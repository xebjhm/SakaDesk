# D2a-0 Timeline Jump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chat-timeline jump (calendar date, message target, first unread, Home/End) instant and reliable, verified in a real browser, so that jumping from 2026 to a 2022 day takes well under a second.

**Architecture:** A pure resolver (`resolveJump`) maps a jump target to `{index, align}` on the messages array. A hook (`useTimelineJump`) does an instant `scrollToIndex`, waits until the target row is rendered, measures it, and corrects up to 2 times. It then highlights the row and logs a breadcrumb. Every existing jump entry point is rewired to it. A Playwright spec with a 5,000-message fixture room locks the scroll behaviour in a real browser.

**Tech Stack:** React 18 + TypeScript, react-virtuoso 4.18, vitest + @testing-library/react, Playwright 1.57, FastAPI + pydantic + structlog (backend log whitelist), pytest.

Spec: `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md`, section "D2a-0".

## Global Constraints

- Branch `fix/timeline-jump` (already created from `dev`, spec committed as `7f50e89`). The PR targets `dev`.
- Commit with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Use Conventional Commits, whole line ≤ 72 chars, imperative, no trailing period. End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Frontend commands run in `SakaDesk/frontend/` (`npx vitest run …`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx playwright test …`). Backend commands run in `SakaDesk/` with `uv run pytest …`.
- UI: design-system tokens only (`docs/design/DESIGN_SYSTEM.md`). No hex, `rgb()`, arbitrary radius/shadow/text/spacing, or named palette classes in new code. The highlight uses `bg-group-subtle`, `rounded-card`, `duration-base` and `ease-standard`.
- No `console.log`. Breadcrumbs go through `clientLog` (`frontend/src/utils/clientLog.ts`). Its fields are whitelisted in the backend and must never carry names, text, URLs or paths.
- Never use `behavior: 'smooth'` for a timeline jump.
- `followOutput` stays exactly as it is (`isAtBottom ? 'smooth' : false`).
- The zero-pixel e2e (`e2e/visual-zero-pixel.spec.ts`) must still pass: this PR adds no visible change except the transient highlight.
- e2e runs against the backend serving `frontend/dist`, so run `npm run build` in `frontend/` before `npx playwright test`. The backend is started by `playwright.config.ts` (`webServer`, `SAKADESK_TEST_MODE=true`).

## File Structure

| File | Responsibility |
|---|---|
| Create `frontend/e2e/fixtures/bigRoom.ts` | Deterministic 5,000-message fixture room plus `page.route` mocks |
| Create `frontend/e2e/timeline-scroll.spec.ts` | Real-browser scroll/jump behaviour tests |
| Modify `backend/api/client_log.py` | Whitelist the `timeline_jump` event and its fields |
| Modify `backend/tests/test_client_log_api.py` | Tests for the new event |
| Modify `frontend/src/utils/clientLog.ts` | Add the `timeline_jump` event and its field keys to the types |
| Create `frontend/src/features/messages/timeline/jumpTarget.ts` | Pure `JumpTarget` types + `resolveJump` |
| Create `frontend/src/features/messages/timeline/jumpTarget.test.ts` | Resolver tests |
| Create `frontend/src/features/messages/timeline/landing.ts` | Pure `landingError` + DOM `measureLanding` |
| Create `frontend/src/features/messages/timeline/landing.test.ts` | Landing math tests |
| Create `frontend/src/features/messages/hooks/useTimelineJump.ts` | Jump → settle → correct → highlight → log |
| Create `frontend/src/features/messages/hooks/useTimelineJump.test.ts` | Hook tests with injected frame/measure |
| Modify `frontend/src/features/messages/hooks/useTimelineKeyNav.ts` (+ test) | Home/End go through `jumpTo` |
| Modify `frontend/src/features/messages/components/MessageList.tsx` | Target-message effect calls `onJumpToMessage`; row highlight |
| Modify `frontend/src/features/messages/MessagesFeature.tsx` | Own the hook; rewire calendar, unread, call and keys; highlight state |
| Modify `CHANGELOG.md` | User-facing entry under `[Unreleased]` |
| Modify `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md` | Zero-drift: the final hook interface and outcomes |

Media rows already reserve their box from `width`/`height` (`MediaContainer` in `MessageBubble.tsx`), so that part of the spec needs no work.

---

### Task 1: Real-browser scroll tests (lock current behaviour, expose the slow date jump)

**Files:**
- Create: `frontend/e2e/fixtures/bigRoom.ts`
- Create: `frontend/e2e/timeline-scroll.spec.ts`

**Interfaces:**
- Produces: `buildBigRoom()`, `pinBigRoom(page, opts)`, `BIG_ROOM` constants, and the helper `topVisibleMessageId(page)`, used by this spec now and by the D2a plan later.

- [ ] **Step 1: Write the fixture**

`frontend/e2e/fixtures/bigRoom.ts`:

```ts
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
```

- [ ] **Step 2: Write the spec**

`frontend/e2e/timeline-scroll.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import {
  buildBigRoom, firstIdOnDate, isRowInViewport, pinBigRoom, topVisibleMessageId,
  COUNT, TZ, type FixtureMessage,
} from './fixtures/bigRoom'

// Locks the chat timeline's scroll behaviour in a real browser. D2a (GroupedVirtuoso,
// letters) must keep every test here green.

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

async function openBigRoom(page: Page) {
  await page.goto('/')
  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
}

async function openCalendarAt(page: Page, monthLabel: string) {
  await page.getByTitle('More options').click()
  await page.getByText('Date Search', { exact: true }).click()
  const dialog = page.getByRole('dialog')
  const prev = dialog.locator('button:has(svg.lucide-chevron-left)')
  for (let i = 0; i < 80; i++) {
    if (await dialog.getByText(monthLabel, { exact: true }).isVisible()) return dialog
    await prev.click()
  }
  throw new Error(`calendar never reached ${monthLabel}`)
}

test.describe('timeline scroll', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
    await pinBigRoom(page, { messages })
  })

  test('opens at the bottom of a new room', async ({ page }) => {
    await openBigRoom(page)
    expect(await isRowInViewport(page, COUNT)).toBe(true)
  })

  test('calendar jump to a 2022 day lands on that day in under a second', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'January 2022')
    const expected = firstIdOnDate(messages.current, '2022-01-15')
    const t0 = Date.now()
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 1000, intervals: [50] }).toBe(expected)
    expect(Date.now() - t0).toBeLessThan(1000)
    await expect(page.locator(`#msg-${expected}`)).toHaveClass(/bg-group-subtle/)
  })

  test('media gallery "jump to message" lands on a 2022 message', async ({ page }) => {
    await openBigRoom(page)
    await page.getByTitle('More options').click()
    await page.getByText('Media', { exact: true }).click()
    // Newest first: the last thumbnail is message 100 (2022).
    await page.getByRole('dialog').locator('button:has(img)').last().click()
    await page.getByTitle('Jump to message').click()
    await expect.poll(() => isRowInViewport(page, 100), { timeout: 1000, intervals: [50] }).toBe(true)
    await expect(page.locator('#msg-100')).toHaveClass(/bg-group-subtle/)
  })

  test('re-opening the room restores the last top message', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'March 2024')
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    const expected = firstIdOnDate(messages.current, '2024-03-15')
    await expect.poll(() => topVisibleMessageId(page), { timeout: 2000 }).toBe(expected)
    await page.waitForTimeout(800) // useChatScroll debounces saves by 500 ms
    await page.getByText('Other Room', { exact: true }).click()
    await expect(page.getByText('Other room message')).toBeVisible()
    await page.getByText('Big Room', { exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 3000 }).toBe(expected)
  })

  test('at the bottom, a newly synced message is followed', async ({ page }) => {
    await openBigRoom(page)
    const next = { ...messages.current[COUNT - 1], id: COUNT + 1, content: 'Freshly synced' }
    messages.current = [...messages.current, next]
    await page.getByTitle('Sync now').click()
    await expect.poll(() => isRowInViewport(page, COUNT + 1), { timeout: 5000 }).toBe(true)
  })

  test('first-unread arrow centres the first unread message', async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await pinBigRoom(page, { messages, lastReadId: 2500 })
    await openBigRoom(page)
    await page.getByTitle('Jump to oldest unread').click()
    await expect.poll(() => isRowInViewport(page, 2501), { timeout: 1000, intervals: [50] }).toBe(true)
  })
})
```

Note on `openBigRoom` with `lastReadId: 2500`: unread rows render behind a shelter (content at opacity 0), but the `#msg-<id>` rows still exist and still have a box. Playwright counts them as visible, and the assertions check the row box, not the text. A room with no saved position opens at the bottom (`useChatScroll` falls back to the last index), so the first unread (2501) is above the viewport and the "Jump to oldest unread" arrow is shown.

