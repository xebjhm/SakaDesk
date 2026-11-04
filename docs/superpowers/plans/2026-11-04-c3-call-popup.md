# C3: Bottom-Right Incoming-Call Popup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a sync finds a new 1:1 voice message while SakaDesk is not in the foreground, ring it in a small always-on-top call window at the bottom right of the screen, without stealing focus; a missed or declined call becomes a "missed call" toast.

**Architecture:**
- **Backend decides.** The C1 collector also keeps the newest new voice per chat. A pure `select_call_candidate` + `divert_gate` choose at most one candidate per sync, and C1's `divert` hook hands that chat's `ToastPlan` to a process-wide `CallPopupController` instead of toasting it.
- **Controller owns the call.** It reserves the call during planning, downloads the voice first in phase 3, then dispatches it to the desktop popup through `desktop_bridge`. It applies the popup page's events (`ringing`, `answered`, …) with watchdogs, and sends the fallback or missed-call toast through C1's `send_planned`.
- **Popup page reuses B.** `/?view=call-popup` renders `CallPopupApp` (no `App`, no `AuthProvider`). It fetches the call info, the messages, the read-state row and the settings, and runs B's `useIncomingCall` unchanged in behaviour (additive `surface`, `onOutcome`, `isCallElsewhere`). It never writes a store.
- **Main window is the only heard writer.** On answer the backend calls `window.__sakadeskMarkVoiceHeard` in the main window, which reveals the voice through the shared `readStateStore`.
- **Desktop hosts the window.** `call_popup_window.py` pre-creates one hidden pywebview window after the main window loads, reveals it with native no-activate Win32 calls at a DPI-correct bottom-right rect, and destroys it with the main window.

**Tech Stack:** FastAPI + pydantic v2 + structlog; asyncio; ctypes (Win32: user32, dwmapi, shell32, ntdll), pywebview 5.3.2 (WinForms/WebView2), pythonnet (lazy); React 18 + TypeScript; pytest (+ `pytest-asyncio`, strict mode); vitest + Testing Library + MSW.

**Spec:** `docs/superpowers/specs/2026-11-04-c3-call-popup-design.md`. It is authoritative; read the sections each task names. Where this plan resolves a gap in the spec it says so explicitly ("Plan resolution").

**Base:** branch `feat/c3-call-popup` (already checked out; do not switch). It sits on C2 (`feat/c2-tray`) and C1 (`feat/c1-notifications`) and uses their `notification_planner`, `send_planned`, `ui_state`, `desktop_bridge`, `i18n`, `settings_store`, the tray and the quit flag, plus B's `useIncomingCall`, `decideCall`, `CallScreen`, `CallAudio` and `preloadAudio`.

## Global Constraints

Every task's requirements implicitly include this section.

### Behaviour (values copied from the spec)

- **When:** a sync finds a new voice from a 1:1 member while the app is not in the foreground (C1 `ui_state.focused` is false: hidden in the tray, minimised or not focused). B's eligibility rules apply, through B's own implementation (`decideCall` in the popup), never reimplemented in Python.
- **One call:** one popup, for the newest new visible voice (by `newest_key`: timestamp, then zero-padded id) over 1:1 chats. Rooms never ring (`chat_kind.is_group_chat(service, group_id, member_count_for(group_id))`, so a one-member `GROUP_CHAT_IDS` room never rings). Every other chat gets its normal C1 toast. One call at a time across all services.
- **Gate order** (`divert_gate`, first failure is the logged reason): 1 `popup_disabled`, 2 `no_candidate`, 3 `unavailable`, 4 `foreground`, 5 `busy`, 6 `quiet` (Win32 quiet state, read last and only when 1–5 passed).
- **Planner order (C1 change):** build the plan → `divert` → `disabled` → `viewing`.
- **Answer:** the voice plays in the popup → "call ended" → the popup closes. The voice is marked heard **when the user answers** (as in B). The main window stays hidden.
- **Missed / declined / timed out:** "missed call: X (+N more messages)" toast; the voice stays unheard so B rings in the app later. `already_read` skip → no toast. Any other skip or a failed start → the original plan as a fallback toast.
- **Window:** fixed bottom-right above the taskbar (work area), `POPUP_WIDTH_DIP = 300` wide at 9:16, `POPUP_MARGIN_DIP = 12`, always on top, frameless, no backdrop, no taskbar button, not in Alt+Tab, never activated, DPI-aware; the page always sees a **300 × 533 CSS px** viewport. Title `"SakaDesk Call"` (never `"SakaDesk"`). `background_color="#0D0F14"`.
- **Timers:** B's `RING_TIMEOUT_MS = 30_000` and `PRELOAD_TIMEOUT_MS = 10_000` (reused, not copied); `START_WATCHDOG_S = 20`, `RING_WATCHDOG_S = 45`, `CONNECTED_WATCHDOG_S = 900`; `POPUP_LOAD_TIMEOUT_S = 15`; `BRIDGE_TIMEOUT_S = 10`, `BRIDGE_START_TIMEOUT_S = 20`; popup destroy timeout `3.0` s; heard delivery up to 3 attempts, 1 s apart; two failed creations in a row → popup unavailable for the rest of the process.
- **Setting:** `call_popup_enabled`, default **True**, separate from B's `incoming_call_enabled` and from C1's `notifications_enabled`.
- **Notifications switch:** the popup is governed **only** by `call_popup_enabled`. With `notifications_enabled` off, only toasts are suppressed (normal, missed-call and fallback); each controller suppression logs `call_popup_toast_skip reason=notifications_disabled`.
- **Quiet state:** QUNS 1 `not_present`, 2 `fullscreen`, 3 `d3d_fullscreen`, 4 `presentation`, 6 `quiet_time`, 7 `app_fullscreen` → quiet; 5 or other → Focus Assist via WNF `0x0D83063EA3BF1C75`: 1 `focus_assist_priority`, 2 `focus_assist_alarms` → quiet; 0 `accepts`; other/failure → `unknown`, **not quiet** (undetectable → popup).
- **Ringtone:** silent; one swap point `getRingtone()` in `features/incomingCall/ringtone.ts`.
- **Out of scope:** a ringtone sound, room calls, moving/resizing the popup, keyboard control of the popup, monitors other than the primary.

### Binding principles

- **Single source of truth.** The popup reads the same primary stores as the main UI (app-state prefs, the `read_state_<path>` conversation row, `/api/settings`) and **never writes** heard/read state, prefs or conversation rows itself: no `persisted.setPref`, `setConv`, `setConvBeacon`, `flushNow`, no `PUT /api/read-states`. Only the main window writes heard state, through the existing read-state path (`readStateStore.saveReadState` = `persisted.setConv` + the search-copy `PUT /api/read-states`). The backend controller is the single owner of the active call; the main window asks it (`GET /api/call-popup/active`) instead of keeping a copy.
- **Breadcrumbs everywhere.** Every decision, skip and failure path logs a structlog (backend) or `clientLog` (frontend) breadcrumb with ids, codes, counts, durations or physical pixel sizes only — never names, message text, paths, URLs or tokens. The call info `path` is returned to the popup page and never logged.
- **B unchanged.** Every existing B test passes unchanged; B's new hook arguments are optional and additive.
- **i18n:** no hardcoded user-facing strings; backend strings in `backend/i18n/<locale>/call_popup.json`, frontend via `t()`; all five locales `en`, `ja`, `zh-TW`, `zh-CN`, `yue`.
- **Windows-only code** (`ctypes.windll`/`WinDLL`, `wintypes`, `System.Windows.Forms`, pywebview window creation) is imported lazily inside functions and guarded, with injectable seams, so Linux CI never imports it and stays green.
- **No `print()`.** Use `pathlib.Path` and `encoding="utf-8"` for every file read/write.
- **pysaka is untouched.** Voice-first is SakaDesk-side queue ordering.

### Logging (full event list, spec §9)

**Backend (structlog):**

| event | fields |
|---|---|
| `call_popup_skip` | service, reason (`popup_disabled`/`no_candidate`/`unavailable`/`foreground`/`busy`/`quiet`), group_id, member_id, message_id (with a candidate), quiet_state (for `quiet`) |
| `call_popup_reserved` | call_id, service, group_id, member_id, message_id, count |
| `call_popup_voice_first` | call_id, items, downloaded |
| `call_popup_dispatch` | call_id, result (`started`/`start_failed`/`foreground`/`viewing`; plan adds `not_reserved`) |
| `call_popup_abandoned` | call_id, reason (`sync_failed`/`cancelled`), toast (`sent`/`skipped`) |
| `call_popup_event` | call_id, event, phase, reason, error_type |
| `call_popup_event_stale` | call_id, event, reason (`unknown_call`/`wrong_phase`/`message_mismatch`) |
| `call_popup_hide` | call_id, reason (the event or watchdog that ended the call) |
| `call_popup_toast` | call_id, kind (`fallback`/`missed`), reason, sent |
| `call_popup_toast_skip` | call_id, kind (`fallback`/`missed`), reason (`notifications_disabled`) |
| `call_popup_heard` | call_id, message_id, delivered, attempts, reason (`not_ready`/`error`/`no_host`) |
| `call_popup_cancel` | call_id, reason (`foreground`/`disabled`/`app_exit`), phase |
| `call_popup_watchdog` | call_id, phase |
| `call_popup_unavailable` | reason (`no_host`), once |
| `call_popup_bridge_failed` | op, error_type or reason (`timeout`) |
| `call_popup_window` | action (`created`/`reused`/`create_failed`/`disabled_after_failures`/`lost`/`destroyed`/`destroy_failed`; plan adds `start_refused`, `preload_skipped`), error_type, reason |
| `call_popup_reveal` / `call_popup_reveal_failed` | call_id, dpi, width, height, visible / error_type |
| `quiet_state` (debug) / `quiet_state_failed` | quns, focus_assist, result / api (`quns`/`wnf`), error_type |

C1's `notify_skip reason=diverted`, `notify_sent` and `notify_failed` cover the toasts themselves.

**Frontend (`POST /api/client-log`):** B's `call_ring`, `call_skip`, `call_answer`, `call_decline`, `call_timeout`, `call_end`, `call_cancel`, `call_error` are reused; from the popup they carry `surface=popup`; `call_skip` gains the reason `popup_active` (main window). New events: `call_popup_start` (call_id), `call_popup_error` (call_id, error_type), `call_popup_heard_applied` (service, group_id, member_id, message_id, changed), `call_popup_heard_ignored` (reason). New whitelisted fields: `surface`, `call_id`, `changed`. Value rules unchanged.

### Strings

- **Backend** (`backend/i18n/<locale>/call_popup.json`, section `call_popup`):

  | key | en | ja | zh-TW | zh-CN | yue |
  |---|---|---|---|---|---|
  | `missed_title` | Missed call: {name} | 不在着信：{name} | 未接來電：{name} | 未接来电：{name} | 未接來電：{name} |
  | `missed_body` | Click to open the chat | クリックしてトークを開く | 點擊開啟聊天室 | 点击打开聊天室 | 㩒一下打開聊天室 |
  | `missed_more` | +{n} more messages | ほか{n}件のメッセージ | 另有 {n} 則訊息 | 另有 {n} 条消息 | 仲有 {n} 則訊息 |

- **Frontend** (all five `frontend/src/i18n/locales/*.json`, under `settings`); the call screen reuses B's `call.*` keys unchanged:

  | key | zh-TW | ja | en | zh-CN | yue |
  |---|---|---|---|---|---|
  | `settings.callPopup` | 背景來電小窗 | バックグラウンド着信ウィンドウ | Background call popup | 后台来电小窗 | 背景來電小窗 |
  | `settings.callPopupDesc` | SakaDesk 在背景時收到成員語音，會在右下角小窗以來電方式響起 | SakaDesk がバックグラウンドのときにメンバーからボイスが届くと、右下の小さなウィンドウで着信します | When SakaDesk is in the background and a member sends a voice message, it rings in a small window at the bottom right | SakaDesk 在后台时收到成员语音，会在右下角小窗以来电方式响起 | SakaDesk 喺背景時收到成員語音，會喺右下角小窗以來電方式響起 |

### Project rules

- **Tooling:** `uv` only (never `pip`). Run everything from the repo root `/home/xtorker/repos/Project-Saka/SakaDesk` unless a step says `cd frontend`.
- **Checks** (run before each commit for the side you touched; the full set in the last task):
  - Backend: `uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy backend`.
  - Frontend: `cd frontend && npx tsc --noEmit && npx vitest run`, then `npm run lint` (eslint with `--max-warnings 20`). It is at **19** warnings now; it must stay **≤ 20** — add none.
  - pytest runs with `asyncio_mode = "strict"`: async tests need `@pytest.mark.asyncio`.
  - Known pre-existing failure: none in SakaDesk; if a keyring test errors headless, it is environmental, not a regression.
- **Commits:**
  - Conventional Commits `type(scope): subject`, imperative, whole first line ≤ 72 characters, no trailing period. Scope for this work: `call-popup` (C1 files: `notify`; settings UI: `settings`).
  - Commit with `uv run git commit -F "$MSG"` where `$MSG` is a `mktemp` file (create it in your scratchpad directory when you have one). Never bare `git commit` (the pre-commit hook is only on the uv PATH).
  - Every message ends with a blank line and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - A hook validates the format against `docs/DOC_FORMATS.md`; if it blocks, fix the message, never bypass it.
  - One logical change per commit. Don't push. Don't switch branches.
- **CHANGELOG:** one end-user entry under `[Unreleased]` → `### Added`, in the last task (Task 14) only.

---

### Task 1: Collect the newest new voice and divert before the notifications switch

**Spec:** §4.1, §4.2 "Planner order change", §11.1 "Collector" and "Divert hook … rule order".

**Files:**
- Modify: `backend/services/new_message_collector.py` (`CollectedChat`, `NewMessageCollector._collect`).
- Modify: `backend/services/notification_planner.py` (`plan_toasts` body and docstring; `Skip` docstring).
- Test: `backend/tests/test_new_message_collector.py`, `backend/tests/test_notification_planner.py` (replace `test_rule_order_disabled_before_viewing_before_divert`).

**Interfaces:**
- Consumes (existing): `newest_key(message: dict[str, Any]) -> tuple[str, str]`; `plan_toasts(chats, *, service, service_display, output_service_dir, ui_state, enabled, hide_content, strings, avatar_for, divert: Callable[[ToastPlan], bool], member_count_for) -> tuple[list[ToastPlan], list[Skip]]`.
- Produces:
  - `CollectedChat.newest_voice: dict[str, Any] | None = None` — the newest **visible** new message with `type == "voice"` (same `newest_key` ordering; hidden rows never count; on a merge the newer voice wins).
  - `plan_toasts` applies, per chat: build the `ToastPlan` (unchanged code, now also for chats that end up `disabled`) → `divert(plan)` → `Skip("diverted")`; else `not enabled` → `Skip("disabled")`; else viewing → `Skip("viewing")`; else the plan is returned. `divert` is therefore called for **every** chat, including when `enabled=False`.

- [ ] **Step 1: Write the failing collector tests** (append to `backend/tests/test_new_message_collector.py`; reuse that file's existing member-info helper if it has one, otherwise use this one):

```python
def _info(gid: int = 34, mid: int = 58) -> dict:
    return {
        "group_id": gid, "group_name": "金村 美玖", "member_id": mid,
        "member_name": "金村 美玖", "member_dir": Path("out/34 金村 美玖/58 金村 美玖"),
    }


def _m(mid: int, type_: str, ts: str, state: str = "published") -> dict:
    return {"id": mid, "type": type_, "timestamp": ts, "content": None, "state": state}


def test_newest_voice_is_the_newest_visible_voice() -> None:
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [
        _m(1, "voice", "2026-11-04T10:00:00Z"),
        _m(2, "voice", "2026-11-04T11:00:00Z"),
        _m(3, "text", "2026-11-04T12:00:00Z"),
    ])
    (chat,) = c.entries()
    assert chat.newest["id"] == 3
    assert chat.newest_voice is not None and chat.newest_voice["id"] == 2


def test_hidden_voice_never_counts() -> None:
    c = NewMessageCollector("hinatazaka46")
    # is_hidden_message: any set state other than "published" is hidden (withdrawn).
    hidden = _m(5, "voice", "2026-11-04T13:00:00Z", state="unpublished")
    c.on_new_messages(_info(), [_m(1, "voice", "2026-11-04T10:00:00Z"), hidden])
    assert c.entries()[0].newest_voice["id"] == 1


def test_newest_voice_is_none_without_a_voice() -> None:
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [_m(1, "text", "2026-11-04T10:00:00Z")])
    assert c.entries()[0].newest_voice is None


def test_merge_keeps_the_newer_voice_and_a_voiceless_call_keeps_it() -> None:
    c = NewMessageCollector("hinatazaka46")
    c.on_new_messages(_info(), [_m(1, "voice", "2026-11-04T10:00:00Z")])
    c.on_new_messages(_info(), [_m(9, "voice", "2026-11-04T09:00:00Z")])  # older
    c.on_new_messages(_info(), [_m(4, "text", "2026-11-04T14:00:00Z")])   # no voice
    assert c.entries()[0].newest_voice["id"] == 1
    c.on_new_messages(_info(), [_m(7, "voice", "2026-11-04T15:00:00Z")])  # newer
    assert c.entries()[0].newest_voice["id"] == 7
```

If the file already imports `Path`, do not import it twice.

- [ ] **Step 2: Run, expect FAIL** — `uv run pytest backend/tests/test_new_message_collector.py -q` → `AttributeError: 'CollectedChat' object has no attribute 'newest_voice'`.

- [ ] **Step 3: Implement the collector change.** In `CollectedChat` add, after `newest`:

```python
    newest_voice: dict[str, Any] | None = None
```

In `_collect`, compute it together with `newest` (before any counter moves, so a swallowed failure leaves nothing partial):

```python
        newest = max(visible, key=newest_key) if visible else None
        voices = [m for m in visible if m.get("type") == "voice"]
        newest_voice = max(voices, key=newest_key) if voices else None
```

Pass `newest_voice=newest_voice` when creating the entry, and on a merge:

```python
        existing.count += len(visible)
        if newest_key(newest) >= newest_key(existing.newest):
            existing.newest = newest
        if newest_voice is not None and (
            existing.newest_voice is None
            or newest_key(newest_voice) >= newest_key(existing.newest_voice)
        ):
            existing.newest_voice = newest_voice
```

Update the class docstring line to mention `newest_voice` (Zero Drift).

- [ ] **Step 4: Write the failing planner tests.** In `backend/tests/test_notification_planner.py` delete `test_rule_order_disabled_before_viewing_before_divert` and add:

```python
def test_rule_order_diverted_before_disabled_before_viewing(tmp_path: Path) -> None:
    seen: list[str] = []

    def yes(p: ToastPlan) -> bool:
        seen.append(p.member_id)
        return True

    def no(p: ToastPlan) -> bool:
        seen.append(p.member_id)
        return False

    _, skips = run([chat(tmp_path)], tmp_path, enabled=False, divert=yes)
    assert skips == [Skip("diverted", "34", "58", 1)] and seen == ["58"]
    seen.clear()
    _, skips = run([chat(tmp_path)], tmp_path, enabled=False, divert=no)
    assert skips == [Skip("disabled", "34", "58", 1)] and seen == ["58"]
    ui = UiState(SERVICE, "34", "58", True)
    _, skips = run([chat(tmp_path)], tmp_path, ui_state=ui, divert=no)
    assert skips == [Skip("viewing", "34", "58", 1)]


def test_disabled_still_offers_every_chat_to_divert(tmp_path: Path) -> None:
    offered: list[str] = []

    def divert(p: ToastPlan) -> bool:
        offered.append(p.member_id)
        return p.member_id == "58"

    other = chat(tmp_path, group_id="35", group_dir="35 小坂 菜緒",
                 member_id="59", member_dir="59 小坂 菜緒", member_name="小坂 菜緒")
    plans, skips = run([chat(tmp_path), other], tmp_path, enabled=False, divert=divert)
    assert plans == []
    assert offered == ["58", "59"]
    assert [s.reason for s in skips] == ["diverted", "disabled"]
```

- [ ] **Step 5: Run, expect FAIL** — `uv run pytest backend/tests/test_notification_planner.py -q` (the first `skips` is `disabled`, `offered == []`).

- [ ] **Step 6: Implement the planner order.** In `plan_toasts`, move the `if not enabled` and viewing checks **after** the plan is built and offered to `divert`:

```python
        plan = ToastPlan(...)  # unchanged construction (body, avatar, count, newest_type, newest_id)
        if divert(plan):
            skips.append(Skip("diverted", group_id, member_id, count))
            continue
        if not enabled:
            skips.append(Skip("disabled", group_id, member_id, count))
            continue
        if (
            ui_state.focused
            and ui_state.service == service
            and ui_state.group_id == group_id
            and ui_state.member_id == member_id
        ):
            skips.append(Skip("viewing", group_id, member_id, count))
            continue
        plans.append(plan)
```

Update the `plan_toasts` docstring: "Rules apply per chat in this order: diverted (the C3 hook, which receives every fully built plan, even when notifications are off), disabled, viewing." Update `Skip`'s docstring order to `diverted|disabled|viewing`.

- [ ] **Step 7: Run, expect PASS** — `uv run pytest backend/tests/test_new_message_collector.py backend/tests/test_notification_planner.py backend/tests/test_sync_notify.py -q`, then `uv run ruff check . && uv run ruff format --check . && uv run mypy backend`.

- [ ] **Step 8: Commit**

```bash
git add backend/services/new_message_collector.py backend/services/notification_planner.py \
  backend/tests/test_new_message_collector.py backend/tests/test_notification_planner.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(notify): track the newest voice and divert before the switch' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 2: Quiet state (fullscreen, presentation, Focus Assist)

**Spec:** §4.3, §11.1 "Quiet state".

**Files:**
- Create: `backend/services/quiet_state.py`, `backend/tests/test_quiet_state.py`.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```python
WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75

@dataclass(frozen=True)
class QuietState:
    code: str          # not_present|fullscreen|d3d_fullscreen|presentation|quiet_time|app_fullscreen|
                       # focus_assist_priority|focus_assist_alarms|accepts|unknown
    quiet: bool
    quns: int          # raw SHQueryUserNotificationState value, -1 on failure / not queried
    focus_assist: int  # 0|1|2, -1 on failure / not queried

UNKNOWN = QuietState("unknown", False, -1, -1)

def query_quiet_state(*, shell32: Any = None, ntdll: Any = None, platform: str | None = None) -> QuietState
    # never raises; platform (default sys.platform) != "win32" returns UNKNOWN; tests pass fakes + platform="win32"
```

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_quiet_state.py`). The fakes write through `ctypes.byref(...)._obj`, the object the byref points at (CPython):

