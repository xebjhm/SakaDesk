# Sub-project A: Member Images, Avatar History & Read-Path Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three member images (list icon / chat icon / call screen) and their archived history viewable, show Japanese group names on the service rail, stop the sidebar from re-parsing the archive every 2 s, and adopt pysaka 0.4.5 (locked favorites write, pre-subscription backfill).

**Architecture:** A stat-keyed cache (`backend/services/messages_cache.py`) holds immutable per-file summaries; `/groups`, `/unread_counts` and the favorites lookup read summaries, so a file is parsed only after it changes. Chat loads parse off the event loop and answer `304` via ETag. Profile images are read from pysaka's `profile_images/index.json` by `backend/services/profile_images_service.py` and exposed through one new endpoint plus `*_local` fields. The frontend adds a tabbed viewer wrapper around the existing `MediaViewerModal`, pill entry points in the profile card, and a member-list context menu.

**Tech Stack:** FastAPI, Python 3.12 (`uv`), pytest (`asyncio_mode = "strict"`), React 18 + TypeScript, Vite, vitest + Testing Library + MSW, Tailwind, lucide-react, i18next.

**Spec:** `docs/superpowers/specs/2026-11-03-avatar-viewer-and-perf-design.md` · depends on `../pysaka` branch `feat/archive-integrity-v045` (plan `../pysaka/docs/superpowers/plans/2026-11-03-archive-integrity-v045.md`).

## Global Constraints

