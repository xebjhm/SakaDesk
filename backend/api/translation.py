"""
Translation API for SakaDesk.
Handles on-demand translation requests using cloud LLM providers (Gemini, OpenAI).
"""

import asyncio
import json
import re
from pathlib import Path
from typing import Literal, Optional, cast

import httpx
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.api.content import get_output_dir, validate_path_within_dir
from backend.services.settings_store import load_config, update_config
from backend.services.service_utils import validate_service, get_service_display_name
from pysaka.credentials import get_token_manager
from backend.services.translation_service import (
    GeminiProvider,
    OpenAIProvider,
    TranslationProvider,
    build_batch_translation_prompt,
    build_blog_translation_prompt,
    build_translation_prompt,
)

router = APIRouter()
logger = structlog.get_logger(__name__)


def _read_json_file(path: Path) -> dict:
    """Blocking read+parse of a JSON file (offload via asyncio.to_thread on the async path)."""
    with open(path, "r", encoding="utf-8") as f:
        return cast(dict, json.load(f))


# Canonical model list — the single source of truth for available models.
# Frontend reads this via /api/translation/models endpoint.
GEMINI_MODELS = [
    {
        "id": "gemini-3.1-flash-lite",
        "label": "Gemini 3.1 Flash Lite",
    },
    {
        "id": "gemini-3.5-flash",
        "label": "Gemini 3.5 Flash",
    },
]

DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0]["id"]


# --- Request models ---


class ConfigureRequest(BaseModel):
    # All optional/omittable; the endpoint does a full replace, writing None for
    # anything not sent (defaults make that contract explicit rather than
    # "required-but-nullable", which is what bare Optional means in Pydantic v2).
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    target_language: Optional[str] = None


class TestConnectionRequest(BaseModel):
    provider: str
    model: str
    api_key: Optional[str] = None  # If omitted, uses stored key from keyring


class TranslateRequest(BaseModel):
    type: Literal["message", "blog_full"]
    message_id: Optional[int] = None
    service: str
    member_path: Optional[str] = None
    context_message_ids: Optional[list[int]] = None
    paragraphs: Optional[list[str]] = None  # For blog_full: pre-split paragraphs
    target_language: str
    user_nickname: Optional[str] = None  # Replace %%% placeholders before translation


class TranslateBatchRequest(BaseModel):
    type: Literal["messages"]
    message_ids: list[int]
    service: str
    member_path: str
    target_language: str


# --- Provider helpers ---


_API_KEY_CREDENTIAL_GROUP = "llm_provider_api_key"


def _save_api_key(api_key: str) -> None:
    """Store translation API key in the OS credential manager (WCM/keyring)."""
    tm = get_token_manager()
    tm.store.save(_API_KEY_CREDENTIAL_GROUP, {"api_key": api_key})


def _load_api_key() -> Optional[str]:
    """Load translation API key from the OS credential manager."""
    tm = get_token_manager()
    data = tm.store.load(_API_KEY_CREDENTIAL_GROUP)
    if data:
        return cast(Optional[str], data.get("api_key"))
    return None


def _delete_api_key() -> None:
    """Delete translation API key from the OS credential manager."""
    tm = get_token_manager()
    tm.store.delete(_API_KEY_CREDENTIAL_GROUP)


_PLACEHOLDER_RE = re.compile(r"%%%|％％％")
_NICKNAME_TOKEN = "{{NICKNAME}}"


def _replace_placeholders_with_token(text: str) -> str:
    """Replace %%% / ％％％ with {{NICKNAME}} token for LLM translation."""
    return _PLACEHOLDER_RE.sub(_NICKNAME_TOKEN, text)


def _replace_token_with_nickname(text: str, nickname: str) -> str:
    """Replace {{NICKNAME}} token back to user's actual nickname after translation."""
    return text.replace(_NICKNAME_TOKEN, nickname)