```python
import pytest
from structlog.testing import capture_logs

from backend.services.quiet_state import (
    UNKNOWN, WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED, QuietState, query_quiet_state,
)


class FakeShell32:
    def __init__(self, value: int = 5, hr: int = 0, exc: Exception | None = None):
        self.value, self.hr, self.exc = value, hr, exc

    def SHQueryUserNotificationState(self, out):  # noqa: N802 (Win32 name)
        if self.exc:
            raise self.exc
        out._obj.value = self.value
        return self.hr


class FakeNtdll:
    def __init__(self, profile: int = 0, status: int = 0, exc: Exception | None = None):
        self.profile, self.status, self.exc = profile, status, exc
        self.name = None

    def NtQueryWnfStateData(self, name, type_id, scope, stamp, buf, size):  # noqa: N802
        if self.exc:
            raise self.exc
        self.name = name._obj.value
        assert type_id is None and scope is None
        buf._obj.value = self.profile
        return self.status


def q(shell=None, nt=None):
    return query_quiet_state(shell32=shell or FakeShell32(), ntdll=nt or FakeNtdll(), platform="win32")


@pytest.mark.parametrize("value, code", [
    (1, "not_present"), (2, "fullscreen"), (3, "d3d_fullscreen"),
    (4, "presentation"), (6, "quiet_time"), (7, "app_fullscreen"),
])
def test_quns_quiet_values(value, code):
    assert q(FakeShell32(value)) == QuietState(code, True, value, -1)


@pytest.mark.parametrize("profile, expected", [
    (0, QuietState("accepts", False, 5, 0)),
    (1, QuietState("focus_assist_priority", True, 5, 1)),
    (2, QuietState("focus_assist_alarms", True, 5, 2)),
])
def test_accepts_then_focus_assist(profile, expected):
    nt = FakeNtdll(profile)
    assert q(FakeShell32(5), nt) == expected
    assert nt.name == WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED


def test_unknown_quns_value_goes_to_focus_assist():
    assert q(FakeShell32(0), FakeNtdll(0)) == QuietState("accepts", False, 0, 0)


@pytest.mark.parametrize("nt", [FakeNtdll(3), FakeNtdll(0, status=0xC0000034), FakeNtdll(exc=OSError())])
def test_wnf_failure_is_unknown_and_not_quiet(nt):
    with capture_logs() as logs:
        state = q(FakeShell32(5), nt)
    assert state == QuietState("unknown", False, 5, -1)
    assert any(e["event"] == "quiet_state_failed" and e["api"] == "wnf" for e in logs)


@pytest.mark.parametrize("shell", [FakeShell32(hr=1), FakeShell32(exc=OSError())])
def test_quns_failure_falls_through_with_minus_one(shell):
    with capture_logs() as logs:
        state = q(shell, FakeNtdll(2))
    assert state == QuietState("focus_assist_alarms", True, -1, 2)
    assert any(e["event"] == "quiet_state_failed" and e["api"] == "quns" for e in logs)


def test_non_windows_is_unknown():
    assert query_quiet_state(platform="linux") == UNKNOWN


def test_every_query_logs_codes_at_debug():
    with capture_logs() as logs:
        q(FakeShell32(2))
    (e,) = [e for e in logs if e["event"] == "quiet_state"]
    assert e == {"event": "quiet_state", "log_level": "debug", "quns": 2, "focus_assist": -1, "result": "fullscreen"}
```

- [ ] **Step 2: Run, expect FAIL** — `uv run pytest backend/tests/test_quiet_state.py -q` (module missing).

- [ ] **Step 3: Implement `backend/services/quiet_state.py`:**

```python
"""Is Windows in a state where a popup would intrude? (spec §4.3)

Step 1 asks ``shell32.SHQueryUserNotificationState`` (fullscreen app,
presentation mode, quiet time, …). When it reports "accepts notifications" (or
any other value, or fails) step 2 reads Focus Assist from the shell's
quiet-hours WNF profile with ``ntdll.NtQueryWnfStateData`` (undocumented; a
failure reads as "unknown", which is not quiet, so the popup shows). Windows
only: off Windows it returns :data:`UNKNOWN`. Never raises. Logs codes only.
"""

from __future__ import annotations

import ctypes
import sys
from dataclasses import dataclass
from typing import Any

import structlog

logger = structlog.get_logger(__name__)

WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75
_QUNS_QUIET = {
    1: "not_present", 2: "fullscreen", 3: "d3d_fullscreen",
    4: "presentation", 6: "quiet_time", 7: "app_fullscreen",
}
_FOCUS_QUIET = {1: "focus_assist_priority", 2: "focus_assist_alarms"}


@dataclass(frozen=True)
class QuietState:
    """``code`` is the logged result; ``quns``/``focus_assist`` are raw (-1 = unread)."""

    code: str
    quiet: bool
    quns: int
    focus_assist: int


UNKNOWN = QuietState("unknown", False, -1, -1)


def _read_quns(shell32: Any) -> int:
    try:
        value = ctypes.c_int(0)
        hr = shell32.SHQueryUserNotificationState(ctypes.byref(value))
        if hr != 0:
            logger.warning("quiet_state_failed", api="quns", error_type="hresult")
            return -1
        return int(value.value)
    except Exception as e:
        logger.warning("quiet_state_failed", api="quns", error_type=type(e).__name__)
        return -1


def _read_focus_assist(ntdll: Any) -> int:
    try:
        name = ctypes.c_uint64(WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED)
        stamp = ctypes.c_ulong(0)
        buf = ctypes.c_uint32(0)
        size = ctypes.c_ulong(ctypes.sizeof(buf))
        status = ntdll.NtQueryWnfStateData(
            ctypes.byref(name), None, None, ctypes.byref(stamp),
            ctypes.byref(buf), ctypes.byref(size),
        )
        if status != 0:
            logger.warning("quiet_state_failed", api="wnf", error_type="ntstatus")
            return -1
        profile = int(buf.value)
        if profile not in (0, 1, 2):
            logger.warning("quiet_state_failed", api="wnf", error_type="unexpected_profile")
            return -1
        return profile
    except Exception as e:
        logger.warning("quiet_state_failed", api="wnf", error_type=type(e).__name__)
        return -1


def query_quiet_state(
    *, shell32: Any = None, ntdll: Any = None, platform: str | None = None
) -> QuietState:
    """The current quiet state. ``shell32``/``ntdll``/``platform`` are test seams."""
    plat = sys.platform if platform is None else platform
    if plat != "win32":
        return UNKNOWN
    try:
        if shell32 is None:
            shell32 = ctypes.WinDLL("shell32")  # type: ignore[attr-defined]
        if ntdll is None:
            ntdll = ctypes.WinDLL("ntdll")  # type: ignore[attr-defined]
    except Exception as e:
        logger.warning("quiet_state_failed", api="quns", error_type=type(e).__name__)
        return UNKNOWN
    quns = _read_quns(shell32)
    code = _QUNS_QUIET.get(quns)
    if code is not None:
        state = QuietState(code, True, quns, -1)
    else:
        profile = _read_focus_assist(ntdll)
        if profile in _FOCUS_QUIET:
            state = QuietState(_FOCUS_QUIET[profile], True, quns, profile)
        elif profile == 0:
            state = QuietState("accepts", False, quns, 0)
        else:
            state = QuietState("unknown", False, quns, -1)
    logger.debug("quiet_state", quns=state.quns, focus_assist=state.focus_assist, result=state.code)
    return state
```

Note `test_non_windows_is_unknown` passes no fakes; the fakes path always passes `platform="win32"`.

- [ ] **Step 4: Run, expect PASS** — `uv run pytest backend/tests/test_quiet_state.py -q`; `uv run ruff check . && uv run ruff format --check . && uv run mypy backend`.

- [ ] **Step 5: Commit** — subject `feat(call-popup): detect fullscreen, presentation and Focus Assist`:

```bash
git add backend/services/quiet_state.py backend/tests/test_quiet_state.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): detect fullscreen, presentation and Focus Assist' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 3: Call candidate, gate, divert hook, missed-call plan and strings

**Spec:** §4.2, §4.4 "Toasts" (`build_missed_plan`), §8.1, §11.1 "`select_call_candidate`", "`divert_gate`", "Divert hook with the real `plan_toasts`", "i18n".

**Files:**
- Create: `backend/services/call_popup.py` (pure part only; Task 5 adds the controller to the same module).
- Create: `backend/i18n/{en,ja,zh-TW,zh-CN,yue}/call_popup.json`.
- Create: `backend/tests/test_call_popup.py`.
- Modify: `backend/tests/test_backend_i18n.py` (add the `call_popup` section tests).

**Interfaces:**
- Consumes:
  - `CollectedChat` (Task 1) with `group_id: str`, `member_id: str`, `member_dir: Path`, `newest_voice: dict[str, Any] | None`; `newest_key(message) -> tuple[str, str]` from `backend.services.new_message_collector`.
  - `ToastPlan(target: ChatTarget, group_id: str, member_id: str, title: str, body: str, avatar: Path | None, count: int, newest_type: str, newest_id: str)`, `ChatTarget(service, path, name, is_group_chat)`, `UiState(service, group_id, member_id, focused)`, `plan_toasts(...)` (Task 1 order) from `backend.services.notification_planner`.
  - `is_group_chat(service: str, group_id: str | int, member_count: int) -> bool` from `backend.services.chat_kind`.
  - `QuietState` (Task 2) from `backend.services.quiet_state`.
  - `get_strings(section: str, lang: str | None) -> dict[str, str]` from `backend.services.i18n`.
- Produces (in `backend/services/call_popup.py`):

```python
@dataclass(frozen=True)
class CallCandidate:
    group_id: str
    member_id: str
    message_id: str          # the voice's id, as a string (ToastPlan convention)
    member_dir: Path

@dataclass(frozen=True)
class PendingCall:
    call_id: int             # process-wide counter, starting at 1
    plan: ToastPlan          # the built C1 plan (title/body/avatar/target/count)
    candidate: CallCandidate

class Reserver(Protocol):
    def reserve(self, plan: ToastPlan, candidate: CallCandidate) -> PendingCall | None: ...

def select_call_candidate(chats: list[CollectedChat], *, service: str,
                          member_count_for: Callable[[str], int]) -> CallCandidate | None
def divert_gate(*, candidate: CallCandidate | None, enabled: bool, host_available: bool,
                ui_state: UiState, busy: bool, quiet: Callable[[], QuietState]) -> str | None
class QuietProbe:                       # calls its query at most once; remembers the result
    def __init__(self, query: Callable[[], QuietState]) -> None
    def __call__(self) -> QuietState
    @property
    def state(self) -> QuietState | None
class CallDivert:                       # the C1 divert hook; remembers what it reserved
    pending: PendingCall | None
    def __call__(self, plan: ToastPlan) -> bool
def make_call_divert(candidate: CallCandidate | None, gate_reason: str | None,
                     controller: Reserver) -> CallDivert
def log_gate_skip(*, service: str, reason: str, candidate: CallCandidate | None,
                  quiet: QuietState | None) -> None      # logs call_popup_skip
def build_missed_plan(plan: ToastPlan, strings: dict[str, str]) -> ToastPlan
```

- [ ] **Step 1: Create the string files** (UTF-8, two-space JSON, exactly the Global Constraints table). Example `backend/i18n/en/call_popup.json`:

```json
{
  "missed_title": "Missed call: {name}",
  "missed_body": "Click to open the chat",
  "missed_more": "+{n} more messages"
}
```

`ja`: `不在着信：{name}` / `クリックしてトークを開く` / `ほか{n}件のメッセージ`; `zh-TW`: `未接來電：{name}` / `點擊開啟聊天室` / `另有 {n} 則訊息`; `zh-CN`: `未接来电：{name}` / `点击打开聊天室` / `另有 {n} 条消息`; `yue`: `未接來電：{name}` / `㩒一下打開聊天室` / `仲有 {n} 則訊息`.

- [ ] **Step 2: Write the failing tests.** Add to `backend/tests/test_backend_i18n.py` (follow the file's `tray` tests: `I18N_DIR`, `SUPPORTED` are already there):

```python
CALL_POPUP_KEYS = {"missed_title", "missed_body", "missed_more"}


