import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, ROOM_DIR, TZ } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// The app's Content-Security-Policy (backend/security_headers.py APP_CSP) must not refuse
// anything the app itself loads. Runs against the built frontend the backend serves.
test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

/** Collects every CSP violation the page reports, from the console and from the DOM event. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  const consoleViolations: string[] = []
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleViolations.push(msg.text())
  })
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = seen
    document.addEventListener('securitypolicyviolation', (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`))
  })
  return async () => {
    const pageViolations = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )
    return [...consoleViolations, ...pageViolations]
  }
}

test('the app loads and opens a chat with no Content-Security-Policy violation', async ({ page }) => {
  await pinBigRoom(page, { messages: { current: buildBigRoom() } })
  const violations = await watchViolations(page)

  const response = await page.goto('/')
  const policy = response?.headers()['content-security-policy'] ?? ''
  expect(policy).toContain("script-src 'self'")
  expect(policy).toContain("frame-ancestors 'self'")
  expect(policy).not.toContain('unsafe-inline')
  expect(policy).not.toContain('unsafe-eval')

  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })

  expect(await violations()).toEqual([])
})

test('the blogs feed and a blog post open with no Content-Security-Policy violation', async ({ page }) => {
  await pinBlogs(page)
  const violations = await watchViolations(page)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Latest Blogs' })).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: /春の日記 42/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/最後まで読んでくれてありがとう/)).toBeVisible()

  expect(await violations()).toEqual([])
})

test('the Memories hub opens with no Content-Security-Policy violation', async ({ page }) => {
  await pinBigRoom(page, { messages: { current: buildBigRoom(10) }, feature: 'memories' })
  const violations = await watchViolations(page)
  const hub = page.waitForResponse((res) => /\/api\/memories\/[^/]+\/hub/.test(res.url()))

  await page.goto('/')
  await hub
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 10000 })

  expect(await violations()).toEqual([])
})

test('the call popup rings a reserved call with no Content-Security-Policy violation', async ({ page }) => {
  const service = 'hinatazaka46'
  const voice = {
    id: 9100, member_id: '1', timestamp: '2026-11-04T02:00:00Z', type: 'voice', content: null, is_favorite: false,
    media_file: 'messages/1 Big Room/1 Big Room/voice/9100.m4a', width: null, height: null,
  }
  const member = {
    id: '1', name: 'Big Room', dir_name: '1 Big Room', path: ROOM_DIR, thumbnail: null, portrait: null,
    phone_image: `/api/content/media/${service}/members/1/phone.png`, group_thumbnail: null,
  }
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route('**/api/call-popup/calls/1', (r) =>
    r.fulfill({
      json: { call_id: 1, service, path: ROOM_DIR, is_group_chat: false, group_id: '1', member_id: '1', message_id: 9100 },
    }),
  )
  await page.route('**/api/call-popup/calls/1/events', (r) => r.fulfill({ status: 204 }))
  await page.route('**/api/settings', (r) => r.fulfill({ json: { call_popup_enabled: true, incoming_call_enabled: true } }))
  await page.route('**/api/app-state/prefs', (r) => r.fulfill({ json: { language: 'en' } }))
  await page.route((u) => u.pathname === '/api/app-state/conversation', (r) =>
    r.fulfill({ json: { value: JSON.stringify({ lastReadId: 0, revealedIds: [] }) } }),
  )
  await page.route('**/api/content/messages_by_path*', (r) =>
    r.fulfill({ json: { member, messages: [voice], total_count: 1, unread_count: 1, max_message_id: 9100 } }),
  )
  await page.route('**/api/content/media/**', (r) =>
    r.request().url().includes('/voice/')
      ? r.fulfill({ body: Buffer.alloc(16), contentType: 'audio/mp4' })
      : r.fulfill({ body: png, contentType: 'image/png' }),
  )
  await page.route('**/api/client-log', (r) => r.fulfill({ status: 204 }))
  await page.setViewportSize({ width: 340, height: 600 })
  const violations = await watchViolations(page)

  const response = await page.goto('/?view=call-popup')
  expect(response?.status()).toBe(200)
  // The desktop host starts the call through this global once the page has loaded.
  await page.evaluate(() =>
    (window as unknown as { __sakadeskCallPopup: { start(id: number): void } }).__sakadeskCallPopup.start(1),
  )
  await expect(page.locator('.sd-call-ring')).toBeVisible({ timeout: 10000 })

  expect(await violations()).toEqual([])
})

test('the app page refuses eval, so host calls must not need it', async ({ page }) => {
  await pinBigRoom(page, { messages: { current: buildBigRoom(10) } })
  // The probe must run as the page's own (same-origin) script: code Playwright evaluates
  // through CDP may call eval even under this CSP (Runtime.evaluate allows it by default).
  await page.route('**/__eval_probe.js', (route) => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: "window.__evalOutcome = (function () { try { return String(eval('1 + 1')) } catch (e) { return e.name } })()",
  }))
  await page.goto('/')
  await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
  await page.addScriptTag({ url: '/__eval_probe.js' })
  const outcome = await page.evaluate(() => (window as unknown as { __evalOutcome?: string }).__evalOutcome)
  expect(outcome).toBe('EvalError')
})

test('the built bundle never compiles strings as code', () => {
  const dir = fileURLToPath(new URL('../dist/assets/', import.meta.url))
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .filter((name) => /\bnew Function\s*\(|(?<![\w$.])eval\s*\(/.test(readFileSync(`${dir}${name}`, 'utf8')))
  expect(offenders).toEqual([])
})
