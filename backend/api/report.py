"""
Bug Report API for SakaDesk.
Collects diagnostics with smart log filtering and redaction.
"""

import asyncio
import json
import os
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Sequence
from typing import Any, Optional, Union
from urllib.parse import urlencode, quote

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from backend.services.path_resolver import output_dir_value
from backend.services.platform import (
    get_default_output_dir,
    get_logs_dir,
    get_settings_path,
)
from backend.services.settings_store import read_settings_file
from pysaka.credentials import get_token_manager
from pysaka import Group, get_jwt_remaining_seconds

from backend.version import APP_VERSION

router = APIRouter(prefix="/api/report", tags=["report"])
logger = structlog.get_logger(__name__)

# Try to get pysaka version
try:
    import pysaka

    PYSAKA_VERSION = getattr(pysaka, "__version__", "unknown")
except Exception:
    PYSAKA_VERSION = "unknown"


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


Nicknames = Union[str, Sequence[str], None]
"""One nickname, several (one per service plus the legacy key), or none."""


def _nickname_list(nicknames: Nicknames) -> list[str]:
    """Non-empty distinct nicknames, longest first (a nickname that is a
    substring of another must not leave part of the longer one behind)."""
    items = [nicknames] if isinstance(nicknames, str) else list(nicknames or ())
    unique = {n for n in items if isinstance(n, str) and n}
    return sorted(unique, key=lambda n: (-len(n), n))


def _redact_nickname(text: str, nicknames: Nicknames) -> str:
    """Redact every user nickname from text, longest first, in one pass.

    One regex alternation, so a shorter nickname never matches inside a longer
    one already redacted, nor inside the ``[REDACTED]`` placeholder. Matched
    in any letter case (``Hina`` for ``hina``; no effect on CJK).
    """
    names = _nickname_list(nicknames)
    if not names:
        return text
    pattern = "|".join(re.escape(n) for n in names)
    return re.sub(pattern, "[REDACTED]", text, flags=re.IGNORECASE)


# Patterns for token-like / bearer / JWT / long secret strings. Ordered so the
# more specific patterns run first. Kept module-level so they compile once.
_SECRET_PATTERNS = [
    # JWT (header.payload.signature) — matches even when only base64url chars
    re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"),
    # Authorization: Bearer <token>
    re.compile(r"[Bb]earer\s+\S+"),
    # Long hex secrets (>= 32 hex chars, e.g. API keys / hashes)
    re.compile(r"\b[0-9a-fA-F]{32,}\b"),
    # Long base64/base64url secrets (>= 40 chars)
    re.compile(r"\b[A-Za-z0-9_/+-]{40,}={0,2}\b"),
]


def _scrub_secrets(text: str) -> str:
    """Scrub token-like / bearer / JWT / long secret strings from log text.

    Applied on top of path/nickname redaction so leaked credentials never reach
    the diagnostics or bug-report output. Preserves surrounding context.
    """
    result = text
    for pattern in _SECRET_PATTERNS:
        result = pattern.sub("[REDACTED_SECRET]", result)
    return result


def scrub_log_line(
    line: str, username: str, nickname: Nicknames, output_dir: Optional[str] = None
) -> str:
    """Full redaction for a single emitted log line, in a fixed order.

    1. the custom output dir (``[REDACTED_DIR]``), 2. the username in user
    profile paths (``/[REDACTED]``), 3. the nicknames, 4. secrets. Paths come
    first: a nickname that overlaps the username or a folder of the output dir
    (``hin`` / ``hina``) must not rewrite part of the path before the path
    patterns see it, which left ``C:\\Users\\[REDACTED]a`` or the whole
    custom dir behind. The output dir goes before the username, so a data dir
    under the user profile is replaced whole. Shared by the report and
    diagnostics endpoints (SEC-5).
    """
    text = _redact_output_dir(line, output_dir)
    text = _redact_path(text, username)
    text = _redact_nickname(text, nickname)
    return _scrub_secrets(text)


def _redact_output_dir(text: str, output_dir: Optional[str]) -> str:
    """Redact a user-chosen data/output directory from free text.

    The output dir can live outside C:\\Users (e.g. D:\\SakaData), so _redact_path
    won't catch it — but sync errors embed it. Redact all slash variants.
    """
    if not output_dir:
        return text
    variants = {
        output_dir,
        output_dir.replace("\\", "/"),
        output_dir.replace("/", "\\"),
    }
    names = sorted((v for v in variants if v), key=lambda v: (-len(v), v))
    pattern = "|".join(re.escape(v) for v in names)
    return re.sub(pattern, "[REDACTED_DIR]", text, flags=re.IGNORECASE)


