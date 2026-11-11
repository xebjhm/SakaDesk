import pytest
from pathlib import Path
from unittest.mock import patch
from backend.services.path_resolver import (
    resolve_service_path,
    find_folder_by_id,
    resolve_talk_room_path,
    resolve_member_path,
    get_output_dir,
    resolve_messages_file,
)


def test_resolve_service_path():
    """resolve_service_path returns path with display name."""
    with patch(
        "backend.services.path_resolver.get_output_dir", return_value=Path("/output")
    ):
        path = resolve_service_path("hinatazaka46")
        assert path == Path("/output/日向坂46")


def test_find_folder_by_id(tmp_path):
    """find_folder_by_id finds folder starting with ID."""
    (tmp_path / "40 松田 好花").mkdir()
    (tmp_path / "78 日向坂46 四期生ライブ").mkdir()

    result = find_folder_by_id(tmp_path, 40)
    assert result.name == "40 松田 好花"

    result = find_folder_by_id(tmp_path, 78)
    assert result.name == "78 日向坂46 四期生ライブ"


def test_find_folder_by_id_not_found(tmp_path):
    """find_folder_by_id raises if not found."""
    (tmp_path / "40 松田 好花").mkdir()

    with pytest.raises(FileNotFoundError):
        find_folder_by_id(tmp_path, 999)


def test_get_output_dir_default():
    """get_output_dir returns default when settings don't exist."""
    with patch("backend.services.platform.get_settings_path") as mock_path:
        mock_path.return_value = Path("/nonexistent/settings.json")
        result = get_output_dir()
        assert result == Path.home() / "Documents" / "SakaDesk"


def test_find_folder_by_id_base_path_not_exists(tmp_path):
    """find_folder_by_id raises when base path doesn't exist."""
    non_existent = tmp_path / "nonexistent"
    with pytest.raises(FileNotFoundError):
        find_folder_by_id(non_existent, 40)


def test_resolve_talk_room_path(tmp_path):
    """resolve_talk_room_path finds talk room folder."""
    messages_dir = tmp_path / "日向坂46" / "messages"
    messages_dir.mkdir(parents=True)
    (messages_dir / "40 松田 好花").mkdir()

    with patch("backend.services.path_resolver.get_output_dir", return_value=tmp_path):
        with patch(
            "backend.services.path_resolver.get_service_display_name",
            return_value="日向坂46",
        ):
            result = resolve_talk_room_path("hinatazaka46", 40)
            assert result.name == "40 松田 好花"


def test_resolve_member_path(tmp_path):
    """resolve_member_path finds member folder within talk room."""
    member_dir = tmp_path / "日向坂46" / "messages" / "40 松田 好花" / "64 松田 好花"
    member_dir.mkdir(parents=True)

    with patch("backend.services.path_resolver.get_output_dir", return_value=tmp_path):
        with patch(
            "backend.services.path_resolver.get_service_display_name",
            return_value="日向坂46",
        ):
            result = resolve_member_path("hinatazaka46", 40, 64)
            assert result.name == "64 松田 好花"


def test_resolve_messages_file(tmp_path):
    """resolve_messages_file returns path to messages.json."""
    member_dir = tmp_path / "日向坂46" / "messages" / "40 松田 好花" / "64 松田 好花"
    member_dir.mkdir(parents=True)

    with patch("backend.services.path_resolver.get_output_dir", return_value=tmp_path):
        with patch(
            "backend.services.path_resolver.get_service_display_name",
            return_value="日向坂46",
        ):
            result = resolve_messages_file("hinatazaka46", 40, 64)
            assert result.name == "messages.json"
            assert result.parent.name == "64 松田 好花"


# --- a transient settings read failure (the 05:15:20Z path_traversal_blocked burst) ----


@pytest.fixture
def settings(tmp_path):
    import json

    from backend.services import path_resolver

    path_resolver._last_good.clear()
    out = tmp_path / "out 🌸"
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"output_dir": str(out)}), encoding="utf-8")
    yield path, out
    path_resolver._last_good.clear()


def test_a_transient_read_failure_keeps_the_last_output_dir(settings):
    """Windows: reading settings.json while os.replace swaps it can fail
    (PermissionError). Falling back to the default dir made every archive path
    "outside" (64 path_traversal_blocked at once) and poisoned a cached view."""
    from structlog.testing import capture_logs

    from backend.services import path_resolver

    path, out = settings
    default = Path("/default")
    assert path_resolver.output_dir_from_settings(path, default) == out
    with (
        patch.object(
            path_resolver, "_read_settings", side_effect=PermissionError(13, "denied")
        ),
        capture_logs() as logs,
    ):
        assert path_resolver.output_dir_from_settings(path, default) == out
    (event,) = [e for e in logs if e["event"] == "output_dir_settings_unreadable"]
    assert event["error_type"] == "PermissionError"
    assert event["fallback"] == "last_good"
    assert str(out) not in repr(logs) and str(path) not in repr(logs)


def test_without_a_last_good_value_the_default_is_used_and_logged(settings):
    from structlog.testing import capture_logs

    from backend.services import path_resolver

    path, _ = settings
    path.write_text("NOT_JSON", encoding="utf-8")
    with capture_logs() as logs:
        assert path_resolver.output_dir_from_settings(path, Path("/d")) == Path("/d")
    (event,) = [e for e in logs if e["event"] == "output_dir_settings_unreadable"]
    assert (event["error_type"], event["fallback"]) == ("JSONDecodeError", "default")
    path.write_text('["not", "a", "map"]', encoding="utf-8")
    assert path_resolver.output_dir_from_settings(path, Path("/d")) == Path("/d")
    path.write_text("{}", encoding="utf-8")
    assert path_resolver.output_dir_from_settings(path, Path("/d")) == Path("/d")


def test_get_output_dir_uses_the_last_good_value(settings):
    from backend.services import path_resolver

    path, out = settings
    with patch("backend.services.platform.get_settings_path", return_value=path):
        assert get_output_dir() == out
        with patch.object(path_resolver, "_read_settings", side_effect=OSError):
            assert get_output_dir() == out


def test_content_get_output_dir_uses_the_last_good_value(settings):
    from backend.api import content
    from backend.services import path_resolver

    path, out = settings
    with patch("backend.api.content.get_settings_path", return_value=path):
        assert content.get_output_dir() == out
        with patch.object(path_resolver, "_read_settings", side_effect=OSError):
            assert content.get_output_dir() == out


def test_archive_checks_survive_a_transient_settings_failure(settings):
    """The incident path: album_colors probes resolve under people.output_dir()."""
    from structlog.testing import capture_logs

    from backend.services import path_resolver
    from backend.services.memories import album_colors

    path, out = settings
    sdir = out / "乃木坂46"
    pic = sdir / "messages" / "1 a" / "2 b" / "picture" / "1.jpg"
    pic.parent.mkdir(parents=True)
    pic.write_bytes(b"\xff\xd8\xff")
    mf = pic.relative_to(sdir).as_posix()
    with patch("backend.services.platform.get_settings_path", return_value=path):
        keys, transient = album_colors._stat_keys(sdir, [mf])
        assert keys[mf] is not None and transient == 0
        with (
            patch.object(path_resolver, "_read_settings", side_effect=PermissionError),
            capture_logs() as logs,
        ):
            keys, transient = album_colors._stat_keys(sdir, [mf])
            assert keys[mf] is not None and transient == 0
    assert not [e for e in logs if e["event"] == "path_traversal_blocked"]
