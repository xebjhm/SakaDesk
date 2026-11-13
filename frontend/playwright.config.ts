import { defineConfig, devices } from '@playwright/test'
import { E2E_API_TOKEN } from './e2e/apiToken'

// The backend requires the per-launch token (security audit 2026-11-13): pin one for
// the test server (SAKADESK_API_TOKEN below) and send it on every request the page makes.
// e2e/launch-auth.spec.ts turns the header off to test the real #t= path.

export default defineConfig({
  testDir: './e2e',
  // e2e/probe runs against the Vite dev server: see playwright.probe.config.ts.
  testIgnore: ['**/probe/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    // Base URL for the backend (runs on port 8000)
    baseURL: 'http://localhost:8000',
    extraHTTPHeaders: { 'X-SakaDesk-Token': E2E_API_TOKEN },
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
  // SAKADESK_TEST_MODE is set via env var (CI step or shell), not inline in the command
  webServer: {
    command: process.platform === 'win32'
      ? 'cd .. && uv run uvicorn backend.main:app --port 8000 --timeout-keep-alive 600'
      : 'cd .. && SAKADESK_TEST_MODE=true uv run uvicorn backend.main:app --port 8000 --timeout-keep-alive 600',
    url: 'http://localhost:8000/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { SAKADESK_TEST_MODE: 'true', SAKADESK_API_TOKEN: E2E_API_TOKEN },
  },
})