def _provider_http_error(exc: Exception) -> HTTPException:
    """Map a provider/transport exception to an HTTPException.

    Provider-agnostic (works for any LLM backend, not just Gemini) and never
    leaks the raw exception text to the client — details go to the logs instead.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status == 429:
            return HTTPException(
                status_code=429,
                detail="Rate limit reached. Please wait a moment and try again.",
            )
        if status == 503:
            return HTTPException(
                status_code=503,
                detail="Translation service is temporarily unavailable. Please try again later.",
            )
        return HTTPException(
            status_code=502,
            detail=f"Translation provider error ({status}). Please try again.",
        )
    if isinstance(exc, httpx.ConnectError):
        return HTTPException(
            status_code=503,
            detail="Cannot reach the translation provider. Check your internet connection.",
        )
    if isinstance(exc, httpx.TimeoutException):
        return HTTPException(
            status_code=504,
            detail="The translation provider timed out. Please try again.",
        )
    return HTTPException(
        status_code=500, detail="Translation failed. Please try again."
    )


def _instantiate_provider(
    provider_name: str, model: str, api_key: str
) -> TranslationProvider:
    """Instantiate the correct provider from name/model/api_key."""
    if provider_name == "gemini":
        return GeminiProvider(api_key=api_key, model=model)
    elif provider_name == "openai":
        return OpenAIProvider(api_key=api_key, model=model)
    else:
        raise HTTPException(
            status_code=400, detail=f"Unknown provider: {provider_name}"
        )


async def _get_provider_from_config() -> TranslationProvider:
    """Load provider from saved settings + API key from keyring. Raises 400 if not configured."""
    config = await load_config()
    provider_name = config.get("translation_provider")
    model = config.get("translation_model")
    # Reset stale model to default
    if model and model not in _valid_model_ids():
        model = DEFAULT_GEMINI_MODEL
    api_key = _load_api_key()

    if not provider_name:
        raise HTTPException(
            status_code=400,
            detail="No translation provider configured. Please set a provider in settings.",
        )
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No translation API key configured. Please set an API key in settings.",
        )
    if not model:
        raise HTTPException(
            status_code=400,
            detail="No translation model configured. Please set a model in settings.",
        )

    return _instantiate_provider(provider_name, model, api_key)


def _extract_member_name(member_path: str) -> Optional[str]:
    """Extract member name from path like '日向坂46/messages/34 金村 美玖/58 金村 美玖'.

    Returns the last segment's name part (after the number prefix), e.g. '金村 美玖'.
    """
    parts = member_path.rstrip("/").split("/")
    if parts:
        last = parts[-1]
        # Remove leading number prefix: "58 金村 美玖" → "金村 美玖"
        space_idx = last.find(" ")
        if space_idx > 0 and last[:space_idx].isdigit():
            return last[space_idx + 1 :]
        return last
    return None


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences (```json ... ```) from LLM responses."""
    text = text.strip()
    # Remove opening fence (```json or ```)
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    # Remove closing fence
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


# --- Endpoints ---


def _valid_model_ids() -> set[str]:
    """Return the set of currently valid model IDs across all providers."""
    ids: set[str] = set()
    for models in (GEMINI_MODELS,):
        for m in models:
            ids.add(m["id"])
    return ids


@router.get("/config")
async def get_config():
    """Get current translation provider configuration.

    API key is returned as a masked string (e.g., 'AIza...xQ') so the frontend
    knows one is set without exposing the raw value.
    If the stored model is not in the current valid list, reset to default.
    """
    config = await load_config()

    # Auto-fix stale model names (e.g., preview suffix changes)
    stored_model = config.get("translation_model")
    if stored_model and stored_model not in _valid_model_ids():
        logger.info(
            "Resetting unknown model to default",
            old=stored_model,
            new=DEFAULT_GEMINI_MODEL,
        )
        stored_model = DEFAULT_GEMINI_MODEL

        def _fix(c: dict) -> None:
            c["translation_model"] = DEFAULT_GEMINI_MODEL

        await update_config(_fix)

    # Offload the OS keyring read — it can take hundreds of ms on Windows (WCM),
    # and running it on the event loop stalls every other request meanwhile.
    api_key = await asyncio.to_thread(_load_api_key)
    masked_key = None
    if api_key:
        if len(api_key) > 8:
            masked_key = api_key[:4] + "..." + api_key[-2:]
        else:
            masked_key = "****"
    return {
        "provider": config.get("translation_provider"),
        "model": stored_model,
        "api_key_masked": masked_key,
        "has_api_key": api_key is not None,
        "target_language": config.get("translation_target_language"),
    }


@router.get("/models")
async def get_models():
    """Return available models per provider. Frontend uses this as the source of truth."""
    return {
        "gemini": GEMINI_MODELS,
    }