- [ ] **Step 3: Build and run, expecting the date-jump and highlight tests to fail**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend && npm run build && npx playwright test e2e/timeline-scroll.spec.ts --reporter=line
```

Expected on the unchanged code:
- PASS: `opens at the bottom`, `re-opening … restores`, `newly synced message is followed`, `first-unread arrow`.
- FAIL: `calendar jump … under a second` (smooth scroll: times out or exceeds 1 s; at the latest, the class assertion fails), and `media gallery … jump` fails on the `bg-group-subtle` assertion only.

If a "PASS" test fails here, the fixture or a selector is wrong, not the app. Fix the selector or the mock (look at the real DOM with `npx playwright test --debug` or the trace), never the assertion. `openCalendarAt` relies on the lucide class `lucide-chevron-left` on the calendar's previous-month icon. If the "Sync now" click does not trigger a refetch, check `startSync` in `shell/hooks/useSync.ts`: it polls `/api/sync/progress` and bumps `syncVersion` on `idle`. Record each actual result in the commit body.

- [ ] **Step 4: Confirm the zero-pixel spec is unaffected**

```bash
npx playwright test e2e/visual-zero-pixel.spec.ts --reporter=line
```

Expected: `3 passed`. If no local baselines exist (they are gitignored), capture them first on the unchanged code with `--update-snapshots`, then rerun without it.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/e2e/fixtures/bigRoom.ts frontend/e2e/timeline-scroll.spec.ts
uv run git commit -m "test(e2e): lock timeline scroll behaviour in a real browser" -m "The calendar-jump and highlight checks fail until jumps are instant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Whitelist the `timeline_jump` breadcrumb

**Files:**
- Modify: `backend/api/client_log.py`
- Modify: `backend/tests/test_client_log_api.py`
- Modify: `frontend/src/utils/clientLog.ts`

**Interfaces:**
- Produces: the event `'timeline_jump'` with field keys `target` (string code), `index` (int), `corrections` (int), `outcome` (string code) and `jump_ms` (int), accepted by `POST /api/client-log` and typed in `ClientLogEvent` / `ClientLogFieldKey`.

- [ ] **Step 1: Write the failing backend test**

Append to `backend/tests/test_client_log_api.py`:

```python
def test_timeline_jump_is_accepted_with_its_fields():
    with capture_logs() as logs:
        res = client.post(
            "/api/client-log",
            json={
                "event": "timeline_jump",
                "fields": {
                    "target": "first_unread",
                    "index": 2500,
                    "corrections": 1,
                    "outcome": "landed",
                    "jump_ms": 140,
                },
            },
        )
    assert res.status_code == 204
    events = _client_events(logs)
    assert len(events) == 1
    assert events[0]["event"] == "timeline_jump"
    assert events[0]["log_level"] == "info"
    assert events[0]["outcome"] == "landed"
    assert events[0]["corrections"] == 1


