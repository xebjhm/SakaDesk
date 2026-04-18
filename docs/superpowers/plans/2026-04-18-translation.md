# Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline AI-powered translation for Japanese blog posts and messages, with provider abstraction (Gemini, OpenAI), hover-translate and global toggle modes, and localStorage caching.

**Architecture:** Backend translation service with provider abstraction mirrors the existing transcription pattern. Three REST endpoints handle single message, batch message, and blog translation. Frontend uses a `useMessageTranslation` hook with localStorage caching, a `TranslateButton` hover component, and an `InlineTranslation` display component. Settings UI lets users configure their own provider/API key.

**Tech Stack:** Python/FastAPI (backend), React/TypeScript/Zustand (frontend), httpx (API calls to LLM providers), localStorage (translation cache)

---

## File Map

### Backend (New)

| File | Responsibility |
|------|----------------|
| `backend/services/translation_service.py` | `TranslationProvider` ABC, `GeminiProvider`, `OpenAIProvider`, prompt construction, `%%%` placeholder handling |
| `backend/api/translation.py` | REST endpoints: translate, translate-batch, translate-blog, configure, test-connection |
| `backend/tests/test_translation_service.py` | Unit tests for providers, prompt construction, `%%%` handling |
| `backend/tests/test_translation_api.py` | API endpoint tests (route registration, validation, error cases) |

### Backend (Modified)

| File | Change |
|------|--------|
| `backend/main.py` | Import and register translation router |
| `backend/services/settings_store.py` | Add translation defaults to `_SETTINGS_DEFAULTS` |

### Frontend (New)

| File | Responsibility |
|------|----------------|
| `frontend/src/hooks/useMessageTranslation.ts` | Hook for triggering translation, managing localStorage cache, loading states |
| `frontend/src/core/common/TranslateButton.tsx` | Hover translate pill button (globe icon) |
| `frontend/src/core/common/InlineTranslation.tsx` | Translation display with dashed-border (messages) and left-border (blogs) variants |

### Frontend (Modified)

| File | Change |
|------|--------|
| `frontend/src/features/messages/components/MessageBubble.tsx` | Add TranslateButton on hover, InlineTranslation below text content |
| `frontend/src/features/blogs/components/BlogReader.tsx` | Add TranslateButton on paragraph hover, InlineTranslation below paragraphs |
| `frontend/src/shell/components/SettingsModal.tsx` | Add TranslationSettingsSection component |
| `frontend/src/store/appStore.ts` | Add translation global toggle state |
| `frontend/src/features/messages/MessagesFeature.tsx` | Add translation settings to AppSettings interface |
| `frontend/src/i18n/locales/en.json` | Add translation i18n keys |
| `frontend/src/i18n/locales/ja.json` | Add translation i18n keys |
| `frontend/src/i18n/locales/zh-TW.json` | Add translation i18n keys |
| `frontend/src/i18n/locales/zh-CN.json` | Add translation i18n keys |
| `frontend/src/i18n/locales/yue.json` | Add translation i18n keys |

---

## Task 1: Backend Translation Service — Provider Abstraction and Prompt Construction

**Files:**
- Create: `backend/services/translation_service.py`
- Test: `backend/tests/test_translation_service.py`

- [ ] **Step 1: Write failing tests for TranslationProvider ABC and prompt construction**

```python
# backend/tests/test_translation_service.py
import pytest

from backend.services.translation_service import (
    TranslationProvider,
    GeminiProvider,
    OpenAIProvider,
    build_translation_prompt,
    build_batch_translation_prompt,
    validate_placeholder_count,
)


class TestTranslationProviderInterface:
    """Verify the ABC contract."""

    def test_cannot_instantiate_abc(self):
        with pytest.raises(TypeError):
            TranslationProvider()  # type: ignore[abstract]

    def test_gemini_provider_is_subclass(self):
        assert issubclass(GeminiProvider, TranslationProvider)

    def test_openai_provider_is_subclass(self):
        assert issubclass(OpenAIProvider, TranslationProvider)


class TestPromptConstruction:
    """Test translation prompt building."""

    def test_single_message_prompt_includes_target_language(self):
        prompt = build_translation_prompt(
            text="こんにちは",
            target_language="en",
        )
        assert "English" in prompt or "en" in prompt
        assert "こんにちは" in prompt

    def test_single_message_prompt_with_context(self):
        prompt = build_translation_prompt(
            text="ありがとう",
            target_language="en",
            context_texts=["こんにちは", "元気ですか"],
        )
        assert "ありがとう" in prompt
        assert "こんにちは" in prompt

    def test_prompt_includes_placeholder_instruction_when_present(self):
        prompt = build_translation_prompt(
            text="%%%さん、こんにちは",
            target_language="en",
        )
        assert "%%%" in prompt
        # Should contain instruction about keeping %%% as-is
        assert "placeholder" in prompt.lower() or "%%%" in prompt

    def test_prompt_no_placeholder_instruction_when_absent(self):
        prompt = build_translation_prompt(
            text="こんにちは",
            target_language="en",
        )
        # Should not mention placeholder handling when text has no %%%
        assert "placeholder" not in prompt.lower()

    def test_batch_prompt_includes_all_messages(self):
        prompt = build_batch_translation_prompt(
            texts={"1": "おはよう", "2": "こんにちは", "3": "こんばんは"},
            target_language="en",
        )
        assert "おはよう" in prompt
        assert "こんにちは" in prompt
        assert "こんばんは" in prompt


class TestPlaceholderValidation:
    """Test %%% placeholder count validation."""

    def test_matching_count_returns_true(self):
        assert validate_placeholder_count(
            "%%%さん、こんにちは%%%",
            "%%%, hello %%%"
        ) is True

    def test_mismatching_count_returns_false(self):
        assert validate_placeholder_count(
            "%%%さん、こんにちは%%%",
            "hello there"
        ) is False

    def test_no_placeholders_returns_true(self):
        assert validate_placeholder_count(
            "こんにちは",
            "hello"
        ) is True

    def test_fullwidth_placeholders_counted(self):
        assert validate_placeholder_count(
            "％％％さん",
            "%%% dear"
        ) is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest backend/tests/test_translation_service.py -v`
