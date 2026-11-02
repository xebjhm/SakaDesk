import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.tests.read_path_fixture import HINATA_SINGLE, SAKURA_SINGLE, build_archive

client = TestClient(app)
PREFIX = "/api/content/media/hinatazaka46/messages/34%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/58%20%E9%87%91%E6%9D%91%20%E7%BE%8E%E7%8E%96/profile_images"


def _archive_images(member_dir: Path, entries, current):
    root = member_dir / "profile_images"
    for e in entries:
        p = root / e["file"]
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"img")
    with open(root / "index.json", "w", encoding="utf-8") as f:
        json.dump(
            {"version": 1, "current": current, "images": entries}, f, ensure_ascii=False
        )


@pytest.fixture
def archive(tmp_path):
    root = build_archive(tmp_path)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


def test_history_newest_first_with_current_flag(archive):
    _archive_images(
        archive / HINATA_SINGLE,
        [
            {
                "kind": "thumbnail",
                "file": "thumbnail/old.jpeg",
                "url": "https://cdn/old.jpeg",
                "first_seen": "2026-03-14T00:00:00Z",
            },
            {
                "kind": "thumbnail",
                "file": "thumbnail/new.jpeg",
                "url": "https://cdn/new.jpeg",
                "first_seen": "2026-07-05T00:00:00Z",
            },
        ],
        {"thumbnail": "https://cdn/new.jpeg"},
    )
    body = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()
    thumbs = body["kinds"]["thumbnail"]
    assert [t["url"] for t in thumbs] == [
        f"{PREFIX}/thumbnail/new.jpeg",
        f"{PREFIX}/thumbnail/old.jpeg",
    ]
    assert [t["current"] for t in thumbs] == [True, False]
    assert thumbs[1]["first_seen"] == "2026-03-14T00:00:00Z"


def test_current_not_archived_yet_is_listed_first_as_remote(archive):
    _archive_images(
        archive / HINATA_SINGLE,
        [
            {
                "kind": "thumbnail",
                "file": "thumbnail/old.jpeg",
                "url": "https://cdn/old.jpeg",
                "first_seen": "2026-03-14T00:00:00Z",
            }
        ],
        {"thumbnail": "https://cdn/brand-new.jpeg"},
    )
    thumbs = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()[
        "kinds"
    ]["thumbnail"]
    assert thumbs[0] == {
        "url": "https://cdn/brand-new.jpeg",
        "first_seen": None,
        "current": True,
    }
    assert thumbs[1]["current"] is False


def test_no_index_falls_back_to_member_block(archive):
    kinds = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()[
        "kinds"
    ]
    assert kinds["phone_image"] == [
        {
            "url": "https://cdn/members/phone-images/58-20260102-000000.jpeg",
            "first_seen": None,
            "current": True,
        }
    ]
    assert set(kinds) == {"group_thumbnail", "thumbnail", "phone_image"}


def test_member_without_images_returns_empty_kinds(archive):
    assert client.get(f"/api/content/profile_images?path={SAKURA_SINGLE}").json() == {
        "kinds": {}
    }


def test_missing_file_on_disk_is_skipped_and_corrupt_index_falls_back(archive):
    member_dir = archive / HINATA_SINGLE
    _archive_images(
        member_dir,
        [
            {
                "kind": "thumbnail",
                "file": "thumbnail/a.jpeg",
                "url": "u/a",
                "first_seen": "2026-01-01T00:00:00Z",
            }
        ],
        {"thumbnail": "u/a"},
    )
    (member_dir / "profile_images" / "thumbnail" / "a.jpeg").unlink()
    thumbs = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()[
        "kinds"
    ]["thumbnail"]
    assert thumbs == [{"url": "u/a", "first_seen": None, "current": True}]
    (member_dir / "profile_images" / "index.json").write_text("{bad", encoding="utf-8")
    assert (
        client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").status_code
        == 200
    )


def test_traversal_rejected(archive):
    assert client.get("/api/content/profile_images?path=../../etc").status_code in (
        400,
        403,
        404,
    )


def test_local_fields_in_groups_and_messages(archive):
    _archive_images(
        archive / HINATA_SINGLE,
        [
            {
                "kind": "phone_image",
                "file": "phone_image/p.jpeg",
                "url": "https://cdn/p.jpeg",
                "first_seen": "2026-01-01T00:00:00Z",
            }
        ],
        {
            "phone_image": "https://cdn/p.jpeg",
            "thumbnail": "https://cdn/t-not-yet.jpeg",
        },
    )
    groups = client.get("/api/content/groups?service=hinatazaka46").json()["groups"]
    member = next(g for g in groups if str(g["id"]) == "34")["members"][0]
    assert member["phone_image_local"] == f"{PREFIX}/phone_image/p.jpeg"
    assert member["thumbnail_local"] is None and member["group_thumbnail_local"] is None
    msgs = client.get(f"/api/content/messages_by_path?path={HINATA_SINGLE}").json()
    assert msgs["member"]["phone_image_local"] == f"{PREFIX}/phone_image/p.jpeg"
