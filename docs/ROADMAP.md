# HakoDesk Feature Roadmap

> **Last Updated:** 2026-01-14

This document tracks planned features, improvements, and technical debt for HakoDesk.

---

## Priority Levels

| Priority | Description |
|----------|-------------|
| P0 | Critical bugs affecting core functionality |
| P1 | High-value features or important fixes |
| P2 | Medium priority improvements |
| P3 | Nice-to-have features |
| P4 | Future vision / research required |

---

## P0: Critical Bugs

### 1. Unread Indicator Not Working Properly
**Status:** ✅ Complete
**Category:** Bug Fix
**Complexity:** Medium

**Problem:** Unread indicator does not display correctly.

**Solution implemented:**
- [x] Backend now calculates accurate unread count
- [x] `last_read_id` properly saved/loaded per member
- [x] Unread count persists across app restarts

**Files modified:**
- `backend/api/content.py` - Added accurate unread count calculation
- `backend/services/settings_service.py` - Persistence improvements

---

## P1: High Priority Features

### 2. User Nickname Resolution (%%% Placeholder)
**Status:** ✅ Complete
**Category:** Enhancement
**Complexity:** Medium

**Goal:** Replace `%%%` placeholder in messages with actual user nickname.

**Solution implemented:**
- [x] Fetch nickname via pyhako core API
- [x] Store nickname in settings (cached)
- [x] Replace `%%%` in message rendering (frontend)
- [x] Graceful fallback when nickname unavailable

**Files modified:**
- `backend/api/profile.py` - New profile API for nickname
- `frontend/src/App.tsx` - Nickname replacement in message rendering

---

### 3. Smart Token Refresh & Health Check
**Status:** ✅ Complete
**Category:** Architecture
**Complexity:** High

**Problem:** Token refreshed on every auth check, wasteful and detectable.

**Solution implemented:** Option A (Lazy Refresh)
- [x] Only refresh when token expires in < 5 minutes
- [x] Check JWT expiry before API calls
- [x] Minimal server contact
- [x] Token expiry shown in diagnostics panel

**Files modified:**
- `backend/services/auth_service.py` - Lazy refresh logic
- `backend/api/diagnostics.py` - Token expiry display

---

### 4. Multi-Service Support (Nogizaka, Sakurazaka)
**Status:** ✅ Complete (Frontend Architecture)
**Category:** Major Feature
**Complexity:** Very High

**Goal:** Support all three groups with a modern 3-zone Discord-style UI.

**Plan Document:** [docs/plans/2026-01-14-multi-service-ui.md](plans/2026-01-14-multi-service-ui.md)

**Frontend Architecture (Completed):**
```
┌─────────────────────────────────────────────────────┐
│ Zone A │ Zone B   │ Zone C (Content Area)           │
│ 56px   │ 48px     │ flex-1                          │
├────────┼──────────┼─────────────────────────────────┤
│        │          │                                 │
│ [Hina] │ Messages │ [Sidebar] [Chat View]           │
│ [Nogi] │ Blogs    │                                 │
│ [Saku] │ News     │                                 │
│        │ FanClub  │                                 │
│        │ AI       │                                 │
│        │          │                                 │
└────────┴──────────┴─────────────────────────────────┘

Zone A: ServiceRail - Service icons (Discord-style)
Zone B: FeatureRail - Feature navigation per service
Zone C: ContentArea - Feature-specific content
```

**Frontend Implementation (Complete):**
- [x] Zustand store for service/feature selection with persistence
- [x] ServiceRail component (Zone A) - Discord-style service icons
- [x] FeatureRail component (Zone B) - Feature navigation
- [x] ContentArea component (Zone C) - Feature rendering
- [x] Layout component refactored to 3-zone architecture
- [x] MessagesFeature extracted from App.tsx
- [x] Sidebar filtering by active service
- [x] Service/feature configuration system
- [x] Index exports for stores, config, features

**Backend changes (Remaining):**
- [ ] Update pyhako Group enum usage throughout
- [ ] Separate credential storage per group
- [ ] Separate sync state per group
- [ ] Update settings structure

**Core library dependency:**
- Verify pyhako supports all three groups
- May need core updates first

---

### 5. Anonymous Analytics & Community Statistics
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
- Project website with app intro, download, and stats

