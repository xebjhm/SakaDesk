"""
Authentication Service for SakaDesk

Uses pysaka's TokenManager for credential storage (same as CLI).
This ensures consistent behavior across CLI and GUI:
- Windows: Windows Credential Manager (WCM)
- Linux: Plaintext fallback (development only)
"""

import asyncio
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
from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode
from backend.services.service_utils import (
    get_all_services,
    get_service_enum,
    validate_service,
)

logger = structlog.get_logger(__name__)

# Bound on the in-line renewal of the status path (``get_status``), which the
# app's loading screen waits on. A slower renewal is cancelled and counts as
# outcome ``error``; the sync path renews without this bound.
STATUS_RENEW_TIMEOUT_SECONDS = 20.0


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
                error=str(e),
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

    async def _renew_for_status(self, service: str) -> str:
        """``renew_expired`` bounded by ``STATUS_RENEW_TIMEOUT_SECONDS``.

        On timeout the renewal is cancelled (the gate and the pysaka refresh
        unwind through their ``async with`` blocks), the retry cooldown starts,
        ``session_renew`` (outcome ``timeout``) is logged and ``error`` is
        returned, so the service is never marked for a slow renewal.
        """
        try:
            async with asyncio.timeout(STATUS_RENEW_TIMEOUT_SECONDS):
                return await self.renew_expired(service)
        except TimeoutError:
            session_alert.note_renew_failure(service)
            logger.info(
                "session_renew",
                service=service,
                outcome="timeout",
                timeout_s=STATUS_RENEW_TIMEOUT_SECONDS,
            )
            return "error"

    async def _settle(self, service: str, status: dict) -> dict:
        """Renew an expired token, then report the live status (spec B1 §1).

        Adds ``session_expired: True`` only for a dead session. ``token_expired``
        without ``session_expired`` means "not renewed this time, will retry"
        (outcome ``error``, ``skipped``, a timeout, or a first
        ``refresh_failed`` strike). A marked service reads ``session_expired``
        unless its slow retry (``refresh_failed`` marks only, see
        ``session_alert.MARKED_RETRY_SECONDS``) is due and succeeds.
        """
        marked = session_alert.needs_login(service)
        if marked and not session_alert.may_renew(service):
            return {**status, "authenticated": False, "session_expired": True}
        if not marked and not status.get("token_expired"):
            return status
        outcome = await self._renew_for_status(service)
        if outcome in ("ok", "not_expired"):
            fresh = await asyncio.to_thread(self._get_service_auth_status, service)
            if fresh.get("token_expired"):
                # Renewed (or found renewed) yet the stored token still reads
                # expired (e.g. clock skew): back off so the next poll does not
                # refresh again at once.
                session_alert.note_renew_failure(service)
                logger.warning("session_renew_still_expired", service=service)
            return fresh
        if outcome in ("dead", "no_cookies"):
            await session_alert.report(service, "expired")
            return {**status, "authenticated": False, "session_expired": True}
        if marked:
            return {**status, "authenticated": False, "session_expired": True}
        if outcome == "refresh_failed" and await session_alert.report(
            service, "refresh_failed"
        ):
            return {**status, "session_expired": True}
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
        retry cooldown). ``ok`` / ``not_expired`` call ``session_alert.clear``
        (removing a ``refresh_failed`` mark and its tray alert). Logs
        ``session_renew`` (with ``reason`` when skipped) and
        ``session_renew_retry`` when a marked service is retried; never raises.
        Cancellation propagates (see ``_renew_for_status``).
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
        if outcome in ("ok", "not_expired"):
            await session_alert.clear(service)
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

    async def login_with_browser(self, service: str):
        """
        Launch browser for OAuth login.

        Args:
            service: The service to log in to (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        # Supersede any in-progress browser login (e.g. the user switched
        # services, or a previous window was abandoned). Cancelling closes the
        # old browser and releases the lock, instead of silently queueing behind
        # it — which previously deadlocked until the 5-minute login timeout.
        await self._supersede_active_login(service)

        async with self._browser_lock:
            self._active_login_task = asyncio.current_task()
            try:
                logger.info(
                    "Starting browser login",
                    service=service,
                    session_dir=str(self._session_dir),
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
                    logger.info(
                        "Login successful, credentials saved to TokenManager",
                        service=service,
                    )
                    await session_alert.clear(service)
                    return True

            except asyncio.CancelledError:
                logger.info(
                    "Browser login superseded by a newer request", service=service
                )
                raise
            except Exception as e:
                logger.error(
                    "Login error", service=service, error_type=type(e).__name__
                )
                return False
            finally:
                if self._active_login_task is asyncio.current_task():
                    self._active_login_task = None

        return False

    async def _supersede_active_login(self, new_service: str) -> None:
        """Cancel any in-progress browser login so a newer one can take over."""
        task = self._active_login_task
        if task is not None and not task.done():
            logger.info(
                "Superseding in-progress browser login", new_service=new_service
            )
            task.cancel()
            # Wait for it to unwind (closing its browser, releasing the lock).
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

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
            logger.error("Failed to save credentials", service=service, error=str(e))
            raise

    async def logout(self, service: str):
        """
        Clear credentials for a specific service and forget its needs-login mark.

        Args:
            service: The service to log out of (e.g., 'hinatazaka46').
        """
        validate_service(service)
        group = self._get_group(service)

        try:
            tm = get_token_manager()
            tm.delete_session(group.value)
            # SD-BE-API-04: drop the cached session so a subsequent status read
            # does not report the logged-out service as still authenticated.
            self._invalidate_session_cache(group.value)
            logger.info("Credentials cleared from TokenManager", service=service)
        except Exception as e:
            logger.error("Failed to clear credentials", service=service, error=str(e))
        # A logged-out service must not keep reporting session_expired.
        await session_alert.clear(service)

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
            logger.error("Failed to load config", service=service, error=str(e))
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
