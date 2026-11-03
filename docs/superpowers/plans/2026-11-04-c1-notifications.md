# C1: Accurate New Messages + Windows Toasts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Count only genuinely new messages per sync.
- Send one native Windows toast per member/room (avatar, title, preview, localized). Clicking a toast opens that chat.
- Replace plyer.

**Architecture:**
- A per-sync `NewMessageCollector` receives pysaka's `on_new_messages`.
- A pure `notification_planner` turns the collected rows into `ToastPlan`s, applying the skip rules and the C3 `divert` hook.
- A `Notifier` delivers the plans (`windows-toasts` on Windows, a null notifier elsewhere).
- Clicks route through `desktop_bridge` to `desktop.py`, which focuses the window and calls the frontend's shared `openChat`.
- The frontend reports its focused chat to `/api/ui-state`.
- The app identity (a Start Menu `.lnk` carrying the AUMID) is ensured at startup and set by the installer.

**Tech Stack:** FastAPI + pydantic v2 + structlog; `windows-toasts` (WinRT) and `pywin32`, both Windows-only; React 18/TS; pytest, vitest.

**Spec:** `docs/superpowers/specs/2026-11-04-c1-notifications-design.md` (read the sections each task names).

## Global Constraints

### Behaviour
- One toast per 1:1 member or per room per sync.
- Never toast for:
  - `initial_sync` calls;
  - hidden (withdrawn) rows;
  - a chat being viewed while the app is focused;
  - `notifications_enabled == false`.
- **Body:**
  - text collapsed to one line and cut at 80 characters, then `…`;
  - media uses the localized `sent_photo` / `sent_video` / `sent_voice`;
  - empty text or an unknown type uses `sent_message`;
  - `notifications_hide_content` uses `hidden_body`;
  - in a room, the preview is prefixed `"{member}: "`;
  - `count > 1` appends `more` on a new line.
