# Sub-project C3: Bottom-Right Incoming-Call Popup — Design

**Date:** 2026-11-04
**Repos touched:** `SakaDesk` only (backend, desktop layer and frontend). No pysaka change: pysaka already returns everything needed (`on_new_messages` rows and media queue items carrying `message_id`).
**Depends on:** C2 (`feat/c2-tray`), which sits on C1 (`feat/c1-notifications`). C3 branches from C2 (`feat/c3-call-popup`).
**Status:** The user's C3 decisions are final (memory `c-notify-tray-popup-decisions`, recorded 2026-11-04). The user is away and asked for C1–C3 to be built and tested.
**Programme:** C1 toasts → C2 tray + background sync → **C3 bottom-right call popup (this)**. C3 fills C1's `divert` hook and reuses B's `useIncomingCall`, `callDecision`, `CallScreen` and `CallAudio` unchanged in behaviour.

---

## 1. Goals

1. **Background call.** When a sync finds a new voice message from a 1:1 member while SakaDesk is not in the foreground (hidden in the tray, minimised or not focused), a small call window rings at the bottom right of the screen, above the taskbar.
2. **One call at a time, for the newest voice.** Every other chat with new messages gets its normal C1 toast.
3. **Answer in place.** The voice plays inside the popup, then the popup shows "call ended" and closes. The voice is heard, and the main window stays hidden.
4. **Missed or declined** → a "missed call" toast. The voice stays unheard, so B's in-app call rings when the user later opens that chat.
5. **Respect fullscreen and quiet states.** Under Focus Assist, a fullscreen app or presentation mode, the normal toast is sent instead.
6. **One source of truth.** The popup reads and writes the same stores as the main window (read state, settings, prefs). It never keeps its own copy.
7. **Logging.** Every decision, skip and failure is logged with ids, codes and counts only.

