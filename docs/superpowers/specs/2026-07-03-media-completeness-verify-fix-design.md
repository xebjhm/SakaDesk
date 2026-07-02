# Media Completeness: Prevention + Verify & Fix — Design

**Date:** 2026-07-03
**Repos touched:** `pysaka` (SDK, prevention + reconcile primitive), `SakaDesk` (backend orchestration + API + UI)
**Status:** Approved — scope confirmed by user 2026-07-03: both parts, one-click, per-service. ToS/re-login is root-caused here but fixed in a separate follow-up.

---

## 1. Problem

A user reports message **text** syncs correctly but **images are missing in large ID ranges** (e.g. IDs jump from `…126584` to `165748`, everything between absent). Confirmed root cause:

pysaka syncs a member in two stages that SakaDesk drives separately:

1. `SyncManager.sync_member` writes `messages.json` **and advances the per-member cursor** `last_sync_ts` (`manager.py:315`), but only *queues* media (`prepare_messages`, `manager.py:323-404`, queued only when `filepath.exists()` is false). `media_file` is written onto every message regardless of whether the file was ever downloaded.
2. `SyncManager.process_media_queue` (SakaDesk phase 3, `sync_service.py:559-618`) downloads the queued bytes **after** the cursor already advanced.

If stage 2 is interrupted (app closed, `ConnectionResetError [WinError 10054]`, token expiry, network drop), the text is saved and the cursor has already jumped forward. The next sync fetches the timeline with `since_ts = cursor`, filtering those messages out, so their media is **never re-queued** — a permanent, silent gap. Phase 3 reporting "No new media to download" is technically correct.

**Aggravating factors**

- `client.download_file` (`client.py:677-706`) has **no retry** and writes by truncating the destination then reading the full body inside the open context. An interrupted read leaves a 0-byte/truncated file that then *masquerades as complete* forever (both `prepare_messages` and `download_file` treat `filepath.exists()` as "done").
- The original media **URL is not persisted** in `messages.json` (only the local `media_file` path). Fresh signed URLs require re-fetching the timeline. So a pure disk scan can *detect* gaps but cannot *repair* them alone.

**Out of scope for this work — ToS & "re-login to all services" (root-caused here, fixed in a follow-up).** Two unrelated mechanisms that only *appear* to be one event:

- **ToS panel** is gated solely by `localStorage['tos_accepted_at']` (`App.tsx:164-172`, `TosDialog.tsx:20`) — no backend/token linkage. It reappears only when that storage is wiped: Reset-to-defaults, fresh install, or the WebView/pywebview profile storage not persisting across a launch (an app update or profile-path change). Intermittent ToS ⇒ local WebView storage is being cleared; the follow-up should pin down which launch clears it.
- **"Re-login to all services"** is JWT token expiry surfaced for every service at once: `/api/auth/status` is queried with `service=None`, so when refresh fails they all flip to `token_expired` together (`auth_service.py:90-100`). Intermittency is explained directly by the user's log: token lifetime ~1h (`token_expires_in: 57m`) **and** `has_refresh=False` (no refresh token — renewal depends on the cookie path) **and** recurring `getaddrinfo failed` / `Cookie refresh attempt failed` during network blips. Healthy network ⇒ silent refresh, no prompt; a blip near the hour boundary ⇒ refresh fails, tokens expire, all services demand re-login.

**Follow-up (separate spec/plan, not this work):** (a) diagnose why WebView `localStorage` is cleared on some launches; (b) improve the "all services expire at once" UX and consider obtaining/persisting a refresh token so renewal survives cookie-path failures.

---

## 2. Goals / Non-goals

**Goals**
1. **Prevention:** stop interrupted syncs from permanently stranding media. A message's cursor must not advance past it until its media is confirmed on disk.
2. **Remediation:** a user-triggered **Verify & Fix** action that scans existing data, finds messages whose media is missing (or a 0-byte stub), and backfills it.
3. **Robust downloads:** eliminate the truncated-stub failure mode.

**Non-goals**
- Fixing the ToS/re-login UX (documented only).
- A background/automatic integrity scan (Verify & Fix is explicit, user-triggered). Prevention makes ongoing scans unnecessary.
- Migrating persistence to a database. Disk `messages.json` remains source of truth.
- Repairing blog media (already self-heals via `build_download_queue`).

