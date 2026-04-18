"""
Transcription service for SakaDesk.

Provides local-first Japanese audio transcription using faster-whisper,
with a provider abstraction for future cloud API support.

Storage: JSON sidecar files (transcriptions.json) alongside messages.json.
"""

import json
import structlog
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = structlog.get_logger(__name__)


@dataclass
class TranscriptionSegment:
    start: float
    end: float
    text: str
    confidence: float


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
    """Local transcription using faster-whisper (CTranslate2)."""

    def __init__(
        self,
        model_size: str = "medium",
        model_dir: Optional[Path] = None,
        device: str = "cpu",
    ):
        self._model_size = model_size
        self._model_dir = model_dir
        self._device = device
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        from faster_whisper import WhisperModel

        compute_type = "float16" if self._device == "cuda" else "int8"
        kwargs: dict = {"device": self._device, "compute_type": compute_type}
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