def _redact_member_path(value: str) -> str:
    """Keep only the leading group/service segment of a member_path.

    `member_path` is e.g. "hinatazaka46/messages/34"; the member/message id is
    behavioral PII that must never reach a public GitHub issue. We keep the
    service segment (low sensitivity, high debug value) and drop the rest.
    """
    segments = [s for s in value.replace("\\", "/").split("/") if s]
    if not segments:
        return "[REDACTED]"
    if len(segments) == 1:
        return segments[0]
    return f"{segments[0]}/[REDACTED]"


def _redact_diagnostics(
    obj, username: str, nickname: Nicknames, output_dir: Optional[str] = None
):
    """Recursively scrub an entire diagnostics structure before it leaves the app.

    The diagnostics dict is embedded in the *public* GitHub-issue URL body and
    auto-copied to the clipboard; previously only `logs` were scrubbed, leaking
    `member_path`, `sync_state.last_error` paths, etc. (Theme J / SD-FE-GAP-A-01).
    Every string gets path + nickname + secret + output-dir scrubbing; the special
    `member_path` key is additionally reduced to its group/service segment.
    """
    if isinstance(obj, dict):
        return {
            k: _redact_member_path(v)
            if k == "member_path" and isinstance(v, str)
            else _redact_diagnostics(v, username, nickname, output_dir)
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_redact_diagnostics(v, username, nickname, output_dir) for v in obj]
    if isinstance(obj, str):
        return scrub_log_line(obj, username, nickname, output_dir)
    return obj


def _get_output_dir() -> Optional[str]:
    """Read the configured sync output dir (for redaction of custom data paths).

    The saved text as is. When the saved value is unset, empty, blank or not a
    string, sync uses the default folder, so that folder's path is returned:
    logs name it and must be redacted too. None when settings cannot be read.
    """
    try:
        data = read_settings_file(get_settings_path())
        if isinstance(data, dict):
            raw = data.get("output_dir")
            if isinstance(raw, str) and raw.strip():
                return raw
            return str(get_default_output_dir())
    except Exception as e:
        # Do NOT fail silently: if the output dir can't be read, custom-data-dir
        # redaction is skipped and a path outside C:\Users could reach the public
        # bug report. Log so the gap is visible (member-path reduction + username
        # scrub still run). (Review follow-up to WP-11.)
        # The error type only: the error text can carry the settings path.
        logger.warning(
            "report_output_dir_read_failed_redaction_partial",
            error_type=type(e).__name__,
        )
    return None


def _get_smart_logs(
    log_path: Path,
    username: str,
    nickname: Nicknames,
    output_dir: Optional[str] = None,
) -> dict:
    """
    Smart log filtering:
    1. Errors/warnings from dedicated error.log (or fall back to debug.log)
    2. Last 30 lines of debug.log for recent context
    3. Deduplicated, capped at 150 lines
    """
    errors = []
    recent = []

    if not log_path.exists():
        return {"errors": [], "recent": ["No log file found"]}

    try:
        # Recent context from debug.log
        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()

        for line in all_lines[-30:]:
            recent.append(scrub_log_line(line.strip(), username, nickname, output_dir))

        # Errors/warnings: prefer error.log (pre-filtered, smaller)
        error_log = log_path.parent / "error.log"
        error_lines = []
        if error_log.exists():
            with open(error_log, "r", encoding="utf-8", errors="ignore") as f:
                error_lines = f.readlines()
        else:
            error_lines = all_lines

        def _is_error_or_warning(line: str) -> bool:
            ll = line.lower()
            return "[error" in ll or "[warning" in ll

        for line in error_lines:
            if _is_error_or_warning(line):
                errors.append(
                    scrub_log_line(line.strip(), username, nickname, output_dir)
                )

        # Deduplicate (errors that appear in recent don't need to be in both)
        recent_set = set(recent)
        errors = [e for e in errors if e not in recent_set]

        # Cap total at 150
        if len(errors) + len(recent) > 150:
            errors = errors[-(150 - len(recent)) :]

    except Exception as e:
        return {"errors": [], "recent": [f"Error reading logs: {e}"]}

    return {"errors": errors, "recent": recent}


def _get_token_expiry() -> dict:
    """Get token expiry info without exposing the token. Uses shared pysaka utility."""
    try:
        tm = get_token_manager()

        for group in Group:
            session_data = tm.load_session(group.value)
            if session_data and session_data.get("access_token"):
                token = session_data["access_token"]
                remaining = get_jwt_remaining_seconds(token)

                if remaining is not None:
                    if remaining < 0:
                        return {
                            "has_token": True,
                            "token_expires_in": "expired",
                            "groups_configured": [group.value],
                        }
                    hours = remaining // 3600
                    mins = (remaining % 3600) // 60
                    return {
                        "has_token": True,
                        "token_expires_in": f"{hours}h {mins}m",
                        "groups_configured": [group.value],
                    }

        return {"has_token": False, "token_expires_in": None, "groups_configured": []}
    except Exception:
        return {"has_token": False, "token_expires_in": None, "groups_configured": []}


