# Sub-project C1: Accurate New-Message Detection + Windows Toasts — Design

**Date:** 2026-11-04
**Repos touched:** `SakaDesk` only. No pysaka change: it already exposes `sync_member(on_new_messages=…)`.
**Status:** Design approved by the user 2026-11-04. The user was away for the spec review and asked for C1–C3 to be built and tested before they return.
**Programme:** C1 (this) → C2 tray + background sync → C3 bottom-right call popup. The user's answers to all C questions are recorded in memory `c-notify-tray-popup-decisions`. This spec implements the C1 answers and leaves named hooks for C2/C3.

---

## 1. Goals

1. **Correct new-message counts.** Sync's "new messages" equals the number of messages that were genuinely not on disk before. Today `sync_member` returns rows processed, including the re-fetched overlap, so every sync over-reports by about 40.
2. **Working Windows notifications.** plyer fails in the frozen build ("No usable implementation found!"). Replace it with native toasts.
3. **One toast per member or room, with real content:**
   - **Title:** the member's name, or the room's name.
   - **Body:** a preview of the newest message.
   - **Image:** the member's avatar.
   - **Click:** opens that chat.
4. **Localized text** in all five locales. Today the text is hard-coded English.
5. **Logging.** Every decision, skip and failure is logged with ids, counts and codes only. Never names, message text or paths.

**Out of scope (C2/C3):**
- the tray, close-to-tray and the backend scheduler;
- the call popup and the missed-call toast.

C1 sends voice messages as normal toasts and exposes a hook that C3 will use to divert them.

---

## 2. Decisions (from the user)

| # | Decision |
|---|----------|
| granularity | One toast per member (1:1) or per room (group chat) per sync. |
| skip | Don't toast a chat the user is viewing while the app is in the foreground; toast in every other case. |
| content | Show text up to 80 chars. Media shows "sent a photo / video / voice message". A new setting **"hide content in notifications"** (default off) replaces every body with "sent a new message". |
| click | Bring SakaDesk to the front (restoring it if minimised) and open that chat. |
| rooms | One toast per room: title = room name, body = `member: preview`. |
| voice | A normal toast in C1. A `divert` hook lets C3 replace a member's toast with the popup. |
| sound | The Windows default toast sound. |
| quiet | Rely on Windows Focus Assist; there are no in-app quiet hours. |
| switch | The existing global `notifications_enabled`. No per-member mute. |
| tech | `windows-toasts` (WinRT), validated by spike on 2026-11-04: it works in a frozen PyInstaller exe; a banner appears only if a Start Menu `.lnk` carries the AUMID; a click fires `on_activated` while the process runs. |

---

## 3. Collection: counting only truly new messages

**Where.** In `SyncService.sync_group`, phase 2, the incremental (non-scan) `self.manager.sync_member(...)` call passes `on_new_messages=collector.on_new_messages`. Scan calls stay as they are: pysaka never fires the callback for `ignore_cursor`.

**`NewMessageCollector`** (new: `backend/services/new_message_collector.py`). One collector per sync run.

- **Callback:** `on_new_messages(member_info, new_messages)`.
  - If `member_info["initial_sync"]` is true, it logs `notify_collect_skip` (`reason=initial_sync`, `group_id`, `member_id`, `count`) and ignores the call.
  - Otherwise it keeps only the visible rows (`not message_visibility.is_hidden_message(m)`).
    - Withdrawn skeletons are dropped and logged: `notify_collect_skip` with `reason=hidden`, `count`.
  - It stores the rows under the key `(group_id, member_id)`, together with:
    - `group_name`, `member_name`;
    - `member_dir` (the `Path` pysaka passes);
    - the newest visible message;
    - the visible count.
- **`counts()`:** returns `{(gid, mid): visible_count}`.
- **`entries()`:** returns the stored per-member records.
- **Never raises.** pysaka already swallows callback exceptions; the collector also guards its own logic.

**Totals.**
- `total_new_messages` and `members_with_new` (the progress result and the `phase2_complete` log) are computed from `collector.counts()`, not from `sync_member`'s return value.
- The existing `reported_new` logic for scanned rooms and first-seen extras stays. Those calls never reach the collector, so they contribute 0, which matches today's "recovered history is not new".
- Metadata cursor updates still use `count > 0` from the return value. That decides whether to refresh `last_message_id`, so it is unchanged.

**Logging:** `notify_collected` once per sync, with `members`, `messages`, `skipped_initial` and `skipped_hidden`.

---

## 4. Planning: which toasts to send (pure)

