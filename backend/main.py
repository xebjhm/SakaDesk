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

# On-demand ONNX runtime provisioning (Task 6): make onnxruntime importable
# BEFORE anything else in this process imports it -- a packaged Windows build
# ships without onnxruntime bundled (Task 7 excludes it from the PyInstaller
# build), so the very first `import onnxruntime` anywhere downstream (e.g.
# inside `pysaka.knowledge.backends.onnx_embedder`, first pulled in by
# `backend.services.knowledge_service._build_embedder`) could otherwise fail
# with a raw `ModuleNotFoundError` instead of the app's own "not ready yet"
# handling. In dev/tests onnxruntime lives in the venv, so this call finds it
# via `importlib.util.find_spec` and returns `"bundled"` -- a pure no-op, same
# as every other call site of this function (see
# `onnx_runtime_loader.ensure_onnxruntime_importable`'s docstring). In a
# packaged build where the runtime was already downloaded in a prior session,
# this prepends its install dir to `sys.path`/the DLL search path so the KB
# can use it immediately without needing to re-trigger a download this run.
from backend.services.onnx_runtime_loader import (  # noqa: E402
    ensure_onnxruntime_importable,
)

ensure_onnxruntime_importable()

# === NOW SAFE TO IMPORT OTHER MODULES ===
import asyncio  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402
from urllib.parse import urlparse  # noqa: E402

import structlog  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from starlette.middleware.trustedhost import TrustedHostMiddleware  # noqa: E402
from backend.api import (  # noqa: E402
    ai,
    auth,
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
    blogs,
    search,
    read_states,
    transcription,
    translation,
    app_state as app_state_api,
)
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

