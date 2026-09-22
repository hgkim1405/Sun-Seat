from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable


def group_runs(timeline: Iterable[dict[str, Any]], interval_seconds: int) -> list[dict[str, Any]]:
    items = list(timeline)
    if not items:
        return []
    runs: list[dict[str, Any]] = []
    current_side = str(items[0]["rawSide"])
    start = items[0]["time"]
    count = 0
    for item in items:
        side = str(item["rawSide"])
        if side != current_side:
            runs.append(_run(current_side, start, item["time"], count, interval_seconds))
            current_side = side
            start = item["time"]
            count = 0
        count += 1
    end_time = _add_seconds(items[-1]["time"], interval_seconds)
    runs.append(_run(current_side, start, end_time, count, interval_seconds))
    return runs


def _add_seconds(value: str, seconds: int) -> str:
    return (datetime.fromisoformat(value) + timedelta(seconds=seconds)).isoformat()


def _run(side: str, start: str, end: str, count: int, interval_seconds: int) -> dict[str, Any]:
    return {
        "side": side,
        "start": start,
        "end": end,
        "durationMinutes": count * interval_seconds / 60.0,
        "sampleCount": count,
    }


def count_short_switches(runs: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"switchesUnder1Minute": 0, "switchesUnder2Minutes": 0, "switchesUnder3Minutes": 0}
    for run in runs:
        duration = float(run["durationMinutes"])
        if run["side"] in {"LEFT", "RIGHT"}:
            if duration <= 1.0:
                counts["switchesUnder1Minute"] += 1
            if duration <= 2.0:
                counts["switchesUnder2Minutes"] += 1
            if duration <= 3.0:
                counts["switchesUnder3Minutes"] += 1
    return counts


def run_stats(runs: list[dict[str, Any]]) -> dict[str, Any]:
    counts = count_short_switches(runs)
    side_runs = [run for run in runs if run["side"] in {"LEFT", "RIGHT"}]
    return {
        **counts,
        "runsOver5Minutes": sum(1 for run in side_runs if run["durationMinutes"] >= 5.0),
        "runsOver10Minutes": sum(1 for run in side_runs if run["durationMinutes"] >= 10.0),
        "runsOver20Minutes": sum(1 for run in side_runs if run["durationMinutes"] >= 20.0),
        "longestLeftRun": max((run["durationMinutes"] for run in runs if run["side"] == "LEFT"), default=0.0),
        "longestRightRun": max((run["durationMinutes"] for run in runs if run["side"] == "RIGHT"), default=0.0),
        "longestTunnelRun": max((run["durationMinutes"] for run in runs if run["side"] == "TUNNEL"), default=0.0),
    }


def aggregate_timeline(timeline: list[dict[str, Any]], bucket_seconds: int) -> list[dict[str, Any]]:
    if not timeline:
        return []
    buckets: dict[int, list[dict[str, Any]]] = {}
    first_epoch = datetime.fromisoformat(timeline[0]["time"]).timestamp()
    for item in timeline:
        bucket = int((datetime.fromisoformat(item["time"]).timestamp() - first_epoch) // bucket_seconds)
        buckets.setdefault(bucket, []).append(item)
    output = []
    for bucket, items in buckets.items():
        def mean(key: str) -> float:
            return sum(float(item[key]) for item in items) / len(items)

        representative = max(items, key=lambda item: max(float(item["leftExposure"]), float(item["rightExposure"])))
        output.append({
            "time": items[0]["time"],
            "distance": mean("distance"),
            "lat": mean("lat"),
            "lon": mean("lon"),
            "bearing": mean("bearing"),
            "sunAzimuth": mean("sunAzimuth"),
            "sunAltitude": mean("sunAltitude"),
            "tunnel": all(bool(item["tunnel"]) for item in items),
            "leftExposure": mean("leftExposure"),
            "rightExposure": mean("rightExposure"),
            "rawSide": representative["rawSide"],
            "sampleCount": len(items),
        })
    return output
