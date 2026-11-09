# Media and polling reliability (R-i) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining cause of video stalls found by the real-data smoke test on dev 2dd8836 (qa5), and fix the small defects it found.

**Evidence (qa5, `C:\D\saka-verify\qa5\`, network logs `qa5\work\net2.jsonl`):** for ~30 min all media loads in < 1 s. Then three `/api/sync/progress` requests stayed unanswered ~495 s; while they were pending every other progress poll waited exactly ~20 000 ms before being sent (296 times) — Chromium's HTTP cache lock (concurrent requests to the same cacheable URL wait for the in-flight writer, timeout 20 s); responses carry no `Cache-Control`; a default `fetch` took 8 712 ms vs 16 ms with `cache:'no-store'`. During that window 6/6 videos and voices stayed at readyState 0 and Favourites media reached the server exactly 15 s late. Client-side ESTABLISHED sockets to :14649 had no server counterpart (half-open). The stall cleared when the 495 s requests completed.

**Tech Stack:** FastAPI/uvicorn (Windows Proactor), React + TS, Vitest, pytest.

## Global Constraints

Same as R-h: read "## Global Constraints" in `docs/superpowers/plans/2026-11-09-v2-acceptance-round3.md` and the R-f constraints it references (breadcrumbs both sides + pytest, async hygiene, logging without PII, tokens only, i18n ×5, zero-drift docs, Conventional Commits via `uv run git commit` ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, never stage `.superpowers/`). CHANGELOG `[Unreleased]` in the last task only.

---

### Task 1: Root-cause the never-answered requests and half-open sockets (investigation + fix)
Use superpowers:systematic-debugging. Why did three `/api/sync/progress` requests go unanswered for ~495 s, and why do client-side sockets stay ESTABLISHED with no server counterpart? Candidates to test: the proactor guard (`backend/services/proactor_resets.py:~70-83`) detaching a transport whose socket is then never closed or whose protocol never learns the connection is gone; uvicorn/h11 keep-alive reuse of a connection the server has dropped (client sends the request on a dead keep-alive socket and waits until a TCP timeout); a handler that blocks (e.g. `/api/sync/progress` waiting on a lock held by sync); thread-pool exhaustion. Reproduce on the acceptance build over CDP and with a local Windows-like harness where possible; read `backend/api/sync.py` (~137) and uvicorn config (find where it's started). Fix the root cause (e.g. make the guard close the socket and notify the protocol; set uvicorn `timeout_keep_alive` / disable keep-alive reuse after resets; make the progress handler non-blocking) with tests. Report the evidence. Commit `fix(server): never leave requests unanswered on reset connections` (adjust to the real cause).

### Task 2: No browser cache lock on API polls
- Backend: middleware adding `Cache-Control: no-store` to every `/api/` JSON response (not media/avatar/thumbnail routes, which keep their caching headers). Tests.
- Frontend: polling hooks (`frontend/src/shell/hooks/useBackendSyncWatcher.ts:~73`, `useSync.ts:~285`, the groups / unread_counts polls) fetch with `cache: 'no-store'`, never start a poll while the previous one for the same key is pending, and abort a poll after ~4 s (AbortController) with a breadcrumb on timeout (register both sides). Tests. Commit `fix(sync): uncached, non-overlapping polls with timeouts`.

### Task 3: Fewer requests per bubble
- Batch translation lookups (`frontend/src/hooks/useMessageTranslation.ts:~62`, one `/api/app-state/translations` call per mounted bubble → one batched call per visible window, e.g. a debounced loader that collects ids for 50 ms; backend endpoint accepts a list if it doesn't already). Tests.
- Favourites voices load metadata only when visible (`FavoritesModal.tsx:~221`, same lazy pattern as the video cards).
- Lower `media_request` logging to sampled/aggregate at debug level so the log doesn't rotate every ~20 min (keep warnings and disconnect/errors). Commit `perf(app): batch translation lookups and lazy-load favourite voices`.

### Task 4: Small UI defects from qa5
- `frontend/src/core/media/useZoomPan.ts:~36,55-57`: snap scale to `MIN_ZOOM` when `scale - MIN_ZOOM < 1e-6` (float residue keeps zoom-out/fit enabled and the grab cursor at fit). Test.
- Chat scrollbar thumb clipped into a wedge by the sheet's 24 px rounded corner when scrolled to the bottom: add `margin-block` on `::-webkit-scrollbar-track` for scrollers inside rounded sheets (index.css ~70; scope to the sheet scrollers or globally if harmless). Style test.
- Media durations sometimes "0:00 / 0:00": in `VoicePlayer.tsx:~186-200` and `VideoPlayer.tsx:~161-167` read duration immediately when `readyState >= 1` after binding listeners, and also listen to `durationchange`. Tests.
- Commit `fix(media): exact fit zoom, unclipped scrollbars and reliable durations`.

### Task 5: CHANGELOG and full checks
End-user entries: videos and voices keep loading during long sessions; durations always show; small zoom and scrollbar polish. Full suites. Commit `docs(changelog): note media reliability fixes`.
