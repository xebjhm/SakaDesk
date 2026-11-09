"""Tests for the backend string catalog."""

import json
from pathlib import Path

import pytest

from backend.services.i18n import SUPPORTED, get_strings

I18N_DIR = Path(__file__).resolve().parent.parent / "i18n"
KEYS = {
    "sent_photo",
    "sent_video",
    "sent_voice",
    "sent_message",
    "hidden_body",
    "more",
    "test_title",
    "test_body",
}


def _load(lang: str) -> dict:
    path = I18N_DIR / lang / "notifications.json"
    return json.loads(path.read_text(encoding="utf-8"))


TRAY_KEYS = {
    "open",
    "sync_now",
    "quit",
    "tooltip_idle",
    "tooltip_unread",
    "still_running_title",
    "still_running_body",
}


def _load_tray(lang: str) -> dict:
    path = I18N_DIR / lang / "tray.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("lang", SUPPORTED)
def test_tray_locale_has_same_keys_as_en(lang):
    assert set(_load_tray(lang)) == TRAY_KEYS
    assert all(isinstance(v, str) and v for v in _load_tray(lang).values())


@pytest.mark.parametrize("lang", SUPPORTED)
def test_tray_tooltip_unread_has_n_placeholder(lang):
    assert "{n}" in _load_tray(lang)["tooltip_unread"]
    assert "{n}" not in _load_tray(lang)["tooltip_idle"]


@pytest.mark.parametrize("lang", SUPPORTED)
def test_tray_get_strings_matches_file(lang):
    assert get_strings("tray", lang) == _load_tray(lang)


def test_tray_non_ascii_round_trip():
    assert get_strings("tray", "ja")["sync_now"] == "今すぐ同期"
    assert get_strings("tray", "zh-CN")["quit"] == "退出"
    assert get_strings("tray", "yue")["tooltip_unread"].format(n=2) == (
        "SakaDesk — 2 則未讀"
    )
    assert get_strings("tray", "en")["tooltip_unread"].format(n=2) == (
        "SakaDesk — 2 unread"
    )


def test_supported_locales():
    assert SUPPORTED == ("en", "ja", "zh-TW", "zh-CN", "yue")


@pytest.mark.parametrize("lang", SUPPORTED)
def test_locale_has_same_keys_as_en(lang):
    assert set(_load(lang)) == KEYS
    assert set(_load(lang)) == set(_load("en"))


@pytest.mark.parametrize("lang", SUPPORTED)
def test_more_has_n_placeholder_and_values_nonempty(lang):
    data = _load(lang)
    assert "{n}" in data["more"]
    assert all(isinstance(v, str) and v for v in data.values())


@pytest.mark.parametrize("lang", SUPPORTED)
def test_get_strings_matches_file(lang):
    assert get_strings("notifications", lang) == _load(lang)


@pytest.mark.parametrize("lang", [None, "", "xx", "fr", "EN"])
def test_unknown_or_none_falls_back_to_en(lang):
    assert get_strings("notifications", lang) == _load("en")


def test_more_formats_with_n():
    assert get_strings("notifications", "en")["more"].format(n=3) == "+3 more"
    assert get_strings("notifications", "ja")["more"].format(n=2) == "ほか2件"


def test_non_ascii_round_trip():
    s = get_strings("notifications", "ja")
    assert s["sent_photo"] == "写真を送信しました"
    assert get_strings("notifications", "zh-TW")["sent_photo"] == "傳送了照片"
    assert get_strings("notifications", "yue")["sent_photo"] == "傳送咗相片"
    assert get_strings("notifications", "zh-CN")["hidden_body"] == "发来新消息"


def test_unknown_section_returns_empty_dict():
    assert get_strings("nonexistent", "en") == {}


def test_results_are_cached_and_callers_cannot_poison_cache():
    a = get_strings("notifications", "en")
    a["sent_photo"] = "mutated"
    assert get_strings("notifications", "en")["sent_photo"] == "Sent a photo"


# ------------------------------------------------------- resolve_ui_language


def _prefs(monkeypatch, value) -> None:
    from backend.services import app_state

    def fake() -> dict:
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(app_state, "get_prefs", fake)


def test_ui_language_prefers_the_settings_choice(monkeypatch):
    from backend.services.i18n import resolve_ui_language

    _prefs(monkeypatch, {"language": "ja", "other": 1})
    assert resolve_ui_language({"language": "en"}) == "ja"