New: `backend/services/notification_planner.py`. It is a pure module with no I/O.

```python
@dataclass(frozen=True)
class ChatTarget:
    service: str          # e.g. "hinatazaka46"
    path: str             # chat path as the frontend uses it, e.g. "日向坂46/messages/34 金村 美玖/58 金村 美玖"
                          # (room: "日向坂46/messages/43 日向坂46")
    name: str             # member name (1:1) or room name (room)
    is_group_chat: bool

@dataclass(frozen=True)
class ToastPlan:
    target: ChatTarget
    group_id: str
    member_id: str        # "0" for a room toast
    title: str
    body: str
    avatar: Path | None   # local file, or None
    count: int            # visible new messages in this chat
    newest_type: str      # text|picture|video|voice
    newest_id: str        # id of the newest message ("" when it has none)
```

**`plan_toasts(chats, *, service, service_display, output_service_dir, ui_state, enabled, hide_content, strings, avatar_for, divert, member_count_for) -> tuple[list[ToastPlan], list[Skip]]`**

1. **Disabled.** If `enabled` is false, every chat is skipped with `reason=disabled`.
2. **Group by chat.**
   - Each 1:1 member is its own chat.
   - All members of a room share one chat, `(group_id, room)`.
   - `member_count_for(group_id)` returns the member count, and `is_group_chat(group_id, member_count)` reuses the content API rule: `member_count > 1 or group_id in GROUP_CHAT_IDS[service]`, where `member_count` is the number of member folders in the group folder. A member folder is defined once, by `chat_kind.is_member_dir` (a directory named `"<id> <name>"` holding `messages.json`); `content.get_member_dirs` and the sync service's member count both use it. Move the rule to a shared helper (`backend/services/chat_kind.py`). `content.py` and the planner both import it, so the two can never disagree.
3. **Viewing.** If `ui_state.focused` and `ui_state.chat == (service, group_id, member_id_or_0)`, the chat is skipped with `reason=viewing`.
4. **Divert (the hook for C3).** The chat's `ToastPlan` is built first (title, body, avatar, `newest_type`, `newest_id`; steps 5–7), then passed to `divert(plan)` (the hook receives the built plan, not just ids). If it returns `True`, the chat is skipped with `reason=diverted`. C1 passes `lambda _p: False`.
5. **Title:**
   - member name (1:1);
   - room name (room), as stored in the folder name without the leading id.
6. **Body:**
   - When `hide_content` is on: `strings.hidden_body`.
   - When it is off, a preview of the newest message:
     - text: its content collapsed to one line (whitespace runs become one space) and cut to 80 characters plus `…`;
     - picture / video / voice: `strings.sent_photo` / `sent_video` / `sent_voice`;
     - empty text or an unknown type: `strings.sent_message`.
   - In a room, the preview is prefixed `"{member}: "`.
   - With `count > 1`, `strings.more.format(n=count-1)` is appended on a new line.
7. **Avatar:** `avatar_for(member_dir)`. Rooms use the newest message author's avatar.
8. **Output.** `Skip(reason, group_id, member_id, count)` records are returned for logging. The planner itself never logs.

**Avatar lookup** (`avatar_for`, in the notifier module):
- the newest file in `<member_dir>/profile_images/thumbnail/`, else `.../phone_image/`, else `None`;
- only `.jpg`, `.jpeg`, `.png` and `.jfif` files count.

**Paths.**
- `target.path` = `<service display name>/messages/<group folder>/<member folder>` for 1:1, and `<service display name>/messages/<group folder>` for rooms.
- It is built from `member_dir` relative to the service output dir, using `/` separators. This is the same string `MessagesFeature` and `parseReadStatePath` use.

---

## 5. Strings (backend i18n)

The backend has no translations today. Add `backend/i18n/` holding one `notifications.json` per locale (`en`, `ja`, `zh-TW`, `zh-CN`, `yue`), and a small loader `backend/services/i18n.py`:

- `get_strings(section: str, lang: str | None) -> dict[str, str]`;
- the language comes from `resolve_ui_language(config)`: the app_state prefs `language` (the choice made in Settings, `persisted.setPref('language')`), else `settings.json` `language` (written by the installer), else `None`, which `get_strings` maps to `en`. This is the frontend's own order;
- every locale has every key (enforced by a test). At runtime `en` is also merged in per key under the requested locale, so a missing or corrupt locale file never yields missing keys; if `en` itself is unusable, missing keys read as `""` instead of raising. Each unusable file logs `i18n_load_failed` once;
- C2 and C3 add their own sections to the same files.