Expected: FAIL — `ImportError: cannot import name 'TranslationProvider'`

- [ ] **Step 3: Implement translation_service.py**

```python
# backend/services/translation_service.py
"""
Translation service for SakaDesk.

Provides AI-powered Japanese-to-target-language translation using cloud LLM APIs,
with a provider abstraction for multiple backends (Gemini, OpenAI).

Translations are cached client-side in localStorage — no server-side storage.
"""

import json
import re
import structlog
from abc import ABC, abstractmethod
from typing import Optional

import httpx

logger = structlog.get_logger(__name__)

# Maps target language codes to display names for prompt construction
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "ja": "Japanese",
    "zh-TW": "Traditional Chinese",
    "zh-CN": "Simplified Chinese",
    "yue": "Cantonese",
}

# %%% placeholder pattern — matches both ASCII and fullwidth variants
_PLACEHOLDER_RE = re.compile(r"%%%|％％％")


class TranslationProvider(ABC):
    """Abstract base for translation engines."""

    @abstractmethod
    async def translate(self, prompt: str) -> str:
        """Send a translation prompt and return the raw response text."""
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Check if the provider is ready (API key valid, etc.)."""
        ...


class GeminiProvider(TranslationProvider):
    """Google Gemini translation provider."""

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash-lite"):
        self._api_key = api_key
        self._model = model

    async def translate(self, prompt: str) -> str:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.3},
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                params={"key": self._api_key},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["candidates"][0]["content"]["parts"][0]["text"]

    async def is_available(self) -> bool:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{self._model}"
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params={"key": self._api_key})
                return resp.status_code == 200
        except Exception:
            return False


class OpenAIProvider(TranslationProvider):
    """OpenAI translation provider."""

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self._api_key = api_key
        self._model = model

    async def translate(self, prompt: str) -> str:
        url = "https://api.openai.com/v1/chat/completions"
        payload = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": "You are a precise Japanese translator. Output only the translation, no explanations."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
        }
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def is_available(self) -> bool:
        try:
            url = "https://api.openai.com/v1/models"
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
                return resp.status_code == 200
        except Exception:
            return False


def _get_language_name(code: str) -> str:
    return LANGUAGE_NAMES.get(code, code)


def _has_placeholders(text: str) -> bool:
    return bool(_PLACEHOLDER_RE.search(text))


def build_translation_prompt(
    text: str,
    target_language: str,
    context_texts: Optional[list[str]] = None,
) -> str:
    """Build a translation prompt for a single text item.

    Args:
        text: The Japanese text to translate.
        target_language: Target language code (e.g., "en").
        context_texts: Optional surrounding messages for context (not translated).
    """
    lang_name = _get_language_name(target_language)
    parts: list[str] = []

    parts.append(f"Translate the following Japanese text to {lang_name}.")
    parts.append("Output only the translation, nothing else.")

    if _has_placeholders(text):
        parts.append(
            "The text contains %%% which is a placeholder for the reader's name. "
            "Keep %%% exactly as-is in the translation. Do not translate or modify it."
        )

    if context_texts:
        parts.append("\n--- Context (do NOT translate, for reference only) ---")
        for ctx in context_texts:
            parts.append(ctx)
        parts.append("--- End context ---\n")

    parts.append(f"\nText to translate:\n{text}")

    return "\n".join(parts)


def build_batch_translation_prompt(
    texts: dict[str, str],
    target_language: str,
) -> str:
    """Build a batch translation prompt for multiple messages.

    Args:
        texts: Dict mapping message ID (as string) to Japanese text.
        target_language: Target language code (e.g., "en").

    Returns:
        Prompt string. Response should be valid JSON: {"id": "translation", ...}
    """
    lang_name = _get_language_name(target_language)
    has_pct = any(_has_placeholders(t) for t in texts.values())

    parts: list[str] = []
    parts.append(f"Translate each of the following Japanese messages to {lang_name}.")
    parts.append(
        "Return a JSON object mapping each ID to its translation. "
        "Output only valid JSON, no markdown fences, no explanation."
    )

    if has_pct:
        parts.append(
            "Some messages contain %%% which is a placeholder for the reader's name. "
            "Keep %%% exactly as-is in all translations."
        )

    parts.append("\nMessages:")
    for msg_id, text in texts.items():
        parts.append(f'  "{msg_id}": "{text}"')

    return "\n".join(parts)


def validate_placeholder_count(original: str, translated: str) -> bool:
    """Check that the translated text has the same number of %%% placeholders as the original.

    Counts both ASCII (%%%) and fullwidth (％％％) variants together.
    """
    original_count = len(_PLACEHOLDER_RE.findall(original))
    translated_count = len(_PLACEHOLDER_RE.findall(translated))
    return original_count == translated_count
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest backend/tests/test_translation_service.py -v`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/translation_service.py backend/tests/test_translation_service.py
git commit -m "feat(translation): add translation service with provider abstraction and prompt construction"
```

---

## Task 2: Backend Translation API Endpoints

**Files:**
- Create: `backend/api/translation.py`
- Modify: `backend/main.py:46-62` (import), `backend/main.py:184-186` (router registration)
- Modify: `backend/services/settings_store.py:27-36` (defaults)
- Modify: `frontend/src/features/messages/MessagesFeature.tsx:54-65` (AppSettings)
- Test: `backend/tests/test_translation_api.py`

- [ ] **Step 1: Add translation settings defaults**

In `backend/services/settings_store.py`, add to `_SETTINGS_DEFAULTS`:

```python
_SETTINGS_DEFAULTS: dict[str, Any] = {
    "auto_sync_enabled": True,
    "sync_interval_minutes": 15,
    "adaptive_sync_enabled": True,
    "is_configured": False,
    "notifications_enabled": True,
    "blogs_full_backup": False,
    "auto_download_updates": False,
    "transcription_device": "cpu",  # "cpu" or "cuda"
    "translation_provider": None,  # "gemini" or "openai"
    "translation_model": None,  # e.g., "gemini-2.5-flash-lite", "gpt-4o-mini"
    "translation_api_key": None,  # User's API key
    "translation_target_language": None,  # Defaults to UI language at runtime
}
```

- [ ] **Step 2: Write failing tests for translation API**

```python
# backend/tests/test_translation_api.py
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_translation_routes_registered():
    """Translation configure endpoint should be accessible."""
    response = client.post(
        "/api/translation/configure",
        json={
            "provider": "gemini",
            "model": "gemini-2.5-flash-lite",
            "api_key": "test-key",
            "target_language": "en",
        },
    )
    # Should succeed (saves config)
    assert response.status_code == 200