- Backend: `uv run pytest backend/tests/...`, `uv run ruff check .`, `uv run ruff format .`, `uv run mypy backend`. Never `pip`.
- Frontend (from `frontend/`): `npx vitest run <file>`, `npx tsc --noEmit`, `npm run lint` if defined.
- Commit with `uv run git commit` (pre-commit lives on the uv PATH). Subject: Conventional Commits, ≤ 72 chars, imperative, no period; body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Format rules: `docs/DOC_FORMATS.md`.
- All file I/O: `pathlib.Path`, `encoding="utf-8"`. No `print()`, no `time.sleep()`; blocking FS work in async handlers goes through `asyncio.to_thread`.
- No hardcoded user-facing strings: every new UI string is an i18n key present in all five locale files (`en`, `ja`, `zh-TW`, `zh-CN`, `yue`).
- Existing response fields of `/groups`, `/unread_counts`, `messages_by_path`, `group_messages` stay byte-identical (golden test, Task 1); only the additive `*_local` fields of Task 8 change them.
- Kind ↔ data ↔ i18n mapping (spec §2): list icon = `group_thumbnail` = `profileImages.thumbnailGroup`; chat icon = `thumbnail` = `profileImages.thumbnail`; call screen = `phone_image` = `profileImages.phoneImage`.
- pysaka during development comes from the editable `../pysaka` source (`[tool.uv.sources]`), which must be on branch `feat/archive-integrity-v045` with pysaka Tasks 1–4 merged locally. Do not edit the `pysaka==0.4.4` pin until pysaka 0.4.5 is published (Task 13).
- Branch: `feat/avatar-viewer-and-perf` (already created from `origin/dev`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/tests/read_path_fixture.py` (create) | Builds a deterministic archive tree (CJK/emoji names, favorites, canceled message, group chat, corrupt file) |
| `backend/tests/test_read_path_golden.py` + `backend/tests/golden/read_path.json` (create) | Byte-identity guard for the four read endpoints |
| `backend/services/messages_cache.py` (create) | `StatCache`, `stat_key`, `MessagesSummary`, `get_messages_summary` |
| `backend/services/profile_images_service.py` (create) | Read `index.json`, local media URLs, API payload |
| `backend/api/content.py` (modify) | Use summaries; off-loop chat loads; ETag; `*_local` fields; `GET /profile_images` |
| `backend/api/favorites.py` (modify) | Locate file via summaries; write via `SyncManager.update_message_fields_sync` |
| `backend/services/sync_service.py` (modify) | Call `backfill_past_messages` after each `sync_member` |
| `scripts/bench_read_path.py` (create) | Before/after timing on a copy of a real archive |
| `frontend/src/hooks/useVisiblePolling.ts` (+ test) (create) | Interval that pauses while the window is hidden |
| `frontend/src/features/messages/profileImages.ts` (+ test) (create) | Kinds, `memberImageUrl`, fetch, period labels |
| `frontend/src/features/messages/components/ProfileImageViewer.tsx` (+ test) (create) | Tabbed history viewer around `MediaViewerModal` |
| `frontend/src/features/messages/components/ProfileImagePills.tsx` (create) | The three pills in the profile card |
| `frontend/src/features/messages/components/MemberContextMenu.tsx` (create) | Right-click menu on member-list rows |
| `frontend/src/core/media/PhotoDetailModal.tsx` (modify) | Plain-text `sourceLabel`; `headerSlot` prop |
| `frontend/src/features/messages/components/MemberProfilePopup.tsx`, `MemberList.tsx`, `MessagesFeature.tsx`, `frontend/src/core/layout/ServiceRail.tsx`, `frontend/src/types/index.ts` (modify) | Wiring |
| `frontend/src/i18n/locales/*.json` (modify) | `profileImages.*` keys |

---

### Task 1: Golden baseline for the read endpoints (no production change)

**Files:**
- Create: `backend/tests/read_path_fixture.py`, `backend/tests/test_read_path_golden.py`, `backend/tests/golden/read_path.json` (generated)

**Interfaces:**
- Produces: `build_archive(root: Path) -> Path` and `GOLDEN_CASES` used by later tasks' tests.

- [ ] **Step 1: Write the fixture builder**

`backend/tests/read_path_fixture.py`:

```python
"""Deterministic archive tree shared by the read-path golden and cache tests."""

import json
from pathlib import Path
from typing import Any

HINATA_SINGLE = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
HINATA_GROUP = "日向坂46/messages/43 日向坂46"
SAKURA_SINGLE = "櫻坂46/messages/79 中川 智尋/134 中川 智尋"


def _write(member_dir: Path, member: dict[str, Any], messages: list[dict[str, Any]]) -> None:
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
    return {"id": i, "timestamp": ts, "type": "text", "content": f"メッセージ {i} 🎉", "is_favorite": False, **kw}


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
            _msg(104, "2026-01-01T13:00:00Z", type="voice", media_file="messages/34 金村 美玖/58 金村 美玖/voice/104.m4a"),
        ],
    )
    _write(root / HINATA_GROUP / "1 メンバーA", {"id": 1, "name": "メンバーA"}, [_msg(201, "2026-01-02T10:00:00Z")])
    _write(
        root / HINATA_GROUP / "2 メンバーB 🎉",
        {"id": 2, "name": "メンバーB 🎉", "group_thumbnail": "https://cdn/groups/thumbnails/43.jpg"},
        [_msg(202, "2026-01-02T09:00:00Z"), _msg(203, "2026-01-02T11:00:00Z")],
    )
    _write(root / SAKURA_SINGLE, {"id": 134, "name": "中川 智尋"}, [_msg(301, "2026-06-15T12:00:00Z")])
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
    "single_all": ("GET", f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=0", None),
    "single_limited": ("GET", f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=102&limit=2", None),
    "group_all": ("GET", f"/api/content/group_messages/{HINATA_GROUP}?limit=0&last_read_id=201", None),
    "group_default": ("GET", f"/api/content/group_messages/{HINATA_GROUP}", None),
}
```

- [ ] **Step 2: Write the golden test**

`backend/tests/test_read_path_golden.py`:

```python
"""Byte-identity guard: the read endpoints must answer exactly as before the
read-path performance work (spec §5.5). Regenerate ONLY for a reviewed,
intentional change: SAKADESK_UPDATE_GOLDEN=1 uv run pytest backend/tests/test_read_path_golden.py
"""

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.tests.read_path_fixture import GOLDEN_CASES, build_archive

GOLDEN = Path(__file__).parent / "golden" / "read_path.json"
client = TestClient(app)


def _call(method: str, url: str, body):
    return client.post(url, json=body) if method == "POST" else client.get(url)


@pytest.fixture
def archive(tmp_path):
    root = build_archive(tmp_path)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


def test_read_endpoints_match_golden(archive):
    actual = {}
    for name, (method, url, body) in GOLDEN_CASES.items():
        resp = _call(method, url, body)
        actual[name] = {"status": resp.status_code, "body": resp.text}

    if os.environ.get("SAKADESK_UPDATE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(exist_ok=True)
        with open(GOLDEN, "w", encoding="utf-8") as f:
            json.dump(actual, f, ensure_ascii=False, indent=2)
        pytest.skip("golden regenerated")

    with open(GOLDEN, encoding="utf-8") as f:
        expected = json.load(f)
    for name in GOLDEN_CASES:
        assert actual[name] == expected[name], name
```

- [ ] **Step 3: Generate the baseline from the CURRENT code and inspect it**

```bash
SAKADESK_UPDATE_GOLDEN=1 uv run pytest backend/tests/test_read_path_golden.py -q
uv run pytest backend/tests/test_read_path_golden.py -q
python3 -c "import json;d=json.load(open('backend/tests/golden/read_path.json',encoding='utf-8'));print({k:v['status'] for k,v in d.items()})"
```

Expected: first run SKIPPED (regenerated), second run PASS, statuses all `200`. Open the file and check `groups_all` contains `金村 美玖` and the corrupt member has no `thumbnail` key; `unread` maps the corrupt and missing paths to `0`.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/read_path_fixture.py backend/tests/test_read_path_golden.py backend/tests/golden/read_path.json
uv run git commit -m "test(content): pin read endpoint responses with a golden file

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stat-keyed summary cache for `/groups` and `/unread_counts`

**Files:**
- Create: `backend/services/messages_cache.py`, `backend/tests/test_messages_cache.py`
- Modify: `backend/api/content.py` — `_collect_groups` (member loop, ~L283-310) and `_compute_unread_counts` (~L583-650)

**Interfaces:**
- Produces:
  - `stat_key(path: Path) -> tuple[int, int, int]` (raises `OSError` if missing)
  - `class StatCache: get(path: Path, build: Callable[[Any], T]) -> T`
  - `@dataclass(frozen=True) MessagesSummary(member: dict, last_raw_id: Any, total_messages: Any, sorted_ids: tuple, id_set: frozenset)` with `unread_count(last_read_id, revealed) -> int`
  - `get_messages_summary(path: Path) -> MessagesSummary`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_messages_cache.py`:

```python
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.services import messages_cache as mc


def _write(p: Path, messages, member=None):
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"member": member or {"name": "テスト"}, "messages": messages}, f, ensure_ascii=False)


@pytest.fixture(autouse=True)
def fresh_cache(monkeypatch):
    monkeypatch.setattr(mc, "_MESSAGES_CACHE", mc.StatCache())


def test_summary_fields(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 5}, {"id": 3}, {"id": 9}], member={"name": "金村", "thumbnail": "t"})
    s = mc.get_messages_summary(p)
    assert s.member == {"name": "金村", "thumbnail": "t"}
    assert s.last_raw_id == 9 and s.total_messages == 3
    assert s.sorted_ids == (3, 5, 9) and s.id_set == frozenset({3, 5, 9})


def test_summary_empty_and_explicit_total(tmp_path):
    p = tmp_path / "messages.json"
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"messages": [], "total_messages": 7}, f)
    s = mc.get_messages_summary(p)
    assert s.last_raw_id is None and s.total_messages == 7 and s.member == {}


@pytest.mark.parametrize(
    "ids,last,revealed,expected",
    [
        ([1, 2, 3, 4], 2, set(), 2),
        ([1, 2, 3, 4], 2, {4}, 1),
        ([1, 2, 3, 4], 2, {1, "x"}, 2),
        ([1, 3, 3, 4], 2, {3}, 1),  # duplicates counted like the original loop
        ([], 0, set(), 0),
    ],
)
def test_unread_count_matches_original_loop(tmp_path, ids, last, revealed, expected):
    p = tmp_path / "messages.json"
    _write(p, [{"id": i} for i in ids])
    original = sum(1 for i in ids if i > last and i not in revealed)
    assert mc.get_messages_summary(p).unread_count(last, revealed) == original == expected


def test_cache_hit_does_not_reparse(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    first = mc.get_messages_summary(p)
    with patch("backend.services.messages_cache.json.load", side_effect=AssertionError("reparsed")):
        assert mc.get_messages_summary(p) is first


def test_invalidation_same_size_rewrite_via_replace(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    assert mc.get_messages_summary(p).sorted_ids == (1,)
    tmp = tmp_path / "x.tmp"
    _write(tmp, [{"id": 2}])  # same byte size
    os.replace(tmp, p)
    assert mc.get_messages_summary(p).sorted_ids == (2,)


def test_invalidation_in_place_append_and_delete(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [{"id": 1}])
    mc.get_messages_summary(p)
    _write(p, [{"id": 1}, {"id": 2}])
    assert mc.get_messages_summary(p).sorted_ids == (1, 2)
    p.unlink()
    with pytest.raises(FileNotFoundError):
        mc.get_messages_summary(p)


def test_corrupt_file_raises_and_is_not_cached(tmp_path):
    p = tmp_path / "messages.json"
    p.write_text("{bad", encoding="utf-8")
    with pytest.raises(ValueError):
        mc.get_messages_summary(p)
    _write(p, [{"id": 4}])
    assert mc.get_messages_summary(p).sorted_ids == (4,)


def test_member_mapping_is_read_only(tmp_path):
    p = tmp_path / "messages.json"
    _write(p, [], member={"name": "a"})
    with pytest.raises(TypeError):
        mc.get_messages_summary(p).member["name"] = "mutated"  # type: ignore[index]
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest backend/tests/test_messages_cache.py -q`
Expected: FAIL — `ImportError: cannot import name 'messages_cache'`.

- [ ] **Step 3: Implement `backend/services/messages_cache.py`**

```python
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
```

- [ ] **Step 4: Use summaries in `content.py`**

Add `from backend.services.messages_cache import get_messages_summary`.

In `_collect_groups`, replace the `with open(msg_file, ...)` block (inside `try:`) with:

```python
                        summary = get_messages_summary(msg_file)
                        m_data = summary.member
                        member_meta["thumbnail"] = m_data.get("thumbnail")
                        member_meta["portrait"] = m_data.get("portrait")
                        member_meta["phone_image"] = m_data.get("phone_image")
                        member_meta["group_thumbnail"] = m_data.get("group_thumbnail")

                        if m_data.get("group_thumbnail"):
                            group_thumbnail = m_data.get("group_thumbnail")

                        # Get last message ID (last in file order, as before)
                        if summary.last_raw_id is not None:
                            last_id = summary.last_raw_id
                            if last_id > last_message_id:
                                last_message_id = last_id

                        # Count messages
                        total_messages += summary.total_messages
```

In `_compute_unread_counts`, replace the individual-path `with open(...)` block with:

```python
                result[path] = get_messages_summary(msg_file).unread_count(
                    last_read_id, revealed_ids
                )
```

and the group-path inner `with open(member_msg_file, ...)` block with:

```python
                            total_unread += get_messages_summary(
                                member_msg_file
                            ).unread_count(last_read_id, revealed_ids)
```

Keep every surrounding `try/except` and log call unchanged.

- [ ] **Step 5: Run cache tests, golden, and the existing content suites**

Run: `uv run pytest backend/tests/test_messages_cache.py backend/tests/test_read_path_golden.py backend/tests/test_content_api.py backend/tests/test_content_api_extended.py backend/tests/test_content_offload.py -q`
Expected: all PASS (golden unchanged).

- [ ] **Step 6: Commit**

```bash
uv run ruff check backend && uv run ruff format backend && uv run mypy backend
git add backend/services/messages_cache.py backend/tests/test_messages_cache.py backend/api/content.py
uv run git commit -m "perf(content): cache messages.json summaries by file stat

/groups and /unread_counts re-parsed every messages.json on each 2 s
sidebar poll; they now parse a file only after it changes on disk.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Off-loop chat loads + ETag / 304

**Files:**
- Modify: `backend/api/content.py` — `get_messages_by_path` (~L385-449), `get_group_messages` (~L452-541)
- Create: `backend/tests/test_content_etag.py`

**Interfaces:**
- Consumes: `stat_key` (Task 2).
- Produces: `_etag(files: list[Path], *params) -> Optional[str]`; handlers set `ETag` + `Cache-Control: no-cache`; `If-None-Match` match → `304`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_content_etag.py`:

```python
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.tests.read_path_fixture import HINATA_GROUP, HINATA_SINGLE, build_archive

client = TestClient(app)


@pytest.fixture
def archive(tmp_path):
    root = build_archive(tmp_path)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


@pytest.mark.parametrize(
    "url",
    [
        f"/api/content/messages_by_path?path={HINATA_SINGLE}&last_read_id=0",
        f"/api/content/group_messages/{HINATA_GROUP}?limit=0",
    ],
)
def test_etag_roundtrip_and_invalidation(archive, url):
    first = client.get(url)
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "no-cache"

    again = client.get(url, headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""

    other_params = client.get(url + "&limit=1", headers={"If-None-Match": etag})
    assert other_params.status_code == 200  # params are part of the key

    target = archive / (HINATA_SINGLE if "messages_by_path" in url else f"{HINATA_GROUP}/1 メンバーA") / "messages.json"
    data = json.loads(target.read_text(encoding="utf-8"))
    data["messages"][0]["is_favorite"] = True
    target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    changed = client.get(url, headers={"If-None-Match": etag})
    assert changed.status_code == 200 and changed.headers["etag"] != etag


def test_chat_loads_run_off_loop(archive):
    with patch("backend.api.content.asyncio.to_thread", wraps=__import__("asyncio").to_thread) as spy:
        client.get(f"/api/content/messages_by_path?path={HINATA_SINGLE}")
        client.get(f"/api/content/group_messages/{HINATA_GROUP}")
    assert spy.call_count >= 2
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest backend/tests/test_content_etag.py -q`
Expected: FAIL — `KeyError: 'etag'`.

- [ ] **Step 3: Implement**

Imports in `content.py`: `import hashlib`, `from fastapi import APIRouter, Header, HTTPException, Query, Response`, `from backend.services.messages_cache import get_messages_summary, stat_key`, `from backend.version import APP_VERSION`.

Add helpers (above `get_messages_by_path`):

```python
_NO_CACHE = "no-cache"


def _etag(files: list[Path], *params: Any) -> Optional[str]:
    """Strong validator for a response built from ``files`` with ``params``.

    Covers every input of the response: the files' stat keys, the query
    parameters that shape it, and the app version (a code change can change
    the shape). None if a file vanished mid-request (no caching then).
    """
    try:
        keys = [(str(f), stat_key(f)) for f in files]
    except OSError:
        return None
    raw = json.dumps([keys, [str(p) for p in params], APP_VERSION], ensure_ascii=False)
    return '"' + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32] + '"'


def _not_modified(etag: str) -> Response:
    return Response(status_code=304, headers={"ETag": etag, "Cache-Control": _NO_CACHE})


def _load_member_messages(msg_file: Path, limit: int, last_read_id: int) -> dict:
    """Blocking body of messages_by_path (unchanged logic) — run in a thread."""
    with open(msg_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    messages = _visible_messages(data.get("messages", []))
    messages.sort(key=lambda x: x.get("timestamp", ""))
    total = len(messages)
    unread_count = 0
    max_message_id = 0
    if last_read_id > 0:
        for m in messages:
            msg_id = m.get("id", 0)
            if msg_id > max_message_id:
                max_message_id = msg_id
            if msg_id > last_read_id:
                unread_count += 1
    else:
        unread_count = total
        if messages:
            max_message_id = max(m.get("id", 0) for m in messages)
    if limit > 0:
        messages = messages[-limit:]
    data["messages"] = messages
    data["total_count"] = total
    data["unread_count"] = unread_count
    data["max_message_id"] = max_message_id
    return data
```

Replace `get_messages_by_path` with:

```python
@router.get("/messages_by_path")
async def get_messages_by_path(
    response: Response,
    path: str,
    limit: int = 0,
    offset: int = 0,
    last_read_id: int = 0,
    if_none_match: Optional[str] = Header(default=None),
):
    """
    Get messages using the relative path from output dir.
    Path should point to the member directory containing messages.json.

    Example path: "日向坂46/messages/34 金村 美玖/58 金村 美玖"

    Parameters:
    - limit: Maximum number of messages to return (returns latest messages)
    - last_read_id: For calculating unread count

    Sends an ETag with ``Cache-Control: no-cache``; a matching
    ``If-None-Match`` gets ``304`` without the file being parsed.
    """
    if is_test_mode():
        from backend.fixtures.test_data import get_test_messages_response

        return get_test_messages_response(path, last_read_id)

    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, path)
    logger.debug("Loading messages", path=path, limit=limit, last_read_id=last_read_id)

    msg_file = safe_path / "messages.json"
    if not msg_file.exists():
        logger.debug("Messages file not found", file_path=str(msg_file))
        raise HTTPException(status_code=404, detail="No messages found")

    etag = _etag([msg_file], "member", path, limit, offset, last_read_id)
    if etag is not None and if_none_match == etag:
        return _not_modified(etag)

    try:
        data = await asyncio.to_thread(_load_member_messages, msg_file, limit, last_read_id)
    except Exception as e:
        logger.error("Failed to load messages", path=path, error=str(e))
        raise HTTPException(status_code=500, detail="An internal error occurred")

    if etag is not None:
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = _NO_CACHE
    return data
```

For `get_group_messages`: move everything after `if not safe_path.is_dir(): ...` into `def _load_group_messages(safe_path: Path, group_path: str, limit: int, last_read_id: int) -> dict:` **verbatim** (same loop, sort, unread, pagination, return dict), and add:

```python
def _group_member_files(safe_path: Path) -> list[Path]:
    files = []
    for member_dir in sorted(safe_path.iterdir()):
        if member_dir.is_dir() and parse_id_name(member_dir.name)[0]:
            msg_file = member_dir / "messages.json"
            if msg_file.exists():
                files.append(msg_file)
    return files
```

New handler body:

```python
@router.get("/group_messages/{group_path:path}")
async def get_group_messages(
    response: Response,
    group_path: str,
    limit: int = 200,
    offset: int = 0,
    last_read_id: int = 0,
    if_none_match: Optional[str] = Header(default=None),
):
    """(docstring unchanged, plus the ETag paragraph from messages_by_path)"""
    output_dir = get_output_dir()
    safe_path = validate_path_within_dir(output_dir, group_path)

    if not safe_path.is_dir():
        raise HTTPException(status_code=404, detail="Group not found")

    files = await asyncio.to_thread(_group_member_files, safe_path)
    etag = _etag(files, "group", group_path, limit, offset, last_read_id)
    if etag is not None and if_none_match == etag:
        return _not_modified(etag)

    data = await asyncio.to_thread(_load_group_messages, safe_path, group_path, limit, last_read_id)
    if etag is not None:
        response.headers["ETag"] = etag
        response.headers["Cache-Control"] = _NO_CACHE
    return data
```

Replace the `(docstring unchanged, …)` line with the existing docstring text followed by the same ETag paragraph used in `get_messages_by_path`.

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/test_content_etag.py backend/tests/test_read_path_golden.py backend/tests/test_content_api.py backend/tests/test_content_api_extended.py backend/tests/test_content_visibility.py -q`
Expected: all PASS (golden compares `status` and `body` only, so the new headers do not affect it).

- [ ] **Step 5: Commit**

```bash
uv run ruff check backend && uv run ruff format backend && uv run mypy backend
git add backend/api/content.py backend/tests/test_content_etag.py
uv run git commit -m "perf(content): parse chat loads off the loop and answer 304

messages_by_path and group_messages now json.load in a worker thread and
send an ETag with Cache-Control no-cache, so an unchanged conversation is
revalidated without being parsed or serialised again.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sidebar polling pauses when hidden; unread badges survive a failed poll

**Files:**
- Create: `frontend/src/hooks/useVisiblePolling.ts`, `frontend/src/hooks/useVisiblePolling.test.ts`
- Modify: `frontend/src/features/messages/components/MemberList.tsx` (L129-140)

**Interfaces:**
- Produces: `useVisiblePolling(callback: () => void, intervalMs: number, deps: DependencyList): void` — runs `callback` immediately, every `intervalMs` while visible, and once when the document becomes visible.

- [ ] **Step 1: Write the failing test**

`frontend/src/hooks/useVisiblePolling.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisiblePolling } from './useVisiblePolling';

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
}

describe('useVisiblePolling', () => {
    beforeEach(() => { vi.useFakeTimers(); setVisibility('visible'); });
    afterEach(() => { vi.useRealTimers(); });

    it('runs immediately and on every interval while visible', () => {
        const cb = vi.fn();
        renderHook(() => useVisiblePolling(cb, 1000, []));
        expect(cb).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(3000);
        expect(cb).toHaveBeenCalledTimes(4);
    });

    it('skips ticks while hidden and refreshes once on becoming visible', () => {
        const cb = vi.fn();
        renderHook(() => useVisiblePolling(cb, 1000, []));
        setVisibility('hidden');
        vi.advanceTimersByTime(5000);
        expect(cb).toHaveBeenCalledTimes(1);
        setVisibility('visible');
        expect(cb).toHaveBeenCalledTimes(2);
    });

    it('stops on unmount', () => {
        const cb = vi.fn();
        const { unmount } = renderHook(() => useVisiblePolling(cb, 1000, []));
        unmount();
        vi.advanceTimersByTime(5000);
        setVisibility('visible');
        expect(cb).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `frontend/`): `npx vitest run src/hooks/useVisiblePolling.test.ts`
Expected: FAIL — cannot resolve `./useVisiblePolling`.

- [ ] **Step 3: Implement**

`frontend/src/hooks/useVisiblePolling.ts`:

```ts
import { useEffect, useRef, type DependencyList } from 'react';

/**
 * Poll `callback` every `intervalMs`, skipping ticks while the window is hidden
 * (minimized / background tab) and refreshing once as soon as it is visible
 * again. Runs `callback` immediately on mount and whenever `deps` change.
 */
export function useVisiblePolling(callback: () => void, intervalMs: number, deps: DependencyList): void {
    const cbRef = useRef(callback);
    cbRef.current = callback;

    useEffect(() => {
        cbRef.current();
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            cbRef.current();
        }, intervalMs);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') cbRef.current();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-controlled deps
    }, [intervalMs, ...deps]);
}
```

In `MemberList.tsx`: import `useVisiblePolling` from `'../../../hooks/useVisiblePolling'` and replace

```tsx
    useEffect(() => {
        loadGroups();
        const interval = setInterval(loadGroups, UI_CONSTANTS.polling.sidebarMs);
        return () => clearInterval(interval);
    }, [activeService]);
