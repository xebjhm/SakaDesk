# 0.4.2 reliability: session renewal, read-state recovery, call popup frame

Date: 2026-11-09. Status: approved in discussion (user, 2026-11-09). Target release: SakaDesk 0.4.2.
No pysaka change: the cookie refresh (`Client.refresh_access_token`, Plan B) already exists.

Items B1 and B2 are follow-ups that the 0.4.0 release deferred. B4 was reported by the user on 2026-11-09. B3, the packaged smoke test, runs when the user upgrades to 0.4.1, so it is not part of this spec.

## B1. An expired access token is renewed silently; only a dead session asks for a login

### Problem (from the user's Windows log, 2026-11-09)

The access token is a JWT that expires every hour. An expired token does not mean a dead session, because the session cookie can mint a new one. At 12:54:19 UTC, a Sakurazaka token that had expired 2,984 s earlier was renewed by the cookie refresh (HTTP 200, new expiry 3,600 s). The UI had already opened the login dialog, so the user logged in again at 12:54:39 for no reason.

The cause is `AuthService.get_status` (`backend/services/auth_service.py`). It returns `authenticated: False, token_expired: True` as soon as the JWT `exp` has passed, and two consumers act on that answer:

- **Scheduler.** `auto_sync_scheduler._decide` returns `not_authenticated` and skips the sync, and the sync is the very path that would refresh the token. After the PC sleeps longer than an hour, background sync stops for good. The log shows this: Sakurazaka ticked `not_authenticated` repeatedly on 2026-11-08.
- **Frontend.** The frontend opens the login dialog.

The log also shows two refreshes for one service starting in the same millisecond. Each refresh rotates the session cookie, so two concurrent refreshes can invalidate each other.

### Design

1. **Renew in place.** When `get_status(service)` finds an expired token that has cookies, it first runs one refresh. If the refresh succeeds, the status is authenticated with the new expiry. A dead session (`authenticated: False, session_expired: True`) is reported only when the service is marked (§3): at once after `SessionExpiredError`, or after the second `RefreshFailedError` in a row. Without cookies, there is nothing to try, so the status is a dead session immediately. Any other failure returns the old answer, `token_expired: True` without `session_expired` (see Frontend).
   - **Bounded and concurrent.** The status path waits at most `STATUS_RENEW_TIMEOUT_SECONDS = 20` (`auth_service`) for its in-line renewal, because the app's loading screen waits on `get_status`. The renewal runs as a tracked background task awaited through `asyncio.shield`, so the timeout only stops the waiting: the renewal keeps running inside the gate and saves (or reports) its result, because cancelling it after the server rotated the session cookie would lose the new cookie. On timeout this status call answers outcome `error` (not marked), the 60 s cooldown starts (a later success clears it) and `session_renew outcome=timeout` is logged. After the cooldown, a status call that finds the gate still busy waits at it as usual. The sync path renews without this bound. The all-services `get_status()` settles services concurrently (`asyncio.gather`), so it waits for the slowest renewal, not the sum.
2. **Single flight per service.** A new module, `backend/services/refresh_gate.py`, holds one `asyncio.Lock` per service, created lazily and bound to the running loop. Callers that arrive while a refresh runs wait for it and then use its result. They do not start a second refresh.
   - Every refresh path takes the gate: `get_status`, `AuthService.refresh_if_needed` (`/api/auth/refresh`), and `SyncService._authenticated_client` (`client.refresh_if_needed`).
   - After acquiring the gate, a caller reloads the stored token. If it is no longer near expiry, the caller uses it and skips the refresh.
3. **Dead-session signal.** A dead session is only declared after the refresh failed:
   - from `get_status`, after the in-place renewal failed;
   - from `/api/auth/refresh-if-needed` (`refresh_if_needed`), when its refresh fails the same way;
   - from a sync or verify, when `run_sync_task` / `run_verify_task` gets `SessionExpiredError` or `RefreshFailedError`.
   Each path calls `session_alert.report(service, kind)` with `kind` `expired` (`SessionExpiredError`, no cookies: marks at once) or `refresh_failed` (`RefreshFailedError`, or a refresh that returned `False`: marks on the second strike in a row). `report` returns whether the service is now marked. The kind of each mark is kept; an `expired` report upgrades a `refresh_failed` mark without a second toast.
   - **Clearing.** `session_alert.clear(service)` removes the mark, strikes, cooldown and retry wait, and refreshes the tray badge and tooltip. It runs after a login or logout, after a renewal with outcome `ok` / `not_expired`, after `refresh_if_needed` refreshed, and after a sync that completed (`start_sync` returned True; a no-op or a swallowed generic failure does not count).
   - **Slow retry for `refresh_failed` marks.** A `refresh_failed` mark (often just offline) still allows one renewal attempt every `MARKED_RETRY_SECONDS = 600` (`session_alert`). The retry runs from `get_status`, which the scheduler also calls; the per-service gate keeps it to one refresh (and so at most one headless browser) per service at a time. `get_status` keeps answering `session_expired` for the marked service until such a retry succeeds; a failed retry waits the full interval again. `expired` marks stay sticky until login or logout.