def _load_call_popup(lang: str) -> dict:
    return json.loads((I18N_DIR / lang / "call_popup.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("lang", SUPPORTED)
def test_call_popup_locale_has_same_keys_as_en(lang):
    data = _load_call_popup(lang)
    assert set(data) == CALL_POPUP_KEYS
    assert "{name}" in data["missed_title"] and "{n}" in data["missed_more"]
    assert get_strings("call_popup", lang) == data


def test_call_popup_non_ascii_round_trip():
    assert get_strings("call_popup", "ja")["missed_title"].format(name="金村 美玖") == "不在着信：金村 美玖"
    assert get_strings("call_popup", "yue")["missed_more"].format(n=2) == "仲有 2 則訊息"
```

(Import `json` at the top if the file does not already.) Create `backend/tests/test_call_popup.py` with these tests; reuse the `chat`/`run` style of `test_notification_planner.py` (copy the helpers, do not import test modules):

```python
from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from structlog.testing import capture_logs

from backend.services.call_popup import (
    CallCandidate, PendingCall, QuietProbe, build_missed_plan, divert_gate,
    log_gate_skip, make_call_divert, select_call_candidate,
)
from backend.services.new_message_collector import CollectedChat
from backend.services.notification_planner import ChatTarget, Skip, ToastPlan, UiState, plan_toasts
from backend.services.quiet_state import QuietState

SERVICE, DISPLAY = "hinatazaka46", "日向坂46"
IDLE = UiState(None, None, None, False)
LOUD = QuietState("accepts", False, 5, 0)
QUIET = QuietState("fullscreen", True, 2, -1)


def voice(mid: int, ts: str) -> dict[str, Any]:
    return {"id": mid, "timestamp": ts, "type": "voice", "content": None, "state": "published"}


def chat(root: Path, gid: str, mid: str, *, newest_voice: dict | None, name: str = "金村 美玖",
         count: int = 1) -> CollectedChat:
    newest = newest_voice or {"id": 1, "timestamp": "2026-11-04T09:00:00Z", "type": "text",
                              "content": "hi", "state": "published"}
    return CollectedChat(group_id=gid, group_name=name, member_id=mid, member_name=name,
                         member_dir=root / DISPLAY / "messages" / f"{gid} {name}" / f"{mid} {name}",
                         count=count, newest=newest, newest_voice=newest_voice)


def one(_gid: str) -> int:
    return 1
```

Then the cases (write each as its own test function):
- **`select_call_candidate`:** two 1:1 chats with voices `voice(10, "2026-11-04T10:00:00Z")` and `voice(9, "2026-11-04T11:00:00Z")` → the second (newer timestamp, smaller id); equal timestamps `voice(9, T)` vs `voice(10, T)` → id 10; a chat whose `newest_voice` is `None` is ignored; a room by `member_count_for` returning 2 is excluded; a one-member room in `GROUP_CHAT_IDS` is excluded (pick a real id from `backend.services.chat_kind.GROUP_CHAT_IDS[SERVICE]`, e.g. `next(iter(GROUP_CHAT_IDS[SERVICE]))`); no voices → `None`. The result is `CallCandidate(group_id, member_id, message_id=str(voice["id"]), member_dir=chat.member_dir)`.
- **`divert_gate` order:** with all inputs passing it returns `None`; flipping each input in turn yields `popup_disabled` (`enabled=False`), `no_candidate` (`candidate=None`), `unavailable` (`host_available=False`), `foreground` (`ui_state` focused), `busy` (`busy=True`), `quiet` (`quiet=lambda: QUIET`). With `enabled=False` **and** every later input failing, the reason is still `popup_disabled`. A `quiet` thunk that records calls is **not** called when any of gates 1–5 fails, and is called once when they pass.
- **`QuietProbe`:** calls the query once across two calls; `state` is `None` before the first call and the result after.
- **Divert hook with the real `plan_toasts`** (fake reserver):

```python
class FakeReserver:
    def __init__(self, result: bool = True):
        self.result, self.calls = result, []

    def reserve(self, plan: ToastPlan, candidate: CallCandidate) -> PendingCall | None:
        self.calls.append((plan, candidate))
        return PendingCall(1, plan, candidate) if self.result else None


def plan_with(chats, root, divert, *, enabled=True, ui=IDLE):
    strings = {"sent_photo": "p", "sent_video": "v", "sent_voice": "Sent a voice message",
               "sent_message": "m", "hidden_body": "h", "more": "+{n} more"}
    return plan_toasts(chats, service=SERVICE, service_display=DISPLAY,
                       output_service_dir=root / DISPLAY, ui_state=ui, enabled=enabled,
                       hide_content=False, strings=strings, avatar_for=lambda _d: None,
                       divert=divert, member_count_for=one)
```

  Cases: (a) only the candidate's plan is diverted (`Skip("diverted", "34", "58", 1)`), the other chat's plan is returned, and `hook.pending.plan.group_id == "34"`; (b) a lost race (`FakeReserver(False)`) keeps the plan and logs `call_popup_skip` with `reason="busy"`, `service`, `group_id`, `member_id`, `message_id`; (c) `gate_reason="quiet"` → nothing reserved, `reserve` never called; (d) `candidate=None` → never diverts; (e) notifications off (`enabled=False`) and gate passed → the candidate is reserved (`diverted`) and every other chat is `disabled`; (f) `gate_reason="quiet"` with `enabled=False` → the candidate's chat is `disabled`, nothing returned; (g) a room plan whose `(group_id, member_id)` would match is never diverted (`plan.target.is_group_chat` true; build the plan by hand with `ToastPlan(..., target=ChatTarget(SERVICE, "x", "room", True), member_id="0", ...)` and a candidate with `member_id="0"`); (h) after one successful reserve the hook returns `False` for any later plan.
- **`log_gate_skip`:** with a candidate and `QUIET` → one `call_popup_skip` event with exactly `service, reason, group_id, member_id, message_id, quiet_state="fullscreen"` (+ `log_level`); without a candidate (`no_candidate`) → only `service, reason`.
- **`build_missed_plan`:** `count=1` → title `"Missed call: 金村 美玖"`, body `"Click to open the chat"`; `count=4` → body `"+3 more messages"`; target, tag fields (`group_id`, `member_id`), avatar and count are unchanged (compare with `dataclasses.replace(plan, title=…, body=…)`).

- [ ] **Step 3: Run, expect FAIL** — `uv run pytest backend/tests/test_call_popup.py backend/tests/test_backend_i18n.py -q` (module missing).

- [ ] **Step 4: Implement the pure part of `backend/services/call_popup.py`:**

```python
"""Background incoming-call popup (spec C3 §4).

This module holds the pure decision code (candidate, gate, divert hook,
missed-call plan) and, from Task 5 on, the process-wide
``CallPopupController`` that owns the single active popup call. Logs carry
ids, codes and counts only; names, text and paths are never logged.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import structlog

from backend.services.chat_kind import is_group_chat
from backend.services.new_message_collector import CollectedChat, newest_key
from backend.services.notification_planner import ToastPlan, UiState
from backend.services.quiet_state import QuietState

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class CallCandidate:
    """The newest new voice over this sync's 1:1 chats."""

    group_id: str
    member_id: str
    message_id: str  # the voice's id, as a string (ToastPlan convention)
    member_dir: Path


@dataclass(frozen=True)
class PendingCall:
    """A reserved popup call: the diverted C1 plan plus its candidate."""

    call_id: int
    plan: ToastPlan
    candidate: CallCandidate


class Reserver(Protocol):
    def reserve(self, plan: ToastPlan, candidate: CallCandidate) -> PendingCall | None: ...


def select_call_candidate(
    chats: list[CollectedChat], *, service: str, member_count_for: Callable[[str], int]
) -> CallCandidate | None:
    """The 1:1 chat whose new voice is newest (timestamp, then id); rooms never ring."""
    best: CollectedChat | None = None
    for c in chats:
        if c.newest_voice is None:
            continue
        if is_group_chat(service, c.group_id, member_count_for(c.group_id)):
            continue
        if best is None or newest_key(c.newest_voice) > newest_key(best.newest_voice or {}):
            best = c
    if best is None or best.newest_voice is None:
        return None
    return CallCandidate(best.group_id, best.member_id, str(best.newest_voice.get("id", "")), best.member_dir)


def divert_gate(
    *, candidate: CallCandidate | None, enabled: bool, host_available: bool,
    ui_state: UiState, busy: bool, quiet: Callable[[], QuietState],
) -> str | None:
    """The first failing gate's reason, or None to divert. ``quiet`` is read last."""
    if not enabled:
        return "popup_disabled"
    if candidate is None:
        return "no_candidate"
    if not host_available:
        return "unavailable"
    if ui_state.focused:
        return "foreground"
    if busy:
        return "busy"
    if quiet().quiet:
        return "quiet"
    return None


class QuietProbe:
    """Wraps a quiet-state query so it runs at most once and its result can be logged."""

    def __init__(self, query: Callable[[], QuietState]) -> None:
        self._query = query
        self._state: QuietState | None = None

    def __call__(self) -> QuietState:
        if self._state is None:
            self._state = self._query()
        return self._state

    @property
    def state(self) -> QuietState | None:
        return self._state


class CallDivert:
    """C1 ``divert`` hook: diverts only the candidate's 1:1 plan, once, when reserved."""

    def __init__(self, candidate: CallCandidate | None, gate_reason: str | None, controller: Reserver) -> None:
        self._candidate = candidate
        self._gate_reason = gate_reason
        self._controller = controller
        self.pending: PendingCall | None = None

    def __call__(self, plan: ToastPlan) -> bool:
        c = self._candidate
        if c is None or self._gate_reason is not None or self.pending is not None:
            return False
        if plan.target.is_group_chat or (plan.group_id, plan.member_id) != (c.group_id, c.member_id):
            return False
        pending = self._controller.reserve(plan, c)
        if pending is None:
            logger.info("call_popup_skip", service=plan.target.service, reason="busy",
                        group_id=c.group_id, member_id=c.member_id, message_id=c.message_id)
            return False
        self.pending = pending
        return True


def make_call_divert(candidate: CallCandidate | None, gate_reason: str | None, controller: Reserver) -> CallDivert:
    """Build the divert hook for one ``plan_toasts`` call."""
    return CallDivert(candidate, gate_reason, controller)


def log_gate_skip(*, service: str, reason: str, candidate: CallCandidate | None, quiet: QuietState | None) -> None:
    """Log why the popup was not used for this sync (``call_popup_skip``)."""
    fields: dict[str, object] = {"service": service, "reason": reason}
    if candidate is not None:
        fields.update(group_id=candidate.group_id, member_id=candidate.member_id,
                      message_id=candidate.message_id)
    if reason == "quiet" and quiet is not None:
        fields["quiet_state"] = quiet.code
    logger.info("call_popup_skip", **fields)


def build_missed_plan(plan: ToastPlan, strings: dict[str, str]) -> ToastPlan:
    """The missed-call toast: same target/tag/avatar, title and body from ``strings``.

    ``notifications_hide_content`` does not apply: the popup already showed the
    caller's name and the title carries no message content.
    """
    body = strings["missed_more"].format(n=plan.count - 1) if plan.count > 1 else strings["missed_body"]
    return dataclasses.replace(plan, title=strings["missed_title"].format(name=plan.title), body=body)
```

- [ ] **Step 5: Run, expect PASS** — `uv run pytest backend/tests/test_call_popup.py backend/tests/test_backend_i18n.py -q`; then ruff check, ruff format check, `uv run mypy backend`.

- [ ] **Step 6: Commit** — `feat(call-popup): pick the call candidate and gate the popup`:

```bash
git add backend/services/call_popup.py backend/i18n/*/call_popup.json \
  backend/tests/test_call_popup.py backend/tests/test_backend_i18n.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): pick the call candidate and gate the popup' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 4: Desktop bridge for the popup host

**Spec:** §6.6, §11.1 "Bridge".

**Files:**
- Modify: `backend/services/desktop_bridge.py` (module docstring + new section at the end).
- Create: `backend/tests/test_desktop_bridge_call_popup.py`.

**Interfaces:**
- Consumes: nothing from earlier tasks (the module already imports `ChatTarget` from `notification_planner`; keep it free of `call_popup` imports to avoid a cycle).
- Produces (in `backend.services.desktop_bridge`):

```python
BRIDGE_TIMEOUT_S = 10.0
BRIDGE_START_TIMEOUT_S = 20.0

@dataclass(frozen=True)
class HeardTarget:
    service: str
    path: str          # the frontend chat path; never logged
    message_id: int

class CallPopupHost(Protocol):
    def available(self) -> bool: ...
    def ensure(self) -> bool: ...
    def start(self, call_id: int) -> bool: ...        # True when __sakadeskCallPopup.start ran
    def reveal(self) -> bool: ...
    def hide(self) -> None: ...
    def cancel(self, call_id: int) -> None: ...
    def deliver_heard(self, target: HeardTarget) -> str: ...   # "delivered" | "not_ready"

def set_call_popup_host(host: CallPopupHost | None) -> None   # also re-arms the once-only no_host log
def call_popup_available() -> bool
async def call_popup_start(call_id: int) -> bool
async def call_popup_reveal() -> bool
async def call_popup_hide() -> None
async def call_popup_cancel(call_id: int) -> None
async def call_popup_deliver_heard(target: HeardTarget) -> str   # + "error" | "no_host"
def call_popup_ensure() -> None                                  # fire-and-forget daemon thread
```

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_desktop_bridge_call_popup.py`):

```python
import asyncio
import threading

import pytest
from structlog.testing import capture_logs

from backend.services import desktop_bridge as db


class Host:
    def __init__(self, *, raise_on: str | None = None, block: threading.Event | None = None):
        self.calls: list[tuple] = []
        self.raise_on, self.block = raise_on, block

    def _do(self, op, *args, result=None):
        self.calls.append((op, *args))
        if self.block is not None:
            self.block.wait(5)
        if self.raise_on == op:
            raise RuntimeError("boom")
        return result

    def available(self): return self._do("available", result=True)
    def ensure(self): return self._do("ensure", result=True)
    def start(self, call_id): return self._do("start", call_id, result=True)
    def reveal(self): return self._do("reveal", result=True)
    def hide(self): return self._do("hide")
    def cancel(self, call_id): return self._do("cancel", call_id)
    def deliver_heard(self, target): return self._do("deliver_heard", target, result="delivered")


@pytest.fixture(autouse=True)
def _clear():
    db.set_call_popup_host(None)
    yield
    db.set_call_popup_host(None)


def test_no_host_logs_once_and_returns_safe_values():
    with capture_logs() as logs:
        assert db.call_popup_available() is False
        assert asyncio.run(db.call_popup_start(1)) is False
        assert asyncio.run(db.call_popup_reveal()) is False
        assert asyncio.run(db.call_popup_deliver_heard(db.HeardTarget("s", "p", 1))) == "no_host"
        asyncio.run(db.call_popup_hide())
        asyncio.run(db.call_popup_cancel(1))
        db.call_popup_ensure()
    assert [e for e in logs if e["event"] == "call_popup_unavailable"] == [
        {"event": "call_popup_unavailable", "log_level": "info", "reason": "no_host"}
    ]


def test_host_calls_pass_through():
    host = Host()
    db.set_call_popup_host(host)
    assert db.call_popup_available() is True
    assert asyncio.run(db.call_popup_start(7)) is True
    assert asyncio.run(db.call_popup_reveal()) is True
    asyncio.run(db.call_popup_cancel(7))
    t = db.HeardTarget("hinatazaka46", "日向坂46/messages/34 金村 美玖/58 金村 美玖", 10)
    assert asyncio.run(db.call_popup_deliver_heard(t)) == "delivered"
    assert ("start", 7) in host.calls and ("cancel", 7) in host.calls and ("deliver_heard", t) in host.calls


def test_raising_host_logs_op_and_type_only():
    db.set_call_popup_host(Host(raise_on="start"))
    with capture_logs() as logs:
        assert asyncio.run(db.call_popup_start(1)) is False
    (e,) = [e for e in logs if e["event"] == "call_popup_bridge_failed"]
    assert e["op"] == "start" and e["error_type"] == "RuntimeError"


def test_raising_deliver_heard_returns_error():
    db.set_call_popup_host(Host(raise_on="deliver_heard"))
    assert asyncio.run(db.call_popup_deliver_heard(db.HeardTarget("s", "p", 1))) == "error"


def test_hanging_host_times_out(monkeypatch):
    gate = threading.Event()
    db.set_call_popup_host(Host(block=gate))
    monkeypatch.setattr(db, "BRIDGE_TIMEOUT_S", 0.05)
    try:
        with capture_logs() as logs:
            assert asyncio.run(db.call_popup_reveal()) is False
        (e,) = [e for e in logs if e["event"] == "call_popup_bridge_failed"]
        assert e["op"] == "reveal" and e["reason"] == "timeout"
    finally:
        gate.set()


def test_start_uses_the_longer_timeout(monkeypatch):
    seen = []
    async def fake_wait_for(aw, timeout):
        seen.append(timeout)
        return await aw
    db.set_call_popup_host(Host())
    monkeypatch.setattr(db.asyncio, "wait_for", fake_wait_for)
    asyncio.run(db.call_popup_start(1))
    asyncio.run(db.call_popup_reveal())
    assert seen == [db.BRIDGE_START_TIMEOUT_S, db.BRIDGE_TIMEOUT_S]


def test_ensure_runs_on_a_thread_and_survives_errors():
    host = Host(raise_on="ensure")
    db.set_call_popup_host(host)
    with capture_logs() as logs:
        db.call_popup_ensure()
        for _ in range(100):
            if any(e["event"] == "call_popup_bridge_failed" for e in logs):
                break
            threading.Event().wait(0.01)
    assert ("ensure",) in host.calls
    assert any(e["event"] == "call_popup_bridge_failed" and e["op"] == "ensure" for e in logs)


def test_available_false_when_host_raises():
    db.set_call_popup_host(Host(raise_on="available"))
    assert db.call_popup_available() is False
```

- [ ] **Step 2: Run, expect FAIL** — `uv run pytest backend/tests/test_desktop_bridge_call_popup.py -q`.

- [ ] **Step 3: Implement.** Append to `backend/services/desktop_bridge.py` (add `import threading`, `from dataclasses import dataclass`, `from typing import Protocol, TypeVar` to the imports; extend the module docstring with one sentence: "The call popup host (``set_call_popup_host``) runs blocking GUI calls; every async ``call_popup_*`` wrapper runs them in a worker thread with a timeout and never raises."):

```python
# ------------------------------------------------------------ call popup host

BRIDGE_TIMEOUT_S = 10.0
# start may recreate a lost popup window (POPUP_LOAD_TIMEOUT_S = 15 in the host).
BRIDGE_START_TIMEOUT_S = 20.0

_T = TypeVar("_T")


@dataclass(frozen=True)
class HeardTarget:
    """What the main window marks heard. ``path`` is never logged."""

    service: str
    path: str
    message_id: int


class CallPopupHost(Protocol):
    def available(self) -> bool: ...
    def ensure(self) -> bool: ...
    def start(self, call_id: int) -> bool: ...
    def reveal(self) -> bool: ...
    def hide(self) -> None: ...
    def cancel(self, call_id: int) -> None: ...
    def deliver_heard(self, target: HeardTarget) -> str: ...


_call_popup_host: CallPopupHost | None = None
_call_popup_unavailable_logged = False


def set_call_popup_host(host: CallPopupHost | None) -> None:
    """Register (or clear) the desktop popup window host (Windows only)."""
    global _call_popup_host, _call_popup_unavailable_logged
    _call_popup_host = host
    _call_popup_unavailable_logged = False


def _host_or_log() -> CallPopupHost | None:
    global _call_popup_unavailable_logged
    host = _call_popup_host
    if host is None and not _call_popup_unavailable_logged:
        _call_popup_unavailable_logged = True
        logger.info("call_popup_unavailable", reason="no_host")
    return host


def call_popup_available() -> bool:
    """True when a host is registered and reports itself available. Never raises."""
    host = _host_or_log()
    if host is None:
        return False
    try:
        return bool(host.available())
    except Exception as e:
        logger.warning("call_popup_bridge_failed", op="available", error_type=type(e).__name__)
        return False


async def _run_host(op: str, call: Callable[[CallPopupHost], _T], *, failed: _T, no_host: _T,
                    timeout: float | None = None) -> _T:
    host = _host_or_log()
    if host is None:
        return no_host
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(call, host), BRIDGE_TIMEOUT_S if timeout is None else timeout
        )
    except asyncio.TimeoutError:
        logger.warning("call_popup_bridge_failed", op=op, reason="timeout")
    except Exception as e:
        logger.warning("call_popup_bridge_failed", op=op, error_type=type(e).__name__)
    return failed


async def call_popup_start(call_id: int) -> bool:
    return bool(await _run_host("start", lambda h: h.start(call_id), failed=False, no_host=False,
                                timeout=BRIDGE_START_TIMEOUT_S))


async def call_popup_reveal() -> bool:
    return bool(await _run_host("reveal", lambda h: h.reveal(), failed=False, no_host=False))


async def call_popup_hide() -> None:
    await _run_host("hide", lambda h: h.hide(), failed=None, no_host=None)


async def call_popup_cancel(call_id: int) -> None:
    await _run_host("cancel", lambda h: h.cancel(call_id), failed=None, no_host=None)


async def call_popup_deliver_heard(target: HeardTarget) -> str:
    """``delivered`` | ``not_ready`` from the host, else ``error`` | ``no_host``."""
    return await _run_host("deliver_heard", lambda h: h.deliver_heard(target), failed="error", no_host="no_host")


def call_popup_ensure() -> None:
    """Create the popup window if absent, on a daemon thread. Never blocks, never raises."""
    host = _host_or_log()
    if host is None:
        return

    def run() -> None:
        try:
            host.ensure()
        except Exception as e:
            logger.warning("call_popup_bridge_failed", op="ensure", error_type=type(e).__name__)

    threading.Thread(target=run, name="call_popup_ensure", daemon=True).start()
```

Write the timeout lookups as `BRIDGE_TIMEOUT_S` / `BRIDGE_START_TIMEOUT_S` module globals read at call time (as above), so the monkeypatch in the tests takes effect; `call_popup_start` must therefore pass `timeout=BRIDGE_START_TIMEOUT_S` evaluated inside the function body, not as a default argument.

- [ ] **Step 4: Run, expect PASS** — `uv run pytest backend/tests/test_desktop_bridge_call_popup.py backend/tests/test_desktop_bridge.py -q`; ruff, format check, mypy.

- [ ] **Step 5: Commit** — `feat(call-popup): bridge the popup window host to the backend`:

```bash
git add backend/services/desktop_bridge.py backend/tests/test_desktop_bridge_call_popup.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): bridge the popup window host to the backend' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 5: Call popup controller

**Spec:** §3.2, §4.4 (all of it), §4.6 `info`/`active` semantics, §10, §11.1 "Controller" and "Watchdog vs B".

**Files:**
- Modify: `backend/services/call_popup.py` (append the controller).
- Create: `backend/tests/test_call_popup_controller.py`.

**Interfaces:**
- Consumes:
  - From Task 3 (`backend.services.call_popup`): `CallCandidate(group_id: str, member_id: str, message_id: str, member_dir: Path)`, `PendingCall(call_id: int, plan: ToastPlan, candidate: CallCandidate)`, `build_missed_plan(plan, strings) -> ToastPlan`.
  - From Task 4 (`backend.services.desktop_bridge`): `HeardTarget(service, path, message_id: int)`, async `call_popup_start(call_id) -> bool`, `call_popup_reveal() -> bool`, `call_popup_hide() -> None`, `call_popup_cancel(call_id) -> None`, `call_popup_deliver_heard(target) -> str` (`delivered|not_ready|error|no_host`).
  - C1: `send_planned(plans: list[ToastPlan]) -> int` (`backend.services.notification_service`), `get_ui_state() -> UiState` (`backend.services.ui_state`), `load_config() -> dict` (async, `backend.services.settings_store`), `get_strings(section, lang)` + `resolve_ui_language(config) -> str | None` (`backend.services.i18n`; the latter reads SQLite, run it with `asyncio.to_thread`), `track_background_task(coro, *, name) -> asyncio.Task` (`backend.services.background_tasks`).
- Produces (in `backend.services.call_popup`):

```python
START_WATCHDOG_S = 20      # B's PRELOAD_TIMEOUT_MS (10 s) + 10 s for the page fetches
RING_WATCHDOG_S = 45       # B's RING_TIMEOUT_MS (30 s) + 15 s
CONNECTED_WATCHDOG_S = 900
HEARD_ATTEMPTS = 3
HEARD_RETRY_S = 1.0

@dataclass(frozen=True)
class CallEvent:
    kind: str                  # ringing|skipped|answered|declined|timeout|ended|cancelled|error
    reason: str | None = None
    error_type: str | None = None
    message_id: int | None = None

@dataclass(frozen=True)
class CallInfo:
    call_id: int
    service: str
    path: str                  # plan.target.path; returned to the popup page, never logged
    is_group_chat: bool
    group_id: str
    member_id: str
    message_id: int

class CallPopupController:
    def __init__(self, *, send_toasts=None, bridge=None, get_ui_state=None, load_config=None,
                 strings_for=None, sleep=asyncio.sleep, heard_sleep=asyncio.sleep,
                 start_watchdog_s=START_WATCHDOG_S, ring_watchdog_s=RING_WATCHDOG_S,
                 connected_watchdog_s=CONNECTED_WATCHDOG_S) -> None
    phase: str                 # property: idle|reserved|starting|ringing|connected
    busy: bool                 # property: phase != "idle"
    def reserve(self, plan: ToastPlan, candidate: CallCandidate) -> PendingCall | None
    async def dispatch(self, call_id: int) -> None
    def abandon(self, call_id: int, reason: str) -> None          # reason: sync_failed|cancelled
    def info(self, call_id: int) -> CallInfo | None
    def is_active_for(self, service: str, group_id: str, member_id: str, message_id: int) -> bool
    async def on_event(self, call_id: int, event: CallEvent) -> bool
    async def on_foreground(self) -> None
    async def cancel(self, reason: str) -> None                   # reason: disabled
    async def shutdown(self) -> None
    async def wait_tasks(self) -> None                            # test/shutdown helper: await spawned toasts/heard
def get_call_popup_controller() -> CallPopupController            # process-wide singleton
def _reset_controller_for_tests() -> None
```

**Behaviour to implement (spec §4.4, restated):**
- `reserve`: `idle` → `reserved`, allocates `call_id` (counter from 1), logs `call_popup_reserved` (`call_id`, `service`=`plan.target.service`, `group_id`, `member_id`, `message_id`, `count`); any other phase → `None` (no log; the divert hook logs `busy`).
- `dispatch(call_id)`: only from `reserved` (else log `call_popup_dispatch result=not_reserved`). Re-read `get_ui_state()`. If focused: → `idle`; when `ui.service == plan.target.service and ui.group_id == candidate.group_id and ui.member_id == candidate.member_id` log `result=viewing` and send nothing; otherwise log `result=foreground` and send the **fallback** toast (reason `foreground`). Not focused: **Plan resolution (race):** set `starting` and arm the start watchdog **before** awaiting `bridge.call_popup_start(call_id)`, because the popup page's `GET /calls/{id}` can reach the server loop before the await returns; `True` → log `result=started`; `False` → if still current and `starting`: → `idle`, log `result=start_failed`, fallback toast (reason `start_failed`).
- `abandon(call_id, reason)`: only from `reserved` and the current call (else log `call_popup_abandoned … toast="skipped"`, nothing else). → `idle`; `sync_failed` → fallback toast; `cancelled` → none. Logs `call_popup_abandoned` (`call_id`, `reason`, `toast` = `sent` for `sync_failed`, `skipped` for `cancelled`). Synchronous: it spawns the toast as a tracked background task, never awaits.
- `info(call_id)`: the `CallInfo` when `call_id` is current and the phase is `starting|ringing|connected`; else `None`.
- `is_active_for(...)`: true when the phase is not `idle` and `plan.target.service`, `candidate.group_id`, `candidate.member_id`, `candidate.message_id == str(message_id)` all match.
- `on_event(call_id, event)` — valid phases: `ringing`, `skipped` ← `starting`; `answered`, `declined`, `timeout` ← `ringing`; `ended` ← `connected`; `error`, `cancelled` ← `starting|ringing|connected`. Stale (return `False`, log `call_popup_event_stale` with `call_id`, `event`, `reason`): `unknown_call` (not the current call, or idle), `wrong_phase`, `message_mismatch` (an `answered` whose `message_id` is missing or `!= int(candidate.message_id)`). Accepted events log `call_popup_event` (`call_id`, `event`, `phase` before, `reason`, `error_type`). Effects:

  | event | phase before | effect |
  |---|---|---|
  | `ringing` | starting | → `ringing`, ring watchdog, `await bridge.call_popup_reveal()`. **Plan resolution:** reveal `False` → `idle`, `await bridge.call_popup_cancel(call_id)`, `call_popup_hide reason=reveal_failed`, fallback toast (reason `reveal_failed`) |
  | `skipped` | starting | → `idle`, no hide; `reason == "already_read"` → no toast; else fallback toast (reason = event reason) |
  | `answered` | ringing | → `connected`, connected watchdog, spawn `deliver_heard` |
  | `declined` / `timeout` | ringing | → `idle`, `await bridge.call_popup_hide()`, `call_popup_hide reason=<event>`, missed toast (reason = event) |
  | `ended` | connected | → `idle`, hide, `call_popup_hide reason=ended` |
  | `error` / `cancelled` | starting | → `idle`, hide, fallback toast (reason = event) |
  | `error` / `cancelled` | ringing | → `idle`, hide, missed toast (reason `error`) |
  | `error` / `cancelled` | connected | → `idle`, hide, no toast |

- Watchdogs (one asyncio task at a time, created with `asyncio.get_running_loop().create_task`, cancelled on every transition — but a watchdog never cancels itself): after `sleep(seconds)`, if the call and phase are unchanged → `idle`, log `call_popup_watchdog` (`call_id`, `phase`), `await bridge.call_popup_cancel(call_id)`, `call_popup_hide reason=watchdog`, then `starting` → fallback toast (reason `watchdog`), `ringing` → missed toast (reason `watchdog`), `connected` → no toast.
- `on_foreground()`: `starting`/`ringing` → `idle`, `await bridge.call_popup_cancel(call_id)`, log `call_popup_cancel` (`call_id`, `reason="foreground"`, `phase`), no toast. `connected` → left alone (debug `call_popup_foreground_kept`, `call_id`). `reserved`/`idle` → nothing.
- `cancel(reason)`: any non-idle phase → `idle`; for `starting|ringing|connected` also `await bridge.call_popup_cancel(call_id)`; log `call_popup_cancel` (`call_id`, `reason`, `phase`); no toast.
- `shutdown()`: → `idle` (watchdog cancelled), log `call_popup_cancel reason=app_exit` (`call_id`, `phase`) when a call was active, cancel spawned tasks; no toast, no bridge call.
- Toasts (`_send_toast(pending, kind, reason)`, spawned): `config = await load_config()`; if `config.get("notifications_enabled", True)` is false → log `call_popup_toast_skip` (`call_id`, `kind`, `reason="notifications_disabled"`) and send nothing. Else `plan = pending.plan` (fallback) or `build_missed_plan(pending.plan, await strings_for(config))` (missed); `sent = await send_toasts([plan]) > 0`; log `call_popup_toast` (`call_id`, `kind`, `reason`, `sent`). An exception logs `call_popup_toast` with `sent=False` and `error_type`. Default `strings_for(config)` = `get_strings("call_popup", await asyncio.to_thread(resolve_ui_language, config))`.
- Heard (`_deliver_heard(pending)`, spawned): `target = HeardTarget(plan.target.service, plan.target.path, int(candidate.message_id))`; up to `HEARD_ATTEMPTS` calls, `heard_sleep(HEARD_RETRY_S)` between them, retrying while the result is `not_ready` or `error`; stop on `delivered` or `no_host`. Log `call_popup_heard` (`call_id`, `message_id`, `delivered`, `attempts`, and `reason` = the last result when not delivered).
- State is guarded by a `threading.Lock`; never `await` while holding it. Spawned work uses `track_background_task(coro, name=...)` and is also kept in `self._tasks` for `wait_tasks()`.

- [ ] **Step 1: Write the test harness and failing tests** (`backend/tests/test_call_popup_controller.py`):

```python
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from structlog.testing import capture_logs

from backend.services.call_popup import (
    CONNECTED_WATCHDOG_S, RING_WATCHDOG_S, START_WATCHDOG_S,
    CallCandidate, CallEvent, CallInfo, CallPopupController,
)
from backend.services.desktop_bridge import HeardTarget
from backend.services.notification_planner import ChatTarget, ToastPlan, UiState

PATH = "日向坂46/messages/34 金村 美玖/58 金村 美玖"
STRINGS = {"missed_title": "Missed call: {name}", "missed_body": "Click to open the chat",
           "missed_more": "+{n} more messages"}
IDLE_UI = UiState(None, None, None, False)


def plan(count: int = 1) -> ToastPlan:
    return ToastPlan(target=ChatTarget("hinatazaka46", PATH, "金村 美玖", False), group_id="34",
                     member_id="58", title="金村 美玖", body="Sent a voice message", avatar=None,
                     count=count, newest_type="voice", newest_id="10")


CAND = CallCandidate("34", "58", "10", Path("out") / PATH)


class Bridge:
    def __init__(self, *, start=True, reveal=True, heard=("delivered",)):
        self.start_result, self.reveal_result = start, reveal
        self.heard = list(heard)
        self.calls: list[tuple] = []

    async def call_popup_start(self, call_id): self.calls.append(("start", call_id)); return self.start_result
    async def call_popup_reveal(self): self.calls.append(("reveal",)); return self.reveal_result
    async def call_popup_hide(self): self.calls.append(("hide",))
    async def call_popup_cancel(self, call_id): self.calls.append(("cancel", call_id))
    async def call_popup_deliver_heard(self, target):
        self.calls.append(("heard", target))
        return self.heard.pop(0) if len(self.heard) > 1 else self.heard[0]


class Sleeper:
    """Injected watchdog sleep: parks every call until release()."""
    def __init__(self): self.durations: list[float] = []; self._futs: list[asyncio.Future] = []
    async def __call__(self, s: float) -> None:
        self.durations.append(s)
        fut = asyncio.get_running_loop().create_future()
        self._futs.append(fut)
        await fut
    def release(self) -> None:
        for f in self._futs:
            if not f.done():
                f.set_result(None)
        self._futs.clear()


class Env:
    def __init__(self, *, ui: UiState = IDLE_UI, notifications: bool = True, **bridge_kw: Any):
        self.ui, self.bridge, self.sleeper, self.sent = ui, Bridge(**bridge_kw), Sleeper(), []
        self.config = {"notifications_enabled": notifications, "language": "en"}
        self.heard_sleep = AsyncMock()

        async def send(plans): self.sent.extend(plans); return len(plans)
        async def load(): return dict(self.config)
        async def strings(_c): return dict(STRINGS)

        self.ctrl = CallPopupController(send_toasts=send, bridge=self.bridge, get_ui_state=lambda: self.ui,
                                        load_config=load, strings_for=strings, sleep=self.sleeper,
                                        heard_sleep=self.heard_sleep)

    async def settle(self) -> None:
        for _ in range(5):
            await asyncio.sleep(0)
        await self.ctrl.wait_tasks()

    async def ringing(self, count: int = 1) -> int:
        p = self.ctrl.reserve(plan(count), CAND)
        await self.ctrl.dispatch(p.call_id)
        assert await self.ctrl.on_event(p.call_id, CallEvent("ringing"))
        return p.call_id


def events(logs, name): return [e for e in logs if e["event"] == name]
```

Tests to write (each a separate `@pytest.mark.asyncio` function using `Env`):
1. `reserve` → `reserved`, `call_id == 1`, logs `call_popup_reserved` with `count`; a second `reserve` → `None`; ids keep increasing across calls (after `abandon`, the next reserve gets 2).
2. `dispatch` not focused → bridge `("start", 1)`, phase `starting`, `call_popup_dispatch result=started`, start watchdog armed with `START_WATCHDOG_S` (`sleeper.durations == [20]`).
3. `dispatch` start `False` → `idle`, `result=start_failed`, one fallback toast equal to `plan()`.
4. `dispatch` focused on that chat (`UiState("hinatazaka46", "34", "58", True)`) → `idle`, `result=viewing`, no start, no toast; focused elsewhere → `result=foreground`, fallback toast, no start.
5. `dispatch` of a non-reserved id → `result=not_reserved`, no bridge call.
6. `info` is `None` while `reserved`, equals `CallInfo(1, "hinatazaka46", PATH, False, "34", "58", 10)` while `starting/ringing/connected`, `None` after `idle` and for another id. `is_active_for("hinatazaka46", "34", "58", 10)` true while reserved…connected, false for message 11 and after idle.
7. Event × phase matrix (parametrize over `(event, phase_before, expected_phase, hide, toast_kind)`) covering every row of the effect table above, asserting bridge calls, phase, and toast kind (`fallback` → `sent == [plan()]`; `missed` → `sent[0].title == "Missed call: 金村 美玖"`).
8. Stale: wrong id → `unknown_call`; `declined` while `starting` → `wrong_phase`; `answered` with `message_id=11` or `None` → `message_mismatch`; each returns `False` and changes nothing.
9. `skipped reason=already_read` → no toast; `skipped reason=no_photo` → fallback toast.
10. Reveal failure: `Env(reveal=False)`, ringing event → `idle`, bridge `cancel`, `call_popup_hide reason=reveal_failed`, fallback toast.
11. Answer → `connected`, `deliver_heard` called with `HeardTarget("hinatazaka46", PATH, 10)`; logs `call_popup_heard delivered=True attempts=1`; `Env(heard=("not_ready", "not_ready", "delivered"))` → `attempts=3`, `heard_sleep` awaited twice with `1.0`; `Env(heard=("error",))` → `delivered=False attempts=3 reason="error"`; `Env(heard=("no_host",))` → `attempts=1 reason="no_host"`.
12. Missed text: `count=1` → body `"Click to open the chat"`; `count=4` → `"+3 more messages"`; CJK title preserved.
13. Notifications off (`Env(notifications=False)`): decline, timeout, `skipped no_photo`, start failure, dispatch-time foreground and `abandon(sync_failed)` each send nothing and log `call_popup_toast_skip` with `reason="notifications_disabled"` and the right `kind`; the phase still goes `idle`.
14. Watchdogs: in `starting` release the sleeper → bridge `cancel`, `call_popup_watchdog phase=starting`, fallback toast; in `ringing` (durations show `45`) → missed toast; in `connected` (durations show `900`) → cancel, no toast. A transition before release cancels the watchdog (release after `declined` changes nothing more).
15. `on_foreground` per phase: `starting`/`ringing` → cancel + `call_popup_cancel reason=foreground`, no toast; `connected` → untouched; `reserved` → untouched (and a following `dispatch` with `ui` focused elsewhere → `foreground` toast).
16. `cancel("disabled")` in each active phase → `idle`, no toast, bridge cancel only for started phases; logs `call_popup_cancel reason=disabled`.
17. `shutdown()` while ringing → `idle`, `call_popup_cancel reason=app_exit`, no toast, no bridge call, the watchdog task is cancelled.
18. `abandon(1, "sync_failed")` from reserved → fallback toast, `toast="sent"`; `abandon(1, "cancelled")` → no toast, `toast="skipped"`; `abandon` when not reserved → logged `toast="skipped"` and nothing else.
19. No log event emitted by the controller contains the plan's title, body or path (scan every captured event's values for `"金村"` and `"messages/"`).
20. **Watchdog vs B** (plain sync test):

```python
ROOT = Path(__file__).resolve().parents[2]


def _ms(rel: str, name: str) -> int:
    text = (ROOT / rel).read_text(encoding="utf-8")
    m = re.search(rf"{name}\s*=\s*([\d_]+)", text)
    assert m, name
    return int(m.group(1).replace("_", ""))


def test_watchdogs_outlast_b_timers():
    ring = _ms("frontend/src/features/incomingCall/useIncomingCall.ts", "RING_TIMEOUT_MS")
    preload = _ms("frontend/src/features/incomingCall/preloadAudio.ts", "PRELOAD_TIMEOUT_MS")
    assert RING_WATCHDOG_S * 1000 > ring
    assert START_WATCHDOG_S * 1000 > preload
    assert CONNECTED_WATCHDOG_S == 900
```

- [ ] **Step 2: Run, expect FAIL** — `uv run pytest backend/tests/test_call_popup_controller.py -q` (`ImportError`).

- [ ] **Step 3: Implement the controller** in `backend/services/call_popup.py`. Add imports (`asyncio`, `threading`, `Any`, `Awaitable` and `Coroutine` from `collections.abc`; `from backend.services import desktop_bridge`; `from backend.services.background_tasks import track_background_task`; `from backend.services.desktop_bridge import HeardTarget`; `from backend.services.i18n import get_strings, resolve_ui_language`). Import `send_planned`, `get_ui_state` and `settings_store.load_config` **inside** `__init__` when the argument is `None` (keeps the module import light and cycle-free). Core skeleton:

```python
IDLE, RESERVED, STARTING, RINGING, CONNECTED = "idle", "reserved", "starting", "ringing", "connected"
_VALID: dict[str, frozenset[str]] = {
    "ringing": frozenset({STARTING}), "skipped": frozenset({STARTING}),
    "answered": frozenset({RINGING}), "declined": frozenset({RINGING}), "timeout": frozenset({RINGING}),
    "ended": frozenset({CONNECTED}),
    "error": frozenset({STARTING, RINGING, CONNECTED}), "cancelled": frozenset({STARTING, RINGING, CONNECTED}),
}


async def _default_strings(config: dict[str, Any]) -> dict[str, str]:
    return get_strings("call_popup", await asyncio.to_thread(resolve_ui_language, config))


class CallPopupController:
    """Owns the one active popup call (spec §4.4). Methods run on the server loop."""

    def __init__(self, *, send_toasts=None, bridge=None, get_ui_state=None, load_config=None,
                 strings_for=None, sleep=asyncio.sleep, heard_sleep=asyncio.sleep,
                 start_watchdog_s: float = START_WATCHDOG_S, ring_watchdog_s: float = RING_WATCHDOG_S,
                 connected_watchdog_s: float = CONNECTED_WATCHDOG_S) -> None:
        if send_toasts is None:
            from backend.services.notification_service import send_planned as send_toasts
        if get_ui_state is None:
            from backend.services.ui_state import get_ui_state
        if load_config is None:
            from backend.services.settings_store import load_config
        self._send_toasts = send_toasts
        self._bridge = bridge if bridge is not None else desktop_bridge
        self._get_ui_state = get_ui_state
        self._load_config = load_config
        self._strings_for = strings_for or _default_strings
        self._sleep, self._heard_sleep = sleep, heard_sleep
        self._durations = {STARTING: start_watchdog_s, RINGING: ring_watchdog_s, CONNECTED: connected_watchdog_s}
        self._lock = threading.Lock()
        self._phase = IDLE
        self._pending: PendingCall | None = None
        self._next_id = 1
        self._watchdog: asyncio.Task[None] | None = None
        self._tasks: set[asyncio.Task[Any]] = set()

    # --- helpers (call with the lock held where noted) ---
    def _current_id(self) -> int | None:
        return self._pending.call_id if self._pending is not None else None

    def _cancel_watchdog_locked(self) -> None:
        task, self._watchdog = self._watchdog, None
        if task is not None and not task.done() and task is not asyncio.current_task():
            task.cancel()

    def _to_idle_locked(self) -> None:
        self._cancel_watchdog_locked()
        self._phase, self._pending = IDLE, None

    def _enter_locked(self, phase: str, call_id: int) -> None:
        self._cancel_watchdog_locked()
        self._phase = phase
        self._watchdog = asyncio.get_running_loop().create_task(
            self._watch(call_id, phase, self._durations[phase]))

    def _spawn(self, coro: Coroutine[Any, Any, Any], name: str) -> None:
        task = track_background_task(coro, name=name)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _spawn_toast(self, pending: PendingCall, kind: str, reason: str) -> None:
        self._spawn(self._send_toast(pending, kind, reason), "call_popup_toast")

    async def wait_tasks(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)
```

(`Coroutine` from `collections.abc`.) The methods with the trickiest ordering, verbatim:

```python
    async def dispatch(self, call_id: int) -> None:
        with self._lock:
            pending = self._pending
            if pending is None or pending.call_id != call_id or self._phase != RESERVED:
                pending = None
            else:
                ui = self._get_ui_state()
                if ui.focused:
                    self._to_idle_locked()
                    viewing: bool | None = (
                        ui.service == pending.plan.target.service
                        and ui.group_id == pending.candidate.group_id
                        and ui.member_id == pending.candidate.member_id
                    )
                else:
                    viewing = None
                    # Enter starting BEFORE the await: the page's GET /calls/{id}
                    # may reach the loop before call_popup_start returns.
                    self._enter_locked(STARTING, call_id)
        if pending is None:
            logger.info("call_popup_dispatch", call_id=call_id, result="not_reserved")
            return
        if viewing is True:
            logger.info("call_popup_dispatch", call_id=call_id, result="viewing")
            return
        if viewing is False:
            logger.info("call_popup_dispatch", call_id=call_id, result="foreground")
            self._spawn_toast(pending, "fallback", "foreground")
            return
        if await self._bridge.call_popup_start(call_id):
            logger.info("call_popup_dispatch", call_id=call_id, result="started")
            return
        with self._lock:
            still = self._current_id() == call_id and self._phase == STARTING
            if still:
                self._to_idle_locked()
        logger.info("call_popup_dispatch", call_id=call_id, result="start_failed")
        if still:
            self._spawn_toast(pending, "fallback", "start_failed")

    async def on_event(self, call_id: int, event: CallEvent) -> bool:
        with self._lock:
            phase, pending = self._phase, self._pending
            if pending is None or pending.call_id != call_id or phase == IDLE:
                stale: str | None = "unknown_call"
            elif phase not in _VALID.get(event.kind, frozenset()):
                stale = "wrong_phase"
            elif event.kind == "answered" and str(event.message_id) != pending.candidate.message_id:
                stale = "message_mismatch"
            else:
                stale = None
                if event.kind == "ringing":
                    self._enter_locked(RINGING, call_id)
                elif event.kind == "answered":
                    self._enter_locked(CONNECTED, call_id)
                else:
                    self._to_idle_locked()
        if stale is not None or pending is None:
            logger.info("call_popup_event_stale", call_id=call_id, event=event.kind, reason=stale)
            return False
        logger.info("call_popup_event", call_id=call_id, event=event.kind, phase=phase,
                    reason=event.reason, error_type=event.error_type)
        kind = event.kind
        if kind == "ringing":
            if not await self._bridge.call_popup_reveal():
                with self._lock:
                    still = self._current_id() == call_id and self._phase == RINGING
                    if still:
                        self._to_idle_locked()
                if still:
                    await self._bridge.call_popup_cancel(call_id)
                    logger.info("call_popup_hide", call_id=call_id, reason="reveal_failed")
                    self._spawn_toast(pending, "fallback", "reveal_failed")
        elif kind == "answered":
            self._spawn(self._deliver_heard(pending), "call_popup_heard")
        elif kind == "skipped":
            if event.reason != "already_read":
                self._spawn_toast(pending, "fallback", event.reason or "skipped")
        else:
            await self._bridge.call_popup_hide()
            logger.info("call_popup_hide", call_id=call_id, reason=kind)
            if kind in ("declined", "timeout"):
                self._spawn_toast(pending, "missed", kind)
            elif phase == STARTING:
                self._spawn_toast(pending, "fallback", kind)
            elif phase == RINGING:
                self._spawn_toast(pending, "missed", "error")
        return True

    async def _watch(self, call_id: int, phase: str, seconds: float) -> None:
        await self._sleep(seconds)
        with self._lock:
            if self._current_id() != call_id or self._phase != phase:
                return
            pending = self._pending
            self._watchdog = None  # never cancel ourselves
            self._to_idle_locked()
        logger.warning("call_popup_watchdog", call_id=call_id, phase=phase)
        await self._bridge.call_popup_cancel(call_id)
        logger.info("call_popup_hide", call_id=call_id, reason="watchdog")
        if pending is not None and phase == STARTING:
            self._spawn_toast(pending, "fallback", "watchdog")
        elif pending is not None and phase == RINGING:
            self._spawn_toast(pending, "missed", "watchdog")

    async def _send_toast(self, pending: PendingCall, kind: str, reason: str) -> None:
        call_id = pending.call_id
        try:
            config = await self._load_config()
            if not config.get("notifications_enabled", True):
                logger.info("call_popup_toast_skip", call_id=call_id, kind=kind, reason="notifications_disabled")
                return
            plan = pending.plan
            if kind == "missed":
                plan = build_missed_plan(plan, await self._strings_for(config))
            sent = await self._send_toasts([plan]) > 0
            logger.info("call_popup_toast", call_id=call_id, kind=kind, reason=reason, sent=sent)
        except Exception as e:
            logger.warning("call_popup_toast", call_id=call_id, kind=kind, reason=reason,
                           sent=False, error_type=type(e).__name__)

    async def _deliver_heard(self, pending: PendingCall) -> None:
        target = HeardTarget(pending.plan.target.service, pending.plan.target.path,
                             int(pending.candidate.message_id))
        result, attempts = "", 0
        while attempts < HEARD_ATTEMPTS:
            attempts += 1
            result = await self._bridge.call_popup_deliver_heard(target)
            if result in ("delivered", "no_host"):
                break
            if attempts < HEARD_ATTEMPTS:
                await self._heard_sleep(HEARD_RETRY_S)
        delivered = result == "delivered"
        logger.info("call_popup_heard", call_id=pending.call_id, message_id=pending.candidate.message_id,
                    delivered=delivered, attempts=attempts, **({} if delivered else {"reason": result}))
```

Implement `phase`/`busy` properties, `reserve`, `abandon`, `info`, `is_active_for`, `on_foreground`, `cancel` and `shutdown` per the behaviour list above (each a short locked transition followed by the bridge call and the log, in the same style). `abandon` must not await: spawn its toast with `_spawn_toast`. The module-level singleton:

```python
_controller: CallPopupController | None = None


def get_call_popup_controller() -> CallPopupController:
    """The process-wide controller (one popup call at a time across all services)."""
    global _controller
    if _controller is None:
        _controller = CallPopupController()
    return _controller


def _reset_controller_for_tests() -> None:
    global _controller
    _controller = None
```

Update the module docstring's second paragraph to describe the controller (Zero Drift).

- [ ] **Step 4: Run, expect PASS** — `uv run pytest backend/tests/test_call_popup_controller.py backend/tests/test_call_popup.py -q`; ruff check, ruff format check, `uv run mypy backend`.

- [ ] **Step 5: Commit** — `feat(call-popup): drive the popup call from a backend controller`:

```bash
git add backend/services/call_popup.py backend/tests/test_call_popup_controller.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): drive the popup call from a backend controller' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 6: Call popup API, foreground hook, client-log whitelist, setting and shutdown

**Spec:** §4.6, §5 (backend part), §9.2 (whitelist), §4.4 `shutdown`, §11.1 "API", "Settings", "Client-log".

**Files:**
- Create: `backend/api/call_popup.py`, `backend/tests/test_call_popup_api.py`.
- Modify: `backend/main.py` (import + `app.include_router(call_popup.router)`; lifespan shutdown calls `await get_call_popup_controller().shutdown()` right before the auto-sync scheduler stop).
- Modify: `backend/api/ui_state.py` (after storing, `focused=True` → `await get_call_popup_controller().on_foreground()`), `backend/tests/test_ui_state_api.py`.
- Modify: `backend/api/client_log.py` (events `call_popup_start`, `call_popup_error`, `call_popup_heard_applied`, `call_popup_heard_ignored`; fields `surface`, `call_id`, `changed`), `backend/tests/test_client_log_api.py`.
- Modify: `backend/services/settings_store.py` (`_SETTINGS_DEFAULTS["call_popup_enabled"] = True` with a comment), `backend/api/settings.py` (`SettingsResponse.call_popup_enabled: bool = True`, `SettingsUpdate.call_popup_enabled: Optional[bool] = None`, both response constructions, `_apply` with change detection), `tests/test_api_settings.py`, `backend/tests/test_settings_store_extended.py`.
- Modify: `backend/tests/test_tray_tooltip_wiring.py` or a new `backend/tests/test_call_popup_lifespan.py` (lifespan shutdown test).

**Interfaces:**
- Consumes (Task 5, `backend.services.call_popup`): `get_call_popup_controller() -> CallPopupController` with `info(call_id) -> CallInfo | None`, `async on_event(call_id, CallEvent) -> bool`, `is_active_for(service, group_id, member_id, message_id: int) -> bool`, `async on_foreground()`, `async cancel(reason: str)`, `async shutdown()`; `CallEvent(kind, reason=None, error_type=None, message_id=None)`; `CallInfo` dataclass (`call_id, service, path, is_group_chat, group_id, member_id, message_id`). Task 4: `desktop_bridge.call_popup_ensure() -> None`.
- Produces (HTTP, used by the popup page in Task 10 and the main window in Task 8):
  - `GET /api/call-popup/calls/{call_id}` → `200 {call_id, service, path, is_group_chat, group_id, member_id, message_id}` or `404`.
  - `POST /api/call-popup/calls/{call_id}/events`, body `{event: "ringing"|"skipped"|"answered"|"declined"|"timeout"|"ended"|"cancelled"|"error", reason?: code, error_type?: code, message_id?: int}` (extra keys forbidden) → `204`, or `409` when `on_event` returns `False`.
  - `GET /api/call-popup/active?service=&group_id=&member_id=&message_id=` → `200 {"active": bool}`.
  - Validation: `call_id` path int `1..999999999999`; codes `^[a-z0-9_]{1,40}$`; ids `^[0-9]{1,12}$`; `message_id` `StrictInt` in the body, int `≥ 0` in the query. A violation returns `422` and logs nothing.
  - Setting `call_popup_enabled` (default `True`) in `GET/POST /api/settings`.

- [ ] **Step 1: Write the failing API tests** (`backend/tests/test_call_popup_api.py`). Patch the controller with a fake via `monkeypatch.setattr("backend.api.call_popup.get_call_popup_controller", lambda: fake)`:

```python
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.call_popup import CallEvent, CallInfo

client = TestClient(app)
PATH = "日向坂46/messages/34 金村 美玖/58 金村 美玖"


class FakeController:
    def __init__(self, ok: bool = True):
        self.ok, self.events, self.active_args = ok, [], []

    def info(self, call_id):
        return CallInfo(call_id, "hinatazaka46", PATH, False, "34", "58", 10) if call_id == 1 else None

    async def on_event(self, call_id, event: CallEvent):
        self.events.append((call_id, event))
        return self.ok

    def is_active_for(self, service, group_id, member_id, message_id):
        self.active_args.append((service, group_id, member_id, message_id))
        return message_id == 10


@pytest.fixture
def fake(monkeypatch):
    f = FakeController()
    monkeypatch.setattr("backend.api.call_popup.get_call_popup_controller", lambda: f)
    return f
```

Cases: `GET /calls/1` → 200 with the exact dict (CJK path intact), `GET /calls/2` → 404; `POST /calls/1/events {"event": "answered", "message_id": 10}` → 204 and `fake.events == [(1, CallEvent("answered", None, None, 10))]`; `{"event": "skipped", "reason": "no_photo"}` → 204; `fake.ok = False` → 409; 422 (and no log event with `source` or `call_popup_` from the API) for each of: unknown event `"rang"`, `reason: "No Photo"`, `reason: "写真"`, `message_id: 1.5`, `message_id: "10"`, an extra key `{"event": "ringing", "path": "x"}`, `call_id` `0` and `abc`; `GET /active?service=hinatazaka46&group_id=34&member_id=58&message_id=10` → `{"active": true}`, `message_id=11` → false, `group_id=3a` → 422. Assert no API log line ever contains `PATH`.

- [ ] **Step 2: Write the failing wiring tests:**
  - `backend/tests/test_ui_state_api.py`: a fake controller with `on_foreground = AsyncMock()` patched at `backend.api.ui_state.get_call_popup_controller`; posting `focused: true` awaits it once; `focused: false` never.
  - `backend/tests/test_client_log_api.py`: each new event is accepted with its fields (`{"event": "call_popup_heard_applied", "fields": {"service": "hinatazaka46", "group_id": 34, "member_id": 58, "message_id": 10, "changed": True}}` → 204 and logged at info with `source="client"`); `{"event": "call_ring", "fields": {"surface": "popup", "message_id": 10}}` → 204; `{"event": "call_popup_start", "fields": {"call_id": 1}}` → 204; the old rules still reject (`{"event": "call_popup_start", "fields": {"path": "x"}}` → 422, `{"event": "call_popup_error", "fields": {"error_type": "Has Space"}}` → 422).
  - `tests/test_api_settings.py` (use its `isolated_settings` fixture and the existing `client` fixture): `call_popup_enabled` defaults to `True`; `POST {"call_popup_enabled": false}` round-trips and is saved; turning it **on** from off calls `backend.api.settings.desktop_bridge.call_popup_ensure` once (patch it); turning it **off** from on awaits the controller's `cancel(reason="disabled")` once (patch `backend.api.settings.get_call_popup_controller` with a fake whose `cancel` is an `AsyncMock`); posting the same value again calls neither.
  - `backend/tests/test_settings_store_extended.py`: `_SETTINGS_DEFAULTS["call_popup_enabled"] is True`.
  - Lifespan (`backend/tests/test_call_popup_lifespan.py`, copy the `_reset_bridge` fixture pattern from `test_tray_tooltip_wiring.py`, including `shutdown_state.reset_for_tests()`): patch `backend.services.call_popup.get_call_popup_controller` to return a fake with `shutdown = AsyncMock()`; `with TestClient(app): pass`; assert `shutdown` awaited once.

- [ ] **Step 3: Run, expect FAIL** — `uv run pytest backend/tests/test_call_popup_api.py backend/tests/test_ui_state_api.py backend/tests/test_client_log_api.py backend/tests/test_call_popup_lifespan.py backend/tests/test_settings_store_extended.py tests/test_api_settings.py -q`.

- [ ] **Step 4: Implement `backend/api/call_popup.py`:**

```python
"""Background call popup API (spec C3 §4.6).

The popup page reads its call (``GET /calls/{id}``) and reports what B's call
hook did (``POST /calls/{id}/events``); the main window asks whether the popup
already owns a voice (``GET /active``) before ringing it in the app. Only
code-like values are accepted, so names, text or paths never reach the log;
the returned ``path`` is never logged.
"""

from dataclasses import asdict
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, HTTPException, Path, Query, Response
from pydantic import BaseModel, ConfigDict, StrictInt, StringConstraints

from backend.services.call_popup import CallEvent, get_call_popup_controller

router = APIRouter(prefix="/api/call-popup", tags=["call-popup"])

CodeStr = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,40}$")]
CallId = Annotated[int, Path(ge=1, le=999_999_999_999)]
EventName = Literal["ringing", "skipped", "answered", "declined", "timeout", "ended", "cancelled", "error"]


class CallEventBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: EventName
    reason: Optional[CodeStr] = None
    error_type: Optional[CodeStr] = None
    message_id: Optional[StrictInt] = None


@router.get("/calls/{call_id}")
async def get_call(call_id: CallId) -> dict:
    info = get_call_popup_controller().info(call_id)
    if info is None:
        raise HTTPException(status_code=404, detail="No such call")
    return asdict(info)


@router.post("/calls/{call_id}/events", status_code=204)
async def post_call_event(call_id: CallId, body: CallEventBody) -> Response:
    ok = await get_call_popup_controller().on_event(
        call_id, CallEvent(body.event, body.reason, body.error_type, body.message_id))
    return Response(status_code=204 if ok else 409)


@router.get("/active")
async def get_active(
    service: Annotated[str, Query(pattern=r"^[a-z0-9_]{1,40}$")],
    group_id: Annotated[str, Query(pattern=r"^[0-9]{1,12}$")],
    member_id: Annotated[str, Query(pattern=r"^[0-9]{1,12}$")],
    message_id: Annotated[int, Query(ge=0)],
) -> dict[str, bool]:
    return {"active": get_call_popup_controller().is_active_for(service, group_id, member_id, message_id)}
```

Register it in `backend/main.py`: add `call_popup` to the `from backend.api import (...)` list and `app.include_router(call_popup.router)` after `ui_state.router`. In the lifespan shutdown, immediately before `if auto_sync_scheduler is not None: await auto_sync_scheduler.stop()`:

```python
    # Drop any popup call (no toast) before syncs and writers stop.
    from backend.services.call_popup import get_call_popup_controller

    await get_call_popup_controller().shutdown()
```

In `backend/api/ui_state.py` import `get_call_popup_controller` at module level and, after the `logger.debug("ui_state", ...)` line:

```python
    if body.focused:
        # The main window came forward: a popup that is still ringing yields to it (no toast).
        await get_call_popup_controller().on_foreground()
```

Update the module docstring with that sentence.

In `backend/api/client_log.py` add the four events to `ClientEvent` and `"surface", "call_id", "changed"` to `ALLOWED_FIELDS`.

In `backend/api/settings.py`: import `from backend.services import desktop_bridge` and `from backend.services.call_popup import get_call_popup_controller`; add the field to both models and both `SettingsResponse(...)` constructions (`call_popup_enabled=config.get("call_popup_enabled", True)`); in `update_settings` add `call_popup_change: Optional[bool] = None` to the `nonlocal` list and:

```python
        if update.call_popup_enabled is not None:
            if update.call_popup_enabled != config.get("call_popup_enabled", True):
                call_popup_change = update.call_popup_enabled
            config["call_popup_enabled"] = update.call_popup_enabled
```

and after the autostart handling:

```python
    if call_popup_change is True:
        # Create the popup window now (in a thread; never blocks this response).
        desktop_bridge.call_popup_ensure()
    elif call_popup_change is False:
        await get_call_popup_controller().cancel(reason="disabled")
```

- [ ] **Step 5: Run, expect PASS** — the Step 3 command, then the full `uv run pytest -q`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy backend`.

- [ ] **Step 6: Commit** — `feat(call-popup): expose the popup call API and setting`:

```bash
git add backend/api/call_popup.py backend/main.py backend/api/ui_state.py backend/api/client_log.py \
  backend/api/settings.py backend/services/settings_store.py backend/tests/test_call_popup_api.py \
  backend/tests/test_ui_state_api.py backend/tests/test_client_log_api.py \
  backend/tests/test_call_popup_lifespan.py backend/tests/test_settings_store_extended.py tests/test_api_settings.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): expose the popup call API and setting' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 7: Divert during sync, download the voice first, dispatch or abandon

**Spec:** §4.5, §3.1, §11.1 "Sync", §10 rows "Sync fails or is cancelled after reserving".

**Files:**
- Modify: `backend/services/sync_service.py` (`_notify_new_messages`, the `start_sync` call site, phase 3, the `except`/`finally` blocks).
- Modify: `backend/tests/test_sync_notify.py` (gate/divert wiring).
- Create: `backend/tests/test_sync_call_popup.py` (full-run phase-3 and abort tests).

**Interfaces:**
- Consumes:
  - Task 3 (`backend.services.call_popup`): `select_call_candidate(chats, *, service, member_count_for) -> CallCandidate | None`, `divert_gate(*, candidate, enabled, host_available, ui_state, busy, quiet) -> str | None`, `QuietProbe(query)` (callable; `.state -> QuietState | None`), `make_call_divert(candidate, gate_reason, controller) -> CallDivert` (callable; `.pending -> PendingCall | None`), `log_gate_skip(*, service, reason, candidate, quiet) -> None`, `PendingCall(call_id, plan, candidate)` with `candidate.message_id: str` and `candidate.member_dir: Path`.
  - Task 5: `get_call_popup_controller()` → `.busy: bool`, `.reserve(...)`, `async .dispatch(call_id) -> None`, `.abandon(call_id, reason) -> None`.
  - Task 2: `query_quiet_state() -> QuietState` (`backend.services.quiet_state`).
  - Task 4: `desktop_bridge.call_popup_available() -> bool`.
  - Existing: `track_background_task(coro, *, name)`, `self.manager.process_media_queue(session, queue, progress_callback=...) -> dict[Path, dict[int, dict]]`. Queue items carry `"message_id"` (int) and `"member_dir"` (Path).
- Produces: `SyncService._notify_new_messages(collector, app_settings) -> PendingCall | None` (the reserved call, returned even when sending toasts failed afterwards, so a reservation can never leak).

- [ ] **Step 1: Write the failing `_notify_new_messages` tests** in `backend/tests/test_sync_notify.py`. Extend `_run` with optional `controller`, `available=True` and `quiet=QuietState("accepts", False, 5, 0)` arguments, patching `backend.services.sync_service.get_call_popup_controller`, `backend.services.sync_service.desktop_bridge.call_popup_available` and `backend.services.sync_service.query_quiet_state`, and return `(send, result)`. Add a voice to the collector for member 58 (`{"id": 10, "timestamp": "2026-11-04T11:00:00Z", "type": "voice", "content": None, "state": "published"}`). Use a fake controller:

```python
class FakeController:
    busy = False

    def __init__(self, ok: bool = True):
        self.ok, self.reserved = ok, []

    def reserve(self, plan, candidate):
        self.reserved.append((plan, candidate))
        return PendingCall(1, plan, candidate) if self.ok else None
```

Cases: (a) the voice chat is diverted — `send` gets only member 59's plan, the return value is the `PendingCall` with `candidate.message_id == "10"`, and `notify_skip reason=diverted` is logged; (b) `call_popup_enabled: False` in settings → no reserve, both plans sent, `call_popup_skip reason=popup_disabled`; (c) `available=False` → `unavailable`; (d) focused `ui` elsewhere → `foreground`; (e) `FakeController.busy = True` → `busy`; (f) `quiet=QuietState("fullscreen", True, 2, -1)` → `call_popup_skip reason=quiet quiet_state=fullscreen`; (g) the quiet query is not called when the gate fails earlier (a `MagicMock` `query_quiet_state` with `assert_not_called()`); (h) `notifications_enabled: False` with the popup on → reserved, member 59 `notify_skip reason=disabled`, `send` not awaited with any plan; (i) `send_planned` raising after a reservation → `notify_failed` is logged **and** the `PendingCall` is still returned; (j) no voice → `call_popup_skip reason=no_candidate`, return `None`.

- [ ] **Step 2: Write the failing full-run tests** (`backend/tests/test_sync_call_popup.py`), reusing the core harness by import (`backend/tests` is a package):

```python
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.call_popup import CallCandidate, PendingCall
from backend.services.sync_service import SyncService
from backend.tests.test_sync_service_core import _mock_sync_manager, _run_start_sync
```

Build one group (100) with one member (101). The fake `sync_member(session, group, member, queue, **kw)` appends two queue items — the voice `{"message_id": 10, "member_dir": md, "media_type": "voice", "url": "u1", "path": md / "voice/10.m4a", "timestamp": "…"}` and a picture `{"message_id": 11, "member_dir": md, …}` — fires `kw["on_new_messages"]` with a voice row id 10, and returns 2. Patch `backend.services.sync_service.get_call_popup_controller` with a fake whose `busy=False`, `reserve` returns `PendingCall(7, plan, candidate)`, `dispatch = AsyncMock()`, `abandon = MagicMock()`; patch `desktop_bridge.call_popup_available` → `True`, `query_quiet_state` → not quiet, and capture `track_background_task` calls (`side_effect` that records `(coro, name)` and closes non-dispatch coroutines you do not await). Make `process_media_queue` an `AsyncMock(side_effect=lambda s, q, progress_callback=None: {md: {int(i["message_id"]): {"duration": 1} for i in q}})` that also records each call's message ids.

Cases:
- the first `process_media_queue` call contains only message 10; the second contains only 11 (voice removed from the chunk loop); `update_message_metadata` receives dims for both 10 and 11; `call_popup_voice_first` is logged with `call_id=7, items=1, downloaded=<the callback's count>`; one `track_background_task` call named `call_popup_dispatch`; `abandon` not called;
- no matching voice item (sync_member appends only the picture) → `call_popup_voice_first items=0 downloaded=0`, dispatch still scheduled, one chunk call with the picture;
- empty media queue entirely → dispatch still scheduled (phase 3 must not skip it);
- an exception after reservation and before dispatch (make `process_media_queue` raise `RuntimeError` on its first call) → `abandon(7, reason="sync_failed")`, no dispatch;
- `asyncio.CancelledError` raised from the first `process_media_queue` call → `start_sync` re-raises it (`pytest.raises(asyncio.CancelledError)`) and `abandon(7, reason="cancelled")`;
- `SessionExpiredError` from `pysaka` raised there → re-raised, `abandon(7, reason="sync_failed")`.

- [ ] **Step 3: Run, expect FAIL** — `uv run pytest backend/tests/test_sync_notify.py backend/tests/test_sync_call_popup.py -q`.

- [ ] **Step 4: Implement `_notify_new_messages`.** Add imports at the top of `sync_service.py`:

```python
from backend.services import desktop_bridge
from backend.services.call_popup import (
    PendingCall, QuietProbe, divert_gate, get_call_popup_controller, log_gate_skip,
    make_call_divert, select_call_candidate,
)
from backend.services.quiet_state import query_quiet_state
```

Replace the body so it reads (keep the existing skip/summary logging):

```python
    async def _notify_new_messages(
        self, collector: NewMessageCollector, app_settings: dict[str, Any]
    ) -> PendingCall | None:
        """Plan and send one toast per member/room; divert the newest 1:1 voice to the popup.

        Returns the reserved popup call (or None). Logs ids, counts and error
        types only. A failure is logged as ``notify_failed`` and swallowed; a call
        reserved before the failure is still returned so the sync dispatches or
        abandons it.
        """
        divert = None
        try:
            chats = collector.entries()
            if not chats:
                return None
            group_dirs = {c.group_id: c.member_dir.parent for c in chats}

            def member_count_for(gid: str) -> int:
                return _count_member_dirs(group_dirs[gid])

            ui = get_ui_state()
            controller = get_call_popup_controller()
            candidate = select_call_candidate(chats, service=self._service, member_count_for=member_count_for)
            probe = QuietProbe(query_quiet_state)
            gate_reason = divert_gate(
                candidate=candidate,
                enabled=bool(app_settings.get("call_popup_enabled", True)),
                host_available=desktop_bridge.call_popup_available(),
                ui_state=ui,
                busy=controller.busy,
                quiet=probe,
            )
            if gate_reason is not None:
                log_gate_skip(service=self._service, reason=gate_reason, candidate=candidate, quiet=probe.state)
            divert = make_call_divert(candidate, gate_reason, controller)
            language = await asyncio.to_thread(resolve_ui_language, app_settings)
            plans, skips = plan_toasts(
                chats,
                service=self._service,
                service_display=get_service_display_name(self._service),
                output_service_dir=self.service_data_dir,
                ui_state=ui,
                enabled=bool(app_settings.get("notifications_enabled", True)),
                hide_content=bool(app_settings.get("notifications_hide_content", False)),
                strings=get_strings("notifications", language),
                avatar_for=find_avatar,
                # C3: the newest new 1:1 voice goes to the bottom-right call popup.
                divert=divert,
                member_count_for=member_count_for,
            )
            # ... unchanged: notify_skip per skip, send_planned, notify_summary ...
        except Exception as e:
            logger.warning("notify_failed", service=self._service, error_type=type(e).__name__)
        return divert.pending if divert is not None else None
```

- [ ] **Step 5: Implement the run wiring in `start_sync`.**
  - Before the outer `try:` (next to `rate_limited`), add:

    ```python
        # C3: a popup call reserved by _notify_new_messages; dispatched after
        # its voice downloads, or abandoned if the run stops first.
        pending_call: PendingCall | None = None
        call_dispatched = False
        call_abort_reason = "sync_failed"
    ```

  - At the notify call site: `pending_call = await self._notify_new_messages(collector, app_settings)`.
  - Phase 3: hoist `total_successed = 0` and `all_dimensions_by_dir = {}` above `if media_queue:` (right after `progress.start_phase(...)`; `media_count = len(media_queue)` stays computed **before** the voice is removed so the progress total is unchanged), then insert:

    ```python
                if pending_call is not None:
                    cand = pending_call.candidate
                    voice_items = [
                        item for item in media_queue
                        if str(item.get("message_id")) == cand.message_id
                        and item.get("member_dir") == cand.member_dir
                    ]
                    voice_downloaded = 0
                    if voice_items:
                        media_queue[:] = [i for i in media_queue if i not in voice_items]
                        voice_stats = [0]

                        async def voice_cb(c, t):
                            voice_stats[0] = c
                            progress.set_completed(c, detail=f"{c:,} files")

                        voice_dims = await self.manager.process_media_queue(
                            session, voice_items, progress_callback=voice_cb
                        )
                        for member_dir, dims in voice_dims.items():
                            all_dimensions_by_dir.setdefault(member_dir, {}).update(dims)
                        voice_downloaded = voice_stats[0]
                        total_successed += voice_downloaded
                    logger.info("call_popup_voice_first", call_id=pending_call.call_id,
                                items=len(voice_items), downloaded=voice_downloaded)
                    track_background_task(
                        get_call_popup_controller().dispatch(pending_call.call_id),
                        name="call_popup_dispatch",
                    )
                    call_dispatched = True
    ```

  - The chunk loop iterates `range(0, len(media_queue), chunk_size)` (not `media_count`), the `messages.json` metadata update loop runs whenever `all_dimensions_by_dir` is non-empty (move it out of `if media_queue:`), and `"No new media to download."` is logged only when `media_count == 0`.
  - In `except asyncio.CancelledError:` set `call_abort_reason = "cancelled"` first. The other branches keep `sync_failed`.
  - In the outer `finally:` (first statement):

    ```python
            if pending_call is not None and not call_dispatched:
                # Never awaits: abandon spawns its fallback toast as a background task.
                get_call_popup_controller().abandon(pending_call.call_id, reason=call_abort_reason)
    ```

- [ ] **Step 6: Run, expect PASS** — `uv run pytest backend/tests/test_sync_notify.py backend/tests/test_sync_call_popup.py backend/tests/test_sync_service_core.py -q`, then the full suite, ruff, format check, mypy.

- [ ] **Step 7: Commit** — `feat(call-popup): divert new voices to the popup during sync`:

```bash
git add backend/services/sync_service.py backend/tests/test_sync_notify.py backend/tests/test_sync_call_popup.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): divert new voices to the popup during sync' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 8: Additive hooks in B's call, ringtone swap point, main-window popup check

**Spec:** §7.3, §7.6, §9.2 (frontend types), §10 row "Main window visible but unfocused, same chat selected", §11.3 "`useIncomingCall`".

**Files:**
- Modify: `frontend/src/utils/clientLog.ts` (events + field keys).
- Modify: `frontend/src/features/incomingCall/callDecision.ts` (`CallSkipReason` gains `'popup_active'`; `decideCall` unchanged).
- Modify: `frontend/src/features/incomingCall/useIncomingCall.ts` (optional `surface`, `onOutcome`, `isCallElsewhere`; export `CallOutcome`).
- Create: `frontend/src/features/incomingCall/ringtone.ts`.
- Create: `frontend/src/features/callPopup/callPopupApi.ts` (only `isCallPopupActive` in this task).
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (pass `isCallElsewhere`).
- Modify: `frontend/src/__tests__/mocks/handlers.ts` (MSW: `GET /api/call-popup/active` → `{active: false}`).
- Create tests: `frontend/src/features/incomingCall/useIncomingCall.popup.test.ts`, `frontend/src/features/incomingCall/ringtone.test.ts`, `frontend/src/features/callPopup/callPopupApi.test.ts`, and extend `frontend/src/utils/clientLog.test.ts` if it enumerates events.

**Interfaces:**
- Consumes: B's existing `useIncomingCall(args: UseIncomingCallArgs, preload?) -> IncomingCall`, `clientLog(event, fields)`, `parseReadStatePath(path) -> {service, groupId, memberId} | null` (`features/messages/readStatePath.ts`); backend `GET /api/call-popup/active?service=&group_id=&member_id=&message_id=` → `{active: boolean}` (Task 6).
- Produces:

```ts
// utils/clientLog.ts
export type ClientLogEvent = /* existing */ | 'call_popup_start' | 'call_popup_error'
    | 'call_popup_heard_applied' | 'call_popup_heard_ignored';
export type ClientLogFieldKey = /* existing */ | 'surface' | 'call_id' | 'changed';

// incomingCall/useIncomingCall.ts
export type CallOutcome =
    | { kind: 'skipped'; reason: CallSkipReason | 'superseded' | 'media_unavailable' }
    | { kind: 'ringing' } | { kind: 'declined' } | { kind: 'timeout' }
    | { kind: 'ended' }         // when the ended hold finishes (where scrollToMessage is called)
    | { kind: 'cancelled' };    // visit cleanup or setting off while ringing/connected
export interface UseIncomingCallArgs {
    /* existing fields unchanged */
    surface?: 'popup';
    onOutcome?: (o: CallOutcome) => void;
    isCallElsewhere?: (messageId: number) => Promise<boolean>;
}

// incomingCall/ringtone.ts
export interface Ringtone { start(): void; stop(): void }
export const SILENT_RINGTONE: Ringtone;
/** The one swap point for a future synthesized (Web Audio) ringtone. */
export function getRingtone(): Ringtone;

// callPopup/callPopupApi.ts
export async function isCallPopupActive(
    ctx: { service: string; groupId: number; memberId: number }, messageId: number,
): Promise<boolean>   // false on any failure
```

- [ ] **Step 1: Write the failing hook tests** (`useIncomingCall.popup.test.ts`; copy `makeArgs`, `voice`, `member`, `DIR`, `flush`, `ringing` and the `clientLog` mock from `useIncomingCall.test.ts` — do not edit that file):
  - `onOutcome` fires `{kind:'ringing'}` on ring; `{kind:'declined'}` on decline; `{kind:'timeout'}` after `RING_TIMEOUT_MS`; `{kind:'ended'}` only after `ENDED_HOLD_MS` following `onPlaybackEnded` (not at the moment of `call_end`); `{kind:'cancelled'}` on unmount while ringing and on `enabled: false` while connected; `{kind:'skipped', reason:'no_photo'}` for a member without images; a repeated identical skip on the same visit (rerender with `freshFetch.seq: 2`) still fires `onOutcome` twice while `call_skip` is logged once; a failing preload fires `{kind:'skipped', reason:'media_unavailable'}`; `already_read` after preload fires `{kind:'skipped', reason:'already_read'}`.
  - `surface: 'popup'` adds `surface: 'popup'` to **every** `clientLog` call of a ring → answer → end flow (`log.mock.calls.every(([, f]) => f.surface === 'popup')`); without `surface` the existing exact payloads are unchanged (e.g. `call_ring` is exactly `{service, group_id, member_id, message_id}`).
  - `isCallElsewhere` resolving `true` → no ring, `call_skip` with `reason: 'popup_active'` and `message_id: 10`, `onOutcome` skipped `popup_active`; resolving `false` → rings; rejecting → rings; it is called once with `10`, after the preload resolved (assert call order with a preload mock that records).
  - A visit change while `isCallElsewhere` is pending → `call_skip reason: 'superseded'`, no ring.

- [ ] **Step 2: Write the failing small tests:** `ringtone.test.ts` (`getRingtone()` returns `SILENT_RINGTONE`; `start`/`stop` are callable no-ops); `callPopupApi.test.ts` with MSW `server.use(...)`: requests `/api/call-popup/active?service=hinatazaka46&group_id=34&member_id=58&message_id=10` and returns `true` for `{active: true}`, `false` for a 500 and for a network error.

- [ ] **Step 3: Run, expect FAIL** — `cd frontend && npx vitest run src/features/incomingCall src/features/callPopup`.

- [ ] **Step 4: Implement.**
  - `clientLog.ts`: add the event and field union members listed above.
  - `callDecision.ts`: `| 'popup_active'` in `CallSkipReason`, with a doc comment "produced only by useIncomingCall's isCallElsewhere check, never by decideCall".
  - `ringtone.ts`: exactly the interface above (`SILENT_RINGTONE = { start() {}, stop() {} }`, `getRingtone()` returns it).
  - `useIncomingCall.ts`:
    - add the three optional fields with doc comments, and `export type CallOutcome` as above;
    - add one logging helper and use it for **every** `clientLog` call in the hook (add `log` to each hook dependency array that uses it so eslint gains no warning):

      ```ts
      const log = useCallback((event: ClientLogEvent, fields: ClientLogFields) => {
          const surface = argsRef.current.surface;
          clientLog(event, surface ? { ...fields, surface } : fields);
      }, []);
      const outcome = useCallback((o: CallOutcome) => { argsRef.current.onOutcome?.(o); }, []);
      ```

    - fire `outcome` at: `startRinging` after `call_ring` (`ringing`); the ring timer after `call_timeout` (`timeout`); `decline` after `call_decline` (`declined`); `toEnded`'s hold timer after `scrollToMessage` (`ended`); the visit cleanup after `call_cancel` (`cancelled`); the setting-off effect after its `call_cancel` (`cancelled`); `logSkip` **before** its dedupe return (`skipped`, `d.reason`); `fail()` (`superseded` when superseded, else `media_unavailable` **before** the `mediaErrorLoggedRef` dedupe).
    - replace the preload success branch with:

      ```ts
      async () => {
          settled();
          const skip = (reason: 'superseded' | 'call_active' | 'already_read' | 'popup_active') => {
              log('call_skip', { ...ctx, message_id: message.id, reason });
              outcome({ kind: 'skipped', reason });
          };
          const stale = () => evalId !== evalIdRef.current || argsRef.current.chatDir !== chatDir;
          if (stale()) return skip('superseded');
          // Defensive and effectively unreachable (see the comment kept from B).
          if (phaseRef.current !== 'idle') return skip('call_active');
          if (!argsRef.current.isUnread(message.id)) return skip('already_read');
          const elsewhere = argsRef.current.isCallElsewhere;
          if (elsewhere) {
              // The popup owns this voice (main window visible but unfocused): don't ring it twice.
              const active = await elsewhere(message.id).catch(() => false);
              if (stale()) return skip('superseded');
              if (phaseRef.current !== 'idle') return skip('call_active');
              if (active) return skip('popup_active');
          }
          startRinging({ message, name: a.name, photoUrl: photoUrl as string, audioUrl });
      },
      ```

      With no `isCallElsewhere` there is no `await` before `startRinging`, so B's timing and every existing B test are unchanged. Keep B's existing comment about the defensive `call_active` exit.
  - `callPopupApi.ts`:

    ```ts
    /** True when the backend's popup currently owns this voice (GET /api/call-popup/active). */
    export async function isCallPopupActive(
        ctx: { service: string; groupId: number; memberId: number }, messageId: number,
    ): Promise<boolean> {
        try {
            const q = new URLSearchParams({
                service: ctx.service, group_id: String(ctx.groupId),
                member_id: String(ctx.memberId), message_id: String(messageId),
            });
            const res = await fetch(`/api/call-popup/active?${q}`);
            if (!res.ok) return false;
            const body = await res.json() as { active?: unknown };
            return body.active === true;
        } catch {
            return false;
        }
    }
    ```

  - `MessagesFeature.tsx`: import `isCallPopupActive`; define before the `useIncomingCall` call

    ```ts
    const isCallElsewhere = useCallback((messageId: number) => {
        const ctx = selectedGroupDir ? parseReadStatePath(selectedGroupDir) : null;
        return ctx ? isCallPopupActive(ctx, messageId) : Promise.resolve(false);
    }, [selectedGroupDir]);
    ```

    and pass `isCallElsewhere` to `useIncomingCall`.
  - `handlers.ts`: `http.get('/api/call-popup/active', () => HttpResponse.json({ active: false }))`.

- [ ] **Step 5: Run, expect PASS** — `cd frontend && npx vitest run src/features/incomingCall src/features/callPopup src/utils && npx tsc --noEmit && npx vitest run && npm run lint` (warnings ≤ 20, no new ones).

- [ ] **Step 6: Commit** — `feat(call-popup): report call outcomes and skip calls the popup owns`:

```bash
git add frontend/src/utils/clientLog.ts frontend/src/features/incomingCall frontend/src/features/callPopup \
  frontend/src/features/messages/MessagesFeature.tsx frontend/src/__tests__/mocks/handlers.ts frontend/src/utils/clientLog.test.ts
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): report call outcomes and skip calls the popup owns' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

(Drop `clientLog.test.ts` from `git add` if you did not change it.)

---

### Task 9: One read-state store and the main-window heard bridge

**Spec:** §7.4, §11.3 "`readStateStore`" and "`markVoiceHeard`".

**Files:**
- Create: `frontend/src/features/messages/readStateStore.ts` (+ `readStateStore.test.ts`).
- Create: `frontend/src/features/messages/hooks/useReadStateSubscription.ts` (+ `.test.ts`); export it from `frontend/src/features/messages/hooks/index.ts` if that barrel lists the other hooks.
- Create: `frontend/src/shell/markVoiceHeard.ts` (+ `markVoiceHeard.test.ts`).
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (use the store; subscribe), `frontend/src/shell/App.tsx` (install `window.__sakadeskMarkVoiceHeard` next to `__sakadeskOpenChat`).

**Interfaces:**
- Consumes: `persisted.getConv<T>(key, fallback)`, `persisted.setConv(key, patch)` (`core/persistence/persisted.ts`); `parseReadStatePath(path)` (`features/messages/readStatePath.ts`); `clientLog` with the events/fields added in Task 8 (`call_popup_heard_applied`, `call_popup_heard_ignored`, field `changed`).
- Produces:

```ts
// features/messages/readStateStore.ts
export interface ReadState { lastReadId: number; readCount: number; revealedIds: number[] }
export const EMPTY_READ_STATE: ReadState;                    // { lastReadId: 0, readCount: 0, revealedIds: [] }
export function readStateKey(path: string): string;          // `read_state_${path}`
export function parseReadState(row: unknown): ReadState;     // today's loadReadState parsing + fallbacks
export function loadReadState(path: string): ReadState;      // parseReadState(persisted.getConv(key, {}))
export function saveReadState(path: string, state: ReadState): void; // setConv + fire-and-forget PUT /api/read-states
export function applyReveal(prev: ReadState, msgId: number, messageIds: number[]): ReadState; // pure
export function isUnreadIn(state: ReadState): (id: number) => boolean;
export function revealInStore(path: string, msgId: number): boolean; // false when already heard
export type ReadStateListener = (path: string) => void;
export function subscribeReadState(listener: ReadStateListener): () => void;

// features/messages/hooks/useReadStateSubscription.ts
export function useReadStateSubscription(
    selectedGroupDir: string | undefined,
    onSelectedChanged: (state: ReadState) => void,
    onAnyChange: () => void,
): void

// shell/markVoiceHeard.ts
export interface VoiceHeardPayload { service: string; path: string; message_id: number }
export function markVoiceHeard(payload: unknown): boolean;   // always true (malformed is ignored + logged)
declare global { interface Window { __sakadeskMarkVoiceHeard?: (payload: unknown) => boolean } }
```

`MessagesFeature` keeps exporting `ReadState` (re-export from the store: `export type { ReadState } from './readStateStore';`) so existing imports keep working.

- [ ] **Step 1: Write the failing tests.**
  - `readStateStore.test.ts`: `parseReadState` for `{}`, `{value: ''}`, `{value: 'not json'}`, `{value: JSON.stringify(s)}`, `null`; table-driven `applyReveal` cases written from today's `revealMessage` logic: (1) already revealed → returns `prev` (same object); (2) reveal the first unread id with messageIds `[1..5]`, `lastReadId 2` → `lastReadId 3`, `revealedIds []`, `readCount+1`; (3) reveal 5 with `[3,4,5]` unread → `lastReadId` stays, `revealedIds [5]`; (4) then reveal 3 and 4 → consolidates to `lastReadId 5`, `revealedIds []`; (5) `messageIds []` → just appends to `revealedIds`, `readCount+1`; `isUnreadIn` (`id > lastReadId && !revealedIds.includes(id)`); `revealInStore` with `vi.spyOn(persisted, 'getConv')`/`'setConv'` and `fetch` stubbed: writes `setConv('read_state_<path>', {value: JSON.stringify(next)})`, PUTs `/api/read-states` with `{service, group_id, member_id, last_read_id, read_count, revealed_ids}`, notifies a subscriber with the path, returns `true`; a second call for the same id returns `false` and writes nothing; unsubscribe stops notifications.
  - `useReadStateSubscription.test.ts` (`renderHook`): a `revealInStore` on the selected path calls `onSelectedChanged` with the new state and `onAnyChange`; on another path only `onAnyChange`; after unmount nothing.
  - `markVoiceHeard.test.ts` (mock `clientLog`, spy `persisted`): a valid payload (`path` = `'日向坂46/messages/34 金村 美玖/58 金村 美玖'`, `message_id: 10`) → `true`, logs `call_popup_heard_applied` with `{service:'hinatazaka46', group_id:34, member_id:58, message_id:10, changed:true}`; the same again → `changed:false`; malformed (`null`, missing `path`, `message_id: '10'`, `message_id: 1.5`, an unparsable path `'x/y'`) → `true`, logs `call_popup_heard_ignored` `{reason:'malformed'}`, writes nothing. No log call contains the path or a name.

- [ ] **Step 2: Run, expect FAIL** — `cd frontend && npx vitest run src/features/messages src/shell/markVoiceHeard.test.ts`.

- [ ] **Step 3: Implement `readStateStore.ts`** by moving MessagesFeature's code verbatim into pure functions: `parseReadState` (today's `loadReadState` body taking the row), `saveReadState` (today's body minus `setReadStateVersion`), `applyReveal` (today's `revealMessage` consolidation with `messages.map(m => m.id)` replaced by `messageIds`; the early `return prev` kept), and:

