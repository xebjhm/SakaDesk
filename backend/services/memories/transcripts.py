"""Transcript helpers for Memories (the voice radio's lyrics and keyword clips).

The only way Memories reads a room's ``transcriptions.json``: every read goes
through ``TranscriptionStorage().load_all`` (the one parser). All functions
except :func:`keyword_clips` are blocking; call them via ``asyncio.to_thread``.

- ``transcript_ids(sdir, room)`` -- ids with at least one segment and
  ``no_speech`` false.
- ``segments_for(sdir, room, ids)`` -- ``{id: [{"start", "end", "text"}]}``
  for the wanted ids (``no_speech`` entries excluded).
- ``keyword_clips(segments, pattern, *, pad_s=0.3)`` -- pure: one clip per
  segment whose NFKC text matches ``pattern``.
- ``transcripts_stat(sdir, rooms)`` -- ``(size, mtime_ns)`` per room's file
  (``None`` when absent), for cache hashes.

An unparseable file gives an empty result plus ``memories_skip``
(``view=transcripts``, ``reason=unreadable``, ``error_type``). Logs never carry
transcript text, rooms or paths.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path

import structlog

from backend.services.memories.selection import normalize
from backend.services.transcription_service import (
    TranscriptionResult,
    TranscriptionStorage,
)

logger = structlog.get_logger(__name__)

Clip = tuple[int, float, float, str]


def _load(sdir: Path, room: str) -> list[TranscriptionResult]:
    """Every transcription of ``room``; ``[]`` (and a skip) when unparseable."""
    try:
        return TranscriptionStorage().load_all(sdir / room)
    except Exception as e:  # noqa: BLE001 - any bad sidecar must not break a view
        logger.warning(
            "memories_skip",
            view="transcripts",
            reason="unreadable",
            error_type=type(e).__name__,
        )
        return []


def transcript_ids(sdir: Path, room: str) -> frozenset[int]:
    """Message ids in ``room`` with at least one segment and speech. Blocking."""
    return frozenset(
        r.message_id for r in _load(sdir, room) if r.segments and not r.no_speech
    )


def segments_for(sdir: Path, room: str, ids: Iterable[int]) -> dict[int, list[dict]]:
    """``{id: [{"start", "end", "text"}]}`` for the wanted ids with speech. Blocking."""
    wanted = set(ids)
    return {
        r.message_id: [
            {"start": s.start, "end": s.end, "text": s.text} for s in r.segments
        ]
        for r in _load(sdir, room)
        if r.message_id in wanted and r.segments and not r.no_speech
    }


def keyword_clips(
    segments: Mapping[int, list[dict]], pattern: re.Pattern, *, pad_s: float = 0.3
) -> list[Clip]:
    """``(message_id, max(0, start - pad), end + pad, text)`` per matching segment.

    Matching runs on the NFKC-normalised text; the returned text is the
    segment's own. Order: ``segments`` order, then segment order.
    """
    out: list[Clip] = []
    for mid, segs in segments.items():
        for s in segs:
            if pattern.search(normalize(s["text"])):
                out.append(
                    (mid, max(0, s["start"] - pad_s), s["end"] + pad_s, s["text"])
                )
    return out


def transcripts_stat(
    sdir: Path, rooms: Sequence[str]
) -> tuple[tuple[int, int] | None, ...]:
    """``(size, mtime_ns)`` of each room's ``transcriptions.json`` (or ``None``)."""
    out: list[tuple[int, int] | None] = []
    for room in rooms:
        try:
            st = (sdir / room / TranscriptionStorage.FILENAME).stat()
        except OSError:
            out.append(None)
            continue
        out.append((st.st_size, st.st_mtime_ns))
    return tuple(out)


__all__ = ["keyword_clips", "segments_for", "transcript_ids", "transcripts_stat"]
