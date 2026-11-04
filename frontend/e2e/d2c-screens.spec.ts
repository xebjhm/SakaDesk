import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Captures (does not compare) every D2c dialog so the restyle can be reviewed side by side.
//   SHOT_LABEL=before npx playwright test e2e/d2c-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/<label>/ (git-ignored).

const LABEL = process.env.SHOT_LABEL
const SERVICES = ['hinatazaka46', 'sakurazaka46'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=before or SHOT_LABEL=after')

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/${LABEL}/${name}.png`, animations: 'disabled' })
}

async function chatMenu(page: Page, text: string) {
  await page.getByTitle('More options').click()
  if (text) await page.getByText(text, { exact: true }).click()
}

async function railMenu(page: Page, text: string) {
  await page.getByTitle('Settings', { exact: true }).click()
  if (text) await page.getByText(text, { exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await page.route('**/api/favorites/**', (route) => route.fulfill({ json: { success: true } }))
  await page.route((url) => url.pathname === '/api/search/status', (route) => route.fulfill({ json: { is_building: false } }))
  await page.route((url) => url.pathname === '/api/search', (route) =>
    route.fulfill({
      json: {
        query: 'おはよう', normalized_query: 'おはよう', total_count: 2, has_more: false,
        results: [
          { result_type: 'message', message_id: 42, content: 'おはよう😊', snippet: '<mark>おはよう</mark>😊', service: 'hinatazaka46', group_id: 1, group_name: 'Big Room', member_id: 1, member_name: 'Big Room', timestamp: '2026-11-03T10:00:00Z', type: 'text', is_group_chat: false },
          { result_type: 'message', message_id: 43, content: 'お早う', snippet: '<mark class="reading">お早う</mark>', service: 'sakurazaka46', group_id: 2, group_name: 'Other', member_id: 2, member_name: 'Other', timestamp: '2026-11-02T10:00:00Z', type: 'text', is_group_chat: false },
        ],
      },
    }),
  )
})

for (const service of SERVICES) {
  test(`${service}: chat dialogs and menus`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: buildBigRoom() }, service })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })

    await chatMenu(page, '')
    await shot(page, `${service}-chat-menu`)
    await page.mouse.click(1000, 797) // an outside click closes the menu before and after D2c

    await page.locator(`#msg-${COUNT}`).getByText(`Message ${COUNT}`).click({ button: 'right' })
    await shot(page, `${service}-message-menu`)
    await page.getByText('Add to favorites', { exact: true }).click()

    for (const [item, name] of [['Date Search', 'calendar'], ['Favorites', 'favorites'], ['Background', 'background'], ['Media', 'media-gallery']] as const) {
      await chatMenu(page, item)
      await shot(page, `${service}-${name}`)
      if (name !== 'media-gallery') await page.keyboard.press('Escape')
    }
    await page.getByRole('dialog', { name: 'Media' }).locator('button:has(img)').first().click()
    await shot(page, `${service}-media-viewer`)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    await page.locator(`#msg-${COUNT}`).getByRole('button', { name: 'Big Room' }).first().click()
    await shot(page, `${service}-member-profile`)
    await page.keyboard.press('Escape')
  })

  test(`${service}: app dialogs and search`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: buildBigRoom(50) }, service })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })

    await railMenu(page, '')
    await shot(page, `${service}-settings-menu`)
    await page.getByText('Settings', { exact: true }).click()
    await shot(page, `${service}-settings-general`)
    await page.getByRole('navigation').getByRole('button', { name: 'Sync', exact: true }).click()
    await shot(page, `${service}-settings-sync`)
    await page.getByRole('button', { name: 'Re-sync all', exact: true }).click()
    await shot(page, `${service}-confirm`)
    // Before D2c one Escape closes Settings with its confirm; after D2c the first closes the confirm.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)

    await railMenu(page, 'Settings')
    for (const [tab, name] of [['AI', 'ai'], ['Updates', 'updates']] as const) {
      await page.getByRole('navigation').getByRole('button', { name: tab, exact: true }).click()
      await shot(page, `${service}-settings-${name}`)
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0)

    await railMenu(page, 'About')
    await shot(page, `${service}-about`)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Add Service' }).click()
    await shot(page, `${service}-add-service`)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    await page.getByPlaceholder(/^Search messages/).fill('おはよう')
    await expect(page.locator('mark', { hasText: 'おはよう' }).first()).toBeVisible()
    await shot(page, `${service}-search`)
    await page.keyboard.press('Escape')
  })

  test(`${service}: blog dialogs`, async ({ page }) => {
    await pinBlogs(page, { service })
    await page.goto('/')
    await page.getByRole('button', { name: 'Select Member' }).click()
    await expect(page.getByRole('button', { name: /^春野/ }).first()).toBeVisible({ timeout: 10000 })
    await shot(page, `${service}-member-select`)
    await page.getByRole('button', { name: /^春野/ }).first().click()
    await expect(page.getByRole('heading', { level: 2, name: /春野/ })).toBeVisible()
    await shot(page, `${service}-member-timeline`)
    await page.getByRole('button', { name: 'Photo Album' }).click()
    await shot(page, `${service}-blog-gallery`)
  })
}

test('hinatazaka46: report issue, diagnostics, reveal all', async ({ page }) => {
  await pinBigRoom(page, { messages: { current: buildBigRoom() }, lastReadId: COUNT - 3 })
  await page.goto('/')
  await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
  await railMenu(page, 'Report Issue')
  await shot(page, 'hinatazaka46-report-issue')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await railMenu(page, 'About')
  const version = page.getByText(/^Version /).first()
  for (let i = 0; i < 5; i++) await version.click()
  await expect(page.getByText('Developer Diagnostics')).toBeVisible()
  await shot(page, 'hinatazaka46-diagnostics')
  await page.keyboard.press('Escape')

  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
  const shelter = page.locator(`#msg-${COUNT}`).getByTestId('unread-shelter')
  const box = (await shelter.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(page.getByRole('heading', { name: 'Reveal All Messages?' })).toBeVisible()
  await shot(page, 'hinatazaka46-reveal-all')
  await page.mouse.up()
})