```

with

```tsx
    useVisiblePolling(loadGroups, UI_CONSTANTS.polling.sidebarMs, [activeService]);
```

and in `checkUnread`'s `catch`, replace

```tsx
            console.error('Failed to fetch unread counts:', err);
            // Fallback: don't show any unread counts rather than showing wrong ones
            setUnreadCounts({});
```

with

```tsx
            console.error('Failed to fetch unread counts:', err);
            // Keep the last known counts: they were correct one poll ago, while
            // clearing them made every badge flicker off on a single hiccup.
```

- [ ] **Step 4: Run tests and type-check**

Run (in `frontend/`): `npx vitest run src/hooks/useVisiblePolling.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useVisiblePolling.ts frontend/src/hooks/useVisiblePolling.test.ts frontend/src/features/messages/components/MemberList.tsx
uv run git commit -m "perf(sidebar): pause polling while the window is hidden

Also keeps the last unread counts when one poll fails instead of
clearing every badge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Read-path benchmark script

**Files:**
- Create: `scripts/bench_read_path.py`

- [ ] **Step 1: Write the script**

```python
"""Time one sidebar poll cycle and the largest chat load on an archive COPY.

Never point this at the live archive folder: copy it first, e.g.
  cp -r "/mnt/c/D/SakaDesk Output" /tmp/claude-bench-archive
  uv run python scripts/bench_read_path.py /tmp/claude-bench-archive --runs 5
"""

import argparse
import logging
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.api.content import (  # noqa: E402
    _collect_groups,
    _compute_unread_counts,
    _load_member_messages,
)

log = logging.getLogger("bench")


def _timed(fn, runs: int) -> list[float]:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t0) * 1000)
    return out


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("archive", type=Path)
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()
    root: Path = args.archive
    files = sorted(root.glob("*/messages/*/*/messages.json"), key=lambda p: p.stat().st_size)
    if not files:
        raise SystemExit("no messages.json under archive")
    read_states = {str(f.parent.relative_to(root)).replace("\\", "/"): {"lastReadId": 0, "revealedIds": []} for f in files}

    def poll() -> None:
        _collect_groups(root, None)
        _compute_unread_counts(root, read_states)

    poll_ms = _timed(poll, args.runs)
    largest = files[-1]
    chat_ms = _timed(lambda: _load_member_messages(largest, 0, 0), args.runs)
    total_mb = sum(f.stat().st_size for f in files) / 1048576
    log.info("files=%d total=%.1fMB largest=%.1fMB", len(files), total_mb, largest.stat().st_size / 1048576)
    log.info("sidebar poll: first=%.0fms median(rest)=%.1fms", poll_ms[0], statistics.median(poll_ms[1:] or poll_ms))
    log.info("largest chat load: median=%.0fms", statistics.median(chat_ms))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it on a copy of the real archive**

The first (cold) run parses every file — exactly what every poll cost before Task 2; the warm runs are the new per-poll cost.

```bash
rm -rf /tmp/claude-bench-archive && cp -r "/mnt/c/D/SakaDesk Output" /tmp/claude-bench-archive
uv run python scripts/bench_read_path.py /tmp/claude-bench-archive --runs 6
rm -rf /tmp/claude-bench-archive
```

Expected: `first` in the hundreds of ms; `median(rest)` in single-digit ms. Paste the three output lines into the PR's `## Testing` section.

