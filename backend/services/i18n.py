"""Backend string catalog.

Strings live in ``backend/i18n/<locale>/<section>.json`` (UTF-8). Unknown or
missing languages fall back to English. :func:`resolve_ui_language` picks the
language the user chose in the app.
"""

import json
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

import structlog

from backend.services import app_state

logger = structlog.get_logger(__name__)

SUPPORTED = ("en", "ja", "zh-TW", "zh-CN", "yue")
_FALLBACK = "en"
_I18N_DIR = Path(__file__).resolve().parent.parent / "i18n"


@lru_cache(maxsize=None)
def _load(section: str, lang: str) -> tuple[tuple[str, str], ...]:
    path = _I18N_DIR / lang / f"{section}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        logger.warning(
            "i18n_load_failed",
            section=section,
            lang=lang,
            error_type=type(e).__name__,
        )
        return ()
    return tuple((str(k), str(v)) for k, v in data.items())


def get_strings(section: str, lang: str | None) -> dict[str, str]:
    """Return the strings for ``section`` in ``lang`` (fallback ``en``).

    The file read is cached; each call returns a fresh dict so callers may
    mutate the result safely.
    """
    resolved = lang if lang in SUPPORTED else _FALLBACK
    if resolved != lang:
        logger.debug("i18n_lang_fallback", section=section, fallback=resolved)
    return dict(_load(section, resolved))


def resolve_ui_language(config: Mapping[str, Any]) -> str | None:
    """The UI language to use for backend strings.

    Same order as the frontend: the app_state prefs ``language`` (the choice
    made in Settings), else ``config["language"]`` (settings.json, written by
    the installer), else ``None`` (``get_strings`` then uses ``en``). Prefs
    that cannot be read are logged (``ui_language_prefs_unreadable``,
    error type only) and skipped. Reads SQLite: call it off the event loop.
    """
    try:
        pref = app_state.get_prefs().get("language")
    except Exception as e:
        logger.warning("ui_language_prefs_unreadable", error_type=type(e).__name__)
        pref = None
    if isinstance(pref, str) and pref:
        logger.debug("ui_language_resolved", source="prefs", lang=pref)
        return pref
    lang = config.get("language")
    if isinstance(lang, str) and lang:
        logger.debug("ui_language_resolved", source="settings", lang=lang)
        return lang
    logger.debug("ui_language_resolved", source="none")
    return None