def test_timeline_jump_rejects_text_in_its_fields():
    res = client.post(
        "/api/client-log",
        json={"event": "timeline_jump", "fields": {"target": "高井 俐香"}},
    )
    assert res.status_code == 422
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk && uv run pytest backend/tests/test_client_log_api.py -k timeline_jump -v
```

Expected: the first test fails with 422 (unknown event). The second passes already (the literal rejects the event); that is fine.

- [ ] **Step 3: Implement**

In `backend/api/client_log.py`, add `"timeline_jump",` as the last entry of `ClientEvent` (after `"avatar_fallback",`). Add these to `ALLOWED_FIELDS` after `"size",`:

```python
        "target",
        "index",
        "corrections",
        "outcome",
        "jump_ms",
```

In `frontend/src/utils/clientLog.ts`:

```ts
export type ClientLogEvent =
    | 'call_ring' | 'call_skip' | 'call_answer' | 'call_decline'
    | 'call_timeout' | 'call_end' | 'call_cancel' | 'call_error'
    | 'notify_open_chat' | 'backend_sync_followed' | 'backend_sync_skipped'
    | 'call_popup_start' | 'call_popup_error'
    | 'call_popup_heard_applied' | 'call_popup_heard_ignored'
    | 'app_load_failed'
    | 'design_tokens_applied' | 'design_tokens_fallback' | 'avatar_fallback'
    | 'timeline_jump';

export type ClientLogFieldKey =
    | 'service' | 'group_id' | 'member_id' | 'message_id' | 'reason'
    | 'phase' | 'ring_ms' | 'talk_ms' | 'error_type'
    | 'surface' | 'call_id' | 'changed' | 'has_target'
    | 'theme' | 'size'
    | 'target' | 'index' | 'corrections' | 'outcome' | 'jump_ms';
```

- [ ] **Step 4: Run, expect pass**

```bash
uv run pytest backend/tests/test_client_log_api.py -v
cd frontend && npx tsc --noEmit
```

Expected: all pass; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add backend/api/client_log.py backend/tests/test_client_log_api.py frontend/src/utils/clientLog.ts
uv run git commit -m "feat(log): accept timeline jump breadcrumbs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pure jump resolver and landing math

**Files:**
- Create: `frontend/src/features/messages/timeline/jumpTarget.ts`
- Create: `frontend/src/features/messages/timeline/jumpTarget.test.ts`
- Create: `frontend/src/features/messages/timeline/landing.ts`
- Create: `frontend/src/features/messages/timeline/landing.test.ts`

**Interfaces:**
- Produces:
  - `type JumpAlign = 'start' | 'center' | 'end'`
  - `type JumpTarget = { kind: 'message'; id: number; align?: 'start' | 'center' } | { kind: 'date'; date: string } | { kind: 'firstUnread' } | { kind: 'top' } | { kind: 'bottom' }`
  - `interface ResolvedJump { index: number; messageId: number; align: JumpAlign; highlight: boolean; verify: boolean }`
  - `resolveJump(messages: readonly Pick<Message,'id'|'timestamp'>[], target: JumpTarget, isUnread: (id: number) => boolean): ResolvedJump | null`
  - `jumpTargetCode(target: JumpTarget): 'message' | 'date' | 'first_unread' | 'top' | 'bottom'`
  - `LANDING_TOLERANCE_PX = 8`
  - `landingError(row: Box, view: Box, scroll: { atTop: boolean; atBottom: boolean }, align: JumpAlign): number`, where `interface Box { top: number; bottom: number }`
  - `measureLanding(messageId: number, align: JumpAlign): number | null` (DOM; null = row not rendered)

- [ ] **Step 1: Write the failing resolver tests**

`frontend/src/features/messages/timeline/jumpTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveJump, jumpTargetCode } from './jumpTarget';
import { toLocalDateStr } from '../../../utils/dateFormatters';

const msgs = [
    { id: 10, timestamp: '2022-01-14T10:00:00Z' },
    { id: 11, timestamp: '2022-01-15T10:00:00Z' },
    { id: 12, timestamp: '2022-01-15T11:00:00Z' },
    { id: 13, timestamp: '2026-11-03T10:00:00Z' },
];
const none = () => false;

describe('resolveJump', () => {
    it('finds a message by id, aligned start and highlighted by default', () => {
        expect(resolveJump(msgs, { kind: 'message', id: 12 }, none))
            .toEqual({ index: 2, messageId: 12, align: 'start', highlight: true, verify: true });
    });

    it('keeps an explicit centre alignment for a message', () => {
        expect(resolveJump(msgs, { kind: 'message', id: 12, align: 'center' }, none)?.align).toBe('center');
    });

    it('returns null for an unknown message id', () => {
        expect(resolveJump(msgs, { kind: 'message', id: 99 }, none)).toBeNull();
    });

    it('finds the first message of a local date', () => {
        const date = toLocalDateStr(msgs[1].timestamp);
        const r = resolveJump(msgs, { kind: 'date', date }, none);
        expect(r?.messageId).toBe(msgs.find(m => toLocalDateStr(m.timestamp) === date)!.id);
        expect(r?.align).toBe('start');
        expect(r?.highlight).toBe(true);
    });

    it('returns null for a date without messages', () => {
        expect(resolveJump(msgs, { kind: 'date', date: '2023-06-01' }, none)).toBeNull();
    });

    it('finds the first unread, centred and not highlighted', () => {
        expect(resolveJump(msgs, { kind: 'firstUnread' }, id => id >= 12))
            .toEqual({ index: 2, messageId: 12, align: 'center', highlight: false, verify: true });
    });

    it('returns null when nothing is unread', () => {
        expect(resolveJump(msgs, { kind: 'firstUnread' }, none)).toBeNull();
    });

    it('top and bottom skip verification and highlight', () => {
        expect(resolveJump(msgs, { kind: 'top' }, none))
            .toEqual({ index: 0, messageId: 10, align: 'start', highlight: false, verify: false });
        expect(resolveJump(msgs, { kind: 'bottom' }, none))
            .toEqual({ index: 3, messageId: 13, align: 'end', highlight: false, verify: false });
    });

    it('returns null for every kind on an empty list', () => {
        for (const t of [{ kind: 'top' }, { kind: 'bottom' }, { kind: 'firstUnread' }] as const) {
            expect(resolveJump([], t, () => true)).toBeNull();
        }
    });
});

