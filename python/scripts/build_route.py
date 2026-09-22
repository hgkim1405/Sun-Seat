from __future__ import annotations

import logging
import sys
from pathlib import Path

from shapely.geometry import LineString

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.config import MAX_EDGE_JUMP_METERS, MAX_STATION_NEAREST_DISTANCE_METERS, PROCESSED_DIR, STATION_ALIASES, STATION_ORDER, ensure_data_directories
from sunseat.geometry import geodesic_distance_m
from sunseat.io import read_json, write_json
from sunseat.railway.graph import build_graph, match_stations, refine_station_nodes, route_edges, route_length_m


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("build_route")


def build() -> None:
    railway_dir = PROCESSED_DIR / "railway"
    railways = read_json(railway_dir / "railways.geojson")["features"]
    stations = read_json(railway_dir / "stations.geojson")["features"]
    graph = build_graph(railways)
    if graph.number_of_nodes() < 2:
        raise RuntimeError("railway graph has fewer than two nodes")
    matches = match_stations(graph, stations, STATION_ALIASES)
    matches = refine_station_nodes(graph, matches, STATION_ORDER)
    station_nodes = [matches[name].nearest_node for name in STATION_ORDER]
    edges = route_edges(graph, station_nodes)
    total_length = route_length_m(edges)
    if total_length <= 0:
        raise RuntimeError("route length is zero")

    route_features = []
    route_coordinate_sequence = []
    cumulative = 0.0
    max_segment = 0.0
    max_join = 0.0
    for edge in edges:
        coordinates = edge["geometry"]
        if not route_coordinate_sequence:
            route_coordinate_sequence.extend(coordinates)
        else:
            if route_coordinate_sequence[-1] != coordinates[0]:
                jump = geodesic_distance_m(route_coordinate_sequence[-1], coordinates[0])
                max_join = max(max_join, jump)
                route_coordinate_sequence.append(coordinates[0])
            route_coordinate_sequence.extend(coordinates[1:])
        edge_length = 0.0
        for first, second in zip(coordinates, coordinates[1:]):
            segment_length = geodesic_distance_m(first, second)
            max_segment = max(max_segment, segment_length)
            edge_length += segment_length
        route_features.append({
            "type": "Feature",
            "properties": {
                "osm_id": edge.get("osm_id"),
                "railway": edge.get("railway"),
                "name": edge.get("name"),
                "tunnel": edge.get("tunnel", False),
                "bridge": edge.get("bridge"),
                "maxspeed": edge.get("maxspeed"),
                "highspeed": edge.get("highspeed"),
                "layer": edge.get("layer"),
                "lengthM": edge_length,
                "startNode": edge.get("startNode"),
                "endNode": edge.get("endNode"),
            },
            "geometry": {"type": "LineString", "coordinates": coordinates},
        })
        cumulative += edge_length

    station_mapping = {}
    for name in STATION_ORDER:
        match = matches[name]
        coordinate = [match.coordinate[0], match.coordinate[1]]
        distances = [0.0]
        for first, second in zip(route_coordinate_sequence, route_coordinate_sequence[1:]):
            distances.append(distances[-1] + geodesic_distance_m(first, second))
        nearest_index = min(range(len(route_coordinate_sequence)), key=lambda index: geodesic_distance_m(route_coordinate_sequence[index], coordinate))
        station_mapping[name] = {
            "osmId": match.osm_id,
            "osmName": match.name,
            "coordinate": coordinate,
            "routeDistanceM": distances[nearest_index],
            "nearestDistanceM": match.nearest_distance_m,
            "graphNode": list(match.nearest_node),
        }

    max_nearest_station = max(item["nearestDistanceM"] for item in station_mapping.values())
    if max_nearest_station > MAX_STATION_NEAREST_DISTANCE_METERS:
        raise RuntimeError(f"station anchor is too far from railway graph: {max_nearest_station:.1f}m")
    if max_join > MAX_EDGE_JUMP_METERS:
        raise RuntimeError(f"route contains a geometry join above {MAX_EDGE_JUMP_METERS}m: {max_join:.1f}m")
    if any(station_mapping[a]["routeDistanceM"] >= station_mapping[b]["routeDistanceM"] for a, b in zip(STATION_ORDER, STATION_ORDER[1:])):
        raise RuntimeError("station route distances are not strictly increasing")
    route_line = LineString(route_coordinate_sequence)
    segment_keys = [tuple(sorted((tuple(first), tuple(second)))) for first, second in zip(route_coordinate_sequence, route_coordinate_sequence[1:])]
    duplicate_segment_count = len(segment_keys) - len(set(segment_keys))

    output_dir = PROCESSED_DIR / "route"
    write_json(output_dir / "route.geojson", {"type": "FeatureCollection", "features": route_features})
    write_json(output_dir / "route-segments.json", edges)
    write_json(output_dir / "station-mapping.json", station_mapping)
    write_json(output_dir / "route-summary.json", {
        "stationOrder": STATION_ORDER,
        "routeLengthM": total_length,
        "routeLengthKm": total_length / 1000.0,
        "graphNodeCount": graph.number_of_nodes(),
        "graphEdgeCount": graph.number_of_edges(),
        "routeFeatureCount": len(route_features),
        "maxSegmentM": max_segment,
        "maxJoinM": max_join,
        "maxSegmentOrJoinM": max(max_segment, max_join),
        "maxStationNearestDistanceM": max_nearest_station,
        "continuous": True,
        "geometryValid": bool(route_line.is_valid),
        "geometrySimple": bool(route_line.is_simple),
        "duplicateSegmentCount": duplicate_segment_count,
        "selfIntersectionCheck": "passed" if route_line.is_simple else "failed",
    })
    LOGGER.info("Built route %.2fkm with %d segments", total_length / 1000.0, len(edges))


if __name__ == "__main__":
    ensure_data_directories()
    build()
