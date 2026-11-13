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
    // Focus moves into the revealed row, not to the body.
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[id^="msg-"]')?.id)).toBe(`msg-${COUNT}`)
  })

  test('Tab leaves the search field for the filters and Enter on the filter button opens them', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.route((url) => url.pathname === '/api/search', (route) => route.fulfill({ json: {
      query: 'Message', normalized_query: 'Message', total_count: 1, has_more: false,
      results: [{ result_type: 'message', message_id: 7, content: 'Message 7', snippet: '<mark>Message</mark> 7', service: 'hinatazaka46',
        group_id: 1, group_name: 'Big Room', member_id: 1, member_name: 'Big Room', timestamp: '2022-01-02T03:00:00Z', type: 'text', is_group_chat: false }],
    } }))
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible() // the app is up: Ctrl+K is bound
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox')
    await input.fill('Message')
    await expect(page.getByRole('option')).toHaveCount(1)
    await expect(input).toHaveAttribute('aria-activedescendant', /.+/)
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Filters' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: /Filter by member/ })).toBeVisible()
  })

  test('an open dialog makes the app behind it inert and gives it back on close', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await page.getByTitle('More options').click()
    await page.getByText('Date Search', { exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Date Search' })
    await expect(dialog).toBeVisible()
    await expect(page.locator('#root')).toHaveAttribute('inert', '')
    // Tab cycles inside the dialog only.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '')
  })

  test('below md the closed member sidebar is inert and the chat is inert while it is open', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.setViewportSize({ width: 600, height: 800 })
    await page.goto('/')
    const sidebar = page.locator('div.fixed.inset-y-0.left-0.z-30')
    await expect(sidebar).toHaveAttribute('inert', '')
    await page.getByRole('button', { name: 'Show conversations' }).click()
    await expect(sidebar).not.toHaveAttribute('inert', '')
    await expect(page.locator('div.contents[inert]')).toHaveCount(1)
  })

  test('below md the member sidebar opens and closes from the keyboard alone', async ({ page }) => {
    await pinBigRoom(page, { messages })
    await page.setViewportSize({ width: 600, height: 800 })
    await page.goto('/')
    const toggle = page.getByRole('button', { name: 'Show conversations' })
    await toggle.focus()
    await page.keyboard.press('Enter')
    const sidebar = page.locator('div.fixed.inset-y-0.left-0.z-30')
    await expect(sidebar).not.toHaveAttribute('inert', '')
    expect(await page.evaluate(() => !!document.activeElement?.closest('div.fixed.inset-y-0.left-0.z-30'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(sidebar).toHaveAttribute('inert', '')
    await expect(toggle).toBeFocused()
  })
})
