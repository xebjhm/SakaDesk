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
- **Use common-sense kanji.** Prefer everyday words over obscure homophone kanji:
  後半戦 (not 孤帆線), 本番 (not 本盤), 前半 (not 全般 unless contextually correct),
  楽屋 (not 額谷), 衣装 (not 異相), 収録 (not 就六), リハーサル, 打ち合わせ, etc.
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


class GeminiTranscriptionProvider:
    """Gemini-based transcription with timestamps via multimodal audio input.

    Returns timestamped segments directly — no Whisper alignment needed.
    """

    def __init__(self, api_key: str, model: str = "gemini-3.1-flash-lite-preview"):
        self._api_key = api_key
        self._model = model

    # Inline data limit: use File API if audio + prompt exceeds ~15MB
    # (total request limit is 20MB, leaving headroom for prompt/schema)
    _INLINE_SIZE_LIMIT = 15 * 1024 * 1024  # 15MB

    async def _upload_file(
        self, audio_bytes: bytes, mime_type: str, client: httpx.AsyncClient
    ) -> str:
        """Upload audio via Gemini Files API. Returns the file URI."""
        # Step 1: Initiate resumable upload
        metadata = {"file": {"display_name": "transcription_audio"}}
        init_resp = await client.post(
            "https://generativelanguage.googleapis.com/upload/v1beta/files",
            headers={
                "x-goog-api-key": self._api_key,
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(len(audio_bytes)),
                "X-Goog-Upload-Header-Content-Type": mime_type,
                "Content-Type": "application/json",
            },
            json=metadata,
        )
        init_resp.raise_for_status()
        upload_url = init_resp.headers["X-Goog-Upload-URL"]

        # Step 2: Upload bytes
        upload_resp = await client.post(
            upload_url,
            headers={
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
                "Content-Type": mime_type,
            },
            content=audio_bytes,
        )
        upload_resp.raise_for_status()
        file_info = upload_resp.json()
        file_uri = file_info["file"]["uri"]
        logger.info("Audio uploaded via Files API", uri=file_uri, size=len(audio_bytes))
        return file_uri

    async def transcribe(
        self,
        audio_path: Path,
        member_name: Optional[str] = None,
        group_name: Optional[str] = None,
    ) -> tuple[str, list[TranscriptionSegment]]:
        """Send audio to Gemini and return (full_text, segments) with timestamps."""
        import base64

        audio_bytes = audio_path.read_bytes()

        suffix = audio_path.suffix.lower()
        mime_types = {
            ".m4a": "audio/aac",
            ".mp4": "audio/aac",
            ".mp3": "audio/mp3",
            ".wav": "audio/wav",
            ".ogg": "audio/ogg",
            ".flac": "audio/flac",
            ".aac": "audio/aac",
        }
        mime_type = mime_types.get(suffix, "audio/aac")

        system_instruction = _build_transcription_system_instruction(
            member_name=member_name, group_name=group_name
        )

        user_prompt = (
            "Transcribe this audio with fine-grained timestamps.\n\n"
            "IMPORTANT segmentation rules:\n"
            "- Each segment should be 1-2 sentences MAX (roughly 5-15 seconds of speech).\n"
            "- If a speaker talks for 20+ seconds, split into multiple segments.\n"
            "- Cut at natural pauses, sentence boundaries, or clause breaks (て/けど/から/し).\n"
            "- Prefer too many segments over too few. Short segments are better for subtitles.\n"
            "- start_seconds is the time in seconds when the segment begins."
        )

        # Structured output schema — Gemini returns validated JSON directly
        response_schema = {
            "type": "object",
            "properties": {
                "segments": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "start_seconds": {
                                "type": "number",
                                "description": "Start time in seconds",
                            },
                            "text": {
                                "type": "string",
                                "description": "Transcribed text for this segment",
                            },
                        },
                        "required": ["start_seconds", "text"],
                    },
                },
            },
            "required": ["segments"],
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"

        async with httpx.AsyncClient(timeout=180.0) as client:
            # Choose inline_data or File API based on audio size
            if len(audio_bytes) <= self._INLINE_SIZE_LIMIT:
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
                audio_part = {
                    "inline_data": {"mime_type": mime_type, "data": audio_b64}
                }
            else:
                file_uri = await self._upload_file(audio_bytes, mime_type, client)
                audio_part = {
                    "file_data": {"mime_type": mime_type, "file_uri": file_uri}
                }

            payload = {
                "system_instruction": {"parts": [{"text": system_instruction}]},
                "contents": [
                    {
                        "role": "user",
                        "parts": [audio_part, {"text": user_prompt}],
                    }
                ],
                "generationConfig": {
                    "temperature": 1.0,
                    "responseMimeType": "application/json",
                    "responseJsonSchema": response_schema,
                },
            }

            resp = await client.post(
                url,
                headers={"x-goog-api-key": self._api_key},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

        # Check for safety filter blocks
        candidates = data.get("candidates", [])
        if not candidates:
            raise RuntimeError("Gemini returned no candidates")

        candidate = candidates[0]
        finish_reason = candidate.get("finishReason", "")
        if finish_reason == "SAFETY":
            safety_ratings = candidate.get("safetyRatings", [])
            blocked_cats = [r["category"] for r in safety_ratings if r.get("blocked")]
            raise RuntimeError(
                f"Content blocked by safety filter: {', '.join(blocked_cats) or 'unknown'}"
            )
        if "content" not in candidate or not candidate["content"].get("parts"):
            raise RuntimeError(
                f"Gemini returned no content (finishReason: {finish_reason})"
            )

        raw_text = candidate["content"]["parts"][0]["text"]

        # Parse structured JSON response
        import json as _json

        parsed = _json.loads(raw_text)
        raw_segments = parsed.get("segments", [])

        segments: list[TranscriptionSegment] = []
        full_text_parts: list[str] = []

        for seg in raw_segments:
            text = seg.get("text", "").strip()
            if not text:
                continue

            # Clean tokenized spaces between CJK characters
            text = _clean_cjk_spaces(text)

            start_time = float(seg.get("start_seconds", 0))
            full_text_parts.append(text)
            segments.append(
                TranscriptionSegment(
                    start=start_time,
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