def test_translate_requires_fields():
    """POST /api/translation/translate requires all fields."""
    response = client.post("/api/translation/translate", json={})
    assert response.status_code == 422


def test_translate_batch_requires_fields():
    """POST /api/translation/translate-batch requires all fields."""
    response = client.post("/api/translation/translate-batch", json={})
    assert response.status_code == 422


def test_translate_blog_requires_fields():
    """POST /api/translation/translate-blog requires all fields."""
    response = client.post("/api/translation/translate-blog", json={})
    assert response.status_code == 422


def test_translate_rejects_unconfigured_provider():
    """Translation should fail when no provider is configured."""
    # First clear any config
    client.post(
        "/api/translation/configure",
        json={
            "provider": None,
            "model": None,
            "api_key": None,
            "target_language": "en",
        },
    )
    response = client.post(
        "/api/translation/translate",
        json={
            "type": "message",
            "message_id": 1,
            "service": "hinatazaka46",
            "member_path": "日向坂46/messages/34 金村 美玖/58 金村 美玖",
            "target_language": "en",
        },
    )
    assert response.status_code == 400
    assert "provider" in response.json()["detail"].lower()
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest backend/tests/test_translation_api.py -v`
Expected: FAIL — routes not registered

- [ ] **Step 4: Implement translation API**

Create `backend/api/translation.py` with the following endpoints:

- `POST /configure` — Save provider configuration to settings.json
- `POST /test-connection` — Validate API key by calling provider's `is_available()`
- `POST /translate` — Single message or blog paragraph translation (loads message from messages.json, builds prompt with context, calls provider)
- `POST /translate-batch` — Batch translate multiple messages (for global toggle mode, returns JSON dict of id→translation)
- `POST /translate-blog` — Full blog translation (loads blog HTML from cache, parses paragraphs, returns indexed translations)

All endpoints use `_get_provider_from_config()` to instantiate the correct provider from settings. Error handling: 429 for rate limits, 502 for provider errors, 400 for missing config. The `%%%` placeholder validation logs warnings via structlog but still returns the translation.

See the full implementation in the spec's Backend API section for request/response schemas. Key implementation details:
- Uses `validate_service()` and `validate_path_within_dir()` for security (same pattern as transcription API)
- Messages loaded from `messages.json` via `member_path` (same as transcription)
- Blog content loaded from `{service}/blogs/cache/{blog_id}.json`
- Batch responses parsed as JSON, with markdown fence stripping for LLM quirks
- `httpx.HTTPStatusError` caught separately to handle 429 rate limits

- [ ] **Step 5: Register translation router in main.py**

In `backend/main.py`, add `translation` to the import list and register the router:

```python
app.include_router(
    translation.router, prefix="/api/translation", tags=["translation"]
)
```

- [ ] **Step 6: Add translation fields to AppSettings interface**

In `frontend/src/features/messages/MessagesFeature.tsx`, add to `AppSettings`:

```typescript
translation_provider?: string | null;
translation_model?: string | null;
translation_api_key?: string | null;
translation_target_language?: string | null;
```

- [ ] **Step 7: Run API tests to verify they pass**

Run: `uv run pytest backend/tests/test_translation_api.py -v`
Expected: All 5 tests PASS

- [ ] **Step 8: Commit**

```bash
git add backend/api/translation.py backend/main.py backend/services/settings_store.py backend/tests/test_translation_api.py frontend/src/features/messages/MessagesFeature.tsx
git commit -m "feat(translation): add translation API endpoints, settings defaults, and route registration"
```

---

## Task 3: Frontend i18n — Add Translation Keys to All 5 Locales

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/i18n/locales/zh-TW.json`
- Modify: `frontend/src/i18n/locales/zh-CN.json`
- Modify: `frontend/src/i18n/locales/yue.json`

