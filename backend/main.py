from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from backend.api import auth, content, sync, settings, diagnostics, profile, report
from backend.services.platform import get_logs_dir
import logging
import sys

# Force UTF-8 for stdout/stderr to prevent encoding errors on Windows
# This keeps 'print()' calls in dependencies (like pymsg) safe even if console is hidden/CP1252
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')  # type: ignore[union-attr]
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')  # type: ignore[union-attr]

# Configure logging - single debug.log captures everything, filtered at report time
log_dir = get_logs_dir()
log_file = log_dir / "debug.log"

# Clear existing handlers to avoid duplicates
root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)
root_logger.handlers = []

log_format = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# File Handler - DEBUG level (captures everything for bug reports)
file_handler = logging.FileHandler(log_file, encoding="utf-8")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(log_format)
root_logger.addHandler(file_handler)

# Stream Handler (for console) - INFO level
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setLevel(logging.INFO)
stream_handler.setFormatter(log_format)
root_logger.addHandler(stream_handler)


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


@app.get("/health")
async def health():
    return {"status": "ok"}

# Serve Frontend (Production Mode)
# We assume the frontend is built to 'frontend/dist' or '../frontend/dist'
frontend_dist = Path("frontend/dist")
if not frontend_dist.exists():
    # Try looking in specific build location relative to executable or root
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"

if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # API requests already caught by routers above
        # Serve index.html for everything else (SPA routing)
        path = frontend_dist / full_path
        if path.exists() and path.is_file():
            return FileResponse(path)
        return FileResponse(frontend_dist / "index.html")
else:
    logging.warning("Frontend build not found. Run 'npm run build' in frontend directory.")
