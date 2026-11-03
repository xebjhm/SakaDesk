"""Backend auto-sync scheduler.

Runs one asyncio task per service. Each task waits one interval (fixed or
adaptive, see :func:`backend.services.adaptive_sync.next_interval_minutes`),
reloads the settings and decides whether to start a sync. The scheduler lives in
the backend so syncing continues while the window is hidden in the tray.

Decision order for each tick (the first match is the logged ``reason``):
``shutting_down`` -> ``disabled`` -> ``not_configured`` -> ``not_authenticated``
-> launch (``started`` / ``already_running`` / ``shutting_down`` from
:func:`backend.services.sync_launcher.launch_sync`).

Logging uses ids and codes only: ``auto_sync_tick`` (service, reason,
next_minutes) and ``auto_sync_failed`` (service, error_type).

The scheduler never raises out of its tasks. Under pytest and in the E2E test
mode it is not started by the app lifespan (see :func:`scheduler_allowed_in_env`).
"""

from __future__ import annotations

import asyncio
import os
from typing import Any, Awaitable, Callable, Iterable, Mapping, Optional

import structlog

from backend.services.adaptive_sync import next_interval_minutes
from backend.services.shutdown_state import is_shutting_down
from backend.services.sync_launcher import launch_sync

logger = structlog.get_logger(__name__)

# Environment variable that stops the lifespan from starting the scheduler.
# tests/conftest.py sets it so TestClient(app) never spawns real background syncs;
# a test that wants the scheduler removes it (monkeypatch.delenv).
DISABLE_ENV_VAR = "SAKADESK_DISABLE_AUTO_SYNC"

# Used only when the settings cannot be read at all after a failure.
_FALLBACK_INTERVAL_MINUTES = 15.0

REASON_SHUTTING_DOWN = "shutting_down"
REASON_DISABLED = "disabled"
REASON_NOT_CONFIGURED = "not_configured"
REASON_NOT_AUTHENTICATED = "not_authenticated"

SleepFn = Callable[[float], Awaitable[Any]]
LoadSettingsFn = Callable[[], Awaitable[Mapping[str, Any]]]
IsAuthenticatedFn = Callable[[str], Awaitable[bool]]
LaunchFn = Callable[..., Awaitable[str]]


def scheduler_allowed_in_env() -> bool:
    """False under pytest (``SAKADESK_DISABLE_AUTO_SYNC`` set) and in E2E test mode."""
    from backend.services import platform

    if os.environ.get(DISABLE_ENV_VAR):
        return False
    return not platform.is_test_mode()


async def _default_load_settings() -> Mapping[str, Any]:
    from backend.services.settings_store import load_config

    return await load_config()


async def _default_is_authenticated(service: str) -> bool:
    """True when the service has a valid stored session (same check as /api/auth/status)."""
    from backend.api.auth import auth_service

    status = await auth_service.get_status(service)
    return bool(status.get("authenticated"))


class AutoSyncScheduler:
    """Periodically starts background syncs, one task per service."""

    def __init__(
        self,
        services: Iterable[str],
        *,
        sleep: SleepFn = asyncio.sleep,
        load_settings: LoadSettingsFn = _default_load_settings,
        is_authenticated: IsAuthenticatedFn = _default_is_authenticated,
        launch: LaunchFn = launch_sync,
    ) -> None:
        self._services = list(services)
        self._sleep = sleep
        self._load_settings = load_settings
        self._is_authenticated = is_authenticated
        self._launch = launch
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def start(self) -> None:
        """Create one task per service. Idempotent while running."""
        if self._tasks:
            return
        for service in self._services:
            self._tasks[service] = asyncio.create_task(
                self._run(service), name=f"auto_sync_{service}"
            )

    async def stop(self) -> None:
        """Cancel every task and wait until they have unwound. Idempotent."""
        tasks = list(self._tasks.values())
        self._tasks = {}
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _decide(self, service: str, settings: Mapping[str, Any]) -> str:
        if is_shutting_down():
            return REASON_SHUTTING_DOWN
        if not settings["auto_sync_enabled"]:
            return REASON_DISABLED
        if not settings["is_configured"]:
            return REASON_NOT_CONFIGURED
        if not await self._is_authenticated(service):
            return REASON_NOT_AUTHENTICATED
        return await self._launch(service, origin="scheduler")

    async def _run(self, service: str) -> None:
        fixed_minutes = _FALLBACK_INTERVAL_MINUTES
        minutes: Optional[float] = None
        while True:
            try:
                if minutes is None:
                    settings = await self._load_settings()
                    fixed_minutes = float(settings["sync_interval_minutes"])
                    minutes = next_interval_minutes(settings)
                await self._sleep(minutes * 60)

                settings = await self._load_settings()
                fixed_minutes = float(settings["sync_interval_minutes"])
                reason = await self._decide(service, settings)
                minutes = next_interval_minutes(settings)
                logger.info(
                    "auto_sync_tick",
                    service=service,
                    reason=reason,
                    next_minutes=round(minutes, 1),
                )
                if reason == REASON_SHUTTING_DOWN:
                    return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(
                    "auto_sync_failed", service=service, error_type=type(exc).__name__
                )
                # The fixed interval stands in for the next wait, then the loop
                # carries on with a fresh decision.
                minutes = fixed_minutes
