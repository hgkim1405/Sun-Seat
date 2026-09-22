"""Stage a verified processed dataset and switch the active manifest atomically.

The existing PoC pipeline writes to data/processed and data/results/poc. This
script copies those validated outputs into a version directory before changing
the small active manifest, so a failed copy or validation never changes the
currently active dataset.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.io import read_json, write_json


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
PROCESSED = DATA / "processed"
RESULTS = DATA / "results" / "poc"


def validate(source_processed: Path, source_results: Path) -> None:
    route_summary = read_json(source_processed / "route" / "route-summary.json")
    if not route_summary.get("continuous") or not route_summary.get("geometryValid") or not route_summary.get("geometrySimple"):
        raise ValueError("source route failed continuity or geometry validation")
    if int(route_summary.get("duplicateSegmentCount", 1)) != 0:
        raise ValueError("source route contains duplicate segments")
    validation = read_json(source_results / "validation.json")
    if validation.get("passed") is not True and validation.get("status") not in {"PASS", "pass"}:
        raise ValueError("source validation.json is not PASS")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=datetime.now(timezone.utc).strftime("v%Y%m%d%H%M%S"))
    args = parser.parse_args()
    validate(PROCESSED, RESULTS)
    versions = PROCESSED / "versions"
    versions.mkdir(parents=True, exist_ok=True)
    staging = versions / f".staging-{uuid.uuid4().hex}"
    target = versions / args.version
    try:
        shutil.copytree(PROCESSED / "route", staging / "route")
        if (PROCESSED / "tunnels").exists():
            shutil.copytree(PROCESSED / "tunnels", staging / "tunnels")
        shutil.copytree(RESULTS, staging / "results")
        validate(staging, staging / "results")
        staging.rename(target)
        write_json(PROCESSED / "active.json", {
            "version": args.version,
            "routeRoot": f"versions/{args.version}/route",
            "resultsRoot": f"versions/{args.version}/results",
            "activatedAt": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    print(f"Activated SunSeat dataset {args.version}")


if __name__ == "__main__":
    main()
