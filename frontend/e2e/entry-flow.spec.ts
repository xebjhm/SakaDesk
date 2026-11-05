// frontend/e2e/entry-flow.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { pinEntry, RUNNING, COMPLETE } from './fixtures/entry'
import { TZ } from './fixtures/bigRoom'

// Locks the entry flow before D2d restyles it. Every auth call is mocked (fixtures/entry.ts).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

async function acceptTos(page: Page) {
  const tos = page.getByRole('dialog', { name: 'Terms of Service' })
  await expect(tos).toBeVisible({ timeout: 10000 })
  const accept = tos.getByRole('button', { name: 'Accept and Continue' })
  await expect(accept).toBeDisabled()
  await tos.getByRole('checkbox').check()
  await accept.click()
}

/** The accepted ToS reaches the prefs store as a write-once timestamp. */
async function expectTosSaved(state: { prefsPosts: Record<string, unknown>[] }) {
  await expect.poll(() => state.prefsPosts.some((p) => typeof p.tos_accepted_at === 'string')).toBe(true)
}

/** On the landing page: pick the groups (by name, in order) and press Get Started. */
async function startWith(page: Page, ...names: string[]) {
  await expect(page.getByRole('heading', { name: 'Welcome to SakaDesk' })).toBeVisible({ timeout: 10000 })
  for (const name of names) await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: /^Get Started/ }).click()
}

test('first launch: terms, groups, login, folder, first sync, then the app', async ({ page }) => {
  const state = await pinEntry(page)
  state.progress.hinatazaka46 = RUNNING
  await page.goto('/')
  await acceptTos(page)
  await expectTosSaved(state)
  await startWith(page, '日向坂46')

  const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await expect(login).toBeVisible()
  await login.getByRole('button', { name: 'Connect Account' }).click()
  await expect.poll(() => state.loginCalls).toEqual(['hinatazaka46'])

  const setup = page.getByRole('dialog', { name: 'Welcome to SakaDesk' })
  await expect(setup).toBeVisible({ timeout: 10000 })
  await setup.getByPlaceholder('C:\\Users\\YourName\\SakaDesk-data').fill('C:\\SakaDesk-データ')
  await setup.getByRole('button', { name: 'Start Using SakaDesk' }).click()
  await expect.poll(() => state.settingsSaves).toContainEqual({ output_dir: 'C:\\SakaDesk-データ' })

  const sync = page.getByRole('dialog', { name: /^Phase 1/ })
  await expect(sync).toBeVisible({ timeout: 10000 })
  await expect(sync.getByText('5 / 20')).toBeVisible({ timeout: 10000 })
  expect(state.syncStarts).toEqual(['hinatazaka46'])
  state.progress.hinatazaka46 = COMPLETE
  await expect(page.getByRole('dialog', { name: 'Complete' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('dialog', { name: 'Complete' })).toHaveCount(0, { timeout: 10000 })
  await expect(page.getByRole('navigation', { name: 'Groups' })).toBeVisible()
})

test('a failed login shows the error; Maybe Later moves on to the folder setup', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.loginStatus = 500
  await page.goto('/')
  await startWith(page, '日向坂46')
  const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await login.getByRole('button', { name: 'Connect Account' }).click()
  await expect(login.getByText('Login failed or cancelled')).toBeVisible()
  await login.getByRole('button', { name: 'Maybe Later' }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to SakaDesk' })).toBeVisible()
  expect(state.loginCalls).toEqual(['hinatazaka46'])
})

test('Yodel warns outside Japan; Log in anyway still logs in', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.geoBlocked = true
  await page.goto('/')
  await startWith(page, 'Yodel')
  await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Connect Account' }).click()
  const warning = page.getByRole('dialog', { name: 'Yodel is available in Japan only' })
  await expect(warning).toBeVisible()
  expect(state.loginCalls).toEqual([])
  await warning.getByRole('button', { name: 'Log in anyway' }).click()
  await expect.poll(() => state.loginCalls).toEqual(['yodel'])
})

test('a newly added group shows the inline sync view while its first sync runs', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true, services: ['hinatazaka46'], configured: true, authed: ['hinatazaka46'] })
  state.progress.sakurazaka46 = RUNNING
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Groups' })).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Add Service' }).click()
  await page.getByRole('dialog', { name: 'Add Service' }).getByRole('button', { name: /櫻坂46/ }).click()
  await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Connect Account' }).click()
  await expect(page.getByRole('heading', { name: 'Phase 1: Scanning Groups' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('5 / 20')).toBeVisible()
  expect(state.loginCalls).toEqual(['sakurazaka46'])
  // The already-added group syncs at start-up; each group starts exactly once.
  await expect.poll(() => state.syncStarts).toEqual(['hinatazaka46', 'sakurazaka46'])
  state.progress.sakurazaka46 = COMPLETE
  await expect(page.getByRole('heading', { name: 'Phase 1: Scanning Groups' })).toHaveCount(0, { timeout: 10000 })  // No late extra start once the first sync completes.
  expect(state.syncStarts).toEqual(['hinatazaka46', 'sakurazaka46'])
})

test('a short window scrolls the terms; Accept stays on screen (D2d)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 })
  await pinEntry(page)
  await page.goto('/')
  const tos = page.getByRole('dialog', { name: 'Terms of Service' })
  await expect(tos).toBeVisible({ timeout: 10000 })
  await expect(tos.getByRole('button', { name: 'Accept and Continue' })).toBeInViewport({ ratio: 1 })
  await tos.getByRole('checkbox').check()
  await expect(tos.getByRole('button', { name: 'Accept and Continue' })).toBeEnabled()
  await expect(tos.getByRole('button', { name: 'Accept and Continue' })).toBeInViewport({ ratio: 1 })
})

test('the next service login dialog shows no error from the previous failed login (D2d)', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.loginStatus = 500
  await page.goto('/')
  await startWith(page, '日向坂46', '櫻坂46')
  const first = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await first.getByRole('button', { name: 'Connect Account' }).click()
  await expect(first.getByText('Login failed or cancelled')).toBeVisible()
  await first.getByRole('button', { name: 'Maybe Later' }).click()
  const second = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await expect(second).toContainText('櫻坂46')
  await expect(second.getByRole('alert')).toHaveCount(0)
  await expect(second.getByText('Login failed or cancelled')).toHaveCount(0)
})
