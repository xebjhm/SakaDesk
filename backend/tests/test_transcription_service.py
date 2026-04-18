import json
from pathlib import Path

import pytest

from backend.services.transcription_service import (
    TranscriptionProvider,
    LocalWhisperProvider,
    TranscriptionStorage,
    TranscriptionResult,
    TranscriptionSegment,
)


class TestTranscriptionStorage:
    """Tests for JSON sidecar read/write."""

    def test_save_and_load_roundtrip(self, tmp_path: Path):
        storage = TranscriptionStorage()
        member_dir = tmp_path / "service" / "messages" / "1 Group" / "2 Member"
        member_dir.mkdir(parents=True)

        result = TranscriptionResult(
            message_id=123,
            media_type="voice",
            language="ja",
            model="faster-whisper-medium",
            duration_seconds=10.5,
            full_text="こんにちは",
            segments=[
                TranscriptionSegment(
                    start=0.0, end=2.0, text="こんにちは", confidence=0.95
                ),
            ],
        )

        storage.save(member_dir, result)

        loaded = storage.load(member_dir, 123)
        assert loaded is not None
        assert loaded.message_id == 123
        assert loaded.full_text == "こんにちは"
        assert loaded.segments[0].confidence == 0.95
        assert loaded.model == "faster-whisper-medium"

    def test_load_returns_none_when_missing(self, tmp_path: Path):
        storage = TranscriptionStorage()
        assert storage.load(tmp_path, 999) is None

    def test_save_appends_to_existing(self, tmp_path: Path):
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        r1 = TranscriptionResult(
            message_id=1,
            media_type="voice",
            language="ja",
            model="m",
            duration_seconds=5.0,
            full_text="first",
            segments=[
                TranscriptionSegment(start=0.0, end=1.0, text="first", confidence=0.9)
            ],
        )
        r2 = TranscriptionResult(
            message_id=2,
            media_type="video",
            language="ja",
            model="m",
            duration_seconds=3.0,
            full_text="second",
            segments=[
                TranscriptionSegment(start=0.0, end=1.0, text="second", confidence=0.8)
            ],
        )

        storage.save(member_dir, r1)
        storage.save(member_dir, r2)

        assert storage.load(member_dir, 1) is not None
        assert storage.load(member_dir, 2) is not None

    def test_save_overwrites_existing_message_id(self, tmp_path: Path):
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        r1 = TranscriptionResult(
            message_id=1,
            media_type="voice",
            language="ja",
            model="old",
            duration_seconds=5.0,
            full_text="old text",
            segments=[
                TranscriptionSegment(start=0.0, end=1.0, text="old", confidence=0.5)
            ],
        )
        r2 = TranscriptionResult(
            message_id=1,
            media_type="voice",
            language="ja",
            model="new",
            duration_seconds=5.0,
            full_text="new text",
            segments=[
                TranscriptionSegment(start=0.0, end=1.0, text="new", confidence=0.9)
            ],
        )

        storage.save(member_dir, r1)
        storage.save(member_dir, r2)

        loaded = storage.load(member_dir, 1)
        assert loaded is not None
        assert loaded.model == "new"
        assert loaded.full_text == "new text"

    def test_transcriptions_json_format(self, tmp_path: Path):
        """Verify the on-disk format matches the spec."""
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        result = TranscriptionResult(
            message_id=42,
            media_type="voice",
            language="ja",
            model="faster-whisper-medium",
            duration_seconds=10.0,
            full_text="test",
            segments=[
                TranscriptionSegment(start=0.0, end=1.0, text="test", confidence=0.9),
            ],
        )
        storage.save(member_dir, result)

        raw = json.loads(
            (member_dir / "transcriptions.json").read_text(encoding="utf-8")
        )
        assert raw["version"] == 1
        assert isinstance(raw["transcriptions"], list)
        assert raw["transcriptions"][0]["message_id"] == 42
        assert "created_at" in raw["transcriptions"][0]


class TestTranscriptionProviderInterface:
    """Verify the ABC contract."""

    def test_cannot_instantiate_abc(self):
        with pytest.raises(TypeError):
            TranscriptionProvider()  # type: ignore[abstract]

    def test_local_whisper_provider_is_subclass(self):
        assert issubclass(LocalWhisperProvider, TranscriptionProvider)
