from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Any

import networkx as nx

from ..geometry import bearing_degrees, geodesic_distance_m, polyline_length_m


@dataclass(frozen=True)
class StationMatch:
    requested_name: str
    osm_id: str
    name: str
    coordinate: tuple[float, float]
    nearest_node: tuple[int, int, int]
    nearest_distance_m: float


def node_key(coordinate: list[float] | tuple[float, float], layer: str = "0") -> tuple[int, int, int]:
    # OSM railway ways in this corridor frequently split a continuous rail
    # between ways with inconsistent layer tags. Keep layer on edge metadata,
    # but use the quantized physical coordinate for graph topology so an
    # otherwise real OSM connection is not discarded. Route validation still
    # rejects large jumps and non-monotonic station anchors.
    lon, lat = coordinate
    return (round(float(lon) * 100000), round(float(lat) * 100000), 0)


def build_graph(features: list[dict[str, Any]]) -> nx.Graph:
    graph: nx.Graph = nx.Graph()
    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coordinates = geometry.get("coordinates") or []
        properties = feature.get("properties") or {}
        if len(coordinates) < 2:
            continue
        layer = str(properties.get("layer") or "0")
        for first, second in zip(coordinates, coordinates[1:]):
            start = node_key(first, layer)
            end = node_key(second, layer)
            if start == end:
                continue
            length = geodesic_distance_m(first, second)
            if not math.isfinite(length) or length <= 0:
                continue
            edge_properties = {
                "geometry": [list(first), list(second)],
                "length": length,
                "tunnel": str(properties.get("tunnel") or "").lower() in {"yes", "true", "1"},
                "osm_id": str(properties.get("osm_id", "")),
                "railway": properties.get("railway", "rail"),
                "name": properties.get("name") or properties.get("name_ko"),
                "maxspeed": properties.get("maxspeed"),
                "highspeed": properties.get("highspeed"),
                "usage": properties.get("usage"),
                "service": properties.get("service"),
                "layer": layer,
            }
            if graph.has_edge(start, end):
                if length < float(graph[start][end]["length"]):
                    graph[start][end].update(edge_properties)
            else:
                graph.add_edge(start, end, **edge_properties)
    return graph


def nearest_graph_node(graph: nx.Graph, coordinate: tuple[float, float]) -> tuple[tuple[int, int, int], float]:
    best_node: tuple[int, int, int] | None = None
    best_distance = float("inf")
    for node in graph.nodes:
        candidate = (node[0] / 100000.0, node[1] / 100000.0)
        distance = geodesic_distance_m(coordinate, candidate)
        if distance < best_distance:
            best_node = node
            best_distance = distance
    if best_node is None:
        raise ValueError("railway graph is empty")
    return best_node, best_distance


def nearest_graph_nodes(graph: nx.Graph, coordinate: tuple[float, float], limit: int = 12) -> list[tuple[tuple[int, int, int], float]]:
    candidates = []
    for node in graph.nodes:
        node_coordinate = (node[0] / 100000.0, node[1] / 100000.0)
        candidates.append((geodesic_distance_m(coordinate, node_coordinate), node))
    candidates.sort(key=lambda item: item[0])
    return [(node, distance) for distance, node in candidates[:limit]]


def station_text(properties: dict[str, Any]) -> str:
    return str(properties.get("name_ko") or properties.get("name") or "")


def is_exact_station_name(name: str, aliases: tuple[str, ...]) -> bool:
    normalized = name.strip().casefold()
    for alias in aliases:
        normalized_alias = alias.strip().casefold()
        if normalized == normalized_alias or normalized.removesuffix("역") == normalized_alias:
            return True
    return False