def _get_sync_state() -> dict:
    """Get current sync state from per-service metadata files."""
    try:
        settings = read_settings_file(get_settings_path())
        if isinstance(settings, dict):
            # The resolver sync uses: an empty saved value is the default folder
            output_dir = output_dir_value(
                settings.get("output_dir"), get_default_output_dir()
            )
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


def _get_nicknames() -> Optional[list[str]]:
    """Every cached user nickname to redact, longest first; ``None`` if unknown.

    ``api/profile.py`` caches one nickname per service under
    ``user_nicknames`` (a dict); an older build stored a single
    ``user_nickname`` string. Both are collected; empty and non-string values
    are skipped. Read with ``settings_store.read_settings_file`` (locked,
    retried, last good value on a transient failure). ``None`` means the
    settings could not be read and no last good value exists: the callers
    then fail closed (:func:`_withhold_free_text`), never send unredacted logs.
    """
    try:
        data = read_settings_file(get_settings_path())
    except Exception as e:
        logger.warning("report_nickname_read_failed", error_type=type(e).__name__)
        return None
    if not isinstance(data, dict):
        return []
    found: list[Any] = []
    per_service = data.get("user_nicknames")
    if isinstance(per_service, dict):
        found.extend(per_service.values())
    found.append(data.get("user_nickname"))
    names = _nickname_list(found)
    logger.debug("report_nicknames", count=len(names))
    return names


WITHHELD_LOGS = {"errors": [], "recent": [], "withheld": "nicknames_unavailable"}


def _withhold_free_text(diagnostics: dict) -> None:
    """Fail closed when the nicknames are unknown: drop the logs and free text.

    Log lines, the error message and the user's own report text are where a
    nickname would appear; with no nickname list they cannot be redacted, so
    they are not sent at all.
    """
    report_text = diagnostics.get("report_text")
    if isinstance(report_text, dict):
        for key in report_text:
            report_text[key] = None
    diagnostics["logs"] = dict(WITHHELD_LOGS)
    context = diagnostics.get("context")
    if isinstance(context, dict):
        for key in ("error_message", "current_screen"):
            if key in context:
                context[key] = None
    logger.warning("report_logs_withheld", reason="nicknames_unavailable")


MAX_GITHUB_URL_LENGTH = 8000
"""Longest ``github_url`` returned. The desktop shell refuses a URL over 8192
characters (``nav_guard.MAX_URL_LENGTH``), which would silently drop the report
page, so the percent-encoded URL is kept below that with some margin."""

_URL_EXCLUDED_KEYS = ("logs", "report_text")
"""Top-level diagnostics keys left out of the URL body: the logs and the
user's full text (the URL carries that text itself, possibly cut)."""

_TRUNCATION_MARK = "\u2026"
_URL_TEXT_KEYS = ("error_message", "current_screen")
"""Free-text keys of ``diagnostics["context"]`` that are also trimmed when the URL is too long."""


def _clip(text: Any, limit: int) -> Any:
    """``text`` cut to ``limit`` characters plus an ellipsis; other values and short text as is."""
    if isinstance(text, str) and len(text) > limit:
        return text[:limit] + _TRUNCATION_MARK
    return text


