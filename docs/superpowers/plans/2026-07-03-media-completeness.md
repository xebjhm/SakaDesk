# Media Completeness (Prevention + Verify & Fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop interrupted syncs from permanently stranding message media, and add a one-click per-service "Verify & Fix" button that backfills already-missing media.

**Architecture:** Three pysaka SDK changes (harden downloads, gate the sync cursor on media completeness, add offline-scan + reconcile primitives) plus a SakaDesk layer (a `verify_and_fix_media` orchestrator, a `POST /api/sync/verify` endpoint, and a Settings button) that reuses the existing progress modal. All reusable logic lives in pysaka (UI-agnostic); SakaDesk only orchestrates and renders.

**Tech Stack:** Python 3.9+ async (aiohttp, aiofiles, structlog), pysaka SDK, FastAPI backend, React + TypeScript + Vite + Tailwind + i18next frontend. Tests: `pytest` / `pytest-asyncio`, `vitest`.

**IMPORTANT — pysaka test conventions (do NOT use respx here):** pysaka networks via **aiohttp**, and its tests mock it with `unittest.mock` fixtures defined in `pysaka/tests/conftest.py` — do not introduce `respx`/httpx (respx only intercepts httpx). Use these fixtures:
- `client` → a real `Client(group=Group.HINATAZAKA46, access_token="test_token")`.
- `mock_session` → a `MagicMock` whose `session.get.return_value.__aenter__.return_value` is an `AsyncMock` response; set `resp.status`, `resp.read = AsyncMock(return_value=b"...")`, `resp.headers = {...}` on it. For multi-attempt tests use `mock_session.get.return_value.__aenter__.side_effect = [resp1, resp2]`.
- `sync_manager` → `SyncManager(mock_client, tmp_path)` where `mock_client` is a `MagicMock(spec=Client)` with `get_messages`/`download_file` as `AsyncMock`. `sync_manager.output_dir` is `tmp_path`.
Raw API messages use `"type": "image"` (normalized to `"picture"`), `"text"` (normalized to `"content"`), `"file"` for media URL, `"member_id"`, `"published_at"`. Do real file I/O against `tmp_path`; only the network (`mock_session` / `mock_client.download_file`) is mocked.

**Spec:** `SakaDesk/docs/superpowers/specs/2026-07-03-media-completeness-verify-fix-design.md`

## Global Constraints

- **Toolchain:** `uv` only. Run every Python command as `uv run <cmd>` inside the relevant repo dir. Commit with `uv run git commit` (bare `git commit` fails — pre-commit not on PATH). Frontend uses `npm run test:run` (vitest).
- **Two repos, isolated worktrees:** pysaka changes land in a `fix/media-completeness` worktree of `pysaka`; SakaDesk changes in a `fix/media-completeness` worktree of `SakaDesk`. Do NOT work in the main checkouts — both hold unrelated in-progress work. pysaka ships first; SakaDesk consumes it via the editable path dep (`../pysaka`), so re-run `uv sync` in SakaDesk after pysaka changes if imports fail.
- **Filesystem:** always `pathlib.Path`; always `open(..., encoding="utf-8")`. Never string path concat, never CP1252/Big5.
- **Async hygiene:** never `time.sleep()` — use `await asyncio.sleep()`. Never `print()` — use `structlog`.
- **i18n:** no hardcoded user-facing strings. Every new UI string gets a key in all five locales: `frontend/src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json`.
- **pysaka purity:** pysaka must not import from SakaDesk or any UI. It returns data, not user-facing strings.
- **Security:** never log tokens/URLs-with-creds beyond what existing code already does; no `assert` for control flow.
- **Commit footer:** end every commit message body with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**pysaka** (`fix/media-completeness` worktree):
- Modify `src/pysaka/client.py` — harden `download_file` (Part C).
- Modify `src/pysaka/manager.py` — `prepare_messages` + `sync_member` cursor gating (Part A); add `scan_member_media` and `reconcile_member_media` (Part B primitives).
- Modify `tests/` — new tests alongside existing pysaka tests (match existing file naming, e.g. `tests/test_manager.py`, `tests/test_client.py`).
- Update `CHANGELOG.md`.

**SakaDesk** (`fix/media-completeness` worktree):
- Modify `backend/api/progress.py` — add `set_result` / `result` field.
- Modify `backend/services/sync_service.py` — extract `_authenticated_client`; add `verify_and_fix_media`.
- Modify `backend/api/sync.py` — add `run_verify_task` + `POST /verify`.
- Modify `backend/tests/test_sync_service.py` (or a new `test_verify_media.py`) and `backend/tests/test_sync_api.py`.
- Modify `frontend/src/shell/hooks/useSync.ts` — add `verifyAndFix`.
- Modify `frontend/src/shell/components/SettingsModal.tsx` — add the button.
- Modify the sync progress modal component — render the completion summary from `result`.
- Modify `frontend/src/i18n/locales/*.json` — five files.
- Update `docs/KNOWN_BUGS.md` and `CHANGELOG.md`.

---

# PART 1 — pysaka SDK (do first)

> Set up the worktree before Task 1. From `/home/xebjhm/repos/Project-Saka/pysaka`:
> use `superpowers:using-git-worktrees` to create a worktree on branch `fix/media-completeness`, then `uv sync` inside it. Run all Part-1 commands from that worktree dir.

## Task 1: Harden `download_file` (atomic write, validation, retries)

**Files:**
- Modify: `src/pysaka/client.py` — `download_file` (currently `client.py:677-706`), plus imports near top.
- Test: `tests/test_client.py`

**Interfaces:**
- Produces: `Client.download_file(session, url, filepath, timestamp=None, *, retries=3) -> bool` — returns `True` only when a non-empty file is present on disk afterward; writes via a `*.part` temp then atomic `os.replace`; never leaves a truncated/0-byte stub.

- [ ] **Step 1: Confirm imports.** Open `src/pysaka/client.py` and ensure `os`, `asyncio`, and `contextlib` are imported at the top. `asyncio` is already imported. Add whichever of `import os` / `import contextlib` are missing (top import block).

- [ ] **Step 2: Write failing tests** in `tests/test_client.py`, using the existing `client` + `mock_session` fixtures and real `tmp_path` files (see the pysaka test conventions in Global Constraints; ensure `from unittest.mock import AsyncMock` and `from pathlib import Path` are imported in the file):

