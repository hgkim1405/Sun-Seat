from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.main import ExposureRequest, calculate, load_active_dataset  # noqa: E402
from sunseat.config import DATA_DIR, RESULTS_DIR, STATION_TIMELINE, local_datetime  # noqa: E402
from sunseat.geometry import geodesic_distance_m  # noqa: E402
from sunseat.io import read_json, write_json, write_text  # noqa: E402


STATION_ORDER = ["서울", "광명", "오송", "대전", "동대구", "부산"]
DEMO_VERSION = "demo-seoul-busan-2026-09-23"


def midpoint(start: list[float], end: list[float], index: int) -> list[float]:
    # A small lateral offset makes the demo line look like a railway corridor
    # on the route map instead of a single straight diagonal.
    offsets = (0.012, -0.018, 0.014, -0.012, 0.009)
    return [
        round((start[0] + end[0]) / 2, 7),
        round((start[1] + end[1]) / 2 + offsets[index % len(offsets)], 7),
    ]


def downsample(items: list[dict], step: int) -> list[dict]:
    reduced = items[::step]
    if items and reduced[-1] != items[-1]:
        reduced.append(items[-1])
    return reduced


def build_route(stations: dict[str, dict]) -> tuple[list[dict], dict[str, dict], dict]:
    edges: list[dict] = []
    station_mapping: dict[str, dict] = {}
    cumulative = 0.0

    for index, (origin, destination) in enumerate(zip(STATION_ORDER, STATION_ORDER[1:])):
        start = [float(stations[origin]["longitude"]), float(stations[origin]["latitude"])]
        end = [float(stations[destination]["longitude"]), float(stations[destination]["latitude"])]
        geometry = [start, midpoint(start, end, index), end]
        tunnel = index in {2, 3}
        edges.append({
            "geometry": geometry,
            "tunnel": tunnel,
            "railway": "rail",
            "name": f"SunSeat 데모 구간 {index + 1}",
            "demo": True,
        })

        if origin not in station_mapping:
            station_mapping[origin] = {
                "osmName": origin,
                "coordinate": start,
                "routeDistanceM": cumulative,
                "nearestDistanceM": 0.0,
                "demo": True,
            }
        cumulative += sum(geodesic_distance_m(a, b) for a, b in zip(geometry, geometry[1:]))
        station_mapping[destination] = {
            "osmName": destination,
            "coordinate": end,
            "routeDistanceM": cumulative,
            "nearestDistanceM": 0.0,
            "demo": True,
        }

    route_summary = {
        "routeId": "seoul-busan",
        "stationOrder": STATION_ORDER,
        "routeLengthM": cumulative,
        "routeLengthKm": cumulative / 1000.0,
        "routeFeatureCount": len(edges),
        "continuous": True,
        "geometryValid": True,
        "geometrySimple": True,
        "source": "DEMO_FROM_METADATA_COORDINATES",
        "isDemoData": True,
        "version": DEMO_VERSION,
    }
    return edges, station_mapping, route_summary


def to_geojson(edges: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "railway": edge["railway"],
                    "name": edge["name"],
                    "tunnel": edge["tunnel"],
                    "demo": True,
                },
                "geometry": {"type": "LineString", "coordinates": edge["geometry"]},
            }
            for edge in edges
        ],
        "properties": {
            "routeId": "seoul-busan",
            "source": "DEMO_FROM_METADATA_COORDINATES",
            "isDemoData": True,
        },
    }


def create_dataset(force: bool) -> None:
    metadata = read_json(DATA_DIR / "metadata" / "stations.json")
    station_records = {item["name"]: item for item in metadata["stations"]}
    missing = [name for name in STATION_ORDER if name not in station_records]
    if missing:
        raise RuntimeError(f"station metadata is missing: {', '.join(missing)}")

    processed_dir = DATA_DIR / "processed" / "route"
    output_files = [
        processed_dir / "route.geojson",
        processed_dir / "route-segments.json",
        processed_dir / "station-mapping.json",
        processed_dir / "route-summary.json",
        RESULTS_DIR / "summary.json",
        RESULTS_DIR / "timeline.json",
        RESULTS_DIR / "timeline-1m.json",
        RESULTS_DIR / "timeline-5m.json",
        RESULTS_DIR / "report.md",
    ]
    if not force:
        existing = [path for path in output_files if path.exists()]
        if existing:
            names = ", ".join(str(path.relative_to(DATA_DIR.parent)) for path in existing)
            raise RuntimeError(f"output already exists: {names}. Use --force to replace it.")

    edges, station_mapping, route_summary = build_route(station_records)
    write_json(processed_dir / "route.geojson", to_geojson(edges))
    write_json(processed_dir / "route-segments.json", edges)
    write_json(processed_dir / "station-mapping.json", station_mapping)
    write_json(processed_dir / "route-summary.json", route_summary)

    # Create a temporary summary so RouteDataset can be loaded by calculate().
    write_json(RESULTS_DIR / "summary.json", {"isDemoData": True, "version": DEMO_VERSION})
    load_active_dataset()
    station_timeline = [
        {"station": station, "time": local_datetime(moment).isoformat(), "event": event}
        for station, moment, event in STATION_TIMELINE
    ]
    exposure = calculate(ExposureRequest(
        origin=STATION_ORDER[0],
        destination=STATION_ORDER[-1],
        departure=station_timeline[0]["time"],
        arrival=station_timeline[-1]["time"],
        stationTimeline=station_timeline,
    ))
    timeline = exposure["timeline"]
    route_length_km = route_summary["routeLengthKm"]
    tunnel_count = sum(1 for item in timeline if item["tunnel"])
    poc_summary = {
        "pocStatus": "PASS · DEMO DATA",
        "routeId": "seoul-busan",
        "recommendedSide": exposure["recommendedSide"],
        "leftWeightedExposure": exposure["summary"]["leftWeightedExposure"],
        "rightWeightedExposure": exposure["summary"]["rightWeightedExposure"],
        "tunnelDistanceKm": route_length_km * tunnel_count / max(1, len(timeline)),
        "tunnelPercentage": tunnel_count / max(1, len(timeline)) * 100,
        "sampleCount": len(timeline),
        "sampleIntervalSeconds": 30,
        "isDemoData": True,
        "source": "역 메타데이터 좌표 기반 합성 경로 · UI 확인용",
        "generatedAt": "2026-09-23T00:00:00+09:00",
    }
    write_json(RESULTS_DIR / "summary.json", poc_summary)
    write_json(RESULTS_DIR / "timeline.json", timeline)
    write_json(RESULTS_DIR / "timeline-1m.json", downsample(timeline, 2))
    write_json(RESULTS_DIR / "timeline-5m.json", downsample(timeline, 10))
    write_text(DATA_DIR / "results" / "poc" / "report.md", """# SunSeat 데모 데이터\n\n이 결과는 실제 OSM 철도 선형이 아니라 UI와 계산 흐름을 확인하기 위해 역 메타데이터 좌표로 만든 합성 경로입니다. 실서비스 결과나 실제 운행 선형으로 사용하면 안 됩니다.\n""")

    print(f"created demo route: {route_summary['routeLengthKm']:.1f} km")
    print(f"created exposure timeline: {len(timeline)} samples")
    print("route: 서울 → 광명 → 오송 → 대전 → 동대구 → 부산")
    print("source: DEMO_FROM_METADATA_COORDINATES")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create local demo route data for the SunSeat UI.")
    parser.add_argument("--force", action="store_true", help="replace existing demo/PoC outputs")
    args = parser.parse_args()
    create_dataset(args.force)