4. **Alerts.** The new `backend/services/session_alert.py` keeps the set of services that need a login, in memory for this app run.
   - **Windows toast.** It is sent once per expiry. While the service stays in the set, later detections log `session_alert_skipped` (reason `already_alerted`) and do not toast again. The title and body come from i18n, e.g. "櫻坂46 needs you to log in again", in all five locales. Clicking the toast opens the main window and the login dialog for that service. It uses a separate bridge handler, `desktop_bridge.open_login(service)` (registered with `set_open_login_handler`), which calls `window.__sakadeskOpenLogin(service)` in the main window. That returns `false` (logged as `notify_open_login delivered=false` with `reason` `unknown_service`, `onboarding` or `session_expired_modal`) when the service is not added or the dialog cannot show because onboarding or another service's session-expired modal is up.
   - **Tray.** While the set is non-empty, the tray icon gets a warning badge (an overlay variant of the existing icon), and the tooltip gets a first line such as "Login needed: 櫻坂46, 乃木坂46" (first, so the tray's 127-character tooltip clamp can only cut the unread summary). Both go through `desktop_bridge`, and nothing runs when no tray is registered. Clearing the last service restores the normal icon and tooltip.
   - **The setting.** The toast follows the existing `notifications_enabled` setting. The tray badge always shows.
5. **Scheduler.** `_decide` keeps calling `get_status`. Because `get_status` now renews, `not_authenticated` means a dead session. The tick log gains `reason=session_expired` for that case.
6. **Breadcrumbs.** `session_renew` (service and outcome: `ok`, `not_expired`, `no_cookies`, `dead`, `refresh_failed`, `error`, `timeout` on the status path, or `skipped` with `reason` `marked_expired`, `marked_retry_wait` or `cooldown`), `session_renew_retry` (a marked service is retried, with its kind), `session_renew_waited` / `session_renew_wait_timeout` (gate contention), `session_renew_still_expired`, `session_alert` (action `marked`, `mark_upgraded`, `cleared`, `cooldown_started`, `marked_retry_scheduled`, `toast_sent` or `toast_failed`), `session_alert_skipped` (`already_alerted`, `first_strike`, `notifications_off`), `session_alert_toast_failed` and `sync_session_success_skipped`. Errors are logged by type only. No tokens, cookies or paths.

### Frontend

- `/api/auth/status` keeps its shape. `session_expired: True` marks a dead session. `token_expired: True` without `session_expired` is still possible and means "not renewed this time, will retry": outcome `error` (e.g. a network error), a status-path timeout, the 60 s cooldown (`skipped`), or a first `refresh_failed` strike.
- The login prompt behaviour is unchanged: it opens when the status is not authenticated. That happens far less often now, because a renewable token comes back authenticated.
- The toast click opens the main window, selects the service and opens `LoginModal` for it, through the separate `open_login` bridge handler (§4).

### Error handling

- **Refresh exceptions.** A network error, a timeout or a headless-browser failure counts as a failed renewal for this check. The service is not marked dead on a network error, though: only `SessionExpiredError` or `RefreshFailedError` marks it. On other errors, `get_status` returns the old `token_expired` answer without `session_expired`, and the next tick tries again.
- **Hung refresh.** The status path stops waiting after `STATUS_RENEW_TIMEOUT_SECONDS` (outcome `error`, not marked) while the refresh continues in the background. The refresh holds the gate for at most the existing refresh timeout; gate waiters give up after `GATE_WAIT_SECONDS` (120 s) and treat it as a failed check.

- **Refinements (plan, 2026-11-09; final review).** `SessionExpiredError` (or no cookies) marks at once; `RefreshFailedError` marks after two consecutive failed renewals, so a short offline period never toasts. A failed renewal is not retried within 60 s, and a renewal whose result still reads expired (clock skew) also starts that cooldown. An `expired` mark is not renewed again until login or logout clears it; a `refresh_failed` mark is retried every `MARKED_RETRY_SECONDS` and cleared when a retry succeeds.

### Tests

- `get_status` with an expired token covers three cases:
  - the refresh succeeds: authenticated, and no alert;
  - the refresh fails with `SessionExpiredError`: a dead session, and the service is marked;
  - a network error: not marked.
- Two concurrent `get_status` calls run exactly one refresh.
- A sync and a status check also run only one refresh between them.
- `report(service, "expired")` toasts once and skips on the second call; `toast_failed` is logged when the toast is not sent. `clear` restores the tray state.
- Two offline strikes mark the service; a retry after `MARKED_RETRY_SECONDS` that succeeds clears the mark and the tray. An `expired` mark is never retried.
- Two expired services settle concurrently (about one renewal in total); a slow renewal answers the status call within `STATUS_RENEW_TIMEOUT_SECONDS` as `error` (not marked), then still completes, saves and clears in the background.
- With notifications off, there is no toast, but the badge still shows.
- The scheduler treats a renewable token as a sync, not `not_authenticated`.
- Breadcrumb fields contain no secrets.

## B2. Read-state hydration keeps retrying and saves what was read meanwhile

### Problem

`hydrateConversations` (`frontend/src/core/persistence/persisted.ts`) tries four times, after delays of 0.5, 1 and 2 s. If all four fail, `convReady` stays false for the whole session. `saveReadState` (`readStateStore.ts`) and `markVoiceHeard` then skip every write. Skipping is intended, because writing a state derived from the empty fallback would overwrite stored progress. But everything read in that session is lost.

### Design

1. **Keep retrying.** After the initial attempts fail, hydration keeps retrying in the background with backoff: 5 s, 15 s, 30 s, then every 60 s until it succeeds. Each retry logs `conv_hydrate_retry` with its index. Success after a failure logs `conv_hydrate_recovered` with the attempt count. There is one retry loop per app run, and it stops on success.
2. **Pending saves.** While the cache is not ready, `saveReadState` keeps the newest `ReadState` per chat path in an in-memory map instead of dropping it. The existing `read_state_save_skipped` log becomes `read_state_save_deferred`, still once per chat per session.
3. **Merge on recovery.** When hydration succeeds, each pending entry is compared with the stored row.
   - The pending state is written (cache, backend and the search-copy PUT, as in a normal save) only if it is further ahead: a larger `lastReadId`, or the same `lastReadId` with any field that only grows. Otherwise it is dropped.
   - After the merge, the read-state subscribers (`subscribeReadState`) are notified once per written path, and the conversations-ready listeners run once (the sidebar unread counts and the tray tooltip refresh).
   - **Open chat.** A chat opened while the cache was not ready holds a state derived from the empty fallback. On recovery `MessagesFeature` merges the now-loaded row into it monotonically (`mergeReadState`), so its next reveal can never write the fallback-derived state over stored progress.
   - Logs `read_state_pending_flushed` with the written and dropped counts.
4. **Voice marks.** `markVoiceHeard` keeps returning `null` while the cache is not ready, so the backend retries later. That is already correct. The return value only changes once the cache is ready, through recovery.

### Tests

- Hydration fails four times, then succeeds on a background retry:
  - `convReady` becomes true, and `conv_hydrate_recovered` is logged.
  - Fake timers check the backoff schedule.
- Saves made while not ready are deferred:
  - Deferred saves that are further ahead are flushed after recovery.
  - Deferred saves that are behind the stored row are dropped.
  - Subscribers are notified once.
- No write happens before the cache is ready (the regression guard for the original reason to skip).

## B4. The call popup is only our call card, with no dark square frame

### Problem (user screenshot, 2026-11-09)

The popup window (`call_popup_window.py`) is a frameless WebView2 window. It has a dark background (`#0D0F14`), small DWM rounded corners (`DWMWCP_ROUND`, about 8 px) and a DWM shadow. The page fills the window, but the ringing halo and the card's visible edge are drawn inset by 8 px with a 16 px radius (`.sd-call-halo--inset`). A dark square rim therefore shows between the window edge and our rounded card.

### Design

1. **Primary: full bleed.** The call card fills the window edge to edge, and its corner radius matches the window's DWM corner.
   - Remove the 8 px inset: the halo uses `inset: 0` and follows the window's corner radius. **As implemented:** `.sd-call-halo--inset` is `inset: 0; border-radius: 8px`.
   - The window and body background match the card's own edge colour, so no dark band can appear. **As implemented:** not changed yet; the window background stays `#0D0F14` until the native-pixel Windows capture shows whether it is needed.
   - The native DWM rounded corners and shadow form the frame: antialiased, with no transparency tricks.
   - On Windows 10 (no corner preference), the corners are square but the rim is still gone.
2. **Fallback, only if the primary looks wrong on Windows: a transparent window.** Use pywebview `transparent=True`, a transparent WebView2 background, and the rounded card drawn by CSS.
   - This is tried only if the primary cannot match the look. Colour-key transparency can leave a fringe on antialiased edges.
   - The choice is made from native-pixel captures on Windows, and it is shown to the user before merge.
3. **The ringing glow.** It moves to the inside of the card edge, so it is never clipped by the window bounds.

### Verification

- Windows build. The test call is fired the way C3 acceptance did it, and the popup is captured as native pixels via CDP. A full-screen grab is never used, per the user's privacy rule.
- Before/after captures go on the comparison page for the user.
- Tests: the existing popup layout tests are updated (no inset, matching radius). `call_popup_window` keeps its style tests.

## Out of scope

- **Memories (回憶).** It is the next sub-project, with its own spec.
- **Changing the cookie refresh itself (pysaka).**
- **Retrying the headless-browser fallback on a schedule.** The gate and the scheduler's own interval are enough.