```python
@pytest.mark.asyncio
async def test_download_file_zero_byte_stub_is_redownloaded(tmp_path, client, mock_session):
    # A pre-existing 0-byte file must NOT count as "already downloaded".
    dest = tmp_path / "picture" / "1.jpg"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(b"")
    resp = mock_session.get.return_value.__aenter__.return_value
    resp.status = 200
    resp.read = AsyncMock(return_value=b"REALBYTES")
    resp.headers = {}
    ok = await client.download_file(mock_session, "https://cdn/1.jpg", dest)
    assert ok is True
    assert dest.read_bytes() == b"REALBYTES"


@pytest.mark.asyncio
async def test_download_file_content_length_mismatch_leaves_no_stub(tmp_path, client, mock_session):
    dest = tmp_path / "picture" / "2.jpg"
    resp = mock_session.get.return_value.__aenter__.return_value
    resp.status = 200
    resp.read = AsyncMock(return_value=b"AB")
    resp.headers = {"Content-Length": "999"}
    ok = await client.download_file(mock_session, "https://cdn/2.jpg", dest, retries=1)
    assert ok is False
    assert not dest.exists()                        # no truncated stub
    assert not (dest.parent / "2.jpg.part").exists()


@pytest.mark.asyncio
async def test_download_file_retries_then_succeeds(tmp_path, client, mock_session):
    dest = tmp_path / "picture" / "3.jpg"
    resp_500 = AsyncMock(); resp_500.status = 500
    resp_ok = AsyncMock(); resp_ok.status = 200
    resp_ok.read = AsyncMock(return_value=b"OK"); resp_ok.headers = {}
    mock_session.get.return_value.__aenter__.side_effect = [resp_500, resp_ok]
    ok = await client.download_file(mock_session, "https://cdn/3.jpg", dest, retries=3)
    assert ok is True
    assert dest.read_bytes() == b"OK"
```

- [ ] **Step 3: Run tests to verify they fail.** Run: `uv run pytest tests/test_client.py -k download_file -v` — Expected: FAIL (current impl truncates, has no retry, treats 0-byte as done, and does not read `Content-Length`).

- [ ] **Step 4: Implement.** Replace `download_file` body with:

```python
    async def download_file(
        self,
        session: aiohttp.ClientSession,
        url: str,
        filepath: Path,
        timestamp: Optional[str] = None,
        *,
        retries: int = 3,
    ) -> bool:
        """
        Download a file to disk safely: write to a ``*.part`` temp then atomically
        rename. Validates the body is non-empty and (when the server sends
        ``Content-Length``) matches the declared size. Retries transient failures
        with a short backoff. On ultimate failure leaves NO file behind — a prior
        truncated/0-byte stub is treated as missing and re-downloaded.

        Args:
            session: Active aiohttp ClientSession.
            url: The download URL.
            filepath: Destination Path object.
            timestamp: Optional ISO timestamp (reserved; unused).
            retries: Max attempts before giving up.

        Returns:
            True if a non-empty file exists at ``filepath`` afterward, else False.
        """
        if not url:
            return True
        # A zero-byte stub from a past truncated write is NOT complete.
        if filepath.exists() and filepath.stat().st_size > 0:
            return True

        filepath.parent.mkdir(parents=True, exist_ok=True)
        tmp = filepath.with_name(filepath.name + ".part")
        last_err: Optional[str] = None

        for attempt in range(retries):
            try:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        last_err = f"status {resp.status}"
                        logger.warning("Download failed", status=resp.status, url=url)
                    else:
                        data = await resp.read()
                        declared = resp.headers.get("Content-Length")
                        if not data:
                            last_err = "empty body"
                        elif declared is not None and declared.isdigit() and int(declared) != len(data):
                            last_err = f"size mismatch got={len(data)} declared={declared}"
                        else:
                            async with aiofiles.open(tmp, "wb") as f:
                                await f.write(data)
                            os.replace(tmp, filepath)
                            return True
            except Exception as e:  # noqa: BLE001 - transient network errors are retried
                last_err = str(e)
                logger.warning("Download error (will retry)", url=url, error=str(e), attempt=attempt + 1)

            if attempt < retries - 1:
                await asyncio.sleep(0.5 * (attempt + 1))

        with contextlib.suppress(OSError):
            tmp.unlink(missing_ok=True)
        logger.error("Download ultimately failed", url=url, error=str(last_err))
        return False
```

- [ ] **Step 5: Run tests to verify they pass.** Run: `uv run pytest tests/test_client.py -k download_file -v` — Expected: PASS.

- [ ] **Step 5b: Fix the pre-existing test broken by hardening.** `tests/test_coverage_boost.py::test_client_download_file_success` patches `aiofiles.open` and asserts `aiofiles.open(dest, "wb")` — but the new code writes to a `dest.name + ".part"` temp then `os.replace`s it, so that assertion and the mocked (never-written) temp will fail on `os.replace`. Rewrite that test to the real-`tmp_path` + `mock_session` pattern:

```python
@pytest.mark.asyncio
async def test_client_download_file_success(client, mock_session, tmp_path):
    """Download writes the body via atomic .part rename."""
    resp = mock_session.get.return_value.__aenter__.return_value
    resp.status = 200
    resp.read = AsyncMock(return_value=b"file_content")
    resp.headers = {}
    dest = tmp_path / "file.jpg"
    ok = await client.download_file(mock_session, "http://example.com/file.jpg", dest)
    assert ok is True
    assert dest.read_bytes() == b"file_content"
    assert not (tmp_path / "file.jpg.part").exists()
```

- [ ] **Step 6: Regression + commit.** Run: `uv run pytest tests/test_client.py tests/test_coverage_boost.py -v` (ensure nothing else asserts the old truncate-in-place behavior; fix any that do the same way). Then:

```bash
git add src/pysaka/client.py tests/test_client.py tests/test_coverage_boost.py
uv run git commit -m "fix(client): harden download_file with atomic write, validation, retries

Write to a .part temp then atomic rename; validate non-empty body and
Content-Length; retry transient failures; treat 0-byte stubs as missing.
Prevents interrupted downloads from leaving files that masquerade as complete.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Gate the sync cursor on media completeness (prevention)

**Files:**
- Modify: `src/pysaka/manager.py` — `prepare_messages` (`manager.py:323-404`) and `sync_member` (`manager.py:220`, `manager.py:305-315`).
- Test: `tests/test_manager.py`

**Interfaces:**
- Produces: `SyncManager.prepare_messages(messages, member_dir, queue) -> tuple[list[dict], Optional[str], Optional[str]]` — now a **3-tuple** `(processed, earliest_failed_ts, earliest_pending_media_ts)`. The third element is the `published_at` (or `""`) of the oldest message whose media was queued because it is not yet on disk; `None` if no media was queued.
- Consumes (internal): `sync_member` unpacks the 3-tuple and clamps the persisted `last_sync_ts` behind `earliest_pending_media_ts` so an interrupted media download is re-fetched next run.

- [ ] **Step 1: Write the failing tests** in `tests/test_manager.py`, using the `sync_manager` fixture (its `output_dir` is `tmp_path`; `session = AsyncMock()`; raw messages use `"type": "image"` / `"text"` / `"file"` — mirror the existing `test_sync_member_prepare_failure_holds_cursor`):

```python
@pytest.mark.asyncio
async def test_cursor_held_behind_message_with_undownloaded_media(sync_manager):
    """A queued-but-not-downloaded image must hold the cursor behind it, even
    when a newer text message exists — so an interrupted media phase self-heals."""
    session = AsyncMock()
    group = {"id": 1, "name": "Grp"}
    member = {"id": 10, "name": "Mem"}
    queue: list = []
    prefetched = [
        {"id": 100, "type": "text", "text": "hi", "member_id": 10, "published_at": "2026-01-01T00:00:00Z"},
        {"id": 101, "type": "image", "file": "http://img.jpg", "member_id": 10, "published_at": "2026-01-02T00:00:00Z"},
        {"id": 102, "type": "text", "text": "newest", "member_id": 10, "published_at": "2026-01-03T00:00:00Z"},
    ]
    await sync_manager.sync_member(session, group, member, queue, prefetched_messages=prefetched)
    # Image 101 was queued (file absent) -> cursor clamped to its ts, NOT 102's.
    assert any(item["message_id"] == 101 for item in queue)
    assert sync_manager.get_last_ts(1, 10) == "2026-01-02T00:00:00Z"


