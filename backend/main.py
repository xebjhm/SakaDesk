# === LOGGING CONFIGURATION MUST BE FIRST ===
# This MUST happen before importing any modules that use logging
# Otherwise, loggers are cached as unconfigured and won't route properly

import sys
import logging
from pathlib import Path
import os

# Force UTF-8 for stdout/stderr to prevent encoding errors on Windows
# This keeps 'print()' calls in dependencies (like pymsg) safe even if console is hidden/CP1252
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

# Determine log directory (inline to avoid importing platform module yet).
# Mirror the precedence in platform.get_app_data_dir(): SAKADESK_DATA_DIR wins so
# that isolated/test runs (which point it at a temp dir) redirect logs too, instead
# of leaking debug.log into the real %LOCALAPPDATA%\SakaDesk\logs.
_data_dir_override = os.environ.get("SAKADESK_DATA_DIR")
if _data_dir_override:
    _app_dir = Path(_data_dir_override)
elif os.name == "nt":  # Windows
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    _app_dir = Path(base) / "SakaDesk"
else:  # Linux/Mac (dev)
    _app_dir = Path.home() / ".SakaDesk"
log_dir = _app_dir / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / "debug.log"

# Configure pysaka's unified logging system (structlog-based)
from pysaka.logging import configure_logging  # noqa: E402

configure_logging(
    log_file=log_file,
    log_level=logging.DEBUG,
    console_level=logging.INFO,
    file_level=logging.DEBUG,
)

# === NOW SAFE TO IMPORT OTHER MODULES ===
import asyncio  # noqa: E402
import mimetypes  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
from urllib.parse import urlparse  # noqa: E402

import structlog  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from starlette.datastructures import Headers  # noqa: E402
from starlette.middleware.trustedhost import TrustedHostMiddleware  # noqa: E402
from starlette.types import Receive, Scope, Send  # noqa: E402
from backend.api import (  # noqa: E402
    auth,
    account,
    content,
    sync,
    settings,
    diagnostics,
    profile,
    report,
    version,
    notifications,
    favorites,
    chat_features,
    client_log,
    ui_state,
    call_popup,
    blogs,
    search,
    read_states,
    transcription,
    translation,
    app_state as app_state_api,
    memories,
    archive,
    media,
    session,
)
from backend.api_no_store import ApiNoStoreMiddleware  # noqa: E402
from backend.security_headers import DOCS_CSP, AppWithSecurityHeaders  # noqa: E402
from backend.services import api_auth, log_throttle  # noqa: E402
from backend.services import app_state  # noqa: E402
from backend.services.data_lock import DataDirLock  # noqa: E402
from backend.services.platform import get_app_data_dir  # noqa: E402
from backend.services.shutdown_state import begin_shutdown  # noqa: E402

logger = structlog.get_logger(__name__)

# OS-level exclusive lock over the data directory's writer subsystem (see
# backend/services/data_lock.py). Acquired on startup, off the event loop, so
# a close->reopen race between an outgoing and incoming instance never lets
# both write at once. Released only after every writer below has been
# stopped and drained (see quiesce_writers / lifespan shutdown).
data_lock = DataDirLock(get_app_data_dir() / ".write.lock")

# Registry of writer-stop thunks (each call returns an awaitable). Services
# register their real stop() during startup; kept as an indirection so the
# barrier itself is unit-testable without booting real services.
_writer_stops: list = []


async def quiesce_writers() -> None:
    """Stop and drain every data-dir writer. Returns only once none can write.

    Per-hook error isolation (I2): one failing hook must not skip the others,
    since a hung/failed sync stop must not also leave the blog or search
    writer undrained. But a failure here must never be swallowed silently --
    logged at ERROR with the hook's name, because releasing the lock right
    after is the one place this really matters: if a writer wasn't actually
    drained, an incoming instance can now race it. Blocking release forever
    on a hung writer would be worse (the next instance could never write), so
    this still proceeds to release -- just loudly, not silently.
    """
    for make in list(_writer_stops):
        hook_name = (
            getattr(make, "__name__", None)
            or getattr(
                getattr(make, "__self__", None), "__class__", type(make)
            ).__name__
        )
        try:
            await make()
        except Exception:
            logger.error(
                "writer stop failed; writer may not be fully drained; "
                "releasing lock anyway to avoid deadlock",
                hook=hook_name,
                exc_info=True,
            )