describe('jumpTargetCode', () => {
    it('maps kinds to log-safe snake_case codes', () => {
        expect(jumpTargetCode({ kind: 'firstUnread' })).toBe('first_unread');
        expect(jumpTargetCode({ kind: 'message', id: 1 })).toBe('message');
        expect(jumpTargetCode({ kind: 'date', date: '2022-01-15' })).toBe('date');
    });
});
```

- [ ] **Step 2: Write the failing landing tests**

`frontend/src/features/messages/timeline/landing.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { landingError, measureLanding, LANDING_TOLERANCE_PX } from './landing';

const view = { top: 100, bottom: 700 };
const free = { atTop: false, atBottom: false };

describe('landingError', () => {
    it('start: distance of the row top from the view top', () => {
        expect(landingError({ top: 130, bottom: 180 }, view, free, 'start')).toBe(30);
        expect(landingError({ top: 100, bottom: 180 }, view, free, 'start')).toBe(0);
    });

    it('start: a row below the top is fine when the list cannot scroll further', () => {
        expect(landingError({ top: 400, bottom: 450 }, view, { atTop: false, atBottom: true }, 'start')).toBe(0);
    });

    it('center: distance of the row centre from the view centre', () => {
        expect(landingError({ top: 375, bottom: 425 }, view, free, 'center')).toBe(0);
        expect(landingError({ top: 200, bottom: 250 }, view, free, 'center')).toBe(-175);
    });

    it('center: clamped at either end of the list', () => {
        expect(landingError({ top: 200, bottom: 250 }, view, { atTop: true, atBottom: false }, 'center')).toBe(0);
        expect(landingError({ top: 600, bottom: 650 }, view, { atTop: false, atBottom: true }, 'center')).toBe(0);
    });

    it('end: distance of the row bottom from the view bottom, clamped at the top', () => {
        expect(landingError({ top: 600, bottom: 690 }, view, free, 'end')).toBe(-10);
        expect(landingError({ top: 120, bottom: 300 }, view, { atTop: true, atBottom: false }, 'end')).toBe(0);
    });

    it('exports an 8 px tolerance', () => {
        expect(LANDING_TOLERANCE_PX).toBe(8);
    });
});

