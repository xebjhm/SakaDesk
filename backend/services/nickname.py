"""The member-message nickname placeholder.

Members write ``%%%`` (ASCII) or ``％％％`` (fullwidth) where the official app
shows the reader's own nickname. Every place that shows message text to the
user replaces it with the nickname cached per service in settings
(``user_nicknames``). Without a cached nickname the text is left unchanged,
the same as the chat view.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

PLACEHOLDER_RE = re.compile(r"%%%|％％％")


def apply_nickname(text: str, nickname: str | None) -> str:
    """Return ``text`` with every placeholder replaced by ``nickname``."""
    if not nickname or not text:
        return text
    return PLACEHOLDER_RE.sub(lambda _m: nickname, text)


def nickname_for(settings: Mapping[str, Any], service: str) -> str | None:
    """The cached nickname for ``service`` from app settings, or ``None``."""
    nicknames = settings.get("user_nicknames")
    if not isinstance(nicknames, Mapping):
        return None
    value = nicknames.get(service)
    return value if isinstance(value, str) and value else None