| key | en | ja | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `sent_photo` | Sent a photo | 写真を送信しました | 傳送了照片 | 发送了照片 | 傳送咗相片 |
| `sent_video` | Sent a video | 動画を送信しました | 傳送了影片 | 发送了视频 | 傳送咗影片 |
| `sent_voice` | Sent a voice message | ボイスを送信しました | 傳送了語音 | 发送了语音 | 傳送咗語音 |
| `sent_message` | Sent a message | メッセージを送信しました | 傳送了訊息 | 发送了消息 | 傳送咗訊息 |
| `hidden_body` | Sent a new message | 新しいメッセージがあります | 傳了新訊息 | 发来新消息 | 傳咗新訊息 |
| `more` | +{n} more | ほか{n}件 | 另外 {n} 則 | 另外 {n} 条 | 另外 {n} 則 |
| `test_title` | SakaDesk | SakaDesk | SakaDesk | SakaDesk | SakaDesk |
| `test_body` | Notifications are working | 通知は正常に動作しています | 通知運作正常 | 通知运作正常 | 通知運作正常 |

---

## 6. Delivery: native toasts

**`backend/services/notification_service.py`** is rewritten. plyer is removed from the code and from `pyproject.toml` / `uv.lock`.

- A `Notifier` protocol with two operations:
  - `show(plan: ToastPlan) -> bool`;
  - `status() -> dict`, returning `available`, `backend`, `last_error` (an error code or type only) and `aumid`.
- **`WindowsToastNotifier`:**
  - It uses `windows_toasts.InteractableWindowsToaster("SakaDesk", notifierAUMID=AUMID)` with `AUMID = "SakaDesk"`.
  - The two text fields are the title and the body.
  - The avatar is set as `ToastImagePosition.AppLogo` when one exists.
  - It uses the default audio.
  - **No launch arguments.** `Toast.launch_action` is never set: in windows-toasts 1.3.1 it also sets `activationType="protocol"`, so a click would make Windows open the string as a URI instead of firing the in-process callback (verified on Windows; the spike validated `on_activated` without a launch action).
  - `toast.tag` is `"{group_id}:{member_id}"` (ids only, ≤ 64 characters) and `toast.group` is the service, so a newer toast for the same chat replaces the older one. The test toast keeps the library's default tag.
  - **Click:** each toast's `on_activated` is a closure over its own `ToastPlan`. It logs `notify_clicked` (`service`, `group_id`, `member_id`, from the plan) and calls the registered **open-chat handler** (§7) with `plan.target`. A plan without a chat (the test toast) logs `notify_click_unhandled` (`reason=no_target`).
  - **Failure:** `on_failed` logs `notify_failed` (`error_type`, ids).
  - **Threading:** `show()` runs `toaster.show_toast` inside `asyncio.to_thread`, so it never blocks the event loop. WinRT calls happen on that worker thread.
- **`NullNotifier`** (non-Windows, a `windows_toasts` import failure, or a toaster that fails to initialise) returns `False`. `notify_unavailable` is logged once per process, when the notifier is built, with `reason` = `not_windows`, `import_error` (`error_type`, `module`) or `init_error` (`error_type`).
- **`get_notifier()`** returns a process-wide singleton.
- **`async def send_planned(plans) -> int`** shows each plan, each bounded by a 10-second timeout (`asyncio.wait_for`). It logs `notify_sent` per toast (`service`, `group_id`, `member_id`, `count`, `newest_type`) or `notify_failed` (a timeout is `error_type=TimeoutError`; the next plan is still shown), and returns the number sent. With an unavailable notifier it logs one `notify_skip reason=unavailable` (`backend_reason`, `count`) instead.
- **`send_test()`** is kept for `/api/notifications/test`. It uses the i18n test strings. `get_notification_status()` reports the notifier status: `plyer_available` is renamed `available`. Update the API model, the frontend user of that field (if any) and the diagnostics code.

**Shortcut / AUMID** (`backend/services/app_identity.py`, Windows only):
- **`ensure_start_menu_shortcut()`** is called once at startup from `desktop.py`. In a frozen build it:
  - targets `%APPDATA%\Microsoft\Windows\Start Menu\Programs\SakaDesk.lnk`;
  - if the file is missing, creates it pointing at `sys.executable` with the AUMID;
  - if it exists without the AUMID (or with another AUMID), sets only the AUMID property and never changes the target. The link is loaded with write access (`IPersistFile.Load(path, STGM_READWRITE=2)`), then `SetValue`/`Commit` and `Save(path, 0)`; the default read mode makes the save fail with `STG_E_ACCESSDENIED` on the installer's shortcut (verified on Windows);
  - `pythoncom.CoInitialize()` failing with `RPC_E_CHANGED_MODE` means COM is already initialised on the thread: it is logged (`app_identity`, `action=com_already_initialized`) and work continues;
  - logs `app_identity` with `action` = `created`, `updated`, `ok` or `failed` and `error_type`;
  - never raises.