**Community Statistics:**
- Member popularity rankings
- Group distribution
- Loyalty/retention rankings
- Trending members
- Cross-group insights
- Awards: Rising Star, Hidden Gem, The Dedicated

**Tech Stack:**
- Supabase (free tier) for backend
- Public website on Vercel/Netlify

**Implementation Phases:**
- [ ] Phase 1: Supabase backend setup & schema
- [ ] Phase 2: Desktop app integration (consent, upload)
- [ ] Phase 3: Public website with stats dashboard
- [ ] Phase 4: Personal analytics (local summaries)
- [ ] Phase 5: Yearly Wrapped with shareable cards

---

### 6. Randomized Background Sync
**Status:** ✅ Complete
**Category:** Security/Anti-Detection
**Complexity:** Medium

**Goal:** Avoid detectable patterns by randomizing sync intervals.

**Solution implemented:** Based on analysis of 19,873 messages from 24 members:
- [x] Analyzed posting patterns: Peak hours 19:00-23:00 JST (40% of messages)
- [x] Time-of-day multiplier (peak=0.6x, dead hours=2.0x)
- [x] Activity multiplier (recent posts=0.5x, inactive=1.5x)
- [x] ±20% jitter on each interval
- [x] Clamped to 5-60 minute range
- [x] Settings toggle: "Smart Timing" (adaptive_sync_enabled)

**Algorithm:**
```
interval = base_minutes × time_multiplier × activity_multiplier × (1 ± 0.2)

Time multipliers (JST):
- 19:00-22:00: 0.6x (peak hours)
- 17:00-18:00, 23:00: 0.7x (active)
- 09:00-16:00: 0.8x (daytime)
- 02:00-06:00: 2.0x (dead hours)

Activity multipliers:
- < 1 hour since post: 0.5x
- < 3 hours: 0.7x
- > 24 hours: 1.3x
- > 72 hours: 1.5x
```

**Files:**
- `backend/services/adaptive_sync.py` - Adaptive interval calculator
- `backend/api/settings.py` - Added adaptive_sync_enabled setting

---

## P2: Medium Priority

### 7. Built-in Version Update Check
**Status:** ✅ Complete
**Category:** Feature
**Complexity:** Medium

**Goal:** Check GitHub releases for updates and notify user.

**Solution implemented:**
- [x] GitHub API: `GET /repos/{owner}/{repo}/releases/latest`
- [x] Compare current version vs latest release (semantic versioning)
- [x] Show notification in UI (gradient banner at top)
- [x] Download button links to release page
- [x] Check on startup with 1-hour cache to respect rate limits
- [x] Dismiss per-version persists to localStorage

**Files:**
- `backend/api/version.py` - Version check endpoint with caching
- `frontend/src/components/UpdateBanner.tsx` - Update notification banner

---

### 8. In-Place Software Upgrade
**Status:** ✅ Complete
**Category:** Feature
**Complexity:** High

**Current Problem:** Windows users must uninstall → reinstall for updates.

**Solution implemented:**
- [x] Download new installer from GitHub releases to temp directory
- [x] Generate batch script that waits for app to close, runs installer silently
- [x] App spawns upgrade script and exits gracefully
- [x] Upgrade banner shows download progress and "Install Now" button
- [x] Inno Setup already handles in-place upgrade automatically

**Files:**
- `backend/services/upgrade_service.py` - Download, script generation, launch
- `backend/api/version.py` - Upgrade API endpoints (start, status, launch, cancel)
- `frontend/src/components/UpdateBanner.tsx` - Upgrade UI with progress bar

---

### 9. Staged Rollout System
**Status:** Research Required
**Category:** Infrastructure
**Complexity:** Very High

**Goal:** Release to 10-20% of users first (RC), then full release.

**Possible Approaches:**

```
Option A: Client-side percentage check
──────────────────────────────────────
- Generate stable user ID (hash of machine ID or install ID)
- On update check, include user ID
- Server (or GitHub API custom) returns appropriate version
- Cons: Requires server-side logic or GitHub Actions

Option B: Multiple release channels
───────────────────────────────────
- Release tags: v1.0.0-rc.1, v1.0.0
- User opts into RC channel in settings
- App checks appropriate channel
- Pros: Simple, no server needed
- Cons: Opt-in only, not percentage-based

Option C: GitHub Release + percentage tag
─────────────────────────────────────────
- Release body contains: `rollout: 20%`
- Client parses this, uses stable hash to determine eligibility
- After full rollout, update to `rollout: 100%`
- Pros: No server, percentage-based
- Cons: Requires manual release body updates

Option D: External update service
─────────────────────────────────
- Simple JSON file on GitHub Pages or CDN
- Contains version info and rollout percentage
- Client checks this file
- Pros: Flexible, updatable
- Cons: Another thing to maintain
```

