import { test, expect, type Page } from '@playwright/test'

// Pixel-regression guard for refactors that must not change the UI (D1 design-system
// foundation). Baselines are local-only (gitignored): capture them on the base commit
// with --update-snapshots, then run without it after the change.
//
// The backend test-mode fixtures no longer match the real API shapes (the groups
// payload is a bare list there, an object here), so the data the screens render is
// pinned here at the network layer. That also makes the baselines independent of
// whatever is in the machine's own app-state store.

const SERVICE = 'hinatazaka46'
const MEMBER_DIR = `${SERVICE}/messages/1 Test Member/1 Test Member`
const GROUP_DIR = `${SERVICE}/messages/2 Test Group Chat`

const member = (id: string, name: string, path: string) => ({
  id,
  name,
  dir_name: path.split('/').pop(),
  path,
  thumbnail: null,
  portrait: null,
  phone_image: null,
  group_thumbnail: null,
})

const MEMBER_ONE = member('1', 'Test Member', MEMBER_DIR)
const GROUP_MEMBER = member('3', 'Group Member', `${GROUP_DIR}/3 Group Member`)

const messages = (memberId: string) => [
  {
    id: 1,
    member_id: memberId,
    timestamp: '2026-11-03T09:00:00Z',
    type: 'text',
    content: 'Hello! This is a test message.',
    is_favorite: false,
    media_file: null,
    width: null,
    height: null,
  },
  {
    id: 2,
    member_id: memberId,
    timestamp: '2026-11-03T09:05:00Z',
    type: 'text',
    content: 'This is another test message.',
    is_favorite: true,
    media_file: null,
    width: null,
    height: null,
  },
]

const GROUPS = {
  groups: [
    {
      id: '1',
      name: 'Test Member',
      service: SERVICE,
      dir_name: '1 Test Member',
      group_path: `${SERVICE}/messages/1 Test Member`,
      member_count: 1,
      is_group_chat: false,
      is_active: true,
      is_graduated: false,
      server_unread_count: 1,
      thumbnail: null,
      thumbnail_local: null,
      last_message_id: 2,
      total_messages: 2,
      members: [MEMBER_ONE],
    },
    {
      id: '2',
      name: 'Test Group Chat',
      service: SERVICE,
      dir_name: '2 Test Group Chat',
      group_path: GROUP_DIR,
      member_count: 1,
      is_group_chat: true,
      is_active: true,
      is_graduated: false,
      server_unread_count: 1,
      thumbnail: null,
      thumbnail_local: null,
      last_message_id: 2,
      total_messages: 2,
      members: [GROUP_MEMBER],
    },
  ],
  last_sync: {},
}

async function pinData(page: Page) {
  await page.route('**/api/app-state/prefs', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204 })
    // Skip the first-run ToS dialog and the service-selection onboarding.
    return route.fulfill({
      json: {
        tos_accepted_at: '2026-01-01T00:00:00Z',
        language: 'en',
        'sakadesk-app-state': JSON.stringify({
          state: {
            selectedServices: [SERVICE],
            activeService: SERVICE,
            activeFeatures: { [SERVICE]: 'messages' },
          },
          version: 4,
        }),
      },
    })
  })
  // Keep the app out of its "Syncing..." state: nothing is syncing in these shots.
  await page.route('**/api/sync/progress*', (route) =>
    route.fulfill({ json: { state: 'idle' } }),
  )
  await page.route('**/api/sync/start*', (route) =>
    route.fulfill({ json: { status: 'started' } }),
  )
  await page.route('**/api/content/groups*', (route) => route.fulfill({ json: GROUPS }))
  // Message 1 is read (bubble visible), message 2 stays unread (shelter + badge).
  await page.route('**/api/app-state/conversation-all', (route) =>
    route.fulfill({
      json: Object.fromEntries(
        [MEMBER_DIR, GROUP_DIR].map((dir) => [
          `read_state_${dir}`,
          { value: JSON.stringify({ lastReadId: 1, revealedIds: [] }) },
        ]),
      ),
    }),
  )
  await page.route('**/api/content/unread_counts*', (route) =>
    route.fulfill({ json: { [MEMBER_DIR]: 1, [GROUP_DIR]: 1 } }),
  )
  await page.route('**/api/content/messages_by_path*', (route) =>
    route.fulfill({
      json: {
        member: MEMBER_ONE,
        messages: messages('1'),
        total_count: 2,
        unread_count: 1,
        max_message_id: 2,
      },
    }),
  )
  await page.route('**/api/content/group_messages/**', (route) =>
    route.fulfill({
      json: {
        members: [GROUP_MEMBER],
        messages: messages('3'),
        total_messages: 2,
        unread_count: 1,
        max_message_id: 2,
      },
    }),
  )
  // D2a: letters, account profile and streak are pinned so the shots do not depend on the machine.
  await page.route('**/api/chat/letters_local*', (route) => route.fulfill({ json: { letters: [] } }))
  await page.route('**/api/account/profile*', (route) => route.fulfill({ json: { name: null, avatars: [] } }))
  await page.route('**/api/chat/streak/**', (route) => route.fulfill({ json: { days: 0, is_active: false } }))
}

test.describe('zero-pixel regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    await page.setViewportSize({ width: 1280, height: 800 })
    await pinData(page)
  })

  test('home', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Test Member')).toBeVisible({ timeout: 10000 })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('home.png', { fullPage: true })
  })

  test('member chat', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Test Member').click()
    await expect(page.getByText('Hello! This is a test message.')).toBeVisible()
    // The click leaves the pointer on the member cell (hover lift); park it away so the shot is stable.
    await page.mouse.move(1000, 700)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('chat-member.png', { fullPage: true })
  })

  test('group chat', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Test Group Chat').click()
    await expect(page.getByText('Hello! This is a test message.')).toBeVisible()
    // The click leaves the pointer on the member cell (hover lift); park it away so the shot is stable.
    await page.mouse.move(1000, 700)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot('chat-group.png', { fullPage: true })
  })
})
