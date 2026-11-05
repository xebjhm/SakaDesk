import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, roomDir, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Captures (does not compare) every R-a screen (frame + chat) of every group, so the v2
// re-apply can be reviewed against the pre-D2 look. The same spec and fixture run on three builds:
//   SHOT_LABEL=base  — e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   — dev before R-a
//   SHOT_LABEL=after — this branch at the end
//   SHOT_LABEL=after npx playwright test e2e/r-a-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-a/<label>/ (git-ignored).

const LABEL = process.env.SHOT_LABEL
const SERVICES = ['hinatazaka46', 'sakurazaka46', 'nogizaka46', 'yodel'] as const
// 1×1 transparent PNG (images); the voice file only needs an audio content type.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')

async function shot(page: Page, name: string) {
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/r-a/${LABEL}/${name}.png`, animations: 'disabled' })
}

/** The big room plus a voice, a video and a favourite Japanese text with a link (all read). */
function mediaRoom(): FixtureMessage[] {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 4, minute)).toISOString()
  const extra = [
    { id: COUNT + 1, member_id: '1', timestamp: at(0), type: 'voice', content: null, is_favorite: false,
      media_file: 'messages/1 Big Room/1 Big Room/voice/5001.m4a', width: null, height: null },
    { id: COUNT + 2, member_id: '1', timestamp: at(1), type: 'video', content: null, is_favorite: false,
      media_file: 'messages/1 Big Room/1 Big Room/video/5002.mp4', width: 640, height: 360 },
    { id: COUNT + 3, member_id: '1', timestamp: at(2), type: 'text', content: '今日もありがとう🌸 https://example.com',
      is_favorite: true, media_file: null, width: null, height: null },
  ] as unknown as FixtureMessage[]
  return [...buildBigRoom(), ...extra]
}

for (const service of SERVICES) {
  test(`${service}: frame, member list and the unread chat`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await pinBigRoom(page, { messages: { current: buildBigRoom() }, service, lastReadId: COUNT - 3 })
    await page.goto('/')
    await expect(page.getByText('Big Room', { exact: true })).toBeVisible({ timeout: 10000 })
    await shot(page, `${service}-home`)

    await page.getByText('Big Room', { exact: true }).click({ button: 'right' })
    await shot(page, `${service}-member-menu`)
    await page.keyboard.press('Escape')
    await page.mouse.click(1000, 797) // an outside click closes the menu on every build

    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT - 2}`)).toBeVisible({ timeout: 10000 })
    await shot(page, `${service}-chat-unread`)
  })

  test(`${service}: media, menus and the profile card`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await pinBigRoom(page, { messages: { current: mediaRoom() }, service })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT + 3}`)).toBeVisible({ timeout: 10000 })
    await shot(page, `${service}-chat-media`)

    await page.getByTitle('More options').click()
    await shot(page, `${service}-conversation-menu`)
    await page.mouse.click(1000, 797)

    await page.locator(`#msg-${COUNT + 3}`).getByText(/今日もありがとう/).click({ button: 'right' })
    await shot(page, `${service}-message-menu`)
    await page.keyboard.press('Escape')
    await page.mouse.click(1000, 797)

    // The first button of a run's first row is the avatar on every build.
    await page.locator(`#msg-${COUNT + 1}`).locator('button').first().click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await shot(page, `${service}-profile`)
    await page.keyboard.press('Escape')
  })

  test(`${service}: call popup`, async ({ page }) => {
    const dir = roomDir(service)
    const voice = {
      id: 9100, member_id: '1', timestamp: '2026-11-04T02:00:00Z', type: 'voice', content: null, is_favorite: false,
      media_file: 'messages/1 Big Room/1 Big Room/voice/9100.m4a', width: null, height: null,
    }
    const member = {
      id: '1', name: '春野 ひなた', dir_name: '1 Big Room', path: dir, thumbnail: null, portrait: null,
      phone_image: `/api/content/media/${service}/members/1/phone.png`, group_thumbnail: null,
    }
    await page.route('**/api/call-popup/calls/1', (r) => r.fulfill({
      json: { call_id: 1, service, path: dir, is_group_chat: false, group_id: '1', member_id: '1', message_id: 9100 },
    }))
    await page.route('**/api/call-popup/calls/1/events', (r) => r.fulfill({ status: 204 }))
    await page.route('**/api/settings', (r) => r.fulfill({ json: { call_popup_enabled: true, incoming_call_enabled: true } }))
    await page.route('**/api/app-state/prefs', (r) => r.fulfill({ json: { language: 'en' } }))
    await page.route((u) => u.pathname === '/api/app-state/conversation', (r) =>
      r.fulfill({ json: { value: JSON.stringify({ lastReadId: 0, revealedIds: [] }) } }))
    await page.route('**/api/content/messages_by_path*', (r) => r.fulfill({
      json: { member, messages: [voice], total_count: 1, unread_count: 1, max_message_id: 9100 },
    }))
    await page.route('**/api/content/media/**', (r) => r.request().url().includes('/voice/')
      ? r.fulfill({ body: Buffer.alloc(16), contentType: 'audio/mp4' })
      : r.fulfill({ body: PNG, contentType: 'image/png' }))
    await page.route('**/api/client-log', (r) => r.fulfill({ status: 204 }))
    await page.setViewportSize({ width: 340, height: 600 })
    await page.goto('/?view=call-popup')
    await page.evaluate(() => (window as unknown as { __sakadeskCallPopup: { start(id: number): void } }).__sakadeskCallPopup.start(1))
    await expect(page.locator('.sd-call-ring')).toBeVisible({ timeout: 10000 })
    await shot(page, `${service}-call-popup`)
  })
}