**Recommendation:** Start with Option B (channels), evolve to Option C if needed.

**Tasks:**
- [ ] Design update check protocol
- [ ] Implement stable user ID generation
- [ ] Add channel preference to settings
- [ ] Create release automation workflow

---

### 10. Diagnostic System Review
**Status:** ✅ Complete
**Category:** Technical Debt
**Complexity:** Low-Medium

**Goal:** Review and improve current diagnostics for debugging.

**Implemented:**
- [x] System info: OS, Python version, app version, PyHako version
- [x] Auth status: token validity, expiry time, configured groups
- [x] Config state: output dir, auto-sync settings
- [x] Sync state: disk usage, file count, last sync time
- [x] Logs: recent, errors, warnings tabs with filtering
- [x] Token expiry status (shown as time remaining)
- [x] Copy JSON to clipboard for support
- [x] Hidden developer panel (5-click easter egg on About version)

**Files:**
- `backend/api/diagnostics.py` - Comprehensive diagnostics endpoint
- `frontend/src/components/DiagnosticsModal.tsx` - Developer panel UI

---

### 11. Voice Item UI/UX Improvements
**Status:** ✅ Complete
**Category:** UI/UX
**Complexity:** Low-Medium

**Current:** Enhanced audio player with full controls

**Improvements:**
- [x] Volume slider on hover (appears near volume icon)
- [x] Click volume icon to mute/unmute
- [ ] Visual waveform display (optional, nice-to-have) - deferred
- [x] Keyboard shortcuts (space to pause, arrow keys to seek, M to mute)
- [x] Remember volume preference (persisted to localStorage)

**Component:** `frontend/src/components/VoicePlayer.tsx`

---

### 12. Multi-Language Support (i18n)
**Status:** Not Started
**Category:** Feature
**Complexity:** Medium-High

**Goal:** Localization for multiple languages.

**Architecture:**
```
strings/
├── en.json      # English (default)
├── ja.json      # Japanese
├── zh-CN.json   # Simplified Chinese
└── zh-TW.json   # Traditional Chinese

Backend: backend/i18n/strings.py
Frontend: react-i18next or similar
```

**Tasks:**
- [ ] Extract all user-facing strings
- [ ] Create translation file structure
- [ ] Implement language detection (system locale)
- [ ] Add language selector in settings
- [ ] Translate to priority languages

**Priority languages:** English, Japanese, Chinese (Simplified/Traditional)

---

### 13. Windows Desktop Notifications
**Status:** ✅ Complete
**Category:** Feature
**Complexity:** Medium

**Goal:** Native desktop notifications for new messages.

**Solution implemented:** Option B (plyer - cross-platform)
- [x] plyer library for cross-platform notifications
- [x] Notification service in backend with enable/disable
- [x] Trigger on new message detection during sync
- [x] Add notification toggle in settings UI
- [x] /api/notifications endpoint for status and testing

**Files:**
- `backend/services/notification_service.py` - Notification service
- `backend/api/notifications.py` - Notification API endpoint
- `backend/api/settings.py` - Added notifications_enabled setting

---

## P3: Nice-to-Have

### 14. Official Blogs Support
**Status:** Not Started
**Category:** Feature
**Complexity:** Medium

**Note:** Backup already supported in pyhako core.

**Frontend design needed:**
- Blog list view (by member)
- Blog post reader view
- Image gallery in posts
- Navigation between posts

**Tasks:**
- [ ] Design blog UI/UX
- [ ] Create BlogList component
- [ ] Create BlogReader component
- [ ] Integrate with sync (blog sync)
- [ ] Add blog section to navigation

---

### 15. Audio/Video Transcription (Whisper)
**Status:** Research Required
**Category:** Feature
**Complexity:** Very High

**Goal:** Transcribe voice messages and videos for:
1. Search functionality
2. Translation for non-Japanese users
3. Future vector DB integration

