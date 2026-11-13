"""Tests for GET /api/chat/letters_local (sent letters from the local archive)."""

import json
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)

MEMBER = "日向坂46/messages/90 高井 俐香/142 高井 俐香"
SAKURA_MEMBER = "櫻坂46/messages/79 中川 智尋/134 中川 智尋"
TEXT = "いつもありがとう🌸 応援してます"


@pytest.fixture
def root(tmp_path: Path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        yield tmp_path


def _member_dir(root: Path, member: str = MEMBER) -> Path:
    member_dir = root / member
    (member_dir / "letters").mkdir(parents=True, exist_ok=True)
    return member_dir


def _write(root: Path, payload: object, member: str = MEMBER) -> Path:
    member_dir = _member_dir(root, member)
    with open(member_dir / "letters.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return member_dir


def _letter(letter_id: object, created_at: object, **kw: object) -> dict:
    return {
        "id": letter_id,
        "member_id": 142,
        "text": TEXT,
        "created_at": created_at,
        "updated_at": created_at,
        "is_favorite": False,
        "image_file": f"letters/{letter_id}.jpg",
        "width": 341,
        "height": 512,
        **kw,
    }


def _get(path: str = MEMBER, service: str = "hinatazaka46"):
    return client.get(
        "/api/chat/letters_local", params={"service": service, "path": path}
    )


def _events(logs: list[dict]) -> list[dict]:
    return [e for e in logs if e.get("event") == "letters_local"]


def test_found_letters_oldest_first_with_media_urls(root):
    member_dir = _write(
        root,
        {
            "version": 1,
            "letters": [
                _letter(2, "2026-10-31T08:03:23Z"),
                _letter(1, "2025-10-31T16:19:35Z"),
            ],
        },
    )
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg")  # 2.jpg is missing
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    letters = res.json()["letters"]
    assert [entry["id"] for entry in letters] == [1, 2]
    assert letters[0]["text"] == TEXT
    expected = "/api/content/media/hinatazaka46/" + "/".join(
        quote(p, safe="")
        for p in ["messages", "90 高井 俐香", "142 高井 俐香", "letters", "1.jpg"]
    )
    assert letters[0]["image_url"] == expected
    assert letters[1]["image_url"] is None
    assert (letters[0]["width"], letters[0]["height"]) == (341, 512)
    [event] = _events(logs)
    assert event["outcome"] == "found"
    assert event["count"] == 2 and event["skipped"] == 0
    assert event["log_level"] == "info"
    assert TEXT not in str(logs) and "高井" not in str(logs)


def test_image_url_is_served_by_the_media_route(root):
    member_dir = _write(
        root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]}
    )
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg-bytes")
    url = _get().json()["letters"][0]["image_url"]
    res = client.get(url)
    assert res.status_code == 200
    assert res.content == b"jpg-bytes"


def test_missing_file_gives_an_empty_list(root):
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    assert res.json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "missing"


def test_no_letters_is_empty(root):
    _write(root, {"version": 1, "letters": []})
    with capture_logs() as logs:
        assert _get().json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "empty"


@pytest.mark.parametrize("raw", ["{not json", "[]", '{"letters": {}}'])
def test_invalid_file_gives_an_empty_list_and_a_warning(root, raw):
    (_member_dir(root) / "letters.json").write_text(raw, encoding="utf-8")
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    assert res.json() == {"letters": []}
    [event] = _events(logs)
    assert event["outcome"] == "invalid"
    assert event["log_level"] == "warning"


def test_bad_entries_are_skipped_and_counted(root):
    _write(
        root,
        {
            "version": 1,
            "letters": [
                "not a dict",
                _letter(True, "2025-01-01T00:00:00Z"),
                _letter(3, None),
                _letter(4, "yesterday"),
                _letter(5, "2025-01-01T00:00:00Z", text=None, width=0, height="512"),
            ],
        },
    )
    with capture_logs() as logs:
        letters = _get().json()["letters"]
    assert [entry["id"] for entry in letters] == [5]
    assert letters[0]["text"] == ""
    assert letters[0]["width"] is None and letters[0]["height"] is None
    assert _events(logs)[0]["skipped"] == 4


