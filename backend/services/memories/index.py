"""Per-member memory index: derived once, cached in SQLite (spec 3.3).

Every Memories screen reads :class:`MemberIndex` instead of re-scanning
``messages.json``. The cache key is ``data_hash``: size + mtime of the member's
``messages.json`` plus the values derived from the side inputs (birthday,
subscription start, graduation), so a change in any of them rebuilds the entry.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
import sqlite3
import time
from bisect import bisect_left, bisect_right
from collections import Counter
from dataclasses import dataclass, field, fields
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services.memories import selection as sel
from backend.services.memories.member_profiles import load_birthdays
from backend.services.memories.names import normalize_member_name
from backend.services.memories.subscriptions import load_subscription_starts
from backend.services.platform import get_app_data_dir

logger = structlog.get_logger(__name__)

# Bump when the derivation rules change so stale cache rows are rebuilt.
INDEX_VERSION = "2"
_LEADING_INT = re.compile(r"^\s*(\d+)")
_SYNC_METADATA = "sync_metadata.json"

_db_path: Optional[Path] = None


def set_db_path(path: Path) -> None:
    global _db_path
    _db_path = path


def _path() -> Path:
    return _db_path or (get_app_data_dir() / "memories_index.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_path())
    # busy_timeout first: the journal_mode switch itself can hit a locked DB.
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS member_index ("
        "service_dir TEXT, member_dir TEXT, data_hash TEXT, payload TEXT, "
        "PRIMARY KEY(service_dir, member_dir))"
    )
    return conn


@dataclass
class MemberIndex:
    member_dir: str = ""  # POSIX, relative to the service dir
    member_id: str = ""
    name_norm: str = ""
    hour_hist: list[int] = field(default_factory=lambda: [0] * 24)  # JST, non-promo
    first_ts: dict[str, str] = field(default_factory=dict)  # type -> UTC ISO
    first_nickname_id: int | None = None  # includes promo texts
    counts_by_year: dict[int, dict[str, int]] = field(default_factory=dict)
    longest_streak_days: int = 0
    bursts: list[list[int]] = field(default_factory=list)
    captions: dict[int, int] = field(default_factory=dict)  # photo id -> text id
    importance: dict[int, int] = field(default_factory=dict)  # non-promo texts
    photo_scores: dict[int, int] = field(default_factory=dict)  # non-promo photos
    promo_ids: set[int] = field(default_factory=set)
    nickname_count: int = 0  # includes promo texts (unlike greeting_counts)
    greeting_counts: dict[str, int] = field(default_factory=dict)
    birthday: str | None = None
    subscription_start: str | None = None
    graduated: bool = False
    data_hash: str = ""

    def to_json(self) -> str:
        d = {f.name: getattr(self, f.name) for f in fields(self)}
        d["promo_ids"] = sorted(self.promo_ids)
        return json.dumps(d, ensure_ascii=False)

    @classmethod
    def from_json(cls, payload: str) -> MemberIndex:
        d = json.loads(payload)
        d["counts_by_year"] = {int(y): v for y, v in d["counts_by_year"].items()}
        for key in ("captions", "importance", "photo_scores"):
            d[key] = {int(k): v for k, v in d[key].items()}
        d["promo_ids"] = set(d["promo_ids"])
        return cls(**d)


@dataclass(frozen=True)
class _Inputs:
    """Side inputs shared by all members of one service."""

    birthdays: dict[str, str]
    sub_starts: dict[str, str]
    closed_groups: frozenset[str]


def _load_inputs(service_data_dir: Path) -> _Inputs:
    closed: set[str] = set()
    try:
        meta = json.loads(
            (service_data_dir / _SYNC_METADATA).read_text(encoding="utf-8")
        )
        for gid, entry in (meta.get("server_groups") or {}).items():
            if isinstance(entry, dict) and entry.get("state") == "closed":
                closed.add(str(gid))
    except FileNotFoundError:
        pass
    except (OSError, ValueError, AttributeError, TypeError) as e:
        logger.warning(
            "memory_index_sync_metadata_unreadable", error_type=type(e).__name__
        )
    return _Inputs(
        birthdays=load_birthdays(service_data_dir),
        sub_starts=load_subscription_starts(service_data_dir),
        closed_groups=frozenset(closed),
    )


def _leading_id(name: str) -> str:
    m = _LEADING_INT.match(name)
    return m.group(1) if m else ""


def _rel(service_data_dir: Path, member_dir: Path) -> str:
    try:
        return member_dir.relative_to(service_data_dir).as_posix()
    except ValueError:
        return member_dir.as_posix()


def _identity(service_data_dir: Path, member_dir: Path, inputs: _Inputs) -> MemberIndex:
    """Empty index carrying everything derivable without reading messages."""
    gid = _leading_id(member_dir.parent.name)
    _, _, raw_name = member_dir.name.partition(" ")
    name_norm = normalize_member_name(raw_name)
    return MemberIndex(
        member_dir=_rel(service_data_dir, member_dir),
        member_id=_leading_id(member_dir.name),
        name_norm=name_norm,
        birthday=inputs.birthdays.get(name_norm),
        subscription_start=inputs.sub_starts.get(gid),
        graduated=gid in inputs.closed_groups,
    )


def _data_hash(messages_path: Path, base: MemberIndex) -> str:
    st = messages_path.stat()
    key = "|".join(
        [
            INDEX_VERSION,
            str(st.st_size),
            str(st.st_mtime_ns),
            base.birthday or "",
            base.subscription_start or "",
            "1" if base.graduated else "0",
        ]
    )
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _parse_ts(raw: Any) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _load_msgs(messages_path: Path) -> tuple[list[sel.Msg], int]:
    data = json.loads(messages_path.read_text(encoding="utf-8"))
    out: list[sel.Msg] = []
    skipped = 0
    for m in data["messages"]:
        ts = _parse_ts(m.get("timestamp"))
        try:
            mid = int(m["id"])
        except (KeyError, TypeError, ValueError):
            ts = None
        if ts is None:
            skipped += 1
            continue
        out.append(
            sel.Msg(
                id=mid,
                ts=ts,
                type=str(m.get("type") or ""),
                text=str(m.get("content") or ""),
                favorited=bool(m.get("is_favorite")),
            )
        )
    out.sort(key=lambda m: (m.ts, m.id))
    return out, skipped


def _is_holiday(d: date, birthday: date | None, sub_start: date | None) -> bool:
    """12/24, 12/25, 1/1, her birthday, or the fan's subscription anniversary."""
    if (d.month, d.day) in ((12, 24), (12, 25), (1, 1)):
        return True
    return any(
        x is not None and (x.month, x.day) == (d.month, d.day)
        for x in (birthday, sub_start)
    )


