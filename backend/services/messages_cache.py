"""Stat-keyed cache of per-file summaries of ``messages.json``.

Invalidation looks only at the file system: ``(st_mtime_ns, st_size, st_ino)``.
Every writer — pysaka sync, favorites, any future code — changes at least one of
them (an atomic ``os.replace`` always changes the inode), so no writer has to
cooperate with this cache. Values are immutable summaries, never the raw
message dicts: request handlers mutate those (e.g. adding ``member_id``), and a
cached raw object would carry such mutations into later responses.
"""

from __future__ import annotations

import bisect
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping, TypeVar

T = TypeVar("T")
StatKey = tuple[int, int, int]


def stat_key(path: Path) -> StatKey:
    """Version of a file as the OS sees it. Raises OSError if it is missing."""
    st = path.stat()
    return (st.st_mtime_ns, st.st_size, st.st_ino)


class StatCache:
    """Thread-safe map ``path -> (stat_key, value)``.

    The stat is taken *before* the file is read, so a cached value is never
    older than its key: a write racing the read only causes one extra rebuild.
    """

    def __init__(self) -> None:
        self._entries: dict[str, tuple[StatKey, Any]] = {}
        self._lock = threading.Lock()

    def get(self, path: Path, build: Callable[[Any], T]) -> T:
        key = str(path)
        try:
            sk = stat_key(path)
        except OSError:
            with self._lock:
                self._entries.pop(key, None)
            raise
        with self._lock:
            hit = self._entries.get(key)
        if hit is not None and hit[0] == sk:
            return hit[1]  # type: ignore[no-any-return]
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        value = build(data)
        with self._lock:
            self._entries[key] = (sk, value)
        return value


@dataclass(frozen=True)
class MessagesSummary:
    """What the sidebar endpoints need from one ``messages.json``."""

    member: Mapping[str, Any]
    last_raw_id: Any  # id of the LAST message in file order, None if no messages
    total_messages: Any  # data["total_messages"] if present, else len(messages)
    sorted_ids: tuple[Any, ...]  # every message id (``m.get("id", 0)``), sorted
    id_set: frozenset[Any]

    def unread_count(self, last_read_id: Any, revealed: Iterable[Any]) -> int:
        """Same result as ``sum(1 for id in ids if id > last_read_id and id not in revealed)``."""
        ids = self.sorted_ids
        count = len(ids) - bisect.bisect_right(ids, last_read_id)
        for r in set(revealed):
            if isinstance(r, int) and not isinstance(r, bool) and r > last_read_id:
                count -= bisect.bisect_right(ids, r) - bisect.bisect_left(ids, r)
        return count


def build_messages_summary(data: Any) -> MessagesSummary:
    member = data.get("member", {})
    msgs = data.get("messages", [])
    ids = [m.get("id", 0) for m in msgs]
    return MessagesSummary(
        member=MappingProxyType(dict(member)),
        last_raw_id=msgs[-1].get("id", 0) if msgs else None,
        total_messages=data.get("total_messages", len(msgs)),
        sorted_ids=tuple(sorted(ids)),
        id_set=frozenset(ids),
    )


_MESSAGES_CACHE = StatCache()


def get_messages_summary(path: Path) -> MessagesSummary:
    """Summary of ``path``; parses only when the file changed since last time.

    Raises the same errors reading the file would (OSError, ValueError, …).
    """
    return _MESSAGES_CACHE.get(path, build_messages_summary)
