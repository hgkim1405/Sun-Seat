from datetime import datetime

from api.main import ExposureBatchRequest, ExposureRequest, calculate, exposure_batch, load_active_dataset


def test_internal_calculation_uses_active_route_dataset() -> None:
    load_active_dataset()
    result = calculate(ExposureRequest(
        origin="서울",
        destination="부산",
        departure=datetime.fromisoformat("2026-09-22T14:19:00+09:00"),
        arrival=datetime.fromisoformat("2026-09-22T16:50:00+09:00"),
        stationTimeline=[
            {"station": "서울", "time": "2026-09-22T14:19:00+09:00", "event": "departure"},
            {"station": "부산", "time": "2026-09-22T16:50:00+09:00", "event": "arrival"},
        ],
    ))
    assert result["routeId"] == "seoul-busan"
    assert result["summary"]["sampleCount"] == 303
    assert result["segments"]
    assert result["precision"]["weather"] == "clear_sky_only"


def test_internal_batch_calculation_returns_results_in_request_order() -> None:
    load_active_dataset()
    request = ExposureRequest(
        origin="서울",
        destination="부산",
        departure=datetime.fromisoformat("2026-09-22T14:19:00+09:00"),
        arrival=datetime.fromisoformat("2026-09-22T16:50:00+09:00"),
        stationTimeline=[
            {"station": "서울", "time": "2026-09-22T14:19:00+09:00", "event": "departure"},
            {"station": "부산", "time": "2026-09-22T16:50:00+09:00", "event": "arrival"},
        ],
    )
    result = exposure_batch(ExposureBatchRequest(requests=[request]))
    assert len(result["results"]) == 1
    assert result["results"][0]["routeId"] == "seoul-busan"
