from __future__ import annotations

from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
RAW_OSM_DIR = DATA_DIR / "raw" / "osm"
PROCESSED_DIR = DATA_DIR / "processed"
RESULTS_DIR = DATA_DIR / "results" / "poc"

TIMEZONE_NAME = "Asia/Seoul"
TIMEZONE = ZoneInfo(TIMEZONE_NAME)
POC_DATE = date(2026, 9, 22)
SAMPLE_INTERVAL_SECONDS = 30
BEARING_WINDOW_METERS = 200.0
WEAK_THRESHOLD = 0.15
MAX_EDGE_JUMP_METERS = 2000.0
MAX_STATION_NEAREST_DISTANCE_METERS = 500.0

# South Korea corridor containing Seoul and Busan. The default Overpass query is
# deliberately limited to railway=rail ways and railway stations to keep the
# raw snapshot practical for a PoC.
OVERPASS_BBOX = (34.5, 126.5, 38.2, 129.7)  # south, west, north, east
OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter"

STATION_ORDER = ["서울", "광명", "오송", "대전", "동대구", "부산"]
STATION_ALIASES = {
    "서울": ("서울", "Seoul"),
    "광명": ("광명", "Gwangmyeong"),
    "오송": ("오송", "Osong"),
    "대전": ("대전", "Daejeon"),
    "동대구": ("동대구", "Dongdaegu"),
    "부산": ("부산", "Busan"),
}

# This is the supplied PoC schedule, not a claim about a currently operating
# service. The report labels it as estimated train-position input.
STATION_TIMELINE = (
    ("서울", time(14, 19), "departure"),
    ("광명", time(14, 36), "arrival"),
    ("광명", time(14, 38), "departure"),
    ("오송", time(15, 5), "arrival"),
    ("오송", time(15, 6), "departure"),
    ("대전", time(15, 23), "arrival"),
    ("대전", time(15, 25), "departure"),
    ("동대구", time(16, 7), "arrival"),
    ("동대구", time(16, 9), "departure"),
    ("부산", time(16, 50), "arrival"),
)

SOLAR_CHECKPOINT_LABELS = ("서울", "대전", "부산")


def local_datetime(value: time) -> datetime:
    return datetime.combine(POC_DATE, value, tzinfo=TIMEZONE)


def ensure_data_directories() -> None:
    for path in (RAW_OSM_DIR, PROCESSED_DIR, RESULTS_DIR):
        path.mkdir(parents=True, exist_ok=True)
