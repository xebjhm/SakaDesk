# Feature 3: AI-Enabled Immersive Translation for Blogs and Messages

## Overview

Add inline translation for Japanese blog posts and messages, showing original text alongside translations. Powered by cloud LLM APIs with a provider abstraction for flexibility. Users choose their own provider and API key.

## Scope

- **Content**: Text messages and blog posts
- **Source language**: Japanese
- **Target language**: Defaults to app UI language, overridable in settings
- **Provider**: User-selected (Gemini, OpenAI, etc.) — no default pre-selected
- **Availability**: All users with a configured API key
- **Status**: Experimental (marked in settings)

## Tech Stack

### Translation Provider Abstraction

`TranslationProvider` interface — same pattern as transcription:

```typescript
interface TranslationProvider {
    translate(text: string, targetLang: string, context?: string[]): Promise<string>;
    translateBatch(texts: string[], targetLang: string): Promise<string[]>;
}
```

### Providers to Ship

| Provider | Model | Input / Output per 1M tokens | Notes |
|----------|-------|------------------------------|-------|
| Google Gemini | 2.5 Flash Lite | $0.10 / $0.40 | Cheapest. Free tier: 1,500 RPD (data may be used for training on free tier). |
| Google Gemini | 2.5 Flash | $0.30 / $2.50 | Better quality. Free tier available. |
| OpenAI | GPT-4o-mini | $0.15 / $0.60 | Proven JP quality. No data training on API usage. |

Future providers via abstraction: DeepL, Ollama/local models, Claude, GPT-4.1 Nano, etc.

### User Setup

User configures in settings:
1. Choose provider from dropdown
2. Enter their own API key
3. Select target language (defaults to UI language)

**No default provider selected** — user explicitly picks and enters their API key. The platform provides the options; the user decides and executes.

**Data privacy note**: Settings UI shows a brief informational note next to each provider about their data policy (e.g., "Free tier data may be used by Google to improve their products"). Informational only — user makes the decision.

## Translation Modes

### 1. Hover Translate (Single Message/Paragraph)

**When global toggle is OFF (default).**

- User hovers over a message bubble or blog paragraph
- A small "Translate" button appears (globe icon + text)
- Click triggers translation of that single item
- Translation appears inline below the original

**Context-aware translation for messages:**
When translating a single message, the API call includes ~5 surrounding messages as context (not translated — just sent for the LLM to understand references). Only the target message is translated and returned. This ensures quality without extra cost.

**Blog single-paragraph:**
When translating a single paragraph in a blog, the entire blog is sent as context but only the target paragraph is requested for translation. Slightly more input tokens, but much better quality — the LLM understands the full post context.

### 2. Global Toggle (Translate All)

**Separate toggles for messages and blogs.**

Both marked as **experimental** in settings.

**Messages (global toggle ON):**
- All visible messages in the viewport get translated in one batch API call (~10-20 messages)
- As user scrolls, new messages are lazily translated in batches (debounced ~300ms after scroll stops)
- Cached translations load instantly — no duplicate API calls
- Individual hover buttons hidden (everything is being translated)

**Blogs (global toggle ON):**
- Entire blog post translated in one API call (best quality, cheapest)
- Loading skeleton shown while translating
- All paragraphs show translations simultaneously when complete

**Keyboard shortcut**: `Ctrl+T` toggles the global toggle for the current context:
- In messages view → toggles messages global translation
- In blog reader view → toggles blogs global translation

**Toggle OFF**: Translations hide but stay in cache. Toggle back ON → cached translations reappear instantly.

## `%%%` Placeholder Handling

Messages may contain `%%%` (ASCII) or `％％％` (fullwidth) placeholders representing the user's nickname. These are replaced with the actual nickname at display time by the frontend.

**Translation prompt instruction:**
```
The text contains %%% which is a placeholder for the reader's name.
Keep %%% exactly as-is in the translation. Do not translate or modify it.
```

The frontend applies nickname replacement on both the original text and the translated text, so `%%%` works correctly in both.

## Caching

**Storage**: localStorage, keyed by `message_id + target_language + provider` (messages) or `blog_id + target_language + provider` (blogs).

**Cache behavior:**
- Cache hit → show translation instantly, no API call
- Cache miss → API call, cache result
- Cache shared between hover mode and global toggle mode (no duplicate work)
- User changes target language → cache miss (different key), fresh translation
- User changes provider → cache miss (different key), fresh translation
- Settings: "Clear translation cache" button to wipe all cached translations

