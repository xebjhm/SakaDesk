"""
Transcription service for SakaDesk.

Provides hybrid Japanese audio transcription:
- Gemini API for high-quality text (accurate Japanese)
- Local faster-whisper tiny (CPU-only) for segment timestamps
- Alignment function to combine both outputs

Storage: JSON sidecar files (transcriptions.json) alongside messages.json.
"""

import json
import structlog
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

logger = structlog.get_logger(__name__)

_TRANSCRIPTION_SYSTEM_INSTRUCTION = """You are transcribing audio from 坂道シリーズ (Sakamichi Series) idol group members — 日向坂46, 櫻坂46, 乃木坂46.

{context}

## Rules

- Transcribe spoken Japanese accurately, preserving the speaker's natural speech.
- **Use correct kanji for member names.** You know the 坂道シリーズ member roster —
  use the official kanji spellings (e.g., 片山紗希 not 片山咲, 石塚瑶季 not 石塚陽季).
- Keep all proper nouns accurate: member names, group names, song/single titles,
  concert names (ひな誕祭, W-KEYAKI FES.), show names (ひなあい, そこさく, 乃木坂工事中).
- Preserve casual speech exactly as spoken. Do NOT formalize.
- Keep filler words and interjections: えーと, あのー, うーん, ふふ, えへへ, etc.
- Keep industry terms in their standard form: 選抜, フォーメーション, センター,
  アンダー, ひらがな日向, セトリ, ミーグリ, 握手会, 歌割り, etc.
- If the speaker laughs, note with (笑). Ignore background music/effects.
- If audio is unclear, transcribe your best guess without noting uncertainty.

## Output

Output only the transcription text. No timestamps, no labels, no commentary."""


def _build_transcription_system_instruction(
    member_name: Optional[str] = None,
    group_name: Optional[str] = None,
) -> str:
    """Build transcription system instruction with speaker context."""
    if group_name and member_name:
        context = f"Speaker: {member_name} ({group_name})"
    elif member_name:
        context = f"Speaker: {member_name}"
    elif group_name:
        context = f"Group: {group_name}"
    else:
        context = ""

    return _TRANSCRIPTION_SYSTEM_INSTRUCTION.format(context=context)


@dataclass
class TranscriptionSegment:
    start: float
    end: float
    text: str
    confidence: float = 1.0


@dataclass
class TranscriptionResult:
    message_id: int
    media_type: str  # "voice" or "video"
    language: str
    model: str
    duration_seconds: float
    full_text: str
    segments: list[TranscriptionSegment]
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class TranscriptionProvider(ABC):
    """Abstract base for transcription engines."""

    @abstractmethod
    def transcribe(self, audio_path: Path, language: str = "ja") -> TranscriptionResult:
        """Transcribe an audio file and return timestamped segments."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is ready (model downloaded, API key set, etc.)."""
        ...