- [ ] **Step 1: Add translation keys to en.json**

Add after the `"transcription"` section:

```json
"translation": {
    "translate": "Translate",
    "translating": "Translating...",
    "settings": {
        "title": "Translation",
        "provider": "Provider",
        "model": "Model",
        "apiKey": "API Key",
        "testConnection": "Test Connection",
        "testSuccess": "Connection successful",
        "testFailed": "Connection failed",
        "targetLanguage": "Target Language",
        "globalMessages": "Translate all messages",
        "globalBlogs": "Translate all blog posts",
        "experimental": "Experimental",
        "clearCache": "Clear Translation Cache",
        "cacheClearedMsg": "Translation cache cleared"
    },
    "error": {
        "noProvider": "Please configure a translation provider in settings",
        "failed": "Translation failed",
        "rateLimited": "Rate limit reached, try again later"
    },
    "dataPolicy": {
        "geminiFree": "Free tier: data may be used by Google to improve products",
        "geminiPaid": "Paid tier: data not used for training",
        "openai": "API data not used for training"
    }
}
```

- [ ] **Step 2: Add translation keys to ja.json**

```json
"translation": {
    "translate": "翻訳",
    "translating": "翻訳中...",
    "settings": {
        "title": "翻訳",
        "provider": "プロバイダー",
        "model": "モデル",
        "apiKey": "APIキー",
        "testConnection": "接続テスト",
        "testSuccess": "接続成功",
        "testFailed": "接続失敗",
        "targetLanguage": "翻訳先の言語",
        "globalMessages": "すべてのメッセージを翻訳",
        "globalBlogs": "すべてのブログ記事を翻訳",
        "experimental": "実験的機能",
        "clearCache": "翻訳キャッシュをクリア",
        "cacheClearedMsg": "翻訳キャッシュをクリアしました"
    },
    "error": {
        "noProvider": "設定で翻訳プロバイダーを設定してください",
        "failed": "翻訳に失敗しました",
        "rateLimited": "レート制限に達しました。後でもう一度お試しください"
    },
    "dataPolicy": {
        "geminiFree": "無料枠：データがGoogleの製品改善に使用される場合があります",
        "geminiPaid": "有料枠：データはトレーニングに使用されません",
        "openai": "APIデータはトレーニングに使用されません"
    }
}
```

- [ ] **Step 3: Add translation keys to zh-TW.json**

```json
"translation": {
    "translate": "翻譯",
    "translating": "翻譯中...",
    "settings": {
        "title": "翻譯",
        "provider": "服務提供者",
        "model": "模型",
        "apiKey": "API 金鑰",
        "testConnection": "測試連線",
        "testSuccess": "連線成功",
        "testFailed": "連線失敗",
        "targetLanguage": "目標語言",
        "globalMessages": "翻譯所有訊息",
        "globalBlogs": "翻譯所有部落格文章",
        "experimental": "實驗性功能",
        "clearCache": "清除翻譯快取",
        "cacheClearedMsg": "翻譯快取已清除"
    },
    "error": {
        "noProvider": "請在設定中配置翻譯服務提供者",
        "failed": "翻譯失敗",
        "rateLimited": "已達速率限制，請稍後再試"
    },
    "dataPolicy": {
        "geminiFree": "免費方案：資料可能被 Google 用於改善產品",
        "geminiPaid": "付費方案：資料不會用於訓練",
        "openai": "API 資料不會用於訓練"
    }
}
```

- [ ] **Step 4: Add translation keys to zh-CN.json**

```json
"translation": {
    "translate": "翻译",
    "translating": "翻译中...",
    "settings": {
        "title": "翻译",
        "provider": "服务提供商",
        "model": "模型",
        "apiKey": "API 密钥",
        "testConnection": "测试连接",
        "testSuccess": "连接成功",
        "testFailed": "连接失败",
        "targetLanguage": "目标语言",
        "globalMessages": "翻译所有消息",
        "globalBlogs": "翻译所有博客文章",
        "experimental": "实验性功能",
        "clearCache": "清除翻译缓存",
        "cacheClearedMsg": "翻译缓存已清除"
    },
    "error": {
        "noProvider": "请在设置中配置翻译服务提供商",
        "failed": "翻译失败",
        "rateLimited": "已达速率限制，请稍后再试"
    },
    "dataPolicy": {
        "geminiFree": "免费方案：数据可能被 Google 用于改善产品",
        "geminiPaid": "付费方案：数据不会用于训练",
        "openai": "API 数据不会用于训练"
    }
}
```