def _parse_date(raw: str | None) -> date | None:
    try:
        return date.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def _longest_streak(days: set[date]) -> int:
    best = run = 0
    prev: date | None = None
    for d in sorted(days):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    return best


def _derive(msgs: list[sel.Msg], idx: MemberIndex) -> None:
    """Single pass over time-sorted messages; fills ``idx`` in place."""
    birthday = _parse_date(idx.birthday)
    sub_start = _parse_date(idx.subscription_start)
    texts = [m for m in msgs if m.type == "text" and m.text.strip()]
    media = [m for m in msgs if m.type in sel.MEDIA_TYPES]
    text_ts = [t.ts for t in texts]

    repeats: Counter[tuple[int, str]] = Counter(
        (sel.jst(t.ts).year, sel.normalize(t.text).strip()) for t in texts
    )
    promo_text = {t.id for t in texts if sel.is_promo(t.text)}
    idx.promo_ids = set(promo_text)

    # Bursts, captions, photo scores.
    bursts = sel.find_bursts(media)
    idx.bursts = [[m.id for m in b] for b in bursts]
    burst_of = {m.id: b for b in bursts for m in b}
    window = sel.CAPTION_WINDOW
    for p in media:
        burst = burst_of.get(p.id)
        lo = (min(m.ts for m in burst) if burst else p.ts) - window
        hi = (max(m.ts for m in burst) if burst else p.ts) + window
        near = texts[bisect_left(text_ts, lo) : bisect_right(text_ts, hi)]
        if sel.photo_is_promo(p, near, burst):
            idx.promo_ids.add(p.id)
            continue
        cap = sel.caption_for(p, near, burst)
        if cap is not None:
            idx.captions[p.id] = cap.id
        day = sel.jst(p.ts).date()
        idx.photo_scores[p.id] = sel.photo_score(
            p,
            cap,
            last_in_burst=burst is not None and burst[-1].id == p.id,
            holiday=_is_holiday(day, birthday, sub_start),
        )

    # Texts: importance, nickname, greetings.
    # Promo scope differs by field: ``nickname_count`` / ``first_nickname_id``
    # INCLUDE promo texts (a nickname is a nickname wherever it appears), while
    # ``greeting_counts`` / ``importance`` / ``hour_hist`` EXCLUDE promo.
    specials: dict[int, set[date]] = {}
    greetings: Counter[str] = Counter()
    for t in texts:
        year = sel.jst(t.ts).year
        if sel.has_nickname(t.text):
            idx.nickname_count += 1
            if idx.first_nickname_id is None:
                idx.first_nickname_id = t.id
        if t.id in promo_text:
            continue
        if year not in specials:
            specials[year] = sel.special_dates(
                year, idx.birthday, idx.subscription_start
            )
        idx.importance[t.id] = sel.importance(
            t,
            special=sel.jst(t.ts).date() in specials[year],
            repeated=repeats[(year, sel.normalize(t.text).strip())] >= 3,
        )
        g = sel.greeting_class(t.text)
        if g:
            greetings[g] += 1
    idx.greeting_counts = dict(greetings)

    # Histogram, firsts, per-year counts, streak.
    days: set[date] = set()
    for m in msgs:
        local = sel.jst(m.ts)
        days.add(local.date())
        if m.id not in idx.promo_ids:
            idx.hour_hist[local.hour] += 1
        idx.first_ts.setdefault(
            m.type, m.ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        )
        by_type = idx.counts_by_year.setdefault(local.year, {})
        by_type[m.type] = by_type.get(m.type, 0) + 1
    idx.longest_streak_days = _longest_streak(days)


