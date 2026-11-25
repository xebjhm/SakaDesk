"""Test-archive builder for the Memories tests (a helper module, not a conftest).

Writes the on-disk shapes pysaka produces, so the memory index, facts and the
Memories services read them exactly as they read a real archive:

- ``write_room`` -- ``messages/<gid group>/<mid name>/messages.json`` plus,
  optionally, ``profile_images/index.json`` (with the image files) and
  ``letters.json``;
- ``msg`` -- one ``messages.json`` row (``timestamp`` is the archive's UTC
  ``YYYY-MM-DDTHH:MM:SSZ``);
- ``write_side_inputs`` -- ``memories/member_profiles.json``,
  ``memories/subscriptions.json`` and ``sync_metadata.json`` ``server_groups``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def msg(
    i: int,
    ts: str,
    type_: str = "text",
    content: str = "",
    fav: bool = False,
    **extra: Any,
) -> dict:
    """One ``messages.json`` row; ``ts`` is the archive UTC timestamp."""
    return {
        "id": i,
        "timestamp": ts,
        "type": type_,
        "content": content,
        "is_favorite": fav,
        **extra,
    }


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def write_avatars(
    room_dir: Path, entries: list[dict], current_file: str | None = None
) -> None:
    """``profile_images/index.json`` with ``entries`` (``{kind, file, first_seen}``).

    Every canonical entry's file is written, so the profile-image service
    serves it. ``current_file`` (default: the newest thumbnail by ``first_seen``)
    becomes the current thumbnail.
    """
    root = room_dir / "profile_images"
    for e in entries:
        file = e.get("file")
        if isinstance(file, str) and ".." not in file:
            (root / file).parent.mkdir(parents=True, exist_ok=True)
            (root / file).write_bytes(b"\xff\xd8\xff")
    if current_file is None:
        thumbs = [e for e in entries if e.get("kind") == "thumbnail"]
        newest = max(thumbs, key=lambda e: e.get("first_seen") or "", default=None)
        current_file = newest["file"] if newest else None
    current = (
        {"thumbnail": "https://cdn.example.jp/icons/" + current_file.split("/")[-1]}
        if current_file
        else {}
    )
    _write_json(
        root / "index.json", {"version": 1, "images": entries, "current": current}
    )


def write_room(
    sdir: Path,
    gid_group: str,
    mid_name: str,
    msgs: list[dict],
    *,
    avatars: list | None = None,
    letters: list | None = None,
) -> Path:
    """Write one room folder and return it (``sdir/messages/<gid_group>/<mid_name>``)."""
    d = sdir / "messages" / gid_group / mid_name
    d.mkdir(parents=True, exist_ok=True)
    _write_json(d / "messages.json", {"member": {}, "messages": msgs})
    if avatars is not None:
        write_avatars(d, avatars)
    if letters is not None:
        _write_json(d / "letters.json", {"letters": letters})
    return d


def write_side_inputs(
    sdir: Path,
    *,
    birthdays: dict[str, str] | None = None,
    sub_starts: dict[str, str] | None = None,
    closed_groups: list[str] | None = None,
) -> None:
    """Side inputs read by ``index._load_inputs`` (only the ones given are written).

    ``birthdays`` maps a normalized name to ``YYYY-MM-DD``; ``sub_starts`` maps
    a group id to its earliest subscription start; ``closed_groups`` lists
    group ids whose ``server_groups`` state is ``closed``.
    """
    if birthdays is not None:
        _write_json(
            sdir / "memories" / "member_profiles.json",
            {"updated_at": "2026-11-01T00:00:00+00:00", "birthdays": birthdays},
        )
    if sub_starts is not None:
        _write_json(
            sdir / "memories" / "subscriptions.json",
            {"groups": {g: {"earliest_start": s} for g, s in sub_starts.items()}},
        )
    if closed_groups is not None:
        _write_json(
            sdir / "sync_metadata.json",
            {"server_groups": {g: {"state": "closed"} for g in closed_groups}},
        )