def _render_github_url(
    category: str, what_doing: str, what_wrong: str, diagnostics: dict
) -> str:
    """The untrimmed GitHub new-issue URL (see :func:`_build_github_url`)."""
    category_labels = {
        "sync_data": "Sync / Data",
        "playback": "Playback",
        "login": "Login",
        "other": "Other",
    }

    title = f"[Bug] {category_labels.get(category, 'Other')}: {what_wrong[:50]}"

    # Compact diagnostics — exclude logs to keep URL short
    compact_diag = {k: v for k, v in diagnostics.items() if k not in _URL_EXCLUDED_KEYS}
    diag_json = json.dumps(compact_diag, indent=2)

    body = f"""## Bug Report

**Category:** {category_labels.get(category, "Other")}
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
    return f"https://github.com/xebjhm/SakaDesk/issues/new?{params}"


def _build_github_url(
    category: str, what_doing: str, what_wrong: str, diagnostics: dict
) -> str:
    """Build GitHub issue URL with pre-filled content, at most
    ``MAX_GITHUB_URL_LENGTH`` characters.

    Only includes compact system info in the URL to avoid GitHub's URL length limit.
    The ``logs`` and ``report_text`` diagnostics are excluded — they're too large
    for URL encoding. When the percent-encoded
    URL is still too long (CJK text encodes to 9 characters per character), the
    user-written text is cut, all of it to the same length, found by bisection:
    ``what_doing``, ``what_wrong`` and the ``context`` fields ``error_message`` and
    ``current_screen``, each cut text ending in an ellipsis. The full text stays in
    the ``report_text`` diagnostics (clipboard copy, scrubbed like the rest of the
    diagnostics). A cut logs ``report_url_truncated`` with the URL length before
    and after and the characters kept per field, never the text.
    If the fixed part alone is over the limit, every cut text is reduced to the
    ellipsis alone (the URL is then returned over the limit) and the cut is
    logged as above with ``kept_chars`` 0.
    """
    url = _render_github_url(category, what_doing, what_wrong, diagnostics)
    if len(url) <= MAX_GITHUB_URL_LENGTH:
        return url

    def render(keep: int) -> str:
        context = diagnostics.get("context")
        trimmed = diagnostics
        if isinstance(context, dict):
            trimmed = {
                **diagnostics,
                "context": {
                    k: _clip(v, keep) if k in _URL_TEXT_KEYS else v
                    for k, v in context.items()
                },
            }
        return _render_github_url(
            category, _clip(what_doing, keep), _clip(what_wrong, keep), trimmed
        )

    context = diagnostics.get("context")
    context_lengths = [
        len(v)
        for k, v in (context.items() if isinstance(context, dict) else ())
        if k in _URL_TEXT_KEYS and isinstance(v, str)
    ]
    low, high = 0, max(len(what_doing), len(what_wrong), *context_lengths, 1)
    if len(render(0)) > MAX_GITHUB_URL_LENGTH:
        low = high = 0
    while low < high:
        mid = (low + high + 1) // 2
        if len(render(mid)) <= MAX_GITHUB_URL_LENGTH:
            low = mid
        else:
            high = mid - 1
    trimmed_url = render(low)
    logger.info(
        "report_url_truncated",
        length_before=len(url),
        length_after=len(trimmed_url),
        kept_chars=low,
    )
    return trimmed_url


@router.post("", response_model=ReportResponse)
async def generate_report(
    context: ReportContext, what_doing: str = "", what_wrong: str = ""
):
    """Generate bug report diagnostics and GitHub URL.

    The gathering reads settings (under the cross-thread settings lock), the
    token store and the logs, so it runs in a worker thread, off the loop.
    """
    return await asyncio.to_thread(_generate_report, context, what_doing, what_wrong)


def _generate_report(
    context: ReportContext, what_doing: str, what_wrong: str
) -> "ReportResponse":
    """Blocking body of :func:`generate_report`."""
    username = _get_username()
    nickname = _get_nicknames()

    # Base diagnostics
    diagnostics = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "category": context.category,
        "system": {
            "os": platform.system(),
            "os_release": platform.release(),
            "python_version": sys.version.split()[0],
            "app_version": APP_VERSION,
            "pysaka_version": PYSAKA_VERSION,
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

    # The user's full text, for the clipboard copy (the URL may cut it)
    diagnostics["report_text"] = {"what_doing": what_doing, "what_wrong": what_wrong}

    # Smart logs
    log_path = get_logs_dir() / "debug.log"
    output_dir = _get_output_dir()
    if nickname is None:  # settings unreadable: fail closed
        _withhold_free_text(diagnostics)
    else:
        diagnostics["logs"] = _get_smart_logs(log_path, username, nickname, output_dir)

    # Scrub the WHOLE payload (not just logs) before it becomes a public issue URL
    # body and a clipboard copy — member_path, sync errors, custom data paths.
    diagnostics = _redact_diagnostics(diagnostics, username, nickname or [], output_dir)

    # Build GitHub URL from the already-redacted diagnostics
    github_url = _build_github_url(
        context.category, what_doing, what_wrong, diagnostics
    )

    return ReportResponse(diagnostics=diagnostics, github_url=github_url)


@router.get("/diagnostics")
async def get_diagnostics_only():
    """Get diagnostics without creating GitHub URL (for preview), off the loop."""
    return await asyncio.to_thread(_diagnostics_only)


def _diagnostics_only() -> dict:
    """Blocking body of :func:`get_diagnostics_only`."""
    username = _get_username()
    nickname = _get_nicknames()

    diagnostics = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "system": {
            "os": platform.system(),
            "os_release": platform.release(),
            "python_version": sys.version.split()[0],
            "app_version": APP_VERSION,
            "pysaka_version": PYSAKA_VERSION,
        },
        "auth": _get_token_expiry(),
        "sync_state": _get_sync_state(),
    }

    log_path = get_logs_dir() / "debug.log"
    output_dir = _get_output_dir()
    if nickname is None:  # settings unreadable: fail closed
        _withhold_free_text(diagnostics)
    else:
        diagnostics["logs"] = _get_smart_logs(log_path, username, nickname, output_dir)

    # Scrub the whole payload — the diagnostics modal renders/copies these values.
    redacted: dict = _redact_diagnostics(
        diagnostics, username, nickname or [], output_dir
    )
    return redacted
