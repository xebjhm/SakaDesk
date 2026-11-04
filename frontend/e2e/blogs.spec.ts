import { test, expect, type Page } from '@playwright/test'
import { TZ } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Behaviour locks of the blog screens (D2b): written against the pre-D2b code and kept green
// through the restyle. Selectors use roles, names and text that survive the restyle.

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await pinBlogs(page)
})

const postTitle = (page: Page, name: string) => page.getByRole('heading', { level: 1, name })

async function openNewest(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /春の日記 42/ }).click()
  await expect(postTitle(page, '春の日記 42 🌸')).toBeVisible({ timeout: 10000 })
}

test('a card in the recent feed opens that post in the reader', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Latest Blogs' })).toBeVisible({ timeout: 10000 })
  const content = page.waitForRequest(
    (r) => r.url().includes('/api/blogs/content') && new URL(r.url()).searchParams.get('blog_id') === '142',
  )
  await page.getByRole('button', { name: /春の日記 42/ }).click()
  await content
  await expect(postTitle(page, '春の日記 42 🌸')).toBeVisible()
  await expect(page.getByText(/最後まで読んでくれてありがとう/)).toBeVisible()
})

test('the older/newer buttons and the arrow keys walk the member posts', async ({ page }) => {
  await openNewest(page)
  await page.getByRole('button', { name: /春の日記 41/ }).click()
  await expect(postTitle(page, '春の日記 41 🌸')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(postTitle(page, '春の日記 42 🌸')).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(postTitle(page, '春の日記 41 🌸')).toBeVisible()
})

test('a click near the bottom of the timeline rail opens the oldest post', async ({ page }) => {
  await openNewest(page)
  const rail = page.getByTestId('timeline-rail')
  await expect(rail).toBeVisible()
  const box = (await rail.boundingBox())!
  // The rail maps 30 px from its top (newest) to 30 px from its bottom (oldest).
  const x = box.x + box.width / 2
  const y = box.y + box.height - 30
  // The rail selects from the hover state: let the hover render (tooltip shows #1) before clicking.
  await page.mouse.move(x, y)
  await expect(page.getByText('#1', { exact: true })).toBeVisible()
  await page.mouse.click(x, y)
  await expect(postTitle(page, '春の日記 01 🌸')).toBeVisible()
  await expect(rail.getByText('1/42')).toBeVisible()
})

test('back returns from the reader to the recent feed', async ({ page }) => {
  await openNewest(page)
  await page.getByRole('button', { name: 'Back to latest blogs' }).click()
  await expect(page.getByRole('heading', { name: 'Latest Blogs' })).toBeVisible()
})

test('a post chosen in the member timeline opens, and back returns to that timeline', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Select Member' }).click()
  // Member cells are div[role=button]; the feed cards are <button> elements.
  await page.locator('div[role="button"]', { hasText: '春野' }).click()
  const timelineHeading = page.getByRole('heading', { level: 2, name: /春野/ })
  await expect(timelineHeading).toBeVisible()
  await page.getByRole('button', { name: /春の日記 39/ }).click()
  await expect(postTitle(page, '春の日記 39 🌸')).toBeVisible()
  await page.getByRole('button', { name: 'Back to latest blogs' }).click()
  await expect(timelineHeading).toBeVisible()
})

test('the member name in the reader opens that member timeline', async ({ page }) => {
  await openNewest(page)
  await page.getByRole('button', { name: /^春野/ }).first().click()
  await expect(page.getByRole('heading', { level: 2, name: /春野/ })).toBeVisible()
})
