from __future__ import annotations

from typing import Any, Iterable

from .config import WEAK_THRESHOLD
from .geometry import normalize_angle_degrees


def side_score(train_bearing: float, sun_azimuth: float, sun_altitude: float) -> float:
    if sun_altitude <= 0.0:
        return 0.0
    relative = normalize_angle_degrees(sun_azimuth - train_bearing)
    import math

    return math.cos(math.radians(sun_altitude)) * math.sin(math.radians(relative))


def classify_exposure(score: float, tunnel: bool, sun_altitude: float) -> tuple[str, float, float]:
    if tunnel:
        return "TUNNEL", 0.0, 0.0
    if sun_altitude <= 0.0:
        return "WEAK", 0.0, 0.0
    if abs(score) < WEAK_THRESHOLD:
        return "WEAK", max(0.0, -score), max(0.0, score)
    return ("RIGHT", 0.0, score) if score > 0.0 else ("LEFT", -score, 0.0)


def weighted_minutes(timeline: Iterable[dict[str, Any]], side: str, interval_seconds: int) -> float:
    key = "leftExposure" if side == "LEFT" else "rightExposure"
    return sum(float(item[key]) for item in timeline) * interval_seconds / 60.0