```ts
const listeners = new Set<ReadStateListener>();

export function subscribeReadState(listener: ReadStateListener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * Mark one voice heard in the primary store (used by the main window when the
 * popup answered it). Consolidation happens the next time the chat is open.
 */
export function revealInStore(path: string, msgId: number): boolean {
    const prev = loadReadState(path);
    if (!isUnreadIn(prev)(msgId)) return false;
    saveReadState(path, applyReveal(prev, msgId, []));
    for (const l of [...listeners]) {
        try { l(path); } catch (err) { console.debug('[readStateStore] listener failed', err); }
    }
    return true;
}
```

- [ ] **Step 4: Rewire `MessagesFeature.tsx`** with byte-identical behaviour: delete its `loadReadState`/`saveReadState` definitions; keep a local `const saveAndBump = useCallback((path: string, s: ReadState) => { saveReadState(path, s); setReadStateVersion(v => v + 1); }, []);` and use it wherever `saveReadState` was called; `revealMessage` becomes `setReadState(prev => { const next = applyReveal(prev, msgId, messages.map(m => m.id)); if (next !== prev && selectedGroupDir) saveAndBump(selectedGroupDir, next); return next; })`; `isUnread` stays as is. Add:

```ts
useReadStateSubscription(selectedGroupDir, setReadState, () => setReadStateVersion(v => v + 1));
```

