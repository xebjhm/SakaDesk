# 0.4.2 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renew expired access tokens silently and alert only on a dead session. Keep retrying read-state hydration and save what was read in the meantime. Remove the dark square frame around the call popup.

**Architecture:**
- B1: a per-service single-flight gate (`refresh_gate`) wraps every token refresh. `AuthService.get_status` renews an expired token in place. A new `session_alert` module owns the "needs login" set, the one-time Windows toast and the tray badge and tooltip line. `desktop.py` and the frontend route a toast click to the login dialog.
- B2: `persisted.ts` keeps a background retry loop and a ready listener. `readStateStore.ts` defers saves and merges them on recovery.
- B4: the popup page fills the window edge to edge. It is verified on Windows with native-pixel captures.

**Tech Stack:** Python 3.9+ (FastAPI, asyncio, structlog, pystray, Pillow, windows-toasts), pytest; React 18 + TypeScript, vitest; pywebview 5.3.2 (WebView2).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-09-v042-reliability-design.md`.
- Use `uv run` for every Python command; never pip. Commit with `uv run git commit` (pre-commit is only on the uv PATH).
- Logs carry ids, codes and counts only. Never log tokens, cookies, paths, names or message text.
- Every decision, failure and skip path leaves a structured breadcrumb.
- All file I/O uses `encoding="utf-8"`. No `print()`. No `time.sleep()`.
- User-facing strings live in i18n: the backend `backend/i18n/<lang>/*.json`, the frontend `frontend/src/i18n/locales/*.json`. The five locales are en, ja, zh-TW, zh-CN and yue.
- UI uses design-system tokens only. Commit subjects follow Conventional Commits, ≤ 72 chars, and end with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- **Spec refinement (made in this plan):**
  - `SessionExpiredError` marks the session dead at once.
  - `RefreshFailedError` marks it only after **two consecutive** failed renewals, so a brief offline period after waking (cookie refresh and headless both fail) never raises a false "log in again" toast.
  - Renewal for a service is not re-attempted within `RENEW_RETRY_SECONDS = 60` after a failure. While the service is marked dead, it is not re-attempted at all until login.
  - These refinements are recorded in the spec in Task 8.

---

## File map

| File | Responsibility |
|---|---|
| `backend/services/refresh_gate.py` (new) | per-service single-flight lock for token refreshes |
| `backend/services/session_alert.py` (new) | needs-login set, failure counting, retry cooldown, toast once, tray alert |
| `backend/services/auth_service.py` | `renew_expired()`; `get_status` renews; `refresh_if_needed` gated; login clears alert |
| `backend/services/sync_service.py` | `_authenticated_client` under the gate |
| `backend/api/sync.py` | `run_sync_task` reports dead / failed / success to `session_alert` |
| `backend/services/auto_sync_scheduler.py` | `session_expired` tick reason |
| `backend/services/notification_service.py` | `show_login` / `send_login_alert`, click → `desktop_bridge.open_login` |
| `backend/services/desktop_bridge.py` | open-login handler, tray-alert handler |
| `backend/services/tray_tooltip.py` | login-needed line in the tooltip |
| `backend/i18n/*/notifications.json`, `backend/i18n/*/tray.json` | login toast and tooltip strings |
| `tray.py` | `TrayController.set_alert(on)` badge icon |
| `desktop.py` | `make_open_login_handler`, wiring |
| `frontend/src/shell/App.tsx`, `frontend/src/utils/clientLog.ts` | `window.__sakadeskOpenLogin` |
| `frontend/src/core/persistence/persisted.ts` | background hydration retry + `onConversationsReady` |
| `frontend/src/features/messages/readStateStore.ts` | deferred saves, `mergeReadStates`, flush |
| `frontend/src/features/messages/MessagesFeature.tsx` | bump `readStateVersion` on recovery |
| `frontend/src/features/incomingCall/callScreen.css`, `frontend/src/features/callPopup/callPopup.css`, `call_popup_window.py` | popup frame |

---

### Task 1: Refresh gate

**Files:**
- Create: `backend/services/refresh_gate.py`
- Test: `backend/tests/test_refresh_gate.py`

**Interfaces:**
- Produces: `refresh_gate.hold(service: str)`, an async context manager that holds the service's lock and waits at most `GATE_WAIT_SECONDS = 120.0`. On timeout it raises `asyncio.TimeoutError`.

- [ ] **Step 1: Write the failing test**

```python
"""Single-flight refresh gate (spec B1 §2)."""

import asyncio

import pytest
from structlog.testing import capture_logs

from backend.services import refresh_gate


@pytest.mark.asyncio
async def test_same_service_runs_one_at_a_time():
    order: list[str] = []

    async def worker(tag: str):
        async with refresh_gate.hold("hinatazaka46"):
            order.append(f"{tag}-in")
            await asyncio.sleep(0.01)
            order.append(f"{tag}-out")

    with capture_logs() as logs:
        await asyncio.gather(worker("a"), worker("b"))
    assert order == ["a-in", "a-out", "b-in", "b-out"]
    assert [e["event"] for e in logs].count("session_renew_waited") == 1


@pytest.mark.asyncio
async def test_different_services_do_not_block():
    entered = asyncio.Event()

    async def holder():
        async with refresh_gate.hold("hinatazaka46"):
            await entered.wait()

    task = asyncio.create_task(holder())
    await asyncio.sleep(0)
    async with refresh_gate.hold("sakurazaka46"):
        entered.set()
    await task


@pytest.mark.asyncio
async def test_wait_times_out(monkeypatch):
    monkeypatch.setattr(refresh_gate, "GATE_WAIT_SECONDS", 0.01)
    release = asyncio.Event()

    async def holder():
        async with refresh_gate.hold("yodel"):
            await release.wait()

    task = asyncio.create_task(holder())
    await asyncio.sleep(0)
    with pytest.raises(asyncio.TimeoutError):
        async with refresh_gate.hold("yodel"):
            pass
    release.set()
    await task
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run pytest backend/tests/test_refresh_gate.py -q`
Expected: FAIL, `ImportError: cannot import name 'refresh_gate'`.

- [ ] **Step 3: Implement**

```python
"""Per-service single-flight gate for access-token refreshes (spec B1 §2).

Every refresh rotates the session cookie, so two concurrent refreshes for one
service can invalidate each other. ``AuthService.get_status`` /
``refresh_if_needed`` and ``SyncService._authenticated_client`` all refresh
inside ``hold(service)``; a caller that waited re-reads the stored token and
usually finds it already renewed. Locks are created lazily and re-created when
the running loop changes (tests, restarts).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog

logger = structlog.get_logger(__name__)

GATE_WAIT_SECONDS = 120.0

_locks: dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Lock]] = {}


def _lock_for(service: str) -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    entry = _locks.get(service)
    if entry is None or entry[0] is not loop:
        entry = (loop, asyncio.Lock())
        _locks[service] = entry
    return entry[1]


@asynccontextmanager
async def hold(service: str) -> AsyncIterator[None]:
    """Hold ``service``'s refresh lock; raises ``asyncio.TimeoutError`` after ``GATE_WAIT_SECONDS``."""
    lock = _lock_for(service)
    contended = lock.locked()
    await asyncio.wait_for(lock.acquire(), GATE_WAIT_SECONDS)
    if contended:
        logger.info("session_renew_waited", service=service)
    try:
        yield
    finally:
        lock.release()
```

- [ ] **Step 4: Run it to verify it passes**

Run: `uv run pytest backend/tests/test_refresh_gate.py -q`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/refresh_gate.py backend/tests/test_refresh_gate.py
uv run git commit -m "feat(auth): add a per-service single-flight refresh gate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Session alert core (needs-login set, toast once, tray hooks, strings)

**Files:**
- Create: `backend/services/session_alert.py`
- Modify: `backend/services/desktop_bridge.py` (open-login + tray-alert handlers)
- Modify: `backend/services/notification_service.py` (`show_login`, `send_login_alert`)
- Modify: `backend/services/tray_tooltip.py` (login line)
- Modify: `backend/i18n/{en,ja,zh-TW,zh-CN,yue}/notifications.json`, `backend/i18n/{en,ja,zh-TW,zh-CN,yue}/tray.json`
- Test: `backend/tests/test_session_alert.py`; extend `backend/tests/test_desktop_bridge.py`, `backend/tests/test_tray_tooltip.py`

**Interfaces:**
- Produces:
  - `session_alert.RENEW_RETRY_SECONDS = 60.0` and `REFRESH_FAILED_STRIKES = 2`.
  - `async report(service: str, kind: Literal["expired", "refresh_failed"]) -> bool` returns whether the service is now marked.
  - `report_success(service: str) -> None` resets strikes and cooldown; it does not clear a mark.
  - `async clear(service: str) -> None` runs after a login.
  - `needs_login(service: str) -> bool` and `needs_login_services() -> list[str]` (sorted).
  - `may_renew(service: str, now: float | None = None) -> bool` is False while marked or inside the cooldown.
  - `note_renew_failure(service: str, now: float | None = None) -> None` starts the cooldown.
  - `_reset_for_tests()`.
- Produces in `desktop_bridge`:
  - `set_open_login_handler(handler: Callable[[str], None] | None)`
  - `open_login(service: str) -> None`
  - `set_tray_alert_handler(handler: Callable[[bool], None] | None)`
  - `set_tray_alert(on: bool) -> None`
  - None of them raises. When no handler is registered, each logs `*_unhandled` once.
- Produces in `notification_service`: `async send_login_alert(service: str, title: str, body: str) -> bool`.

- [ ] **Step 1: Add the strings**

Add these keys to each locale (keep the existing keys and valid JSON).

`backend/i18n/<lang>/notifications.json`:

| lang | `login_title` | `login_body` |
|---|---|---|
| en | `{service}: please log in again` | `Background sync is paused. Click to log in.` |
| ja | `{service}：再ログインが必要です` | `バックグラウンド同期を停止しています。クリックしてログインしてください。` |
| zh-TW | `{service} 需要重新登入` | `背景同步已暫停，點一下重新登入。` |
| zh-CN | `{service} 需要重新登录` | `后台同步已暂停，点击重新登录。` |
| yue | `{service} 要重新登入` | `背景同步暫停咗，撳一下重新登入。` |

`backend/i18n/<lang>/tray.json`, key `tooltip_login`: en `Login needed: {services}`, ja `再ログインが必要: {services}`, zh-TW `需要重新登入：{services}`, zh-CN `需要重新登录：{services}`, yue `要重新登入：{services}`.

- [ ] **Step 2: Write the failing tests** (`backend/tests/test_session_alert.py`)

```python
"""session_alert: needs-login set, strikes, cooldown, toast once (spec B1 §3-4)."""

from unittest.mock import AsyncMock, patch

import pytest
from structlog.testing import capture_logs

from backend.services import session_alert


@pytest.fixture(autouse=True)
def _reset():
    session_alert._reset_for_tests()
    yield
    session_alert._reset_for_tests()


def _patches(enabled=True):
    return (
        patch.object(session_alert, "_load_settings", AsyncMock(return_value={"notifications_enabled": enabled, "language": "en"})),
        patch.object(session_alert, "send_login_alert", AsyncMock(return_value=True)),
        patch.object(session_alert.desktop_bridge, "set_tray_alert"),
        patch.object(session_alert, "schedule_refresh"),
    )


@pytest.mark.asyncio
async def test_expired_marks_and_toasts_once():
    p1, p2, p3, p4 = _patches()
    with p1, p2 as toast, p3 as tray, p4, capture_logs() as logs:
        assert await session_alert.report("sakurazaka46", "expired") is True
        assert await session_alert.report("sakurazaka46", "expired") is True
    toast.assert_awaited_once()
    service, title, body = toast.await_args.args
    assert service == "sakurazaka46" and "櫻坂46" in title and body
    tray.assert_called_with(True)
    assert session_alert.needs_login("sakurazaka46")
    assert any(e["event"] == "session_alert_skipped" and e["reason"] == "already_alerted" for e in logs)
    assert "token" not in repr(logs).lower()


@pytest.mark.asyncio
async def test_refresh_failed_needs_two_strikes():
    p1, p2, p3, p4 = _patches()
    with p1, p2 as toast, p3, p4:
        assert await session_alert.report("yodel", "refresh_failed") is False
        assert not session_alert.needs_login("yodel")
        assert await session_alert.report("yodel", "refresh_failed") is True
    toast.assert_awaited_once()


@pytest.mark.asyncio
async def test_success_resets_strikes():
    p1, p2, p3, p4 = _patches()
    with p1, p2, p3, p4:
        await session_alert.report("yodel", "refresh_failed")
        session_alert.report_success("yodel")
        assert await session_alert.report("yodel", "refresh_failed") is False


@pytest.mark.asyncio
async def test_notifications_off_no_toast_but_tray_badge():
    p1, p2, p3, p4 = _patches(enabled=False)
    with p1, p2 as toast, p3 as tray, p4, capture_logs() as logs:
        await session_alert.report("nogizaka46", "expired")
    toast.assert_not_awaited()
    tray.assert_called_with(True)
    assert any(e["event"] == "session_alert_skipped" and e["reason"] == "notifications_off" for e in logs)


@pytest.mark.asyncio
async def test_clear_restores_tray_when_last():
    p1, p2, p3, p4 = _patches()
    with p1, p2, p3 as tray, p4:
        await session_alert.report("nogizaka46", "expired")
        await session_alert.report("yodel", "expired")
        await session_alert.clear("nogizaka46")
        tray.assert_called_with(True)
        await session_alert.clear("yodel")
        tray.assert_called_with(False)
    assert session_alert.needs_login_services() == []


def test_may_renew_cooldown_and_mark():
    assert session_alert.may_renew("hinatazaka46", now=0.0)
    session_alert.note_renew_failure("hinatazaka46", now=0.0)
    assert not session_alert.may_renew("hinatazaka46", now=30.0)
    assert session_alert.may_renew("hinatazaka46", now=61.0)
```

- [ ] **Step 3: Run them to verify they fail**

Run: `uv run pytest backend/tests/test_session_alert.py -q`
Expected: FAIL, `ImportError`.

- [ ] **Step 4: Add the `desktop_bridge` handlers**

Append to `backend/services/desktop_bridge.py`, following the existing `open_window` and `set_tray_tooltip` style:

```python
_open_login_handler: Callable[[str], None] | None = None
_tray_alert_handler: Callable[[bool], None] | None = None


def set_open_login_handler(handler: Callable[[str], None] | None) -> None:
    """Register (or clear) the host function that opens the login dialog for a service."""
    global _open_login_handler
    _open_login_handler = handler


def open_login(service: str) -> None:
    """Show the main window on ``service``'s login dialog. Never raises."""
    handler = _open_login_handler
    if handler is None:
        logger.info("login_open_unhandled", reason="no_handler")
        return
    try:
        handler(service)
    except Exception as e:
        logger.warning("login_open_failed", error_type=type(e).__name__)


def set_tray_alert_handler(handler: Callable[[bool], None] | None) -> None:
    """Register (or clear) the tray's warning-badge switch."""
    global _tray_alert_handler
    _tray_alert_handler = handler


def set_tray_alert(on: bool) -> None:
    """Turn the tray warning badge on or off. Never raises; no-op without a tray."""
    handler = _tray_alert_handler
    if handler is None:
        logger.debug("tray_alert_unhandled", reason="no_handler")
        return
    try:
        handler(on)
    except Exception as e:
        logger.warning("tray_alert_failed", error_type=type(e).__name__)
```

Tests to add in `backend/tests/test_desktop_bridge.py`:
- `open_login` calls the handler with the service.
- With no handler, `open_login` logs `login_open_unhandled`.
- A raising handler is caught (`login_open_failed`).
- `set_tray_alert` passes the bool through.

- [ ] **Step 5: Add `show_login` and `send_login_alert` to `notification_service.py`**

- Add `def show_login(self, service: str, title: str, body: str) -> bool: ...` to the `Notifier` protocol.
- `_UnavailableNotifier.show_login` raises the same way its `show_simple` does.
- `WindowsNotifier.show_login` copies `show_simple`, except: `toast.tag = f"login-{service}"`, `toast.group = _SIMPLE_GROUP`, and `toast.on_activated = lambda _args: self._on_login_click(service)`.
- Add:

```python
    def _on_login_click(self, service: str) -> None:
        """WinRT-thread ``on_activated`` callback for a login toast. Never raises."""
        try:
            logger.info("notify_clicked", kind="login", service=service)
            desktop_bridge.open_login(service)
        except Exception as e:  # pragma: no cover - open_login never raises
            logger.warning("login_open_failed", error_type=type(e).__name__)
```

and the module function:

```python
async def send_login_alert(service: str, title: str, body: str) -> bool:
    """Show the "log in again" toast for ``service``; return whether it showed. Never raises.

    Same worker thread, queue, stuck guard and timeout as other toasts. The
    caller (session_alert) applies the notifications setting. Logged as
    ``notify_sent`` / ``notify_failed`` with ``kind=login``; text never logged.
    """
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info("notify_skip", reason="unavailable", kind="login", backend_reason=status.get("last_error"))
        return False
    return await _run_guarded(
        lambda: notifier.show_login(service, title, body),
        {"kind": "login", "service": service},
        skip_extra={},
        sent_extra={},
    )
```

Test in the existing notification-service tests, following the `send_simple` ones: with a fake notifier, `send_login_alert` calls `show_login` with the same arguments and logs `kind=login`. A `_on_login_click` with a patched `desktop_bridge.open_login` calls it with the service.

- [ ] **Step 6: Implement `backend/services/session_alert.py`**

```python
"""Services whose session is dead and need a login (spec B1 §3-4).

``report`` is called after a renewal or sync failed: ``expired`` (the server
says the session is gone, ``SessionExpiredError`` / no cookies) marks at once;
``refresh_failed`` (``RefreshFailedError``: every refresh method failed, which
also happens briefly offline) marks after ``REFRESH_FAILED_STRIKES`` in a row.
Marking sends one Windows toast per expiry (when notifications are on), turns
the tray badge on and refreshes the tray tooltip (which lists marked services).
``clear`` runs after a successful login. State is in memory for this app run.
Logs ids and reasons only.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Literal

import structlog

from backend.services import desktop_bridge
from backend.services.i18n import get_strings, resolve_ui_language
from backend.services.notification_service import send_login_alert
from backend.services.service_utils import get_service_display_name
from backend.services.settings_store import load_config
from backend.services.tray_tooltip import schedule_refresh

logger = structlog.get_logger(__name__)

RENEW_RETRY_SECONDS = 60.0
REFRESH_FAILED_STRIKES = 2

_marked: set[str] = set()
_strikes: dict[str, int] = {}
_cooldown_until: dict[str, float] = {}


async def _load_settings() -> dict[str, Any]:
    return dict(await load_config())


def needs_login(service: str) -> bool:
    return service in _marked


def needs_login_services() -> list[str]:
    return sorted(_marked)


def may_renew(service: str, now: float | None = None) -> bool:
    """False while ``service`` is marked or inside its retry cooldown."""
    if service in _marked:
        return False
    now = time.monotonic() if now is None else now
    return now >= _cooldown_until.get(service, 0.0)


def note_renew_failure(service: str, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    _cooldown_until[service] = now + RENEW_RETRY_SECONDS


def report_success(service: str) -> None:
    """A renewal or sync worked: reset strikes and cooldown (a mark stays until login)."""
    _strikes.pop(service, None)
    _cooldown_until.pop(service, None)


async def report(service: str, kind: Literal["expired", "refresh_failed"]) -> bool:
    """Record a failure; return whether ``service`` is (now) marked as needing a login."""
    if service in _marked:
        logger.info("session_alert_skipped", service=service, reason="already_alerted", kind=kind)
        return True
    if kind == "refresh_failed":
        _strikes[service] = _strikes.get(service, 0) + 1
        if _strikes[service] < REFRESH_FAILED_STRIKES:
            logger.info("session_alert_skipped", service=service, reason="first_strike", kind=kind)
            return False
    _marked.add(service)
    _strikes.pop(service, None)
    logger.info("session_alert", action="marked", service=service, kind=kind)
    desktop_bridge.set_tray_alert(True)
    schedule_refresh()
    await _toast(service)
    return True


async def _toast(service: str) -> None:
    try:
        settings = await _load_settings()
        if not settings.get("notifications_enabled", True):
            logger.info("session_alert_skipped", service=service, reason="notifications_off")
            return
        language = await asyncio.to_thread(resolve_ui_language, settings)
        strings = get_strings("notifications", language)
        title = strings["login_title"].format(service=get_service_display_name(service))
        sent = await send_login_alert(service, title, strings["login_body"])
        logger.info("session_alert", action="toast_sent" if sent else "toast_failed", service=service)
    except Exception as e:
        logger.warning("session_alert_toast_failed", service=service, error_type=type(e).__name__)


async def clear(service: str) -> None:
    """A login succeeded: forget the mark, strikes and cooldown."""
    was_marked = service in _marked
    _marked.discard(service)
    report_success(service)
    if not was_marked:
        return
    logger.info("session_alert", action="cleared", service=service)
    desktop_bridge.set_tray_alert(bool(_marked))
    schedule_refresh()


def _reset_for_tests() -> None:
    _marked.clear()
    _strikes.clear()
    _cooldown_until.clear()
```

If importing `notification_service` or `tray_tooltip` at module top creates a cycle, import them inside `_toast` / `report` / `clear` and keep `send_login_alert` and `schedule_refresh` as module attributes for patching. Check with `uv run python -c "import backend.services.session_alert"`.

- [ ] **Step 7: Add the tooltip login line** (`backend/services/tray_tooltip.py`, in `refresh_tray_tooltip` after computing `text`)

```python
            from backend.services import session_alert  # local: session_alert imports this module

            marked = session_alert.needs_login_services()
            if marked:
                names = ", ".join(get_service_display_name(s) for s in marked)
                text = f"{text}\n{get_strings('tray', language)['tooltip_login'].format(services=names)}"
            desktop_bridge.set_tray_tooltip(text)
            logger.info("tray_tooltip", unread=unread, login_needed=len(marked))
```

Import `get_service_display_name` from `backend.services.service_utils` at the top. Test in `backend/tests/test_tray_tooltip.py`: with `session_alert` marking `sakurazaka46` (patch `needs_login_services` to return `["sakurazaka46"]`), the pushed tooltip ends with `Login needed: 櫻坂46`.

- [ ] **Step 8: Run the tests**

Run: `uv run pytest backend/tests/test_session_alert.py backend/tests/test_desktop_bridge.py backend/tests/test_tray_tooltip.py -q` and the notification-service test file.
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add backend/services/session_alert.py backend/services/desktop_bridge.py backend/services/notification_service.py backend/services/tray_tooltip.py backend/i18n backend/tests
uv run git commit -m "feat(auth): alert once when a session needs a new login" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: AuthService renews expired tokens in place

**Files:**
- Modify: `backend/services/auth_service.py`
- Test: `backend/tests/test_auth_renewal.py` (new); update `backend/tests/test_auth_service*.py` where they expect `token_expired`

**Interfaces:**
- Consumes: `refresh_gate.hold`; `session_alert.report`, `report_success`, `clear`, `may_renew`, `note_renew_failure` and `needs_login`.
- Produces: `AuthService.renew_expired(service: str) -> str`. It returns one of `"ok"`, `"not_expired"`, `"no_cookies"`, `"dead"`, `"refresh_failed"`, `"error"`, `"skipped"`.
- Produces the `get_status` contract. Per service, the status adds `session_expired: True` only for a dead session. `token_expired: True` without `session_expired` means "not renewed this time, will retry".

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_auth_renewal.py`)

```python
"""get_status renews an expired token before saying "log in" (spec B1 §1)."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from pysaka import RefreshFailedError, SessionExpiredError

from backend.services import session_alert
from backend.services.auth_service import AuthService

EXPIRED = {"authenticated": False, "token_expired": True, "expires_at": 1, "message": "x"}
VALID = {"authenticated": True, "expires_at": 9, "app_id": None, "storage_type": "secure"}


@pytest.fixture(autouse=True)
def _reset():
    session_alert._reset_for_tests()
    with patch.object(session_alert, "report", AsyncMock(side_effect=lambda s, k: k == "expired")) as rep:
        yield rep
    session_alert._reset_for_tests()


def _svc(statuses, outcome):
    svc = AuthService()
    seq = iter(statuses)
    svc._get_service_auth_status = lambda s: next(seq)  # type: ignore[method-assign]
    svc.renew_expired = AsyncMock(return_value=outcome)  # type: ignore[method-assign]
    return svc


@pytest.mark.asyncio
async def test_renewed_token_reads_authenticated(_reset):
    svc = _svc([EXPIRED, VALID], "ok")
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        status = await svc.get_status("sakurazaka46")
    assert status["authenticated"] is True
    _reset.assert_not_awaited()


@pytest.mark.asyncio
async def test_dead_session_is_marked(_reset):
    svc = _svc([EXPIRED], "dead")
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        status = await svc.get_status("sakurazaka46")
    assert status["session_expired"] is True and status["authenticated"] is False
    _reset.assert_awaited_once_with("sakurazaka46", "expired")


@pytest.mark.asyncio
async def test_network_error_is_not_marked(_reset):
    svc = _svc([EXPIRED], "error")
    with patch("backend.services.auth_service.is_test_mode", return_value=False):
        status = await svc.get_status("sakurazaka46")
    assert status.get("session_expired") is None and status["token_expired"] is True
    _reset.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_renewals_refresh_once():
    svc = AuthService()
    calls = 0

    async def fake_refresh(self, session):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return True

    tokens = iter([("old", True), ("new", False), ("new", False)])

    def load(_svc):
        token, expired = next(tokens)
        return {"access_token": token, "cookies": {"session": "c"}}, expired

    svc._load_token_for_renewal = load  # type: ignore[method-assign]
    svc._save_refreshed = lambda service, client: None  # type: ignore[method-assign]
    with patch("backend.services.auth_service.Client.refresh_access_token", fake_refresh):
        results = await asyncio.gather(svc.renew_expired("yodel"), svc.renew_expired("yodel"))
    assert calls == 1
    assert sorted(results) == ["not_expired", "ok"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exc,outcome",
    [(SessionExpiredError("x"), "dead"), (RefreshFailedError("x"), "refresh_failed"), (OSError("x"), "error")],
)
async def test_renew_maps_failures(exc, outcome):
    svc = AuthService()
    svc._load_token_for_renewal = lambda s: ({"access_token": "t", "cookies": {"session": "c"}}, True)  # type: ignore[method-assign]
    with patch("backend.services.auth_service.Client.refresh_access_token", AsyncMock(side_effect=exc)):
        assert await svc.renew_expired("yodel") == outcome


@pytest.mark.asyncio
async def test_no_cookies_is_dead():
    svc = AuthService()
    svc._load_token_for_renewal = lambda s: ({"access_token": "t", "cookies": {}}, True)  # type: ignore[method-assign]
    assert await svc.renew_expired("yodel") == "no_cookies"
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest backend/tests/test_auth_renewal.py -q`
Expected: FAIL (`renew_expired` / `_load_token_for_renewal` missing; no `session_expired`).

- [ ] **Step 3: Implement in `auth_service.py`**

Add the imports `from pysaka import RefreshFailedError, SessionExpiredError` (into the existing pysaka import) and `from backend.services import refresh_gate, session_alert`. Then:

1. **Extract `_save_refreshed(self, service: str, client: Client) -> float`.** Move the save block from `refresh_if_needed` into it: `tm.save_session(...)`, `self._invalidate_session_cache(group.value)`, then return the new remaining seconds. `refresh_if_needed` calls it.
2. **Add `_load_token_for_renewal`:**

```python
    def _load_token_for_renewal(self, service: str) -> tuple[Optional[dict], bool]:
        """Fresh (uncached) stored session and whether its token is expired."""
        group = self._get_group(service)
        self._invalidate_session_cache(group.value)
        data = self._load_session_cached(group.value)
        token = (data or {}).get("access_token")
        return data, bool(token) and self._is_token_expired(token)
```

3. **Add `renew_expired`:**

```python
    async def renew_expired(self, service: str) -> str:
        """Renew ``service``'s expired token with its session cookie, single-flight.

        Returns ``ok`` (renewed and saved), ``not_expired`` (another caller renewed
        it while we waited), ``no_cookies``, ``dead`` (SessionExpiredError),
        ``refresh_failed`` (RefreshFailedError), ``error`` (anything else, e.g.
        offline or a gate timeout) or ``skipped`` (marked dead or inside the retry
        cooldown). Logs ``session_renew``; never raises.
        """
        if not session_alert.may_renew(service):
            logger.info("session_renew", service=service, outcome="skipped")
            return "skipped"
        try:
            async with refresh_gate.hold(service):
                data, expired = await asyncio.to_thread(self._load_token_for_renewal, service)
                if not data or not expired:
                    outcome = "not_expired"
                elif not data.get("cookies"):
                    outcome = "no_cookies"
                else:
                    client = Client(
                        group=self._get_group(service),
                        access_token=data["access_token"],
                        cookies=data.get("cookies"),
                        auth_dir=self._session_dir,
                    )
                    async with aiohttp.ClientSession() as session:
                        await client.refresh_access_token(session)
                    await asyncio.to_thread(self._save_refreshed, service, client)
                    outcome = "ok"
        except SessionExpiredError:
            outcome = "dead"
        except RefreshFailedError:
            outcome = "refresh_failed"
        except Exception as e:
            logger.warning("session_renew_error", service=service, error_type=type(e).__name__)
            outcome = "error"
        if outcome in ("ok", "not_expired"):
            session_alert.report_success(service)
        elif outcome in ("refresh_failed", "error"):
            session_alert.note_renew_failure(service)
        logger.info("session_renew", service=service, outcome=outcome)
        return outcome
```

4. **Change `get_status`.** It keeps the current status computation (test mode is unchanged), then post-processes:

```python
    async def _settle(self, service: str, status: dict) -> dict:
        """Renew an expired token, then report the live status (spec B1 §1)."""
        if session_alert.needs_login(service):
            return {**status, "authenticated": False, "session_expired": True}
        if not status.get("token_expired"):
            return status
        outcome = await self.renew_expired(service)
        if outcome in ("ok", "not_expired"):
            return await asyncio.to_thread(self._get_service_auth_status, service)
        if outcome in ("dead", "no_cookies"):
            await session_alert.report(service, "expired")
            return {**status, "session_expired": True}
        if outcome == "refresh_failed" and await session_alert.report(service, "refresh_failed"):
            return {**status, "session_expired": True}
        return status
```

- Single service: `status = await asyncio.to_thread(...); return await self._settle(service, status)`.
- All services: compute the dict as today, then `for s, st in list(statuses.items()): statuses[s] = await self._settle(s, st)`. Sequential is fine: renewals are rare and gated.

5. **`refresh_if_needed`.** Wrap everything after the test-mode return in `async with refresh_gate.hold(service):`. Inside the gate, call `self._invalidate_session_cache(group.value)` before `_load_session_cached`, so a waiter sees the token another caller just renewed. On a successful refresh, call `session_alert.report_success(service)`.
6. **`login_with_browser`.** Right after `logger.info("Login successful, credentials saved to TokenManager", ...)`, add `await session_alert.clear(service)`.

- [ ] **Step 4: Run the new and existing auth tests**

Run: `uv run pytest backend/tests/test_auth_renewal.py backend/tests/test_auth_service.py backend/tests/test_auth_service_cache.py backend/tests/test_auth_service_extended.py -q`
Expected:
- The new tests pass.
- Existing tests that build an expired token and assert `token_expired` may now attempt a renewal. In those tests, patch `AuthService.renew_expired` to `AsyncMock(return_value="error")`. That keeps the old answer and is the documented "will retry" contract. Do not weaken any other assertion.

- [ ] **Step 5: Commit**

```bash
git add backend/services/auth_service.py backend/tests
uv run git commit -m "feat(auth): renew expired tokens before reporting logged out" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Sync path under the gate; sync results feed the alert; scheduler reason

**Files:**
- Modify: `backend/services/sync_service.py` (`_authenticated_client`)
- Modify: `backend/api/sync.py` (`run_sync_task`, `run_verify_task`)
- Modify: `backend/services/auto_sync_scheduler.py`
- Test: `backend/tests/test_sync_session_alert.py` (new); extend the scheduler tests (`grep -l auto_sync backend/tests`)

**Interfaces:**
- Consumes: `refresh_gate.hold`; `session_alert.report`, `report_success` and `needs_login`.
- Produces: the scheduler constant `REASON_SESSION_EXPIRED = "session_expired"`.

- [ ] **Step 1: Write the failing tests**

```python
"""Sync failures and successes feed session_alert (spec B1 §3, §5)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pysaka import RefreshFailedError, SessionExpiredError

import backend.api.sync as sync_api


@pytest.mark.asyncio
@pytest.mark.parametrize("exc,kind", [(SessionExpiredError("x"), "expired"), (RefreshFailedError("x"), "refresh_failed")])
async def test_sync_failure_reports(exc, kind):
    svc = MagicMock(start_sync=AsyncMock(side_effect=exc))
    with (
        patch.object(sync_api, "get_sync_service", return_value=svc),
        patch.object(sync_api, "schedule_refresh"),
        patch("backend.api.sync.session_alert.report", AsyncMock(return_value=True)) as report,
    ):
        await sync_api.run_sync_task("sakurazaka46", False, False)
    report.assert_awaited_once_with("sakurazaka46", kind)


@pytest.mark.asyncio
async def test_sync_success_reports_success():
    svc = MagicMock(start_sync=AsyncMock(return_value=None))
    with (
        patch.object(sync_api, "get_sync_service", return_value=svc),
        patch.object(sync_api, "schedule_refresh"),
        patch("backend.api.sync.session_alert.report_success") as ok,
    ):
        await sync_api.run_sync_task("sakurazaka46", False, False)
    ok.assert_called_once_with("sakurazaka46")


@pytest.mark.asyncio
async def test_authenticated_client_takes_the_gate():
    from backend.services.sync_service import SyncService

    svc = SyncService("yodel")
    entered: list[str] = []

    class Gate:
        def __init__(self, s):
            entered.append(s)

        async def __aenter__(self):
            return None

        async def __aexit__(self, *a):
            return False

    svc.load_config = AsyncMock(return_value={})  # no token: raises after the gate
    with patch("backend.services.sync_service.refresh_gate.hold", Gate):
        with pytest.raises(Exception, match="Not authenticated"):
            await svc._authenticated_client(MagicMock())
    assert entered == ["yodel"]
```

Scheduler test: when `_is_authenticated` returns False and `session_alert.needs_login("yodel")` is True, `_decide` returns `"session_expired"`. Otherwise it returns `"not_authenticated"`. Follow the existing scheduler test's construction of the scheduler with injected seams.

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest backend/tests/test_sync_session_alert.py -q`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`sync_service.py`.** Add `from backend.services import refresh_gate`. In `_authenticated_client`, put the body from `config = await self.load_config()` through the end of the `try/except (SessionExpiredError, RefreshFailedError)` block inside `async with refresh_gate.hold(self._service):`. The token save that follows (`if client.access_token != token:`) stays inside too, so the renewed token is stored before the gate opens.
- **`api/sync.py`.** Add `from backend.services import session_alert`. Then in `run_sync_task`:

```python
    try:
        await sync_service.start_sync(include_inactive, force_resync)
        session_alert.report_success(service)
    except SessionExpiredError:
        logger.warning("sync_failed", service=service, reason="session_expired")
        progress.error("SESSION_EXPIRED")
        await session_alert.report(service, "expired")
    except RefreshFailedError:
        logger.error("sync_failed", service=service, reason="refresh_failed")
        progress.error("REFRESH_FAILED")
        await session_alert.report(service, "refresh_failed")
```

  Keep the generic `except Exception` and the `finally`. Make the same two `report(...)` additions in `run_verify_task`.
- **`auto_sync_scheduler.py`.** Add `REASON_SESSION_EXPIRED = "session_expired"`. In `_decide`, replace the not-authenticated branch:

```python
        if not await self._is_authenticated(service):
            from backend.services import session_alert

            return REASON_SESSION_EXPIRED if session_alert.needs_login(service) else REASON_NOT_AUTHENTICATED
```

- [ ] **Step 4: Run the sync and scheduler tests**

Run: `uv run pytest backend/tests/test_sync_session_alert.py backend/tests -q -k "sync or scheduler" -p no:cacheprovider`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/services/sync_service.py backend/api/sync.py backend/services/auto_sync_scheduler.py backend/tests
uv run git commit -m "feat(sync): gate token refreshes and report dead sessions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Desktop wiring: tray badge, toast click → login dialog

**Files:**
- Modify: `tray.py` (`set_alert`, badge image)
- Modify: `desktop.py` (`make_open_login_handler`, register the handlers)
- Modify: `frontend/src/shell/App.tsx`, `frontend/src/utils/clientLog.ts`
- Test: `tests/test_tray.py`, `tests/test_desktop_open_chat.py` (add the login handler tests next to the open-chat ones), `frontend/src/shell/App.openLogin.test.tsx` (new)

**Interfaces:**
- Consumes: `desktop_bridge.set_open_login_handler` and `set_tray_alert_handler` (Task 2).
- Produces: the frontend global `window.__sakadeskOpenLogin?: (service: string) => boolean`.

- [ ] **Step 1: Write the failing tests**

`tests/test_tray.py`, using the file's existing fake-icon pattern:

```python
def test_set_alert_swaps_icon_and_back(fake_tray):  # reuse the file's fixture that builds a started TrayController
    tray, icon = fake_tray
    base = icon.icon
    tray.set_alert(True)
    assert icon.icon is not base
    tray.set_alert(False)
    assert icon.icon is base


def test_set_alert_without_icon_is_noop():
    from tray import TrayController

    TrayController(strings=lambda: {}, on_open=lambda: None, on_sync_now=lambda: None, on_quit=lambda: None).set_alert(True)
```

If `tests/test_tray.py` has no such fixture, build the controller with `icon_factory=lambda: PIL.Image.new("RGBA", (64, 64))` and a fake `pystray` module, the way the existing start tests do.

`tests/test_desktop_open_chat.py`: `make_open_login_handler(window, focus_fn)` calls `window.show()` and `focus_fn`, then `evaluate_js` with a script containing `window.__sakadeskOpenLogin` and `"sakurazaka46"`. It logs `notify_open_login` with `delivered=True`, or `notify_open_login_failed reason=not_ready` when the script returns false.

`frontend/src/shell/App.openLogin.test.tsx`: render `App` the same way the existing `App.*.test.tsx` files do. Call `window.__sakadeskOpenLogin('sakurazaka46')` inside `act`. Expect `useAppStore.getState().activeService === 'sakurazaka46'` and a login dialog for 櫻坂46 is shown. An unknown service returns `false` and changes nothing.

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/test_tray.py tests/test_desktop_open_chat.py -q` and `cd frontend && npx vitest run src/shell/App.openLogin.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`tray.py`.** Add the badge and the alert switch:

```python
def _alert_image(base: Any) -> Any:
    """The tray icon with an amber warning dot at the bottom right (login needed)."""
    from PIL import ImageDraw

    img = base.convert("RGBA").copy()
    w, h = img.size
    r = max(4, w // 4)
    draw = ImageDraw.Draw(img)
    draw.ellipse((w - 2 * r - 1, h - 2 * r - 1, w - 1, h - 1), fill=(217, 119, 6, 255), outline=(255, 255, 255, 255), width=max(1, w // 32))
    return img
```

  In `TrayController`, keep `self._base_image`, set in `start()` as the image passed to `pystray.Icon`, and add:

```python
    def set_alert(self, on: bool) -> None:
        """Show (or remove) the login-needed badge on the icon. Never raises."""
        icon = self._icon
        if icon is None or self._base_image is None:
            logger.debug("tray_alert_skipped", reason="no_icon")
            return
        try:
            icon.icon = _alert_image(self._base_image) if on else self._base_image
            logger.info("tray_alert", on=on)
        except Exception as e:
            logger.warning("tray_alert_failed", error_type=type(e).__name__)
```

  The amber matches the semantic warning family. The tray is a native surface outside the web design system, so a literal RGB tuple is acceptable here.
- **`desktop.py`.** Add `make_open_login_handler(window, focus_fn)`, mirroring `make_open_chat_handler`. The script is

```python
"window.__sakadeskOpenLogin ? window.__sakadeskOpenLogin(" + json.dumps(service) + ") === true : false"
```

  It logs `notify_open_login` (`service`, `delivered=True`) or `notify_open_login_failed` (`reason=not_ready` or `error_type`) and never raises. Where `set_open_chat_handler` is registered, also call `desktop_bridge.set_open_login_handler(make_open_login_handler(window, <same focus fn>))`. Where `set_tray_tooltip_handler(tray.set_tooltip)` is registered, also call `desktop_bridge.set_tray_alert_handler(tray.set_alert)`, then `tray.set_alert(bool(session_alert.needs_login_services()))`.
- **`clientLog.ts`.** Add `'notify_open_login'` to `ClientLogEvent`.
- **`App.tsx`.** Next to the `__sakadeskOpenChat` effect:

```tsx
declare global {
    interface Window {
        /** Called by the desktop host when a "log in again" toast is clicked. */
        __sakadeskOpenLogin?: (service: string) => boolean;
    }
}

    // Desktop "log in again" toast click: show that service and its login dialog.
    useEffect(() => {
        window.__sakadeskOpenLogin = (service: string) => {
            if (!useAppStore.getState().selectedServices.includes(service)) {
                clientLog('notify_open_login', { delivered: false, reason: 'unknown_service' });
                return false;
            }
            useAppStore.getState().setActiveService(service);
            setDisconnectedLoginService(service);
            clientLog('notify_open_login', { delivered: true, service });
            return true;
        };
        return () => { delete window.__sakadeskOpenLogin; };
    }, []);
