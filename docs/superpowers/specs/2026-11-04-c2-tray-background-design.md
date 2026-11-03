# Sub-project C2: System Tray + Background Sync — Design

**Date:** 2026-11-04
**Repos touched:** `SakaDesk` only.
**Depends on:** C1 (`feat/c1-notifications`). C2 branches from it.
**Status:** The user's decisions were recorded 2026-11-04 (memory `c-notify-tray-popup-decisions`, Q9–Q12, all "recommended"). The user is away and asked for C1–C3 to be built and tested.

---

## 1. Goals

1. **Close to tray.** ✕ minimises SakaDesk to the system tray and syncing continues in the background. The first time, a toast says SakaDesk is still running. A setting can switch ✕ back to "quit".
2. **Tray menu:** **Open SakaDesk** / **Sync now** / **Quit**.
   - A left click opens the window.
   - The tooltip shows the total unread count.
3. **Autostart.** A setting, off by default. When on, SakaDesk starts at login hidden in the tray, with no window.
4. **Background scheduler.**
   - The scheduler lives in the backend, so it does not depend on the hidden webview's timers.
   - It uses the same interval rules as today (fixed or adaptive).
   - C1 toasts therefore arrive while the window is hidden.
5. **Logging.** Every decision and failure is logged, with ids, codes and counts only.

**Out of scope:** the C3 call popup.

---

## 2. Backend scheduler

### 2.1 Shared sync launch

`backend/services/sync_launcher.py`:

```python
async def launch_sync(service: str, *, include_inactive: bool = True, force_resync: bool = False, origin: str) -> str
```

- Returns `"started" | "already_running" | "shutting_down"`.
- It is extracted verbatim from `POST /api/sync/start` (shutdown guard, running guard, progress reset, `create_task(run_sync_task…)`, `_task` assignment). The endpoint then calls it and maps the results to today's HTTP responses (400 already running, 503 shutting down). The API is byte-compatible.
- `origin` is `api | scheduler | tray`. It is logged as `sync_launch` (`service`, `origin`, `result`).

### 2.2 Interval

- `backend/services/adaptive_sync.py` gains `next_interval_minutes(settings) -> float`, extracted from `GET /api/sync/next_interval`. The endpoint uses it.
- Result: adaptive gives `calculate_next_sync_interval()`, fixed gives `float(settings["sync_interval_minutes"])`.

### 2.3 Scheduler

`backend/services/auto_sync_scheduler.py`, class `AutoSyncScheduler`:

- It is started in the FastAPI lifespan after the existing startup, and cancelled and awaited in lifespan shutdown before `quiesce_writers`.
- There is one asyncio task per service in `SERVICES`.
- Each task loops:
  1. load settings and compute `minutes = next_interval_minutes(settings)`;
  2. `await sleep(minutes*60)`, where the sleep is injectable for tests;
  3. reload settings;
  4. decide.
- **Decision**, in this order. The first match is the logged `reason`:

  | condition | result |
  |---|---|
  | shutting down | `shutting_down` (the loop exits) |
  | `auto_sync_enabled` is false | `disabled` |
  | `is_configured` is false | `not_configured` |
  | the service has no valid stored session (`auth_service.get_status(service)` not authenticated) | `not_authenticated` |
  | otherwise | `launch_sync(service, origin="scheduler")` → `started` or `already_running` |

  Each tick logs `auto_sync_tick` (`service`, `reason`, `next_minutes`).
- The first tick waits one full interval. The startup sync stays in the frontend, which runs even when the window starts hidden, because the webview still loads.
- A loop iteration never raises. Exceptions are logged as `auto_sync_failed` (`service`, `error_type`), after which the loop sleeps one fixed interval (`sync_interval_minutes`) and continues.

### 2.4 Frontend

