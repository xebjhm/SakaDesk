# SakaDesk Feature Roadmap

> **Last Updated:** 2026-03-22

This document tracks planned features and improvements for SakaDesk.
Completed items have been archived — see git history for details.

---

## Priority Levels

| Priority | Description |
|----------|-------------|
| P1 | High-value features or important fixes |
| P2 | Medium priority improvements |
| P3 | Nice-to-have features |
| P4 | Future vision / research required |

---

## P1: High Priority

### 1. Anonymous Analytics & Community Statistics
**Status:** Not Started
**Category:** Major Feature
**Complexity:** Very High

**Goal:** Privacy-first analytics system with community rankings, personal summaries, and yearly wrapped.

**Design Document:** [docs/plans/2026-01-13-anonymous-analytics-design.md](plans/2026-01-13-anonymous-analytics-design.md)

**Key Features:**
- De-identified (去識別化) data collection with user opt-in
- Server-side user linking (survives reinstalls/device changes)
- Public dashboard with member rankings, trends, awards
- Personal local summaries (monthly/yearly message stats)
- Yearly Wrapped with shareable cards (like Spotify Wrapped)

**Community Statistics:**
- Member popularity rankings
- Group distribution & cross-group insights
- Loyalty/retention rankings & trending members
- Awards: Rising Star, Hidden Gem, The Dedicated

**Tech Stack:**
- Supabase (free tier) for backend
- Project website on Vercel (already deployed)

**Implementation Phases:**
- [ ] Phase 1: Supabase backend setup & schema
- [ ] Phase 2: Desktop app integration (consent, upload)
- [ ] Phase 3: Public website stats dashboard
- [ ] Phase 4: Personal analytics (local summaries)
- [ ] Phase 5: Yearly Wrapped with shareable cards

**Prerequisite:** P1.2 (Privacy Policy) should ship before or alongside Phase 2.

---

### 2. Privacy Policy & Data Upload Agreement
**Status:** Not Started
**Category:** Legal/Compliance
**Complexity:** Medium

**Goal:** Inform users about data collection for anonymous analytics dashboard.

**Dependencies:** Ships with or before P1.1 Phase 2.

**Tasks:**
- [ ] Create Privacy Policy page/dialog
- [ ] Explain what data is collected (去識別化 only)
- [ ] Show opt-in dialog when enabling analytics
- [ ] Link to full privacy policy from settings
- [ ] Allow users to view/delete their anonymous data

---

## P2: Medium Priority

### 3. Refresh Token Login (Bypass Browser)
**Status:** In Progress (infrastructure exists, UI missing)
**Category:** Feature
**Complexity:** Low

**Goal:** Allow users to provide their own `refresh_token` to authenticate without browser login.

**Use case:** Users who obtain a `refresh_token` from mobile app traffic capture can bypass the interactive browser-based OAuth flow.

**Existing Infrastructure (already implemented):**
- [x] `Client.__init__` accepts `refresh_token` parameter (pysaka)
- [x] `refresh_access_token()` Plan A handles `refresh_token`-based refresh (pysaka)
- [x] `TokenManager` stores/loads `refresh_token` in keyring (backend)

**Remaining Tasks:**
- [ ] Add `--refresh-token` CLI flag to saka-cli for direct token input
- [ ] Add refresh token input field in SakaDesk login UI
- [ ] Validate refresh token works by attempting a token refresh before saving
- [ ] Add a `TokenAuth` alternative class in pysaka

---

### 4. Fuzzy Search Improvements
**Status:** In Progress (basic search exists, linguistic fuzzy missing)
**Category:** Feature
**Complexity:** Medium-High

**Goal:** Improve search with linguistic fuzzy matching for Japanese/English/Chinese.

**Existing Infrastructure (already implemented):**
- [x] `SearchService` with SQLite FTS5 trigram tokenizer (`backend/services/search_service.py`)
- [x] `/search` API endpoint with multi-service, member, date, content-type filters (`backend/api/search.py`)
- [x] `SearchModal` frontend component with blog/message search (`frontend/src/features/search/`)
- [x] `jaconv` for Japanese text normalization

**Remaining Tasks:**
- [ ] Evaluate linguistic fuzzy libraries (`rapidfuzz`, MeCab/Sudachi for Japanese segmentation)
- [ ] Add Levenshtein distance or phonetic matching beyond trigram overlap
- [ ] Improve ranking for mixed-language content
- [ ] Handle incremental index updates for large datasets

---

### 5. Staged Rollout System
**Status:** Research Required
**Category:** Infrastructure
**Complexity:** Very High

**Goal:** Release to 10-20% of users first (RC), then full release.

**Recommendation:** Start with Option B (release channels), evolve to percentage-based if needed.

