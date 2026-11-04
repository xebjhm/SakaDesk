// frontend/e2e/entry-screens.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { pinEntry, RUNNING, MEDIA, COMPLETE } from './fixtures/entry'
import { TZ } from './fixtures/bigRoom'

// Captures (does not compare) every D2d entry screen so the restyle can be reviewed side by side.
//   SHOT_LABEL=before npx playwright test e2e/entry-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/<label>/ (git-ignored). Every auth call is mocked (fixtures/entry.ts).

const LABEL = process.env.SHOT_LABEL

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=before or SHOT_LABEL=after')

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/${LABEL}/entry-${name}.png`, animations: 'disabled' })
}

async function startWith(page: Page, ...names: string[]) {
  await expect(page.getByRole('heading', { name: 'Welcome to SakaDesk' })).toBeVisible({ timeout: 10000 })
  for (const name of names) await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: /^Get Started/ }).click()
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
})

test('terms of service', async ({ page }) => {
  await pinEntry(page)
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Terms of Service' })).toBeVisible({ timeout: 10000 })
  await shot(page, 'tos')
  await page.setViewportSize({ width: 1280, height: 480 })
  await shot(page, 'tos-short')
})

test('landing', async ({ page }) => {
  await pinEntry(page, { tosAccepted: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome to SakaDesk' })).toBeVisible({ timeout: 10000 })
  await shot(page, 'landing-empty')
  await page.getByRole('button', { name: /日向坂46/ }).click()
  await page.getByRole('button', { name: /櫻坂46/ }).click()
  await shot(page, 'landing-two')
})

test('login: gradient, error, light header', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  await page.goto('/')
  await startWith(page, '日向坂46', '櫻坂46')
  const first = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await expect(first).toBeVisible()
  await shot(page, 'login-hinatazaka46')
  state.loginStatus = 500
  await first.getByRole('button', { name: 'Connect Account' }).click()
  await expect(first.getByText('Login failed or cancelled')).toBeVisible()
  await shot(page, 'login-error')
  await first.getByRole('button', { name: 'Maybe Later' }).click()
  await expect(page.getByRole('dialog', { name: 'Connect Your Account?' })).toBeVisible()
  await shot(page, 'login-sakurazaka46')
})

test('login: the Yodel warning', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.geoBlocked = true
  await page.goto('/')
  await startWith(page, 'Yodel')
  await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Connect Account' }).click()
  await expect(page.getByRole('dialog', { name: 'Yodel is available in Japan only' })).toBeVisible()
  await shot(page, 'login-yodel-geo')
})

test('setup and a sequential first sync', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.progress.hinatazaka46 = RUNNING
  state.progress.sakurazaka46 = RUNNING
  await page.goto('/')
  await startWith(page, '日向坂46', '櫻坂46')
  for (let i = 0; i < 2; i++) {
    const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
    await login.getByRole('button', { name: 'Connect Account' }).click()
    await expect.poll(() => state.loginCalls.length, { timeout: 10000 }).toBe(i + 1)
  }
  const setup = page.getByRole('dialog', { name: 'Welcome to SakaDesk' })
  await expect(setup).toBeVisible({ timeout: 10000 })
  await shot(page, 'setup')
  await setup.getByPlaceholder('C:\\Users\\YourName\\SakaDesk-data').fill('C:\\SakaDesk-データ')
  await setup.getByRole('button', { name: 'Start Using SakaDesk' }).click()
  const sync = page.getByRole('dialog', { name: /^Phase/ })
  await expect(sync.getByText('5 / 20')).toBeVisible({ timeout: 10000 })
  await shot(page, 'sync-running')
  // The first sync runs in the app's own service order (櫻坂46 before 日向坂46), not the click order.
  state.progress.sakurazaka46 = MEDIA
  await expect(page.getByText('Downloading media... Please do not close the app.')).toBeVisible({ timeout: 10000 })
  await shot(page, 'sync-media')
  state.progress.sakurazaka46 = COMPLETE
  await expect(page.getByText(/\(2\/2\)/)).toBeVisible({ timeout: 10000 })
  state.progress.hinatazaka46 = COMPLETE
  await expect(page.getByRole('dialog', { name: 'Complete' })).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: `e2e-shots/${LABEL}/entry-sync-complete.png`, animations: 'disabled' })
})

for (const [base, added] of [['hinatazaka46', '櫻坂46'], ['sakurazaka46', '日向坂46']] as const) {
  test(`inline sync of ${added} added to ${base}`, async ({ page }) => {
    const state = await pinEntry(page, { tosAccepted: true, services: [base], configured: true, authed: [base] })
    const addedId = added === '櫻坂46' ? 'sakurazaka46' : 'hinatazaka46'
    state.progress[addedId] = RUNNING
    await page.goto('/')
    await expect(page.getByRole('navigation', { name: 'Groups' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Add Service' }).click()
    await page.getByRole('dialog', { name: 'Add Service' }).getByRole('button', { name: new RegExp(added) }).click()
    await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Connect Account' }).click()
    await expect(page.getByText('5 / 20')).toBeVisible({ timeout: 10000 })
    await shot(page, `inline-sync-${addedId}`)
  })
}

test('the settings error toast over Settings', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true, services: ['hinatazaka46'], configured: true, authed: ['hinatazaka46'] })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Groups' })).toBeVisible({ timeout: 10000 })
  state.settingsSaveStatus = 500
  await page.getByTitle('Settings', { exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('switch', { name: 'Incoming calls' }).click()
  await expect(page.getByTestId('settings-error-toast')).toBeVisible()
  await shot(page, 'error-toast')
})