- [ ] **Step 3: Commit**

```bash
uv run ruff check scripts && uv run ruff format scripts
git add scripts/bench_read_path.py
uv run git commit -m "chore(scripts): add read-path benchmark for archive copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Favorites through pysaka's locked writer

**Files:**
- Modify: `backend/api/favorites.py:71-135` (`_update_local_favorite`)
- Modify: `backend/tests/test_favorites.py` (append)

**Interfaces:**
- Consumes: `get_messages_summary` (Task 2), `SyncManager.update_message_fields_sync` (pysaka Task 1).

- [ ] **Step 1: Write the failing test** (append to `TestLocalFavorite` class or module level, matching the file's style)

```python
    def test_update_local_favorite_uses_locked_writer(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            member_dir = Path(tmp_dir) / "日向坂46" / "messages" / "1 Group" / "40 Member"
            member_dir.mkdir(parents=True)
            msg_file = member_dir / "messages.json"
            msg_file.write_text(json.dumps({"messages": [{"id": 12345, "is_favorite": False}]}), encoding="utf-8")

            with patch("api.favorites._get_output_dir", return_value=Path(tmp_dir)), patch(
                "api.favorites.SyncManager.update_message_fields_sync", return_value=True
            ) as writer:
                assert _update_local_favorite(12345, True, "hinatazaka46") is True

            writer.assert_called_once_with(msg_file, 12345, {"is_favorite": True})
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest backend/tests/test_favorites.py -q`
Expected: the new test FAILS (`AttributeError: ... has no attribute 'SyncManager'`); the existing ones PASS.

- [ ] **Step 3: Implement**

In `favorites.py` add `from pysaka.manager import SyncManager` and `from backend.services.messages_cache import get_messages_summary`; remove the now-unused `atomic_write_json` import if nothing else uses it. Replace the per-file `try:` body inside the member loop with:

```python
            try:
                # Locate via the stat-keyed summary (no full parse unless the
                # file changed), then write through pysaka's per-file lock so a
                # sync writing the same file cannot drop either change.
                if message_id not in get_messages_summary(msg_file).id_set:
                    continue
                if SyncManager.update_message_fields_sync(
                    msg_file, message_id, {"is_favorite": is_favorite}
                ):
                    logger.info(
                        f"Updated local favorite: service={service}, "
                        f"msg={message_id}, is_favorite={is_favorite}"
                    )
                    return True
                return False
```

Keep the existing `except Exception as e:` handler. Update the function docstring: replace "Writes are atomic (temp file + os.replace) …" with "Writes go through pysaka's `SyncManager.update_message_fields_sync`, which is atomic and holds the same per-file lock as sync (SD-BE-API-02)."

- [ ] **Step 4: Run tests**

Run: `uv run pytest backend/tests/test_favorites.py -q`
Expected: all PASS (existing tests exercise the real pysaka writer through the editable source).

- [ ] **Step 5: Commit**

```bash
uv run ruff check backend && uv run ruff format backend && uv run mypy backend
git add backend/api/favorites.py backend/tests/test_favorites.py
uv run git commit -m "fix(favorites): write through pysaka's per-file lock

A favorite toggled while a sync wrote the same messages.json could drop
the freshly synced messages; both now share one lock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backfill orchestration in sync

**Files:**
- Modify: `backend/services/sync_service.py` (~L560, right after `count = await self.manager.sync_member(...)`)
- Modify: `backend/tests/test_sync_service_core.py` (append)

- [ ] **Step 1: Write the failing test**

Add to the same test class as `test_members_failure_in_one_group_does_not_abort_sync` in `backend/tests/test_sync_service_core.py` (it reuses that module's `_run_start_sync` helper):

```python
    @pytest.mark.asyncio
    async def test_phase2_backfills_each_member_and_isolates_errors(self, tmp_path):
        """Every synced member gets one backfill call; a backfill error is logged
        and never fails the sync."""
        groups = [
            {"id": 100, "name": "G1", "state": "open", "subscription": {"state": "active"}},
            {"id": 200, "name": "G2", "state": "open", "subscription": {"state": "active"}},
        ]

        async def members(_session, gid):
            return [{"id": gid + 1, "name": f"M{gid}"}]

        mock_client = MagicMock()
        mock_client.access_token = "tok"
        mock_client.refresh_if_needed = AsyncMock()
        mock_client.get_groups = AsyncMock(return_value=groups)
        mock_client.get_members = AsyncMock(side_effect=members)
        mock_client.get_messages = AsyncMock(return_value=[])

        mock_manager = MagicMock()
        mock_manager.client = mock_client
        mock_manager.get_last_ts = MagicMock(return_value="2026-01-01T00:00:00Z")
        mock_manager.get_last_id = MagicMock(return_value=1)
        mock_manager.sync_member = AsyncMock(return_value=0)
        mock_manager.process_media_queue = AsyncMock(return_value={})
        mock_manager.backfill_past_messages = AsyncMock(side_effect=[RuntimeError("boom"), 2])
        saved: dict = {}

        await _run_start_sync(
            SyncService(),
            tmp_path,
            groups=groups,
            members=None,
            mock_manager=mock_manager,
            saved=saved,
        )

        assert mock_manager.backfill_past_messages.await_count == 2
        backfilled = {c.args[1]["id"] for c in mock_manager.backfill_past_messages.await_args_list}
        assert backfilled == {100, 200}
        assert {c.args[1]["id"] for c in mock_manager.sync_member.await_args_list} == {100, 200}
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest backend/tests/test_sync_service_core.py -q -k backfills`
Expected: FAIL — `await_count == 0`.

- [ ] **Step 3: Implement**

After the `count = await self.manager.sync_member(...)` call add:

```python
                        # pysaka 0.4.5: once per member, merge the ~1-1.5 days
                        # before the first subscription (and their media). Free
                        # after the first success (flag in sync_state); never
                        # fails the sync.
                        try:
                            await self.manager.backfill_past_messages(
                                session, task["group"], task["member"]
                            )
                        except (SessionExpiredError, RefreshFailedError):
                            raise
                        except Exception as e:
                            logger.warning(
                                "past_backfill_failed",
                                member_id=member_id,
                                error=str(e),
                            )
```

(`SessionExpiredError`, `RefreshFailedError` are already imported in this module — verify with `grep -n "RefreshFailedError" backend/services/sync_service.py`.)

- [ ] **Step 4: Run sync suites**

Run: `uv run pytest backend/tests/test_sync_service.py backend/tests/test_sync_service_core.py backend/tests/test_sync_service_extended.py backend/tests/test_first_sync_smoke.py -q`
Expected: all PASS. Existing tests build `mock_manager = MagicMock()` without `backfill_past_messages`; awaiting that plain `MagicMock` raises `TypeError`, which the new `except Exception` logs as `past_backfill_failed` — so they keep passing unchanged. Do not add a blanket fixture.

- [ ] **Step 5: Commit**

```bash
uv run ruff check backend && uv run ruff format backend && uv run mypy backend
git add backend/services/sync_service.py backend/tests/
uv run git commit -m "feat(sync): recover messages from before the subscription

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Profile images backend (service, endpoint, `*_local` fields)

**Files:**
- Create: `backend/services/profile_images_service.py`, `backend/tests/test_profile_images_api.py`
- Modify: `backend/api/content.py` (`_collect_groups` member + group fields, `_load_member_messages`, `_load_group_messages`, ETag file lists, new route)
- Modify: `backend/tests/golden/read_path.json` (regenerated, additive only)

**Interfaces:**
- Consumes: `StatCache` (Task 2); pysaka index format `{"version": 1, "current": {kind: url}, "images": [{"kind","file","url","first_seen"}]}` with `file` relative to `profile_images/`.
- Produces:
  - `KINDS = ("group_thumbnail", "thumbnail", "phone_image")`
  - `local_urls(output_dir: Path, member_dir: Path) -> dict[str, Optional[str]]` (keys `group_thumbnail_local`, `thumbnail_local`, `phone_image_local`)
  - `list_images(output_dir: Path, member_dir: Path, member_block: Mapping) -> dict` → `{"kinds": {kind: [{"url": str, "first_seen": Optional[str], "current": bool}]}}` newest first
  - `index_files(member_dir: Path) -> list[Path]` (index path if it exists, for ETags)
  - `GET /api/content/profile_images?path=<member dir relative to output dir>`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_profile_images_api.py`:

```python
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
        json.dump({"version": 1, "current": current, "images": entries}, f, ensure_ascii=False)


@pytest.fixture
def archive(tmp_path):
    root = build_archive(tmp_path)
    with patch("backend.api.content.get_output_dir", return_value=root):
        yield root


def test_history_newest_first_with_current_flag(archive):
    _archive_images(
        archive / HINATA_SINGLE,
        [
            {"kind": "thumbnail", "file": "thumbnail/old.jpeg", "url": "https://cdn/old.jpeg", "first_seen": "2026-03-14T00:00:00Z"},
            {"kind": "thumbnail", "file": "thumbnail/new.jpeg", "url": "https://cdn/new.jpeg", "first_seen": "2026-07-05T00:00:00Z"},
        ],
        {"thumbnail": "https://cdn/new.jpeg"},
    )
    body = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()
    thumbs = body["kinds"]["thumbnail"]
    assert [t["url"] for t in thumbs] == [f"{PREFIX}/thumbnail/new.jpeg", f"{PREFIX}/thumbnail/old.jpeg"]
    assert [t["current"] for t in thumbs] == [True, False]
    assert thumbs[1]["first_seen"] == "2026-03-14T00:00:00Z"


def test_current_not_archived_yet_is_listed_first_as_remote(archive):
    _archive_images(
        archive / HINATA_SINGLE,
        [{"kind": "thumbnail", "file": "thumbnail/old.jpeg", "url": "https://cdn/old.jpeg", "first_seen": "2026-03-14T00:00:00Z"}],
        {"thumbnail": "https://cdn/brand-new.jpeg"},
    )
    thumbs = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()["kinds"]["thumbnail"]
    assert thumbs[0] == {"url": "https://cdn/brand-new.jpeg", "first_seen": None, "current": True}
    assert thumbs[1]["current"] is False


def test_no_index_falls_back_to_member_block(archive):
    kinds = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()["kinds"]
    assert kinds["phone_image"] == [
        {"url": "https://cdn/members/phone-images/58-20260102-000000.jpeg", "first_seen": None, "current": True}
    ]
    assert set(kinds) == {"group_thumbnail", "thumbnail", "phone_image"}


def test_member_without_images_returns_empty_kinds(archive):
    assert client.get(f"/api/content/profile_images?path={SAKURA_SINGLE}").json() == {"kinds": {}}


def test_missing_file_on_disk_is_skipped_and_corrupt_index_falls_back(archive):
    member_dir = archive / HINATA_SINGLE
    _archive_images(member_dir, [{"kind": "thumbnail", "file": "thumbnail/a.jpeg", "url": "u/a", "first_seen": "2026-01-01T00:00:00Z"}], {"thumbnail": "u/a"})
    (member_dir / "profile_images" / "thumbnail" / "a.jpeg").unlink()
    thumbs = client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").json()["kinds"]["thumbnail"]
    assert thumbs == [{"url": "u/a", "first_seen": None, "current": True}]
    (member_dir / "profile_images" / "index.json").write_text("{bad", encoding="utf-8")
    assert client.get(f"/api/content/profile_images?path={HINATA_SINGLE}").status_code == 200


def test_traversal_rejected(archive):
    assert client.get("/api/content/profile_images?path=../../etc").status_code in (400, 403, 404)


def test_local_fields_in_groups_and_messages(archive):
    _archive_images(
        archive / HINATA_SINGLE,
        [{"kind": "phone_image", "file": "phone_image/p.jpeg", "url": "https://cdn/p.jpeg", "first_seen": "2026-01-01T00:00:00Z"}],
        {"phone_image": "https://cdn/p.jpeg", "thumbnail": "https://cdn/t-not-yet.jpeg"},
    )
    groups = client.get("/api/content/groups?service=hinatazaka46").json()["groups"]
    member = next(g for g in groups if str(g["id"]) == "34")["members"][0]
    assert member["phone_image_local"] == f"{PREFIX}/phone_image/p.jpeg"
    assert member["thumbnail_local"] is None and member["group_thumbnail_local"] is None
    msgs = client.get(f"/api/content/messages_by_path?path={HINATA_SINGLE}").json()
    assert msgs["member"]["phone_image_local"] == f"{PREFIX}/phone_image/p.jpeg"
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest backend/tests/test_profile_images_api.py -q`
Expected: FAIL — 404 for `/api/content/profile_images`.

- [ ] **Step 3: Implement the service**

`backend/services/profile_images_service.py`:

```python
"""Read pysaka's ``profile_images/index.json`` for the UI.

pysaka (>= 0.4.5) archives each member's list icon (``group_thumbnail``), chat
icon (``thumbnail``) and call-screen image (``phone_image``) under
``<member_dir>/profile_images/<kind>/<basename>`` and keeps an index whose
``current`` map holds each kind's latest API URL. This module turns that into
media URLs served by ``/api/content/media``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import quote

from backend.services.messages_cache import StatCache
from backend.services.service_utils import get_service_identifier

KINDS = ("group_thumbnail", "thumbnail", "phone_image")
DIR_NAME = "profile_images"
INDEX_NAME = "index.json"
_INDEX_CACHE = StatCache()


def _media_url(output_dir: Path, file_path: Path) -> Optional[str]:
    rel = file_path.relative_to(output_dir).parts
    service_id = get_service_identifier(rel[0]) if rel else None
    if not service_id:
        return None
    return "/api/content/media/" + "/".join([quote(service_id, safe="")] + [quote(p, safe="") for p in rel[1:]])


def _load_index(member_dir: Path) -> Optional[dict[str, Any]]:
    path = member_dir / DIR_NAME / INDEX_NAME
    try:
        index = _INDEX_CACHE.get(path, lambda data: data)
    except (OSError, ValueError):
        return None
    if not isinstance(index, dict) or not isinstance(index.get("images"), list):
        return None
    return index


def index_files(member_dir: Path) -> list[Path]:
    path = member_dir / DIR_NAME / INDEX_NAME
    return [path] if path.exists() else []


def _archived(output_dir: Path, member_dir: Path, index: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    """Archived entries of ``kind`` whose file exists, newest first."""
    out = []
    for e in index["images"]:
        if not isinstance(e, dict) or e.get("kind") != kind or not e.get("file"):
            continue
        file_path = member_dir / DIR_NAME / str(e["file"])
        try:
            file_path.resolve().relative_to((member_dir / DIR_NAME).resolve())
        except ValueError:
            continue  # never serve outside profile_images/
        if not file_path.is_file():
            continue
        url = _media_url(output_dir, file_path)
        if url:
            out.append({"url": url, "first_seen": e.get("first_seen"), "source_url": e.get("url")})
    out.sort(key=lambda x: x["first_seen"] or "", reverse=True)
    return out


def local_urls(output_dir: Path, member_dir: Path) -> dict[str, Optional[str]]:
    """``{kind}_local`` → media URL of the current archived image, or None."""
    result: dict[str, Optional[str]] = {f"{k}_local": None for k in KINDS}
    index = _load_index(member_dir)
    if index is None:
        return result
    current = index.get("current") or {}
    for kind in KINDS:
        for e in _archived(output_dir, member_dir, index, kind):
            if e["source_url"] == current.get(kind):
                result[f"{kind}_local"] = e["url"]
                break
    return result


def list_images(output_dir: Path, member_dir: Path, member_block: Mapping[str, Any]) -> dict[str, Any]:
    """Payload of ``GET /api/content/profile_images``."""
    index = _load_index(member_dir)
    kinds: dict[str, list[dict[str, Any]]] = {}
    for kind in KINDS:
        if index is None:
            remote = member_block.get(kind)
            entries = [{"url": remote, "first_seen": None, "current": True}] if remote else []
        else:
            current_url = (index.get("current") or {}).get(kind)
            archived = _archived(output_dir, member_dir, index, kind)
            entries = [
                {"url": e["url"], "first_seen": e["first_seen"], "current": e["source_url"] == current_url}
                for e in archived
            ]
            if current_url and not any(e["current"] for e in entries):
                entries.insert(0, {"url": current_url, "first_seen": None, "current": True})
        if entries:
            kinds[kind] = entries
    return {"kinds": kinds}
```

- [ ] **Step 4: Wire into `content.py`**

Import: `from backend.services import profile_images_service`.

In `_collect_groups`, right after the four `member_meta[...] = m_data.get(...)` lines add:

```python
                        member_meta.update(
                            profile_images_service.local_urls(output_dir, member_dir)
                        )
```

and next to `group_thumbnail = m_data.get("group_thumbnail")`:

```python
                            group_thumbnail_local = member_meta.get("group_thumbnail_local")
```

initialising `group_thumbnail_local = None` beside `group_thumbnail = None`, and add `"thumbnail_local": group_thumbnail_local,` after `"thumbnail": group_thumbnail,` in the group dict.

In `_load_member_messages`, before `return data`:

```python
    if isinstance(data.get("member"), dict):
        data["member"].update(profile_images_service.local_urls(get_output_dir(), msg_file.parent))
```

In `_load_group_messages`, after building each `members_map[member_id] = {...}`:

```python
                members_map[member_id].update(
                    profile_images_service.local_urls(get_output_dir(), member_dir)
                )
```

ETag inputs: in `get_messages_by_path` use `_etag([msg_file, *profile_images_service.index_files(safe_path)], ...)`; in `_group_member_files` append `profile_images_service.index_files(member_dir)` for each member.

New route (after `get_group_messages`):

```python
@router.get("/profile_images")
async def get_profile_images(path: str):
    """Archived list icon / chat icon / call-screen images of one member, newest
    first per kind; falls back to the remote URLs before pysaka archived them."""
    output_dir = get_output_dir()
    member_dir = validate_path_within_dir(output_dir, path)
    msg_file = member_dir / "messages.json"
    if not msg_file.exists():
        raise HTTPException(status_code=404, detail="No messages found")

    def _build() -> dict:
        try:
            member_block = get_messages_summary(msg_file).member
        except (OSError, ValueError):
            member_block = {}
        return profile_images_service.list_images(output_dir, member_dir, member_block)

    return await asyncio.to_thread(_build)
```

- [ ] **Step 5: Regenerate the golden file and review the diff is additive only**

```bash
SAKADESK_UPDATE_GOLDEN=1 uv run pytest backend/tests/test_read_path_golden.py -q
git diff --stat backend/tests/golden/read_path.json
git diff backend/tests/golden/read_path.json | grep '^[-+]' | grep -v '_local' | grep -v '^[-+][-+]'
```

Expected: the last command prints only lines that differ solely by the added `"*_local": null` keys inside the escaped body strings (each body string line changes because keys were inserted). Read the diff and confirm no existing value changed; if anything else changed, fix the code, not the golden.

- [ ] **Step 6: Run backend suite**

Run: `uv run pytest backend/tests -q`
Expected: all PASS except the known headless-keyring case documented in memory (`test_api_groups_fetch` lives in pysaka, not here — so expect zero failures).

- [ ] **Step 7: Commit**

```bash
uv run ruff check backend && uv run ruff format backend && uv run mypy backend
git add backend/services/profile_images_service.py backend/api/content.py backend/tests/test_profile_images_api.py backend/tests/golden/read_path.json
uv run git commit -m "feat(content): serve archived member images and history

Adds GET /api/content/profile_images and *_local URLs in member payloads
so avatars load from the local archive and work offline.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend data helpers and local-first avatars

**Files:**
- Create: `frontend/src/features/messages/profileImages.ts`, `frontend/src/features/messages/profileImages.test.ts`
- Modify: `frontend/src/types/index.ts` (`MemberInfo`), `MemberList.tsx` (avatar priority, ~L180), `MessagesFeature.tsx` (~L556, ~L734, ~L878)

**Interfaces:**
- Produces:
  - `type ProfileImageKind = 'group_thumbnail' | 'thumbnail' | 'phone_image'`
  - `PROFILE_IMAGE_KINDS: ProfileImageKind[]` (display order: list icon, chat icon, call screen)
  - `KIND_I18N_KEY: Record<ProfileImageKind, 'thumbnailGroup' | 'thumbnail' | 'phoneImage'>`
  - `interface ProfileImageEntry { url: string; first_seen: string | null; current: boolean }`
  - `type ProfileImagesByKind = Partial<Record<ProfileImageKind, ProfileImageEntry[]>>`
  - `memberImageUrl(member, kind): string | undefined`
  - `fetchProfileImages(path: string, signal?: AbortSignal): Promise<ProfileImagesByKind>`
  - `periodLabel(entries: ProfileImageEntry[], index: number, currentLabel: string): string`

- [ ] **Step 1: Write the failing test**

`frontend/src/features/messages/profileImages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import { memberImageUrl, periodLabel, fetchProfileImages, PROFILE_IMAGE_KINDS } from './profileImages';

describe('memberImageUrl', () => {
    it('prefers the local archive, falls back to the CDN', () => {
        expect(memberImageUrl({ thumbnail: 'cdn', thumbnail_local: '/local' }, 'thumbnail')).toBe('/local');
        expect(memberImageUrl({ thumbnail: 'cdn', thumbnail_local: null }, 'thumbnail')).toBe('cdn');
        expect(memberImageUrl(undefined, 'phone_image')).toBeUndefined();
    });
});

describe('periodLabel', () => {
    const entries = [
        { url: 'c', first_seen: '2026-07-05T00:00:00Z', current: true },
        { url: 'b', first_seen: '2026-03-14T00:00:00Z', current: false },
        { url: 'a', first_seen: null, current: false },
    ];
    it('labels current as "<from> – <now>" and older ones by the next newer start', () => {
        expect(periodLabel(entries, 0, '目前')).toMatch(/^2026\/07\/0[45] – 目前$/);
        expect(periodLabel(entries, 1, '目前')).toMatch(/^2026\/03\/1[34] – 2026\/07\/0[45]$/);
    });
    it('uses the current label alone when the start is unknown', () => {
        expect(periodLabel([{ url: 'x', first_seen: null, current: true }], 0, 'Now')).toBe('Now');
        expect(periodLabel(entries, 2, '目前')).toBe('');
    });
});

describe('fetchProfileImages', () => {
    it('returns the kinds map', async () => {
        server.use(http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: { thumbnail: [{ url: 'u', first_seen: null, current: true }] } })));
        const kinds = await fetchProfileImages('日向坂46/messages/34 a/58 b');
        expect(kinds.thumbnail?.[0].url).toBe('u');
    });
    it('throws on HTTP errors', async () => {
        server.use(http.get('/api/content/profile_images', () => new HttpResponse(null, { status: 404 })));
        await expect(fetchProfileImages('x')).rejects.toThrow();
    });
    it('orders kinds list icon, chat icon, call screen', () => {
        expect(PROFILE_IMAGE_KINDS).toEqual(['group_thumbnail', 'thumbnail', 'phone_image']);
    });
});
```

(The date regexes allow ±1 day because `toLocalDateStr` converts to the machine's zone.)

- [ ] **Step 2: Run to verify failure**

Run (in `frontend/`): `npx vitest run src/features/messages/profileImages.test.ts`
Expected: FAIL — cannot resolve `./profileImages`.

- [ ] **Step 3: Implement**

`frontend/src/features/messages/profileImages.ts`:

```ts
import { toLocalDateStr } from '../../utils/dateFormatters';