- [ ] **Step 5: Add translation keys to yue.json**

```json
"translation": {
    "translate": "翻譯",
    "translating": "翻譯緊...",
    "settings": {
        "title": "翻譯",
        "provider": "服務提供者",
        "model": "模型",
        "apiKey": "API 密鑰",
        "testConnection": "測試連接",
        "testSuccess": "連接成功",
        "testFailed": "連接失敗",
        "targetLanguage": "目標語言",
        "globalMessages": "翻譯所有訊息",
        "globalBlogs": "翻譯所有網誌文章",
        "experimental": "實驗性功能",
        "clearCache": "清除翻譯緩存",
        "cacheClearedMsg": "翻譯緩存已清除"
    },
    "error": {
        "noProvider": "請喺設定入面配置翻譯服務提供者",
        "failed": "翻譯失敗",
        "rateLimited": "已達速率限制，請遲啲再試"
    },
    "dataPolicy": {
        "geminiFree": "免費方案：數據可能俾 Google 用嚟改善產品",
        "geminiPaid": "付費方案：數據唔會用嚟訓練",
        "openai": "API 數據唔會用嚟訓練"
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/ja.json frontend/src/i18n/locales/zh-TW.json frontend/src/i18n/locales/zh-CN.json frontend/src/i18n/locales/yue.json
git commit -m "feat(translation): add i18n translation keys for all 5 locales"
```

---

## Task 4: Frontend — useMessageTranslation Hook with localStorage Caching

**Files:**
- Create: `frontend/src/hooks/useMessageTranslation.ts`

Note: The existing `useTranslation` from `../i18n` is the i18n hook. Our translation hook is named `useMessageTranslation` to avoid collision.

- [ ] **Step 1: Create the useMessageTranslation hook**

```typescript
// frontend/src/hooks/useMessageTranslation.ts
import { useState, useCallback } from 'react';

type TranslationState = 'idle' | 'loading' | 'done' | 'error';

interface UseMessageTranslationReturn {
    translation: string | null;
    state: TranslationState;
    trigger: () => Promise<void>;
    error: string | null;
    clear: () => void;
}

// localStorage cache key format: translation:{type}:{id}:{lang}
function getCacheKey(
    type: 'message' | 'blog_paragraph',
    contentId: string | number,
    targetLanguage: string,
): string {
    return `translation:${type}:${contentId}:${targetLanguage}`;
}

function getCachedTranslation(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function setCachedTranslation(key: string, translation: string): void {
    try {
        localStorage.setItem(key, translation);
    } catch {
        // localStorage full — silently ignore
    }
}

/**
 * Hook for translating a single message.
 * Manages localStorage cache and API calls.
 */
export function useMessageTranslation(params: {
    service: string | undefined;
    messageId: number | undefined;
    memberPath: string | undefined;
    targetLanguage: string;
    contextMessageIds?: number[];
}): UseMessageTranslationReturn {
    const { service, messageId, memberPath, targetLanguage, contextMessageIds } = params;

    const cacheKey = messageId
        ? getCacheKey('message', messageId, targetLanguage)
        : '';

    // Check cache on init
    const cached = cacheKey ? getCachedTranslation(cacheKey) : null;

    const [translation, setTranslation] = useState<string | null>(cached);
    const [state, setState] = useState<TranslationState>(cached ? 'done' : 'idle');
    const [error, setError] = useState<string | null>(null);

    const trigger = useCallback(async () => {
        if (!service || !messageId || !memberPath) return;

        // Check cache first
        const cachedValue = getCachedTranslation(cacheKey);
        if (cachedValue) {
            setTranslation(cachedValue);
            setState('done');
            return;
        }

        setState('loading');
        setError(null);

        try {
            const res = await fetch('/api/translation/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'message',
                    message_id: messageId,
                    service,
                    member_path: memberPath,
                    context_message_ids: contextMessageIds,
                    target_language: targetLanguage,
                }),
            });

            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.detail || `Request failed: ${res.status}`);
            }

            const data = await res.json();
            if (data.ok) {
                const translatedText = data.translation;
                setTranslation(translatedText);
                setState('done');
                setCachedTranslation(cacheKey, translatedText);
            } else {
                throw new Error('Translation returned not ok');
            }
        } catch (e) {
            setState('error');
            setError(e instanceof Error ? e.message : 'Translation failed');
        }
    }, [service, messageId, memberPath, targetLanguage, contextMessageIds, cacheKey]);

    const clear = useCallback(() => {
        setTranslation(null);
        setState('idle');
        setError(null);
    }, []);

    return { translation, state, trigger, error, clear };
}

/**
 * Batch translate multiple messages. Returns translations keyed by message ID.
 */
export async function translateBatch(params: {
    messageIds: number[];
    service: string;
    memberPath: string;
    targetLanguage: string;
}): Promise<Record<string, string>> {
    const { messageIds, service, memberPath, targetLanguage } = params;

    // Filter out already-cached messages
    const uncachedIds: number[] = [];
    const results: Record<string, string> = {};

    for (const id of messageIds) {
        const key = getCacheKey('message', id, targetLanguage);
        const cached = getCachedTranslation(key);
        if (cached) {
            results[String(id)] = cached;
        } else {
            uncachedIds.push(id);
        }
    }

    if (uncachedIds.length === 0) return results;

    const res = await fetch('/api/translation/translate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: 'messages',
            message_ids: uncachedIds,
            service,
            member_path: memberPath,
            target_language: targetLanguage,
        }),
    });

    if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Batch translation failed: ${res.status}`);
    }

    const data = await res.json();
    if (data.ok && data.translations) {
        for (const [id, text] of Object.entries(data.translations)) {
            results[id] = text as string;
            const key = getCacheKey('message', id, targetLanguage);
            setCachedTranslation(key, text as string);
        }
    }

    return results;
}

