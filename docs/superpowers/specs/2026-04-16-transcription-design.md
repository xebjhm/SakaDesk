# Feature 2: Japanese Audio Transcription for Voice and Video

## Overview

Add local-first Japanese audio transcription for voice messages and video, with timeline-synced display, background batch processing for future chatbot corpus, and search integration. Designed with a provider abstraction to support cloud APIs in the future.

## Scope

- **Media types**: Voice messages and video messages
- **Language**: Japanese only (initial release)
- **Engine**: Local `faster-whisper` with `medium` model (configurable)
- **Availability**: All users (not gated behind golden finger)
- **Platform**: Windows primary, architecture supports cross-platform

## Tech Stack

### Transcription Engine

- **Library**: `faster-whisper` (CTranslate2-based, fast CPU/GPU inference)
- **Model**: `medium` (1.5GB, good Japanese accuracy for casual speech)
- **Provider abstraction**: `TranscriptionProvider` interface so the engine is pluggable:
  - `LocalWhisperProvider` (ships first)
  - Future: `OpenAIWhisperProvider`, `GoogleSTTProvider`, etc.
- **Model isolation**: Model path and provider type configured in settings. Switching model or provider requires zero code changes — config only.

### New Dependencies

- `faster-whisper` — added via `uv add faster-whisper`
- CTranslate2 model files — downloaded on first use, stored in app data directory (`~/.SakaDesk/models/`)

## Transcription Data

### Storage: JSON sidecar (primary) + SQLite index (search)

Follows the existing pattern: JSON files as source of truth, SQLite for search.

**JSON file** — stored per-member alongside messages:
```
[Service]/messages/[Group]/[Member]/
  messages.json          (existing)
  transcriptions.json    (NEW — all transcripts for this member)
```

**Transcription format** (`transcriptions.json`):
```json
{
  "version": 1,
  "transcriptions": [
    {
      "message_id": 12345,
      "media_type": "voice",
      "language": "ja",
      "model": "faster-whisper-medium",
      "created_at": "2026-04-16T12:00:00Z",
      "duration_seconds": 58.2,
      "full_text": "おはようございます。今日はお休みの日なので...",
      "segments": [
        {
          "start": 0.0,
          "end": 2.8,
          "text": "おはようございます。",
          "confidence": 0.94
        },
        {
          "start": 3.1,
          "end": 7.2,
          "text": "今日はお休みの日なので、",
          "confidence": 0.91
        }
      ]
    }
  ]
}
```

**Key fields:**
- `version` — schema evolution
- `model` — tracks what generated each transcript (enables re-transcription with better models)
- `segments[].start/end` — float seconds for timeline-synced UI
- `segments[].confidence` — per-segment reliability score
- `full_text` — pre-joined for easy indexing

### SQLite Integration (search_index.db)

**Schema migration required** — add `type` column to `search_messages`:

```sql
ALTER TABLE search_messages ADD COLUMN type TEXT DEFAULT 'text';
```

- Existing rows get `'text'` as default (correct — currently only text messages are indexed)
- During index build, populate `type` from message data (`text`, `picture`, `video`, `voice`)
- When transcription is saved, UPDATE the row's `content` and `content_normalized` with transcript text
- FTS5 index updates automatically via existing triggers

**No new tables** — voice/video messages enrich existing `search_messages` rows rather than creating a parallel index.

**Migration safety**: Detect old schema (missing `type` column), run ALTER TABLE, trigger re-index to populate types for existing rows.

## Processing Architecture

### Two-Layer Strategy

**1. On-demand (foreground, high priority)**
- User clicks "Transcribe" button on a specific message
- Immediately queued at HIGH priority — jumps ahead of batch queue
- UI shows loading spinner, then transcript appears when done
- Result cached — subsequent views load from JSON, no re-computation

**2. Background pipeline (low priority)**
- After each sync, new voice/video messages are queued for transcription
- Processed during idle time, throttled to avoid hogging CPU
- Pausable/cancellable if user notices performance impact
- Silently builds corpus for future chatbot

### Priority Queue

```
[HIGH] On-demand user requests — immediate processing
[LOW]  Background batch — idle-time processing, throttled
```

On-demand requests always preempt batch processing. A single transcription worker processes the queue, switching to high-priority items immediately when they arrive.

### Backend API

**`POST /api/transcription/transcribe`** — On-demand transcription
- Request: `{ "message_id": number, "service": string, "member_path": string }`
- Response: `{ "ok": true, "transcription": { ...transcript data } }`
- Enqueues at high priority, waits for result, returns transcript

**`GET /api/transcription/status`** — Background pipeline status
- Response: `{ "queue_size": number, "processing": boolean, "current_message_id": number | null }`

**`GET /api/transcription/{service}/{message_id}`** — Get cached transcript
- Returns cached transcript if exists, 404 if not yet transcribed

## Frontend UX

### 1. Message Bubble (Inline Chat)

**Layout: Option B — Outside bubble as attached footer**

- **Before transcription**: Subtle "Transcribe" button as attached footer below the message bubble, with accent color border. Available for voice and video messages.
- **During transcription**: Button replaced with loading spinner + "Transcribing..." text
- **After transcription**: Collapsible transcript panel below bubble
  - Collapsed by default in chat view
  - Toggle "▶ Transcript" / "▼ Transcript"
  - When expanded: timeline-synced segments with timestamps
  - Active segment highlighted during playback
  - Click timestamp to seek audio/video to that point
  - Auto-scroll to keep active segment visible

### 2. Full-Screen Viewer (MediaViewerModal)