class LocalWhisperProvider(TranscriptionProvider):
    """Local timing provider using faster-whisper tiny (CPU-only).

    This provider is used exclusively for segment timestamps in the hybrid
    pipeline. Gemini provides the high-quality text; this provides the time
    boundaries to align against.
    """

    def __init__(
        self,
        model_size: str = "tiny",
        model_dir: Optional[Path] = None,
    ):
        self._model_size = model_size
        self._model_dir = model_dir
        # Always CPU — GPU support removed; this model is for timing only
        self._device = "cpu"
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        from faster_whisper import WhisperModel

        # CPU-only: use int8 compute type
        kwargs: dict = {"device": self._device, "compute_type": "int8"}
        if self._model_dir:
            kwargs["download_root"] = str(self._model_dir)

        logger.info(
            "Loading whisper model", model=self._model_size, device=self._device
        )
        self._model = WhisperModel(self._model_size, **kwargs)
        logger.info("Whisper model loaded", model=self._model_size, device=self._device)

    def is_available(self) -> bool:
        try:
            self._ensure_model()
            return True
        except Exception:
            return False

    def _run_transcribe(self, audio_path: Path, language: str):
        """Run the actual transcription. Returns (segments_iter, info)."""
        # vad_filter=False: Silero VAD requires an ONNX model file that
        # is not bundled with the PyInstaller package. Voice messages are
        # short enough that VAD filtering isn't necessary.
        return self._model.transcribe(
            str(audio_path),
            language=language,
            beam_size=5,
            vad_filter=False,
        )

    def transcribe(self, audio_path: Path, language: str = "ja") -> TranscriptionResult:
        """Transcribe audio for timing data. Text quality is secondary here."""
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        self._ensure_model()

        segments_iter, info = self._run_transcribe(audio_path, language)
        segments, full_text_parts = self._collect_segments(segments_iter)

        return TranscriptionResult(
            message_id=0,  # Caller sets this
            media_type="voice",  # Caller sets this
            language=info.language,
            model=f"faster-whisper-{self._model_size}",
            duration_seconds=round(info.duration, 2),
            full_text="".join(full_text_parts),
            segments=segments,
        )

    @staticmethod
    def _collect_segments(segments_iter):
        """Consume segment iterator and build segment list + full text."""
        import math

        segments = []
        full_text_parts = []
        for seg in segments_iter:
            # avg_logprob is a negative log probability (e.g., -0.3).
            # Convert to 0-1 scale: exp(-0.3) ≈ 0.74
            raw_log_prob = seg.avg_logprob if hasattr(seg, "avg_logprob") else -1.0
            confidence = round(math.exp(raw_log_prob), 3)

            segments.append(
                TranscriptionSegment(
                    start=round(seg.start, 2),
                    end=round(seg.end, 2),
                    text=seg.text.strip(),
                    confidence=confidence,
                )
            )
            full_text_parts.append(seg.text.strip())
        return segments, full_text_parts