@pytest.mark.asyncio
async def test_cursor_advances_fully_when_all_media_present(sync_manager):
    session = AsyncMock()
    group = {"id": 1, "name": "Grp"}
    member = {"id": 10, "name": "Mem"}
    member_dir = sync_manager.output_dir / "messages" / "1 Grp" / "10 Mem"
    (member_dir / "picture").mkdir(parents=True)
    (member_dir / "picture" / "101.jpg").write_bytes(b"IMG")   # already on disk -> not queued
    queue: list = []
    prefetched = [
        {"id": 101, "type": "image", "file": "http://img.jpg", "member_id": 10, "published_at": "2026-01-02T00:00:00Z"},
        {"id": 102, "type": "text", "text": "later", "member_id": 10, "published_at": "2026-01-03T00:00:00Z"},
    ]
    await sync_manager.sync_member(session, group, member, queue, prefetched_messages=prefetched)
    assert queue == []
    assert sync_manager.get_last_ts(1, 10) == "2026-01-03T00:00:00Z"   # full advance
```

> `get_media_extension("http://img.jpg", "picture")` yields `jpg`, so the on-disk name is `101.jpg`.

- [ ] **Step 2: Run to verify failure.** Run: `uv run pytest tests/test_manager.py -k cursor -v` — Expected: FAIL (current code advances the cursor to 102's `2026-01-03T00:00:00Z` because it ignores queued-but-undownloaded media).

- [ ] **Step 3: Implement `prepare_messages`.** Add the pending-media tracker. In `src/pysaka/manager.py`:

Change the signature/return annotation to a 3-tuple and initialize the tracker near `earliest_failed_ts`:

```python
    def prepare_messages(
        self, messages: list[dict[str, Any]], member_dir: Path, queue: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], Optional[str], Optional[str]]:
```

```python
        processed = []
        earliest_failed_ts: Optional[str] = None
        earliest_pending_media_ts: Optional[str] = None
```

Inside the `if not filepath.exists():` block (right after `queue.append({...})`), record the pending timestamp:

```python
                    if not filepath.exists():
                        queue.append(
                            {
                                "url": media_url,
                                "path": filepath,
                                "timestamp": msg.get("published_at"),
                                "message_id": msg["id"],
                                "media_type": msg_type,
                                "member_dir": member_dir,
                            }
                        )
                        # Hold the cursor behind this message until its media is on
                        # disk, so an interrupted download is re-fetched next run.
                        pending_ts = msg.get("published_at") or ""
                        if earliest_pending_media_ts is None or pending_ts < earliest_pending_media_ts:
                            earliest_pending_media_ts = pending_ts
```

Change the final return:

```python
        return processed, earliest_failed_ts, earliest_pending_media_ts
```

Update the docstring's "Returns:" to describe the third element (one sentence: "`earliest_pending_media_ts` is the `published_at` (`""` if none) of the oldest message whose media was queued for download; `None` if no media was queued. The caller must not advance the cursor past it.").

- [ ] **Step 4: Implement `sync_member` clamp.** At the unpack site (`manager.py:220`):

```python
            processed, earliest_failed_ts, earliest_pending_media_ts = self.prepare_messages(
                messages, member_dir, media_queue
            )
```

After the existing failed-ts clamp (the `if earliest_failed_ts is not None and newest_ts is not None:` block near `manager.py:313`), add:

```python
            # Also hold the cursor behind any message whose media is still queued
            # (not yet confirmed on disk). If the media phase is interrupted, the
            # next timestamp-filtered sync re-fetches these messages and re-downloads.
            if earliest_pending_media_ts is not None and newest_ts is not None:
                newest_ts = min(newest_ts, earliest_pending_media_ts)
```

- [ ] **Step 5: Run to verify pass.** Run: `uv run pytest tests/test_manager.py -k cursor -v` — Expected: PASS.

- [ ] **Step 6: Fix any existing prepare_messages callers/tests.** Run: `uv run pytest tests/test_manager.py -v`. Any existing test that unpacks a 2-tuple from `prepare_messages` must be updated to the 3-tuple. Fix them to `processed, failed, pending = manager.prepare_messages(...)`.

- [ ] **Step 7: Commit.**

```bash
git add src/pysaka/manager.py tests/test_manager.py
uv run git commit -m "fix(manager): gate sync cursor on media completeness

prepare_messages now reports the earliest message with still-queued media;
sync_member clamps last_sync_ts behind it so an interrupted media download is
re-fetched and re-downloaded on the next sync instead of being stranded forever.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `scan_member_media` — offline gap detection

**Files:**
- Modify: `src/pysaka/manager.py` — add method to `SyncManager`.
- Test: `tests/test_manager.py`

**Interfaces:**
- Produces: `SyncManager.scan_member_media(member_dir: Path) -> dict[str, Any]` returning `{"checked": int, "missing": list[dict]}` where each missing descriptor is `{"message_id": int, "media_type": str, "path": Path, "timestamp": Optional[str]}`. Offline (no network). A media file counts as missing if absent OR zero bytes. Resolves expected paths via `self.output_dir / msg["media_file"]`.

- [ ] **Step 1: Write the failing test** in `tests/test_manager.py` (uses the `sync_manager` fixture; `import json` and `from pathlib import Path` are already in that file):

```python
def test_scan_member_media_finds_absent_and_zero_byte(sync_manager):
    member_dir = sync_manager.output_dir / "messages" / "1 Grp" / "10 Mem"
    (member_dir / "picture").mkdir(parents=True)
    # 101 present & non-empty; 102 zero-byte; 103 absent; 104 text (ignored)
    (member_dir / "picture" / "101.jpg").write_bytes(b"IMG")
    (member_dir / "picture" / "102.jpg").write_bytes(b"")
    (member_dir / "messages.json").write_text(json.dumps({"messages": [
        {"id": 101, "type": "picture", "media_file": "messages/1 Grp/10 Mem/picture/101.jpg"},
        {"id": 102, "type": "picture", "media_file": "messages/1 Grp/10 Mem/picture/102.jpg"},
        {"id": 103, "type": "picture", "media_file": "messages/1 Grp/10 Mem/picture/103.jpg"},
        {"id": 104, "type": "text", "content": "hi"},
    ]}), encoding="utf-8")

    result = sync_manager.scan_member_media(member_dir)
    assert result["checked"] == 3
    assert sorted(d["message_id"] for d in result["missing"]) == [102, 103]
    assert all(isinstance(d["path"], Path) for d in result["missing"])


def test_scan_member_media_missing_file_returns_empty(sync_manager):
    member_dir = sync_manager.output_dir / "messages" / "1 Grp" / "10 Mem"
    member_dir.mkdir(parents=True)
    assert sync_manager.scan_member_media(member_dir) == {"checked": 0, "missing": []}
```

- [ ] **Step 2: Run to verify failure.** Run: `uv run pytest tests/test_manager.py -k scan_member_media -v` — Expected: FAIL (`AttributeError: scan_member_media`).