@pytest.mark.parametrize(
    "prefs", [{}, {"language": None}, {"language": ""}, {"language": 3}]
)
def test_ui_language_falls_back_to_settings_json(monkeypatch, prefs):
    from backend.services.i18n import resolve_ui_language

    _prefs(monkeypatch, prefs)
    assert resolve_ui_language({"language": "zh-TW"}) == "zh-TW"


def test_ui_language_none_when_unset(monkeypatch):
    from backend.services.i18n import resolve_ui_language

    _prefs(monkeypatch, {})
    assert resolve_ui_language({}) is None
    assert resolve_ui_language({"language": ""}) is None


def test_ui_language_unreadable_prefs_fall_back_and_log(monkeypatch):
    import sqlite3

    from structlog.testing import capture_logs

    from backend.services.i18n import resolve_ui_language

    _prefs(monkeypatch, sqlite3.OperationalError("no such table: prefs C:/secret"))
    with capture_logs() as logs:
        assert resolve_ui_language({"language": "yue"}) == "yue"
    (event,) = [e for e in logs if e["event"] == "ui_language_prefs_unreadable"]
    assert event["error_type"] == "OperationalError"
    assert "secret" not in repr(logs)


def test_ui_language_reads_the_real_prefs_store(tmp_path, monkeypatch):
    from backend.services import app_state
    from backend.services.i18n import resolve_ui_language

    monkeypatch.setattr(app_state, "_db_path", tmp_path / "app_state.db")
    app_state.init_db()
    app_state.set_prefs({"language": "zh-CN"})
    assert resolve_ui_language({"language": "en"}) == "zh-CN"


# ------------------------------------------------------- per-key en fallback


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    """A temporary i18n dir; the load cache is cleared around the test."""
    from backend.services import i18n

    monkeypatch.setattr(i18n, "_I18N_DIR", tmp_path)
    i18n._load.cache_clear()
    yield tmp_path
    i18n._load.cache_clear()


def _write(root: Path, lang: str, content: str) -> None:
    (root / lang).mkdir(parents=True, exist_ok=True)
    (root / lang / "notifications.json").write_text(content, encoding="utf-8")


EN = {"sent_photo": "Sent a photo", "more": "+{n} more", "test_title": "SakaDesk"}


def test_missing_key_falls_back_to_en_per_key(catalog):
    _write(catalog, "en", json.dumps(EN))
    _write(catalog, "ja", json.dumps({"sent_photo": "写真を送信しました"}))
    s = get_strings("notifications", "ja")
    assert s == {**EN, "sent_photo": "写真を送信しました"}


@pytest.mark.parametrize("content", [None, "{not json", "[1, 2]", '"text"'])
def test_missing_or_corrupt_locale_yields_en(catalog, content):
    from structlog.testing import capture_logs

    _write(catalog, "en", json.dumps(EN))
    if content is not None:
        _write(catalog, "zh-TW", content)
    with capture_logs() as logs:
        assert get_strings("notifications", "zh-TW") == EN
    failed = [e for e in logs if e["event"] == "i18n_load_failed"]
    assert [(e["lang"], e["section"]) for e in failed] == [("zh-TW", "notifications")]


def test_missing_en_never_raises_and_logs_once(catalog):
    from structlog.testing import capture_logs

    with capture_logs() as logs:
        s = get_strings("notifications", "en")
        assert s["test_title"] == "" and s["more"].format(n=2) == ""
        get_strings("notifications", "en")
    failed = [e for e in logs if e["event"] == "i18n_load_failed"]
    assert len(failed) == 1 and failed[0]["lang"] == "en"


def test_missing_en_still_uses_the_requested_locale(catalog):
    _write(catalog, "ja", json.dumps({"sent_photo": "写真を送信しました"}))
    s = get_strings("notifications", "ja")
    assert s["sent_photo"] == "写真を送信しました"
    assert s["sent_video"] == ""


CALL_POPUP_KEYS = {"missed_title", "missed_body", "missed_more"}


def _load_call_popup(lang: str) -> dict:
    return json.loads((I18N_DIR / lang / "call_popup.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("lang", SUPPORTED)
def test_call_popup_locale_has_same_keys_as_en(lang):
    data = _load_call_popup(lang)
    assert set(data) == CALL_POPUP_KEYS
    assert "{name}" in data["missed_title"] and "{n}" in data["missed_more"]
    assert get_strings("call_popup", lang) == data


def test_call_popup_non_ascii_round_trip():
    assert (
        get_strings("call_popup", "ja")["missed_title"].format(name="金村 美玖")
        == "不在着信：金村 美玖"
    )
    assert (
        get_strings("call_popup", "yue")["missed_more"].format(n=2) == "仲有 2 則訊息"
    )
