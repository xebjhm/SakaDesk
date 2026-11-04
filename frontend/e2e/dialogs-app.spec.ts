import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, TZ } from './fixtures/bigRoom'
import { pinBlogs, MEMBER_A } from './fixtures/blogs'

// Locks the app-level dialogs, search and the blog dialogs before D2c restyles them.
// Before D2c most of these dialogs have no dialog role, so they are found by their heading.

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

const SETTINGS = {
  output_dir: '/fixture/out',
  auto_sync_enabled: true,
  adaptive_sync_enabled: true,
  sync_interval_minutes: 15,
  is_configured: true,
  incoming_call_enabled: true,
  notifications_enabled: true,
}

async function pinSettings(page: Page, saved: Record<string, unknown>[]) {
  await page.route((url) => url.pathname === '/api/settings', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      saved.push(body)
      return route.fulfill({ json: { ...SETTINGS, ...body } })
    }
    return route.fulfill({ json: SETTINGS })
  })
}

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
}

/** The rail's settings button (title "Settings") opens a menu; its items are found by text. */
async function openRailMenu(page: Page, text: string) {
  await page.getByTitle('Settings', { exact: true }).click()
  await page.getByText(text, { exact: true }).click()
}

test.describe('app dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await pinBigRoom(page, { messages: { current: buildBigRoom(50) } })
  })

  test('settings: a tab switches, a switch saves, Escape closes', async ({ page }) => {
    const saved: Record<string, unknown>[] = []
    await pinSettings(page, saved)
    await openHome(page)
    await openRailMenu(page, 'Settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

    await page.getByRole('switch', { name: 'Incoming calls' }).click()
    await expect.poll(() => saved).toContainEqual({ incoming_call_enabled: false })

    await page.getByRole('navigation').getByRole('button', { name: 'Sync', exact: true }).click()
    await expect(page.getByText('Sync Mode', { exact: true })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)
  })

  test('settings: a sync radio saves, reset asks in-app then saves (D2c)', async ({ page }) => {
    const saved: Record<string, unknown>[] = []
    await pinSettings(page, saved)
    await openHome(page)
    await openRailMenu(page, 'Settings')
    const settings = page.getByRole('dialog', { name: 'Settings' })

    await settings.getByRole('navigation').getByRole('button', { name: 'Sync', exact: true }).click()
    await settings.getByRole('radio', { name: /^Off/ }).click() // controlled: checks once the save lands
    await expect.poll(() => saved).toContainEqual({ auto_sync_enabled: false, adaptive_sync_enabled: false })

    await settings.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Reset to defaults' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(confirm).toHaveCount(0)
    await expect.poll(() => saved.some((b) => b.incoming_call_enabled === true && b.auto_sync_enabled === true)).toBe(true)
    await expect(settings).toBeVisible()
  })

  test('about opens from the rail menu and Escape closes it', async ({ page }) => {
    await openHome(page)
    await openRailMenu(page, 'About')
    await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'SakaDesk' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'About' })).toHaveCount(0)
  })

  test('report issue opens from the rail menu and Cancel closes it', async ({ page }) => {
    await openHome(page)
    await openRailMenu(page, 'Report Issue')
    await expect(page.getByRole('heading', { name: 'Report an Issue' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Report an Issue' })).toHaveCount(0)
  })

  test('add service lists other groups; adding and removing groups works', async ({ page }) => {
    // The fresh-login prompt is dismissed with Maybe Later; auth is answered here, never by the real login.
    await page.route('**/api/auth/**', (route) => route.abort('blockedbyclient'))
    await page.route((url) => url.pathname === '/api/auth/status', (route) => route.fulfill({ json: { services: {} } }))
    await openHome(page)
    await page.getByRole('button', { name: 'Add Service' }).click()
    await expect(page.getByRole('heading', { name: 'Add Service' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Add Service' })).toHaveCount(0)

    const rail = page.getByRole('navigation', { name: 'Groups' })
    await page.getByRole('button', { name: 'Add Service' }).click()
    await page.getByRole('dialog', { name: 'Add Service' }).getByRole('button', { name: /櫻坂46/ }).click()
    await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Maybe Later' }).click()
    await expect(rail.getByRole('button', { name: '櫻坂46', exact: true })).toBeVisible()

    await rail.getByRole('button', { name: '櫻坂46', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove Service' }).click()
    await expect(rail.getByRole('button', { name: '櫻坂46', exact: true })).toHaveCount(0)

    await rail.getByRole('button', { name: '日向坂46', exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove Service' }).click()
    await expect(page.getByRole('heading', { name: 'Welcome to SakaDesk' })).toBeVisible()
  })

  test('Ctrl+K opens search, a query shows results, Escape closes it', async ({ page }) => {
    await page.route((url) => url.pathname === '/api/search/status', (route) => route.fulfill({ json: { is_building: false } }))
    await page.route((url) => url.pathname === '/api/search', (route) =>
      route.fulfill({
        json: {
          query: 'おはよう', normalized_query: 'おはよう', total_count: 1, has_more: false,
          results: [{
            result_type: 'message', message_id: 42, content: 'おはよう😊', snippet: '<mark>おはよう</mark>😊',
            service: 'hinatazaka46', group_id: 1, group_name: 'Big Room', member_id: 1, member_name: 'Big Room',
            timestamp: '2026-11-03T10:00:00Z', type: 'text', is_group_chat: false,
          }],
        },
      }),
    )
    await openHome(page)
    await page.keyboard.press('Control+k')
    const input = page.getByPlaceholder(/^Search messages/)
    await expect(input).toBeVisible()
    await input.fill('おはよう')
    await expect(page.locator('mark', { hasText: 'おはよう' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(input).toHaveCount(0)
  })
})

test.describe('blog dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await pinBlogs(page)
  })

  test('select member → timeline → photo album opens; Escape closes the album', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Select Member' }).click()
    // The member (a div role=button before D2c, a button after) is named by its name; feed cards start with their date.
    await page.getByRole('button', { name: /^春野/ }).first().click()
    const timeline = page.getByRole('heading', { level: 2, name: /春野/ })
    await expect(timeline).toBeVisible()
    await page.getByRole('button', { name: 'Photo Album' }).click()
    await expect(page.getByRole('heading', { name: 'Photo Album' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Photo Album' })).toHaveCount(0)
  })

  test('arrow keys do not switch the post behind an open member timeline', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /春の日記 41/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: '春の日記 41 🌸' })).toBeVisible()
    await page.getByRole('button', { name: new RegExp(`^${MEMBER_A.name.split(' ')[0]}`) }).first().click()
    await expect(page.getByRole('heading', { level: 2, name: /春野/ })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { level: 1, name: '春の日記 41 🌸' })).toBeVisible()
  })

  test('Escape in the photo album leaves the member timeline open (D2c)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Select Member' }).click()
    await page.getByRole('dialog', { name: 'Select Member' }).getByRole('button', { name: /^春野/ }).click()
    const timeline = page.getByRole('dialog', { name: /春野/ })
    await timeline.getByRole('button', { name: 'Photo Album' }).click()
    await expect(page.getByRole('dialog', { name: 'Photo Album' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Photo Album' })).toHaveCount(0)
    await expect(timeline).toBeVisible()
  })
})