# Deliberate startup delay shared by both deferred background sweeps below
# (`_deferred_blog_backup` and `_deferred_kb_initial_build`): gives the real
# sync/backup-completion hooks time to fire and enqueue their own work first,
# so these startup sweeps mostly find "nothing to do" instead of routinely
# racing a live hook doing the SAME work for the SAME service. KB review
# Finding 1: `_deferred_kb_initial_build` used to fire with ZERO delay (unlike
# this constant), so the startup sweep raced a live sync-completion hook's KB
# index on every app launch that happened to have pending sync work.
_STARTUP_DEFERRED_DELAY_S = 60


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle for the application."""
    # --- Startup ---
    # Remove leftover upgrade files from a previous cancelled/failed upgrade
    from backend.services.upgrade_service import cleanup_upgrade_files

    cleanup_upgrade_files()

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
    _writer_stops.append(_stop_all_sync_services)
    _writer_stops.append(get_blog_backup_manager().stop_async)
    _writer_stops.append(stop_search_service)
    _writer_stops.append(drain_background_tasks)

    background_task = asyncio.create_task(_deferred_blog_backup())
    kb_initial_build_task = asyncio.create_task(_deferred_kb_initial_build())

    # Warm the translation key-status cache in the background so the first
    # Settings -> AI open is instant instead of paying the OS keyring read then.
    from backend.api.translation import warm_key_status_cache

    # Retain via the tracked-task registry so it isn't garbage-collected mid-flight
    # and is drained on shutdown (SD-BE-API-11).
    track_background_task(
        asyncio.to_thread(warm_key_status_cache), name="warm_key_status_cache"
    )

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

    # Cancel the deferred blog backup if it's still pending
    if not background_task.done():
        background_task.cancel()
        try:
            await background_task
        except asyncio.CancelledError:
            pass

    # Cancel the deferred KB initial-build check if it's still pending. Any
    # per-service rebuild it may have already scheduled lives in
    # `background_tasks.track_background_task`'s own retained set, independent
    # of this wrapper task -- cancelling this one only stops the (cheap)
    # enabled-check/fan-out, never an in-flight rebuild.
    if not kb_initial_build_task.done():
        kb_initial_build_task.cancel()
        try:
            await kb_initial_build_task
        except asyncio.CancelledError:
            pass

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
    await asyncio.sleep(_STARTUP_DEFERRED_DELAY_S)  # let sync finish and enqueue first
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


async def _deferred_kb_initial_build():
    """On startup, if the KB chatbot is enabled, catch up any service that
    synced (or was backed up) while the KB was off/never rebuilt.

    Confirmed bug (`pwave-confirmed-bugs.md`): blog/message indexing only ever
    fires as a side hook of a backup/sync completing, so a user who already has
    a synced library when they enable the KB (or whose sync ran while the KB
    was disabled) gets an empty or stale corpus until they happen to find the
    Rebuild button. This mirrors `_deferred_blog_backup`'s pattern (the SAME
    deliberate `_STARTUP_DEFERRED_DELAY_S` delay, then a retained local
    `asyncio.Task`, cancelled at shutdown -- see `lifespan`) but schedules the
    actual per-service work through `schedule_initial_build_all`, which fans
    out via `background_tasks.track_background_task` (so a multi-minute first
    index can't be silently garbage-collected) -- this wrapper task itself is
    just the delay + cheap enabled-check + fan-out.

    KB review Finding 1: this sweep used to fire with ZERO delay, unlike
    `_deferred_blog_backup`'s deliberate 60s wait -- so it routinely raced a
    live sync-completion hook indexing the SAME service right after startup,
    both writing `KnowledgeService`'s (then process-wide) progress at once.
    Sharing the delay makes that race rare in the first place; `rebuild()`'s
    per-service in-flight registry (see `KnowledgeService._index_inflight`) is
    the actual fix that makes it harmless even when it does happen -- one of
    the two calls simply skips.

    Deliberately does NOT try to distinguish "empty" from "stale" up front:
    `rebuild()`'s no-op fast path (Task 3 item 5) makes a rebuild of an
    already-fully-indexed service a cheap content-hash pass with zero
    embedding, so it's simpler and just as cheap to always run one per synced
    service rather than pre-checking document counts.
    """
    await asyncio.sleep(_STARTUP_DEFERRED_DELAY_S)  # mirrors _deferred_blog_backup
    try:
        from backend.services.knowledge_service import (
            kb_enabled,
            schedule_initial_build_all,
        )

        if not await kb_enabled():
            return
        await schedule_initial_build_all()
    except Exception as e:
        logger.warning(f"KB initial build check failed (non-fatal): {e}")


app = FastAPI(title="SakaDesk", lifespan=lifespan)

# Coded AI errors → {"detail", "code"} so the UI can localize the message.
from backend.api.errors import (  # noqa: E402
    CodedHTTPException,
    coded_http_exception_handler,
)

app.add_exception_handler(CodedHTTPException, coded_http_exception_handler)

# CORS configuration
# In production, frontend is served from same origin (no CORS needed).
# These origins are for development mode when Vite runs on a separate port.
ALLOWED_ORIGINS = [
    "http://localhost:5173",  # Vite dev server default
    "http://127.0.0.1:5173",
    "http://localhost:3000",  # Common alternative
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)


def _is_loopback_origin(origin: str) -> bool:
    """True if an Origin header value points at this app's own loopback host.

    The app is served from http://127.0.0.1:<port> / http://localhost:<port>
    (randomized port), so we compare only the host — any loopback port is ours.
    Non-http(s) schemes and unparseable values are rejected.
    """
    try:
        parsed = urlparse(origin)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    return parsed.hostname in ("127.0.0.1", "localhost")


@app.middleware("http")
async def block_cross_origin_api(request: Request, call_next):
    """CSRF / DNS-rebinding defense for the local API (SEC-2).

    For /api/* requests, reject (403) any request that carries an Origin header
    whose scheme://host is not one of the app's own loopback origins. Browsers
    always attach Origin on cross-site POST/DELETE and on fetch(), so this blocks
    the CSRF vector without requiring the same-origin frontend to send anything
    new. Requests with NO Origin (native/webview/CLI, most same-origin GETs) are
    allowed. CORS preflight (OPTIONS) is never blocked here.
    """
    if request.method != "OPTIONS" and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and not _is_loopback_origin(origin):
            return JSONResponse(
                status_code=403,
                content={"detail": "Cross-origin request rejected"},
            )
    return await call_next(request)


# Restrict the accepted Host header to loopback (defeats DNS rebinding) plus the
# TestClient's "testserver" host. Bare hostnames are matched; ports are ignored
# by TrustedHostMiddleware, so the randomized loopback port is covered.
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost", "testserver"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(sync.router, prefix="/api/sync", tags=["sync"])
app.include_router(content.router, prefix="/api/content", tags=["content"])
app.include_router(settings.router)
app.include_router(diagnostics.router)
app.include_router(profile.router)
app.include_router(report.router)
app.include_router(version.router)
app.include_router(notifications.router)
app.include_router(favorites.router)
app.include_router(chat_features.router)
app.include_router(blogs.router, prefix="/api/blogs", tags=["blogs"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(read_states.router, prefix="/api/read-states", tags=["read-states"])
app.include_router(
    transcription.router, prefix="/api/transcription", tags=["transcription"]
)
app.include_router(translation.router, prefix="/api/translation", tags=["translation"])
app.include_router(ai.router, prefix="/api/ai", tags=["ai"])
app.include_router(app_state_api.router, prefix="/api/app-state", tags=["app-state"])


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve Frontend (Production Mode)
frontend_dist = Path("frontend/dist")
if not frontend_dist.exists():
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"

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
