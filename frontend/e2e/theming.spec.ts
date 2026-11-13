import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// CSS contracts that need real layout (UI health plan H).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.describe('theming', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
  })

  test('an unbreakable run wraps inside its bubble instead of being cut off', async ({ page }) => {
    const last = messages.current[messages.current.length - 1]
    messages.current[messages.current.length - 1] = { ...last, content: `w${'w'.repeat(300)}〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜〜！！！！！！！！！！！！！！！` }
    await pinBigRoom(page, { messages })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    const text = page.locator(`#msg-${COUNT} [lang="ja"].whitespace-pre-wrap`)
    await expect(text).toBeVisible({ timeout: 10000 })
    const fits = await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)
  })
})
