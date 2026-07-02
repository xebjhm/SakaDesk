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

# Determine log directory (inline to avoid importing platform module yet)
if os.name == "nt":  # Windows
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
)

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle for the application."""
    # --- Startup ---
    # Remove leftover upgrade files from a previous cancelled/failed upgrade
    from backend.services.upgrade_service import cleanup_upgrade_files

    cleanup_upgrade_files()

    background_task = asyncio.create_task(_deferred_blog_backup())

    yield

    # --- Shutdown ---
    # Cancel the deferred blog backup if it's still pending
    if not background_task.done():
        background_task.cancel()
        try:
            await background_task
        except asyncio.CancelledError:
            pass

    # Stop any running blog backup tasks so their asyncio Tasks end cleanly
    from backend.services.blog_service import get_blog_backup_manager

    try:
        get_blog_backup_manager().shutdown()
    except Exception:
        pass

    from backend.services.search_service import shutdown_search_service

    shutdown_search_service()
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


app = FastAPI(title="SakaDesk", lifespan=lifespan)

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
    """CSRF / DNS-rebinding defense for the local API (SEC-2b).

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
        # "../../pyproject.toml"). Resolve the joined path and require it to
        # stay within the resolved dist root before serving. On any escape,
        # bad characters, or non-file, fall through to index.html.
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
