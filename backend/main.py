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
    log_dir = Path(base) / "hakodesk" / "logs"
else:  # Linux/Mac (dev)
    log_dir = Path.home() / ".hakodesk" / "logs"
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
import structlog  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from backend.api import auth, content, sync, settings, diagnostics, profile, report, version, notifications, favorites, chat_features, blogs, search  # noqa: E402

logger = structlog.get_logger(__name__)

app = FastAPI(title="HakoDesk")

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
