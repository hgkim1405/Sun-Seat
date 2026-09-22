from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.config import PROCESSED_DIR, RESULTS_DIR, SAMPLE_INTERVAL_SECONDS, STATION_TIMELINE, TIMEZONE, ensure_data_directories, local_datetime
from sunseat.io import read_json, write_json
from sunseat.railway.sampler import RouteSampler


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("generate_samples")


def position_at(moment: datetime, events: list[tuple[datetime, str, str]], station_distances: dict[str, float]) -> float:
    if moment <= events[0][0]:
        return station_distances[events[0][1]]
    if moment >= events[-1][0]:
        return station_distances[events[-1][1]]
    for first, second in zip(events, events[1:]):
        first_time, first_station, _ = first
        second_time, second_station, _ = second
        if first_time <= moment <= second_time:
            first_distance = station_distances[first_station]
            second_distance = station_distances[second_station]
            duration = (second_time - first_time).total_seconds()
            if duration <= 0 or first_station == second_station:
                return first_distance
            progress = (moment - first_time).total_seconds() / duration
            return first_distance + (second_distance - first_distance) * progress
    raise RuntimeError(f"unable to interpolate position at {moment.isoformat()}")


def generate() -> None:
    route_edges = read_json(PROCESSED_DIR / "route" / "route-segments.json")
    station_mapping = read_json(PROCESSED_DIR / "route" / "station-mapping.json")
    sampler = RouteSampler.from_edges(route_edges)
    events = [(local_datetime(moment), station, kind) for station, moment, kind in STATION_TIMELINE]
    station_distances = {name: float(value["routeDistanceM"]) for name, value in station_mapping.items()}
    start = events[0][0]
    end = events[-1][0]
    samples = []
    moment = start
    while moment <= end:
        distance = position_at(moment, events, station_distances)
        item = sampler.sample(distance)
        item["time"] = moment.isoformat()
        item["estimatedPosition"] = True
        samples.append(item)
        moment += timedelta(seconds=SAMPLE_INTERVAL_SECONDS)
    write_json(RESULTS_DIR / "samples-30s.json", samples)
    write_json(RESULTS_DIR / "sample-metadata.json", {
        "date": start.date().isoformat(),
        "timezone": str(TIMEZONE),
        "sampleIntervalSeconds": SAMPLE_INTERVAL_SECONDS,
        "sampleCount": len(samples),
        "positionMode": "estimated route-distance interpolation between supplied station times",
        "stationTimeline": [{"station": station, "time": local_datetime(moment).isoformat(), "event": kind} for station, moment, kind in STATION_TIMELINE],
    })
    LOGGER.info("Generated %d route samples at %ds interval", len(samples), SAMPLE_INTERVAL_SECONDS)


if __name__ == "__main__":
    ensure_data_directories()
    generate()

