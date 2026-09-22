from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.analysis import aggregate_timeline, group_runs, run_stats
from sunseat.config import PROCESSED_DIR, RESULTS_DIR, SAMPLE_INTERVAL_SECONDS, STATION_TIMELINE, TIMEZONE_NAME, ensure_data_directories
from sunseat.exposure import classify_exposure, side_score, weighted_minutes
from sunseat.io import read_json, write_json
from sunseat.solar import compare_solar_positions, solar_position_astral, solar_position_noaa


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("calculate_sun_exposure")


def calculate() -> None:
    samples = read_json(RESULTS_DIR / "samples-30s.json")
    route_summary = read_json(PROCESSED_DIR / "route" / "route-summary.json")
    tunnel_summary = read_json(PROCESSED_DIR / "tunnels" / "tunnel-summary.json")
    station_mapping = read_json(PROCESSED_DIR / "route" / "station-mapping.json")
    timeline = []
    solar_validation = []
    for sample in samples:
        position = solar_position_noaa_from_iso(sample["time"], sample["lat"], sample["lon"])
        score = side_score(sample["bearing"], position["azimuth"], position["altitude"])
        raw_side, left, right = classify_exposure(score, bool(sample["tunnel"]), position["altitude"])
        timeline.append({
            **sample,
            "sunAzimuth": position["azimuth"],
            "sunAltitude": position["altitude"],
            "sideScore": score,
            "leftExposure": left,
            "rightExposure": right,
            "rawSide": raw_side,
        })

    # Independent solar check at the three required route anchors using NOAA
    # equations versus Astral when installed.
    for station in ("서울", "대전", "부산"):
        mapping = station_mapping[station]
        sample = min(timeline, key=lambda item: abs(float(item["distance"]) - float(mapping["routeDistanceM"])))
        primary = solar_position_noaa_from_iso(sample["time"], sample["lat"], sample["lon"])
        reference = solar_position_astral_from_iso(sample["time"], sample["lat"], sample["lon"])
        solar_validation.append({
            "station": station,
            "time": sample["time"],
            "lat": sample["lat"],
            "lon": sample["lon"],
            "primary": primary,
            "reference": reference,
            "comparison": compare_solar_positions(primary, reference),
        })

    runs = group_runs(timeline, SAMPLE_INTERVAL_SECONDS)
    stats = run_stats(runs)
    raw_switch_count = sum(1 for first, second in zip(timeline, timeline[1:]) if first["rawSide"] != second["rawSide"])
    left_weighted = weighted_minutes(timeline, "LEFT", SAMPLE_INTERVAL_SECONDS)
    right_weighted = weighted_minutes(timeline, "RIGHT", SAMPLE_INTERVAL_SECONDS)
    left_minutes = sum(1 for item in timeline if item["rawSide"] == "LEFT") * SAMPLE_INTERVAL_SECONDS / 60.0
    right_minutes = sum(1 for item in timeline if item["rawSide"] == "RIGHT") * SAMPLE_INTERVAL_SECONDS / 60.0
    side_runs = [run for run in runs if run["side"] in {"LEFT", "RIGHT"}]
    has_multiple_meaningful_runs = sum(1 for run in side_runs if run["durationMinutes"] >= 5.0) >= 2
    has_long_run = any(run["durationMinutes"] >= 10.0 for run in side_runs)
    weighted_difference = abs(left_weighted - right_weighted)
    poc_status = "PASS" if has_multiple_meaningful_runs or has_long_run or weighted_difference >= 10.0 else "INVESTIGATE"
    summary = {
        "routeDistanceKm": route_summary["routeLengthKm"],
        "tunnelDistanceKm": tunnel_summary["tunnelDistanceM"] / 1000.0,
        "tunnelPercentage": (tunnel_summary["tunnelDistanceM"] / route_summary["routeLengthM"] * 100.0) if route_summary["routeLengthM"] else 0.0,
        "totalTravelMinutes": (len(timeline) - 1) * SAMPLE_INTERVAL_SECONDS / 60.0,
        "sampleIntervalSeconds": SAMPLE_INTERVAL_SECONDS,
        "sampleCount": len(timeline),
        "leftExposureMinutes": left_minutes,
        "rightExposureMinutes": right_minutes,
        "leftWeightedExposure": left_weighted,
        "rightWeightedExposure": right_weighted,
        "rawSwitchCount": raw_switch_count,
        **stats,
        "recommendedSide": "LEFT" if left_weighted < right_weighted else "RIGHT" if right_weighted < left_weighted else "NONE",
        "pocStatus": poc_status,
        "timezone": TIMEZONE_NAME,
        "positionMode": "estimated",
        "solarImplementation": "NOAA solar position equations",
        "solarValidationReference": "Astral when available",
    }
    write_json(RESULTS_DIR / "timeline.json", timeline)
    write_json(RESULTS_DIR / "timeline-1m.json", aggregate_timeline(timeline, 60))
    write_json(RESULTS_DIR / "timeline-5m.json", aggregate_timeline(timeline, 300))
    write_json(RESULTS_DIR / "runs.json", runs)
    write_json(RESULTS_DIR / "solar-validation.json", solar_validation)
    write_json(RESULTS_DIR / "summary.json", summary)
    LOGGER.info("Exposure complete: %s, raw switches=%d, recommended=%s", poc_status, raw_switch_count, summary["recommendedSide"])


def solar_position_noaa_from_iso(value: str, latitude: float, longitude: float) -> dict[str, float]:
    from datetime import datetime

    return solar_position_noaa(datetime.fromisoformat(value), latitude, longitude)


def solar_position_astral_from_iso(value: str, latitude: float, longitude: float) -> dict[str, float] | None:
    from datetime import datetime

    return solar_position_astral(datetime.fromisoformat(value), latitude, longitude)


if __name__ == "__main__":
    ensure_data_directories()
    calculate()