---

## 3. Architecture

Three independent, separately-testable changes. Architecture purity preserved: all reusable logic lives in pysaka (UI-agnostic); SakaDesk only orchestrates + exposes UI.

### Part A — Prevention: gate cursor commit on media completeness (pysaka)

Mirror the existing `earliest_failed_ts` clamp precedent (`manager.py:300-315`, which already holds the cursor behind messages that fail to *normalize*). Extend the same idea to media.

**Mechanism (disk-truth, post-download reconciliation of the cursor):**
- `prepare_messages` continues to queue missing media, and additionally each queue item carries its message's `published_at` and `(group_id, member_id)` so the owning message is identifiable.
- The cursor advance in `sync_member` becomes *provisional*: `sync_member` still writes `messages.json`, but the committed `last_sync_ts` is clamped to **exclude any message whose media is not yet confirmed on disk**.
- After `process_media_queue` runs, a lightweight per-member reconcile re-checks disk truth: for each affected `(group, member)`, the cursor is committed only up to (but not including) the earliest message whose expected media file is still absent/0-byte. Members whose media all landed get the full advance.

Net effect: interruption at any point leaves the cursor behind the first message with missing media, so the **next normal sync naturally re-fetches those messages (fresh URLs) and re-downloads** — self-healing, no URL persistence, reusing the existing timeline + existence-check path.

> Implementation note (for the plan, not decided here): the exact seam — whether `sync_member` returns pending-media info for the caller to hold the cursor, vs. `process_media_queue` reporting failures back for a clamp step — is an implementation detail. The *contract* is: **cursor never commits past unconfirmed media.**

### Part B — Reconcile primitive (pysaka) + Verify & Fix orchestration (SakaDesk)

**pysaka — new UI-agnostic method** `SyncManager.reconcile_member_media(session, group, member, *, progress=None) -> ReconcileReport`:
- Read that member's `messages.json`.
- For each message with expected media (`media_file` / `file` / `thumbnail`), resolve the on-disk path and classify: **present** (exists, size > 0), **missing** (absent or 0-byte).
- If any missing: re-fetch that member's timeline (full range, ignoring the cursor) to obtain fresh signed URLs, match by message id, build a queue of the missing items, and download via the same `process_media_queue`/`download_file` path (now hardened, Part C).
- Return a report: `{checked, present, missing, repaired, failed, still_missing_ids}`.
- Pure, deterministic, testable without UI.

**SakaDesk — new** `SyncService.verify_and_fix_media(service, *, progress_manager) -> Summary`:
- Enumerate every member under `{service}/messages/**` (reuse `path_resolver`).
- Open one aiohttp session, refresh token if needed (same guard as `start_sync`), then call `reconcile_member_media` per member, streaming counts through the existing `progress_manager`.
- Aggregate a summary: members scanned, media checked, missing found, repaired, failed.
- Model the scan-then-download shape on `blog_service.build_download_queue` + `download_blog_content` (the established completeness-by-disk-scan pattern).

### Part C — Download robustness (pysaka)

Harden `client.download_file`:
- Download to a temp `*.part` file, then atomically rename on success (no truncated destination ever visible).
- Validate: non-zero bytes, and if the response sends `Content-Length`, the written size must match; otherwise discard.
- Add bounded retries (e.g. 3 attempts, small backoff) around transient errors / short reads.
- On failure, leave no stub behind (remove the `.part`).

This makes both prevention and Verify & Fix reliable, and removes the "0-byte file masquerades as complete" trap.

---

## 4. API & Frontend (SakaDesk)

**API:** `POST /api/sync/verify?service=…` in `backend/api/sync.py`, mirroring `/start`: `get_sync_service(service)` → `asyncio.create_task(run_verify_task(...))`, progress via the existing `progress_manager` (`GET /api/sync/progress`), errors via `CodedHTTPException`. `SESSION_EXPIRED` handled identically to sync.