**Approach options:**
```
Option A: Local Whisper
───────────────────────
- whisper.cpp or faster-whisper
- Runs on user's machine
- Pros: Privacy, no API costs
- Cons: Requires good hardware, large model download

Option B: Cloud API (OpenAI Whisper API)
────────────────────────────────────────
- Send audio to API
- Pros: Fast, no local resources
- Cons: Privacy concerns, API costs

Option C: Hybrid
────────────────
- Small model locally for quick transcription
- Optional cloud for better accuracy
- User chooses in settings
```

**Tasks:**
- [ ] Evaluate whisper.cpp integration with PyInstaller
- [ ] Design transcription storage (SQLite? alongside media?)
- [ ] Implement background transcription queue
- [ ] Add transcription display in UI
- [ ] Consider translation integration

---

### 16. Fan Club Contents Support
**Status:** Blocked (Core Library)
**Category:** Feature
**Complexity:** High

**Dependency:** Requires pyhako core development first.

**Tasks:**
- [ ] Implement in pyhako core
- [ ] Design fan club content UI
- [ ] Integrate with sync
- [ ] Handle different content types

---

### 17. Fuzzy Search (Multi-Language)
**Status:** Not Started
**Category:** Feature
**Complexity:** Medium-High

**Goal:** Search messages with fuzzy matching, supporting Japanese/English/Chinese.

**Libraries to evaluate:**
- `fuzzywuzzy` / `rapidfuzz` (Python)
- `fuse.js` (JavaScript, frontend search)
- SQLite FTS5 with tokenizer

**Challenges:**
- Japanese text segmentation (MeCab, Sudachi)
- Mixed language content
- Performance with large datasets

**Tasks:**
- [ ] Evaluate search library options
- [ ] Design search index structure
- [ ] Implement search API endpoint
- [ ] Create search UI component
- [ ] Handle incremental index updates

---

## P4: Future Vision

### 18. Vector Database per Chat Room
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
- Transcription (P3.14) for voice/video content
- Significant storage and compute requirements

**Tasks:**
- [ ] Evaluate embedded vector DB options
- [ ] Design embedding pipeline (which model?)
- [ ] Plan storage strategy
- [ ] Design query API
- [ ] Create semantic search UI

---

### 19. Sync Phase 4: Post-Processing
**Status:** Not Started
**Category:** Architecture
**Complexity:** Medium

**Goal:** Add post-sync processing phase for:
1. Media dimension extraction (already partially implemented)
2. Transcription queue
3. Vector DB updates
4. Thumbnail generation
5. Analytics/statistics