describe('measureLanding', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    function mount(rowTop: number) {
        document.body.innerHTML =
            '<div data-virtuoso-scroller="true" id="s"><div id="msg-42"></div></div>';
        const s = document.getElementById('s')!;
        const r = document.getElementById('msg-42')!;
        s.getBoundingClientRect = () => ({ top: 100, bottom: 700 } as DOMRect);
        r.getBoundingClientRect = () => ({ top: rowTop, bottom: rowTop + 50 } as DOMRect);
        Object.defineProperties(s, {
            scrollTop: { value: 500, configurable: true },
            clientHeight: { value: 600, configurable: true },
            scrollHeight: { value: 5000, configurable: true },
        });
    }

    it('returns null when the row is not rendered', () => {
        expect(measureLanding(42, 'start')).toBeNull();
    });

    it('measures the rendered row against its scroller', () => {
        mount(112);
        expect(measureLanding(42, 'start')).toBe(12);
    });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend && npx vitest run src/features/messages/timeline
```

Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`frontend/src/features/messages/timeline/jumpTarget.ts`:

```ts
import type { Message } from '../../../types';
import { toLocalDateStr } from '../../../utils/dateFormatters';

/** Where the target row should sit in the viewport after a jump. */
export type JumpAlign = 'start' | 'center' | 'end';

/** Every way the chat timeline can be jumped. `date` is a local YYYY-MM-DD (toLocalDateStr). */
export type JumpTarget =
    | { kind: 'message'; id: number; align?: 'start' | 'center' }
    | { kind: 'date'; date: string }
    | { kind: 'firstUnread' }
    | { kind: 'top' }
    | { kind: 'bottom' };

export interface ResolvedJump {
    index: number;
    messageId: number;
    align: JumpAlign;
    /** Flash the landed row (message and date jumps). */
    highlight: boolean;
    /** Measure and correct after landing (skipped for top/bottom, which Virtuoso lands exactly). */
    verify: boolean;
}

type JumpMessage = Pick<Message, 'id' | 'timestamp'>;

const at = (messages: readonly JumpMessage[], index: number, align: JumpAlign, highlight: boolean, verify: boolean): ResolvedJump | null =>
    index < 0 || index >= messages.length ? null : { index, messageId: messages[index].id, align, highlight, verify };

/** Resolve a jump target to a row of `messages`, or null when there is nothing to jump to. */
export function resolveJump(
    messages: readonly JumpMessage[],
    target: JumpTarget,
    isUnread: (id: number) => boolean,
): ResolvedJump | null {
    switch (target.kind) {
        case 'message':
            return at(messages, messages.findIndex(m => m.id === target.id), target.align ?? 'start', true, true);
        case 'date':
            return at(messages, messages.findIndex(m => toLocalDateStr(m.timestamp) === target.date), 'start', true, true);
        case 'firstUnread':
            return at(messages, messages.findIndex(m => isUnread(m.id)), 'center', false, true);
        case 'top':
            return at(messages, 0, 'start', false, false);
        case 'bottom':
            return at(messages, messages.length - 1, 'end', false, false);
    }
}

/** Log-safe code for a target kind (the client-log whitelist only takes [a-z0-9_]). */
export function jumpTargetCode(target: JumpTarget): 'message' | 'date' | 'first_unread' | 'top' | 'bottom' {
    return target.kind === 'firstUnread' ? 'first_unread' : target.kind;
}
```

`frontend/src/features/messages/timeline/landing.ts`:

```ts
import type { JumpAlign } from './jumpTarget';

/** A landed row may sit this far from its aligned position and still count as landed. */
export const LANDING_TOLERANCE_PX = 8;

export interface Box { top: number; bottom: number }

/**
 * Signed distance (px) between where the row is and where `align` wants it.
 * When the list cannot scroll further in the needed direction, the row is as
 * close as it can get, so the error is 0.
 */
export function landingError(row: Box, view: Box, scroll: { atTop: boolean; atBottom: boolean }, align: JumpAlign): number {
    let d: number;
    if (align === 'start') d = row.top - view.top;
    else if (align === 'end') d = row.bottom - view.bottom;
    else d = (row.top + row.bottom) / 2 - (view.top + view.bottom) / 2;
    if (d > 0 && scroll.atBottom) return 0;
    if (d < 0 && scroll.atTop) return 0;
    return d;
}

/** Measure the rendered row `msg-<id>` against its Virtuoso scroller; null when not rendered. */
export function measureLanding(messageId: number, align: JumpAlign): number | null {
    const row = document.getElementById(`msg-${messageId}`);
    const scroller = row?.closest<HTMLElement>('[data-virtuoso-scroller]');
    if (!row || !scroller) return null;
    const atTop = scroller.scrollTop <= 0;
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    return landingError(row.getBoundingClientRect(), scroller.getBoundingClientRect(), { atTop, atBottom }, align);
}
```

- [ ] **Step 5: Run, expect pass**

```bash
npx vitest run src/features/messages/timeline
```

Expected: PASS (all tests). `resolveJump` uses `toLocalDateStr` in both the code and the test, so the test is timezone-independent.

- [ ] **Step 6: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/features/messages/timeline
uv run git commit -m "feat(chat): resolve timeline jump targets and landing error" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `useTimelineJump` hook

**Files:**
- Create: `frontend/src/features/messages/hooks/useTimelineJump.ts`
- Create: `frontend/src/features/messages/hooks/useTimelineJump.test.ts`

**Interfaces:**
- Consumes: `resolveJump`, `jumpTargetCode`, `JumpTarget` (Task 3), `measureLanding`, `LANDING_TOLERANCE_PX` (Task 3), `clientLog('timeline_jump', …)` (Task 2).
- Produces:
  - `type JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled'`
  - `MAX_CORRECTIONS = 2`, `MAX_WAIT_FRAMES = 60`, `SETTLE_FRAMES = 2`
  - `useTimelineJump(args: UseTimelineJumpArgs): (target: JumpTarget) => Promise<JumpOutcome>`
  - `interface UseTimelineJumpArgs { virtuosoRef: React.RefObject<VirtuosoHandle | null>; messages: readonly Message[]; isUnread: (id: number) => boolean; onLanded?: (messageId: number) => void; deps?: Partial<JumpDeps> }`
  - `interface JumpDeps { nextFrame: () => Promise<void>; measure: (messageId: number, align: JumpAlign) => number | null; now: () => number }`

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/messages/hooks/useTimelineJump.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { useTimelineJump, MAX_CORRECTIONS } from './useTimelineJump';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const msg = (id: number, ts: string): Message =>
    ({ id, timestamp: ts, type: 'text', is_favorite: false, content: `m${id}` });
const messages = [msg(1, '2022-01-15T01:00:00Z'), msg(2, '2024-03-15T01:00:00Z'), msg(3, '2026-11-03T01:00:00Z')];

function setup(measures: Array<number | null>, opts: { unread?: (id: number) => boolean } = {}) {
    const scrollToIndex = vi.fn();
    const ref = { current: { scrollToIndex } as unknown as VirtuosoHandle };
    const onLanded = vi.fn();
    const queue = [...measures];
    const measure = vi.fn(() => (queue.length > 1 ? queue.shift()! : queue[0]));
    const { result } = renderHook(() => useTimelineJump({
        virtuosoRef: ref,
        messages,
        isUnread: opts.unread ?? (() => false),
        onLanded,
        deps: { nextFrame: () => Promise.resolve(), measure, now: () => 0 },
    }));
    return { jumpTo: result.current, scrollToIndex, onLanded, measure };
}

beforeEach(() => vi.mocked(clientLog).mockClear());

describe('useTimelineJump', () => {
    it('jumps instantly, verifies, highlights and logs a landing', async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([3]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledTimes(1);
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start', behavior: 'auto' });
        expect(onLanded).toHaveBeenCalledWith(2);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump',
            { target: 'message', index: 1, corrections: 0, outcome: 'landed', jump_ms: 0 });
    });

    it('waits for the row to render before measuring', async () => {
        const { jumpTo, measure } = setup([null, null, 0]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(measure.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('corrects an off landing and then lands', async () => {
        // First render measures 40, the settled re-measure is still 40 → one correction → 0.
        const { jumpTo, scrollToIndex } = setup([40, 40, 0]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledTimes(2);
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ corrections: 1, outcome: 'landed' }));
    });

    it(`gives up after ${MAX_CORRECTIONS} corrections and does not highlight`, async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([40]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('gave_up');
        expect(scrollToIndex).toHaveBeenCalledTimes(1 + MAX_CORRECTIONS);
        expect(onLanded).not.toHaveBeenCalled();
    });

    it('gives up when the row never renders', async () => {
        const { jumpTo } = setup([null]);
        await expect(jumpTo({ kind: 'message', id: 2 })).resolves.toBe('gave_up');
    });

    it('reports not_found without scrolling', async () => {
        const { jumpTo, scrollToIndex } = setup([0]);
        await expect(jumpTo({ kind: 'message', id: 99 })).resolves.toBe('not_found');
        expect(scrollToIndex).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ outcome: 'not_found', index: -1 }));
    });

    it('first unread is centred and not highlighted', async () => {
        const { jumpTo, scrollToIndex, onLanded } = setup([0], { unread: id => id >= 2 });
        await expect(jumpTo({ kind: 'firstUnread' })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'center', behavior: 'auto' });
        expect(onLanded).not.toHaveBeenCalled();
    });

    it('bottom scrolls without measuring', async () => {
        const { jumpTo, scrollToIndex, measure } = setup([0]);
        await expect(jumpTo({ kind: 'bottom' })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'end', behavior: 'auto' });
        expect(measure).not.toHaveBeenCalled();
    });

    it('a newer jump cancels an older one still settling', async () => {
        const { jumpTo } = setup([null, null, null, 0]);
        const first = jumpTo({ kind: 'message', id: 1 });
        const second = jumpTo({ kind: 'message', id: 3 });
        await expect(first).resolves.toBe('cancelled');
        await expect(second).resolves.toBe('landed');
    });

    it('never uses smooth scrolling', async () => {
        const { jumpTo, scrollToIndex } = setup([40, 40, 0]);
        await jumpTo({ kind: 'date', date: '2099-01-01' });
        await jumpTo({ kind: 'message', id: 1 });
        for (const [arg] of scrollToIndex.mock.calls) expect(arg.behavior).toBe('auto');
    });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend && npx vitest run src/features/messages/hooks/useTimelineJump.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`frontend/src/features/messages/hooks/useTimelineJump.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
import { clientLog } from '../../../utils/clientLog';
import { jumpTargetCode, resolveJump, type JumpAlign, type JumpTarget } from '../timeline/jumpTarget';
import { LANDING_TOLERANCE_PX, measureLanding } from '../timeline/landing';

export type JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled';

/** Extra scrollToIndex calls after the first one when the row lands off target. */
export const MAX_CORRECTIONS = 2;
/** Frames to wait for the target row to render (~1 s at 60 fps). */
export const MAX_WAIT_FRAMES = 60;
/** Frames to let heights settle after the row renders, before measuring. */
export const SETTLE_FRAMES = 2;

export interface JumpDeps {
    nextFrame: () => Promise<void>;
    measure: (messageId: number, align: JumpAlign) => number | null;
    now: () => number;
}

const defaultDeps: JumpDeps = {
    nextFrame: () => new Promise(resolve => requestAnimationFrame(() => resolve())),
    measure: measureLanding,
    now: () => performance.now(),
};

export interface UseTimelineJumpArgs {
    virtuosoRef: React.RefObject<VirtuosoHandle | null>;
    messages: readonly Message[];
    isUnread: (id: number) => boolean;
    /** Called with the landed message id for highlighted jumps (message, date). */
    onLanded?: (messageId: number) => void;
    /** Test seam: frame scheduler, DOM measurement and clock. */
    deps?: Partial<JumpDeps>;
}

/**
 * One way to jump the chat timeline: an instant scrollToIndex, then wait for the
 * target row to render, measure it and correct up to MAX_CORRECTIONS times
 * (Virtuoso estimates heights it has not measured, so a far jump can land a little
 * off). A newer jump cancels an older one that is still settling. Every jump logs a
 * `timeline_jump` breadcrumb with no message text or names.
 */
export function useTimelineJump({ virtuosoRef, messages, isUnread, onLanded, deps }: UseTimelineJumpArgs) {
    const latest = useRef({ messages, isUnread, onLanded });
    latest.current = { messages, isUnread, onLanded };
    const depsRef = useRef<JumpDeps>({ ...defaultDeps, ...deps });
    depsRef.current = { ...defaultDeps, ...deps };
    const tokenRef = useRef(0);

    useEffect(() => () => { tokenRef.current += 1; }, []);

    return useCallback(async (target: JumpTarget): Promise<JumpOutcome> => {
        const token = ++tokenRef.current;
        const { nextFrame, measure, now } = depsRef.current;
        const started = now();
        const resolved = resolveJump(latest.current.messages, target, latest.current.isUnread);

        const finish = (outcome: JumpOutcome, index: number, corrections: number): JumpOutcome => {
            clientLog('timeline_jump', {
                target: jumpTargetCode(target),
                index,
                corrections,
                outcome,
                jump_ms: Math.round(now() - started),
            });
            return outcome;
        };

        if (!resolved) return finish('not_found', -1, 0);
        const scroll = () => virtuosoRef.current?.scrollToIndex({ index: resolved.index, align: resolved.align, behavior: 'auto' });
        if (!virtuosoRef.current) return finish('gave_up', resolved.index, 0);
        scroll();
        if (!resolved.verify) return finish('landed', resolved.index, 0);

        let corrections = 0;
        for (;;) {
            let error: number | null = null;
            for (let frame = 0; frame < MAX_WAIT_FRAMES && error === null; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', resolved.index, corrections);
                error = measure(resolved.messageId, resolved.align);
            }
            if (error === null) return finish('gave_up', resolved.index, corrections);
            for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', resolved.index, corrections);
            }
            error = measure(resolved.messageId, resolved.align) ?? error;
            if (Math.abs(error) <= LANDING_TOLERANCE_PX) {
                if (resolved.highlight) latest.current.onLanded?.(resolved.messageId);
                return finish('landed', resolved.index, corrections);
            }
            if (corrections >= MAX_CORRECTIONS) return finish('gave_up', resolved.index, corrections);
            corrections += 1;
            scroll();
        }
    }, [virtuosoRef]);
}
```