**Frontend:** a **"Verify & Fix media"** button in the **`sync` tab** of `SettingsModal.tsx`, next to "Clean blog cache" (the de-facto maintenance section). It calls a new `verifyAndFix(service)` in `useSync.ts` (mirrors `startSync`, reuses the existing progress modal). On completion, show a summary toast/dialog: *"Checked N images, repaired M, K still unavailable."* All user-facing strings go through the existing i18n resource keys — no hardcoded text.

**UX (confirmed, §9):** single button = verify **and** fix in one flow, with live progress and an end summary — no separate dry-run. Rationale: the progress infra already exists, and a dry-run adds a step for little value when the fix is idempotent and safe.

---

## 5. Data flow

```
Verify & Fix (per service)
  UI button ──POST /api/sync/verify?service──▶ run_verify_task
     └─ SyncService.verify_and_fix_media
          refresh_if_needed(token)
          for each member under {service}/messages/**:
             SyncManager.reconcile_member_media(session, group, member)
                read messages.json → classify expected media vs disk (exists & >0)
                if missing: re-fetch timeline (fresh URLs) → queue missing
                           → process_media_queue → download_file(.part→atomic)
                emit progress; return ReconcileReport
          aggregate → Summary ──progress_manager──▶ UI summary
```

```
Normal sync (prevention, Part A)
  phase2 sync_member: write messages.json; queue missing media;
                      hold provisional cursor
  phase3 process_media_queue: download queued media (hardened)
  reconcile cursor: commit last_sync_ts only up to first message with
                    media still missing on disk
```

---

## 6. Error handling

- **Token expiry mid-verify:** same path as sync — `SessionExpiredError` → `progress.error("SESSION_EXPIRED")` → UI prompts re-login. Partial repairs already written stay valid.
- **Individual download failure:** counted in `failed` / `still_missing_ids`, never crashes the run; no stub left on disk (Part C). Because prevention gates the cursor, a still-missing item will also be retried on the next normal sync.
- **Interruption during Verify & Fix:** safe & resumable — it is idempotent; re-running re-detects whatever is still missing.
- **Timeline no longer contains an old message** (deleted upstream): report as `still_missing` / unavailable, do not error.

---

## 7. Testing

pysaka (`uv run pytest`, 100% core coverage rule):
- `reconcile_member_media`: present vs missing vs 0-byte stub classification; re-fetch + repair; deleted-upstream → still_missing; report accuracy. Use `respx` for network isolation, non-ASCII (CJK) member paths, `pathlib` + utf-8.
- Prevention: simulate interruption (media download raises after cursor stage) → assert `last_sync_ts` did **not** advance past the message with missing media → assert next sync re-queues it. `time-machine` for deterministic timestamps.
- `download_file` hardening: short read / Content-Length mismatch → `.part` discarded, no stub; retry then success; atomic rename.

SakaDesk:
- `verify_and_fix_media`: multi-member aggregation, progress emission, session-expiry propagation. `syrupy` snapshot for the summary payload.
- API `/api/sync/verify`: happy path, unknown service, session-expired mapping.
- Frontend: button wiring + summary rendering (i18n keys, including CJK/emoji).

---

## 8. Rollout / process notes

- Implement in **git worktrees per repo** (both `pysaka` and `SakaDesk` currently have active in-progress branches — `feat/knowledge-engine` and unstaged `dev` work), to avoid disturbing them. Branch: `fix/media-completeness`.
- pysaka change ships first (SDK), SakaDesk consumes it via the editable path dep.
- Conventional Commits, atomic: (1) pysaka download hardening, (2) pysaka cursor-gating prevention, (3) pysaka reconcile primitive, (4) SakaDesk service+API, (5) SakaDesk UI+i18n.
- Docs: update `pysaka` docstrings/CHANGELOG and SakaDesk `docs/KNOWN_BUGS.md` / CHANGELOG (zero-drift rule).

---

## 9. Decisions (confirmed 2026-07-03)

1. **Scope** — *both* prevention + Verify & Fix button. ✅
2. **UX** — single one-click verify-**and**-fix with live progress + end summary (no separate dry-run). ✅
3. **Granularity** — per-service button. ✅
4. **ToS/re-login** — root-caused in §1; fix deferred to a separate follow-up spec. ✅
