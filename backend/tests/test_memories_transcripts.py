"""Transcript helpers for Memories (``backend/services/memories/transcripts.py``)."""

from __future__ import annotations

import json
import os
import re

import pytest
from structlog.testing import capture_logs

from backend.services.memories import transcripts as tr
from backend.services.memories.lexicon import GREETING_RES
from backend.services.transcription_service import TranscriptionStorage

ROOM = "messages/34 金村 美玖/58 金村 美玖"
OYASUMI = GREETING_RES["oyasumi"]


def entry(mid, segments, *, no_speech=False, media_type="voice"):
    return {
        "message_id": mid,
        "media_type": media_type,
        "language": "ja",
        "model": "m",
        "duration_seconds": 10.0,
        "full_text": "".join(s["text"] for s in segments),
        "segments": [{"confidence": 1.0, **s} for s in segments],
        "no_speech": no_speech,
        "created_at": "2026-11-01T00:00:00+00:00",
    }


def write_transcripts(sdir, room, entries):
    d = sdir / room
    d.mkdir(parents=True, exist_ok=True)
    path = d / TranscriptionStorage.FILENAME
    path.write_text(
        json.dumps({"version": 1, "transcriptions": entries}, ensure_ascii=False),
        encoding="utf-8",
    )
    return path


def seg(start, end, text):
    return {"start": start, "end": end, "text": text}


@pytest.fixture
def sdir(tmp_path):
    return tmp_path / "日向坂46"


def test_transcript_ids_skip_no_speech_and_empty(sdir):
    write_transcripts(
        sdir,
        ROOM,
        [
            entry(1, [seg(0, 2, "おやすみ")]),
            entry(2, []),
            entry(3, [seg(0, 1, "x")], no_speech=True),
            entry(4, [seg(0, 1, "ふふ")]),
        ],
    )
    assert tr.transcript_ids(sdir, ROOM) == frozenset({1, 4})


def test_transcript_ids_missing_file_is_empty(sdir):
    assert tr.transcript_ids(sdir, ROOM) == frozenset()


def test_corrupt_file_is_empty_and_logs_no_path(sdir):
    path = write_transcripts(sdir, ROOM, [])
    path.write_text("{broken", encoding="utf-8")
    with capture_logs() as logs:
        assert tr.transcript_ids(sdir, ROOM) == frozenset()
    assert {"event": "transcriptions_unreadable", "log_level": "warning"}.items() <= (
        logs[0].items()
    )
    assert "path" not in logs[0]
    assert str(sdir) not in repr(logs) and "金村" not in repr(logs)


@pytest.mark.parametrize(
    "raw",
    [
        b"\xff\xfe not utf-8",  # read_text raises past _load_raw
        json.dumps({"version": 1, "transcriptions": [{"message_id": 1}]}).encode(),
    ],
)
def test_unparseable_file_gives_empty_and_a_skip(sdir, raw):
    path = write_transcripts(sdir, ROOM, [])
    path.write_bytes(raw)
    with capture_logs() as logs:
        assert tr.transcript_ids(sdir, ROOM) == frozenset()
        assert tr.segments_for(sdir, ROOM, {1}) == {}
    skips = [e for e in logs if e["event"] == "memories_skip"]
    assert len(skips) == 2
    assert set(skips[0]) == {"event", "log_level", "view", "reason", "error_type"}
    assert skips[0]["view"] == "transcripts" and skips[0]["reason"] == "unreadable"
    assert str(sdir) not in repr(logs)


def test_segments_for_filters_ids_and_no_speech(sdir):
    write_transcripts(
        sdir,
        ROOM,
        [
            entry(1, [seg(0.0, 1.5, "ねえ"), seg(1.5, 3.0, "おやすみ🌙")]),
            entry(2, [seg(0, 1, "いらない")]),
            entry(3, [seg(0, 1, "x")], no_speech=True),
        ],
    )
    assert tr.segments_for(sdir, ROOM, {1, 3, 9}) == {
        1: [
            {"start": 0.0, "end": 1.5, "text": "ねえ"},
            {"start": 1.5, "end": 3.0, "text": "おやすみ🌙"},
        ]
    }


def test_keyword_clips_pad_clamp_and_match():
    segments = {
        5: [
            seg(0.1, 1.0, "おやすみ🌙"),
            seg(1.0, 2.0, "また明日"),
            seg(4.0, 6.0, "ｵﾔｽﾐ"),  # NFKC katakana: not the hiragana word
        ],
        7: [seg(10.0, 12.5, "じゃあ、おやすみなさい")],
        8: [seg(2.0, 3.0, "ＯＫ、おやすみ")],  # full-width context
    }
    clips = tr.keyword_clips(segments, OYASUMI)
    assert clips == [
        (5, 0.0, pytest.approx(1.3), "おやすみ🌙"),
        (7, pytest.approx(9.7), pytest.approx(12.8), "じゃあ、おやすみなさい"),
        (8, pytest.approx(1.7), pytest.approx(3.3), "ＯＫ、おやすみ"),
    ]
    assert tr.keyword_clips(segments, OYASUMI, pad_s=0)[0][1:3] == (0.1, 1.0)
    assert tr.keyword_clips({1: [seg(0, 1, "おはよう")]}, OYASUMI) == []


def test_keyword_clips_matches_nfkc_forms():
    # A full-width ASCII pattern matches after NFKC.
    assert tr.keyword_clips({1: [seg(0, 1, "ＡＢＣ")]}, re.compile("ABC"), pad_s=0) == [
        (1, 0, 1, "ＡＢＣ")
    ]


def test_transcripts_stat_changes_with_the_file(sdir):
    other = "messages/35 小坂 菜緒/60 小坂 菜緒"
    path = write_transcripts(sdir, ROOM, [entry(1, [seg(0, 1, "a")])])
    first = tr.transcripts_stat(sdir, [ROOM, other])
    assert first[1] is None
    assert first[0] == (path.stat().st_size, path.stat().st_mtime_ns)
    write_transcripts(sdir, ROOM, [entry(1, [seg(0, 1, "ab")])])
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
    assert tr.transcripts_stat(sdir, [ROOM, other]) != first