@router.post("/configure")
async def configure(request: ConfigureRequest):
    """Save translation provider configuration.

    Provider, model, and target language go to settings.json.
    API key goes to the OS credential manager (WCM/keyring).
    """

    def _update(config: dict) -> None:
        config["translation_provider"] = request.provider
        config["translation_model"] = request.model
        config["translation_target_language"] = request.target_language
        # Remove api_key from settings.json if it was stored there previously
        config.pop("translation_api_key", None)

    await update_config(_update)

    # Store API key securely in keyring
    if request.api_key:
        _save_api_key(request.api_key)
    elif request.provider is None:
        # Clearing provider — also clear API key
        _delete_api_key()

    logger.info("Translation provider configured", provider=request.provider)
    return {"ok": True}


@router.post("/clear-api-key")
async def clear_api_key():
    """Delete the stored LLM API key from the OS credential manager.

    Provider/model settings are left intact; only the secret is removed. Used by
    the settings "Clear API key" action for users who want to wipe the key.
    """
    _delete_api_key()
    logger.info("Cleared stored LLM API key")
    return {"ok": True}


@router.post("/test-connection")
async def test_connection(request: TestConnectionRequest):
    """Test if the API key is valid by pinging the provider."""
    api_key = request.api_key or _load_api_key()
    if not api_key:
        return {
            "ok": False,
            "code": "no_key",
            "detail": "No API key provided or stored.",
        }
    provider = _instantiate_provider(request.provider, request.model, api_key)
    status = await provider.check_connection()
    if status == "ok":
        return {"ok": True}
    if status == "auth":
        # Distinguish a rejected key from a network failure so the user fixes the
        # right thing instead of always being told the key is bad.
        return {
            "ok": False,
            "code": "auth",
            "detail": "The API key was rejected. Check that it is correct.",
        }
    return {
        "ok": False,
        "code": "unreachable",
        "detail": "Could not reach the provider. Check your internet connection.",
    }