- [ ] **Step 3: Implement** (add to `SyncManager`, e.g. after `prepare_messages`):

```python
    def scan_member_media(self, member_dir: Path) -> dict[str, Any]:
        """
        Offline scan of a member's messages.json for missing media.

        A media file is 'missing' if it does not exist OR has zero bytes.
        Expected paths are resolved as ``self.output_dir / msg["media_file"]``.

        Returns:
            ``{"checked": int, "missing": list[dict]}`` where each missing
            descriptor is ``{"message_id", "media_type", "path": Path,
            "timestamp"}``. Returns zero/empty if messages.json is absent or
            unreadable.
        """
        result: dict[str, Any] = {"checked": 0, "missing": []}
        messages_file = member_dir / "messages.json"
        if not messages_file.exists():
            return result
        try:
            with open(messages_file, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:  # noqa: BLE001
            logger.warning("scan: unreadable messages.json", file=str(messages_file), error=str(e))
            return result

        for msg in data.get("messages", []):
            media_file = msg.get("media_file")
            mtype = msg.get("type")
            if not media_file or mtype not in ("picture", "video", "voice"):
                continue
            result["checked"] += 1
            path = self.output_dir / media_file
            try:
                present = path.exists() and path.stat().st_size > 0
            except OSError:
                present = False
            if not present:
                result["missing"].append(
                    {
                        "message_id": msg.get("id"),
                        "media_type": mtype,
                        "path": path,
                        "timestamp": msg.get("timestamp") or msg.get("published_at"),
                    }
                )
        return result
```

- [ ] **Step 4: Run to verify pass.** Run: `uv run pytest tests/test_manager.py -k scan_member_media -v` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/pysaka/manager.py tests/test_manager.py
uv run git commit -m "feat(manager): add scan_member_media offline gap detector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `reconcile_member_media` — backfill from a fresh timeline

**Files:**
- Modify: `src/pysaka/manager.py` — add method to `SyncManager`.
- Test: `tests/test_manager.py`

**Interfaces:**
- Consumes: `scan_member_media` output (`missing` list), a `timeline_messages: list[dict]` fetched by the caller (fresh signed `file`/`thumbnail` URLs), and the hardened `download_file` / existing `process_media_queue` + `update_message_metadata`.
- Produces: `SyncManager.reconcile_member_media(session, member_dir: Path, missing: list[dict], timeline_messages: list[dict], progress_callback=None) -> dict[str, int]` returning `{"repaired": int, "failed": int, "still_missing": int}`. `repaired` = missing files now present & non-empty (re-checked on disk); `still_missing` = `len(missing) - repaired` (includes items with no timeline match, e.g. deleted upstream).

- [ ] **Step 1: Write the failing test** in `tests/test_manager.py` (uses the `sync_manager` fixture; its `client.download_file` is an `AsyncMock` — give it a `side_effect` that actually writes bytes so the on-disk re-check counts the repair; `session` is unused so pass `AsyncMock()`):

```python
@pytest.mark.asyncio
async def test_reconcile_downloads_missing_from_timeline(sync_manager):
    member_dir = sync_manager.output_dir / "messages" / "1 Grp" / "10 Mem"
    (member_dir / "picture").mkdir(parents=True)
    dest = member_dir / "picture" / "103.jpg"
    missing = [{"message_id": 103, "media_type": "picture", "path": dest,
                "timestamp": "2026-01-03T00:00:00Z"}]
    timeline = [{"id": 103, "file": "https://cdn/fresh-103.jpg", "type": "picture"},
                {"id": 999, "file": "https://cdn/other.jpg"}]
    (member_dir / "messages.json").write_text(json.dumps({"messages": [
        {"id": 103, "type": "picture", "media_file": "messages/1 Grp/10 Mem/picture/103.jpg"}
    ]}), encoding="utf-8")

    async def fake_dl(session, url, path, timestamp=None, **kw):
        Path(path).write_bytes(b"FRESHIMG")
        return True
    sync_manager.client.download_file = AsyncMock(side_effect=fake_dl)

    report = await sync_manager.reconcile_member_media(AsyncMock(), member_dir, missing, timeline)
    assert report == {"repaired": 1, "failed": 0, "still_missing": 0}
    assert dest.read_bytes() == b"FRESHIMG"


@pytest.mark.asyncio
async def test_reconcile_no_timeline_match_is_still_missing(sync_manager):
    member_dir = sync_manager.output_dir / "messages" / "1 Grp" / "10 Mem"
    member_dir.mkdir(parents=True)
    missing = [{"message_id": 103, "media_type": "picture",
                "path": member_dir / "picture" / "103.jpg", "timestamp": None}]
    report = await sync_manager.reconcile_member_media(AsyncMock(), member_dir, missing, timeline_messages=[])
    assert report == {"repaired": 0, "failed": 0, "still_missing": 1}
```

- [ ] **Step 2: Run to verify failure.** Run: `uv run pytest tests/test_manager.py -k reconcile -v` — Expected: FAIL (`AttributeError`).

- [ ] **Step 3: Implement:**

```python
    async def reconcile_member_media(
        self,
        session: aiohttp.ClientSession,
        member_dir: Path,
        missing: list[dict[str, Any]],
        timeline_messages: list[dict[str, Any]],
        progress_callback: Optional[Any] = None,
    ) -> dict[str, int]:
        """
        Backfill a member's missing media using fresh URLs from a re-fetched
        timeline. Matches each missing message_id to a ``file``/``thumbnail`` URL,
        downloads via ``process_media_queue`` (hardened ``download_file``), then
        re-checks disk truth and writes back dimension metadata.

        Returns ``{"repaired", "failed", "still_missing"}``.
        """
        report = {"repaired": 0, "failed": 0, "still_missing": 0}
        if not missing:
            return report

        url_by_id: dict[Any, str] = {}
        for m in timeline_messages:
            url = m.get("file") or m.get("thumbnail")
            if url:
                url_by_id[m.get("id")] = url

        queue: list[dict[str, Any]] = []
        for d in missing:
            url = url_by_id.get(d["message_id"])
            if url:
                queue.append(
                    {
                        "url": url,
                        "path": d["path"],
                        "timestamp": d.get("timestamp"),
                        "message_id": d["message_id"],
                        "media_type": d["media_type"],
                        "member_dir": member_dir,
                    }
                )

        metadata_by_dir = await self.process_media_queue(
            session, queue, progress_callback=progress_callback
        )

        # Re-check disk truth: a queued item counts as repaired only if the file
        # is now present and non-empty.
        for item in queue:
            p = item["path"]
            try:
                ok = p.exists() and p.stat().st_size > 0
            except OSError:
                ok = False
            if ok:
                report["repaired"] += 1
            else:
                report["failed"] += 1
        report["still_missing"] = len(missing) - report["repaired"]

        member_meta = metadata_by_dir.get(member_dir)
        if member_meta:
            await self.update_message_metadata(member_dir / "messages.json", member_meta)
        return report
```

- [ ] **Step 4: Run to verify pass.** Run: `uv run pytest tests/test_manager.py -k reconcile -v` — Expected: PASS.

- [ ] **Step 5: Full pysaka suite + changelog + commit.** Run: `uv run pytest -q` (whole pysaka suite; the pre-existing headless keyring failure in `test_api_groups_fetch` is a known non-regression — ignore only that one). Add a CHANGELOG entry under an "Unreleased" heading in `CHANGELOG.md`:

