# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/xebjhm/SakaDesk/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/xebjhm/SakaDesk/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/xebjhm/SakaDesk/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/xebjhm/SakaDesk/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xebjhm/SakaDesk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xebjhm/SakaDesk/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xebjhm/SakaDesk/releases/tag/v0.1.0