- **Chat classification:** `is_group_chat = member_count > 1 or group_id in GROUP_CHAT_IDS[service]`. One shared helper is used by both `content.py` and the planner.
- **AUMID** = `"SakaDesk"`. The shortcut lives at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\SakaDesk.lnk`. Never change an existing shortcut's target.

### Logging
- Every decision and failure is logged with ids, counts, codes and error types only.
- Never names, message text, paths or URLs.
- **Event names:**
  - collection: `notify_collected`, `notify_collect_skip`;
  - planning and delivery: `notify_skip`, `notify_sent`, `notify_failed`, `notify_summary`, `notify_unavailable`;
  - clicks: `notify_clicked`, `notify_click_unhandled`, `notify_open_chat`, `notify_open_chat_failed`;
  - other: `app_identity`, `ui_state`.

### Project rules
- **Dependencies:**
  - Windows-only, via markers: `windows-toasts` and `pywin32` (`; sys_platform == 'win32'`).
  - Remove `plyer`.
- **Tooling:** uv only. Use pathlib and `encoding="utf-8"`. No `print()`.
- **Strings:** no hardcoded user-facing strings.
  - Backend: `backend/i18n/<locale>/notifications.json` via `backend/services/i18n.py`.
  - Frontend: `t()`.
  - All five locales: `en`, `ja`, `zh-TW`, `zh-CN`, `yue`.
- **Checks:**
  - Backend: `uv run pytest -q`, `uv run ruff check .`, `uv run mypy backend` if configured.
  - Frontend (in `frontend/`): `npx vitest run`, `npx tsc --noEmit`, `npm run lint`. Lint must exit 0 with 20 or fewer warnings.
- **Commits:**
  - `uv run git commit -F <mktemp file in scratchpad>`, Conventional Commits, subject 72 characters or fewer.
  - Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't push.
- **CHANGELOG:** one end-user entry in Task 8.

---

### Task 1: Shared chat-kind rule and backend i18n

**Files:**
- Create: `backend/services/chat_kind.py`, `backend/services/i18n.py`, and `backend/i18n/{en,ja,zh-TW,zh-CN,yue}/notifications.json`.
- Create tests: `backend/tests/test_chat_kind.py`, `backend/tests/test_backend_i18n.py`.
- Modify: `backend/api/content.py`. Move `GROUP_CHAT_IDS` and the rule into `chat_kind`, and import them back so content behaviour is unchanged.
- Modify: `tooling/build_windows.spec`, if `backend/i18n` JSON files are not picked up by `collect_all('backend')`. Verify; add the `datas` entry if needed.

**Interfaces (produces):**

```python
# chat_kind.py
GROUP_CHAT_IDS: dict[str, set[str]]          # moved verbatim from content.py
def is_group_chat(service: str, group_id: str | int, member_count: int) -> bool
# i18n.py
SUPPORTED = ("en", "ja", "zh-TW", "zh-CN", "yue")
def get_strings(section: str, lang: str | None) -> dict[str, str]   # falls back to "en" for unknown/None lang; cached
```

**JSON keys** (section `notifications`): `sent_photo`, `sent_video`, `sent_voice`, `sent_message`, `hidden_body`, `more` (with the `{n}` placeholder), `test_title`, `test_body`. Values are exactly the table in spec §5.

- [ ] **Tests:**
  - `is_group_chat` covers multiple members, a single member in a `GROUP_CHAT_IDS` room, and a 1:1 chat.
  - `content.py` still classifies the same chats (the existing content tests must pass).
  - Every locale file has the identical key set as `en`.
  - Unknown and `None` languages fall back to `en`.
  - `more` formats with `n`.
  - Non-ASCII values round-trip.
- [ ] **Implement, then run:** `uv run pytest backend/tests/test_chat_kind.py backend/tests/test_backend_i18n.py backend/tests/test_content_api.py -q`.
- [ ] **Commit:** `feat(i18n): add backend string catalog and shared chat-kind rule`.

---

### Task 2: Collect genuinely new messages (fix the overcount)

**Files:**
- Create: `backend/services/new_message_collector.py`, `backend/tests/test_new_message_collector.py`.
- Modify: `backend/services/sync_service.py`:
  - the incremental `sync_member(...)` call (about line 816);
  - the totals loop after phase 2 (about lines 1000–1010);
  - the `phase2_complete` log.
- Add a regression test in the existing sync-service tests (find the file that tests `sync_group` totals, e.g. `backend/tests/test_sync_service*.py`).

**Interfaces (produces):**

```python
@dataclass
class CollectedChat:
    group_id: str
    group_name: str
    member_id: str
    member_name: str
    member_dir: Path
    count: int                      # visible new rows
    newest: dict                    # newest visible message (by timestamp, then id)

class NewMessageCollector:
    def __init__(self, service: str) -> None
    def on_new_messages(self, member_info: dict, new_messages: list[dict]) -> None
    def counts(self) -> dict[tuple[str, str], int]
    def entries(self) -> list[CollectedChat]
    def log_summary(self) -> None   # notify_collected: members, messages, skipped_initial, skipped_hidden
