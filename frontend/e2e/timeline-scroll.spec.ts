import { test, expect, type Page } from '@playwright/test'
import {
  buildBigRoom, firstIdOnDate, isRowInViewport, pinBigRoom, topVisibleMessageId,
  COUNT, TZ, type FixtureMessage,
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
    await expect(page.locator(`#msg-${expected}`)).toHaveClass(/bg-group-subtle/)
  })

  test('media gallery "jump to message" lands on a 2022 message', async ({ page }) => {
    await openBigRoom(page)
    await page.getByTitle('More options').click()
    await page.getByText('Media', { exact: true }).click()
    // Newest first: the last thumbnail is message 100 (2022).
    await page.getByRole('dialog').locator('button:has(img)').last().click()
    await page.getByTitle('Jump to message').click()
    await expect.poll(() => isRowInViewport(page, 100), { timeout: 1000, intervals: [50] }).toBe(true)
    await expect(page.locator('#msg-100')).toHaveClass(/bg-group-subtle/)
  })

  test('re-opening the room restores the last top message', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'March 2024')
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    const expected = firstIdOnDate(messages.current, '2024-03-15')
    await expect.poll(() => topVisibleMessageId(page), { timeout: 2000 }).toBe(expected)
    await page.waitForTimeout(800) // useChatScroll debounces saves by 500 ms
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
})
