from __future__ import annotations

import bisect
from dataclasses import dataclass
from typing import Any

from pyproj import Transformer

from ..geometry import bearing_degrees, geodesic_distance_m

_TO_METRIC = Transformer.from_crs("EPSG:4326", "EPSG:5179", always_xy=True)
_TO_WGS84 = Transformer.from_crs("EPSG:5179", "EPSG:4326", always_xy=True)


@dataclass
class RouteSampler:
    coordinates: list[list[float]]
    cumulative_m: list[float]
    segment_tunnel: list[bool]

    @classmethod
    def from_edges(cls, edges: list[dict[str, Any]]) -> "RouteSampler":
        coordinates: list[list[float]] = []
        tunnels: list[bool] = []
        for edge in edges:
            edge_coordinates = [list(point) for point in edge["geometry"]]
            if not coordinates:
                coordinates.extend(edge_coordinates)
            else:
                if coordinates[-1] != edge_coordinates[0]:
                    coordinates.append(edge_coordinates[0])
                    tunnels.append(bool(edge.get("tunnel", False)))
                coordinates.extend(edge_coordinates[1:])
            tunnels.extend([bool(edge.get("tunnel", False))] * max(1, len(edge_coordinates) - 1))
        if len(coordinates) < 2:
            raise ValueError("route must contain at least two coordinates")
        cumulative = [0.0]
        for first, second in zip(coordinates, coordinates[1:]):
            cumulative.append(cumulative[-1] + geodesic_distance_m(first, second))
        if len(tunnels) < len(coordinates) - 1:
            tunnels.extend([False] * (len(coordinates) - 1 - len(tunnels)))
        return cls(coordinates, cumulative, tunnels[: len(coordinates) - 1])

    @property
    def total_distance_m(self) -> float:
        return self.cumulative_m[-1]

    def _segment_index(self, distance_m: float) -> int:
        if distance_m <= 0:
            return 0
        if distance_m >= self.total_distance_m:
            return len(self.coordinates) - 2
        return max(0, min(len(self.coordinates) - 2, bisect.bisect_right(self.cumulative_m, distance_m) - 1))

    def point_at(self, distance_m: float) -> tuple[float, float]:
        distance_m = min(self.total_distance_m, max(0.0, distance_m))
        index = self._segment_index(distance_m)
        start_m = self.cumulative_m[index]
        end_m = self.cumulative_m[index + 1]
        fraction = 0.0 if end_m == start_m else (distance_m - start_m) / (end_m - start_m)
        x1, y1 = _TO_METRIC.transform(*self.coordinates[index])
        x2, y2 = _TO_METRIC.transform(*self.coordinates[index + 1])
        lon, lat = _TO_WGS84.transform(x1 + (x2 - x1) * fraction, y1 + (y2 - y1) * fraction)
        return float(lon), float(lat)

    def bearing_at(self, distance_m: float, window_m: float = 200.0) -> float:
        start = self.point_at(max(0.0, distance_m - window_m))
        end = self.point_at(min(self.total_distance_m, distance_m + window_m))
        return bearing_degrees(start, end)

    def tunnel_at(self, distance_m: float) -> bool:
        return self.segment_tunnel[self._segment_index(distance_m)]

    def sample(self, distance_m: float) -> dict[str, Any]:
        lon, lat = self.point_at(distance_m)
        return {
            "distance": distance_m,
            "lon": lon,
            "lat": lat,
            "bearing": self.bearing_at(distance_m),
            "tunnel": self.tunnel_at(distance_m),
        }
