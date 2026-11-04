import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ } from './fixtures/bigRoom'

// Non-scroll behaviour of the D2a chat frame (scrolling lives in timeline-scroll.spec.ts).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await pinBigRoom(page, { messages: { current: buildBigRoom() } })
})

test('the chat header shows the member and the subscription streak', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
  const header = page.locator('header').first()
  await expect(header.getByRole('heading', { name: 'Big Room' })).toBeVisible()
  await expect(header.getByText(/Subscribed for\s*128\s*days/)).toBeVisible()
})