```markdown
### Fixed
- Sync no longer strands message media when a media download is interrupted: the
  per-member cursor is held behind any message whose media is not yet on disk, and
  `download_file` now writes atomically with validation and retries.
### Added
- `SyncManager.scan_member_media` / `reconcile_member_media` primitives for
  detecting and backfilling missing message media.
```

```bash
git add src/pysaka/manager.py tests/test_manager.py CHANGELOG.md
uv run git commit -m "feat(manager): add reconcile_member_media backfill primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PART 2 — SakaDesk backend

> Set up the SakaDesk worktree before Task 6. From `/home/xebjhm/repos/Project-Saka/SakaDesk`:
> create a `fix/media-completeness` worktree, then `uv sync` (picks up the editable `../pysaka`; if the worktree's relative `../pysaka` path doesn't resolve to your pysaka worktree, that's fine — the SDK changes are already committed on pysaka's branch, so point the dep at it or merge pysaka's branch into its main first). Run Part-2 backend commands from the SakaDesk worktree.

## Task 5: `SyncProgress.set_result` + `result` in status

**Files:**
- Modify: `backend/api/progress.py`
- Test: `backend/tests/test_sync_api.py` (or wherever `SyncProgress` is unit-tested; add a small unit test)

**Interfaces:**
- Produces: `SyncProgress.set_result(result: dict) -> None`; `get_status()` includes `"result": <dict|None>`; `reset()` clears it to `None`.

- [ ] **Step 1: Write the failing test:**

```python
def test_progress_result_roundtrip():
    from backend.api.progress import SyncProgress
    p = SyncProgress()
    assert p.get_status()["result"] is None
    p.set_result({"missing": 5, "repaired": 4})
    assert p.get_status()["result"] == {"missing": 5, "repaired": 4}
    p.reset()
    assert p.get_status()["result"] is None
```

- [ ] **Step 2: Run to verify failure.** Run: `uv run pytest backend/tests/test_sync_api.py -k result -v` — Expected: FAIL (`KeyError: 'result'`).

- [ ] **Step 3: Implement.** In `backend/api/progress.py`:
  - In `reset()` (inside the `with self._lock:` block) add: `self._result: Optional[dict] = None`
  - Add a method:
```python
    def set_result(self, result: dict):
        """Attach a structured summary (rendered by the frontend, i18n-safe)."""
        with self._lock:
            self._result = result
```
  - In `get_status()`'s returned dict, add: `"result": self._result,`

- [ ] **Step 4: Run to verify pass.** Run: `uv run pytest backend/tests/test_sync_api.py -k result -v` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/api/progress.py backend/tests/test_sync_api.py
uv run git commit -m "feat(progress): add structured result field for verify summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Extract `_authenticated_client` from `start_sync` (DRY, reused by verify)

**Files:**
- Modify: `backend/services/sync_service.py` — extract lines ~188-192 and ~219-299 into a helper; call it from `start_sync`.
- Test: existing `backend/tests/test_sync_service*.py` as regression (no behavior change).

**Interfaces:**
- Produces: `SyncService._authenticated_client(self, session: aiohttp.ClientSession) -> Client` — loads config, builds a `Client`, lazy-refreshes the token (verifying via `get_groups` on refresh failure, deleting a truly-dead session and raising `SessionExpiredError`), persists rotated tokens, and returns the ready `Client`. Raises `Exception("Not authenticated")` when no token.

- [ ] **Step 1: Add the helper** to `SyncService` (place above `start_sync`). Move the existing logic verbatim:

```python
    async def _authenticated_client(self, session: aiohttp.ClientSession) -> Client:
        """Build an authenticated Client for this service, refreshing the token if
        needed. Verifies a failed refresh with a live get_groups call before giving
        up; deletes a truly-expired session and raises SessionExpiredError."""
        config = await self.load_config()
        token = config.get("access_token")
        if not token:
            raise Exception("Not authenticated")

        auth_dir = str(get_session_dir())
        client = Client(
            group=self._get_group(),
            access_token=token,
            cookies=config.get("cookies"),
            app_id=config.get("x-talk-app-id"),
            user_agent=config.get("user-agent"),
            auth_dir=auth_dir,
        )

        try:
            await client.refresh_if_needed(session, min_seconds_remaining=300)
        except (SessionExpiredError, RefreshFailedError) as refresh_err:
            logger.warning(
                "Token refresh failed - verifying token validity",
                error_type=type(refresh_err).__name__,
                error=str(refresh_err),
            )
            try:
                test_groups = await client.get_groups(session, include_inactive=False)
                if test_groups is not None:
                    logger.info(
                        "Token is still valid despite refresh failure - continuing",
                        groups_found=len(test_groups),
                    )
                else:
                    logger.error("Token verification failed - session is truly expired")
                    tm = get_token_manager()
                    tm.delete_session(self._service)
                    raise SessionExpiredError("Session expired") from refresh_err
            except SessionExpiredError:
                logger.error("Token verification confirmed session is expired")
                tm = get_token_manager()
                tm.delete_session(self._service)
                raise

        if client.access_token != token:
            logger.info("Tokens refreshed during auth check - saving to storage")
            try:
                tm = get_token_manager()
                tm.save_session(
                    self._service, client.access_token, client.refresh_token, client.cookies
                )
            except Exception as e:
                logger.error("Failed to save refreshed tokens", error=str(e), exc_info=True)
        return client
```

- [ ] **Step 2: Rewire `start_sync`.** Delete the now-duplicated block in `start_sync`: the config/token load (`config = await self.load_config()` through `raise Exception("Not authenticated")`, ~188-192) AND the client-creation + refresh + save block (~219-299). Inside `async with aiohttp.ClientSession(connector=connector) as session:`, replace it with:

```python
                client = await self._authenticated_client(session)
```
Keep the subsequent `self.manager = SyncManager(client, self.service_data_dir)` and everything after. (The `is_fresh` detection block ~197-208 does not use `config`/`token`; leave it as-is.)

- [ ] **Step 3: Run regression.** Run: `uv run pytest backend/tests/test_sync_service.py backend/tests/test_sync_service_core.py backend/tests/test_sync_service_extended.py backend/tests/test_sync_api.py -v` — Expected: PASS (same behavior). If a test asserted on the inlined flow, adjust it minimally to the helper.

- [ ] **Step 4: Commit.**

```bash
git add backend/services/sync_service.py
uv run git commit -m "refactor(sync): extract _authenticated_client for reuse by verify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `SyncService.verify_and_fix_media`

**Files:**
- Modify: `backend/services/sync_service.py` — add method.
- Test: `backend/tests/test_verify_media.py` (new)

**Interfaces:**
- Consumes: `self._authenticated_client`, `SyncManager.scan_member_media` / `reconcile_member_media` / `client.get_messages`, `progress_manager`.
- Produces: `SyncService.verify_and_fix_media(self) -> dict[str, int]` returning `{"members", "checked", "missing", "repaired", "failed", "still_missing"}`; drives the service's `SyncProgress` (phases `verifying` → `repairing`), and calls `progress.set_result(<same dict>)`. Sets/clears `self.running`.