Implement the hook with a ref for the selected dir:

```ts
export function useReadStateSubscription(selectedGroupDir, onSelectedChanged, onAnyChange): void {
    const ref = useRef({ selectedGroupDir, onSelectedChanged, onAnyChange });
    useLayoutEffect(() => { ref.current = { selectedGroupDir, onSelectedChanged, onAnyChange }; });
    useEffect(() => subscribeReadState(path => {
        const cur = ref.current;
        cur.onAnyChange();
        if (path === cur.selectedGroupDir) cur.onSelectedChanged(loadReadState(path));
    }), []);
}
```

- [ ] **Step 5: Implement `shell/markVoiceHeard.ts`:**

```ts
import { clientLog } from '../utils/clientLog';
import { parseReadStatePath } from '../features/messages/readStatePath';
import { revealInStore } from '../features/messages/readStateStore';

/**
 * Main-window heard bridge: the backend calls window.__sakadeskMarkVoiceHeard
 * after the popup answered a voice. The main window is the only writer of read
 * state. Returns true even for a malformed payload so the backend never retries
 * one that can never apply.
 */
export function markVoiceHeard(payload: unknown): boolean {
    const p = payload as Partial<VoiceHeardPayload> | null;
    const ctx = p && typeof p.path === 'string' ? parseReadStatePath(p.path) : null;
    if (!p || typeof p.service !== 'string' || !ctx || typeof p.message_id !== 'number'
        || !Number.isInteger(p.message_id) || p.message_id <= 0) {
        clientLog('call_popup_heard_ignored', { reason: 'malformed' });
        return true;
    }
    const changed = revealInStore(p.path as string, p.message_id);
    clientLog('call_popup_heard_applied', {
        service: ctx.service, group_id: ctx.groupId, member_id: ctx.memberId,
        message_id: p.message_id, changed,
    });
    return true;
}
```

