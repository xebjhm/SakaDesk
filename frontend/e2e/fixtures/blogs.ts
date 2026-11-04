import type { Page, Route } from '@playwright/test'
import { buildBigRoom, pinBigRoom } from './bigRoom'

// Pinned blog data for the D2b locks and screenshots: two fictional members with CJK names,
// 42 + 6 posts with CJK + emoji titles and SVG pictures. Everything is answered at the network
// layer on top of pinBigRoom, which opens the app on the blog feature.

export const MEMBER_A = { id: '9901', name: '春野 ひなた' }
export const MEMBER_B = { id: '9902', name: '秋山 さくら' }
const DAY = 24 * 60 * 60 * 1000
/** Newest post: 2026-11-03 18:00 JST. */
const NEWEST = Date.UTC(2026, 10, 3, 9, 0, 0)

export interface FixturePost {
  id: string
  title: string
  published_at: string
  url: string
  thumbnail: string
  cached: boolean
}

/** A member's posts, newest first (index 0), as /api/blogs/list returns them. */
export function memberPosts(service: string, member: 'A' | 'B'): FixturePost[] {
  const spec =
    member === 'A'
      ? { count: 42, firstDay: 0, stepDays: 9, prefix: '1', label: '春の日記', emoji: '🌸' }
      : { count: 6, firstDay: 2, stepDays: 20, prefix: '2', label: '秋の便り', emoji: '🍁' }
  return Array.from({ length: spec.count }, (_, i) => {
    const n = String(spec.count - i).padStart(2, '0')
    const id = `${spec.prefix}${n}`
    return {
      id,
      title: `${spec.label} ${n} ${spec.emoji}`,
      published_at: new Date(NEWEST - (spec.firstDay + i * spec.stepDays) * DAY).toISOString(),
      url: `https://example.com/blog/${id}`,
      thumbnail: `/api/content/media/${service}/blogs/thumb-${id}.svg`,
      cached: true,
    }
  })
}

function contentHtml(service: string, post: FixturePost): string {
  const line = '春の風が吹いて、桜の花びらがゆっくりと舞っていました。'
  return [
    `<p>${post.title}の日です☀️<br>${line.repeat(3)}<br><br>`,
    'An English line to check how mixed text wraps at the reading width of the post.<br>',
    `<img src="/api/content/media/${service}/blogs/photo-${post.id}.svg"><br><br>`,
    '最後まで読んでくれてありがとう💐 <a href="https://example.com/more">もっと見る</a></p>',
  ].join('')
}

const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="#cbd5e1"/><circle cx="${w / 2}" cy="${h * 0.4}" r="${w / 5}" fill="#94a3b8"/></svg>`

export interface PinBlogOptions {
  /** Service whose blogs are shown (default hinatazaka46). */
  service?: string
  /** What /api/blogs/recent answers (default ok). */
  recent?: 'ok' | 'empty' | 'error'
}

export async function pinBlogs(page: Page, opts: PinBlogOptions = {}): Promise<void> {
  const service = opts.service ?? 'hinatazaka46'
  await pinBigRoom(page, { messages: { current: buildBigRoom(10) }, service, feature: 'blogs' })

  const posts = { A: memberPosts(service, 'A'), B: memberPosts(service, 'B') }
  const all = [...posts.A, ...posts.B]
  const memberOf = (id: string) => (posts.A.some((p) => p.id === id) ? MEMBER_A : MEMBER_B)
  const recent = [...posts.A.slice(0, 3), ...posts.B]
    .sort((a, b) => b.published_at.localeCompare(a.published_at))
    .map((p) => ({
      id: p.id,
      title: p.title,
      published_at: p.published_at,
      url: p.url,
      thumbnail: p.thumbnail,
      member_id: memberOf(p.id).id,
      member_name: memberOf(p.id).name,
    }))

  // Routes registered later win, so these override pinBigRoom's catch-all media route.
  await page.route('**/api/blogs/recent*', (route) => {
    if (opts.recent === 'error') return route.fulfill({ status: 500, json: { detail: 'pinned failure' } })
    return route.fulfill({ json: { service, posts: opts.recent === 'empty' ? [] : recent } })
  })
  await page.route('**/api/blogs/sync*', (route) =>
    route.fulfill({
      json: { status: 'ok', service, total_members: 2, total_blogs: all.length, last_sync: '2026-11-04T03:00:00Z' },
    }),
  )
  await page.route('**/api/blogs/members-with-thumbnails*', (route) =>
    route.fulfill({
      json: { service, members: [{ ...MEMBER_A, thumbnail: 'a.jpg' }, { ...MEMBER_B, thumbnail: null }] },
    }),
  )
  await page.route('**/api/blogs/list*', (route) => {
    const memberId = new URL(route.request().url()).searchParams.get('member_id')
    const member = memberId === MEMBER_B.id ? MEMBER_B : MEMBER_A
    return route.fulfill({
      json: { member_id: member.id, member_name: member.name, blogs: member === MEMBER_A ? posts.A : posts.B },
    })
  })
  await page.route('**/api/blogs/content*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('blog_id')
    const post = all.find((p) => p.id === id)
    if (!post) return route.fulfill({ status: 404, json: { detail: 'not found' } })
    return route.fulfill({
      json: {
        meta: { id: post.id, member_name: memberOf(post.id).name, title: post.title, published_at: post.published_at, url: post.url },
        content: { html: contentHtml(service, post) },
        images: [],
      },
    })
  })
  const image = (w: number, h: number) => (route: Route) =>
    route.fulfill({ body: svg(w, h), contentType: 'image/svg+xml' })
  await page.route('**/api/content/media/*/blogs/thumb-*', image(300, 400))
  await page.route('**/api/content/media/*/blogs/photo-*', image(600, 400))
  await page.route('**/api/blogs/member-thumbnail/**', image(200, 200))
  // The Hinatazaka mascot in the member dialog is a CDN picture.
  await page.route('https://cdn.hinatazaka46.com/**', image(200, 200))
}
