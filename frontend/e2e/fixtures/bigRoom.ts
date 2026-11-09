import type { Page } from '@playwright/test'

// A deterministic 5,000-message room spanning 2022-01 … 2026-11, used to test
// virtual scrolling and jumps in a real browser (jsdom cannot measure layout).
// Timestamps are spread evenly, so every local (Asia/Tokyo) day has 2–3 messages.

export const TZ = 'Asia/Tokyo'
export const SERVICE = 'hinatazaka46'
export const roomDir = (service: string) => `${service}/messages/1 Big Room/1 Big Room`
export const otherDir = (service: string) => `${service}/messages/2 Other Room/2 Other Room`
export const ROOM_DIR = roomDir(SERVICE)
export const OTHER_DIR = otherDir(SERVICE)
export const COUNT = 5000
const START = Date.UTC(2022, 0, 1, 3, 0, 0)
const END = Date.UTC(2026, 10, 3, 3, 0, 0)
// Pictures are sparse so the media gallery has exactly three items.
export const PICTURE_IDS = new Set([100, 2000, 4990])

export interface FixtureLetter { id: number; created_at: string; text: string; width: number; height: number }

/** Sent letters of the big room (23:00 JST, after that day's messages). Letter 100 shares its id with message 100, a picture. */
export const LETTERS: FixtureLetter[] = [
  { id: 9001, created_at: '2022-02-10T14:00:00Z', text: 'Letter 9001 🌸', width: 341, height: 512 },
  { id: 100, created_at: '2023-06-01T14:00:00Z', text: 'Letter 100', width: 341, height: 512 },
  { id: 9002, created_at: '2025-05-05T14:00:00Z', text: 'Letter 9002', width: 341, height: 512 },
  { id: 9003, created_at: '2026-11-02T14:00:00Z', text: 'Letter 9003', width: 341, height: 512 },
]

export interface FixtureMessage {
  id: number
  member_id: string
  timestamp: string
  type: 'text' | 'picture'
  content: string | null
  is_favorite: boolean
  media_file: string | null
  width: number | null
  height: number | null
}

export function buildBigRoom(count = COUNT): FixtureMessage[] {
  const step = (END - START) / (COUNT - 1)
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1
    const picture = PICTURE_IDS.has(id)
    return {
      id,
      member_id: '1',
      timestamp: new Date(START + Math.round(i * step)).toISOString(),
      type: picture ? 'picture' : 'text',
      // Vary the height: every 7th message is long, so estimated heights are wrong.
      content: picture ? null : id % 7 === 0 ? `Message ${id}\n${'long line '.repeat(40)}` : `Message ${id}`,
      is_favorite: false,
      media_file: picture ? `messages/1 Big Room/1 Big Room/picture/${id}.png` : null,
      width: picture ? 800 : null,
      height: picture ? 600 : null,
    }
  })
}

/** Local (Asia/Tokyo) YYYY-MM-DD of an ISO timestamp, matching toLocalDateStr in the app. */
export function tokyoDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ })
}

export function firstIdOnDate(messages: FixtureMessage[], date: string): number {
  const m = messages.find((x) => tokyoDate(x.timestamp) === date)
  if (!m) throw new Error(`fixture has no message on ${date}`)
  return m.id
}

const member = (id: string, name: string, path: string) => ({
  id, name, dir_name: path.split('/').pop(), path,
  thumbnail: null, portrait: null, phone_image: null, group_thumbnail: null,
})

const room = (id: string, name: string, path: string, total: number) => ({
  id, name, service: path.split('/')[0], dir_name: path.split('/').pop(),
  group_path: path.split('/').slice(0, 3).join('/'),
  member_count: 1, is_group_chat: false, is_active: true, is_graduated: false,
  server_unread_count: 0, thumbnail: null, thumbnail_local: null,
  last_message_id: total, total_messages: total,
  members: [member(id, name, path)],
})

// 1×1 transparent PNG for every media request.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

export interface PinOptions {
  /** Messages served for the big room; a mutable holder so a test can append. */
  messages: { current: FixtureMessage[] }
  /** Read state of the big room (default: everything read). */
  lastReadId?: number
  /** Service the two rooms belong to (default hinatazaka46). */
  service?: string
  /** Letters of the big room (default LETTERS); the other room has none. */
  letters?: FixtureLetter[]
  /** Feature open at start (default messages). */
  feature?: 'messages' | 'blogs'
}