In `App.tsx`, next to the `__sakadeskOpenChat` effect:

```ts
    // Desktop popup answered a voice: the main window (sole writer) marks it heard.
    useEffect(() => {
        window.__sakadeskMarkVoiceHeard = markVoiceHeard;
        return () => { delete window.__sakadeskMarkVoiceHeard; };
    }, []);
```

- [ ] **Step 6: Run, expect PASS** — `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`.

- [ ] **Step 7: Commit** — `feat(call-popup): mark popup-answered voices heard in the main window`:

```bash
git add frontend/src/features/messages frontend/src/shell/markVoiceHeard.ts \
  frontend/src/shell/markVoiceHeard.test.ts frontend/src/shell/App.tsx
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): mark popup-answered voices heard in the main window' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 10: The popup page (route, language, CallPopupApp, PopupCall, inset halo)

**Spec:** §7.1, §7.2, §7.5, §7.6 (`PopupCall` uses the ringtone), §11.3 "`CallPopupApp` / `PopupCall`", "Route", "Language".

**Files:**
- Create: `frontend/src/shell/callPopupRoute.ts` (+ `.test.ts`), `frontend/src/shell/language.ts` (+ `.test.ts`).
- Modify: `frontend/src/shell/App.tsx` (the post-hydrate language step calls `applyStartupLanguage()`), `frontend/src/shell/main.tsx` (route).
- Modify: `frontend/src/features/callPopup/callPopupApi.ts` (add `CallPopupInfo`, `fetchCallInfo`, `postCallEvent`).
- Create: `frontend/src/features/callPopup/CallPopupApp.tsx`, `PopupCall.tsx`, `callPopup.css`, `index.ts`, `CallPopupApp.test.tsx`.
- Modify: `frontend/src/features/incomingCall/callScreen.css` (inset halo).
- Modify: `frontend/src/__tests__/mocks/handlers.ts` (defaults: `GET /api/call-popup/calls/:id` → 404, `POST /api/call-popup/calls/:id/events` → 204).

**Interfaces:**
- Consumes:
  - Task 8: `UseIncomingCallArgs.surface/onOutcome`, `CallOutcome`, `getRingtone(): Ringtone`, `clientLog` events `call_popup_start`/`call_popup_error` and field `call_id`.
  - Task 9: `ReadState`, `readStateKey(path) -> 'read_state_<path>'`, `parseReadState(row: unknown)`, `isUnreadIn(state)` from `features/messages/readStateStore`.
  - Task 6 HTTP: `GET /api/call-popup/calls/{id}` → `{call_id, service, path, is_group_chat, group_id, member_id, message_id}` | 404; `POST /api/call-popup/calls/{id}/events` body `{event, reason?, error_type?, message_id?}`.
  - Existing: `persisted.hydratePrefs()`, `persisted.getConversation(key)` (GET `/api/app-state/conversation?path=<key>`; **Plan resolution:** the spec's `?key=` is the query name `path` in the real API, and `persisted.getConversation` is the existing read-only helper for it), `GET /api/settings`, `GET /api/content/messages_by_path?path=<path>&limit=0` → `{messages, member, …}`; B's `useIncomingCall`, `CallScreen`, `CallAudio`, `preloadAudio`; `getServiceTheme(service)` (`config/serviceThemes`), `getServiceDisplayName(service)` (`data/services`), `formatName` (`utils`), `parseReadStatePath`, `useTranslation` (`i18n`), `i18n` default export.
- Produces:

```ts
// shell/callPopupRoute.ts
export function isCallPopupView(search: string): boolean;     // URLSearchParams(search).get('view') === 'call-popup'
// shell/language.ts
export async function applyStartupLanguage(): Promise<void>;  // persisted 'language', else /api/settings language, else keep default
// features/callPopup/callPopupApi.ts (additions)
export interface CallPopupInfo { call_id: number; service: string; path: string; is_group_chat: boolean;
                                 group_id: string; member_id: string; message_id: number }