class GeminiTranscriptionProvider:
    """Gemini-based transcription with timestamps via multimodal audio input.

    Returns timestamped segments directly — no Whisper alignment needed.
    Uses gemini-2.5-flash (stable, proven audio support).
    """

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        self._api_key = api_key
        self._model = model

    async def transcribe(
        self,
        audio_path: Path,
        member_name: Optional[str] = None,
        group_name: Optional[str] = None,
    ) -> tuple[str, list[TranscriptionSegment]]:
        """Send audio to Gemini and return (full_text, segments) with timestamps."""
        import base64
        import re

        audio_bytes = audio_path.read_bytes()
        audio_b64 = base64.b64encode(audio_bytes).decode("ascii")

        suffix = audio_path.suffix.lower()
        mime_types = {
            ".m4a": "audio/mp4",
            ".mp4": "audio/mp4",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
        }
        mime_type = mime_types.get(suffix, "audio/mp4")

        system_instruction = _build_transcription_system_instruction(
            member_name=member_name, group_name=group_name
        )

        user_prompt = (
            "Transcribe this audio with timestamps for each sentence or clause.\n\n"
            "Format each line as:\n"
            "[MM:SS] transcribed text\n\n"
            "One timestamp per natural sentence or clause break."
        )

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        payload = {
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "contents": [
                {
                    "parts": [
                        {"inlineData": {"mimeType": mime_type, "data": audio_b64}},
                        {"text": user_prompt},
                    ]
                }
            ],
            "generationConfig": {"temperature": 0.1},
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, params={"key": self._api_key}, json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw_text = data["candidates"][0]["content"]["parts"][0]["text"]

        # Parse [MM:SS] lines into segments
        segments: list[TranscriptionSegment] = []
        full_text_parts: list[str] = []

        for line in raw_text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue

            # Match [MM:SS] or [ MM:SS ] patterns
            m = re.match(r"\[?\s*(\d{1,2}):(\d{2})\s*\]?\s*(.*)", line)
            if not m:
                continue

            minutes = int(m.group(1))
            seconds = int(m.group(2))
            text = m.group(3).strip()

            if not text:
                continue

            # Clean tokenized spaces between CJK characters
            text = _clean_cjk_spaces(text)

            start_time = minutes * 60 + seconds
            full_text_parts.append(text)
            segments.append(
                TranscriptionSegment(
                    start=float(start_time),
                    end=0.0,  # filled below
                    text=text,
                    confidence=1.0,
                )
            )

        # Fill end times: each segment ends when the next one starts
        for i in range(len(segments) - 1):
            segments[i].end = segments[i + 1].start
        # Last segment: estimate end as start + average segment duration
        if segments:
            if len(segments) > 1:
                avg_dur = (segments[-1].start - segments[0].start) / (len(segments) - 1)
                segments[-1].end = segments[-1].start + avg_dur
            else:
                segments[-1].end = segments[-1].start + 10.0

        full_text = "".join(full_text_parts)
        return full_text, segments


def _clean_cjk_spaces(text: str) -> str:
    """Remove spaces between CJK characters inserted by Gemini's tokenizer.

    Keeps spaces between CJK and ASCII (e.g., "日向坂 46" stays),
    only removes spaces where both neighbors are CJK.
    """
    import re

    # Remove space between two CJK characters
    # CJK ranges: \u3000-\u9fff, \uf900-\ufaff, \ufe30-\ufe4f
    text = re.sub(
        r"([\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f])"
        r"\s+"
        r"([\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f])",
        r"\1\2",
        text,
    )
    # Run twice to catch overlapping matches (e.g., "あ い う" → "あい う" → "あいう")
    text = re.sub(
        r"([\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f])"
        r"\s+"
        r"([\u3000-\u9fff\uf900-\ufaff\ufe30-\ufe4f])",
        r"\1\2",
        text,
    )
    return text


class TranscriptionStorage:
    """Read/write transcriptions.json sidecar files."""

    FILENAME = "transcriptions.json"

    def save(self, member_dir: Path, result: TranscriptionResult) -> None:
        """Save a transcription result to the member's transcriptions.json."""
        file_path = member_dir / self.FILENAME

        # Load existing
        data = self._load_raw(file_path)

        # Remove existing entry for same message_id (re-transcription)
        data["transcriptions"] = [
            t for t in data["transcriptions"] if t["message_id"] != result.message_id
        ]

        # Append new
        entry = asdict(result)
        data["transcriptions"].append(entry)

        # Write atomically
        tmp_path = file_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(file_path)

    def load(self, member_dir: Path, message_id: int) -> Optional[TranscriptionResult]:
        """Load a specific transcription by message_id."""
        file_path = member_dir / self.FILENAME
        data = self._load_raw(file_path)

        for entry in data["transcriptions"]:
            if entry["message_id"] == message_id:
                return TranscriptionResult(
                    message_id=entry["message_id"],
                    media_type=entry["media_type"],
                    language=entry["language"],
                    model=entry["model"],
                    duration_seconds=entry["duration_seconds"],
                    full_text=entry["full_text"],
                    created_at=entry.get("created_at", ""),
                    segments=[
                        TranscriptionSegment(**s) for s in entry.get("segments", [])
                    ],
                )
        return None

    def load_all(self, member_dir: Path) -> list[TranscriptionResult]:
        """Load all transcriptions for a member."""
        file_path = member_dir / self.FILENAME
        data = self._load_raw(file_path)
        results = []
        for entry in data["transcriptions"]:
            results.append(
                TranscriptionResult(
                    message_id=entry["message_id"],
                    media_type=entry["media_type"],
                    language=entry["language"],
                    model=entry["model"],
                    duration_seconds=entry["duration_seconds"],
                    full_text=entry["full_text"],
                    created_at=entry.get("created_at", ""),
                    segments=[
                        TranscriptionSegment(**s) for s in entry.get("segments", [])
                    ],
                )
            )
        return results

    def _load_raw(self, file_path: Path) -> dict:
        if file_path.exists():
            try:
                return json.loads(file_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, KeyError):
                logger.warning(
                    "Corrupt transcriptions.json, starting fresh", path=str(file_path)
                )
        return {"version": 1, "transcriptions": []}
