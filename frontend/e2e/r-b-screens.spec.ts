import { test, expect, type Locator, type Page } from '@playwright/test'
import { TZ } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Captures (does not compare) every blog screen of the three groups with blogs, so the v2
// re-apply can be reviewed against the pre-D2 look. The same spec runs on three builds:
//   SHOT_LABEL=base  - e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   - dev before R-b
//   SHOT_LABEL=after - this branch at the end
// Command (from frontend/, with port 8000 free; the tests run serially, so capture never competes for CPU):
//   SHOT_LABEL=after npx playwright test e2e/r-b-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-b/<label>/ (git-ignored). Yodel has no blogs.

const LABEL = process.env.SHOT_LABEL
const SERVICES = ['hinatazaka46', 'sakurazaka46', 'nogizaka46'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')
test.describe.configure({ mode: 'serial' })

/** Visible, in the viewport and with a stable box (two reads 250 ms apart equal): virtualized rows move while they mount. */
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
  // Park the pointer on the canvas below the sheet so no hover state is captured by accident.
  if (parkPointer) await page.mouse.move(1000, 797)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/r-b/${LABEL}/${name}.png`, animations: 'disabled' })
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
})

for (const service of SERVICES) {
  test(`${service}: feed, hover states, reader and rail`, async ({ page }) => {
    await pinBlogs(page, { service })
    await page.goto('/')
    const card = page.getByRole('button', { name: /春の日記 42/ })
    await settled(page, card)
    await expect(page.getByText('Checking for updates...')).toHaveCount(0)
    await shot(page, `${service}-feed`)

    await card.hover()
    await shot(page, `${service}-feed-card-hover`, false)
    await page.getByRole('button', { name: 'Select Member' }).hover()
    await shot(page, `${service}-feed-button-hover`, false)

    await card.click()
    await settled(page, page.getByRole('heading', { level: 1, name: '春の日記 42 🌸' }))
    await settled(page, page.getByRole('button', { name: /春の日記 41/ }))
    await shot(page, `${service}-reader`)

    const rail = page.getByTestId('timeline-rail')
    await settled(page, rail)
    const box = (await rail.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 30 + 0.3 * (box.height - 60))
    await expect(page.getByText('#30', { exact: true })).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(1000) // the dwell zoom is 800 ms
    await shot(page, `${service}-rail`, false)
  })

  test(`${service}: member select and member timeline`, async ({ page }) => {
    await pinBlogs(page, { service })
    await page.goto('/')
    await settled(page, page.getByRole('button', { name: /春の日記 42/ }))
    await page.getByRole('button', { name: 'Select Member' }).click()
    // The member cell is a button on dev and a div on e4e4118: match by text. The feed card
    // behind the modal also shows the name, but it comes first in the DOM, so take the last match.
    const cell = page.getByText(/春野/).last()
    await settled(page, cell)
    await shot(page, `${service}-member-select`)
    await cell.click()
    await settled(page, page.getByText(/春の日記 42/).first())
    await shot(page, `${service}-member-timeline`)
  })
}

test('hinatazaka46: empty feed', async ({ page }) => {
  await pinBlogs(page, { recent: 'empty' })
  await page.goto('/')
  await settled(page, page.getByText('No blog posts found'))
  await shot(page, 'hinatazaka46-feed-empty')
})

test('hinatazaka46: error feed', async ({ page }) => {
  await pinBlogs(page, { recent: 'error' })
  await page.goto('/')
  await settled(page, page.getByRole('button', { name: /retry/i }))
  await shot(page, 'hinatazaka46-feed-error')
})
