from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.config import PROCESSED_DIR, RESULTS_DIR, STATION_ORDER, ensure_data_directories
from sunseat.exposure import classify_exposure, side_score
from sunseat.io import read_json, write_json, write_text


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("validate_results")


def validate() -> None:
    summary = read_json(RESULTS_DIR / "summary.json")
    timeline = read_json(RESULTS_DIR / "timeline.json")
    runs = read_json(RESULTS_DIR / "runs.json")
    route_summary = read_json(PROCESSED_DIR / "route" / "route-summary.json")
    station_mapping = read_json(PROCESSED_DIR / "route" / "station-mapping.json")
    solar_validation = read_json(RESULTS_DIR / "solar-validation.json")
    checks: list[dict[str, object]] = []

    checks.append(_check("route_continuous", bool(route_summary.get("continuous")), "route continuity flag"))
    checks.append(_check("station_order", all(station_mapping[a]["routeDistanceM"] < station_mapping[b]["routeDistanceM"] for a, b in zip(STATION_ORDER, STATION_ORDER[1:])), "station anchor route distances increase"))
    checks.append(_check("route_join", float(route_summary["maxJoinM"]) <= 2000.0, f"max geometry join {route_summary['maxJoinM']:.1f}m; longest OSM segment {route_summary['maxSegmentM']:.1f}m"))
    checks.append(_check("geometry_valid", bool(route_summary.get("geometryValid")), "Shapely route geometry is valid"))
    checks.append(_check("geometry_simple", bool(route_summary.get("geometrySimple")), "route has no self-intersection"))
    checks.append(_check("duplicate_segments", int(route_summary.get("duplicateSegmentCount", -1)) == 0, f"duplicate segment count {route_summary.get('duplicateSegmentCount')}"))
    checks.append(_check("timeline_nonempty", bool(timeline), f"{len(timeline)} raw samples"))
    checks.append(_check("tunnel_mask", all(item["leftExposure"] == 0 and item["rightExposure"] == 0 for item in timeline if item["tunnel"]), "tunnel exposure is zero"))
    checks.append(_check("side_convention", side_score(0.0, 90.0, 30.0) > 0.0 and classify_exposure(side_score(0.0, 90.0, 30.0), False, 30.0)[0] == "RIGHT", "northbound + east sun is RIGHT"))
    checks.append(_check("solar_reference", all(item["comparison"].get("withinOneDegree", False) for item in solar_validation if item["comparison"].get("referenceAvailable")), "NOAA vs Astral within 1 degree"))
    checks.append(_check("solar_reference_present", all(item["comparison"].get("referenceAvailable", False) for item in solar_validation), "independent solar reference available"))

    passed = all(bool(check["passed"]) for check in checks)
    validation = {
        "passed": passed,
        "checks": checks,
        "checkedAt": timeline[-1]["time"] if timeline else None,
    }
    write_json(RESULTS_DIR / "validation.json", validation)
    write_text(RESULTS_DIR / "report.md", make_report(summary, route_summary, station_mapping, solar_validation, runs, validation))
    LOGGER.info("Validation %s", "PASSED" if passed else "FAILED")
    if not passed:
        failed = ", ".join(str(check["name"]) for check in checks if not check["passed"])
        raise RuntimeError(f"PoC validation failed: {failed}")


def _check(name: str, passed: bool, evidence: str) -> dict[str, object]:
    return {"name": name, "passed": passed, "evidence": evidence}


def make_report(summary: dict, route_summary: dict, stations: dict, solar: list[dict], runs: list[dict], validation: dict) -> str:
    solar_lines = []
    for item in solar:
        comparison = item["comparison"]
        solar_lines.append(f"| {item['station']} | {item['time']} | {item['primary']['azimuth']:.3f}° / {item['primary']['altitude']:.3f}° | {comparison.get('azimuthErrorDegrees', float('nan')):.4f}° / {comparison.get('altitudeErrorDegrees', float('nan')):.4f}° |")
    mapping_lines = "\n".join(f"| {name} | {value['osmName']} | {value['routeDistanceM'] / 1000.0:.3f} | {value['nearestDistanceM']:.1f} |" for name, value in stations.items())
    run_lines = "\n".join(f"| {run['side']} | {run['start']} | {run['end']} | {run['durationMinutes']:.1f} |" for run in runs if run["side"] in {"LEFT", "RIGHT", "TUNNEL"})
    check_lines = "\n".join(f"- {'PASS' if check['passed'] else 'FAIL'}: {check['name']} — {check['evidence']}" for check in validation["checks"])
    return f"""# Sun Seat PoC 결과 보고서

## DATA

- OSM source: Overpass API corridor snapshot; raw source metadata is in `data/raw/osm/source-metadata.json`.
- Route generation: OSM `railway=rail` way vertices → endpoint/vertex graph → shortest continuous path through station anchors.
- Position mode: estimated route-distance interpolation using the supplied station timeline; this is not GPS.

## ROUTE

- Total route: **{summary['routeDistanceKm']:.3f} km**
- Tunnel: **{summary['tunnelDistanceKm']:.3f} km ({summary['tunnelPercentage']:.2f}%)**
- Max OSM segment: **{route_summary['maxSegmentM']:.1f} m**; max geometry join: **{route_summary['maxJoinM']:.1f} m**
- Geometry: valid={route_summary['geometryValid']}, simple={route_summary['geometrySimple']}, duplicate segments={route_summary['duplicateSegmentCount']}
- Graph: {route_summary['graphNodeCount']} nodes / {route_summary['graphEdgeCount']} edges

### Station mapping

| Requested | OSM name | Route km | Nearest rail distance m |
|---|---|---:|---:|
{mapping_lines}

## SOLAR

Timezone: **{summary['timezone']}**. Primary calculation: **{summary['solarImplementation']}**. Reference: **{summary['solarValidationReference']}**.

| Checkpoint | Time | NOAA azimuth / altitude | Absolute error azimuth / altitude |
|---|---|---:|---:|
{chr(10).join(solar_lines)}

## EXPOSURE

- Total LEFT raw minutes: **{summary['leftExposureMinutes']:.1f}**
- Total RIGHT raw minutes: **{summary['rightExposureMinutes']:.1f}**
- LEFT weighted exposure: **{summary['leftWeightedExposure']:.3f}**
- RIGHT weighted exposure: **{summary['rightWeightedExposure']:.3f}**
- Raw switch count: **{summary['rawSwitchCount']}**
- Recommended side: **{summary['recommendedSide']}**

## FLICKER

- ≤1 minute: **{summary['switchesUnder1Minute']}**
- ≤2 minutes: **{summary['switchesUnder2Minutes']}**
- ≤3 minutes: **{summary['switchesUnder3Minutes']}**
- ≥5 minutes: **{summary['runsOver5Minutes']}**
- ≥10 minutes: **{summary['runsOver10Minutes']}**
- ≥20 minutes: **{summary['runsOver20Minutes']}**

## LONGEST RUN

- LEFT: **{summary['longestLeftRun']:.1f} min**
- RIGHT: **{summary['longestRightRun']:.1f} min**
- TUNNEL: **{summary['longestTunnelRun']:.1f} min**

| Side | Start | End | Duration min |
|---|---|---|---:|
{run_lines}

## VALIDATION

{check_lines}

## CONCLUSION

**{summary['pocStatus']}**

This result is a data-backed PoC conclusion for the supplied date/time inputs. It must not be described as a live timetable or live GPS prediction.
"""


if __name__ == "__main__":
    ensure_data_directories()
    validate()
