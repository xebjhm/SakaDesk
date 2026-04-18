"""
Transcription API for SakaDesk.
Handles on-demand transcription requests and cached transcript retrieval.
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import structlog

from backend.services.transcription_service import (
    TranscriptionStorage,
    TranscriptionResult,
    LocalWhisperProvider,
)
from backend.services.platform import get_app_data_dir, get_settings_path
from backend.services.settings_store import _read_file
from backend.api.content import get_output_dir, validate_path_within_dir
from backend.services.service_utils import validate_service, get_service_display_name

router = APIRouter()
logger = structlog.get_logger(__name__)

storage = TranscriptionStorage()

# Singleton provider — model loaded once, reused across requests.
_provider: LocalWhisperProvider | None = None
_provider_device: str | None = None  # Track which device the singleton was loaded with


def _get_model_dir() -> Path:
    model_dir = get_app_data_dir() / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    return model_dir


def _get_provider() -> LocalWhisperProvider:
    global _provider, _provider_device
    settings = _read_file(get_settings_path())
    device = settings.get("transcription_device", "cpu")

    # Reload if device setting changed
    if _provider is not None and _provider_device == device:
        return _provider

    _provider = LocalWhisperProvider(
        model_size="medium", model_dir=_get_model_dir(), device=device
    )
    _provider_device = device
    return _provider


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

    # Transcribe using singleton provider (model loaded once)
    try:
        import asyncio

        provider = _get_provider()
        result = await asyncio.to_thread(provider.transcribe, media_path, "ja")
        result.message_id = request.message_id
        result.media_type = media_type

        # Save to JSON sidecar
        storage.save(member_dir, result)

        logger.info(
            "Transcription complete",
            message_id=request.message_id,
            duration=result.duration_seconds,
            segments=len(result.segments),
        )

        return {"ok": True, "transcription": _result_to_dict(result)}

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(
            "Transcription failed", message_id=request.message_id, error=str(e)
        )
        raise HTTPException(status_code=500, detail="Transcription failed")


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


@router.post("/test-gpu")
async def test_gpu():
    """Test if CUDA/GPU transcription works on this machine.

    Loads the model on CUDA, runs a minimal inference test, and reports
    whether GPU acceleration is available. Called from settings before
    switching device to 'cuda'.
    """
    import asyncio

    def _test():
        try:
            provider = LocalWhisperProvider(
                model_size="medium", model_dir=_get_model_dir(), device="cuda"
            )
            provider._ensure_model()

            # Generate 1 second of silence to test inference
            import numpy as np

            silence = np.zeros(16000, dtype=np.float32)
            segments, _info = provider._model.transcribe(
                silence, language="ja", beam_size=1, vad_filter=False
            )
            # Consume iterator to trigger actual CUDA inference
            for _ in segments:
                pass

            return {
                "ok": True,
                "device": "cuda",
                "message": "GPU acceleration is available",
            }
        except Exception as e:
            return {"ok": False, "device": "cpu", "error": str(e)}

    return await asyncio.to_thread(_test)


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
