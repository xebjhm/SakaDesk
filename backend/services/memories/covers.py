"""Album cover overrides: the hook for 「設為這個月的封面」 (spec 8).

Wave 4 adds the right-click 「設為這個月的封面」 action and its storage; this
wave only defines the contract that :mod:`album` already consumes.

Contract of :func:`load_cover_overrides`:

- ``scope`` is ``people.person_key(summary)`` for one person, or ``"all"``
  for the 全員 album.
- The result maps a JST month (``YYYY-MM``) to ``(room, message_id)``, where
  ``room`` is the relative POSIX ``member_dir``.
- An override wins only while that message is still a picture / video of
  that month in the album's current filter; otherwise the normal cover rules
  decide (``album.choose_cover``). A stale override is never an error.

The overrides are part of the album's cache hash, so a change re-picks covers.
"""

from __future__ import annotations

from pathlib import Path


async def load_cover_overrides(sdir: Path, scope: str) -> dict[str, tuple[str, int]]:
    """``month -> (room, message_id)`` chosen by the fan. Always ``{}`` in this wave."""
    del sdir, scope  # wave 4 reads its storage with these
    return {}


__all__ = ["load_cover_overrides"]
