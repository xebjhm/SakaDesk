"""
Translation service for SakaDesk.

Provides AI-powered Japanese-to-target-language translation using cloud LLM APIs,
with a provider abstraction for multiple backends (Gemini, OpenAI).

Translations are cached client-side in localStorage — no server-side storage.
"""

import re
import structlog
from abc import ABC, abstractmethod
from typing import Literal, Optional, cast

import httpx

from backend.services.ai_errors import (
    EmptyOutputError,
    IncompleteOutputError,
    SafetyBlockedError,
)

# Result of a provider connectivity probe: reachable+authorized, key rejected,
# or could-not-reach (network/timeout/unexpected status). Lets the UI tell the
# user whether to fix the key or their connection.
ConnectionStatus = Literal["ok", "auth", "unreachable"]

logger = structlog.get_logger(__name__)

LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "ja": "Japanese",
    "zh-TW": "Traditional Chinese",
    "zh-CN": "Simplified Chinese",
    "yue": "Cantonese",
}

_PLACEHOLDER_RE = re.compile(r"%%%|％％％")


# ---------------------------------------------------------------------------
# System instruction for idol group translation
# ---------------------------------------------------------------------------
# Gemini uses this via `system_instruction` (higher priority than user message).
# OpenAI uses it as the `system` message. Organized by category.

_SYSTEM_INSTRUCTION = """You are a specialist translator for Japanese idol group content (坂道シリーズ: 日向坂46, 櫻坂46, 乃木坂46).

## 1. Names & Proper Nouns

- Keep ALL Japanese proper nouns in their original form. Never translate or romanize:
  member names, group names, song/single/album titles, concert names, show names.
- Keep honorific suffixes attached: ～ちゃん, ～さん, ～くん, ～先輩, ～氏.
  Example: '美玖ちゃん' stays '美玖ちゃん', NOT 'Miku' or 'dear Miku'.
- Keep member nicknames in Japanese: かとし, まなふぃ, きょんこ, おすし, etc.
- Keep abbreviated show names as-is: ひなあい, そこさく, 乃木坂工事中, etc.

## 2. Fan & Community Terms

- Keep fan group names untranslated: おひさま (日向坂46), Buddies (櫻坂46).
- Keep fan terminology in Japanese: 推し, 担当, 推しメン, 同担, ファン.
- Keep generation references as-is: 一期生, 二期生, 三期生, 四期生, 五期生.

## 3. Industry & Performance Terms

Keep these in Japanese (with natural context):
- Events: ライブ, 握手会, ミーグリ (meet & greet), お渡し会, 全国ツアー, リリースイベント
- Music: セトリ (setlist), MV, サビ (chorus), 振り付け, フリ (choreography), 歌割り (singing parts)
- Stage: センター, フォーメーション, ポジション, アンダー, 選抜, 福神
- Production: 衣装, レッスン, リハーサル, 収録, ロケ
- Use your judgment: translate when meaning would be lost to non-fans,
  keep in Japanese when fans would expect the original term.

## 4. Tone & Personality

- Preserve the author's tone exactly. Casual stays casual, cute stays cute.
  Do NOT formalize or flatten the writing style.
- Translate casual abbreviations as casual: めっちゃ, すご(い), ありがと(う), おは(よう).
  Do NOT "correct" them to formal forms before translating.
- Third-person self-reference (e.g., '美玖は〜') should be translated as
  first person ('I') naturally in the target language.
- Preserve the emotional nuance of sentence-ending particles (よ, ね, な, かな, だよね).
  These convey warmth, seeking agreement, wonder, etc.

## 5. Expressions & Formatting

- Keep onomatopoeia and interjections in original form:
  えへへ, わーい, うわぁ, きゃー, ふふ, えーん, よいしょ, etc.
- Preserve repeated characters for emphasis exactly as written:
  すごいいいい, かわいいいいい, ありがとうううう. Do NOT compress.
- Translate parenthetical expressions naturally:
  (笑) → (lol), (泣) → (cries), (照) → (blushes). Keep extended thoughts in parentheses.
- Keep all emoji and kaomoji exactly as they appear: ( ¨̮ ), (´;ω;`), etc.
- Keep hashtags as-is: #日向坂46, #ブログ, etc.
- Preserve line breaks and paragraph structure.

## 6. Dates & Formatting

- Convert Japanese date formats (2026年4月18日) to the target language's
  natural format. Keep day-of-week references natural.

## 7. Target Language Notes

- When translating to Chinese (Traditional/Simplified/Cantonese), many kanji terms
  can be kept as-is since they share characters. Use the target variant's conventions.
- When translating to English, prioritize natural flow over literal accuracy.
  Idol fan culture context should feel natural, not academic.

## 8. Placeholders

- If the text contains {{NICKNAME}}, keep it exactly as-is in the translation.

## Output

Output only the translation. No explanations, notes, or commentary."""


