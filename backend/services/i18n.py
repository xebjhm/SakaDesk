"""Backend string catalog.

Strings live in ``backend/i18n/<locale>/<section>.json`` (UTF-8). Unknown or
missing languages fall back to English.
"""

import json
from functools import lru_cache
from pathlib import Path

import structlog

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
