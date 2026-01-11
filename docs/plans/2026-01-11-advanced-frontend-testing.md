# Advanced Frontend Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add E2E testing (Playwright), integration testing (MSW), and snapshot testing (Vitest) to the HakoDesk frontend, with test mode bypass for authenticated flows.

**Architecture:** Create a backend test mode that bypasses real OAuth and returns fixture data. Use MSW to mock API responses for integration tests. Use Playwright for E2E tests with both mocked and real auth options. Add Vitest snapshots for existing component tests.

**Tech Stack:** Playwright, MSW (Mock Service Worker), Vitest snapshots, pytest fixtures

---

## Task 1: Add Backend Test Mode Environment Variable

**Files:**
- Modify: `backend/services/platform.py`
- Test: `tests/test_services_platform.py`

**Step 1: Add TEST_MODE detection to platform.py**

Add after line 14 (after DEV_MODE):

```python
# Environment variable to enable test mode (bypasses real auth)
TEST_MODE = os.environ.get("HAKODESK_TEST_MODE", "false").lower() == "true"


def is_test_mode() -> bool:
    """Check if running in test mode (for E2E testing)."""
    return TEST_MODE
```

**Step 2: Run existing tests to verify no breakage**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && uv run pytest tests/test_services_platform.py -v`
Expected: All tests pass

**Step 3: Add test for is_test_mode**

Add to `tests/test_services_platform.py` in TestDevModeDetection class:

```python
def test_is_test_mode_returns_bool(self):
    """is_test_mode() should return a boolean."""
    from backend.services.platform import is_test_mode
    result = is_test_mode()
    assert isinstance(result, bool)
```

**Step 4: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && uv run pytest tests/test_services_platform.py -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add backend/services/platform.py tests/test_services_platform.py
git commit -m "feat(backend): add TEST_MODE environment variable for E2E testing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Test Fixtures for Authenticated State

**Files:**
- Create: `backend/fixtures/__init__.py`
- Create: `backend/fixtures/test_data.py`

**Step 1: Create fixtures directory**

Run: `mkdir -p /home/xtorker/repos/Project-PyHako/HakoDesk/backend/fixtures`

**Step 2: Create __init__.py**

```python
"""Test fixtures for E2E testing."""
from .test_data import TEST_AUTH_CONFIG, TEST_GROUPS, TEST_MESSAGES, TEST_MEMBER
```

**Step 3: Create test_data.py**

```python
"""
Test fixtures for E2E and integration testing.
These fixtures simulate authenticated state and API responses.
"""

# Simulated authenticated config (bypasses real OAuth)
TEST_AUTH_CONFIG = {
    "access_token": "test_token_for_e2e_testing_only",
    "x-talk-app-id": "test_app_id",
    "session_dir": "/tmp/hakodesk_test_session",
}

# Test member data
TEST_MEMBER = {
    "id": "test_member_001",
    "name": "Test Member",
    "thumbnail": "/api/content/media/test/thumbnail.jpg",
    "portrait": "/api/content/media/test/portrait.jpg",
    "phone_image": None,
}

# Test group/member list for sidebar
TEST_GROUPS = {
    "groups": [
        {
            "path": "individual/test_member_001",
            "name": "Test Member",
            "is_group": False,
            "message_count": 10,
            "last_message_date": "2024-01-15T10:30:00Z",
        },
        {
            "path": "group/test_group_chat",
            "name": "Test Group Chat",
            "is_group": True,
            "message_count": 25,
            "last_message_date": "2024-01-15T12:00:00Z",
        },
    ]
}

