# Port-independent app state + close→reopen safety

**Status:** design / awaiting review
**Date:** 2026-07-07
**Scope:** SakaDesk (backend + frontend + desktop shell). Blocks the 0.3.2 release.

## Problem

All persistent frontend state lives in the WebView2 `localStorage`, which is
partitioned **per origin** (`scheme://host:port`). The desktop shell serves the
app from `http://127.0.0.1:<port>`, where `<port>` is chosen at launch by
`create_server_socket` and persisted to `%LOCALAPPDATA%\SakaDesk\.port` for reuse.

When the app is **closed and reopened quickly**, the old instance is still
shutting down (killing its workers) and still holding the saved port. The new
instance's `create_server_socket` sees the saved port as active
(`_port_is_active` → a live TCP connect), so it **allocates a new port and
overwrites `.port`**. The webview origin changes (`:5895` → `:13143`), so every
`localStorage`-backed value is orphaned and the app resurfaces first-run state —
most visibly the **Terms-of-Service gate**, but also read/unread state, language,
per-chat backgrounds, per-room scroll position, and the translation cache.

Observed in the field (2026-07-06): a fast close→reopen shifted the port
5895 → 13143 and reset the ToS gate. Confirmed via `.port`, two live
`SakaDesk.exe` processes during the overlap, and the origin-scoped `localStorage`.

### Root cause

Persistent state is tied to a value (the port) that is **not** stable across a
close→reopen race. This is a fragile coupling; the port should be irrelevant to
persistence.

### Secondary hazard

During the close→reopen overlap two backends briefly run against the **same data
directory** (`settings.json`, `messages.json`, sync state, indexes). Even though
individual writes are atomic (temp + `os.replace`), two independent writers can
still clobber each other's logical updates.

## Goals

1. **No persistent user-facing state is tied to the webview port.** ToS, language,
   read/unread, per-chat background, per-room + blog scroll position, translation
   cache, volume, and dismissed-update all survive a port change.
2. **Close→reopen is seamless:** the UI opens instantly with all state intact, no
   perceptible wait, no re-showing the ToS gate.
3. **No data-directory write races** between an outgoing and incoming instance —
   with a hard guarantee that once the outgoing instance releases the write lock,
   it performs **no further data-dir writes**.
4. Existing users lose nothing: a one-time migration copies current `localStorage`
   into the backend store.

## Non-goals

- Preventing a user from *deliberately* running two copies at once. The real
  scenario is close→reopen, not two intentional instances; the write lock makes
  even the deliberate case safe, but we do not add a "refuse to launch" gate.
- Multi-device / cloud sync of app state. Local only.
- Changing what any of this state *means* — only where it is stored.

## What moves to the backend

| Category | Current localStorage key(s) | Notes |
|---|---|---|
| ToS acceptance | `tos_accepted_at` | the blocking symptom |
| Language | `sakadesk-language` | also mirrored in `settings.json` today |
| Read/unread state | `read_state_${path}` | per conversation |
| Per-chat background | `bg_settings_${conversationPath}` | per conversation |
| Per-room / blog scroll | `useChatScroll`, `BlogReader` keys | per conversation / blog |
| Translation cache | `translation:message:<id>:<lang>` | regenerable but API-costly |
| Volume | `useAmplifiedVolume` key | small pref |
| Dismissed update | `sakadesk_dismissed_update` | small pref |

**Stays local (not persisted meaningfully):** dev toggles `DEBUG_AUTH` /
`DEBUG_SYNC`. Any transient in-memory-only UI state is unaffected.

## Design

### 1. Backend app-state store

A new port-independent store under the fixed data dir
(`<SAKADESK_DATA_DIR or %LOCALAPPDATA%\SakaDesk>/app_state/`), owned by a small
`app_state` service. Two shapes, matched to access pattern:

- **`prefs.json`** — a single small blob for global scalars loaded once at
  startup: `tos_accepted_at`, `language`, `volume`, `dismissed_update`.
- **Per-conversation state** — read state, background, and scroll position keyed
  by conversation path (`conversation_state.json` as a `{path: {...}}` map, or a
  per-path file; map is simpler and small enough). Loaded lazily when a room
  opens, which the room view already does asynchronously.
- **Translation cache** — keyed by `message:<id>:<lang>`. Potentially large;
  stored separately (its own file or a SQLite table) with a size cap / simple
  LRU so it can't grow unbounded. Loaded per message batch, as today.

All writes go through the existing atomic-write helper (temp + `os.replace`).

**Endpoints** (namespaced, e.g. `/api/app-state/…`):
- `GET /prefs`, `PATCH /prefs` (partial update)
- `GET /conversation?path=…`, `PATCH /conversation?path=…`
- `GET /translation-cache?keys=…`, `PATCH /translation-cache`
- `POST /migrate` — accept a one-time `localStorage` dump (see Migration)

### 2. Frontend `persisted` layer

Replace direct `localStorage` use with a thin `persisted` module so call sites
change minimally and the storage backend is centralized.

- **Startup hydration:** during the app's existing startup loading phase, fetch
  `/prefs` and hydrate the existing Zustand store. After hydration, pref reads are
  synchronous (from memory), so `useState` initializers and render-time reads keep
  working without an async refactor at every site.
