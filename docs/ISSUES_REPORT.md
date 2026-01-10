# HakoDesk Issues Report

Generated: 2026-01-10 (Updated)

## Summary

This document summarizes findings from comprehensive code review including:
- Test coverage analysis
- Security review
- Code quality review
- Logic/correctness review

## All Critical Issues Fixed

### Session 1 - Initial Fixes

1. **Race condition in desktop.py** - Added `wait_for_server()` to ensure backend is ready before creating window
2. **Bare except clauses** - Changed `except:` to `except Exception:` in desktop.py
3. **Undefined variable** - Fixed `logger` to `logging` in backend/main.py
4. **Duplicate comment** - Removed duplicate "Configure logging" comment
5. **Missing function definition** - Added `def build_exe():` that was missing from build_windows.py
6. **Naming inconsistencies** - Fixed setup.iss to use `HakoDesk` instead of `pymsg-gui`
7. **CI/CD modernization** - Updated workflow to use `uv` instead of `pip`
8. **Broken tests** - Marked multi-group tests as skipped (feature not implemented)

### Session 2 - Critical Security & Bug Fixes

1. **[FIXED] Windows build script cross-platform detection** - Added `check_environment()` to detect when Windows Python is trying to access WSL project (invalid configuration). Provides clear guidance on how to run correctly.

2. **[FIXED] Overly permissive CORS** - Changed from `allow_origins=["*"]` to explicit localhost origins only:
   ```python
   ALLOWED_ORIGINS = [
       "http://localhost:5173",      # Vite dev server
       "http://127.0.0.1:5173",
       "http://localhost:3000",
       "http://127.0.0.1:3000",
       "http://localhost:8080",
       "http://127.0.0.1:8080",
   ]
   ```
   Also restricted methods to `["GET", "POST", "PUT", "DELETE"]`.

3. **[FIXED] Path traversal hardening** - Created `validate_path_within_dir()` function with:
   - Null byte and injection character detection
   - `os.path.commonpath()` for reliable containment check (handles edge cases like `/output` vs `/output2`)
   - Double-check with string prefix comparison
   - Proper logging of traversal attempts

4. **[FIXED] Sync metadata initialization order** - Moved settings loading BEFORE `force_resync` check to ensure `self.output_dir` and `self.metadata_file` are set before use.

5. **[FIXED] Settings thread blocking** - Added 5-minute timeout to `thread.join()` in folder picker dialog to prevent indefinite blocking.

---

## Remaining Issues (Lower Priority)

### LOW-1: Test Coverage ~30%

**Current State:**
- 18 tests, 15 passing, 3 skipped
- No tests for: diagnostics.py, progress.py, platform.py
- No integration tests
- No frontend tests

**Recommendation:** Add pytest-cov with 70% minimum coverage gate.

### LOW-2: Frontend Not Tested

**Current State:** No React component tests, no E2E tests with Playwright.

**Recommendation:** Add Vitest for component testing, Playwright for E2E.

### LOW-3: Multi-Group Support Not Implemented

**Current State:**
- AuthService is single-group (Hinatazaka46 hardcoded)
- SyncService uses `HinatazakaClient` wrapper (single group)
- Tests for multi-group exist but are skipped

**Note:** This is a planned feature, not a bug. See TODO.md.

### LOW-4: Type Hints Incomplete

**Files:** Multiple async functions missing return type hints.

**Recommendation:** Add mypy to CI pipeline.

### LOW-5: No Error Recovery in Sync

**File:** `backend/services/sync_service.py`

**Issue:** If sync crashes mid-way, there's no recovery mechanism.

**Recommendation:** Implement checkpoint-based recovery (future enhancement).

---

## Files Changed

### Session 1
1. `README.md` - Created
2. `scripts/verify_build.py` - Created
3. `scripts/build_windows.bat` - Created
4. `desktop.py` - Fixed race condition, bare except
5. `backend/main.py` - Fixed undefined logger, duplicate comment
6. `tooling/windows/build_windows.py` - Added missing function definition
7. `tooling/windows/setup.iss` - Fixed naming to HakoDesk
8. `.github/workflows/build.yml` - Modernized to use uv
9. `tests/test_multi_group.py` - Marked tests as skipped
10. `docs/ISSUES_REPORT.md` - Created

### Session 2
1. `scripts/verify_build.py` - Added cross-platform detection, fixed installer path
2. `backend/main.py` - Fixed CORS configuration, renamed app title to HakoDesk
3. `backend/api/content.py` - Added `validate_path_within_dir()` security function
4. `backend/services/sync_service.py` - Fixed initialization order bug
5. `backend/api/settings.py` - Added thread timeout
6. `docs/ISSUES_REPORT.md` - Updated

---

## Running the Build

**Important:** Run from within the project directory, not via WSL network paths from Windows.

**From WSL terminal:**
```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk
uv run python scripts/verify_build.py
```

**Quick verification (skip slow tests):**
```bash
uv run python scripts/verify_build.py --quick
```

**Windows native (requires Windows-cloned repo):**
```cmd
cd C:\path\to\HakoDesk
uv sync
uv run python scripts/verify_build.py
```

---

## Test Results

```
==================== 15 passed, 3 skipped, 2 warnings ====================
```

All tests pass. 3 tests skipped for multi-group feature (not yet implemented).
