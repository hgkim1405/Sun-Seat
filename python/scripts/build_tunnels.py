from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.config import PROCESSED_DIR, ensure_data_directories
from sunseat.io import read_json, write_json


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("build_tunnels")


def build() -> None:
    route_path = PROCESSED_DIR / "route" / "route.geojson"
    route = read_json(route_path)
    tunnel_features = [feature for feature in route["features"] if feature.get("properties", {}).get("tunnel")]
    tunnel_distance = sum(float(feature["properties"].get("lengthM", 0.0)) for feature in tunnel_features)
    output_dir = PROCESSED_DIR / "tunnels"
    write_json(output_dir / "tunnels.geojson", {"type": "FeatureCollection", "features": tunnel_features})
    write_json(output_dir / "tunnel-summary.json", {
        "tunnelFeatureCount": len(tunnel_features),
        "tunnelDistanceM": tunnel_distance,
        "source": str(route_path),
    })
    LOGGER.info("Found %.2fkm of tunnel segments", tunnel_distance / 1000.0)


if __name__ == "__main__":
    ensure_data_directories()
    build()