export async function pinBigRoom(page: Page, opts: PinOptions): Promise<void> {
  const service = opts.service ?? SERVICE
  const bigDir = roomDir(service)
  const smallDir = otherDir(service)
  const lastReadId = opts.lastReadId ?? COUNT + 1000
  const other = [{ ...buildBigRoom(1)[0], id: 1, content: 'Other room message' }]

  await page.route('**/api/app-state/prefs', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204 })
    return route.fulfill({
      json: {
        tos_accepted_at: '2026-01-01T00:00:00Z',
        language: 'en',
        'sakadesk-app-state': JSON.stringify({
          state: {
            selectedServices: [service],
            activeService: service,
            activeFeatures: { [service]: opts.feature ?? 'messages' },
          },
          version: 4,
        }),
      },
    })
  })
  await page.route('**/api/sync/progress*', (route) => route.fulfill({ json: { state: 'idle' } }))
  await page.route('**/api/sync/start*', (route) => route.fulfill({ json: { status: 'started' } }))
  await page.route('**/api/content/groups*', (route) =>
    route.fulfill({
      json: {
        groups: [
          room('1', 'Big Room', bigDir, opts.messages.current.length),
          room('2', 'Other Room', smallDir, 1),
        ],
        last_sync: {},
      },
    }),
  )
  await page.route('**/api/app-state/conversation-all', (route) =>
    route.fulfill({
      json: {
        [`read_state_${bigDir}`]: { value: JSON.stringify({ lastReadId, revealedIds: [] }) },
        [`read_state_${smallDir}`]: { value: JSON.stringify({ lastReadId: 99, revealedIds: [] }) },
      },
    }),
  )
  // Scroll-position and read-state saves: answered here so tests never write to the backend store.
  await page.route((url) => url.pathname === '/api/app-state/conversation', (route) => route.fulfill({ status: 204 }))
  await page.route('**/api/content/unread_counts*', (route) =>
    route.fulfill({ json: { [bigDir]: Math.max(0, opts.messages.current.length - lastReadId), [smallDir]: 0 } }),
  )
  await page.route('**/api/content/messages_by_path*', (route) => {
    const url = new URL(route.request().url())
    const isOther = (url.searchParams.get('path') ?? '').includes('Other Room')
    const msgs = isOther ? other : opts.messages.current
    return route.fulfill({
      json: {
        member: member(isOther ? '2' : '1', isOther ? 'Other Room' : 'Big Room', isOther ? smallDir : bigDir),
        messages: msgs,
        total_count: msgs.length,
        unread_count: 0,
        max_message_id: msgs[msgs.length - 1].id,
      },
    })
  })
  await page.route('**/api/chat/message_dates/**', (route) => {
    const counts = new Map<string, number>()
    for (const m of opts.messages.current) counts.set(tokyoDate(m.timestamp), (counts.get(tokyoDate(m.timestamp)) ?? 0) + 1)
    return route.fulfill({ json: { dates: [...counts].map(([date, count]) => ({ date, count })) } })
  })
  await page.route('**/api/chat/streak/**', (route) => route.fulfill({ json: { days: 128, is_active: true } }))
  await page.route('**/api/chat/letters_local*', (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    const letters = path.includes('Big Room') ? (opts.letters ?? LETTERS) : []
    return route.fulfill({
      json: {
        letters: letters.map((l) => ({ ...l, image_url: `/api/content/media/${service}/messages/1 Big Room/1 Big Room/letters/${l.id}.jpg` })),
      },
    })
  })
  await page.route('**/api/account/profile*', (route) =>
    route.fulfill({
      json: {
        name: 'Fixture Fan',
        avatars: [{ url: `/api/content/media/${service}/account/profile_images/thumbnail/me.jpg`, first_seen: '2022-01-01T00:00:00Z' }],
      },
    }),
  )
  await page.route('**/api/content/media/**', (route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  )
  await page.route('**/api/client-log', (route) => route.fulfill({ status: 204 }))
}

/**
 * Id of the first message row the user can see: its box reaches below the top of the chat
 * viewport, or below the sticky date header when the list has one (rows behind it are hidden).
 */
export async function topVisibleMessageId(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')
    if (!scroller) return null
    const header = scroller.querySelector<HTMLElement>('[data-testid="virtuoso-top-item-list"]')
    const top = Math.max(scroller.getBoundingClientRect().top, header ? header.getBoundingClientRect().bottom : -Infinity)
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[id^="msg-"]'))
      .map((el) => ({ id: Number(el.id.slice(4)), rect: el.getBoundingClientRect() }))
      .filter((r) => r.rect.bottom > top + 1)
      .sort((a, b) => a.rect.top - b.rect.top)
    return rows.length ? rows[0].id : null
  })
}

/** Whether a row (a message id, or a row key such as 'letter-100') lies inside the chat viewport. */
export async function isRowInViewport(page: Page, row: number | string): Promise<boolean> {
  const key = typeof row === 'number' ? `msg-${row}` : row
  return page.evaluate((target) => {
    const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')
    const el = document.getElementById(target)
    if (!scroller || !el) return false
    const s = scroller.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return r.bottom > s.top && r.top < s.bottom
  }, key)
}
