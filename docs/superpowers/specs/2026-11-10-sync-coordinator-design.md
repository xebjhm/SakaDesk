# Sync coordinator, honest progress, deferred inline media

Date: 2026-11-10. Status: approved (user, 2026-11-10), with the decisions listed at the end.
Branches: SakaDesk `fix/sync-coordinator` (worktree `../SakaDesk-sync`), pysaka `feat/deferred-backfill-media` (worktree `../pysaka-sync`).
Scope: three items, all approved for implementation in discussion (user, 2026-11-10). S3 needs a pysaka release (0.4.8) before the SakaDesk PR can pass CI (`--no-sources`).

## Problem (from the user's fresh-install run, Windows log, 2026-11-10)

The user wiped the output folder and installed a new build to reproduce a first-time user. The sync dialog showed "Phase 2: Collecting metadata — 日向坂46 (1/4)", while media from other services was already on disk. The progress shown did not match the real work, and the ETA was meaningless.

| UTC | Event |
|---|---|
| 02:04:58 | Backend start. The AutoSyncScheduler waits start here. |
| 02:09:09 | `sync_launch origin=api service=hinatazaka46`: the first-launch sequence (`startSequentialSync`). |
| 02:11:43 | `sync_launch origin=scheduler service=yodel` |
| 02:12:09 | `sync_launch origin=scheduler service=nogizaka46`, ending with `phase3_complete media_count=250` at 02:12:32 |
| 02:13:12 | `sync_launch origin=scheduler service=sakurazaka46`, ending with `phase3_complete media_count=713` at 02:15:14 |
| 02:19:35 | The scheduler runs Nogizaka and Sakurazaka again. Hinatazaka is still in phase 2. |

The run shows three separate faults.

1. **Two orchestrators.** The "one service at a time" sequence lives only in the frontend (`useSync.startSequentialSync`). The backend scheduler (`auto_sync_scheduler._decide`) checks only enabled, configured and authenticated. Its timer starts at app launch, so the first tick (about 7 minutes later; login and setup took about 4) landed while the sequence was still on service 1. The startup effect (`useSync` Effect 1) also starts every connected service at once on each later app start. Each service opens its own `TCPConnector(limit=20)`, so N services download with N×20 connections and compete for the same bandwidth. When the sequence later reaches a service the scheduler already synced, it either runs it again or attaches halfway through (the progress jumps straight to phase 3).
2. **Phase 2 downloads media.** In `sync_room`, every member runs pysaka `backfill_past_messages()` (pre-subscription messages plus their media, through its own `process_media_queue`) and `sync_letters()` (letter-card images, `download_file` one by one). Both run inline, member after member. On a fresh install every member does both, so the step labelled "Collecting metadata" writes media, runs slowly (0.03 members/s in the screenshot), and none of those files are counted in phase 3.
3. **The ETA cannot be right.** `SyncProgress.get_status` computes `eta = remaining / (completed / phase_elapsed)`:
   - It covers only the current phase of the current service. Phase 3 (usually the longest) and the remaining services are not included.
   - In phase 2 the unit is a member, but work per member varies by orders of magnitude (rooms of 12 to 7,019 messages in this log). On a first sync every room is a history scan, serialised by `scan_sem` and paced at `SCAN_TIMELINE_INTERVAL = 3.0` s per timeline request, and members complete in bursts when their room finishes.
   - The speed is a cumulative average since the phase started, so stalls and bursts dominate it.
   - In phase 3, pysaka `process_media_queue` calls the progress callback only for successes, so a single failed download leaves the bar short of 100 % for good.
   - The "Elapsed" tile is phase elapsed, which resets at every phase.

## S1. One backend sync queue; the frontend only displays it

### Design

1. **`backend/services/sync_coordinator.py`** owns a FIFO queue of jobs `{service, kind: "sync" | "verify", include_inactive, force_resync, origin, sequence_id?}` and runs **one job at a time across all services** (a single serial runner). Every writer path goes through it: `POST /api/sync/start`, the scheduler and the tray through `sync_launcher` (a thin call to `coordinator.enqueue(...)`), `POST /api/sync/verify` and `/start-all` directly.
   - **Results:** `started` (the slot was free), `queued` (with `position`), `already_running`, `already_queued` (dedup: one queued or running job per service and kind; a queued `force_resync` upgrades an existing queued sync instead of adding a second job), `shutting_down`.
   - **Runner.** A single runner task pops the next job and awaits `run_sync_task` / `run_verify_task`, unchanged. `SyncService._task` and `_generation` keep their meaning, so `/cancel` still reaches the running job with a real `task.cancel()`.
   - **Progress of a queued service.** When a job is enqueued its tracker is `reset()` and set to the new state `queued` with `queue_position` (1-based) in `/api/sync/progress`. When the job starts, the tracker moves to `starting` as today.
   - **Shutdown.** `is_shutting_down()` refuses new jobs (as today). On shutdown the coordinator drops queued jobs (logged) before `quiesce_writers()`. The running job is handled by the existing quiesce path.
   - **Trade-off.** A long first sync of a newly added service delays the incremental syncs (and new-message toasts) of the other services until it ends. That is accepted: the user asked for progress that matches reality, and incremental syncs take seconds.
