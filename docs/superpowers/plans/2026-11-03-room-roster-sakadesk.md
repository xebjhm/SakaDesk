# Complete Room Archives (SakaDesk side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use pysaka 0.4.6's room roster so SakaDesk archives every author of a room. Each room's history is scanned once, slowly. Recovered messages are kept out of the new-message counts. Progress tells the user what is happening.

**Architecture:**
- `SyncService.start_sync` → `sync_group`:
  1. Full-fetch each unscanned room behind a scan semaphore (`page_delay=1.0`).
  2. Sync API members plus `manager.extra_room_members(...)`, with `ignore_cursor` during a scan.
  3. Mark the room scanned after `room_archive_complete`.
  4. Exclude recovered counts from totals and notifications, and index recovered members with `full_member_scan`.
- `ProgressTracker` gains `extend_total` and a `detail_code` that the frontend localises.
- `MessageList` gives member 0 (the room author) no avatar click.

**Tech Stack:** FastAPI backend (Python 3.12, pytest), React + TypeScript frontend (vitest), i18n JSON in 5 locales; uv only.

Spec: `../pysaka/docs/superpowers/specs/2026-11-03-room-roster-v046-design.md` §4, §7. pysaka plan: `../pysaka/docs/superpowers/plans/2026-11-03-room-roster-v046.md`. Its Tasks 1–6 must be merged on the pysaka branch first; SakaDesk uses `../pysaka` editable.

## Global Constraints

- pysaka API used (exact names):
  - `manager.history_scanned(gid) -> bool`;
  - `manager.mark_history_scanned(gid)`;
  - `await manager.room_archive_complete(group, messages) -> bool`;
  - `await manager.extra_room_members(session, group, api_members, messages, name_hints) -> list[dict]`;
  - `manager.sync_member(..., ignore_cursor=True)`;
  - `client.get_messages(..., page_delay=1.0)`.
- Scans run one room at a time (`asyncio.Semaphore(1)` created per `start_sync`). Incremental rooms stay concurrent as today.
- Pass `ignore_cursor=True` / `page_delay=1.0` **only** for scanned rooms, so existing call assertions stay valid.
- Extra members are never written to `metadata["groups"]`; `check_new_messages` is unchanged.
- Extra members bypass `initial_limit` (default 0 = off).
- A failure in `extra_room_members` other than `SessionExpiredError`/`RefreshFailedError` is logged as `room_extra_members_failed` (`group_id`, `error_type`) and the room continues with no extras. Auth errors re-raise.
- New progress field `detail_code`: `"scanning_history"` while a room's history fetch runs, otherwise None.
- i18n key `sync.scanningHistory` in all five locales, with these exact values:
  - en: `First-time full scan of chat history…`
  - ja: `トーク履歴を初回スキャン中…`
  - zh-TW: `首次完整掃描聊天室歷史…`
  - zh-CN: `首次完整扫描聊天室历史…`
  - yue: `第一次完整掃描聊天室歷史…`
- Never log message text, letter text, signed URLs or tokens.
- CHANGELOG entries are for end users: bold symptom/benefit lead-in, ≤ 3 sentences, no code identifiers (see `docs/DOC_FORMATS.md`).
- Commit with `uv run git commit -F <unique file>`; Conventional Commits ≤ 72 chars; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Backend tests: `uv run pytest backend/tests/<file> -q`. Frontend: `cd frontend && npx vitest run <file>` and `npx tsc --noEmit`.

Branch: `feat/room-roster` from `dev`.

---

### Task 1: Progress `extend_total` + `detail_code` + localized scanning text

