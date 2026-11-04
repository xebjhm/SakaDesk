import { test, expect, type Page } from '@playwright/test'
import { TZ } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Captures (does not compare) the blog screens of the three groups with blogs so the D2b
// restyle can be reviewed side by side. Run once on the unchanged code and once at the end:
//   SHOT_LABEL=before npx playwright test e2e/d2b-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/<label>/ (git-ignored). Yodel has no blogs.

const LABEL = process.env.SHOT_LABEL
const SERVICES = ['hinatazaka46', 'sakurazaka46', 'nogizaka46'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=before or SHOT_LABEL=after')

async function shot(page: Page, name: string) {
  // Park the pointer on the canvas below the sheet so no hover state is captured.
  await page.mouse.move(1000, 797)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/${LABEL}/${name}.png`, animations: 'disabled' })
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
})

for (const service of SERVICES) {
  test(`${service}: blog feed, reader and rail`, async ({ page }) => {
    await pinBlogs(page, { service })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /春の日記 42/ })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Checking for updates...')).toHaveCount(0)
    await shot(page, `${service}-blogs-feed`)

    await page.getByRole('button', { name: /春の日記 42/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeVisible()
    await expect(page.getByRole('button', { name: /春の日記 41/ })).toBeVisible()
    await shot(page, `${service}-blogs-reader`)

    const rail = page.getByTestId('timeline-rail')
    const box = (await rail.boundingBox())!
    // 30% down the usable track (30 px padding each end): index round(0.3 * 41) = 12 → post #30.
    await page.mouse.move(box.x + box.width / 2, box.y + 30 + 0.3 * (box.height - 60))
    await expect(page.getByText('#30', { exact: true })).toBeVisible()
    // The dwell zoom (800 ms) widens the track from 2 px to 3 px; capture only once it applied.
    const track = rail.locator(':scope > div').first()
    await expect
      .poll(() => track.evaluate((el) => getComputedStyle(el).width))
      .toBe('3px')
    await page.screenshot({ path: `e2e-shots/${LABEL}/${service}-blogs-rail.png`, animations: 'disabled' })
  })
}

test('hinatazaka46: empty feed', async ({ page }) => {
  await pinBlogs(page, { recent: 'empty' })
  await page.goto('/')
  await expect(page.getByText('No blog posts found')).toBeVisible({ timeout: 10000 })
  await shot(page, 'hinatazaka46-blogs-empty')
})

test('hinatazaka46: failed feed', async ({ page }) => {
  await pinBlogs(page, { recent: 'error' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 10000 })
  await shot(page, 'hinatazaka46-blogs-error')
})
