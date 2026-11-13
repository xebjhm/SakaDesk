"""
Authentication Service for SakaDesk

Uses pysaka's TokenManager for credential storage (same as CLI).
This ensures consistent behavior across CLI and GUI:
- Windows: Windows Credential Manager (WCM)
- Linux: Plaintext fallback (development only)
"""

import asyncio
import collections
import contextlib
import structlog
from typing import Any, Dict, Mapping, Optional, cast
import aiohttp
from pysaka import (
    BrowserAuth,
    Group,
    Client,
    RefreshFailedError,
    SessionExpiredError,
    is_jwt_expired,
    parse_jwt_expiry,
    get_jwt_remaining_seconds,
)
from pysaka.credentials import get_token_manager

from backend.services import refresh_gate, session_alert
from backend.services.background_tasks import track_background_task
from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode
from backend.services.service_utils import (
    get_all_services,
    get_service_enum,
    validate_service,
)

logger = structlog.get_logger(__name__)

# How long the status path (``get_status``, which the app's loading screen waits
# on) waits for an in-line renewal. A slower renewal keeps running in the
# background and saves its result; this status call answers outcome ``error``.
STATUS_RENEW_TIMEOUT_SECONDS = 20.0

# How long ``cancel_login`` waits for a cancelled browser login to unwind (its
# browser closing) before it answers anyway; the login keeps unwinding.
LOGIN_CANCEL_WAIT_SECONDS = 10.0

# How many login attempt ids ``cancel_login`` remembers (finished ones, and
# cancels that arrived before their login registered).
_ATTEMPT_MEMORY = 32


class LoginCancelledError(Exception):
    """A login whose attempt was cancelled before it opened a browser."""


def _region_is_blocked(country_code: Optional[str]) -> bool:
    """Yodel's web service is Japan-only. A known non-JP country is blocked; an
    unknown country (the geo-IP lookup failed) is NOT blocked — we fail open so a
    lookup failure never produces a false warning."""
    if not country_code:
        return False
    return country_code.upper() != "JP"