- [ ] **Step 1: Write the failing test.** Build a fake on-disk service tree, monkeypatch `_authenticated_client` to return a stub client whose `get_messages` yields fresh URLs, and stub the SDK download. Follow the fixture/monkeypatch style already in `backend/tests/test_sync_service.py`:

```python
import json
import pytest
from pathlib import Path


@pytest.mark.asyncio
async def test_verify_and_fix_repairs_missing_media(tmp_path, monkeypatch):
    from backend.services.sync_service import SyncService

    # --- lay out a service tree with one member missing image 103 ---
    output_dir = tmp_path / "out"
    service_display = "日向坂46"
    member_dir = output_dir / service_display / "messages" / "10 G" / "20 M"
    (member_dir / "picture").mkdir(parents=True)
    (member_dir / "picture" / "101.jpg").write_bytes(b"IMG")   # present
    # 103 absent -> the gap
    (member_dir / "messages.json").write_text(json.dumps({"messages": [
        {"id": 101, "type": "picture", "media_file": "messages/10 G/20 M/picture/101.jpg"},
        {"id": 103, "type": "picture", "media_file": "messages/10 G/20 M/picture/103.jpg",
         "timestamp": "2026-01-03T00:00:00Z"},
    ]}), encoding="utf-8")

    svc = SyncService(service="hinatazaka46")
    monkeypatch.setattr(svc, "load_app_settings",
                        lambda: _async({"output_dir": str(output_dir), "is_configured": True}))

    # Stub the authenticated client: get_messages returns a fresh URL for 103;
    # download_file writes bytes to the destination.
    class StubClient:
        async def get_messages(self, session, gid, since_ts=None):
            return [{"id": 103, "file": "https://cdn/fresh-103.jpg", "type": "picture"}]
        async def download_file(self, session, url, path, timestamp=None, **kw):
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_bytes(b"FRESH")
            return True

    async def fake_auth(session):
        from pysaka import SyncManager
        client = StubClient()
        svc.manager = SyncManager.__new__(SyncManager)   # bypass __init__ network
        svc.manager.client = client
        svc.manager.output_dir = output_dir / service_display
        return client
    monkeypatch.setattr(svc, "_authenticated_client", fake_auth)

    result = await svc.verify_and_fix_media()
    assert result["missing"] == 1
    assert result["repaired"] == 1
    assert (member_dir / "picture" / "103.jpg").read_bytes() == b"FRESH"


def _async(value):
    async def _f(*a, **k):
        return value
    return _f
```

> Adjust `_async`/monkeypatch to match how `test_sync_service.py` already stubs `load_app_settings` and auth. The key assertions are `missing==1`, `repaired==1`, file written. If constructing `SyncManager` without a real client is awkward, instead let `fake_auth` build a real `SyncManager(StubClient(), svc.service_data_dir)` after `verify_and_fix_media` has set `self.service_data_dir` — simplest is to have `verify_and_fix_media` construct the manager itself (see Step 2) and have `fake_auth` return only the client.

- [ ] **Step 2: Implement `verify_and_fix_media`:**

```python
    async def verify_and_fix_media(self) -> dict[str, int]:
        """Scan every member's messages.json for missing media (absent/0-byte) and
        backfill it using fresh timeline URLs. One-click, per-service, idempotent."""
        totals = {"members": 0, "checked": 0, "missing": 0,
                  "repaired": 0, "failed": 0, "still_missing": 0}
        if self.running:
            return totals
        self.running = True
        progress = progress_manager.get(self._service)
        try:
            app_settings = await self.load_app_settings()
            self.output_dir = Path(app_settings.get("output_dir", str(get_default_output_dir())))
            service_display = get_service_display_name(self._service)
            self.service_data_dir = self.output_dir / service_display
            self.metadata_file = self.service_data_dir / "sync_metadata.json"
            messages_root = self.service_data_dir / "messages"

            progress.reset()
            progress.start_phase("verifying", "Verifying", 1, 0, "members")

            if not messages_root.exists():
                progress.complete()
                progress.set_result(totals)
                return totals

            connector = aiohttp.TCPConnector(limit=20)
            async with aiohttp.ClientSession(connector=connector) as session:
                client = await self._authenticated_client(session)
                if self.manager is None:
                    self.manager = SyncManager(client, self.service_data_dir)

                # Phase 1: offline scan, group gaps by group id.
                gaps_by_group: dict[int, list[tuple[Path, list]]] = defaultdict(list)
                for group_dir in sorted(p for p in messages_root.iterdir() if p.is_dir()):
                    try:
                        gid = int(group_dir.name.split(" ", 1)[0])
                    except (ValueError, IndexError):
                        continue
                    for member_dir in sorted(p for p in group_dir.iterdir() if p.is_dir()):
                        if not (member_dir / "messages.json").exists():
                            continue
                        totals["members"] += 1
                        scan = self.manager.scan_member_media(member_dir)
                        totals["checked"] += scan["checked"]
                        if scan["missing"]:
                            totals["missing"] += len(scan["missing"])
                            gaps_by_group[gid].append((member_dir, scan["missing"]))
                        progress.update(1, detail=f"{member_dir.name}")

                # Phase 2: per-group fresh timeline fetch + reconcile.
                if totals["missing"] == 0:
                    progress.complete()
                    progress.set_result(totals)
                    return totals

                progress.start_phase("repairing", "Repairing Media", 2, totals["missing"], "files")
                done = 0
                for gid, members in gaps_by_group.items():
                    all_ts = [d["timestamp"] for _, miss in members for d in miss]
                    if any(not ts for ts in all_ts):
                        since_ts: Optional[str] = None      # some gap has no ts -> full history
                    else:
                        earliest = min(all_ts)
                        try:
                            dt = datetime.fromisoformat(earliest.replace("Z", "+00:00")) - timedelta(seconds=300)
                            since_ts = dt.isoformat().replace("+00:00", "Z")
                        except (ValueError, TypeError):
                            since_ts = None
                    timeline = await self.manager.client.get_messages(session, gid, since_ts=since_ts)
                    for member_dir, missing in members:
                        base = done
                        async def _cb(c, t, _base=base):
                            progress.set_completed(_base + c, detail=f"{_base + c:,} files")
                        report = await self.manager.reconcile_member_media(
                            session, member_dir, missing, timeline, progress_callback=_cb
                        )
                        done += report["repaired"] + report["failed"]
                        totals["repaired"] += report["repaired"]
                        totals["failed"] += report["failed"]
                        totals["still_missing"] += report["still_missing"]

            progress.complete()
            progress.set_result(totals)
            logger.info("verify_complete", service=self._service, **totals)
            return totals
        finally:
            self.running = False
```

- [ ] **Step 3: Run to verify pass.** Run: `uv run pytest backend/tests/test_verify_media.py -v` — Expected: PASS. Iterate on the test's stubbing until green (the production code is the target; keep it unchanged unless a real bug surfaces).

- [ ] **Step 4: Commit.**

