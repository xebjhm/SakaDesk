# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **A first sync only kept each member's most recent 1000 messages**, silently
  leaving out older history even though it had already been downloaded. A fresh
  sync now saves a member's complete message history. Members you synced before
  this fix stay capped until you run a full re-sync (Force Resync), which now
  back-fills their older messages and media.

## [0.3.2] - 2026-07-08

### Fixed
- **Terminal/console windows popping up on their own, sometimes several times**:
  the app's silent login-refresh tried to drive a bundled headless browser that
  the installer does not ship, which kicked off a runtime Chromium download in a
  visible console window (and retried on network hiccups). The refresh now reuses
  your already-installed Chrome/Edge — the same browser used to log in — so
  nothing is downloaded, and the packaged app now keeps any child process
  windowless as a safety net.
- **Your selected groups, favorites, layout and open chats could reset to
  defaults on launch**: a start-up timing issue occasionally saved a blank
  default state over your real one. Your saved settings are now loaded before
  anything can overwrite them, and the app reliably reopens on your last group.
- **A settings change made right before closing the app could be lost**: pending
  changes (a toggle you just flipped, the conversation you last read, scroll
  position) are now flushed when the window closes instead of being dropped.
- **Favoriting a message could silently undo itself**: when the server rejected a
  favorite the star stayed lit until the next reload; a failed favorite now
  reverts immediately and tells you it didn't save. Favorites also update the
  correct message when two groups share a message number.
- **Date search and the calendar could jump to or highlight the wrong day** for
  messages around midnight, because dates were bucketed in UTC while messages
  display in your local time. Both now use local dates consistently.
- **Sync could not be stopped once it was verifying files, and the sync window
  could get stuck spinning** on an error. Cancelling now stops the verify pass
  too, the window is always dismissable, and sync errors show a readable message.
- **Search could silently drop results or show wrong totals** when two groups
  happened to share a message number; results are now counted per group.
- **The app could freeze while browsing a large library**: heavy disk, database
  and credential reads now run off the main request path, so the UI and media
  playback stay responsive.
- **Launching a second copy (or reopening quickly after closing) showed a
  "Server failed to start" error**: a real single-instance check now focuses the
  running window instead, and the start-up wait was lengthened to cover a normal
  close-then-reopen. A minimized-then-closed window no longer restores off-screen.
- **An interrupted in-place update could roll back after locking program files**:
  the updater now shuts the app's background worker down before exiting, and the
  uninstaller only removes the app's own files instead of the whole chosen folder.

- **Translation "API key not set" even when it looked configured**: the AI
  settings panel could show the key as "saved securely" while it was actually
  missing from the OS credential store, so translation failed with a confusing
  message. The panel now warns clearly when a provider is set but no key is
  stored, and the status self-heals after a failed translation.
- **Window grew on every restart** at non-100% display scaling; window geometry
  is now correct at any DPI scale and across multiple monitors.
- **Manual "Check for updates"** now forces a live check instead of possibly
  reporting a stale "up to date".
- **In-place updates** now close a running app cleanly (WM_CLOSE) instead of
  risking a rolled-back install.
- **Blog metadata sync** no longer fails with an "access denied" error when
  another process briefly holds the blog index (antivirus/search indexer); the
  write is retried.

### Security
- **The built-in bug report could put which group/member you message into the
  public issue it opens.** Bug reports and copied diagnostics are now scrubbed —
  the specific member and any custom data-folder path are removed before anything
  leaves the app.
- Hardened the local API against path traversal, DNS-rebinding, and
  cross-origin/CSRF (SEC-1, SEC-2, API-I2).
- Self-update downloads are restricted to HTTPS GitHub hosts (SEC-4).
- Secrets are scrubbed from diagnostics and issue-report output (SEC-5).
- Blog image proxy no longer follows redirects and is size-capped (API-I3).
- Credential store no longer silently falls back to a plaintext keyring
  (opt-in only; SEC-3).
- Fixed a sync-cancellation data-corruption risk (SVC-C1) plus assorted
  sync/blog/search correctness fixes.

## [0.3.1] - 2026-07-04

### Added
- **Verify & Fix media** (Settings → Sync): scans downloaded messages and
  re-downloads any missing images/videos, per service.
- **Deep re-verify** (Settings → Sync): an on-demand full re-sync that re-checks
  every member's entire timeline from scratch and re-downloads anything missing
  (files already saved are skipped). Catches gaps the media-only check cannot —
  including entirely-missing messages. Behind a confirm, as it is slower and makes
  many API requests.
