from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.config import PROCESSED_DIR, RAW_OSM_DIR, ensure_data_directories
from sunseat.io import read_json, write_json


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("extract_railway")


def properties_for_way(tags: dict[str, Any], osm_id: int) -> dict[str, Any]:
    return {
        "osm_id": str(osm_id),
        "railway": tags.get("railway"),
        "name": tags.get("name"),
        "name_ko": tags.get("name:ko"),
        "tunnel": tags.get("tunnel"),
        "bridge": tags.get("bridge"),
        "maxspeed": tags.get("maxspeed"),
        "highspeed": tags.get("highspeed"),
        "usage": tags.get("usage"),
        "service": tags.get("service"),
        "layer": tags.get("layer", "0"),
    }


def extract() -> None:
    source = RAW_OSM_DIR / "south-korea-rail-corridor.json"
    if not source.exists():
        raise FileNotFoundError(f"OSM snapshot not found: {source}. Run download_osm.py first.")
    payload = read_json(source)
    ways = []
    stations = []
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        if element.get("type") == "way" and tags.get("railway") == "rail":
            geometry = element.get("geometry") or []
            coordinates = [[point["lon"], point["lat"]] for point in geometry if "lon" in point and "lat" in point]
            if len(coordinates) >= 2:
                ways.append({
                    "type": "Feature",
                    "properties": properties_for_way(tags, int(element["id"])),
                    "geometry": {"type": "LineString", "coordinates": coordinates},
                })
        elif element.get("type") == "node" and tags.get("railway") in {"station", "halt"}:
            if "lon" in element and "lat" in element:
                stations.append({
                    "type": "Feature",
                    "properties": {
                        "osm_id": str(element["id"]),
                        "railway": tags.get("railway"),
                        "name": tags.get("name"),
                        "name_ko": tags.get("name:ko"),
                    },
                    "geometry": {"type": "Point", "coordinates": [element["lon"], element["lat"]]},
                })
    if not ways or not stations:
        raise RuntimeError(f"OSM extraction produced ways={len(ways)}, stations={len(stations)}")
    out_dir = PROCESSED_DIR / "railway"
    write_json(out_dir / "railways.geojson", {"type": "FeatureCollection", "features": ways})
    write_json(out_dir / "stations.geojson", {"type": "FeatureCollection", "features": stations})
    write_json(out_dir / "extraction-summary.json", {
        "source": str(source),
        "railwayFeatureCount": len(ways),
        "stationFeatureCount": len(stations),
    })
    LOGGER.info("Extracted %d railway ways and %d stations", len(ways), len(stations))


if __name__ == "__main__":
    ensure_data_directories()
    extract()