```bash
git add backend/services/sync_service.py backend/tests/test_verify_media.py
uv run git commit -m "feat(sync): add verify_and_fix_media backfill orchestrator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `POST /api/sync/verify` endpoint

**Files:**
- Modify: `backend/api/sync.py`
- Test: `backend/tests/test_sync_api.py`

**Interfaces:**
- Produces: `POST /api/sync/verify?service=<svc>` → `{"status": "started", "service": svc}`; 400 on invalid service or when a sync/verify is already running for that service. Runs `verify_and_fix_media` in a background task; maps `SessionExpiredError`→`progress.error("SESSION_EXPIRED")`, `RefreshFailedError`→`"REFRESH_FAILED"`.

- [ ] **Step 1: Write the failing test** (follow the FastAPI `TestClient` pattern already in `test_sync_api.py`):

```python
def test_verify_endpoint_starts(monkeypatch, client):
    import backend.api.sync as sync_api

    called = {}
    async def fake_verify(self):
        called["ran"] = True
        return {"missing": 0}
    monkeypatch.setattr(sync_api.SyncService, "verify_and_fix_media", fake_verify, raising=False)

    resp = client.post("/api/sync/verify?service=hinatazaka46")
    assert resp.status_code == 200
    assert resp.json()["status"] == "started"


def test_verify_endpoint_rejects_bad_service(client):
    resp = client.post("/api/sync/verify?service=not_a_service")
    assert resp.status_code == 400
```

> Use the same `client` fixture / router mounting the existing sync API tests use. If the router is mounted at `/api/sync`, the path is `/api/sync/verify`.

- [ ] **Step 2: Run to verify failure.** Run: `uv run pytest backend/tests/test_sync_api.py -k verify -v` — Expected: FAIL (404).

- [ ] **Step 3: Implement.** In `backend/api/sync.py` add, mirroring `run_sync_task` / `start_sync`:

```python
async def run_verify_task(service: str):
    """Background wrapper for verify-and-fix."""
    sync_service = get_sync_service(service)
    progress = progress_manager.get(service)
    try:
        await sync_service.verify_and_fix_media()
    except SessionExpiredError:
        logger.warning(f"Verify failed for {service}: Session expired")
        progress.error("SESSION_EXPIRED")
    except RefreshFailedError:
        logger.error(f"Verify failed for {service}: All refresh attempts failed")
        progress.error("REFRESH_FAILED")
    except Exception as e:
        logger.error(f"Background verify error for {service}: {e}")
        progress.error(str(e))


