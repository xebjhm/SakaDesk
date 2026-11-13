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

  test('in forced colours a switch shows on and off, and the selected group is outlined', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/settings', (route) => route.fulfill({ json: {
      output_dir: '/fixture/out', auto_sync_enabled: true, sync_interval_minutes: 15, is_configured: true,
      incoming_call_enabled: true, notifications_enabled: false,
    } }))
    await pinBigRoom(page, { messages })
    await page.emulateMedia({ forcedColors: 'active' })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })

    const group = page.locator('nav [aria-current="page"]').first()
    expect(await group.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')

    await page.getByTitle('Settings', { exact: true }).click()
    await page.getByText('Settings', { exact: true }).last().click()
    const on = page.locator('[role="switch"][aria-checked="true"]').first()
    const off = page.locator('[role="switch"][aria-checked="false"]').first()
    await expect(on).toBeVisible()
    const bg = (l: typeof on) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(await bg(on)).not.toBe(await bg(off))
    expect(await off.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid')
  })
})