```

**Rules:**
- **`initial_sync`:** ignore the call and log `notify_collect_skip` (`reason="initial_sync"`, `group_id`, `member_id`, `count`).
- **Hidden rows:** drop rows where `message_visibility.is_hidden_message` is true. If any are dropped, log `notify_collect_skip` (`reason="hidden"`, `count`).
- **Merging:** several calls for the same `(group_id, member_id)` in one run merge. Counts add up, and the newest row wins.
- **Ids:** stored as `str`.
- **Errors:** wrap the body in `try/except Exception` and log `notify_collect_failed` (`error_type`). It never raises.

**Sync wiring:**
- Create one collector per service per `sync_group` run.
- Pass `on_new_messages=collector.on_new_messages` **only** on the incremental (non-scan) call.
- **Totals:**
  - `total_new_messages` = sum of `collector.counts().values()`;
  - `members_with_new` = number of keys with a count above 0;
  - keep the `reported_new`/scan bookkeeping and the metadata cursor update (`count > 0`) unchanged;
  - call `collector.log_summary()` after phase 2.
- **Handoff to Task 8:** keep the collector reachable so Task 8 can plan and send from it. Store it on the sync-run state, or return it from the phase-2 helper, whichever fits the code. Document the choice in the report.
- **Legacy notification:** leave the existing `notify_sync_complete_async` call in place for now. Task 8 replaces it.

- [ ] **Tests:**
  - collector: initial sync ignored; hidden rows dropped; merging; newest selection; exceptions swallowed and logged (use `structlog.testing.capture_logs`).
  - **Regression:** a sync where `sync_member` returns 40 but never calls `on_new_messages` reports `new_messages == 0` in the result. Use a fake manager.
  - **Exact count:** a sync where the callback reports 2 new rows reports exactly 2.
- [ ] **Run:** `uv run pytest backend/tests -q -k "collector or sync"`, then the full backend suite.
- [ ] **Commit:** `fix(sync): count only messages that are new on disk`.

---

### Task 3: Notification planner (pure)

**Files:**
- Create: `backend/services/notification_planner.py`, `backend/tests/test_notification_planner.py`.

**Interfaces (produces):**
- `ChatTarget` and `ToastPlan` exactly as in spec §4.
- `Skip(reason: str, group_id: str, member_id: str, count: int)`.
- `UiState(service: str | None, group_id: str | None, member_id: str | None, focused: bool)`. Put it here, or in `ui_state.py` (Task 5) and import it; it must be importable without FastAPI.

```python
def plan_toasts(
    chats: list[CollectedChat], *, service: str, service_display: str, output_service_dir: Path,
    ui_state: UiState, enabled: bool, hide_content: bool, strings: dict[str, str],
    avatar_for: Callable[[Path], Path | None], divert: Callable[[ChatTarget], bool],
    member_count_for: Callable[[str], int],
) -> tuple[list[ToastPlan], list[Skip]]
def preview_text(message: dict, strings: dict[str, str]) -> str          # 80-char cut, whitespace collapse, media labels
def find_avatar(member_dir: Path) -> Path | None                         # newest file in profile_images/thumbnail/, else phone_image/; .jpg/.jpeg/.png/.jfif only
```

**Rules:**
- **Order:** apply them in the order of spec §4.
- **Rooms:**
  - Member `CollectedChat`s of the same `group_id` collapse into one plan.
  - `member_id` is `"0"`.
  - `count` is the sum.
  - The newest message is across all members, and its author's name becomes the prefix.
  - The avatar is that author's.
- **Room name:** the group folder name without its leading `"<id> "`.
- **`target.path`:** `member_dir` (1:1) or `member_dir.parent` (room), relative to `output_service_dir.parent` (the output root), as a POSIX string. The result starts with the service display folder.
- **Viewing skip:** compares `ui_state.service == service`, `ui_state.group_id == group_id` and `ui_state.member_id == member_id` (`"0"` for rooms), with `ui_state.focused` true.

- [ ] **Tests** (the full matrix from spec §11 "Planner"):
  - each skip reason;
  - 1:1 versus room grouping, including the single-member `GROUP_CHAT_IDS` room;
  - the text cut at exactly 80 versus 81 characters;
  - multi-line text and whitespace runs;
  - each media type, empty text, unknown types;
  - `hide_content`;
  - the room prefix;
  - `more` with count 1 versus 3;
  - path strings for 1:1 and room with CJK folder names;
  - avatar fallback (thumbnail, then phone_image, then None; non-image files ignored; newest by name).
- [ ] **Run:** `uv run pytest backend/tests/test_notification_planner.py -q`.
- [ ] **Commit:** `feat(notify): plan one toast per member or room`.

---

### Task 4: Native toast notifier (replaces plyer)

**Files:**
- Rewrite: `backend/services/notification_service.py`.
- Modify: `backend/api/notifications.py` (status model: `available`, `backend`, `last_error`, `aumid`; the test endpoint uses the i18n test strings).
- Modify: `backend/api/settings.py`, only if its import of `set_notifications_enabled` changes.
- Modify: `pyproject.toml` and `uv.lock`:
  - `uv remove plyer`;
  - `uv add "windows-toasts; sys_platform == 'win32'" "pywin32; sys_platform == 'win32'"`.
- Modify: `tooling/build_windows.spec`. Add `'windows_toasts'` and `'winrt'` to `packages_to_collect` and remove any plyer entry.
- Create: `backend/services/desktop_bridge.py` and `backend/tests/test_notification_service.py`. Update existing notification tests (`backend/tests/test_notifications.py`, `test_notification_offload.py`) to the new API, and delete the tests of removed functions.

**Interfaces (produces):**

```python
# notification_service.py
AUMID = "SakaDesk"
class Notifier(Protocol):
    def show(self, plan: ToastPlan) -> bool: ...
    def status(self) -> dict: ...