/**
 * Clear all translation cache entries from localStorage.
 */
export function clearTranslationCache(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('translation:')) {
            keysToRemove.push(key);
        }
    }
    for (const key of keysToRemove) {
        localStorage.removeItem(key);
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useMessageTranslation.ts
git commit -m "feat(translation): add useMessageTranslation hook with localStorage caching"
```

---

## Task 5: Frontend — TranslateButton and InlineTranslation Components

**Files:**
- Create: `frontend/src/core/common/TranslateButton.tsx`
- Create: `frontend/src/core/common/InlineTranslation.tsx`

- [ ] **Step 1: Create TranslateButton component**

```tsx
// frontend/src/core/common/TranslateButton.tsx
import React from 'react';
import { Loader2, Globe } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranslateButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    accentColor?: string;
}

export const TranslateButton: React.FC<TranslateButtonProps> = ({
    state,
    onClick,
    accentColor = '#6da0d4',
}) => {
    const { t } = useTranslation();

    if (state === 'done') return null;

    const isLoading = state === 'loading';

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (!isLoading) onClick();
            }}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors hover:opacity-80 disabled:cursor-wait"
            style={{
                borderColor: `${accentColor}40`,
                color: accentColor,
                background: `${accentColor}08`,
            }}
        >
            {isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
                <Globe className="w-3 h-3" />
            )}
            <span>
                {isLoading ? t('translation.translating') : t('translation.translate')}
            </span>
        </button>
    );
};
```

- [ ] **Step 2: Create InlineTranslation component**

```tsx
// frontend/src/core/common/InlineTranslation.tsx
import React from 'react';

interface InlineTranslationProps {
    translation: string;
    variant: 'message' | 'blog';
    accentColor?: string;
}

/**
 * Displays translated text inline.
 * - 'message' variant: dashed border separator inside message bubble
 * - 'blog' variant: left border accent bar below paragraph
 */
