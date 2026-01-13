# HakoDesk Logging Refactor Plan

## Problem Statement

Currently, PyHako (core library) logs do not appear in HakoDesk's debug.log file because:

1. **No Configuration Call**: PyHako's `configure_logging()` is never called in HakoDesk
2. **Import Ordering**: Loggers are cached at import time before any configuration
3. **Dual Systems**: PyHako uses structlog, HakoDesk uses stdlib logging with no bridge
4. **Missing File Handler**: PyHako's logging only outputs to console (stdout)

## Goal

Unify logging so both PyHako and HakoDesk logs:
- Appear in the same `debug.log` file
- Support dual output: File (DEBUG) + Console (INFO)
- Preserve secret redaction from PyHako
- Support environment-based formatting (dev=colored, prod=JSON)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        HakoDesk main.py                         │
│                                                                 │
│  1. Configure logging FIRST (before any imports)                │
│  2. Then import modules                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PyHako logging.py                           │
│                                                                 │
│  configure_logging(log_file=None) ← Enhanced to accept file     │
│                                                                 │
│  structlog.configure(...)                                       │
│       │                                                         │
│       ▼                                                         │
│  structlog.stdlib.LoggerFactory() ← Bridge to stdlib            │
│       │                                                         │
│       ▼                                                         │
│  stdlib root logger                                             │
│       ├── StreamHandler (stdout, INFO)                          │
│       └── FileHandler (debug.log, DEBUG) ← NEW                  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Step 1: Enhance PyHako's `configure_logging()` Function

**File**: `PyHako/src/pyhako/logging.py`

**Changes**:
- Add optional `log_file` parameter for file output
- Add optional `log_level` parameter for root logger level
- Support dual handlers (file + console)
- Return configured logger for verification

```python
def configure_logging(
    log_file: str | Path | None = None,
    log_level: int = logging.INFO,
    console_level: int = logging.INFO,
    file_level: int = logging.DEBUG,
) -> None:
    """
    Configure structured logging for PyHako.

    Args:
        log_file: Optional path to log file. If provided, adds FileHandler.
        log_level: Root logger level (default: INFO)
        console_level: Console handler level (default: INFO)
        file_level: File handler level (default: DEBUG)

    Respects HAKO_ENV environment variable:
    - 'development' (default): Colored, human-readable console output.
    - 'production': JSON output for machine parsing.
    """
```

### Step 2: Refactor HakoDesk's `main.py`

**File**: `HakoDesk/backend/main.py`

**Changes**:
1. Move logging configuration to the VERY TOP (before any imports)
2. Call PyHako's `configure_logging()` with file path
3. Remove duplicate logging setup code
4. Keep platform-specific imports after logging is configured

**New Structure**:
```python
# === LOGGING CONFIGURATION MUST BE FIRST ===
# This MUST happen before importing any modules that use logging
# Otherwise, loggers are cached as unconfigured and won't route properly

import sys
import logging
from pathlib import Path

# Force UTF-8 for stdout/stderr (before any logging)
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Get log directory (inline to avoid importing platform module yet)
import os
if os.name == 'nt':  # Windows
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    log_dir = Path(base) / "hakodesk" / "logs"
else:  # Linux/Mac (dev)
    log_dir = Path.home() / ".hakodesk" / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / "debug.log"

# Configure PyHako's unified logging system
from pyhako.logging import configure_logging
configure_logging(
    log_file=log_file,
    log_level=logging.DEBUG,
    console_level=logging.INFO,
    file_level=logging.DEBUG,
)

# === NOW SAFE TO IMPORT OTHER MODULES ===
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
# ... rest of imports
```

### Step 3: Update PyHako logging.py Implementation

**Full implementation for PyHako/src/pyhako/logging.py**:

```python
import logging
import os
import sys
from pathlib import Path
from typing import Any

import structlog


def configure_logging(
    log_file: str | Path | None = None,
    log_level: int = logging.INFO,
    console_level: int = logging.INFO,
    file_level: int = logging.DEBUG,
) -> None:
    """
    Configure structured logging for PyHako.

    Args:
        log_file: Optional path to log file. If provided, adds FileHandler.
        log_level: Root logger level (default: INFO)
        console_level: Console handler level (default: INFO)
        file_level: File handler level (default: DEBUG)

    Respects HAKO_ENV environment variable:
    - 'development' (default): Colored, human-readable console output.
    - 'production': JSON output for machine parsing.
    """
    env = os.getenv("HAKO_ENV", "development").lower()

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        _redact_secrets,
    ]

    # Structlog processors
    processors = shared_processors + [
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ]

    structlog.configure(
        processors=processors,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Determine renderer based on environment
    if env == "production":
        console_renderer = structlog.processors.JSONRenderer()
        file_renderer = structlog.processors.JSONRenderer()
    else:
        console_renderer = structlog.dev.ConsoleRenderer()
        # File gets plain text for readability in log files
        file_renderer = structlog.dev.ConsoleRenderer(colors=False)

    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove existing handlers to avoid duplicates
    for h in root_logger.handlers[:]:
        root_logger.removeHandler(h)

    # Console Handler (stdout)
    console_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            console_renderer,
        ],
    )
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(console_formatter)
    console_handler.setLevel(console_level)
    root_logger.addHandler(console_handler)

    # File Handler (optional)
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        file_formatter = structlog.stdlib.ProcessorFormatter(
            foreign_pre_chain=shared_processors,
            processors=[
                structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                file_renderer,
            ],
        )
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
        file_handler.setFormatter(file_formatter)
        file_handler.setLevel(file_level)
        root_logger.addHandler(file_handler)

    # Silence noisy libraries - these are very verbose at DEBUG level
    noisy_loggers = [
        "parso", "asyncio", "httpcore", "httpx",
        "aiohttp", "urllib3", "charset_normalizer",
        "chardet", "PIL", "aiohttp.access",
    ]
    for lib in noisy_loggers:
        logging.getLogger(lib).setLevel(logging.WARNING)


def _redact_secrets(
    logger: logging.Logger,
    method_name: str,
    event_dict: dict[str, Any]
) -> dict[str, Any]:
    """
    Processor to redact sensitive keys from log output.
    """
    sensitive_keys = {
        "access_token", "refresh_token", "token", "password", "secret", "cookie", "cookies", "authorization"
    }

    # Redact top-level keys
    for key in event_dict.copy():
        if key.lower() in sensitive_keys:
            event_dict[key] = "***REDACTED***"

    # Shallow redaction for dictionary values (handling headers/cookies dicts)
    for key, value in event_dict.items():
        if isinstance(value, dict):
            for sub_key in value:
                if sub_key.lower() in sensitive_keys:
                    value[sub_key] = "***REDACTED***"

    return event_dict
```

### Step 4: Simplified HakoDesk main.py

**Full implementation for HakoDesk/backend/main.py**:

```python
# === LOGGING CONFIGURATION MUST BE FIRST ===
# This MUST happen before importing any modules that use logging
# Otherwise, loggers are cached as unconfigured and won't route properly

import sys
import logging
from pathlib import Path
import os

# Force UTF-8 for stdout/stderr (before any logging)
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Determine log directory (inline to avoid importing platform module yet)
if os.name == 'nt':  # Windows
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    log_dir = Path(base) / "hakodesk" / "logs"
else:  # Linux/Mac (dev)
    log_dir = Path.home() / ".hakodesk" / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
log_file = log_dir / "debug.log"

# Configure PyHako's unified logging system
from pyhako.logging import configure_logging
configure_logging(
    log_file=log_file,
    log_level=logging.DEBUG,
    console_level=logging.INFO,
    file_level=logging.DEBUG,
)

# === NOW SAFE TO IMPORT OTHER MODULES ===
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.api import auth, content, sync, settings, diagnostics, profile, report, version, notifications, favorites, chat_features
from backend.services.platform import get_logs_dir

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
    logging.warning("Frontend build not found. Run 'npm run build' in frontend directory.")
```

## Migration Checklist

- [ ] **Step 1**: Update `PyHako/src/pyhako/logging.py` with new `configure_logging()` signature
- [ ] **Step 2**: Update `HakoDesk/backend/main.py` to call `configure_logging()` FIRST
- [ ] **Step 3**: Remove duplicate logging setup from `main.py`
- [ ] **Step 4**: Test that PyHako logs appear in `debug.log`
- [ ] **Step 5**: Test that HakoDesk logs appear in `debug.log`
- [ ] **Step 6**: Verify secret redaction works for both
- [ ] **Step 7**: Verify console output shows colored logs in dev mode
- [ ] **Step 8**: Test production mode (HAKO_ENV=production) outputs JSON

## Benefits

1. **Single Source of Truth**: All logging configuration in PyHako
2. **Unified Output**: Both PyHako and HakoDesk logs in same file
3. **Secret Redaction**: Automatic for all logs
4. **Environment Awareness**: Dev=colored, Prod=JSON
5. **Reduced Duplication**: No more duplicate noisy logger suppression
6. **Proper Bridging**: structlog → stdlib → handlers

## Rollback Plan

If issues arise, revert to the current dual-system approach by:
1. Restoring the original `main.py` logging setup
2. Keeping PyHako's logging as-is (console only)

The systems are independent enough that this is safe.