**Out of scope:**
- **A ringtone.** The call is silent. §7.6 reserves one swap point for a synthesized ringtone later.
- Calls for multi-member rooms (B rule).
- Moving or resizing the popup. Its position is fixed.
- Keyboard control of the popup. The popup never takes focus (§6.3), so Enter/Esc do not reach it; it is mouse-driven.
- Popups on monitors other than the primary one (the monitor that holds the taskbar's work area, §6.4).

---

## 2. Decisions (from the user)

| # | Decision |
|---|----------|
| when | A sync finds a new voice from a 1:1 member while the app is not in the foreground (C1 `ui_state.focused` is false). B's eligibility rules apply, through B's own implementation. |
| one | One popup, for the newest voice. Other chats get normal C1 toasts. |
| missed | Declined or unanswered → "missed call: X (+N more messages)" toast. The voice stays unheard; B rings later in the app. |
| answer | The voice plays in the popup → "call ended" → the popup closes → the voice is heard. The main window stays hidden. |
| window | Fixed bottom-right above the taskbar (work area), 300 px wide at 9:16, always on top, frameless, no backdrop. The card fills the window, with B's halo drawn inset. DPI-aware. Agreed design: "小窗C 不要背景 單純的通話畫面 / 保留光暈". |
| ringtone | Silent for now, with one code hook reserved for a synthesized ringtone. |
| setting | "Background call popup" (背景來電小窗), default **on**, separate from B's `incoming_call_enabled`. |
| quiet | Focus Assist, a fullscreen app or presentation mode → a toast instead of the popup. If the state cannot be detected → the popup. |
| timeout | B's ring duration (`RING_TIMEOUT_MS = 30_000`), reused by reusing B's hook. |

**Interpretations made in this spec** (where the decisions leave a detail open):
- **When "heard" is marked.** The voice is marked heard **when the user answers**, exactly as in B (§2.4 of B: "answering marks the voice heard immediately … hanging up early does not undo this"). By the time the popup closes the voice is heard, which satisfies the decision, and both call surfaces behave the same.
- **Notifications switched off** (decided by the user, 2026-11-04). The popup is governed **only** by its own switch (`call_popup_enabled`), not by `notifications_enabled`. With notifications off and the popup on, a qualifying voice still shows the popup. Only toasts are suppressed: the normal message toasts, the missed-call toast and the fallback toast (for a quiet state or a failed popup). Each suppression logs a skip reason. The divert hook therefore runs before C1's `disabled` skip (§4.2).
- **"New voice".** This means any new visible voice among the chat's new messages in this sync, not only the newest message. A member often sends a voice and then a text. The popup rings that voice (the newest new voice), which is also B's candidate for the chat.

---

## 3. Behaviour

### 3.1 Flow

```
sync phase 2 ─▶ collector (newest new voice per chat)
             ─▶ select candidate (newest voice over 1:1 chats) ─▶ gates (§4.2)
             ─▶ plan_toasts(divert=…)  ── candidate's plan diverted ──▶ controller.reserve()
                                        └─ every other plan ──────────▶ C1 toasts (send_planned)
sync phase 3 ─▶ the candidate's voice file is downloaded first (§4.5)
             ─▶ controller.dispatch()  (background task; sync continues)
                   ─▶ desktop: popup.start(call_id)        (window still hidden)
                   ─▶ popup page: GET call info, messages, read state, settings
                   ─▶ B's useIncomingCall decides + preloads ─▶ "ringing"
                   ─▶ backend: popup.reveal()              (bottom-right, top-most, no activation)
user: answer ─▶ "answered" ─▶ main window marks the voice heard (§7.4) ─▶ voice plays ─▶ ended hold ─▶ "ended" ─▶ hide
user: decline / 30 s ─▶ "declined"/"timeout" ─▶ hide ─▶ missed-call toast
```

### 3.2 Controller states

The backend `CallPopupController` (§4.4) owns the only record of the active popup call. It is process-wide, so one call exists at a time across all services.

```
idle ──reserve()──────────▶ reserved
reserved ──dispatch() ok──▶ starting           (popup page received start; window hidden)
reserved ──dispatch() refused / sync aborted──▶ idle   (fallback: the normal toast, except §4.4 exceptions)
reserved ──30 min watchdog──▶ idle              (safety net for a leaked reservation; fallback toast)
starting ──event ringing──▶ ringing            (window revealed)
starting ──skipped / error / cancelled / 20 s watchdog──▶ idle   (window hidden; fallback toast unless reason already_read)
ringing ──answered────────▶ connected          (heard delivered to the main window)
ringing ──declined / timeout / error / cancelled / 45 s watchdog──▶ idle   (window hidden; missed-call toast)
ringing ──main window focused──▶ idle          (popup cancelled; no toast; B rings in the app)
connected ──ended / error──▶ idle              (window hidden; no toast)
connected ──15 min watchdog──▶ idle            (popup cancelled; no toast)
reserved ──setting off──▶ idle                 (no popup yet; fallback toast)
starting / ringing / connected ──setting off──▶ idle   (popup cancelled; no toast)
any ──app exit──▶ idle                         (popup cancelled; no toast)
```

---

## 4. Backend

### 4.1 Collector: the newest new voice

`CollectedChat` (C1, `backend/services/new_message_collector.py`) gains `newest_voice: dict[str, Any] | None = None`: the newest **visible** new message with `type == "voice"`, using the same `newest_key` ordering (timestamp, then zero-padded id). Hidden rows never count. When several pysaka callbacks hit the same member in one run, the newer voice wins, as `newest` already does. Nothing else in C1 changes.

### 4.2 Candidate and gates (pure)

New module `backend/services/call_popup.py`.

```python
@dataclass(frozen=True)
class CallCandidate:
    group_id: str
    member_id: str
    message_id: str          # the voice's id, as a string (ToastPlan convention)
    member_dir: Path

def select_call_candidate(chats, *, service, member_count_for) -> CallCandidate | None
def divert_gate(*, candidate, enabled, host_available, ui_state, busy, quiet) -> str | None
```

**`select_call_candidate`.** Over the chats that have `newest_voice`, it drops rooms and returns the one whose voice has the largest `newest_key`. A chat is a room by the shared `chat_kind.is_group_chat(service, group_id, member_count_for(group_id))`, the same rule the planner and the content API use, so a one-member room listed in `GROUP_CHAT_IDS` never rings. With no such chat, it returns `None`.

**`divert_gate`.** It returns the skip reason, or `None` to divert. It checks in this order, and the first failure is the logged `reason`:

| # | condition | reason |
|---|-----------|--------|
| 1 | `call_popup_enabled` is on | `popup_disabled` |
| 2 | there is a candidate | `no_candidate` |
| 3 | a popup host is registered and available (§6.6) | `unavailable` |
| 4 | the app is not in the foreground (`not ui_state.focused`) | `foreground` |
| 5 | no popup call is active (controller not `idle`) | `busy` |
| 6 | the quiet state allows a popup (§4.3) | `quiet` (with `quiet_state`) |

The quiet state is read last, and only when gates 1–5 passed, because it is a Win32 call.

**What B's rules cover.** B's own `decideCall` runs in the popup on fresh data (§7.2). The backend gate only checks what B cannot know: the setting, the foreground, the quiet state and the one-at-a-time rule. B's checks (newest voice by timestamp, unread, photo, preload) are therefore never reimplemented in Python. If B says "don't ring", the popup reports `skipped` and the chat gets its normal toast (§4.4).

**The divert hook.** `make_call_divert(candidate, gate_reason, controller) -> Callable[[ToastPlan], bool]`:
- it returns `True` only for the plan whose `(group_id, member_id)` matches the candidate, when `plan.target.is_group_chat` is false, `gate_reason is None` and `controller.reserve(plan, candidate)` returns a `PendingCall`;
- `reserve` re-checks `busy` under the controller lock, so two services' syncs cannot both reserve. A lost race logs `call_popup_skip reason=busy`, and that plan stays a normal toast;
- for every other plan it returns `False`, so those plans are toasted exactly as in C1;
- the planner then records `Skip("diverted", …)` for the diverted plan, logged by C1's existing `notify_skip`.

**Planner order change (C1 `plan_toasts`, minimal).** C1 checks `disabled`, then `viewing`, then builds the plan and calls `divert`. The popup must not depend on `notifications_enabled`, so the divert check moves to the front:
1. build the chat's `ToastPlan` first (title, body, avatar; unchanged code, now also for chats that end up `disabled`, which costs one avatar directory listing per chat);
2. `divert(plan)` → `Skip("diverted")`;
3. `not enabled` → `Skip("disabled")`, exactly as today. C1's `notify_skip reason=disabled` breadcrumb is unchanged for every chat that is not diverted, including the candidate's chat when a gate refused the popup (for example `quiet`);
4. `viewing` → `Skip("viewing")`, as today.

Moving `divert` ahead of `viewing` changes no outcome: the hook only diverts when the app is not focused (gate 4), and `viewing` requires focus. The docstring's rule order and C1's rule-order test are updated to `diverted`, `disabled`, `viewing`.

### 4.3 Quiet state (`backend/services/quiet_state.py`, Windows only)

`query_quiet_state() -> QuietState(code: str, quiet: bool, quns: int, focus_assist: int)`. It never raises. Off Windows it returns `QuietState("unknown", False, -1, -1)`.

**Step 1: `shell32.SHQueryUserNotificationState(byref(c_int))`** (lazy `ctypes.windll`; a non-zero HRESULT counts as a failure):

| QUNS value | name | result |
|---|---|---|
| 1 | `QUNS_NOT_PRESENT` (locked, screen saver, another user) | quiet, `not_present`. Nobody would see the popup; a toast waits in Notification Center. |
| 2 | `QUNS_BUSY` (fullscreen app) | quiet, `fullscreen` |
| 3 | `QUNS_RUNNING_D3D_FULL_SCREEN` | quiet, `d3d_fullscreen` |
| 4 | `QUNS_PRESENTATION_MODE` | quiet, `presentation` |
| 5 | `QUNS_ACCEPTS_NOTIFICATIONS` | go to step 2 |
| 6 | `QUNS_QUIET_TIME` | quiet, `quiet_time` |
| 7 | `QUNS_APP` (fullscreen Store app) | quiet, `app_fullscreen` |
| other / call failed | — | go to step 2 (`quns=-1` on failure, logged `quiet_state_failed api=quns`) |

**Step 2: Focus Assist.** `SHQueryUserNotificationState` does not report Focus Assist, and Windows has no documented API for it. Read the shell's quiet-hours profile with `ntdll.NtQueryWnfStateData`:
- state name `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75` (a 64-bit value passed by pointer), no type id, no scope;
- a 4-byte buffer: `0` = off, `1` = priority only, `2` = alarms only.

| profile | result |
|---|---|
| 1 | quiet, `focus_assist_priority` |
| 2 | quiet, `focus_assist_alarms` |
| 0 | not quiet, `accepts` |
| other / NTSTATUS ≠ 0 / exception | not quiet, `unknown` (`focus_assist=-1`, logged `quiet_state_failed api=wnf`) |

An undetectable state therefore shows the popup, as the user decided. Toasts already follow Focus Assist natively, so the toast fallback respects it. Each query logs `quiet_state` (`quns`, `focus_assist`, `result`) at debug. Windows 11's "Do not disturb" is expected to use the same WNF profile; this is checked manually (§11.4) and the raw codes are logged, so a mismatch can be fixed from a bug report.

### 4.4 Controller (`CallPopupController`, in `call_popup.py`)

`get_call_popup_controller()` returns a process-wide singleton. Its methods run on the server loop. A `threading.Lock` guards the state, because `reserve` is called from inside `plan_toasts`, also on the loop, and the lock costs nothing. Everything it depends on is injected for tests: `send_toasts` (default C1 `send_planned`), the bridge functions (§6.6), `get_ui_state`, `load_config`, the string loader, `sleep` and the four watchdog durations.

```python
@dataclass(frozen=True)
class PendingCall:
    call_id: int              # process-wide counter, starting at 1
    plan: ToastPlan           # the built C1 plan (title/body/avatar/target/count)
    candidate: CallCandidate
```

| method | behaviour |
|---|---|
| `reserve(plan, candidate)` | `idle` → `reserved` (arming the reserved watchdog), returns `PendingCall`; otherwise `None`. Logs `call_popup_reserved` (`call_id`, `service`, `group_id`, `member_id`, `message_id`, `count`). |
| `dispatch(call_id)` | Only from `reserved`. It re-reads `get_ui_state()`. If the app is now focused, the call is released: when the user is viewing that chat there is no toast, because B rings there (`result=viewing`); otherwise the plan is sent as a normal toast (`result=foreground`). Otherwise it enters `starting` (with the start watchdog) and then awaits `bridge.call_popup_start(call_id)`; the page may fetch the call before `start` returns. When `start` returns `True` and the call is still current in `starting`, the start watchdog is re-armed so its 20 s count from that return (`result=started`). `False` while still `starting` → `idle` and a fallback toast (`result=start_failed`). If the call was cancelled, watchdogged or replaced during the await, nothing more happens (`result=superseded`, no toast). A call that is no longer reserved when `dispatch` runs (watchdog, cancel, shutdown) logs `result=not_reserved` and does nothing. Logs `call_popup_dispatch` (`call_id`, `result`). |
| `abandon(call_id, reason)` | Only from `reserved`, used by the sync's error paths (§4.5). `reason=sync_failed` → fallback toast; `reason=cancelled` → no toast (the app is shutting down or the sync was cancelled). A call that is no longer reserved is a no-op (`toast=skipped`). Logs `call_popup_abandoned` (`call_id`, `reason`, `toast`). |
| `info(call_id)` | The active call's `CallInfo` (§4.6) when `call_id` is current and the state is `starting`/`ringing`/`connected`; else `None`. |
| `on_event(call_id, event)` | Applies the table below. Returns `False` for a stale event (unknown call, wrong phase, or an `answered` whose `message_id` differs from the candidate), logged as `call_popup_event_stale` (`call_id`, `call_event`, `reason`). |
| `on_foreground()` | Called when the main window reports `focused=true` (§4.6). `starting`/`ringing` → `bridge.call_popup_cancel(call_id)`, `idle`, no toast. `connected` → left alone: an answered call is not cut off (debug `call_popup_foreground_kept`). `reserved` → nothing, because `dispatch` re-checks. Logs `call_popup_cancel reason=foreground`. |
| `cancel(reason)` | Setting turned off (`disabled`). Any active phase → popup cancelled, `idle`, no toast. `reserved` → `idle` and the diverted plan goes out as a fallback toast (`call_popup_toast kind=fallback reason=disabled`, subject to the notifications-off suppression): no popup exists yet, and the user turned off only the popup, so the chat keeps its notification. The sync's later `dispatch` logs `result=not_reserved`. Logs `call_popup_cancel` (`call_id`, `reason`, `phase`). |
| `shutdown()` | From lifespan shutdown, before the scheduler stop. It cancels the watchdogs (including one already firing, so no toast follows shutdown) and goes to `idle` with no toast (`call_popup_cancel reason=app_exit` when a call was active). |

**Events from the popup** (`POST /api/call-popup/calls/{call_id}/events`, §4.6):

| event (fields) | valid in | effect |
|---|---|---|
| `ringing` | `starting` | → `ringing` (ring watchdog), then `bridge.call_popup_reveal(call_id)`. A failed reveal, while the call is still `ringing`, cancels the popup (`call_popup_cancel`), → `idle`, logs `call_popup_hide reason=reveal_failed` and sends the fallback toast (`reason=reveal_failed`). A successful reveal is re-checked: when the call is no longer current in `ringing` or `connected` (cancelled, watchdogged, declined or ended during the await, whose hide may have landed before the window was shown), it hides again (`bridge.call_popup_hide(call_id)`, `call_popup_hide reason=superseded`) |
| `skipped` (`reason`) | `starting` | → `idle`, window stays hidden. `reason=already_read` → no toast (the voice was heard meanwhile); any other reason → fallback toast |
| `answered` (`message_id`) | `ringing` | → `connected`; `deliver_heard` (below) as a background task; connected watchdog |
| `declined` | `ringing` | hide, → `idle`, missed-call toast (`reason=declined`) |
| `timeout` | `ringing` | hide, → `idle`, missed-call toast (`reason=timeout`) |
| `ended` (`reason` `played`/`hung_up`) | `connected` | hide, → `idle`; the reason (how the call ended) is logged in `call_popup_event` |
| `error` (`error_type`) / `cancelled` | `starting` | hide, → `idle`, fallback toast (`reason` = the event) |
| `error` / `cancelled` | `ringing` | hide, → `idle`, missed-call toast (`reason` = the event: `error` or `cancelled`) |
| `error` / `cancelled` | `connected` | hide, → `idle` |

The host reports a popup window lost during a call (§6.5) as `error` with `error_type=window_lost`, so the call ends at once with the row above for its phase instead of waiting for its watchdog.

`reason` is a code from the known set (B's skip reasons `disabled`, `group_chat`, `no_voice`, `already_read`, `no_photo`, `dismissed_this_visit`, `call_active`, plus `superseded`, `media_unavailable`, `popup_active`, `played`, `hung_up`); any other well-formed value reaches the controller as `other`, so only a fixed vocabulary is logged (§4.6). Each accepted event logs `call_popup_event` (`call_id`, `call_event`, `phase` before, plus `reason` / `error_type` when given). Each hide logs `call_popup_hide` (`call_id`, `reason`).

**Watchdogs** (asyncio tasks, cancelled on every transition):
- `RESERVED_WATCHDOG_S = 1800`: a safety net, not a timeout of normal operation. A reservation lives while its sync downloads media, and a sync with a big media queue can legitimately take long, hence 30 min. Every sync path hands the reservation back (`dispatch` or `abandon`), so this only fires when a future leak would otherwise leave the controller `busy` for the life of the process. It is armed in `reserve` and cancelled by `dispatch`, `abandon`, `cancel` and `shutdown`. On expiry it does **not** call the bridge (no popup exists yet): it behaves like `abandon(reason="watchdog")` and sends the original plan as a fallback toast (`call_popup_toast reason=watchdog`), subject to the notifications-off suppression. A sync that wakes up later finds the call gone (`dispatch` logs `result=not_reserved`; `abandon` is a no-op);
- `START_WATCHDOG_S = 20`: B's `PRELOAD_TIMEOUT_MS` (10 s) plus 10 s for the page fetches. It is armed when `starting` is entered (before `call_popup_start`, so the page can fetch) and re-armed when `call_popup_start` returns `True`, so a slow start (up to `BRIDGE_START_TIMEOUT_S`, §6.6) does not use up the page's budget;
- `RING_WATCHDOG_S = 45`: B's `RING_TIMEOUT_MS` (30 s) plus 15 s of slack. A test keeps it above B's constant (§11.1);
- `CONNECTED_WATCHDOG_S = 900`.

On expiry (except `reserved`, see above) the controller cancels the popup (`bridge.call_popup_cancel`) and applies the row of the `error` event for that phase. It logs `call_popup_watchdog` (`call_id`, `phase`, where `phase=reserved` marks a leaked reservation).

**Toasts.** Both go through C1's `send_planned([plan])`, so the notifier, the tag `"{group_id}:{member_id}"`, the avatar, the click-to-open-chat closure (`on_activated` → `desktop_bridge.open_chat(plan.target)`) and the `notify_sent` / `notify_failed` logging are C1's own.
- **Fallback toast:** the original `PendingCall.plan`, unchanged.
- **Missed-call toast:** `build_missed_plan(plan, strings) -> ToastPlan` (pure) returns `dataclasses.replace(plan, title=strings["missed_title"].format(name=plan.title), body=…)`, where the body is `strings["missed_more"].format(n=plan.count - 1)` when `plan.count > 1`, else `strings["missed_body"]`. The strings are `get_strings("call_popup", resolve_ui_language(config))`, read when the toast is sent. `notifications_hide_content` does not change this toast: the popup already showed the caller's name on screen, and the title carries no message content.
- **Notifications switch.** Before sending either toast, the controller reads `notifications_enabled` (via `load_config`, at send time). When it is off, nothing is sent and `call_popup_toast_skip` (`call_id`, `kind`, `reason=notifications_disabled`) is logged. The call's own state change happens as usual.
- Both log `call_popup_toast` (`call_id`, `kind=fallback|missed`, `reason`, `sent`) when a toast is attempted.

**Heard delivery (`deliver_heard`).** It calls `bridge.call_popup_deliver_heard(HeardTarget(service, path, message_id))` up to 3 times, 1 s apart, while the result is "not ready" or an error. It logs `call_popup_heard` (`call_id`, `message_id`, `delivered`, `attempts`, and `reason` = `not_ready|error|no_host` when not delivered). When it is not delivered, the voice stays unheard and B rings in the app later: a degraded but safe outcome.

### 4.5 Sync wiring (`SyncService`)

1. **`_notify_new_messages`** (C1):
   - before `plan_toasts`, call `select_call_candidate`, then `divert_gate`, with `enabled=app_settings.get("call_popup_enabled", True)`, `host_available=desktop_bridge.call_popup_available()`, the same `ui_state` snapshot passed to the planner, `busy=controller.busy` and a lazy quiet thunk evaluated by the gate only at step 6;
   - log `call_popup_skip` (`service`, `reason`, plus `group_id`/`member_id`/`message_id` when there is a candidate, and `quiet_state` when the reason is `quiet`) whenever the reason is not `None`. `no_candidate` is logged only when the collector has at least one chat;
   - pass `make_call_divert(...)` as `divert`;
   - return the reserved `PendingCall | None` (captured by the hook) to the sync run that called it, which keeps it with a `dispatched = False` flag.
2. **Voice first (phase 3).** If a call is reserved, then before the 50-item chunk loop:
   - remove from `media_queue` the items whose `str(item["message_id"]) == candidate.message_id` and whose `item.get("member_dir") == candidate.member_dir`;
   - download them with one `self.manager.process_media_queue(session, voice_items, progress_callback=…)` call, merge the returned dimensions into `all_dimensions_by_dir` and add the successes to `total_successed`, so the progress and the metadata update are unchanged;
   - log `call_popup_voice_first` (`call_id`, `items`, `downloaded`).

   When no item matches (the file is already on disk), this step is a no-op. Either way, `track_background_task(controller.dispatch(call_id), name="call_popup_dispatch")` follows and `dispatched = True`. The sync never waits on the popup.
3. **Aborted syncs.** In the sync's `finally`, a reserved call that was never dispatched calls `controller.abandon(call_id, reason="cancelled")` on `CancelledError`, or `reason="sync_failed"` on any other exception (including `SessionExpiredError`/`RefreshFailedError`). `abandon` sends its toast through `track_background_task`, so the `finally` never awaits. The call goes through a guard that catches any `Exception` from `abandon` and logs `call_popup_abandon_failed` (`call_id`, `reason`, `error_type`), so a failing `abandon` can never mask the sync's own exception or skip the `running`/`_task` bookkeeping that follows in the `finally`.
   `_notify_new_messages` also owns the one window where the reservation exists but the sync does not hold it yet: `reserve` runs inside `plan_toasts`, and the toast send is awaited afterwards. If that await is cancelled, `_notify_new_messages` abandons the call itself with `reason="cancelled"` (through the same guard) and re-raises `CancelledError`.
4. **Why voice first.** pysaka writes `media_file` when the download is *queued*, and C1 plans toasts before phase 3. Without this step the popup's preload (B condition 8) would fail on every fresh voice. Downloading one file first rings within seconds, instead of after every picture and video of the sync. This is SakaDesk-side queue ordering; pysaka is untouched.

### 4.6 API (`backend/api/call_popup.py`)

All ids follow C1's ui-state rules (`^[0-9]{1,12}$` strings, or `StrictInt` for `call_id`/`message_id`), and codes (`reason`, `error_type`) follow `^[a-z0-9_]{1,40}$`. A violation returns 422 and logs nothing. A well-formed `reason` outside the known set of §4.4 is passed on as `other`.

- **`GET /api/call-popup/calls/{call_id}`** → `200 {call_id, service, path, is_group_chat, group_id, member_id, message_id}` from `controller.info`, else `404`. `path` is `plan.target.path`, the frontend's chat path. It is returned to the popup page and never logged.
- **`POST /api/call-popup/calls/{call_id}/events`**, body `{event: "ringing"|"skipped"|"answered"|"declined"|"timeout"|"ended"|"cancelled"|"error", reason?: code, error_type?: code, message_id?: int}` → `204`, or `409` when `on_event` returns `False`.
- **`GET /api/call-popup/active?service=&group_id=&member_id=&message_id=`** → `200 {active: bool}`: true when the controller is not `idle` and its candidate matches. B in the main window calls it before ringing (§7.3).
- **`POST /api/ui-state`** (C1): after storing the state, when `focused` is true it runs `controller.on_foreground()` as a tracked background task (`call_popup_foreground`) and answers 204 at once: the cancel waits on the popup host (up to `BRIDGE_TIMEOUT_S`), and the report must stay fast. An exception there logs `call_popup_foreground_failed` (`error_type`).
- **`POST /api/client-log`** (B): whitelist additions in §9.2.

---

## 5. Setting

| key | default | meaning |
|---|---|---|
| `call_popup_enabled` | `True` | ring in the bottom-right popup when the app is in the background |

- **Backend `backend/api/settings.py`:** the same pattern as `incoming_call_enabled` (`_SETTINGS_DEFAULTS`, the response model, `SettingsUpdate`, `_apply`).
- **A changed value** in `POST /api/settings`:
  - turning it on calls `desktop_bridge.call_popup_ensure()`, which creates the window if it is absent (in a thread; it never blocks the response);
  - turning it off calls `controller.cancel(reason="disabled")`. The window is kept until exit; it is simply not created at the next start.
- **Frontend:** `AppSettings.call_popup_enabled?: boolean`. A toggle in `SettingsModal` directly under B's incoming-call toggle, with the same switch markup and a one-line description. Reset to defaults sets `call_popup_enabled: true`.

---

## 6. Desktop (`call_popup_window.py`, next to `desktop.py` and `tray.py`)

### 6.1 pywebview 5.3.2 facts this design relies on

Checked in the 5.3.2 wheel (`webview/platforms/winforms.py`, `edgechromium.py`, `event.py`). CI and `build.ps1` both pin 5.3.2.

- **Multiple windows.** `webview.create_window` after `start` is supported: a non-master window waits for `_main_window_created` and is created through `Invoke` on the GUI thread. Every window shares the main window's `storage_path`, so the popup uses the same WebView2 browser process (one extra renderer) and the same origin storage.
- **Exit rule.** `BrowserForm.on_close` calls `Application.Exit()` only when **no** window is left (`len(BrowserView.instances) == 0`). A live popup, even hidden, would keep `webview.start()` from returning after the main window closes, so the process (and the installer's mutex) would stay alive. §6.5 handles this.
- **Options.**
  - `frameless=True` sets `FormBorderStyle.None`;
  - `on_top=True` sets `TopMost`;
  - `easy_drag` only injects drag JS for frameless windows;
  - `shadow=True` calls `ExtendFrameIntoClientArea` plus `DwmSetWindowAttribute(…, 2, 2)` (DWM shadow on a frameless window);
  - `focus=False` adds `WS_EX_NOACTIVATE` (`0x08000000`) in `__init__` and again on every `Activated`;
  - `hidden=True` creates the form by `Opacity=0; Show(); Hide(); Opacity=1`.
- **Focus.**
  - pywebview's `window.show()` calls `Form.Show()` **and `Activate()`**, which would steal focus, so the popup never uses it;
  - `on_shown` calls `webview.Focus()` once, during the hidden create;
  - focus is controlled by `focus=False` plus a native no-activate show (§6.3).
- **DPI.**
  - `SetProcessDPIAware()` is called for the master window, so the process is **system-DPI aware** and every Win32 coordinate is in physical pixels at the system DPI;
  - the initial `Location` is used verbatim (physical px);
  - `move()` multiplies by `GetScaleFactorForDevice(0)` (logical px);
  - WinForms `AutoScaleMode.Dpi` may rescale the form once at creation.

  The popup therefore never relies on pywebview's size or position. It sets both itself, in physical pixels, every time it is revealed (§6.4).
- **Events.** `closing` runs handlers synchronously (its return value can cancel). `loaded`, `shown`, `closed` and `before_show` run handlers in new threads. `evaluate_js` blocks until `loaded` and then on the GUI thread.

### 6.2 Creation: pre-created hidden, then reused

**Decision.** Create the popup once, hidden, then show, hide and reuse it for every call. Do not create and destroy it per call.

**Why.**
- A new WebView2 costs about 1–2 s to start, plus the bundle load.
- The hidden-create path briefly calls `Form.Show()` and `webview.Focus()`, which can disturb the foreground app. Paying that once, when SakaDesk itself starts (a normal launch is in the foreground anyway, and an autostart happens at sign-in), is far better than paying it at every call while the user is in another app.
- The cost is one idle renderer process holding a tiny page.

**When.**
- Once the main window's `loaded` event first fires, a thread runs `popup.ensure()` if `call_popup_enabled` is on (read with `settings_store.read_config_sync()`). A once-flag ignores later `loaded` events.
- If the setting is turned on later, `call_popup_ensure()` creates it then (§5).
- If the window was lost (its `closed` fired while the app is not quitting: `call_popup_window action=lost`), `start()` recreates it on demand, waiting for it to load.

**`create_window` arguments:**

```python
webview.create_window(
    title="SakaDesk Call",      # never "SakaDesk": _focus_window falls back to FindWindowW(None, "SakaDesk")
    url=f"http://{HOST}:{port}/?view=call-popup",
    width=300, height=533,      # placeholder; real geometry is set at reveal (§6.4)
    resizable=False, frameless=True, easy_drag=False,
    focus=False, on_top=True, hidden=True, shadow=True,
    background_color="#0D0F14", # dark before the page paints
)
```

- **Styles** (the form and its HWND exist; the window is still hidden). pywebview 5.3.2 creates the form synchronously after `start`, so they are applied right after `create_window` returns; `before_show` is only the fallback when no HWND exists yet:
  - add `WS_EX_TOOLWINDOW` (`0x80`) to `GWL_EXSTYLE` with `SetWindowLongW`, so the popup has no taskbar button and is not in Alt+Tab. Use the style bit, not `Form.ShowInTaskbar`, which recreates the handle under the WebView2 control;
  - set `DWMWA_WINDOW_CORNER_PREFERENCE` (33) to `DWMWCP_ROUND` (2), giving Windows 11 rounded corners; on Windows 10 the call fails and is ignored (debug log).
- **`ensure()`** waits up to `POPUP_LOAD_TIMEOUT_S = 15` on `events.loaded.wait`. A cached window is reused only when it is loaded and not closed; otherwise it is dropped (`action=lost`) and recreated. A creation that fails (`error_type` = `load_timeout`, `closed` or the exception type) destroys the half-made window. It logs `call_popup_window` with `action=created|reused|create_failed` and `error_type`. `start()` refuses while quitting, while unavailable, or for a call already hidden or cancelled (`action=start_refused`, `reason=quitting|unavailable|ended`, §6.3).
- **Two failed creations in a row** set `available = False` for the rest of the process (`action=disabled_after_failures`), so every later call goes straight to a toast instead of waiting 15 s each time.

### 6.3 Show without stealing focus

- **Reveal** (on `ringing`), in this order: `SetWindowPos(hwnd, 0, x, y, w, h, SWP_NOZORDER|SWP_NOACTIVATE)` (move and size while still hidden, so the first paint is at the right spot), `ShowWindow(hwnd, SW_SHOWNOACTIVATE=4)` (its `WM_SHOWWINDOW` keeps WinForms `Visible` in sync for `Form.Hide`), then `SetWindowPos(hwnd, HWND_TOPMOST=-1, 0, 0, 0, 0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)`. A system DPI of 0 or less is a `call_popup_reveal_failed` with `error_type=bad_dpi`. None of the calls activates the window, so typing in another app continues uninterrupted. Clicks still reach the WebView2 content; `WS_EX_NOACTIVATE` keeps the popup from becoming the foreground window when it is clicked.
- **Hide:** `window.hide()` (pywebview `Form.Hide`, which never activates anything).
- **Cancel:** `evaluate_js("window.__sakadeskCallPopup && window.__sakadeskCallPopup.cancel(<call_id>)")`, then hide.
- **Ordering and call scope.** `start`, `reveal`, `hide` and `cancel` run on worker threads that are otherwise unordered, so one host lock serializes them, and each takes the call id. The host remembers the started call (`start`) and the newest call that was hidden or cancelled (ids only grow):
  - `hide(call_id)` / `cancel(call_id)` mark that call ended, even with no window, so a `start` still in flight for it is refused (`action=start_refused reason=ended`). When a newer call already owns the window they do nothing (debug `call_popup_hide_skipped reason=stale_call`), so a late hide never hides the next call;
  - `reveal(call_id)` does nothing and returns `False` unless `call_id` is the started call and not ended (`call_popup_reveal_skipped reason=stale_call`), so a cancel that won the race is never undone. The controller's re-check after the reveal (§4.4) covers the other order.
- **Logging:** reveal logs `call_popup_reveal` (`call_id`, `dpi`, `width`, `height`, `visible` = `IsWindowVisible` afterwards) or `call_popup_reveal_failed` (`error_type`). Physical sizes are not personal data.

### 6.4 Placement and DPI (pure helper)

`popup_rect(work_area: Rect, dpi: int) -> Rect`, all in physical pixels:

```
scale  = dpi / 96
w      = round(POPUP_WIDTH_DIP * scale)        # POPUP_WIDTH_DIP = 300
h      = round(w * 16 / 9)                     # 9:16
margin = round(POPUP_MARGIN_DIP * scale)       # POPUP_MARGIN_DIP = 12
x      = work_area.right  - w - margin
y      = work_area.bottom - h - margin
```

- `work_area` comes from `SystemParametersInfoW(SPI_GETWORKAREA=0x30)`: the primary monitor's desktop minus the taskbar, so the popup sits above a bottom taskbar and beside a side one.
- `dpi` comes from `GetDpiForSystem()` (Windows 10 1607+), else `GetDeviceCaps(GetDC(0), LOGPIXELSX)`.
- Both are re-read at every reveal, so a moved taskbar or a changed resolution is picked up.
- WebView2 rasterises at the same system scale, so the page always sees a **300 × 533 CSS px** viewport and B's container queries resolve the same at every DPI. At 300 px the ringing layout is stacked (below 400 px) and the button labels stay visible (above 230 px).

### 6.5 Lifecycle: quit, session end and the main window

- **Quit (tray).** `on_quit` becomes `_mark_quitting(); tray.stop(); popup.destroy(); window.destroy()`.
- **Catch-all.** `window.events.closed += popup.destroy_on_main_closed`. Whatever closes the main window (Quit, ✕ with close-to-tray off, the C2 session-end guard letting a shutdown through, a crash path that reaches `closed`), the popup is destroyed too, so `instances` reaches 0 and `webview.start()` returns into the existing cleanup.
- **Destroy.** `popup.destroy(timeout=3.0)` runs `window.destroy()` on a daemon thread (it blocks on the GUI thread, so a hung GUI thread must not block the caller) and waits at most `timeout` for the popup's `closed` event. Destroy is idempotent: a second call (tray Quit plus the main window's `closed`) returns at once (debug `action=destroy_skipped`). The host is unavailable afterwards, and a window that finished loading after `destroy` ran is closed too. If `closed` does not arrive in time, it logs `call_popup_window action=destroy_failed` and calls `System.Windows.Forms.Application.Exit()` (lazy import), so the process can never be kept alive by the popup. It logs `action=destroyed` on success.
- **Session end.** Windows sends the session-end close to every top-level form. The popup has no `closing` handler that cancels, so it closes. The main window is handled by C2's guard.
- **While quitting.** `popup.start()` returns `False` when `_quitting` is set, and the backend's `controller.shutdown()` (lifespan) drops any active call without a toast.
- **The popup's own close.** It has no ✕ (frameless), never activates (so no Alt+F4) and has no taskbar button. Its `closed` firing while not quitting means the window was lost, and the next `start()` recreates it. When a call still holds the window (started, not yet hidden or cancelled), the host logs `call_popup_window action=lost call_id=…` and reports it through its injectable `report_lost` seam, whose default schedules `controller.on_event(call_id, CallEvent("error", error_type="window_lost"))` on the server loop (`run_on_server_loop`). The call then ends now (fallback toast when starting, missed-call toast when ringing) rather than after its watchdog (45 s ringing, 900 s connected, every new voice `busy` meanwhile). A failing report logs `call_popup_lost_report_failed` (`call_id`, `error_type`). The handler reads the call id without the host lock, so a host call blocked on that window cannot stall pywebview's event thread.

### 6.6 Bridge (`backend/services/desktop_bridge.py`)

The same registration pattern as C1/C2. `desktop.py` registers a host after creating the popup controller object, on Windows only:

```python
class CallPopupHost(Protocol):
    def available(self) -> bool: ...
    def ensure(self) -> bool: ...
    def start(self, call_id: int) -> bool: ...        # True when __sakadeskCallPopup.start ran
    def reveal(self, call_id: int) -> bool: ...     # False for a stale call id (§6.3)
    def hide(self, call_id: int) -> None: ...       # a no-op when a newer call owns the window
    def cancel(self, call_id: int) -> None: ...
    def deliver_heard(self, target: HeardTarget) -> str: ...   # "delivered" | "not_ready"

def set_call_popup_host(host: CallPopupHost | None) -> None
def call_popup_available() -> bool
async def call_popup_start(call_id: int) -> bool
async def call_popup_reveal(call_id: int) -> bool
async def call_popup_hide(call_id: int) -> None
async def call_popup_cancel(call_id: int) -> None
async def call_popup_deliver_heard(target: HeardTarget) -> str   # adds "error" | "no_host"
def call_popup_ensure() -> None                                     # fire-and-forget thread
```

- The host methods block (`evaluate_js`, `Invoke`), so every async bridge function runs them with `asyncio.wait_for(loop.run_in_executor(<host executor>, ...), timeout)`: `BRIDGE_TIMEOUT_S = 10`, except `call_popup_start`, which uses `BRIDGE_START_TIMEOUT_S = 20` because it may recreate a lost window (`POPUP_LOAD_TIMEOUT_S = 15`). The server loop never blocks on the GUI thread.
- **Own executor.** Host calls run on a dedicated `ThreadPoolExecutor(max_workers=HOST_EXECUTOR_WORKERS=2, thread_name_prefix="call_popup_host")`, created on first use, never on the loop's default executor. A timed-out call is abandoned but its thread stays blocked on the GUI (pywebview's `evaluate_js` / `Invoke` have no timeout); on the shared default pool a wedged popup would slowly starve the backend's many `to_thread` users (sync, read-state I/O). On its own pool it can hold at most two threads, and later calls queue and time out. The lifespan shutdown calls `shutdown_call_popup_executor()` after `controller.shutdown()`: `shutdown(wait=False, cancel_futures=True)`, so app exit never waits on a blocked call.
- **Timeout breaker.** `MAX_HOST_TIMEOUTS = 2` host calls in a row that time out (any call that completes, even by raising, resets the count) mark the popup unavailable for the rest of the process: `call_popup_unavailable reason=host_timeouts` (warning, with `timeouts`). `call_popup_available()` stays a flag read and then returns `False`, so the gate skips with `unavailable` and the chat gets its normal toast. `set_call_popup_host` re-arms the breaker (the desktop registers its host once per process).
- They never raise:
  - with no host, `call_popup_unavailable` (`reason=no_host`) is logged once;
  - a timeout or an exception logs `call_popup_bridge_failed` (`op`, `error_type` or `reason=timeout`) and returns `False` / `"error"`.
- **`deliver_heard`** runs `evaluate_js("window.__sakadeskMarkVoiceHeard ? window.__sakadeskMarkVoiceHeard(<json>) : null")` on the **main** window. The result is `true` → `delivered`, `null` (no bridge yet, or its conversation cache not loaded, §7.4) → `not_ready`.
- **`HeardTarget(service, path, message_id)`** is a frozen dataclass in the bridge module.
- Off Windows no host is registered, so the gate reports `unavailable` and Linux CI never imports pywebview or Win32 code. `call_popup_window.py` imports `ctypes.windll` and `System.Windows.Forms` lazily inside its methods, and `user32`/`dwmapi` are injectable for tests.

---

## 7. Frontend

### 7.1 Route

- `shell/main.tsx` checks `isCallPopupView(location.search)` (`view=call-popup`, in `shell/callPopupRoute.ts`, unit-tested).
- Each route is loaded with a dynamic `import()`, so the popup never evaluates `App`'s module graph and the main window never loads the popup's. Before the import resolves, the popup route calls `installCallPopupBridge()` synchronously (§7.2); a failed import logs `call_popup_error error_type=load_failed`. A failed main-route import logs `app_load_failed error_type=load_failed` (a warning), so a blank main window leaves a breadcrumb.
- When it matches, it renders `<CallPopupApp />` from `features/callPopup/` inside `ErrorBoundary`, **without** `AuthProvider` or `App`. The popup therefore never runs:
  - the startup sync or `useBackendSyncWatcher`;
  - the ui-state reporter;
  - `useAppStore.persist.rehydrate()`;
  - the ToS gate;
  - the toast-click bridge.

  The bundle and `index.html` are shared.

### 7.2 `CallPopupApp` and `PopupCall` (`features/callPopup/`)

**Store rule (binding).** The popup **reads** the primary stores directly and **writes none of them**:
- prefs: `persisted.hydratePrefs()`, read-only (voice volume, language);
- read state: `GET /api/app-state/conversation?path=read_state_<path>` (`persisted.getConversation`), the same row the main window and the C2 tooltip use, parsed by `parseReadState` (§7.4);
- settings: `GET /api/settings`.

It never calls `persisted.setPref`, `setConv`, `setConvBeacon` or `flushNow`, and never `PUT /api/read-states`. "Heard" is written only by the main window (§7.4). A test spies on all of these to enforce it.

**`CallPopupApp`.**
1. **Bridge (`callPopupBridge.ts`).** `window.__sakadeskCallPopup = { start(callId), cancel(callId) }` is installed synchronously, at module load and again from `main.tsx` before the dynamic import resolves, because the host evaluates `start` right after the page's `loaded` event, which can precede React's mount. A `start` that arrives with no handler attached is queued (the newest wins) and replayed when `CallPopupApp` attaches; a `cancel` for the queued id drops it. A start that had not loaded when the handler detaches (StrictMode remount) is queued again. The global stays installed for the life of the page.
   On mount `CallPopupApp` adds the `sd-call-popup-doc` class to `<html>` (the dark background), attaches the handler, and removes both on unmount.
2. **`start(callId)`:**
   - log `client_log('call_popup_start', {call_id})`;
   - `GET /api/call-popup/calls/{id}` (404 → `call_popup_error error_type=info_not_found`, nothing posted: the backend has already moved on);
   - re-hydrate prefs, then apply the language with `applyStartupLanguage()` (extracted from `App.tsx`'s post-hydrate step into `shell/language.ts` and used by both: persisted `language`, else `/api/settings` `language`, else the browser default);
   - fetch the settings, `GET /api/content/messages_by_path?path=<path>&limit=0` and the read-state row, in parallel.

   Any failure posts `error` with `error_type` = `info_failed|start_failed|settings_failed|messages_failed|read_state_failed` and logs `call_popup_error` (`start_failed`: the prefs or language step threw). The page rings **exactly** `info.message_id`: voices other than that one are dropped from the messages handed to B's hook, and when B's own candidate (`pickCandidate`) is a different voice the page logs `call_popup_error error_type=message_mismatch` (a newer voice that arrived since gets its own call). Without this, an `answered` for another id would be rejected as stale and the heard mark never delivered. On success it renders `<PopupCall key={callId} …/>` inside `CallPopupBoundary`; the key makes every call a fresh hook instance, with no dismissed set or dedupe carried over. If a descendant throws while rendering, the boundary renders nothing and the page posts `error` with `error_type=render_failed` (logged as `call_popup_error`).
3. **`cancel(callId)`** (from the backend): unmount the matching `PopupCall`, and mark the call cancelled-by-host so its outcomes are **not** posted back.

**`PopupCall`.** It calls B's `useIncomingCall` exactly as `MessagesFeature` does, with:
- `service`, `chatDir = path`, `isGroupChat` from the call info;
- `messages`, and `member = data.member` from `messages_by_path` (which carries the `_local` image URLs);
- `name = formatName(member.name)`;
- `enabled = settings.call_popup_enabled ?? true` (the popup's own switch);
- `isUnread = isUnreadIn(readState)` (§7.4);
- `freshFetch = {seq: 1, dir: path}`, set once after the fetches;
- `revealMessage = id => postEvent('answered', {message_id: id})`: the popup's heard path goes to the main window through the backend (§7.4);
- `scrollToMessage = () => {}`;
- `preload = fetchPreload` (`features/callPopup/fetchPreload.ts`), not B's `Audio` preload: the popup page loads while its window is hidden, and WebView2 keeps media suspended in a hidden page (`visibilityState` is `hidden`), so an `Audio` element never reaches `canplay` and B's preload always timed out there. `fetchPreload` confirms the file with a one-byte ranged GET (`Range: bytes=0-0`) that must return 2xx with an `audio/*` content type, within B's `PRELOAD_TIMEOUT_MS`; anything else rejects as `media_unavailable`. Playback itself starts after the reveal, when the page is visible;
- `logContext = parseReadStatePath(path)`;
- the new optional `surface: 'popup'` and `onOutcome` arguments (§7.3).

`onOutcome` maps to the event endpoint: `skipped` → `skipped` (with `reason`), `ringing` → `ringing`, `declined` → `declined`, `timeout` → `timeout`, `ended` → `ended` (with `reason` `played`/`hung_up` when the hook gave one), `cancelled` → `cancelled`. Posting is fire-and-forget: a failure is logged as `call_popup_error error_type=event_post_failed`, and the backend watchdog recovers.

**Render.** While the hook's phase is not `idle`:

```
<div class="sd-call-popup" style="--sd-accent: …; --sd-rad: 0px">
  <CallScreen phase name groupLabel photoUrl talkSeconds answerStyle onAnswer onDecline onHangUp />
  <div class="sd-call-halo sd-call-halo--inset" data-phase={phase} aria-hidden />
  <CallAudio key={message.id} … />
</div>
```

- **Accent and answer style:** the same rule as `MessagesFeature` (`getServiceTheme(service)`: light services use `messages.bubbleBorder` and `answerStyle='light'`, others `modals.accentColor` and `'solid'`), read for the call's service instead of the active one.
- **Group label:** `getServiceDisplayName(service)`.
- **Talk timer:** the same 250 ms tick as `CallOverlay`.
- **Live region:** one, as in `CallOverlay`.
- **No Esc/Enter handler,** because the window never receives keyboard focus.
- **When the hook is idle** the root renders nothing over the dark background; the window is already being hidden by then.

### 7.3 Additive changes to B's hook and decision

All of these are optional. B's existing call sites and tests are unchanged.

- **`surface?: 'popup'`.** When set, every `clientLog` call in `useIncomingCall` adds `surface`, so popup calls are told apart in `debug.log`.
- **`onOutcome?: (o: CallOutcome) => void`:**

  ```ts
  export type CallOutcome =
    | { kind: 'skipped'; reason: CallSkipReason | 'superseded' | 'media_unavailable' }
    | { kind: 'ringing' } | { kind: 'declined' } | { kind: 'timeout' }
    // When the ended hold finishes (where scrollToMessage is called). `reason` is how the call
    // ended (`call_end`'s reason); absent after a playback error, which logs `call_error`.
    | { kind: 'ended'; reason?: 'played' | 'hung_up' }
    | { kind: 'cancelled' };    // visit cleanup or setting off while ringing/connected
  ```

  It fires at the exact points where the hook already logs. `finish(reason)` hands its reason to the ended hold, which reports it with `ended`. `skipped` fires even when the `call_skip` log is deduped.
- **`isCallElsewhere?: (messageId: number) => Promise<boolean>`.** It is checked after a successful preload, just before `startRinging`. When it returns true, the hook logs `call_skip` with the new reason `popup_active` and does not ring. A rejection or a synchronous throw counts as false and is logged as `call_error` with `error_type=popup_check_failed`. `MessagesFeature` passes a function calling `GET /api/call-popup/active` (`isCallPopupActive`) with `parseReadStatePath(selectedGroupDir)` and the id; that call has a 3 s timeout (`POPUP_CHECK_TIMEOUT_MS`), and a non-2xx answer, network error, timeout or malformed body also logs `popup_check_failed` and returns false, so when the main window cannot tell, it rings. This stops the main window (visible but unfocused, with that chat selected, refetching after the sync) from ringing the same voice as the popup. It reads the controller, the single owner of the active call, instead of a pushed copy. The popup itself does not pass it.
- **`CallSkipReason`** gains `popup_active`. It is produced only by this hook path; `decideCall` is unchanged.

### 7.4 Read state: one store, one writer (`features/messages/readStateStore.ts`)

**The primary store** for heard/unheard is the app-state conversation row `read_state_<chat path>` (SQLite `conversation_state`, value `{"value": "<JSON {lastReadId, readCount, revealedIds}>"}`). The main window reads it through `persisted.getConv` (its cache of that table) and writes it through `persisted.setConv`, which PATCHes the row immediately. C2's tray tooltip and the sidebar read the same row. "Heard" is the existing unread rule: `id > lastReadId && !revealedIds.includes(id)`. There is no separate heard flag.

**Refactor.** Move the read-state code out of `MessagesFeature` unchanged:
- `parseReadState(row)`: today's `loadReadState` parsing, with the same fallbacks. A row that parses to `null`, a non-object, or an object missing a numeric `lastReadId` or an array `revealedIds` is repaired field by field (missing parts become `0` / `[]`), so `isUnreadIn` and `applyReveal` never throw on it;
- `loadReadState(path)` and `saveReadState(path, state)`: `setConv` plus the fire-and-forget `PUT /api/read-states` search copy;
- `applyReveal(prev, msgId, messageIds)`: today's `revealMessage` consolidation, made pure;
- `isUnreadIn(state)`: returns `(id) => boolean`.

Add `revealInStore(path, msgId)`. It loads the state, and if the id is already heard (`!isUnreadIn(state)(msgId)`) it returns `false`. Otherwise it saves `applyReveal(prev, msgId, [])`: the id goes into `revealedIds`, and consolidation happens the next time the chat is open, as today. It then notifies the subscribers and returns `true`. `subscribeReadState(listener)` (used through `useReadStateSubscription`) lets `MessagesFeature` refresh when the selected chat's row changed outside it, and bump `readStateVersion` (sidebar refresh) for any change. The subscriber does not overwrite its in-memory state: it merges the stored row into it with `mergeReadState` (max `lastReadId`, union of revealed ids, so an in-flight in-chat reveal is never lost) and, when the merge holds more than the stored row, writes it back through the same `saveReadState` path. `MessagesFeature` keeps calling `applyReveal` and `saveReadState` for its own reveals, so behaviour is byte-identical.

**The main-window heard bridge** (`shell/markVoiceHeard.ts`). `App.tsx` installs `window.__sakadeskMarkVoiceHeard = markVoiceHeard` next to `__sakadeskOpenChat`, and removes it on unmount. `markVoiceHeard({service, path, message_id})`:
- first checks `persisted.conversationsReady()`, which is true only after the latest `hydrateConversations()` GET succeeded. Until then (still loading at startup or after a reload, or the GET failed and the cache fell back to `{}`), an existing read row reads as empty, so writing "heard" over it would reset the chat's read progress to `lastReadId: 0`. The bridge therefore applies nothing, logs `call_popup_heard_ignored reason=not_ready` and returns `null`;
- validates the shape (and that `parseReadStatePath(path)` parses). A malformed payload (bad shape, `service` not matching the path, a non-positive or non-integer id) logs `call_popup_heard_ignored reason=malformed` and returns `true`, so the backend does not retry a payload that can never apply;
- otherwise calls `revealInStore(path, message_id)`, logs `call_popup_heard_applied` (`service`, `group_id`, `member_id`, `message_id`, `changed`) and returns `true`;
- an exception while applying logs `call_popup_heard_ignored reason=error` (no error text, which could carry a path) and returns `true` as well.

Once the cache is loaded, the bridge therefore **always returns `true`**: the host maps `true` to `delivered` (final), `null` (bridge not installed yet, or the cache not loaded) to `not_ready`, and a thrown JS error to `error`, and retries only the last two. A request that can never succeed on retry must not be retried; the voice then stays unheard and B rings it in the app later. The retry budget (3 attempts, 1 s apart, about 2 s plus the script calls) covers a reload that finishes hydrating in that window; a call can only be answered after a sync and a ring, by which time a normal startup has long hydrated. A cache that never loads leaves the voice unheard, the documented safe outcome.

The popup never writes read state. The main window, the only writer, applies the reveal through the same code path it uses for any heard voice, so its cache, the backend row, the search copy, the sidebar badge and the C2 tooltip all agree, and B's next decision sees the voice as heard.

### 7.5 CSS (`callScreen.css` and `features/callPopup/callPopup.css`)

- **`callScreen.css` gains the inset halo** described in B §2.5. It sits **above** the card, because an inset shadow under the photo would be hidden:
  - `.sd-call-halo--inset`: `position:absolute; inset:0; border-radius:var(--sd-rad); pointer-events:none; z-index:2`;
  - `[data-phase="ringing"]`: `box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--sd-accent, #7cc7e8) 75%, white), inset 0 0 36px 6px color-mix(in srgb, var(--sd-accent, #7cc7e8) 55%, transparent)`, with the same `sd-call-breathe` 2.4 s animation;
  - `[data-phase="connected"]`: `box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sd-accent, #7cc7e8) 45%, transparent)`;
  - nothing while ended;
  - the existing `prefers-reduced-motion` rule also stops it.
- **`callPopup.css`:**
  - `html, body, #root { margin:0; height:100%; overflow:hidden; background:#0D0F14 }`, scoped by a `sd-call-popup-doc` class that `CallPopupApp` adds to `<html>`;
  - `.sd-call-popup { position:fixed; inset:0 }`;
  - `.sd-call-popup .sd-call-screen { box-shadow:none }`: the outer drop shadow and rim would be clipped by the window, and DWM draws the window shadow.
  - `--sd-rad: 0px`: on Windows 11 DWM rounds the window itself (§6.2); on Windows 10 the card is square.
- `CallScreen` itself is not changed.

### 7.6 Ringtone hook (`features/incomingCall/ringtone.ts`)

```ts
export interface Ringtone { start(): void; stop(): void }
export const SILENT_RINGTONE: Ringtone = { start() {}, stop() {} };
/** The one swap point for a future synthesized (Web Audio) ringtone. */
export function getRingtone(): Ringtone { return SILENT_RINGTONE; }
```

`PopupCall` calls `getRingtone().start()` when the phase becomes `ringing` and `stop()` when it leaves `ringing` or unmounts. Nothing else plays sound. The in-app call (B) does not use it yet; it can adopt the same hook later.

---

## 8. Strings

### 8.1 Backend (`backend/i18n/<locale>/call_popup.json`, new section `call_popup`)

| key | en | ja | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `missed_title` | Missed call: {name} | 不在着信：{name} | 未接來電：{name} | 未接来电：{name} | 未接來電：{name} |
| `missed_body` | Click to open the chat | クリックしてトークを開く | 點擊開啟聊天室 | 点击打开聊天室 | 㩒一下打開聊天室 |
| `missed_more` | +{n} more messages | ほか{n}件のメッセージ | 另有 {n} 則訊息 | 另有 {n} 条消息 | 仲有 {n} 則訊息 |

C1's loader, the per-key `en` fallback and the "every locale has every key" test cover the new section.

### 8.2 Frontend (all five `locales/*.json`)

The call screen reuses B's `call.*` keys unchanged.

| key | zh-TW | ja | en | zh-CN | yue |
|---|---|---|---|---|---|
| `settings.callPopup` | 背景來電小窗 | バックグラウンド着信ウィンドウ | Background call popup | 后台来电小窗 | 背景來電小窗 |
| `settings.callPopupDesc` | SakaDesk 在背景時收到成員語音，會在右下角小窗以來電方式響起 | SakaDesk がバックグラウンドのときにメンバーからボイスが届くと、右下の小さなウィンドウで着信します | When SakaDesk is in the background and a member sends a voice message, it rings in a small window at the bottom right | SakaDesk 在后台时收到成员语音，会在右下角小窗以来电方式响起 | SakaDesk 喺背景時收到成員語音，會喺右下角小窗以來電方式響起 |

---

## 9. Logging

Every event carries ids, codes, counts, durations or physical pixel sizes only. Never names, message text, paths, URLs or tokens.

### 9.1 Backend events (structlog)

| event | fields |
|---|---|
| `call_popup_skip` | service, reason (`popup_disabled`/`no_candidate`/`unavailable`/`foreground`/`busy`/`quiet`), group_id, member_id, message_id (with a candidate), quiet_state (for `quiet`) |
| `call_popup_reserved` | call_id, service, group_id, member_id, message_id, count |
| `call_popup_voice_first` | call_id, items, downloaded |
| `call_popup_dispatch` | call_id, result (`started`/`start_failed`/`superseded`/`foreground`/`viewing`/`not_reserved`) |
| `call_popup_abandoned` | call_id, reason (`sync_failed`/`cancelled`), toast (`sent`/`skipped`) |
| `call_popup_event` | call_id, call_event, phase, reason, error_type |
| `call_popup_event_stale` | call_id, call_event, reason (`unknown_call`/`wrong_phase`/`message_mismatch`) |
| `call_popup_hide` | call_id, reason (the event or watchdog that ended the call, `reveal_failed`, or `superseded` for a re-hide after a late reveal) |
| `call_popup_toast` | call_id, kind (`fallback`/`missed`), reason, sent |
| `call_popup_toast_skip` | call_id, kind (`fallback`/`missed`), reason (`notifications_disabled`) |
| `call_popup_heard` | call_id, message_id, delivered, attempts, reason (`not_ready`/`error`/`no_host`) |
| `call_popup_cancel` | call_id, reason (`foreground`/`disabled`/`app_exit`), phase |
| `call_popup_watchdog` | call_id, phase (`reserved`/`starting`/`ringing`/`connected`) |
| `call_popup_abandon_failed` | call_id, reason, error_type |
| `call_popup_unavailable` | reason (`no_host`, once; `host_timeouts`, once, with timeouts) |
| `call_popup_bridge_failed` | op, error_type or reason (`timeout`) |
| `call_popup_window` | action (`created`/`reused`/`create_failed`/`disabled_after_failures`/`lost`/`destroyed`/`destroy_failed`/`start_refused`/`preload_skipped`; debug `destroy_skipped`), error_type, reason, call_id (`lost` during a call, `start_refused`) |
| `call_popup_lost_report_failed` | call_id, error_type |
| `call_popup_foreground_failed` | error_type |
| `call_popup_app_exit_failed` | error_type (the `Application.Exit` fallback itself raised) |
| `call_popup_corner_skipped` (debug) | hresult or error_type (no DWM rounded corners, e.g. Windows 10) |
| `call_popup_foreground_kept` (debug) | call_id (an answered call is not cut off by the main window gaining focus) |
| `call_popup_reveal` / `call_popup_reveal_failed` | call_id, dpi, width, height, visible / call_id, error_type (`bad_dpi` also dpi) |
| `call_popup_reveal_skipped` / `call_popup_hide_skipped` (debug) | call_id, reason (`stale_call`) |
| `quiet_state` (debug) / `quiet_state_failed` | quns, focus_assist, result / api (`quns`/`wnf`), error_type |

C1's `notify_skip reason=diverted`, `notify_sent` and `notify_failed` cover the toasts themselves.

### 9.2 Frontend (`POST /api/client-log`)

- **B's events** (`call_ring`, `call_skip`, `call_answer`, `call_decline`, `call_timeout`, `call_end`, `call_cancel`, `call_error`) are reused. From the popup they carry `surface=popup`. `call_skip` gains the reason `popup_active` (main window). A failed `/active` check logs `call_error` with `error_type=popup_check_failed`.
- **New events:**
  - `call_popup_start` (call_id);
  - `call_popup_error` (call_id, error_type: `info_failed`, `info_not_found`, `start_failed`, `settings_failed`, `messages_failed`, `read_state_failed`, `message_mismatch`, `render_failed`, `event_post_failed`, `load_failed`);
  - `call_popup_heard_applied` (service, group_id, member_id, message_id, changed);
  - `call_popup_heard_ignored` (reason: `not_ready`, `malformed`, `error`);
  - `app_load_failed` (error_type `load_failed`; a warning): the main route's dynamic import failed.
- **Whitelist:** add these events to `ClientEvent` and the fields `surface`, `call_id` and `changed` to `ALLOWED_FIELDS`. The value rules are unchanged.

---

## 10. Edge cases

| case | behaviour |
|---|---|
| Main window opened (tray, toast click, taskbar) while ringing | ui-state `focused=true` → `on_foreground` cancels the popup, with no toast. The voice is unheard, so B rings when the user opens the chat. A call already answered keeps playing in the popup. |
| Main window visible but unfocused, same chat selected | The popup rings. The main window's refetch after the sync reaches B, which asks `/api/call-popup/active` after its preload and skips with `popup_active`. After a missed call, B rings at the next fresh fetch of that chat. |
| Second voice while ringing (any chat, any service) | `busy` → the normal C1 toast for that chat. For the same chat, the later missed-call toast shares C1's tag `"{group_id}:{member_id}"` and replaces that toast. |
| Several 1:1 voices in one sync | Only the newest voice (by timestamp, then id) rings. The others are normal toasts. |
| B's rules say no in the popup (no photo, already read, …) | `skipped` → the window never shows. `already_read` → no toast; any other reason → the normal toast. |
| Voice file still missing | Voice-first download (§4.5). If the preload still fails within 10 s → `skipped reason=media_unavailable` → the normal toast. The voice stays unheard. |
| Playback error after answering | B's path: `call_error playback_failed` → ended screen → `ended` → hide. The voice stays heard, as in B. |
| Popup window failed to create, or lost | `start` returns False → fallback toast. Two creation failures → `unavailable` for the rest of the run (toasts only). Lost during a call → reported as `error window_lost`: fallback toast when starting, missed-call toast when ringing, no toast when connected. |
| Popup page never reports | The watchdogs (20 s / 45 s / 15 min) hide or cancel it and send the fallback or missed-call toast. A leaked reservation is released by the 30 min reserved watchdog, with the fallback toast. |
| Heard delivery fails (main page not ready) | 3 attempts, then `call_popup_heard delivered=false`. The voice stays unheard and B rings in the app later. |
| Quit, ✕ with close-to-tray off, or session end while the popup is open | The popup is destroyed with the main window (§6.5). `controller.shutdown()` sends no toast. The process exits. |
| Sync fails or is cancelled after reserving | `abandon`: fallback toast on failure; nothing on cancel. This includes a cancel during the toast send inside `_notify_new_messages`. |
| Setting turned off while ringing | `cancel(reason=disabled)`, with no toast. |
| Notifications off, popup on | The popup still rings for a qualifying voice. Every other chat is skipped as `disabled` (`notify_skip`). A missed call or a fallback (quiet state, failed popup) sends no toast and logs `call_popup_toast_skip reason=notifications_disabled`; a quiet-state refusal leaves the candidate's plan to C1's `disabled` skip. |
| Notifications on, popup off | `popup_disabled` → toasts only. |
| Fullscreen, presentation or Focus Assist | `quiet` → the normal toast (which Windows itself holds back under Focus Assist). |
| Answered call, chat had other new messages | No toast for that chat. The unread badge and the tray tooltip show them. |

---

## 11. Testing

### 11.1 Backend (pytest; Linux CI, no Windows imports)

- **Collector:** `newest_voice` is the newest visible voice; a hidden voice is ignored; it is `None` without a voice.
- **`select_call_candidate`:**
  - the newest voice across 1:1 chats, including a newer timestamp with a smaller id and a tie broken by id;
  - rooms excluded, including a one-member `GROUP_CHAT_IDS` room;
  - `None`.
- **`divert_gate`:** each reason in order. The quiet thunk is not called when an earlier gate fails.
- **Divert hook with the real `plan_toasts`:**
  - only the candidate's plan is diverted (`Skip("diverted")`) and every other plan is returned;
  - a lost `reserve` race keeps the plan;
  - rule order `diverted`, `disabled`, `viewing`: with `enabled=False`, `divert` is still called for every chat; a `True` gives `Skip("diverted")` and a `False` gives `Skip("disabled")`; viewing still skips when the hook returns False;
  - `notifications_enabled` off and `call_popup_enabled` on → the candidate is reserved and every other chat is `disabled`;
  - a gate refusal (e.g. `quiet`) with notifications off → the candidate's chat is `disabled`, not toasted.
- **Quiet state (fake `shell32`/`ntdll`):** every QUNS value; WNF 0/1/2/other; failures → `unknown`/not quiet with `quiet_state_failed`; non-Windows → `unknown`.
- **Controller** (fake bridge, fake `send_toasts`, injected sleep):
  - every event × phase in §4.4, including stale events and `message_mismatch`;
  - with `notifications_enabled` off, the missed-call and fallback toasts (decline, timeout, skipped, start failure, dispatch-time foreground, `abandon(sync_failed)`) are not sent and each logs `call_popup_toast_skip reason=notifications_disabled`;
  - dispatch re-check (focused on that chat → nothing; focused elsewhere → toast);
  - each watchdog, including `reserved` (fallback toast, no bridge call, notifications-off suppression, cancelled by `dispatch`/`abandon`/`shutdown`, a late `dispatch` is `not_reserved`);
  - `already_read` → no toast;
  - missed-call text for count 1 and > 1, with a CJK name;
  - heard retries (`not_ready` twice, then delivered; three failures);
  - `on_foreground` per phase; `cancel` (in `reserved`: fallback toast `reason=disabled`, suppressed with notifications off); `shutdown`; `abandon` for both reasons;
  - `error window_lost` per phase (fallback / missed / none);
  - a call ended during the reveal await (foreground, `cancel(disabled)`, declined) is hidden again (`reason=superseded`); an answer during it keeps the popup.
- **Watchdog vs B:** a test parses `RING_TIMEOUT_MS` and `PRELOAD_TIMEOUT_MS` from the frontend sources and asserts `RING_WATCHDOG_S*1000 > RING_TIMEOUT_MS` and `START_WATCHDOG_S*1000 > PRELOAD_TIMEOUT_MS`.
- **Sync** (fake manager):
  - the voice item is downloaded in its own first `process_media_queue` call and removed from the chunk loop;
  - its dimensions still reach `update_message_metadata`;
  - dispatch is scheduled;
  - no matching item → dispatch right away;
  - an exception before dispatch → `abandon(sync_failed)`; cancel → `abandon(cancelled)`.
- **API:**
  - call info 200/404;
  - event 204/409/422 (unknown event, bad code, float, a string with a space or CJK);
  - `active` true/false;
  - `ui-state` focused calls `on_foreground` as a background task: the 204 does not wait for a slow cancel, and a raising one logs `call_popup_foreground_failed`;
  - an `ended` event keeps its `played`/`hung_up` reason.
- **Settings:** `call_popup_enabled` defaults to on and round-trips; on → `call_popup_ensure`; off → `cancel(disabled)`.
- **Client-log:** the new events and fields are accepted (including `app_load_failed` as a warning and every `call_popup_heard_ignored` reason), and the old rules still reject.
- **i18n:** the `call_popup` section exists in all five locales.
- **Bridge:** no host → logs once and returns False/`no_host`; a raising or hanging host → `call_popup_bridge_failed` (timeout injected); host calls run on `call_popup_host` threads (at most two); two timeouts in a row → `available()` False without asking the host and `call_popup_unavailable reason=host_timeouts`; a completed call resets the count; `shutdown_call_popup_executor` does not wait for a blocked call and a later call gets a fresh pool.

### 11.2 Desktop (pytest, fakes for webview/user32/dwmapi)

- **`popup_rect`:** at 96/120/144/192 DPI, with a bottom, top, left and right work area offset. The 9:16 shape holds after rounding.
- **`CallPopupWindow`:**
  - `ensure` creates once with exactly the §6.2 arguments (reuse only when loaded and not closed) (title not "SakaDesk", `focus=False`, `hidden=True`, `frameless=True`, `on_top=True`, `easy_drag=False`, `resizable=False`);
  - `before_show` sets `WS_EX_TOOLWINDOW` and the corner preference;
  - load timeout → `create_failed`; two failures → unavailable;
  - `start` returns False when the script returns false, or while quitting;
  - `reveal` calls `SetWindowPos(…, SWP_NOZORDER|SWP_NOACTIVATE)`, `ShowWindow(SW_SHOWNOACTIVATE)`, then `SetWindowPos(HWND_TOPMOST, …, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)`, in that order, and never `window.show()`; a DPI of 0 fails with `bad_dpi`;
  - `cancel` runs the script then hides;
  - call scope and ordering: a reveal after a hide or cancel of the same call, or for a call that was never started, touches no window; a cancel before `start` returns refuses that start (`reason=ended`); a late hide or cancel for an older call leaves the newer one; a cancel issued during a reveal's Win32 calls waits for it, then hides;
  - `destroy` success; `destroy` timeout, including a hung `window.destroy()`, → `Application.Exit` fallback (injected); a second `destroy` is a no-op;
  - a lost window is recreated by the next `start`;
  - a window lost during a call is reported (`report_lost(call_id)`), not after a hide or cancel or with no call; a failing report is logged; the default report schedules `on_event(call_id, error window_lost)`;
  - `deliver_heard` maps `true`/`null` to `delivered`/`not_ready`.
- **`desktop.py`:** `on_quit` destroys the popup before the main window; main `closed` destroys the popup; the popup is created after the first `loaded` only when the setting is on, and only once.

### 11.3 Frontend (vitest)

- **`useIncomingCall`:**
  - `onOutcome` fires for every kind, including a deduped skip; `ended` carries `played` or `hung_up`, and no reason after a playback error;
  - `surface` is added to every log;
  - `isCallElsewhere` true → `call_skip popup_active` and no ring; a rejection → rings;
  - every existing B test passes unchanged.
- **`readStateStore`:**
  - `applyReveal` matches the old `revealMessage` results (table-driven, moved tests);
  - `revealInStore` writes through `persisted.setConv` and the search PUT, notifies subscribers and returns false when already heard;
  - `MessagesFeature`'s subscriber refreshes the selected chat (harness).
- **`markVoiceHeard`:** valid → applied, `changed` true then false; malformed → ignored and logged; returns `true` in both cases. Before the conversation cache loaded, or after its load failed → `null`, `not_ready` logged, no `setConv` and no PUT, the row untouched; after a later successful load → applied. `persisted.conversationsReady()` is true only after a successful load.
- **`CallPopupApp` / `PopupCall`** (mocked fetch and `Audio`, fake timers):
  - `start` → fetches → `ringing` posted;
  - answer → `answered` posted with the message id, then `ended` (`reason=played`) after the hold;
  - decline / 30 s timeout posted;
  - a B skip (`no_photo`) posts `skipped`;
  - fetch failures post `error`;
  - `cancel` unmounts and posts nothing;
  - a new `start` remounts (fresh hook);
  - the inset halo carries the phase;
  - the ringtone starts and stops with ringing;
  - **no `persisted.setPref` / `setConv` / `setConvBeacon` / `flushNow` and no `PUT /api/read-states` call ever happens**;
  - non-ASCII names render.
- **`fetchPreload`:** resolves on a 2xx `audio/*` ranged GET; rejects `media_unavailable` on a non-2xx, a non-audio type, a network error or the timeout, and `aborted` on abort.
- **Bridge:** an early `start` is queued and replayed on attach; `cancel` drops it.
- **Route:** `isCallPopupView`; a failed main-route import logs `app_load_failed`. **Language:** `applyStartupLanguage` precedence, shared by `App` and the popup.
- **Settings:** the toggle and Reset. **i18n:** the new keys are present in all five locales.

### 11.4 Manual (Windows, on the `C:\D\saka-verify` copy only, never the live archive)

Build and launch as in the C1/C2 specs:
- a frozen build via `build.ps1` (pywebview 5.3.2 pinned), or the dev exe launched with `-WorkingDirectory`;
- reuse the existing Windows login, and never log in from WSL;
- create new messages with the C1 trim helper.

1. **Tray.** With the window hidden in the tray, a new 1:1 voice → the popup appears bottom-right above the taskbar within seconds of the sync. Check this at 100% and at 150% display scaling: 300 px CSS wide, 9:16, no white flash, rounded on Windows 11.
2. **No focus steal.** While typing in Notepad, the popup appears and typing continues in Notepad. The popup has no taskbar button and is not in Alt+Tab.
3. **Answer.** The voice plays → "call ended" → the popup closes. The main window stays hidden. Opening the chat later shows the voice heard, with no in-app ring, and the sidebar badge and tray tooltip agree.
4. **Decline, then timeout.** Decline → missed-call toast with "+N more" when there were more messages → clicking it opens that chat and B rings. Repeat and let it time out after 30 s.
5. **Other window states.** Minimised window, then visible-but-unfocused window: the popup appears. With that chat selected in the unfocused window, B does not ring as well (`popup_active` in `debug.log`).
6. **Quiet states.** A fullscreen video, then Focus Assist / Do not disturb on → a normal toast instead, with `quiet_state` codes in `debug.log`. Note whether the WNF profile reflects Windows 11 Do not disturb.
7. **Foreground while ringing.** Open the main window from the tray while ringing → the popup disappears.
8. **Quit and sign-out.** Quit from the tray while ringing → the process is gone in Task Manager (the mutex is released). Signing out while ringing is not blocked.
9. **Two voices.** Two members send voices in one sync → one popup (the newer one) and one normal toast.
10. **Setting off.** Toasts only.
11. **Notifications off, popup on.** A new 1:1 voice still rings. Decline it: no missed-call toast. Other chats get no toast. `debug.log` has `notify_skip reason=disabled` and `call_popup_toast_skip`.
12. **Logs.** `debug.log` has a breadcrumb for every step, with no names, text or paths.

**Results (Windows, frozen build on a copy of the data, 57678fa).**
- **Placement and focus.** Popup 525 × 933 px at (3294, 1122) at 168 DPI (300 × 533 CSS px), tool window and top-most; the foreground window was unchanged by the reveal.
- **Timeout.** Ring, then the 30 s timeout, then hide and the missed-call toast.
- **Answer.** Answer, playback to the end, heard delivered to the main window (`changed=True`), then hide. Playback starts after the reveal (`fetchPreload`, §7.2).
- **Quit.** A Restart Manager close with the popup present destroys it and the process exits.
- Other checklist steps (5 to 11, including the Windows 11 Do not disturb `quiet_state` codes) have no recorded result yet.

---

## 12. Risks

- **Focus at creation.** pywebview's hidden-create path calls `Form.Show()` and `webview.Focus()` once. Creating the popup at SakaDesk start keeps this away from calls, but an autostart at sign-in could still flicker focus once. Manual step 2 checks the steady state, and `debug.log` records `call_popup_window action=created`.
- **Native show vs WinForms state.** The reveal uses `ShowWindow(SW_SHOWNOACTIVATE)` behind WinForms' back. WinForms tracks visibility through `WM_SHOWWINDOW`, so the WebView2 control should become visible with it. If the card renders blank on reveal, the fallback is to set the WebView2 controller visible explicitly (`window.native.browser.webview.Visible = True`) inside the same `Invoke`. `call_popup_reveal visible=` and manual step 1 detect this.
- **Hidden page.** WebView2 keeps media suspended while the page is hidden (`visibilityState` is `hidden`), so the popup cannot preload an `Audio` element (found on Windows at 57678fa); it uses `fetchPreload` (§7.2) and plays after the reveal. Timers in the hidden page may be throttled; everything before the reveal is event-driven (fetch). The 30 s ring timer starts when ringing begins, and that same moment triggers the reveal, so the timer runs while the page is visible. Throttling can only lengthen the hidden preload timeout slightly.
- **Focus Assist detection uses an undocumented WNF state.** If a Windows build changes it, the read fails or reads 0, and the popup shows. That is the user's rule for an undetectable state. The raw values are logged.
- **System-DPI awareness.** The process is system-DPI aware (pywebview), so on a primary monitor whose DPI differs from the system DPI Windows bitmap-scales the popup (slightly soft) without misplacing it.
- **Two WebView2 renderers.** The idle popup costs one extra renderer process for the app's lifetime while the setting is on.