# Test messages for chat view
TEST_MESSAGES = [
    {
        "id": 1,
        "timestamp": "2024-01-15T09:00:00Z",
        "type": "text",
        "content": "Hello! This is a test message.",
        "is_favorite": False,
        "media_file": None,
        "width": None,
        "height": None,
    },
    {
        "id": 2,
        "timestamp": "2024-01-15T09:05:00Z",
        "type": "text",
        "content": "This is another test message with a link: https://example.com",
        "is_favorite": True,
        "media_file": None,
        "width": None,
        "height": None,
    },
    {
        "id": 3,
        "timestamp": "2024-01-15T09:10:00Z",
        "type": "picture",
        "content": "Check out this photo!",
        "is_favorite": False,
        "media_file": "test/photo.jpg",
        "width": 800,
        "height": 600,
    },
    {
        "id": 4,
        "timestamp": "2024-01-15T09:15:00Z",
        "type": "voice",
        "content": None,
        "is_favorite": False,
        "media_file": "test/voice.mp3",
        "width": None,
        "height": None,
    },
]

# Response for messages endpoint
def get_test_messages_response(path: str, last_read_id: int = 0):
    """Generate test messages response matching API format."""
    unread_count = sum(1 for m in TEST_MESSAGES if m["id"] > last_read_id)
    return {
        "member": TEST_MEMBER,
        "messages": TEST_MESSAGES,
        "total_count": len(TEST_MESSAGES),
        "unread_count": unread_count,
        "max_message_id": max(m["id"] for m in TEST_MESSAGES) if TEST_MESSAGES else 0,
    }
```

**Step 4: Commit**

```bash
git add backend/fixtures/
git commit -m "feat(backend): add test fixtures for E2E testing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Test Mode Bypass to Auth Service

**Files:**
- Modify: `backend/services/auth_service.py`
- Test: Existing tests should pass

**Step 1: Import test mode and fixtures**

Add at top of `backend/services/auth_service.py` after existing imports:

```python
from backend.services.platform import get_session_dir, is_dev_mode, is_test_mode
```

And add import for fixtures (inside is_test_mode check to avoid circular imports):

**Step 2: Modify get_status() to return test auth in test mode**

Replace the `get_status` method:

```python
async def get_status(self):
    """Check authentication status."""
    # Test mode: always return authenticated with test config
    if is_test_mode():
        from backend.fixtures.test_data import TEST_AUTH_CONFIG
        return {
            "is_authenticated": True,
            "app_id": TEST_AUTH_CONFIG.get("x-talk-app-id"),
            "storage_type": "test_mode"
        }

    config = self._store.load_config()

    if config:
        token = config.get('access_token')
        if token:
            if self._is_token_expired(token):
                return {
                    "is_authenticated": False,
                    "token_expired": True,
                    "message": "Token expired. Please re-login."
                }
            return {
                "is_authenticated": True,
                "app_id": config.get('x-talk-app-id'),
                "storage_type": "secure" if not is_dev_mode() else "development"
            }

    return {"is_authenticated": False}
```

**Step 3: Modify get_config() to return test config in test mode**

Replace the `get_config` method:

```python
def get_config(self) -> dict:
    """Get the current config (for sync service)."""
    if is_test_mode():
        from backend.fixtures.test_data import TEST_AUTH_CONFIG
        return TEST_AUTH_CONFIG
    return self._store.load_config()
```

**Step 4: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && uv run pytest tests/ -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add backend/services/auth_service.py
git commit -m "feat(auth): bypass real OAuth in test mode

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Test Mode Routes for Content API

**Files:**
- Modify: `backend/api/content.py`

**Step 1: Add test mode import at top**

Add after existing imports:

```python
from backend.services.platform import is_test_mode
```

**Step 2: Modify get_groups() to return test data in test mode**

Find the `get_groups` function and add test mode check at the start:

```python
@router.get("/groups")
async def get_groups():
    """Get list of available groups/members."""
    if is_test_mode():
        from backend.fixtures.test_data import TEST_GROUPS
        return TEST_GROUPS

    # ... rest of existing implementation
```

**Step 3: Modify get_messages_by_path() to return test data in test mode**

Find the `get_messages_by_path` function and add test mode check:

```python
@router.get("/messages_by_path")
async def get_messages_by_path(
    path: str,
    limit: int = 0,
    offset: int = 0,
    last_read_id: int = 0
):
    """Get messages for a specific member path."""
    if is_test_mode():
        from backend.fixtures.test_data import get_test_messages_response
        return get_test_messages_response(path, last_read_id)

    # ... rest of existing implementation
```

