# backend/tests/test_service_utils.py
import json
from unittest.mock import patch

import pytest
from backend.services.service_utils import (
    atomic_write_json,
    get_all_services,
    get_service_config,
    get_service_display_name,
    get_service_enum,
    validate_service,
)
from pysaka import Group


class TestAtomicWriteJson:
    """The shared crash-safe writer used by favorites/transcription/desktop."""

    def test_writes_json_and_leaves_no_tmp(self, tmp_path):
        target = tmp_path / "out.json"
        atomic_write_json(target, {"a": 1, "ら": "ラ"})
        assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1, "ら": "ラ"}
        # No temp file left behind.
        assert not list(tmp_path.glob("*.tmp"))

    def test_replaces_existing_file_atomically(self, tmp_path):
        target = tmp_path / "out.json"
        target.write_text(json.dumps({"old": True}), encoding="utf-8")
        atomic_write_json(target, {"new": True})
        assert json.loads(target.read_text(encoding="utf-8")) == {"new": True}

    def test_failure_leaves_original_intact_and_cleans_tmp(self, tmp_path):
        """If the replace fails, the original file must be untouched and the temp
        file cleaned up — a crash mid-write can never corrupt the archive."""
        target = tmp_path / "out.json"
        target.write_text(json.dumps({"keep": "me"}), encoding="utf-8")

        # Force the atomic replace to fail after the temp file is written.
        with patch(
            "backend.services.service_utils._replace_with_retry",
            side_effect=OSError("boom"),
        ):
            with pytest.raises(OSError):
                atomic_write_json(target, {"new": "data"})

        # Original content preserved; no temp file orphaned.
        assert json.loads(target.read_text(encoding="utf-8")) == {"keep": "me"}
        assert not list(tmp_path.glob("*.tmp"))


def test_get_all_services():
    services = get_all_services()
    assert len(services) == 4
    assert "hinatazaka46" in services
    assert "nogizaka46" in services
    assert "sakurazaka46" in services
    assert "yodel" in services


def test_get_service_display_name():
    assert get_service_display_name("hinatazaka46") == "日向坂46"
    assert get_service_display_name("nogizaka46") == "乃木坂46"
    assert get_service_display_name("sakurazaka46") == "櫻坂46"


def test_get_service_enum():
    assert get_service_enum("hinatazaka46") == Group.HINATAZAKA46
    assert get_service_enum("nogizaka46") == Group.NOGIZAKA46
    assert get_service_enum("sakurazaka46") == Group.SAKURAZAKA46


def test_validate_service_valid():
    assert validate_service("hinatazaka46") == "hinatazaka46"


def test_validate_service_invalid():
    with pytest.raises(ValueError):
        validate_service("invalid_service")


def test_get_service_config():
    """Test get_service_config returns correct config dict for valid service."""
    config = get_service_config("hinatazaka46")
    assert isinstance(config, dict)
    assert "display_name" in config
    assert config["display_name"] == "日向坂46"


def test_get_service_config_invalid():
    """Test get_service_config raises ValueError for invalid service."""
    with pytest.raises(ValueError, match="Unknown service"):
        get_service_config("invalid_service")


def test_get_service_display_name_invalid():
    """Test get_service_display_name raises ValueError for invalid service."""
    with pytest.raises(ValueError, match="Unknown service"):
        get_service_display_name("invalid_service")
