from datetime import datetime

from sunseat.analysis import aggregate_timeline, group_runs
from sunseat.exposure import classify_exposure, side_score
from sunseat.geometry import normalize_angle_degrees
from sunseat.railway.sampler import RouteSampler
from sunseat.solar import solar_position_noaa


def test_angle_normalization():
    assert normalize_angle_degrees(190) == -170
    assert normalize_angle_degrees(-190) == 170


def test_northbound_east_sun_is_right():
    score = side_score(0, 90, 30)
    assert score > 0
    assert classify_exposure(score, False, 30)[0] == "RIGHT"


def test_tunnel_exposure_is_zero():
    assert classify_exposure(0.8, True, 30) == ("TUNNEL", 0.0, 0.0)


def test_sun_below_horizon_is_weak_and_zero():
    assert classify_exposure(0.8, False, -1) == ("WEAK", 0.0, 0.0)


def test_runs_and_aggregation():
    timeline = [
        {"time": "2026-09-22T14:19:00+09:00", "rawSide": "RIGHT", "leftExposure": 0, "rightExposure": 1, "distance": 0, "lat": 36, "lon": 127, "bearing": 90, "sunAzimuth": 180, "sunAltitude": 30, "tunnel": False},
        {"time": "2026-09-22T14:19:30+09:00", "rawSide": "RIGHT", "leftExposure": 0, "rightExposure": 1, "distance": 30, "lat": 36, "lon": 127, "bearing": 90, "sunAzimuth": 180, "sunAltitude": 30, "tunnel": False},
        {"time": "2026-09-22T14:20:00+09:00", "rawSide": "LEFT", "leftExposure": 1, "rightExposure": 0, "distance": 60, "lat": 36, "lon": 127, "bearing": 90, "sunAzimuth": 0, "sunAltitude": 30, "tunnel": False},
    ]
    runs = group_runs(timeline, 30)
    assert runs[0]["side"] == "RIGHT"
    assert runs[0]["durationMinutes"] == 1
    assert len(aggregate_timeline(timeline, 60)) == 2


def test_noaa_returns_reasonable_daylight_values():
    result = solar_position_noaa(datetime.fromisoformat("2026-09-22T14:19:00+09:00"), 37.55, 126.97)
    assert 0 <= result["azimuth"] < 360
    assert -90 <= result["altitude"] <= 90


def test_sampler_keeps_tunnel_mask_aligned_across_join():
    sampler = RouteSampler.from_edges([
        {"geometry": [[127.0, 37.0], [127.001, 37.0]], "tunnel": False},
        {"geometry": [[127.001001, 37.0], [127.002, 37.0]], "tunnel": True},
    ])
    assert sampler.tunnel_at(sampler.total_distance_m * 0.25) is False
    assert sampler.tunnel_at(sampler.total_distance_m * 0.75) is True