**No speculative caching**: In hover mode, only the target message is translated and cached. Surrounding context messages are NOT translated — they're sent for quality context only.

## Presentation UX

### Messages: Dashed Border Style (Option A)

Translation appears below the original text inside the message bubble, separated by a dashed border in accent color.

```
┌─────────────────────────────────────┐
│ 今日はカフェでケーキ食べちゃった🍰    │
│ - - - - - - - - - - - - - - - - - - │
│ I had cake at a cafe today 🍰       │
│ So happy~                           │
└─────────────────────────────────────┘
```

- Translation text: accent color (service theme), slightly smaller font size
- Dashed border: accent color at 30% opacity
- Translation appears with a subtle fade-in animation

### Blogs: Left Border Accent Style (Option B)

Translation appears below each paragraph, indented with a left border bar.

```
みなさん、こんにちは！最近暑くなってきましたね。

│ Hello everyone! It's been getting hotter recently.
```

- Left border: 2px solid, accent color at 30% opacity
- Translation text: accent color, slightly smaller font, with left padding
- Applied per-paragraph for natural reading flow

### Hover Translate Button

- Small pill button: globe icon + "Translate" text
- Appears on hover, positioned at top-right of the message bubble or paragraph
- Disappears when global toggle is ON
- Loading state: button becomes a spinner during API call

## Blog Translation Flow

1. **Single paragraph (hover)**: Send full blog as context, request translation of target paragraph only. Return and display inline.
2. **Global toggle ON**: Send entire blog in one API call, request all paragraphs translated. Return structured response mapping each paragraph to its translation. Display all inline simultaneously.

**Blog API call structure:**
```json
{
    "blog_html": "<full blog content>",
    "target_language": "en",
    "mode": "full"
}
```

Backend parses the blog HTML into paragraphs, sends to LLM with instructions to translate each paragraph and return a structured mapping. Frontend receives paragraph-indexed translations and inserts them inline.

## Message Translation Flow

### Single Message (Hover)

1. User clicks translate on message #42
2. Frontend sends to backend: `{ message_id: 42, context_message_ids: [39, 40, 41, 43, 44] }`
3. Backend loads message content, builds prompt with context
4. LLM translates only the target message
5. Frontend receives translation, caches in localStorage, displays inline

### Batch (Global Toggle ON)

1. Global toggle turned ON
2. Frontend collects visible message IDs in viewport
3. Filters out already-cached messages
4. Sends uncached IDs to backend: `{ message_ids: [35, 36, 37, 38, 39, 40, ...], target_language: "en" }`
5. Backend batches messages, sends to LLM in one call
6. Frontend receives translations, caches all, displays inline
7. On scroll: debounce 300ms, repeat for new visible messages

## Backend API

### `POST /api/translation/translate`

Single message or paragraph translation.

**Request:**
```json
{
    "type": "message",
    "message_id": 42,
    "service": "hinatazaka46",
    "member_path": "...",
    "context_message_ids": [39, 40, 41, 43, 44],
    "target_language": "en"
}
```

**Response:**
```json
{
    "ok": true,
    "translation": "I had cake at a cafe today 🍰 So happy~"
}
```

### `POST /api/translation/translate-batch`

Batch translation for global toggle mode.

**Request:**
```json
{
    "type": "messages",
    "message_ids": [35, 36, 37, 38, 39, 40],
    "service": "hinatazaka46",
    "member_path": "...",
    "target_language": "en"
}
```

**Response:**
```json
{
    "ok": true,
    "translations": {
        "35": "Good morning!",
        "36": "Yesterday's concert was the best!",
        "37": "...",
    }
}
```

### `POST /api/translation/translate-blog`

Blog translation.

**Request:**
```json
{
    "blog_id": "abc123",
    "service": "hinatazaka46",
    "target_language": "en",
    "mode": "full"
}
```

**Response:**
```json
{
    "ok": true,
    "translations": [
        { "index": 0, "original": "みなさん、こんにちは！", "translation": "Hello everyone!" },
        { "index": 1, "original": "先日...", "translation": "The other day..." }
    ]
}
```

### `POST /api/translation/configure`

Save provider configuration.

**Request:**
```json
{
    "provider": "gemini",
    "model": "gemini-2.5-flash-lite",
    "api_key": "...",
    "target_language": "en"
}
```

## Settings UI

### Translation Settings Section

