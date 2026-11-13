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
    await page.getByText('Big Room', { exact: true }).click()
    await expect.poll(() => seen.filter((s) => s.room === 'big').length).toBe(2)
    const after304 = await pageNow(page)

    expect(seen.filter((s) => s.room === 'big')).toEqual([
      { room: 'big', tag: null, status: 200 },
      { room: 'big', tag: '"big-v1"', status: 304 },
    ])
    // The cached list stays on screen: no skeleton, the newest row still there.
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible()
    await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
    // A 304 sets no room state: nothing heavy runs once it has landed.
    await page.waitForTimeout(500)
    const afterwards = (await longTasks(page)).filter((t) => t.start >= after304 && t.duration >= 100)
    expect(afterwards).toEqual([])
  })
})