```

  Put the `declare global` with the other window globals (`openChat.ts` style) if the lint rules require it.

- [ ] **Step 4: Run the tests**

Run: `uv run pytest tests/test_tray.py tests/test_desktop_open_chat.py tests/test_desktop_tray.py -q` and `cd frontend && npx vitest run src/shell && npx tsc --noEmit -p .`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add tray.py desktop.py tests frontend/src/shell frontend/src/utils/clientLog.ts
uv run git commit -m "feat(desktop): badge the tray and open login from the toast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Read-state hydration keeps retrying (B2 part 1)

**Files:**
- Modify: `frontend/src/core/persistence/persisted.ts`
- Modify: `frontend/src/utils/clientLog.ts` (add `'conv_hydrate_recovered'`)
- Test: `frontend/src/core/persistence/persisted.hydrateRecovery.test.ts` (new)

**Interfaces:**
- Produces: `persisted.onConversationsReady(listener: () => void): () => void`. The listener runs once each time the cache goes from not ready to ready. The returned function unsubscribes.
- Produces: `CONV_BACKGROUND_RETRY_DELAYS_MS = [5000, 15000, 30000]` and `CONV_BACKGROUND_RETRY_MAX_MS = 60000` (exported).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

describe('conversation hydration recovery (spec B2 §1)', () => {
    beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('keeps retrying in the background and notifies listeners once ready', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (String(url).includes('/conversations')) {
                calls += 1;
                if (calls <= 5) return { ok: false, status: 503, json: async () => ({}) } as Response;
                return { ok: true, json: async () => ({ read_state_a: { value: '{}' } }) } as Response;
            }
            return { ok: true, json: async () => ({}) } as Response;
        }));
        const { persisted } = await import('./persisted');
        const { clientLog } = await import('../../utils/clientLog');
        const ready = vi.fn();
        persisted.onConversationsReady(ready);
        const first = persisted.hydrateConversations();
        await vi.advanceTimersByTimeAsync(3500); // 500 + 1000 + 2000
        await first;
        expect(persisted.conversationsReady()).toBe(false);
        await vi.advanceTimersByTimeAsync(5000); // background #1 (call 5) fails
        expect(persisted.conversationsReady()).toBe(false);
        await vi.advanceTimersByTimeAsync(15000); // background #2 (call 6) succeeds
        expect(persisted.conversationsReady()).toBe(true);
        expect(ready).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('conv_hydrate_recovered', expect.objectContaining({ count: 6 }));
    });
});
```