def _build(messages_path: Path, base: MemberIndex) -> tuple[MemberIndex, int]:
    msgs, skipped = _load_msgs(messages_path)
    if skipped:
        logger.warning(
            "memory_index_messages_skipped", member_id=base.member_id, count=skipped
        )
    _derive(msgs, base)
    return base, len(msgs)


def _cache_get(service_dir: str, member_dir: str, data_hash: str) -> MemberIndex | None:
    try:
        with contextlib.closing(_connect()) as c:
            row = c.execute(
                "SELECT data_hash, payload FROM member_index "
                "WHERE service_dir=? AND member_dir=?",
                (service_dir, member_dir),
            ).fetchone()
        if row and row[0] == data_hash:
            return MemberIndex.from_json(row[1])
    except (sqlite3.Error, ValueError, KeyError, TypeError) as e:
        logger.warning("memory_index_cache_read_failed", error_type=type(e).__name__)
    return None


def _cache_put(service_dir: str, idx: MemberIndex) -> None:
    try:
        # closing() releases the handle; the inner ``with`` commits.
        with contextlib.closing(_connect()) as c, c:
            c.execute(
                "INSERT OR REPLACE INTO member_index"
                "(service_dir, member_dir, data_hash, payload) VALUES (?,?,?,?)",
                (service_dir, idx.member_dir, idx.data_hash, idx.to_json()),
            )
    except sqlite3.Error as e:
        logger.warning("memory_index_cache_write_failed", error_type=type(e).__name__)


def _get_sync(
    service_data_dir: Path, member_dir: Path, inputs: _Inputs
) -> tuple[MemberIndex, bool]:
    """Return ``(index, built)``; never raises. Blocking: call via a thread."""
    base = MemberIndex()
    try:
        base = _identity(service_data_dir, member_dir, inputs)
        messages_path = member_dir / "messages.json"
        base.data_hash = _data_hash(messages_path, base)
        service_dir = str(service_data_dir)
        cached = _cache_get(service_dir, base.member_dir, base.data_hash)
        if cached is not None:
            logger.info("memory_index_hit", member_id=base.member_id)
            return cached, False
        start = time.perf_counter()
        idx, count = _build(messages_path, base)
        _cache_put(service_dir, idx)
        logger.info(
            "memory_index_built",
            member_id=idx.member_id,
            elapsed_ms=round((time.perf_counter() - start) * 1000),
            msgs=count,
        )
        return idx, True
    except Exception as e:  # noqa: BLE001 - the index must never raise
        logger.warning(
            "memory_index_failed", member_id=base.member_id, error_type=type(e).__name__
        )
        empty = MemberIndex(
            member_dir=base.member_dir,
            member_id=base.member_id,
            name_norm=base.name_norm,
            birthday=base.birthday,
            subscription_start=base.subscription_start,
            graduated=base.graduated,
        )
        return empty, False


async def get_member_index(service_data_dir: Path, member_dir: Path) -> MemberIndex:
    """Cached index for one member; rebuilt off the event loop when stale.

    On any failure an empty index (not cached) is returned and
    ``memory_index_failed`` is logged.
    """

    def run() -> MemberIndex:
        return _get_sync(service_data_dir, member_dir, _load_inputs(service_data_dir))[
            0
        ]

    return await asyncio.to_thread(run)


def _member_dirs(service_data_dir: Path) -> list[Path]:
    root = service_data_dir / "messages"
    out: list[Path] = []
    try:
        for group in sorted(root.iterdir()):
            if not group.is_dir():
                continue
            out.extend(
                m for m in sorted(group.iterdir()) if (m / "messages.json").is_file()
            )
    except OSError as e:
        logger.warning("memory_index_scan_failed", error_type=type(e).__name__)
    return out


async def build_all(service_data_dir: Path) -> int:
    """Rebuild every stale member index; returns how many were rebuilt."""

    def run() -> int:
        inputs = _load_inputs(service_data_dir)
        return sum(
            _get_sync(service_data_dir, d, inputs)[1]
            for d in _member_dirs(service_data_dir)
        )

    built = await asyncio.to_thread(run)
    logger.info("memory_index_build_all", rebuilt=built)
    return built
