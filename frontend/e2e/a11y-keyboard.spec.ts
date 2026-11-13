import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Keyboard and screen-reader contracts that need a real browser (UI health plan G).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.describe('keyboard access', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
  })

  test('an unread message is revealed from the keyboard', async ({ page }) => {
    await pinBigRoom(page, { messages, lastReadId: COUNT - 1 })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    const shelter = page.getByRole('button', { name: 'Show unread message' })
    await expect(shelter).toBeVisible({ timeout: 10000 })
    await shelter.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Show unread message' })).toHaveCount(0)
    await expect(page.locator(`#msg-${COUNT}`)).toContainText(`Message ${COUNT}`)
  })
})