async def _stop_sync_coordinator() -> None:
    """Drop every queued sync/verify job and stop the coordinator's runner."""
    from backend.services.sync_coordinator import get_coordinator

    await get_coordinator().stop()


async def _stop_all_sync_services() -> None:
    """Stop every lazily-created SyncService (SVC-S1 writer barrier).

    ``backend.api.sync`` creates one ``SyncService`` per messaging service on
    first use, so the set of instances is only known at shutdown time —
    imported locally (not at module load) to avoid a circular import with
    ``backend.api.sync`` -> ``backend.main``.
    """
    from backend.api.sync import _sync_services

    for svc in list(_sync_services.values()):
        await svc.stop()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle for the application."""
    # --- Startup ---
    # Remove leftover upgrade files from a previous cancelled/failed upgrade
    from backend.services.upgrade_service import cleanup_upgrade_files

    cleanup_upgrade_files()

    # Let desktop threads (the tray) schedule coroutines on this loop.
    from backend.services import desktop_bridge

    desktop_bridge.set_server_loop(asyncio.get_running_loop())

    # Windows only: finish closing sockets the browser reset (aborted media
    # downloads) instead of leaving them half-open. Keeps the Proactor loop,
    # which login's Playwright subprocess needs. See proactor_resets.
    # Best effort: a failure here must never stop the server from starting.
    from backend.services import proactor_resets

    try:
        proactor_resets.install_proactor_reset_guard()
    except Exception as exc:
        logger.warning("proactor_reset_guard_failed", error_type=type(exc).__name__)

    # Windows only: a browser that resets a connection before it is accepted
    # must not make CPython close the listening socket (the backend would stop
    # accepting for good). Same best-effort rule as above.
    try:
        proactor_resets.install_proactor_accept_guard()
    except Exception as exc:
        logger.warning("proactor_accept_guard_failed", error_type=type(exc).__name__)

    # Windows only: the re-armed resets above would each still log CPython's
    # "Task exception was never retrieved" at ERROR; downgrade exactly that
    # report to a debug breadcrumb. Same best-effort rule as above.
    try:
        proactor_resets.install_accept_reset_log_filter(asyncio.get_running_loop())
    except Exception as exc:
        logger.warning(
            "proactor_accept_log_filter_failed", error_type=type(exc).__name__
        )

    # Port-independent app state (SQLite) must exist before any reader/writer
    # touches it.
    app_state.init_db()

    # Acquire the data-dir write lock off the event loop so a close->reopen
    # race (a prior instance still draining) never blocks server startup or
    # the UI. If a stale holder does not release within the timeout, log and
    # proceed anyway — atomic writes bound the worst case to a last-writer-
    # wins on a single file, not corruption (see data_lock.py / design doc).
    def _acquire_data_lock() -> bool:
        return data_lock.acquire(timeout=10.0)

    if not await asyncio.to_thread(_acquire_data_lock):
        logger.warning(
            "data_dir_lock_acquire_timed_out",
            lock_path=str(get_app_data_dir() / ".write.lock"),
        )

    # Register every data-dir writer's stop hook so shutdown can quiesce them
    # all before releasing the lock above. Reset first: the TestClient (and a
    # theoretical app restart within one process) re-runs this lifespan
    # against the same module-level list, and stale thunks from a prior
    # startup must not accumulate / run twice.
    from backend.services.blog_service import get_blog_backup_manager
    from backend.services.search_service import stop_search_service
    from backend.services.background_tasks import (
        drain_background_tasks,
        track_background_task,
    )

    # Order matters: stop_search_service must run before drain_background_tasks
    # -- a tracked background task (e.g. verify-and-fix media) writes through
    # the search executors, so draining tracked tasks before search is stopped
    # would let that write race stop_search_service's own teardown.
    _writer_stops.clear()
    # The sync coordinator first: drop its queued jobs so cancelling the running
    # sync below cannot start the next one (spec 2026-11-10 S1).
    _writer_stops.append(_stop_sync_coordinator)
    _writer_stops.append(_stop_all_sync_services)
    _writer_stops.append(get_blog_backup_manager().stop_async)
    _writer_stops.append(stop_search_service)
    # The thumbnail pre-generation worker: stopped (its thread abandoned after
    # media_pregen.STOP_TIMEOUT_S) before tracked tasks drain.
    from backend.services import media_pregen

    _writer_stops.append(media_pregen.stop)
    _writer_stops.append(drain_background_tasks)

    background_task = asyncio.create_task(_deferred_blog_backup())

    from backend.services.memories.exports import sweep_loop

    export_sweep_task = asyncio.create_task(sweep_loop())

    # Warm the translation key-status cache in the background so the first
    # Settings -> AI open is instant instead of paying the OS keyring read then.
    from backend.api.translation import warm_key_status_cache

    # Retain via the tracked-task registry so it isn't garbage-collected mid-flight
    # and is drained on shutdown (SD-BE-API-11).
    track_background_task(warm_key_status_cache(), name="warm_key_status_cache")

    # Background auto-sync (one task per service). Started last so everything it
    # relies on exists; skipped under pytest / E2E test mode (see
    # scheduler_allowed_in_env) so TestClient(app) never spawns real syncs.
    from backend.services.auto_sync_scheduler import (
        AutoSyncScheduler,
        scheduler_allowed_in_env,
    )
    from backend.services.service_utils import get_all_services

    auto_sync_scheduler: AutoSyncScheduler | None = None
    if scheduler_allowed_in_env():
        auto_sync_scheduler = AutoSyncScheduler(get_all_services())
        auto_sync_scheduler.start()
    else:
        logger.info("auto_sync_scheduler_skipped", reason="env")

    # Memories notifications (spec 15): one background task, same env gate.
    from backend.services.memories import notify_scheduler

    memories_notifier: notify_scheduler.MemoriesNotifyScheduler | None = None
    if scheduler_allowed_in_env():
        memories_notifier = notify_scheduler.MemoriesNotifyScheduler(get_all_services())
        memories_notifier.start()
    else:
        logger.info("memories_notify_skipped", reason="env")

    # Thumbnail pre-generation (idle, throttled; stopped via _writer_stops above).
    if scheduler_allowed_in_env():
        media_pregen.start(get_all_services())
    else:
        logger.info("media_pregen_skipped", reason="env")

    yield

    # --- Shutdown ---
    # Flip the shutdown flag FIRST, before anything else -- this is the
    # signal read paths check (search_service.build_full_index's untracked
    # spawn sites; sync/verify start entry points) to refuse spawning a NEW
    # writer once shutdown has begun (C1c). A writer spawned after this point
    # but before quiesce_writers() would otherwise escape the barrier
    # entirely, since quiesce_writers() only drains writers that already
    # existed at the moment it runs.
    begin_shutdown()

    # Desktop threads must stop scheduling onto this loop, and a waiting
    # debounced tray refresh must not outlive it.
    from backend.services.tray_tooltip import cancel_pending

    desktop_bridge.set_server_loop(None)
    await cancel_pending()

    # Cancel the deferred blog backup if it's still pending
    if not background_task.done():
        background_task.cancel()
        try:
            await background_task
        except asyncio.CancelledError:
            pass

    export_sweep_task.cancel()
    try:
        await export_sweep_task
    except asyncio.CancelledError:
        pass

    # Drop any popup call (no toast) before syncs and writers stop.
    from backend.services.call_popup import get_call_popup_controller

    await get_call_popup_controller().shutdown()
    # Its host calls run on their own pool: stop it without waiting on a
    # thread a wedged popup may still hold.
    desktop_bridge.shutdown_call_popup_executor()

    # Stop the auto-sync scheduler before the write barrier so it cannot launch
    # a sync while writers are being drained (launch_sync also refuses once
    # begin_shutdown() has run).
    if auto_sync_scheduler is not None:
        await auto_sync_scheduler.stop()

    # The Memories notifier writes app_state.db (ledger, card baselines) under
    # the data lock, so it must stop before the write barrier below.
    if memories_notifier is not None:
        await memories_notifier.stop()

    # Ordered write barrier (must not be reordered): quiesce+drain every
    # writer registered above, THEN allow final synchronous writes (window
    # geometry, saved by desktop.py's on_closing before process exit), THEN
    # release the lock. Releasing before every writer is stopped would let a
    # still-running writer race an incoming instance; only after this
    # sequence completes is it guaranteed no further data-dir write occurs
    # from this process.
    await quiesce_writers()
    # (Final synchronous writes — e.g. window geometry — happen in
    # desktop.py's on_closing, which already runs before this lifespan's
    # shutdown is signalled via should_exit; no additional write is needed
    # here.)
    data_lock.release()

    # Flush and close all log file handlers so the uninstaller can delete the data directory
    for handler in logging.root.handlers[:]:
        try:
            handler.flush()
            handler.close()
        except Exception:
            pass
    logger.info("Shutdown complete - file handles released")


async def _deferred_blog_backup():
    """Auto-resume blog backup if enabled but not triggered by sync."""
    await asyncio.sleep(60)  # Wait long enough for sync to finish and enqueue
    try:
        from backend.services.settings_store import load_config
        from backend.services.blog_service import (
            get_blog_backup_manager,
            _is_blog_supported,
        )

        settings = await load_config()
        if not settings.get("blogs_full_backup") or not settings.get("is_configured"):
            return

        # If auto-sync is enabled, sync flow handles blog enqueue (Step 3).
        # This startup hook is only for the case where auto-sync is OFF
        # but blogs_full_backup is ON.
        if settings.get("auto_sync_enabled"):
            return

        from pysaka.credentials import get_token_manager
        from pysaka import Group

        manager = get_blog_backup_manager()
        tm = get_token_manager()
        services = [
            g.value
            for g in Group
            if tm.load_session(g.value) and _is_blog_supported(g.value)
        ]
        if services:
            # start() skips services already running (e.g. frontend toggle)
            manager.start(services)
            logger.info("Blog backup auto-resumed on startup", services=services)
    except Exception as e:
        logger.warning(f"Blog backup auto-resume failed (non-fatal): {e}")


def _docs_urls(frozen: bool) -> dict[str, str | None]:
    """FastAPI's /docs, /redoc and /openapi.json only in source runs.

    The docs pages load floating-version CDN scripts into the app's privileged
    origin, and the schema maps every route (security audit 2026-11-13).
    """
    if frozen:
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


def _docs_csp_overrides(docs: dict[str, str | None]) -> dict[str, str]:
    """CSP overrides for the docs pages ``docs`` enables (none when frozen).

    FastAPI's /docs and /redoc load CDN scripts with inline setup, which
    ``APP_CSP`` refuses; in source runs those pages keep only ``DOCS_CSP``.
    """
    paths = [p for p in (docs["docs_url"], docs["redoc_url"]) if p]
    if docs["docs_url"]:
        paths.append(f"{docs['docs_url']}/oauth2-redirect")
    return {path: DOCS_CSP for path in paths}


_docs = _docs_urls(frozen=bool(getattr(sys, "frozen", False)))
app = AppWithSecurityHeaders(
    title="SakaDesk",
    lifespan=lifespan,
    docs_url=_docs["docs_url"],
    redoc_url=_docs["redoc_url"],
    openapi_url=_docs["openapi_url"],
    # CSP, framing, sniffing and embedding headers on every response, including
    # the guards' 400/401/403 and Starlette's own 500 page.
    csp_overrides=_docs_csp_overrides(_docs),
)

# Coded AI errors → {"detail", "code"} so the UI can localize the message.
from backend.api.errors import (  # noqa: E402
    CodedHTTPException,
    coded_http_exception_handler,
)

app.add_exception_handler(CodedHTTPException, coded_http_exception_handler)


def _is_own_origin(origin: str, host: str) -> bool:
    """True only when Origin is exactly ``http(s)://<this request's Host>``.

    TrustedHostMiddleware has already limited Host to loopback names, so an
    exact match means the page came from this server. A page on any other
    loopback port does not match (security audit 2026-11-13).
    """
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False
    return parsed.netloc.lower() == host.lower()


@app.middleware("http")
async def api_guard(request: Request, call_next):
    """Who may call /api (SEC-2 + security audit 2026-11-13).

    1. A request that carries an Origin must come from this server's own
       origin (CSRF, other loopback ports, ``Origin: null``).
    2. Every request must carry the per-launch token in the X-SakaDesk-Token
       header, or for GET/HEAD (and only when the header is absent) the
       HttpOnly cookie set by /api/session/bootstrap, which holds the derived
       ``api_auth.cookie_value()``: the token is refused as the cookie and the
       cookie value as the header. Processes and pages without either get 401.
       A cookie-authorised request whose Sec-Fetch-Site is neither
       same-origin nor none (an absent header is allowed) is also refused.
    Under pytest only (SAKADESK_TEST_CLIENT=1), TestClient's Host: testserver
    skips step 2. Reject logs go through ``log_throttle.reject_logs`` so an
    unauthenticated caller cannot flood debug.log.
    """
    path = request.scope.get("path", "")
    if path.startswith("/api/"):
        host = request.headers.get("host", "")
        origin = request.headers.get("origin")
        if origin is not None and not _is_own_origin(origin, host):
            log_throttle.reject_logs.log(
                logger.info,
                "api_request_rejected",
                reason="origin",
                method=request.method,
            )
            return JSONResponse(
                status_code=403, content={"detail": "Cross-origin request rejected"}
            )
        is_test_client = (
            api_auth.test_client_mode() and host.split(":", 1)[0] == "testserver"
        )
        if not is_test_client:
            token = request.headers.get(api_auth.TOKEN_HEADER, "")
            if token:
                authorized = api_auth.token_ok(token)
            elif request.method in ("GET", "HEAD"):
                cookie = request.cookies.get(api_auth.TOKEN_COOKIE, "")
                fetch_site = request.headers.get("sec-fetch-site")
                if (
                    cookie
                    and fetch_site is not None
                    and fetch_site not in ("same-origin", "none")
                ):
                    log_throttle.reject_logs.log(
                        logger.info,
                        "api_request_rejected",
                        reason="fetch_site",
                        method=request.method,
                    )
                    return JSONResponse(
                        status_code=401, content={"detail": "Unauthorized"}
                    )
                authorized = api_auth.cookie_ok(cookie)
            else:
                authorized = False
            if not authorized:
                log_throttle.reject_logs.log(
                    logger.info,
                    "api_request_rejected",
                    reason="token",
                    method=request.method,
                )
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


# Restrict Host to loopback names (defeats DNS rebinding). TestClient's
# "testserver" is accepted only under pytest (SAKADESK_TEST_CLIENT=1): the
# single-label name could otherwise be rebound (security audit 2026-11-13).
_ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
if api_auth.test_client_mode():
    _ALLOWED_HOSTS.append("testserver")


class _LoggingTrustedHostMiddleware(TrustedHostMiddleware):
    """TrustedHostMiddleware that leaves a breadcrumb (code only, never the Host).

    The breadcrumb shares the guard's rate-limited ``api_request_rejected`` budget.
    """

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket") and not self.allow_any:
            host = Headers(scope=scope).get("host", "").split(":")[0]
            if host not in self.allowed_hosts:
                log_throttle.reject_logs.log(
                    logger.info, "api_request_rejected", reason="host"
                )
        await super().__call__(scope, receive, send)


app.add_middleware(_LoggingTrustedHostMiddleware, allowed_hosts=_ALLOWED_HOSTS)

# API JSON must never enter the browser HTTP cache (cache-lock stalls on polls).
app.add_middleware(ApiNoStoreMiddleware)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(session.router)
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])
app.include_router(content.router, prefix="/api/content", tags=["content"])
app.include_router(media.router, prefix="/api/media", tags=["media"])
app.include_router(settings.router)
app.include_router(diagnostics.router)
app.include_router(profile.router)
app.include_router(report.router)
app.include_router(version.router)
app.include_router(notifications.router)
app.include_router(favorites.router)
app.include_router(chat_features.router)
app.include_router(account.router)
app.include_router(client_log.router)
app.include_router(archive.router)
app.include_router(ui_state.router)
app.include_router(call_popup.router)
app.include_router(blogs.router, prefix="/api/blogs", tags=["blogs"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(read_states.router, prefix="/api/read-states", tags=["read-states"])
app.include_router(
    transcription.router, prefix="/api/transcription", tags=["transcription"]
)
app.include_router(translation.router, prefix="/api/translation", tags=["translation"])
app.include_router(app_state_api.router, prefix="/api/app-state", tags=["app-state"])
app.include_router(memories.router)


@app.get("/health")
async def health(nonce: str | None = None):
    """Liveness for desktop.py. With a nonce, also proves this is SakaDesk's
    backend: only the process holding the launch token can compute the proof."""
    if nonce is not None:
        if api_auth.valid_nonce(nonce):
            return {"status": "ok", "proof": api_auth.health_proof(nonce)}
        log_throttle.reject_logs.log(logger.info, "health_nonce_rejected")
    return {"status": "ok"}


# Exact types for the SPA's own files. On Windows ``mimetypes`` lets the registry
# override its defaults (some setups map .js to text/plain); with nosniff a script
# or stylesheet served with another type is refused and the window stays blank.
_STATIC_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".png": "image/png",
    ".woff2": "font/woff2",
}


def _pin_static_types() -> None:
    """Register ``_STATIC_TYPES`` with ``mimetypes`` (``add_type`` reads the registry first)."""
    for ext, media_type in _STATIC_TYPES.items():
        mimetypes.add_type(media_type, ext)


_pin_static_types()


# Serve Frontend (Production Mode)
def _frontend_dist_dir() -> Path:
    """The built SPA next to the code: ``<repo>/frontend/dist`` in source runs,
    ``<_MEIPASS>/frontend/dist`` when frozen (``tooling/build_windows.spec``).

    Never the working directory: a ``frontend/dist`` planted there would be
    served with the app's authority (security audit 2026-11-13).
    """
    return Path(__file__).resolve().parent.parent / "frontend" / "dist"


frontend_dist = _frontend_dist_dir()

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    # index.html must never be cached — it references hashed asset filenames
    # that change on every build. A cached index.html would keep pointing at
    # an old (missing or stale) bundle after an upgrade. Hashed /assets/*.js
    # files are safe to cache because their name changes when content changes.
    _NO_CACHE_HEADERS = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    # Resolve once so containment checks compare against the real dist root.
    _frontend_dist_resolved = frontend_dist.resolve()

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # SEC-1: Starlette does NOT collapse ".." in a :path segment, so
        # frontend_dist / full_path can escape the dist dir (e.g.
        # "../../pyproject.toml"). Resolve the joined path and require it to stay
        # within the resolved dist root before serving. On any escape, bad
        # characters, or non-file, fall through to index.html.
        if "\x00" not in full_path:
            candidate = (frontend_dist / full_path).resolve()
            if (
                candidate.is_relative_to(_frontend_dist_resolved)
                and candidate.is_file()
            ):
                return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html", headers=_NO_CACHE_HEADERS)
else:
    logger.warning(
        "Frontend build not found. Run 'npm run build' in frontend directory."
    )
