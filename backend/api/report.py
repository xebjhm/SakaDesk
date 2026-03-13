"""
Bug Report API for HakoDesk.
Collects diagnostics with smart log filtering and redaction.
"""
import json
import os
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, cast
from urllib.parse import urlencode, quote

from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.platform import get_logs_dir, get_settings_path
from pyhako.credentials import get_token_manager
from pyhako import Group, get_jwt_remaining_seconds

router = APIRouter(prefix="/api/report", tags=["report"])

# App version
APP_VERSION = "0.1.0"

# Try to get PyHako version
try:
    import pyhako
    PYHAKO_VERSION = getattr(pyhako, "__version__", "unknown")
except Exception:
    PYHAKO_VERSION = "unknown"


class ReportContext(BaseModel):
    """Context passed from frontend about current view."""
    category: str  # sync_data, playback, login, other
    member_path: Optional[str] = None
    message_id: Optional[int] = None
    current_screen: Optional[str] = None
    error_message: Optional[str] = None  # For crash reports


class ReportResponse(BaseModel):
    """Response with diagnostics and GitHub URL."""
    diagnostics: dict
    github_url: str


def _get_username() -> str:
    """Get current system username for redaction."""
    try:
        return os.getlogin()
    except Exception:
        try:
            return os.environ.get("USER", os.environ.get("USERNAME", ""))
        except Exception:
            return ""


def _redact_path(text: str, username: str) -> str:
    """Redact username from file paths."""
    if not username:
        return text
    # Handle both forward and back slashes
    patterns = [
        rf"/home/{re.escape(username)}",
        rf"/Users/{re.escape(username)}",
        rf"C:\\Users\\{re.escape(username)}",
        rf"C:/Users/{re.escape(username)}",
    ]
    result = text
    for pattern in patterns:
        result = re.sub(pattern, "/[REDACTED]", result, flags=re.IGNORECASE)
    return result


def _redact_nickname(text: str, nickname: Optional[str]) -> str:
    """Redact user nickname from text."""
    if not nickname:
        return text
    return text.replace(nickname, "[REDACTED]")


def _get_smart_logs(log_path: Path, username: str, nickname: Optional[str]) -> dict:
    """
    Smart log filtering:
    1. All ERROR and WARNING lines
    2. Last 30 lines of any level
    3. Deduplicated, capped at 150 lines
    """
    errors = []
    recent = []

    if not log_path.exists():
        return {"errors": [], "recent": ["No log file found"]}

    try:
        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()

        # Get all errors/warnings
        for line in all_lines:
            if " - ERROR - " in line or " - WARNING - " in line:
                redacted = _redact_path(_redact_nickname(line.strip(), nickname), username)
                errors.append(redacted)

        # Get last 30 lines
        for line in all_lines[-30:]:
            redacted = _redact_path(_redact_nickname(line.strip(), nickname), username)
            recent.append(redacted)

        # Deduplicate (errors that appear in recent don't need to be in both)
        recent_set = set(recent)
        errors = [e for e in errors if e not in recent_set]

        # Cap total at 150
        if len(errors) + len(recent) > 150:
            errors = errors[-(150 - len(recent)):]

    except Exception as e:
        return {"errors": [], "recent": [f"Error reading logs: {e}"]}

    return {"errors": errors, "recent": recent}


def _get_token_expiry() -> dict:
    """Get token expiry info without exposing the token. Uses shared pyhako utility."""
    try:
        tm = get_token_manager()

        for group in Group:
            session_data = tm.load_session(group.value)
            if session_data and session_data.get("access_token"):
                token = session_data["access_token"]
                remaining = get_jwt_remaining_seconds(token)

                if remaining is not None:
                    if remaining < 0:
                        return {"has_token": True, "token_expires_in": "expired", "groups_configured": [group.value]}
                    hours = remaining // 3600
                    mins = (remaining % 3600) // 60
                    return {
                        "has_token": True,
                        "token_expires_in": f"{hours}h {mins}m",
                        "groups_configured": [group.value]
                    }

        return {"has_token": False, "token_expires_in": None, "groups_configured": []}
    except Exception:
        return {"has_token": False, "token_expires_in": None, "groups_configured": []}