- `useSync.ts` "Effect 2" (the frontend auto-sync timers) is **removed**. The startup sync (Effect 1) stays.
- **New watcher**, `useBackendSyncWatcher` in `frontend/src/shell/hooks/`:
  - every 5 s while the document is visible, it `GET`s `/api/sync/progress?service=` for each connected service that is not already being polled;
  - if `state === 'running'`, it calls the existing `pollSyncProgress(service, false)`, so the UI follows backend-started syncs exactly as it does user-started ones;
  - on visibility regained, it checks immediately.
- **Missed completions.** A sync can finish while the window is hidden. The progress response gains `run_id: int`, incremented by `SyncProgress.reset()`. The watcher remembers the last `run_id` it saw per service. When the `run_id` changed and the state is `complete` or `idle`, it bumps `syncVersion` once, so messages refresh. The first observation only records the value.

---

## 3. Settings

| key | default | meaning |
|---|---|---|
| `close_to_tray` | `True` | ✕ hides the window to the tray instead of quitting |
| `autostart` | `False` | start at login, hidden in the tray |
| `tray_hint_shown` | `False` | internal flag: the "still running" toast has been shown once |

- **Backend:** same pattern as `incoming_call_enabled` (`_SETTINGS_DEFAULTS`, the response model, `SettingsUpdate` and `_apply`). `tray_hint_shown` is not in `SettingsUpdate`: the backend sets it.
- **`autostart` changes** call `autostart.apply(enabled)` (§5) after the settings are saved.
- **Frontend:** in Settings → General, two toggles with the existing switch markup. Reset to defaults sets `close_to_tray: true, autostart: false`.

| key | en | ja | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `settings.closeToTray` | Keep running in the tray when closed | 閉じてもトレイで実行を続ける | 關閉視窗時縮到系統匣 | 关闭窗口时缩到系统托盘 | 閂視窗時縮到系統匣 |
| `settings.closeToTrayDesc` | Closing the window keeps SakaDesk syncing in the background | ウィンドウを閉じてもバックグラウンドで同期を続けます | 關閉視窗後 SakaDesk 會在背景繼續同步 | 关闭窗口后 SakaDesk 会在后台继续同步 | 閂咗視窗之後 SakaDesk 會喺背景繼續同步 |
| `settings.autostart` | Start with Windows | Windows の起動時に開始 | 開機時自動啟動 | 开机时自动启动 | 開機時自動啟動 |
| `settings.autostartDesc` | Starts hidden in the tray when you sign in | サインイン時にトレイで起動します | 登入 Windows 時直接在系統匣啟動 | 登录 Windows 时直接在系统托盘启动 | 登入 Windows 時直接喺系統匣啟動 |

---

## 4. Tray

### 4.1 Library

- Use `pystray`, Windows-only (marker `sys_platform == 'win32'`), imported lazily.
- The icon is `tooling/windows/SakaDesk.ico`, bundled into the frozen build as a data file and loaded with Pillow, which is already a dependency.
- The tray runs via `Icon.run_detached()`, so it does not block pywebview's GUI loop.

### 4.2 Module

`tray.py` lives next to `desktop.py` at the repo root (the desktop layer). Interface:

```python
class TrayController:
    def __init__(self, *, strings: dict[str,str], on_open, on_sync_now, on_quit, icon_factory=None) -> None
    def start(self) -> None            # logs tray action=started | unavailable(reason) | failed(error_type)
    def set_tooltip(self, text: str) -> None
    def stop(self) -> None
```

- **Menu items**, localized: `open` (the default, so a left click triggers it), `sync_now`, `quit`.
- **Clicks.** Callbacks run on pystray's thread and are wrapped so they never raise. Each logs `tray_click` (`item`).

### 4.3 Actions (`desktop.py`)

- **Open.**
  - Show the window: `window.show()`, then focus it with the C1 focus helper, extended so that a hidden window gets `SW_SHOW`.
  - The frontend then reports focus through ui-state on its own.