export type CallPopupEvent = 'ringing' | 'skipped' | 'answered' | 'declined' | 'timeout' | 'ended' | 'cancelled' | 'error';
export interface CallEventExtra { reason?: string; error_type?: string; message_id?: number }
export async function fetchCallInfo(callId: number): Promise<CallPopupInfo | null>;  // null on 404; throws otherwise
export function postCallEvent(callId: number, event: CallPopupEvent, extra?: CallEventExtra): void; // fire-and-forget
// features/callPopup/CallPopupApp.tsx
export const CallPopupApp: React.FC<{ preload?: (url: string, signal?: AbortSignal) => Promise<void> }>;
declare global { interface Window { __sakadeskCallPopup?: { start(callId: number): void; cancel(callId: number): void } } }
```

- [ ] **Step 1: Write the failing small tests.** `callPopupRoute.test.ts`: `'?view=call-popup'` true; `''`, `'?view=other'`, `'?x=call-popup'` false. `language.test.ts` (spy `persisted.getPref`, `i18n.changeLanguage`, stub `fetch`): persisted `'ja'` → `changeLanguage('ja')` and no fetch; none + settings `{language:'zh-TW'}` → `'zh-TW'`; none + fetch rejects → no change.

- [ ] **Step 2: Write the failing popup tests** (`CallPopupApp.test.tsx`): mock `../../utils/clientLog`; use MSW `server.use(...)` for `GET /api/call-popup/calls/1` (returns the info with `path: '日向坂46/messages/34 金村 美玖/58 金村 美玖'`, `message_id: 10`), `GET /api/settings` (`{call_popup_enabled: true, language: 'en'}`), `GET /api/content/messages_by_path` (a voice id 10 with `media_file`, and `member: {id: 58, name: '金村 美玖', phone_image_local: '/img/p.jpg'}`), `GET /api/app-state/conversation` (`{}`), `GET /api/app-state/prefs` (`{}`), and record every `POST /api/call-popup/calls/:id/events` body. Render `<CallPopupApp preload={() => Promise.resolve()} />`, then `await act(() => window.__sakadeskCallPopup!.start(1))` and settle. Spy `persisted.setPref`, `persisted.setConv`, `persisted.setConvBeacon`, `persisted.flushNow`, and track any `PUT /api/read-states` request. Cases:
  1. start → info, settings, messages and read state fetched → `ringing` posted; the name `金村 美玖` renders (non-ASCII).
  2. Click Answer (`getByRole('button', {name: 'Answer'})`) → `answered` posted with `message_id: 10`; dispatch `ended` on the `call-audio` element → after `ENDED_HOLD_MS` (fake timers) `ended` posted.
  3. Decline → `declined`; another run, advance `RING_TIMEOUT_MS` → `timeout`.
  4. Member without images → `skipped` with `reason: 'no_photo'`, nothing rendered.
  5. Read state `{value: JSON.stringify({lastReadId: 10, readCount: 1, revealedIds: []})}` → `skipped` `already_read`.
  6. Info 404 → no POST at all, `call_popup_error` logged with `error_type: 'info_not_found'`; settings 500 → `error` posted with `error_type: 'settings_failed'` (likewise `messages_failed`, `read_state_failed`, and `info_failed` for an info 500).
  7. While ringing, `window.__sakadeskCallPopup!.cancel(1)` → the call unmounts (`queryByRole('button', {name: 'Answer'})` null) and **no** event is posted after the cancel (the hook's `cancelled` outcome is suppressed).
  8. A second `start(2)` after call 1 ended remounts a fresh hook (call 2's `ringing` posted).
  9. The inset halo (`.sd-call-halo--inset`) carries `data-phase="ringing"`, then `connected`.
  10. `vi.spyOn(ringtoneModule, 'getRingtone')` returning `{start, stop}` spies: `start` once on ringing, `stop` when it leaves ringing; `stop` on unmount while ringing.
  11. In every case above: `setPref`, `setConv`, `setConvBeacon`, `flushNow` were never called and no `PUT /api/read-states` happened.
  12. Every `clientLog` call carries `surface: 'popup'` except the app's own `call_popup_start`/`call_popup_error`.

- [ ] **Step 3: Run, expect FAIL** — `cd frontend && npx vitest run src/shell src/features/callPopup`.

- [ ] **Step 4: Implement route and language.** `callPopupRoute.ts` as in Interfaces. `language.ts`:

```ts
import i18n from '../i18n';
import { persisted } from '../core/persistence/persisted';

/**
 * The single ordered startup language decision, shared by App and the call
 * popup: 1) the persisted user choice, 2) the installer/settings.json language,
 * 3) the browser-detected default already applied by i18n/index.ts.
 * Call after persisted.hydratePrefs().
 */
