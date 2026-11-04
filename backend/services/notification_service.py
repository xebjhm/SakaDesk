"""Native desktop toasts for SakaDesk.

The planner (:mod:`backend.services.notification_planner`) decides what to
show; this module delivers it. On Windows a toast is sent through
``windows_toasts`` under the ``SakaDesk`` AUMID. A click fires the toast's
in-process ``on_activated`` callback, whose closure holds the plan, and opens
that chat via :mod:`backend.services.desktop_bridge`, scrolled to the message
the toast previews (``newest_id``). No launch action is set: in windows-toasts
it turns the click into a protocol activation. Everywhere else (or when
``windows_toasts`` cannot be imported) a :class:`NullNotifier` is used.

Logs carry ids, counts, codes and error types only: never titles, bodies,
names, paths or URLs.
"""

from __future__ import annotations

import asyncio
import sys
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Protocol

import structlog

from backend.services import desktop_bridge
from backend.services.app_identity import AUMID
from backend.services.i18n import get_strings
from backend.services.notification_planner import ChatTarget, ToastPlan

logger = structlog.get_logger(__name__)

_BACKEND_WINDOWS = "windows_toasts"
_BACKEND_NONE = "none"
_LIVE_TOASTS = 64  # keep recent Toast objects alive so WinRT callbacks still fire
_SHOW_TIMEOUT_S = 10  # seconds one show may take before it counts as failed
_SIMPLE_TAG = "app:hint"  # hint toasts share one Action Center slot
_SIMPLE_GROUP = "app"

_notifications_enabled = True

# Toast shows run on one dedicated worker thread, so a hung WinRT call can
# only ever block this thread, never the default executor other code uses.
_toast_executor: ThreadPoolExecutor | None = None
_show_running = False  # a show is on (or queued for) the worker thread
_show_state_lock = threading.Lock()


class Notifier(Protocol):
    """Shows one planned toast and reports its own health."""

    def show(self, plan: ToastPlan) -> bool: ...

    def show_simple(self, title: str, body: str) -> bool: ...

    def status(self) -> dict: ...


# ------------------------------------------------------------------- notifiers


def _click_message_id(newest_id: str) -> tuple[int | None, str | None]:
    """The message a click jumps to: ``(id, None)`` or ``(None, reason)``.

    ``newest_id`` is an ASCII decimal id above zero; anything else yields no
    jump, with ``reason`` ``no_id`` (empty) or ``bad_id`` (not such an id).
    """
    if not newest_id:
        return None, "no_id"
    if newest_id.isascii() and newest_id.isdigit() and int(newest_id) > 0:
        return int(newest_id), None
    return None, "bad_id"


class NullNotifier:
    """Used where toasts are unavailable. ``show`` returns ``False``.

    :func:`get_notifier` logs ``notify_unavailable`` (with the reason) once,
    when it builds this notifier; ``show`` itself does not log.
    """

    def __init__(self, reason: str) -> None:
        self._reason = reason

    def show(self, plan: ToastPlan) -> bool:
        return False

    def show_simple(self, title: str, body: str) -> bool:
        return False

    def status(self) -> dict:
        return {
            "available": False,
            "backend": _BACKEND_NONE,
            "last_error": self._reason,
            "aumid": AUMID,
        }


