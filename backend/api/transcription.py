"""
Transcription API for SakaDesk.
Handles on-demand transcription requests and cached transcript retrieval.

Hybrid pipeline:
- Gemini API for high-quality Japanese text (when API key is configured)
- Whisper tiny (CPU) for segment timestamps
- Falls back to Whisper tiny only when no API key is present
"""

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import structlog

from backend.services.transcription_service import (
    TranscriptionStorage,
    TranscriptionResult,
    GeminiTranscriptionProvider,
)
from backend.api.content import get_output_dir, validate_path_within_dir
from backend.services.service_utils import validate_service, get_service_display_name

router = APIRouter()
logger = structlog.get_logger(__name__)

storage = TranscriptionStorage()


def _get_gemini_api_key() -> str | None:
    """Load LLM API key from keyring (shared with translation)."""
    from pysaka.credentials import get_token_manager

    tm = get_token_manager()
    data = tm.store.load("llm_provider_api_key")
    if data:
        return data.get("api_key")
    return None


class TranscribeRequest(BaseModel):
    message_id: int
    service: str
    member_path: str  # Relative path to member dir from output dir


@router.post("/transcribe")
async def transcribe(request: TranscribeRequest):
    """On-demand transcription of a single message."""
    try:
        validate_service(request.service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    output_dir = get_output_dir()
    member_dir = validate_path_within_dir(output_dir, request.member_path)

    if not member_dir.is_dir():
        raise HTTPException(status_code=404, detail="Member directory not found")

    # Check cache first
    cached = storage.load(member_dir, request.message_id)
    if cached:
        return {"ok": True, "transcription": _result_to_dict(cached)}

    # Find the media file for this message
    messages_file = member_dir / "messages.json"
    if not messages_file.exists():
        raise HTTPException(status_code=404, detail="Messages file not found")

    import json

    with open(messages_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    message = None
    for msg in data.get("messages", []):
        if msg.get("id") == request.message_id:
            message = msg
            break

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    media_type = message.get("type")
    if media_type not in ("voice", "video"):
        raise HTTPException(status_code=400, detail="Message is not voice or video")

    media_file = message.get("media_file")
    if not media_file:
        raise HTTPException(status_code=400, detail="Message has no media file")

    # Resolve media path — media_file is relative to the service directory
    # (e.g., "messages/34 金村 美玖/.../voice/123.m4a") but validate_path_within_dir
    # expects paths relative to output_dir. Extract the service dir name from
    # member_path (e.g., "日向坂46/messages/34 金村 美玖/58 金村 美玖").
    service_dir_name = request.member_path.split("/")[0]
    media_path_from_output = f"{service_dir_name}/{media_file}"
    media_path = validate_path_within_dir(output_dir, media_path_from_output)
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="Media file not found on disk")

    try:
        api_key = _get_gemini_api_key()

        # Extract member/group context from member_path
        # e.g., "日向坂46/messages/85 片山 紗希/137 片山 紗希"
        path_parts = request.member_path.rstrip("/").split("/")
        member_name = None
        if path_parts:
            last = path_parts[-1]
            space_idx = last.find(" ")
            if space_idx > 0 and last[:space_idx].isdigit():
                member_name = last[space_idx + 1 :]
        try:
            group_display = get_service_display_name(request.service)
        except (ValueError, KeyError):
            group_display = request.service

        if not api_key:
            raise HTTPException(
                status_code=400,
                detail="No API key configured. Please set up a provider in Translation settings.",
            )

        # Read provider and model from settings (shared with translation)
        from backend.services.settings_store import load_config
        from backend.api.translation import DEFAULT_GEMINI_MODEL

        config = await load_config()
        provider = config.get("translation_provider")

        if provider and provider != "gemini":
            raise HTTPException(
                status_code=400,
                detail="Transcription requires Gemini (multimodal audio). Please switch provider to Gemini in Translation settings.",
            )

        model = config.get("translation_model") or DEFAULT_GEMINI_MODEL

        gemini_provider = GeminiTranscriptionProvider(api_key=api_key, model=model)

        try:
            gemini_text, segments = await gemini_provider.transcribe(
                media_path, member_name=member_name, group_name=group_display
            )
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status == 429:
                raise HTTPException(
                    status_code=429,
                    detail="Rate limit reached. Please wait a moment and try again.",
                )
            elif status == 503:
                raise HTTPException(
                    status_code=503,
                    detail="Gemini API is temporarily unavailable. Please try again later.",
                )
            elif status == 404:
                raise HTTPException(
                    status_code=502,
                    detail=f"Gemini model '{gemini_provider._model}' not found. Check settings.",
                )
            else:
                raise HTTPException(
                    status_code=502,
                    detail=f"Gemini API error ({status}). Please try again.",
                )
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="Cannot reach Gemini API. Check your internet connection.",
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="Gemini API timed out. The audio may be too long. Please try again.",
            )

        duration = segments[-1].end if segments else 0.0

        result = TranscriptionResult(
            message_id=request.message_id,
            media_type=media_type,
            language="ja",
            model=f"gemini-{gemini_provider._model}",
            duration_seconds=round(duration, 2),
            full_text=gemini_text,
            segments=segments,
        )

        # Save to JSON sidecar
        storage.save(member_dir, result)

        logger.info(
            "Transcription complete",
            message_id=request.message_id,
            duration=result.duration_seconds,
            segments=len(result.segments),
        )

        return {"ok": True, "transcription": _result_to_dict(result)}

    except HTTPException:
        raise  # Re-raise specific HTTP errors as-is
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(
            "Transcription failed", message_id=request.message_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@router.get("/status")
async def get_status():
    """Get background transcription pipeline status."""
    # Background pipeline not yet implemented — return idle status
    return {
        "queue_size": 0,
        "processing": False,
        "current_message_id": None,
    }


@router.get("/{service}/{message_id}")
async def get_cached(service: str, message_id: int):
    """Get a cached transcription by service and message_id."""
    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    output_dir = get_output_dir()

    # Search all member directories under this service for the message
    try:
        display_name = get_service_display_name(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown service: {service}")

    service_dir = output_dir / display_name / "messages"
    if not service_dir.exists():
        raise HTTPException(status_code=404, detail="Service directory not found")

    # Search through group/member dirs for this message_id
    for group_dir in service_dir.iterdir():
        if not group_dir.is_dir():
            continue
        for member_dir in group_dir.iterdir():
            if not member_dir.is_dir():
                continue
            result = storage.load(member_dir, message_id)
            if result:
                return {"ok": True, "transcription": _result_to_dict(result)}

    raise HTTPException(status_code=404, detail="Transcription not found")


def _result_to_dict(result: TranscriptionResult) -> dict:
    """Convert TranscriptionResult to API response dict."""
    return {
        "message_id": result.message_id,
        "media_type": result.media_type,
        "language": result.language,
        "model": result.model,
        "created_at": result.created_at,
        "duration_seconds": result.duration_seconds,
        "full_text": result.full_text,
        "segments": [
            {
                "start": s.start,
                "end": s.end,
                "text": s.text,
                "confidence": s.confidence,
            }
            for s in result.segments
        ],
    }
