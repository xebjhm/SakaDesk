import { defineConfig, devices } from '@playwright/test'

// Probes react-virtuoso behaviour on a dev-only page served by the Vite dev server.
// Run: npx playwright test -c playwright.probe.config.ts --reporter=line
export default defineConfig({
  testDir: './e2e/probe',
  use: { baseURL: 'http://localhost:5179' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