- **Sync now.**
  - `launch_sync(service, origin="tray")` for each authenticated service.
  - The coroutine is scheduled on the uvicorn event loop. `desktop_bridge.run_on_server_loop(coro)` uses `asyncio.run_coroutine_threadsafe` with the loop captured in lifespan via `desktop_bridge.set_server_loop(loop)`.
  - It logs `tray_sync_now` (`services`, `started`).
- **Quit.**
  - Set the module flag `_quitting = True`, stop the tray, then call `window.destroy()`.
  - The existing shutdown path runs unchanged.

### 4.4 Tooltip (unread total)

- **Backend.** `backend/services/unread_summary.py`:
  - `async def unread_total() -> int`. It sums unread counts across all services. It reuses the content API's unread computation (`_compute_unread_counts` over the output dir) with the read states stored in the backend (the `read_states` store fed by the frontend's `PUT /api/read-states`). It runs off the loop (`to_thread`).
  - `tooltip_text(n, strings)`: `strings["tooltip_unread"].format(n=n)` when n > 0, else `strings["tooltip_idle"]`.
- **Refresh.** After each sync completes (in `run_sync_task`'s completion path) and after a read-state upsert (debounced 2 s), the backend computes the text and calls `desktop_bridge.set_tray_tooltip(text)`. That is a handler registered by `desktop.py`; it logs `tray_tooltip_unhandled` once when no handler is registered. The refresh logs `tray_tooltip` (`unread`).

### 4.5 Strings

Backend i18n, new section `tray` in each `backend/i18n/<locale>/tray.json`:

| key | en | ja | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `open` | Open SakaDesk | SakaDesk を開く | 打開 SakaDesk | 打开 SakaDesk | 打開 SakaDesk |
| `sync_now` | Sync now | 今すぐ同期 | 立即同步 | 立即同步 | 即刻同步 |
| `quit` | Quit | 終了 | 結束 | 退出 | 結束 |
| `tooltip_idle` | SakaDesk | SakaDesk | SakaDesk | SakaDesk | SakaDesk |
| `tooltip_unread` | SakaDesk — {n} unread | SakaDesk — 未読 {n} 件 | SakaDesk — {n} 則未讀 | SakaDesk — {n} 条未读 | SakaDesk — {n} 則未讀 |
| `still_running_title` | SakaDesk is still running | SakaDesk は実行中です | SakaDesk 仍在背景執行 | SakaDesk 仍在后台运行 | SakaDesk 仲喺背景運行緊 |
| `still_running_body` | It keeps syncing in the tray. Right-click the tray icon to quit. | トレイで同期を続けます。終了するにはトレイアイコンを右クリックしてください。 | 會在系統匣繼續同步。要結束請在系統匣圖示上按右鍵。 | 会在系统托盘继续同步。要退出请在托盘图标上点右键。 | 會喺系統匣繼續同步。要結束請喺系統匣圖示㩒右鍵。 |

The language comes from C1's `resolve_ui_language()`.

---

## 5. Close to tray, `--background`, autostart

### 5.1 Closing handler

`make_closing_handler(window, *, get_settings, hide_fn, notify_hint, save_geometry)` is a pure factory in `desktop.py`. pywebview's `closing` event cancels the close when the handler returns `False`.

- **`_quitting`, or `close_to_tray` off:** save the geometry (as today) and return `True`, so the window closes and the app exits.
- **Otherwise:**
  - save the geometry, then `window.hide()`;
  - `set_ui_state(UiState(None, None, None, False))` directly, so the viewing skip is never stale and does not rely on WebView2 blur events;
  - if `tray_hint_shown` is false, show the toast `still_running_title` / `still_running_body` through C1's notifier (add `show_simple(title, body) -> bool` to the `Notifier` protocol; `NullNotifier` returns False) and persist `tray_hint_shown=True`;
  - return `False`;
  - log `window_close` with `action=hidden|quit` and `hint=shown|skipped`.
- **No tray.** If the tray failed to start (`TrayController` unavailable), ✕ always quits. A hidden window with no tray could never be reopened. Log `window_close` with `action=quit` and `reason=no_tray`.

### 5.2 `--background`

- `desktop.py` parses `--background` from `sys.argv`.
- When present, it creates the window with `hidden=True` (pywebview `create_window(..., hidden=True)`).
- The webview still loads, so the startup sync runs. The tray starts as usual.
- Logs `app_start` with `background=<bool>`.

### 5.3 Single instance

`_focus_existing_window()` (second launch) shows a hidden window: `ShowWindow(SW_SHOW)` when `IsWindowVisible` is false, else the C1 restore-if-minimized logic, then `SetForegroundWindow`.

### 5.4 Autostart

`backend/services/autostart.py`, Windows and frozen only. It uses `winreg` from the standard library: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `SakaDesk` = `"<sys.executable>" --background`.

- `apply(enabled: bool)` writes or deletes the value.
- `reconcile(enabled: bool)` runs at startup from `desktop.py`. It fixes a missing value or a wrong path (the app moved) when enabled, and removes the value when disabled.
- It logs `autostart` with `action=enabled|disabled|ok|repaired|skipped_dev|failed` and `error_type`. Paths are never logged.
- It never raises.
- Dev runs (not frozen) log `skipped_dev`.

---

## 6. Packaging

- `uv add "pystray; sys_platform == 'win32'"`.
- `tooling/build_windows.spec`:
  - add `pystray` to the collected packages, plus `PIL` if it is not already collected;
  - add the datas entry `(tooling/windows/SakaDesk.ico, 'assets')`;
  - `tray.py` resolves the icon path from `sys._MEIPASS/assets/SakaDesk.ico` when frozen, else from the repo path.

---

## 7. Logging summary

New events:

- `sync_launch`;
- `auto_sync_tick`, `auto_sync_failed`;
- `tray`, `tray_click`, `tray_sync_now`, `tray_tooltip`, `tray_tooltip_unhandled`;
- `window_close`;
- `app_start`;
- `autostart`.

Frontend: `client_log` gains `backend_sync_followed` (`service`) when the watcher attaches to a sync started by the backend. Add it to both whitelists.

---

## 8. Testing

### Backend

- **`launch_sync`:** all three results. `/api/sync/start` responses are unchanged (the existing tests pass).
- **Scheduler, with a fake sleep and fake settings/auth:**
  - each reason;
  - the loop survives exceptions;
  - shutdown cancels it;
  - the first tick waits a full interval;
  - adaptive versus fixed intervals.
- **Progress:** `run_id` increments on reset.
- **Unread:** `unread_total` with fixture data; `tooltip_text`.
- **Autostart, with a fake winreg:** each action; nothing raises; paths are never logged.
- **Settings:** the three keys, the round trip, and `autostart` applying on update.
- **Notifier:** `show_simple` on the fake and null notifiers.

### Desktop

- **`make_closing_handler`:**
  - quitting;
  - close-to-tray off;
  - hide + hint once;
  - hint already shown;
  - no tray;
  - the ui-state reset.
- **`TrayController`, with a fake pystray:**
  - the menu labels and default item;
  - callbacks are wrapped;
  - tooltip updates;
  - unavailable / import-failure logging.
- **`--background`** parsing.
- **Focus** of a hidden window.

### Frontend

- The watcher follows a backend-started sync.
- A missed completion bumps `syncVersion` once per `run_id`.
- Effect 2 is gone: no timers.
- Settings toggles, Reset, and i18n presence.

### Manual (Windows copy)

- ✕ hides to the tray, with the hint toast once; Open / Sync now / Quit work; the tooltip shows unread.
- Set a fixed interval of 1 minute **in the copy's settings**. With the window hidden, a scheduled sync runs and a C1 toast arrives (use the C1 trim helper to create new messages).
- `autostart` on writes the Run value, and off removes it. Restore afterwards.
- `--background` starts hidden, and the tray Open shows the window.
- A second launch shows the hidden window.
