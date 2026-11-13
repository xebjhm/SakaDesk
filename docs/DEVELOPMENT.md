# SakaDesk Development Guide

## Quick Start

`./dev.sh` (Linux/macOS) or `.\dev.ps1` (Windows) starts the backend and the
Vite dev server. Once the frontend answers, `dev.sh` prints the app URL and
`dev.ps1` opens it in your browser: `http://127.0.0.1:5173/#t=<token>`.

The local API requires a per-launch token (`X-SakaDesk-Token`), and the dev
server's `/api` proxy does not add it: the page authenticates itself with the
`#t=` token in its URL, like SakaDesk's own windows. By hand, generate the
token once into the git-ignored `.dev-api-token` (the file the scripts use)
and read it in each terminal that needs it:

```bash
cd /path/to/SakaDesk
uv sync
(umask 077 && uv run python -c "import secrets; print(secrets.token_urlsafe(32))" > .dev-api-token)

# Backend
export SAKADESK_API_TOKEN=$(cat .dev-api-token)
uv run uvicorn backend.main:app --port 8000 --reload

# Frontend (separate terminal; Vite does not read the token)
cd frontend
npm install
npm run dev

# The app URL (open it in your browser)
echo "http://127.0.0.1:5173/#t=$(cat .dev-api-token)"
```

The dev server listens on 127.0.0.1 only and proxies `/api` to the backend.
The page moves the token out of the address bar on load and keeps it for that
tab only. A tab opened without `#t=` has no token, so the API answers its
changes with 401 (and its reads too, unless an earlier tab left the media
cookie): reopen it with the app URL.

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

Test mode (`SAKADESK_TEST_MODE=true`) bypasses real OAuth and returns fixture data.

The Playwright config pins the test server's `SAKADESK_API_TOKEN`
(`e2e/apiToken.ts`) and sends it as the `X-SakaDesk-Token` header from every
page. `e2e/launch-auth.spec.ts` turns that header off and checks the real
`#t=` launch path instead; the backend serves `frontend/dist`, so run
`npm run build` first.

#### Option 2: Real Auth - For Manual Testing

For testing the complete flow with real authentication:

**Step 1: Start backend in normal mode**

The local API requires a per-launch token. Use the one in `.dev-api-token`
(see Quick Start for how to create it); the backend serves `frontend/dist`, so
build the frontend first:

```bash
cd /path/to/SakaDesk
(cd frontend && npm run build)
export SAKADESK_API_TOKEN=$(cat .dev-api-token)
uv run uvicorn backend.main:app --port 8000 --reload
```

**Step 2: Login manually**

Open `http://localhost:8000/#t=<token>` in a browser, with the value of
`SAKADESK_API_TOKEN` / `.dev-api-token` as `<token>`
(`echo "http://localhost:8000/#t=$(cat .dev-api-token)"` prints it), and
complete the login flow. This saves your session. Without `#t=` every `/api`
call answers 401.

**Step 3: Save auth state for Playwright**

Playwright sends `SAKADESK_API_TOKEN` as the header, so export the same value
in this terminal:

```bash
export SAKADESK_API_TOKEN=$(cat .dev-api-token)
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
| **Dev Mode** (`SAKADESK_DEV_MODE=true`) | Linux development | Real OAuth | Real API, plaintext creds |
| **Test Mode** (`SAKADESK_TEST_MODE=true`) | E2E/Integration testing | Mocked | Fixture data |

### Environment Variables

```bash
# Development on Linux (already automatic)
SAKADESK_DEV_MODE=true

# Enable test mode for E2E testing
SAKADESK_TEST_MODE=true

# Pin the local API token for a source run (dev servers, e2e). At least 16
# characters; the dev page's #t= URL accepts 16-128 of A-Z a-z 0-9 _ -.
# Unset, the backend draws a random token. The packaged app ignores it.
SAKADESK_API_TOKEN=<token>
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
SAKADESK_DEV_MODE=true uv run uvicorn backend.main:app --port 8000 --reload --log-level debug
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
- Ensure `SAKADESK_TEST_MODE=true` is set
- Check backend is running on port 8000

### Every `/api` request answers 401 in the dev page
- The tab was opened without `#t=<token>`: reopen it with the URL `dev.sh`
  prints / `dev.ps1` opens (`http://127.0.0.1:5173/#t=` plus the contents of
  `.dev-api-token`)
- The backend runs with a different `SAKADESK_API_TOKEN` than the URL's
  token: restart both with `dev.sh` / `dev.ps1`, or export the value from
  `.dev-api-token` before starting the backend

### Snapshot test failures
- Review the diff: is the change intentional?
- Update with `npm run test:run -- -u`

### MSW "unhandled request" errors
- Add missing handler to `frontend/src/__tests__/mocks/handlers.ts`