2. **Sequences.** `POST /api/sync/start-all` with body `{services: [...], blocking: bool}` enqueues one job per service under a new `sequence_id`, in the fixed order `SERVICE_SYNC_ORDER = ("nogizaka46", "sakurazaka46", "hinatazaka46", "yodel")` (user decision; the request order is ignored, and a service missing from the tuple goes last in request order) and returns `{sequence_id, results: {service: result}}`. `GET /api/sync/queue` returns `{running: {service, kind} | null, queued: [{service, kind, position}], sequence: {id, services, current_index, blocking, state: "running" | "complete" | "cancelled", completed: [...], failed: [...]} | null}`. The last finished sequence stays readable until the next one starts, so a reloaded window can show its result.
   - **Cancel.** `POST /api/sync/cancel?service=X` cancels X (running, or removed from the queue). `POST /api/sync/cancel?sequence=<id>` cancels the running job of that sequence and drops its remaining jobs. Jobs from other origins (scheduler, tray) stay queued.
3. **Scheduler.** `_decide` gains, before the launch, `sequence_active` (a sequence is running) → no launch. When a sequence ends (any state), the coordinator calls `wake_scheduler()`. The existing wake semantics ("re-read the settings and start a full new wait, without a tick") make the first scheduled sync count from the end of the first sync, not from app launch. A scheduler launch that finds its service queued returns `already_queued`.
4. **Frontend (`useSync`, `SyncModal`, `App`).** The backend is the single source of truth for the queue.
   - `startSequentialSync(services)` calls `start-all` with `blocking: true` and then polls `GET /api/sync/queue` (1 s) plus `/api/sync/progress` of `sequence.running`. `sequentialSyncInfo` is derived from the queue response, never from a local loop index. The force-clear `isPollingRef.current[service] = false` hack goes away.
   - `startSyncAllServices` and the startup effect (Effect 1) call `start-all` with `blocking: false` instead of N parallel `startSync`. The fresh check (`/api/settings/fresh`) still decides `blocking`.
   - On mount, if `GET /api/sync/queue` reports a running `blocking` sequence, the modal reopens on it (window reload, crash).
   - `pollSyncProgress` handles `state: "queued"`: keep polling, and show "Waiting (#n)" (new i18n key `sync.queued`, five locales) in the inline sync view.
   - Cancel in the sequence modal calls `cancel?sequence=<id>`.
   - `useBackendSyncWatcher` treats `queued` like `running` (attach the follower).
5. **Breadcrumbs.** `sync_queue` (action `enqueued` / `started` / `finished` / `dropped` / `deduped` / `cancelled`, service, kind, origin, position, sequence_id; `finished` carries `outcome` `complete` / `error` / `cancelled` and `elapsed`). `sync_sequence` (backend: action `started` / `finished`, sequence_id, count, outcome). `auto_sync_tick reason=sequence_active`. `sync_launch` keeps its fields and adds `position` for `queued`. Ids and codes only.

### Tests

- Coordinator: two services enqueued run one after the other, never overlapping (a fake `run_sync_task` records start/end). Dedup returns `already_running` / `already_queued`. A queued `force_resync` upgrades the queued job. Cancelling a queued job removes it without running it. Sequence cancel drops only that sequence's jobs. Shutdown drops queued jobs.
- Progress: a queued service reports `state: queued` with the right `queue_position`, which drops as jobs ahead of it finish.
- Scheduler: `sequence_active` skips the launch. The end of a sequence wakes the scheduler, and the next tick comes one full interval later (fake sleep).
- API: `start-all` runs services in `SERVICE_SYNC_ORDER` whatever the request order (e.g. `[yodel, hinatazaka46, nogizaka46]` → 乃, 日, Yodel), plus its results; `GET /api/sync/queue` shape; `cancel?sequence=`.
- Frontend (vitest + msw): the sequence modal follows the backend `current_index`; a `queued` progress keeps the poller alive; a remount during a blocking sequence reopens the modal; Effect 1 sends a single `start-all`.
- Regression: replay the 2026-11-10 timeline (sequence of four services, scheduler ticks at +2.5 min) and assert that no second `run_sync_task` starts before the first finishes.