export async function applyStartupLanguage(): Promise<void> {
    const lang = persisted.getPref<string | null>('language', null);
    if (lang) {
        await i18n.changeLanguage(lang);
        return;
    }
    try {
        const s = await (await fetch('/api/settings')).json();
        if (s?.language) await i18n.changeLanguage(s.language);
    } catch { /* keep browser-detected default */ }
}
```

In `App.tsx` replace the inline `.then(async () => { const lang = … })` step with `.then(() => applyStartupLanguage())`, keeping the comment that explains the order (moved into `language.ts`). `App.tos-hydration.test.tsx` and `App.integration.test.tsx` must still pass.

`main.tsx`:

```tsx
const root = ReactDOM.createRoot(document.getElementById('root')!);
if (isCallPopupView(window.location.search)) {
    // The bottom-right call popup: no auth, no App shell, no sync, no ui-state reporter.
    root.render(
        <React.StrictMode>
            <ErrorBoundary>
                <CallPopupApp />
            </ErrorBoundary>
        </React.StrictMode>,
    );
} else {
    root.render(/* the existing AuthProvider > ErrorBoundary > App tree, unchanged */);
}
```

- [ ] **Step 5: Implement the API helpers** in `callPopupApi.ts`:

```ts
export async function fetchCallInfo(callId: number): Promise<CallPopupInfo | null> {
    const res = await fetch(`/api/call-popup/calls/${callId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`call info ${res.status}`);
    return await res.json() as CallPopupInfo;
}

export function postCallEvent(callId: number, event: CallPopupEvent, extra: CallEventExtra = {}): void {
    const failed = () => clientLog('call_popup_error', { call_id: callId, error_type: 'event_post_failed' });
    try {
        fetch(`/api/call-popup/calls/${callId}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event, ...extra }),
        }).then(res => { if (!res.ok) failed(); }).catch(failed);
    } catch {
        failed();
    }
}
```

- [ ] **Step 6: Implement `CallPopupApp.tsx`.** Behaviour:
  - On mount: add class `sd-call-popup-doc` to `document.documentElement`, then install `window.__sakadeskCallPopup = { start, cancel }`; on unmount remove both.
  - `activeRef: { callId: number; cancelled: boolean } | null`; `post(callId, event, extra)` calls `postCallEvent` only when `activeRef.current?.callId === callId && !activeRef.current.cancelled`.
  - `start(callId)`: mark any previous active call cancelled; set a new active record; `setCall(null)`; `clientLog('call_popup_start', {call_id})`; `fetchCallInfo` (throw → `fail('info_failed')`; `null` → `clientLog('call_popup_error', {call_id, error_type: 'info_not_found'})` and return, nothing posted); `await persisted.hydratePrefs(); await applyStartupLanguage();`; then `Promise.allSettled` of `GET /api/settings`, `GET /api/content/messages_by_path?path=${encodeURIComponent(info.path)}&limit=0`, `persisted.getConversation(readStateKey(info.path))` (each `!res.ok` counts as rejected); the first rejection in that order → `fail('settings_failed' | 'messages_failed' | 'read_state_failed')`, where `fail(t)` logs `call_popup_error {call_id, error_type: t}` and posts `error {error_type: t}`. If the record was cancelled meanwhile, stop. Else `setCall({callId, info, settings, messages, member, readState: parseReadState(row)})`.
  - `cancel(callId)`: when it is the active call, mark it cancelled and `setCall(null)` (unmounts `PopupCall`); otherwise nothing.
  - Render `call ? <PopupCall key={call.callId} … post={(e, x) => post(call.callId, e, x)} preload={preload} /> : null`.
- [ ] **Step 7: Implement `PopupCall.tsx`:**

```tsx
export const PopupCall: React.FC<PopupCallProps> = ({ info, settings, messages, member, readState, post, preload = preloadAudio }) => {
    const { t } = useTranslation();
    const isUnread = useMemo(() => isUnreadIn(readState), [readState]);
    const freshFetch = useMemo(() => ({ seq: 1, dir: info.path }), [info.path]);
    const logContext = useMemo(() => parseReadStatePath(info.path), [info.path]);
    const revealMessage = useCallback((id: number) => post('answered', { message_id: id }), [post]);
    const scrollToMessage = useCallback(() => {}, []);
    const onOutcome = useCallback((o: CallOutcome) => {
        if (o.kind === 'skipped') post('skipped', { reason: o.reason });
        else post(o.kind);
    }, [post]);
    const call = useIncomingCall({
        service: info.service, chatDir: info.path, isGroupChat: info.is_group_chat,
        messages, member, name: formatName(member?.name ?? ''),
        enabled: settings.call_popup_enabled ?? true,   // the popup's own switch
        isUnread, freshFetch, revealMessage, scrollToMessage, logContext,
        surface: 'popup', onOutcome,
    }, preload);
    // ringtone: silent today; getRingtone() is the one swap point
    useEffect(() => {
        if (call.phase !== 'ringing') return;
        const ringtone = getRingtone();
        ringtone.start();
        return () => ringtone.stop();
    }, [call.phase]);
    // Talk timer: the same 250 ms tick as CallOverlay.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (call.phase !== 'connected') return;
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), 250);
        return () => clearInterval(id);
    }, [call.phase]);
    const theme = getServiceTheme(info.service);
    const light = theme.messages.headerStyle === 'light';
    const accent = light ? theme.messages.bubbleBorder : theme.modals.accentColor;
    // One always-mounted live region, as in CallOverlay. No Esc/Enter handler:
    // the window never receives keyboard focus.
    const liveText = call.phase === 'ringing' ? `${call.name} ${t('call.incoming')}`
        : call.phase === 'ended' ? t('call.ended') : '';
    const liveRegion = <div role="status" aria-live="polite" className="sr-only">{liveText}</div>;
    if (call.phase === 'idle' || !call.message) return liveRegion;
    const talkSeconds = call.talkStartedAt ? (now - call.talkStartedAt) / 1000 : 0;
    return (
        <>
            {liveRegion}
            <div className="sd-call-popup" style={{ '--sd-accent': accent, '--sd-rad': '0px' } as React.CSSProperties}>
                <CallScreen
                    phase={call.phase}
                    name={call.name}
                    groupLabel={getServiceDisplayName(info.service)}
                    photoUrl={call.photoUrl}
                    talkSeconds={talkSeconds}
                    answerStyle={light ? 'light' : 'solid'}
                    onAnswer={call.answer}
                    onDecline={call.decline}
                    onHangUp={call.hangUp}
                />
                <div aria-hidden className="sd-call-halo sd-call-halo--inset" data-phase={call.phase} />
                <CallAudio
                    key={call.message.id}
                    phase={call.phase}
                    audioUrl={call.audioUrl}
                    onPlaybackEnded={call.onPlaybackEnded}
                    onPlaybackError={call.onPlaybackError}
                />
            </div>
        </>
    );
};
```

`PopupCallProps`: `{ info: CallPopupInfo; settings: AppSettings; messages: Message[]; member: MemberInfo | undefined; readState: ReadState; post: (event: CallPopupEvent, extra?: CallEventExtra) => void; preload?: (url: string, signal?: AbortSignal) => Promise<void> }` (`AppSettings` from `features/messages/MessagesFeature`, which gains `call_popup_enabled` in Task 11 — until then read it as `(settings as { call_popup_enabled?: boolean }).call_popup_enabled`; Task 11 removes the cast).

- [ ] **Step 8: CSS.** `features/callPopup/callPopup.css` (imported by `CallPopupApp.tsx`):

```css
/* Bottom-right call popup (spec C3 §7.5). The window is the card; DWM draws its shadow. */
html.sd-call-popup-doc,
html.sd-call-popup-doc body,
html.sd-call-popup-doc #root { margin: 0; height: 100%; overflow: hidden; background: #0D0F14; }
.sd-call-popup { position: fixed; inset: 0; }
.sd-call-popup .sd-call-screen { box-shadow: none; }
```

Append to `features/incomingCall/callScreen.css` (above the `prefers-reduced-motion` block, so that rule — `.sd-call-halo { animation: none; }` — also stops it):

```css
/* Inset halo for the popup (B §2.5): drawn above the card, since an inset shadow under the photo is hidden. */
.sd-call-halo--inset { position: absolute; inset: 0; border-radius: var(--sd-rad); pointer-events: none; z-index: 2; }
.sd-call-halo--inset[data-phase="ringing"] {
  box-shadow:
    inset 0 0 0 2px color-mix(in srgb, var(--sd-accent, #7cc7e8) 75%, white),
    inset 0 0 36px 6px color-mix(in srgb, var(--sd-accent, #7cc7e8) 55%, transparent);
  animation: sd-call-breathe 2.4s ease-in-out infinite;
}
.sd-call-halo--inset[data-phase="connected"] {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sd-accent, #7cc7e8) 45%, transparent);
}
.sd-call-halo--inset[data-phase="ended"] { box-shadow: none; animation: none; }
```

`CallScreen.tsx` is not changed.

- [ ] **Step 9: Run, expect PASS** — `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint` (≤ 20 warnings, none new).

- [ ] **Step 10: Commit** — `feat(call-popup): render the bottom-right popup call view`:

```bash
git add frontend/src/shell frontend/src/features/callPopup frontend/src/features/incomingCall/callScreen.css \
  frontend/src/__tests__/mocks/handlers.ts
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): render the bottom-right popup call view' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 11: Settings toggle for the background call popup

**Spec:** §5 (frontend), §8.2, §11.3 "Settings" and "i18n".

**Files:**
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (`AppSettings.call_popup_enabled?: boolean` with a comment).
- Modify: `frontend/src/shell/components/SettingsModal.tsx` (toggle directly under B's incoming-call toggle; Reset adds `call_popup_enabled: true`).
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json` (`settings.callPopup`, `settings.callPopupDesc`).
- Modify: `frontend/src/features/callPopup/PopupCall.tsx` (drop the temporary cast from Task 10, if present).
- Create: `frontend/src/shell/components/SettingsModal.callPopup.test.tsx`, `frontend/src/i18n/callPopupSettings.test.ts`; extend `frontend/src/shell/components/SettingsModal.reset.test.tsx`.

**Interfaces:**
- Consumes: backend `call_popup_enabled` in `GET/POST /api/settings` (Task 6); `SettingsModal`'s `onSaveSettings(partial)` prop; the existing switch markup of the incoming-call toggle.
- Produces: `AppSettings.call_popup_enabled?: boolean` (read by `PopupCall` as `settings.call_popup_enabled ?? true`).

- [ ] **Step 1: Write the failing tests.** `callPopupSettings.test.ts` (copy the structure of `src/i18n/traySettings.test.ts`) asserting the exact five-locale strings from the Global Constraints table. `SettingsModal.callPopup.test.tsx` (copy `renderModal` from `SettingsModal.reset.test.tsx`): the switch named `Background call popup` renders `aria-checked="true"` when the field is missing; clicking it calls `onSaveSettings({ call_popup_enabled: false })`; with `call_popup_enabled: false` it is unchecked and clicking saves `true`; the description text renders; the toggle sits immediately after the `Incoming calls` switch in document order. In `SettingsModal.reset.test.tsx` add `call_popup_enabled: true` to the Reset expectation.

- [ ] **Step 2: Run, expect FAIL** — `cd frontend && npx vitest run src/shell/components src/i18n`.

- [ ] **Step 3: Implement.** `AppSettings`: `call_popup_enabled?: boolean;  // ring in the bottom-right popup when the app is in the background (default on)`. In `SettingsModal.tsx`: `const callPopupEnabled = appSettings.call_popup_enabled ?? true;`, a block copied from the incoming-call toggle with `{/* Background call popup (default on) */}`, `aria-checked={callPopupEnabled}`, `aria-label={t('settings.callPopup')}`, `onClick={() => onSaveSettings({ call_popup_enabled: !callPopupEnabled })}` and `{t('settings.callPopupDesc')}`, placed directly after the incoming-call block; add `call_popup_enabled: true,` to `handleResetDefaults`. Add the two keys to each locale's `settings` object (the first `"settings": {` block, next to `incomingCall`/`incomingCallDesc`) with the exact table values.

- [ ] **Step 4: Run, expect PASS** — `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`.

- [ ] **Step 5: Commit** — `feat(settings): add the background call popup toggle`:

```bash
git add frontend/src/features/messages/MessagesFeature.tsx frontend/src/shell/components \
  frontend/src/i18n frontend/src/features/callPopup/PopupCall.tsx
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(settings): add the background call popup toggle' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 12: The popup window host (no-activate, DPI-correct, reusable)

**Spec:** §6.1–6.5, §11.2 "`popup_rect`" and "`CallPopupWindow`", §12 risks.

**Files:**
- Create: `call_popup_window.py` (repo root, next to `desktop.py` and `tray.py`).
- Create: `tests/test_call_popup_window.py`.

**Interfaces:**
- Consumes (Task 4, `backend.services.desktop_bridge`): `HeardTarget(service: str, path: str, message_id: int)`; the host must satisfy `CallPopupHost` (`available() -> bool`, `ensure() -> bool`, `start(call_id: int) -> bool`, `reveal() -> bool`, `hide() -> None`, `cancel(call_id: int) -> None`, `deliver_heard(target) -> str` returning `"delivered" | "not_ready"`). Frontend globals: `window.__sakadeskCallPopup.start/cancel` (Task 10), `window.__sakadeskMarkVoiceHeard(payload) -> true` (Task 9, main window).
- Produces:

```python
TITLE = "SakaDesk Call"
BACKGROUND_COLOR = "#0D0F14"
POPUP_WIDTH_DIP = 300
POPUP_MARGIN_DIP = 12
POPUP_LOAD_TIMEOUT_S = 15.0
DESTROY_TIMEOUT_S = 3.0
MAX_CREATE_FAILURES = 2

@dataclass(frozen=True)
class Rect:
    left: int; top: int; right: int; bottom: int
    width: int   # property
    height: int  # property

def popup_rect(work_area: Rect, dpi: int) -> Rect

class CallPopupWindow:   # implements desktop_bridge.CallPopupHost
    def __init__(self, *, main_window: Any, url: str, is_quitting: Callable[[], bool],
                 create_window: Callable[..., Any] | None = None, user32: Any = None, dwmapi: Any = None,
                 work_area: Callable[[], Rect] | None = None, system_dpi: Callable[[], int] | None = None,
                 app_exit: Callable[[], None] | None = None,
                 load_timeout: float = POPUP_LOAD_TIMEOUT_S, destroy_timeout: float = DESTROY_TIMEOUT_S) -> None
    def available(self) -> bool
    def ensure(self) -> bool
    def start(self, call_id: int) -> bool
    def reveal(self) -> bool
    def hide(self) -> None
    def cancel(self, call_id: int) -> None
    def deliver_heard(self, target: HeardTarget) -> str
    def destroy(self, timeout: float | None = None) -> None
    def destroy_on_main_closed(self, *_args: Any) -> None
```

**Plan resolution (pywebview timing):** `webview.create_window` called from a worker thread after `webview.start` creates the form **synchronously** (WinForms `Invoke`), so a `before_show` handler subscribed after it returns would never run, and `loaded` may already be set. `ensure()` therefore applies `WS_EX_TOOLWINDOW` and the corner preference **right after `create_window` returns** (the form exists and is still hidden — the state the spec's `before_show` describes), subscribes `before_show` only as a fallback when no HWND is available yet, and waits with `window.events.loaded.wait(timeout)` (pywebview's `Event.wait`) instead of a handler.

- [ ] **Step 1: Write the failing tests** (`tests/test_call_popup_window.py`). Fakes:

```python
import threading

import pytest
from structlog.testing import capture_logs

import call_popup_window as cpw
from backend.services.desktop_bridge import HeardTarget


class FakeEvent:
    def __init__(self, auto: bool = False):
        self.handlers, self._e = [], threading.Event()
        if auto:
            self._e.set()

    def __iadd__(self, h):
        self.handlers.append(h)
        return self

    def set(self, *a):
        self._e.set()
        for h in list(self.handlers):
            h(*a)

    def is_set(self): return self._e.is_set()
    def wait(self, timeout=None): return self._e.wait(timeout)


class Events:
    def __init__(self, loads: bool):
        self.loaded, self.closed, self.before_show = FakeEvent(auto=loads), FakeEvent(), FakeEvent()


class FakeWindow:
    def __init__(self, *, loads=True, js_result=True, hwnd=0x1234, close_on_destroy=True):
        self.events, self.js, self.js_result = Events(loads), [], js_result
        self.hidden = self.shown = 0
        self.close_on_destroy = close_on_destroy
        self.native = type("N", (), {"Handle": hwnd})()

    def evaluate_js(self, script):
        self.js.append(script)
        return self.js_result

    def hide(self): self.hidden += 1
    def show(self): self.shown += 1
    def destroy(self):
        if self.close_on_destroy:
            self.events.closed.set()


class FakeUser32:
    def __init__(self): self.calls, self.exstyle = [], 0
    def GetWindowLongW(self, hwnd, idx): self.calls.append(("GetWindowLongW", hwnd, idx)); return self.exstyle
    def SetWindowLongW(self, hwnd, idx, val): self.calls.append(("SetWindowLongW", hwnd, idx, val)); return 0
    def ShowWindow(self, hwnd, cmd): self.calls.append(("ShowWindow", hwnd, cmd)); return 1
    def SetWindowPos(self, *a): self.calls.append(("SetWindowPos", *a)); return 1
    def IsWindowVisible(self, hwnd): return 1


class FakeDwm:
    def __init__(self, hr=0): self.calls, self.hr = [], hr
    def DwmSetWindowAttribute(self, hwnd, attr, ptr, size): self.calls.append((hwnd, attr, ptr._obj.value, size)); return self.hr


def make(windows, **kw):
    created, exits = [], []
    it = iter(windows)

    def create_window(**kwargs):
        created.append(kwargs)
        return next(it)

    w = cpw.CallPopupWindow(
        main_window=kw.pop("main", FakeWindow()), url="http://127.0.0.1:1/?view=call-popup",
        is_quitting=kw.pop("quitting", lambda: False), create_window=create_window,
        user32=kw.pop("user32", FakeUser32()), dwmapi=kw.pop("dwm", FakeDwm()),
        work_area=lambda: cpw.Rect(0, 0, 1920, 1040), system_dpi=lambda: 96,
        app_exit=lambda: exits.append(1), load_timeout=0.05, destroy_timeout=0.05, **kw)
    return w, created, exits
```

Cases:
- **`popup_rect`** parametrized over dpi `96, 120, 144, 192` and work areas `Rect(0,0,1920,1040)` (bottom taskbar), `Rect(0,40,1920,1080)` (top), `Rect(60,0,1920,1080)` (left), `Rect(0,0,1860,1080)` (right): `width == round(300*dpi/96)`, `abs(height - width*16/9) <= 0.5`, `right == area.right - round(12*dpi/96)`, `bottom == area.bottom - round(12*dpi/96)`. Exact spot checks: dpi 96 → `Rect(1608, 495, 1908, 1028)` for `Rect(0,0,1920,1040)`; dpi 144 → width 450, height 800.
- **`ensure`** creates once with exactly `title="SakaDesk Call"`, `url=…?view=call-popup`, `width=300`, `height=533`, `resizable=False`, `frameless=True`, `easy_drag=False`, `focus=False`, `on_top=True`, `hidden=True`, `shadow=True`, `background_color="#0D0F14"`; logs `call_popup_window action=created`; a second `ensure` creates nothing and logs `action=reused`.
- Styles: `SetWindowLongW(hwnd, -20, exstyle | 0x80)` and `DwmSetWindowAttribute(hwnd, 33, 2, 4)` are called during `ensure`; a failing `DwmSetWindowAttribute` (hr ≠ 0) is ignored (debug log) and `ensure` still returns `True`; with `native.Handle = None` at creation nothing is styled during `ensure`, and after the test sets `native.Handle = 0x1234` and fires `events.before_show.set()` the styles are applied by the fallback.
- A window that never loads → `False`, `action=create_failed` with `error_type="load_timeout"`, the half-made window is destroyed; two in a row → `action=disabled_after_failures`, `available()` false, a third `ensure` creates nothing. A success in between resets the counter. `create_window` raising → `create_failed` with the exception type.
- **`start`**: evaluates exactly `window.__sakadeskCallPopup ? (window.__sakadeskCallPopup.start(7), true) : false` and returns `True` only for a `True` result (`False`/`None` → `False`); while quitting → `False` without creating anything (logs `action=start_refused reason=quitting`); when unavailable → `False` (`reason=unavailable`).
- **Lost window**: firing the popup's `closed` while not quitting/destroying logs `action=lost`; the next `start` creates a new window.
- **`reveal`**: `ShowWindow(hwnd, 4)` then `SetWindowPos(hwnd, -1, x, y, w, h, 0x0010 | 0x0040)` with the `popup_rect` values; never `window.show()`; logs `call_popup_reveal` with `call_id` (from the last `start`), `dpi`, `width`, `height`, `visible=True`; no HWND or a raising `ShowWindow` → `False` and `call_popup_reveal_failed` (`error_type`).
- **`cancel(7)`**: evaluates `window.__sakadeskCallPopup && window.__sakadeskCallPopup.cancel(7)` then hides (hides even when `evaluate_js` raises).
- **`hide`**: calls `window.hide()`; no window → no-op.
- **`deliver_heard`**: on the **main** window, script `window.__sakadeskMarkVoiceHeard ? window.__sakadeskMarkVoiceHeard({...}) : null` with the JSON of `HeardTarget` (`ensure_ascii=False`, CJK kept); `True` → `"delivered"`, `None` → `"not_ready"`.
- **`destroy`**: success → `action=destroyed`, no `app_exit`; `close_on_destroy=False` → `action=destroy_failed` (`error_type="timeout"`) and `app_exit` called once; `window.destroy()` raising → `destroy_failed` + `app_exit`; no window → no-op; `destroy_on_main_closed()` delegates to `destroy()`.
- No log event contains the URL, the path or a name.

- [ ] **Step 2: Run, expect FAIL** — `uv run pytest tests/test_call_popup_window.py -q`.

- [ ] **Step 3: Implement `call_popup_window.py`.** Module docstring: what it is, that it is Windows-only with every Win32/pythonnet import lazy and every native seam injectable, that it logs codes and physical pixel sizes only. Key parts:

```python
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
SW_SHOWNOACTIVATE = 4
HWND_TOPMOST = -1
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
SPI_GETWORKAREA = 0x0030
DWMWA_WINDOW_CORNER_PREFERENCE = 33
DWMWCP_ROUND = 2
LOGPIXELSX = 88

_START_JS = "window.__sakadeskCallPopup ? (window.__sakadeskCallPopup.start({call_id}), true) : false"
_CANCEL_JS = "window.__sakadeskCallPopup && window.__sakadeskCallPopup.cancel({call_id})"
_HEARD_JS = "window.__sakadeskMarkVoiceHeard ? window.__sakadeskMarkVoiceHeard({payload}) : null"


def popup_rect(work_area: Rect, dpi: int) -> Rect:
    """Bottom-right rect in physical pixels: 300 DIP wide, 9:16, 12 DIP margin."""
    scale = dpi / 96
    w = round(POPUP_WIDTH_DIP * scale)
    h = round(w * 16 / 9)
    margin = round(POPUP_MARGIN_DIP * scale)
    x = work_area.right - w - margin
    y = work_area.bottom - h - margin
    return Rect(x, y, x + w, y + h)
```

Defaults (all lazy, only reached on Windows): `create_window` → `import webview; webview.create_window`; `user32` → `ctypes.WinDLL("user32")` with `argtypes`/`restype` declared for `GetWindowLongW`, `SetWindowLongW`, `ShowWindow`, `SetWindowPos`, `IsWindowVisible`, `SystemParametersInfoW`, `GetDpiForSystem` (when present), `GetDC`, `ReleaseDC` using `ctypes.wintypes` (HWND as `wintypes.HWND`, so 64-bit handles are not truncated); `dwmapi` → `ctypes.WinDLL("dwmapi")`; `work_area` → `SystemParametersInfoW(SPI_GETWORKAREA, 0, byref(wintypes.RECT()), 0)` (raises `OSError` on a zero return); `system_dpi` → `GetDpiForSystem()`, else `gdi32.GetDeviceCaps(GetDC(0), LOGPIXELSX)` with `ReleaseDC`; `app_exit` → `import clr; clr.AddReference("System.Windows.Forms"); import System.Windows.Forms as WinForms; WinForms.Application.Exit()` (guarded by try/except, logged by type). The HWND is read like `desktop._native_hwnd` (`window.native.Handle`, `ToInt64()` when present); keep a local helper — do not import `desktop`.

`ensure()` holds a `threading.Lock` (start, the preloader and the settings toggle can race), returns `False` when unavailable or quitting, reuses a loaded window, otherwise: `window = create_window(title=TITLE, url=self._url, width=300, height=533, resizable=False, frameless=True, easy_drag=False, focus=False, on_top=True, hidden=True, shadow=True, background_color=BACKGROUND_COLOR)`; `window.events.closed += self._on_closed`; apply styles now (or subscribe `before_show` when no HWND); `window.events.loaded.wait(self._load_timeout)`; on success reset failures and log `created`; on timeout/exception log `create_failed`, best-effort `window.destroy()`, count the failure and at `MAX_CREATE_FAILURES` set unavailable and log `disabled_after_failures`. `_apply_styles(hwnd)`: `SetWindowLongW(hwnd, GWL_EXSTYLE, GetWindowLongW(hwnd, GWL_EXSTYLE) | WS_EX_TOOLWINDOW)` (the style bit, never `Form.ShowInTaskbar`, which recreates the handle under WebView2), then `DwmSetWindowAttribute(hwnd, 33, byref(c_int(2)), sizeof(c_int))`, logging a non-zero HRESULT or an exception at debug (`call_popup_corner_skipped`) — Windows 10 has no rounded corners. `_on_closed(*_)` ignores closes while `self._destroying` or quitting; otherwise logs `action=lost` and forgets the window. `reveal`, `hide`, `cancel`, `deliver_heard`, `destroy`, `destroy_on_main_closed` exactly per the test list. Never call pywebview's `window.show()` (it activates the form). The two central methods:

```python
    def ensure(self) -> bool:
        with self._lock:
            if not self._available or self._is_quitting():
                return False
            if self._window is not None and self._window.events.loaded.is_set():
                logger.info("call_popup_window", action="reused")
                return True
            window = None
            try:
                window = self._create_window(
                    title=TITLE, url=self._url, width=300, height=533,  # placeholder; reveal sets the real rect
                    resizable=False, frameless=True, easy_drag=False, focus=False,
                    on_top=True, hidden=True, shadow=True, background_color=BACKGROUND_COLOR,
                )
                self._destroying = False
                window.events.closed += self._on_closed
                hwnd = _hwnd_of(window)
                if hwnd:
                    self._apply_styles(hwnd)
                else:
                    window.events.before_show += lambda *_: self._apply_styles(_hwnd_of(window))
                if not window.events.loaded.wait(self._load_timeout):
                    raise TimeoutError
            except Exception as e:
                error_type = "load_timeout" if isinstance(e, TimeoutError) else type(e).__name__
                logger.warning("call_popup_window", action="create_failed", error_type=error_type)
                if window is not None:
                    self._destroying = True
                    with contextlib.suppress(Exception):
                        window.destroy()
                self._window = None
                self._failures += 1
                if self._failures >= MAX_CREATE_FAILURES:
                    self._available = False
                    logger.warning("call_popup_window", action="disabled_after_failures")
                return False
            self._window, self._failures = window, 0
            logger.info("call_popup_window", action="created")
            return True

    def reveal(self) -> bool:
        try:
            hwnd = _hwnd_of(self._window) if self._window is not None else None
            if not hwnd:
                raise LookupError("no_hwnd")
            dpi = int(self._system_dpi())
            rect = popup_rect(self._work_area(), dpi)
            self._user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
            self._user32.SetWindowPos(hwnd, HWND_TOPMOST, rect.left, rect.top, rect.width, rect.height,
                                      SWP_NOACTIVATE | SWP_SHOWWINDOW)
            visible = bool(self._user32.IsWindowVisible(hwnd))
            logger.info("call_popup_reveal", call_id=self._call_id, dpi=dpi,
                        width=rect.width, height=rect.height, visible=visible)
            return visible
        except Exception as e:
            logger.warning("call_popup_reveal_failed", call_id=self._call_id, error_type=type(e).__name__)
            return False
```

`_hwnd_of(None)` must return `None` (guard the attribute access); `_apply_styles(None)` is a no-op.

- [ ] **Step 4: Run, expect PASS** — `uv run pytest tests/test_call_popup_window.py -q`; `uv run ruff check . && uv run ruff format --check .`.

- [ ] **Step 5: Commit** — `feat(call-popup): host the popup in a no-activate desktop window`:

```bash
git add call_popup_window.py tests/test_call_popup_window.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): host the popup in a no-activate desktop window' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 13: Wire the popup into the desktop app lifecycle

**Spec:** §6.2 "When", §6.5, §6.6 (registration), §11.2 "`desktop.py`".

**Files:**
- Modify: `desktop.py` (top-level import, two pure factories, wiring in `main()`).
- Create: `tests/test_desktop_call_popup.py`.

**Interfaces:**
- Consumes: Task 12 `CallPopupWindow(*, main_window, url, is_quitting, …)` with `.ensure() -> bool`, `.destroy(timeout=None) -> None`, `.destroy_on_main_closed(*_args) -> None`; Task 4 `desktop_bridge.set_call_popup_host(host | None)`; existing `settings_store.read_config_sync() -> dict` (raises when unreadable), `_mark_quitting()`, `_quitting`, `tray.stop()`, `HOST`, `port`, `window`.
- Produces (in `desktop.py`):

```python
def make_quit_handler(*, mark_quitting: Callable[[], None], stop_tray: Callable[[], None],
                      destroy_popup: Callable[[], None], destroy_window: Callable[[], None]) -> Callable[[], None]
    # order: mark_quitting → stop_tray → destroy_popup → destroy_window
def make_popup_preloader(ensure: Callable[[], bool], read_settings: Callable[[], dict]) -> Callable[..., None]
    # main-window `loaded` handler: runs ensure() once, only when call_popup_enabled (default True);
    # later loaded events are ignored; logs call_popup_window action=preload_skipped reason=disabled|settings_unreadable
```

- [ ] **Step 1: Write the failing tests** (`tests/test_desktop_call_popup.py`, `import desktop` works because `tests/conftest.py` mocks `webview`):
  - `make_quit_handler` calls the four callbacks in exactly that order (record into one list).
  - `make_popup_preloader`: setting on → `ensure` called once even when the handler fires three times (also from two threads at once); setting off → never called and logs `preload_skipped reason=disabled`; `read_settings` raising → never called, logs `preload_skipped reason=settings_unreadable`; missing key → treated as on; the handler accepts and ignores positional args (pywebview may pass the window).
  - Packaging guard: `desktop.py` imports `call_popup_window` at module top level (parse `desktop.py` with `ast` and find an `ImportFrom` with `module == "call_popup_window"` in `tree.body`), so PyInstaller traces it like `tray.py` (it only follows top-level imports).

- [ ] **Step 2: Run, expect FAIL** — `uv run pytest tests/test_desktop_call_popup.py -q`.

- [ ] **Step 3: Implement the factories** in `desktop.py` (near `make_open_window_handler`), with docstrings, `threading.Lock` + a once-flag in the preloader, and the logs above. Add `from call_popup_window import CallPopupWindow  # noqa: E402` next to `from tray import TrayController`.

- [ ] **Step 4: Wire `main()`.** After `show_window = make_open_window_handler(window, _focus_window)`:

```python
        # Background call popup (Windows only): one hidden window, created after
        # the main window first loads and reused for every call.
        popup: CallPopupWindow | None = None
        if platform.system() == "Windows":
            popup = CallPopupWindow(
                main_window=window,
                url=f"http://{HOST}:{port}/?view=call-popup",
                is_quitting=lambda: _quitting,
            )
            desktop_bridge.set_call_popup_host(popup)
            window.events.loaded += make_popup_preloader(popup.ensure, settings_store.read_config_sync)
            # Whatever closes the main window also closes the popup, so
            # webview.start() can return and the process (and its mutex) exits.
            window.events.closed += popup.destroy_on_main_closed

        on_quit = make_quit_handler(
            mark_quitting=_mark_quitting,
            stop_tray=lambda: tray.stop(),
            destroy_popup=popup.destroy if popup is not None else (lambda: None),
            destroy_window=window.destroy,
        )
```

and delete the old inline `def on_quit()`. Nothing else in the tray, closing handler or session-end guard changes (the popup has no `closing` handler, so a session end closes it).

- [ ] **Step 5: Run, expect PASS** — `uv run pytest tests -q` (all desktop tests, including `test_desktop_tray.py` and `test_desktop_lifecycle.py`), `uv run ruff check . && uv run ruff format --check .`.

- [ ] **Step 6: Commit** — `feat(call-popup): create, show and destroy the popup with the app`:

```bash
git add desktop.py tests/test_desktop_call_popup.py
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'feat(call-popup): create, show and destroy the popup with the app' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

### Task 14: Packaging check, CHANGELOG, README and spec sync

**Spec:** whole spec (Zero Drift), §6.1 (pywebview 5.3.2 pin), §11.4 (referenced, not run here).

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Added`, one entry).
- Modify: `README.md` (Features list and Project Structure).
- Modify: `docs/superpowers/specs/2026-11-04-c3-call-popup-design.md` (sync the plan resolutions so the spec matches the code).
- Verify only (no change expected): `tooling/build_windows.spec`, `build.ps1`, `tests/test_release_pin_guard.py`.

**Interfaces:**
- Consumes: everything from Tasks 1–13 (no code interfaces change here).
- Produces: documentation only.

- [ ] **Step 1: Packaging check.** Confirm, and write down in the task report:
  - `call_popup_window.py` is imported at the top of `desktop.py` (Task 13's AST test passes), so PyInstaller's `Analysis([desktop.py])` traces it; its Win32/pythonnet imports are lazy but come from `ctypes` (stdlib) and `clr`/`System.Windows.Forms`, which pywebview's WinForms backend already ships.
  - `backend/i18n/*/call_popup.json` is collected by `collect_all('backend')` (it already ships `notifications.json` and `tray.json`): `grep -n "'backend'" tooling/build_windows.spec`.
  - pywebview stays pinned to 5.3.2: `uv run pytest tests/test_release_pin_guard.py -q`.

  No `tooling/build_windows.spec` change is needed; if any check fails, fix it in this task and mention it in the commit body.

- [ ] **Step 2: CHANGELOG.** Under `## [Unreleased]` → `### Added`, add as the first bullet:

```markdown
- **Incoming calls while SakaDesk is in the background.** When a member sends
  a voice message while the app is hidden, minimised or behind other windows,
  a small call window rings at the bottom right of the screen; answer to play
  it there, or miss it and get a missed-call notification instead. It stays
  out of the way during fullscreen apps, presentations and Focus Assist, and
  you can turn it off in Settings.
```

(Bold lead-in + two sentences = 3 sentences; no code identifiers.)

- [ ] **Step 3: README.** Features: add `- **Incoming calls** — an unheard voice message rings like a phone call in the chat, or in a small bottom-right window while the app is in the background`. Project Structure: add `│   │   ├── call_popup.py    # Background call popup API` under `api/`, `│       ├── call_popup.py    # Call popup decisions and controller` and `│       ├── quiet_state.py   # Fullscreen / Focus Assist detection` under `services/`, and `├── call_popup_window.py     # Bottom-right call popup window (Windows)` next to `desktop.py`. Keep the tree's alignment.

- [ ] **Step 4: Spec sync (Zero Drift).** Edit the spec so it matches what was built:
  - §7.2: the read-state row is read with `GET /api/app-state/conversation?path=read_state_<path>` (`persisted.getConversation`), not `?key=`.
  - §4.4 `dispatch`: the controller enters `starting` (and arms the start watchdog) before awaiting `call_popup_start`, so the page's info request can never race it; `result=not_reserved` for a dispatch or abandon of a call that is no longer reserved.
  - §4.4 events: a failed reveal cancels the popup and sends the fallback toast (`call_popup_hide reason=reveal_failed`).
  - §6.2: styles are applied right after `create_window` returns (before_show only as a fallback), and `ensure` waits on `events.loaded.wait`.
  - §9.1: add `call_popup_window` actions `start_refused` and `preload_skipped`, and the debug events `call_popup_corner_skipped` and `call_popup_foreground_kept`.

- [ ] **Step 5: Full verification.**

```bash
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
uv run mypy backend
cd frontend && npx tsc --noEmit && npx vitest run && npm run lint
```

Expected: all green; eslint ≤ 20 warnings (19 before this branch; none added).

- [ ] **Step 6: Commit** — `docs(call-popup): add the changelog entry and sync the docs`:

```bash
git add CHANGELOG.md README.md docs/superpowers/specs/2026-11-04-c3-call-popup-design.md
MSG="$(mktemp)"
printf '%s\n\n%s\n' 'docs(call-popup): add the changelog entry and sync the docs' \
  'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' > "$MSG"
uv run git commit -F "$MSG"
```

---

## After the tasks (controller, not plan tasks)

1. **Whole-branch review** of `feat/c3-call-popup` against the spec (requesting-code-review), fix findings in follow-up commits.
2. **Manual Windows check** on the `C:\D\saka-verify` copy only (never the live archive), following the spec's **§11.4 checklist, steps 1–12** exactly: build with `build.ps1` (pywebview 5.3.2 pinned) or launch the dev exe with `-WorkingDirectory`; reuse the existing Windows login and never log in from WSL; create new messages with the C1 trim helper. Record the `quiet_state` codes seen for Windows 11 "Do not disturb" (§11.4 step 6) and whether the card ever renders blank on reveal (§12 "Native show vs WinForms state"). Restore the live app afterwards.

## Spec coverage map

| Spec | Task |
|---|---|
| §4.1 collector `newest_voice` | 1 |
| §4.2 candidate, gate, divert hook, planner order | 1, 3, 7 |
| §4.3 quiet state | 2 |
| §4.4 controller, toasts, heard delivery, watchdogs | 3 (`build_missed_plan`), 5 |
| §4.5 sync wiring, voice first, abort | 7 |
| §4.6 API, ui-state foreground, client-log | 6 |
| §5 setting (backend / frontend) | 6 / 11 |
| §6.1–6.5 window host, placement, lifecycle | 12, 13 |
| §6.6 bridge | 4 |
| §7.1 route, §7.2 popup app, §7.5 CSS | 10 |
| §7.3 hook additions, §7.6 ringtone | 8 |
| §7.4 read-state store, heard bridge | 9 |
| §8 strings | 3 (backend), 11 (frontend) |
| §9 logging | every task (Global Constraints list) |
| §11.1–11.3 tests | in each task |
| §11.4 manual | After the tasks |