```
Option B: Multiple release channels
- Release tags: v1.0.0-rc.1, v1.0.0
- User opts into RC channel in settings
- Pros: Simple, no server needed

Option C: GitHub Release + percentage tag (future)
- Release body contains: `rollout: 20%`
- Client uses stable hash to determine eligibility
```

**Tasks:**
- [ ] Design update check protocol
- [ ] Implement stable user ID generation
- [ ] Add channel preference to settings
- [ ] Create release automation workflow

---

## P3: Nice-to-Have

### 6. Audio/Video Transcription (Whisper)
**Status:** Research Required
**Category:** Feature
**Complexity:** Very High

**Goal:** Transcribe voice messages and videos for search, translation, and future vector DB integration.

**Approach options:**
```
Option A: Local (whisper.cpp / faster-whisper)
- Pros: Privacy, no API costs
- Cons: Requires good hardware, large model download

Option B: Cloud API (OpenAI Whisper API)
- Pros: Fast, no local resources
- Cons: Privacy concerns, API costs

Option C: Hybrid (user chooses in settings)
```

**Tasks:**
- [ ] Evaluate whisper.cpp integration with PyInstaller
- [ ] Design transcription storage (SQLite? alongside media?)
- [ ] Implement background transcription queue
- [ ] Add transcription display in UI
- [ ] Consider translation integration

---

### 7. Fan Club Contents Support
**Status:** Blocked (Core Library)
**Category:** Feature
**Complexity:** High

**Dependency:** Requires pysaka core development first.

**Existing Infrastructure:**
- [x] Frontend feature definition stub in `config/features.ts` (icon, label, accessLevel)
- [x] `FeatureId` type includes `'fanclub'` in state management

**Remaining Tasks:**
- [ ] Implement fan club API methods in pysaka core
- [ ] Design fan club content UI (FanClubFeature component)
- [ ] Add backend API endpoints
- [ ] Enable feature in `SERVICE_FEATURES` config
- [ ] Integrate with sync

---

## P4: Future Vision

### 8. Sync Phase 4: Post-Processing
**Status:** Not Started
**Category:** Architecture
**Complexity:** Medium

**Goal:** Add a dedicated post-sync processing phase with a job queue for background tasks.

**Note:** Media dimension extraction is already handled inline during Phase 3 sync (`sync_service.py`). This item is about building a proper post-processing pipeline for heavier tasks.

**Architecture:**
```
Sync Flow:
Phase 1: Fetch message metadata
Phase 2: Download media files
Phase 3: Update database + extract media dimensions (current)
Phase 4: Post-processing (NEW)
         ├── Queue transcription jobs
         ├── Update search index
         └── Generate thumbnails
```

**Tasks:**
- [ ] Design post-processing pipeline
- [ ] Implement job queue (background processing)
- [ ] Add progress tracking for post-processing
- [ ] Make post-processing interruptible/resumable

---

### 9. Vector Database per Chat Room
**Status:** Research Required
**Category:** Future Feature
**Complexity:** Very High

**Goal:** Semantic search and AI-powered features per member/room.

**Use cases:**
- "Find messages where she talked about her cat"
- Similar message suggestions
- Conversation summarization
- Mood/topic analysis over time

**Technology options:**
- ChromaDB (embedded, good for desktop app)
- LanceDB (embedded, Rust-based)
- SQLite with vector extension

**Dependencies:**
- Transcription (P3.6) for voice/video content
- Significant storage and compute requirements

**Existing:** Design document at `.claude/skills/vector-db-integration.md` (architecture only, no implementation).

**Tasks:**
- [ ] Evaluate embedded vector DB options
- [ ] Design embedding pipeline (which model?)
- [ ] Plan storage strategy
- [ ] Design query API
- [ ] Create semantic search UI

---

## Implementation Order

### Next Up
1. P1.2: Privacy Policy (prerequisite for analytics)
2. P1.1: Anonymous Analytics (phased rollout)

### Quick Wins
3. P2.3: Refresh Token Login (infrastructure exists, just needs UI)
4. P2.4: Fuzzy Search Improvements (search exists, add linguistic matching)

### When Needed
5. P2.5: Staged Rollout (when user base grows)

### Long-Term
6. P3.6: Transcription
7. P3.7: Fan Club (blocked on core)
8. P4.8: Post-Processing Pipeline
9. P4.9: Vector DB

---

## Notes

- Items marked "Research Required" need investigation before planning
- Items marked "Blocked" have external dependencies
- Complexity ratings are rough estimates
- Priorities may shift based on user feedback

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-03-22 | Roadmap cleanup: removed 16 completed items, updated statuses from codebase audit, 9 remaining |
| 2026-02-05 | Completed blog support, multi-service backend, message sync fixes |
| 2026-01-14 | Completed multi-service UI architecture, official app feature parity |
| 2026-01-13 | Completed in-place upgrade, randomized sync, version check, notifications, phase 1-2 items |
| 2026-01-11 | Initial roadmap created |