class WindowsToastNotifier:
    """Sends toasts through ``windows_toasts`` (imported lazily).

    Raises ``ImportError`` (or another exception from the toaster) from
    ``__init__``; :func:`get_notifier` turns that into a :class:`NullNotifier`.
    """

    def __init__(self) -> None:
        import windows_toasts as wt  # lazy: Windows-only dependency

        self._wt = wt
        self._toaster = wt.InteractableWindowsToaster(AUMID, notifierAUMID=AUMID)
        self._last_error: str | None = None
        self._live: deque[Any] = deque(maxlen=_LIVE_TOASTS)

    def show(self, plan: ToastPlan) -> bool:
        """Show the toast; raises on failure (callers log ``notify_failed``)."""
        wt = self._wt
        try:
            # Never set launch_action: windows-toasts then makes the click a
            # protocol activation (Windows opens it as a URI) instead of
            # firing on_activated in this process.
            toast = wt.Toast(text_fields=[plan.title, plan.body])
            if plan.group_id and plan.member_id:
                # Ids only (<= 64 chars): a newer toast for the same chat
                # replaces the older one in the Action Center.
                toast.tag = f"{plan.group_id}:{plan.member_id}"
                toast.group = plan.target.service
            if plan.avatar is not None:
                self._add_avatar(toast, plan)
            toast.on_activated = lambda _args, p=plan: self._on_click(p)
            toast.on_failed = lambda args, p=plan: self._on_failed(p, args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def show_simple(self, title: str, body: str) -> bool:
        """Show an app-level hint toast (no chat, no avatar); raises on failure.

        A click shows the main window through :func:`desktop_bridge.open_window`
        (a no-op when no handler is registered).
        """
        wt = self._wt
        try:
            toast = wt.Toast(text_fields=[title, body])
            # One fixed slot: a newer hint replaces the older one.
            toast.tag = _SIMPLE_TAG
            toast.group = _SIMPLE_GROUP
            toast.on_activated = lambda _args: self._on_simple_click()
            toast.on_failed = lambda args: self._on_simple_failed(args)
            self._live.append(toast)
            self._toaster.show_toast(toast)
        except Exception as e:
            self._last_error = type(e).__name__
            raise
        self._last_error = None
        return True

    def status(self) -> dict:
        return {
            "available": True,
            "backend": _BACKEND_WINDOWS,
            "last_error": self._last_error,
            "aumid": AUMID,
        }

    def _add_avatar(self, toast: Any, plan: ToastPlan) -> None:
        wt = self._wt
        try:
            toast.AddImage(
                wt.ToastDisplayImage(
                    wt.ToastImage(plan.avatar),
                    position=wt.ToastImagePosition.AppLogo,
                )
            )
        except Exception as e:
            # A missing or unreadable avatar must not cost the user the toast.
            logger.warning(
                "notify_failed",
                stage="avatar",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                error_type=type(e).__name__,
            )

    def _on_click(self, plan: ToastPlan) -> None:
        """WinRT-thread ``on_activated`` callback for ``plan``'s toast. Never raises."""
        try:
            if not plan.target.service or not plan.target.path:
                # The test toast has no chat behind it.
                logger.info("notify_click_unhandled", reason="no_target")
                return
            # The chat opens at the message the toast previews; without a
            # usable id it still opens, just without the jump.
            message_id, no_target = _click_message_id(plan.newest_id)
            fields: dict[str, Any] = {"has_target": message_id is not None}
            if no_target is not None:
                fields["target_reason"] = no_target
            logger.info(
                "notify_clicked",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                **fields,
            )
            desktop_bridge.open_chat(plan.target, message_id)
        except Exception as e:
            logger.warning("notify_open_chat_failed", error_type=type(e).__name__)

    def _on_simple_click(self) -> None:
        """WinRT-thread ``on_activated`` callback for a hint toast. Never raises."""
        try:
            logger.info("notify_clicked", kind="simple")
            desktop_bridge.open_window()
        except Exception as e:  # pragma: no cover - open_window never raises
            logger.warning("window_open_failed", error_type=type(e).__name__)

    def _on_simple_failed(self, event_args: Any) -> None:
        """WinRT-thread callback for a hint toast. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                kind="simple",
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass

    def _on_failed(self, plan: ToastPlan, event_args: Any) -> None:
        """WinRT-thread callback. Never raises."""
        self._last_error = "ToastFailed"
        try:
            logger.warning(
                "notify_failed",
                service=plan.target.service,
                group_id=plan.group_id,
                member_id=plan.member_id,
                error_type="ToastFailed",
                error_code=getattr(event_args, "error_code", None),
            )
        except Exception:  # pragma: no cover - logging must not break WinRT
            pass


# ------------------------------------------------------------------- singleton

_notifier: Notifier | None = None
_notifier_lock = threading.Lock()


def _is_windows() -> bool:
    return sys.platform == "win32"


def _build_notifier() -> Notifier:
    """Build the notifier; log ``notify_unavailable`` with the reason when it is null."""
    if not _is_windows():
        logger.warning("notify_unavailable", reason="not_windows")
        return NullNotifier("not_windows")
    try:
        return WindowsToastNotifier()
    except ImportError as e:
        logger.warning(
            "notify_unavailable",
            reason="import_error",
            error_type=type(e).__name__,
            module=e.name,
        )
        return NullNotifier("import_error")
    except Exception as e:
        logger.warning(
            "notify_unavailable", reason="init_error", error_type=type(e).__name__
        )
        return NullNotifier("init_error")


def get_notifier() -> Notifier:
    """The process-wide notifier (Windows toasts, else a :class:`NullNotifier`).

    Built once per process, so ``notify_unavailable`` is logged at most once.
    """
    global _notifier
    with _notifier_lock:
        if _notifier is None:
            _notifier = _build_notifier()
        return _notifier


def _reset_notifier_for_tests() -> None:
    global _notifier
    with _notifier_lock:
        _notifier = None


# -------------------------------------------------------------------- delivery


def _fail_fields(plan: ToastPlan) -> dict[str, Any]:
    return {
        "service": plan.target.service,
        "group_id": plan.group_id,
        "member_id": plan.member_id,
    }


def _get_toast_executor() -> ThreadPoolExecutor:
    """The single-worker toast executor (created on first use)."""
    global _toast_executor
    with _show_state_lock:
        if _toast_executor is None:
            _toast_executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="toast"
            )
        return _toast_executor


def _claim_show_slot() -> bool:
    """Mark a show as running; False when a previous show is still running."""
    global _show_running
    with _show_state_lock:
        if _show_running:
            return False
        _show_running = True
        return True


def _release_show_slot() -> None:
    global _show_running
    with _show_state_lock:
        _show_running = False


def _reset_toast_executor_for_tests() -> None:
    """Drop the executor and busy flag (does not wait for a stuck worker)."""
    global _toast_executor, _show_running
    with _show_state_lock:
        executor, _toast_executor = _toast_executor, None
        _show_running = False
    if executor is not None:
        executor.shutdown(wait=False)


async def _run_guarded(
    job_fn: Callable[[], bool],
    fields: dict[str, Any],
    *,
    skip_extra: dict[str, Any],
    sent_extra: dict[str, Any],
) -> bool:
    """Run ``job_fn`` (a notifier show) on the toast worker; log the outcome.

    Never raises. ``fields`` are added to every failure/skip log, ``skip_extra``
    to the busy skip and ``sent_extra`` to the success log.

    A show that takes longer than ``_SHOW_TIMEOUT_S`` is logged as
    ``notify_failed`` (``error_type=TimeoutError``); its worker thread is left
    to finish on its own. While such a show is still running, further shows
    are not queued behind it: they are skipped with ``notify_skip
    reason=busy``.
    """
    if not _claim_show_slot():
        logger.info("notify_skip", reason="busy", **fields, **skip_extra)
        return False
    try:
        # submit + done-callback (not run_in_executor) so the slot is also
        # freed if the job is cancelled before the worker ever starts it.
        job = _get_toast_executor().submit(job_fn)
    except Exception as e:  # e.g. the executor was shut down
        _release_show_slot()
        logger.warning("notify_failed", **fields, error_type=type(e).__name__)
        return False
    job.add_done_callback(lambda _f: _release_show_slot())
    try:
        shown = await asyncio.wait_for(
            asyncio.wrap_future(job), timeout=_SHOW_TIMEOUT_S
        )
    except TimeoutError:
        logger.warning("notify_failed", **fields, error_type="TimeoutError")
        return False
    except Exception as e:
        logger.warning("notify_failed", **fields, error_type=type(e).__name__)
        return False
    if not shown:
        logger.warning("notify_failed", **fields, reason="not_shown")
        return False
    logger.info("notify_sent", **fields, **sent_extra)
    return True


async def _show_one(notifier: Notifier, plan: ToastPlan) -> bool:
    """Show ``plan`` on the toast worker thread; log the outcome. Never raises.

    Guarded as described in :func:`_run_guarded`; logs carry ids and ``count``
    only.
    """
    return await _run_guarded(
        lambda: notifier.show(plan),
        _fail_fields(plan),
        skip_extra={"count": plan.count},
        sent_extra={"count": plan.count, "newest_type": plan.newest_type},
    )


async def send_planned(plans: list[ToastPlan]) -> int:
    """Show every plan (off the event loop) and return how many were shown.

    Skips everything when notifications are disabled (the planner already
    skips in that case, so this is a second guard; ``notify_skip
    reason=disabled``) or when the notifier is unavailable (``notify_skip
    reason=unavailable`` with ``backend_reason``; the notifier already logged
    ``notify_unavailable`` once, when it was built). Each show is bounded by
    ``_SHOW_TIMEOUT_S``, and while a timed-out show is still stuck the rest
    are skipped (``notify_skip reason=busy``). The notifier is resolved on a worker thread: its
    first use imports ``windows_toasts``/WinRT and builds the toaster.
    """
    if not plans:
        return 0
    if not _notifications_enabled:
        logger.info("notify_skip", reason="disabled", count=len(plans))
        return 0
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info(
            "notify_skip",
            reason="unavailable",
            backend_reason=status.get("last_error"),
            count=len(plans),
        )
        return 0
    sent = 0
    for plan in plans:
        if await _show_one(notifier, plan):
            sent += 1
    return sent


async def send_simple(title: str, body: str) -> bool:
    """Show an app-level hint toast (off the event loop); return whether it showed.

    Goes through the same worker thread, busy guard and timeout as chat
    toasts. Not gated on the notifications flag: it is a one-time lifecycle
    hint, not a message notification. Skipped when the notifier is unavailable
    (``notify_skip reason=unavailable kind=simple``). Outcomes are logged as
    ``notify_sent`` / ``notify_failed`` with ``kind=simple``; the title and
    body are never logged. Never raises.
    """
    notifier = await asyncio.to_thread(get_notifier)
    status = notifier.status()
    if not status.get("available", True):
        logger.info(
            "notify_skip",
            reason="unavailable",
            kind="simple",
            backend_reason=status.get("last_error"),
        )
        return False
    return await _run_guarded(
        lambda: notifier.show_simple(title, body),
        {"kind": "simple"},
        skip_extra={},
        sent_extra={},
    )


async def send_test(lang: str | None) -> bool:
    """Show a test toast in ``lang``. Ignores the enabled flag (user-initiated)."""
    strings = get_strings("notifications", lang)
    plan = ToastPlan(
        target=ChatTarget(service="", path="", name="", is_group_chat=False),
        group_id="",
        member_id="",
        title=strings["test_title"],
        body=strings["test_body"],
        avatar=None,
        count=1,
        newest_type="text",
        newest_id="",
    )
    return await _show_one(await asyncio.to_thread(get_notifier), plan)


# ---------------------------------------------------------------------- state


def set_notifications_enabled(enabled: bool) -> None:
    """Enable or disable notifications."""
    global _notifications_enabled
    _notifications_enabled = enabled
    logger.info("notifications_enabled_changed", enabled=enabled)


def get_notifications_enabled() -> bool:
    """Check if notifications are enabled."""
    return _notifications_enabled


def get_notification_status() -> dict:
    """Diagnostics: the enabled flag plus the notifier's own status."""
    return {"enabled": _notifications_enabled, **get_notifier().status()}