## S2. Honest progress and ETA

### Design

1. **Run elapsed.** `SyncProgress` records `run_started_at` at `reset()` and reports `run_elapsed_seconds`. The "Elapsed" tile shows run elapsed, so it no longer resets at each phase. `elapsed_seconds` (phase) stays in the payload for compatibility.
2. **Recent speed.** Speed is a sliding window over the last `SPEED_WINDOW_SECONDS = 30` of `(time, completed)` samples (recorded on every update, at most one sample per 0.5 s), not the cumulative phase average. Below 2 samples it falls back to the phase average.
3. **ETA only where it can be right.** `eta_seconds` is set only in phase `downloading`, and only after at least `ETA_MIN_ITEMS = 20` items and `ETA_MIN_SECONDS = 10` in the phase. Otherwise `eta_seconds` is `null` and a new field `eta_reason` says why: `not_estimable` (scanning, discovering, collecting metadata: work per unit is unknown) or `warming_up` (downloading, before the thresholds). The frontend shows "—" for `not_estimable` and "Estimating…" (new key `time.etaEstimating`, five locales) for `warming_up`. There is no cross-service ETA: the sequence chip ("日向坂46 (1/4)") already shows where the run is.
4. **Phase 3 counts every processed file.** SakaDesk passes pysaka's new `item_callback` (S3.3) and counts `processed` (success or failure) for `completed`, plus a `failed` count shown in `detail_extra` ("2 failed", new i18n key `sync.filesFailed`). The bar always reaches 100 %, and Verify & Fix still repairs the failures. The `phase3_complete` log gains `downloaded` and `failed`.
5. **Phase 1 moves.** `discovering` updates `completed` once per group whose member list was read (it stays at 0 today).
6. **Phase 2 detail does not flicker between rooms.** While a room holds `scan_sem`, `detail` shows that room (`detail_code: scanning_history`). Member completions in other rooms update the counter without overwriting `detail`. Without a scan, the last completed member stays the detail, as today.

### Tests

- `SyncProgress`: `run_elapsed_seconds` survives `start_phase`. The window speed reflects only the last 30 s (`time-machine`). `eta_seconds` is `null` with `eta_reason=not_estimable` in `syncing`, `warming_up` below the thresholds, and a number after them.
- Phase 3: with one failing download out of three, `completed == total == 3` and `failed == 1` at the end.
- Phase 1: `completed` reaches the number of open groups.
- Frontend: the ETA tile renders "—" and "Estimating…" for the two reasons. The elapsed tile uses `run_elapsed_seconds`.

## S3. pysaka: backfill and letter media join the phase-3 queue

### Design (pysaka 0.4.8, backward compatible)

1. **`SyncManager.backfill_past_messages(..., media_queue: list | None = None)`.** With `media_queue=None` it behaves exactly as today. With a list, the media items from `prepare_messages` are appended to it (same item format as `sync_member`, so phase 3 merges dimensions into `messages.json` as usual), nothing is downloaded, and `past_backfilled_at` is **not** set. Instead the manager records a pending finalisation for the member: the queued paths and whether every past message normalised. When nothing had to be queued, the flag is set at once, as today (nothing to wait for).
2. **`SyncManager.sync_letters(..., media_queue: list | None = None)`.** Same pattern. With a list, letter-card images are appended as items with `media_type: "picture"`, `kind: "letter"` and **no `member_dir`**, so `process_media_queue` never writes their dimensions into `messages.json`. Images already on disk are not queued. After a complete fetch, the `letters_updated_at` cursor move is recorded as pending, unless every image is already present (then it moves at once).
3. **`process_media_queue(..., item_callback=None)`.** A new optional callback `item_callback(ok: bool)` (sync or async) runs once per item, success or failure. `progress_callback` keeps its current meaning (successes only), so existing callers see no change.
4. **`SyncManager.finalize_deferred_media() -> dict`.** For every pending entry it applies today's completion rule: it sets `past_backfilled_at` when every past message normalised and every queued file is on disk, and it moves `letters_updated_at` when the fetch was complete and every image is on disk. It then saves `sync_state` once and clears the pending set. Returns `{"backfill_marked": n, "letters_marked": n, "still_pending": n}`. Pending entries live in memory only: a sync that stops before finalising leaves the flags unset, so the next sync re-fetches (merging is idempotent, as today).
5. **Docs.** Docstrings for both methods and the new parameters. CHANGELOG `[Unreleased]` → `Added` (`media_queue` on both methods, `item_callback`, `finalize_deferred_media`), written for API consumers.