class AuthService:
    def __init__(self):
        self._session_dir = get_session_dir()
        self._browser_lock = asyncio.Lock()
        # The in-progress browser-login task, so a newer login can supersede it.
        self._active_login_task: Optional["asyncio.Task[Any]"] = None
        # The service of ``_active_login_task`` (an id), so a cancel for one
        # service never stops another's login.
        self._active_login_service: Optional[str] = None
        # Services whose login the user cancelled (``cancel_login``) and that are
        # still unwinding. ``POST /login`` reads it (``consume_login_cancel``) to
        # answer 409 instead of propagating the cancellation; a cancellation
        # without a marker (shutdown, a superseding login) still propagates.
        self._cancelled: set[str] = set()
        # The frontend's id for the active login (``attempt``), when it sent one.
        self._active_login_attempt: Optional[str] = None
        # Attempts that already finished, so a late cancel answers False (the
        # login may have succeeded) instead of waiting for a login that is over.
        self._finished_attempts: "collections.deque[str]" = collections.deque(
            maxlen=_ATTEMPT_MEMORY
        )
        # Cancels that arrived before their login registered (still in transit,
        # or behind an older login's supersede): the login refuses to start.
        self._pending_cancels: "collections.deque[tuple[str, str]]" = collections.deque(
            maxlen=_ATTEMPT_MEMORY
        )
        # SD-BE-API-04: in-process cache of the loaded session per service.
        # The OS keyring read (Windows Credential Manager) costs hundreds of ms
        # and GET /api/auth/status is polled by the frontend for EVERY service on
        # every call. Cache the loaded session so a poll is one WCM read per
        # service at most, and invalidate on save/delete/refresh so the cache
        # never serves stale credentials. Keyed by Group.value. A None value is
        # a real cache entry meaning "no session"; a missing key means "unknown".
        self._session_cache: Dict[str, Optional[Dict[str, Any]]] = {}

    def _get_group(self, service: str) -> Group:
        """Convert service string to Group enum."""
        return get_service_enum(service)

    def _load_session_cached(self, group_value: str) -> Optional[Dict[str, Any]]:
        """Load a service's session, using the in-process cache when warm.

        On a cache miss this performs the (potentially slow) keyring read and
        stores the result. Callers on the event loop must run this via
        ``asyncio.to_thread`` (see SD-BE-API-04) so the read never blocks the
        loop; the cache makes the common (warm) case a pure dict lookup.
        """
        if group_value in self._session_cache:
            return self._session_cache[group_value]
        tm = get_token_manager()
        session = cast(Optional[Dict[str, Any]], tm.load_session(group_value))
        self._session_cache[group_value] = session
        return session

    def _invalidate_session_cache(self, group_value: Optional[str] = None) -> None:
        """Drop cached session(s) so the next read reflects a save/delete/refresh.

        Pass a Group.value to invalidate one service, or None to clear all.
        """
        if group_value is None:
            self._session_cache.clear()
        else:
            self._session_cache.pop(group_value, None)

    def _reload_session_fresh(self, group_value: str) -> Optional[Dict[str, Any]]:
        """Drop the cache entry and re-read the stored session (blocking keyring read).

        Run via ``asyncio.to_thread`` when called from the event loop.
        """
        self._invalidate_session_cache(group_value)
        return self._load_session_cached(group_value)

    def invalidate_session(self, service: str) -> None:
        """Drop the cached session of ``service`` after another component changed it.

        ``SyncService`` saves refreshed tokens and deletes expired sessions through
        the TokenManager directly; calling this afterwards makes the next
        :meth:`get_status` re-read the store, so the auto-sync scheduler's
        authentication gate reflects the stored session. Logs ``auth_cache_invalidated``
        (service). An unknown service id is logged as ``auth_cache_invalidate_skipped``
        and ignored.
        """
        try:
            group = self._get_group(service)
        except ValueError:
            logger.warning(
                "auth_cache_invalidate_skipped",
                service=service,
                reason="unknown_service",
            )
            return
        self._invalidate_session_cache(group.value)
        logger.info("auth_cache_invalidated", service=service)

    def _is_token_expired(self, token: str) -> bool:
        """Check if JWT token is expired. Uses shared pysaka utility."""
        expired = is_jwt_expired(token)
        remaining = get_jwt_remaining_seconds(token)
        exp_timestamp = parse_jwt_expiry(token)

        if remaining is not None:
            logger.debug(
                "Token expiry check",
                expired=expired,
                remaining_seconds=remaining,
                exp_timestamp=exp_timestamp,
            )
        else:
            logger.warning("Token does not have expected JWT structure")

        return cast(bool, expired)

    def _get_token_expiry_timestamp(self, token: str) -> Optional[int]:
        """Extract expiry timestamp from JWT token. Uses shared pysaka utility."""
        return cast(Optional[int], parse_jwt_expiry(token))

    def _get_service_auth_status(self, service: str) -> dict:
        """Get authentication status for a single service."""
        try:
            group = self._get_group(service)
            token_data = self._load_session_cached(group.value)

            if token_data:
                token = token_data.get("access_token")
                cookies = token_data.get("cookies", {})
                cookie_keys = list(cookies.keys()) if cookies else []

                logger.debug(
                    "Loaded session from TokenManager",
                    service=service,
                    has_token=bool(token),
                    has_cookies=bool(cookies),
                    cookie_keys=cookie_keys,
                )

                if token:
                    expires_at = self._get_token_expiry_timestamp(token)
                    if self._is_token_expired(token):
                        logger.warning(
                            "Token is expired, returning token_expired status",
                            service=service,
                        )
                        return {
                            "authenticated": False,
                            "token_expired": True,
                            "expires_at": expires_at,
                            "message": "Token expired. Please re-login.",
                        }
                    logger.info(
                        "Auth status check: authenticated and token valid",
                        service=service,
                        expires_at=expires_at,
                    )
                    return {
                        "authenticated": True,
                        "expires_at": expires_at,
                        "app_id": token_data.get("x-talk-app-id"),
                        "storage_type": "secure"
                        if not is_dev_mode()
                        else "development",
                    }
            else:
                logger.debug("No token data found in TokenManager", service=service)
        except Exception as e:
            logger.error(
                "Failed to check auth status",
                service=service,
                error_type=type(e).__name__,
                exc_info=True,
            )

        return {"authenticated": False}

    async def get_status(self, service: Optional[str] = None):
        """
        Check authentication status.

        Args:
            service: If provided, return status for that service only.
                     If None, return status for all services.

        Returns:
            If service is provided: dict with 'authenticated' key for that service.
            If service is None: dict with 'services' key containing status for all services.
        """
        logger.debug("Checking authentication status", service=service)

        # Test mode: always return authenticated with test config
        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG

            if service:
                validate_service(service)
                return {
                    "authenticated": True,
                    "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                    "storage_type": "test_mode",
                }
            return {
                "services": {
                    s: {
                        "authenticated": True,
                        "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
                        "storage_type": "test_mode",
                    }
                    for s in get_all_services()
                }
            }

        if service:
            validate_service(service)
            # SD-BE-API-04: the keyring read happens inside _get_service_auth_status
            # (via _load_session_cached). Offload it so a cold read never blocks
            # the event loop; a warm cache hit returns almost immediately.
            status = await asyncio.to_thread(self._get_service_auth_status, service)
            return await self._settle(service, status)

        # Return status for all services. One thread hop reads them all (each may
        # be a WCM round-trip on a cold cache), keeping the polled endpoint off
        # the event loop.
        def _all_status() -> Dict[str, Any]:
            return {s: self._get_service_auth_status(s) for s in get_all_services()}

        statuses = await asyncio.to_thread(_all_status)
        # Settle concurrently: each renewal is bounded by
        # STATUS_RENEW_TIMEOUT_SECONDS, so the loading screen waits for the
        # slowest one rather than the sum.
        names = list(statuses)
        settled = await asyncio.gather(*(self._settle(s, statuses[s]) for s in names))
        return {"services": dict(zip(names, settled))}

    async def _renew_and_report(self, service: str) -> str:
        """``renew_expired`` plus the ``session_alert`` report its outcome calls for.

        ``dead`` / ``no_cookies`` report ``expired``; ``refresh_failed`` reports
        ``refresh_failed`` (a mark on the second strike). Runs to completion
        even when the status call that started it stopped waiting.
        """
        outcome = await self.renew_expired(service)
        if outcome in ("dead", "no_cookies"):
            await session_alert.report(service, "expired")
        elif outcome == "refresh_failed":
            await session_alert.report(service, "refresh_failed")
        return outcome

    async def _renew_for_status(self, service: str) -> str:
        """Wait at most ``STATUS_RENEW_TIMEOUT_SECONDS`` for a renewal.

        The renewal runs as a tracked background task (``_renew_and_report``)
        and is awaited through ``asyncio.shield``: the timeout only stops this
        status call from waiting. The renewal itself keeps running inside the
        gate and saves (or reports) its result, because cancelling a refresh
        after the server rotated the session cookie would lose the new cookie
        and kill the session. On timeout the 60 s retry cooldown starts (so
        polls do not pile up behind the busy gate meanwhile; a success clears
        it), ``session_renew`` (outcome ``timeout``) is logged and ``error`` is
        returned for this call.
        """
        task = track_background_task(
            self._renew_and_report(service), name="session_renew_status"
        )
        try:
            return await asyncio.wait_for(
                asyncio.shield(task), STATUS_RENEW_TIMEOUT_SECONDS
            )
        except TimeoutError:
            session_alert.note_renew_failure(service)
            logger.info(
                "session_renew",
                service=service,
                outcome="timeout",
                timeout_s=STATUS_RENEW_TIMEOUT_SECONDS,
                renewal="continues_in_background",
            )
            return "error"

    async def _settle(self, service: str, status: dict) -> dict:
        """Renew an expired token, then report the live status (spec B1 §1).

        Adds ``session_expired: True`` only for a dead session. ``token_expired``
        without ``session_expired`` means "not renewed this time, will retry"
        (outcome ``error``, ``skipped``, a timeout, or a first
        ``refresh_failed`` strike). A marked service reads ``session_expired``
        unless its slow retry (``refresh_failed`` marks only, see
        ``session_alert.MARKED_RETRY_SECONDS``) is due and refreshes for real
        (outcome ``ok``).
        """
        marked = session_alert.needs_login(service)
        if marked and not session_alert.may_renew(service):
            return {**status, "authenticated": False, "session_expired": True}
        if not marked and not status.get("token_expired"):
            return status
        outcome = await self._renew_for_status(service)
        if outcome in ("ok", "not_expired") and not session_alert.needs_login(service):
            fresh = await asyncio.to_thread(self._get_service_auth_status, service)
            if fresh.get("token_expired"):
                # Renewed (or found renewed) yet the stored token still reads
                # expired (e.g. clock skew): back off so the next poll does not
                # refresh again at once.
                session_alert.note_renew_failure(service)
                logger.warning("session_renew_still_expired", service=service)
            return fresh
        # _renew_and_report already fed session_alert: dead / no_cookies always
        # mark; otherwise a mark (second strike, or a retry that failed) means a
        # dead session for now.
        if outcome in ("dead", "no_cookies") or session_alert.needs_login(service):
            return {**status, "authenticated": False, "session_expired": True}
        return status

    def _load_token_for_renewal(self, service: str) -> tuple[Optional[dict], bool]:
        """Fresh (uncached) stored session and whether its token is expired."""
        group = self._get_group(service)
        self._invalidate_session_cache(group.value)
        data = self._load_session_cached(group.value)
        token = (data or {}).get("access_token")
        if not token:
            return data, False
        return data, self._is_token_expired(token)

    def _save_refreshed(self, service: str, client: Client) -> float:
        """Persist the credentials ``client`` just refreshed; return remaining seconds.

        A successful refresh always sets ``access_token`` (pysaka raises rather than
        returning success without one), so narrow ``str | None`` to ``str`` here.
        """
        group = self._get_group(service)
        new_token = cast(str, client.access_token)
        get_token_manager().save_session(
            group.value,
            new_token,
            client.refresh_token,  # persist any refresh_token returned; parity with sync_service
            client.cookies,
        )
        # SD-BE-API-04: refresh rotated the stored token; invalidate the cache so
        # status reads pick up the new (longer-lived) one.
        self._invalidate_session_cache(group.value)
        return self._get_token_remaining_seconds(new_token)

    async def renew_expired(self, service: str) -> str:
        """Renew ``service``'s expired token with its session cookie, single-flight.

        Returns ``ok`` (renewed and saved), ``not_expired`` (another caller renewed
        it while we waited, or the stored token is not expired), ``no_cookies``,
        ``dead`` (SessionExpiredError), ``refresh_failed`` (RefreshFailedError or
        a ``False`` refresh), ``error`` (anything else, e.g. offline or a gate
        timeout) or ``skipped`` (``session_alert.renew_block_reason``: an
        ``expired`` mark, a ``refresh_failed`` mark before its slow retry, or the
        retry cooldown; checked before and again right after acquiring the gate,
        so a caller that waited behind a failed refresh does not refresh again).
        Only ``ok`` (a real refresh) calls ``session_alert.clear``, removing a
        ``refresh_failed`` mark and its tray alert. ``not_expired`` resets
        strikes and cooldown for an unmarked service; a marked service keeps its
        mark (no network proof) and waits for its next slow retry. Logs
        ``session_renew`` (with ``reason`` when skipped, ``after_wait`` when the
        re-check skipped, ``mark_kept`` for an unproven marked retry) and
        ``session_renew_retry`` when a marked service is retried; never raises.
        Cancellation propagates (a refreshed save still finishes first).
        """
        reason = session_alert.renew_block_reason(service)
        if reason is not None:
            logger.info(
                "session_renew", service=service, outcome="skipped", reason=reason
            )
            return "skipped"
        if session_alert.needs_login(service):
            logger.info(
                "session_renew_retry",
                service=service,
                kind=session_alert.mark_kind(service),
            )
        try:
            async with refresh_gate.hold(service):
                # Another caller may have failed while we waited at the gate.
                reason = session_alert.renew_block_reason(service)
                if reason is not None:
                    logger.info(
                        "session_renew",
                        service=service,
                        outcome="skipped",
                        reason=reason,
                        after_wait=True,
                    )
                    return "skipped"
                data, expired = await asyncio.to_thread(
                    self._load_token_for_renewal, service
                )
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
                        refreshed = await client.refresh_access_token(session)
                    if refreshed:
                        await self._save_refreshed_uncancellable(service, client)
                        outcome = "ok"
                    else:
                        outcome = "refresh_failed"
        except SessionExpiredError:
            outcome = "dead"
        except RefreshFailedError:
            outcome = "refresh_failed"
        except Exception as e:
            logger.warning(
                "session_renew_error", service=service, error_type=type(e).__name__
            )
            outcome = "error"
        if outcome == "ok":
            await session_alert.clear(service)
        elif outcome == "not_expired" and session_alert.needs_login(service):
            # No refresh ran, so nothing proves the session alive: keep the
            # mark and wait for the next slow retry.
            session_alert.note_renew_failure(service)
            logger.info(
                "session_renew", service=service, outcome=outcome, mark_kept=True
            )
            return outcome
        elif outcome == "not_expired":
            session_alert.report_success(service)
        elif outcome in ("refresh_failed", "error"):
            session_alert.note_renew_failure(service)
        logger.info("session_renew", service=service, outcome=outcome)
        return outcome

    async def _save_refreshed_uncancellable(
        self, service: str, client: Client
    ) -> float:
        """Run ``_save_refreshed`` in a thread and finish it even when cancelled.

        The refresh already rotated the session cookie, so the save must land
        before the caller's ``refresh_gate`` opens; a cancellation (status-path
        timeout) waits for the save, then propagates.
        """
        save = asyncio.ensure_future(
            asyncio.to_thread(self._save_refreshed, service, client)
        )
        try:
            return await asyncio.shield(save)
        except asyncio.CancelledError:
            await save
            raise

    async def login_with_browser(self, service: str, attempt: Optional[str] = None):
        """
        Launch browser for OAuth login.

        Args:
            service: The service to log in to (e.g., 'hinatazaka46').
            attempt: The frontend's id for this login, so a cancel that arrives
                before the login registers is not lost.

        Returns True once the credentials are saved, False when the browser flow
        returned nothing or failed. A cancellation (``cancel_login``, a newer
        login superseding this one, or shutdown) re-raises ``CancelledError``;
        the caller tells the user's Cancel apart with ``consume_login_cancel``.
        Once the credentials are saved the login can no longer be cancelled.

        Raises:
            LoginCancelledError: ``attempt`` was cancelled before the login
                registered; no browser was opened.
        """
        validate_service(service)
        group = self._get_group(service)
        self._refuse_if_cancelled_early(service, attempt)

        # Supersede any in-progress browser login (e.g. the user switched
        # services, or a previous window was abandoned). Cancelling closes the
        # old browser and releases the lock, instead of silently queueing behind
        # it — which previously deadlocked until the 5-minute login timeout.
        await self._supersede_active_login(service)

        async with self._browser_lock:
            # A cancel may have arrived while this waited for the supersede or
            # the lock; once registered below, a cancel finds this task.
            self._refuse_if_cancelled_early(service, attempt)
            self._active_login_task = asyncio.current_task()
            self._active_login_service = service
            self._active_login_attempt = attempt
            try:
                logger.info(
                    "Starting browser login",
                    service=service,
                    has_session_dir=bool(self._session_dir),
                )

                creds = await BrowserAuth.login(
                    group=group,
                    headless=False,
                    user_data_dir=str(self._session_dir),
                    channel="chrome",
                )

                if creds:
                    # The browser flow stays outside the gate; only the save is
                    # held, so a renewal in flight can never write its older
                    # rotated credentials over this fresh login.
                    async with refresh_gate.hold(service):
                        self._save_credentials(service, creds)
                    # Saved on a single-session token: from here a Cancel must
                    # not undo the login, so it is no longer the active one.
                    self._clear_active_login(finished=attempt)
                    logger.info(
                        "Login successful, credentials saved to TokenManager",
                        service=service,
                    )
                    await session_alert.clear(service)
                    return True

            except asyncio.CancelledError:
                logger.info(
                    "browser_login_cancelled",
                    service=service,
                    reason="user" if service in self._cancelled else "superseded",
                )
                raise
            except Exception as e:
                logger.error(
                    "Login error", service=service, error_type=type(e).__name__
                )
                return False
            finally:
                if self._active_login_task is asyncio.current_task():
                    self._clear_active_login(finished=attempt)

        return False

    def _clear_active_login(self, finished: Optional[str] = None) -> None:
        self._active_login_task = None
        self._active_login_service = None
        self._active_login_attempt = None
        if finished is not None:
            self._finished_attempts.append(finished)

    def _refuse_if_cancelled_early(self, service: str, attempt: Optional[str]) -> None:
        """Raise ``LoginCancelledError`` when ``attempt`` has a pending cancel."""
        if attempt is None or (service, attempt) not in self._pending_cancels:
            return
        self._pending_cancels.remove((service, attempt))
        self._finished_attempts.append(attempt)
        logger.info("browser_login_cancelled", service=service, reason="early")
        raise LoginCancelledError()

    async def _cancel_and_wait(
        self, task: "asyncio.Task[Any]", timeout: Optional[float] = None
    ) -> bool:
        """Cancel ``task`` and wait for it to unwind (its browser closes, the
        lock is released). Returns False when ``timeout`` ran out first; the
        task keeps unwinding."""
        task.cancel()
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if task in done and not task.cancelled():
            # Retrieve the result so an exception is never reported unretrieved.
            with contextlib.suppress(Exception):
                task.exception()
        return task in done

    async def cancel_login(self, service: str, attempt: Optional[str] = None) -> bool:
        """Cancel the browser login of ``service`` (the dialog's Cancel).

        - The active login of ``service`` (and of ``attempt``, when both carry
          one): cancels it and waits up to ``LOGIN_CANCEL_WAIT_SECONDS`` for it
          to unwind (its browser closes, ``_browser_lock`` is released). While
          it unwinds, ``service`` carries the marker ``consume_login_cancel``
          reads. A wait that runs out is logged ``login_cancel_timeout`` and
          still answers True; the marker stays until the login is done.
        - An ``attempt`` that has not registered yet and has not finished: the
          cancel is kept, and that login refuses to start (no browser opens).
        - Otherwise (no login, another service's, or one that finished, which
          may have saved its credentials): nothing happens.

        Returns True when a login was cancelled (or will refuse to start), False
        otherwise. Logs ``login_cancel`` (service, outcome ``cancelled`` |
        ``pending`` | ``none``).

        Raises:
            ValueError: ``service`` is not a known service.
        """
        validate_service(service)
        task = self._active_login_task
        active = (
            task is not None
            and not task.done()
            and self._active_login_service == service
            and (attempt is None or self._active_login_attempt in (None, attempt))
        )
        if not active or task is None:
            if attempt is not None and attempt not in self._finished_attempts:
                self._pending_cancels.append((service, attempt))
                logger.info("login_cancel", service=service, outcome="pending")
                return True
            logger.info("login_cancel", service=service, outcome="none")
            return False
        self._cancelled.add(service)
        logger.info("login_cancel", service=service, outcome="cancelled")

        def drop_marker(_task: "asyncio.Task[Any]") -> None:
            self._cancelled.discard(service)

        try:
            finished = await self._cancel_and_wait(task, LOGIN_CANCEL_WAIT_SECONDS)
        except asyncio.CancelledError:
            # This request itself was cancelled (shutdown): the login still
            # unwinds and drops the marker when done.
            task.add_done_callback(drop_marker)
            raise
        if finished:
            self._cancelled.discard(service)
        else:
            logger.warning(
                "login_cancel_timeout",
                service=service,
                wait_s=LOGIN_CANCEL_WAIT_SECONDS,
            )
            task.add_done_callback(drop_marker)
        return True

    def consume_login_cancel(self, service: str) -> bool:
        """True once if ``cancel_login`` is unwinding ``service``'s login.

        ``POST /login`` calls this when ``login_with_browser`` raised
        ``CancelledError``: True means the user cancelled (answer 409), False
        means another cancellation (shutdown, a superseding login) that must
        propagate. The marker is removed, so it is read at most once.
        """
        if service in self._cancelled:
            self._cancelled.discard(service)
            return True
        return False

    async def _supersede_active_login(self, new_service: str) -> None:
        """Cancel any in-progress browser login so a newer one can take over."""
        task = self._active_login_task
        if task is not None and not task.done():
            logger.info(
                "Superseding in-progress browser login", new_service=new_service
            )
            # Wait for it to unwind (closing its browser, releasing the lock).
            await self._cancel_and_wait(task)

    def _save_credentials(self, service: str, creds: Mapping[str, Any]):
        """Save credentials to pysaka's TokenManager (CLI pattern)."""
        group = self._get_group(service)
        try:
            tm = get_token_manager()
            # Pass missing keys through as None (save_session's access_token is
            # typed str but accepts None at runtime for partial/cleared creds).
            tm.save_session(
                group.value,
                cast(str, creds.get("access_token")),
                creds.get("refresh_token"),
                creds.get("cookies"),
            )
            # SD-BE-API-04: freshly-saved credentials must invalidate the cache
            # so the next status read reflects them instead of the stale entry.
            self._invalidate_session_cache(group.value)
            logger.info("Credentials saved to TokenManager", service=service)
        except Exception as e:
            logger.error(
                "Failed to save credentials",
                service=service,
                error_type=type(e).__name__,
            )
            raise

    def _delete_session(self, service: str, group: Group) -> None:
        """Delete the stored session and its cached status. Never raises."""
        try:
            tm = get_token_manager()
            tm.delete_session(group.value)
            # SD-BE-API-04: drop the cached session so a subsequent status read
            # does not report the logged-out service as still authenticated.
            self._invalidate_session_cache(group.value)
            logger.info("Credentials cleared from TokenManager", service=service)
        except Exception as e:
            logger.error(
                "Failed to clear credentials",
                service=service,
                error_type=type(e).__name__,
            )

    async def logout(self, service: str):
        """
        Clear credentials for a specific service and forget its needs-login mark.

        Holds the service's ``refresh_gate`` while deleting, so a renewal that
        already holds it (and saves inside it) finishes first and its session
        is then deleted. If the gate stays busy past ``GATE_WAIT_SECONDS`` the
        session is deleted anyway (``logout_gate_timeout``). Pending memories
        exports are dropped too (``logout_exports_cleared``, ``count``): they
        hold the previous session's content (security audit 2026-11-13).

        Args:
            service: The service to log out of (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        try:
            async with refresh_gate.hold(group.value):
                self._delete_session(service, group)
        except TimeoutError:
            logger.warning("logout_gate_timeout", service=service)
            self._delete_session(service, group)
        # A logged-out service must not keep reporting session_expired.
        await session_alert.clear(service)

        from backend.services.memories import exports

        held = len(exports.store)
        exports.store.clear()
        logger.info("logout_exports_cleared", count=held)

    def _get_token_remaining_seconds(self, token: str) -> float:
        """Get seconds remaining until token expires. Uses shared pysaka utility."""
        remaining = get_jwt_remaining_seconds(token)
        if remaining is None:
            return -1  # Assume expired if can't parse
        return float(remaining)

    async def refresh_if_needed(
        self, service: str, threshold_minutes: int = 10
    ) -> dict:
        """
        Check token expiry and refresh if within threshold.

        Called by frontend polling to proactively refresh tokens before expiry.

        Args:
            service: The service to check/refresh (e.g., 'hinatazaka46').
            threshold_minutes: Refresh if token expires within this many minutes.

        Returns:
            dict with 'refreshed' (bool), 'remaining_seconds' (float) and 'status':
            ``valid``, ``refreshed``, ``no_token``, ``refresh_failed`` (the refresh
            returned False), ``skipped`` (``session_alert.renew_block_reason``
            blocks a refresh: marked, or inside the retry cooldown), ``error``
            (an exception; logged by type only) or ``test_mode``.

        Failures feed ``session_alert`` like ``renew_expired`` does:
        ``SessionExpiredError`` reports ``expired``; ``RefreshFailedError`` or a
        ``False`` refresh starts the cooldown and reports ``refresh_failed``; any
        other error starts the cooldown. A refresh that worked calls
        ``session_alert.clear``.
        """
        validate_service(service)
        group = self._get_group(service)

        logger.debug(
            "refresh_if_needed called",
            service=service,
            threshold_minutes=threshold_minutes,
        )

        if is_test_mode():
            return {
                "refreshed": False,
                "remaining_seconds": 3600,
                "status": "test_mode",
            }

        try:
            async with refresh_gate.hold(service):
                # Re-read inside the gate: a waiter must see a token another
                # caller just renewed, not a stale cached one.
                token_data = await asyncio.to_thread(
                    self._reload_session_fresh, group.value
                )

                if not token_data or not token_data.get("access_token"):
                    logger.warning("No token found for refresh check", service=service)
                    return {
                        "refreshed": False,
                        "remaining_seconds": 0,
                        "status": "no_token",
                    }

                token = token_data["access_token"]
                remaining_seconds = self._get_token_remaining_seconds(token)
                threshold_seconds = threshold_minutes * 60

                logger.debug(
                    "Token status",
                    service=service,
                    remaining_seconds=round(remaining_seconds),
                    threshold_seconds=threshold_seconds,
                )

                # If token is still valid and not within threshold, no refresh needed
                if remaining_seconds > threshold_seconds:
                    logger.debug(
                        "Token still valid, no refresh needed", service=service
                    )
                    return {
                        "refreshed": False,
                        "remaining_seconds": remaining_seconds,
                        "status": "valid",
                    }

                # Token is expired or within threshold - attempt refresh, unless
                # the service is marked or inside its retry cooldown.
                reason = session_alert.renew_block_reason(service)
                if reason is not None:
                    logger.info(
                        "session_renew",
                        service=service,
                        outcome="skipped",
                        reason=reason,
                        path="refresh_if_needed",
                    )
                    return {
                        "refreshed": False,
                        "remaining_seconds": remaining_seconds,
                        "status": "skipped",
                    }
                logger.info(
                    "Token expiring soon, attempting refresh",
                    service=service,
                    remaining_seconds=round(remaining_seconds),
                )

                # Proper API-based refresh via Client.refresh_access_token()
                # using the web request profile (cookie/session refresh with
                # headless-browser fallback).
                client = Client(
                    group=group,
                    access_token=token,
                    cookies=token_data.get("cookies"),
                    auth_dir=self._session_dir,
                )

                async with aiohttp.ClientSession() as session:
                    refresh_success = await client.refresh_access_token(session)

                    if refresh_success:
                        new_remaining = await asyncio.to_thread(
                            self._save_refreshed, service, client
                        )
                        await session_alert.clear(service)
                        logger.info(
                            "Token refreshed successfully via API",
                            service=service,
                            new_remaining_seconds=round(new_remaining),
                        )
                        return {
                            "refreshed": True,
                            "remaining_seconds": new_remaining,
                            "status": "refreshed",
                        }
                    else:
                        logger.warning(
                            "API-based refresh failed, session may require re-login",
                            service=service,
                        )
                        session_alert.note_renew_failure(service)
                        await session_alert.report(service, "refresh_failed")
                        return {
                            "refreshed": False,
                            "remaining_seconds": remaining_seconds,
                            "status": "refresh_failed",
                        }

        except SessionExpiredError:
            logger.warning(
                "refresh_if_needed error",
                service=service,
                error_type="SessionExpiredError",
            )
            await session_alert.report(service, "expired")
        except RefreshFailedError:
            logger.warning(
                "refresh_if_needed error",
                service=service,
                error_type="RefreshFailedError",
            )
            session_alert.note_renew_failure(service)
            await session_alert.report(service, "refresh_failed")
        except Exception as e:
            logger.error(
                "refresh_if_needed error", service=service, error_type=type(e).__name__
            )
            session_alert.note_renew_failure(service)
        return {"refreshed": False, "remaining_seconds": 0, "status": "error"}

    def get_config(self, service: str) -> dict:
        """
        Get the current config for a specific service (for sync service).

        Args:
            service: The service to get config for (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        if is_test_mode():
            from backend.fixtures.test_data import TEST_AUTH_CONFIG

            return cast(Dict[Any, Any], TEST_AUTH_CONFIG)

        try:
            tm = get_token_manager()
            token_data = tm.load_session(group.value)
            return cast(Dict[Any, Any], token_data or {})
        except Exception as e:
            logger.error(
                "Failed to load config", service=service, error_type=type(e).__name__
            )
            return {}

    async def check_geo_availability(self, service: str) -> dict:
        """Whether a region-restricted service is usable from here. Yodel's web
        service is Japan-only; Yodel's endpoints don't hard-block by IP in a way
        we can probe, so we detect the user's country via geo-IP (the desktop
        backend runs locally, so the lookup reflects the user's own IP) and warn
        when it is not Japan.

        Returns ``{"service", "restricted", "available", "blocked", "country"}``.
        Only Yodel is region-locked — every other service returns available with
        no network call.
        """
        validate_service(service)
        if service != Group.YODEL.value:
            return {
                "service": service,
                "restricted": False,
                "available": True,
                "blocked": False,
                "country": None,
            }

        country = await self._lookup_country()
        blocked = _region_is_blocked(country)
        logger.info("yodel.geo_check", country=country, blocked=blocked)
        return {
            "service": service,
            "restricted": True,
            "available": not blocked,
            "blocked": blocked,
            "country": country,
        }

    async def _lookup_country(self) -> Optional[str]:
        """Best-effort ISO country code for this machine's public IP, via a free
        no-key geo-IP service (with a fallback). None if all lookups fail, so the
        caller fails open."""
        providers = [
            (
                "http://ip-api.com/json/?fields=status,countryCode",
                lambda d: d.get("countryCode")
                if d.get("status") == "success"
                else None,
            ),
            (
                "https://ipwho.is/",
                lambda d: d.get("country_code") if d.get("success", True) else None,
            ),
        ]
        timeout = aiohttp.ClientTimeout(total=6)
        for url, extract in providers:
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.get(url) as resp:
                        if resp.status != 200:
                            continue
                        data = await resp.json(content_type=None)
                        code = extract(data)
                        if code:
                            return str(code).upper()
            except Exception as e:
                logger.debug("geoip_lookup_failed", url=url, error=str(e))
        return None
