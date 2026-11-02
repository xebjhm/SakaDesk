"""Stat-keyed cache of per-file summaries of ``messages.json``.

Invalidation looks only at the file system: ``(st_mtime_ns, st_size, st_ino)``.
Every writer — pysaka sync, favorites, any future code — changes at least one of
them (an atomic ``os.replace`` always changes the inode), so no writer has to
cooperate with this cache. Values are immutable summaries, never the raw
message dicts: request handlers mutate those (e.g. adding ``member_id``), and a
cached raw object would carry such mutations into later responses.

Limits of the key: on a filesystem without stable inodes and with coarse mtime
(FAT/exFAT) a same-size replace within one timestamp tick could be served stale
from the cache. Current writers (atomic ``os.replace`` on NTFS/ext4) cannot hit
that, so it is accepted.

Malformed files keep their pre-cache behaviour: building a summary never raises
for a defect that only one consumer of the old code would have hit. Such defects
are stored and re-raised by the consumer that needs the broken part, so the
``/groups`` and ``/unread_counts`` results (including their error paths) stay
identical to the code that parsed ``messages.json`` on every request.
"""

from __future__ import annotations

import bisect
import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping, NoReturn, Optional, TypeVar

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
        key = os.path.normcase(str(path.resolve()))
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


class _NoMessages:
    """Type of ``NO_MESSAGES`` (distinct from an explicit ``"id": null``)."""

    def __repr__(self) -> str:
        return "NO_MESSAGES"


NO_MESSAGES: Any = _NoMessages()


def _reraise(err: BaseException) -> NoReturn:
    """Raise a fresh copy of a stored error.

    Re-raising the stored instance would grow its traceback on every request
    and pin the frames (and the parsed file) that built it.
    """
    try:
        fresh = type(err)(*err.args)
    except Exception:  # exotic constructor; fall back to the shared instance
        raise err.with_traceback(None) from None
    raise fresh from None


def _stored(err: Exception) -> Exception:
    return err.with_traceback(None)


def _orderable(ids: list[Any]) -> bool:
    """True when ``ids`` has a total order that bisect can rely on.

    All real numbers (NaN excluded) or all strings. Anything else (mixed types,
    NaN, containers) is counted with the original loop so results and raised
    errors stay exactly those of the old code.
    """
    if all(isinstance(i, str) for i in ids):
        return True
    return all(isinstance(i, (int, float)) and i == i for i in ids)


@dataclass(frozen=True)
class MessagesSummary:
    """What the sidebar endpoints need from one ``messages.json``.

    ``member`` / ``last_raw_id`` / ``total_messages`` serve ``/groups`` and are
    read through ``require_*`` so a defect raises where the old inline code did.
    ``unread_count`` serves ``/unread_counts``.
    """

    member: Mapping[str, Any]
    last_raw_id: Any  # id of the LAST message in file order; NO_MESSAGES if none
    total_messages: Any  # data["total_messages"] if present, else len(messages)
    # Ids sorted for bisect; None when unorderable or when ids_error is set.
    sorted_ids: Optional[tuple[Any, ...]] = None
    id_set: Optional[frozenset[Any]] = None
    raw_ids: Optional[tuple[Any, ...]] = None  # file order; fallback path only
    member_error: Optional[Exception] = None
    last_error: Optional[Exception] = None
    total_error: Optional[Exception] = None
    ids_error: Optional[Exception] = None

    def require_member(self) -> Mapping[str, Any]:
        if self.member_error is not None:
            _reraise(self.member_error)
        return self.member

    def require_last_id(self) -> Any:
        """Last message id as ``msgs[-1].get("id", 0)``, or ``NO_MESSAGES``."""
        if self.last_error is not None:
            _reraise(self.last_error)
        return self.last_raw_id

    def require_total(self) -> Any:
        if self.total_error is not None:
            _reraise(self.total_error)
        return self.total_messages

    def unread_count(self, last_read_id: Any, revealed: Iterable[Any]) -> int:
        """``sum(1 for m_id in ids if m_id > last_read_id and m_id not in revealed)``.

        Raises whatever that expression would raise for this file and input.
        """
        if self.ids_error is not None:
            _reraise(self.ids_error)
        ids = self.sorted_ids
        if ids is None or self.id_set is None:
            revealed_set = set(revealed)
            return sum(
                1
                for m_id in self.raw_ids or ()
                if m_id > last_read_id and m_id not in revealed_set
            )
        count = len(ids) - bisect.bisect_right(ids, last_read_id)
        for r in set(revealed):
            if r in self.id_set and r > last_read_id:
                count -= bisect.bisect_right(ids, r) - bisect.bisect_left(ids, r)
        return count


def build_messages_summary(data: Any) -> MessagesSummary:
    """Summarise parsed JSON; defects are stored, not raised (see module doc).

    Only ``data.get`` can fail here, as it did in both old code paths.
    """
    member = data.get("member", {})
    msgs = data.get("messages", [])

    member_map: Mapping[str, Any] = MappingProxyType({})
    member_error = None
    if isinstance(member, dict):
        member_map = MappingProxyType(dict(member))
    else:
        member_error = _stored(
            AttributeError(f"'{type(member).__name__}' object has no attribute 'get'")
        )

    last_raw_id: Any = NO_MESSAGES
    last_error = None
    try:
        if msgs:
            last_raw_id = msgs[-1].get("id", 0)
    except Exception as e:
        last_error = _stored(e)

    total: Any = 0
    total_error = None
    try:
        total = data.get("total_messages", len(msgs))
    except Exception as e:
        total_error = _stored(e)

    sorted_ids = id_set = raw_ids = ids_error = None
    try:
        ids = [m.get("id", 0) for m in msgs]
        if _orderable(ids):
            sorted_ids = tuple(sorted(ids))
            id_set = frozenset(ids)
        else:
            raw_ids = tuple(ids)
    except Exception as e:
        ids_error = _stored(e)

    return MessagesSummary(
        member=member_map,
        last_raw_id=last_raw_id,
        total_messages=total,
        sorted_ids=sorted_ids,
        id_set=id_set,
        raw_ids=raw_ids,
        member_error=member_error,
        last_error=last_error,
        total_error=total_error,
        ids_error=ids_error,
    )


_MESSAGES_CACHE = StatCache()


def get_messages_summary(path: Path) -> MessagesSummary:
    """Summary of ``path``; parses only when the file changed since last time.

    Raises the same errors reading the file would (OSError, ValueError, …).
    """
    return _MESSAGES_CACHE.get(path, build_messages_summary)