### SakaDesk side

- `sync_room` passes `media_queue` to both calls, so phase 2 makes API calls and writes JSON only.
- After phase 3 and `_mark_scanned_rooms`, `start_sync` calls `manager.finalize_deferred_media()` and logs `deferred_media_finalized` with its counts. A cancelled or failed phase 3 skips it (logged `deferred_media_finalize_skipped reason=...`).
- `media_count` in phase 3 now includes these items. `phase2_complete` logs `deferred_media_items`.
- `pyproject.toml`: `pysaka==0.4.8` (dev currently pins 0.4.6).

### Tests

- pysaka: with `media_queue`, `backfill_past_messages` downloads nothing (respx: no media request), appends the items, and leaves the flag unset. After the files exist, `finalize_deferred_media` sets it. A missing file keeps it unset (`still_pending`). The same three cases for `sync_letters` and its cursor. Letter items carry no `member_dir`. `item_callback` fires for a failed download, and `progress_callback` still counts successes only. Without `media_queue` the current tests pass unchanged. 100 % coverage of the new code.
- SakaDesk: phase 2 with a fake manager makes no `download_file` call. Finalisation runs after phase 3 and is skipped on cancel.

## Rollout

1. pysaka PR (`feat/deferred-backfill-media`) → merge → release 0.4.8 (the `/release` flow; `publish.yml` creates the GitHub Release).
2. One SakaDesk PR on `fix/sync-coordinator` with atomic commits: S1 backend, S1 frontend, S2, S3 (pysaka bump plus wiring), and docs.
3. Acceptance on Windows, repeating the user's test: empty output folder, fresh install of the build, four services. Expected: `debug.log` shows `sync_queue started` strictly one service after another, no `origin=scheduler` launch during the sequence, no media files written while the dialog shows phase 2, and the phase-3 bar reaching 100 %.

## Out of scope

- The blog backup, which runs alongside message syncs after a sync when `blogs_full_backup` is on. It has its own pool. It can be revisited after this lands if bandwidth contention still shows.
- A cross-service or whole-run ETA.
- saka-cli adopting `media_queue` / `finalize_deferred_media` (it keeps today's behaviour through the defaults).

## Decisions (user, 2026-11-10)

1. **Verify & Fix joins the same queue** (S1.1). It waits behind a running sync instead of being refused with "already running".
2. **One job at a time applies to every job**, including scheduled incremental syncs.
3. **Service order is 乃木坂46 → 櫻坂46 → 日向坂46 → Yodel** (S1.2).

## Implementation notes (release review, 2026-11-10)

Where the shipped code differs from or refines the design above:

- **Queued tracker.** A job's tracker is reset and set to `queued` at enqueue only when no other job of that service is running or queued. Otherwise it keeps that job's progress until this one starts. Each tracker reports `job_kind` (`sync` / `verify`), and the frontend waits for the kind it started. A Verify & Fix queued behind a sync therefore shows its own findings, not the sync's completion.
- **Queue snapshot.** `GET /api/sync/queue` also returns `origin` for `running` and each `queued` job.
- **Cancel.** `cancel?sequence=` drops the sequence's own jobs and any job adopted into it. Jobs outside the sequence stay queued. A cancelled sequence stops counting as active at once, so the scheduler and a new start-all no longer wait for it, and a new start-all is never joined to it. A cancel that lands after enqueue reserved the slot, but before the job's task exists, is honoured (the job never runs). The frontend applies a Cancel pressed before the start-all answered once the sequence id arrives. A cancel that did not take effect is logged (`sync_cancel_failed`).
- **Lost sequence.** A sequence that disappears from the backend (restart) ends the frontend watch as `lost`, never as complete.
- **i18n.** The queued state uses `sync.phaseQueued` ("Waiting") and `sync.queuedDetail` ("Waiting for another sync to finish (#n in line)"), not a single `sync.queued` key.
- **Breadcrumbs.** `sync_queue` also emits `refused`, `cancel_not_running`, `job_failed` and `runner_failed`; `sync_sequence` also emits `joined` and `cancelled`.
- **Progress (S2).**
  - Run elapsed starts at the run's first `start_phase`, so time spent queued is not counted.
  - Failed downloads are a separate `failed` field (shown as "· n failed"), not `detail_extra`.
  - The discovering bar moves once per group handled (closed, failed or read).
- **S3.** pysaka's `finalize_deferred_media` also returns `saved`, which SakaDesk logs.