export type ProfileImageKind = 'group_thumbnail' | 'thumbnail' | 'phone_image';

/** Display order: list icon, chat icon, call screen. */
export const PROFILE_IMAGE_KINDS: ProfileImageKind[] = ['group_thumbnail', 'thumbnail', 'phone_image'];

/** i18n key suffix under `profileImages.` for each kind. */
export const KIND_I18N_KEY: Record<ProfileImageKind, 'thumbnailGroup' | 'thumbnail' | 'phoneImage'> = {
    group_thumbnail: 'thumbnailGroup',
    thumbnail: 'thumbnail',
    phone_image: 'phoneImage',
};

export interface ProfileImageEntry {
    url: string;
    first_seen: string | null;
    current: boolean;
}

export type ProfileImagesByKind = Partial<Record<ProfileImageKind, ProfileImageEntry[]>>;

type MemberImageFields = Partial<Record<ProfileImageKind | `${ProfileImageKind}_local`, string | null>>;

/** Local archived copy if the backend has one, else the CDN URL. */
export function memberImageUrl(member: MemberImageFields | null | undefined, kind: ProfileImageKind): string | undefined {
    return member?.[`${kind}_local`] || member?.[kind] || undefined;
}

export async function fetchProfileImages(path: string, signal?: AbortSignal): Promise<ProfileImagesByKind> {
    const res = await fetch(`/api/content/profile_images?path=${encodeURIComponent(path)}`, { signal });
    if (!res.ok) throw new Error(`profile_images ${res.status}`);
    const body = (await res.json()) as { kinds: ProfileImagesByKind };
    return body.kinds;
}

