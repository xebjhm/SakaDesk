# HakoDesk Development Guide

## Quick Start

```bash
# Backend
cd /path/to/HakoDesk
uv sync
uv run uvicorn backend.main:app --port 8000 --reload

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 (frontend dev server proxies to backend).

---

## Testing

### Backend Tests (pytest)

```bash
# Run all tests
uv run pytest -v

# Run with coverage
uv run pytest --cov=backend --cov-report=term-missing

# Run specific test file
uv run pytest tests/test_api_smoke.py -v
```

### Frontend Unit Tests (Vitest)

```bash
cd frontend

# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run with coverage
npm run test:coverage
```

### Frontend Integration Tests

Integration tests use MSW (Mock Service Worker) to mock API responses. They test component interactions with mocked backends.

```bash
cd frontend
npm run test:run
```

Integration tests are in `src/*.integration.test.tsx` files.

### Frontend E2E Tests (Playwright)

E2E tests run against the full stack (backend + frontend).

#### Option 1: Test Mode (Mocked Auth) - For CI/Quick Testing

```bash
cd frontend

# Run all E2E tests (starts backend in test mode automatically)
npm run test:e2e

# Run with browser UI
npm run test:e2e:ui

# Run headed (see the browser)
npm run test:e2e:headed
```

Test mode (`HAKODESK_TEST_MODE=true`) bypasses real OAuth and returns fixture data.

#### Option 2: Real Auth - For Manual Testing

For testing the complete flow with real authentication:

**Step 1: Start backend in normal mode**

```bash
cd /path/to/HakoDesk
uv run uvicorn backend.main:app --port 8000 --reload
```

**Step 2: Login manually**

Open http://localhost:8000 in a browser and complete the login flow. This saves your session.

**Step 3: Save auth state for Playwright**

```bash
cd frontend
npx playwright test --headed --project=chromium e2e/save-auth.spec.ts
```

This saves your authenticated session to `frontend/.auth/user.json`.

**Step 4: Run E2E tests with real auth**

```bash
# Set env var to use saved auth state
PLAYWRIGHT_AUTH_FILE=.auth/user.json npm run test:e2e
```

---

## Test Mode vs Development Mode

| Mode | Purpose | Auth | Data |
|------|---------|------|------|
| **Normal** | Production/Dev | Real OAuth | Real API |
| **Dev Mode** (`HAKODESK_DEV_MODE=true`) | Linux development | Real OAuth | Real API, plaintext creds |
| **Test Mode** (`HAKODESK_TEST_MODE=true`) | E2E/Integration testing | Mocked | Fixture data |

### Environment Variables

```bash
# Development on Linux (already automatic)
HAKODESK_DEV_MODE=true

# Enable test mode for E2E testing
HAKODESK_TEST_MODE=true
```

---

## Snapshot Testing

Snapshot tests capture component output and compare against saved baselines.

```bash
cd frontend

# Run tests (will fail if snapshots changed)
npm run test:run

# Update snapshots after intentional changes
npm run test:run -- -u
```

Snapshots are stored in `__snapshots__/` directories next to test files.

**When to update snapshots:**
- After intentional UI changes
- Review diff carefully before updating

---

## Code Coverage

### Backend

```bash
uv run pytest --cov=backend --cov-report=html
# On macOS/Linux: open htmlcov/index.html
# On Windows: start htmlcov/index.html
```

Coverage threshold: 50% minimum (enforced in CI)

### Frontend

```bash
cd frontend
npm run test:coverage
# On macOS/Linux: open coverage/index.html
# On Windows: start coverage/index.html
```

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/build.yml`) runs:

1. Frontend build (`npm run build`)
2. Frontend tests (`npm run test:run`)
3. Backend tests with coverage (`pytest --cov`)
4. Type checking (`mypy backend/`)
5. Windows installer build

---

## Debugging

### Backend Logs

```bash
# Enable debug logging
HAKODESK_DEV_MODE=true uv run uvicorn backend.main:app --port 8000 --reload --log-level debug
```

### Frontend DevTools

- React DevTools browser extension
- Network tab for API calls
- Console for errors

### Playwright Debug

```bash
cd frontend
PWDEBUG=1 npm run test:e2e
```

This opens Playwright Inspector for step-by-step debugging.

---

## Common Issues

### "Login failed" in tests
- Ensure `HAKODESK_TEST_MODE=true` is set
- Check backend is running on port 8000

### Snapshot test failures
- Review the diff: is the change intentional?
- Update with `npm run test:run -- -u`

### MSW "unhandled request" errors
- Add missing handler to `frontend/src/__tests__/mocks/handlers.ts`