- A clear warning when logging into **Yodel** from outside Japan — Yodel's web
  service is Japan-only, so a login from another region can't reach its servers.
  The app now detects this before login and explains how to proceed (connect from
  Japan and try again) instead of failing silently.

### Fixed
- Interrupted syncs no longer permanently skip message media — the sync cursor is
  held behind any message whose media has not been confirmed on disk.
- API key and login are no longer dropped on app update or reinstall. Credentials
  are now isolated per entry in the OS keyring (via pysaka 0.4.2), so a routine
  session refresh can no longer overwrite a stored translation/AI API key.
- Translation no longer fails with `no_model` when the saved config omits a model;
  it falls back to the default and self-heals the stored value.
- The log directory now honors `SAKADESK_DATA_DIR`.
- **Verify & Fix media no longer overstates completeness.** Media messages whose
  media has no downloadable source (e.g. expired-media stubs) are now reported as
  unresolved instead of being silently counted as present, and the "all present"
  message is scoped to downloaded messages — so the check never claims complete
  while media is unaccounted for.
- Uninstall now removes the correct saved credentials and auth data (it targeted
  stale `pyzaka`/`zakadesk` names before, missing the current `pysaka` entries).
- **Blog backup now resumes safely after an interruption.** Blog content and
  images are written atomically, and a blog left partial by a crash/interruption
  is detected and re-downloaded instead of being skipped as "done".
- The sync progress window no longer looks stuck after finishing: the
  "downloading media… do not close" warning now clears on completion, and a Done
  button lets you dismiss it (it also auto-closes).
- Settings → AI now opens without waiting on the OS keyring. The key-status read
  behind `/api/translation/config` is cached in memory (warmed at startup,
  invalidated on save/clear) instead of being re-read on every open; a brief
  loading indicator covers the first open after launch.

### Changed
- Starting **Verify & Fix media** now closes the settings panel so the validation
  progress and result are in focus.
- The **Deep re-verify** confirmation now uses an in-app styled dialog matching the
  rest of the UI, instead of the browser-native `window.confirm` popup.
- After **Verify & Fix media**, the progress window stays open and shows the
  results — any media with no available source is listed by **member and date**
  (with a Done button to dismiss) instead of the panel auto-closing.
- **Withdrawn (member-canceled) posts** are now hidden from the message list and
  no longer counted as missing media. Their status is recorded in the synced data
  on disk but not shown. Existing messages pick this up after a re-sync (which
  backfills the message `state`); Deep re-verify does a full backfill.
- **Translation** is no longer marked "Experimental".
- The translation **target language** in Settings → AI now appears immediately
  (from the saved value) instead of waiting for the config to load.
- **Blog backup** wording and progress are clearer: it's called "backup" (not
  "cache"), the size shows a "Calculating backup size…" indicator, and an active
  backup shows "Backing up blogs… X of Y".

## [0.3.0] - 2026-07-01

### Added
- **AI transcription** — on-demand Gemini transcription of voice/video messages
  with timeline-synced segments and click-to-seek subtitles; structured-output
  timestamps, File API for large audio, and safety-block handling.
- **AI translation** — immersive blog translation with in-place DOM injection,
  per-message translation, a unified translate button with error state, and
  provider/model settings.
- **Mobile auth mode** — per-service auth mode (web/mobile) with a redesigned
  account tab, manual refresh_token entry, an Android request profile, and a
  login-time mode choice; rows scoped to connected services.
- **Two-way unread sync (opt-in)** — opening a room in SakaDesk can clear its
  unread on the official app (Windows → phone), and the unread badge reflects
  reads made on the phone (phone → Windows).
- **Blog photo gallery ("Album")** — photo gallery modal with post dates, wired
  into the member timeline, with jump-to-message from a photo.
- **Clipboard copy** — Ctrl+C to copy media to the clipboard in the media viewer.
- **Media gallery** — jump-to-message from photo/video/voice detail via clickable
  timestamps, per-row transcript previews, source labels with a jump action.
- **Settings redesign** — left-sidebar tabs, a shared "AI Provider" block for
  transcription + translation, "Reset to defaults", and "Clear API key".
- Rerun buttons for transcription and translation; diagnostics bundle filename;
  release CI infrastructure.

### Changed
- Unified the Voice, Video, and Photo players into shared components that own
  their transcription across bubble, gallery, and fullscreen contexts.
- Gemini model list centralized and updated to GA IDs (gemini-3.1); stale model
  names auto-reset to default on config load.
