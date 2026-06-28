# SakaDesk Feature Roadmap

> **Last Updated:** 2026-06-28

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

## Recently Completed (since 2026-03-22)

> Verified against the `dev` branches on 2026-06-28. Listed here so the roadmap stays honest; details in git history.

| Feature | Notes |
|---------|-------|
| **Audio/Video Transcription** (was P3.6) | Implemented via **Gemini API** (structured output → timestamps/segments), not the originally-researched local whisper. Backend `transcription_service.py` + `/api/transcription`; frontend `TranscribeButton`/`TranscriptPanel`/`SubtitleOverlay`; transcripts are searchable. Background job-queue intentionally deferred (see P4.8). |
| **Translation** (new, was untracked) | DeepL-based. Backend `translation_service.py` + `/api/translate`; unified translate button + immersive blog translation. |
| **Clipboard Copy** (new, was untracked) | Ctrl+C to copy media (photo/video/voice) from the media viewer. |
| **Mobile Auth Mode** (part of P2.3) | pysaka `platform="android"` profile (mobile host, Dart UA, app headers) + `refresh_token` refresh; SakaDesk `auth_mode` web/mobile toggle. Merged to pysaka `dev` 2026-06-28. ⚠️ End-to-end testing still pending. |

---

## P1: High Priority

### 1. Anonymous Analytics & Community Statistics
**Status:** Design-only (design doc was written in 2026-01 then deleted 2026-02; recoverable from git history)
**Category:** Major Feature
**Complexity:** Very High

**Goal:** Privacy-first analytics system with community rankings, personal summaries, and yearly wrapped.

**Design Document:** original at `docs/plans/2026-01-13-anonymous-analytics-design.md` was removed in the 2026-02-05 plan cleanup — **recover from git** (`git log --diff-filter=D` / `git show`) before restarting.

**Key Features:**
- De-identified (去識別化) data collection with user opt-in
- Server-side user linking (survives reinstalls/device changes)
- Public dashboard with member rankings, trends, awards
- Personal local summaries (monthly/yearly message stats)
- Yearly Wrapped with shareable cards (like Spotify Wrapped)

**Tech Stack:**
- Supabase (free tier) for backend — **no Supabase code exists yet**
- Project website on Vercel (already deployed; currently uses Vercel page-view analytics only)

**Implementation Phases:**
- [ ] Phase 0: Recover/refresh the design doc
- [ ] Phase 1: Supabase backend setup & schema
- [ ] Phase 2: Desktop app integration (consent, upload)
- [ ] Phase 3: Public website stats dashboard
- [ ] Phase 4: Personal analytics (local summaries)
- [ ] Phase 5: Yearly Wrapped with shareable cards

**Prerequisites / conflicts:**
- P1.2 (Privacy Policy) should ship before or alongside Phase 2.
- ⚠️ The website FAQ currently states there is **"no analytics, telemetry, or tracking of any kind."** This must be updated when analytics ships.

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
- [ ] Reconcile the website FAQ "no tracking" statement

---

## P2: Medium Priority

### 3. Refresh Token Login (Bypass Browser)
**Status:** Mostly Done (refresh_token infra + mobile auth mode shipped; manual-paste UX missing)
**Category:** Feature
**Complexity:** Low

**Goal:** Allow users to provide their own `refresh_token` to authenticate without browser login.

**Use case:** Users who obtain a `refresh_token` from mobile app traffic capture can bypass the interactive browser-based OAuth flow.

**Already implemented:**
- [x] `Client.__init__` accepts `refresh_token` + `platform` params (pysaka)
- [x] `refresh_access_token()` Plan A handles `refresh_token`-based refresh (pysaka)
- [x] `refresh_token` captured from signin response (pysaka `auth.py`)
- [x] `TokenManager` stores/loads `refresh_token` (backend)
- [x] Mobile auth mode wiring + `auth_mode` web/mobile toggle in Settings (SakaDesk)

**Remaining Tasks:**
- [ ] Add a refresh-token input field in the SakaDesk login UI (`LoginPage.tsx`) — paste-to-login
- [ ] Validate the token (attempt a refresh) before saving
- [ ] Add `--refresh-token` CLI flag to saka-cli for direct token input
- [ ] (Optional) Add a `TokenAuth` alternative class in pysaka

---

### 4. Fuzzy Search Improvements
**Status:** Functionally Done (pragmatic FTS5 + reading-normalization; heavy fuzzy libs deferred by design)
**Category:** Feature
**Complexity:** Medium-High

**Goal:** Improve search with linguistic fuzzy matching for Japanese/English/Chinese.

**Implemented:**
- [x] `SearchService` with SQLite FTS5 trigram tokenizer (`backend/services/search_service.py`)
- [x] `/search` API with multi-service, member, date, content-type, exact-only filters (`backend/api/search.py`)
- [x] `SearchModal` frontend (SearchModal/FilterBar/Input/ResultList) (`frontend/src/features/search/`)
- [x] `jaconv` + `pykakasi` (kanji→reading) normalization
- [x] Incremental index updates
- [x] Comprehensive backend search tests

**Deferred (intentionally — only pursue if real user demand):**
- [ ] rapidfuzz / Levenshtein / phonetic matching beyond trigram + reading overlap
- [ ] MeCab/Sudachi morphological segmentation
- [ ] Language-aware ranking for mixed-language content