Adjust the URL match and the success JSON to the real `api.getAllConversations` endpoint and response shape in `persisted.ts`. Read it first and keep the test's structure.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/core/persistence/persisted.hydrateRecovery.test.ts`
Expected: FAIL (`onConversationsReady` is not a function).

- [ ] **Step 3: Implement in `persisted.ts`**

```ts
export const CONV_BACKGROUND_RETRY_DELAYS_MS: readonly number[] = [5000, 15000, 30000];
export const CONV_BACKGROUND_RETRY_MAX_MS = 60000;

const readyListeners = new Set<() => void>();
let backgroundRetrying = false;
let totalAttempts = 0;

function markReady(cache: Record<string, unknown>): void {
  const wasReady = convReady;
  convCache = cache as typeof convCache;
  convReady = true;
  if (!wasReady) readyListeners.forEach((fn) => { try { fn(); } catch { /* listener errors never break hydration */ } });
}

async function backgroundRetry(): Promise<void> {
  if (backgroundRetrying) return;
  backgroundRetrying = true;
  for (let i = 0; !convReady; i++) {
    await wait(CONV_BACKGROUND_RETRY_DELAYS_MS[i] ?? CONV_BACKGROUND_RETRY_MAX_MS);
    if (convReady) break; // a foreground load (e.g. migration) succeeded meanwhile
    totalAttempts += 1;
    try {
      markReady(await api.getAllConversations());
      clientLog('conv_hydrate_recovered', { count: totalAttempts });
    } catch (err) {
      clientLog('conv_hydrate_retry', { index: totalAttempts, phase: 'background', ...failureFields(err) });
    }
  }
  backgroundRetrying = false;
}
```

