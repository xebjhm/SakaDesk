import type { Page } from '@playwright/test'

// A deterministic 5,000-message room spanning 2022-01 … 2026-11, used to test
// virtual scrolling and jumps in a real browser (jsdom cannot measure layout).
// Timestamps are spread evenly, so every local (Asia/Tokyo) day has 2–3 messages.

export const TZ = 'Asia/Tokyo'
export const SERVICE = 'hinatazaka46'
export const ROOM_DIR = `${SERVICE}/messages/1 Big Room/1 Big Room`
export const OTHER_DIR = `${SERVICE}/messages/2 Other Room/2 Other Room`
export const COUNT = 5000
const START = Date.UTC(2022, 0, 1, 3, 0, 0)
const END = Date.UTC(2026, 10, 3, 3, 0, 0)
// Pictures are sparse so the media gallery has exactly three items.
export const PICTURE_IDS = new Set([100, 2000, 4990])

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
  id, name, service: SERVICE, dir_name: path.split('/').pop(),
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
}

export async function pinBigRoom(page: Page, opts: PinOptions): Promise<void> {
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
            selectedServices: [SERVICE],
            activeService: SERVICE,
            activeFeatures: { [SERVICE]: 'messages' },
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
          room('1', 'Big Room', ROOM_DIR, opts.messages.current.length),
          room('2', 'Other Room', OTHER_DIR, 1),
        ],
        last_sync: {},
      },
    }),
  )
  await page.route('**/api/app-state/conversation-all', (route) =>
    route.fulfill({
      json: {
        [`read_state_${ROOM_DIR}`]: { value: JSON.stringify({ lastReadId, revealedIds: [] }) },
        [`read_state_${OTHER_DIR}`]: { value: JSON.stringify({ lastReadId: 99, revealedIds: [] }) },
      },
    }),
  )
  await page.route('**/api/content/unread_counts*', (route) =>
    route.fulfill({ json: { [ROOM_DIR]: Math.max(0, opts.messages.current.length - lastReadId), [OTHER_DIR]: 0 } }),
  )
  await page.route('**/api/content/messages_by_path*', (route) => {
    const url = new URL(route.request().url())
    const isOther = (url.searchParams.get('path') ?? '').includes('Other Room')
    const msgs = isOther ? other : opts.messages.current
    return route.fulfill({
      json: {
        member: member(isOther ? '2' : '1', isOther ? 'Other Room' : 'Big Room', isOther ? OTHER_DIR : ROOM_DIR),
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
  await page.route('**/api/content/media/**', (route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  )
  await page.route('**/api/client-log', (route) => route.fulfill({ status: 204 }))
}

/** Id of the first message row whose box reaches into the chat viewport, or null. */
export async function topVisibleMessageId(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')
    if (!scroller) return null
    const top = scroller.getBoundingClientRect().top
    const rows = Array.from(scroller.querySelectorAll<HTMLElement>('[id^="msg-"]'))
      .map((el) => ({ id: Number(el.id.slice(4)), rect: el.getBoundingClientRect() }))
      .filter((r) => r.rect.bottom > top + 1)
      .sort((a, b) => a.rect.top - b.rect.top)
    return rows.length ? rows[0].id : null
  })
}

/** Whether the row for `id` lies inside the chat viewport. */
export async function isRowInViewport(page: Page, id: number): Promise<boolean> {
  return page.evaluate((target) => {
    const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')
    const row = document.getElementById(`msg-${target}`)
    if (!scroller || !row) return false
    const s = scroller.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return r.bottom > s.top && r.top < s.bottom
  }, id)
}