- **Per-conversation state:** fetched when a room/blog opens (already async),
  cached in memory for the session, write-through on change.
- **Write-through:** changes update the in-memory store immediately and PATCH the
  backend (debounced for chatty writes like scroll position).
- **Failure handling:** a failed backend write logs and retries; it must never
  block the UI. A failed read falls back to defaults (same as a missing key
  today).

### 3. Migration (one-time)

On first launch of the new build, if the backend store is empty, the frontend
reads the known `localStorage` keys **on the current origin** and POSTs them to
`/migrate`, which writes them into the app-state store; then it marks migration
done (a backend flag) so it never runs again.

**Limitation (documented):** `localStorage` is origin-scoped, so the migration
can only read the port the app is currently loaded on. A user whose port has
**already** shifted (their real state is under the old origin) must load the app
once on the old port to migrate. For the field-affected user this is the existing
recovery: set `.port` back to `5895`, launch once (migrates `:5895` state into the
backend), after which the port is irrelevant forever.

### 4. Concurrency — close→reopen write handoff

Once state is backend-backed, a changed port loses nothing, so the reopen may
bind **any** free port instantly and the UI loads immediately. The only remaining
hazard is two instances writing the data dir during the shutdown overlap. This is
handled by a single **data-dir write lock**:

- **Lock:** an OS-level exclusive lock on `<data_dir>/.write.lock`
  (`msvcrt.locking` on Windows; `fcntl.flock` elsewhere). OS-level so it is
  **auto-released if the holder process dies** (crash-safe — a crash cannot wedge
  it). The lock file also records the holder PID for diagnostics.
- **Reads are lock-free.** Atomic writes guarantee a reader sees either the whole
  old file or the whole new file, never a partial — so hydration and message reads
  never need the lock.
- **Incoming instance:** starts its HTTP server and shows the UI immediately
  (reads only). Before enabling its *writers* (sync loop, indexers, blog backup,
  app-state writes) it acquires the write lock, blocking in the background with a
  bounded timeout (~10s). No UI spinner; only background sync waits.
- **Outgoing instance — the ordered shutdown that guarantees no write after
  release:**
  1. On window close, signal every data-dir writer to stop: cancel the sync loop,
     cancel background tasks (`track_background_task` jobs, blog backup, search /
     knowledge indexers), stop accepting new work.
  2. **Drain** in-flight writes — bounded await/join so nothing is mid-write.
  3. Perform any final writes (window geometry) **while still holding the lock**.
  4. **Release the lock**, then `os._exit`.

  Because the lock is released only after steps 1–3, **once the lock is free the
  outgoing instance has no live writer and performs no further data-dir write.**
  This is the guarantee called out in review.

- **`.port` reuse is removed.** It only existed to keep `localStorage` stable and
  is no longer load-bearing; the server binds an ephemeral port each launch. (This
  also deletes the `_port_is_active` heuristic that caused the shift.)

## Components & boundaries

- `backend/services/app_state.py` — the store (prefs / conversation / translation
  cache), atomic writes, migration ingest. No web/framework deps.
- `backend/api/app_state.py` — the endpoints, thin over the service.
- `backend/services/data_lock.py` — the OS-level write lock (acquire with timeout,
  release, crash-safe), no other deps; unit-testable via temp dirs.
- Shutdown orchestration lives where sync/tasks are owned (extend the existing
  shutdown path in `backend/main.py` lifespan + `desktop.py` on-close) to run the
  ordered quiesce → drain → final-write → release sequence.
- `frontend/src/…/persisted.ts` — the storage layer + Zustand hydration + migration.
  Call sites in the ~15 audited files switch from `localStorage` to `persisted`.
- `desktop.py` — drop `.port` reuse / `_port_is_active`; wire the write-lock
  acquire/release into startup/shutdown.

## Error handling

- Backend store read failure → return defaults (missing-key semantics).
- Backend store write failure → log, retry, never block UI.
- Write-lock acquire timeout (outgoing instance hung / crashed but OS didn't
  release yet) → log and proceed; atomic writes bound the worst case to a
  last-writer-wins on a single file, not corruption.
- Migration failure → log; the app still works (state simply starts fresh); do not
  mark migration done so it can retry next launch.

## Testing

- **Unit (backend):** `app_state` prefs/conversation/translation round-trips,
  migration ingest, translation-cache cap/LRU; `data_lock` acquire/timeout/release
  and stale-lock reclaim after a simulated dead holder.
- **Unit (frontend):** `persisted` layer — hydration, write-through/debounce,
  read fallback on backend error, one-time migration guard.
- **Integration:** shutdown sequence stops writers before releasing the lock —
  assert no data-dir write occurs after release (instrument the writers with a
  post-release write attempt that must not fire).
- **Manual:** close→reopen rapidly → ToS/scroll/read-state/language all intact,
  UI instant; port may differ across launches with no effect.

## Rollout

- Lands on `dev` as part of 0.3.2 (release held for it).
- Field-affected user: one-time `.port`→`5895` recovery so their existing
  `localStorage` migrates into the backend; afterwards port-independent.

## Open questions

- Translation-cache store: JSON file with LRU vs a SQLite table (there is already
  a search DB). Lean JSON+cap unless volume argues otherwise — decide in the plan.
- Exact debounce for scroll-position write-through (chatty) — tune in the plan.
