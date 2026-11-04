"""Tests for GET /api/account/profile (the user's archived nickname and avatars)."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)

NAME = "ゆき🌸ファン"
SIGNED = "https://cdn.example.com/avatar.jpg?Expires=1&Signature=SECRET-SIG"


@pytest.fixture
def root(tmp_path: Path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        yield tmp_path


def _account(
    root: Path,
    profile: object = None,
    index: object = None,
    files: tuple[str, ...] = (),
) -> Path:
    account = root / "日向坂46" / "account"
    (account / "profile_images" / "thumbnail").mkdir(parents=True, exist_ok=True)
    for target, payload in (
        (account / "profile.json", profile),
        (account / "profile_images" / "index.json", index),
    ):
        if payload is None:
            continue
        if isinstance(payload, str):
            target.write_text(payload, encoding="utf-8")
        else:
            with open(target, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
    for name in files:
        (account / "profile_images" / name).write_bytes(b"img")
    return account


def _image(file: str, first_seen: str, kind: str = "thumbnail") -> dict:
    return {"kind": kind, "file": file, "url": SIGNED, "first_seen": first_seen}


def _events(logs: list[dict]) -> list[dict]:
    return [e for e in logs if e.get("event") == "account_profile"]


def _get(service: str = "hinatazaka46"):
    return client.get("/api/account/profile", params={"service": service})


def test_found_profile_with_avatar_history(root):
    _account(
        root,
        profile={"version": 1, "name": NAME, "updated_at": "2026-08-12T15:12:14Z"},
        index={
            "version": 1,
            "current": {"thumbnail": SIGNED},
            "images": [
                _image("thumbnail/b.jpg", "2026-08-12T15:12:14Z"),
                _image("thumbnail/a.jpg", "2025-01-01T00:00:00Z"),
                _image("phone_image/p.jpg", "2025-01-01T00:00:00Z", kind="phone_image"),
            ],
        },
        files=("thumbnail/a.jpg", "thumbnail/b.jpg"),
    )
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == NAME
    assert body["avatars"] == [
        {
            "url": "/api/content/media/hinatazaka46/account/profile_images/thumbnail/a.jpg",
            "first_seen": "2025-01-01T00:00:00Z",
        },
        {
            "url": "/api/content/media/hinatazaka46/account/profile_images/thumbnail/b.jpg",
            "first_seen": "2026-08-12T15:12:14Z",
        },
    ]
    assert "SECRET-SIG" not in res.text and "cdn.example.com" not in res.text
    [event] = _events(logs)
    assert (
        event["outcome"] == "found"
        and event["avatars"] == 2
        and event["has_name"] is True
    )
    assert "SECRET-SIG" not in str(logs) and NAME not in str(logs)
    assert client.get(body["avatars"][0]["url"]).status_code == 200


def test_missing_account_folder(root):
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    assert res.json() == {"name": None, "avatars": []}
    assert _events(logs)[0]["outcome"] == "missing"


def test_invalid_profile_still_returns_the_avatars(root):
    _account(
        root,
        profile="{oops",
        index={
            "version": 1,
            "images": [_image("thumbnail/a.jpg", "2025-01-01T00:00:00Z")],
        },
        files=("thumbnail/a.jpg",),
    )
    with capture_logs() as logs:
        body = _get().json()
    assert body["name"] is None and len(body["avatars"]) == 1
    [event] = _events(logs)
    assert event["outcome"] == "invalid" and event["log_level"] == "warning"


def test_invalid_index_still_returns_the_name(root):
    _account(root, profile={"version": 1, "name": NAME}, index="[]")
    with capture_logs() as logs:
        body = _get().json()
    assert body == {"name": NAME, "avatars": []}
    assert _events(logs)[0]["outcome"] == "invalid"


def test_bad_entries_are_skipped(root):
    _account(
        root,
        profile={"version": 1, "name": ""},
        index={
            "version": 1,
            "images": [
                _image("thumbnail/../../x.jpg", "2025-01-01T00:00:00Z"),
                _image("thumbnail/gone.jpg", "2025-01-01T00:00:00Z"),
                _image("thumbnail/a.jpg", "soon"),
                "not a dict",
            ],
        },
        files=("thumbnail/a.jpg",),
    )
    with capture_logs() as logs:
        body = _get().json()
    assert body == {"name": None, "avatars": []}
    [event] = _events(logs)
    assert (
        event["outcome"] == "empty"
        and event["skipped"] == 4
        and event["has_name"] is False
    )


def test_unknown_service_is_rejected(root):
    with capture_logs() as logs:
        assert _get(service="nope").status_code == 400
    assert _events(logs)[0]["outcome"] == "bad_service"


# --- fix wave 1: hardening ---------------------------------------------------

DEEP = "[" * 200000 + "]" * 200000


def _symlink(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks unsupported")


@pytest.mark.parametrize("which", ["profile", "index"])
@pytest.mark.parametrize("kind", ["deep", "big", "wrong_type"])
def test_hostile_files_are_invalid_not_500(root, which, kind):
    good_profile = {"version": 1, "name": NAME}
    good_index = {"version": 1, "images": []}
    payloads = {
        "deep": DEEP,
        "big": json.dumps(good_index) + " " * 50,
        "wrong_type": '"str"',
    }
    profile = payloads[kind] if which == "profile" else good_profile
    index = payloads[kind] if which == "index" else good_index
    limit = 10**6 if kind != "big" else 40
    with patch("backend.services.archive_urls.MAX_JSON_BYTES", limit):
        if kind == "big":
            profile = json.dumps(profile) if which != "profile" else profile
            index = json.dumps(index) if which != "index" else index
            if which == "index":
                profile = good_profile
        _account(root, profile=profile, index=index)
        with capture_logs() as logs:
            res = _get()
    assert res.status_code == 200
    [event] = _events(logs)
    assert event["outcome"] == "invalid" and event["log_level"] == "warning"
    assert NAME not in str(logs)


def test_symlinked_account_dir_outside_output_is_invalid(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside")
    (outside / "profile.json").write_text(json.dumps({"name": NAME}), encoding="utf-8")
    (root / "日向坂46").mkdir()
    _symlink(root / "日向坂46" / "account", outside)
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200 and res.json() == {"name": None, "avatars": []}
    assert _events(logs)[0]["outcome"] == "invalid"
    assert "outside" not in str(logs)


def test_symlinked_profile_file_outside_output_is_invalid(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "p.json"
    outside.write_text(json.dumps({"name": NAME}), encoding="utf-8")
    account = _account(root)
    _symlink(account / "profile.json", outside)
    body = _get().json()
    assert body["name"] is None


def test_symlinked_avatar_outside_output_is_skipped(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "a.jpg"
    outside.write_bytes(b"secret")
    account = _account(
        root,
        index={
            "version": 1,
            "images": [_image("thumbnail/a.jpg", "2025-01-01T00:00:00Z")],
        },
    )
    _symlink(account / "profile_images" / "thumbnail" / "a.jpg", outside)
    with capture_logs() as logs:
        body = _get().json()
    assert body["avatars"] == []
    assert _events(logs)[0]["skipped"] == 1


def test_permission_error_is_invalid_not_500(root):
    _account(root, profile={"version": 1, "name": NAME})
    with patch.object(Path, "is_file", side_effect=PermissionError("denied")):
        with capture_logs() as logs:
            res = _get()
    assert res.status_code == 200
    assert _events(logs)[0]["outcome"] == "invalid"
