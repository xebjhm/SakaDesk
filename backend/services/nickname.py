"""The member-message nickname placeholder.

Members write ``%%%`` (ASCII) or ``％％％`` (fullwidth) where the official app
shows the reader's own nickname. This module replaces it in backend-rendered
text (currently the Windows toast previews) with the nickname cached per
service in settings (``user_nicknames``); the chat screen and search results
do the same in the frontend. Without a cached nickname the text is left
unchanged, as in the chat view.
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
