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
