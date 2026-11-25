"""Whether the tests run on CI (the ``CI`` environment variable)."""

import os

_FALSE_WORDS = frozenset({"0", "false", "no"})


def on_ci() -> bool:
    """True when ``CI`` is set to a value other than empty, ``0``, ``false`` or ``no``.

    The comparison ignores case and surrounding blanks, so ``CI=false`` and
    ``CI=0`` (how some shells switch it off) do not count as CI.
    """
    value = os.environ.get("CI", "").strip().lower()
    return bool(value) and value not in _FALSE_WORDS