**Step 4: Run tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk && uv run pytest tests/ -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add backend/api/content.py
git commit -m "feat(content): return test fixtures in test mode

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Install Playwright for Frontend E2E Tests

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install Playwright**

Run:
```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend
npm install --save-dev @playwright/test
npx playwright install chromium
```

**Step 2: Add E2E test scripts to package.json**

Add to scripts section:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui",
"test:e2e:headed": "playwright test --headed"
```

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(frontend): add Playwright for E2E testing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Configure Playwright

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/example.spec.ts`

**Step 1: Create playwright.config.ts**

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    // Base URL for the backend (runs on port 8000)
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start backend server before tests (in test mode)
  webServer: {
    command: 'cd .. && HAKODESK_TEST_MODE=true uv run uvicorn backend.main:app --port 8000',
    url: 'http://localhost:8000/api/auth/status',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})
```

**Step 2: Create e2e directory and example test**

Run: `mkdir -p /home/xtorker/repos/Project-PyHako/HakoDesk/frontend/e2e`

Create `frontend/e2e/example.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('HakoDesk E2E Tests (Test Mode)', () => {
  test('should show authenticated state in test mode', async ({ page }) => {
    await page.goto('/')

    // In test mode, should skip login and show main app
    // Wait for sidebar to load
    await expect(page.locator('text=Test Member')).toBeVisible({ timeout: 10000 })
  })

  test('should display sidebar with test groups', async ({ page }) => {
    await page.goto('/')

    // Should show test member in sidebar
    await expect(page.getByText('Test Member')).toBeVisible()
    await expect(page.getByText('Test Group Chat')).toBeVisible()
  })

  test('should load messages when clicking a conversation', async ({ page }) => {
    await page.goto('/')

    // Click on test member
    await page.getByText('Test Member').click()

    // Should show test messages
    await expect(page.getByText('Hello! This is a test message.')).toBeVisible()
  })

  test('should render message with link as clickable', async ({ page }) => {
    await page.goto('/')

    await page.getByText('Test Member').click()

    // Find the link in the message
    const link = page.getByRole('link', { name: 'https://example.com' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', 'https://example.com')
  })

  test('should show unread count badge', async ({ page }) => {
    await page.goto('/')

    await page.getByText('Test Member').click()

    // Should show unread count in header
    await expect(page.getByText(/\d+ unread/)).toBeVisible()
  })
})
```

**Step 3: Run E2E tests to verify setup**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:e2e`
Expected: Tests should run (may fail initially if backend not configured, but setup is correct)

**Step 4: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e/
git commit -m "test(e2e): add Playwright config and initial E2E tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Install and Configure MSW for Integration Tests

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/__tests__/mocks/handlers.ts`
- Create: `frontend/src/__tests__/mocks/server.ts`

**Step 1: Install MSW**

Run:
```bash
cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend
npm install --save-dev msw
```

**Step 2: Create mock handlers**

Create `frontend/src/__tests__/mocks/handlers.ts`:

```typescript
import { http, HttpResponse } from 'msw'

// Test data matching backend fixtures
const TEST_MEMBER = {
  id: 'test_member_001',
  name: 'Test Member',
  thumbnail: '/api/content/media/test/thumbnail.jpg',
  portrait: '/api/content/media/test/portrait.jpg',
  phone_image: null,
}

const TEST_MESSAGES = [
  {
    id: 1,
    timestamp: '2024-01-15T09:00:00Z',
    type: 'text',
    content: 'Hello! This is a test message.',
    is_favorite: false,
    media_file: null,
    width: null,
    height: null,
  },
  {
    id: 2,
    timestamp: '2024-01-15T09:05:00Z',
    type: 'text',
    content: 'This is another test message.',
    is_favorite: true,
    media_file: null,
    width: null,
    height: null,
  },
]

export const handlers = [
  // Auth status - always authenticated for integration tests
  http.get('/api/auth/status', () => {
    return HttpResponse.json({
      is_authenticated: true,
      app_id: 'test_app_id',
      storage_type: 'test',
    })
  }),

  // Groups list
  http.get('/api/content/groups', () => {
    return HttpResponse.json({
      groups: [
        {
          path: 'individual/test_member_001',
          name: 'Test Member',
          is_group: false,
          message_count: 10,
          last_message_date: '2024-01-15T10:30:00Z',
        },
      ],
    })
  }),

  // Messages by path
  http.get('/api/content/messages_by_path', ({ request }) => {
    const url = new URL(request.url)
    const lastReadId = parseInt(url.searchParams.get('last_read_id') || '0')

    return HttpResponse.json({
      member: TEST_MEMBER,
      messages: TEST_MESSAGES,
      total_count: TEST_MESSAGES.length,
      unread_count: TEST_MESSAGES.filter(m => m.id > lastReadId).length,
      max_message_id: Math.max(...TEST_MESSAGES.map(m => m.id)),
    })
  }),

  // Settings
  http.get('/api/settings', () => {
    return HttpResponse.json({
      output_dir: '/tmp/hakodesk_test',
      auto_sync_enabled: false,
      sync_interval_minutes: 30,
      is_configured: true,
    })
  }),

  // Fresh install check
  http.get('/api/settings/fresh', () => {
    return HttpResponse.json({ is_fresh: false })
  }),

  // Sync progress (idle)
  http.get('/api/sync/progress', () => {
    return HttpResponse.json({ state: 'idle' })
  }),
]
```

**Step 3: Create MSW server setup**

Create `frontend/src/__tests__/mocks/server.ts`:

```typescript
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

export const server = setupServer(...handlers)
```

**Step 4: Update test setup to use MSW**

Modify `frontend/src/__tests__/setup.ts`:

```typescript
import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, afterAll, beforeAll, vi } from 'vitest'
import { server } from './mocks/server'

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

// Reset handlers after each test
afterEach(() => {
  cleanup()
  server.resetHandlers()
})

// Clean up after all tests
afterAll(() => server.close())

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Mock HTMLMediaElement methods for audio/video tests
HTMLMediaElement.prototype.load = vi.fn()
HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
HTMLMediaElement.prototype.pause = vi.fn()
```

**Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/__tests__/mocks/ frontend/src/__tests__/setup.ts
git commit -m "build(frontend): add MSW for API mocking in integration tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add Integration Tests for App Component

**Files:**
- Create: `frontend/src/App.integration.test.tsx`

**Step 1: Create integration test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(localStorage.getItem).mockReturnValue(null)
  })

  it('should render main app when authenticated', async () => {
    render(<App />)

    // Wait for auth check and initial render
    await waitFor(() => {
      expect(screen.getByText('Select a Conversation')).toBeInTheDocument()
    })
  })

  it('should show welcome message when no conversation selected', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/Welcome to HakoDesk/)).toBeInTheDocument()
    })
  })

  it('should display sidebar with groups from API', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })
  })

  it('should load messages when conversation is selected', async () => {
    render(<App />)

    // Wait for sidebar to load
    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })

    // Click on the conversation
    await userEvent.click(screen.getByText('Test Member'))

    // Wait for messages to load
    await waitFor(() => {
      expect(screen.getByText('Hello! This is a test message.')).toBeInTheDocument()
    })
  })

  it('should show header with conversation name after selection', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Test Member')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByText('Test Member'))

    // Header should update
    await waitFor(() => {
      const headers = screen.getAllByText('Test Member')
      expect(headers.length).toBeGreaterThan(1) // sidebar + header
    })
  })
})
```

**Step 2: Run integration tests**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run`
Expected: Integration tests pass with MSW mocking API calls

**Step 3: Commit**

```bash
git add frontend/src/App.integration.test.tsx
git commit -m "test(frontend): add integration tests for App with MSW

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add Snapshot Tests to Existing Components

**Files:**
- Modify: `frontend/src/components/MessageBubble.test.tsx`
- Modify: `frontend/src/pages/LoginPage.test.tsx`

**Step 1: Add snapshot test to MessageBubble.test.tsx**

Add at the end of the describe block:

```typescript
describe('Snapshots', () => {
  it('should match snapshot for text message', () => {
    const { container } = render(<MessageBubble {...defaultProps} />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('should match snapshot for picture message', () => {
    const pictureMessage = createMessage({
      type: 'picture',
      media_file: 'path/to/photo.jpg',
      width: 800,
      height: 600,
    })
    const { container } = render(<MessageBubble {...defaultProps} message={pictureMessage} />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('should match snapshot for unread message with overlay', () => {
    const { container } = render(<MessageBubble {...defaultProps} isUnread={true} />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
```

**Step 2: Add snapshot test to LoginPage.test.tsx**

Add at the end of the describe block:

```typescript
describe('Snapshots', () => {
  it('should match snapshot for default state', () => {
    const { container } = render(<LoginPage {...defaultProps} />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('should match snapshot with error state', () => {
    const { container } = render(<LoginPage {...defaultProps} initialError="Session expired" />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
```

**Step 3: Run tests to generate snapshots**

Run: `cd /home/xtorker/repos/Project-PyHako/HakoDesk/frontend && npm run test:run -- -u`
Expected: Snapshots are created in `__snapshots__` directories

**Step 4: Commit**

```bash
git add frontend/src/components/MessageBubble.test.tsx frontend/src/pages/LoginPage.test.tsx frontend/src/components/__snapshots__/ frontend/src/pages/__snapshots__/
git commit -m "test(frontend): add snapshot tests for MessageBubble and LoginPage

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Create DEVELOPMENT.md Documentation

**Files:**
- Create: `docs/DEVELOPMENT.md`

**Step 1: Create comprehensive development documentation**

```markdown
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
uv run pytest tests/test_api_auth.py -v
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
npx playwright test --headed --project=chromium tests/save-auth.spec.ts
```

This saves your authenticated session to `frontend/.auth/user.json`.

**Step 4: Run E2E tests with real auth**

```bash
# Set env var to use saved auth state
PLAYWRIGHT_AUTH_FILE=.auth/user.json npm run test:e2e
```

**Step 5: Create save-auth.spec.ts helper** (for generating auth state)

Create `frontend/e2e/save-auth.spec.ts`:

```typescript
import { test } from '@playwright/test'

// Run this manually to save authentication state
// npx playwright test e2e/save-auth.spec.ts --headed
test('save authenticated state', async ({ page, context }) => {
  // Navigate to app - assumes you've already logged in via the browser
  await page.goto('/')

  // Wait for authenticated state
  await page.waitForSelector('text=Select a Conversation', { timeout: 60000 })

  // Save storage state
  await context.storageState({ path: '.auth/user.json' })
  console.log('Auth state saved to .auth/user.json')
})
```

Add to `.gitignore`:
```
frontend/.auth/
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
open htmlcov/index.html
```

Coverage threshold: 50% minimum (enforced in CI)

### Frontend

```bash
cd frontend
npm run test:coverage
open coverage/index.html
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
```

**Step 2: Commit**

```bash
git add docs/DEVELOPMENT.md
git commit -m "docs: add comprehensive development guide with testing instructions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Create E2E Auth Helper Script

**Files:**
- Create: `frontend/e2e/save-auth.spec.ts`
- Modify: `frontend/.gitignore`

**Step 1: Create save-auth helper**

```typescript
import { test, expect } from '@playwright/test'

/**
 * Helper script to save authenticated state for E2E tests.
 *
 * Usage:
 * 1. Start backend normally: uv run uvicorn backend.main:app --port 8000
 * 2. Login via browser at http://localhost:8000
 * 3. Run: npx playwright test e2e/save-auth.spec.ts --headed
 * 4. Auth state saved to .auth/user.json
 * 5. Use in tests: PLAYWRIGHT_AUTH_FILE=.auth/user.json npm run test:e2e
 */
test.describe.configure({ mode: 'serial' })

test('save authenticated state', async ({ page, context }) => {
  // This test is for manual use only - run with --headed
  test.setTimeout(120000) // 2 minutes for manual login

  // Navigate to app
  await page.goto('/')

  // If login page appears, wait for user to complete login manually
  const isLoginPage = await page.locator('text=Connect Account').isVisible()

  if (isLoginPage) {
    console.log('Login page detected. Please complete login in the browser...')
    console.log('Waiting for authenticated state (timeout: 2 minutes)...')
  }

  // Wait for authenticated state (sidebar visible)
  await expect(page.locator('.flex.h-screen')).toBeVisible({ timeout: 120000 })

  // Verify we're past login
  const loginButton = page.locator('text=Launch Browser Login')
  await expect(loginButton).not.toBeVisible({ timeout: 5000 }).catch(() => {
    // If still visible, user hasn't logged in
    throw new Error('Login not completed. Please complete login in the browser.')
  })

  // Ensure .auth directory exists
  const fs = await import('fs')
  const authDir = '.auth'
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true })
  }

  // Save storage state
  await context.storageState({ path: '.auth/user.json' })
  console.log('\n✅ Auth state saved to .auth/user.json')
  console.log('Run E2E tests with: PLAYWRIGHT_AUTH_FILE=.auth/user.json npm run test:e2e')
})
```

**Step 2: Add .auth to .gitignore**

Add to `frontend/.gitignore`:

```
# Auth state for E2E testing (contains real credentials)
.auth/
```

**Step 3: Commit**

```bash
git add frontend/e2e/save-auth.spec.ts frontend/.gitignore
git commit -m "test(e2e): add helper script for saving real auth state

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Update CI to Run E2E Tests

**Files:**
- Modify: `.github/workflows/build.yml`

**Step 1: Add E2E test step after frontend tests**

Add after "Run Frontend Tests" step:

```yaml
    - name: Install Playwright Browsers
      working-directory: ./frontend
      run: npx playwright install chromium --with-deps

    - name: Run E2E Tests
      working-directory: ./frontend
      run: npm run test:e2e
      env:
        HAKODESK_TEST_MODE: 'true'
```

**Step 2: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "build: add Playwright E2E tests to CI workflow

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification

After all tasks complete:

1. **Run backend tests:**
   ```bash
   cd /home/xtorker/repos/Project-PyHako/HakoDesk
   uv run pytest -v
   ```
   Expected: All tests pass

2. **Run frontend unit/integration tests:**
   ```bash
   cd frontend
   npm run test:run
   ```
   Expected: All tests pass (including new integration tests)

3. **Run E2E tests in test mode:**
   ```bash
   cd frontend
   npm run test:e2e
   ```
   Expected: E2E tests pass with mocked auth

4. **Verify documentation:**
   ```bash
   cat docs/DEVELOPMENT.md | head -50
   ```
   Expected: Development guide with testing instructions

---

## Summary

| Task | Type | Files | Description |
|------|------|-------|-------------|
| 1 | Backend | platform.py | Add TEST_MODE env var |
| 2 | Backend | fixtures/*.py | Create test data fixtures |
| 3 | Backend | auth_service.py | Bypass auth in test mode |
| 4 | Backend | content.py | Return fixtures in test mode |
| 5 | Frontend | package.json | Install Playwright |
| 6 | Frontend | playwright.config.ts, e2e/*.ts | Configure Playwright + tests |
| 7 | Frontend | mocks/*.ts, setup.ts | Install and configure MSW |
| 8 | Frontend | App.integration.test.tsx | Add integration tests |
| 9 | Frontend | *.test.tsx | Add snapshot tests |
| 10 | Docs | DEVELOPMENT.md | Comprehensive dev guide |
| 11 | Frontend | save-auth.spec.ts | Helper for real auth E2E |
| 12 | CI | build.yml | Add E2E to CI pipeline |

**Total new tests:** ~15 E2E + 5 integration + 5 snapshots