- Message/media panels auto-expand and auto-collapse based on visibility.
- Desktop window geometry migrated into settings.json; no longer shrinks on restart.
- Requires **pysaka >= 0.4.0** (mobile auth mode, two-way unread sync, data-loss fixes).

### Fixed
- Numerous transcription/subtitle-sync, auto-expand/collapse, and fullscreen
  control fixes across the media players.
- Auth: reconnection cooldown stops the login dialog re-triggering; disconnect
  state preserved across auth refresh; rotated refresh_token persisted.
- Translation no longer caches truncated (`MAX_TOKENS`/`RECITATION`) output as a
  success; fullscreen photo viewer recovers after a broken image; transcript
  auto-scroll no longer skips every other active segment.
- Many i18n corrections across the 5 locales.

### Removed
- Local Whisper transcription model (transcription is now Gemini-only).

## [0.2.4] - 2026-03-29

### Added
- **Upgrade system redesign** — replaced fragile batch script with direct Inno Setup `/SILENT` invocation; two-stage upgrade icon in service rail replaces top gradient banner
- SHA-256 verification for downloaded installers (mandatory, refuses unverified files)
- Download integrity checks: file size validation + 500 MB download cap
- `auto_download_updates` setting with toggle in Settings (default: OFF, opt-in)
- "Check for Updates" button in Settings for manual version checks
- Auto-relaunch after silent install via Inno Setup `[Run]` section
- Graceful app shutdown before installer launch
- Shorter 5-minute cache TTL for failed GitHub release checks (vs 1 hour for success)
- Download button click tracking via Vercel Analytics custom events on website
- i18n keys for upgrade UI in all 5 locales (EN, JA, ZH-CN, ZH-TW, YUE)

### Changed
- Upgrade icon uses ArrowUpCircle (ready) and Loader2 (launching) icons
- Voice player no longer auto-repeats by default
- Video player: loop, speed, and download controls moved into three-dot menu
- Website screenshots replaced with high-res WebP format

### Security
- Installer filename sanitized to prevent path traversal via crafted API response
- `release_url` validated against `github.com` origin before opening
- Auto-download defaults to OFF — requires explicit user opt-in for silent downloads

### Removed
- `UpdateBanner.tsx` — replaced by `UpgradeIcon` in service rail
- Batch script upgrade mechanism (`generate_upgrade_script`, `launch_upgrade`)
- `/upgrade/launch` API endpoint — replaced by `/upgrade/install`

## [0.2.3] - 2026-03-22

### Added
- Landing page website with i18n support (EN, JA, ZH-TW, ZH-CN) and screenshot carousel — Astro static site with Tailwind CSS for Vercel deployment
- GPL-3.0 license

## [0.2.2] - 2026-03-22

### Fixed
- **Critical:** Sync cascade causing 164 syncs per session instead of 4 — React effect dependency chain created feedback loop where sync completion triggered immediate re-sync
- **Critical:** Blog backup timeout storm — all blog downloads fired concurrently, overwhelming the connection pool and causing mass TimeoutError
- Settings file contention on Windows — `os.replace()` fails when antivirus locks the file; added retry with backoff
- User nickname (%%%) placeholder visible on app load — nicknames now cached during sync and returned in settings API response
- Adaptive sync always hitting 5-minute floor due to `sync_interval_minutes` default of 1

### Changed
- Adaptive sync base interval hardcoded to 10 minutes, decoupled from user setting (which only applies to fixed-interval mode)
- Time-of-day multipliers rebuilt from 13,132 actual Hinatazaka46 messages — peak hours (20:00 JST) now sync every ~5 min, dead hours (01:00-06:00) every ~30 min
- Blog download concurrency limited to 5 concurrent blogs (was unbounded), image semaphore reduced from 50 to 20
- Memoized `connectedServices` in AuthContext to prevent unnecessary effect re-runs
- Nickname refresh runs once per app session (first sync), subsequent syncs use cache
- Removed unused activity multiplier from adaptive sync (was dead code)

## [0.2.1] - 2026-03-21

### Changed
- **Breaking:** Rebranded from HakoDesk to SakaDesk across the entire codebase
- Renamed SDK dependency from pyhako to pysaka (requires pysaka >= 0.3.0)
- Externalized remaining hardcoded Japanese strings to i18n locale files
- Replaced ToS acknowledgement list with official service excerpts
- Moved BlogBackupManager to dedicated background thread
- Centralized settings defaults in settings_store