**Files:**
- Modify: `backend/api/progress.py` (`reset`, `start_phase`, new methods, `get_status`)
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (`SyncProgress` interface ~line 41; detail render ~line 726)
- Modify: `frontend/src/utils/syncFormatters.ts` (new `getSyncDetail`)
- Modify: `frontend/src/shell/components/SyncModal.tsx` (~line 181), `frontend/src/core/layout/InlineSyncView.tsx` (~line 124)
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json` (`sync.scanningHistory`)
- Test: `backend/tests/test_progress.py`, `frontend/src/utils/syncFormatters.test.ts`

**Interfaces:**
- Produces:
  - `ProgressTracker.extend_total(n: int) -> None`;
  - `ProgressTracker.set_detail_code(code: Optional[str]) -> None`;
  - `get_status()["detail_code"]`;
  - TS `SyncProgress.detail_code?: string | null`;
  - `getSyncDetail(syncProgress: SyncProgress, t: (key: string) => string, fallback: string): string`.

- [ ] **Step 1: Failing backend tests** (append to `backend/tests/test_progress.py`; follow its existing import of the tracker class)

```python
def test_extend_total_grows_current_phase():
    p = ProgressTracker()
    p.start_phase("syncing", "Collecting Metadata", 2, 3, "members")
    p.update(3)
    p.extend_total(2)
    status = p.get_status()
    assert status["total"] == 5 and status["completed"] == 3


def test_detail_code_set_and_cleared():
    p = ProgressTracker()
    assert p.get_status()["detail_code"] is None
    p.set_detail_code("scanning_history")
    assert p.get_status()["detail_code"] == "scanning_history"
    p.start_phase("downloading", "Downloading Media", 3, 1, "files")
    assert p.get_status()["detail_code"] is None
```

(Use the class name the file already imports. If it is not `ProgressTracker`, rename it in the test.)

- [ ] **Step 2: Failing frontend test** (append to `frontend/src/utils/syncFormatters.test.ts`)

```ts
import { getSyncDetail } from './syncFormatters';

describe('getSyncDetail', () => {
    const t = (k: string) => (k === 'sync.scanningHistory' ? 'SCAN' : k);
    it('returns detail or fallback without a code', () => {
        expect(getSyncDetail({ state: 'running', detail: '高井 俐香 (3)' }, t, 'FALLBACK')).toBe('高井 俐香 (3)');
        expect(getSyncDetail({ state: 'running' }, t, 'FALLBACK')).toBe('FALLBACK');
    });
    it('prefixes the localized scanning text', () => {
        expect(getSyncDetail({ state: 'running', detail: '日向坂46', detail_code: 'scanning_history' }, t, 'F')).toBe('SCAN · 日向坂46');
        expect(getSyncDetail({ state: 'running', detail_code: 'scanning_history' }, t, 'F')).toBe('SCAN');
    });
});
```

- [ ] **Step 3: Run both** — `uv run pytest backend/tests/test_progress.py -q` and `cd frontend && npx vitest run src/utils/syncFormatters.test.ts` → FAIL.

- [ ] **Step 4: Implement backend** (`backend/api/progress.py`)

- In `reset()`: `self._detail_code: Optional[str] = None`.
- In `start_phase()`: `self._detail_code = None`.
- New methods:

```python
    def extend_total(self, n: int):
        """Grow the current phase's total (e.g. room authors found mid-phase)."""
        with self._lock:
            self._total += n

    def set_detail_code(self, code: Optional[str]):
        """Set a machine-readable detail (e.g. "scanning_history") the frontend
        localises; None clears it. Cleared by start_phase."""
        with self._lock:
            self._detail_code = code