**Architecture:**
```
Sync Flow:
──────────
Phase 1: Fetch message metadata
Phase 2: Download media files
Phase 3: Update database
Phase 4: Post-processing (NEW)
         ├── Extract media dimensions
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

### 20. Official App Feature Parity
**Status:** ✅ Complete
**Category:** Major Feature
**Complexity:** Very High

**Goal:** Match official 46 Message app features discovered via HAR analysis.

**Plan Document:** [../../../.claude/plans/modular-bubbling-blum.md](../../../.claude/plans/modular-bubbling-blum.md)

**Core library updates (pyhako):**
- [x] Add `get_letters()` method
- [x] Add `get_past_messages()` method
- [x] Add `add_favorite()` / `remove_favorite()` methods
- [x] Add `get_subscription_streak()` method
- [x] Add `get_member()` method
- [x] Add `get_account()` method

**Frontend components:**
- [x] MediaGalleryModal.tsx - Grid view with photo/video/voice tabs
- [x] FavoritesModal.tsx - Starred messages list
- [x] SentLettersModal.tsx - Grid view of sent letters
- [x] CalendarModal.tsx - Date navigation with message highlights
- [x] BackgroundModal.tsx - Chat background customization

**Backend API:**
- [x] `/api/favorites` - Favorites management
- [x] `/api/chat_features` - Letters, calendar, backgrounds

---

### 21. Terms of Service Acknowledgment
**Status:** Not Started
**Category:** Legal/Compliance
**Complexity:** Low

**Goal:** Show ToS acknowledgment on first launch, similar to CLI version.

**Implementation:**
- [ ] Create ToS dialog component
- [ ] Show on first launch (check localStorage/settings)
- [ ] Block app usage until accepted
- [ ] Store acceptance timestamp in settings
- [ ] Include disclaimer about unofficial app nature

---

### 22. Privacy Policy & Data Upload Agreement
**Status:** Not Started
**Category:** Legal/Compliance
**Complexity:** Medium

**Goal:** Inform users about data collection for anonymous analytics dashboard.

**Dependencies:** P1.5 Anonymous Analytics

**Implementation:**
- [ ] Create Privacy Policy page/dialog
- [ ] Explain what data is collected (去識別化 only)
- [ ] Show opt-in dialog when enabling analytics
- [ ] Link to full privacy policy from settings
- [ ] Allow users to view/delete their anonymous data

---

### 23. Version in Installer Filename
**Status:** Not Started
**Category:** Build/CI
**Complexity:** Low

**Goal:** Include version number in installer filename (e.g., `HakoDesk-1.2.3-Setup.exe`).

**Implementation:**
- [ ] Update Inno Setup script to use version variable
- [ ] Modify GitHub Actions to pass version to build
- [ ] Output format: `HakoDesk-{version}-Setup.exe`

**Files:**
- `installer/hakodesk.iss` - Inno Setup script
- `.github/workflows/build.yml` - CI workflow

---

### 24. Feature Request Button (許願池)
**Status:** Not Started
**Category:** User Engagement
**Complexity:** Medium

**Goal:** One-click feature request submission via GitHub Issues.

**Implementation:**
- [ ] Add "許願池" button in Settings menu
- [ ] Open GitHub issue URL with pre-filled template
- [ ] Template includes: version, OS, feature description placeholder
- [ ] Use GitHub issue template URL parameters
- [ ] No authentication required (uses user's GitHub login)

**URL Format:**
```
https://github.com/{owner}/{repo}/issues/new?template=feature_request.md&title=Feature+Request:+&labels=enhancement
```

---

## Implementation Order Suggestion

Based on dependencies and value:

### Phase 1: Stability & Core Fixes ✅ COMPLETE
1. ~~P0.1: Unread indicator fix~~ ✅
2. ~~P1.3: Smart token refresh~~ ✅
3. ~~P2.10: Diagnostic review~~ ✅

### Phase 2: User Experience ✅ COMPLETE
4. ~~P1.2: Nickname resolution~~ ✅
5. ~~P2.11: Voice UI improvements~~ ✅
6. ~~Bug report system~~ ✅ (bonus)
7. ~~P2.13: Desktop notifications~~ ✅
8. ~~P2.7: Version update check~~ ✅

### Phase 3: Growth & Security ✅ COMPLETE
9. ~~P1.6: Randomized sync~~ ✅
10. ~~P2.8: In-place upgrade~~ ✅

### Phase 4: Major Features
11. ~~P1.20: Official app feature parity~~ ✅
12. ~~P1.4: Multi-service support (frontend architecture)~~ ✅
13. P1.5: Anonymous analytics & community statistics
14. P3.14: Blog support ← NEXT
15. P2.12: i18n

### Phase 5: Advanced Features
16. P3.17: Fuzzy search
17. P3.15: Transcription
18. P4.19: Post-processing phase
19. P4.18: Vector DB

### Deferred
- P2.9: Staged rollout (when user base grows)
- P3.16: Fan club (blocked on core)

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
| 2026-01-14 | Completed P1.4: Multi-Service UI Architecture - 3-zone Discord-style layout with Zustand, ServiceRail, FeatureRail, ContentArea, MessagesFeature extraction |
| 2026-01-14 | Completed P1.20: Official App Feature Parity (MediaGallery, Favorites, SentLetters, Calendar, Background) |
| 2026-01-13 | Completed P2.8: In-place software upgrade for Windows |
| 2026-01-13 | Completed P1.6: Randomized sync with adaptive timing algorithm |
| 2026-01-13 | Completed P2.7: Version update check, P2.13: Desktop notifications |
| 2026-01-13 | Marked Phase 1 & 2 complete: P0.1, P1.2, P1.3, P2.10, P2.11 all done |
| 2026-01-13 | Added P2.21-24: ToS acknowledgment, Privacy policy, Version in filename, Feature request button (24 items total) |
| 2026-01-13 | Added P1.20: Official App Feature Parity - HAR analysis revealed 6+ new API endpoints |
| 2026-01-13 | Added P1.5: Anonymous Analytics & Community Statistics (19 items total) |
| 2026-01-11 | Initial roadmap created with 18 items |