- **Provider**: Dropdown (Gemini, OpenAI). Each option shows a brief data policy note.
- **Model**: Dropdown filtered by provider (e.g., Gemini → Flash Lite, Flash)
- **API Key**: Password input field with test button ("Test Connection")
- **Target Language**: Dropdown defaulting to current UI language. Options: English, Japanese, Traditional Chinese, Simplified Chinese, Cantonese.
- **Global Toggle — Messages**: Switch (experimental badge). Keyboard shortcut: Ctrl+T in messages view.
- **Global Toggle — Blogs**: Switch (experimental badge). Keyboard shortcut: Ctrl+T in blog reader view.
- **Clear Translation Cache**: Button to wipe localStorage cache.

## i18n

New keys across all 5 locales:

| Key | Purpose |
|-----|---------|
| `translation.translate` | "Translate" button label |
| `translation.translating` | "Translating..." loading state |
| `translation.settings.title` | "Translation" settings section header |
| `translation.settings.provider` | "Provider" label |
| `translation.settings.model` | "Model" label |
| `translation.settings.apiKey` | "API Key" label |
| `translation.settings.testConnection` | "Test Connection" button |
| `translation.settings.targetLanguage` | "Target Language" label |
| `translation.settings.globalMessages` | "Translate all messages" toggle label |
| `translation.settings.globalBlogs` | "Translate all blog posts" toggle label |
| `translation.settings.experimental` | "Experimental" badge |
| `translation.settings.clearCache` | "Clear Translation Cache" button |
| `translation.error.noProvider` | "Please configure a translation provider in settings" |
| `translation.error.failed` | "Translation failed" |
| `translation.error.rateLimited` | "Rate limit reached, try again later" |
| `translation.dataPolicy.geminiFree` | "Free tier: data may be used by Google to improve products" |
| `translation.dataPolicy.geminiPaid` | "Paid tier: data not used for training" |
| `translation.dataPolicy.openai` | "API data not used for training" |

## Error Handling

- **No provider configured**: Toast "Please configure a translation provider in settings" with link to settings
- **Invalid API key**: "Test Connection" button shows error. Translation attempts show toast error.
- **Rate limited (429)**: Toast with "Rate limit reached, try again later". Respect retry-after header.
- **API error (500, network)**: Toast "Translation failed". Hover button returns to clickable state (retryable).
- **Empty content**: Skip translation for empty/media-only messages.
- **`%%%` mangled by LLM**: Validate response contains same number of `%%%` as input. If not, show original `%%%` count warning in logs (structlog), display translation anyway.

## Files Changed

### Backend (New)
| File | Purpose |
|------|---------|
| `backend/services/translation_service.py` | TranslationProvider interface, GeminiProvider, OpenAIProvider, prompt construction, `%%%` handling |
| `backend/api/translation.py` | REST endpoints: translate, translate-batch, translate-blog, configure |

### Backend (Modified)
| File | Change |
|------|--------|
| `backend/main.py` | Register translation routes |
| `backend/services/settings_store.py` | Store translation provider config (provider, model, API key encrypted, target language) |

### Frontend (New)
| File | Purpose |
|------|---------|
| `frontend/src/hooks/useTranslation.ts` | Hook for triggering translation, managing cache, loading states |
| `frontend/src/core/common/TranslateButton.tsx` | Hover translate button component (globe icon pill) |
| `frontend/src/core/common/InlineTranslation.tsx` | Inline translation display component (dashed border style for messages, left border for blogs) |

### Frontend (Modified)
| File | Change |
|------|--------|
| `frontend/src/features/messages/components/MessageBubble.tsx` | Add TranslateButton on hover, InlineTranslation below text content |
| `frontend/src/features/blogs/components/BlogReader.tsx` | Add TranslateButton on paragraph hover, InlineTranslation below each paragraph |
| `frontend/src/core/modals/SettingsModal.tsx` | Add translation settings section (provider, API key, toggles) |
| `frontend/src/store/appStore.ts` | Add translation global toggle states (messages, blogs), target language |
| `frontend/src/i18n/locales/*.json` | Add translation keys (all 5 locales) |

## Out of Scope

- Local/offline translation models (Ollama) — future via provider abstraction
- Translation of image text (OCR) in blogs or messages
- Translation history/export
- Collaborative translation corrections
- Translation for voice/video transcriptions (could chain transcription → translation later)
- DeepL provider (future)
- Auto-detect source language (hardcoded to Japanese for now)
