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
**Status:** Not Started
**Category:** Bug Fix
**Complexity:** Medium

**Problem:** Unread indicator does not display correctly.

**Investigation needed:**
- [ ] Trace how unread state is tracked (frontend state vs backend)
- [ ] Check if `last_read_id` is being saved/loaded correctly
- [ ] Verify unread count calculation logic
- [ ] Test across app restarts

**Files likely involved:**
- `frontend/src/App.tsx` - state management
- `backend/api/content.py` - `last_read_id` handling
- `backend/services/settings_service.py` - persistence

---

## P1: High Priority Features

### 2. User Nickname Resolution (%%% Placeholder)
**Status:** Not Started
**Category:** Enhancement
**Complexity:** Medium

**Goal:** Replace `%%%` placeholder in messages with actual user nickname.

**Approach:**
- [ ] Investigate HAR files for nickname endpoint
- [ ] Check if pyhako core already supports this
- [ ] Add nickname fetching to auth/sync flow
- [ ] Store nickname in settings or credentials
- [ ] Replace `%%%` in message rendering (frontend)

**Notes:**
- `%%%` is the official app's placeholder for user nickname
- Need to handle case where nickname is not available (show `%%%` or generic text)

---

### 3. Smart Token Refresh & Health Check
**Status:** Not Started
**Category:** Architecture
**Complexity:** High

**Current Problem:** Token refreshed on every auth check, wasteful and detectable.

**Proposed Architecture:**

```
Option A: Lazy Refresh (Recommended)
─────────────────────────────────────
- Only refresh when token is about to expire (e.g., < 5 min remaining)
- Check expiry before each API call
- Minimal server contact

Option B: Separate Health Check Thread
──────────────────────────────────────
- Background thread with heartbeat
- Periodic health checks (randomized interval)
- Token refresh only when needed
- Pros: Proactive detection of session issues
- Cons: More complexity, more server contact
```

**Decision needed:** Which option to implement?

**Tasks:**
- [ ] Analyze token structure (JWT? expiry field?)
- [ ] Check pyhako core for expiry handling
- [ ] Implement chosen approach
- [ ] Add token expiry to diagnostics

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

### 5. Randomized Background Sync
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

### 6. Built-in Version Update Check
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

### 7. In-Place Software Upgrade
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

### 8. Staged Rollout System
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

### 9. Diagnostic System Review
**Status:** Not Started
**Category:** Technical Debt
**Complexity:** Low-Medium

**Goal:** Review and improve current diagnostics for debugging.

**Review checklist:**
- [ ] Is all relevant system info captured?
- [ ] Are logs sufficient for debugging?
- [ ] Is sensitive data properly redacted?
- [ ] Can diagnostics be exported for support?

**Potential improvements:**
- [ ] Add token expiry status (redacted)
- [ ] Add sync history summary
- [ ] Add performance metrics
- [ ] Add "copy to clipboard" for support

---

### 10. Voice Item UI/UX Improvements
**Status:** Not Started
**Category:** UI/UX
**Complexity:** Low-Medium

**Current:** Basic audio player

**Improvements:**
- [ ] Volume slider on hover (appears near volume icon)
- [ ] Click volume icon to mute/unmute
- [ ] Visual waveform display (optional, nice-to-have)
- [ ] Keyboard shortcuts (space to pause, arrow keys to seek)
- [ ] Remember volume preference

**Component:** `frontend/src/components/AudioPlayer.tsx` (or similar)

---

### 11. Multi-Language Support (i18n)
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

### 12. Windows Desktop Notifications
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

### 13. Official Blogs Support
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

### 14. Audio/Video Transcription (Whisper)
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

### 15. Fan Club Contents Support
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

### 16. Fuzzy Search (Multi-Language)
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

### 17. Vector Database per Chat Room
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

### 18. Sync Phase 4: Post-Processing
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

### Phase 1: Stability & Core Fixes
1. P0.1: Unread indicator fix
2. P1.3: Smart token refresh
3. P2.9: Diagnostic review

### Phase 2: User Experience
4. P1.2: Nickname resolution
5. P2.10: Voice UI improvements
6. P2.12: Desktop notifications

### Phase 3: Growth & Security
7. P1.5: Randomized sync
8. P2.6: Version update check
9. P2.7: In-place upgrade

### Phase 4: Major Features
10. P1.4: Multi-service support
11. P3.13: Blog support
12. P2.11: i18n

### Phase 5: Advanced Features
13. P3.16: Fuzzy search
14. P3.14: Transcription
15. P4.18: Post-processing phase
16. P4.17: Vector DB

### Deferred
- P2.8: Staged rollout (when user base grows)
- P3.15: Fan club (blocked on core)

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
| 2026-01-11 | Initial roadmap created with 18 items |
