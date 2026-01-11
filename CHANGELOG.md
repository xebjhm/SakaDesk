# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive feature roadmap with 18 planned items
- Session expiration detection with automatic redirect to login
- pyhako TokenManager integration for secure credential storage
- E2E testing infrastructure with Playwright
- Integration tests with MSW (Mock Service Worker)
- Snapshot tests for UI components
- TEST_MODE for backend E2E testing support
- Comprehensive backend test suite (83 tests)
- Frontend unit tests with Vitest and React Testing Library
- mypy type checking in CI pipeline
- pytest-cov with 50% minimum coverage gate

### Changed
- Auth/sync flow now follows pyhako CLI pattern
- Token refresh only saves when tokens actually change
- Fresh SyncManager created for each sync (prevents stale client issues)

### Fixed
- Session expiration now properly redirects to login instead of failing silently
- Sync works immediately after re-login (no restart required)
- Type errors for mypy compliance

## [0.1.0] - 2026-01-11

### Added
- Initial HakoDesk GUI application
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

[Unreleased]: https://github.com/user/hakodesk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/user/hakodesk/releases/tag/v0.1.0
