import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ } from './fixtures/bigRoom'

// The app's Content-Security-Policy (backend/security_headers.py APP_CSP) must not refuse
// anything the app itself loads. Runs against the built frontend the backend serves.
test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test('the app loads and opens a chat with no Content-Security-Policy violation', async ({ page }) => {
  await pinBigRoom(page, { messages: { current: buildBigRoom() } })
  const consoleViolations: string[] = []
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleViolations.push(msg.text())
  })
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = seen
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`))
  })

  const response = await page.goto('/')
  const policy = response?.headers()['content-security-policy'] ?? ''
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain("frame-ancestors 'self'")
  expect(policy).not.toContain('unsafe-inline')

  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })

  const pageViolations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  )
  expect([...consoleViolations, ...pageViolations]).toEqual([])
})