- In `hydrateConversations`, count each try in `totalAttempts`. On success, call `markReady(...)` instead of setting the fields directly.
- On the final failure, keep `convCache = {}`, `convReady = false` and the `conv_hydrate_failed` log, then `void backgroundRetry();`.
- Add `onConversationsReady(listener) { readyListeners.add(listener); return () => readyListeners.delete(listener); }` to the `persisted` object.
- Update the doc comment above `hydrateConversations`, and the App.tsx comment that mentions `CONV_HYDRATE_RETRY_DELAYS_MS`, to describe the background retry (zero-drift docs).

- [ ] **Step 4: Run the persistence tests**

Run: `cd frontend && npx vitest run src/core/persistence`
Expected: pass, including the existing hydration tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/persistence frontend/src/utils/clientLog.ts frontend/src/shell/App.tsx
uv run git commit -m "fix(read-state): keep retrying the conversation cache load" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Deferred read-state saves and merge on recovery (B2 part 2)

**Files:**
- Modify: `frontend/src/features/messages/readStateStore.ts`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (bump `readStateVersion` on recovery)
- Modify: `frontend/src/utils/clientLog.ts` (replace `'read_state_save_skipped'` with `'read_state_save_deferred'`; add `'read_state_pending_flushed'`)
- Test: `frontend/src/features/messages/readStateStore.deferred.test.ts` (new); update tests that expect `read_state_save_skipped`

