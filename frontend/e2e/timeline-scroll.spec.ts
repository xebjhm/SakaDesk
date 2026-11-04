import { test, expect, type Page } from '@playwright/test'
import {
  buildBigRoom, firstIdOnDate, isRowInViewport, pinBigRoom, topVisibleMessageId,
  COUNT, ROOM_DIR, TZ, type FixtureMessage,
} from './fixtures/bigRoom'

// Locks the chat timeline's scroll behaviour in a real browser. D2a (GroupedVirtuoso,
// letters) must keep every test here green.

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

async function openBigRoom(page: Page) {
  await page.goto('/')
  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
}

async function openCalendarAt(page: Page, monthLabel: string) {
  await page.getByTitle('More options').click()
  await page.getByText('Date Search', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  const prev = dialog.locator('button.p-2').first() // previous-month chevron (lucide adds no class here)
  for (let i = 0; i < 80; i++) {
    if (await dialog.getByText(monthLabel, { exact: true }).isVisible()) return dialog
    await prev.click()
  }
  throw new Error(`calendar never reached ${monthLabel}`)
}

/** Focus the timeline without clicking a bubble (a click on an unread shelter would reveal it). */
async function focusTimeline(page: Page) {
  await page.locator('[data-virtuoso-scroller]').click({ position: { x: 4, y: 4 } })
}

test.describe('timeline scroll', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
    await pinBigRoom(page, { messages })
  })

  test('opens at the bottom of a new room', async ({ page }) => {
    await openBigRoom(page)
    expect(await isRowInViewport(page, COUNT)).toBe(true)
  })

  test('calendar jump to a 2022 day lands on that day in under a second', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'January 2022')
    const expected = firstIdOnDate(messages.current, '2022-01-15')
    const t0 = Date.now()
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 1000, intervals: [50] }).toBe(expected)
    expect(Date.now() - t0).toBeLessThan(1000)
    await expect(page.locator(`#msg-${expected}`)).toHaveClass(/animate-landing/)
  })

  test('media gallery "jump to message" lands on a 2022 message', async ({ page }) => {
    await openBigRoom(page)
    await page.getByTitle('More options').click()
    await page.getByText('Media', { exact: true }).click()
    // Newest first: the last thumbnail is message 100 (2022).
    await page.getByRole('dialog').locator('button:has(img)').last().click()
    await page.getByTitle('Jump to message').click()
    await expect.poll(() => isRowInViewport(page, 100), { timeout: 1000, intervals: [50] }).toBe(true)
    await expect(page.locator('#msg-100')).toHaveClass(/animate-landing/)
  })

  test('re-opening the room restores the last top message', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'March 2024')
    const expected = firstIdOnDate(messages.current, '2024-03-15')
    // useChatScroll saves the top message 500 ms after the list stops moving.
    const saved = page.waitForRequest((req) =>
      req.method() === 'PATCH' &&
      new URL(req.url()).searchParams.get('path') === `sakadesk_scroll_${ROOM_DIR}` &&
      String((req.postDataJSON() as { value?: unknown } | null)?.value) === String(expected),
    )
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 2000 }).toBe(expected)
    await saved
    await page.getByText('Other Room', { exact: true }).click()
    await expect(page.getByText('Other room message')).toBeVisible()
    await page.getByText('Big Room', { exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 3000 }).toBe(expected)
  })

  test('at the bottom, a newly synced message is followed', async ({ page }) => {
    await openBigRoom(page)
    const next = { ...messages.current[COUNT - 1], id: COUNT + 1, content: 'Freshly synced' }
    messages.current = [...messages.current, next]
    await page.getByTitle('Sync now').click()
    await expect.poll(() => isRowInViewport(page, COUNT + 1), { timeout: 5000 }).toBe(true)
  })

  test('first-unread arrow centres the first unread message', async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await pinBigRoom(page, { messages, lastReadId: 2500 })
    await openBigRoom(page)
    await page.getByTitle('Jump to oldest unread').click()
    await expect.poll(() => isRowInViewport(page, 2501), { timeout: 1000, intervals: [50] }).toBe(true)
  })

  test('Home and End jump to the first and the last message', async ({ page }) => {
    // The app's own handler must run (one timeline_jump breadcrumb per key), not the browser's native Home/End.
    const jumps: string[] = []
    page.on('request', (req) => {
      if (req.method() !== 'POST' || !req.url().includes('/api/client-log')) return
      const body = req.postDataJSON() as { event?: string; fields?: { target?: string } } | null
      if (body?.event === 'timeline_jump' && body.fields?.target) jumps.push(body.fields.target)
    })
    await openBigRoom(page)
    await focusTimeline(page)
    const before = jumps.length
    await page.keyboard.press('Home')
    await expect.poll(() => jumps.slice(before), { timeout: 3000 }).toEqual(['top'])
    await expect.poll(() => isRowInViewport(page, 1), { timeout: 2000, intervals: [50] }).toBe(true)
    await page.keyboard.press('End')
    await expect.poll(() => jumps.slice(before), { timeout: 3000 }).toEqual(['top', 'bottom'])
    await expect.poll(() => isRowInViewport(page, COUNT), { timeout: 2000, intervals: [50] }).toBe(true)
    expect(jumps.slice(before)).toEqual(['top', 'bottom'])
  })

  test('first-unread arrow below the view brings the first unread into view', async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await pinBigRoom(page, { messages, lastReadId: 2500 })
    await openBigRoom(page)
    await focusTimeline(page)
    await page.keyboard.press('Home')
    await expect.poll(() => isRowInViewport(page, 1), { timeout: 2000, intervals: [50] }).toBe(true)
    const arrow = page.getByTitle('Jump to oldest unread')
    await expect(arrow).toHaveCount(1)
    await arrow.click()
    await expect.poll(() => isRowInViewport(page, 2501), { timeout: 1000, intervals: [50] }).toBe(true)
  })

  test('a date jump puts that day\'s date pill at the top', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'January 2022')
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect(page.locator('[data-testid="virtuoso-top-item-list"] time')).toHaveAttribute('datetime', '2022-01-15', { timeout: 1000 })
  })

  test('clicking the sticky date pill opens the calendar', async ({ page }) => {
    await openBigRoom(page)
    await page.locator('[data-testid="virtuoso-top-item-list"] button').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Date Search', { exact: true })).toBeVisible()
    await expect(dialog.getByText('November 2026', { exact: true })).toBeVisible() // its month grid
  })

  test('the sticky date band lets clicks through to the row behind it', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'January 2022')
    const id = firstIdOnDate(messages.current, '2022-01-15')
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 2000 }).toBe(id)
    // Slide that row 30 px up behind the band, then hit-test the band beside the pill.
    const hit = await page.evaluate((rowId) => {
      const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')!
      scroller.scrollTop += 30
      const band = scroller.querySelector<HTMLElement>('[data-testid="virtuoso-top-item-list"]')!.getBoundingClientRect()
      const el = document.elementFromPoint(scroller.getBoundingClientRect().left + 40, band.bottom - 10)
      return el?.closest('[id^="msg-"]')?.id ?? el?.outerHTML.slice(0, 80) ?? null
    }, id)
    expect(hit).toBe(`msg-${id}`)
  })

  test('a sent letter shows on its day, keyed apart from messages', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'February 2022')
    // The grid also shows the dimmed 10 March; the in-month day comes first.
    await dialog.getByRole('button', { name: '10', exact: true }).first().click()
    await expect(page.locator('#letter-9001')).toBeAttached({ timeout: 2000 })
    await expect(page.locator('#letter-9001 img').first()).toHaveAttribute('src', /letters\/9001\.jpg$/)
  })
})
