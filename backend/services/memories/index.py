"""Per-room memory index: derived once, cached in SQLite (spec 3.2 / 3.3).

Every Memories screen reads the cache instead of re-scanning ``messages.json``.
Two tables live in ``memories_index.db`` (app data dir):

- ``member_index``: one JSON :class:`MemberIndex` per room folder (lifetime
  aggregates, avatar history, last message).
- ``message_facts``: one compact row per message (JST date/hour, flags,
  scores, burst / caption links, media file, duration). Query it through
  :mod:`backend.services.memories.facts`.

Both are written in one transaction and keyed by ``(service_dir,
member_dir)``. The cache key is ``data_hash``: ``INDEX_VERSION`` (which folds
in a lexicon hash), size + mtime of ``messages.json`` and of the
``profile_images`` index, plus the side inputs (birthday, subscription start,
graduation, group-chat flag), so a change in any of them rebuilds the entry.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
from bisect import bisect_left, bisect_right
from collections import Counter
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field, fields
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services.chat_kind import GROUP_CHAT_IDS, is_group_chat
from backend.services.memories import lexicon
from backend.services.memories import selection as sel
from backend.services.memories.member_profiles import load_birthdays
from backend.services.memories.names import normalize_member_name
from backend.services.memories.subscriptions import load_subscription_starts
from backend.services import profile_images_service, shutdown_state
from backend.services.memories.locks import keyed_lock
from backend.services.platform import get_app_data_dir
from backend.services.service_utils import (
    get_service_display_name,
    get_service_identifier,
)

logger = structlog.get_logger(__name__)


def _lexicon_fingerprint() -> str:
    """Short hash of every public constant in ``lexicon``.

    Any pattern or word-list edit changes it, so cached rows derived with the
    old lexicon are rebuilt without anyone remembering to bump the version.
    """
    parts: list[str] = []
    for name in sorted(vars(lexicon)):
        if not name.isupper():
            continue
        value = getattr(lexicon, name)
        if isinstance(value, re.Pattern):
            value = (value.pattern, value.flags)
        elif isinstance(value, dict):
            value = sorted(
                (k, (v.pattern, v.flags) if isinstance(v, re.Pattern) else v)
                for k, v in value.items()
            )
        parts.append(f"{name}={value!r}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()[:12]


# Bump the leading number when the derivation rules change; the lexicon hash
# is folded in automatically. Either change rebuilds every cached row.
INDEX_VERSION = f"6-{_lexicon_fingerprint()}"
_LEADING_INT = re.compile(r"^\s*(\d+)")
_SYNC_METADATA = "sync_metadata.json"

_db_path: Optional[Path] = None


def set_db_path(path: Path) -> None:
    global _db_path
    _db_path = path


def _path() -> Path:
    return _db_path or (get_app_data_dir() / "memories_index.db")


# Column order of ``message_facts`` after the (service_dir, member_dir) key.
FACT_COLUMNS = (
    "id",
    "ts_utc",
    "jst_date",
    "hour",
    "minute",
    "type",
    "is_promo",
    "has_nickname",
    "greeting_mask",
    "chars",
    "importance",
    "photo_score",
    "burst_id",
    "caption_id",
    "favorited",
    "media_file",
    "duration_s",
    "is_welcome",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS member_index (
    service_dir TEXT, member_dir TEXT, data_hash TEXT, payload TEXT,
    PRIMARY KEY(service_dir, member_dir));
CREATE TABLE IF NOT EXISTS message_facts (
    service_dir TEXT NOT NULL, member_dir TEXT NOT NULL, id INTEGER NOT NULL,
    ts_utc TEXT NOT NULL, jst_date TEXT NOT NULL,
    hour INTEGER NOT NULL, minute INTEGER NOT NULL, type TEXT NOT NULL,
    is_promo INTEGER NOT NULL, has_nickname INTEGER NOT NULL,
    greeting_mask INTEGER NOT NULL, chars INTEGER NOT NULL,
    importance INTEGER, photo_score INTEGER, burst_id INTEGER, caption_id INTEGER,
    favorited INTEGER NOT NULL, media_file TEXT, duration_s REAL,
    is_welcome INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(service_dir, member_dir, id)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS message_facts_by_clock
    ON message_facts(service_dir, member_dir, hour, minute);
"""

# Fact queries are scoped by the primary-key prefix (service_dir, member_dir).
# The one secondary index, ``message_facts_by_clock``, serves the 同じ時刻
# time-of-day query (``facts.facts_at_clock``, refreshed every minute), which
# would otherwise scan every row of every room. The rows are unchanged, so it
# needs no INDEX_VERSION bump: SQLite fills it from the existing rows once.
# The older date / type indexes only cost space; older DBs still have them.
_DROPPED_INDEXES = ("message_facts_by_date", "message_facts_by_type")