def get_notifier() -> Notifier                     # singleton: WindowsToastNotifier on win32 if importable, else NullNotifier
async def send_planned(plans: list[ToastPlan]) -> int   # to_thread per show; logs notify_sent / notify_failed
async def send_test(lang: str | None) -> bool
def build_launch_args(target: ChatTarget) -> str   # "action=open&service=…&path=…&name=…&group=0|1" (urlencode)
def parse_launch_args(args: str) -> ChatTarget | None
def set_notifications_enabled(enabled: bool) -> None   # keep (used by settings API)
def get_notifications_enabled() -> bool
def get_notification_status() -> dict
# desktop_bridge.py
def set_open_chat_handler(handler: Callable[[ChatTarget], None] | None) -> None
def open_chat(target: ChatTarget) -> None          # calls handler or logs notify_click_unhandled; never raises
```

**`WindowsToastNotifier`:**
- Imports `windows_toasts` lazily inside `__init__`. On `ImportError` the singleton falls back to `NullNotifier` and logs `notify_unavailable` (`reason="import_error"`) once.
- Uses `InteractableWindowsToaster("SakaDesk", notifierAUMID=AUMID)` and `Toast(text_fields=[title, body], launch_action=build_launch_args(target))`. Check the library's attribute name for launch args, `launch_action` versus `launch`, against its docs or source and use the correct one.
- Adds `AddImage(ToastDisplayImage(ToastImage(avatar), position=ToastImagePosition.AppLogo))` when there is an avatar.
- `on_activated`: parse the arguments, log `notify_clicked` (`service`, `group_id`, `member_id`, with ids parsed from the path's numeric prefixes), then call `desktop_bridge.open_chat`.
- `on_failed`: log `notify_failed` (`error_type`).

**`NullNotifier`:** `show` returns `False` and logs `notify_unavailable` (`reason="not_windows"`) once per process.

**`send_planned`** skips everything when `get_notifications_enabled()` is false. That is a second guard; the planner already skips.

- [ ] **Tests:**
  - the launch-args round trip with CJK paths and `&` and `=` in names;
  - `parse_launch_args` on garbage returns `None`;
  - `NullNotifier` on non-win32 logs once;
  - `send_planned` with a fake notifier (monkeypatch `get_notifier`) logs `notify_sent` per plan and returns the count, and a failing `show` logs `notify_failed` without raising;
  - the status API shape;
  - the test endpoint uses the i18n strings;
  - `desktop_bridge`: with no handler it logs; a raising handler is logged with its type only.
- [ ] **Run:** `uv run pytest -q` (full) and `uv run ruff check .`. Check `uv.lock` updates.
- [ ] **Commit:** `feat(notify): send native Windows toasts instead of plyer`.

---

### Task 5: Foreground and current-chat reporting

**Files:**
- Create: `backend/services/ui_state.py`, `backend/api/ui_state.py` (router `POST /api/ui-state`, 204), `backend/tests/test_ui_state_api.py`.
- Modify: `backend/main.py` (register the router).
- Create: `frontend/src/features/messages/hooks/useUiStateReporter.ts` (+ `.test.ts`).
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (call the hook) and `frontend/src/__tests__/mocks/handlers.ts` (an MSW 204 handler).

**Interfaces:**
- **Backend:**
  - `get_ui_state() -> UiState` and `set_ui_state(state: UiState) -> None`. They are thread-safe (a lock), and the default is `UiState(None, None, None, False)`.
  - The request model accepts:
    - `service`: `^[a-z0-9_]{1,40}$` or null;
    - `group_id`, `member_id`: `^[0-9]{1,12}$` or null;
    - `focused`: strict bool.

    Anything else gets a 422.
  - It logs `ui_state` at debug with the same fields.
- **Frontend:** `useUiStateReporter(chatDir: string | undefined)`.
  - It computes `{service, group_id, member_id}` with the existing `parseReadStatePath`. Move it out of `MessagesFeature.tsx` into `frontend/src/features/messages/readStatePath.ts` and export it, updating the imports. Rooms give `member_id` `"0"`.
  - `focused` = `document.hasFocus() && document.visibilityState === 'visible'`.
  - It posts on chat change and on `window` `focus` / `blur` and `document` `visibilitychange`, debounced to 300 ms. Errors go to `console.debug` only.

- [ ] **Tests:**
  - **Backend:** validation (bad id, bad service, a non-bool `focused`), the store and the default, the 204 response.
  - **Frontend:** debounce (fake timers), the payload for a 1:1 and a room path, a focus/blur update, the unmount cleanup.
- [ ] **Run:** the backend tests, then in `frontend/` `npx vitest run src/features/messages`, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Commit:** `feat(notify): report the focused chat to the backend`.

---

### Task 6: Click to open chat (bridge, desktop and frontend)

**Files:**
- Create: `frontend/src/shell/openChat.ts` (+ `.test.ts`).
- Modify:
  - `frontend/src/features/search/SearchModal.tsx`: use `openChat`, keeping its own `setTargetMessageId` call;
  - `frontend/src/shell/App.tsx`: install `window.__sakadeskOpenChat` on mount and remove it on unmount;
  - `frontend/src/utils/clientLog.ts` and `backend/api/client_log.py`: add the event `notify_open_chat` to both whitelists, with tests;
  - `desktop.py`: register `desktop_bridge.set_open_chat_handler(...)` after `create_window`.

**Interfaces:**
- **`openChat`:**

  ```ts
  export interface OpenChatTarget { service: string; path: string; name: string; is_group_chat: boolean }
  export function openChat(target: OpenChatTarget): void
  ```

  It uses the store actions exactly as `SearchModal` did:
  1. `setSelectedConversation(service, {path, name: formatName(name), isGroupChat})`;
  2. `setActiveFeature(service, 'messages')`;
  3. `setActiveService(service)` if different, else `triggerConversationNavigation()`;
  4. then `clientLog('notify_open_chat', {service})`.

  Validate the input shape and ignore it (with `console.debug`) if it is malformed.
- **`desktop.py` handler** (it runs on a WinRT thread):
  1. `window.restore()` and `window.show()`;
  2. `_focus_existing_window()` (reuse it);
  3. `window.evaluate_js("window.__sakadeskOpenChat && window.__sakadeskOpenChat(" + json.dumps(asdict(target), ensure_ascii=False) + ")")`.

  It logs `notify_open_chat` (`service`, `is_group_chat`), or `notify_open_chat_failed` (`error_type`) on exception. It never raises.

- [ ] **Tests:**
  - **Frontend:** `openChat` for same-service and cross-service navigation (store state assertions); malformed input ignored; the `SearchModal` tests still pass.
  - **Backend:** the whitelist accepts `notify_open_chat`.
  - **`desktop.py`:** put the handler in a small pure function, `make_open_chat_handler(window, focus_fn)`, and test it with a fake window, including the evaluate_js string and the exception path.
- [ ] **Run:** frontend and backend suites, tsc, lint.
- [ ] **Commit:** `feat(notify): open the chat when a toast is clicked`.

---

### Task 7: App identity (Start Menu shortcut + AUMID)

**Files:**
- Create: `backend/services/app_identity.py`, `backend/tests/test_app_identity.py`.
- Modify: `desktop.py` (startup call, frozen only) and `tooling/windows/setup.iss` (`[Icons]`: add `AppUserModelID: "SakaDesk"` to the `{autoprograms}` and `{autodesktop}` lines).

**Interfaces:**

```python
SHORTCUT_NAME = "SakaDesk.lnk"
class ShellLinks(Protocol):            # thin seam over pywin32 so logic is testable
    def exists(self, path: Path) -> bool: ...
    def read_aumid(self, path: Path) -> str | None: ...
    def create(self, path: Path, target: Path, workdir: Path, aumid: str) -> None: ...
    def set_aumid(self, path: Path, aumid: str) -> None: ...