export const InlineTranslation: React.FC<InlineTranslationProps> = ({
    translation,
    variant,
    accentColor = '#6da0d4',
}) => {
    if (!translation) return null;

    if (variant === 'message') {
        return (
            <div
                className="mt-2 pt-2 text-[13px] leading-relaxed whitespace-pre-wrap"
                style={{
                    borderTop: `1px dashed ${accentColor}4D`,
                    color: accentColor,
                }}
            >
                {translation}
            </div>
        );
    }

    // Blog variant — left border accent
    return (
        <div
            className="mt-1 mb-3 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap"
            style={{
                borderLeft: `2px solid ${accentColor}4D`,
                color: accentColor,
            }}
        >
            {translation}
        </div>
    );
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/common/TranslateButton.tsx frontend/src/core/common/InlineTranslation.tsx
git commit -m "feat(translation): add TranslateButton and InlineTranslation UI components"
```

---

## Task 6: Frontend — Integrate Translation into MessageBubble

**Files:**
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`

- [ ] **Step 1: Add imports and translation hook to MessageBubble**

Add these imports at the top of `MessageBubble.tsx`:

```typescript
import { useMessageTranslation } from '../../../hooks/useMessageTranslation';
import { TranslateButton } from '../../../core/common/TranslateButton';
import { InlineTranslation } from '../../../core/common/InlineTranslation';
import { useAppStore } from '../../../store/appStore';
```

- [ ] **Step 2: Add translation state inside MessageBubbleComponent**

Inside `MessageBubbleComponent`, after the transcription hook setup (around line 211), add:

```typescript
// Translation — active for messages with text content
const hasTextContent = !!message.content && message.content.trim().length > 0;
const translationTargetLanguage = useAppStore(s => s.translationTargetLanguage) ?? 'en';
const {
    translation,
    state: translationState,
    trigger: triggerTranslation,
} = useMessageTranslation({
    service: hasTextContent && !isUnread ? service : undefined,
    messageId: hasTextContent && !isUnread ? message.id : undefined,
    memberPath: hasTextContent && !isUnread ? memberPath : undefined,
    targetLanguage: translationTargetLanguage,
});
```

- [ ] **Step 3: Add TranslateButton and InlineTranslation display**

Inside the message bubble, after the text content section (the `LinkifiedText` div around line 377) and before the "Fallback for missing content" section, add:

```tsx
{/* Translation */}
{hasTextContent && !isUnread && (
    <>
        {translationState !== 'done' && (
            <div className="mt-1">
                <TranslateButton
                    state={translationState}
                    onClick={triggerTranslation}
                    accentColor={theme?.voicePlayerAccent}
                />
            </div>
        )}
        {translation && (
            <InlineTranslation
                translation={translation}
                variant="message"
                accentColor={theme?.voicePlayerAccent}
            />
        )}
    </>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/messages/components/MessageBubble.tsx
git commit -m "feat(translation): integrate hover translate button and inline translation into MessageBubble"
```

---

## Task 7: Frontend — App Store Translation State

**Files:**
- Modify: `frontend/src/store/appStore.ts`

- [ ] **Step 1: Add translation state to AppState interface**

Add to the `AppState` interface after the `goldenFingerActive` section:

```typescript
// ─── Translation ──────────────────────────────────────────────────────
/** Target language for translations (defaults to UI language). */
translationTargetLanguage: string | null;
/** Set target language for translations. */
setTranslationTargetLanguage: (lang: string | null) => void;
/** Global translation toggle for messages. */
translationGlobalMessages: boolean;
/** Global translation toggle for blogs. */
translationGlobalBlogs: boolean;
/** Set global translation toggle for messages. */
setTranslationGlobalMessages: (enabled: boolean) => void;
/** Set global translation toggle for blogs. */
setTranslationGlobalBlogs: (enabled: boolean) => void;
```

- [ ] **Step 2: Add implementation in the store creator**

After the `setGoldenFingerActive` implementation:

```typescript
translationTargetLanguage: null,
setTranslationTargetLanguage: (lang) => set({ translationTargetLanguage: lang }),
translationGlobalMessages: false,
setTranslationGlobalMessages: (enabled) => set({ translationGlobalMessages: enabled }),
translationGlobalBlogs: false,
setTranslationGlobalBlogs: (enabled) => set({ translationGlobalBlogs: enabled }),
```

- [ ] **Step 3: Add to partialize for persistence**

Add to the `partialize` function return object:

```typescript
translationTargetLanguage: state.translationTargetLanguage,
translationGlobalMessages: state.translationGlobalMessages,
translationGlobalBlogs: state.translationGlobalBlogs,
```

- [ ] **Step 4: Bump store version to 5**

Change `version: 4` to `version: 5` in the persist config.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/appStore.ts
git commit -m "feat(translation): add translation toggle state to app store"
```

---

## Task 8: Frontend — Translation Settings Section in SettingsModal

**Files:**
- Modify: `frontend/src/shell/components/SettingsModal.tsx`

- [ ] **Step 1: Add TranslationSettingsSection component**

Add a `TranslationSettingsSection` function component at the bottom of `SettingsModal.tsx` (after `TranscriptionDeviceSection`). It receives `appSettings` and `onSaveSettings` as props.

The component contains:
- Provider dropdown (Gemini, OpenAI) with data policy note below
- Model dropdown (filtered by selected provider)
- API Key password input with "Test Connection" button
- Target Language dropdown (English, Japanese, Traditional Chinese, Simplified Chinese, Cantonese)
- "Clear Translation Cache" button
- Experimental badge next to the section title

Provider/model changes are saved via `POST /api/translation/configure`. Test Connection uses `POST /api/translation/test-connection`. Cache clear iterates localStorage keys starting with `translation:`.

The PROVIDERS list:
```typescript
const PROVIDERS = [
    { value: 'gemini', label: 'Google Gemini' },
    { value: 'openai', label: 'OpenAI' },
];

const MODELS: Record<string, { value: string; label: string }[]> = {
    gemini: [
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite ($0.10/M in)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash ($0.30/M in)' },
    ],
    openai: [
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini ($0.15/M in)' },
    ],
};
```

- [ ] **Step 2: Add TranslationSettingsSection to the modal**

In the `SettingsModal` component, after the Transcription section (around line 315), add:

```tsx
{/* Translation */}
<TranslationSettingsSection
    appSettings={appSettings}
    onSaveSettings={onSaveSettings}
/>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shell/components/SettingsModal.tsx
git commit -m "feat(translation): add translation settings section to SettingsModal"
```

---

## Task 9: Frontend — Integrate Translation into BlogReader

**Files:**
- Modify: `frontend/src/features/blogs/components/BlogReader.tsx`

- [ ] **Step 1: Add imports and state**

Add imports for `TranslateButton`, `InlineTranslation`, `useTranslation` (as `useI18n`), and `useAppStore`.

Add state inside BlogReader component:
```typescript
const translationTargetLanguage = useAppStore(s => s.translationTargetLanguage) ?? 'en';
const [blogTranslations, setBlogTranslations] = useState<Record<number, string>>({});
const [translatingParagraph, setTranslatingParagraph] = useState<number | null>(null);
const [hoveredParagraph, setHoveredParagraph] = useState<number | null>(null);
```

- [ ] **Step 2: Add paragraph translation handler**

```typescript
const handleTranslateParagraph = async (paragraphIndex: number, paragraphText: string) => {
    const cacheKey = `translation:blog_paragraph:${blog.id}_${paragraphIndex}:${translationTargetLanguage}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        setBlogTranslations(prev => ({ ...prev, [paragraphIndex]: cached }));
        return;
    }

    setTranslatingParagraph(paragraphIndex);
    try {
        const res = await fetch('/api/translation/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'blog_paragraph',
                service: serviceId,
                text: paragraphText,
                blog_html: content?.content.html ?? '',
                target_language: translationTargetLanguage,
            }),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.ok) {
                setBlogTranslations(prev => ({ ...prev, [paragraphIndex]: data.translation }));
                try { localStorage.setItem(cacheKey, data.translation); } catch { /* full */ }
            }
        }
    } catch {
        // User can retry
    } finally {
        setTranslatingParagraph(null);
    }
};
```

- [ ] **Step 3: Add useEffect for paragraph hover detection**

After the blog content renders, use a `useEffect` to attach mouseenter/mouseleave handlers to paragraph elements in the rendered HTML:

```typescript
useEffect(() => {
    const container = blogContentRef.current;
    if (!container || !content) return;

    const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4');
    const handlers: Array<{ el: Element; enter: () => void; leave: () => void }> = [];

    paragraphs.forEach((p, index) => {
        const text = p.textContent?.trim();
        if (!text) return;
        const enter = () => setHoveredParagraph(index);
        const leave = () => setHoveredParagraph(null);
        p.addEventListener('mouseenter', enter);
        p.addEventListener('mouseleave', leave);
        handlers.push({ el: p, enter, leave });
    });

    return () => {
        for (const { el, enter, leave } of handlers) {
            el.removeEventListener('mouseenter', enter);
            el.removeEventListener('mouseleave', leave);
        }
    };
}, [content, processedHtml]);
```

- [ ] **Step 4: Add useEffect to inject inline translations into rendered DOM**

```typescript
useEffect(() => {
    const container = blogContentRef.current;
    if (!container) return;

    // Remove previously injected translations
    container.querySelectorAll('.blog-translation-inline').forEach(el => el.remove());

    const paragraphs = container.querySelectorAll('p, h1, h2, h3, h4');
    for (const [indexStr, translationText] of Object.entries(blogTranslations)) {
        const index = parseInt(indexStr, 10);
        const el = paragraphs[index];
        if (!el || !translationText) continue;

        const translationDiv = document.createElement('div');
        translationDiv.className = 'blog-translation-inline';
        translationDiv.style.cssText = `
            margin-top: 4px;
            margin-bottom: 12px;
            padding-left: 12px;
            border-left: 2px solid ${oshiColor1}4D;
            color: ${oshiColor1};
            font-size: 13px;
            line-height: 1.6;
            white-space: pre-wrap;
        `;
        translationDiv.textContent = translationText;
        el.after(translationDiv);
    }
}, [blogTranslations, oshiColor1]);
```

- [ ] **Step 5: Add floating TranslateButton for hovered paragraphs**

After the blog content div, inside the article tag, add a floating translate button that positions itself near the hovered paragraph. Only show when: paragraph is hovered, not already translated, and not currently translating a different paragraph.

```tsx
{hoveredParagraph !== null && blogContentRef.current && (() => {
    const paragraphs = blogContentRef.current!.querySelectorAll('p, h1, h2, h3, h4');
    const el = paragraphs[hoveredParagraph] as HTMLElement | undefined;
    const text = el?.textContent?.trim();
    if (!el || !text || blogTranslations[hoveredParagraph]) return null;

    return (
        <div
            className="absolute right-8 z-20"
            style={{ top: el.offsetTop }}
            onMouseEnter={() => setHoveredParagraph(hoveredParagraph)}
            onMouseLeave={() => setHoveredParagraph(null)}
        >
            <TranslateButton
                state={translatingParagraph === hoveredParagraph ? 'loading' : 'idle'}
                onClick={() => handleTranslateParagraph(hoveredParagraph, text)}
                accentColor={oshiColor1}
            />
        </div>
    );
})()}
```

- [ ] **Step 6: Reset translations when blog changes**

```typescript
useEffect(() => {
    setBlogTranslations({});
    setTranslatingParagraph(null);
    setHoveredParagraph(null);
}, [blog.id]);
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/blogs/components/BlogReader.tsx
git commit -m "feat(translation): integrate hover translate and inline translation into BlogReader"
```

---

## Task 10: Add httpx Dependency

**Files:**
- Modify: `pyproject.toml` (via `uv add`)

- [ ] **Step 1: Add httpx**

Run: `uv add httpx`

The translation service uses `httpx` for async HTTP calls to LLM provider APIs (Gemini, OpenAI).

- [ ] **Step 2: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "feat(translation): add httpx dependency for LLM API calls"
```

---

## Task 11: Run Full Test Suite and Verify

- [ ] **Step 1: Run all backend tests**

Run: `uv run pytest backend/tests/ -v`
Expected: All tests PASS (existing + new translation tests)

- [ ] **Step 2: Run linting**

Run: `uv run ruff check backend/ --fix`
Expected: No errors

- [ ] **Step 3: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Start dev servers and test in browser**

Run backend: `uv run uvicorn backend.main:app --reload --port 18964`
Run frontend: `cd frontend && npm run dev`

**Manual test checklist:**
1. Open Settings — see Translation section with Experimental badge
2. Select provider (Gemini or OpenAI), enter API key, test connection
3. Open a message conversation — hover over a text message — see Translate button
4. Click Translate — see loading state — see translation appear with dashed border
5. Reload page — translation loads from cache instantly
6. Open a blog post — hover over a paragraph — see Translate button
7. Click Translate — see translation appear with left border accent
8. Clear Translation Cache in settings — translations disappear on reload

- [ ] **Step 5: Fix any issues found during testing**

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix(translation): address issues found during integration testing"
```
