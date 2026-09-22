from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sunseat.config import OVERPASS_BBOX, OVERPASS_ENDPOINT, RAW_OSM_DIR, ensure_data_directories
from sunseat.io import write_json


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger("download_osm")


def overpass_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    return f"""[out:json][timeout:300];
(
  way[\"railway\"=\"rail\"]({south},{west},{north},{east});
  node[\"railway\"~\"^(station|halt)$\"]({south},{west},{north},{east});
);
out body geom;"""


def download_overpass(output: Path) -> None:
    query = overpass_query(OVERPASS_BBOX)
    LOGGER.info("Downloading real OSM railway data from %s", OVERPASS_ENDPOINT)
    response = requests.post(
        OVERPASS_ENDPOINT,
        data={"data": query},
        headers={"User-Agent": "sun-seat-poc/1.0 (technical validation)"},
        timeout=360,
    )
    response.raise_for_status()
    payload = response.json()
    if not payload.get("elements"):
        raise RuntimeError("Overpass returned no railway or station elements")
    write_json(output, payload)
    LOGGER.info("Saved %d OSM elements to %s", len(payload["elements"]), output)


def download_geofabrik(output: Path) -> None:
    url = "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf"
    LOGGER.info("Downloading Geofabrik PBF: %s", url)
    with requests.get(url, headers={"User-Agent": "sun-seat-poc/1.0"}, stream=True, timeout=60) as response:
        response.raise_for_status()
        with output.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    handle.write(chunk)
    LOGGER.info("Saved Geofabrik PBF to %s", output)
    raise RuntimeError(
        "Geofabrik PBF was downloaded, but this PoC's default extractor consumes the smaller Overpass JSON snapshot. "
        "Run with --source overpass for the supported route build path."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Download actual OSM railway data for the Sun Seat PoC")
    parser.add_argument("--source", choices=("overpass", "geofabrik"), default="overpass")
    args = parser.parse_args()
    ensure_data_directories()
    metadata = {
        "source": args.source,
        "downloadedAt": datetime.now(timezone.utc).isoformat(),
        "bbox": list(OVERPASS_BBOX),
        "endpoint": OVERPASS_ENDPOINT if args.source == "overpass" else "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
    }
    if args.source == "overpass":
        output = RAW_OSM_DIR / "south-korea-rail-corridor.json"
        download_overpass(output)
        metadata["rawFile"] = str(output)
    else:
        output = RAW_OSM_DIR / "south-korea-latest.osm.pbf"
        download_geofabrik(output)
    write_json(RAW_OSM_DIR / "source-metadata.json", metadata)


if __name__ == "__main__":
    main()