### Added
- Pre-commit hooks (ruff, mypy, tsc, eslint) for development quality gates
- Comprehensive backend test suites (23 new modules, 80%+ coverage)
- Frontend test suites for SyncModal, useSettings, syncFormatters, downloads
- Atomic file writes for blog index and sync metadata (prevents corruption)
- Batch operations: check_new_messages, group timeline fetch, blog metadata
- ProcessPoolExecutor for GIL-free search index builds
- Timestamp-based sync cursor (replaces message-ID cursor)
- Log rotation with separate error.log
- Video player loop toggle button (replaces auto-loop)
- Blog recent posts cache with Zustand persistence

### Fixed
- Concurrent image downloads bounded to prevent timeout
- React effect dependency stability with useRef in BlogsFeature and useSettings
- Conditional React hook calls in PhotoDetailModal
- TypeScript compilation errors in BlogsFeature
- mypy type errors in search_service, sync_service, and diagnostics
- Flaky BlogBackupManager tests replaced time.sleep with threading.Event
- Frontend snapshot tests compatible with pre-commit whitespace hooks
- Prevent concurrent browser login launches
- freeze_support() added to prevent duplicate app on Windows
- Search indexing moved to background to unblock sync Phase 3

### Security
- CI hardened with explicit permissions per job
- Version validation in Inno Setup to prevent command injection
- Coverage threshold enforced at 80% for backend

## [0.2.0] - 2026-03-16

### Added
- Multi-service architecture — sync and view multiple services simultaneously
- First-launch onboarding flow with login carousel and sequential sync
- Per-service inline sync progress view (replaces empty-state confusion)
- Global fuzzy search across messages and blogs with keyword highlighting
- Blog feature with full-text search, member filtering, and media gallery
- Blog full backup with parallel downloading and background processing
- Internationalization (i18n) with 5 languages: English, Japanese, Traditional Chinese, Simplified Chinese, Cantonese
- Service-themed UI with per-group color schemes and ambient backgrounds
- Yodel service support
- Member favorites and custom service/feature ordering via drag-and-drop
- Adaptive sync with smart timing based on posting patterns
- Desktop notification support (hidden until stable)
- In-app update checker with version comparison
- DPI-aware window geometry save/restore
- Search index with reader-writer executor split for concurrent access
- Settings UI with blog backup status, sync interval, and output folder picker
- About dialog with diagnostics and issue reporting
- Session expiration detection with automatic re-login prompt
- Comprehensive test suites: backend (83 tests), frontend (Vitest), E2E (Playwright)

### Changed
- Auth/sync flow follows pysaka CLI pattern with TokenManager integration
- FastAPI lifecycle migrated from deprecated `on_event` to `lifespan` context manager
- Folder picker uses async executor instead of blocking thread.join
- PriorityPool replaced with per-operation TCPConnector limits
- Structured logging uses keyword args instead of f-strings throughout
- Requires pysaka >= 0.2.0

### Fixed
- XSS vulnerability in search result snippets — now sanitized with DOMPurify
- Internal exception details no longer leaked in HTTP 500 responses
- `metadata_file` initialized in SyncService `__init__` with runtime guard
- `member_ids` query parameter validates integer conversion (400 vs 500)
- DPI scaling drift on window geometry save/restore
- Sync works immediately after re-login (no restart required)
- Session expiration properly redirects to login

### Security
- Search snippets sanitized with DOMPurify (ALLOWED_TAGS: mark only)
- HTTP 500 responses return generic message, full errors logged server-side
- Structured logging prevents credential leakage via f-strings

## [0.1.0] - 2026-01-11

### Added
- Initial SakaDesk GUI application
- Cross-platform support (Windows production, Linux/Mac development)
- Secure credential storage via Windows Credential Manager
- Browser-based OAuth authentication flow
- Real-time sync progress tracking with ETA
- Message viewing with media support (images, videos, voice)
- Audio playback with progress bar
- Scroll position restoration per chat
- Media dimension pre-calculation for smooth loading
- Chat list with member avatars and unread indicators
- Diagnostics endpoint for debugging
- Cross-platform build verification scripts
- GitHub Actions CI/CD pipeline

### Security
- API hardened against common vulnerabilities
- Rate limiting on sensitive endpoints
- Input validation and sanitization

[Unreleased]: https://github.com/xebjhm/SakaDesk/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/xebjhm/SakaDesk/compare/v0.3.1...v0.3.2
[0.2.4]: https://github.com/xebjhm/SakaDesk/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/xebjhm/SakaDesk/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/xebjhm/SakaDesk/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xebjhm/SakaDesk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xebjhm/SakaDesk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xebjhm/SakaDesk/releases/tag/v0.1.0
