"""
Translation API for SakaDesk.
Handles on-demand translation requests using cloud LLM providers (Gemini, OpenAI).
"""

import json
import re
from pathlib import Path
from typing import Optional

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

# Canonical model list — the single source of truth for available models.
# Frontend reads this via /api/translation/models endpoint.
GEMINI_MODELS = [
    {
        "id": "gemini-3.1-flash-lite-preview",
        "label": "Gemini 3.1 Flash Lite — fast, free tier (recommended)",
    },
    {
        "id": "gemini-3.1-flash-preview",
        "label": "Gemini 3.1 Flash — higher quality",
    },
]

DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0]["id"]


# --- Request models ---


class ConfigureRequest(BaseModel):
    provider: Optional[str]
    model: Optional[str]
    api_key: Optional[str]
    target_language: Optional[str]


class TestConnectionRequest(BaseModel):
    provider: str
    model: str
    api_key: Optional[str] = None  # If omitted, uses stored key from keyring


class TranslateRequest(BaseModel):
    type: str  # "message", "blog_paragraph", or "blog_full"
    message_id: Optional[int] = None
    service: str
    member_path: Optional[str] = None
    context_message_ids: Optional[list[int]] = None
    text: Optional[str] = None
    blog_html: Optional[str] = None
    paragraphs: Optional[list[str]] = None  # For blog_full: pre-split paragraphs
    target_language: str
    user_nickname: Optional[str] = None  # Replace %%% placeholders before translation


class TranslateBatchRequest(BaseModel):
    type: str  # "messages"
    message_ids: list[int]
    service: str
    member_path: str
    target_language: str


class TranslateBlogRequest(BaseModel):
    blog_id: str
    service: str
    target_language: str
    mode: str = "full"


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
        return data.get("api_key")
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


def _parse_paragraphs_from_html(html: str) -> list[str]:
    """Extract non-empty text paragraphs from blog HTML."""
    # Try to use html.parser via stdlib; fall back to regex if unavailable
    try:
        from html.parser import HTMLParser

        class _ParagraphExtractor(HTMLParser):
            def __init__(self) -> None:
                super().__init__()
                self._paragraphs: list[str] = []
                self._current: list[str] = []
                self._in_block = False

            def handle_starttag(self, tag: str, attrs: object) -> None:
                if tag in ("p", "br"):
                    self._in_block = True

            def handle_endtag(self, tag: str) -> None:
                if tag == "p":
                    text = "".join(self._current).strip()
                    if text:
                        self._paragraphs.append(text)
                    self._current = []
                    self._in_block = False

            def handle_data(self, data: str) -> None:
                self._current.append(data)

        parser = _ParagraphExtractor()
        parser.feed(html)
        # Also flush any remaining text
        remaining = "".join(parser._current).strip()
        if remaining:
            parser._paragraphs.append(remaining)
        paragraphs = parser._paragraphs
    except Exception:
        # Fallback: strip all tags
        plain = re.sub(r"<[^>]+>", " ", html)
        paragraphs = [p.strip() for p in plain.split("\n") if p.strip()]

    return [p for p in paragraphs if p]


# --- Endpoints ---


