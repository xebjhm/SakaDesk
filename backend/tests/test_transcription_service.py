import json
from pathlib import Path

import httpx
import pytest
import respx

from backend.services.transcription_service import (
    TranscriptionStorage,
    TranscriptionResult,
    TranscriptionSegment,
    GeminiTranscriptionProvider,
    _build_transcription_system_instruction,
    _clean_cjk_spaces,
)

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent"
)


def _empty_segments_response() -> httpx.Response:
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"parts": [{"text": '{"segments": []}'}]}}]},
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

    def test_wrong_shape_json_self_heals(self, tmp_path: Path):
        """SD-BE-API-16: valid JSON that isn't the expected shape (e.g. `{}` after
        a partial write) must not KeyError forever — load returns None and a
        subsequent save recovers instead of 500ing."""
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()
        # Well-formed JSON, wrong shape (no "transcriptions" list).
        (member_dir / TranscriptionStorage.FILENAME).write_text(
            "{}", encoding="utf-8"
        )

        # load() does not raise; treats it as empty.
        assert storage.load(member_dir, 1) is None

        # save() recovers by starting fresh rather than KeyError-ing.
        storage.save(
            member_dir,
            TranscriptionResult(
                message_id=1,
                media_type="voice",
                language="ja",
                model="m",
                duration_seconds=1.0,
                full_text="hi",
                segments=[],
            ),
        )
        assert storage.load(member_dir, 1) is not None

    def test_save_and_load_preserves_no_speech(self, tmp_path: Path):
        """An audio-less message is stored as an empty no_speech transcript."""
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        result = TranscriptionResult(
            message_id=7,
            media_type="video",
            language="ja",
            model="gemini-3.1-flash-lite",
            duration_seconds=2.4,
            full_text="",
            segments=[],
            no_speech=True,
        )
        storage.save(member_dir, result)

        loaded = storage.load(member_dir, 7)
        assert loaded is not None
        assert loaded.no_speech is True
        assert loaded.segments == []
        assert loaded.full_text == ""

    def test_load_defaults_no_speech_false_for_legacy_entries(self, tmp_path: Path):
        """Transcripts written before the no_speech field load as no_speech=False."""
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()
        (member_dir / TranscriptionStorage.FILENAME).write_text(
            json.dumps(
                {
                    "version": 1,
                    "transcriptions": [
                        {
                            "message_id": 9,
                            "media_type": "voice",
                            "language": "ja",
                            "model": "m",
                            "duration_seconds": 1.0,
                            "full_text": "やあ",
                            "segments": [],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        loaded = storage.load(member_dir, 9)
        assert loaded is not None
        assert loaded.no_speech is False

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

    def test_concurrent_saves_do_not_drop_entries(self, tmp_path: Path):
        """SD-BE-API-07: two transcriptions for different messages in the same
        member dir may save concurrently (each save runs in a worker thread).
        The per-dir lock must serialize the read-modify-write so neither entry is
        lost to a last-writer-wins race on the shared base file."""
        import threading

        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        def _make(mid: int) -> TranscriptionResult:
            return TranscriptionResult(
                message_id=mid,
                media_type="voice",
                language="ja",
                model="m",
                duration_seconds=1.0,
                full_text=f"text-{mid}",
                segments=[],
            )

        # Many interleaved concurrent saves of distinct message_ids.
        ids = list(range(50))
        start = threading.Barrier(len(ids))

        def _worker(mid: int) -> None:
            start.wait()  # maximize overlap of the load→mutate→write window
            storage.save(member_dir, _make(mid))

        threads = [threading.Thread(target=_worker, args=(mid,)) for mid in ids]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Every entry must survive — no silent drops.
        for mid in ids:
            loaded = storage.load(member_dir, mid)
            assert loaded is not None, f"message {mid} was dropped by a save race"

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


class TestGeminiTranscriptionProvider:
    """Verify GeminiTranscriptionProvider construction."""

    def test_instantiates_with_api_key(self):
        provider = GeminiTranscriptionProvider(api_key="test-key")
        assert provider._api_key == "test-key"
        assert provider._model == "gemini-3.1-flash-lite"

    def test_custom_model(self):
        provider = GeminiTranscriptionProvider(
            api_key="test-key", model="gemini-3-flash-preview"
        )
        assert provider._model == "gemini-3-flash-preview"


class TestGeminiPayloadHardening:
    """Guards against Gemini fabricating transcripts for silent/near-silent media."""

    @pytest.mark.asyncio
    async def test_transcribe_uses_deterministic_temperature(self, tmp_path):
        audio = tmp_path / "clip.mp4"
        audio.write_bytes(b"\x00\x00\x00\x08ftyp")
        provider = GeminiTranscriptionProvider(api_key="k", model="m")

        with respx.mock:
            route = respx.post(_GEMINI_URL).mock(
                return_value=_empty_segments_response()
            )
            await provider.transcribe(audio)

        payload = json.loads(route.calls.last.request.content)
        # temperature 1.0 makes transcription "creative" — a root cause of the
        # hallucinated transcript on silent audio.
        assert payload["generationConfig"]["temperature"] == 0

    @pytest.mark.asyncio
    async def test_mp4_sent_as_video_mime(self, tmp_path):
        audio = tmp_path / "clip.mp4"
        audio.write_bytes(b"\x00\x00\x00\x08ftyp")
        provider = GeminiTranscriptionProvider(api_key="k", model="m")

        with respx.mock:
            route = respx.post(_GEMINI_URL).mock(
                return_value=_empty_segments_response()
            )
            await provider.transcribe(audio)

        payload = json.loads(route.calls.last.request.content)
        part = payload["contents"][0]["parts"][0]
        assert part["inline_data"]["mime_type"] == "video/mp4"


class TestFilesApiCleanup:
    """SD-BE-API-17: large uploads to the Gemini Files API are deleted afterward."""

    @pytest.mark.asyncio
    async def test_large_upload_is_deleted(self, tmp_path, monkeypatch):
        provider = GeminiTranscriptionProvider(api_key="k", model="m")
        # Force the File API path without allocating a real 15MB+ file.
        monkeypatch.setattr(provider, "_INLINE_SIZE_LIMIT", 4)
        audio = tmp_path / "clip.mp4"
        audio.write_bytes(b"\x00\x00\x00\x18ftypmp42-bigger-than-limit")

        file_uri = "https://generativelanguage.googleapis.com/v1beta/files/abc-123"

        async def fake_upload(self, audio_bytes, mime_type, client):
            return file_uri

        monkeypatch.setattr(
            GeminiTranscriptionProvider, "_upload_file", fake_upload
        )

        with respx.mock:
            respx.post(_GEMINI_URL).mock(return_value=_empty_segments_response())
            delete_route = respx.delete(file_uri).mock(
                return_value=httpx.Response(200)
            )
            await provider.transcribe(audio)

        # The uploaded file must be cleaned up after generateContent.
        assert delete_route.called

    @pytest.mark.asyncio
    async def test_delete_failure_does_not_break_transcription(
        self, tmp_path, monkeypatch
    ):
        provider = GeminiTranscriptionProvider(api_key="k", model="m")
        monkeypatch.setattr(provider, "_INLINE_SIZE_LIMIT", 4)
        audio = tmp_path / "clip.mp4"
        audio.write_bytes(b"\x00\x00\x00\x18ftypmp42-bigger-than-limit")

        file_uri = "https://generativelanguage.googleapis.com/v1beta/files/xyz"

        async def fake_upload(self, audio_bytes, mime_type, client):
            return file_uri

        monkeypatch.setattr(
            GeminiTranscriptionProvider, "_upload_file", fake_upload
        )

        with respx.mock:
            respx.post(_GEMINI_URL).mock(return_value=_empty_segments_response())
            respx.delete(file_uri).mock(return_value=httpx.Response(500))
            # A failed cleanup must not raise — transcription still returns.
            full_text, segments = await provider.transcribe(audio)
        assert segments == []


class TestSystemInstruction:
    """The transcription prompt must not encourage guessing."""

    def test_instruction_forbids_inventing_words(self):
        instr = _build_transcription_system_instruction(
            member_name="高井俐香", group_name="日向坂46"
        )
        lowered = instr.lower()
        # The old prompt said "transcribe your best guess" — that invited
        # fabrication on silent audio.
        assert "best guess" not in lowered
        assert "never invent" in lowered


class TestCleanCjkSpaces:
    """Tests for CJK space cleanup."""

    def test_removes_spaces_between_cjk(self):
        assert _clean_cjk_spaces("皆 さん こんばんは") == "皆さんこんばんは"

    def test_keeps_spaces_between_cjk_and_ascii(self):
        assert _clean_cjk_spaces("日向坂 46") == "日向坂 46"

    def test_keeps_ascii_spaces(self):
        assert _clean_cjk_spaces("hello world") == "hello world"

    def test_mixed_content(self):
        result = _clean_cjk_spaces("日向坂 46 の メンバー です")
        assert "日向坂 46" in result
        assert "のメンバーです" in result