- **Dev runs** (not frozen) skip it and log `app_identity` with `action=skipped_dev`. Dev testing uses the frozen build.
- **`SetCurrentProcessExplicitAppUserModelID("SakaDesk")`** is called at startup (frozen) so the taskbar groups with the shortcut.
- **Implementation.** Use `win32com` (pywin32), as in the spike: `IShellLink` + `IPropertyStore`, `PKEY_AppUserModel_ID`. Check whether pywin32 is already a dependency (via keyring and `win32ctypes`). If not, add it with `uv add pywin32 --optional`/marker `sys_platform == 'win32'`, following the existing Windows-only dependency pattern in `pyproject.toml`.
- **Installer** `tooling/windows/setup.iss`, `[Icons]`: add `AppUserModelID: "SakaDesk"` to the Start Menu entry, and to the desktop entry for consistency.
- **PyInstaller** `tooling/build_windows.spec`: add `windows_toasts` and `winrt` to `packages_to_collect`. The spike needed `--collect-submodules winrt --collect-submodules windows_toasts`.

---

## 7. Click → open chat

- **Bridge.** `backend/services/desktop_bridge.py` holds an optional `open_chat_handler: Callable[[ChatTarget], None]`, set by `desktop.py` after the window exists.
  - `open_chat(target)` calls it, or logs `notify_click_unhandled` when there is none.
  - It never raises; exceptions are logged with their type.
- **`desktop.py` handler.**
  - Shows the window (`window.show()`). It never calls `window.restore()`: pywebview forces `WindowState = Normal`, which un-maximizes the window.
  - Brings it to the front with `_focus_window(hwnd)`, using the window's own handle (`window.native.Handle` on WinForms) or, without one, `FindWindowW(None, "SakaDesk")`. If `IsIconic(hwnd)` it calls `ShowWindow(SW_RESTORE)`, otherwise `ShowWindow(SW_SHOW)` (a maximized window stays maximized), then `SetForegroundWindow`. Best-effort and never raises; it logs `window_focus`, `window_focus_skipped` or `window_focus_failed`. The single-instance `_focus_existing_window()` uses the same function.
  - Calls `window.evaluate_js("window.__sakadeskOpenChat ? (window.__sakadeskOpenChat(<payload>), true) : false")`, where the payload is `json.dumps(target_dict)`.
  - Logs `notify_open_chat` (`service`, `is_group_chat`, `delivered=true`) when the script returned `true`; `notify_open_chat_failed` with `reason=not_ready` when the frontend has not installed the function yet; or `notify_open_chat_failed` (`error_type`) on an exception.
- **Frontend.** `frontend/src/shell/openChat.ts` exports `openChat(target)`, which performs exactly the navigation `SearchModal` uses, minus `setTargetMessageId`. In order:
  1. `setSelectedConversation(service, {path, name: formatName(name), isGroupChat})`;
  2. `setActiveFeature(service, 'messages')`;
  3. `setActiveService(service)` when switching service, otherwise `triggerConversationNavigation()`.

  `SearchModal` is refactored to call the shared function, keeping its `setTargetMessageId` call. `App.tsx` installs `window.__sakadeskOpenChat = openChat` on mount, removes it on unmount, and logs `client_log('notify_open_chat', {service})` via the existing endpoint (add the event to the whitelist).

---

## 8. Foreground and current chat

- **Endpoint.** `POST /api/ui-state`, body `{ service: string|null, group_id: string|null, member_id: string|null, focused: boolean }`.
  - It is stored in memory in `backend/services/ui_state.py` and logged at debug as `ui_state`, with the same fields minus nothing sensitive (ids only).
  - It returns 204.
  - Values follow the client-log rule: codes and ids only. Each id is a `^[0-9]{1,12}$` string, `service` uses the `[a-z0-9_]` code pattern, and the request is rejected with 422 otherwise.
- **Frontend.** A `useUiStateReporter()` hook in `MessagesFeature` reports:
  - on chat change, using `parseReadStatePath(selectedGroupDir)` (`member_id` `"0"` for rooms);
  - on `window` `focus` / `blur` and `document.visibilitychange`, where `focused` = `document.hasFocus() && document.visibilityState === 'visible'`.

  It is debounced to 300 ms. Failures are swallowed (`console.debug`).