def match_stations(graph: nx.Graph, station_features: list[dict[str, Any]], station_aliases: dict[str, tuple[str, ...]]) -> dict[str, StationMatch]:
    components = {node: component_index for component_index, component in enumerate(nx.connected_components(graph)) for node in component}
    candidate_map: dict[str, list[tuple[int, float, dict[str, Any], tuple[int, int, int], int]]]= {}
    for requested, aliases in station_aliases.items():
        candidates = []
        for feature in station_features:
            props = feature.get("properties") or {}
            name = station_text(props)
            if any(alias.casefold() in name.casefold() for alias in aliases):
                coordinates = (feature["geometry"]["coordinates"][0], feature["geometry"]["coordinates"][1])
                node, distance = nearest_graph_node(graph, coordinates)
                exact_rank = 0 if is_exact_station_name(name, aliases) else 1
                candidates.append((exact_rank, distance, feature, node, components[node]))
        if not candidates:
            raise ValueError(f"station anchor not found in OSM data: {requested}")
        candidate_map[requested] = candidates

    common_components = set.intersection(*(set(item[4] for item in candidates) for candidates in candidate_map.values()))
    if common_components:
        selected_component = min(
            common_components,
            key=lambda component: (
                sum(min(item[0] for item in candidate_map[name] if item[4] == component) for name in candidate_map),
                sum(min(item[1] for item in candidate_map[name] if item[4] == component) for name in candidate_map),
            ),
        )
        candidate_lists = [[item for item in candidate_map[name] if item[4] == selected_component] for name in candidate_map]
        # Several exact OSM station nodes can exist for platforms. Choose the
        # exact candidates that form the shortest connected station sequence,
        # rather than simply choosing the nearest platform independently. This
        # prevents Seoul Station from anchoring to a nearby branch that first
        # travels north before reaching Gwangmyeong.
        states: list[dict[int, tuple[float, int | None]]] = []
        first_states = {}
        for index, candidate in enumerate(candidate_lists[0]):
            first_states[index] = (candidate[0] * 1_000_000.0 + candidate[1] * 0.001, None)
        states.append(first_states)
        for candidates in candidate_lists[1:]:
            current_states: dict[int, tuple[float, int | None]] = {}
            for index, candidate in enumerate(candidates):
                best: tuple[float, int | None] | None = None
                for previous_index, (previous_cost, _) in states[-1].items():
                    previous = candidate_lists[len(states) - 1][previous_index]
                    try:
                        path_distance = nx.shortest_path_length(graph, previous[3], candidate[3], weight="length")
                    except nx.NetworkXNoPath:
                        continue
                    cost = previous_cost + float(path_distance) + candidate[0] * 1_000_000.0 + candidate[1] * 0.001
                    if best is None or cost < best[0]:
                        best = (cost, previous_index)
                if best is not None:
                    current_states[index] = best
            states.append(current_states)
        if states[-1]:
            selected_indices: list[int] = [min(states[-1], key=lambda index: states[-1][index][0])]
            for layer in range(len(states) - 1, 0, -1):
                selected_indices.append(states[layer][selected_indices[-1]][1])
            selected_indices.reverse()
            selected = {name: candidate_lists[layer][selected_indices[layer]] for layer, name in enumerate(candidate_map)}
        else:
            selected = {name: min((item for item in candidates if item[4] == selected_component), key=lambda item: (item[0], item[1])) for name, candidates in candidate_map.items()}
    else:
        selected = {name: min(candidates, key=lambda item: (item[0], item[1])) for name, candidates in candidate_map.items()}

    matches: dict[str, StationMatch] = {}
    for requested, selected_candidate in selected.items():
        _, distance, feature, node, _ = selected_candidate
        props = feature.get("properties") or {}
        matches[requested] = StationMatch(
            requested_name=requested,
            osm_id=str(props.get("osm_id", "")),
            name=station_text(props),
            coordinate=(feature["geometry"]["coordinates"][0], feature["geometry"]["coordinates"][1]),
            nearest_node=node,
            nearest_distance_m=distance,
        )
    return matches


def refine_station_nodes(graph: nx.Graph, matches: dict[str, StationMatch], station_order: list[str]) -> dict[str, StationMatch]:
    """Prefer a nearby through-track vertex when the nearest vertex is a station spur.

    Station nodes commonly sit on a platform branch. Refining only interior
    anchors against both adjacent anchors avoids entering and leaving the same
    branch, while retaining the actual OSM station name and coordinate.
    """
    selected = dict(matches)
    for _ in range(2):
        for index in range(1, len(station_order) - 1):
            name = station_order[index]
            previous = selected[station_order[index - 1]].nearest_node
            following = selected[station_order[index + 1]].nearest_node
            through_path = nx.shortest_path(graph, previous, following, weight="length")
            on_through_path = [
                (geodesic_distance_m(selected[name].coordinate, (node[0] / 100000.0, node[1] / 100000.0)), node)
                for node in through_path
            ]
            on_through_path = [item for item in on_through_path if item[0] <= 500.0]
            if on_through_path:
                distance, node = min(on_through_path, key=lambda item: item[0])
                selected[name] = replace(selected[name], nearest_node=node, nearest_distance_m=distance)
                continue
            candidates = nearest_graph_nodes(graph, selected[name].coordinate)
            from_previous = nx.single_source_dijkstra_path_length(graph, previous, weight="length")
            from_following = nx.single_source_dijkstra_path_length(graph, following, weight="length")
            viable = []
            for node, distance in candidates:
                if node not in from_previous or node not in from_following:
                    continue
                first_path = nx.shortest_path(graph, previous, node, weight="length")
                second_path = nx.shortest_path(graph, node, following, weight="length")
                first_edges = {frozenset((a, b)) for a, b in zip(first_path, first_path[1:])}
                second_edges = {frozenset((a, b)) for a, b in zip(second_path, second_path[1:])}
                overlap = sum(float(graph[a][b]["length"]) for a, b in (tuple(edge) for edge in first_edges & second_edges))
                viable.append((from_previous[node] + from_following[node] + overlap * 1000.0 + distance * 0.001, node, distance))
            if viable:
                _, node, distance = min(viable, key=lambda item: item[0])
                selected[name] = replace(selected[name], nearest_node=node, nearest_distance_m=distance)
    return selected


def route_edges(graph: nx.Graph, station_nodes: list[tuple[int, int, int]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for start, end in zip(station_nodes, station_nodes[1:]):
        path = nx.shortest_path(graph, start, end, weight="length")
        for first, second in zip(path, path[1:]):
            edge = graph[first][second]
            coordinates = list(edge["geometry"])
            first_coord = [first[0] / 100000.0, first[1] / 100000.0]
            second_coord = [second[0] / 100000.0, second[1] / 100000.0]
            forward_error = geodesic_distance_m(coordinates[0], first_coord) + geodesic_distance_m(coordinates[-1], second_coord)
            reverse_error = geodesic_distance_m(coordinates[0], second_coord) + geodesic_distance_m(coordinates[-1], first_coord)
            if reverse_error < forward_error:
                coordinates = list(reversed(coordinates))
            output.append({**edge, "geometry": coordinates, "startNode": list(first), "endNode": list(second)})
    return output


def route_length_m(edges: list[dict[str, Any]]) -> float:
    return sum(polyline_length_m(edge["geometry"]) for edge in edges)
