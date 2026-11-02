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


# ---- fix round 1: cheap per-poll lookup, safe read paths -------------------

T_NEW = {
    "kind": "thumbnail",
    "file": "thumbnail/new.jpeg",
    "url": "https://cdn/new.jpeg",
    "first_seen": "2026-07-05T00:00:00Z",
}


def _sidebar_member(service="hinatazaka46", gid="34"):
    groups = client.get(f"/api/content/groups?service={service}").json()["groups"]
    return next(g for g in groups if str(g["id"]) == gid)


def test_local_urls_per_poll_is_lexical(tmp_path, monkeypatch):
    """50 members x 8 entries: no resolve()/relative_to() per entry, <=1
    is_file() per kind (the hot path of every 2 s /groups poll)."""
    from backend.services import profile_images_service as pis

    out = tmp_path / "out"
    members = []
    for i in range(50):
        m = out / "日向坂46" / "messages" / f"{i} 金村" / f"{i} 金村"
        entries = []
        for kind in pis.KINDS:
            for h in range(8):
                entries.append(
                    {
                        "kind": kind,
                        "file": f"{kind}/{i}-{h}.jpeg",
                        "url": f"https://cdn/{i}-{h}.jpeg",
                        "first_seen": f"2026-0{h + 1}",
                    }
                )
        _archive_images(
            m, entries, {k: f"https://cdn/{i}-7.jpeg?s=1" for k in pis.KINDS}
        )
        members.append(m)
    rels = [m.relative_to(out).as_posix() for m in members]
    for m, rel in zip(members, rels):  # warm the parse cache
        pis.local_urls(out, m, rel)

    calls = {"resolve": 0, "relative_to": 0, "is_file": 0}
    for name in calls:
        orig = getattr(Path, name)

        def counted(self, *a, _o=orig, _n=name, **k):
            calls[_n] += 1
            return _o(self, *a, **k)

        monkeypatch.setattr(Path, name, counted)
    for m, rel in zip(members, rels):
        urls = pis.local_urls(out, m, rel)
        assert all(urls.values())
    assert calls["resolve"] == 0 and calls["relative_to"] == 0
    assert calls["is_file"] <= 3 * len(members)


def test_media_url_is_served_for_cjk_and_space_names(archive):
    root = archive / HINATA_SINGLE
    _archive_images(
        root,
        [
            {
                "kind": "thumbnail",
                "file": "thumbnail/日本 語.jpeg",
                "url": "https://cdn/日本 語.jpeg",
                "first_seen": "2026-01-01T00:00:00Z",
            }
        ],
        {"thumbnail": "https://cdn/日本 語.jpeg?sig=z"},
    )
    url = _sidebar_member()["members"][0]["thumbnail_local"]
    assert url and url.startswith("/api/content/media/hinatazaka46/")
    res = client.get(url)
    assert res.status_code == 200 and res.content == b"img"


@pytest.mark.parametrize(
    "bad_file",
    [
        "thumbnail/../thumbnail/new.jpeg",
        "thumbnail/./new.jpeg",
        "thumbnail/sub/new.jpeg",
        "thumbnail//new.jpeg",
        "phone_image/new.jpeg",  # wrong kind directory
        "thumbnail/new.jpeg ",
    ],
)
def test_non_canonical_index_files_are_rejected(archive, bad_file):
    root = archive / HINATA_SINGLE
    good = dict(T_NEW)
    _archive_images(root, [good], {"thumbnail": good["url"]})
    bad = dict(T_NEW, file=bad_file, first_seen="2026-08-01T00:00:00Z")
    (root / "profile_images" / "index.json").write_text(
        json.dumps(
            {"version": 1, "current": {"thumbnail": good["url"]}, "images": [bad]}
        ),
        encoding="utf-8",
    )
    thumbs = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()[
        "kinds"
    ]["thumbnail"]
    assert thumbs == [{"url": good["url"], "first_seen": None, "current": True}]
    assert _sidebar_member()["members"][0]["thumbnail_local"] is None


