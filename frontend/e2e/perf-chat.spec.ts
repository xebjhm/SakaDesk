import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Rendering-performance contracts that need a real browser (UI health plan F).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

/** Serve the rooms with ETags; a matching If-None-Match gets 304. Returns the requests seen. */
async function serveWithEtags(page: Page, messages: { current: FixtureMessage[] }) {
  const seen: { room: string; tag: string | null; status: number }[] = []
  await page.route('**/api/content/messages_by_path*', async (route) => {
    const url = new URL(route.request().url())
    const room = (url.searchParams.get('path') ?? '').includes('Other Room') ? 'other' : 'big'
    const tag = route.request().headers()['if-none-match'] ?? null
    const etag = `"${room}-v1"`
    if (tag === etag) {
      seen.push({ room, tag, status: 304 })
      return route.fulfill({ status: 304, headers: { ETag: etag } })
    }
    seen.push({ room, tag, status: 200 })
    const msgs = room === 'big' ? messages.current : [{ ...messages.current[0], id: 1, content: 'Other room message' }]
    return route.fulfill({
      headers: { ETag: etag, 'Cache-Control': 'no-cache' },
      json: { member: null, messages: msgs, total_count: msgs.length, unread_count: 0, max_message_id: msgs[msgs.length - 1].id },
    })
  })
  return seen
}

/**
 * Resolves when the PAGE's own code reports that it received a 304: the app posts a `chat_load`
 * breadcrumb with `outcome: 'not_modified'` only from its `res.status === 304` branch. Chromium adds
 * its own validators to a plain fetch and answers the page 200 from its cache, so what the route
 * saw is not evidence; this page-side signal is. Register it before the click that triggers it.
 */
function pageSawNotModified(page: Page) {
  return page.waitForRequest((req) => {
    if (!req.url().endsWith('/api/client-log') || req.method() !== 'POST') return false
    const body = req.postDataJSON() as { event?: string; fields?: { outcome?: string } } | null
    return body?.event === 'chat_load' && body.fields?.outcome === 'not_modified'
  }, { timeout: 10000 })
}

/** Record every long task (≥ 50 ms) the page runs, as { start, duration } in page time. */
async function recordLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: { start: number; duration: number }[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
}
const longTasks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __longTasks: { start: number; duration: number }[] }).__longTasks)
const pageNow = (page: Page) => page.evaluate(() => performance.now())

test.describe('chat performance contracts', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
    await pinBigRoom(page, { messages })
    await recordLongTasks(page)
  })

  test('a revisited unchanged room is asked with its ETag and the 304 keeps the list', async ({ page }) => {
    const seen = await serveWithEtags(page, messages)
    await page.goto('/')
    const beforeOpen = await pageNow(page)
    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
    // The first open of the 5 000-message room keeps one parse (Decision 5): recorded, not asserted.
    const firstOpen = (await longTasks(page)).filter((t) => t.start >= beforeOpen)
    test.info().annotations.push({ type: 'longest-task-first-open-ms', description: String(Math.round(Math.max(0, ...firstOpen.map((t) => t.duration)))) })

    await page.getByText('Other Room', { exact: true }).click()
    await expect(page.getByText('Other room message')).toBeVisible()
    const notModified = pageSawNotModified(page)
    await page.getByText('Big Room', { exact: true }).click()
    await notModified // the app's own code got the 304, not a 200 from the HTTP cache
    await expect.poll(() => seen.filter((s) => s.room === 'big').length).toBe(2)
    const after304 = await pageNow(page)

    expect(seen.filter((s) => s.room === 'big')).toEqual([
      { room: 'big', tag: null, status: 200 },
      { room: 'big', tag: '"big-v1"', status: 304 },
    ])
    // The cached list stays on screen: no skeleton, the newest row still there.
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible()
    await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
    // Informational only: long tasks after the 304 are recorded, not asserted. A 5 000-row list can
    // legitimately run a task >= 100 ms for unrelated reasons (layout, scroll restore), so an assertion
    // here would be flaky and would not isolate the parse; the contract is the 304 above plus the
    // unit test's timeline identity.
    await page.waitForTimeout(500)
    const afterwards = (await longTasks(page)).filter((t) => t.start >= after304)
    test.info().annotations.push({ type: 'longest-task-after-304-ms', description: String(Math.round(Math.max(0, ...afterwards.map((t) => t.duration)))) })
  })
})
