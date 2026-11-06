import { test, expect, type Locator, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Captures (does not compare) every R-c dialog so the v2 re-apply can be reviewed against the
// pre-D2 look. The same spec runs on three builds:
//   SHOT_LABEL=base  - e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   - dev before R-c
//   SHOT_LABEL=after - this branch at the end
// Command (from frontend/, with port 8000 free; the tests run serially, so capture never competes for CPU):
//   SHOT_LABEL=after npx playwright test e2e/r-c-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-c/<label>/ (git-ignored). Chat dialogs are captured in all four
// groups (they follow the group); brand dialogs in two groups (they must look the same in both).

const LABEL = process.env.SHOT_LABEL
const GROUPS = ['hinatazaka46', 'sakurazaka46', 'nogizaka46', 'yodel'] as const
const BRAND_CHECK = ['hinatazaka46', 'sakurazaka46'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')
test.describe.configure({ mode: 'serial' })

/** Visible, in the viewport and with a stable box (two reads 250 ms apart equal): dialogs animate in. */
async function settled(page: Page, locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30000 })
  await expect(locator).toBeInViewport({ timeout: 30000 })
  let last = JSON.stringify(await locator.boundingBox())
  await expect.poll(async () => {
    await page.waitForTimeout(250)
    const now = JSON.stringify(await locator.boundingBox())
    const same = now === last
    last = now
    return same
  }, { timeout: 15000 }).toBe(true)
}

async function shot(page: Page, name: string, parkPointer = true) {
  // Park the pointer in the bottom-right corner (on the scrim) so no hover state is captured by accident.
  if (parkPointer) await page.mouse.move(1270, 795)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/r-c/${LABEL}/${name}.png`, animations: 'disabled' })
}

/** Presses Escape until no dialog is left (nested viewer / voice selection close one at a time). */
async function closeAll(page: Page) {
  for (let i = 0; i < 4 && (await page.getByRole('dialog').count()) > 0; i++) await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 })
}

/** The big room plus a voice, a video and a favourite Japanese text (all read). */
function mediaRoom(): FixtureMessage[] {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 4, minute)).toISOString()
  const extra = [
    { id: COUNT + 1, member_id: '1', timestamp: at(0), type: 'voice', content: null, is_favorite: true,
      media_file: 'messages/1 Big Room/1 Big Room/voice/5001.m4a', width: null, height: null },
    { id: COUNT + 2, member_id: '1', timestamp: at(1), type: 'video', content: null, is_favorite: false,
      media_file: 'messages/1 Big Room/1 Big Room/video/5002.mp4', width: 640, height: 360 },
    { id: COUNT + 3, member_id: '1', timestamp: at(2), type: 'text', content: '今日もありがとう🌸',
      is_favorite: true, media_file: null, width: null, height: null },
  ] as unknown as FixtureMessage[]
  return [...buildBigRoom(), ...extra]
}

async function railMenu(page: Page, item: string) {
  await page.getByTitle('Settings', { exact: true }).click()
  await page.getByRole('menu').first().getByText(item, { exact: true }).click()
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

for (const service of GROUPS) {
  test(`${service}: chat dialogs`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: mediaRoom() }, service })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await settled(page, page.locator(`#msg-${COUNT + 3}`))

    for (const [item, name] of [['Date Search', 'calendar'], ['Favorites', 'favorites'], ['Background', 'background'], ['Sent Letters', 'sent-letters'], ['Media', 'media-gallery']] as const) {
      await page.getByTitle('More options').click()
      await page.getByRole('menu').first().getByText(item, { exact: true }).click()
      await settled(page, page.getByRole('dialog').first())
      await shot(page, `${service}-${name}`)
      if (name !== 'media-gallery') await closeAll(page)
    }

    const gallery = page.getByRole('dialog', { name: 'Media' })
    await gallery.locator('button:has(img)').first().click()
    await settled(page, page.getByRole('dialog', { name: /media viewer/i }))
    await shot(page, `${service}-media-viewer`)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /media viewer/i })).toHaveCount(0, { timeout: 30000 })

    await gallery.getByRole('tab', { name: 'Voice messages' }).click()
    const voiceRow = gallery.locator('button[aria-pressed]').first()
    await settled(page, voiceRow)
    await voiceRow.click()
    await shot(page, `${service}-media-voice`)
    await closeAll(page)
  })
}

for (const service of BRAND_CHECK) {
  test(`${service}: brand dialogs`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: buildBigRoom(50) }, service })
    await page.goto('/')
    await settled(page, page.getByText('Big Room', { exact: true }))

    await railMenu(page, 'Settings')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settled(page, settings)
    await shot(page, `${service}-settings-general`)
    await settings.getByRole('navigation').getByRole('button', { name: 'Sync', exact: true }).click()
    await shot(page, `${service}-settings-sync`)
    await settings.getByRole('button', { name: 'Re-sync all', exact: true }).click()
    await settled(page, page.getByRole('dialog').last())
    await shot(page, `${service}-confirm`)
    await page.keyboard.press('Escape')
    await settings.getByRole('navigation').getByRole('button', { name: 'Updates', exact: true }).click()
    await shot(page, `${service}-settings-updates`)
    await closeAll(page)

    await railMenu(page, 'About')
    await settled(page, page.getByRole('dialog').first())
    await shot(page, `${service}-about`)
    const version = page.getByRole('dialog').first().getByText(/^Version /).first()
    for (let i = 0; i < 5; i++) await version.click()
    const diagnostics = page.getByRole('dialog', { name: 'Developer Diagnostics' })
    await settled(page, diagnostics)
    await expect(diagnostics.getByRole('heading', { name: 'SYSTEM' })).toBeVisible({ timeout: 30000 })
    await expect(diagnostics.locator('.animate-spin')).toHaveCount(0, { timeout: 30000 })
    await settled(page, diagnostics.getByRole('heading', { name: 'SYSTEM' }))
    await shot(page, `${service}-diagnostics`)
    await closeAll(page)

    await railMenu(page, 'Report Issue')
    const report = page.getByRole('dialog').first()
    await settled(page, report)
    await report.getByRole('button', { name: /Sync \/ Data/ }).click()
    await shot(page, `${service}-report-issue`)
    await closeAll(page)

    await page.getByRole('button', { name: 'Add Service' }).click()
    await settled(page, page.getByRole('dialog').first())
    await shot(page, `${service}-add-service`)
    await closeAll(page)

    await page.keyboard.press('Control+k')
    await page.getByPlaceholder(/^Search messages/).fill('おはよう')
    await settled(page, page.locator('mark', { hasText: 'おはよう' }).first())
    await page.keyboard.press('ArrowDown')
    await shot(page, `${service}-search`)
    await closeAll(page)
  })
}
