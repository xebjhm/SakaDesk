import { test, expect, type Locator, type Page } from '@playwright/test'
import { pinEntry, RUNNING, MEDIA, COMPLETE } from './fixtures/entry'
import { buildBigRoom, pinBigRoom, roomDir, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Captures (does not compare) every R-d screen so the v2 re-apply can be reviewed against the
// pre-D2 look. The same spec runs on three builds:
//   SHOT_LABEL=base  - e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   - dev before R-d
//   SHOT_LABEL=after - this branch at the end
// Command (from frontend/, with port 8000 free; serial, so capture never competes for CPU):
//   SHOT_LABEL=after npx playwright test e2e/r-d-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-d/<label>/ (git-ignored). Every auth call is mocked
// (fixtures/entry.ts): never a real login.

const LABEL = process.env.SHOT_LABEL

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')
test.describe.configure({ mode: 'serial' })

/** Visible, in the viewport and with a stable box (two reads 250 ms apart equal). */
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

/** Two animation frames: progress polling never goes network-idle, so no networkidle wait here. */
async function shot(page: Page, name: string) {
  await page.mouse.move(1270, 795)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  await page.screenshot({ path: `e2e-shots/r-d/${LABEL}/${name}.png`, animations: 'disabled' })
}

async function startWith(page: Page, ...names: string[]) {
  await expect(page.getByRole('heading', { name: 'Welcome to SakaDesk' })).toBeVisible({ timeout: 30000 })
  for (const name of names) await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: /^Get Started/ }).click()
}

async function railMenu(page: Page, item: string) {
  await page.getByTitle('Settings', { exact: true }).click()
  await page.getByRole('menu').first().getByText(item, { exact: true }).click()
}

/** The big room plus a voice message (the compact voice player). */
function voiceRoom(): FixtureMessage[] {
  const voice = {
    id: COUNT + 1, member_id: '1', timestamp: new Date(Date.UTC(2026, 10, 3, 4, 0)).toISOString(), type: 'voice',
    content: null, is_favorite: false, media_file: 'messages/1 Big Room/1 Big Room/voice/5001.m4a', width: null, height: null,
  } as unknown as FixtureMessage
  return [...buildBigRoom(), voice]
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await page.route((url) => url.pathname === '/api/archive/stats', (route) =>
    route.fulfill({ json: { messages: 12846, photos: 2301, first_message_at: '2023-02-14T03:00:00Z' } }),
  )
})

test('boot', async ({ page }) => {
  await pinEntry(page)
  // Prefs never answer, so the app stays on its boot screen.
  await page.route('**/api/app-state/prefs', () => { /* never fulfilled */ })
  await page.goto('/')
  // The spinner never rests, so its rotating box is never "stable": wait for visible only.
  await expect(page.locator('.animate-spin').first()).toBeVisible({ timeout: 30000 })
  await shot(page, 'boot')
})

test('terms of service', async ({ page }) => {
  await pinEntry(page)
  await page.goto('/')
  const tos = page.getByRole('dialog', { name: 'Terms of Service' })
  await settled(page, tos)
  await shot(page, 'tos')
  await tos.getByText('Key excerpts from the official Terms of Service:').click()
  await shot(page, 'tos-excerpts')
})

test('landing', async ({ page }) => {
  await pinEntry(page, { tosAccepted: true })
  await page.goto('/')
  await settled(page, page.getByRole('heading', { name: 'Welcome to SakaDesk' }))
  await shot(page, 'landing-empty')
  await page.getByRole('button', { name: /日向坂46/ }).click()
  await page.getByRole('button', { name: /櫻坂46/ }).click()
  await shot(page, 'landing-two')
})

test('login over the entry backdrop and the Yodel warning', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.geoBlocked = true
  await page.goto('/')
  await startWith(page, 'Yodel')
  const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await settled(page, login)
  await shot(page, 'login-yodel')
  await login.getByRole('button', { name: 'Connect Account' }).click()
  await settled(page, page.getByRole('dialog', { name: 'Yodel is available in Japan only' }))
  await shot(page, 'login-yodel-geo')
})

test('setup, a sequential first sync and the first-sync toast', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  // The toast's count line reads the archive stats (pinned here, not only in beforeEach).
  await page.route((url) => url.pathname === '/api/archive/stats', (route) =>
    route.fulfill({ json: { messages: 12846, photos: 0, first_message_at: null } }),
  )
  state.progress.hinatazaka46 = RUNNING
  state.progress.sakurazaka46 = RUNNING
  await page.goto('/')
  await startWith(page, '日向坂46', '櫻坂46')
  for (const [i, name] of ['日向坂46', '櫻坂46'].entries()) {
    const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
    await expect(login).toContainText(name)
    await login.getByRole('button', { name: 'Connect Account' }).click()
    await expect.poll(() => state.loginCalls.length, { timeout: 10000 }).toBe(i + 1)
  }
  const setup = page.getByRole('dialog', { name: 'Welcome to SakaDesk' })
  await settled(page, setup)
  await shot(page, 'setup')
  // force: pre-R-d builds leave the button disabled (nothing happens); R-d validates on click.
  await setup.getByRole('button', { name: 'Start Using SakaDesk' }).click({ force: true })
  await shot(page, 'setup-missing')
  await setup.getByRole('button', { name: 'Browse' }).click()
  await expect(setup.getByLabel('Output Folder Path')).toHaveValue('C:\\SakaDesk-データ')
  await setup.getByRole('button', { name: 'Start Using SakaDesk' }).click()
  const sync = page.getByRole('dialog', { name: /^Phase/ })
  await expect(sync.getByText('5 / 20')).toBeVisible({ timeout: 30000 })
  await shot(page, 'sync-running')
  state.progress.sakurazaka46 = MEDIA
  await expect(page.getByText('Downloading media... Please do not close the app.')).toBeVisible({ timeout: 30000 })
  await shot(page, 'sync-media')
  state.progress.sakurazaka46 = COMPLETE
  await expect(page.getByText(/\(2\/2\)/)).toBeVisible({ timeout: 30000 })
  state.progress.hinatazaka46 = COMPLETE
  await expect(page.getByRole('dialog', { name: 'Complete' })).toBeVisible({ timeout: 30000 })
  await shot(page, 'sync-complete')
  // The toast exists only on builds with R-d; base and dev skip the shot. It mounts after the
  // last poll settles the sequence, so wait for it (well under its 6 s lifetime) instead of
  // counting once.
  const toast = page.getByRole('status').filter({ hasText: 'Your archive is ready' })
  const hasToast = await toast.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
  if (hasToast) {
    await expect(toast).toContainText('12,846 messages saved', { timeout: 5000 })
    await shot(page, 'first-sync-toast')
  }
})

