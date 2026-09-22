from __future__ import annotations

import math
from typing import Iterable, Sequence

from pyproj import Geod

GEOD = Geod(ellps="WGS84")


def geodesic_distance_m(a: Sequence[float], b: Sequence[float]) -> float:
    _, _, distance = GEOD.inv(float(a[0]), float(a[1]), float(b[0]), float(b[1]))
    return abs(float(distance))


def bearing_degrees(a: Sequence[float], b: Sequence[float]) -> float:
    azimuth, _, _ = GEOD.inv(float(a[0]), float(a[1]), float(b[0]), float(b[1]))
    return float((azimuth + 360.0) % 360.0)


def normalize_angle_degrees(value: float) -> float:
    return (value + 180.0) % 360.0 - 180.0


def polyline_length_m(coordinates: Iterable[Sequence[float]]) -> float:
    points = list(coordinates)
    return sum(geodesic_distance_m(a, b) for a, b in zip(points, points[1:]))


def interpolate_geodesic(a: Sequence[float], b: Sequence[float], fraction: float) -> tuple[float, float]:
    fraction = min(1.0, max(0.0, fraction))
    azimuth, _, distance = GEOD.inv(float(a[0]), float(a[1]), float(b[0]), float(b[1]))
    lon, lat, _ = GEOD.fwd(float(a[0]), float(a[1]), azimuth, distance * fraction)
    return float(lon), float(lat)


def smooth_bearing_at(coordinates: Sequence[Sequence[float]], index: int, window_vertices: int = 5) -> float:
    start = max(0, index - window_vertices)
    end = min(len(coordinates) - 1, index + window_vertices)
    if start == end:
        return bearing_degrees(coordinates[max(0, index - 1)], coordinates[min(len(coordinates) - 1, index + 1)])
    return bearing_degrees(coordinates[start], coordinates[end])


def finite_or_zero(value: float) -> float:
    return value if math.isfinite(value) else 0.0