def test_symlinked_output_dir_keeps_read_paths_working(tmp_path):
    real = tmp_path / "real"
    root = build_archive(real)
    _archive_images(root / HINATA_SINGLE, [T_NEW], {"thumbnail": T_NEW["url"]})
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    with patch("backend.api.content.get_output_dir", return_value=link):
        member = _sidebar_member()["members"][0]
        assert member["thumbnail_local"] == f"{PREFIX}/thumbnail/new.jpeg"
        single = client.get(f"/api/content/messages_by_path?path={HINATA_SINGLE}")
        assert single.status_code == 200
        assert single.json()["member"]["thumbnail_local"] == member["thumbnail_local"]
        listing = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}")
        assert listing.status_code == 200
        assert (
            listing.json()["kinds"]["thumbnail"][0]["url"] == member["thumbnail_local"]
        )
        group_path = "日向坂46/messages/43 日向坂46"
        _archive_images(
            root / group_path / "1 メンバーA", [T_NEW], {"thumbnail": T_NEW["url"]}
        )
        grp = client.get(f"/api/content/group_messages/{group_path}?limit=0").json()
        assert len(grp["messages"]) == 3
        a = next(m for m in grp["members"] if str(m["id"]) == "1")
        assert a["thumbnail_local"].endswith("/profile_images/thumbnail/new.jpeg")


MALFORMED = {
    "mixed_first_seen": {
        "version": 1,
        "current": {"thumbnail": "https://cdn/new.jpeg"},
        "images": [
            T_NEW,
            dict(T_NEW, file="thumbnail/a.jpeg", first_seen=5),
            dict(T_NEW, file="thumbnail/b.jpeg", first_seen=None),
            dict(T_NEW, file="thumbnail/c.jpeg", first_seen=["x"]),
        ],
    },
    "current_list": {"version": 1, "current": ["x"], "images": [T_NEW]},
    "current_str": {"version": 1, "current": "x", "images": [T_NEW]},
    "current_values": {
        "version": 1,
        "current": {"thumbnail": 5, "phone_image": None, "group_thumbnail": ["u"]},
        "images": [T_NEW],
    },
    "entries_not_dicts": {"images": [1, "x", None, ["y"], T_NEW]},
    "file_not_str": {
        "images": [dict(T_NEW, file=5), dict(T_NEW, file=["a"]), dict(T_NEW, file=None)]
    },
    "kind_unhashable": {
        "images": [dict(T_NEW, kind=["thumbnail"]), dict(T_NEW, kind={})]
    },
    "images_not_list": {"images": {"a": 1}},
    "top_level_list": [T_NEW],
    "top_level_scalar": 3,
}


@pytest.mark.parametrize("name", sorted(MALFORMED))
def test_malformed_index_never_breaks_read_paths(archive, name):
    root = archive / HINATA_SINGLE
    before = _sidebar_member()
    (root / "profile_images").mkdir(parents=True)
    (root / "profile_images" / "thumbnail").mkdir()
    for n in ("new", "a", "b", "c"):
        (root / "profile_images" / "thumbnail" / f"{n}.jpeg").write_bytes(b"img")
    (root / "profile_images" / "index.json").write_text(
        json.dumps(MALFORMED[name]), encoding="utf-8"
    )
    after = _sidebar_member()
    assert after["last_message_id"] == before["last_message_id"] != 0
    assert after["total_messages"] == before["total_messages"] != 0
    assert (
        client.get(f"/api/content/messages_by_path?path={HINATA_SINGLE}").status_code
        == 200
    )
    assert (
        client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").status_code
        == 200
    )
    grp = client.get(
        "/api/content/group_messages/日向坂46/messages/43 日向坂46?limit=0"
    )
    assert grp.status_code == 200 and len(grp.json()["messages"]) == 3


def test_local_urls_failure_is_contained(archive):
    from backend.services import profile_images_service as pis

    before = _sidebar_member()
    with patch.object(pis, "_load_view", side_effect=RuntimeError("boom")):
        after = _sidebar_member()
        urls = pis.local_urls(archive, archive / HINATA_SINGLE)
    assert urls == {f"{k}_local": None for k in pis.KINDS}
    assert after["last_message_id"] == before["last_message_id"]
    assert after["total_messages"] == before["total_messages"]
    assert all(m["thumbnail_local"] is None for m in after["members"])


def test_corrupt_index_is_logged_once_per_stat_key(archive):
    from backend.services import profile_images_service as pis

    member = archive / HINATA_SINGLE
    index = member / "profile_images" / "index.json"
    index.parent.mkdir(parents=True)
    index.write_text("{bad", encoding="utf-8")
    with patch.object(pis, "logger") as log:
        for _ in range(5):
            pis.local_urls(archive, member)
        assert log.warning.call_count == 1
        index.write_text("{still bad!", encoding="utf-8")  # new stat key
        for _ in range(3):
            pis.local_urls(archive, member)
        assert log.warning.call_count == 2