```

- In `get_status()`, add `"detail_code": self._detail_code,` after `"detail_extra"`.

- [ ] **Step 5: Implement frontend**

- `SyncProgress` (MessagesFeature.tsx): add `detail_code?: string | null;` after `detail_extra`.
- `syncFormatters.ts`:

```ts
/** Detail line for a sync progress state; prefixes known detail codes with their localized text. */
export function getSyncDetail(
    syncProgress: SyncProgress,
    t: (key: string) => string,
    fallback: string,
): string {
    const detail = syncProgress.detail || '';
    if (syncProgress.detail_code === 'scanning_history') {
        const scanning = t('sync.scanningHistory');
        return detail ? `${scanning} · ${detail}` : scanning;
    }
    return detail || fallback;
}
```

- Replace in the three render sites:
  - SyncModal.tsx: `{syncProgress.detail || t('sync.processing')}` → `{getSyncDetail(syncProgress, t, t('sync.processing'))}`.
  - InlineSyncView.tsx: same replacement.
  - MessagesFeature.tsx ~726: `{syncProgress.detail || t('sync.syncing')}` → `{getSyncDetail(syncProgress, t, t('sync.syncing'))}`.
  - Import `getSyncDetail` from `../../utils/syncFormatters` (adjust the relative path per file).
- Add `"scanningHistory"` under `"sync"` in each locale with the exact strings from Global Constraints.

- [ ] **Step 6: Run** backend test file, `npx vitest run src/utils/syncFormatters.test.ts src/shell/components/SyncModal.test.tsx`, `npx tsc --noEmit` → PASS.

- [ ] **Step 7: Commit:** `feat(sync): show history scan progress and grow member totals`

---

### Task 2: `sync_group` uses the room roster and the one-time scan

**Files:**
- Modify: `backend/services/sync_service.py`:
  - before Phase 2 (~line 466): `name_hints`, `scan_sem`, `recovered_keys`;
  - `sync_group` (~lines 497–640): scan fetch, extras, `ignore_cursor`, mark;
  - aggregation (~lines 698–740): totals exclusion, search full scan.
- Test: `backend/tests/test_sync_room_roster.py` (new; reuse `_run_start_sync` and helpers by importing them from `backend.tests.test_sync_service_core`, or copy the helper if importing a test module is not done elsewhere)

**Interfaces:**
- Consumes: pysaka APIs in Global Constraints; `progress.extend_total`, `progress.set_detail_code` (Task 1).

- [ ] **Step 1: Failing tests** (`backend/tests/test_sync_room_roster.py`)

```python
"""Room roster + one-time history scan in SyncService (spec §4, §7)."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.services.sync_service import SyncService
from backend.tests.test_sync_service_core import _make_message, _run_start_sync

GROUP = {"id": 43, "name": "日向坂46", "state": "open", "subscription": {"state": "active"}}
API_MEMBERS = [{"id": 79, "name": "日向坂46", "thumbnail": None, "portrait": None}]
EXTRA = [{"id": 22, "name": "潮 紗理菜"}, {"id": 0, "name": "日向坂46", "thumbnail": None}]


def _manager(*, scanned: bool, complete: bool = True, extra=EXTRA, sync_counts=None):
    client = MagicMock()
    client.access_token = "tok"
    client.refresh_if_needed = AsyncMock()
    client.get_groups = AsyncMock(return_value=[GROUP])
    client.get_members = AsyncMock(return_value=API_MEMBERS)
    client.get_messages = AsyncMock(
        return_value=[
            _make_message(1, 79, "2022-04-01T03:05:10Z"),
            _make_message(2, 22, "2021-09-16T06:37:53Z"),
            {"id": 3, "published_at": "2022-04-01T03:00:10Z", "text": "x"},
        ]
    )
    m = MagicMock()
    m.client = client
    m.get_last_ts = MagicMock(side_effect=lambda gid, mid: "2026-10-01T00:00:00Z" if mid == 79 else None)
    m.get_last_id = MagicMock(return_value=None)
    counts = sync_counts or {79: 1, 22: 50, 0: 3}
    m.sync_member = AsyncMock(side_effect=lambda s, g, member, q, **kw: counts.get(member["id"], 0))
    m.process_media_queue = AsyncMock(return_value={})
    m.backfill_past_messages = AsyncMock(return_value=0)
    m.sync_letters = AsyncMock(return_value=0)
    m.history_scanned = MagicMock(return_value=scanned)
    m.mark_history_scanned = MagicMock()
    m.room_archive_complete = AsyncMock(return_value=complete)
    m.extra_room_members = AsyncMock(return_value=extra)
    return m


async def test_unscanned_room_full_fetch_paced_and_marked(tmp_path):
    m = _manager(scanned=False)
    await _run_start_sync(SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m)

    _, kw = m.client.get_messages.await_args
    assert kw.get("since_ts") is None and kw.get("page_delay") == 1.0
    synced = [c.args[2]["id"] for c in m.sync_member.await_args_list]
    assert synced == [79, 22, 0]
    assert all(c.kwargs.get("ignore_cursor") is True for c in m.sync_member.await_args_list)
    m.mark_history_scanned.assert_called_once_with(43)


async def test_incomplete_scan_not_marked(tmp_path):
    m = _manager(scanned=False, complete=False)
    await _run_start_sync(SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m)
    m.mark_history_scanned.assert_not_called()


async def test_scanned_room_incremental_without_new_kwargs(tmp_path):
    m = _manager(scanned=True, extra=[])
    await _run_start_sync(SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m)
    _, kw = m.client.get_messages.await_args
    assert kw.get("since_ts") is not None and "page_delay" not in kw
    assert all("ignore_cursor" not in c.kwargs for c in m.sync_member.await_args_list)
    m.mark_history_scanned.assert_not_called()


async def test_recovered_counts_excluded_from_notification(tmp_path):
    notify = AsyncMock()
    m = _manager(scanned=False)
    await _run_start_sync(SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m, notify_mock=notify)
    notify.assert_not_awaited()  # everything in a scanned room is recovered, not new


async def test_extra_members_not_written_to_metadata(tmp_path):
    saved: dict = {}
    m = _manager(scanned=False)
    await _run_start_sync(SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m, saved=saved)
    keys = set(saved["groups"])
    assert "43_79" in keys and "43_22" not in keys and "43_0" not in keys


async def test_extra_member_failure_is_isolated(tmp_path):
    m = _manager(scanned=False)
    m.extra_room_members = AsyncMock(side_effect=RuntimeError("boom"))
    await _run_start_sync(SyncService(), tmp_path, groups=[GROUP], members=API_MEMBERS, mock_manager=m)
    assert [c.args[2]["id"] for c in m.sync_member.await_args_list] == [79]
    m.mark_history_scanned.assert_called_once_with(43)  # room_archive_complete mocked True here
```

In the last test, the mark happens because the mocked `room_archive_complete` returns True. The production guard is the real `room_archive_complete`, which returns False when the extras' messages are missing. That is covered in pysaka's tests.

Add one more test (scan semaphore):
- two unscanned groups whose `get_messages` side effect records start/finish order with an `asyncio.sleep(0)` in between;
- assert the second fetch does not start before the first finishes.

Use `asyncio.Event`s, or a list of `("start", gid)` / `("end", gid)` and check it is never `start, start`.

- [ ] **Step 2: Run** `uv run pytest backend/tests/test_sync_room_roster.py -q` → FAIL.

- [ ] **Step 3: Implement**

Before `async def sync_group` (after `backfilled_members` is declared):

```python
                # Every API member of this sync by id: names for room authors
                # missing from a room's own member list (pysaka extra_room_members).
                name_hints = {t["member"]["id"]: t["member"] for t in tasks}
                # One-time room history scans re-read whole timelines; run them one
                # at a time (with page_delay) to stay under the API rate limit.
                scan_sem = asyncio.Semaphore(1)
                # (group_id, member_id) whose counts are recovered history, not new:
                # every task of a room scanned in this sync, and extra members with
                # no cursor before it. Excluded from totals/notifications, indexed fully.
                recovered_keys: set[tuple[int, int]] = set()
```

In `sync_group`:

- At the start: `group = group_tasks[0]["group"]` and `scan = not self.manager.history_scanned(gid)`.
- After computing `min_since_ts`: `if scan: min_since_ts = None`.
- Replace the single `get_messages` call:

```python
                    if scan:
                        async with scan_sem:
                            progress.set_detail_code("scanning_history")
                            progress.set_detail(g_name)
                            try:
                                all_messages = await self.manager.client.get_messages(
                                    session, gid, since_ts=None, page_delay=1.0
                                )
                            finally:
                                progress.set_detail_code(None)
                    else:
                        all_messages = await self.manager.client.get_messages(
                            session, gid, since_ts=min_since_ts
                        )

                    try:
                        extra_members = await self.manager.extra_room_members(
                            session,
                            group,
                            [t["member"] for t in group_tasks],
                            all_messages,
                            name_hints,
                        )
                    except (SessionExpiredError, RefreshFailedError):
                        raise
                    except Exception as e:
                        logger.warning(
                            "room_extra_members_failed",
                            group_id=gid,
                            error_type=type(e).__name__,
                        )
                        extra_members = []
                    if extra_members:
                        progress.extend_total(len(extra_members))
                    run_list = list(zip(group_tasks, since_timestamps)) + [
                        ({"group": group, "member": m}, self.manager.get_last_ts(gid, m["id"]))
                        for m in extra_members
                    ]
                    n_api = len(group_tasks)
```

- Change the loop header to `for idx, (task, member_ts) in enumerate(run_list):`.
- Then `is_extra = idx >= n_api`.
- Apply the `initial_limit` slicing only when `not is_extra`.
- The `sync_member` call becomes:

```python
                        count = await self.manager.sync_member(
                            session,
                            task["group"],
                            task["member"],
                            media_queue,
                            prefetched_messages=member_prefetched,
                            **({"ignore_cursor": True} if scan else {}),
                        )
                        if scan or (is_extra and member_ts is None):
                            recovered_keys.add((gid, member_id))
                            backfilled_members[(gid, member_id)] = (task["group"], task["member"])
```

(Leave the existing backfill/letters/progress code in the loop unchanged. pysaka returns 0 from backfill/letters for member 0.)

After the loop, before `group_new = ...`:

```python
                    if scan and await self.manager.room_archive_complete(group, all_messages):
                        self.manager.mark_history_scanned(gid)
```

Aggregation (the `for task, count in results:` loop): count toward the totals only when not recovered.

```python
                for task, count in results:
                    if count > 0:
                        key_t = (task["group"]["id"], task["member"]["id"])
                        if key_t not in recovered_keys:
                            total_new_messages += count
                            members_with_new += 1
                        key = f"{task['group']['id']}_{task['member']['id']}"
                        ...  # existing metadata update unchanged
```

The search block already merges `backfilled_members` into `changed` and passes `full_member_scan=list(backfilled_members)`. Recovered members are in `backfilled_members`, so they get a full scan. Update that comment to mention scanned rooms.

- [ ] **Step 4: Run** `uv run pytest backend/tests/test_sync_room_roster.py backend/tests/test_sync_service_core.py backend/tests/test_sync_service_extended.py -q` → PASS. Then the full backend suite `uv run pytest backend/tests/ tests/ -q`.

- [ ] **Step 5: Commit:** `feat(sync): archive every room author and scan room history once`

---

### Task 3: Member 0 has no avatar click

**Files:**
- Modify: `frontend/src/types/index.ts` (`Message`: add `member_id?: number; member_name?: string;`, which the group endpoint already sends)
- Modify: `frontend/src/features/messages/components/MessageList.tsx` (~line 166)
- Test: `frontend/src/features/messages/components/MessageList.roomAuthor.test.tsx` (new)

**Interfaces:**
- Consumes: group messages carry `member_id` (backend `content.py` sets it).

- [ ] **Step 1: Failing test.** Render `MessageList` with two messages, `member_id` 22 and 0, and a spy `onAvatarClick`. Click both avatar buttons. Assert the spy was called once.
  - Copy the render setup (props, providers, Virtuoso mock) from an existing test that renders `MessageList` or `MessageBubble`; `MessageBubble.test.tsx` shows the providers.
  - If `MessageList` is impractical to render because of virtualization, test the prop wiring by exporting a tiny pure helper from `MessageList.tsx` instead: `export const avatarClickFor = (msg: Message, onAvatarClick?: () => void) => (msg.member_id === 0 ? undefined : onAvatarClick);`, and unit-test that.

- [ ] **Step 2: Implement:** in `MessageList.tsx`, pass `onAvatarClick={avatarClickFor(msg, onAvatarClick)}` (the helper above) to `MessageBubble`. Add the two optional fields to `Message`.

- [ ] **Step 3: Run** `npx vitest run src/features/messages` and `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit:** `fix(messages): room-author messages open no profile card`

---

### Task 4: Changelog (pin happens at release)

**Files:** `CHANGELOG.md` `[Unreleased]`

- [ ] **Step 1:** Add (end-user wording, no identifiers):

```
### Fixed
- **Some chats were missing many messages from members who were not in the room's
  current lineup** — for example the official 日向坂46 room's 2021–2022 member posts,
  earlier lineups of a single's live-event room, and announcements posted as the
  room itself. After updating, the first sync re-reads each chat once (slowly, so
  it can take a while) and adds them with their photos and videos.

### Changed
- **The sync screen says when it is scanning a chat's full history for the first
  time**, and the member count no longer runs past its total.
```

- [ ] **Step 2: Commit:** `docs(changelog): note recovered room messages`

The `pysaka==0.4.6` pin (`uv add "pysaka==0.4.6"`) is done after pysaka 0.4.6 is published, as in 0.4.5.