@router.post("/verify")
async def verify_media(service: str = Query(..., description="Service to verify")):
    try:
        validate_service(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid service: {service}")

    sync_service = get_sync_service(service)
    if sync_service.running:
        raise HTTPException(status_code=400, detail=f"Sync/verify already running for {service}")

    progress = progress_manager.get(service)
    progress.reset()
    progress.start_phase("starting", "Starting", 0, 0, "")
    progress.set_detail("Scanning for missing media...")

    asyncio.create_task(run_verify_task(service))
    return {"status": "started", "service": service}
```

- [ ] **Step 4: Run to verify pass.** Run: `uv run pytest backend/tests/test_sync_api.py -k verify -v` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add backend/api/sync.py backend/tests/test_sync_api.py
uv run git commit -m "feat(api): add POST /api/sync/verify endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PART 3 — SakaDesk frontend

> Run from the SakaDesk worktree's `frontend/` dir. Tests: `npm run test:run -- <file>`.

## Task 9: `verifyAndFix` hook + i18n keys

**Files:**
- Modify: `frontend/src/shell/hooks/useSync.ts` — add `verifyAndFix`, export it.
- Modify: `frontend/src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json` — add keys.
- Test: add a focused test near the existing `src/utils/syncFormatters.test.ts` style, OR a hook test if the repo has a pattern; otherwise verify via Task 11 manual run.

**Interfaces:**
- Produces: `verifyAndFix(service: string) => Promise<void>` on the object returned by `useSync`, which POSTs `/api/sync/verify?service=…`, opens the sync modal, and reuses `pollSyncProgress(service, true)`.

- [ ] **Step 1: Add i18n keys** to all five locale files under the `settings` object (next to `cleanBlogCache`). English (`en.json`):

```json
    "verifyFixMedia": "Verify & fix media",
    "verifyFixMediaDesc": "Scan downloaded messages and re-download any missing images or videos.",
    "verifyFixRunning": "Verifying…",
    "verifySummary": "Checked {{checked}} files · repaired {{repaired}} · {{stillMissing}} still unavailable",
    "verifyNoGaps": "All media present — nothing to fix."
```
Japanese (`ja.json`):
```json
    "verifyFixMedia": "メディアを検証・修復",
    "verifyFixMediaDesc": "ダウンロード済みメッセージを走査し、欠落した画像や動画を再取得します。",
    "verifyFixRunning": "検証中…",
    "verifySummary": "{{checked}} 件を確認 · {{repaired}} 件を修復 · {{stillMissing}} 件は取得不可",
    "verifyNoGaps": "すべてのメディアが揃っています。"
```
Simplified Chinese (`zh-CN.json`):
```json
    "verifyFixMedia": "校验并修复媒体",
    "verifyFixMediaDesc": "扫描已下载的消息，重新下载缺失的图片或视频。",
    "verifyFixRunning": "校验中…",
    "verifySummary": "已检查 {{checked}} 个文件 · 修复 {{repaired}} 个 · {{stillMissing}} 个仍不可用",
    "verifyNoGaps": "所有媒体均已存在，无需修复。"
```
Traditional Chinese (`zh-TW.json`):
```json
    "verifyFixMedia": "驗證並修復媒體",
    "verifyFixMediaDesc": "掃描已下載的訊息，重新下載缺失的圖片或影片。",
    "verifyFixRunning": "驗證中…",
    "verifySummary": "已檢查 {{checked}} 個檔案 · 修復 {{repaired}} 個 · {{stillMissing}} 個仍無法取得",
    "verifyNoGaps": "所有媒體皆已存在，無需修復。"
```
Cantonese (`yue.json`) — note this file nests one level deeper (see its existing indentation):
```json
        "verifyFixMedia": "驗證同修復媒體",
        "verifyFixMediaDesc": "掃描已下載嘅訊息，重新下載唔見咗嘅圖片或者影片。",
        "verifyFixRunning": "驗證緊…",
        "verifySummary": "檢查咗 {{checked}} 個檔案 · 修復咗 {{repaired}} 個 · {{stillMissing}} 個仲攞唔到",
        "verifyNoGaps": "所有媒體都齊，唔使修復。"
```

- [ ] **Step 2: Verify JSON validity.** Run: `node -e "['en','ja','zh-CN','zh-TW','yue'].forEach(l=>require('./src/i18n/locales/'+l+'.json'))"` — Expected: no output, exit 0. Fix any trailing-comma/parse errors.

- [ ] **Step 3: Implement `verifyAndFix`** in `useSync.ts`, right after `startSync` (mirror its structure — it already has `pollSyncProgress`, `setShowSyncModal`, `activeServiceRef`, `i18n`):

```typescript
    const verifyAndFix = useCallback(async (service?: string) => {
        const targetService = service || activeServiceRef.current;
        if (!targetService) {
            console.error('verifyAndFix: No service specified and no active service');
            return;
        }
        if (targetService === activeServiceRef.current) setShowSyncModal(true);

        const initialProgress: SyncProgress = {
            state: 'running',
            phase: 'starting',
            phase_name: i18n.t('settings.verifyFixRunning'),
            detail: i18n.t('sync.initializing'),
        };
        setSyncProgressByService(prev => ({ ...prev, [targetService]: initialProgress }));
        if (targetService === activeServiceRef.current) setSyncProgress(initialProgress);

        try {
            const response = await fetch(
                `/api/sync/verify?service=${encodeURIComponent(targetService)}`,
                { method: 'POST' },
            );
            if (response.ok || response.status === 400) {
                pollSyncProgress(targetService, true);
            } else {
                const data = await response.json().catch(() => ({ detail: i18n.t('sync.unknownError') }));
                const errorProgress: SyncProgress = { state: 'error', detail: data.detail || i18n.t('sync.failedToStart') };
                setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
                if (targetService === activeServiceRef.current) setSyncProgress(errorProgress);
            }
        } catch {
            const errorProgress: SyncProgress = { state: 'error', detail: i18n.t('sync.failedToStart') };
            setSyncProgressByService(prev => ({ ...prev, [targetService]: errorProgress }));
            if (targetService === activeServiceRef.current) setSyncProgress(errorProgress);
        }
    }, [pollSyncProgress]);
```

Add `verifyAndFix` to the object this hook returns (find the `return { startSync, ... }` and include it).

- [ ] **Step 4: Ensure the `SyncProgress` type allows the `result` field** (so the modal can read it). Find the `SyncProgress` TS interface (near `useSync.ts` or a shared types file) and add an optional field:

```typescript
    result?: {
        members: number; checked: number; missing: number;
        repaired: number; failed: number; still_missing: number;
    } | null;
```

- [ ] **Step 5: Typecheck + commit.** Run: `npm run build` (or `npx tsc --noEmit`) — Expected: no type errors. Then:

```bash
git add src/shell/hooks/useSync.ts src/i18n/locales
uv run git commit -m "feat(frontend): add verifyAndFix hook and i18n strings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Settings button + completion summary

**Files:**
- Modify: `frontend/src/shell/components/SettingsModal.tsx` — add the button in the `sync` tab.
- Modify: the sync progress modal component (the one that renders `syncProgress` — locate via `grep -rl "phase_name" src/`) — render the `result` summary on completion.

**Interfaces:**
- Consumes: `verifyAndFix` from `useSync` (wire it through the same prop/context path `SettingsModal` already uses for sync actions; if `SettingsModal` has no sync handle, pass `verifyAndFix` in as a prop from the parent that renders it, alongside the existing `onSaveSettings`).

- [ ] **Step 1: Add the button** in `SettingsModal.tsx` in the `sync` tab, as a new block (place it after the blog-backup block, before "Sync read status to phone"). It needs the active service; `SettingsModal` already knows the active service context (use the same source the rest of the modal uses; if none, accept an `activeService: string` + `onVerifyAndFix: (service: string) => void` prop):

```tsx
                    {/* Data completeness: verify & fix media */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">
                                {t('settings.verifyFixMedia')}
                            </label>
                            <button
                                onClick={() => onVerifyAndFix(activeService)}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                                {t('settings.verifyFixMedia')}
                            </button>
                        </div>
                        <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">
                            {t('settings.verifyFixMediaDesc')}
                        </p>
                    </div>
```

Wire `onVerifyAndFix` / `activeService` from wherever `SettingsModal` is rendered (the same component tree that owns `useSync`). Follow the existing prop pattern (`onSaveSettings` is already threaded in the same way).

- [ ] **Step 1b: Forward `result` through the poller (REQUIRED — the summary is dead without it).** In `frontend/src/shell/hooks/useSync.ts`, `pollSyncProgress` rebuilds the `SyncProgress` object field-by-field and currently drops the backend's `result`. In the `state === 'complete'` branch (grep `'complete'` / where it constructs the completed `SyncProgress`), add `result: data.result ?? null` to the constructed object so `SyncProgress.result` is actually populated for the modal to render. Verify the poll response type includes `result` (extend the response interface if needed). Without this, `progress.result` is always undefined and Step 2 renders nothing.

- [ ] **Step 2: Render the summary** in the sync progress modal. Locate the component that renders `syncProgress.phase_name` / `detail` (`grep -rl "phase_name" src/shell`). When `state === 'complete'` and `result` is present, add a localized summary line:

```tsx
{progress.state === 'complete' && progress.result && (
    <p className="mt-2 text-xs text-gray-600">
        {progress.result.missing === 0
            ? t('settings.verifyNoGaps')
            : t('settings.verifySummary', {
                  checked: progress.result.checked,
                  repaired: progress.result.repaired,
                  stillMissing: progress.result.still_missing,
              })}
    </p>
)}
```
Use whatever the modal's local variable for the progress object is named (`progress` / `syncProgress`).

- [ ] **Step 3: Typecheck/build.** Run: `npm run build` — Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/shell/components/SettingsModal.tsx src/shell/  # include the modified modal component
uv run git commit -m "feat(frontend): add Verify & Fix media button and summary

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: End-to-end verification + docs

**Files:**
- Modify: `SakaDesk/docs/KNOWN_BUGS.md`, `SakaDesk/CHANGELOG.md`.

- [ ] **Step 1: Backend suite green.** From the SakaDesk worktree: `uv run pytest backend/tests -q` — Expected: PASS (aside from any pre-existing known-flaky tests; do not mask new failures).

- [ ] **Step 2: Frontend build + tests green.** From `frontend/`: `npm run test:run` and `npm run build` — Expected: PASS / clean build.

- [ ] **Step 3: Drive the real app.** Use the `/run` skill (or the project's `dev.sh`) to launch SakaDesk. Manually: create a deliberate gap (delete one downloaded `picture/*.jpg` under a member), open Settings → Sync → click **Verify & fix media**, and confirm the progress modal runs and the deleted file is re-downloaded and the summary shows `repaired ≥ 1`. Confirm a second click reports `verifyNoGaps`.

- [ ] **Step 4: Docs (zero-drift).** Add to `docs/KNOWN_BUGS.md` a resolved note that interrupted initial sync could strand media and is now prevented + fixable via Verify & Fix. Add a `CHANGELOG.md` entry:

```markdown
### Added
- **Verify & Fix media** (Settings → Sync): scans downloaded messages and
  re-downloads any missing images/videos, per service.
### Fixed
- Interrupted syncs no longer permanently skip message media — the sync cursor is
  held behind any message whose media has not been confirmed on disk.
```

- [ ] **Step 5: Commit.**

```bash
git add docs/KNOWN_BUGS.md CHANGELOG.md
uv run git commit -m "docs: note media-completeness fix and Verify & Fix feature

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Finish the branch.** Use `superpowers:finishing-a-development-branch` to decide merge/PR for each repo (pysaka first, then SakaDesk). SakaDesk depends on the pysaka changes being on pysaka's integration branch.

---

## Notes on sequencing & dependencies

- **pysaka before SakaDesk.** Tasks 1-4 must be committed on pysaka's branch before SakaDesk Task 7 can pass (it imports `scan_member_media` / `reconcile_member_media`). If SakaDesk's editable `../pysaka` points at the main pysaka checkout rather than the worktree, either merge pysaka's branch into its main or temporarily point the dep at the worktree.
- **The prevention fix (Task 2) and the button (Tasks 3-10) are independently valuable** — if execution is interrupted, a completed Part 1 already stops new gaps from forming.