- **Backend default.** When nothing has been reported, `focused=false`, so toasts are sent.

---

## 9. Sync wiring

After phase 2, where today's `notify_sync_complete_async` call is:

1. Read the settings `notifications_enabled` and `notifications_hide_content`, and the language via `resolve_ui_language` (§5), once per sync.
2. `plans, skips = plan_toasts(collector.entries(), …)`, called per service.
3. Log `notify_skip` for each skip (`reason`, `group_id`, `member_id`, `count`).
4. `await send_planned(plans)`, wrapped so that a notifier failure never fails the sync (log `notify_failed`, `error_type`).
5. Log `notify_summary` (`planned`, `sent`, `skipped`).

`notify_sync_complete*`, `notify_new_messages*` and plyer are deleted.

---

## 10. Settings

- **Backend:** `notifications_hide_content: bool = False` is added to `_SETTINGS_DEFAULTS`, the response model, `SettingsUpdate` and `_apply`, following the pattern of `incoming_call_enabled`.
- **Frontend:**
  - `AppSettings.notifications_hide_content?: boolean`;
  - a toggle in Settings → General, under the existing notifications toggle, or next to the incoming-call toggle if notifications has no toggle in the UI;
  - i18n keys `settings.notificationsHideContent` and `settings.notificationsHideContentDesc` in all five locales.

| key | en | ja | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `settings.notificationsHideContent` | Hide message content in notifications | 通知にメッセージ内容を表示しない | 通知不顯示訊息內容 | 通知不显示消息内容 | 通知唔顯示訊息內容 |
| `settings.notificationsHideContentDesc` | Notifications only say a member sent a new message | 通知には新着があることだけを表示します | 通知只會顯示有新訊息，不顯示內容 | 通知只会显示有新消息，不显示内容 | 通知只會顯示有新訊息，唔顯示內容 |

Check whether a notifications toggle already exists in `SettingsModal`. If it doesn't, add one: `settings.notifications` / `settings.notificationsDesc`, wired to `notifications_enabled`.

---

## 11. Testing

**Unit tests:**
- **Collector:**
  - `initial_sync` is ignored and logged;
  - hidden rows are dropped;
  - counts and the newest message are correct;
  - a callback-side failure never raises.
- **Sync:** an overlap-only run of `sync_member` (`on_new_messages` not fired) gives `total_new_messages == 0` while `count > 0`. This is a regression test for the overcount.
- **Planner:**
  - each skip reason: `disabled`, `viewing` and `diverted`;
  - 1:1 versus room grouping, including a member count of 1 for a `GROUP_CHAT_IDS` room;
  - the title and body for text, the 80-character cut and whitespace collapse, each media type, empty text, `hide_content`, the room prefix and `more`;
  - path building;
  - avatar fallback order.
- **i18n:** every locale has every key; the loader falls back to `en` per key; a missing `en` never raises; `resolve_ui_language` precedence (prefs, then settings.json, then none).
- **Notifier:**
  - no launch action is ever set; each toast's `on_activated` opens its own plan's target;
  - `NullNotifier` on a non-Windows platform;
  - `send_planned` logging with a fake notifier.
- **App identity:** the logic with a fake shell layer (create / update / ok / failed / skipped_dev).
- **UI state:** endpoint validation; the store; the default when unreported.
- **Bridge:** with no handler it logs; with a handler that raises it logs.
- **Frontend:**
  - `openChat`: same-service and cross-service navigation;
  - `SearchModal` behaviour is unchanged;
  - the UI-state reporter: debounce, focus/blur, room `member_id` `"0"`;
  - the settings toggle;
  - i18n presence.

**Manual (Windows copy, frozen build):**
- the shortcut is created or updated and logs `app_identity`;
- a sync that brings new messages shows one toast per member with avatar, title and preview;
- `hide_content` works;
- the viewing skip works;
- `debug.log` breadcrumbs are present;
- the user clicks a toast and the chat opens. This is the one step left to the user.

---

## 12. Risks

- **Toast click when the process is gone.** Not handled: there is no COM activator. C2 keeps the app alive in the tray.
- **Foreground rules.** Windows may refuse `SetForegroundWindow` from a background thread. `_focus_window()` (shared with the single-instance case) is best-effort; if `SetForegroundWindow` is refused, the window is at least shown (or un-minimized) and flashes in the taskbar. Failures are logged (`window_focus_failed`).
- **`windows-toasts` / `winrt` packaging.** Covered by the spike. The build spec change is required.
