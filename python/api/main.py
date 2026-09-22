from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from sunseat.analysis import group_runs, run_stats
from sunseat.exposure import classify_exposure, side_score, weighted_minutes
from sunseat.io import read_json
from sunseat.railway.sampler import RouteSampler
from sunseat.solar import solar_position_noaa


ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
TIMEZONE = ZoneInfo(os.getenv("SUNSEAT_TIMEZONE", "Asia/Seoul"))
CALCULATION_VERSION = os.getenv("SUNSEAT_CALCULATION_VERSION", "2026-09-22-noaa-v1")
SAMPLE_INTERVAL_SECONDS = 30


class StationEvent(BaseModel):
    station: str = Field(min_length=1)
    time: datetime
    event: Literal["arrival", "departure"]


class ExposureRequest(BaseModel):
    origin: str = Field(min_length=1)
    destination: str = Field(min_length=1)
    departure: datetime
    arrival: datetime
    stationTimeline: list[StationEvent] = Field(min_length=2)
    routeId: str = Field(default="seoul-busan", min_length=1)
    calculationVersion: str | None = None

    @field_validator("departure", "arrival")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datetime must include a timezone offset")
        return value.astimezone(TIMEZONE)


class ExposureBatchRequest(BaseModel):
    requests: list[ExposureRequest] = Field(min_length=1, max_length=20)


class RouteDataset:
    def __init__(self) -> None:
        route_id = os.getenv("SUNSEAT_ROUTE_ID", "seoul-busan")
        self.route_id = route_id
        manifest_path = DATA_DIR / "processed" / "active.json"
        manifest = read_json(manifest_path) if manifest_path.exists() else None
        processed_root = DATA_DIR / "processed" / manifest["routeRoot"] if manifest else DATA_DIR / "processed" / "route"
        results_root = DATA_DIR / "processed" / manifest["resultsRoot"] if manifest else DATA_DIR / "results" / "poc"
        self.dataset_version = manifest["version"] if manifest else "osm-overpass-2026-09-22"
        self.station_mapping = read_json(processed_root / "station-mapping.json")
        self.route_summary = read_json(processed_root / "route-summary.json")
        self.route_edges = read_json(processed_root / "route-segments.json")
        self.summary = read_json(results_root / "summary.json")
        self.sampler = RouteSampler.from_edges(self.route_edges)

    def station_distance(self, name: str) -> float:
        if name not in self.station_mapping:
            raise KeyError(name)
        return float(self.station_mapping[name]["routeDistanceM"])

    def validate_request(self, request: ExposureRequest) -> tuple[float, float, bool]:
        try:
            origin_distance = self.station_distance(request.origin)
            destination_distance = self.station_distance(request.destination)
        except KeyError as error:
            raise HTTPException(status_code=422, detail=f"Unknown station anchor: {error.args[0]}") from error
        if request.routeId != self.route_id:
            raise HTTPException(status_code=404, detail=f"Route dataset is not available: {request.routeId}")
        if request.arrival <= request.departure:
            raise HTTPException(status_code=422, detail="arrival must be after departure")
        if request.stationTimeline[0].station != request.origin or request.stationTimeline[-1].station != request.destination:
            raise HTTPException(status_code=422, detail="stationTimeline must start at origin and end at destination")
        reverse = destination_distance < origin_distance
        distances = [self.station_distance(event.station) for event in request.stationTimeline]
        if reverse:
            if any(first < second for first, second in zip(distances, distances[1:])):
                raise HTTPException(status_code=422, detail="stationTimeline is not ordered from origin to destination")
        elif any(first > second for first, second in zip(distances, distances[1:])):
            raise HTTPException(status_code=422, detail="stationTimeline is not ordered from origin to destination")
        return origin_distance, destination_distance, reverse

    def position_at(self, moment: datetime, events: list[tuple[datetime, float]]) -> float:
        if moment <= events[0][0]:
            return events[0][1]
        if moment >= events[-1][0]:
            return events[-1][1]
        for first, second in zip(events, events[1:]):
            first_time, first_distance = first
            second_time, second_distance = second
            if first_time <= moment <= second_time:
                duration = (second_time - first_time).total_seconds()
                if duration <= 0:
                    return first_distance
                progress = (moment - first_time).total_seconds() / duration
                return first_distance + (second_distance - first_distance) * progress
        return events[-1][1]


dataset: RouteDataset | None = None


def _require_dataset() -> RouteDataset:
    if dataset is None:
        raise HTTPException(status_code=503, detail="Active route dataset is not ready")
    return dataset


def _iso(value: datetime) -> str:
    return value.astimezone(TIMEZONE).isoformat()


def _build_segments(timeline: list[dict]) -> list[dict]:
    if not timeline:
        return []
    segments: list[dict] = []
    start = timeline[0]
    current_type = _segment_type(start)
    for item in timeline[1:]:
        item_type = _segment_type(item)
        if item_type != current_type:
            segments.append({
                "type": current_type,
                "start": start["time"],
                "end": item["time"],
                "durationMinutes": round((datetime.fromisoformat(item["time"]) - datetime.fromisoformat(start["time"])).total_seconds() / 60.0, 3),
                "distanceStartM": start["distance"],
                "distanceEndM": item["distance"],
            })
            start = item
            current_type = item_type
    last = timeline[-1]
    segments.append({
        "type": current_type,
        "start": start["time"],
        "end": _iso(datetime.fromisoformat(last["time"]) + timedelta(seconds=SAMPLE_INTERVAL_SECONDS)),
        "durationMinutes": round((datetime.fromisoformat(last["time"]) + timedelta(seconds=SAMPLE_INTERVAL_SECONDS) - datetime.fromisoformat(start["time"])).total_seconds() / 60.0, 3),
        "distanceStartM": start["distance"],
        "distanceEndM": last["distance"],
    })
    return segments