- [ ] **Step 4: Run, expect pass**

```bash
npx vitest run src/features/messages/hooks/useTimelineJump.test.ts
```

Expected: PASS. If `cancels an older one` fails because both promises interleave differently, check that `tokenRef` is read **after** each `await`. Fix the hook, not the test.

- [ ] **Step 5: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/features/messages/hooks/useTimelineJump.ts frontend/src/features/messages/hooks/useTimelineJump.test.ts
uv run git commit -m "feat(chat): add an instant, self-correcting timeline jump hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Route every jump through `jumpTo` and highlight landings

**Files:**
- Modify: `frontend/src/features/messages/hooks/useTimelineKeyNav.ts`
- Modify: `frontend/src/features/messages/hooks/useTimelineKeyNav.test.ts`
- Modify: `frontend/src/features/messages/components/MessageList.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`

**Interfaces:**
- Consumes: `useTimelineJump` (Task 4), `JumpTarget` (Task 3).
- Produces:
  - `useTimelineKeyNav(jumpTo: (t: JumpTarget) => unknown, callActive: boolean)`
  - New `MessageList` props: `onJumpToMessage?: (id: number) => void` and `highlightedMessageId?: number | null`
  - `JUMP_HIGHLIGHT_MS = 1000` (exported from `MessagesFeature.tsx` is not needed; keep it a module constant)