function day(ts: string): string {
    return toLocalDateStr(ts).replace(/-/g, '/');
}

/**
 * Period an image was in use: from its first_seen to the first_seen of the
 * next newer version (entries are newest first), or "<from> – <currentLabel>"
 * for the current one. Unknown start: the current label alone (current) or ''.
 */
export function periodLabel(entries: ProfileImageEntry[], index: number, currentLabel: string): string {
    const entry = entries[index];
    if (!entry.first_seen) return entry.current ? currentLabel : '';
    const from = day(entry.first_seen);
    if (entry.current) return `${from} – ${currentLabel}`;
    const newer = entries[index - 1]?.first_seen;
    return newer ? `${from} – ${day(newer)}` : from;
}
```

In `frontend/src/types/index.ts` `MemberInfo`, add after `group_thumbnail?: string;`:

```ts
    thumbnail_local?: string | null;  // Archived local copy (pysaka profile_images), if any
    phone_image_local?: string | null;
    group_thumbnail_local?: string | null;
```

Replace avatar expressions (import `memberImageUrl` from `'../profileImages'` / `'./profileImages'` as appropriate):
- `MemberList.tsx` single-member avatar: `avatar: memberImageUrl(member, 'group_thumbnail') || memberImageUrl(member, 'thumbnail') || member?.portrait || memberImageUrl(member, 'phone_image') || null,`
- `MemberList.tsx` group-chat avatar: `avatar: group.thumbnail_local || group.thumbnail || null,` and add `thumbnail_local?: string | null;` to the local `GroupInfo` interface.
- `MessagesFeature.tsx` L556: `avatar: memberImageUrl(memberInfo, 'thumbnail') || memberInfo?.portrait || memberImageUrl(memberInfo, 'phone_image')`
- `MessagesFeature.tsx` L734 and L878 `memberAvatar=`: `memberImageUrl(Object.values(membersMap)[0], 'thumbnail') || Object.values(membersMap)[0]?.portrait`

- [ ] **Step 4: Run tests and type-check**

Run (in `frontend/`): `npx vitest run src/features/messages && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/messages/profileImages.ts frontend/src/features/messages/profileImages.test.ts frontend/src/types/index.ts frontend/src/features/messages/components/MemberList.tsx frontend/src/features/messages/MessagesFeature.tsx
uv run git commit -m "feat(messages): load member avatars from the local archive

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tabbed history viewer

**Files:**
- Modify: `frontend/src/core/media/PhotoDetailModal.tsx` (props + label block ~L172-205)
- Create: `frontend/src/features/messages/components/ProfileImageViewer.tsx`, `ProfileImageViewer.test.tsx`
- Modify: all five `frontend/src/i18n/locales/*.json` (add `profileImages` object)