def _build_system_instruction(
    member_name: Optional[str] = None,
    group_name: Optional[str] = None,
    content_type: str = "message",
) -> str:
    """Build the full system instruction with optional context header."""
    parts: list[str] = []

    if group_name and member_name:
        parts.append(
            f"[Context: translating a {content_type} from {member_name}, "
            f"a member of {group_name}.]\n"
        )
    elif member_name:
        parts.append(f"[Context: translating a {content_type} from {member_name}.]\n")
    elif group_name:
        parts.append(
            f"[Context: translating a {content_type} from a member of {group_name}.]\n"
        )

    parts.append(_SYSTEM_INSTRUCTION)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------


class TranslationProvider(ABC):
    """Abstract base for translation engines."""

    @abstractmethod
    async def translate(
        self, prompt: str, system_instruction: Optional[str] = None
    ) -> str:
        """Send a translation prompt and return the raw response text."""
        ...

    @abstractmethod
    async def check_connection(self) -> ConnectionStatus:
        """Probe the provider: 'ok', 'auth' (key rejected), or 'unreachable'."""
        ...


class GeminiProvider(TranslationProvider):
    """Google Gemini translation provider."""

    def __init__(self, api_key: str, model: str = "gemini-3.1-flash-lite"):
        self._api_key = api_key
        self._model = model

    async def translate(
        self, prompt: str, system_instruction: Optional[str] = None
    ) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        payload: dict = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 1.0},
        }
        if system_instruction:
            payload["system_instruction"] = {"parts": [{"text": system_instruction}]}
        logger.debug("translation.gemini_request", model=self._model)
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers={"x-goog-api-key": self._api_key},
                json=payload,
            )
            # Log the failing status + a body snippet (never the api key/headers)
            # so a bad model (404), rejected key (401/403), or quota (429) is
            # diagnosable instead of silently raising.
            if resp.status_code != 200:
                logger.error(
                    "translation.gemini_http_error",
                    model=self._model,
                    status=resp.status_code,
                    body=resp.text[:300],
                )
            resp.raise_for_status()
            data = resp.json()

            candidates = data.get("candidates", [])
            if not candidates:
                raise EmptyOutputError("Gemini returned no candidates")

            candidate = candidates[0]
            finish_reason = candidate.get("finishReason", "")
            if finish_reason == "SAFETY":
                raise SafetyBlockedError("Translation blocked by Gemini safety filter")
            if "content" not in candidate or not candidate["content"].get("parts"):
                raise EmptyOutputError(
                    f"Gemini returned no content (finishReason: {finish_reason})"
                )
            # A non-STOP finish (MAX_TOKENS, RECITATION, OTHER) means the text is
            # truncated. Returning it would cache a half-translation as a success
            # with a "✓ translated" badge and no indication content is missing.
            if finish_reason not in ("STOP", ""):
                raise IncompleteOutputError(
                    f"Translation incomplete (finishReason: {finish_reason})"
                )

            return cast(str, candidate["content"]["parts"][0]["text"])

    async def check_connection(self) -> ConnectionStatus:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers={"x-goog-api-key": self._api_key})
        except httpx.HTTPError:
            return "unreachable"
        if resp.status_code == 200:
            return "ok"
        if resp.status_code in (401, 403):
            return "auth"
        return "unreachable"


