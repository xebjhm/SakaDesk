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
  // ZAKADESK_TEST_MODE is set via env var (CI step or shell), not inline in the command
  webServer: {
    command: process.platform === 'win32'
      ? 'cd .. && uv run uvicorn backend.main:app --port 8000'
      : 'cd .. && ZAKADESK_TEST_MODE=true uv run uvicorn backend.main:app --port 8000',
    url: 'http://localhost:8000/api/auth/status',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { ZAKADESK_TEST_MODE: 'true' },
  },
})