@router.post("/translate")
async def translate(request: TranslateRequest):
    """Translate a single message or blog paragraph."""
    try:
        validate_service(request.service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    provider = await _get_provider_from_config()

    if request.type == "message":
        # --- Message translation ---
        if request.message_id is None:
            raise HTTPException(
                status_code=422, detail="message_id required for type 'message'"
            )
        if not request.member_path:
            raise HTTPException(
                status_code=422, detail="member_path required for type 'message'"
            )

        output_dir = get_output_dir()
        member_dir = validate_path_within_dir(output_dir, request.member_path)

        if not member_dir.is_dir():
            raise HTTPException(status_code=404, detail="Member directory not found")

        messages_file = member_dir / "messages.json"
        if not messages_file.exists():
            raise HTTPException(status_code=404, detail="messages.json not found")

        data = await asyncio.to_thread(_read_json_file, messages_file)

        messages = data.get("messages", [])
        message_map: dict[int, dict] = {m["id"]: m for m in messages if "id" in m}

        target_msg = message_map.get(request.message_id)
        if not target_msg:
            raise HTTPException(status_code=404, detail="Message not found")

        raw_text = target_msg.get("content", "") or ""
        if not raw_text.strip():
            raise HTTPException(
                status_code=400, detail="Message has no text to translate"
            )

        # Replace %%% with {{NICKNAME}} token for LLM (actual nickname swapped after)
        has_nickname = (
            bool(request.user_nickname) and _PLACEHOLDER_RE.search(raw_text) is not None
        )
        text = _replace_placeholders_with_token(raw_text)

        # Build context texts (also with token replaced)
        context_texts: list[str] = []
        if request.context_message_ids:
            for ctx_id in request.context_message_ids:
                ctx_msg = message_map.get(ctx_id)
                if ctx_msg:
                    ctx_text = ctx_msg.get("content", "") or ""
                    if ctx_text.strip():
                        context_texts.append(_replace_placeholders_with_token(ctx_text))

        # Extract member/group context for better prompts
        member_name = (
            _extract_member_name(request.member_path) if request.member_path else None
        )
        try:
            group_name = get_service_display_name(request.service)
        except (ValueError, KeyError):
            group_name = request.service

        prompt, system_instruction = build_translation_prompt(
            text=text,
            target_language=request.target_language,
            context_texts=context_texts if context_texts else None,
            member_name=member_name,
            group_name=group_name,
            content_type="message",
        )

        try:
            translation = await provider.translate(prompt, system_instruction)
        except Exception as e:
            logger.error(
                "Translation failed", message_id=request.message_id, error=str(e)
            )
            raise _provider_http_error(e) from e

        # Replace {{NICKNAME}} token back to actual nickname
        result = translation.strip()
        if has_nickname and request.user_nickname:
            result = _replace_token_with_nickname(result, request.user_nickname)

        logger.info(
            "Message translated",
            message_id=request.message_id,
            target_language=request.target_language,
        )
        return {"ok": True, "translation": result}

    elif request.type == "blog_full":
        # --- Full blog translation with paragraph-level output ---
        if not request.paragraphs or len(request.paragraphs) == 0:
            raise HTTPException(
                status_code=422,
                detail="paragraphs list required for type 'blog_full'",
            )

        try:
            group_name = get_service_display_name(request.service)
        except (ValueError, KeyError):
            group_name = request.service

        prompt, system_instruction = build_blog_translation_prompt(
            paragraphs=request.paragraphs,
            target_language=request.target_language,
            group_name=group_name,
        )

        try:
            raw = await provider.translate(prompt, system_instruction)
        except Exception as e:
            logger.error("Blog full translation failed", error=str(e))
            raise _provider_http_error(e) from e

        # Parse the JSON map (paragraph index -> translation) and re-align to the
        # source order. A paragraph the model merged/omitted stays empty instead of
        # shifting every later translation under the wrong source paragraph.
        cleaned = _strip_markdown_fences(raw)
        try:
            translated_map: dict[str, str] = json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.error(
                "Failed to parse blog translation JSON", error=str(e), raw=raw[:200]
            )
            raise HTTPException(
                status_code=502,
                detail="Provider returned invalid JSON for blog translation",
            )

        aligned = [
            str(translated_map.get(str(i), "")).strip()
            for i in range(len(request.paragraphs))
        ]
        missing = sum(1 for t in aligned if not t)
        logger.info(
            "Blog translated",
            original_count=len(request.paragraphs),
            missing=missing,
        )
        return {
            "ok": True,
            "translations": aligned,
            "partial": missing > 0,
        }

    else:
        raise HTTPException(
            status_code=422, detail=f"Unknown translation type: {request.type}"
        )


@router.post("/translate-batch")
async def translate_batch(request: TranslateBatchRequest):
    """Batch translate multiple messages at once."""
    try:
        validate_service(request.service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    provider = await _get_provider_from_config()

    output_dir = get_output_dir()
    member_dir = validate_path_within_dir(output_dir, request.member_path)

    if not member_dir.is_dir():
        raise HTTPException(status_code=404, detail="Member directory not found")

    messages_file = member_dir / "messages.json"
    if not messages_file.exists():
        raise HTTPException(status_code=404, detail="messages.json not found")

    data = await asyncio.to_thread(_read_json_file, messages_file)

    messages = data.get("messages", [])
    message_map: dict[int, dict] = {m["id"]: m for m in messages if "id" in m}

    # Collect non-empty texts for requested IDs
    texts_to_translate: dict[str, str] = {}
    for msg_id in request.message_ids:
        msg = message_map.get(msg_id)
        if msg:
            text = msg.get("content", "") or ""
            if text.strip():
                texts_to_translate[str(msg_id)] = text

    if not texts_to_translate:
        return {"ok": True, "translations": {}}

    member_name = _extract_member_name(request.member_path)
    try:
        group_name = get_service_display_name(request.service)
    except (ValueError, KeyError):
        group_name = request.service

    prompt, system_instruction = build_batch_translation_prompt(
        texts=texts_to_translate,
        target_language=request.target_language,
        member_name=member_name,
        group_name=group_name,
    )

    try:
        raw_response = await provider.translate(prompt, system_instruction)
    except Exception as e:
        logger.error("Batch translation failed", error=str(e))
        raise _provider_http_error(e) from e

    # Parse JSON from LLM response (strip markdown fences if present)
    cleaned = _strip_markdown_fences(raw_response)
    try:
        translations: dict[str, str] = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.error(
            "Failed to parse batch translation JSON",
            error=str(e),
            raw=raw_response[:200],
        )
        raise HTTPException(
            status_code=502,
            detail="Provider returned invalid JSON for batch translation",
        )

    # Surface any requested messages the model silently dropped, rather than
    # returning "success" while some messages stay quietly untranslated.
    missing = sorted(set(texts_to_translate) - set(translations))
    if missing:
        logger.warning(
            "Batch translation omitted requested messages",
            missing_ids=missing,
            missing_count=len(missing),
        )

    logger.info(
        "Batch translation complete",
        count=len(translations),
        target_language=request.target_language,
    )
    return {"ok": True, "translations": translations, "missing": missing}