def _get_sync_state() -> dict:
    """Get current sync state from per-service metadata files."""
    try:
        settings_path = get_settings_path()
        if settings_path.exists():
            with open(settings_path, "r", encoding="utf-8") as f:
                settings = json.load(f)
                output_dir = settings.get("output_dir")
                if output_dir:
                    # Check per-service metadata files
                    latest_sync = None
                    last_error = None
                    output_path = Path(output_dir)

                    for service_dir in output_path.iterdir():
                        if not service_dir.is_dir():
                            continue
                        metadata_path = service_dir / "sync_metadata.json"
                        if metadata_path.exists():
                            try:
                                with open(metadata_path, "r", encoding="utf-8") as mf:
                                    metadata = json.load(mf)
                                    utc_sync = metadata.get("last_sync")
                                    if utc_sync:
                                        if latest_sync is None or utc_sync > latest_sync:
                                            latest_sync = utc_sync
                                    if metadata.get("last_error"):
                                        last_error = metadata.get("last_error")
                            except Exception:
                                pass

                    return {
                        "last_sync": latest_sync,
                        "last_error": last_error,
                    }
    except Exception:
        pass
    return {"last_sync": None, "last_error": None}


def _get_nickname() -> Optional[str]:
    """Get cached user nickname for redaction."""
    try:
        settings_path = get_settings_path()
        if settings_path.exists():
            with open(settings_path, "r", encoding="utf-8") as f:
                return cast(Optional[str], json.load(f).get("user_nickname"))
    except Exception:
        pass
    return None


def _build_github_url(
    category: str,
    what_doing: str,
    what_wrong: str,
    diagnostics: dict
) -> str:
    """Build GitHub issue URL with pre-filled content.

    Only includes compact system info in the URL to avoid GitHub's URL length limit.
    Logs are excluded — they're too large for URL encoding.
    """
    category_labels = {
        "sync_data": "Sync / Data",
        "playback": "Playback",
        "login": "Login",
        "other": "Other"
    }

    title = f"[Bug] {category_labels.get(category, 'Other')}: {what_wrong[:50]}"

    # Compact diagnostics — exclude logs to keep URL short
    compact_diag = {k: v for k, v in diagnostics.items() if k != "logs"}
    diag_json = json.dumps(compact_diag, indent=2)

    body = f"""## Bug Report

**Category:** {category_labels.get(category, 'Other')}
**What I was doing:** {what_doing}
**What went wrong:** {what_wrong}

---

<details>
<summary>System Info (click to expand)</summary>

```json
{diag_json}
```

</details>

<details>
<summary>Full Diagnostics (paste from clipboard)</summary>

> Full diagnostics (including logs) were copied to your clipboard.
> **Paste here** with Ctrl+V / Cmd+V, replacing this text.

```json
PASTE_HERE
```

</details>
"""

    params = urlencode({"title": title, "body": body}, quote_via=quote)
    return f"https://github.com/xtorker/HakoDesk/issues/new?{params}"


@router.post("", response_model=ReportResponse)
async def generate_report(context: ReportContext, what_doing: str = "", what_wrong: str = ""):
    """Generate bug report diagnostics and GitHub URL."""

    username = _get_username()
    nickname = _get_nickname()

    # Base diagnostics
    diagnostics = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "category": context.category,
        "system": {
            "os": platform.system(),
            "os_release": platform.release(),
            "python_version": sys.version.split()[0],
            "app_version": APP_VERSION,
            "pyhako_version": PYHAKO_VERSION,
        },
        "auth": _get_token_expiry(),
    }

    # Category-specific context
    if context.category == "sync_data":
        diagnostics["context"] = {
            "member_path": context.member_path,
            "sync_state": _get_sync_state(),
        }
    elif context.category == "playback":
        diagnostics["context"] = {
            "member_path": context.member_path,
            "message_id": context.message_id,
        }
    elif context.category == "login":
        # Auth info already in base
        pass
    else:  # other
        diagnostics["context"] = {
            "current_screen": context.current_screen,
            "error_message": context.error_message,
        }

    # Smart logs
    log_path = get_logs_dir() / "debug.log"
    diagnostics["logs"] = _get_smart_logs(log_path, username, nickname)

    # Build GitHub URL
    github_url = _build_github_url(context.category, what_doing, what_wrong, diagnostics)

    return ReportResponse(diagnostics=diagnostics, github_url=github_url)


@router.get("/diagnostics")
async def get_diagnostics_only():
    """Get diagnostics without creating GitHub URL (for preview)."""
    username = _get_username()
    nickname = _get_nickname()

    diagnostics = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "system": {
            "os": platform.system(),
            "os_release": platform.release(),
            "python_version": sys.version.split()[0],
            "app_version": APP_VERSION,
            "pyhako_version": PYHAKO_VERSION,
        },
        "auth": _get_token_expiry(),
        "sync_state": _get_sync_state(),
    }

    log_path = get_logs_dir() / "debug.log"
    diagnostics["logs"] = _get_smart_logs(log_path, username, nickname)

    return diagnostics