@pytest.mark.parametrize(
    "image_file",
    [
        "../../../secret.jpg",
        "letters/../1.jpg",
        "letters/1.jpg/../../x.jpg",
        "picture/1.jpg",
        "letters/abc.jpg",
        None,
    ],
)
def test_non_canonical_image_files_get_no_url(root, image_file):
    member_dir = _write(
        root,
        {
            "version": 1,
            "letters": [_letter(1, "2025-10-31T16:19:35Z", image_file=image_file)],
        },
    )
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg")
    assert _get().json()["letters"][0]["image_url"] is None


@pytest.mark.parametrize("path", ["../../etc", "日向坂46/../../outside"])
def test_traversal_is_rejected(root, path):
    assert _get(path=path).status_code in (403, 404)


def test_a_path_of_another_service_is_rejected(root):
    _write(
        root,
        {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]},
        member=SAKURA_MEMBER,
    )
    with capture_logs() as logs:
        res = _get(path=SAKURA_MEMBER)
    assert res.status_code == 400
    assert _events(logs)[0]["outcome"] == "wrong_service"
    # Through this service's folder into another one: it leaves the folder (403).
    assert _get(path=f"日向坂46/../{SAKURA_MEMBER}").status_code == 403


def test_unknown_service_is_rejected(root):
    with capture_logs() as logs:
        assert _get(service="nope").status_code == 400
    assert _events(logs)[0]["outcome"] == "bad_service"


# --- fix wave 1: hardening ---------------------------------------------------

DEEP = "[" * 200000 + "]" * 200000


def _no_paths_logged(logs: list[dict]) -> None:
    text = str(logs)
    for needle in ("高井", "中川", "日向坂46", "secret", "outside", "etc", "/"):
        assert needle not in text, needle


@pytest.mark.parametrize(
    "path,status", [("../../etc", 404), ("日向坂46/../../outside", 403), ("/etc", 403)]
)
def test_traversal_is_refused_with_a_path_free_breadcrumb(root, path, status):
    with capture_logs() as logs:
        res = _get(path=path)
    assert res.status_code == status
    [event] = _events(logs)
    assert event["outcome"] == "rejected" and event["status"] == status
    assert event["log_level"] == "warning" and event["service"] == "hinatazaka46"


def test_nul_in_path_is_400_with_a_breadcrumb(root):
    with capture_logs() as logs:
        res = _get(path="日向坂46/a\x00b")
    assert res.status_code == 400
    [event] = _events(logs)
    assert event["outcome"] == "rejected" and event["status"] == 400
    _no_paths_logged(logs)


def test_traversal_log_in_content_is_path_free(root):
    with capture_logs() as logs:
        _get(path="日向坂46/../../etc")
    blocked = [e for e in logs if e.get("event") == "path_traversal_blocked"]
    assert blocked and blocked[0]["route"] == "letters_local"
    # (not _no_paths_logged: the reason code "outside_service_folder" contains "outside")
    text = str(logs)
    assert "日向坂46" not in text and "etc" not in text


def test_media_route_debug_log_has_no_path(root):
    member_dir = _write(
        root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]}
    )
    (member_dir / "letters" / "1.jpg").write_bytes(b"x")
    url = _get().json()["letters"][0]["image_url"]
    with capture_logs() as logs:
        assert client.get(url).status_code == 200
    _no_paths_logged(logs)


@pytest.mark.parametrize("kind", ["deep", "big", "wrong_type"])
def test_hostile_letters_file_is_invalid_not_500(root, kind):
    member_dir = _member_dir(root)
    target = member_dir / "letters.json"
    if kind == "deep":
        target.write_text(DEEP, encoding="utf-8")
    elif kind == "big":
        with patch("backend.services.archive_urls.MAX_JSON_BYTES", 10):
            target.write_text(json.dumps({"letters": []}) + " " * 20, encoding="utf-8")
            with capture_logs() as logs:
                res = _get()
            assert res.status_code == 200 and res.json() == {"letters": []}
            assert _events(logs)[0]["outcome"] == "invalid"
        return
    else:
        target.write_text('"just a string"', encoding="utf-8")
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200 and res.json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "invalid"