**Interfaces:**
- Consumes: `ProfileImagesByKind`, `PROFILE_IMAGE_KINDS`, `KIND_I18N_KEY`, `periodLabel` (Task 9).
- Produces:
  - `MediaViewerModal` prop `headerSlot?: React.ReactNode` (rendered top-centre; clicks don't close the modal).
  - `<ProfileImageViewer images initialKind onClose />` with `images: ProfileImagesByKind`, `initialKind: ProfileImageKind`, `onClose: () => void`.

- [ ] **Step 1: Add i18n keys to all five locales**

Add a top-level `"profileImages"` object to each file:

| key | en | ja | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `thumbnailGroup` | List icon | 一覧アイコン | 列表頭像 | 列表头像 | 列表頭像 |
| `thumbnailGroupHint` | Icon shown in the conversation list | トーク一覧に表示されるアイコン | 顯示在聊天室列表上的圖示 | 显示在聊天室列表上的图标 | 喺聊天室列表顯示嘅圖示 |
| `thumbnail` | Chat icon | トークアイコン | 聊天頭像 | 聊天头像 | 聊天頭像 |
| `thumbnailHint` | Avatar shown next to messages in the chat | トーク内のメッセージ横に表示されるアイコン | 聊天室內訊息旁的頭像 | 聊天室内消息旁的头像 | 聊天室入面訊息隔籬嘅頭像 |
| `phoneImage` | Call screen | 着信画面 | 來電畫面 | 来电画面 | 來電畫面 |
| `phoneImageHint` | Photo shown when the member calls | 着信時に表示される写真 | 來電時顯示的照片 | 来电时显示的照片 | 來電時顯示嘅相 |
| `viewImages` | View images | 画像を見る | 查看圖片 | 查看图片 | 睇圖片 |
| `current` | Now | 現在 | 目前 | 目前 | 而家 |
| `versions` | `{{count}} versions` | `{{count}} 件` | `{{count}} 個版本` | `{{count}} 个版本` | `{{count}} 個版本` |

e.g. `en.json`:

```json
  "profileImages": {
    "thumbnailGroup": "List icon",
    "thumbnailGroupHint": "Icon shown in the conversation list",
    "thumbnail": "Chat icon",
    "thumbnailHint": "Avatar shown next to messages in the chat",
    "phoneImage": "Call screen",
    "phoneImageHint": "Photo shown when the member calls",
    "viewImages": "View images",
    "current": "Now",
    "versions": "{{count}} versions"
  }
```

- [ ] **Step 2: Write the failing component test**

`frontend/src/features/messages/components/ProfileImageViewer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileImageViewer } from './ProfileImageViewer';
import type { ProfileImagesByKind } from '../profileImages';

const images: ProfileImagesByKind = {
    thumbnail: [
        { url: '/t-new.jpg', first_seen: '2026-07-05T12:00:00Z', current: true },
        { url: '/t-old.jpg', first_seen: '2026-03-14T12:00:00Z', current: false },
    ],
    phone_image: [{ url: '/p.jpg', first_seen: null, current: true }],
};

describe('ProfileImageViewer', () => {
    it('opens on the requested kind, newest first, and only shows tabs for kinds with images', () => {
        render(<ProfileImageViewer images={images} initialKind="thumbnail" onClose={vi.fn()} />);
        expect(screen.getByRole('tab', { name: /Chat icon/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByRole('tab', { name: /List icon/ })).toBeNull();
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-new.jpg');
        expect(screen.getByText(/– Now$/)).toBeInTheDocument();
    });

    it('arrow keys move within the kind; a tab click switches kind and resets to newest', () => {
        render(<ProfileImageViewer images={images} initialKind="thumbnail" onClose={vi.fn()} />);
        fireEvent.keyDown(document.querySelector('[tabindex="-1"]')!, { key: 'ArrowRight' });
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/t-old.jpg');
        fireEvent.click(screen.getByRole('tab', { name: /Call screen/ }));
        expect(document.querySelector('img')?.getAttribute('src')).toBe('/p.jpg');
    });

    it('falls back to the first available kind and clicking a tab does not close', () => {
        const onClose = vi.fn();
        render(<ProfileImageViewer images={images} initialKind="group_thumbnail" onClose={onClose} />);
        expect(screen.getByRole('tab', { name: /Chat icon/ })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: /Call screen/ }));
        expect(onClose).not.toHaveBeenCalled();
    });
});
```

If `PhotoPlayer` renders `<img>` lazily or wraps it, adjust the `img` lookup to `screen.getByAltText('Media')` (the `alt` the modal passes) — check `PhotoPlayer.tsx` first and use whichever matches.

- [ ] **Step 3: Run to verify failure**

Run (in `frontend/`): `npx vitest run src/features/messages/components/ProfileImageViewer.test.tsx`
Expected: FAIL — cannot resolve `./ProfileImageViewer`.

- [ ] **Step 4: Implement**

`PhotoDetailModal.tsx`: add to `MediaViewerModalProps`:

```tsx
    /** Optional content shown top-centre (e.g. tabs); clicks on it don't close the viewer. */
    headerSlot?: React.ReactNode;
```

destructure `headerSlot`, and right after the close button render:

```tsx
            {headerSlot && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10" onClick={e => e.stopPropagation()}>
                    {headerSlot}
                </div>
            )}
```

Replace the `{/* Source label */}` block with:

```tsx
            {/* Source label: a jump link when it has a target, plain text otherwise */}
            {item.sourceLabel && item.onSourceJump && (
                <button
                    onClick={(e) => { e.stopPropagation(); item.onSourceJump!(); }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 hover:text-white text-sm max-w-[60vw] truncate transition-colors underline underline-offset-2 decoration-white/30 hover:decoration-white/60"
                >
                    {item.sourceLabel}
                </button>
            )}
            {item.sourceLabel && !item.onSourceJump && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/70 text-sm max-w-[60vw] truncate">
                    {item.sourceLabel}
                </div>
            )}
```

`frontend/src/features/messages/components/ProfileImageViewer.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import {
    KIND_I18N_KEY,
    PROFILE_IMAGE_KINDS,
    periodLabel,
    type ProfileImageKind,
    type ProfileImagesByKind,
} from '../profileImages';

interface ProfileImageViewerProps {
    images: ProfileImagesByKind;
    initialKind: ProfileImageKind;
    onClose: () => void;
}

/**
 * Member image history: one tab per kind (list icon / chat icon / call screen),
 * Left/Right through that kind's versions newest first. Copy/save follow the
 * existing 金手指 rule inside MediaViewerModal.
 */
export const ProfileImageViewer: React.FC<ProfileImageViewerProps> = ({ images, initialKind, onClose }) => {
    const { t } = useTranslation();
    const available = PROFILE_IMAGE_KINDS.filter(k => (images[k]?.length ?? 0) > 0);
    const [kind, setKind] = useState<ProfileImageKind>(available.includes(initialKind) ? initialKind : available[0]);
    const [index, setIndex] = useState(0);

    const items: MediaViewerItem[] = useMemo(() => {
        const entries = images[kind] ?? [];
        return entries.map((e, i) => ({
            src: e.url,
            type: 'picture' as const,
            timestamp: e.first_seen ?? '',
            sourceLabel: periodLabel(entries, i, t('profileImages.current')) || undefined,
        }));
    }, [images, kind, t]);

    if (available.length === 0) return null;

    const tabs = (
        <div role="tablist" className="flex gap-1.5">
            {available.map(k => (
                <button
                    key={k}
                    role="tab"
                    aria-selected={k === kind}
                    title={t(`profileImages.${KIND_I18N_KEY[k]}Hint`)}
                    onClick={() => { setKind(k); setIndex(0); }}
                    className={cn(
                        'px-3 py-1 rounded-full text-xs transition-colors',
                        k === kind ? 'bg-white text-gray-900' : 'bg-white/15 text-white/80 hover:bg-white/25',
                    )}
                >
                    {t(`profileImages.${KIND_I18N_KEY[k]}`)}
                    {k === kind && (images[k]?.length ?? 0) > 1 && ` ${index + 1}/${images[k]!.length}`}
                </button>
            ))}
        </div>
    );

    return (
        <MediaViewerModal
            mediaItems={items}
            currentIndex={Math.min(index, items.length - 1)}
            onClose={onClose}
            onNavigate={setIndex}
            headerSlot={tabs}
        />
    );
};
```

- [ ] **Step 5: Run tests and type-check**

Run (in `frontend/`): `npx vitest run src/features/messages src/core/media src/i18n && npx tsc --noEmit`
Expected: PASS (existing PhotoPlayer/VoicePlayer snapshot tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/core/media/PhotoDetailModal.tsx frontend/src/features/messages/components/ProfileImageViewer.tsx frontend/src/features/messages/components/ProfileImageViewer.test.tsx frontend/src/i18n/locales
uv run git commit -m "feat(media): add tabbed viewer for member image history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Entry points — profile card pills and member-list menu

**Files:**
- Create: `frontend/src/features/messages/components/ProfileImagePills.tsx`, `MemberContextMenu.tsx`, `ProfileImagePills.test.tsx`
- Modify: `MemberProfilePopup.tsx`, `MemberList.tsx`, `MessagesFeature.tsx` (popup props ~L878)

**Interfaces:**
- Consumes: `fetchProfileImages`, `ProfileImageViewer`, kinds helpers.
- Produces:
  - `MemberProfilePopup` new optional prop `memberPath?: string` (member dir; omitted for group chats → no pills).
  - `<ProfileImagePills images onOpen />`: `images: ProfileImagesByKind`, `onOpen: (kind: ProfileImageKind) => void`.
  - `<MemberContextMenu x y onViewImages onClose />`.

- [ ] **Step 1: Write the failing test**

`frontend/src/features/messages/components/ProfileImagePills.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileImagePills } from './ProfileImagePills';

describe('ProfileImagePills', () => {
    it('renders one pill per kind that has images, with a count only for history', () => {
        const onOpen = vi.fn();
        render(
            <ProfileImagePills
                images={{
                    thumbnail: [
                        { url: 'a', first_seen: null, current: true },
                        { url: 'b', first_seen: null, current: false },
                        { url: 'c', first_seen: null, current: false },
                    ],
                    phone_image: [{ url: 'p', first_seen: null, current: true }],
                }}
                onOpen={onOpen}
            />,
        );
        expect(screen.queryByText('List icon')).toBeNull();
        expect(screen.getByRole('button', { name: /Chat icon/ })).toHaveTextContent('3');
        expect(screen.getByRole('button', { name: /Call screen/ })).not.toHaveTextContent(/\d/);
        fireEvent.click(screen.getByRole('button', { name: /Call screen/ }));
        expect(onOpen).toHaveBeenCalledWith('phone_image');
    });

    it('renders nothing without images', () => {
        const { container } = render(<ProfileImagePills images={{}} onOpen={vi.fn()} />);
        expect(container).toBeEmptyDOMElement();
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run (in `frontend/`): `npx vitest run src/features/messages/components/ProfileImagePills.test.tsx`
Expected: FAIL — cannot resolve `./ProfileImagePills`.

- [ ] **Step 3: Implement the pills**

`ProfileImagePills.tsx`:

```tsx
import React from 'react';
import { List, MessageCircle, Phone } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { KIND_I18N_KEY, PROFILE_IMAGE_KINDS, type ProfileImageKind, type ProfileImagesByKind } from '../profileImages';

const ICONS: Record<ProfileImageKind, React.ComponentType<{ className?: string }>> = {
    group_thumbnail: List,
    thumbnail: MessageCircle,
    phone_image: Phone,
};

interface ProfileImagePillsProps {
    images: ProfileImagesByKind;
    onOpen: (kind: ProfileImageKind) => void;
}

/** Three small pills under the member name: list icon, chat icon, call screen. */
export const ProfileImagePills: React.FC<ProfileImagePillsProps> = ({ images, onOpen }) => {
    const { t } = useTranslation();
    const kinds = PROFILE_IMAGE_KINDS.filter(k => (images[k]?.length ?? 0) > 0);
    if (kinds.length === 0) return null;
    return (
        <div className="flex justify-center gap-1.5 mb-4">
            {kinds.map(k => {
                const Icon = ICONS[k];
                const count = images[k]!.length;
                return (
                    <button
                        key={k}
                        onClick={() => onOpen(k)}
                        title={t(`profileImages.${KIND_I18N_KEY[k]}Hint`)}
                        aria-label={t(`profileImages.${KIND_I18N_KEY[k]}`)}
                        className="inline-flex items-center gap-1 text-[11px] text-gray-600 bg-gray-100 border border-gray-200 rounded-full px-2.5 py-1 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                    >
                        <Icon className="w-3 h-3" />
                        {t(`profileImages.${KIND_I18N_KEY[k]}`)}
                        {count > 1 && (
                            <span className="text-[9px] text-white bg-sky-400 rounded-full px-1 leading-4" title={t('profileImages.versions', { count })}>
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
```

`MemberContextMenu.tsx` (pattern of `MessageContextMenu`):

```tsx
import React, { useEffect, useRef } from 'react';
import { Image } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Z_CLASS } from '../../../constants/zIndex';
import { Portal } from '../../../core/common/Portal';

interface MemberContextMenuProps {
    x: number;
    y: number;
    onViewImages: () => void;
    onClose: () => void;
}

export const MemberContextMenu: React.FC<MemberContextMenuProps> = ({ x, y, onViewImages, onClose }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    return (
        <Portal>
            <div
                ref={ref}
                role="menu"
                className={`fixed bg-white rounded-lg shadow-lg border border-gray-100 py-1 min-w-[140px] ${Z_CLASS.MODAL}`}
                style={{ left: x, top: y }}
            >
                <button
                    role="menuitem"
                    onClick={() => { onViewImages(); onClose(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                    <Image className="w-4 h-4" />
                    {t('profileImages.viewImages')}
                </button>
            </div>
        </Portal>
    );
};
```

- [ ] **Step 4: Wire the profile card**

In `MemberProfilePopup.tsx`:
- add `memberPath?: string;` to props (doc comment: "Member directory; pills/viewer are shown only when set (single-member chats)") and destructure it;
- state + effect:

```tsx
    const [images, setImages] = useState<ProfileImagesByKind>({});
    const [viewerKind, setViewerKind] = useState<ProfileImageKind | null>(null);

    useEffect(() => {
        if (!isOpen || !memberPath) { setImages({}); return; }
        const controller = new AbortController();
        fetchProfileImages(memberPath, controller.signal)
            .then(k => { if (!controller.signal.aborted) setImages(k); })
            .catch(() => { if (!controller.signal.aborted) setImages({}); });
        return () => controller.abort();
    }, [isOpen, memberPath]);
```

- make the large avatar a button when images exist:

```tsx
                        <button
                            type="button"
                            onClick={() => images.thumbnail?.length && setViewerKind('thumbnail')}
                            className={cn('w-48 h-48 rounded-full bg-white shadow-xl overflow-hidden border-4 border-white', images.thumbnail?.length ? 'cursor-zoom-in' : 'cursor-default')}
                            aria-label={t('profileImages.thumbnail')}
                        >
                            {/* existing <img> / initials fallback unchanged */}
                        </button>
```

- render `<ProfileImagePills images={images} onOpen={setViewerKind} />` directly under the `<h3 id="profile-title">` and change that `h3`'s `mb-6` to `mb-2`;
- render the viewer at the end of the Portal content:

```tsx
            {viewerKind && (
                <ProfileImageViewer images={images} initialKind={viewerKind} onClose={() => setViewerKind(null)} />
            )}
```

- the ESC handler of the popup must not close the popup while the viewer is open: change it to `if (e.key === 'Escape' && !viewerKind) onClose();` and add `viewerKind` to that effect's deps.

Imports: `cn` from `'../../../utils/classnames'`, `fetchProfileImages`, types from `'../profileImages'`, `ProfileImagePills`, `ProfileImageViewer`.

In `MessagesFeature.tsx` pass `memberPath={isGroupChat ? undefined : selectedGroupDir}` to `<MemberProfilePopup>`.

- [ ] **Step 5: Wire the member-list menu**

In `MemberList.tsx`:

```tsx
    const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
    const [viewer, setViewer] = useState<ProfileImagesByKind | null>(null);

    const openImages = (path: string) => {
        fetchProfileImages(path)
            .then(k => setViewer(k))
            .catch(err => console.error('Failed to load profile images:', err));
    };
```

On the row `<button>` add (single-member chats only):

```tsx
                        onContextMenu={info.isGroupChat ? undefined : (e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, path: info.path });
                        }}
```

At the end of the component's returned JSX:

```tsx
            {menu && (
                <MemberContextMenu x={menu.x} y={menu.y} onViewImages={() => openImages(menu.path)} onClose={() => setMenu(null)} />
            )}
            {viewer && (
                <ProfileImageViewer images={viewer} initialKind="thumbnail" onClose={() => setViewer(null)} />
            )}
```

- [ ] **Step 6: Run tests and type-check**

Run (in `frontend/`): `npx vitest run && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/messages
uv run git commit -m "feat(messages): open member images from profile card and list

Adds list icon / chat icon / call screen pills to the profile card, a
zoomable avatar, and a View images item on the member list's right-click.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Service rail shows the Japanese group name

**Files:**
- Modify: `frontend/src/core/layout/ServiceRail.tsx:6,150`
- Modify: `frontend/src/config/serviceThemes.test.ts` or create `frontend/src/data/services.test.ts`

- [ ] **Step 1: Write the failing test** — `frontend/src/data/services.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getServiceDisplayName } from './services';

describe('getServiceDisplayName (service rail tooltip)', () => {
    it.each([
        ['nogizaka46', '乃木坂46'],
        ['sakurazaka46', '櫻坂46'],
        ['hinatazaka46', '日向坂46'],
        ['yodel', 'Yodel'],
    ])('%s -> %s', (id, name) => {
        expect(getServiceDisplayName(id)).toBe(name);
    });
});
```

Run (in `frontend/`): `npx vitest run src/data/services.test.ts` — Expected: PASS already (guards the mapping the rail will now rely on).

- [ ] **Step 2: Implement**

`ServiceRail.tsx` line 6: add `getServiceDisplayName` to the import from `'../../data/services'`; line 150: `title={getServiceDisplayName(service)}`.

- [ ] **Step 3: Type-check and commit**

```bash
cd frontend && npx tsc --noEmit && cd ..
git add frontend/src/core/layout/ServiceRail.tsx frontend/src/data/services.test.ts
uv run git commit -m "fix(rail): show the Japanese group name on hover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Changelog, Windows verification, release wiring

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`), `docs/KNOWN_BUGS.md` (only if pysaka Task 5 shipped), `pyproject.toml` + `uv.lock` (pysaka pin, after release)

- [ ] **Step 1: CHANGELOG** (end-user wording per `docs/DOC_FORMATS.md`) under `## [Unreleased]`:

```markdown
### Added
- **See a member's list icon, chat icon and call-screen photo.** Open them from the new buttons on the profile card, by clicking the large avatar, or with View images on a member's right-click menu. Copy and save work like other photos.
- **Avatar history.** Every time a member changes one of these images, SakaDesk keeps the old one; flip through them with the arrow keys and see when each was in use.
- **Messages from just before you subscribed.** After updating, the next sync adds the day or so of messages the member sent right before your first subscription, which the app never downloaded before.

### Changed
- **Hovering a group in the left rail shows its Japanese name** (乃木坂46, 櫻坂46, 日向坂46) instead of an internal id.
- **The sidebar no longer re-reads your whole archive every two seconds**, and it pauses while the window is minimized. Avatars load from your local archive, so they also show offline.

### Fixed
- **Favoriting a message during a sync could lose the messages that sync had just downloaded.** Both now take turns writing the file.
- **One failed refresh no longer hides every unread badge** in the sidebar.
```

- [ ] **Step 2: Full verification**

```bash
uv run pytest -q
uv run ruff check . && uv run mypy backend
cd frontend && npx vitest run && npx tsc --noEmit && npm run build && cd ..
```

Expected: all green; paste counts into the PR.

- [ ] **Step 3: Windows dev-build check (user authorized driving the Windows app)**

Run the Windows-native dev servers from WSL (same keyring, no re-login):

```bash
powershell.exe -NoProfile -Command "Set-Location '\\wsl.localhost\Ubuntu\home\xtorker\repos\Project-Saka\SakaDesk'; powershell -ExecutionPolicy Bypass -File .\dev.ps1 start"
```

If the UNC path fails (uv venv on a network path), instead build and install a local Windows dev build via `build.ps1` as documented in its header, then launch it. Verify by hand and record results:
1. Trigger a sync; `/mnt/c/D/SakaDesk Output/*/messages/*/*/profile_images/index.json` files appear; the debug log shows `Past messages backfilled` lines for 中川 智尋 (9) and 上村 ひなの (27).
2. Profile card shows the pills; clicking the avatar / pills opens the tabbed viewer; with 金手指 off no Copy/Save, with it on Copy (Ctrl+C) and Save work.
3. Right-click a member → 查看圖片 opens the viewer.
4. Rail hover shows 日向坂46 etc.
5. Task Manager: SakaDesk backend CPU near idle while the sidebar is open; minimizing the window stops `/api/content/groups` requests in the debug log.
6. Toggle a favorite while a sync runs: no error, message count unchanged afterwards.

- [ ] **Step 4: After pysaka 0.4.5 is published** (`/release pysaka 0.4.5`):

```bash
uv add "pysaka==0.4.5"
uv sync
uv run pytest -q
git add pyproject.toml uv.lock CHANGELOG.md
uv run git commit -m "build(deps): require pysaka 0.4.5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: PR**

Push and open a PR to `dev` titled like a commit subject, body sections `## Why`, `## What`, `## Testing` (include benchmark lines from Task 5 and the Windows checklist results), `## Changelog`, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