**Interfaces:**
- Consumes: `persisted.onConversationsReady` (Task 6).
- Produces: `mergeReadStates(stored: ReadState, pending: ReadState): ReadState` (exported, pure), `flushPendingReadStates(): void` (exported, for tests).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ready = { value: false };
const listeners: Array<() => void> = [];
const store: Record<string, unknown> = {};
vi.mock('../../core/persistence/persisted', () => ({
    persisted: {
        conversationsReady: () => ready.value,
        onConversationsReady: (fn: () => void) => { listeners.push(fn); return () => {}; },
        getConv: (k: string, fb: unknown) => (k in store ? store[k] : fb),
        setConv: (k: string, v: unknown) => { store[k] = v; },
    },
}));
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

import { saveReadState, mergeReadStates, readStateKey } from './readStateStore';
import { clientLog } from '../../utils/clientLog';

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

describe('deferred read-state saves (spec B2 §2-3)', () => {
    beforeEach(() => {
        ready.value = false;
        for (const k of Object.keys(store)) delete store[k];
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as Response));
    });

    it('merges monotonically: max lastReadId and readCount, revealed ids above it', () => {
        expect(mergeReadStates(
            { lastReadId: 100, readCount: 50, revealedIds: [105] },
            { lastReadId: 0, readCount: 3, revealedIds: [101, 102, 105, 90] },
        )).toEqual({ lastReadId: 100, readCount: 50, revealedIds: [101, 102, 105] });
    });

    it('defers while not ready, writes nothing, then flushes only what is ahead', () => {
        store[readStateKey(PATH)] = { value: JSON.stringify({ lastReadId: 100, readCount: 50, revealedIds: [] }) };
        saveReadState(PATH, { lastReadId: 0, readCount: 2, revealedIds: [120] });
        expect(JSON.parse((store[readStateKey(PATH)] as { value: string }).value).revealedIds).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('read_state_save_deferred', expect.anything());
        ready.value = true;
        listeners.forEach((fn) => fn());
        const saved = JSON.parse((store[readStateKey(PATH)] as { value: string }).value);
        expect(saved).toEqual({ lastReadId: 100, readCount: 50, revealedIds: [120] });
        expect(clientLog).toHaveBeenCalledWith('read_state_pending_flushed', { written: 1, dropped: 0 });
    });

    it('drops a deferred save that is not ahead of the stored row', () => {
        store[readStateKey(PATH)] = { value: JSON.stringify({ lastReadId: 100, readCount: 50, revealedIds: [] }) };
        saveReadState(PATH, { lastReadId: 40, readCount: 10, revealedIds: [] });
        ready.value = true;
        listeners.forEach((fn) => fn());
        expect(clientLog).toHaveBeenCalledWith('read_state_pending_flushed', { written: 0, dropped: 1 });
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/features/messages/readStateStore.deferred.test.ts`
Expected: FAIL (`mergeReadStates` is not exported).

- [ ] **Step 3: Implement in `readStateStore.ts`**

```ts
/** Newest deferred state per chat while the conversation cache is not ready. */
const pendingReadStates = new Map<string, ReadState>();

/** Merge two read states without ever moving backwards (spec B2 §3). */
export function mergeReadStates(stored: ReadState, pending: ReadState): ReadState {
    const lastReadId = Math.max(stored.lastReadId, pending.lastReadId);
    const revealed = new Set([...stored.revealedIds, ...pending.revealedIds].filter((id) => id > lastReadId));
    return {
        lastReadId,
        readCount: Math.max(stored.readCount, pending.readCount),
        revealedIds: [...revealed].sort((a, b) => a - b),
    };
}

function sameReadState(a: ReadState, b: ReadState): boolean {
    return a.lastReadId === b.lastReadId && a.readCount === b.readCount
        && a.revealedIds.length === b.revealedIds.length
        && a.revealedIds.every((id, i) => id === b.revealedIds[i]);
}

/** Write deferred states that are ahead of the stored rows; drop the rest. */
export function flushPendingReadStates(): void {
    if (pendingReadStates.size === 0) return;
    let written = 0;
    let dropped = 0;
    for (const [path, pending] of pendingReadStates) {
        const stored = loadReadState(path);
        const merged = mergeReadStates(stored, pending);
        const storedSorted = { ...stored, revealedIds: [...stored.revealedIds].sort((a, b) => a - b) };
        if (sameReadState(merged, storedSorted)) { dropped += 1; continue; }
        saveReadState(path, merged);
        written += 1;
    }
    pendingReadStates.clear();
    clientLog('read_state_pending_flushed', { written, dropped });
}

persisted.onConversationsReady(flushPendingReadStates);
```

`loadReadState` is the existing reader that returns `parseReadState(persisted.getConv(...))`; use whatever name the file already exports for it. In `saveReadState`, replace the not-ready branch with:

```ts
    if (!persisted.conversationsReady()) {
        const prev = pendingReadStates.get(path);
        pendingReadStates.set(path, prev ? mergeReadStates(prev, state) : state);
        if (!skippedSaveLogged.has(path)) {
            skippedSaveLogged.add(path);
            clientLog('read_state_save_deferred', { reason: 'not_ready', ...ids });
        }
        return;
    }
```

Update the doc comment of `saveReadState` (deferred, merged on recovery). In `MessagesFeature.tsx`, add:

```tsx
    // The conversation cache recovered after a failed startup load: re-read unread counts.
    useEffect(() => persisted.onConversationsReady(() => setReadStateVersion((v) => v + 1)), []);
```

Register the store's listener before the feature's, so the sidebar re-reads after the flush. `readStateStore` registers at import, and MessagesFeature imports it, so the order holds. Add a comment saying this.

- [ ] **Step 4: Run the messages tests**

Run: `cd frontend && npx vitest run src/features/messages src/shell && npx tsc --noEmit -p .`
Expected: pass. Update any existing test that asserts `read_state_save_skipped` to `read_state_save_deferred`, keeping its other assertions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/messages frontend/src/utils/clientLog.ts
uv run git commit -m "fix(read-state): save progress read while the cache was down" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Call popup frame (B4)

**Files:**
- Modify: `frontend/src/features/incomingCall/callScreen.css` (`.sd-call-halo--inset`)
- Modify: `frontend/src/features/callPopup/callPopup.css`
- Possibly modify: `call_popup_window.py` (only for the fallback)
- Test: the existing popup tests (`grep -rl "sd-call-halo--inset\|callPopup" frontend/src --include=*.test.*`, `tests/test_desktop_call_popup.py`)

- [ ] **Step 1: Capture the current popup on Windows (native pixels)**

- Rebuild the Windows dev build from this branch in `C:\D\saka-verify\SakaDesk` (fetch from WSL first; run `build.ps1 -ExeOnly | Out-Null`; check the exe's `LastWriteTime`).
- Launch it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and fire a test call the way C3 acceptance did.
- Capture two images:
  - the popup page via CDP `shot`;
  - the popup window via Win32 `PrintWindow` on its hwnd. Never use a full-screen grab.
- Compare the two images to find where the dark rim comes from:
  - page pixels: the halo inset or the vignette;
  - window pixels outside the page: the background colour or the DWM shadow and border.

- [ ] **Step 2: Apply the primary fix (full bleed)**

`callScreen.css`: replace the inset rule and its comment:

```css
/* Popup glow (spec 0.4.2 B4). The popup page fills its Windows 11 window edge to edge; the window's
   DWM rounded corners (~8px) and shadow are the frame. The ringing pulse is an inner glow on the
   window edge itself, so no dark band can show between the window edge and the card. */
.sd-call-halo--inset { position: absolute; inset: 0; border-radius: 8px; pointer-events: none; z-index: 2; }
```

`callPopup.css`: make the document background follow the call screen's edge instead of a flat dark square, and keep the existing rules:

```css
html.sd-call-popup-doc,
html.sd-call-popup-doc body,
html.sd-call-popup-doc #root { margin: 0; height: 100%; overflow: hidden; background: transparent; }
.sd-call-popup { position: fixed; inset: 0; border-radius: 8px; overflow: hidden; }
```

If Step 1 shows that the rim lies **outside** the page (window background or DWM border), apply the fallback in Step 3. Otherwise skip Step 3.

- [ ] **Step 3: Fallback (only if needed): transparent window**

- In `call_popup_window.py`, pass `transparent=True` to `create_window` and drop `background_color` (pywebview 5.3.2 makes the WinForms form and the WebView2 background transparent).
- Set `shadow=False`, because a DWM shadow on a transparent form draws a box.
- `callPopup.css` gives `.sd-call-popup` `border-radius: 16px` (the card radius), and the document stays transparent.
- Update `tests/test_desktop_call_popup.py`, whose create-window kwargs assertion pins these options.

- [ ] **Step 4: Re-capture and compare**

- Re-capture with the Step 1 method.
- Put before and after images on the comparison page (`C:\D\saka-verify\qa2\index.html`, new section "0.4.2 B4").
- Check: no dark square, antialiased corners, and the ringing glow visible on all four edges.

- [ ] **Step 5: Run the tests and commit**

Run: `cd frontend && npx vitest run src/features/callPopup src/features/incomingCall` and `uv run pytest tests/test_desktop_call_popup.py -q`
Expected: pass. Update any test that pins `inset: 8px`.

```bash
git add frontend/src/features/incomingCall/callScreen.css frontend/src/features/callPopup call_popup_window.py tests
uv run git commit -m "fix(call-popup): drop the dark square frame around the card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Spec refinement, changelog, full verification, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-11-09-v042-reliability-design.md` (record the Global Constraints refinement under B1 → Error handling)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Update the spec**

Add to B1 "Error handling":

> `SessionExpiredError` (or no cookies) marks at once; `RefreshFailedError` marks after two consecutive failed renewals, so a short offline period never toasts. A failed renewal is not retried within 60 s, and a marked service is not renewed again until login.

- [ ] **Step 2: Changelog `[Unreleased]`**

```markdown
### Fixed
- **No more needless re-logins after the PC wakes up.** An expired sign-in is
  now renewed automatically in the background, so syncing continues without
  asking you to log in again.
- **A clear alert when you really need to log in again.** If a group's sign-in
  can no longer be renewed, SakaDesk shows one Windows notification (click it
  to log in) and a warning dot on the tray icon until you do.
- **Read progress is no longer lost after a slow start.** If SakaDesk could not
  load your read progress at startup, it keeps trying and saves what you read
  in the meantime.
- **The bottom-right call window is just the call card.** The dark square
  frame around it is gone.
```

- [ ] **Step 3: Run the full verification**

```bash
uv run python -m pytest backend/tests/ tests/ -q -p no:cacheprovider
cd frontend && npx vitest run && npx tsc --noEmit -p . && npx eslint src --max-warnings=9999
uv run ruff check . && uv run mypy backend
```

Expected: every suite passes, and there are no new eslint errors.

- [ ] **Step 4: Commit, push and open the PR**

```bash
git add docs CHANGELOG.md
uv run git commit -m "docs: record 0.4.2 renewal refinements and changelog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
uv run git push -u origin fix/v0.4.2-reliability
gh pr create --repo xebjhm/SakaDesk --base dev --head fix/v0.4.2-reliability --title "fix: renew sessions silently, recover read state, clean call popup" --body-file <body with ## Why / ## What / ## Testing / ## Changelog>
```