def test_trailing_newline_image_file_gets_no_url(root):
    member_dir = _write(
        root,
        {
            "version": 1,
            "letters": [
                _letter(1, "2025-10-31T16:19:35Z", image_file="letters/1.jpg\n")
            ],
        },
    )
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg")
    assert _get().json()["letters"][0]["image_url"] is None


def _symlink(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unsupported")


def test_symlinked_letters_file_outside_output_is_invalid(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "letters.json"
    outside.write_text(
        json.dumps({"letters": [_letter(1, "2025-10-31T16:19:35Z")]}), encoding="utf-8"
    )
    member_dir = _member_dir(root)
    _symlink(member_dir / "letters.json", outside)
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200 and res.json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "invalid"
    _no_paths_logged(logs)


def test_symlinked_image_outside_output_gets_no_url(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "x.jpg"
    outside.write_bytes(b"secret")
    member_dir = _write(
        root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]}
    )
    _symlink(member_dir / "letters" / "1.jpg", outside)
    with capture_logs() as logs:
        letters = _get().json()["letters"]
    assert letters[0]["image_url"] is None
    assert _events(logs)[0]["bad_images"] == 1


def test_symlinked_member_dir_escaping_the_output_is_403(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside")
    (root / "日向坂46").mkdir()
    _symlink(root / "日向坂46" / "evil", outside)
    with capture_logs() as logs:
        assert _get(path="日向坂46/evil").status_code == 403
    assert _events(logs)[0]["outcome"] == "rejected"


def test_symlinked_member_dir_into_another_service_is_403(root):
    _write(root, {"version": 1, "letters": []}, member=SAKURA_MEMBER)
    (root / "日向坂46").mkdir()
    _symlink(root / "日向坂46" / "link", root / SAKURA_MEMBER)
    assert _get(path="日向坂46/link").status_code == 403


def test_permission_error_is_invalid_not_500(root):
    _write(root, {"version": 1, "letters": []})
    with patch.object(Path, "is_file", side_effect=PermissionError("denied")):
        with capture_logs() as logs:
            res = _get()
    assert res.status_code == 200 and res.json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "invalid"
    _no_paths_logged(logs)


# --- final fix wave ------------------------------------------------------------


def test_symlink_loop_in_path_is_403_not_500(root):
    (root / "日向坂46").mkdir()
    _symlink(root / "日向坂46" / "a", root / "日向坂46" / "b")
    _symlink(root / "日向坂46" / "b", root / "日向坂46" / "a")
    with capture_logs() as logs:
        res = _get(path="日向坂46/a/x")
    assert res.status_code == 403
    [event] = _events(logs)
    assert event["outcome"] == "rejected" and event["status"] == 403
    assert event["log_level"] == "warning" and event["service"] == "hinatazaka46"
    _no_paths_logged(logs)


@pytest.mark.parametrize(
    "error", [RuntimeError("Symlink loop from '/x/日向坂46/a'"), OSError("/x/日向坂46")]
)
def test_os_error_while_resolving_the_path_is_403_path_free(root, error):
    with patch("backend.api.content.resolve_in_service_folder", side_effect=error):
        with capture_logs() as logs:
            res = _get()
    assert res.status_code == 403
    assert "日向坂46" not in res.text
    [event] = _events(logs)
    assert event["outcome"] == "rejected" and event["status"] == 403
    _no_paths_logged(logs)


def test_bad_images_raise_the_breadcrumb_to_a_warning(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "x.jpg"
    outside.write_bytes(b"secret")
    member_dir = _write(
        root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]}
    )
    _symlink(member_dir / "letters" / "1.jpg", outside)
    with capture_logs() as logs:
        _get()
    [event] = _events(logs)
    assert event["outcome"] == "found" and event["bad_images"] == 1
    assert event["log_level"] == "warning"


def test_a_backslash_path_is_refused_and_the_service_id_form_works(root):
    """Plan C follow-up: '日向坂46\\messages\\...' used to pass on Windows."""
    _write(root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]})
    with capture_logs() as logs:
        res = _get(path=MEMBER.replace("/", "\\"))
    assert res.status_code == 404
    assert _events(logs)[0]["outcome"] == "rejected"
    by_id = _get(path="hinatazaka46/" + MEMBER.split("/", 1)[1])
    assert by_id.status_code == 200 and len(by_id.json()["letters"]) == 1