- [ ] **Step 1: Update the key-nav test first**

Replace the `setup` helper and the Home/End expectations in `frontend/src/features/messages/hooks/useTimelineKeyNav.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type React from 'react';
import { useTimelineKeyNav } from './useTimelineKeyNav';

const key = (k: string) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.KeyboardEvent;

function setup(callActive: boolean) {
    const jumpTo = vi.fn();
    const { result } = renderHook(() => useTimelineKeyNav(jumpTo, callActive));
    return { handle: result.current, jumpTo };
}

describe('useTimelineKeyNav', () => {
    it('Home jumps to the top', () => {
        const { handle, jumpTo } = setup(false);
        const e = key('Home');
        handle(e);
        expect(jumpTo).toHaveBeenCalledWith({ kind: 'top' });
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('End jumps to the bottom', () => {
        const { handle, jumpTo } = setup(false);
        handle(key('End'));
        expect(jumpTo).toHaveBeenCalledWith({ kind: 'bottom' });
    });

    it('leaves PageUp/PageDown alone when no call is active', () => {
        const { handle, jumpTo } = setup(false);
        const e = key('PageUp');
        handle(e);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it.each(['Home', 'End', 'PageUp', 'PageDown'])('%s does not scroll the hidden list during a call', (k) => {
        const { handle, jumpTo } = setup(true);
        const e = key(k);
        handle(e);
        expect(jumpTo).not.toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
    });

    it('ignores other keys during a call', () => {
        const { handle } = setup(true);
        const e = key('Enter');
        handle(e);
        expect(e.preventDefault).not.toHaveBeenCalled();
    });
});
```

Run `npx vitest run src/features/messages/hooks/useTimelineKeyNav.test.ts`. Expected: FAIL (the signature is still the old one).

- [ ] **Step 2: Update `useTimelineKeyNav`**

```ts
import { useCallback } from 'react';
import type React from 'react';
import type { JumpTarget } from '../timeline/jumpTarget';

const SCROLL_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown']);

/**
 * Keyboard handler for the message timeline: Home/End jump to the first/last
 * message through the shared timeline jump. While an incoming call covers the
 * timeline (`callActive`) the list is hidden, so Home/End/PageUp/PageDown are
 * swallowed and nothing scrolls.
 */
export function useTimelineKeyNav(
    jumpTo: (target: JumpTarget) => unknown,
    callActive: boolean,
) {
    return useCallback((e: React.KeyboardEvent) => {
        if (callActive) {
            if (SCROLL_KEYS.has(e.key)) e.preventDefault();
            return;
        }
        if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            void jumpTo({ kind: 'top' });
        } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            void jumpTo({ kind: 'bottom' });
        }
    }, [jumpTo, callActive]);
}
```

Run the key-nav test again. Expected: PASS.

- [ ] **Step 3: `MessageList` — jump callback and highlight**

In `frontend/src/features/messages/components/MessageList.tsx`:

1. Add to `ChatListProps` (after `onTargetMessageConsumed`):

```ts
    /** Jump to a message through the shared timeline jump (same-room and fresh-mount targets) */
    onJumpToMessage?: (id: number) => void;
    /** Message row to flash after a jump landed on it */
    highlightedMessageId?: number | null;
```

2. Destructure `onJumpToMessage` and `highlightedMessageId` in the component signature.

3. Replace the same-room target effect:

```ts
    useEffect(() => {
        if (targetIndex == null) return;
        virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: 'start' });
        onTargetMessageConsumed?.();
    }, [targetIndex, onTargetMessageConsumed, virtuosoRef]);
```

with:

```ts
    // Fresh mounts already start at the target (initialTopMostItemIndex); the shared
    // jump then verifies the landing and highlights it. Same-room targets jump here.
    useEffect(() => {
        if (targetIndex == null || targetMessageId == null) return;
        onJumpToMessage?.(targetMessageId);
        onTargetMessageConsumed?.();
    }, [targetIndex, targetMessageId, onJumpToMessage, onTargetMessageConsumed]);
```

Keep the comment above it that explains the fresh-mount path, updated to say the effect now calls `onJumpToMessage`. Keep `initialTopMostItemIndex = targetIndex ?? savedScrollIndex` unchanged.

4. Replace the row wrapper `<div className="px-4 py-1" id={`msg-${msg.id}`}>` with:

```tsx
                    <div
                        className={cn(
                            'px-4 py-1 rounded-card transition-colors duration-base ease-standard',
                            highlightedMessageId === msg.id && 'bg-group-subtle',
                        )}
                        id={`msg-${msg.id}`}
                    >
```

