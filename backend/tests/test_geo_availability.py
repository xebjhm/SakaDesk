"""Region detection for the Yodel JP-only warning (geo-IP based)."""

import pytest

from backend.services.auth_service import AuthService, _region_is_blocked


def test_region_is_blocked():
    # Any known non-JP country is blocked (Yodel is Japan-only).
    assert _region_is_blocked("TW") is True
    assert _region_is_blocked("US") is True
    # Japan is allowed (case-insensitive).
    assert _region_is_blocked("JP") is False
    assert _region_is_blocked("jp") is False
    # Unknown (geo-IP lookup failed) fails open — never a false warning.
    assert _region_is_blocked(None) is False
    assert _region_is_blocked("") is False


@pytest.mark.asyncio
async def test_check_geo_availability_only_checks_yodel():
    """Non-Yodel services short-circuit as available (no geo-IP lookup)."""
    svc = AuthService()
    res = await svc.check_geo_availability("hinatazaka46")
    assert res == {
        "service": "hinatazaka46",
        "restricted": False,
        "available": True,
        "blocked": False,
        "country": None,
    }


@pytest.mark.asyncio
async def test_check_geo_availability_uses_country(monkeypatch):
    """Yodel availability follows the detected country."""
    svc = AuthService()

    async def fake_tw(self):
        return "TW"

    monkeypatch.setattr(AuthService, "_lookup_country", fake_tw)
    res = await svc.check_geo_availability("yodel")
    assert (
        res["blocked"] is True and res["available"] is False and res["country"] == "TW"
    )

    async def fake_jp(self):
        return "JP"

    monkeypatch.setattr(AuthService, "_lookup_country", fake_jp)
    res = await svc.check_geo_availability("yodel")
    assert (
        res["blocked"] is False and res["available"] is True and res["country"] == "JP"
    )

    async def fake_unknown(self):
        return None

    monkeypatch.setattr(AuthService, "_lookup_country", fake_unknown)
    res = await svc.check_geo_availability("yodel")
    assert res["blocked"] is False  # fail open
