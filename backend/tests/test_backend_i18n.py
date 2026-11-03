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
