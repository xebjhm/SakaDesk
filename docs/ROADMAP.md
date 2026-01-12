# HakoDesk Feature Roadmap

> **Last Updated:** 2026-01-11

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
**Status:** Not Started
**Category:** Major Feature
**Complexity:** Very High

**Goal:** Support all three groups with a modern 3-layer UI.

**UI Design:**
```
┌─────────────────────────────────────────────────────┐
│  [≡]  HakoDesk                              [─][□][×]│
├────────┬────────────────────────────────────────────┤
│        │                                            │
│  🌸    │  Member List        │  Chat View           │
│  Hina  │  ───────────────    │  ─────────────────   │
│        │  [Avatar] Name      │  [Messages...]       │
│  🌸    │  [Avatar] Name      │                      │
│  Nogi  │  [Avatar] Name      │                      │
│        │                     │                      │
│  🌸    │                     │                      │
│  Saku  │                     │                      │
│        │                     │                      │
├────────┴────────────────────────────────────────────┤
│  Status Bar                                         │
└─────────────────────────────────────────────────────┘

Layer 1: Service selector (left nav bar)
Layer 2: Member list (current left panel)
Layer 3: Chat view (current right panel)
```

**Backend changes:**
- [ ] Update pyhako Group enum usage throughout
- [ ] Separate credential storage per group
- [ ] Separate sync state per group
- [ ] Update settings structure

**Frontend changes:**
- [ ] Add left navigation bar component
- [ ] Refactor state to support multiple services
- [ ] Add service switching logic
- [ ] Update routing/navigation

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
**Status:** Not Started
**Category:** Security/Anti-Detection
**Complexity:** Medium

**Current Problem:** Fixed sync intervals are detectable patterns.

**Proposed Solution:**
```
Dynamic Sync Frequency Algorithm:
─────────────────────────────────
1. Base interval: 15-30 minutes (randomized)
2. Activity multiplier:
   - If member posted recently (< 1 hour): check more often
   - If member inactive (> 24 hours): check less often
3. Time-of-day adjustment:
   - Member's typical active hours: more frequent
   - Off-hours: less frequent
4. Jitter: ±20% random variation on each interval

Example:
- Base: 20 min
- Member active: ×0.5 = 10 min
- Peak hours: ×0.7 = 7 min
- Jitter: 7 min ± 1.4 min = 5.6-8.4 min
```

**Tasks:**
- [ ] Analyze member posting patterns from synced data
- [ ] Implement adaptive interval calculator
- [ ] Add randomization layer
- [ ] Store last activity timestamps per member
- [ ] Update sync scheduler

---

## P2: Medium Priority

### 7. Built-in Version Update Check
**Status:** Not Started
**Category:** Feature
**Complexity:** Medium

**Goal:** Check GitHub releases for updates and notify user.

**Implementation:**
- [ ] GitHub API: `GET /repos/{owner}/{repo}/releases/latest`
- [ ] Compare current version vs latest release
- [ ] Show notification in UI (non-intrusive)
- [ ] Download button links to release page or auto-downloads
- [ ] Check on startup + periodic (daily)

**Considerations:**
- Rate limiting (GitHub API: 60 req/hour unauthenticated)
- Cache check result for session
- User preference to disable

---

### 8. In-Place Software Upgrade
**Status:** Not Started
**Category:** Feature
**Complexity:** High

**Current Problem:** Windows users must uninstall → reinstall for updates.

**Proposed Solution:**
```
Upgrade Flow:
─────────────
1. Download new installer to temp location
2. Create upgrade script that:
   - Waits for app to close
   - Runs new installer silently
   - Cleans up temp files
3. App spawns upgrade script and exits
4. Upgrade script takes over

Alternative: NSIS upgrade-aware installer
- Detect existing installation
- Backup user data
- Upgrade in place
- Restore user data
```

**Tasks:**
- [ ] Research PyInstaller + NSIS upgrade patterns
- [ ] Implement upgrade detection in installer
- [ ] Create upgrade script generator
- [ ] Test upgrade path thoroughly
- [ ] Handle rollback on failure

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
**Status:** Not Started
**Category:** Feature
**Complexity:** Medium

**Goal:** Native Windows notifications for new messages.

**Implementation options:**
```
Option A: win10toast / win11toast
─────────────────────────────────
- Python library for Windows notifications
- Simple, works with PyInstaller
- Limited customization

Option B: plyer
───────────────
- Cross-platform notifications
- Works on Windows, Mac, Linux
- Good for future multi-platform support

Option C: pywebview notification API
────────────────────────────────────
- If pywebview supports it
- Native integration
```

**Tasks:**
- [ ] Choose notification library
- [ ] Implement notification service in backend
- [ ] Trigger on new message detection during sync
- [ ] Add notification preferences (enable/disable, sound)
- [ ] Handle click-to-open behavior

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
7. P2.13: Desktop notifications

### Phase 3: Growth & Security
8. P1.6: Randomized sync
9. P2.7: Version update check
10. P2.8: In-place upgrade

### Phase 4: Major Features
11. P1.4: Multi-service support
12. P1.5: Anonymous analytics & community statistics
13. P3.14: Blog support
14. P2.12: i18n

### Phase 5: Advanced Features
15. P3.17: Fuzzy search
16. P3.15: Transcription
17. P4.19: Post-processing phase
18. P4.18: Vector DB

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
| 2026-01-13 | Marked Phase 1 & 2 complete: P0.1, P1.2, P1.3, P2.10, P2.11 all done |
| 2026-01-13 | Added P1.5: Anonymous Analytics & Community Statistics (19 items total) |
| 2026-01-11 | Initial roadmap created with 18 items |