Add `import { cn } from '../../../utils/classnames';` at the top.

- [ ] **Step 4: `MessagesFeature` — own the hook and rewire the entry points**

In `frontend/src/features/messages/MessagesFeature.tsx`:

1. Imports:

```ts
import { useTimelineJump } from './hooks/useTimelineJump';
```

2. Module constant near the other constants at the top of the file:

```ts
/** How long a landed jump keeps its row highlighted before fading out. */
const JUMP_HIGHLIGHT_MS = 1000;
```

3. After `isUnread` is defined (around the current line 402), add the highlight state and the hook:

```ts
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
    const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashLanded = useCallback((id: number) => {
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        setHighlightedMessageId(id);
        highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), JUMP_HIGHLIGHT_MS);
    }, []);
    useEffect(() => () => {
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    }, []);
    useEffect(() => { setHighlightedMessageId(null); }, [selectedGroupDir]);

    const jumpTo = useTimelineJump({ virtuosoRef, messages, isUnread, onLanded: flashLanded });
```

4. Replace `scrollToFirstUnread` and `scrollToMessage`:

```ts
    const scrollToFirstUnread = useCallback(() => { void jumpTo({ kind: 'firstUnread' }); }, [jumpTo]);

    const scrollToMessage = useCallback((id: number) => {
        void jumpTo({ kind: 'message', id, align: 'center' });
    }, [jumpTo]);
```

5. Replace the key-nav line:

```ts
    const handleKeyDown = useTimelineKeyNav(jumpTo, callActive);
```

6. Replace `scrollToDate` (keep its SD-FE-CORE-02 comment block above it):

```ts
    const scrollToDate = useCallback((dateStr: string) => {
        void jumpTo({ kind: 'date', date: dateStr });
    }, [jumpTo]);
```

7. On `<MessageList … />`, add:

```tsx
                            onJumpToMessage={jumpToTargetMessage}
                            highlightedMessageId={highlightedMessageId}
```

with, next to `scrollToMessage`:

```ts
    const jumpToTargetMessage = useCallback((id: number) => {
        void jumpTo({ kind: 'message', id, align: 'start' });
    }, [jumpTo]);
```

8. `useTimelineJump` must be called after `messages`, `isUnread` and `virtuosoRef` exist. Every `jumpTo` consumer (`scrollToMessage` → `useIncomingCall`, `handleKeyDown`, `scrollToDate`) must be declared after it. Move the hook block up if needed. Do not change the order of any other hook.

- [ ] **Step 5: Unit tests, types, lint**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend && npx vitest run && npx tsc --noEmit && npm run lint
```

Expected: all pass, exit 0. If an existing `MessagesFeature` / incoming-call test asserted `scrollToIndex` arguments, update it to the `jumpTo` behaviour (a message jump now aligns `center` with `behavior: 'auto'`, as before) and say so in the commit body.

- [ ] **Step 6: Real-browser verification**

```bash
npm run build && npx playwright test e2e/timeline-scroll.spec.ts e2e/visual-zero-pixel.spec.ts --reporter=line
```

Expected: `9 passed` (6 timeline + 3 zero-pixel). The calendar test now lands in < 1 s with the highlight. If the date jump lands but the poll sees a neighbouring id, inspect the `timeline_jump` breadcrumb in the backend log (`corrections`, `outcome`) before touching the tolerance. The fix belongs in the hook, not in the test.

- [ ] **Step 7: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/src/features/messages
uv run git commit -m "fix(chat): make calendar and message jumps instant" -m "Every timeline jump now goes through useTimelineJump: instant scroll,
verified landing with up to two corrections, a short highlight and a
breadcrumb. The calendar no longer smooth-scrolls through every message.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, changelog, Windows check, PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md`

- [ ] **Step 1: Zero-drift spec update**

In the spec's D2a-0 "Design" section:
- Replace the `useTimelineJump` interface block with the one actually built: `useTimelineJump({ virtuosoRef, messages, isUnread, onLanded, deps })` returning `jumpTo`, plus `JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled'`.
- Change step 3 to: the hook waits up to 60 frames for the row, then settles 2 frames and measures.
- Change step 4's highlight to `bg-group-subtle` on the row for 1 s, faded with `duration-base`.
- Change the incoming-call row of the entry-point table to `jumpTo({kind:'message', align:'center'})`.

- [ ] **Step 2: Changelog**

Read `docs/DOC_FORMATS.md` and follow it. Under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`, add:

```markdown
- **Jumping to an old date is instant.** Picking a day in the chat calendar now goes straight there instead of scrolling through every message in between, and the message you land on flashes briefly so you can see where you are.
```

- [ ] **Step 3: Full checks**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk && uv run pytest backend -q
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npx playwright test e2e/timeline-scroll.spec.ts e2e/visual-zero-pixel.spec.ts --reporter=line
```

Expected: all green. The pysaka keyring test may error in headless WSL; that is pre-existing and not part of this repo's suite.

- [ ] **Step 4: Commit**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add CHANGELOG.md docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md
uv run git commit -m "docs: note instant timeline jumps" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Windows check (controller, with the user)**

Build the Windows test build the same way as for D1.5, against the archive copy `C:\D\saka-verify` (never the live `C:\D\SakaDesk Output`). In 高井 俐香's room, open the calendar, go to a 2022 month, and pick a day. It must land instantly on that day, with the highlight. Also try a search result and the media-gallery "jump to message". Ask the user to confirm.

- [ ] **Step 6: Push and open the PR**

```bash
uv run git push -u origin fix/timeline-jump
```

The PR title is `fix(chat): make calendar and message jumps instant`, targeting `dev`. Its body has `## Why`, `## What`, `## Testing`, `## Changelog` per `docs/DOC_FORMATS.md`, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
