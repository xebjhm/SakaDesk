# C2: System Tray + Background Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- ✕ hides SakaDesk to a tray icon (Open / Sync now / Quit, with an unread tooltip) and syncing keeps running in the background, scheduled by the backend.
- An optional autostart launches the app hidden at login.

**Architecture:**
- **Shared launch.** A shared `launch_sync()` is used by the API, the scheduler and the tray.
- **Scheduler.** An asyncio `AutoSyncScheduler` is started in the FastAPI lifespan. It replaces the frontend's auto-sync timers.
- **Frontend.** The frontend watches `/api/sync/progress` (with a `run_id`) so backend-started syncs show in the UI.
- **Desktop.** The desktop layer adds a `pystray` tray, a closing handler that hides instead of quitting, `--background` start, and a Windows Run-key autostart.

**Tech Stack:** FastAPI/asyncio, structlog; pystray + Pillow (Windows); winreg (stdlib); pywebview; React 18/TS; pytest; vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-c2-tray-background-design.md`. It is authoritative; read the sections each task names.

**Base:** branch `feat/c2-tray` from `feat/c1-notifications`. It uses C1's notifier, i18n, `resolve_ui_language()`, `ui_state`, `desktop_bridge` and the focus helper.

## Global Constraints

### Behaviour
- **Close to tray:**
  - ✕ hides the window unless `close_to_tray` is false, Quit was chosen, or the tray is unavailable. In those three cases ✕ quits.
  - Hiding resets ui-state to unfocused with no chat.
  - The "still running" toast is shown once (`tray_hint_shown`).
- **Scheduler:**
  - It waits a full interval before the first tick.
  - Each tick decides in this order: `shutting_down` → `disabled` → `not_configured` → `not_authenticated` → `launch`.
  - It never raises. One task per service.
- **API compatibility:** `/api/sync/start` responses are byte-compatible.
- **Frontend timers:** the auto-sync timers (useSync Effect 2) are removed; the startup sync (Effect 1) stays.
- **Autostart:**
  - HKCU Run value `SakaDesk` = `"<exe>" --background`;
  - frozen Windows only (dev logs `skipped_dev`);
  - reconciled at startup;
  - never raises;
  - never logs paths.
- **Windows-only imports** (`pystray`, `winreg`, `ctypes.windll`) are lazy; Linux CI never imports them.

### Logging
- Ids, codes and counts only.
- Event names: `sync_launch`, `auto_sync_tick`, `auto_sync_failed`, `auto_sync_scheduler_skipped`, `tray`, `tray_click`, `tray_sync_now`, `tray_tooltip`, `tray_tooltip_unhandled`, `window_close`, `app_start`, `autostart`, plus the client-log event `backend_sync_followed`.

### Strings
- **Frontend:** `settings.closeToTray`, `settings.closeToTrayDesc`, `settings.autostart` and `settings.autostartDesc`, in 5 locales. Exact values are in spec §3.
- **Backend:** the `tray` section (spec §4.5) in `backend/i18n/<locale>/tray.json`.

### Project rules
- **Tooling:** uv only.
- **Checks:**
  - Backend: full `uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy backend`.
  - Frontend, in `frontend/`: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Lint must exit 0 with **≤ 20 warnings**. It is at 20 now, so add none.
- **Commits:**
  - `uv run git commit -F <mktemp file in scratchpad>`.
  - Conventional Commits, subject ≤ 72 chars.
  - Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't push.
- **CHANGELOG:** one end-user entry, in Task 5.

---

### Task 1: Shared sync launch, interval helper, progress `run_id`, backend scheduler

**Spec:** §2.1–2.3.

**Files:**
- Create: `backend/services/sync_launcher.py`, `backend/services/auto_sync_scheduler.py`, and tests.
- Modify:
  - `backend/api/sync.py`: `/start` uses `launch_sync`; `/next_interval` uses `next_interval_minutes`.
  - `backend/services/adaptive_sync.py`: add `next_interval_minutes(settings)`.
  - `backend/api/progress.py` (or wherever `SyncProgress` lives): add `run_id`, incremented in `reset()`, and include it in the progress response.
  - `backend/main.py` lifespan: start the scheduler after the existing startup; cancel and await it in shutdown before `quiesce_writers`.

**Interfaces:**
- `launch_sync(service, *, include_inactive=True, force_resync=False, origin) -> "started" | "already_running" | "shutting_down"`.
- `AutoSyncScheduler(services, *, sleep=asyncio.sleep, load_settings=…, is_authenticated=…, launch=launch_sync)`, with `start()` and `async stop()`. For `is_authenticated(service) -> bool`, use the existing auth service. Read how `/api/auth/status` decides per service; a missing or invalid session gives False.

- [ ] **Tests:**
  - `launch_sync`, all three results;
  - `/api/sync/start` and `/api/sync/next_interval` unchanged (the existing tests pass, plus one asserting `origin="api"` is logged);
  - **Scheduler:**
    - each tick reason (fake sleep that records durations);
    - first tick after a full interval;
    - exception in an iteration → `auto_sync_failed` and the loop continues;
    - `stop()` cancels cleanly;
    - adaptive versus fixed interval;
  - `run_id` increments and appears in the response.
- [ ] Commit: `feat(sync): schedule background syncs in the backend`.

### Task 2: Frontend follows backend-started syncs; remove frontend auto-sync timers

**Spec:** §2.4.

**Files:**
- Modify: `frontend/src/shell/hooks/useSync.ts`. Remove Effect 2 and expose what the watcher needs: `pollSyncProgress`, the `isPollingRef` check and a `bumpSyncVersion`.
- Create: `frontend/src/shell/hooks/useBackendSyncWatcher.ts` (+ test).
- Wire the watcher where `useSync` is used, `App.tsx` / the shell.
- Add `backend_sync_followed` to `frontend/src/utils/clientLog.ts` and `backend/api/client_log.py` (+ backend test).
- Update MSW handlers if progress responses need `run_id`.

**Interfaces:** `useBackendSyncWatcher({ services: string[], isPolling: (s) => boolean, follow: (s) => void, onMissedCompletion: (s) => void, intervalMs = 5000 })`.

- [ ] **Tests:**
  - **Running:** a `running` state for a non-polled service calls `follow` once and logs `backend_sync_followed`.
  - **`run_id` change:**
    - a change to complete/idle calls `onMissedCompletion` once per new `run_id`;
    - the first observation only records the `run_id`.
  - **Visibility:** hidden ticks are skipped, and a check runs on visibility regain.
  - **No timers:** useSync no longer schedules auto-sync timers. Update or remove its tests accordingly.
- [ ] Commit: `feat(sync): follow backend-started syncs in the UI`.

### Task 3: Settings, autostart service, `show_simple`

**Spec:** §3, §5.4, plus `show_simple` from §5.1.

**Files:**
- **Backend settings:** add `close_to_tray` (True), `autostart` (False) and `tray_hint_shown` (False) to `_SETTINGS_DEFAULTS` and the response, following the incoming-call pattern. `SettingsUpdate` gets `close_to_tray` and `autostart`; `tray_hint_shown` is backend-only.
  - On an `autostart` update, call `autostart.apply(new_value)` after saving, off the loop.
  - Add a helper `mark_tray_hint_shown()`.
- **Autostart:** create `backend/services/autostart.py` (+ tests with a fake winreg seam):
  - `apply(enabled, *, frozen, exe, reg=None) -> str`;
  - `reconcile(enabled, *, frozen, exe, reg=None) -> str`.
- **Notifier:** `backend/services/notification_service.py` gains `show_simple(title, body) -> bool` on the protocol, the Windows notifier (tag `"app:hint"`, no avatar, `on_activated` → `desktop_bridge.open_window()` if a handler exists, else no-op) and `NullNotifier`. Also add `desktop_bridge.set_open_window_handler` / `open_window()` (log `window_open_unhandled` when no handler is registered).
- **Frontend:** `AppSettings` fields; two toggles in the General tab; Reset; i18n in 5 locales (spec §3 table).

- [ ] **Tests:**
  - settings defaults, round trip, and autostart apply called;
  - autostart, each action;
  - `show_simple` on the fake and null notifiers;
  - the bridge handlers;
  - frontend toggles, Reset, and i18n presence.
- [ ] Commit: `feat(tray): add close-to-tray and autostart settings`.

### Task 4: Unread total, tray tooltip plumbing, server-loop bridge, tray strings

**Spec:** §4.4, §4.5, plus the §4.3 bridge.

**Files:**
- **Unread summary:** create `backend/services/unread_summary.py` (+ tests):
  - `async unread_total() -> int` reuses the content API's unread computation and the backend read-state store. Find `_compute_unread_counts` in `backend/api/content.py` and the read-state storage behind `/api/read-states`.
  - `tooltip_text(n, strings) -> str`.
- **Bridge** (`desktop_bridge.py`):
  - `set_server_loop(loop)` and `run_on_server_loop(coro) -> concurrent.futures.Future | None`;
  - `set_tray_tooltip_handler(fn)` and `set_tray_tooltip(text)`.
- **Lifespan:** call `desktop_bridge.set_server_loop(asyncio.get_running_loop())`.
- **Refresh triggers:**
  - after each sync completes, in `run_sync_task`'s completion path, schedule `refresh_tray_tooltip()`;
  - after a read-state upsert in `backend/api/read_states.py`, schedule it debounced by 2 s.
  - `refresh_tray_tooltip()` computes the text and calls `set_tray_tooltip`. It logs `tray_tooltip` (`unread`) and never raises.
- **Strings:** `backend/i18n/<locale>/tray.json` (spec §4.5 table). Extend the i18n key-parity test.

- [ ] **Tests:**
  - `unread_total` with a fixture output dir and read states;
  - `tooltip_text`;
  - the debounce, coalescing rapid upserts;
  - the bridge with and without handlers;
  - `run_on_server_loop` with no loop logs and returns None;
  - locale parity for `tray`.
- [ ] Commit: `feat(tray): compute the unread tooltip and bridge to the server loop`.

### Task 5: Tray, closing handler, `--background`, focus hidden window, packaging, CHANGELOG

**Spec:** §4.1–4.3, §5.1–5.3, §6.

**Files:**
- **`tray.py`** (repo root, + `tests/test_tray.py` with a fake pystray): `TrayController` exactly as in spec §4.2.
- **`desktop.py`:**
  - parse `--background`;
  - `create_window(hidden=background)`;
  - start `TrayController` after `create_window`. Its callbacks:
    - `on_open` = show and focus;
    - `on_sync_now` = `run_on_server_loop` of `launch_sync` for each authenticated service, origin tray;
    - `on_quit` = set `_quitting`, stop the tray, then `window.destroy()`;
  - register the bridge handlers (`set_tray_tooltip_handler` → `tray.set_tooltip`; `set_open_window_handler` → `on_open`);
  - call `autostart.reconcile(settings.autostart, frozen=…, exe=Path(sys.executable))` at startup;
  - replace the `closing` hook with `make_closing_handler(...)` from spec §5.1, a pure factory with unit tests;
  - extend the focus helper: a hidden window (not `IsWindowVisible`) gets `SW_SHOW`, a minimized one gets `SW_RESTORE`, otherwise `SW_SHOW`. This applies to both toast clicks and second-instance focus;
  - log `app_start` (`background`).
- **Packaging:**
  - `uv add "pystray; sys_platform == 'win32'"`;
  - `tooling/build_windows.spec`: collect `pystray` (and `PIL` if needed), and add datas `(tooling/windows/SakaDesk.ico, 'assets')`.
- **CHANGELOG** `[Unreleased]` → `### Added`:

```markdown
- **SakaDesk keeps running in the system tray.** Closing the window now hides
  it to the tray and keeps syncing in the background, so notifications still
  arrive; use the tray icon to open the app, sync now, or quit. You can also
  start SakaDesk with Windows. Both are in Settings.
```

- [ ] **Tests:**
  - **Closing handler:** quitting; close-to-tray off; hide + hint once; hint already shown; no tray → quit; ui-state reset; logs.
  - **Tray:** menu labels, default item = open; callbacks are wrapped and logged; tooltip; unavailable on non-Windows or import failure.
  - **`--background`** parsing.
  - **Focus helper branches.**
  - **`desktop.py`** still imports under the test mocks.
- [ ] Commit: `feat(tray): hide to the tray and keep syncing in the background`.

### Task 6: Windows verification (controller)

Use the spec §8 manual list on the `C:\D\saka-verify` copy with a frozen build.
- Restore every system change afterwards: the Run value, and the settings in the copy.
- Restore the live app at the end.
