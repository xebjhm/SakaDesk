import { test, expect } from '@playwright/test'
import { pinBlogs } from './fixtures/blogs'

// Owner comparison for plan F Task 11: ORBS_SHOT=before|after names the file in e2e-shots/.
test('blog feed orbs screenshot', async ({ page }) => {
  test.skip(!process.env.ORBS_SHOT, 'manual comparison only')
  await page.emulateMedia({ reducedMotion: 'reduce' }) // orbs hold still: comparable frames
  await pinBlogs(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Latest Blogs' })).toBeVisible({ timeout: 10000 })
  await page.screenshot({ path: `e2e-shots/blog-orbs-${process.env.ORBS_SHOT}.png` })
})