# Columns added after the first release of ``message_facts``: ``(name, DDL)``.
# A DB created before them gets them through ``ALTER TABLE`` on open; the
# INDEX_VERSION bump that shipped with each one rebuilds every row, so the
# DEFAULT only covers the moment before that rebuild.
_ADDED_COLUMNS = (("is_welcome", "INTEGER NOT NULL DEFAULT 0"),)


# One bulk row read of this DB at a time, process-wide. CPython's sqlite3
# releases the GIL around every row step, so N worker threads reading rows at
# once hand the GIL back and forth on each row and wait out the switch
# interval every time (the "convoy" effect): six concurrent reads of ~3000
# rows took ~25 s instead of ~0.2 s. Serialised, each read keeps the GIL hot.
_ROW_READS = threading.Lock()


@contextlib.contextmanager
def row_reads() -> Iterator[None]:
    """Hold the process-wide row-read lock (see ``_ROW_READS``). Blocking."""
    with _ROW_READS:
        yield


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_path())
    # busy_timeout first: the journal_mode switch itself can hit a locked DB.
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)  # IF NOT EXISTS: cheap, survives a deleted DB
    for name in _DROPPED_INDEXES:
        conn.execute(f"DROP INDEX IF EXISTS {name}")
    have = {row[1] for row in conn.execute("PRAGMA table_info(message_facts)")}
    for name, ddl in _ADDED_COLUMNS:
        if name not in have:
            conn.execute(f"ALTER TABLE message_facts ADD COLUMN {name} {ddl}")
            logger.info("memory_index_column_added", column=name)
    return conn


@dataclass
class MemberIndex:
    """Derived data for ONE ROOM FOLDER (``<gid> <room>/<mid> <name>``).

    It is per room, not per person: a member with two 1:1 rooms (a re-opened
    room under a new id) or with messages in a communal room has one
    MemberIndex per folder. Use :func:`list_members` for the person-level
    view, and skip ``is_group_chat`` entries for member-centric features.
    """

    member_dir: str = ""  # POSIX, relative to the service dir
    member_id: str = ""
    group_id: str = ""
    is_group_chat: bool = False  # communal / multi-sender room
    name_norm: str = ""
    hour_hist: list[int] = field(default_factory=lambda: [0] * 24)  # JST, non-promo
    first_ts: dict[str, str] = field(default_factory=dict)  # type -> UTC ISO
    last_ts: dict[str, str] = field(default_factory=dict)  # type -> UTC ISO
    # {"id", "ts" (UTC ISO), "type"} of her newest message of any type.
    last_message: dict[str, Any] | None = None
    # profile_images history, oldest first: {"kind", "file", "first_seen"}.
    # The oldest entry per kind is when archiving began, not a change.
    avatar_changes: list[dict[str, Any]] = field(default_factory=list)
    first_nickname_id: int | None = None  # includes promo texts, never the welcome
    counts_by_year: dict[int, dict[str, int]] = field(default_factory=dict)
    longest_streak_days: int = 0
    bursts: list[list[int]] = field(default_factory=list)
    # Per-message importance, photo score and caption link live in the
    # ``message_facts`` rows (``importance`` / ``photo_score`` / ``caption_id``).
    promo_ids: set[int] = field(default_factory=set)
    # All words, promo included (unlike greeting_counts); never the welcome.
    nickname_count: int = 0
    # Multi-label (a message counts for every class it contains); non-promo words.
    greeting_counts: dict[str, int] = field(default_factory=dict)
    birthday: str | None = None
    subscription_start: str | None = None
    # 1:1 rooms only: the room's group is closed and no open 1:1 room holds the
    # same name. Always False for group chats (prefer a missed graduation).
    graduated: bool = False
    data_hash: str = ""
    # Runtime only (not stored): the cache write failed, so the fact rows are
    # missing or stale until the next successful build.
    cache_stale: bool = field(default=False, compare=False)

    def to_json(self) -> str:
        d = {f.name: getattr(self, f.name) for f in fields(self)}
        d.pop("cache_stale")
        d["promo_ids"] = sorted(self.promo_ids)
        return json.dumps(d, ensure_ascii=False)

    @classmethod
    def from_json(cls, payload: str) -> MemberIndex:
        d = json.loads(payload)
        d["counts_by_year"] = {int(y): v for y, v in d["counts_by_year"].items()}
        for key in ("captions", "importance", "photo_scores"):
            d.pop(key, None)  # written by index versions before 4
        d["promo_ids"] = set(d["promo_ids"])
        d.pop("cache_stale", None)
        return cls(**d)


@dataclass(frozen=True)
class _Inputs:
    """Side inputs shared by all members of one service."""

    birthdays: dict[str, str]
    sub_starts: dict[str, str]
    closed_groups: frozenset[str]
    service_id: str = ""
    room_sizes: dict[str, int] = field(default_factory=dict)  # gid -> members
    open_solo_names: frozenset[str] = frozenset()  # name_norm in open 1:1 rooms
    rooms: _Rooms = ()
    scan_ok: bool = True


