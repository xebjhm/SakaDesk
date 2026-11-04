import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ } from './fixtures/bigRoom'

// Captures (does not compare) the main screens of every group so the D2a redesign can be
// reviewed side by side. Run once on the unchanged code and once at the end:
//   SHOT_LABEL=before npx playwright test e2e/d2a-screens.spec.ts
// Files land in frontend/e2e-shots/<label>/ (git-ignored).

const LABEL = process.env.SHOT_LABEL
const SERVICES = ['hinatazaka46', 'sakurazaka46', 'nogizaka46', 'yodel'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=before or SHOT_LABEL=after')

for (const service of SERVICES) {
  test(`${service}: sidebar and chat`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await pinBigRoom(page, { messages: { current: buildBigRoom() }, service, lastReadId: COUNT - 3 })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: `e2e-shots/${LABEL}/${service}-home.png`, animations: 'disabled' })
    await page.getByText('Big Room', { exact: true }).click()
    // The chat lands on the first unread row (COUNT - 2); the rows above it may be scrolled away.
    await expect(page.locator(`#msg-${COUNT - 2}`)).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: `e2e-shots/${LABEL}/${service}-chat.png`, animations: 'disabled' })
  })
}