@router.get("/config")
async def get_config():
    """Get current translation provider configuration.

    API key is returned as a masked string (e.g., 'AIza...xQ') so the frontend
    knows one is set without exposing the raw value.
    """
    config = await load_config()

    api_key = _load_api_key()
    masked_key = None
    if api_key:
        if len(api_key) > 8:
            masked_key = api_key[:4] + "..." + api_key[-2:]
        else:
            masked_key = "****"
    return {
        "provider": config.get("translation_provider"),
        "model": config.get("translation_model"),
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


@router.post("/test-connection")
async def test_connection(request: TestConnectionRequest):
    """Test if the API key is valid by pinging the provider."""
    api_key = request.api_key or _load_api_key()
    if not api_key:
        return {"ok": False, "detail": "No API key provided or stored."}
    provider = _instantiate_provider(request.provider, request.model, api_key)
    available = await provider.is_available()
    if not available:
        return {"ok": False, "detail": "Provider is not reachable with the given key."}
    return {"ok": True}


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

        with open(messages_file, "r", encoding="utf-8") as f:
            data = json.load(f)

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
                detail="Gemini API timed out. Please try again.",
            )
        except Exception as e:
            logger.error(
                "Translation failed", message_id=request.message_id, error=str(e)
            )
            raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

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

    elif request.type == "blog_paragraph":
        # --- Blog paragraph translation ---
        text = request.text
        if not text or not text.strip():
            raise HTTPException(
                status_code=422, detail="text required for type 'blog_paragraph'"
            )

        context_texts: list[str] = []
        if request.blog_html:
            # Use surrounding paragraphs as context (first few only)
            paragraphs = _parse_paragraphs_from_html(request.blog_html)
            context_texts = [p for p in paragraphs[:3] if p != text]

        try:
            group_name = get_service_display_name(request.service)
        except (ValueError, KeyError):
            group_name = request.service

        prompt, system_instruction = build_translation_prompt(
            text=text,
            target_language=request.target_language,
            context_texts=context_texts if context_texts else None,
            group_name=group_name,
            content_type="blog post",
        )

        try:
            translation = await provider.translate(prompt, system_instruction)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            raise HTTPException(
                status_code=502,
                detail=f"Provider error: {e.response.status_code}",
            )
        except Exception as e:
            logger.error("Blog paragraph translation failed", error=str(e))
            raise HTTPException(status_code=500, detail="Translation failed")

        return {"ok": True, "translation": translation.strip()}

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
            # Split by the ===PARAGRAPH=== delimiter
            translated_paragraphs = raw.strip().split("===PARAGRAPH===")
            # Clean whitespace from each
            translated_paragraphs = [p.strip() for p in translated_paragraphs]
            # Remove empty entries
            translated_paragraphs = [p for p in translated_paragraphs if p]

            logger.info(
                "Blog translated",
                original_count=len(request.paragraphs),
                translated_count=len(translated_paragraphs),
            )

            return {
                "ok": True,
                "translations": translated_paragraphs,
                "partial": len(translated_paragraphs) != len(request.paragraphs),
            }

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            raise HTTPException(
                status_code=502,
                detail=f"Provider error: {e.response.status_code}",
            )
        except Exception as e:
            logger.error("Blog full translation failed", error=str(e))
            raise HTTPException(status_code=500, detail="Translation failed")

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

    with open(messages_file, "r", encoding="utf-8") as f:
        data = json.load(f)

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
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        raise HTTPException(
            status_code=502, detail=f"Provider error: {e.response.status_code}"
        )
    except Exception as e:
        logger.error("Batch translation failed", error=str(e))
        raise HTTPException(status_code=500, detail="Batch translation failed")

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

    logger.info(
        "Batch translation complete",
        count=len(translations),
        target_language=request.target_language,
    )
    return {"ok": True, "translations": translations}


@router.post("/translate-blog")
async def translate_blog(request: TranslateBlogRequest):
    """Translate a full blog post by loading its cached HTML."""
    try:
        validate_service(request.service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    provider = await _get_provider_from_config()

    # Locate the blog JSON file.
    # Blog cache lives at: {output_dir}/{service_display}/blogs/{member_name}/{date}_{blog_id}/blog.json
    # We search by blog_id since we don't have member_name or date here.
    from backend.services.service_utils import get_service_display_name

    try:
        display_name = get_service_display_name(request.service)
    except ValueError:
        raise HTTPException(
            status_code=400, detail=f"Unknown service: {request.service}"
        )

    output_dir = get_output_dir()
    blogs_base = output_dir / display_name / "blogs"

    # Search for the blog cache file
    blog_json_path: Optional[Path] = None
    if blogs_base.exists():
        for member_dir in blogs_base.iterdir():
            if not member_dir.is_dir():
                continue
            for entry_dir in member_dir.iterdir():
                if not entry_dir.is_dir():
                    continue
                # Folder name format: {date}_{blog_id}
                if (
                    entry_dir.name.endswith(f"_{request.blog_id}")
                    or entry_dir.name == request.blog_id
                ):
                    candidate = entry_dir / "blog.json"
                    if candidate.exists():
                        blog_json_path = candidate
                        break
            if blog_json_path:
                break

    if not blog_json_path:
        raise HTTPException(
            status_code=404,
            detail=f"Blog {request.blog_id} not found in cache for {request.service}",
        )

    with open(blog_json_path, "r", encoding="utf-8") as f:
        blog_data = json.load(f)

    html = blog_data.get("content", {}).get("html", "")
    if not html:
        raise HTTPException(status_code=404, detail="Blog has no HTML content in cache")

    paragraphs = _parse_paragraphs_from_html(html)
    if not paragraphs:
        raise HTTPException(
            status_code=404, detail="No translatable paragraphs found in blog"
        )

    # Translate paragraph by paragraph (sequential to respect rate limits)
    results: list[dict] = []
    for idx, para in enumerate(paragraphs):
        prompt, system_instruction = build_translation_prompt(
            text=para,
            target_language=request.target_language,
        )
        try:
            translation = await provider.translate(prompt, system_instruction)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise HTTPException(status_code=429, detail="Rate limit exceeded")
            raise HTTPException(
                status_code=502,
                detail=f"Provider error: {e.response.status_code}",
            )
        except Exception as e:
            logger.error("Blog paragraph translation failed", index=idx, error=str(e))
            raise HTTPException(status_code=500, detail="Translation failed")

        results.append(
            {
                "index": idx,
                "original": para,
                "translation": translation.strip(),
            }
        )

    logger.info(
        "Blog translation complete",
        blog_id=request.blog_id,
        paragraphs=len(results),
        target_language=request.target_language,
    )
    return {"ok": True, "translations": results}