_Rooms = tuple[tuple[Path, tuple[Path, ...]], ...]

# Single-member reads reuse a recent room scan: listing every room folder
# costs a stat per folder (hundreds of ms on a slow or network drive) and
# rooms appear rarely. ``build_all`` always scans fresh (it prunes on it).
_ROOMS_TTL_SECONDS = 30.0
_rooms_cache: dict[str, tuple[float, _Rooms]] = {}


def _scan_rooms(service_data_dir: Path, *, fresh: bool = True) -> tuple[_Rooms, bool]:
    """``((group_dir, member_dirs), ...)`` with ``messages.json``; ``ok`` flag.

    ``ok`` is False when the listing failed or ``messages/`` is missing; the
    caller must then not treat absent rooms as deleted. With ``fresh=False``
    a successful scan younger than ``_ROOMS_TTL_SECONDS`` is reused.
    """
    key = str(service_data_dir)
    if not fresh:
        hit = _rooms_cache.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return hit[1], True
    root = service_data_dir / "messages"
    out: list[tuple[Path, tuple[Path, ...]]] = []
    try:
        with os.scandir(root) as groups:
            group_entries = sorted(
                (g for g in groups if g.is_dir()), key=lambda g: g.name
            )
        for g in group_entries:
            with os.scandir(g.path) as entries:
                names = sorted(e.name for e in entries if e.is_dir())
            group = root / g.name
            members = tuple(
                group / n for n in names if (group / n / "messages.json").is_file()
            )
            if members:
                out.append((group, members))
    except FileNotFoundError:
        # Not "ok": never prune the cache because the folder is missing (e.g.
        # an unplugged output drive).
        logger.info("memory_index_no_messages_dir")
        return (), False
    except OSError as e:
        logger.warning("memory_index_scan_failed", error_type=type(e).__name__)
        return tuple(out), False
    rooms = tuple(out)
    _rooms_cache[key] = (time.monotonic() + _ROOMS_TTL_SECONDS, rooms)
    return rooms, True


def _load_inputs(service_data_dir: Path, *, fresh_scan: bool = True) -> _Inputs:
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
    service_id = get_service_identifier(service_data_dir.name) or ""
    rooms, scan_ok = _scan_rooms(service_data_dir, fresh=fresh_scan)
    sizes: dict[str, int] = {}
    for group, members in rooms:
        sizes[_leading_id(group.name)] = sum(
            not _is_official(service_id, m) for m in members
        )
    open_solo: set[str] = set()
    for group, members in rooms:
        gid = _leading_id(group.name)
        if gid in closed:
            continue
        open_solo.update(
            _name_norm(m) for m in members if not _group_chat(service_id, m, sizes)
        )
    return _Inputs(
        birthdays=load_birthdays(service_data_dir),
        sub_starts=load_subscription_starts(service_data_dir),
        closed_groups=frozenset(closed),
        service_id=service_id,
        room_sizes=sizes,
        open_solo_names=frozenset(open_solo),
        rooms=rooms,
        scan_ok=scan_ok,
    )


def _is_official(service_id: str, member_dir: Path) -> bool:
    """An official-account folder (e.g. ``33 櫻坂46``) inside a member's room.

    pysaka's extra-author recovery writes it next to the member's own folder.
    It is not a member, so it must not count toward the room's size.
    """
    if _leading_id(member_dir.name) in GROUP_CHAT_IDS.get(service_id, set()):
        return True
    if not service_id:
        return False
    try:
        display = normalize_member_name(get_service_display_name(service_id))
    except ValueError:
        return False
    return _name_norm(member_dir) == display


def _group_chat(service_id: str, member_dir: Path, sizes: dict[str, int]) -> bool:
    """Is this folder part of a group chat (rather than a 1:1 room)?

    Official-account folders always count as group chats (never listed as
    members). In a non-communal room, a folder named like the room itself is
    its owner's 1:1 chat, whatever other senders were recovered next to it.
    """
    gid = _leading_id(member_dir.parent.name)
    if _is_official(service_id, member_dir) or gid in GROUP_CHAT_IDS.get(
        service_id, set()
    ):
        return True
    room_raw = member_dir.parent.name.partition(" ")[2]
    if _name_norm(member_dir) == normalize_member_name(room_raw):
        return False
    return is_group_chat(service_id, gid, sizes.get(gid, 1))


def _name_norm(member_dir: Path) -> str:
    _, _, raw_name = member_dir.name.partition(" ")
    return normalize_member_name(raw_name)


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
    name_norm = _name_norm(member_dir)
    group_chat = _group_chat(inputs.service_id, member_dir, inputs.room_sizes)
    graduated = (
        not group_chat
        and gid in inputs.closed_groups
        and name_norm not in inputs.open_solo_names
    )
    return MemberIndex(
        member_dir=_rel(service_data_dir, member_dir),
        member_id=_leading_id(member_dir.name),
        group_id=gid,
        is_group_chat=group_chat,
        name_norm=name_norm,
        birthday=inputs.birthdays.get(name_norm),
        subscription_start=inputs.sub_starts.get(gid),
        graduated=graduated,
    )