test('inline sync of 櫻坂46 added to 日向坂46', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true, services: ['hinatazaka46'], configured: true, authed: ['hinatazaka46'] })
  state.progress.sakurazaka46 = RUNNING
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Groups' })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Add Service' }).click()
  await page.getByRole('dialog', { name: 'Add Service' }).getByRole('button', { name: /櫻坂46/ }).click()
  await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Connect Account' }).click()
  await expect(page.getByText('5 / 20')).toBeVisible({ timeout: 30000 })
  await shot(page, 'inline-sync-sakurazaka46')
})

for (const service of ['hinatazaka46', 'sakurazaka46'] as const) {
  test(`${service}: about, diagnostics, empty states, milestone, voice, gallery voice`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: voiceRoom() }, service })
    // A seen chat that has passed 1,000 messages before: 5,000 and day 100 are new (R-d builds only).
    const dir = roomDir(service)
    await page.route('**/api/app-state/prefs', (route) => {
      if (route.request().method() !== 'GET') return route.fulfill({ status: 204 })
      return route.fulfill({
        json: {
          tos_accepted_at: '2026-01-01T00:00:00Z',
          language: 'en',
          celebrated_milestones: { [`${service}|${dir}`]: { messages: [1000], days: [100] } },
          'sakadesk-app-state': JSON.stringify({ state: { selectedServices: [service], activeService: service, activeFeatures: { [service]: 'messages' } }, version: 4 }),
        },
      })
    })
    await page.route((url) => url.pathname === '/api/search/status', (route) => route.fulfill({ json: { is_building: false } }))
    await page.route((url) => url.pathname === '/api/search', (route) =>
      route.fulfill({ json: { query: 'zzz', normalized_query: 'zzz', total_count: 0, has_more: false, results: [] } }),
    )
    await page.goto('/')
    await settled(page, page.getByText('Big Room', { exact: true }))
    await shot(page, `${service}-chat-welcome`)

    await railMenu(page, 'About')
    const about = page.getByRole('dialog').first()
    await settled(page, about)
    await shot(page, `${service}-about`)
    const version = about.getByText(/^Version /).first()
    for (let i = 0; i < 5; i++) await version.click()
    const diagnostics = page.getByRole('dialog', { name: 'Developer Diagnostics' })
    await settled(page, diagnostics)
    await expect(diagnostics.getByRole('heading', { name: 'SYSTEM', exact: true })).toBeVisible({ timeout: 30000 })
    await shot(page, `${service}-diagnostics`)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    await page.getByPlaceholder(/^Search messages/).fill('zzz')
    await settled(page, page.getByText(/No results/).first())
    await shot(page, `${service}-search-empty`)
    await page.keyboard.press('Escape')

    await page.getByText('Big Room', { exact: true }).click()
    await settled(page, page.locator(`#msg-${COUNT + 1}`))
    await page.getByTitle('More options').click()
    await page.getByRole('menu').first().getByText('Favorites', { exact: true }).click()
    await settled(page, page.getByRole('dialog').first())
    await shot(page, `${service}-favorites-empty`)
    await page.keyboard.press('Escape')

    await shot(page, `${service}-chat-end`)

    // Decision D13: the gallery's voice tab draws the premium voice card (the opaque sheet card
    // on R-d; the glass card before), fed by voiceRoom()'s voice message.
    await page.getByTitle('More options').click()
    await page.getByRole('menu').first().getByText('Media', { exact: true }).click()
    const gallery = page.getByRole('dialog').first()
    await settled(page, gallery)
    await gallery.getByRole('tab', { name: 'Voice messages' }).click()
    await expect(gallery.getByRole('tab', { name: 'Voice messages' })).toHaveAttribute('aria-selected', 'true')
    // The card's own menu button: present only once the gallery player has rendered.
    await settled(page, gallery.getByRole('button', { name: 'More options' }).last())
    await shot(page, `${service}-gallery-voice`)
    await page.keyboard.press('Escape')
  })
}

test('blog feed empty state', async ({ page }) => {
  await pinBlogs(page, { recent: 'empty' })
  await page.goto('/')
  await settled(page, page.getByText(/No blog posts found/).first())
  await shot(page, 'blog-feed-empty')
})