def _segment_type(item: dict) -> str:
    if item["tunnel"]:
        return "TUNNEL"
    if item["sunAltitude"] <= 0:
        return "NIGHT"
    return item["rawSide"]


def calculate(request: ExposureRequest) -> dict:
    active = _require_dataset()
    origin_distance, destination_distance, reverse = active.validate_request(request)
    events: list[tuple[datetime, float]] = []
    for event in request.stationTimeline:
        if event.station not in active.station_mapping:
            raise HTTPException(status_code=422, detail=f"Unknown station anchor: {event.station}")
        events.append((event.time.astimezone(TIMEZONE), active.station_distance(event.station)))
    events.sort(key=lambda item: item[0])
    if events[0][0] > request.departure or events[-1][0] < request.arrival:
        raise HTTPException(status_code=422, detail="stationTimeline must cover departure and arrival")
    samples: list[dict] = []
    moment = request.departure.astimezone(TIMEZONE)
    end = request.arrival.astimezone(TIMEZONE)
    while moment <= end:
        distance = active.position_at(moment, events)
        route_sample = active.sampler.sample(distance)
        bearing = route_sample["bearing"]
        if reverse:
            bearing = (bearing + 180.0) % 360.0
        solar = solar_position_noaa(moment, route_sample["lat"], route_sample["lon"])
        score = side_score(bearing, solar["azimuth"], solar["altitude"])
        raw_side, left, right = classify_exposure(score, route_sample["tunnel"], solar["altitude"])
        samples.append({
            **route_sample,
            "bearing": bearing,
            "time": _iso(moment),
            "sunAzimuth": solar["azimuth"],
            "sunAltitude": solar["altitude"],
            "sideScore": score,
            "leftExposure": left,
            "rightExposure": right,
            "rawSide": raw_side,
            "positionMode": "estimated_route_distance_interpolation",
        })
        moment += timedelta(seconds=SAMPLE_INTERVAL_SECONDS)
    if not samples or samples[-1]["time"] != _iso(end):
        # Keep the requested arrival visible even when it is not on a 30-second boundary.
        moment = end
        distance = active.position_at(moment, events)
        route_sample = active.sampler.sample(distance)
        bearing = (route_sample["bearing"] + (180.0 if reverse else 0.0)) % 360.0
        solar = solar_position_noaa(moment, route_sample["lat"], route_sample["lon"])
        score = side_score(bearing, solar["azimuth"], solar["altitude"])
        raw_side, left, right = classify_exposure(score, route_sample["tunnel"], solar["altitude"])
        samples.append({**route_sample, "bearing": bearing, "time": _iso(moment), "sunAzimuth": solar["azimuth"], "sunAltitude": solar["altitude"], "sideScore": score, "leftExposure": left, "rightExposure": right, "rawSide": raw_side, "positionMode": "estimated_route_distance_interpolation"})
    runs = group_runs(samples, SAMPLE_INTERVAL_SECONDS)
    stats = run_stats(runs)
    left_weighted = weighted_minutes(samples, "LEFT", SAMPLE_INTERVAL_SECONDS)
    right_weighted = weighted_minutes(samples, "RIGHT", SAMPLE_INTERVAL_SECONDS)
    return {
        "routeId": active.route_id,
        "calculationVersion": request.calculationVersion or CALCULATION_VERSION,
        "recommendedSide": "LEFT" if left_weighted < right_weighted else "RIGHT" if right_weighted < left_weighted else "NONE",
        "summary": {
            "routeDistanceKm": abs(destination_distance - origin_distance) / 1000.0,
            "totalTravelMinutes": (end - request.departure.astimezone(TIMEZONE)).total_seconds() / 60.0,
            "sampleIntervalSeconds": SAMPLE_INTERVAL_SECONDS,
            "sampleCount": len(samples),
            "leftExposureMinutes": sum(item["rawSide"] == "LEFT" for item in samples) * SAMPLE_INTERVAL_SECONDS / 60.0,
            "rightExposureMinutes": sum(item["rawSide"] == "RIGHT" for item in samples) * SAMPLE_INTERVAL_SECONDS / 60.0,
            "leftWeightedExposure": left_weighted,
            "rightWeightedExposure": right_weighted,
            "tunnelMinutes": sum(item["tunnel"] for item in samples) * SAMPLE_INTERVAL_SECONDS / 60.0,
            **stats,
        },
        "precision": {
            "position": "estimated",
            "schedule": "provided_station_timeline",
            "solar": "NOAA solar position equations",
            "weather": "clear_sky_only",
            "shadow": "not_modelled",
        },
        "segments": _build_segments(samples),
        "timeline": samples,
    }


def load_active_dataset() -> None:
    global dataset
    try:
        dataset = RouteDataset()
    except (FileNotFoundError, KeyError, ValueError) as error:
        dataset = None
        print(f"SunSeat calculation dataset is unavailable: {error}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_active_dataset()
    yield


app = FastAPI(title="SunSeat calculation service", version=CALCULATION_VERSION, lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok" if dataset is not None else "degraded", "datasetLoaded": dataset is not None, "routeId": dataset.route_id if dataset else None, "calculationVersion": CALCULATION_VERSION}


@app.post("/calculate/exposure")
def exposure(request: ExposureRequest) -> dict:
    return calculate(request)


@app.post("/calculate/exposure/batch")
def exposure_batch(request: ExposureBatchRequest) -> dict:
    return {"results": [calculate(item) for item in request.requests]}
