# === LOGGING CONFIGURATION MUST BE FIRST ===
# This MUST happen before importing any modules that use logging
# Otherwise, loggers are cached as unconfigured and won't route properly

import sys
import logging
from pathlib import Path
import os

# Force UTF-8 for stdout/stderr to prevent encoding errors on Windows
# This keeps 'print()' calls in dependencies (like pymsg) safe even if console is hidden/CP1252
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[union-attr]
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')  # type: ignore[union-attr]

# Determine log directory (inline to avoid importing platform module yet)
if os.name == 'nt':  # Windows
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    _app_dir = Path(base) / "HakoDesk"
else:  # Linux/Mac (dev)
    _app_dir = Path.home() / ".HakoDesk"
log_dir = _app_dir / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / "debug.log"

# Configure PyHako's unified logging system (structlog-based)
from pyhako.logging import configure_logging  # noqa: E402
configure_logging(
    log_file=log_file,
    log_level=logging.DEBUG,
    console_level=logging.INFO,
    file_level=logging.DEBUG,
)

# === NOW SAFE TO IMPORT OTHER MODULES ===
import asyncio  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

import structlog  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from backend.api import auth, content, sync, settings, diagnostics, profile, report, version, notifications, favorites, chat_features, blogs, search, read_states  # noqa: E402

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown lifecycle for the application."""
    # --- Startup ---
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

        manager = get_blog_backup_manager()
        # Only start if nothing is already running (frontend toggle may have triggered it)
        if any(manager.is_running(s) for s in manager._tasks):
            return

        from pyhako.credentials import get_token_manager

        tm = get_token_manager()
        services = [s for s in tm.list_sessions() if _is_blog_supported(s)]
        if services:
            await manager.start(services)
            logger.info("Blog backup auto-resumed on startup", services=services)
    except Exception as e:
        logger.warning(f"Blog backup auto-resume failed (non-fatal): {e}")


app = FastAPI(title="HakoDesk", lifespan=lifespan)

# CORS configuration
# In production, frontend is served from same origin (no CORS needed).
# These origins are for development mode when Vite runs on a separate port.
ALLOWED_ORIGINS = [
    "http://localhost:5173",      # Vite dev server default
    "http://127.0.0.1:5173",
    "http://localhost:3000",      # Common alternative
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


@app.get("/health")
async def health():
    return {"status": "ok"}

# Serve Frontend (Production Mode)
frontend_dist = Path("frontend/dist")
if not frontend_dist.exists():
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        path = frontend_dist / full_path
        if path.exists() and path.is_file():
            return FileResponse(path)
        return FileResponse(frontend_dist / "index.html")
else:
    logger.warning("Frontend build not found. Run 'npm run build' in frontend directory.")
