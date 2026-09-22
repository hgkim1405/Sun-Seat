from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any


def _julian_day(moment: datetime) -> float:
    utc_moment = moment.astimezone(timezone.utc)
    return 2440587.5 + utc_moment.timestamp() / 86400.0


def solar_position_noaa(moment: datetime, latitude: float, longitude: float) -> dict[str, float]:
    """Return north-based azimuth and geometric altitude using NOAA equations."""
    julian_day = _julian_day(moment)
    century = (julian_day - 2451545.0) / 36525.0

    geometric_longitude = (280.46646 + century * (36000.76983 + century * 0.0003032)) % 360.0
    mean_anomaly = 357.52911 + century * (35999.05029 - 0.0001537 * century)
    anomaly_rad = math.radians(mean_anomaly)
    equation_center = (
        math.sin(anomaly_rad) * (1.914602 - century * (0.004817 + 0.000014 * century))
        + math.sin(2 * anomaly_rad) * (0.019993 - 0.000101 * century)
        + math.sin(3 * anomaly_rad) * 0.000289
    )
    true_longitude = geometric_longitude + equation_center
    omega = math.radians(125.04 - 1934.136 * century)
    apparent_longitude = true_longitude - 0.00569 - 0.00478 * math.sin(omega)

    mean_obliquity = 23.0 + (26.0 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60.0) / 60.0
    corrected_obliquity = mean_obliquity + 0.00256 * math.cos(omega)
    apparent_longitude_rad = math.radians(apparent_longitude)
    declination = math.degrees(math.asin(math.sin(math.radians(corrected_obliquity)) * math.sin(apparent_longitude_rad)))

    y = math.tan(math.radians(corrected_obliquity) / 2.0) ** 2
    equation_of_time = 4.0 * math.degrees(
        y * math.sin(2.0 * math.radians(geometric_longitude))
        - 2.0 * 0.016708634 * math.sin(anomaly_rad)
        + 4.0 * 0.016708634 * y * math.sin(anomaly_rad) * math.cos(2.0 * math.radians(geometric_longitude))
        - 0.5 * y * y * math.sin(4.0 * math.radians(geometric_longitude))
        - 1.25 * 0.016708634 * 0.016708634 * math.sin(2.0 * anomaly_rad)
    )

    offset_hours = moment.utcoffset().total_seconds() / 3600.0 if moment.utcoffset() else 0.0
    local_minutes = moment.hour * 60.0 + moment.minute + moment.second / 60.0
    true_solar_time = (local_minutes + equation_of_time + 4.0 * longitude - 60.0 * offset_hours) % 1440.0
    hour_angle = true_solar_time / 4.0 - 180.0
    latitude_rad = math.radians(latitude)
    declination_rad = math.radians(declination)
    hour_angle_rad = math.radians(hour_angle)

    cosine_zenith = (
        math.sin(latitude_rad) * math.sin(declination_rad)
        + math.cos(latitude_rad) * math.cos(declination_rad) * math.cos(hour_angle_rad)
    )
    zenith = math.degrees(math.acos(max(-1.0, min(1.0, cosine_zenith))))
    altitude = 90.0 - zenith
    azimuth = (math.degrees(math.atan2(
        math.sin(hour_angle_rad),
        math.cos(hour_angle_rad) * math.sin(latitude_rad) - math.tan(declination_rad) * math.cos(latitude_rad),
    )) + 180.0) % 360.0
    return {"azimuth": azimuth, "altitude": altitude}


def solar_position_astral(moment: datetime, latitude: float, longitude: float) -> dict[str, float] | None:
    try:
        from astral import Observer
        from astral.sun import azimuth, elevation
    except ImportError:
        return None
    observer = Observer(latitude=latitude, longitude=longitude)
    return {
        "azimuth": float(azimuth(observer, moment)),
        "altitude": float(elevation(observer, moment)),
    }


def compare_solar_positions(primary: dict[str, float], reference: dict[str, float] | None) -> dict[str, Any]:
    if reference is None:
        return {"referenceAvailable": False}
    azimuth_error = abs(((primary["azimuth"] - reference["azimuth"] + 180.0) % 360.0) - 180.0)
    altitude_error = abs(primary["altitude"] - reference["altitude"])
    return {
        "referenceAvailable": True,
        "azimuthErrorDegrees": azimuth_error,
        "altitudeErrorDegrees": altitude_error,
        "withinOneDegree": azimuth_error < 1.0 and altitude_error < 1.0,
    }