def _stat_part(path: Path) -> str:
    try:
        st = path.stat()
    except OSError:
        return "-"
    return f"{st.st_size}:{st.st_mtime_ns}"


def _data_hash(messages_path: Path, base: MemberIndex) -> str:
    st = messages_path.stat()
    key = "|".join(
        [
            INDEX_VERSION,
            str(st.st_size),
            str(st.st_mtime_ns),
            _stat_part(
                messages_path.parent
                / profile_images_service.DIR_NAME
                / profile_images_service.INDEX_NAME
            ),
            base.birthday or "",
            base.subscription_start or "",
            "1" if base.graduated else "0",
            "1" if base.is_group_chat else "0",
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


_Extras = dict[int, tuple[str | None, float | None]]  # id -> (media_file, seconds)


def _duration(raw: Any) -> float | None:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return float(raw) if raw >= 0 else None


def _load_msgs(messages_path: Path) -> tuple[list[sel.Msg], int, _Extras]:
    data = json.loads(messages_path.read_text(encoding="utf-8"))
    out: list[sel.Msg] = []
    extras: _Extras = {}
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
        media_file = m.get("media_file")
        duration = _duration(m.get("media_duration"))
        if isinstance(media_file, str) or duration is not None:
            extras[mid] = (
                media_file if isinstance(media_file, str) else None,
                duration,
            )
    out.sort(key=lambda m: (m.ts, m.id))
    return out, skipped, extras


def _is_holiday(d: date, birthday: date | None, sub_start: date | None) -> bool:
    """12/24, 12/25, 1/1, her birthday, or the fan's subscription anniversary.

    A fixed list on purpose: the backend has no Japanese public-holiday data
    (only the frontend calendar bundles ``@holiday-jp/holiday_jp``), and the
    photo-score bonus is about personal special days rather than public ones.
    """
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


def _utc_iso(ts: datetime) -> str:
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _derive(
    msgs: list[sel.Msg], idx: MemberIndex, extras: _Extras | None = None
) -> list[tuple[Any, ...]]:
    """Single pass over time-sorted messages; fills ``idx`` in place.

    Returns one ``message_facts`` row per message (``FACT_COLUMNS`` order).

    "Words" are every message with its own non-empty text: texts, and
    photo/video/voice messages that carry a caption. A media message's own
    text is its caption first (and decides whether it is promo); only media
    without text fall back to the nearest text within +-3 min.

    The subscription welcome (``selection.welcome_ids``) is flagged
    ``is_welcome``. It is never "her words": no importance, no nickname or
    greeting count, never a photo's caption. Counts (per year, per type, the hour histogram)
    still include it: it is a message she sent.
    """
    birthday = _parse_date(idx.birthday)
    sub_start = _parse_date(idx.subscription_start)
    welcome = sel.welcome_ids(msgs, sub_start)
    if welcome:
        logger.info("memory_index_welcome", member_id=idx.member_id, count=len(welcome))
    words = [m for m in msgs if m.text.strip()]
    # pairing candidates (a welcome is never a photo's caption)
    texts = [m for m in words if m.type == "text" and m.id not in welcome]
    media = [m for m in msgs if m.type in sel.MEDIA_TYPES]
    text_ts = [t.ts for t in texts]

    captions: dict[int, int] = {}  # media id -> caption id (own id, or paired text)
    importance: dict[int, int] = {}  # non-promo words only
    photo_scores: dict[int, int] = {}  # non-promo photos / videos

    promo_words = {w.id for w in words if sel.is_promo(w.text)}
    idx.promo_ids = set(promo_words)

    # Bursts, captions, photo scores.
    bursts = sel.find_bursts(media)
    idx.bursts = [[m.id for m in b] for b in bursts]
    burst_of = {m.id: b for b in bursts for m in b}
    burst_id = {m.id: b[0].id for b in bursts for m in b}
    window = sel.CAPTION_WINDOW
    for p in media:
        burst = burst_of.get(p.id)
        cap: sel.Msg | None
        if p.text.strip():
            if p.id in promo_words:
                continue  # a promo caption makes a promo photo
            cap = p
        else:
            lo = (min(m.ts for m in burst) if burst else p.ts) - window
            hi = (max(m.ts for m in burst) if burst else p.ts) + window
            near = texts[bisect_left(text_ts, lo) : bisect_right(text_ts, hi)]
            if sel.photo_is_promo(p, near, burst):
                idx.promo_ids.add(p.id)
                continue
            cap = sel.caption_for(p, near, burst)
        if cap is not None:
            captions[p.id] = cap.id
        day = sel.jst(p.ts).date()
        photo_scores[p.id] = sel.photo_score(
            p,
            cap,
            last_in_burst=burst is not None and burst[-1].id == p.id,
            holiday=_is_holiday(day, birthday, sub_start),
        )

    # Words: importance, nickname, greetings.
    # Promo scope differs by field: ``nickname_count`` / ``first_nickname_id``
    # INCLUDE promo words (a nickname is a nickname wherever it appears), while
    # ``greeting_counts`` / ``importance`` / ``hour_hist`` EXCLUDE promo.
    sentences = {w.id: sel.split_sentences(w.text) for w in words}
    by_year: dict[int, list[str]] = {}
    for w in words:
        if w.id not in promo_words and w.id not in welcome:
            by_year.setdefault(sel.jst(w.ts).year, []).append(w.text)
    repeats = {y: sel.sentence_counts(ts) for y, ts in by_year.items()}
    specials: dict[int, set[date]] = {}
    greetings: Counter[str] = Counter()
    nick_ids: set[int] = set()
    masks: dict[int, int] = {}
    for w in words:
        local = sel.jst(w.ts)
        masks[w.id] = sel.greeting_mask(w.text)
        if sel.has_nickname(w.text):
            nick_ids.add(w.id)  # the raw flag, kept for the welcome too
            if w.id not in welcome:
                idx.nickname_count += 1
                if idx.first_nickname_id is None:
                    idx.first_nickname_id = w.id
        if w.id in promo_words or w.id in welcome:
            continue
        if local.year not in specials:
            specials[local.year] = sel.special_dates(
                local.year, idx.birthday, idx.subscription_start
            )
        importance[w.id] = sel.importance(
            w,
            special=local.date() in specials[local.year],
            repeated=sel.is_repeated(sentences[w.id], repeats[local.year]),
        )
        greetings.update(sel.classes_from_mask(masks[w.id]))
    idx.greeting_counts = dict(greetings)

    # Histogram, firsts / lasts, per-year counts, streak, fact rows.
    extras = extras or {}
    days: set[date] = set()
    rows: list[tuple[Any, ...]] = []
    for m in msgs:
        local = sel.jst(m.ts)
        iso = _utc_iso(m.ts)
        days.add(local.date())
        promo = m.id in idx.promo_ids
        if not promo:
            idx.hour_hist[local.hour] += 1
        idx.first_ts.setdefault(m.type, iso)
        idx.last_ts[m.type] = iso
        by_type = idx.counts_by_year.setdefault(local.year, {})
        by_type[m.type] = by_type.get(m.type, 0) + 1
        media_file, duration = extras.get(m.id, (None, None))
        rows.append(
            (
                m.id,
                iso,
                local.date().isoformat(),
                local.hour,
                local.minute,
                m.type,
                int(promo),
                int(m.id in nick_ids),
                masks.get(m.id, 0),
                len(m.text),
                importance.get(m.id),
                photo_scores.get(m.id),
                burst_id.get(m.id),
                captions.get(m.id),
                int(m.favorited),
                media_file,
                duration,
                int(m.id in welcome),
            )
        )
    if msgs:
        last = msgs[-1]
        idx.last_message = {"id": last.id, "ts": _utc_iso(last.ts), "type": last.type}
    idx.longest_streak_days = _longest_streak(days)
    return rows


def _build(
    messages_path: Path, base: MemberIndex
) -> tuple[MemberIndex, list[tuple[Any, ...]]]:
    msgs, skipped, extras = _load_msgs(messages_path)
    if skipped:
        logger.warning(
            "memory_index_messages_skipped", member_id=base.member_id, count=skipped
        )
    rows = _derive(msgs, base, extras)
    base.avatar_changes = profile_images_service.history(messages_path.parent)
    return base, rows


def _cache_get(
    service_dir: str, member_dir: str, data_hash: str | None
) -> MemberIndex | None:
    """The cached index when its hash equals ``data_hash``.

    ``data_hash=None`` returns whatever row is stored (any hash): the stale
    read used while a sync is writing the service (see :func:`sync_writing`).
    """
    try:
        with contextlib.closing(_connect()) as c:
            row = c.execute(
                "SELECT data_hash, payload FROM member_index "
                "WHERE service_dir=? AND member_dir=?",
                (service_dir, member_dir),
            ).fetchone()
        if row and (data_hash is None or row[0] == data_hash):
            return MemberIndex.from_json(row[1])
    except (sqlite3.Error, ValueError, KeyError, TypeError) as e:
        logger.warning("memory_index_cache_read_failed", error_type=type(e).__name__)
    return None


# Service dirs a sync is writing right now (a count per dir, so overlapping
# writers nest). A sync rewrites ``messages.json`` several times per room (new
# messages, then the deferred-media finalize), and each write changes the
# data hash. Rebuilding on every on-demand read in that window built the same
# room up to 4 times a minute; instead reads serve the stored row and the
# ``build_all`` scheduled after the sync rebuilds each changed room once.
_sync_writers: Counter[str] = Counter()


@contextlib.contextmanager
def sync_writing(service_data_dir: Path) -> Iterator[None]:
    """Mark ``service_data_dir`` as being written by a sync for the block."""
    key = str(service_data_dir)
    _sync_writers[key] += 1
    try:
        yield
    finally:
        _sync_writers[key] -= 1
        if _sync_writers[key] <= 0:
            del _sync_writers[key]


def is_sync_writing(service_data_dir: Path) -> bool:
    return _sync_writers.get(str(service_data_dir), 0) > 0


# Service dirs whose post-sync Memories refresh (member profiles, then
# ``build_all``) is scheduled or running. Birthdays and the rebuilt index land
# only when it ends, so views built before then may lack them.
_refreshers: Counter[str] = Counter()


def begin_refresh(service_data_dir: Path) -> None:
    """Mark the post-sync refresh of ``service_data_dir`` as pending."""
    _refreshers[str(service_data_dir)] += 1


def end_refresh(service_data_dir: Path) -> None:
    """Undo one :func:`begin_refresh` (extra calls are ignored)."""
    key = str(service_data_dir)
    _refreshers[key] -= 1
    if _refreshers[key] <= 0:
        del _refreshers[key]


def refresh_pending(service_data_dir: Path) -> bool:
    """True while a sync writes the service or its Memories refresh is pending."""
    return (
        is_sync_writing(service_data_dir)
        or _refreshers.get(str(service_data_dir), 0) > 0
    )


def any_refresh_pending() -> bool:
    """True while a sync writes any service or any Memories refresh is pending.

    Reads two in-memory counters only (no IO), so the thumbnail
    pre-generation worker can poll it on the event loop.
    """
    return bool(_sync_writers) or bool(_refreshers)


@dataclass(frozen=True)
class MediaRow:
    """One picture or video fact with a media file (for thumbnail pre-generation).

    ``member_dir`` and ``media_file`` are as stored (service-relative;
    ``media_file`` as written by pysaka, so it may use ``\\``); ``ts_utc``
    is the UTC ISO time.
    """

    member_dir: str
    media_file: str
    type: str
    ts_utc: str
    favorited: bool


def media_rows(service_data_dir: Path) -> list[MediaRow]:
    """Every picture / video fact with a media file of the service, starred first, then newest.

    Ordered ``favorited DESC, ts_utc DESC``. Blocking and read-only (call it
    from a worker thread); takes the row-read lock (:func:`row_reads`). A
    database error is logged (``memory_index_media_rows_failed``,
    ``error_type``) and gives ``[]``.
    """
    try:
        with row_reads(), contextlib.closing(_connect()) as c:
            rows = c.execute(
                "SELECT member_dir, media_file, type, ts_utc, favorited "
                "FROM message_facts WHERE service_dir=? "
                "AND type IN ('picture','video') AND media_file IS NOT NULL "
                "ORDER BY favorited DESC, ts_utc DESC",
                (str(service_data_dir),),
            ).fetchall()
    except sqlite3.Error as e:
        logger.warning("memory_index_media_rows_failed", error_type=type(e).__name__)
        return []
    return [MediaRow(r[0], r[1], r[2], r[3], bool(r[4])) for r in rows]


_INSERT_FACTS = (
    f"INSERT INTO message_facts(service_dir, member_dir, {', '.join(FACT_COLUMNS)}) "
    f"VALUES ({', '.join('?' * (len(FACT_COLUMNS) + 2))})"
)


def _cache_put(service_dir: str, idx: MemberIndex, rows: list[tuple[Any, ...]]) -> bool:
    """Replace the room's index row and fact rows in one transaction.

    Returns False when the write failed (logged); the caller then holds the
    only copy of the freshly derived data.
    """
    key = (service_dir, idx.member_dir)
    try:
        # closing() releases the handle; the inner ``with`` commits.
        with contextlib.closing(_connect()) as c, c:
            c.execute(
                "DELETE FROM message_facts WHERE service_dir=? AND member_dir=?", key
            )
            c.executemany(_INSERT_FACTS, (key + r for r in rows))
            c.execute(
                "INSERT OR REPLACE INTO member_index"
                "(service_dir, member_dir, data_hash, payload) VALUES (?,?,?,?)",
                (service_dir, idx.member_dir, idx.data_hash, idx.to_json()),
            )
    except sqlite3.Error as e:
        logger.warning("memory_index_cache_write_failed", error_type=type(e).__name__)
        return False
    return True


def _get_sync(
    service_data_dir: Path,
    member_dir: Path,
    inputs: _Inputs,
    *,
    allow_stale: bool = False,
) -> tuple[MemberIndex, bool]:
    """Return ``(index, built)``; never raises. Blocking: call via a thread.

    With ``allow_stale`` (on-demand reads) a stored row whose hash no longer
    matches is still returned while a sync is writing the service
    (``memory_index_stale_served``); a room with no row at all is built.
    """
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
        if allow_stale and is_sync_writing(service_data_dir):
            stale = _cache_get(service_dir, base.member_dir, None)
            if stale is not None:
                logger.info(
                    "memory_index_stale_served",
                    member_id=base.member_id,
                    reason="sync_writing",
                )
                return stale, False
        start = time.perf_counter()
        idx, rows = _build(messages_path, base)
        idx.cache_stale = not _cache_put(service_dir, idx, rows)
        logger.info(
            "memory_index_built",
            member_id=idx.member_id,
            elapsed_ms=round((time.perf_counter() - start) * 1000),
            msgs=len(rows),
        )
        return idx, True
    except Exception as e:  # noqa: BLE001 - the index must never raise
        logger.warning(
            "memory_index_failed", member_id=base.member_id, error_type=type(e).__name__
        )
        empty = MemberIndex(
            member_dir=base.member_dir,
            member_id=base.member_id,
            group_id=base.group_id,
            is_group_chat=base.is_group_chat,
            name_norm=base.name_norm,
            birthday=base.birthday,
            subscription_start=base.subscription_start,
            graduated=base.graduated,
        )
        return empty, False


async def get_member_index(service_data_dir: Path, member_dir: Path) -> MemberIndex:
    """Cached index for one member; rebuilt off the event loop when stale.

    Single-flight per ``(service_dir, member_dir)``: concurrent callers wait
    for one build and then read its cache row. While a sync is writing the
    service, a stored (possibly stale) row is served instead of rebuilding
    (see :func:`sync_writing`). On any failure an empty index
    (not cached) is returned and ``memory_index_failed`` is logged.
    """
    async with keyed_lock(("memory_index", str(service_data_dir), str(member_dir))):

        def run() -> MemberIndex:
            return _get_sync(
                service_data_dir,
                member_dir,
                _load_inputs(service_data_dir, fresh_scan=False),
                allow_stale=True,
            )[0]

        return await asyncio.to_thread(run)


def _fresh_hashes_sync(
    service_data_dir: Path, member_dirs: Sequence[Path]
) -> list[str | None]:
    """Per room, its ``data_hash`` when the stored row is current, else ``None``. Blocking.

    One side-input load, one stat per room (the same :func:`_data_hash` as
    :func:`_get_sync`) and one ``SELECT`` of the stored hashes; no index
    payload is read or parsed. A room whose stored hash differs (new data, or
    never built) or whose ``messages.json`` cannot be stat'ed gives ``None``.
    A database error or a failed side-input load logs
    ``memory_index_hashes_failed`` (``scope=db|inputs``) and gives ``None``
    for every room; an unexpected error for one room logs ``scope=room`` and
    gives ``None`` for it. The caller then falls back to
    :func:`get_member_index`, which never raises (as ``_get_sync`` did).
    """
    if not member_dirs:
        return []
    service_dir = str(service_data_dir)
    try:
        with contextlib.closing(_connect()) as c:
            stored: dict[str, str] = dict(
                c.execute(
                    "SELECT member_dir, data_hash FROM member_index "
                    "WHERE service_dir=?",
                    (service_dir,),
                ).fetchall()
            )
    except sqlite3.Error as e:
        logger.warning(
            "memory_index_hashes_failed", error_type=type(e).__name__, scope="db"
        )
        return [None] * len(member_dirs)
    try:
        inputs = _load_inputs(service_data_dir, fresh_scan=False)
    except Exception as e:  # noqa: BLE001 - fall back per room, never fail the request
        logger.warning(
            "memory_index_hashes_failed", error_type=type(e).__name__, scope="inputs"
        )
        return [None] * len(member_dirs)
    out: list[str | None] = []
    for d in member_dirs:
        try:
            base = _identity(service_data_dir, d, inputs)
            current = _data_hash(d / "messages.json", base)
        except OSError:
            out.append(None)
            continue
        except Exception as e:  # noqa: BLE001 - this room falls back to get_member_index
            logger.warning(
                "memory_index_hashes_failed", error_type=type(e).__name__, scope="room"
            )
            out.append(None)
            continue
        out.append(current if stored.get(base.member_dir) == current else None)
    return out


async def data_hashes(service_data_dir: Path, member_dirs: Sequence[Path]) -> list[str]:
    """The ``data_hash`` of each room, as ``get_member_index(...).data_hash`` gives it.

    The cheap freshness check for view-cache keys (D-M3): one worker hop
    checks every room at once (:func:`_fresh_hashes_sync`). Only the rooms
    that are not current go through :func:`get_member_index`, which builds
    them (new data after a sync) or serves the stored row while a sync is
    writing, exactly as before. Logs one ``memory_index_hashes`` (``rooms``,
    ``fresh``, ``fallback``) instead of a ``memory_index_hit`` per room.
    """
    fresh = await asyncio.to_thread(_fresh_hashes_sync, service_data_dir, member_dirs)
    out: list[str] = []
    fallback = 0
    for d, current in zip(member_dirs, fresh):
        if current is None:
            fallback += 1
            current = (await get_member_index(service_data_dir, d)).data_hash
        out.append(current)
    logger.info(
        "memory_index_hashes",
        rooms=len(out),
        fresh=len(out) - fallback,
        fallback=fallback,
    )
    return out


@dataclass(frozen=True)
class MemberSummary:
    """One person across her 1:1 rooms (communal rooms are excluded)."""

    name_norm: str
    name: str  # folder name of her newest room, as written by pysaka
    member_dirs: tuple[str, ...]  # POSIX, relative; oldest room (lowest gid) first
    member_ids: tuple[str, ...]
    group_ids: tuple[str, ...]
    subscription_start: str | None  # earliest across her rooms
    birthday: str | None
    graduated: bool  # every one of her rooms is graduated


def _list_members_sync(service_data_dir: Path) -> list[MemberSummary]:
    inputs = _load_inputs(service_data_dir)
    by_name: dict[str, list[tuple[MemberIndex, str]]] = {}
    for _, members in inputs.rooms:
        for m in members:
            ident = _identity(service_data_dir, m, inputs)
            if ident.is_group_chat:
                continue
            raw = m.name.partition(" ")[2]
            by_name.setdefault(ident.name_norm, []).append((ident, raw))
    out: list[MemberSummary] = []
    for name_norm, rooms in by_name.items():
        rooms.sort(key=lambda r: (int(r[0].group_id or 0), r[0].member_dir))
        starts = [r.subscription_start for r, _ in rooms if r.subscription_start]
        out.append(
            MemberSummary(
                name_norm=name_norm,
                name=rooms[-1][1],
                member_dirs=tuple(r.member_dir for r, _ in rooms),
                member_ids=tuple(r.member_id for r, _ in rooms),
                group_ids=tuple(r.group_id for r, _ in rooms),
                subscription_start=min(starts) if starts else None,
                birthday=rooms[0][0].birthday,
                graduated=all(r.graduated for r, _ in rooms),
            )
        )
    out.sort(key=lambda s: (int(s.group_ids[0] or 0), s.name_norm))
    merged = sum(1 for s in out if len(s.member_dirs) > 1)
    logger.info("memory_members_listed", members=len(out), merged=merged)
    return out


async def list_members(service_data_dir: Path) -> list[MemberSummary]:
    """Person-level view keyed by ``name_norm`` over 1:1 rooms only.

    Rooms of the same person are merged, with the earliest subscription start
    across them. Reads folder names and side inputs only, never messages.
    """
    return await asyncio.to_thread(_list_members_sync, service_data_dir)


def _prune(service_dir: str, present: set[str]) -> int:
    """Delete cache rows of rooms no longer on disk; returns rooms removed."""
    try:
        with contextlib.closing(_connect()) as c, c:
            stored = {
                r[0]
                for r in c.execute(
                    "SELECT member_dir FROM member_index WHERE service_dir=?",
                    (service_dir,),
                )
            }
            gone = sorted(stored - present)
            for member_dir in gone:
                for table in ("member_index", "message_facts"):
                    c.execute(
                        f"DELETE FROM {table} WHERE service_dir=? AND member_dir=?",
                        (service_dir, member_dir),
                    )
    except sqlite3.Error as e:
        logger.warning("memory_index_prune_failed", error_type=type(e).__name__)
        return 0
    return len(gone)


async def build_all(service_data_dir: Path) -> int:
    """Rebuild every stale member index; returns how many were rebuilt.

    Members are built one by one (each under its single-flight lock), and the
    loop stops early once app shutdown begins. After a complete pass, cache
    rows of rooms no longer on disk are pruned.
    """
    inputs = await asyncio.to_thread(_load_inputs, service_data_dir)
    dirs = [m for _, members in inputs.rooms for m in members]
    stop = shutdown_state.shutdown_event()
    built = 0
    service_dir = str(service_data_dir)
    for d in dirs:
        # A cancelled build_all may still finish writing the room that is in
        # flight (the thread cannot be interrupted) after the shutdown barrier.
        if stop.is_set():
            logger.info(
                "memory_index_build_all_stopped",
                reason="shutdown",
                rebuilt=built,
                remaining=len(dirs) - dirs.index(d),
            )
            return built
        async with keyed_lock(("memory_index", service_dir, str(d))):
            _, was_built = await asyncio.to_thread(
                _get_sync, service_data_dir, d, inputs
            )
        built += was_built

    pruned = 0
    if inputs.scan_ok:
        present = {_rel(service_data_dir, d) for d in dirs}
        pruned = await asyncio.to_thread(_prune, service_dir, present)
    else:
        logger.info("memory_index_prune_skipped", reason="scan_failed")
    solo = {
        _name_norm(d)
        for d in dirs
        if not _group_chat(inputs.service_id, d, inputs.room_sizes)
    }
    logger.info(
        "memory_index_birthdays",
        matched=len(solo & set(inputs.birthdays)),
        members=len(solo),
    )
    logger.info("memory_index_build_all", rebuilt=built, pruned=pruned)
    return built
