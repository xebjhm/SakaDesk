"""Region-availability check for the Yodel JP-only warning."""

import pytest

from backend.services.auth_service import AuthService, _interpret_geo_status


def test_interpret_geo_status():
    # Reachable region.
    assert _interpret_geo_status(200) == {"available": True, "blocked": False}
    # Geo-block (4xx, e.g. 403/451).
    assert _interpret_geo_status(403) == {"available": False, "blocked": True}
    assert _interpret_geo_status(451) == {"available": False, "blocked": True}
    # Unknown (5xx / no response) — never a false "blocked".
    assert _interpret_geo_status(503) == {"available": True, "blocked": False}
    assert _interpret_geo_status(None) == {"available": True, "blocked": False}


@pytest.mark.asyncio
async def test_check_geo_availability_only_checks_yodel():
    """Non-Yodel services short-circuit as available (no network call)."""
    svc = AuthService()
    res = await svc.check_geo_availability("hinatazaka46")
    assert res == {
        "service": "hinatazaka46",
        "restricted": False,
        "available": True,
        "blocked": False,
    }