def ensure_start_menu_shortcut(*, frozen: bool, exe: Path, programs_dir: Path, links: ShellLinks | None = None) -> str
    # returns and logs app_identity action: skipped_dev | created | updated | ok | failed (error_type); never raises
def set_process_aumid() -> None        # SetCurrentProcessExplicitAppUserModelID(AUMID) via ctypes shell32; logs; never raises
```

- **`PyWin32ShellLinks`** implements the protocol as in the spike:
  - `pythoncom.CoCreateInstance(shell.CLSID_ShellLink, …)`;
  - `IPropertyStore` with `pscon.PKEY_AppUserModel_ID`;
  - `IPersistFile.Save`;
  - reading through `IPersistFile.Load` and `GetValue`.

  It is imported lazily and only on win32.
- **`desktop.py`:**
  - frozen: call `set_process_aumid()` and then `ensure_start_menu_shortcut(frozen=True, exe=Path(sys.executable), programs_dir=Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs")`;
  - dev: call `ensure_start_menu_shortcut(frozen=False, …)`, which logs `skipped_dev`.

- [ ] **Tests:** with a fake `ShellLinks`, each action:
  - dev returns `skipped_dev`;
  - a missing shortcut is created with the target and the AUMID;
  - an existing shortcut without the AUMID is updated with `set_aumid` only (the target is untouched);
  - an existing shortcut with the AUMID returns `ok`;
  - an exception returns `failed`, is logged with its type, and does not raise;
  - `set_process_aumid` on non-win32 is a no-op.
- [ ] **Run:** the backend suite and ruff.
- [ ] **Commit:** `feat(notify): register the app identity so toasts show banners`.

---

### Task 8: Wire planning and sending into sync; settings; CHANGELOG

**Files:**
- **Sync:** `backend/services/sync_service.py`. Replace the `notify_sync_complete_async` block as in spec §9:
  - plan per service with `get_ui_state()`;
  - read the settings `notifications_enabled`, `notifications_hide_content` and `language`;
  - `strings = get_strings("notifications", language)`;
  - `avatar_for = find_avatar`;
  - `divert = lambda _t: False`, with the comment `# C3 hook: divert voice chats to the call popup`;
  - `member_count_for` counts member folders in the group folder;
  - log `notify_skip` per skip, then `await send_planned(plans)` inside `try/except Exception`, logging `notify_failed` with `error_type`;
  - log `notify_summary` (`planned`, `sent`, `skipped`).
- **Settings backend:** `backend/services/settings_store.py` (`_SETTINGS_DEFAULTS`) and `backend/api/settings.py` gain `notifications_hide_content: bool = False`. Follow the `incoming_call_enabled` pattern exactly, including both `SettingsResponse` constructions and `_apply`.
- **Settings frontend:**
  - `frontend/src/features/messages/MessagesFeature.tsx`: `AppSettings.notifications_hide_content?: boolean`.
  - `frontend/src/shell/components/SettingsModal.tsx`, General tab, after the incoming-call toggle:
    - a **Notifications** toggle (`notifications_enabled`, default true) with a description;
    - a **Hide message content in notifications** toggle (`notifications_hide_content`, default false), disabled when notifications are off.

    Use the same switch markup as the incoming-call toggle. Add `notifications_enabled: true, notifications_hide_content: false` to Reset to defaults.
  - **i18n**, in all five locales: `settings.notifications`, `settings.notificationsDesc`, `settings.notificationsHideContent`, `settings.notificationsHideContentDesc`. The hide-content texts are in spec §10. For notifications:

    | locale | `settings.notifications` | `settings.notificationsDesc` |
    |---|---|---|
    | en | Notifications | Show a Windows notification when members send new messages |
    | ja | 通知 | メンバーから新着メッセージが届いたら Windows の通知を表示します |
    | zh-TW | 通知 | 成員傳來新訊息時顯示 Windows 通知 |
    | zh-CN | 通知 | 成员发来新消息时显示 Windows 通知 |
    | yue | 通知 | 成員傳嚟新訊息時顯示 Windows 通知 |

- **CHANGELOG** `[Unreleased]`:
  - Under `### Added`:

    ```markdown
    - **Windows notifications for new messages.** Each member who sends new
      messages gets one notification with their photo and a preview; click it
      to open the chat. You can hide message content or turn notifications off
      in Settings.
    ```

  - Under `### Fixed`:

    ```markdown
    - **The new-message count after a sync is now exact.** It used to include
      messages that were already saved.
    ```

- [ ] **Tests:**
  - **Sync:**
    - new rows from two members produce two `send_planned` plans (fake notifier);
    - a focused, viewed chat is skipped;
    - disabled sends none;
    - a notifier exception doesn't fail the sync;
    - `notify_summary` is logged.
  - **Settings:** the default and the round trip.
  - **Frontend:**
    - the toggles call `onSaveSettings` with the right field;
    - hide-content is disabled when notifications are off;
    - Reset includes both;
    - locale presence for the new keys.
- [ ] **Run:** full backend and frontend suites, tsc, lint and ruff.
- [ ] **Commit:** `feat(notify): send a toast per member after each sync`.

---

### Task 9: Windows verification (controller)

Build the frozen dev exe from the branch on the `C:\D\saka-verify` copy. Launch it with `-WorkingDirectory`, `SAKADESK_DATA_DIR` set to the copy, and CDP.

- [ ] **Startup:** `debug.log` shows `app_identity` `created` or `updated`.
  - The existing per-user `SakaDesk.lnk` from the live install gets only the AUMID property; its target is unchanged.
  - Note this in the report.
- [ ] **New messages:**
  - Make new messages appear: lower `last_message_id`/cursors for one or two members in the **copy's** `sync_state.json`, or wait for real new posts.
  - Then sync and expect one toast per member, each with an avatar, title and preview.
  - Confirm with toast history: `ToastNotificationManager.History.GetHistory("SakaDesk")` via a PowerShell/uv script.
- [ ] **Settings:**
  - `hide_content` gives a generic body;
  - notifications off gives no toast and logs `notify_skip` `reason=disabled`;
  - viewing that chat in the foreground logs `reason=viewing`.
- [ ] **No overcount:** an immediate re-sync reports 0 new and sends no toasts.
- [ ] **Logs:** `debug.log` has breadcrumbs with ids and codes only.
- [ ] **Left for the user:** clicking a toast opens the right chat.
- [ ] **Restore** the live app. Remove nothing the live install needs. The AUMID on the shortcut is harmless, and the next installer sets it anyway.
