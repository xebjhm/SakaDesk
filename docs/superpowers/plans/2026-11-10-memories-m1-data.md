# Memories M1 — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared data layer that every Memories screen relies on:
- member birthdays (pysaka);
- an archived subscription start;
- favourite timestamps;
- oshi mirroring;
- the LLM-free selection rules;
- a cached per-member memory index.

**Architecture:**
- pysaka gains `get_member_birthdays()` on its blog scrapers (public official sites).
- SakaDesk gains a `backend/services/memories/` package:
  - `names` normalises member names;
  - `lexicon` / `selection` hold pure scoring rules;
  - `member_profiles`, `subscriptions` and `oshi` provide data;
  - `index` holds the SQLite cache of derived per-member data.
- Hooks:
  - sync refreshes subscriptions and profiles;
  - the favourites API logs `favorited_at` in `app_state.db`;
  - Settings mirrors the frontend oshi list.

**Tech Stack:** Python 3.12, FastAPI, aiohttp, BeautifulSoup (pysaka), SQLite (stdlib), pytest + respx + time-machine; React/TS (one small effect), vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-10-memories-design.md` (§3 Data layer is this plan's source of truth).
- All JST logic uses `zoneinfo.ZoneInfo("Asia/Tokyo")`; stored timestamps stay UTC ISO strings.
- Logs carry ids, codes, counts and scores only — never message text, nicknames, member names or paths; every decision / skip / fallback path logs a structured event.
- `uv run` for every Python command (never pip); commit with `uv run git commit`; Conventional Commits ≤ 72 chars; trailer `Co-Authored-By: <model> <noreply@anthropic.com>`.
- All file I/O `encoding="utf-8"`; `pathlib.Path`; no `print()`; no `time.sleep()`; CPU-heavy scans run via `asyncio.to_thread`.
- Never write to the user's live archive in tests; use `tmp_path` fixtures.
- pysaka is a separate repo (`/home/xtorker/repos/Project-Saka/pysaka`); SakaDesk CI installs pysaka from PyPI (`--no-sources`), so the pysaka change must be **released** (user approval) before the SakaDesk PR can go green. Locally SakaDesk uses the editable path.

---

## File map

| File | Responsibility |
|---|---|
| pysaka `src/pysaka/blog/base.py`, `hinatazaka.py`, `sakurazaka.py`, `nogizaka.py` | `get_member_birthdays() -> dict[str, str]` |
| pysaka `tests/test_blog_birthdays.py` + `tests/fixtures/blog/*` | parser tests on saved HTML/JSON |
| `backend/services/memories/__init__.py` | package marker |
| `backend/services/memories/names.py` | `normalize_member_name` |
| `backend/services/memories/lexicon.py` | keyword lists and regexes |
| `backend/services/memories/selection.py` | promo, greeting, importance, photo score, bursts, captions |
| `backend/services/memories/member_profiles.py` | birthday cache per service |
| `backend/services/memories/subscriptions.py` | earliest subscription start per group |
| `backend/services/memories/oshi.py` | oshi names per service from settings |
| `backend/services/memories/index.py` | per-member derived data, SQLite cache |
| `backend/services/app_state.py`, `backend/api/favorites.py` | `favorite_log` table + `favorited_at` |
| `backend/api/settings.py`, `frontend/src/shell/useOshiMirror.ts`, `frontend/src/shell/App.tsx` | oshi mirror |
| `backend/services/sync_service.py` | hooks: subscriptions + profiles refresh |

---

### Task 1 (pysaka): member birthdays from the official sites

**Files:**
- Modify: `src/pysaka/blog/base.py`, `src/pysaka/blog/hinatazaka.py`, `src/pysaka/blog/sakurazaka.py`, `src/pysaka/blog/nogizaka.py`
- Create: `tests/test_blog_birthdays.py`, fixtures under `tests/fixtures/blog/`
- Modify: `CHANGELOG.md` (`[Unreleased]`), `pyproject.toml` version → `0.4.7`

**Interfaces:**
- Produces: `async def get_member_birthdays(self) -> dict[str, str]` on every blog scraper. It maps the member display name exactly as the site writes it to `"YYYY-MM-DD"`. Members without a parsable birthday are omitted. Graduated members may be omitted. The base class default returns `{}`.

- [ ] **Step 1: Confirm the sources with the scrapers' own session (no header spoofing).**
  - Write a throwaway script in the scratchpad that uses each scraper's existing `self.session` / `base_url`. Do not add custom headers or bypass bot checks. If a site refuses (e.g. Nogizaka answers HTTP 202 with no body), record that and treat the group as "no birthdays" (return `{}`, log `birthdays_unavailable` with `status`).
  - Hinatazaka is verified: the artist page `/s/official/artist/{id}?ima=0000` has a `<td>生年月日</td>` followed by `<td class="c-member__info-td__text">2002年9月10日</td>`. The ids come from `/s/official/search/artist`, which is already parsed in `get_members_with_thumbnails`.
  - Sakurazaka: the artist page `/s/s46/artist/{id}?ima=0000`, with ids from `/s/s46/search/artist`. Expect a similar `生年月日` row; confirm it.
  - Nogizaka: the JSON at `/s/n46/api/list/member`, already used. Look for a `birthday` key (e.g. `"2003/08/08"`).
  - Save one real response per group as a fixture (trim to the relevant parts; no personal data beyond the public profile).

- [ ] **Step 2: Write failing tests** (`tests/test_blog_birthdays.py`)

```python
"""Member birthdays parsed from the official sites (Memories M1)."""

from pathlib import Path

FIX = Path(__file__).parent / "fixtures" / "blog"


def test_parse_japanese_date():
    from pysaka.blog.base import parse_jp_birthday

    assert parse_jp_birthday("2002年9月10日") == "2002-09-10"
    assert parse_jp_birthday(" 2003年12月1日 ") == "2003-12-01"
    assert parse_jp_birthday("2003/08/08") == "2003-08-08"
    assert parse_jp_birthday("不明") is None
    assert parse_jp_birthday("") is None


def test_hinatazaka_profile_parser():
    from pysaka.blog.hinatazaka import parse_birthday_from_profile

    html = (FIX / "hinatazaka_artist.html").read_text(encoding="utf-8")
    assert parse_birthday_from_profile(html) == "2002-09-10"


def test_hinatazaka_profile_without_birthday():
    from pysaka.blog.hinatazaka import parse_birthday_from_profile

    assert parse_birthday_from_profile("<html><body>no table</body></html>") is None
```

  Add the equivalent parser tests for Sakurazaka (`parse_birthday_from_profile` in `sakurazaka.py`) and Nogizaka (`birthdays_from_member_json(data: dict) -> dict[str, str]` in `nogizaka.py`), using the saved fixtures.
  Add one async test per scraper for `get_member_birthdays()`. Mock the HTTP layer the same way the existing blog scraper tests in `tests/` do (open one, e.g. the hinatazaka members test, and copy its mocking pattern). Cover three cases:
  - two members, one without a birthday: the result has only one entry;
  - a non-200 response: `{}` plus a `birthdays_unavailable` log;
  - profile pages fetched with a concurrency cap (see Step 3).

- [ ] **Step 3: Implement**
  - `base.py`: add `parse_jp_birthday(text: str) -> str | None`, which accepts `YYYY年M月D日` and `YYYY/M/D` and returns `YYYY-MM-DD`. Add `async def get_member_birthdays(self) -> dict[str, str]: return {}` with a docstring.
  - Hinatazaka and Sakurazaka:
    - `parse_birthday_from_profile(html) -> str | None`: BeautifulSoup; find the `td` whose stripped text is `生年月日`, then take the next `td`'s text.
    - `get_member_birthdays()`: reuse the artist search list (ids + names, excluding group accounts as the scrapers already do), then fetch each profile with `asyncio.Semaphore(4)` and a short `await asyncio.sleep(0.2)` between requests (be polite).
    - Logging: `birthdays_fetched` with `count`; failures log `birthday_fetch_failed` with `member_id` and `error_type`.
  - Nogizaka: `birthdays_from_member_json` reads `data["data"]` entries' `name` + `birthday`, skipping `code` 46/10001 like the existing filter.
  - Export nothing new at package level unless the blog API is re-exported there (follow `src/pysaka/blog/__init__.py`).

- [ ] **Step 4: Run the tests**
  - Run: `cd /home/xtorker/repos/Project-Saka/pysaka && uv run pytest tests/test_blog_birthdays.py -q && uv run pytest -q -p no:cacheprovider`
  - Expected: all pass. The `test_api_groups_fetch` keyring error is pre-existing on WSL; it is not a regression.

- [ ] **Step 5: Version and changelog, then commit**
  - Bump `pyproject.toml` to `0.4.7`, and run `uv lock` if the repo locks itself.
  - Add a `CHANGELOG.md` `[Unreleased]` → Added entry: "**Member birthdays.** Blog scrapers can read members' birthdays from the official profile pages (Hinatazaka, Sakurazaka; Nogizaka when its member API answers)."

```bash
cd /home/xtorker/repos/Project-Saka/pysaka
git checkout -b feat/member-birthdays origin/dev
git add src/pysaka/blog tests CHANGELOG.md pyproject.toml uv.lock
uv run git commit -m "feat(blog): read member birthdays from official profiles" -m "Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: names + member profile (birthday) cache

**Files:**
- Create: `backend/services/memories/__init__.py` (empty docstring), `backend/services/memories/names.py`, `backend/services/memories/member_profiles.py`
- Test: `backend/tests/test_memories_names.py`, `backend/tests/test_memories_member_profiles.py`

**Interfaces:**
- Consumes: pysaka scraper `get_member_birthdays()` (Task 1). Get scrapers the way `backend/services/blog_service.py` does for `get_members_with_thumbnails`.
- Produces:
  - `normalize_member_name(name: str) -> str`: NFKC, drops all whitespace (ASCII and U+3000) and the group suffix in full-width parentheses (e.g. `松田好花（日向坂46）` → `松田好花`).
  - `async refresh_member_profiles(service: str, service_data_dir: Path, *, now: datetime | None = None, force: bool = False) -> bool`: writes `service_data_dir / "memories" / "member_profiles.json"` = `{"updated_at": iso, "birthdays": {normalized_name: "YYYY-MM-DD"}}`. Skips (`member_profiles_skipped reason=fresh`) when updated less than 7 days ago unless forced. Returns whether it wrote. Unsupported services (Yodel) write nothing and log `reason=unsupported`.
  - `load_birthdays(service_data_dir: Path) -> dict[str, str]`: normalized name → date; `{}` when missing or corrupt (logs `member_profiles_unreadable`).

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_memories_names.py
from backend.services.memories.names import normalize_member_name


def test_normalize_spaces_and_width():
    assert normalize_member_name("金村 美玖") == "金村美玖"
    assert normalize_member_name("金村　美玖") == "金村美玖"
    assert normalize_member_name("ＫＡＮＥＭＵＲＡ") == "KANEMURA"


def test_normalize_group_suffix():
    assert normalize_member_name("松田好花（日向坂46）") == "松田好花"
    assert normalize_member_name("松田好花(日向坂46)") == "松田好花"
```

```python
# backend/tests/test_memories_member_profiles.py
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from backend.services.memories import member_profiles as mp

NOW = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_refresh_writes_normalized(tmp_path):
    scraper = AsyncMock()
    scraper.get_member_birthdays = AsyncMock(return_value={"金村 美玖": "2002-09-10"})
    with patch.object(mp, "_scraper_for", return_value=scraper):
        assert await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is True
    data = json.loads((tmp_path / "memories" / "member_profiles.json").read_text(encoding="utf-8"))
    assert data["birthdays"] == {"金村美玖": "2002-09-10"}
    assert mp.load_birthdays(tmp_path) == {"金村美玖": "2002-09-10"}


@pytest.mark.asyncio
async def test_refresh_skips_when_fresh(tmp_path):
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "member_profiles.json").write_text(
        json.dumps({"updated_at": (NOW - timedelta(days=2)).isoformat(), "birthdays": {}}), encoding="utf-8")
    with patch.object(mp, "_scraper_for") as factory:
        assert await mp.refresh_member_profiles("hinatazaka46", tmp_path, now=NOW) is False
    factory.assert_not_called()


@pytest.mark.asyncio
async def test_unsupported_service_writes_nothing(tmp_path):
    assert await mp.refresh_member_profiles("yodel", tmp_path, now=NOW) is False
    assert not (tmp_path / "memories" / "member_profiles.json").exists()


def test_load_corrupt_is_empty(tmp_path):
    (tmp_path / "memories").mkdir()
    (tmp_path / "memories" / "member_profiles.json").write_text("{not json", encoding="utf-8")
    assert mp.load_birthdays(tmp_path) == {}
```

- [ ] **Step 2: Run to verify failure:** `uv run pytest backend/tests/test_memories_names.py backend/tests/test_memories_member_profiles.py -q` → ImportError.

- [ ] **Step 3: Implement**

```python
# backend/services/memories/names.py
"""Member-name normalisation shared by Memories (matching across sources)."""

import re
import unicodedata

_SUFFIX = re.compile(r"[（(][^）)]*[）)]$")


def normalize_member_name(name: str) -> str:
    """NFKC, no whitespace, no trailing "(group)" suffix."""
    n = unicodedata.normalize("NFKC", name or "").strip()
    n = _SUFFIX.sub("", n)
    return re.sub(r"\s+", "", n)
```

  `member_profiles.py`:
  - `_scraper_for(service)` returns the pysaka blog scraper with an aiohttp session the same way `blog_service` builds one, or `None` for services without a blog site.
  - The write is atomic: write a temp file, then `os.replace`.
  - Logs: `member_profiles_refreshed count=`, `member_profiles_skipped reason=fresh|unsupported`, and `member_profiles_failed error_type=`. A failure keeps the old file.

- [ ] **Step 4: Run:** the same command → PASS.
- [ ] **Step 5: Commit** — `feat(memories): cache member birthdays per service`.

---

### Task 3: archive the earliest subscription start

**Files:**
- Create: `backend/services/memories/subscriptions.py`
- Modify: `backend/services/sync_service.py` (after `phase2_complete`, best-effort)
- Test: `backend/tests/test_memories_subscriptions.py`

**Interfaces:**
- Produces:
  - `async archive_subscription_starts(client, session, group_ids: list[int], service_data_dir: Path, *, today: date) -> int`. For each group not checked today, it calls `client.get_subscription_streak(session, gid)` and reads `current_start_at_date` (`YYYY-MM-DD`). It keeps the **earliest** value ever seen in `service_data_dir/memories/subscriptions.json` = `{"groups": {"<gid>": {"earliest_start": "YYYY-MM-DD", "last_checked": "YYYY-MM-DD"}}}`. It returns how many groups were checked.
    - Auth errors (`SessionExpiredError`, `RefreshFailedError`) propagate.
    - Any other per-group failure logs `subscription_start_failed group_id error_type` and continues.
  - `load_subscription_starts(service_data_dir: Path) -> dict[str, str]`: group_id → earliest start.

- [ ] **Step 1: Write failing tests**

```python
import json
from datetime import date
from unittest.mock import AsyncMock

import pytest

from backend.services.memories.subscriptions import archive_subscription_starts, load_subscription_starts


@pytest.mark.asyncio
async def test_keeps_earliest_and_checks_once_a_day(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(return_value={"current_start_at_date": "2025-03-01"})
    n = await archive_subscription_starts(client, None, [34], tmp_path, today=date(2026, 11, 10))
    assert n == 1 and load_subscription_starts(tmp_path) == {"34": "2025-03-01"}
    # A later streak (after a lapse) does not move the start forward.
    client.get_subscription_streak = AsyncMock(return_value={"current_start_at_date": "2026-01-05"})
    assert await archive_subscription_starts(client, None, [34], tmp_path, today=date(2026, 11, 11)) == 1
    assert load_subscription_starts(tmp_path) == {"34": "2025-03-01"}
    # Same day again: skipped, no request.
    client.get_subscription_streak.reset_mock()
    assert await archive_subscription_starts(client, None, [34], tmp_path, today=date(2026, 11, 11)) == 0
    client.get_subscription_streak.assert_not_called()


@pytest.mark.asyncio
async def test_failure_continues(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(side_effect=[RuntimeError("x"), {"current_start_at_date": "2024-02-02"}])
    assert await archive_subscription_starts(client, None, [1, 2], tmp_path, today=date(2026, 11, 10)) == 2
    assert load_subscription_starts(tmp_path) == {"2": "2024-02-02"}


@pytest.mark.asyncio
async def test_missing_field_is_ignored(tmp_path):
    client = AsyncMock()
    client.get_subscription_streak = AsyncMock(return_value=None)
    await archive_subscription_starts(client, None, [5], tmp_path, today=date(2026, 11, 10))
    assert load_subscription_starts(tmp_path) == {}
```

- [ ] **Step 2:** run → ImportError.
- [ ] **Step 3: Implement**
  - Write the JSON atomically.
  - Logs: `subscription_starts_archived checked= updated=` and `subscription_start_skipped reason=checked_today` (aggregated count).
  - Hook in `sync_service.py` right after the `phase2_complete` log:

```python
                try:
                    await archive_subscription_starts(
                        client, session,
                        sorted({int(g) for g in tasks_by_group}),
                        self.service_data_dir,
                        today=datetime.now(ZoneInfo("Asia/Tokyo")).date(),
                    )
                except (SessionExpiredError, RefreshFailedError):
                    raise
                except Exception as e:
                    logger.warning("subscription_starts_failed", error_type=type(e).__name__)
```

  Use whatever variable holds the synced group ids at that point (`tasks_by_group` keys in the current code). Add a sync-level test in the existing sync test file that the hook is called with the synced group ids and that a generic failure does not fail the sync.
- [ ] **Step 4:** run the new tests and `uv run pytest backend/tests -q -k "sync" -p no:cacheprovider` → PASS.
- [ ] **Step 5: Commit** — `feat(memories): archive the earliest subscription start`.

---

### Task 4: record when a message was favourited

**Files:**
- Modify: `backend/services/app_state.py` (new table + helpers), `backend/api/favorites.py`
- Test: `backend/tests/test_memories_favorite_log.py`

**Interfaces:**
- Produces in `app_state`:
  - `record_favorite(service: str, message_id: int, is_favorite: bool, *, at: datetime | None = None) -> None`. It upserts into table `favorite_log(service TEXT, message_id INTEGER, favorited_at TEXT, PRIMARY KEY(service, message_id))`; it deletes the row when `is_favorite` is False.
  - `favorited_at(service: str, message_ids: list[int]) -> dict[int, str]`.
  - The table is created in `init_db()`.
- Why not `messages.json`: pysaka drops custom fields when a sync re-fetches a message (see pysaka `update_message_fields_sync` docstring).

- [ ] **Step 1: Write failing tests**

```python
from datetime import datetime, timezone

from backend.services import app_state


def test_favorite_log_roundtrip(tmp_path):
    app_state.set_db_path(tmp_path / "s.db")
    app_state.init_db()
    at = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    app_state.record_favorite("hinatazaka46", 101, True, at=at)
    assert app_state.favorited_at("hinatazaka46", [101, 102]) == {101: at.isoformat()}
    app_state.record_favorite("hinatazaka46", 101, False)
    assert app_state.favorited_at("hinatazaka46", [101]) == {}
```

  Add a favourites-API test, extending the existing favourites test file: toggling on calls `record_favorite(service, id, True)`, toggling off calls it with False, and a `record_favorite` exception does not fail the API (it logs `favorite_log_failed`).
- [ ] **Step 2:** run → fail.
- [ ] **Step 3: Implement**
  - Follow `app_state`'s existing connection style.
  - In `favorites.py`, after the successful toggle, call `await asyncio.to_thread(app_state.record_favorite, service, message_id, is_favorite)` inside try/except.
- [ ] **Step 4:** run favourites + app_state tests → PASS.
- [ ] **Step 5: Commit** — `feat(memories): record when a message is favourited`.

---

### Task 5: mirror the oshi list to the backend

**Files:**
- Modify: `backend/api/settings.py` (`oshi_members: Optional[dict[str, list[str]]]` on `SettingsResponse` and `SettingsUpdate`, persisted like `user_nicknames`)
- Create: `backend/services/memories/oshi.py`
- Create: `frontend/src/shell/useOshiMirror.ts` (+ test); Modify: `frontend/src/shell/App.tsx` (call the hook once)
- Test: `backend/tests/test_memories_oshi.py`, `frontend/src/shell/useOshiMirror.test.ts`

**Interfaces:**
- Produces:
  - Backend `async oshi_names(service: str) -> set[str]`: normalized names of the oshi members. The settings store `oshi_members[service]` as blog member ids, which are resolved to names through `BlogService.get_blog_members(service)` (id → name) and normalized with `normalize_member_name`. Unknown ids are dropped (`oshi_unresolved count=`).
  - Frontend `useOshiMirror()`: whenever `useAppStore` `favorites` changes (and once after hydration), POST `/api/settings` with `{ oshi_members: favorites }`, debounced 1 s. Failures `console.warn` + `clientLog('oshi_mirror_failed', { error_type })`.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_memories_oshi.py
from unittest.mock import AsyncMock, patch

import pytest

from backend.services.memories import oshi


@pytest.mark.asyncio
async def test_resolves_blog_ids_to_normalized_names():
    with patch.object(oshi, "load_config", AsyncMock(return_value={"oshi_members": {"hinatazaka46": ["12", "99"]}})), \
         patch.object(oshi, "_blog_members", AsyncMock(return_value={"12": "金村 美玖"})):
        assert await oshi.oshi_names("hinatazaka46") == {"金村美玖"}


@pytest.mark.asyncio
async def test_no_setting_is_empty():
    with patch.object(oshi, "load_config", AsyncMock(return_value={})):
        assert await oshi.oshi_names("hinatazaka46") == set()
```

```ts
// frontend/src/shell/useOshiMirror.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '../store/appStore';
import { useOshiMirror } from './useOshiMirror';

describe('useOshiMirror', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response)); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('posts the favorites map, debounced', async () => {
        renderHook(() => useOshiMirror());
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '12'); });
        act(() => { useAppStore.getState().toggleFavorite('hinatazaka46', '15'); });
        await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
        const posts = vi.mocked(fetch).mock.calls.filter(([u, i]) => u === '/api/settings' && (i as RequestInit)?.method === 'POST');
        expect(posts.length).toBeGreaterThanOrEqual(1);
        const body = JSON.parse((posts.at(-1)![1] as RequestInit).body as string);
        expect(body.oshi_members.hinatazaka46).toEqual(expect.arrayContaining(['12', '15']));
    });
});
```

- [ ] **Step 2:** run both → fail.
- [ ] **Step 3: Implement**
  - Backend: follow `user_nicknames` in `settings.py` for the field.
  - `oshi.py`: `load_config` from `settings_store`; `_blog_members(service)` wraps `BlogService().get_blog_members(service)` (or the module's existing singleton accessor), catching errors → `{}` with log `oshi_members_unavailable`.
  - Frontend: subscribe with `useAppStore.subscribe` in an effect and clear the timer on unmount. Add `oshi_mirror_failed` to the clientLog union, and to the backend client-log allowlist if events are allowlisted (`backend/api/client_log.py`).
- [ ] **Step 4:** run backend + frontend tests and `cd frontend && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — `feat(memories): mirror the oshi list to backend settings`.

---

### Task 6: lexicon + selection rules (pure)

**Files:**
- Create: `backend/services/memories/lexicon.py`, `backend/services/memories/selection.py`
- Test: `backend/tests/test_memories_selection.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Msg: id: int; ts: datetime  # aware UTC; type: str; text: str; favorited: bool = False`
  - `is_promo(text: str) -> bool`
  - `greeting_class(text: str) -> str | None` → one of `"ohayo"|"oyasumi"|"daisuki"|"arigato"|"otsukare"|"ohiru"`, else None
  - `is_pure_greeting(text: str) -> bool`
  - `has_nickname(text: str) -> bool` (`%%%` or `％％％`)
  - `importance(msg: Msg, *, special: bool, repeated: bool) -> int` (spec §3.3 formula)
  - `find_bursts(items: list[Msg]) -> list[list[Msg]]` (photos/videos, same member, ≤ 10 min apart, ≥ 3)
  - `caption_for(photo: Msg, texts: list[Msg], burst: list[Msg] | None = None) -> Msg | None` (nearest non-promo text within ±3 min; burst window = burst ±3 min)
  - `photo_score(photo: Msg, caption: Msg | None, *, last_in_burst: bool, holiday: bool) -> int`
  - `jst(ts: datetime) -> datetime`
  - `special_dates(year: int, birthday: str | None, sub_start: str | None) -> set[date]` (her birthday + day after, 12/31, the subscription anniversary)

- [ ] **Step 1: Write failing tests**

```python
from datetime import datetime, timedelta, timezone

from backend.services.memories.selection import (
    Msg, caption_for, find_bursts, greeting_class, has_nickname, importance, is_promo,
    is_pure_greeting, photo_score,
)

T0 = datetime(2026, 9, 14, 12, 0, tzinfo=timezone.utc)


def m(i, minutes=0, type_="text", text="", fav=False):
    return Msg(id=i, ts=T0 + timedelta(minutes=minutes), type=type_, text=text, favorited=fav)


def test_promo():
    assert is_promo("詳細はコチラ https://example.jp")
    assert is_promo("お知らせ！新曲の発売と予約が始まりました、ぜひチェックしてね" + "あ" * 80)
    assert is_promo("19:00〜 20:00〜 21:00〜 出演します")
    assert not is_promo("今日もお疲れさま！ゆっくり休んでね🌙")


def test_greetings():
    assert greeting_class("おはよう☀️") == "ohayo"
    assert greeting_class("おやすみ〜🌙 また明日ね") == "oyasumi"
    assert greeting_class("%%%ちゃん大好き！") == "daisuki"
    assert is_pure_greeting("おやすみなさい")
    assert not is_pure_greeting("おやすみ、今日のライブ本当にありがとう")
    assert has_nickname("％％％さん") and not has_nickname("みんな")


def test_importance_formula():
    base = m(1, text="あ" * 50)
    assert importance(base, special=False, repeated=False) == 50
    rich = m(2, text="%%%ちゃん本当にありがとう", fav=True)
    assert importance(rich, special=True, repeated=False) == len(rich.text) + 300 + 80 + 100 + 150
    assert importance(m(3, text="おやすみなさい"), special=False, repeated=False) < 0
    assert importance(m(4, text="あ" * 20), special=False, repeated=True) < 0


def test_bursts_and_captions():
    photos = [m(10, 0, "picture"), m(11, 4, "picture"), m(12, 9, "picture"), m(13, 30, "picture")]
    bursts = find_bursts(photos)
    assert [[p.id for p in b] for b in bursts] == [[10, 11, 12]]
    texts = [m(20, 11, text="ライブ最高だった！"), m(21, 40, text="詳細はコチラ https://x.jp")]
    assert caption_for(photos[0], texts, bursts[0]).id == 20      # burst window
    assert caption_for(photos[3], texts) is None                   # promo / out of window


def test_photo_score():
    p, cap = m(1, type_="picture", fav=True), m(2, text="おやすみ🌙")
    assert photo_score(p, cap, last_in_burst=True, holiday=False) == 500 + 150 + 80 + 100
```

  Add tests for:
  - full-width / emoji text;
  - `special_dates`;
  - the holiday / 20–24h bonus (JST 20:00 = UTC 11:00).

- [ ] **Step 2:** run → ImportError.
- [ ] **Step 3: Implement** — `lexicon.py` holds the spec §3.3 lists verbatim:
  - `PROMO_WORDS`;
  - `URL_RE`;
  - `TIME_RE = r"\d{1,2}:\d{2}〜?"`;
  - `EMOTION_WORDS = ("ありがとう","感謝","大好き","本当に","嬉しい","悔しい","涙","目標","夢","卒業","ライブ","ミーグリ","誕生日")`;
  - the greeting regexes;
  - `PURE_GREETING_RE`.

  `selection.py` implements the formulas exactly:
  - Importance: `chars + 300·fav + 80·nickname + 100·emotion + 150·special`, then `−200` for a pure greeting and `−300` when repeated.
  - Photo score: `500·fav + 150·caption + 80·caption_has(%%%|おはよ|おやすみ|好き) + 100·last_in_burst + 80·(JST 20–24h or holiday)`.
  - Promo rule: a URL, or 2+ promo words, or 1 promo word with > 80 chars, or ≥ 3 time patterns.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** — `feat(memories): add the shared selection rules and lexicon`.

---

### Task 7: memory index service (cached per-member derived data)

**Files:**
- Create: `backend/services/memories/index.py`
- Test: `backend/tests/test_memories_index.py`

**Interfaces:**
- Consumes: `selection` (Task 6), `load_birthdays` (Task 2), `load_subscription_starts` (Task 3), `favorited_at` (Task 4), `normalize_member_name` (Task 2).
- Produces:
  - `@dataclass class MemberIndex`:
    - `member_dir: str` (POSIX, relative to the service dir)
    - `member_id: str`
    - `name_norm: str`
    - `hour_hist: list[int]` (24, JST)
    - `first_ts: dict[str, str]` (type → ISO)
    - `first_nickname_id: int | None`
    - `counts_by_year: dict[int, dict[str, int]]`
    - `longest_streak_days: int`
    - `bursts: list[list[int]]`
    - `captions: dict[int, int]` (photo id → text id)
    - `importance: dict[int, int]` (text ids, non-promo)
    - `photo_scores: dict[int, int]`
    - `promo_ids: set[int]`
    - `nickname_count: int`
    - `greeting_counts: dict[str, int]`
    - `birthday: str | None`
    - `subscription_start: str | None`
    - `graduated: bool`
    - `data_hash: str`
  - `async get_member_index(service_data_dir: Path, member_dir: Path) -> MemberIndex`. Returns the cached value when `data_hash` (size + mtime of `messages.json` + the inputs' file hashes) matches; otherwise rebuilds in `asyncio.to_thread` and stores the result.
  - `async build_all(service_data_dir: Path) -> int` (rebuild stale members; returns the count).
  - Cache: SQLite at `get_app_data_dir() / "memories_index.db"`, table `member_index(service_dir TEXT, member_dir TEXT, data_hash TEXT, payload TEXT, PRIMARY KEY(service_dir, member_dir))`. Payload is JSON. Set the DB path through `set_db_path` for tests.
  - Logs:
    - `memory_index_hit` and `memory_index_built member_id elapsed_ms msgs`;
    - `memory_index_failed error_type` (on failure, return an empty index for that member rather than raising).
- Graduation: read `sync_metadata.json` `server_groups[gid].state == "closed"`. The group id is the leading integer of the group dir name.

- [ ] **Step 1: Write failing tests** (synthetic `messages.json` in `tmp_path`, non-ASCII, emoji):

```python
import json
from datetime import datetime, timezone

import pytest

from backend.services.memories import index as mi


def write_member(root, msgs):
    d = root / "messages" / "34 金村 美玖" / "58 金村 美玖"
    d.mkdir(parents=True)
    (d / "messages.json").write_text(json.dumps({"member": {"id": "58", "name": "金村 美玖"}, "messages": msgs}, ensure_ascii=False), encoding="utf-8")
    return d


def msg(i, ts, type_="text", content=""):
    return {"id": i, "timestamp": ts, "type": type_, "content": content, "is_favorite": False}


@pytest.mark.asyncio
async def test_builds_and_caches(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [
        msg(1, "2026-09-14T03:00:00Z", content="おはよう☀️"),                 # JST 12:00
        msg(2, "2026-09-14T12:30:00Z", content="%%%ちゃん、おやすみ🌙"),      # JST 21:30
        msg(3, "2026-09-14T12:31:00Z", "picture"), msg(4, "2026-09-14T12:33:00Z", "picture"),
        msg(5, "2026-09-14T12:36:00Z", "picture"),
        msg(6, "2026-09-15T12:00:00Z", content="詳細はコチラ https://x.jp"),
    ])
    idx = await mi.get_member_index(tmp_path, d)
    assert idx.hour_hist[21] == 4 and idx.nickname_count == 1
    assert idx.first_nickname_id == 2 and idx.bursts == [[3, 4, 5]]
    assert idx.captions[3] == 2 and 6 in idx.promo_ids
    assert idx.greeting_counts["oyasumi"] == 1 and idx.longest_streak_days == 2
    again = await mi.get_member_index(tmp_path, d)   # cache hit
    assert again.data_hash == idx.data_hash


@pytest.mark.asyncio
async def test_rebuilds_when_messages_change(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = write_member(tmp_path, [msg(1, "2026-09-14T03:00:00Z", content="a")])
    first = await mi.get_member_index(tmp_path, d)
    (d / "messages.json").write_text(json.dumps({"member": {"id": "58", "name": "金村 美玖"}, "messages": [
        msg(1, "2026-09-14T03:00:00Z", content="a"), msg(2, "2026-09-15T03:00:00Z", content="b")]}), encoding="utf-8")
    second = await mi.get_member_index(tmp_path, d)
    assert second.data_hash != first.data_hash and sum(second.hour_hist) == 2


@pytest.mark.asyncio
async def test_corrupt_messages_returns_empty_index(tmp_path):
    mi.set_db_path(tmp_path / "idx.db")
    d = tmp_path / "messages" / "1 x" / "2 x"
    d.mkdir(parents=True)
    (d / "messages.json").write_text("{bad", encoding="utf-8")
    idx = await mi.get_member_index(tmp_path, d)
    assert sum(idx.hour_hist) == 0
```

  Add tests for:
  - `birthday` / `subscription_start` / `graduated`, from fixture files written by the Task 2 and Task 3 helpers and a `sync_metadata.json`;
  - `build_all` counting only stale members.
- [ ] **Step 2:** run → ImportError.
- [ ] **Step 3: Implement**
  - A single pass over the messages, sorted by timestamp.
  - Repeated sentences (for `importance`): normalize with NFKC and strip; count over the member's text messages.
  - Streak: consecutive JST dates.
  - Store JSON with `ensure_ascii=False`.
- [ ] **Step 4:** run → PASS; then time a build on the read-only real archive copy. If the real archive is available on this machine, use a throwaway script that reads `/mnt/c/D/SakaDesk Output` without writing, with exact paths only, and never scans `/mnt/c` recursively. Record `elapsed_ms` per member in the report; target < 1 s for 10k messages.
- [ ] **Step 5: Commit** — `feat(memories): cache per-member memory index in SQLite`.

---

### Task 8: refresh hooks, docs, full verification

**Files:**
- Modify: `backend/services/sync_service.py`: after a completed sync, schedule `refresh_member_profiles(service, service_data_dir)` and `build_all(service_data_dir)` as tracked background tasks (`track_background_task`). Never block the sync. Log `memories_refresh_scheduled`.
- Modify: `pyproject.toml` (SakaDesk): `pysaka>=0.4.7`; run `uv lock`.
- Modify: `CHANGELOG.md` `[Unreleased]`: no user-facing entry yet (the data layer has no UI). Do not add one.
- Test: extend the sync tests so that a completed sync schedules both refreshes and a failed refresh does not affect sync results.

- [ ] **Step 1:** write the sync hook test (patch both functions with AsyncMock; assert they are scheduled after `progress.complete()`).
- [ ] **Step 2:** implement the hook.
- [ ] **Step 3: Full verification:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run python -m pytest backend/tests/ tests/ -q -p no:cacheprovider
cd frontend && npx vitest run && npx tsc --noEmit -p . && cd ..
uv run ruff check . && uv run mypy backend
```

  Expected: all pass (the existing 6 warnings are allowed, since they also exist on `dev`).
- [ ] **Step 4: Commit** — `feat(memories): refresh profiles and the index after sync`.
- [ ] **Step 5: pysaka release gate (ask the user).** SakaDesk CI needs pysaka 0.4.7 on PyPI. Ask the user to approve `/release pysaka 0.4.7`. Until then, keep the SakaDesk branch local or push it without merging.