---

### 5. Staged Rollout System
**Status:** Not Started (version/update check exists; no channel or staged-release logic)
**Category:** Infrastructure
**Complexity:** Very High

**Goal:** Release to 10-20% of users first (RC), then full release.

**Already exists:** GitHub-latest-release version check (`backend/api/version.py`), update UI (`UpgradeIcon.tsx`), standard release-please workflow. None of it supports channels or percentage rollout.

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
- [ ] Design update check protocol (add `channel` to VersionInfo)
- [ ] Implement stable user ID generation
- [ ] Add channel preference to settings
- [ ] Create release automation workflow

---

## P3: Nice-to-Have

### 6. Fan Club Contents Support
**Status:** Partial / Unblocked (pysaka core method exists; backend API + UI + enablement missing)
**Category:** Feature
**Complexity:** Medium

**Goal:** Surface fan-club-exclusive content alongside messages/blogs.

**Already implemented:**
- [x] `Client.get_fc_contents()` in pysaka (`client.py`) — the core dependency that previously blocked this
- [x] Frontend feature stub in `config/features.ts` (fanclub icon/label, `accessLevel: 'paid'`); `FeatureId` includes `'fanclub'`

**Remaining Tasks:**
- [ ] Add backend API endpoint wrapping `get_fc_contents()`
- [ ] Design & implement the `FanClubFeature` UI component (parallel to blogs) + `ContentArea` case
- [ ] Add sync integration for fan club content
- [ ] Enable `'fanclub'` in `SERVICE_FEATURES` for supporting services
- [ ] Index fan club content in search

---

## P4: Future Vision

### 7. Sync Phase 4: Post-Processing
**Status:** Partial (post-sync tasks exist but scattered; no formal phase or job queue)
**Category:** Architecture
**Complexity:** Medium

**Goal:** Add a dedicated post-sync processing phase with a job queue for background tasks.

**Current reality (`sync_service.py`):** Phase 1 (scan) → Phase 2 (metadata) → Phase 3 (media download + inline dimension extraction). Post-processing is ad-hoc: search-index update is fire-and-forget (`asyncio.create_task`, not awaited), profile cache refresh + blog backup run inline/after. No unified queue, no progress tracking.

**Architecture (target):**
```
Phase 1: Fetch message metadata
Phase 2: Download media files
Phase 3: Update database + extract media dimensions (current)
Phase 4: Post-processing (NEW)
         ├── Queue transcription jobs (transcription service already exists)
         ├── Update search index (formalize the existing fire-and-forget task)
         └── Generate thumbnails (not implemented)
```

**Tasks:**
- [ ] Design post-processing pipeline + job queue
- [ ] Move existing post-sync tasks into it (search index, transcription, blog backup)
- [ ] Add progress tracking for post-processing
- [ ] Make post-processing interruptible/resumable

---

### 8. Vector Database per Chat Room
**Status:** Research Required (no implementation; referenced design doc does not exist)
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
- SQLite with vector extension (sqlite-vec)

**Dependencies:**
- Transcription (now done) provides voice/video text
- Significant storage and compute requirements

**Note:** Roadmap previously referenced `.claude/skills/vector-db-integration.md` — that file is **missing**; treat design as not-yet-written.

**Tasks:**
- [ ] Evaluate embedded vector DB options
- [ ] Design embedding pipeline (which model?)
- [ ] Plan storage strategy
- [ ] Design query API
- [ ] Create semantic search UI

---

## Implementation Order

### Quick Wins (build on momentum)
1. **P2.3: Refresh Token Login** — finish the manual-paste UX (login field + CLI flag + validate). Small, complements the just-shipped mobile auth mode.
2. **P3.6 Fan Club** — now unblocked (core method exists); backend API + UI + enable.

### Big Bets
3. **P1.2 Privacy Policy** → **P1.1 Anonymous Analytics** (recover design doc first; reconcile FAQ).

### When Needed
4. **P2.5 Staged Rollout** (when the user base grows).

### Long-Term
5. **P4.7 Post-Processing Pipeline** (formalize what already runs ad-hoc).
6. **P4.8 Vector DB** (depends on embeddings; research first).

---

## Notes

- Items marked "Research Required" need investigation before planning.
- Complexity ratings are rough estimates.
- Priorities may shift based on user feedback.

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-06-28 | Codebase audit re-sync: marked Transcription done (Gemini, not whisper); added Translation + Clipboard Copy as completed; Mobile Auth Mode done; P2.3 → Mostly Done; P2.4 → Functionally Done; Fan Club unblocked → Partial; Post-Processing → Partial; corrected Analytics (design-only) and Staged Rollout/Vector DB statuses; fixed broken design-doc references |
| 2026-03-22 | Roadmap cleanup: removed 16 completed items, updated statuses from codebase audit, 9 remaining |
| 2026-02-05 | Completed blog support, multi-service backend, message sync fixes |
| 2026-01-14 | Completed multi-service UI architecture, official app feature parity |
| 2026-01-13 | Completed in-place upgrade, randomized sync, version check, notifications, phase 1-2 items |
| 2026-01-11 | Initial roadmap created |