class OpenAIProvider(TranslationProvider):
    """OpenAI translation provider."""

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self._api_key = api_key
        self._model = model

    async def translate(
        self, prompt: str, system_instruction: Optional[str] = None
    ) -> str:
        url = "https://api.openai.com/v1/chat/completions"
        system_msg = system_instruction or (
            "You are a precise Japanese translator. "
            "Output only the translation, no explanations."
        )
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
        }
        logger.debug("translation.openai_request", model=self._model)
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url, headers={"Authorization": f"Bearer {self._api_key}"}, json=payload
            )
            if resp.status_code != 200:
                logger.error(
                    "translation.openai_http_error",
                    model=self._model,
                    status=resp.status_code,
                    body=resp.text[:300],
                )
            resp.raise_for_status()
            data = resp.json()
            return cast(str, data["choices"][0]["message"]["content"])

    async def check_connection(self) -> ConnectionStatus:
        url = "https://api.openai.com/v1/models"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    url, headers={"Authorization": f"Bearer {self._api_key}"}
                )
        except httpx.HTTPError:
            return "unreachable"
        if resp.status_code == 200:
            return "ok"
        if resp.status_code in (401, 403):
            return "auth"
        return "unreachable"


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------


def _get_language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def _has_placeholders(text: str) -> bool:
    return bool(_PLACEHOLDER_RE.search(text))


def build_translation_prompt(
    text: str,
    target_language: str,
    context_texts: Optional[list[str]] = None,
    member_name: Optional[str] = None,
    group_name: Optional[str] = None,
    content_type: str = "message",
) -> tuple[str, str]:
    """Build a translation prompt for a single text item.

    Returns:
        (user_prompt, system_instruction) tuple. The system instruction
        contains all domain rules; the user prompt is just the task + text.
    """
    lang_name = _get_language_name(target_language)
    parts: list[str] = []

    parts.append(f"Translate to {lang_name}.")

    if context_texts:
        parts.append("\n--- Context (do NOT translate, for reference only) ---")
        for ctx in context_texts:
            parts.append(ctx)
        parts.append("--- End context ---\n")

    parts.append(f"\n{text}")

    system = _build_system_instruction(member_name, group_name, content_type)
    return "\n".join(parts), system


def build_batch_translation_prompt(
    texts: dict[str, str],
    target_language: str,
    member_name: Optional[str] = None,
    group_name: Optional[str] = None,
) -> tuple[str, str]:
    """Build a batch translation prompt for multiple messages.

    Returns:
        (user_prompt, system_instruction) tuple.
    """
    lang_name = _get_language_name(target_language)

    parts: list[str] = []
    parts.append(f"Translate each message to {lang_name}.")
    parts.append(
        "Return a JSON object mapping each ID to its translation. "
        "Output only valid JSON, no markdown fences, no explanation."
    )

    parts.append("\nMessages:")
    for msg_id, text in texts.items():
        parts.append(f'  "{msg_id}": "{text}"')

    system = _build_system_instruction(member_name, group_name, "message")
    return "\n".join(parts), system


def build_blog_translation_prompt(
    paragraphs: list[str],
    target_language: str,
    member_name: Optional[str] = None,
    group_name: Optional[str] = None,
) -> tuple[str, str]:
    """Build a prompt for translating an entire blog post paragraph-by-paragraph.

    Paragraphs are numbered and the model returns a JSON map of number → text, so
    a merged/omitted paragraph only drops its own entry instead of shifting every
    later paragraph's alignment (as the old positional delimiter format did).

    Returns:
        (user_prompt, system_instruction) tuple.
    """
    lang_name = _get_language_name(target_language)
    parts: list[str] = []

    parts.append(f"Translate each numbered paragraph to {lang_name}.")
    parts.append(
        "Return a JSON object mapping each paragraph's number (as a string) to its "
        "translation. Include every number exactly once; do not merge, split, "
        "reorder, or add paragraphs. Output only valid JSON, no markdown fences, "
        "no explanation."
    )

    parts.append("\nParagraphs:")
    for i, paragraph in enumerate(paragraphs):
        parts.append(f'  "{i}": "{paragraph}"')

    system = _build_system_instruction(member_name, group_name, "blog post")
    return "\n".join(parts), system


def validate_placeholder_count(original: str, translated: str) -> bool:
    original_count = len(_PLACEHOLDER_RE.findall(original))
    translated_count = len(_PLACEHOLDER_RE.findall(translated))
    return original_count == translated_count
