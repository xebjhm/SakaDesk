"""Deterministic archive tree shared by the read-path golden and cache tests."""

import json
from pathlib import Path
from typing import Any

HINATA_SINGLE = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
HINATA_GROUP = "日向坂46/messages/43 日向坂46"
SAKURA_SINGLE = "櫻坂46/messages/79 中川 智尋/134 中川 智尋"


def _write(
    member_dir: Path, member: dict[str, Any], messages: list[dict[str, Any]]
) -> None:
    member_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "exported_at": "2026-11-01T00:00:00Z",
        "member": member,
        "total_messages": len(messages),
        "messages": messages,
    }
    with open(member_dir / "messages.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _msg(i: int, ts: str, **kw: Any) -> dict[str, Any]:
    return {
        "id": i,
        "timestamp": ts,
        "type": "text",
        "content": f"メッセージ {i} 🎉",
        "is_favorite": False,
        **kw,
    }


def build_archive(root: Path) -> Path:
    _write(
        root / HINATA_SINGLE,
        {
            "id": 58,
            "name": "金村 美玖",
            "thumbnail": "https://cdn/members/thumbnails/58-20260101-000000.jpeg",
            "phone_image": "https://cdn/members/phone-images/58-20260102-000000.jpeg",
            "group_thumbnail": "https://cdn/groups/thumbnails/34-20260103-000000.jpg",
        },
        [
            _msg(101, "2026-01-01T10:00:00Z"),
            _msg(102, "2026-01-01T11:00:00Z", is_favorite=True),
            _msg(103, "2026-01-01T12:00:00Z", type="picture", state="canceled"),
            _msg(
                104,
                "2026-01-01T13:00:00Z",
                type="voice",
                media_file="messages/34 金村 美玖/58 金村 美玖/voice/104.m4a",
            ),
        ],
    )
    _write(
        root / HINATA_GROUP / "1 メンバーA",
        {"id": 1, "name": "メンバーA"},
        [_msg(201, "2026-01-02T10:00:00Z")],
    )
    _write(
        root / HINATA_GROUP / "2 メンバーB 🎉",
        {
            "id": 2,
            "name": "メンバーB 🎉",
            "group_thumbnail": "https://cdn/groups/thumbnails/43.jpg",
        },
        [_msg(202, "2026-01-02T09:00:00Z"), _msg(203, "2026-01-02T11:00:00Z")],
    )
    _write(
        root / SAKURA_SINGLE,
        {"id": 134, "name": "中川 智尋"},
        [_msg(301, "2026-06-15T12:00:00Z")],
    )
    corrupt = root / "櫻坂46" / "messages" / "62 石森 璃花" / "62 石森 璃花"
    corrupt.mkdir(parents=True, exist_ok=True)
    (corrupt / "messages.json").write_text("{corrupt", encoding="utf-8")
    return root


READ_STATES = {
    HINATA_SINGLE: {"lastReadId": 101, "revealedIds": [104, "x"]},
    HINATA_GROUP: {"lastReadId": 201, "revealedIds": []},
    SAKURA_SINGLE: 0,
    "櫻坂46/messages/62 石森 璃花/62 石森 璃花": {"lastReadId": 0},
    "日向坂46/messages/999 missing": {"lastReadId": 0},
}

GOLDEN_CASES: dict[str, tuple[str, str, Any]] = {
    "groups_all": ("GET", "/api/content/groups", None),
    "groups_hinata": ("GET", "/api/content/groups?service=hinatazaka46", None),
    "unread": ("POST", "/api/content/unread_counts", READ_STATES),
    "single_all": (
        "GET",
        f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=0",
        None,
    ),
    "single_limited": (
        "GET",
        f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=102&limit=2",
        None,
    ),
    "group_all": (
        "GET",
        f"/api/content/group_messages/{HINATA_GROUP}?limit=0&last_read_id=201",
        None,
    ),
    "group_default": ("GET", f"/api/content/group_messages/{HINATA_GROUP}", None),
}