**Integrates into existing layout — no redesign.**

**Voice (premium VoicePlayer, w-96 centered):**
- "Transcribe" button appears below the existing player card
- Once transcribed, replaced by collapsible transcript panel below player
- Panel matches the dark overlay aesthetic (rgba backgrounds, white/muted text)
- Active segment highlighted, click-to-seek, auto-scroll

**Video (VideoPlayer with viewerMode):**
- Subtitle overlay on video (semi-transparent black bar at bottom with white text)
- "CC" toggle button in video controls bar to show/hide subtitles
- "Transcribe" button below video area
- Collapsible transcript panel below video
- Both subtitle overlay and transcript panel sync with playback

### 3. Media Gallery (MediaGalleryModal — Voice Tab)

**List items:**
- One-line transcript preview below member name (truncated with ellipsis)
- "No transcript" in italic gray when not yet transcribed
- Provides quick scanning without playing each message

**Bottom player area:**
- Transcript panel overlays the list as a floating layer above the player card
- Same glassmorphism/gradient blur effect as the player itself
- Collapsible — when collapsed, full list is visible
- When expanded, covers part of the list (list stays in place, scroll preserved)
- Stack from bottom: footer → player card (overlay) → transcript panel (overlay) → list

### 4. Search Results

**Icons**: Use same lucide-react icons as shelter overlay:
- Voice results: `Volume2` icon
- Video results: `Video` icon
- Text results: `MessageSquare` icon (existing)

**Snippet**: Voice/video search results show segment timestamp before the matched text:
```
[0:08] 朝からカフェに行ってきました。
```

**Click behavior**: Navigate to conversation → scroll to message → auto-expand transcript panel → seek player to `matched_segment.start - 3 seconds` → highlight matched segment

**Backend changes**:
- Return real `type` field from `search_messages.type` column instead of hardcoding `"text"`
- Include `segment_start` in search results for voice/video matches (for seek-on-click)

## i18n

New keys across all 5 locales (en, ja, yue, zh-CN, zh-TW):

| Key | Purpose |
|-----|---------|
| `transcription.transcribe` | "Transcribe" button label |
| `transcription.transcribing` | "Transcribing..." loading state |
| `transcription.transcript` | "Transcript" panel header |
| `transcription.noTranscript` | "No transcript" placeholder in gallery list |
| `transcription.clickToJump` | "click to jump" hint in transcript panel |
| `transcription.failed` | "Transcription failed" error toast |
| `transcription.cc` | "CC" toggle tooltip for video subtitles |

## Error Handling

- **Model not downloaded**: On first transcribe attempt, the backend auto-downloads the model via `faster-whisper`'s built-in model fetching (downloads from Hugging Face). Frontend shows a toast "Downloading transcription model..." with indeterminate progress. Model is cached in `~/.SakaDesk/models/` and reused for all subsequent transcriptions. Download happens once.
- **Transcription fails**: Toast error message. Button returns to "Transcribe" state (retryable).
- **File not found**: Media file missing — show error toast, don't crash.
- **Background pipeline error**: Log error via structlog, skip to next item, retry failed items later.
- **Non-Windows**: `faster-whisper` works cross-platform (CPU mode). No platform-specific concerns for transcription itself.

## Files Changed

### Backend (New)
| File | Purpose |
|------|---------|
| `backend/services/transcription_service.py` | TranscriptionProvider interface, LocalWhisperProvider, priority queue, background worker |
| `backend/api/transcription.py` | REST endpoints for transcribe, status, get cached |

### Backend (Modified)
| File | Change |
|------|--------|
| `backend/services/search_service.py` | Add `type` column migration, populate type during indexing, update content on transcription save |
| `backend/main.py` | Register transcription routes, start background worker on lifespan |

### Frontend (New)
| File | Purpose |
|------|---------|
| `frontend/src/core/media/TranscriptPanel.tsx` | Reusable transcript display component (segments, timestamps, highlight, click-to-seek, auto-scroll) |
| `frontend/src/core/media/TranscribeButton.tsx` | Transcribe trigger button with loading state |
| `frontend/src/core/media/SubtitleOverlay.tsx` | Video subtitle overlay component |
| `frontend/src/hooks/useTranscription.ts` | Hook for fetching/triggering transcription, managing state |

### Frontend (Modified)
| File | Change |
|------|--------|
| `frontend/src/features/messages/components/MessageBubble.tsx` | Add TranscribeButton footer and TranscriptPanel for voice/video messages |
| `frontend/src/core/media/PhotoDetailModal.tsx` | Add TranscribeButton and TranscriptPanel below voice player and video player |
| `frontend/src/core/media/VideoPlayer.tsx` | Add SubtitleOverlay and CC toggle |
| `frontend/src/core/media/MediaGalleryModal.tsx` | Add transcript preview in voice list items, overlay transcript panel above player |
| `frontend/src/features/search/components/SearchResultItem.tsx` | Use real type icons (Volume2, Video), show segment timestamp |
| `frontend/src/features/search/SearchModal.tsx` | Pass segment_start for seek-on-click navigation |
| `frontend/src/i18n/locales/*.json` | Add transcription keys (all 5 locales) |

## Out of Scope

- Non-Japanese language support (future — model supports it, just not exposed)
- Cloud transcription providers (architecture supports it, not implemented)
- Transcription for blog embedded audio/video
- Transcription editing/correction UI
- Word-level timestamps (segment-level is sufficient for MVP)
- Batch "Transcribe All" button in settings (future — background pipeline handles this)
