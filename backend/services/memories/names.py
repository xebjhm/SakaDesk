"""Member-name normalisation shared by Memories (matching across sources)."""

import re
import unicodedata

_SUFFIX = re.compile(r"[（(][^）)]*[）)]$")


def normalize_member_name(name: str) -> str:
    """NFKC, no whitespace, no trailing "(group)" suffix."""
    n = unicodedata.normalize("NFKC", name or "").strip()
    n = _SUFFIX.sub("", n)
    return re.sub(r"\s+", "", n)
