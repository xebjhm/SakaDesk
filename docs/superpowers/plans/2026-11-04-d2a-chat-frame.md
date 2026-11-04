# D2a Chat Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the main window the D2 look (neutral group rail, one canvas block for the feature rail and member sidebar, the chat on a sheet) and turn the chat into a day-grouped timeline with sticky date pills, message runs and the user's sent letters inline, without regressing any scroll behaviour.

**Architecture:** A pure `buildTimeline(messages, letters)` model becomes the only index source: the jump hook, scroll restore, unread arrows and the panel-visibility registry all ask it for indices by id, and rows are keyed `msg-<id>` / `letter-<id>`. The list moves from `Virtuoso` to `GroupedVirtuoso` (one group per local day, `DatePill` headers) only after a real-browser probe has pinned down the library's range and sticky-header semantics. Two read-only backend endpoints serve the local letters archive and the account avatar history. The visuals are then rebuilt screen by screen on the design-system tokens and primitives.

**Tech Stack:** React 18 + TypeScript, react-virtuoso 4.18.1 (`GroupedVirtuoso`), framer-motion 10, Tailwind with design-system tokens, vitest 4 + @testing-library/react + msw, Playwright, FastAPI + pydantic + structlog, pytest.

Spec: `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md`, part "D2a — the redesign" (sections 1–5, implementation order, error handling, out of scope). D2a-0 is merged (`e4e4118`); its jump machinery is extended here.

## Global Constraints

- Branch `feat/d2a-chat-frame` (cut from `dev` after D2a-0; spec at `a2998cc`). The PR targets `dev`.
- Commit with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Conventional Commits, whole first line ≤ 72 chars, imperative, no trailing period, and end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A hook enforces `docs/DOC_FORMATS.md`.
- Frontend commands run in `SakaDesk/frontend/` (`npx vitest run …`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npx playwright test …`). Backend commands run in `SakaDesk/` (`uv run pytest …`, `uv run ruff check backend`, `uv run mypy backend`). uv only: never `pip`.
- UI uses design-system tokens and primitives only (`docs/design/DESIGN_SYSTEM.md`). No hex, `rgb()`/`hsl()`, arbitrary radius/shadow/text/spacing (`rounded-[…]`, `shadow-[…]`, `text-[…]`, `p-[…]`, `m-[…]`, `gap-[…]`) and no named palette classes (`bg-gray-100`, `text-red-500`, `bg-white`, `bg-black/50`) in new or changed lines. Width/height/position/grid-template/aspect arbitrary values are allowed. Overlays use `bg-scrim`.
- Group colour only through the official layer (`bg-group-canvas`, `bg-group-title`, `bg-group-title-bar`, `text-group-title`, the shelters) and the roles (`bg-group-accent`, `bg-group-badge`, `text-group-strong`, `border-group-bubble`, `ring-group`, `shadow-group-glow`, `animate-landing`). Official-layer colours stay verbatim (Sakurazaka: white header + thin bar). No group colour anywhere else; the group rail is neutral. At most one `Button variant="primary"` per screen.
- Every new visible string goes through `t('…')` and is added to all 5 locales (`en`, `ja`, `zh-CN`, `zh-TW`, `yue` in `frontend/src/i18n/locales/`). Primitives take translated labels.
- Scrolling: never `behavior: 'smooth'` for a jump; `followOutput` stays exactly `(isAtBottom: boolean) => isAtBottom ? 'smooth' : false`; every jump goes through `jumpTo` and logs exactly one `timeline_jump` breadcrumb. No scroll caller computes an index from `messages[]`: indices come from the `Timeline` model, by id or row key.
- Breadcrumbs on every decision path: backend structlog events (outcome + counts), frontend `clientLog` (whitelisted events and fields only). Never log letter text, nicknames, member names, paths or URLs. The account avatar `url` in `profile_images/index.json` is a signed URL: never return or log it.
- No `print()` / `console.log` in app code. Python: `pathlib.Path`, `open(..., encoding="utf-8")`.
- e2e: run `npm run build` first (the backend on :8000 serves `frontend/dist`), then `npx playwright test <spec> --reporter=line` headless from the CLI. Never use the Playwright MCP, `--headed` or `--ui`. Wait with `waitForRequest` / `expect.poll`, never `waitForTimeout`.
- `e2e/visual-zero-pixel.spec.ts` will fail from Task 8 on (the redesign changes pixels on purpose). Do not run it or update its snapshots before Task 13.
- Guard ratchet: `frontend/src/design/guard.test.ts` counts may only go down. When a file's count drops, lower `src/design/guard-baseline.json` with `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts` and check that the diff only lowers numbers or removes entries.
- Out of scope: dark mode, sidebar collapse, drag-to-resize, the inline "reveal all" dialog (D2c), every other dialog (D2c), blog screens (D2b), entry screens (D2d), new UX features (message right-click menu, member search, …).
- Real archive reference (read-only, never modify): `/mnt/c/D/saka-verify/output/日向坂46/messages/90 高井 俐香/142 高井 俐香/letters.json` is `{"version": 1, "letters": [{id, member_id, text, created_at, updated_at, is_favorite, image_file: "letters/<id>.jpg" | null, width, height}]}`; `/mnt/c/D/saka-verify/output/日向坂46/account/profile.json` is `{version, name, updated_at}`; `account/profile_images/index.json` is `{version, current, images: [{kind, file: "thumbnail/<name>", url, first_seen}]}`.

## File Structure

| File | Responsibility |
|---|---|
| Create `frontend/src/__tests__/virtuosoMock.tsx` | Shared jsdom stand-in for `Virtuoso`/`GroupedVirtuoso` that renders every row and captures `rangeChanged` |
| Create `frontend/src/features/messages/components/MessageList.range.test.tsx` | Locks the `rangeChanged` wiring (unread nav + panel auto-collapse) |
| Modify `frontend/e2e/fixtures/bigRoom.ts` | Sticky-header-aware `topVisibleMessageId`, per-service pinning, scroll-save route; later letters/profile/streak routes |
| Modify `frontend/e2e/timeline-scroll.spec.ts` | More locked behaviours (keys, down arrow, save request); later date pills and letters |
| Create `frontend/e2e/d2a-screens.spec.ts` | Captures before/after screenshots of all four groups (no comparison) |
| Create `frontend/src/features/messages/letters.ts` | `Letter`/profile types, fetchers, letter-avatar choice, letter image size |
| Create `frontend/src/features/messages/timeline/buildTimeline.ts` (+ test) | Pure timeline model: merged rows, runs, day groups, index helpers, row keys |
| Create `frontend/src/features/messages/timeline/TimelineProbe.tsx`, `probeRoute.ts` (+ test) | Dev-only GroupedVirtuoso probe page |
| Create `frontend/playwright.probe.config.ts`, `frontend/e2e/probe/grouped-virtuoso.spec.ts` | Real-browser probe of GroupedVirtuoso semantics (Vite dev server) |
| Modify `frontend/src/features/messages/timeline/jumpTarget.ts`, `landing.ts` (+ tests) | Resolve jumps on the model and row keys; land below the sticky header |
| Modify `frontend/src/features/messages/hooks/useTimelineJump.ts`, `useLandingHighlight.ts`, `useChatScroll.ts` (+ tests) | Jump/highlight/restore on the model and row keys |
| Create `frontend/src/features/messages/utils/nickname.ts` (+ test) | `%%%` nickname replacement, moved out of `MessageList` so one timeline serves everyone |
| Modify `frontend/src/features/messages/components/MessageList.tsx` | Renders the timeline with `GroupedVirtuoso`, date headers, letters, runs |
| Modify `frontend/src/design/primitives/DatePill.tsx` (+ test) | Optional button mode (opens the calendar) |
| Modify `frontend/src/utils/dateFormatters.ts` (+ test) | `fromLocalDateStr` |
| Modify `frontend/src/features/messages/components/ConversationMenu.tsx` | Calendar and letters owned by `MessagesFeature` |
| Modify `backend/api/chat_features.py`; create `backend/api/account.py`, `backend/services/archive_urls.py` | `GET /api/chat/letters_local`, `GET /api/account/profile` |
| Create `backend/tests/test_letters_local_api.py`, `backend/tests/test_account_profile_api.py` | Endpoint tests |
| Modify `backend/api/client_log.py`, `frontend/src/utils/clientLog.ts` (+ test) | New breadcrumbs `letters_load`, `account_profile_load`, `letter_avatar` |
| Modify `frontend/src/core/layout/{Layout,ServiceRail,FeatureRail,ContentArea}.tsx`; create `FadeOnChange.tsx` (+ tests) | The D-4/D-5 frame |
| Modify `frontend/src/config/features.ts`, `frontend/src/shell/components/LoginModal.tsx` | Feature labels from i18n |
| Modify `frontend/src/features/messages/components/MemberList.tsx` (+ test) | Member sidebar |
| Create `frontend/src/features/messages/hooks/useMemberStreak.ts` (+ test) | Streak from a session cache (one request per room per local day), shared by the header and the profile popup |
| Modify `frontend/src/features/messages/components/{MessageBubble,MemberProfilePopup}.tsx` (+ tests) | Runs, token bubbles, popup reads the shared streak |
| Create `frontend/src/features/messages/hooks/useRoomLetters.ts`, `components/LetterRow.tsx` (+ tests) | Letters in chat |
| Modify `frontend/src/core/modals/SentLettersModal.tsx` (+ test) | Overview grid from the local archive, jumps to the letter |
| Modify `frontend/src/features/messages/MessagesFeature.tsx` | Owns timeline, letters, calendar, streak; chat on a `ContentSheet` |
| Modify design tokens: `tokens/radius.ts`, `tailwind.config.js`, `utils/classnames.ts`, `DesignPage.tsx`, `docs/design/DESIGN_SYSTEM.md` | `rounded-tl-tail` (first-bubble corner) and `bg-group-title` (title gradient) |
| Create `frontend/src/i18n/d2a.test.ts` | Every new D2a key exists in all 5 locales |
| Modify `CHANGELOG.md`, the spec | End-user entries; zero drift |

### Adding i18n keys

Several tasks add keys. Use this one-liner from `frontend/` (the locale files round-trip byte-identically through `JSON.stringify(…, null, 2)`); pass a JSON object `{locale: {"section.key": "value"}}` as the argument and avoid apostrophes in values:

```bash
node -e '
const fs = require("fs");
const add = JSON.parse(process.argv[1]);
for (const [code, entries] of Object.entries(add)) {
  const file = `src/i18n/locales/${code}.json`;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [dotted, value] of Object.entries(entries)) {
    const [section, key] = dotted.split(".");
    data[section] = { ...(data[section] ?? {}), [key]: value };
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}' '<JSON>'
```

---

### Task 1: Lock the current scroll behaviour

Characterisation tests: they must PASS on the unchanged code. They are the safety net for Tasks 5–12.

**Files:**
- Create: `frontend/src/__tests__/virtuosoMock.tsx`
- Modify: `frontend/src/features/messages/components/MessageList.jump.test.tsx:6-12`
- Create: `frontend/src/features/messages/components/MessageList.range.test.tsx`
- Modify: `frontend/e2e/fixtures/bigRoom.ts` (full replacement below)
- Modify: `frontend/e2e/timeline-scroll.spec.ts`

**Interfaces:**
- Produces: `virtuosoMock` / `virtuosoCapture` (test helper; Task 6 adds `GroupedVirtuoso` to it). `bigRoom.ts` exports `SERVICE`, `TZ`, `COUNT`, `ROOM_DIR`, `OTHER_DIR`, `roomDir(service)`, `otherDir(service)`, `buildBigRoom()`, `tokyoDate()`, `firstIdOnDate()`, `pinBigRoom(page, { messages, lastReadId?, service? })`, `topVisibleMessageId(page)` (ignores rows hidden behind a sticky header), `isRowInViewport(page, id)`.

- [ ] **Step 1: Create the shared Virtuoso test stand-in**

`frontend/src/__tests__/virtuosoMock.tsx` (the `__tests__/` folder is not scanned by the guard and is not a test file):

```tsx
import React from 'react';
import type { ListRange } from 'react-virtuoso';

/** What the chat tests read back from the last rendered list. */
export const virtuosoCapture: { rangeChanged?: (range: ListRange) => void } = {};

interface FlatProps {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
    rangeChanged?: (range: ListRange) => void;
}

/**
 * jsdom has no layout, so the real list renders no rows. This stand-in renders every row
 * and captures `rangeChanged`. Use with:
 *   vi.mock('react-virtuoso', async () => (await import('<rel>/__tests__/virtuosoMock')).virtuosoMock);
 */
export const virtuosoMock = {
    Virtuoso: ({ data, itemContent, rangeChanged }: FlatProps) => {
        virtuosoCapture.rangeChanged = rangeChanged;
        return <div>{data.map((item, i) => <div key={i}>{itemContent(i, item)}</div>)}</div>;
    },
};
```

- [ ] **Step 2: Point the jump test at the shared stand-in**

In `frontend/src/features/messages/components/MessageList.jump.test.tsx` replace lines 6–12 (the comment and the inline `vi.mock('react-virtuoso', …)` block) with:

```tsx
vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
```

- [ ] **Step 3: Write the rangeChanged lock test**

`frontend/src/features/messages/components/MessageList.range.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import type { Message } from '../../../types';
import { virtuosoCapture } from '../../../__tests__/virtuosoMock';
import { useCollapseOnOutOfView } from '../hooks/useMessageVisibility';
import { MessageList } from './MessageList';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: undefined, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

const msg = (id: number): Message =>
    ({ id, timestamp: `2026-01-0${id}T00:00:00Z`, type: 'text', is_favorite: false, content: `m${id}` });
const messages = [msg(1), msg(2), msg(3)];

function renderList(onRangeChanged = vi.fn()) {
    render(
        <MessageList
            memberId="room"
            messages={messages}
            getSenderInfo={() => ({ name: 'n' })}
            isUnread={() => false}
            onReveal={vi.fn()}
            onLongPress={vi.fn()}
            onRangeChanged={onRangeChanged}
        />,
    );
    return onRangeChanged;
}

describe('MessageList rangeChanged wiring', () => {
    it('reports the rendered range to the unread navigation', () => {
        const onRangeChanged = renderList();
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(onRangeChanged).toHaveBeenCalledWith({ startIndex: 0, endIndex: 1 });
    });

    it('collapses the panels of messages that left the rendered range, and only those', () => {
        const collapse1 = vi.fn();
        const collapse3 = vi.fn();
        renderHook(() => {
            useCollapseOnOutOfView(1, true, collapse1);
            useCollapseOnOutOfView(3, true, collapse3);
        });
        renderList();
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(collapse3).toHaveBeenCalledTimes(1);
        expect(collapse1).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 4: Run the unit tests (must pass on unchanged code)**

Run: `npx vitest run src/features/messages/components/MessageList.range.test.tsx src/features/messages/components/MessageList.jump.test.tsx`
Expected: PASS (5 tests). A failure means the stand-in is wrong, not the app.

- [ ] **Step 5: Replace the e2e fixture**

Full new `frontend/e2e/fixtures/bigRoom.ts` (same data; adds `service`, the sticky-header-aware helper and a route for scroll saves):

```ts
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
            activeFeatures: { [service]: 'messages' },
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

- [ ] **Step 6: Extend the scroll spec**

In `frontend/e2e/timeline-scroll.spec.ts`:

(a) Add `ROOM_DIR` to the import from `./fixtures/bigRoom`.

(b) Add this helper below `openCalendarAt`:

```ts
/** Focus the timeline without clicking a bubble (a click on an unread shelter would reveal it). */
async function focusTimeline(page: Page) {
  await page.locator('[data-virtuoso-scroller]').click({ position: { x: 4, y: 4 } })
}
```

(c) Replace the whole `'re-opening the room restores the last top message'` test with:

```ts
  test('re-opening the room restores the last top message', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'March 2024')
    const expected = firstIdOnDate(messages.current, '2024-03-15')
    // useChatScroll saves the top message 500 ms after the list stops moving.
    const saved = page.waitForRequest((req) =>
      req.method() === 'PATCH' &&
      new URL(req.url()).searchParams.get('path') === `sakadesk_scroll_${ROOM_DIR}` &&
      (req.postData() ?? '').includes(`"value":"${expected}"`),
    )
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 2000 }).toBe(expected)
    await saved
    await page.getByText('Other Room', { exact: true }).click()
    await expect(page.getByText('Other room message')).toBeVisible()
    await page.getByText('Big Room', { exact: true }).click()
    await expect.poll(() => topVisibleMessageId(page), { timeout: 3000 }).toBe(expected)
  })
```

(d) Append these tests inside the `describe` block:

```ts
  test('Home and End jump to the first and the last message', async ({ page }) => {
    await openBigRoom(page)
    await focusTimeline(page)
    await page.keyboard.press('Home')
    await expect.poll(() => isRowInViewport(page, 1), { timeout: 2000, intervals: [50] }).toBe(true)
    await page.keyboard.press('End')
    await expect.poll(() => isRowInViewport(page, COUNT), { timeout: 2000, intervals: [50] }).toBe(true)
  })

  test('first-unread arrow below the view brings the first unread into view', async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await pinBigRoom(page, { messages, lastReadId: 2500 })
    await openBigRoom(page)
    await focusTimeline(page)
    await page.keyboard.press('Home')
    await expect.poll(() => isRowInViewport(page, 1), { timeout: 2000, intervals: [50] }).toBe(true)
    const arrow = page.getByTitle('Jump to oldest unread')
    await expect(arrow).toHaveCount(1)
    await arrow.click()
    await expect.poll(() => isRowInViewport(page, 2501), { timeout: 1000, intervals: [50] }).toBe(true)
  })
```

- [ ] **Step 7: Run the e2e spec on the unchanged app**

Run: `npm run build && npx playwright test e2e/timeline-scroll.spec.ts --reporter=line`
Expected: 8 passed. If one of the new tests fails, the test is wrong (the app is unchanged): fix the test, not the app.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/__tests__/virtuosoMock.tsx frontend/src/features/messages/components/MessageList.jump.test.tsx frontend/src/features/messages/components/MessageList.range.test.tsx frontend/e2e/fixtures/bigRoom.ts frontend/e2e/timeline-scroll.spec.ts
uv run git commit -m "test(chat): lock timeline scroll behaviour before D2a" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Capture "before" screenshots for all four groups

**Files:**
- Create: `frontend/e2e/d2a-screens.spec.ts`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: `pinBigRoom(page, { messages, service, lastReadId })`, `buildBigRoom`, `COUNT`, `TZ` (Task 1).
- Produces: `frontend/e2e-shots/before/<service>-{home,chat}.png` (git-ignored), compared with `after/` in Task 13.

- [ ] **Step 1: Write the capture spec**

`frontend/e2e/d2a-screens.spec.ts`:

```ts
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
    await page.screenshot({ path: `e2e-shots/${LABEL}/${service}-home.png` })
    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT - 4}`)).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: `e2e-shots/${LABEL}/${service}-chat.png` })
  })
}
```

- [ ] **Step 2: Ignore the output folder**

Append to `/home/xtorker/repos/Project-Saka/SakaDesk/.gitignore`, right after the "Local-only pixel baselines" block:

```
# D2a before/after screenshots (e2e/d2a-screens.spec.ts)
frontend/e2e-shots/
```

- [ ] **Step 3: Capture the "before" set**

Run: `npm run build && SHOT_LABEL=before npx playwright test e2e/d2a-screens.spec.ts --reporter=line`
Expected: 4 passed; `ls e2e-shots/before` lists 8 PNGs. Without `SHOT_LABEL` the spec reports 4 skipped.

- [ ] **Step 4: Commit (spec and ignore rule only, never the PNGs)**

```bash
git add frontend/e2e/d2a-screens.spec.ts .gitignore
uv run git commit -m "test(e2e): capture D2a before/after screens for each group" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The pure timeline model

**Files:**
- Create: `frontend/src/features/messages/letters.ts` (types only in this task)
- Create: `frontend/src/features/messages/timeline/buildTimeline.ts`
- Test: `frontend/src/features/messages/timeline/buildTimeline.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `interface Letter { id: number; text: string; created_at: string; image_url: string | null; width: number | null; height: number | null }` in `features/messages/letters.ts`.
  - `RUN_GAP_MS = 300_000`; `type RowKey = \`msg-${number}\` | \`letter-${number}\``; `messageRowKey(id)`, `letterRowKey(id)`, `rowKeyOf(item)`.
  - `type TimelineItem = { kind: 'message'; message: Message; runStart: boolean } | { kind: 'letter'; letter: Letter; runStart: true }`.
  - `buildTimeline(messages: readonly Message[], letters: readonly Letter[]): Timeline` with `items: TimelineItem[]`, `groupCounts: number[]`, `groupDates: string[]`, `groupStarts: number[]`, `indexOfMessage(id)`, `indexOfLetter(id)`, `indexOfDate(date)`, `groupIndexOfDate(date)`, `groupOfIndex(index)`, `indexOfRowKey(key)`, `rowKeyAt(index): RowKey | null`, `messageIdNear(index): number | null`. All lookups return -1 / null when absent.

- [ ] **Step 1: Create the letter type**

`frontend/src/features/messages/letters.ts`:

```ts
/** One sent letter from the local archive (`GET /api/chat/letters_local`). */
export interface Letter {
    id: number;
    text: string;
    /** ISO timestamp (UTC). */
    created_at: string;
    /** Media-route URL of the archived letter image; null when the file is missing. */
    image_url: string | null;
    width: number | null;
    height: number | null;
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/features/messages/timeline/buildTimeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import type { Letter } from '../letters';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import { buildTimeline, rowKeyOf, RUN_GAP_MS } from './buildTimeline';

// Local wall-clock times, so day boundaries hold in every time zone the suite runs in.
const at = (d: number, h: number, m: number, s = 0) => new Date(2026, 0, d, h, m, s).toISOString();
const msg = (id: number, timestamp: string, member_id: number | string = 1): Message =>
    ({ id, timestamp, member_id, type: 'text', is_favorite: false, content: `m${id}` });
const letter = (id: number, created_at: string): Letter =>
    ({ id, text: `l${id}`, created_at, image_url: null, width: null, height: null });
const keys = (t: ReturnType<typeof buildTimeline>) => t.items.map(rowKeyOf);

describe('buildTimeline', () => {
    it('is empty for no rows', () => {
        const t = buildTimeline([], []);
        expect(t.items).toEqual([]);
        expect(t.groupCounts).toEqual([]);
        expect(t.indexOfDate('2026-01-01')).toBe(-1);
        expect(t.rowKeyAt(0)).toBeNull();
        expect(t.messageIdNear(0)).toBeNull();
    });

    it('groups rows by local day and counts them', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(1, 20, 0)), msg(3, at(2, 8, 0))], []);
        expect(t.groupDates).toEqual(['2026-01-01', '2026-01-02']);
        expect(t.groupCounts).toEqual([2, 1]);
        expect(t.groupStarts).toEqual([0, 2]);
        expect(t.groupOfIndex(2)).toBe(1);
        expect(t.groupOfIndex(9)).toBe(-1);
    });

    it('splits at local midnight, even 3 minutes apart', () => {
        const t = buildTimeline([msg(1, at(1, 23, 58)), msg(2, at(2, 0, 1))], []);
        expect(t.groupDates).toEqual([toLocalDateStr(at(1, 23, 58)), toLocalDateStr(at(2, 0, 1))]);
        expect(t.items.map((i) => i.runStart)).toEqual([true, true]);
    });

    it('merges letters by time; a tie puts the message first', () => {
        const t = buildTimeline(
            [msg(1, at(1, 9, 0)), msg(2, at(1, 10, 0))],
            [letter(7, at(1, 10, 0)), letter(8, at(1, 9, 30)), letter(9, at(1, 8, 0))],
        );
        expect(keys(t)).toEqual(['letter-9', 'msg-1', 'letter-8', 'msg-2', 'letter-7']);
    });

    it('keeps a day that has only letters', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(3, 9, 0))], [letter(5, at(2, 12, 0))]);
        expect(t.groupDates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
        expect(t.groupCounts).toEqual([1, 1, 1]);
        expect(t.indexOfDate('2026-01-02')).toBe(1);
        expect(t.groupIndexOfDate('2026-01-02')).toBe(1);
    });

    it('a run continues for the same sender within 5 minutes, inclusive', () => {
        const t = buildTimeline([
            msg(1, at(1, 9, 0)),
            msg(2, at(1, 9, 5)), // exactly RUN_GAP_MS later
            msg(3, at(1, 9, 10, 1)), // 1 s over
        ], []);
        expect(RUN_GAP_MS).toBe(5 * 60 * 1000);
        expect(t.items.map((i) => i.runStart)).toEqual([true, false, true]);
    });

    it('a new sender starts a run', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0), 1), msg(2, at(1, 9, 1), 2), msg(3, at(1, 9, 2), '2')], []);
        expect(t.items.map((i) => i.runStart)).toEqual([true, true, false]);
    });

    it('a letter breaks a run and always starts one', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(1, 9, 2))], [letter(5, at(1, 9, 1))]);
        expect(keys(t)).toEqual(['msg-1', 'letter-5', 'msg-2']);
        expect(t.items.map((i) => i.runStart)).toEqual([true, true, true]);
    });

    it('keeps message and letter ids apart (row keys)', () => {
        const t = buildTimeline([msg(100, at(1, 9, 0))], [letter(100, at(1, 10, 0))]);
        expect(t.indexOfMessage(100)).toBe(0);
        expect(t.indexOfLetter(100)).toBe(1);
        expect(t.indexOfRowKey('letter-100')).toBe(1);
        expect(t.indexOfRowKey('msg-999')).toBe(-1);
        expect(t.rowKeyAt(1)).toBe('letter-100');
    });

    it('messageIdNear prefers the message above, else the one below', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0)), msg(2, at(1, 11, 0))], [letter(5, at(1, 8, 0)), letter(6, at(1, 10, 0))]);
        // letter-5, msg-1, letter-6, msg-2
        expect(t.messageIdNear(2)).toBe(1);
        expect(t.messageIdNear(0)).toBe(1);
        expect(t.messageIdNear(3)).toBe(2);
    });

    it('drops letters whose created_at cannot be parsed', () => {
        const t = buildTimeline([msg(1, at(1, 9, 0))], [letter(5, 'not a date')]);
        expect(keys(t)).toEqual(['msg-1']);
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/messages/timeline/buildTimeline.test.ts`
Expected: FAIL (`Cannot find module './buildTimeline'`).

- [ ] **Step 4: Implement the model**

`frontend/src/features/messages/timeline/buildTimeline.ts`:

```ts
import type { Message } from '../../../types';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import type { Letter } from '../letters';

/** Messages from the same sender on the same local day, at most this far apart, form one run. */
export const RUN_GAP_MS = 5 * 60 * 1000;

/** DOM id and highlight key of a row. Message and letter ids can collide, row keys cannot. */
export type RowKey = `msg-${number}` | `letter-${number}`;

export type TimelineItem =
    | { kind: 'message'; message: Message; runStart: boolean }
    | { kind: 'letter'; letter: Letter; runStart: true };

/**
 * The chat timeline as data: the one index source for the list, jumps, scroll restore,
 * unread navigation and the panel-visibility registry. Indices are item indices (group
 * headers are not counted).
 */
export interface Timeline {
    /** Chronological rows; letters merged by created_at (a tie puts the message first). */
    items: TimelineItem[];
    /** Rows per local day, for GroupedVirtuoso's `groupCounts`. */
    groupCounts: number[];
    /** Local YYYY-MM-DD (toLocalDateStr) of each group. */
    groupDates: string[];
    /** Index of each group's first row. */
    groupStarts: number[];
    indexOfMessage: (id: number) => number;
    indexOfLetter: (id: number) => number;
    /** First row of that local day, or -1. */
    indexOfDate: (date: string) => number;
    groupIndexOfDate: (date: string) => number;
    groupOfIndex: (index: number) => number;
    indexOfRowKey: (key: RowKey) => number;
    rowKeyAt: (index: number) => RowKey | null;
    /** Id of the nearest message at or above `index`, else the nearest below; null without messages. */
    messageIdNear: (index: number) => number | null;
}

export const messageRowKey = (id: number): RowKey => `msg-${id}`;
export const letterRowKey = (id: number): RowKey => `letter-${id}`;
export const rowKeyOf = (item: TimelineItem): RowKey =>
    item.kind === 'message' ? messageRowKey(item.message.id) : letterRowKey(item.letter.id);

function timeOf(iso: string): number | null {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : t;
}

interface Previous { kind: 'message' | 'letter'; day: string; sender: string; time: number | null }

/** Build the timeline. `messages` must be chronological (the backend sorts them); letters may come in any order. */
export function buildTimeline(messages: readonly Message[], letters: readonly Letter[]): Timeline {
    const dated = letters
        .map((letter) => ({ letter, time: timeOf(letter.created_at) }))
        .filter((l): l is { letter: Letter; time: number } => l.time !== null)
        .sort((a, b) => a.time - b.time);

    const items: TimelineItem[] = [];
    const groupCounts: number[] = [];
    const groupDates: string[] = [];
    const groupStarts: number[] = [];
    const groupOf: number[] = [];
    const add = (item: TimelineItem, day: string) => {
        if (groupDates.length === 0 || groupDates[groupDates.length - 1] !== day) {
            groupDates.push(day);
            groupCounts.push(0);
            groupStarts.push(items.length);
        }
        groupCounts[groupCounts.length - 1] += 1;
        groupOf.push(groupDates.length - 1);
        items.push(item);
    };
    const addLetter = (letter: Letter): Previous => {
        const day = toLocalDateStr(letter.created_at);
        add({ kind: 'letter', letter, runStart: true }, day);
        return { kind: 'letter', day, sender: '', time: null };
    };

    let prev: Previous | null = null;
    let next = 0;
    for (const message of messages) {
        const time = timeOf(message.timestamp);
        // Ties go to the message: only letters strictly earlier are placed before it.
        while (next < dated.length && time !== null && dated[next].time < time) {
            prev = addLetter(dated[next].letter);
            next += 1;
        }
        const day = toLocalDateStr(message.timestamp);
        const sender = String(message.member_id ?? '');
        const continues = prev !== null && prev.kind === 'message' && prev.day === day && prev.sender === sender
            && prev.time !== null && time !== null && time >= prev.time && time - prev.time <= RUN_GAP_MS;
        add({ kind: 'message', message, runStart: !continues }, day);
        prev = { kind: 'message', day, sender, time };
    }
    for (; next < dated.length; next += 1) addLetter(dated[next].letter);

    const byKey = new Map<RowKey, number>();
    items.forEach((item, i) => byKey.set(rowKeyOf(item), i));
    const groupByDate = new Map<string, number>();
    groupDates.forEach((date, g) => {
        if (!groupByDate.has(date)) groupByDate.set(date, g);
    });

    return {
        items,
        groupCounts,
        groupDates,
        groupStarts,
        indexOfMessage: (id) => byKey.get(messageRowKey(id)) ?? -1,
        indexOfLetter: (id) => byKey.get(letterRowKey(id)) ?? -1,
        indexOfRowKey: (key) => byKey.get(key) ?? -1,
        groupIndexOfDate: (date) => groupByDate.get(date) ?? -1,
        indexOfDate: (date) => {
            const g = groupByDate.get(date);
            return g === undefined ? -1 : groupStarts[g];
        },
        groupOfIndex: (index) => groupOf[index] ?? -1,
        rowKeyAt: (index) => {
            const item = items[index];
            return item ? rowKeyOf(item) : null;
        },
        messageIdNear: (index) => {
            for (let i = Math.min(index, items.length - 1); i >= 0; i -= 1) {
                const item = items[i];
                if (item.kind === 'message') return item.message.id;
            }
            for (let i = Math.max(index + 1, 0); i < items.length; i += 1) {
                const item = items[i];
                if (item.kind === 'message') return item.message.id;
            }
            return null;
        },
    };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/messages/timeline/buildTimeline.test.ts && npx tsc --noEmit`
Expected: PASS (11 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/messages/letters.ts frontend/src/features/messages/timeline/buildTimeline.ts frontend/src/features/messages/timeline/buildTimeline.test.ts
uv run git commit -m "feat(chat): add the pure timeline model with runs and day groups" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Probe GroupedVirtuoso in a real browser

The spec requires establishing, before the swap, how `GroupedVirtuoso` (4.18.1) reports ranges and where it puts rows under its sticky header. Reading `node_modules/react-virtuoso/dist/index.mjs` suggests: `rangeChanged` skips group headers at the ends and reports **item** indices; `scrollToIndex({index})` converts an item index to the flat list and, for `align: 'start'`, subtracts the sticky header height; `{groupIndex}` targets the group's first item. This task turns those into tests. Tasks 5–6 are written against them.

**Files:**
- Create: `frontend/src/features/messages/timeline/probeRoute.ts`
- Test: `frontend/src/features/messages/timeline/probeRoute.test.ts`
- Create: `frontend/src/features/messages/timeline/TimelineProbe.tsx`
- Modify: `frontend/src/shell/main.tsx`
- Create: `frontend/playwright.probe.config.ts`
- Create: `frontend/e2e/probe/grouped-virtuoso.spec.ts`
- Modify: `frontend/playwright.config.ts`

**Interfaces:**
- Produces: the facts Tasks 5–6 rely on, enforced by `e2e/probe/grouped-virtuoso.spec.ts`:
  1. The sticky header is `[data-testid="virtuoso-top-item-list"]` inside `[data-virtuoso-scroller]`.
  2. `scrollToIndex({ index: i, align: 'start' })` uses item indices and puts row `i`'s top at the sticky header's bottom (±1 px).
  3. `rangeChanged` reports item indices (headers excluded); its `startIndex` may be a row hidden behind the sticky header (1004 or 1005 below).
  4. `scrollToIndex({ groupIndex: g, align: 'start' })` puts group `g`'s first row at the header's bottom with header `g` showing.
  5. `initialTopMostItemIndex: i` (number) is an item index, placed like fact 2.
  6. `offset` shifts the result of fact 2 by exactly `-offset` px.

- [ ] **Step 1: Write the failing route test**

`frontend/src/features/messages/timeline/probeRoute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isTimelineProbeView } from './probeRoute';

describe('isTimelineProbeView', () => {
    it('matches only ?view=timeline-probe', () => {
        expect(isTimelineProbeView('?view=timeline-probe')).toBe(true);
        expect(isTimelineProbeView('?view=timeline-probe&initial=5')).toBe(true);
        expect(isTimelineProbeView('?view=design')).toBe(false);
        expect(isTimelineProbeView('')).toBe(false);
    });
});
```

Run: `npx vitest run src/features/messages/timeline/probeRoute.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the route and the probe page**

`frontend/src/features/messages/timeline/probeRoute.ts`:

```ts
/** Dev-only GroupedVirtuoso probe page (`?view=timeline-probe`), used by e2e/probe. main.tsx gates it behind `import.meta.env.DEV`. */
export function isTimelineProbeView(search: string): boolean {
    return new URLSearchParams(search).get('view') === 'timeline-probe';
}
```

`frontend/src/features/messages/timeline/TimelineProbe.tsx`:

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type IndexLocationWithAlign, type ListRange } from 'react-virtuoso';

const GROUPS = 200;
const PER_GROUP = 10;

interface ProbeWindow extends Window {
    __probe?: { ranges: ListRange[]; scrollToIndex: (location: IndexLocationWithAlign) => void };
}

/**
 * Dev-only harness for e2e/probe/grouped-virtuoso.spec.ts: a fixed-size GroupedVirtuoso
 * (200 groups x 10 rows, rows 60 px, headers 40 px, 600 px tall). `?initial=N` sets
 * initialTopMostItemIndex. Exposes `window.__probe`.
 */
export const TimelineProbe: React.FC = () => {
    const ref = useRef<GroupedVirtuosoHandle>(null);
    const ranges = useRef<ListRange[]>([]);
    const [initial] = useState(() => {
        const value = new URLSearchParams(window.location.search).get('initial');
        return value === null ? undefined : Number(value);
    });
    const groupCounts = useMemo(() => Array.from({ length: GROUPS }, () => PER_GROUP), []);
    useEffect(() => {
        (window as ProbeWindow).__probe = {
            ranges: ranges.current,
            scrollToIndex: (location) => ref.current?.scrollToIndex(location),
        };
    }, []);
    return (
        <div style={{ height: 600, width: 400 }}>
            <GroupedVirtuoso
                ref={ref}
                style={{ height: '100%' }}
                groupCounts={groupCounts}
                initialTopMostItemIndex={initial}
                groupContent={(g) => <div id={`group-${g}`} style={{ height: 40 }}>Group {g}</div>}
                itemContent={(i) => <div id={`row-${i}`} style={{ height: 60 }}>Item {i}</div>}
                rangeChanged={(range) => { ranges.current.push(range); }}
            />
        </div>
    );
};
```

In `frontend/src/shell/main.tsx`, add the import below the `isDesignView` import:

```ts
import { isTimelineProbeView } from '../features/messages/timeline/probeRoute'
```

and add this branch right after the `isDesignView` branch (before `else if (isCallPopupView(…))`):

```tsx
} else if (import.meta.env.DEV && isTimelineProbeView(window.location.search)) {
    // Dev-only GroupedVirtuoso probe (e2e/probe). Dropped from production builds like the design page.
    import('../features/messages/timeline/TimelineProbe').then(({ TimelineProbe }) => {
        root.render(<TimelineProbe />)
    }).catch(() => clientLog('app_load_failed', { error_type: 'timeline_probe' }))
```

- [ ] **Step 3: Run the route test**

Run: `npx vitest run src/features/messages/timeline/probeRoute.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 4: Add the probe Playwright config and keep the main config away from it**

`frontend/playwright.probe.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

// Probes react-virtuoso behaviour on a dev-only page served by the Vite dev server.
// Run: npx playwright test -c playwright.probe.config.ts --reporter=line
export default defineConfig({
  testDir: './e2e/probe',
  use: { baseURL: 'http://localhost:5179' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
})
```

In `frontend/playwright.config.ts`, add below `testDir: './e2e',`:

```ts
  // e2e/probe runs against the Vite dev server: see playwright.probe.config.ts.
  testIgnore: ['**/probe/**'],
```

- [ ] **Step 5: Write the probe spec**

`frontend/e2e/probe/grouped-virtuoso.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'

// Pins how react-virtuoso's GroupedVirtuoso reports ranges and places rows under its
// sticky group header. The D2a chat timeline relies on these facts; a library upgrade
// that changes one fails here first. Probe list: 200 groups x 10 rows (60 px), headers
// 40 px, a 600 px viewport (src/features/messages/timeline/TimelineProbe.tsx).

interface Geometry { headerBottom: number | null; headerText: string | null; rowTop: number | null }

async function open(page: Page, initial?: number) {
  await page.goto(`/?view=timeline-probe${initial === undefined ? '' : `&initial=${initial}`}`)
  await expect(page.locator('[id^="row-"]').first()).toBeVisible({ timeout: 15000 })
}

function geometry(page: Page, rowId: string): Promise<Geometry> {
  return page.evaluate((id) => {
    const scroller = document.querySelector<HTMLElement>('[data-virtuoso-scroller]')!
    const header = scroller.querySelector<HTMLElement>('[data-testid="virtuoso-top-item-list"]')
    const row = document.getElementById(id)
    return {
      headerBottom: header ? header.getBoundingClientRect().bottom : null,
      headerText: header?.textContent ?? null,
      rowTop: row ? row.getBoundingClientRect().top : null,
    }
  }, rowId)
}

/** Distance of the row's top below the sticky header's bottom (null until both exist). */
async function belowHeader(page: Page, rowId: string): Promise<number | null> {
  const g = await geometry(page, rowId)
  return g.rowTop === null || g.headerBottom === null ? null : Math.round(g.rowTop - g.headerBottom)
}

function scrollTo(page: Page, location: Record<string, unknown>) {
  return page.evaluate((loc) => (window as unknown as { __probe: { scrollToIndex: (l: unknown) => void } }).__probe.scrollToIndex(loc), location)
}

function lastRange(page: Page): Promise<{ startIndex: number; endIndex: number }> {
  return page.evaluate(() => {
    const ranges = (window as unknown as { __probe: { ranges: { startIndex: number; endIndex: number }[] } }).__probe.ranges
    return ranges[ranges.length - 1]
  })
}

test.describe('GroupedVirtuoso 4.18 semantics', () => {
  test('1: the sticky group header lives inside the scroller', async ({ page }) => {
    await open(page)
    const g = await geometry(page, 'row-0')
    expect(g.headerBottom).not.toBeNull()
    expect(g.headerText).toBe('Group 0')
  })

  test('2+3: scrollToIndex uses item indices, lands below the header; ranges are item indices', async ({ page }) => {
    await open(page)
    await scrollTo(page, { index: 1005, align: 'start', behavior: 'auto' })
    await expect.poll(() => belowHeader(page, 'row-1005'), { timeout: 3000 }).toBe(0)
    expect((await geometry(page, 'row-1005')).headerText).toBe('Group 100')
    await expect.poll(async () => (await lastRange(page)).startIndex, { timeout: 3000 }).toBeGreaterThanOrEqual(1004)
    const range = await lastRange(page)
    expect(range.startIndex).toBeLessThanOrEqual(1005)
    expect(range.endIndex).toBeGreaterThan(1005)
    expect(range.endIndex).toBeLessThan(2000)
  })

  test('4: scrollToIndex({groupIndex}) lands the group\'s first row below its own header', async ({ page }) => {
    await open(page)
    await scrollTo(page, { groupIndex: 50, align: 'start', behavior: 'auto' })
    await expect.poll(() => belowHeader(page, 'row-500'), { timeout: 3000 }).toBe(0)
    expect((await geometry(page, 'row-500')).headerText).toBe('Group 50')
  })

  test('5: a numeric initialTopMostItemIndex is an item index', async ({ page }) => {
    await open(page, 1005)
    await expect.poll(() => belowHeader(page, 'row-1005'), { timeout: 3000 }).toBe(0)
  })

  test('6: offset shifts the landing by -offset px', async ({ page }) => {
    await open(page)
    await scrollTo(page, { index: 1005, align: 'start', behavior: 'auto', offset: -300 })
    await expect.poll(() => belowHeader(page, 'row-1005'), { timeout: 3000 }).toBe(300)
  })
})
```

- [ ] **Step 6: Run the probe**

Run: `npx playwright test -c playwright.probe.config.ts --reporter=line`
Expected: 5 passed.

If any test fails, **STOP and report the measured numbers to the controller** instead of adapting the app: Tasks 5–6 assume facts 1–6. (For example, if facts 2/4/5 fail by exactly the header height, Virtuoso does not offset for the sticky header and the jump location builder in Task 5 needs an explicit `offset`; that is a design decision for the controller.)

- [ ] **Step 7: Confirm the main e2e config still ignores the probe**

Run: `npx playwright test --list --reporter=line | grep -c probe || true`
Expected: `0`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/messages/timeline/probeRoute.ts frontend/src/features/messages/timeline/probeRoute.test.ts frontend/src/features/messages/timeline/TimelineProbe.tsx frontend/src/shell/main.tsx frontend/playwright.probe.config.ts frontend/playwright.config.ts frontend/e2e/probe/grouped-virtuoso.spec.ts
uv run git commit -m "test(chat): probe GroupedVirtuoso ranges and sticky headers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Move the jump machinery onto the timeline model and row keys

Still on plain `Virtuoso` (the swap is Task 6), with `data = timeline.items` and no letters yet. Every e2e test from Task 1 stays green and nothing changes visually.

**Files:**
- Modify: `frontend/src/features/messages/timeline/jumpTarget.ts` (full replacement) + `jumpTarget.test.ts` (full replacement)
- Modify: `frontend/src/features/messages/timeline/landing.ts` (full replacement) + `landing.test.ts` (full replacement)
- Modify: `frontend/src/features/messages/hooks/useTimelineJump.ts` (full replacement) + `useTimelineJump.test.ts` (edits)
- Modify: `frontend/src/features/messages/hooks/useLandingHighlight.ts` + `useLandingHighlight.test.ts`
- Modify: `frontend/src/features/messages/hooks/useChatScroll.ts` (full replacement) + `useChatScroll.test.ts` (full replacement)
- Create: `frontend/src/features/messages/utils/nickname.ts` + `nickname.test.ts`
- Modify: `frontend/src/features/messages/components/MessageList.tsx` (full replacement) + `MessageList.jump.test.tsx`, `MessageList.range.test.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`

**Interfaces:**
- Consumes: `Timeline`, `RowKey`, `buildTimeline`, `Letter` (Task 3); probe facts 1–3 and 6 (Task 4).
- Produces:
  - `type JumpTarget = … | { kind: 'letter'; id: number }`; `interface ResolvedJump { index: number; rowKey: RowKey; align: JumpAlign; highlight: boolean; verify: boolean; groupIndex?: number }`; `resolveJump(timeline: Timeline, target, isUnread): ResolvedJump | null`; `firstUnreadIndex(timeline, isUnread): number`; `jumpTargetCode(target)` (adds `'letter'`).
  - `stickyHeaderBottom(scroller: HTMLElement): number`; `measureLanding(rowKey: RowKey, align): number | null`; `topVisibleRowIndex(scroller: HTMLElement | null, range: {startIndex; endIndex}, rowKeyAt: (i: number) => RowKey | null): number`.
  - `interface TimelineHandle { scrollToIndex(location: IndexLocationWithAlign | number): void }`; `useTimelineJump({ virtuosoRef, timeline, isUnread, onLanded?: (rowKey: RowKey) => void, resetKey?, getScroller?, visibleRange?, deps? })` → `jumpTo`.
  - `useLandingHighlight(resetKey) → { highlightedRowKey: RowKey | null; flash(rowKey: RowKey) }`.
  - `useChatScroll(memberId, timeline, topVisibleIndex?) → { initialTopMostItemIndex, handleRangeChanged, savePositionImmediate }`.
  - `applyNickname(messages: Message[], nickname: string | undefined): Message[]`.
  - `MessageList` props: `timeline` (replaces `messages`), `highlightedRowKey` (replaces `highlightedMessageId`), `renderLetter?: (letter: Letter) => React.ReactNode`.

- [ ] **Step 1: Write the failing resolver tests**

Full replacement of `frontend/src/features/messages/timeline/jumpTarget.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import type { Letter } from '../letters';
import { toLocalDateStr } from '../../../utils/dateFormatters';
import { buildTimeline } from './buildTimeline';
import { resolveJump, jumpTargetCode, firstUnreadIndex } from './jumpTarget';

const msg = (id: number, timestamp: string): Message => ({ id, timestamp, type: 'text', is_favorite: false, content: `m${id}` });
const letter = (id: number, created_at: string): Letter => ({ id, text: '', created_at, image_url: null, width: null, height: null });
// Rows: msg-10, msg-11, letter-12, msg-12, msg-13 (letter 12 and message 12 share an id).
const timeline = buildTimeline(
    [msg(10, '2022-01-14T10:00:00Z'), msg(11, '2022-01-15T10:00:00Z'), msg(12, '2022-01-15T11:00:00Z'), msg(13, '2026-11-03T10:00:00Z')],
    [letter(12, '2022-01-15T10:30:00Z')],
);
const none = () => false;
const dayOf = (i: number) => {
    const item = timeline.items[i];
    return toLocalDateStr(item.kind === 'message' ? item.message.timestamp : item.letter.created_at);
};

describe('resolveJump', () => {
    it('finds a message by id, aligned start and highlighted by default', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 11 }, none))
            .toEqual({ index: 1, rowKey: 'msg-11', align: 'start', highlight: true, verify: true });
    });

    it('keeps message and letter ids apart', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 12 }, none)?.rowKey).toBe('msg-12');
        expect(resolveJump(timeline, { kind: 'letter', id: 12 }, none))
            .toEqual({ index: 2, rowKey: 'letter-12', align: 'start', highlight: true, verify: true });
    });

    it('keeps an explicit centre alignment for a message', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 12, align: 'center' }, none)?.align).toBe('center');
    });

    it('returns null for unknown ids', () => {
        expect(resolveJump(timeline, { kind: 'message', id: 99 }, none)).toBeNull();
        expect(resolveJump(timeline, { kind: 'letter', id: 99 }, none)).toBeNull();
    });

    it('finds the first row of a local date', () => {
        const date = dayOf(1);
        const expected = timeline.items.findIndex((_, i) => dayOf(i) === date);
        const r = resolveJump(timeline, { kind: 'date', date }, none);
        expect(r?.index).toBe(expected);
        expect(r?.rowKey).toBe(timeline.rowKeyAt(expected));
        expect(r?.highlight).toBe(true);
    });

    it('returns null for a date without rows', () => {
        expect(resolveJump(timeline, { kind: 'date', date: '2023-06-01' }, none)).toBeNull();
    });

    it('first unread skips letters, is centred and not highlighted', () => {
        expect(resolveJump(timeline, { kind: 'firstUnread' }, (id) => id >= 12))
            .toEqual({ index: 3, rowKey: 'msg-12', align: 'center', highlight: false, verify: true });
        expect(firstUnreadIndex(timeline, (id) => id >= 12)).toBe(3);
        expect(firstUnreadIndex(timeline, none)).toBe(-1);
    });

    it('top and bottom skip verification and highlight', () => {
        expect(resolveJump(timeline, { kind: 'top' }, none))
            .toEqual({ index: 0, rowKey: 'msg-10', align: 'start', highlight: false, verify: false });
        expect(resolveJump(timeline, { kind: 'bottom' }, none))
            .toEqual({ index: 4, rowKey: 'msg-13', align: 'end', highlight: false, verify: false });
    });

    it('returns null for every kind on an empty timeline', () => {
        const empty = buildTimeline([], []);
        for (const t of [{ kind: 'top' }, { kind: 'bottom' }, { kind: 'firstUnread' }] as const) {
            expect(resolveJump(empty, t, () => true)).toBeNull();
        }
    });
});

describe('jumpTargetCode', () => {
    it('maps kinds to log-safe snake_case codes', () => {
        expect(jumpTargetCode({ kind: 'firstUnread' })).toBe('first_unread');
        expect(jumpTargetCode({ kind: 'message', id: 1 })).toBe('message');
        expect(jumpTargetCode({ kind: 'letter', id: 1 })).toBe('letter');
        expect(jumpTargetCode({ kind: 'date', date: '2022-01-15' })).toBe('date');
    });
});
```

Full replacement of `frontend/src/features/messages/timeline/landing.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { landingError, measureLanding, stickyHeaderBottom, topVisibleRowIndex, LANDING_TOLERANCE_PX } from './landing';

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

describe('DOM measurement', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    /** A scroller (top 100) with rows `msg-1..3` at the given tops (50 px tall) and an optional sticky header. */
    function mount(rowTops: number[], headerBottom?: number) {
        const header = headerBottom === undefined ? '' : '<div data-testid="virtuoso-top-item-list" id="h"></div>';
        const rows = rowTops.map((_, i) => `<div id="msg-${i + 1}"></div>`).join('');
        document.body.innerHTML = `<div data-virtuoso-scroller="true" id="s">${header}${rows}</div>`;
        const s = document.getElementById('s')!;
        s.getBoundingClientRect = () => ({ top: 100, bottom: 700 } as DOMRect);
        Object.defineProperties(s, {
            scrollTop: { value: 500, configurable: true },
            clientHeight: { value: 600, configurable: true },
            scrollHeight: { value: 5000, configurable: true },
        });
        if (headerBottom !== undefined) {
            document.getElementById('h')!.getBoundingClientRect = () => ({ top: 100, bottom: headerBottom, height: headerBottom - 100 } as DOMRect);
        }
        rowTops.forEach((top, i) => {
            document.getElementById(`msg-${i + 1}`)!.getBoundingClientRect = () => ({ top, bottom: top + 50 } as DOMRect);
        });
        return s;
    }

    it('measureLanding returns null when the row is not rendered', () => {
        expect(measureLanding('msg-42', 'start')).toBeNull();
    });

    it('measureLanding measures the rendered row against its scroller', () => {
        mount([112]);
        expect(measureLanding('msg-1', 'start')).toBe(12);
    });

    it('start lands below the sticky header; center ignores it', () => {
        mount([152], 140);
        expect(stickyHeaderBottom(document.getElementById('s')!)).toBe(140);
        expect(measureLanding('msg-1', 'start')).toBe(12);
        expect(measureLanding('msg-1', 'center')).toBe(152 + 25 - 400);
    });

    it('topVisibleRowIndex skips rows hidden behind the sticky header', () => {
        const s = mount([90, 140, 190], 140);
        const keyAt = (i: number) => (i < 3 ? (`msg-${i + 1}` as const) : null);
        expect(topVisibleRowIndex(s, { startIndex: 0, endIndex: 2 }, keyAt)).toBe(1);
    });

    it('topVisibleRowIndex falls back to the range start', () => {
        expect(topVisibleRowIndex(null, { startIndex: 4, endIndex: 9 }, () => null)).toBe(4);
        const s = mount([]);
        expect(topVisibleRowIndex(s, { startIndex: 2, endIndex: 3 }, () => 'msg-9')).toBe(2);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/features/messages/timeline/jumpTarget.test.ts src/features/messages/timeline/landing.test.ts`
Expected: FAIL (`resolveJump` takes messages; `stickyHeaderBottom` / `topVisibleRowIndex` not exported).

- [ ] **Step 3: Implement the resolver on the model**

Full replacement of `frontend/src/features/messages/timeline/jumpTarget.ts`:

```ts
import type { RowKey, Timeline } from './buildTimeline';

/** Where the target row should sit in the viewport after a jump. */
export type JumpAlign = 'start' | 'center' | 'end';

/** Every way the chat timeline can be jumped. `date` is a local YYYY-MM-DD (toLocalDateStr). */
export type JumpTarget =
    | { kind: 'message'; id: number; align?: 'start' | 'center' }
    | { kind: 'letter'; id: number }
    | { kind: 'date'; date: string }
    | { kind: 'firstUnread' }
    | { kind: 'top' }
    | { kind: 'bottom' };

export interface ResolvedJump {
    /** Item index in the timeline (group headers not counted). */
    index: number;
    /** The row's DOM id and highlight key; corrections re-find the row by it. */
    rowKey: RowKey;
    align: JumpAlign;
    /** Flash the landed row (message, letter and date jumps). */
    highlight: boolean;
    /** Measure and correct after landing (skipped for top/bottom, which Virtuoso lands exactly). */
    verify: boolean;
    /** Set for date jumps once the list is grouped: scroll to the day's group (GroupedVirtuoso `groupIndex`). */
    groupIndex?: number;
}

/** Index of the first unread message row; letters are never unread. -1 when nothing is unread. */
export function firstUnreadIndex(timeline: Timeline, isUnread: (id: number) => boolean): number {
    return timeline.items.findIndex((item) => item.kind === 'message' && isUnread(item.message.id));
}

function at(timeline: Timeline, index: number, align: JumpAlign, highlight: boolean, verify: boolean): ResolvedJump | null {
    const rowKey = index < 0 ? null : timeline.rowKeyAt(index);
    return rowKey === null ? null : { index, rowKey, align, highlight, verify };
}

/** Resolve a jump target to a timeline row, or null when there is nothing to jump to. */
export function resolveJump(
    timeline: Timeline,
    target: JumpTarget,
    isUnread: (id: number) => boolean,
): ResolvedJump | null {
    switch (target.kind) {
        case 'message':
            return at(timeline, timeline.indexOfMessage(target.id), target.align ?? 'start', true, true);
        case 'letter':
            return at(timeline, timeline.indexOfLetter(target.id), 'start', true, true);
        case 'date':
            return at(timeline, timeline.indexOfDate(target.date), 'start', true, true);
        case 'firstUnread':
            return at(timeline, firstUnreadIndex(timeline, isUnread), 'center', false, true);
        case 'top':
            return at(timeline, 0, 'start', false, false);
        case 'bottom':
            return at(timeline, timeline.items.length - 1, 'end', false, false);
    }
}

/** Log-safe code for a target kind (the client-log whitelist only takes [a-z0-9_]). */
export function jumpTargetCode(target: JumpTarget): 'message' | 'letter' | 'date' | 'first_unread' | 'top' | 'bottom' {
    return target.kind === 'firstUnread' ? 'first_unread' : target.kind;
}
```

- [ ] **Step 4: Implement header-aware landing**

Full replacement of `frontend/src/features/messages/timeline/landing.ts`:

```ts
import type { JumpAlign } from './jumpTarget';
import type { RowKey } from './buildTimeline';

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

/**
 * Bottom edge (viewport px) of GroupedVirtuoso's sticky group header inside `scroller`, or the
 * scroller's top when there is none. Rows above it are hidden, and `align: 'start'` lands a row
 * right below it (probe facts 1-2, e2e/probe/grouped-virtuoso.spec.ts).
 */
export function stickyHeaderBottom(scroller: HTMLElement): number {
    const top = scroller.getBoundingClientRect().top;
    const header = scroller.querySelector<HTMLElement>('[data-testid="virtuoso-top-item-list"]');
    return header ? Math.max(top, header.getBoundingClientRect().bottom) : top;
}

/**
 * Measure the rendered row `rowKey` against its Virtuoso scroller; null when not rendered.
 * `start` is measured from the sticky header's bottom edge, `center` and `end` from the scroller.
 */
export function measureLanding(rowKey: RowKey, align: JumpAlign): number | null {
    const row = document.getElementById(rowKey);
    const scroller = row?.closest<HTMLElement>('[data-virtuoso-scroller]');
    if (!row || !scroller) return null;
    const atTop = scroller.scrollTop <= 0;
    // The - 1 is slack for fractional scrollTop values on HiDPI screens.
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const box = scroller.getBoundingClientRect();
    const view = { top: align === 'start' ? stickyHeaderBottom(scroller) : box.top, bottom: box.bottom };
    return landingError(row.getBoundingClientRect(), view, { atTop, atBottom }, align);
}

/**
 * The first row of `range` the user can actually see: Virtuoso's range may start with a row
 * hidden behind the sticky header (probe fact 3). Falls back to `range.startIndex`.
 */
export function topVisibleRowIndex(
    scroller: HTMLElement | null,
    range: { startIndex: number; endIndex: number },
    rowKeyAt: (index: number) => RowKey | null,
): number {
    if (!scroller) return range.startIndex;
    const edge = stickyHeaderBottom(scroller) + 1;
    for (let i = range.startIndex; i <= range.endIndex; i += 1) {
        const key = rowKeyAt(i);
        const el = key ? document.getElementById(key) : null;
        if (el && el.getBoundingClientRect().bottom > edge) return i;
    }
    return range.startIndex;
}
```

- [ ] **Step 5: Run the resolver and landing tests**

Run: `npx vitest run src/features/messages/timeline/jumpTarget.test.ts src/features/messages/timeline/landing.test.ts`
Expected: PASS.

- [ ] **Step 6: Move the jump hook onto the model**

Full replacement of `frontend/src/features/messages/hooks/useTimelineJump.ts`:

```ts
import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import type { IndexLocationWithAlign } from 'react-virtuoso';
import { clientLog } from '../../../utils/clientLog';
import { bezierEasing, motion } from '../../../design/tokens/motion';
import { glideScroll, waitUntilStill } from '../timeline/glide';
import { jumpTargetCode, resolveJump, type JumpAlign, type JumpTarget } from '../timeline/jumpTarget';
import { LANDING_TOLERANCE_PX, measureLanding } from '../timeline/landing';
import type { RowKey, Timeline } from '../timeline/buildTimeline';

export type JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled';

/** Extra scrollToIndex calls after the first one when the row lands off target. */
export const MAX_CORRECTIONS = 2;
/** Frames to wait for the target row to render, per wait cycle (~1 s at 60 fps). */
export const MAX_WAIT_FRAMES = 60;
/** Frames to let heights settle after the row renders, before measuring. */
export const SETTLE_FRAMES = 2;
/** A far jump first lands this fraction of the viewport height short of the target, then glides in. */
export const GLIDE_LEAD = 0.8;
/**
 * react-virtuoso (4.18) re-issues a scrollToIndex each time row heights change, until
 * they have been still for this long; a glide started inside that window is snapped
 * back to the lead-in point. Its value mirrors the library's internal window.
 */
export const VIRTUOSO_RETRY_MS = 150;
/**
 * Stillness required before a far jump starts gliding: one 16 ms frame past Virtuoso's
 * internal retry window (VIRTUOSO_RETRY_MS), so a retry that lands right at the window's
 * edge is still seen as movement.
 */
export const STILLNESS_MS = VIRTUOSO_RETRY_MS + 16;
/** Targets estimated within this many viewport heights glide from where the list is, without a lead-in. */
export const CLOSE_VIEWPORTS = 2;
/**
 * A close glide is planned this many times as far as estimated. Planning long is safe (the
 * glide homes in on the row as soon as it renders and stops there); planning short leaves
 * the row off screen and ends in an instant snap.
 */
export const CLOSE_PLAN_FACTOR = 2;

/**
 * Rough signed distance (px) to scroll so that row `index`, outside the visible `range`,
 * sits at `align`; 0 when it is inside the range. Rows off screen are assumed to be as
 * tall as the visible ones on average. Only used to choose and start a glide; the glide
 * homes in on the measured row once it renders.
 */
export function estimateTravel(
    index: number,
    align: JumpAlign,
    range: { startIndex: number; endIndex: number },
    viewport: number,
): number {
    if (index >= range.startIndex && index <= range.endIndex) return 0;
    const row = viewport / Math.max(1, range.endIndex - range.startIndex + 1);
    // Where the row ends up: 0 at the top of the viewport, 1 at the bottom.
    const at = align === 'start' ? 0 : align === 'center' ? 0.5 : 1;
    if (index > range.endIndex) return (index - range.endIndex - 1) * row + (1 - at) * (viewport - row) + row;
    return -((range.startIndex - index) * row + at * (viewport - row));
}

/** Which branch of the jump ran; logged as the `path` breadcrumb field. */
export type JumpPath =
    | 'instant' | 'onscreen' | 'onscreen_snap' | 'close' | 'close_snap' | 'far' | 'far_unsettled' | 'none';

/** What the hook needs from the list; Virtuoso's and GroupedVirtuoso's handles both fit. */
export interface TimelineHandle {
    scrollToIndex(location: IndexLocationWithAlign | number): void;
}

export interface JumpDeps {
    nextFrame: () => Promise<void>;
    measure: (rowKey: RowKey, align: JumpAlign) => number | null;
    now: () => number;
    reducedMotion: () => boolean;
}

const defaultDeps: JumpDeps = {
    nextFrame: () => new Promise(resolve => requestAnimationFrame(() => resolve())),
    measure: measureLanding,
    now: () => performance.now(),
    reducedMotion: () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
};

const glideEase = bezierEasing(motion.easing.standard);

export interface UseTimelineJumpArgs {
    virtuosoRef: React.RefObject<TimelineHandle | null>;
    /** The one index source: the first scroll and every correction take their index from it. */
    timeline: Timeline;
    isUnread: (id: number) => boolean;
    /** Called with the landed row key for highlighted jumps (message, letter, date). */
    onLanded?: (rowKey: RowKey) => void;
    /** Changing this value cancels any in-flight jump (e.g. the selected room). */
    resetKey?: unknown;
    /** The list's scroll element; without it (or with reduced motion) jumps are instant. */
    getScroller?: () => HTMLElement | null;
    /**
     * The rendered row range (item indices), to tell on-screen targets from far ones and the
     * direction of travel. Omitted, or returning null/undefined (unknown, e.g. right after a
     * room switch), the jump is instant.
     */
    visibleRange?: () => { startIndex: number; endIndex: number } | null | undefined;
    /** Test seam: frame scheduler, DOM measurement, clock and reduced-motion preference. */
    deps?: Partial<JumpDeps>;
}

/**
 * One way to jump the chat timeline. The target is resolved on the `Timeline` model to an
 * item index and a row key (`msg-<id>` / `letter-<id>`). With a scroller and motion allowed,
 * the list glides (motion.duration.glide, homing in on the target row once it renders):
 * - a target already on screen glides straight into place;
 * - a close one (estimateTravel within CLOSE_VIEWPORTS) glides from where the list is;
 * - a far one is first reached with an instant scrollToIndex that lands GLIDE_LEAD
 *   viewports short of it in the direction of travel; once Virtuoso has stopped
 *   re-scrolling that lead-in (STILLNESS_MS still, at most MAX_WAIT_FRAMES) it
 *   glides the rest of the way, or scrolls instantly if heights never settle.
 * If an on-screen target cannot be measured, or a close glide ends without the row
 * rendered, the jump snaps there with an instant scrollToIndex instead. A far lead-in
 * shrinks, possibly to zero (no glide at all), near the list's bottom edge, because
 * Virtuoso clamps the offset to the scroll range; the jump still lands. Wheel or touch
 * input during a glide is overridden: the glide keeps writing scrollTop until it ends.
 * Without a scroller, with prefers-reduced-motion, or with an unknown visible range
 * (no `visibleRange`, or it returns null), one instant scrollToIndex.
 * A resolved `groupIndex` (date jumps on a grouped list) scrolls to that day's group;
 * otherwise to the row's index.
 * Then wait for the target row to render, measure it (`start` below the sticky date
 * header) and correct up to MAX_CORRECTIONS times with instant scrolls (Virtuoso estimates
 * heights it has not measured, so a far jump can land a little off). Each correction
 * re-finds the row's current index by its row key, so a refetch that shifts rows is followed.
 *
 * A jump ends 'cancelled' (also mid-glide) when a newer jump starts, the hook
 * unmounts, `resetKey` changes (the caller switches room), or the target row is
 * no longer in the timeline while it cannot be measured or before a correction.
 *
 * Worst case, after the move (a lead-in wait of at most MAX_WAIT_FRAMES plus one
 * glide), a jump runs (2 * MAX_CORRECTIONS + 1) wait cycles of up to
 * MAX_WAIT_FRAMES + SETTLE_FRAMES frames each: corrections and cycles whose row
 * vanished after settling (while still in the timeline) are counted separately, each
 * at most MAX_CORRECTIONS, plus the final cycle. It then ends 'gave_up'. Every jump
 * logs exactly one `timeline_jump` breadcrumb (including which `path` ran) with no
 * message text or names.
 */
export function useTimelineJump({
    virtuosoRef, timeline, isUnread, onLanded, resetKey, getScroller, visibleRange, deps,
}: UseTimelineJumpArgs) {
    const latest = useRef({ timeline, isUnread, onLanded, getScroller, visibleRange });
    latest.current = { timeline, isUnread, onLanded, getScroller, visibleRange };
    const depsRef = useRef<JumpDeps>({ ...defaultDeps, ...deps });
    depsRef.current = { ...defaultDeps, ...deps };
    const tokenRef = useRef(0);

    // Cleanup runs on unmount and whenever resetKey changes: both cancel in-flight jumps.
    useEffect(() => () => { tokenRef.current += 1; }, [resetKey]);

    return useCallback(async (target: JumpTarget): Promise<JumpOutcome> => {
        const token = ++tokenRef.current;
        const { nextFrame, measure, now, reducedMotion } = depsRef.current;
        const started = now();
        const resolved = resolveJump(latest.current.timeline, target, latest.current.isUnread);

        // Which branch ran, for the breadcrumb; 'none' until a scroll has been chosen.
        let path: JumpPath = 'none';
        const finish = (outcome: JumpOutcome, index: number, corrections: number): JumpOutcome => {
            clientLog('timeline_jump', {
                target: jumpTargetCode(target),
                index,
                corrections,
                outcome,
                path,
                jump_ms: Math.round(now() - started),
            });
            return outcome;
        };

        if (!resolved) return finish('not_found', -1, 0);
        const first = virtuosoRef.current;
        if (!first) return finish('gave_up', resolved.index, 0);

        const scroller = latest.current.getScroller?.() ?? null;
        const range = latest.current.visibleRange?.() ?? null;
        const isCancelled = () => token !== tokenRef.current;
        /** Scroll location of row `index`: its day's group for a grouped date jump, else the row itself. */
        const locate = (index: number, offset?: number): IndexLocationWithAlign => {
            const base = { align: resolved.align, behavior: 'auto' as const, ...(offset ? { offset } : {}) };
            return resolved.groupIndex !== undefined
                ? { ...base, groupIndex: latest.current.timeline.groupOfIndex(index) }
                : { ...base, index };
        };
        // The glide homes in on the target row as soon as it is rendered and measurable.
        const aim = () => measure(resolved.rowKey, resolved.align);
        const glide = (el: HTMLElement, delta: number) =>
            glideScroll(el, delta, motion.duration.glide, glideEase, isCancelled, { nextFrame, now }, aim);
        // An exact, instant scroll to the target (the checks below verify it).
        const snap = (): boolean => {
            const handle = virtuosoRef.current;
            handle?.scrollToIndex(locate(resolved.index));
            return !!handle;
        };
        const travel = scroller && range ? estimateTravel(resolved.index, resolved.align, range, scroller.clientHeight) : null;

        if (scroller === null || travel === null || reducedMotion()) {
            path = 'instant';
            first.scrollToIndex(locate(resolved.index));
        } else if (travel === 0) {
            // Already on screen: glide straight to the aligned position.
            path = 'onscreen';
            const error = measure(resolved.rowKey, resolved.align);
            if (error === null) {
                path = 'onscreen_snap';
                first.scrollToIndex(locate(resolved.index));
            } else if (!(await glide(scroller, error))) return finish('cancelled', resolved.index, 0);
        } else if (Math.abs(travel) <= CLOSE_VIEWPORTS * scroller.clientHeight) {
            // Close: glide from here toward the estimate; a lead-in could land on the wrong side.
            path = 'close';
            if (!(await glide(scroller, travel * CLOSE_PLAN_FACTOR))) return finish('cancelled', resolved.index, 0);
            if (aim() === null) {
                path = 'close_snap';
                if (!snap()) return finish('gave_up', resolved.index, 0);
            }
        } else {
            // Far: land GLIDE_LEAD viewports short of the target in the direction of travel, then glide in.
            path = 'far';
            const dir = Math.sign(travel);
            const lead = Math.round(scroller.clientHeight * GLIDE_LEAD);
            first.scrollToIndex(locate(resolved.index, -dir * lead));
            // Virtuoso re-scrolls to the lead-in while row heights change: wait until it is
            // still, or the glide would be snapped back.
            const leadIn = await waitUntilStill(scroller, STILLNESS_MS, SETTLE_FRAMES, MAX_WAIT_FRAMES, isCancelled, { nextFrame, now });
            if (leadIn === 'cancelled') return finish('cancelled', resolved.index, 0);
            if (leadIn === 'still') {
                if (!(await glide(scroller, dir * lead))) return finish('cancelled', resolved.index, 0);
            } else {
                path = 'far_unsettled';
                // Heights never settled: scroll exactly; the list may be gone.
                if (!snap()) return finish('gave_up', resolved.index, 0);
            }
        }
        if (!resolved.verify) return finish('landed', resolved.index, 0);

        let index = resolved.index;
        let corrections = 0;
        // Wait cycles that ended with the row vanished after settling. Each one consumes a
        // cycle; more than MAX_CORRECTIONS of them ends the jump, so the loop is bounded.
        let vanished = 0;
        const removed = () => latest.current.timeline.indexOfRowKey(resolved.rowKey) < 0;
        for (;;) {
            let error: number | null = null;
            for (let frame = 0; frame < MAX_WAIT_FRAMES && error === null; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', index, corrections);
                error = measure(resolved.rowKey, resolved.align);
                if (error === null && removed()) return finish('cancelled', index, corrections);
            }
            if (error === null) return finish('gave_up', index, corrections);
            for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
                await nextFrame();
                if (token !== tokenRef.current) return finish('cancelled', index, corrections);
            }
            const settled = measure(resolved.rowKey, resolved.align);
            if (settled === null) {
                if (removed()) return finish('cancelled', index, corrections);
                vanished += 1;
                if (vanished > MAX_CORRECTIONS) return finish('gave_up', index, corrections);
                continue;
            }
            if (Math.abs(settled) <= LANDING_TOLERANCE_PX) {
                if (resolved.highlight) latest.current.onLanded?.(resolved.rowKey);
                return finish('landed', index, corrections);
            }
            if (corrections >= MAX_CORRECTIONS) return finish('gave_up', index, corrections);
            // Rows may have shifted since the first scroll: re-find the row by key, never reuse the index.
            const fresh = latest.current.timeline.indexOfRowKey(resolved.rowKey);
            if (fresh < 0) return finish('cancelled', index, corrections);
            index = fresh;
            const handle = virtuosoRef.current;
            if (!handle) return finish('gave_up', index, corrections);
            corrections += 1;
            handle.scrollToIndex(locate(index));
        }
    }, [virtuosoRef]);
}
```

- [ ] **Step 7: Adapt the hook tests to the model and row keys**

In `frontend/src/features/messages/hooks/useTimelineJump.test.ts` (run from `frontend/`):

```bash
f=src/features/messages/hooks/useTimelineJump.test.ts
sed -i "s|^import { toLocalDateStr } from '../../../utils/dateFormatters';|import { toLocalDateStr } from '../../../utils/dateFormatters';\nimport { buildTimeline } from '../timeline/buildTimeline';\nimport type { Letter } from '../letters';|" $f
sed -i "s|        messages: list,|        timeline: buildTimeline(list, opts.letters ?? []),|" $f
sed -i -E "s/onLanded\)\.toHaveBeenCalledWith\(([0-9]+)\)/onLanded).toHaveBeenCalledWith('msg-\1')/" $f
grep -n "toHaveBeenCalledWith('msg-" $f
```

Expected: five lines (`'msg-2'`, `'msg-3'`, `'msg-151'`, `'msg-51'`, `'msg-2'`). Then:

(a) In `interface SetupOpts`, add below `list?: readonly Message[];`:

```ts
    /** Letters merged into the timeline (default: none). */
    letters?: readonly Letter[];
```

(b) Append inside `describe('useTimelineJump', …)`, after the `'cancels an in-flight jump when resetKey changes (room switch)'` test:

```ts
    it('jumps to a letter by its row key, never to a message with the same id', async () => {
        const letters: Letter[] = [{ id: 2, text: '', created_at: '2024-03-15T02:00:00Z', image_url: null, width: null, height: null }];
        const { jumpTo, scrollToIndex, onLanded } = setup([0], { letters });
        // Rows: msg-1, msg-2, letter-2, msg-3
        await expect(jumpTo({ kind: 'letter', id: 2 })).resolves.toBe('landed');
        expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'start', behavior: 'auto' });
        expect(onLanded).toHaveBeenCalledWith('letter-2');
        expect(clientLog).toHaveBeenCalledWith('timeline_jump', expect.objectContaining({ target: 'letter', outcome: 'landed' }));
    });

    it('measures by row key', async () => {
        const { jumpTo, measure } = setup([0]);
        await jumpTo({ kind: 'message', id: 3 });
        expect(measure).toHaveBeenCalledWith('msg-3', 'start');
    });
```

The `measure` mock in `setup` can keep its zero-argument signature: a function with fewer parameters still fits `JumpDeps.measure`, and `toHaveBeenCalledWith` does not depend on it.

- [ ] **Step 8: Highlight by row key**

Full replacement of `frontend/src/features/messages/hooks/useLandingHighlight.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from '../../../design/tokens/motion';
import type { RowKey } from '../timeline/buildTimeline';

/**
 * The landed-row highlight: `flash(rowKey)` sets `highlightedRowKey` on the next animation
 * frame and clears it after `motion.duration.landing`. Clearing first and re-setting on the
 * next frame restarts the CSS animation when the same row lands twice in a row. A change of
 * `resetKey` (the selected room) or an unmount cancels the pending frame and timer; a
 * `resetKey` change also clears the highlight. Rows are keyed `msg-<id>` / `letter-<id>`.
 */
export function useLandingHighlight(resetKey: unknown) {
    const [highlightedRowKey, setHighlightedRowKey] = useState<RowKey | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const frameRef = useRef<number | null>(null);
    const cancel = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        timerRef.current = null;
        frameRef.current = null;
    }, []);
    const flash = useCallback((rowKey: RowKey) => {
        cancel();
        setHighlightedRowKey(null);
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            setHighlightedRowKey(rowKey);
            timerRef.current = setTimeout(() => setHighlightedRowKey(null), motion.duration.landing);
        });
    }, [cancel]);
    useEffect(() => cancel, [cancel]);
    useEffect(() => {
        cancel();
        setHighlightedRowKey(null);
    }, [resetKey, cancel]);
    return { highlightedRowKey, flash };
}
```

Update its test:

```bash
f=src/features/messages/hooks/useLandingHighlight.test.ts
sed -i -e "s/highlightedMessageId/highlightedRowKey/g" -e "s/flash(7)/flash('msg-7')/g" -e "s/flash(8)/flash('letter-8')/g" -e "s/toBe(7)/toBe('msg-7')/g" -e "s/toBe(8)/toBe('letter-8')/g" $f
```

and rename the first test to `'sets the row key on the next animation frame, not synchronously'`.

- [ ] **Step 9: Run the hook tests**

Run: `npx vitest run src/features/messages/hooks/useTimelineJump.test.ts src/features/messages/hooks/useLandingHighlight.test.ts`
Expected: PASS (all previous tests plus the 2 new ones).

- [ ] **Step 10: Commit the jump machinery**

```bash
git add frontend/src/features/messages/timeline/jumpTarget.ts frontend/src/features/messages/timeline/jumpTarget.test.ts frontend/src/features/messages/timeline/landing.ts frontend/src/features/messages/timeline/landing.test.ts frontend/src/features/messages/hooks/useTimelineJump.ts frontend/src/features/messages/hooks/useTimelineJump.test.ts frontend/src/features/messages/hooks/useLandingHighlight.ts frontend/src/features/messages/hooks/useLandingHighlight.test.ts
uv run git commit -m "refactor(chat): resolve jumps on the timeline model by row key" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`tsc` is red between this commit and Step 16 because `MessagesFeature` still passes `messages`; that is expected inside this task.)

- [ ] **Step 11: Write the failing restore and nickname tests**

Full replacement of `frontend/src/features/messages/hooks/useChatScroll.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ListRange } from 'react-virtuoso'
import { useChatScroll } from './useChatScroll'
import type { Message } from '../../../types'
import type { Letter } from '../letters'
import { buildTimeline } from '../timeline/buildTimeline'
import { persisted } from '../../../core/persistence/persisted'

const T0 = Date.UTC(2024, 0, 15, 10, 0)
const message = (id: number): Message => ({
  id, timestamp: new Date(T0 + id * 60_000).toISOString(), type: 'text', is_favorite: false, content: `Message ${id}`,
})
const letter = (id: number, minutes: number): Letter => ({
  id, text: '', created_at: new Date(T0 + minutes * 60_000).toISOString(), image_url: null, width: null, height: null,
})
const timelineOf = (ids: number[], letters: Letter[] = []) => buildTimeline(ids.map(message), letters)

describe('useChatScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    vi.spyOn(persisted, 'getConv').mockReturnValue({})
    vi.spyOn(persisted, 'setConv').mockImplementation(() => {})
    vi.spyOn(persisted, 'setConvBeacon').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('opens a new room at the last row', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([1, 2, 3])))
    expect(result.current.initialTopMostItemIndex).toBe(2)
  })

  it('restores the saved message by id', () => {
    vi.mocked(persisted.getConv).mockReturnValue({ value: '102' })
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    expect(result.current.initialTopMostItemIndex).toBe(1)
  })

  it('restores to the message row when letters come before it', () => {
    vi.mocked(persisted.getConv).mockReturnValue({ value: '102' })
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103], [letter(7, 50)])))
    // letter-7, msg-101, msg-102, msg-103
    expect(result.current.initialTopMostItemIndex).toBe(2)
  })

  it('falls back to the bottom for an unknown id, and to 0 for an empty room', () => {
    vi.mocked(persisted.getConv).mockReturnValue({ value: '999' })
    expect(renderHook(() => useChatScroll('room-1', timelineOf([1, 2, 3]))).result.current.initialTopMostItemIndex).toBe(2)
    expect(renderHook(() => useChatScroll('room-1', timelineOf([]))).result.current.initialTopMostItemIndex).toBe(0)
  })

  it('reads the room key', () => {
    renderHook(() => useChatScroll('room-A', timelineOf([1])))
    expect(persisted.getConv).toHaveBeenCalledWith('sakadesk_scroll_room-A', {})
  })

  it('resolves the range one frame later and saves 500 ms after it settles', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    act(() => { vi.advanceTimersByTime(499) })
    expect(persisted.setConv).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('asks topVisibleIndex which row the user sees (rows behind the sticky header do not count)', () => {
    const topVisible = vi.fn((range: ListRange) => range.startIndex + 1)
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103]), topVisible))
    act(() => result.current.handleRangeChanged({ startIndex: 0, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    act(() => { vi.advanceTimersByTime(500) })
    expect(topVisible).toHaveBeenCalledWith({ startIndex: 0, endIndex: 2 })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('a letter on top saves the nearest message above it, or below at the very top', () => {
    // letter-7, msg-101, letter-8, msg-102
    const timeline = timelineOf([101, 102], [letter(7, 50), letter(8, 101.5)])
    const { result } = renderHook(() => useChatScroll('room-1', timeline))
    act(() => result.current.handleRangeChanged({ startIndex: 2, endIndex: 3 }))
    act(() => { result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenLastCalledWith('sakadesk_scroll_room-1', { value: '101' })
    act(() => result.current.handleRangeChanged({ startIndex: 0, endIndex: 3 }))
    act(() => { result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenCalledTimes(1) // still 101: never written twice
  })

  it('savePositionImmediate resolves a pending range at once', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { result.current.savePositionImmediate() })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  // SD-FE-STATE-03: a scroll-then-close within the debounce must still persist.
  it('flushes the pending position on pagehide through the beacon', () => {
    const { result } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    expect(persisted.setConv).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(persisted.setConvBeacon).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('saves the previous room when the room changes', () => {
    const { result, rerender } = renderHook(({ id, t }) => useChatScroll(id, t), {
      initialProps: { id: 'room-1', t: timelineOf([101, 102, 103]) },
    })
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    rerender({ id: 'room-2', t: timelineOf([201]) })
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(persisted.setConv).toHaveBeenCalledTimes(1)
  })

  it('saves on unmount instead of dropping a pending save', () => {
    const { result, unmount } = renderHook(() => useChatScroll('room-1', timelineOf([101, 102, 103])))
    act(() => result.current.handleRangeChanged({ startIndex: 1, endIndex: 2 }))
    act(() => { vi.advanceTimersToNextFrame() })
    unmount()
    expect(persisted.setConv).toHaveBeenCalledWith('sakadesk_scroll_room-1', { value: '102' })
  })

  it('removes the pagehide listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useChatScroll('room-1', timelineOf([1])))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function))
  })
})
```

`frontend/src/features/messages/utils/nickname.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Message } from '../../../types';
import { applyNickname } from './nickname';

const msg = (id: number, content: string | null): Message => ({ id, timestamp: '2026-01-01T00:00:00Z', type: 'text', is_favorite: false, content });

describe('applyNickname', () => {
    it('replaces ASCII and fullwidth placeholders', () => {
        const out = applyNickname([msg(1, '%%%さん、ありがとう'), msg(2, '％％％ちゃん🌸')], 'ゆき');
        expect(out.map((m) => m.content)).toEqual(['ゆきさん、ありがとう', 'ゆきちゃん🌸']);
    });

    it('returns the same array when nothing changes', () => {
        const list = [msg(1, 'hello'), msg(2, null)];
        expect(applyNickname(list, 'ゆき')).toBe(list);
        expect(applyNickname(list, undefined)).toBe(list);
    });

    it('inserts the nickname literally (no $ patterns)', () => {
        expect(applyNickname([msg(1, '%%%!')], '$&$1')[0].content).toBe('$&$1!');
    });
});
```

Run: `npx vitest run src/features/messages/hooks/useChatScroll.test.ts src/features/messages/utils/nickname.test.ts`
Expected: FAIL (old signature; `./nickname` missing).

- [ ] **Step 12: Implement restore on the model**

Full replacement of `frontend/src/features/messages/hooks/useChatScroll.ts`:

```ts
import { useRef, useCallback, useMemo, useEffect } from 'react';
import type { ListRange } from 'react-virtuoso';
import { persisted } from '../../../core/persistence/persisted';
import type { Timeline } from '../timeline/buildTimeline';

const STORAGE_KEY_PREFIX = 'sakadesk_scroll_';
const DEBOUNCE_MS = 500;

export interface UseChatScrollResult {
  /** Item index to pass to Virtuoso's initialTopMostItemIndex */
  initialTopMostItemIndex: number;
  /** Callback for Virtuoso's rangeChanged prop */
  handleRangeChanged: (range: ListRange) => void;
  /** Save the current position now (e.g. right before a room switch) */
  savePositionImmediate: () => void;
}

/**
 * ID-based scroll save/restore for the chat timeline.
 *
 * - Saves the top-most visible MESSAGE id to persisted app-state, 500 ms after the list
 *   stops moving. A letter on top saves the nearest message above it (below it at the very top).
 * - Which row is "top-most visible" is resolved one animation frame after `rangeChanged`, so
 *   the DOM matches the range: `topVisibleIndex(range)` skips rows hidden behind the sticky date
 *   header; without it the range start is used.
 * - Restores by looking the saved id up in the timeline; a new room or an unknown id opens at the bottom.
 * - The last resolved position is also written on a room switch, on unmount, and (through the
 *   keepalive beacon) on pagehide / hidden.
 */
export function useChatScroll(
  memberId: string | number,
  timeline: Timeline,
  topVisibleIndex?: (range: ListRange) => number,
): UseChatScrollResult {
  const storageKey = `${STORAGE_KEY_PREFIX}${memberId}`;
  const keyRef = useRef(storageKey);
  const latest = useRef({ timeline, topVisibleIndex });
  latest.current = { timeline, topVisibleIndex };
  const pendingRangeRef = useRef<ListRange | null>(null);
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const topIdRef = useRef<number | null>(null);
  const lastSavedRef = useRef<{ key: string; id: number } | null>(null);

  const write = useCallback((key: string, beacon = false) => {
    const id = topIdRef.current;
    if (id === null) return;
    const last = lastSavedRef.current;
    if (last && last.key === key && last.id === id) return;
    if (beacon) persisted.setConvBeacon(key, { value: String(id) });
    else persisted.setConv(key, { value: String(id) });
    lastSavedRef.current = { key, id };
  }, []);

  /** Turn the last reported range into the top visible message id (needs THIS room's DOM). */
  const resolvePending = useCallback(() => {
    const range = pendingRangeRef.current;
    pendingRangeRef.current = null;
    if (!range) return;
    const { timeline: current, topVisibleIndex: resolve } = latest.current;
    const id = current.messageIdNear(resolve ? resolve(range) : range.startIndex);
    if (id !== null) topIdRef.current = id;
  }, []);

  const cancelScheduled = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Room switch: save the previous room's last resolved top message. Its pending range is
  // dropped: the DOM and the timeline already belong to the new room.
  useEffect(() => {
    if (keyRef.current === storageKey) return;
    cancelScheduled();
    pendingRangeRef.current = null;
    write(keyRef.current);
    keyRef.current = storageKey;
    topIdRef.current = null;
  }, [storageKey, cancelScheduled, write]);

  const initialTopMostItemIndex = useMemo(() => {
    const last = timeline.items.length - 1;
    if (last < 0) return 0;
    const savedId = persisted.getConv<{ value?: string }>(storageKey, {}).value ?? null;
    if (!savedId) return last; // New room -> bottom
    const index = timeline.indexOfMessage(Number(savedId));
    return index !== -1 ? index : last; // Not found -> bottom
  }, [storageKey, timeline]);

  const handleRangeChanged = useCallback((range: ListRange) => {
    pendingRangeRef.current = range;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      resolvePending();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        write(keyRef.current);
      }, DEBOUNCE_MS);
    });
  }, [resolvePending, write]);

  const savePositionImmediate = useCallback(() => {
    cancelScheduled();
    resolvePending();
    write(keyRef.current);
  }, [cancelScheduled, resolvePending, write]);

  // Unmount: keep the last resolved position (the DOM is gone, so a pending range is dropped).
  useEffect(() => () => {
    cancelScheduled();
    pendingRangeRef.current = null;
    write(keyRef.current);
  }, [cancelScheduled, write]);

  // SD-FE-STATE-03: flush on pagehide/hidden through setConvBeacon, whose keepalive request
  // survives the JS context teardown on close (plain setConv's PATCH is abandoned).
  useEffect(() => {
    const flush = () => {
      cancelScheduled();
      resolvePending();
      write(keyRef.current, true);
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cancelScheduled, resolvePending, write]);

  return { initialTopMostItemIndex, handleRangeChanged, savePositionImmediate };
}
```

`frontend/src/features/messages/utils/nickname.ts`:

```ts
import type { Message } from '../../../types';

// ASCII %%% (U+0025) and fullwidth ％％％ (U+FF05) stand for the user's nickname.
const HAS_PLACEHOLDER = /%%%|％％％/;
const PLACEHOLDERS = /%%%|％％％/g;

/**
 * Replace the nickname placeholder in message text. Returns the same array when nothing
 * changes, so memoised consumers (the timeline) keep their identity.
 */
export function applyNickname(messages: Message[], nickname: string | undefined): Message[] {
    if (!nickname) return messages;
    let changed = false;
    const out = messages.map((msg) => {
        if (!msg.content || !HAS_PLACEHOLDER.test(msg.content)) return msg;
        changed = true;
        return { ...msg, content: msg.content.replace(PLACEHOLDERS, () => nickname) };
    });
    return changed ? out : messages;
}
```

Run: `npx vitest run src/features/messages/hooks/useChatScroll.test.ts src/features/messages/utils/nickname.test.ts`
Expected: PASS.

- [ ] **Step 13: Render the timeline in MessageList**

Full replacement of `frontend/src/features/messages/components/MessageList.tsx`:

```tsx
import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { Virtuoso, VirtuosoHandle, type ListRange } from 'react-virtuoso';
import type { Message } from '../../../types';
import { useChatScroll } from '../hooks/useChatScroll';
import { useMessagesTheme } from '../hooks/useMessagesTheme';
import { MessageBubble } from './MessageBubble';
import { notifyVisibleMessages } from '../hooks/useMessageVisibility';
import { cn } from '../../../utils/classnames';
import { useTranslation } from '../../../i18n';
import { rowKeyOf, type RowKey, type Timeline, type TimelineItem } from '../timeline/buildTimeline';
import { topVisibleRowIndex } from '../timeline/landing';
import type { Letter } from '../letters';

/**
 * Avatar click handler for a message. Member 0 is the room itself (messages
 * the API returns without an author), which has no profile card to open.
 * The group endpoint serialises member_id as a string (from the folder name),
 * so both 0 and "0" are treated as the room.
 */
export const avatarClickFor = (msg: Message, onAvatarClick?: () => void) =>
    String(msg.member_id) === '0' ? undefined : onAvatarClick;

interface ChatListProps {
    /** Unique identifier for the current room/member */
    memberId: string;
    /** The room's timeline (nickname already applied, letters merged): the only index source */
    timeline: Timeline;
    /** Function to get sender info for a message */
    getSenderInfo: (msg: Message) => { name: string; avatar?: string };
    /** Function to check if a message is unread */
    isUnread: (msgId: number) => boolean;
    /** Callback when a message is revealed */
    onReveal: (msgId: number) => void;
    /** Callback for long-press on unread message */
    onLongPress: () => void;
    /** Callback when the rendered item range changes (for unread navigation) */
    onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
    /** Ref to expose the list handle for external scroll control */
    virtuosoRef?: React.RefObject<VirtuosoHandle>;
    /** Receives Virtuoso's scroll element (the timeline jump glides it) */
    scrollerRef?: (el: HTMLElement | Window | null) => void;
    /** User's nickname (for translations of %%% messages) */
    userNickname?: string;
    /** Callback to toggle favorite status of a message */
    onToggleFavorite?: (messageId: number, currentState: boolean) => void;
    /** Callback when avatar is clicked (for member profile popup) */
    onAvatarClick?: () => void;
    /** Active service ID for media URL construction */
    service?: string;
    /** Target message ID to jump to (from search navigation) */
    targetMessageId?: number | null;
    /** Callback to clear targetMessageId after it's consumed */
    onTargetMessageConsumed?: () => void;
    /** Jump to a message through the shared timeline jump (same-room and fresh-mount targets) */
    onJumpToMessage?: (id: number) => void;
    /** Row to flash after a jump landed on it */
    highlightedRowKey?: RowKey | null;
    /** Callback when a media item is clicked (for media viewer modal) */
    onMediaClick?: (mediaUrl: string, type: string, timestamp?: string) => void;
    /** Function to resolve the member directory path for a message (for transcription) */
    getMemberPath?: (msg: Message) => string | undefined;
    /** Renders the content of a sent-letter row */
    renderLetter?: (letter: Letter) => React.ReactNode;
}

const DEFAULT_ITEM_HEIGHT = 80;

export const MessageList: React.FC<ChatListProps> = ({
    memberId,
    timeline,
    getSenderInfo,
    isUnread,
    onReveal,
    onLongPress,
    onRangeChanged,
    virtuosoRef: externalRef,
    scrollerRef,
    userNickname,
    onToggleFavorite,
    onAvatarClick,
    service,
    targetMessageId,
    onTargetMessageConsumed,
    onJumpToMessage,
    highlightedRowKey,
    onMediaClick,
    getMemberPath,
    renderLetter,
}) => {
    const { t } = useTranslation();
    const virtuosoKey = `virtuoso-${memberId}`;
    const internalRef = useRef<VirtuosoHandle>(null);
    const virtuosoRef = externalRef || internalRef;
    const scrollerElRef = useRef<HTMLElement | null>(null);
    const setScroller = useCallback((el: HTMLElement | Window | null) => {
        scrollerElRef.current = el instanceof HTMLElement ? el : null;
        scrollerRef?.(el);
    }, [scrollerRef]);

    // Get theme colors for message bubbles
    const theme = useMessagesTheme();
    const bubbleTheme = useMemo(() => ({
        bubbleBorder: theme.bubbleBorder,
        voicePlayerAccent: theme.voicePlayerAccent,
        favoriteColor: theme.favoriteColor,
        linkColor: theme.linkColor,
        shelterColors: theme.shelterColors,
        shelterStyle: theme.shelterStyle,
    }), [theme.bubbleBorder, theme.voicePlayerAccent, theme.favoriteColor, theme.linkColor, theme.shelterColors, theme.shelterStyle]);

    // The first row the user can see; rows hidden behind a sticky date header do not count.
    const topVisibleIndex = useCallback((range: ListRange) =>
        topVisibleRowIndex(scrollerElRef.current, range, (i) => timeline.rowKeyAt(i)), [timeline]);

    const {
        initialTopMostItemIndex: savedScrollIndex,
        handleRangeChanged,
    } = useChatScroll(memberId, timeline, topVisibleIndex);

    // Search navigation: the target's index seeds initialTopMostItemIndex on a fresh mount.
    const targetIndex = useMemo(() => {
        if (targetMessageId == null) return undefined;
        const idx = timeline.indexOfMessage(targetMessageId);
        return idx !== -1 ? idx : undefined;
    }, [targetMessageId, timeline]);

    // Fresh mounts already start at the target (initialTopMostItemIndex) and same-room
    // targets arrive on a mounted list; both call onJumpToMessage, the shared jump that
    // scrolls, verifies the landing and highlights it.
    useEffect(() => {
        if (targetIndex == null || targetMessageId == null) return;
        onJumpToMessage?.(targetMessageId);
        onTargetMessageConsumed?.();
    }, [targetIndex, targetMessageId, onJumpToMessage, onTargetMessageConsumed]);

    const initialTopMostItemIndex = targetIndex ?? savedScrollIndex;

    // Range change: restore position, unread navigation and the panel auto-collapse registry
    // (message rows only; letters have no panels).
    const onRangeChange = useCallback((range: ListRange) => {
        handleRangeChanged(range);
        onRangeChanged?.(range);
        const visibleIds = new Set<number>();
        for (let i = range.startIndex; i <= range.endIndex && i < timeline.items.length; i++) {
            const item = timeline.items[i];
            if (item.kind === 'message') visibleIds.add(item.message.id);
        }
        notifyVisibleMessages(visibleIds);
    }, [handleRangeChanged, onRangeChanged, timeline]);

    const renderItem = (item: TimelineItem) => {
        const rowKey = rowKeyOf(item);
        const rowClass = cn('px-4 py-1 rounded-card', highlightedRowKey === rowKey && 'animate-landing');
        if (item.kind === 'letter') {
            return <div className={rowClass} id={rowKey}>{renderLetter?.(item.letter)}</div>;
        }
        const msg = item.message;
        const senderInfo = getSenderInfo(msg);
        return (
            <div className={rowClass} id={rowKey}>
                <MessageBubble
                    message={msg}
                    member_name={senderInfo.name}
                    member_avatar={senderInfo.avatar}
                    isUnread={isUnread(msg.id)}
                    onReveal={() => onReveal(msg.id)}
                    onLongPress={onLongPress}
                    onToggleFavorite={onToggleFavorite}
                    onAvatarClick={avatarClickFor(msg, onAvatarClick)}
                    onMediaClick={onMediaClick}
                    theme={bubbleTheme}
                    service={service}
                    memberPath={getMemberPath?.(msg)}
                    userNickname={userNickname}
                />
            </div>
        );
    };

    if (timeline.items.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-muted">
                <p>{t('messageList.noMessages')}</p>
            </div>
        );
    }

    return (
        <Virtuoso
            key={virtuosoKey}
            ref={virtuosoRef}
            scrollerRef={setScroller}
            style={{ height: '100%' }}
            data={timeline.items}
            initialTopMostItemIndex={initialTopMostItemIndex}
            defaultItemHeight={DEFAULT_ITEM_HEIGHT}
            followOutput={(isAtBottom: boolean) => isAtBottom ? 'smooth' : false}
            rangeChanged={onRangeChange}
            itemContent={(_index, item) => renderItem(item)}
        />
    );
};
```

Update both MessageList tests (from `frontend/`):

```bash
for f in src/features/messages/components/MessageList.jump.test.tsx src/features/messages/components/MessageList.range.test.tsx; do
  sed -i -e "s|            messages={messages}|            timeline={buildTimeline(messages, [])}|" $f
  sed -i "s|^import { MessageList } from './MessageList';|import { MessageList } from './MessageList';\nimport { buildTimeline } from '../timeline/buildTimeline';|" $f
done
f=src/features/messages/components/MessageList.jump.test.tsx
sed -i -e "s/highlightedMessageId: 2/highlightedRowKey: 'msg-2'/" $f
```

Append to `MessageList.range.test.tsx` (inside the `describe`):

```tsx
    it('leaves letters out of the panel registry and keeps message rows keyed msg-<id>', () => {
        const collapse2 = vi.fn();
        renderHook(() => useCollapseOnOutOfView(2, true, collapse2));
        const letter = { id: 2, text: '', created_at: '2026-01-01T12:00:00Z', image_url: null, width: null, height: null };
        const { container } = render(
            <MessageList
                memberId="room"
                timeline={buildTimeline(messages, [letter])}
                getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => false}
                onReveal={vi.fn()}
                onLongPress={vi.fn()}
                renderLetter={() => <span>letter</span>}
            />,
        );
        // Rows: msg-1, letter-2, msg-2, msg-3; range 0..1 holds msg-1 and letter-2 only.
        act(() => virtuosoCapture.rangeChanged!({ startIndex: 0, endIndex: 1 }));
        expect(collapse2).toHaveBeenCalledTimes(1);
        expect(container.querySelector('#letter-2')).not.toBeNull();
        expect(container.querySelector('#msg-2')).not.toBeNull();
    });
```

- [ ] **Step 14: Build the timeline in MessagesFeature**

Edits in `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Below `import { useLandingHighlight } from './hooks/useLandingHighlight';` add:

```ts
import { buildTimeline } from './timeline/buildTimeline';
import { firstUnreadIndex } from './timeline/jumpTarget';
import { applyNickname } from './utils/nickname';
import type { Letter } from './letters';
```

(b) Below `const MAX_CACHED_CHATS = 20;` add:

```ts
/** No letters yet: Task 11 replaces this with the room's letters from the local archive. */
const NO_LETTERS: readonly Letter[] = [];
```

(c) Directly after the `isUnread` `useCallback` block, add:

```ts
    // One timeline for the list, the jumps, the restore and the unread arrows.
    const userNickname = messagesService ? appSettings?.user_nicknames?.[messagesService] : undefined;
    const displayMessages = useMemo(() => applyNickname(messages, userNickname), [messages, userNickname]);
    const timeline = useMemo(() => buildTimeline(displayMessages, NO_LETTERS), [displayMessages]);
```

(d) Replace `const { highlightedMessageId, flash: flashLanded } = useLandingHighlight(selectedGroupDir);` with `const { highlightedRowKey, flash: flashLanded } = useLandingHighlight(selectedGroupDir);`.

(e) In the `useTimelineJump({ … })` call replace `virtuosoRef, messages, isUnread, onLanded: flashLanded,` with `virtuosoRef, timeline, isUnread, onLanded: flashLanded,`.

(f) In `updateUnreadNavState` replace

```ts
        const firstUnreadIndex = messages.findIndex(m => isUnread(m.id));
        let above = false;
        let below = false;

        if (firstUnreadIndex !== -1) {
            if (firstUnreadIndex < currentRange.startIndex) above = true;
            else if (firstUnreadIndex > currentRange.endIndex) below = true;
        }
```

with

```ts
        const firstUnread = firstUnreadIndex(timeline, isUnread);
        let above = false;
        let below = false;

        if (firstUnread !== -1) {
            if (firstUnread < currentRange.startIndex) above = true;
            else if (firstUnread > currentRange.endIndex) below = true;
        }
```

and its dependency list `}, [messages, isUnread]);` with `}, [timeline, isUnread]);`.

(g) In the `<MessageList … />` props replace `messages={messages}` with `timeline={timeline}`, `highlightedMessageId={highlightedMessageId}` with `highlightedRowKey={highlightedRowKey}`, and the multi-line `userNickname={ messagesService ? appSettings?.user_nicknames?.[messagesService] : undefined }` with `userNickname={userNickname}`.

- [ ] **Step 15: Check that no scroll caller indexes `messages[]` any more**

Run: `grep -nE "messages\.(findIndex|indexOf)|messages\[[a-zA-Z]" src/features/messages/MessagesFeature.tsx src/features/messages/components/MessageList.tsx src/features/messages/hooks/*.ts src/features/messages/timeline/*.ts | grep -v test`
Expected: no output.

- [ ] **Step 16: Full frontend checks and the scroll e2e**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green.

Run: `npm run build && npx playwright test e2e/timeline-scroll.spec.ts --reporter=line`
Expected: 8 passed.

- [ ] **Step 17: Commit**

```bash
git add frontend/src/features/messages/hooks/useChatScroll.ts frontend/src/features/messages/hooks/useChatScroll.test.ts frontend/src/features/messages/utils/nickname.ts frontend/src/features/messages/utils/nickname.test.ts frontend/src/features/messages/components/MessageList.tsx frontend/src/features/messages/components/MessageList.jump.test.tsx frontend/src/features/messages/components/MessageList.range.test.tsx frontend/src/features/messages/MessagesFeature.tsx
uv run git commit -m "refactor(chat): drive the list, restore and unread nav by the timeline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: GroupedVirtuoso with sticky date pills

**Files:**
- Modify: `frontend/src/design/primitives/DatePill.tsx` + `Indicators.test.tsx`
- Modify: `frontend/src/utils/dateFormatters.ts` + `dateFormatters.test.ts`
- Modify: `frontend/src/features/messages/timeline/jumpTarget.ts` + `jumpTarget.test.ts`
- Modify: `frontend/src/features/messages/hooks/useTimelineJump.test.ts`
- Modify: `frontend/src/__tests__/virtuosoMock.tsx`
- Modify: `frontend/src/features/messages/components/MessageList.tsx`, `MessageList.jump.test.tsx`, `MessageList.range.test.tsx`
- Create: `frontend/src/features/messages/components/MessageList.grouped.test.tsx`
- Modify: `frontend/src/features/messages/components/ConversationMenu.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`
- Create: `frontend/src/i18n/d2a.test.ts`; modify the 5 locale files
- Modify: `frontend/e2e/timeline-scroll.spec.ts`

**Interfaces:**
- Consumes: probe facts 1–6 (Task 4); `Timeline.groupCounts/groupDates/groupStarts/groupIndexOfDate` (Task 3); `locate()` in `useTimelineJump` already scrolls by `groupIndex` when a resolved jump has one (Task 5).
- Produces: `DatePill` props `onClick?: () => void; actionLabel?: string`; `fromLocalDateStr(date: string): Date | null`; date jumps resolve with `groupIndex`; `MessageList` prop `onOpenCalendar?: () => void` and `virtuosoRef?: React.RefObject<GroupedVirtuosoHandle>`; `ConversationMenu` prop `onOpenCalendar: () => void` (replaces `onSelectDate`); `MessagesFeature` owns the calendar (`calendarOpen`). i18n key `messageList.openCalendar`; `src/i18n/d2a.test.ts` exports nothing and holds the `D2A_KEYS` list that later tasks extend.

- [ ] **Step 1: Write the failing primitive and formatter tests**

Append to `frontend/src/design/primitives/Indicators.test.tsx` inside `describe('DatePill', …)`:

```tsx
    it('becomes a button with a tooltip when it has an action', async () => {
        const onClick = vi.fn();
        render(<DatePill date={new Date(2026, 10, 4, 9, 0)} onClick={onClick} actionLabel="Jump to a date" />);
        const button = screen.getByRole('button', { name: 'Today' });
        expect(button).toHaveAttribute('title', 'Jump to a date');
        expect(button).toHaveClass('rounded-pill', 'focus-visible:ring-group');
        expect(screen.getByText('Today').tagName).toBe('TIME');
        fireEvent.click(button);
        expect(onClick).toHaveBeenCalledOnce();
    });
```

In `frontend/src/utils/dateFormatters.test.ts`, change the import to `import { toLocalDateStr, formatDatePillLabel, fromLocalDateStr } from './dateFormatters';` and append:

```ts
describe('fromLocalDateStr', () => {
  it('turns a local YYYY-MM-DD back into local midnight of that day', () => {
    const d = fromLocalDateStr('2022-01-15')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2022, 0, 15, 0]);
    expect(toLocalDateStr(d)).toBe('2022-01-15');
  });

  it('rejects anything else', () => {
    expect(fromLocalDateStr('')).toBeNull();
    expect(fromLocalDateStr('2022-1-15')).toBeNull();
    expect(fromLocalDateStr('2022-01-15T00:00:00Z')).toBeNull();
  });
});
```

Run: `npx vitest run src/design/primitives/Indicators.test.tsx src/utils/dateFormatters.test.ts`
Expected: FAIL (no button; `fromLocalDateStr` missing).

- [ ] **Step 2: Implement them**

Append to `frontend/src/utils/dateFormatters.ts`:

```ts
/** Local midnight of a "YYYY-MM-DD" from toLocalDateStr; null for anything else. */
export function fromLocalDateStr(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
```

Full replacement of `frontend/src/design/primitives/DatePill.tsx`:

```tsx
import React from 'react';
import { useTranslation } from '../../i18n';
import { cn } from '../../utils/classnames';
import { formatDatePillLabel, toLocalDateStr } from '../../utils/dateFormatters';

export interface DatePillProps {
    date: Date;
    /** Stick to the top of the scrolling timeline. */
    sticky?: boolean;
    /** Makes the pill a button (e.g. open the calendar). */
    onClick?: () => void;
    /** Already translated tooltip for the button. */
    actionLabel?: string;
    className?: string;
}

const PILL = 'pointer-events-auto rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill';

/** Level 3 — floating date label for timelines; optionally a button. */
export const DatePill: React.FC<DatePillProps> = ({ date, sticky = false, onClick, actionLabel, className }) => {
    const { t, i18n } = useTranslation();
    const label = formatDatePillLabel(date, new Date(), i18n.language, (key) => t(key));
    const time = <time dateTime={toLocalDateStr(date)} className={onClick ? undefined : PILL}>{label}</time>;
    return (
        <div className={cn('pointer-events-none flex justify-center py-2', sticky && 'sticky top-0 z-10', className)}>
            {onClick ? (
                <button
                    type="button"
                    onClick={onClick}
                    title={actionLabel}
                    className={cn(
                        PILL,
                        'transition-colors duration-fast ease-standard hover:text-primary',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
                    )}
                >
                    {time}
                </button>
            ) : time}
        </div>
    );
};
```

Run: `npx vitest run src/design/primitives/Indicators.test.tsx src/utils/dateFormatters.test.ts`
Expected: PASS.

- [ ] **Step 3: Date jumps target the day's group**

In `frontend/src/features/messages/timeline/jumpTarget.ts`, replace

```ts
        case 'date':
            return at(timeline, timeline.indexOfDate(target.date), 'start', true, true);
```

with

```ts
        case 'date': {
            // Scroll to the day's group, so its date pill lands at the top (probe fact 4).
            const group = timeline.groupIndexOfDate(target.date);
            const jump = group < 0 ? null : at(timeline, timeline.groupStarts[group], 'start', true, true);
            return jump && { ...jump, groupIndex: group };
        }
```

In `jumpTarget.test.ts`, in `'finds the first row of a local date'`, add `expect(r?.groupIndex).toBe(timeline.groupIndexOfDate(date));`.

In `frontend/src/features/messages/hooks/useTimelineJump.test.ts` (from `frontend/`):

```bash
sed -i "s/expect(scrollToIndex).toHaveBeenCalledWith({ index: 2, align: 'start', behavior: 'auto' });/expect(scrollToIndex).toHaveBeenCalledWith({ groupIndex: 2, align: 'start', behavior: 'auto' });/" src/features/messages/hooks/useTimelineJump.test.ts
```

and append inside `describe('useTimelineJump glide', …)`:

```ts
    it('a far date jump leads in to the day\'s group with an offset', async () => {
        const scroller = fakeScroller();
        const date = toLocalDateStr(many[150].timestamp);
        const group = buildTimeline(many, []).groupIndexOfDate(date);
        const s = setup([], { list: many, glide: { scroller, range: below, targetTop: 20000 } });
        await expect(s.jumpTo({ kind: 'date', date })).resolves.toBe('landed');
        expect(s.scrollToIndex.mock.calls[0][0]).toEqual({ groupIndex: group, align: 'start', behavior: 'auto', offset: -LEAD });
    });
```

Run: `npx vitest run src/features/messages/timeline/jumpTarget.test.ts src/features/messages/hooks/useTimelineJump.test.ts`
Expected: PASS.

- [ ] **Step 4: Add the grouped stand-in and the failing list test**

In `frontend/src/__tests__/virtuosoMock.tsx`, add below `interface FlatProps`:

```tsx
interface GroupedProps {
    groupCounts: number[];
    groupContent: (groupIndex: number) => React.ReactNode;
    itemContent: (index: number, groupIndex: number) => React.ReactNode;
    rangeChanged?: (range: ListRange) => void;
}
```

and add to the `virtuosoMock` object:

```tsx
    GroupedVirtuoso: ({ groupCounts, groupContent, itemContent, rangeChanged }: GroupedProps) => {
        virtuosoCapture.rangeChanged = rangeChanged;
        const rows: React.ReactNode[] = [];
        let index = 0;
        groupCounts.forEach((count, g) => {
            rows.push(<div key={`group-${g}`}>{groupContent(g)}</div>);
            for (let k = 0; k < count; k += 1, index += 1) rows.push(<div key={`item-${index}`}>{itemContent(index, g)}</div>);
        });
        return <div>{rows}</div>;
    },
```

`frontend/src/features/messages/components/MessageList.grouped.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Message } from '../../../types';
import { MessageList } from './MessageList';
import { buildTimeline } from '../timeline/buildTimeline';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: undefined, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: () => <span /> }));

const msg = (id: number, timestamp: string): Message => ({ id, timestamp, type: 'text', is_favorite: false, content: `m${id}` });

describe('MessageList date headers', () => {
    it('renders one date pill per local day, and a pill opens the calendar', () => {
        const timeline = buildTimeline([msg(1, '2025-01-01T03:00:00Z'), msg(2, '2025-01-01T04:00:00Z'), msg(3, '2025-03-05T03:00:00Z')], []);
        const onOpenCalendar = vi.fn();
        const { container } = render(
            <MessageList
                memberId="room"
                timeline={timeline}
                getSenderInfo={() => ({ name: 'n' })}
                isUnread={() => false}
                onReveal={vi.fn()}
                onLongPress={vi.fn()}
                onOpenCalendar={onOpenCalendar}
            />,
        );
        const dates = Array.from(container.querySelectorAll('time')).map((el) => el.getAttribute('datetime'));
        expect(dates).toEqual(timeline.groupDates);
        fireEvent.click(screen.getAllByRole('button')[0]);
        expect(onOpenCalendar).toHaveBeenCalledOnce();
    });
});
```

Run: `npx vitest run src/features/messages/components/MessageList.grouped.test.tsx`
Expected: FAIL (`onOpenCalendar` unknown; no `<time>` rendered).

- [ ] **Step 5: Swap the list to GroupedVirtuoso**

In `frontend/src/features/messages/components/MessageList.tsx`:

(a) Replace `import { Virtuoso, VirtuosoHandle, type ListRange } from 'react-virtuoso';` with `import { GroupedVirtuoso, type GroupedVirtuosoHandle, type ListRange } from 'react-virtuoso';` and add:

```ts
import { DatePill } from '../../../design/primitives';
import { fromLocalDateStr } from '../../../utils/dateFormatters';
```

(b) In `ChatListProps`, change `virtuosoRef?: React.RefObject<VirtuosoHandle>;` to `virtuosoRef?: React.RefObject<GroupedVirtuosoHandle>;` and add:

```ts
    /** Opens the date-search calendar (clicking a date pill) */
    onOpenCalendar?: () => void;
```

(c) Add `onOpenCalendar,` to the destructured props, and change `const internalRef = useRef<VirtuosoHandle>(null);` to `const internalRef = useRef<GroupedVirtuosoHandle>(null);`.

(d) Add above `const DEFAULT_ITEM_HEIGHT = 80;`:

```tsx
/** Sticky day header of the timeline: a DatePill that opens the calendar. */
const TimelineDateHeader: React.FC<{ date: string; onOpenCalendar?: () => void }> = ({ date, onOpenCalendar }) => {
    const { t } = useTranslation();
    const day = fromLocalDateStr(date);
    // A message without a valid timestamp lands in an undated group: keep a 1 px header.
    if (!day) return <div className="h-px" />;
    return <DatePill date={day} onClick={onOpenCalendar} actionLabel={t('messageList.openCalendar')} />;
};
```

(e) Replace the final `return ( <Virtuoso … /> );` with:

```tsx
    // One group per local day; GroupedVirtuoso keeps the current day's header stuck on top and
    // lets the next one push it away. Indices passed around are item indices (probe fact 3).
    return (
        <GroupedVirtuoso
            key={virtuosoKey}
            ref={virtuosoRef}
            scrollerRef={setScroller}
            style={{ height: '100%' }}
            groupCounts={timeline.groupCounts}
            groupContent={(groupIndex) => (
                <TimelineDateHeader date={timeline.groupDates[groupIndex]} onOpenCalendar={onOpenCalendar} />
            )}
            initialTopMostItemIndex={initialTopMostItemIndex}
            defaultItemHeight={DEFAULT_ITEM_HEIGHT}
            followOutput={(isAtBottom: boolean) => isAtBottom ? 'smooth' : false}
            rangeChanged={onRangeChange}
            itemContent={(index) => renderItem(timeline.items[index])}
        />
    );
```

- [ ] **Step 6: Calendar owned by MessagesFeature**

In `frontend/src/features/messages/components/ConversationMenu.tsx`:
- Remove `import { CalendarModal } from '../../../core/modals/CalendarModal';`.
- In `ChatHeaderMenuProps`, replace `onSelectDate?: (date: string) => void;` with:

```ts
    /** Opens the date-search calendar (owned by MessagesFeature; the date pills open it too). */
    onOpenCalendar: () => void;
```

- In the destructuring, replace `onSelectDate,` with `onOpenCalendar,`.
- Replace `handleMenuItemClick` with:

```ts
    const handleMenuItemClick = (modalType: ModalType) => {
        setShowMenu(false);
        if (modalType === 'calendar') {
            onOpenCalendar();
            return;
        }
        setActiveModal(modalType);
    };
```

- Delete the whole `<CalendarModal … />` element.

In `frontend/src/features/messages/MessagesFeature.tsx`:
- Replace `import { VirtuosoHandle } from 'react-virtuoso';` with `import type { GroupedVirtuosoHandle } from 'react-virtuoso';` and add `import { CalendarModal } from '../../core/modals/CalendarModal';`.
- Replace `const virtuosoRef = useRef<VirtuosoHandle>(null);` with `const virtuosoRef = useRef<GroupedVirtuosoHandle>(null);`.
- Below `const [mediaViewerIndex, setMediaViewerIndex] = useState<number | null>(null);` add:

```ts
    // Date-search calendar: opened from the ⋯ menu and from the sticky date pills.
    const [calendarOpen, setCalendarOpen] = useState(false);
    const openCalendar = useCallback(() => setCalendarOpen(true), []);
```

- In `<ConversationMenu … />` replace `onSelectDate={scrollToDate}` with `onOpenCalendar={openCalendar}`.
- In `<MessageList … />` add `onOpenCalendar={openCalendar}`.
- Directly before `{/* Member Profile Popup */}` add:

```tsx
            {selectedGroupDir && (
                <CalendarModal
                    isOpen={calendarOpen}
                    onClose={() => setCalendarOpen(false)}
                    conversationPath={selectedGroupDir}
                    onSelectDate={(date) => {
                        setCalendarOpen(false);
                        scrollToDate(date);
                    }}
                />
            )}
```

- [ ] **Step 7: Add the i18n key and the D2a key test**

Run the "Adding i18n keys" one-liner with:

```json
{"en":{"messageList.openCalendar":"Jump to a date"},"ja":{"messageList.openCalendar":"日付を選んで移動"},"zh-CN":{"messageList.openCalendar":"跳转到日期"},"zh-TW":{"messageList.openCalendar":"跳至日期"},"yue":{"messageList.openCalendar":"跳去某一日"}}
```

`frontend/src/i18n/d2a.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string D2a adds (later tasks append to this list). */
const D2A_KEYS = [
    'messageList.openCalendar',
] as const;

describe('D2a strings', () => {
    it.each(Object.entries(locales))('%s has every D2a key', (_code, data) => {
        const tree = data as unknown as Record<string, Record<string, string>>;
        for (const dotted of D2A_KEYS) {
            const [section, key] = dotted.split('.');
            expect(tree[section]?.[key], dotted).toBeTruthy();
        }
    });
});
```

- [ ] **Step 8: Point the remaining list tests at GroupedVirtuoso and run the suite**

`MessageList.jump.test.tsx` and `MessageList.range.test.tsx` already use the shared stand-in, which now has `GroupedVirtuoso`; their row ids and range indices are unchanged (item indices).

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 9: Lock the date-pill behaviour in the browser**

Append to `frontend/e2e/timeline-scroll.spec.ts` inside the `describe`:

```ts
  test('a date jump puts that day\'s date pill at the top', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'January 2022')
    await dialog.getByRole('button', { name: '15', exact: true }).click()
    await expect(page.locator('[data-testid="virtuoso-top-item-list"] time')).toHaveAttribute('datetime', '2022-01-15', { timeout: 1000 })
  })

  test('clicking the sticky date pill opens the calendar', async ({ page }) => {
    await openBigRoom(page)
    await page.locator('[data-testid="virtuoso-top-item-list"] button').click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })
```

Run: `npm run build && npx playwright test e2e/timeline-scroll.spec.ts --reporter=line`
Expected: 10 passed (the 8 locked tests with `GroupedVirtuoso`, plus these 2). If the restore or a jump test fails, debug the model/landing code with superpowers:systematic-debugging; do not loosen the tests.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/design/primitives/DatePill.tsx frontend/src/design/primitives/Indicators.test.tsx frontend/src/utils/dateFormatters.ts frontend/src/utils/dateFormatters.test.ts frontend/src/features/messages/timeline/jumpTarget.ts frontend/src/features/messages/timeline/jumpTarget.test.ts frontend/src/features/messages/hooks/useTimelineJump.test.ts frontend/src/__tests__/virtuosoMock.tsx frontend/src/features/messages/components/MessageList.tsx frontend/src/features/messages/components/MessageList.grouped.test.tsx frontend/src/features/messages/components/ConversationMenu.tsx frontend/src/features/messages/MessagesFeature.tsx frontend/src/i18n/d2a.test.ts frontend/src/i18n/locales frontend/e2e/timeline-scroll.spec.ts
uv run git commit -m "feat(chat): group the timeline by day with sticky date pills" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backend — local letters and the account profile

**Files:**
- Create: `backend/services/archive_urls.py`
- Modify: `backend/api/chat_features.py`
- Create: `backend/api/account.py`
- Modify: `backend/main.py:55-76` (import) and `:412` (router)
- Modify: `backend/api/client_log.py`, `frontend/src/utils/clientLog.ts`
- Create: `backend/tests/test_letters_local_api.py`, `backend/tests/test_account_profile_api.py`
- Modify: `backend/tests/test_client_log_api.py`

**Interfaces:**
- Produces:
  - `GET /api/chat/letters_local?service=<id>&path=<member dir relative to output dir>` → `{"letters": [{"id": int, "text": str, "created_at": str, "image_url": str | null, "width": int | null, "height": int | null}]}`, oldest first. 400 for an unknown service or a path outside that service's folder; 403 for traversal (from `validate_path_within_dir`); missing/invalid file → `{"letters": []}`.
  - `GET /api/account/profile?service=<id>` → `{"name": str | null, "avatars": [{"url": str, "first_seen": str}]}`, thumbnails only, oldest `first_seen` first; `url` is a media-route URL, never the signed one.
  - structlog events `letters_local` (`outcome` ∈ found/empty/missing/invalid/wrong_service/bad_service, `service`, `count`, `skipped`) and `account_profile` (`outcome` ∈ found/empty/missing/invalid/bad_service, `service`, `avatars`, `skipped`, `has_name`); invalid/rejected at warning.
  - Client-log events `letters_load` (`outcome` ∈ ok/error/timeout/skipped_group, `count`), `account_profile_load` (`outcome` ∈ ok/error), `letter_avatar` (`count`, `history`, `fallback`), `streak_load` (`outcome` ∈ ok/error; used by Task 10); new field keys `count`, `history`, `fallback`.
  - `archive_urls.media_url(service, parts) -> str`, `archive_urls.parse_iso(value) -> datetime | None`.

- [ ] **Step 1: Write the failing letters tests**

`backend/tests/test_letters_local_api.py`:

```python
"""Tests for GET /api/chat/letters_local (sent letters from the local archive)."""

import json
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)

MEMBER = "日向坂46/messages/90 高井 俐香/142 高井 俐香"
SAKURA_MEMBER = "櫻坂46/messages/79 中川 智尋/134 中川 智尋"
TEXT = "いつもありがとう🌸 応援してます"


@pytest.fixture
def root(tmp_path: Path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        yield tmp_path


def _member_dir(root: Path, member: str = MEMBER) -> Path:
    member_dir = root / member
    (member_dir / "letters").mkdir(parents=True, exist_ok=True)
    return member_dir


def _write(root: Path, payload: object, member: str = MEMBER) -> Path:
    member_dir = _member_dir(root, member)
    with open(member_dir / "letters.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return member_dir


def _letter(letter_id: object, created_at: object, **kw: object) -> dict:
    return {
        "id": letter_id,
        "member_id": 142,
        "text": TEXT,
        "created_at": created_at,
        "updated_at": created_at,
        "is_favorite": False,
        "image_file": f"letters/{letter_id}.jpg",
        "width": 341,
        "height": 512,
        **kw,
    }


def _get(path: str = MEMBER, service: str = "hinatazaka46"):
    return client.get("/api/chat/letters_local", params={"service": service, "path": path})


def _events(logs: list[dict]) -> list[dict]:
    return [e for e in logs if e.get("event") == "letters_local"]


def test_found_letters_oldest_first_with_media_urls(root):
    member_dir = _write(
        root,
        {"version": 1, "letters": [_letter(2, "2026-10-31T08:03:23Z"), _letter(1, "2025-10-31T16:19:35Z")]},
    )
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg")  # 2.jpg is missing
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    letters = res.json()["letters"]
    assert [entry["id"] for entry in letters] == [1, 2]
    assert letters[0]["text"] == TEXT
    expected = "/api/content/media/hinatazaka46/" + "/".join(
        quote(p, safe="") for p in ["messages", "90 高井 俐香", "142 高井 俐香", "letters", "1.jpg"]
    )
    assert letters[0]["image_url"] == expected
    assert letters[1]["image_url"] is None
    assert (letters[0]["width"], letters[0]["height"]) == (341, 512)
    [event] = _events(logs)
    assert event["outcome"] == "found"
    assert event["count"] == 2 and event["skipped"] == 0
    assert event["log_level"] == "info"
    assert TEXT not in str(logs) and "高井" not in str(logs)


def test_image_url_is_served_by_the_media_route(root):
    member_dir = _write(root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]})
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg-bytes")
    url = _get().json()["letters"][0]["image_url"]
    res = client.get(url)
    assert res.status_code == 200
    assert res.content == b"jpg-bytes"


def test_missing_file_gives_an_empty_list(root):
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    assert res.json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "missing"


def test_no_letters_is_empty(root):
    _write(root, {"version": 1, "letters": []})
    with capture_logs() as logs:
        assert _get().json() == {"letters": []}
    assert _events(logs)[0]["outcome"] == "empty"


@pytest.mark.parametrize("raw", ["{not json", "[]", '{"letters": {}}'])
def test_invalid_file_gives_an_empty_list_and_a_warning(root, raw):
    (_member_dir(root) / "letters.json").write_text(raw, encoding="utf-8")
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    assert res.json() == {"letters": []}
    [event] = _events(logs)
    assert event["outcome"] == "invalid"
    assert event["log_level"] == "warning"


def test_bad_entries_are_skipped_and_counted(root):
    _write(
        root,
        {
            "version": 1,
            "letters": [
                "not a dict",
                _letter(True, "2025-01-01T00:00:00Z"),
                _letter(3, None),
                _letter(4, "yesterday"),
                _letter(5, "2025-01-01T00:00:00Z", text=None, width=0, height="512"),
            ],
        },
    )
    with capture_logs() as logs:
        letters = _get().json()["letters"]
    assert [entry["id"] for entry in letters] == [5]
    assert letters[0]["text"] == ""
    assert letters[0]["width"] is None and letters[0]["height"] is None
    assert _events(logs)[0]["skipped"] == 4


@pytest.mark.parametrize(
    "image_file",
    ["../../../secret.jpg", "letters/../1.jpg", "letters/1.jpg/../../x.jpg", "picture/1.jpg", "letters/abc.jpg", None],
)
def test_non_canonical_image_files_get_no_url(root, image_file):
    member_dir = _write(root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z", image_file=image_file)]})
    (member_dir / "letters" / "1.jpg").write_bytes(b"jpg")
    assert _get().json()["letters"][0]["image_url"] is None


@pytest.mark.parametrize("path", ["../../etc", "日向坂46/../../outside"])
def test_traversal_is_rejected(root, path):
    assert _get(path=path).status_code in (400, 403)


def test_a_path_of_another_service_is_rejected(root):
    _write(root, {"version": 1, "letters": [_letter(1, "2025-10-31T16:19:35Z")]}, member=SAKURA_MEMBER)
    with capture_logs() as logs:
        res = _get(path=SAKURA_MEMBER)
    assert res.status_code == 400
    assert _events(logs)[0]["outcome"] == "wrong_service"
    assert _get(path=f"日向坂46/../{SAKURA_MEMBER}").status_code == 400


def test_unknown_service_is_rejected(root):
    with capture_logs() as logs:
        assert _get(service="nope").status_code == 400
    assert _events(logs)[0]["outcome"] == "bad_service"
```

Run: `uv run pytest backend/tests/test_letters_local_api.py -q`
Expected: FAIL (404 for the route).

- [ ] **Step 2: Implement the URL helper and the letters endpoint**

`backend/services/archive_urls.py`:

```python
"""Helpers for read-only endpoints that expose files of the local archive.

URLs point at the existing media route (``/api/content/media/<service id>/...``),
which maps the service id to its display-name folder and re-validates the path.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime
from urllib.parse import quote

MEDIA_PREFIX = "/api/content/media/"


def media_url(service: str, parts: Iterable[str]) -> str:
    """Media-route URL of ``<service folder>/<parts...>``; every segment is percent-encoded."""
    return MEDIA_PREFIX + "/".join(quote(p, safe="") for p in [service, *parts])


def parse_iso(value: object) -> datetime | None:
    """Timezone-aware datetime of an ISO-8601 string (``Z`` = UTC); None otherwise.

    Archive timestamps always carry an offset, so naive values are rejected.
    """
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None
```

In `backend/api/chat_features.py`:
- Add `import asyncio` and `import re` to the stdlib imports.
- Change the `service_utils` import to also import `get_service_display_name`:

```python
from backend.services.service_utils import (
    get_service_display_name,
    get_service_enum,
    validate_service,
)
from backend.services.archive_urls import media_url, parse_iso
```

- Update the module docstring list to read `- Sent letters (live API and local archive)`.
- Add after `class MessageDatesResponse`:

```python
# pysaka (>= 0.4.5) writes letter images as letters/<id>.<ext>; nothing else is served.
LETTER_IMAGE_FILE = re.compile(r"^letters/[0-9]+\.[A-Za-z0-9]{1,5}$")


class LocalLetter(BaseModel):
    id: int
    text: str
    created_at: str
    image_url: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None


class LocalLettersResponse(BaseModel):
    letters: List[LocalLetter]


def _positive_int(value: object) -> Optional[int]:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def _read_local_letters(
    member_dir: Path, service: str, member_parts: list[str]
) -> tuple[str, list[LocalLetter], int]:
    """Read ``<member_dir>/letters.json``.

    Returns ``(outcome, letters, skipped)``: outcome is ``missing`` (no file),
    ``invalid`` (unreadable or not ``{"letters": [...]}``), ``empty`` or
    ``found``. Entries without an integer id or a parseable ``created_at`` are
    skipped and counted. ``image_url`` is set only for a canonical
    ``letters/<id>.<ext>`` file that exists. Letters come back oldest first.
    """
    letters_file = member_dir / "letters.json"
    if not letters_file.is_file():
        return "missing", [], 0
    try:
        with open(letters_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return "invalid", [], 0
    raw = data.get("letters") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return "invalid", [], 0
    dated: list[tuple[datetime, LocalLetter]] = []
    skipped = 0
    for entry in raw:
        if not isinstance(entry, dict):
            skipped += 1
            continue
        letter_id = entry.get("id")
        created_at = entry.get("created_at")
        created = parse_iso(created_at)
        if (
            isinstance(letter_id, bool)
            or not isinstance(letter_id, int)
            or not isinstance(created_at, str)
            or created is None
        ):
            skipped += 1
            continue
        image_file = entry.get("image_file")
        image_url = None
        if (
            isinstance(image_file, str)
            and LETTER_IMAGE_FILE.match(image_file)
            and (member_dir / image_file).is_file()
        ):
            image_url = media_url(service, [*member_parts, *image_file.split("/")])
        text = entry.get("text")
        dated.append(
            (
                created,
                LocalLetter(
                    id=letter_id,
                    text=text if isinstance(text, str) else "",
                    created_at=created_at,
                    image_url=image_url,
                    width=_positive_int(entry.get("width")),
                    height=_positive_int(entry.get("height")),
                ),
            )
        )
    dated.sort(key=lambda pair: pair[0])
    letters = [letter for _, letter in dated]
    return ("found" if letters else "empty"), letters, skipped
```

- Add the route after `get_letters`:

```python
@router.get("/letters_local", response_model=LocalLettersResponse)
async def get_letters_local(service: str, path: str):
    """The user's sent letters to one member, from the local archive only.

    ``path`` is the member directory relative to the output directory (as in
    ``/api/content/messages_by_path``) and must lie inside this service's
    folder. A missing or unreadable ``letters.json`` gives an empty list.
    Logs one ``letters_local`` breadcrumb per request: outcome and counts,
    never letter text, names or paths.
    """
    from backend.api.content import get_output_dir, validate_path_within_dir

    try:
        display_name = get_service_display_name(service)
    except ValueError:
        logger.warning("letters_local", outcome="bad_service")
        raise HTTPException(status_code=400, detail="Invalid service")
    output_dir = get_output_dir()
    member_dir = validate_path_within_dir(output_dir, path)
    try:
        parts = list(member_dir.relative_to(output_dir.resolve()).parts)
    except ValueError:
        parts = []
    if not parts or parts[0] != display_name:
        logger.warning("letters_local", outcome="wrong_service", service=service)
        raise HTTPException(status_code=400, detail="Path is not in this service")
    outcome, letters, skipped = await asyncio.to_thread(
        _read_local_letters, member_dir, service, parts[1:]
    )
    log = logger.warning if outcome == "invalid" else logger.info
    log("letters_local", outcome=outcome, service=service, count=len(letters), skipped=skipped)
    return LocalLettersResponse(letters=letters)
```

Run: `uv run pytest backend/tests/test_letters_local_api.py -q`
Expected: PASS.

- [ ] **Step 3: Write the failing account tests**

`backend/tests/test_account_profile_api.py`:

```python
"""Tests for GET /api/account/profile (the user's archived nickname and avatars)."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app

client = TestClient(app)

NAME = "ゆき🌸ファン"
SIGNED = "https://cdn.example.com/avatar.jpg?Expires=1&Signature=SECRET-SIG"


@pytest.fixture
def root(tmp_path: Path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        yield tmp_path


def _account(root: Path, profile: object = None, index: object = None, files: tuple[str, ...] = ()) -> Path:
    account = root / "日向坂46" / "account"
    (account / "profile_images" / "thumbnail").mkdir(parents=True, exist_ok=True)
    for target, payload in ((account / "profile.json", profile), (account / "profile_images" / "index.json", index)):
        if payload is None:
            continue
        if isinstance(payload, str):
            target.write_text(payload, encoding="utf-8")
        else:
            with open(target, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
    for name in files:
        (account / "profile_images" / name).write_bytes(b"img")
    return account


def _image(file: str, first_seen: str, kind: str = "thumbnail") -> dict:
    return {"kind": kind, "file": file, "url": SIGNED, "first_seen": first_seen}


def _events(logs: list[dict]) -> list[dict]:
    return [e for e in logs if e.get("event") == "account_profile"]


def _get(service: str = "hinatazaka46"):
    return client.get("/api/account/profile", params={"service": service})


def test_found_profile_with_avatar_history(root):
    _account(
        root,
        profile={"version": 1, "name": NAME, "updated_at": "2026-08-12T15:12:14Z"},
        index={
            "version": 1,
            "current": {"thumbnail": SIGNED},
            "images": [
                _image("thumbnail/b.jpg", "2026-08-12T15:12:14Z"),
                _image("thumbnail/a.jpg", "2025-01-01T00:00:00Z"),
                _image("phone_image/p.jpg", "2025-01-01T00:00:00Z", kind="phone_image"),
            ],
        },
        files=("thumbnail/a.jpg", "thumbnail/b.jpg"),
    )
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == NAME
    assert body["avatars"] == [
        {"url": "/api/content/media/hinatazaka46/account/profile_images/thumbnail/a.jpg", "first_seen": "2025-01-01T00:00:00Z"},
        {"url": "/api/content/media/hinatazaka46/account/profile_images/thumbnail/b.jpg", "first_seen": "2026-08-12T15:12:14Z"},
    ]
    assert "SECRET-SIG" not in res.text and "cdn.example.com" not in res.text
    [event] = _events(logs)
    assert event["outcome"] == "found" and event["avatars"] == 2 and event["has_name"] is True
    assert "SECRET-SIG" not in str(logs) and NAME not in str(logs)
    assert client.get(body["avatars"][0]["url"]).status_code == 200


def test_missing_account_folder(root):
    with capture_logs() as logs:
        res = _get()
    assert res.status_code == 200
    assert res.json() == {"name": None, "avatars": []}
    assert _events(logs)[0]["outcome"] == "missing"


def test_invalid_profile_still_returns_the_avatars(root):
    _account(root, profile="{oops", index={"version": 1, "images": [_image("thumbnail/a.jpg", "2025-01-01T00:00:00Z")]}, files=("thumbnail/a.jpg",))
    with capture_logs() as logs:
        body = _get().json()
    assert body["name"] is None and len(body["avatars"]) == 1
    [event] = _events(logs)
    assert event["outcome"] == "invalid" and event["log_level"] == "warning"


def test_invalid_index_still_returns_the_name(root):
    _account(root, profile={"version": 1, "name": NAME}, index="[]")
    with capture_logs() as logs:
        body = _get().json()
    assert body == {"name": NAME, "avatars": []}
    assert _events(logs)[0]["outcome"] == "invalid"


def test_bad_entries_are_skipped(root):
    _account(
        root,
        profile={"version": 1, "name": ""},
        index={
            "version": 1,
            "images": [
                _image("thumbnail/../../x.jpg", "2025-01-01T00:00:00Z"),
                _image("thumbnail/gone.jpg", "2025-01-01T00:00:00Z"),
                _image("thumbnail/a.jpg", "soon"),
                "not a dict",
            ],
        },
        files=("thumbnail/a.jpg",),
    )
    with capture_logs() as logs:
        body = _get().json()
    assert body == {"name": None, "avatars": []}
    [event] = _events(logs)
    assert event["outcome"] == "empty" and event["skipped"] == 4 and event["has_name"] is False


def test_unknown_service_is_rejected(root):
    with capture_logs() as logs:
        assert _get(service="nope").status_code == 400
    assert _events(logs)[0]["outcome"] == "bad_service"
```

Run: `uv run pytest backend/tests/test_account_profile_api.py -q`
Expected: FAIL (404).

- [ ] **Step 4: Implement the account endpoint and register it**

`backend/api/account.py`:

```python
"""Account API: the user's own archived nickname and avatar history.

Reads only the local archive that pysaka (>= 0.4.5) writes under
``<output_dir>/<service folder>/account/``: ``profile.json`` (``name``,
``updated_at``) and ``profile_images/index.json`` (``images[{kind, file, url,
first_seen}]``). The ``url`` there is a signed CDN URL: it is never returned or
logged. Avatars are served through the media route instead.
"""

import asyncio
import json
from pathlib import Path
from typing import List, Optional

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from pysaka.utils import sanitize_name

from backend.services.archive_urls import media_url, parse_iso
from backend.services.service_utils import get_service_display_name

router = APIRouter(prefix="/api/account", tags=["account"])
logger = structlog.get_logger(__name__)

AVATAR_KIND = "thumbnail"


class AccountAvatar(BaseModel):
    url: str
    first_seen: str


class AccountProfileResponse(BaseModel):
    name: Optional[str] = None
    avatars: List[AccountAvatar]


def _read_json(path: Path) -> tuple[bool, object]:
    """``(ok, data)``; ok is False when the file cannot be read or parsed."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return True, json.load(f)
    except (OSError, ValueError):
        return False, None


def _canonical_avatar_file(file: str) -> bool:
    """True for exactly ``thumbnail/<sanitized name>``, the only shape pysaka writes."""
    prefix = AVATAR_KIND + "/"
    if not file.startswith(prefix):
        return False
    name = file[len(prefix) :]
    return bool(name) and name not in (".", "..") and sanitize_name(name) == name


def _read_profile(
    account_dir: Path, service: str
) -> tuple[str, Optional[str], list[AccountAvatar], int]:
    """Returns ``(outcome, name, avatars oldest first, skipped)``.

    outcome: ``missing`` (neither file), ``invalid`` (a file exists but cannot
    be parsed; whatever the other file holds is still returned), ``found`` or
    ``empty``. Index entries of another kind are ignored; thumbnail entries with
    a non-canonical or missing file or an unparseable ``first_seen`` are skipped.
    """
    profile_file = account_dir / "profile.json"
    index_file = account_dir / "profile_images" / "index.json"
    has_profile, has_index = profile_file.is_file(), index_file.is_file()
    if not has_profile and not has_index:
        return "missing", None, [], 0
    invalid = False
    name: Optional[str] = None
    if has_profile:
        ok, data = _read_json(profile_file)
        if not ok or not isinstance(data, dict):
            invalid = True
        else:
            raw_name = data.get("name")
            name = raw_name if isinstance(raw_name, str) and raw_name else None
    dated = []
    skipped = 0
    if has_index:
        ok, index = _read_json(index_file)
        images = index.get("images") if ok and isinstance(index, dict) else None
        if not isinstance(images, list):
            invalid = True
            images = []
        for entry in images:
            if not isinstance(entry, dict):
                skipped += 1
                continue
            if entry.get("kind") != AVATAR_KIND:
                continue
            file, first_seen = entry.get("file"), entry.get("first_seen")
            seen = parse_iso(first_seen)
            if (
                not isinstance(file, str)
                or not _canonical_avatar_file(file)
                or not isinstance(first_seen, str)
                or seen is None
                or not (account_dir / "profile_images" / file).is_file()
            ):
                skipped += 1
                continue
            url = media_url(service, ["account", "profile_images", *file.split("/")])
            dated.append((seen, AccountAvatar(url=url, first_seen=first_seen)))
    dated.sort(key=lambda pair: pair[0])
    avatars = [avatar for _, avatar in dated]
    if invalid:
        outcome = "invalid"
    elif name or avatars:
        outcome = "found"
    else:
        outcome = "empty"
    return outcome, name, avatars, skipped


@router.get("/profile", response_model=AccountProfileResponse)
async def get_account_profile(service: str):
    """The user's nickname and avatar history for one service, from the local archive.

    Logs one ``account_profile`` breadcrumb (outcome and counts; never the
    nickname or any URL).
    """
    from backend.api.content import get_output_dir

    try:
        display_name = get_service_display_name(service)
    except ValueError:
        logger.warning("account_profile", outcome="bad_service")
        raise HTTPException(status_code=400, detail="Invalid service")
    account_dir = get_output_dir() / display_name / "account"
    outcome, name, avatars, skipped = await asyncio.to_thread(_read_profile, account_dir, service)
    log = logger.warning if outcome == "invalid" else logger.info
    log(
        "account_profile",
        outcome=outcome,
        service=service,
        avatars=len(avatars),
        skipped=skipped,
        has_name=name is not None,
    )
    return AccountProfileResponse(name=name, avatars=avatars)
```

In `backend/main.py`: add `account,` to the `from backend.api import ( … )` list (after `auth,`) and `app.include_router(account.router)` after `app.include_router(chat_features.router)`.

Run: `uv run pytest backend/tests/test_account_profile_api.py -q`
Expected: PASS.

- [ ] **Step 5: Whitelist the frontend breadcrumbs**

Append to `backend/tests/test_client_log_api.py`:

```python
@pytest.mark.parametrize(
    ("event", "fields"),
    [
        ("letters_load", {"outcome": "ok", "count": 3}),
        ("letters_load", {"outcome": "skipped_group"}),
        ("account_profile_load", {"outcome": "error"}),
        ("letter_avatar", {"count": 3, "history": 2, "fallback": 1}),
        ("streak_load", {"outcome": "ok"}),
    ],
)
def test_letter_breadcrumbs_are_accepted(event, fields):
    with capture_logs() as logs:
        res = client.post("/api/client-log", json={"event": event, "fields": fields})
    assert res.status_code == 204
    assert _client_events(logs)[0]["event"] == event
```

Run: `uv run pytest backend/tests/test_client_log_api.py -q` — Expected: FAIL (422).

In `backend/api/client_log.py`, add to `ClientEvent` after `"timeline_jump",`:

```python
    "letters_load",
    "account_profile_load",
    "letter_avatar",
    "streak_load",
```

and to `ALLOWED_FIELDS` after `"path",`:

```python
        "count",
        "history",
        "fallback",
```

In `frontend/src/utils/clientLog.ts`, extend the unions: `| 'timeline_jump'` becomes `| 'timeline_jump' | 'letters_load' | 'account_profile_load' | 'letter_avatar' | 'streak_load';` and `| 'target' | 'index' | 'corrections' | 'outcome' | 'jump_ms' | 'path';` becomes `| 'target' | 'index' | 'corrections' | 'outcome' | 'jump_ms' | 'path' | 'count' | 'history' | 'fallback';`.

- [ ] **Step 6: Run the backend checks**

Run (in `SakaDesk/`): `uv run pytest backend -q && uv run ruff check backend && uv run ruff format --check backend && uv run mypy backend/`
Expected: all green (the pysaka keyring test may error headless in WSL; that is pre-existing and not in this repo). Run `uv run ruff format backend` if the format check complains, then re-run.

Run (in `frontend/`): `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/services/archive_urls.py backend/api/chat_features.py backend/api/account.py backend/main.py backend/api/client_log.py backend/tests/test_letters_local_api.py backend/tests/test_account_profile_api.py backend/tests/test_client_log_api.py frontend/src/utils/clientLog.ts
uv run git commit -m "feat(api): serve sent letters and account avatars from the archive" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: The frame — group rail, canvas block, content sheet

**Files:**
- Create: `frontend/src/core/layout/FadeOnChange.tsx` + `FadeOnChange.test.tsx`
- Create: `frontend/src/core/layout/ContentSheet.tsx`
- Modify: `frontend/src/core/layout/ContentArea.tsx` (full replacement) + create `ContentArea.test.tsx`
- Modify: `frontend/src/core/layout/Layout.tsx` (full replacement)
- Modify: `frontend/src/core/layout/FeatureRail.tsx` (full replacement) + create `FeatureRail.test.tsx`
- Modify: `frontend/src/core/layout/ServiceRail.tsx` + create `ServiceRail.test.tsx`
- Modify: `frontend/src/config/features.ts`, `frontend/src/shell/components/LoginModal.tsx:144-147`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (root layout)
- Modify: locale files, `frontend/src/i18n/d2a.test.ts`, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Produces: `FadeOnChange({ changeKey: unknown; className?: string; children })` (fades in over `motion.duration.base` on every `changeKey` change without remounting); `ContentSheet({ children; className? })` (the level-1 `Sheet` with `my-2 mr-2`, i.e. 8 px from the frame); `FeatureDefinition.labelKey` (`features.<id>`, replaces `label`/`labelJa`); i18n key `contentArea.comingSoon`.
- Layout decision (spec section 1, resolved here): the canvas block holds the feature rail **and each feature's own sidebar**. `ContentArea` wraps blogs, the placeholders and the initial-sync view in a `ContentSheet`; for messages it renders `MessagesFeature` directly, which puts `MemberList` on the canvas and its chat column in a `ContentSheet`.

- [ ] **Step 1: Write the failing frame tests**

`frontend/src/core/layout/FadeOnChange.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FadeOnChange } from './FadeOnChange';

const Counter: React.FC = () => {
    const [n, setN] = useState(0);
    return <button type="button" onClick={() => setN(n + 1)}>count {n}</button>;
};

describe('FadeOnChange', () => {
    it('keeps its children mounted (and their state) when the key changes', () => {
        const { rerender } = render(<FadeOnChange changeKey="a"><Counter /></FadeOnChange>);
        fireEvent.click(screen.getByRole('button'));
        rerender(<FadeOnChange changeKey="b"><Counter /></FadeOnChange>);
        expect(screen.getByRole('button')).toHaveTextContent('count 1');
    });

    it('passes the className through', () => {
        const { container } = render(<FadeOnChange changeKey="a" className="flex-1"><span /></FadeOnChange>);
        expect(container.firstChild).toHaveClass('flex-1');
    });
});
```

`frontend/src/core/layout/ContentArea.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { ContentArea } from './ContentArea';

vi.mock('../../features/blogs', () => ({ BlogsFeature: () => <div>blogs</div> }));
vi.mock('./InlineSyncView', () => ({ InlineSyncView: () => <div>syncing</div> }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
const show = (feature: FeatureId) => {
    useAppStore.setState({ activeFeatures: { hinatazaka46: feature } });
    return render(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
};

describe('ContentArea', () => {
    it('puts messages straight on the canvas: MessagesFeature lays out its own sheet', () => {
        show('messages');
        expect(screen.getByTestId('messages').closest('.bg-sheet')).toBeNull();
    });

    it('puts blogs on the content sheet', () => {
        show('blogs');
        expect(screen.getByText('blogs').closest('.bg-sheet')).toHaveClass('rounded-sheet', 'shadow-sheet');
    });

    it('shows a translated placeholder for features that are not built yet', () => {
        show('news');
        expect(screen.getByText('News')).toBeInTheDocument();
        expect(screen.getByText('Coming soon')).toBeInTheDocument();
    });
});
```

`frontend/src/core/layout/FeatureRail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { FeatureRail } from './FeatureRail';

vi.mock('../../shell/hooks/useAuth', () => ({
    useAuth: () => ({ isServiceConnected: () => true, checkAuth: vi.fn(), isServiceDisconnected: () => false }),
}));
vi.mock('../../shell/components/LoginModal', () => ({ LoginModal: () => null }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('FeatureRail', () => {
    it('shows icon + translated label entries and marks the active one', async () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'messages' } });
        const { container } = render(<FeatureRail service="hinatazaka46" />);
        expect(screen.getByRole('button', { name: 'Messages' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Blogs' })).not.toHaveAttribute('aria-current');
        expect(container.querySelector('[style]')).toBeNull(); // no inline group colour
        await userEvent.click(screen.getByRole('button', { name: 'Blogs' }));
        expect(useAppStore.getState().getActiveFeature('hinatazaka46')).toBe('blogs');
    });
});
```

`frontend/src/core/layout/ServiceRail.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { ServiceRail } from './ServiceRail';

vi.mock('../../shell/hooks/useAuth', () => ({ useAuth: () => ({ isServiceDisconnected: () => false }) }));
vi.mock('../common/SettingsMenu', () => ({ SettingsMenu: () => null }));
vi.mock('./UpgradeIcon', () => ({ UpgradeIcon: () => null }));
vi.mock('./AddServiceModal', () => ({ AddServiceModal: () => null }));

const renderRail = () => render(
    <ServiceRail
        services={['hinatazaka46', 'sakurazaka46']}
        onAddService={vi.fn()}
        onOpenSettings={vi.fn()}
        onReportIssue={vi.fn()}
        onOpenAbout={vi.fn()}
        onOpenSearch={vi.fn()}
    />,
);

describe('ServiceRail', () => {
    it('is a neutral rail; the active group gets a white ring and the group glow', () => {
        useAppStore.setState({ activeService: 'hinatazaka46' });
        const { container } = renderRail();
        const rail = container.firstChild as HTMLElement;
        expect(rail).toHaveClass('bg-elevated');
        expect(rail.className).not.toMatch(/border-r/);
        const logos = container.querySelectorAll('.rounded-pill.bg-card');
        expect(logos[0]).toHaveClass('ring-2', 'ring-white', 'shadow-group-glow');
        expect(logos[1]).not.toHaveClass('shadow-group-glow');
        expect(container.querySelector('[style]')).toBeNull();
    });

    it('has no group-coloured hovers and no divider line', () => {
        const { container } = renderRail();
        expect(container.innerHTML).not.toMatch(/green-|blue-|bg-gray-300/);
    });
});
```

Run: `npx vitest run src/core/layout`
Expected: FAIL (new modules missing; old classes).

- [ ] **Step 2: Implement FadeOnChange and ContentSheet**

`frontend/src/core/layout/FadeOnChange.tsx`:

```tsx
import React, { useEffect } from 'react';
import { motion as fm, useAnimationControls, useReducedMotion } from 'framer-motion';
import { motion } from '../../design/tokens/motion';

export interface FadeOnChangeProps {
    /** Any change of this value fades the content in again. */
    changeKey: unknown;
    className?: string;
    children: React.ReactNode;
}

/**
 * Fades its children in over `motion.duration.base` whenever `changeKey` changes, without
 * remounting them (feature/service switches keep MessagesFeature's state). No fade with
 * prefers-reduced-motion.
 */
export const FadeOnChange: React.FC<FadeOnChangeProps> = ({ changeKey, className, children }) => {
    const controls = useAnimationControls();
    const reduced = useReducedMotion();
    useEffect(() => {
        if (reduced) {
            controls.set({ opacity: 1 });
            return;
        }
        controls.set({ opacity: 0 });
        void controls.start({
            opacity: 1,
            transition: { duration: motion.duration.base / 1000, ease: [...motion.easing.standard] },
        });
    }, [changeKey, reduced, controls]);
    return <fm.div animate={controls} initial={false} className={className}>{children}</fm.div>;
};
```

`frontend/src/core/layout/ContentSheet.tsx`:

```tsx
import React from 'react';
import { Sheet } from '../../design/primitives';
import { cn } from '../../utils/classnames';

/** The one content sheet (level 1) on the group canvas, 8 px from the frame. */
export const ContentSheet: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <Sheet className={cn('my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden', className)}>{children}</Sheet>
);
```

- [ ] **Step 3: Feature labels from i18n**

In `frontend/src/config/features.ts`, replace in `FeatureDefinition`

```ts
    label: string;
    labelJa: string;
```

with

```ts
    /** i18n key of the feature's name (`features.<id>`). */
    labelKey: string;
```

and in each of the five definitions replace the `label: …,` and `labelJa: …,` lines with one line: `labelKey: 'features.messages',` / `'features.blogs'` / `'features.news'` / `'features.fanclub'` / `'features.ai'` respectively.

In `frontend/src/shell/components/LoginModal.tsx`, replace both `feature: feature?.label ?? featureId` with `feature: feature ? t(feature.labelKey) : featureId`.

- [ ] **Step 4: Rebuild ContentArea, Layout and FeatureRail**

Full replacement of `frontend/src/core/layout/ContentArea.tsx`:

```tsx
// frontend/src/core/layout/ContentArea.tsx
import React from 'react';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { BlogsFeature } from '../../features/blogs';
import { InlineSyncView } from './InlineSyncView';
import { ContentSheet } from './ContentSheet';
import { FadeOnChange } from './FadeOnChange';
import { useTranslation } from '../../i18n';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface ContentAreaProps {
    service: string;
    messagesContent: React.ReactNode;
    syncProgress?: SyncProgress;
    isInitialSyncing?: boolean;
    blogBackupEnabled?: boolean;
}

const ComingSoon: React.FC<{ feature: FeatureId }> = ({ feature }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-1 items-center justify-center text-secondary">
            <div className="text-center">
                <p className="mb-2 text-title">{t(`features.${feature}`)}</p>
                <p className="text-small text-muted">{t('contentArea.comingSoon')}</p>
            </div>
        </div>
    );
};

/**
 * The area right of the feature rail, on the group canvas. Features sit on a ContentSheet;
 * messages lay out their own member sidebar (on the canvas) and chat sheet. Content fades
 * in on every feature or service change.
 */
export const ContentArea: React.FC<ContentAreaProps> = ({
    service,
    messagesContent,
    syncProgress,
    isInitialSyncing,
    blogBackupEnabled,
}) => {
    const { getActiveFeature } = useAppStore();
    const activeFeature = getActiveFeature(service);

    let content: React.ReactNode;
    if (isInitialSyncing && syncProgress?.state === 'running') {
        content = <ContentSheet><InlineSyncView service={service} syncProgress={syncProgress} /></ContentSheet>;
    } else if (activeFeature === 'blogs') {
        content = <ContentSheet><BlogsFeature blogBackupEnabled={blogBackupEnabled} /></ContentSheet>;
    } else if (activeFeature === 'news' || activeFeature === 'fanclub' || activeFeature === 'ai') {
        content = <ContentSheet><ComingSoon feature={activeFeature} /></ContentSheet>;
    } else {
        content = messagesContent;
    }

    return (
        <FadeOnChange changeKey={`${service}:${activeFeature}`} className="flex h-full min-w-0 flex-1">
            {content}
        </FadeOnChange>
    );
};
```

Full replacement of `frontend/src/core/layout/Layout.tsx`:

```tsx
// frontend/src/core/layout/Layout.tsx
import React, { useEffect } from 'react';
import { ServiceRail } from './ServiceRail';
import { FeatureRail } from './FeatureRail';
import { ContentArea } from './ContentArea';
import { Canvas } from '../../design/primitives';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import type { SyncProgress } from '../../features/messages/MessagesFeature';

interface LayoutProps {
    messagesContent: React.ReactNode;
    onAddService: () => void;
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
    onOpenSearch: () => void;
    syncProgressByService?: Record<string, SyncProgress>;
    initialSyncServices?: Record<string, true>;
    blogBackupEnabled?: boolean;
}

/**
 * D-4/D-5 frame: a neutral group rail, then one canvas block (level 0, the official group
 * gradient, rounded on the left) holding the feature rail, each feature's own sidebar and the
 * content sheet.
 */
export const Layout: React.FC<LayoutProps> = ({
    messagesContent,
    onAddService,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
    onOpenSearch,
    syncProgressByService,
    initialSyncServices,
    blogBackupEnabled,
}) => {
    const { t } = useTranslation();
    const { activeService, setActiveService, selectedServices, getServiceOrder } = useAppStore();

    // Sort selected services by global display order
    const serviceOrder = getServiceOrder();
    const services = [...selectedServices].sort(
        (a, b) => serviceOrder.indexOf(a) - serviceOrder.indexOf(b)
    );

    // Auto-select first service if none selected
    useEffect(() => {
        if (services.length > 0 && !activeService) {
            setActiveService(services[0]);
        }
    }, [services, activeService, setActiveService]);

    return (
        <div className="flex h-full flex-1 overflow-hidden bg-elevated">
            <ServiceRail
                services={services}
                onAddService={onAddService}
                onOpenSettings={onOpenSettings}
                onReportIssue={onReportIssue}
                onOpenAbout={onOpenAbout}
                onOpenSearch={onOpenSearch}
            />

            {activeService ? (
                <Canvas className="flex h-full min-w-0 flex-1 rounded-l-sheet">
                    <FeatureRail service={activeService} />
                    <ContentArea
                        service={activeService}
                        messagesContent={messagesContent}
                        syncProgress={syncProgressByService?.[activeService]}
                        isInitialSyncing={!!initialSyncServices?.[activeService]}
                        blogBackupEnabled={blogBackupEnabled}
                    />
                </Canvas>
            ) : (
                <div className="flex flex-1 items-center justify-center text-secondary">
                    <div className="text-center">
                        <p className="mb-2 text-title">{t('landing.welcome')}</p>
                        <p className="text-small">{t('landing.selectService')}</p>
                    </div>
                </div>
            )}
        </div>
    );
};
```

Full replacement of `frontend/src/core/layout/FeatureRail.tsx`:

```tsx
// frontend/src/core/layout/FeatureRail.tsx
import React, { useState } from 'react';
import { useAppStore, FeatureId } from '../../store/appStore';
import { getAvailableFeatures, isFeaturePaid } from '../../config/features';
import { useAuth } from '../../shell/hooks/useAuth';
import { LoginModal } from '../../shell/components/LoginModal';
import { RailItem } from '../../design/primitives';
import { useTranslation } from '../../i18n';

export interface FeatureRailProps {
    service: string;
}

/**
 * Feature rail (D-5): icon + label entries on the group canvas, in the same level-0 block as
 * the feature's sidebar. The selected entry is a white card (RailItem); no group colour.
 */
export const FeatureRail: React.FC<FeatureRailProps> = ({ service }) => {
    const { t } = useTranslation();
    const { getActiveFeature, setActiveFeature, getFeatureOrder, triggerBlogViewReset } = useAppStore();
    const { isServiceConnected, checkAuth, isServiceDisconnected } = useAuth();
    const [loginModal, setLoginModal] = useState<{ featureId: FeatureId } | null>(null);

    const activeFeature = getActiveFeature(service);
    const featureOrder = getFeatureOrder(service);
    const availableFeatures = getAvailableFeatures(service);

    // Sort available features by user preference
    const sortedFeatures = [...availableFeatures].sort((a, b) => {
        const aIndex = featureOrder.indexOf(a.id);
        const bIndex = featureOrder.indexOf(b.id);
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });

    const handleFeatureClick = (featureId: FeatureId) => {
        // Check if feature is paid and service is not connected
        if (isFeaturePaid(featureId) && !isServiceConnected(service)) {
            setLoginModal({ featureId });
            return;
        }

        // If clicking on blogs, trigger a reset to go back to recent posts
        if (featureId === 'blogs') {
            triggerBlogViewReset();
        }
        setActiveFeature(service, featureId);
    };

    const handleLoginSuccess = async () => {
        await checkAuth();
        if (loginModal) {
            // After login, navigate to the feature
            if (loginModal.featureId === 'blogs') {
                triggerBlogViewReset();
            }
            setActiveFeature(service, loginModal.featureId);
        }
        setLoginModal(null);
    };

    return (
        <>
            <nav className="flex w-20 shrink-0 flex-col gap-1 px-2 py-3">
                {sortedFeatures.map(feature => {
                    const Icon = feature.icon;
                    return (
                        <RailItem
                            key={feature.id}
                            icon={<Icon className="h-5 w-5" />}
                            label={t(feature.labelKey)}
                            selected={activeFeature === feature.id}
                            onClick={() => handleFeatureClick(feature.id)}
                        />
                    );
                })}
            </nav>

            {/* Login Modal for paid features */}
            {loginModal && (
                <LoginModal
                    serviceId={service}
                    featureId={loginModal.featureId}
                    onClose={() => setLoginModal(null)}
                    onSuccess={handleLoginSuccess}
                    isDisconnected={isServiceDisconnected(service)}
                />
            )}
        </>
    );
};
```

- [ ] **Step 5: Neutral group rail**

In `frontend/src/core/layout/ServiceRail.tsx`:

(a) Change the imports: drop `getServicePrimaryColor` from the `../../data/services` import and add `import { IconButton } from '../../design/primitives';`.

(b) Root `<div>`: replace `className="w-16 bg-gray-50 h-full flex flex-col items-center py-3 shrink-0 border-r border-gray-200"` with `className="flex h-full w-16 shrink-0 flex-col items-center bg-elevated py-3"`.

(c) In the `services.map`, delete `const primaryColor = getServicePrimaryColor(service);`. Replace both drop-indicator classNames (`"absolute -top-2 … bg-blue-400"` and `"absolute -bottom-2 … bg-blue-400"`) with `"absolute -top-2 left-1/2 w-8 -translate-x-1/2 border-t-2 border-strong"` and `"absolute -bottom-2 left-1/2 w-8 -translate-x-1/2 border-t-2 border-strong"`.

(d) The service `<button>`: replace `className="group relative flex items-center justify-center transition-all duration-200"` with `className="group relative flex items-center justify-center rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"`.

(e) The logo container: replace

```tsx
                                <div
                                    className={cn(
                                        "w-11 h-11 rounded-full bg-white flex items-center justify-center overflow-hidden transition-all duration-200",
                                        "shadow-sm hover:shadow-md hover:scale-105",
                                        isActive ? "ring-[2.5px] ring-offset-1" : "ring-1 ring-gray-200"
                                    )}
                                    style={isActive ? { '--tw-ring-color': primaryColor } as React.CSSProperties : undefined}
                                >
```

with

```tsx
                                <div
                                    className={cn(
                                        'flex h-11 w-11 items-center justify-center overflow-hidden rounded-pill bg-card',
                                        'transition duration-fast ease-standard hover:scale-105',
                                        isActive ? 'ring-2 ring-white shadow-group-glow' : 'shadow-pill hover:shadow-card',
                                    )}
                                >
```

and the short-code fallback span's `"text-gray-600 font-semibold text-sm"` with `'text-small font-semibold text-secondary'`.

(f) Delete the separator (`{/* Separator line */}` and `<div className="w-8 h-px bg-gray-300 my-2" />`) and change the bottom-actions container to `<div className="mt-4 flex flex-col items-center gap-2">`.

(g) Replace the add-service `<button>…</button>` (inside `{!allServicesSelected && (…)}`) with:

```tsx
                    <IconButton
                        variant="secondary"
                        className="h-11 w-11"
                        aria-label={t('serviceRail.addService')}
                        title={t('serviceRail.addService')}
                        icon={<Plus className="h-5 w-5" />}
                        onClick={() => setShowAddModal(true)}
                    />
```

and the search `<button>…</button>` with:

```tsx
                <IconButton
                    variant="secondary"
                    className="h-11 w-11"
                    aria-label={t('search.placeholder')}
                    title={`${t('search.placeholder')} (${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}K)`}
                    icon={<Search className="h-5 w-5" />}
                    onClick={onOpenSearch}
                />
```

The context menu and the disconnected badge stay as they are.

- [ ] **Step 6: MessagesFeature on the canvas and a sheet**

In `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Add `import { ContentSheet } from '../../core/layout/ContentSheet';`.

(b) Replace the sidebar wrapper

```tsx
            <div className={`
                fixed inset-y-0 left-0 z-30 w-80 transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0 bg-white
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
```

with

```tsx
            {/* Member sidebar on the canvas (level 0), next to the feature rail. Below md it slides in over the chat. */}
            <div className={cn(
                'fixed inset-y-0 left-0 z-30 transform transition-transform duration-base ease-standard',
                'max-md:bg-group-canvas md:relative md:translate-x-0',
                isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}>
```

(c) Replace the overlay's `className="fixed inset-0 z-20 bg-black/50 md:hidden"` with `className="fixed inset-0 z-20 bg-scrim md:hidden"`.

(d) Replace `<div className="flex-1 flex flex-col h-full relative min-w-0">` (the `{/* Main Chat Area */}` container) with `<ContentSheet className="relative">`, and the `</div>` that closes it (the one directly before `{/* Member Profile Popup */}`) with `</ContentSheet>`.

- [ ] **Step 7: i18n**

Run the one-liner with:

```json
{"en":{"contentArea.comingSoon":"Coming soon"},"ja":{"contentArea.comingSoon":"近日公開"},"zh-CN":{"contentArea.comingSoon":"即将推出"},"zh-TW":{"contentArea.comingSoon":"即將推出"},"yue":{"contentArea.comingSoon":"就快推出"}}
```

Add `'contentArea.comingSoon',` to `D2A_KEYS` in `src/i18n/d2a.test.ts`.

- [ ] **Step 8: Run the checks and lower the guard baseline**

Run: `npx vitest run src/core/layout src/i18n src/design/guard.test.ts`
Expected: layout and i18n tests PASS; the guard test FAILS only because `Layout.tsx`, `ContentArea.tsx`, `FeatureRail.tsx` and `MessagesFeature.tsx` went down.

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: only lowered numbers or removed entries.

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npx playwright test e2e/timeline-scroll.spec.ts --reporter=line`
Expected: all green; 10 e2e passed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/core/layout frontend/src/config/features.ts frontend/src/shell/components/LoginModal.tsx frontend/src/features/messages/MessagesFeature.tsx frontend/src/i18n frontend/src/design/guard-baseline.json
uv run git commit -m "feat(layout): put rails and content on the canvas and sheet frame" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Member sidebar

**Files:**
- Modify: `frontend/src/features/messages/components/MemberList.tsx`
- Create: `frontend/src/features/messages/components/MemberList.d2a.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `Avatar`, `Badge`, `IconButton` primitives; the canvas block from Task 8.
- Produces: `MemberList` keeps its props. Width 320 px, 376 px at a window width ≥ 1600 px, 432 px at ≥ 1920 px; the grid is `auto-fill` with a 72 px minimum cell, which gives 3 / 4 / 5 columns at those widths with or without a scrollbar.

- [ ] **Step 1: Write the failing test**

`frontend/src/features/messages/components/MemberList.d2a.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { MemberList } from './MemberList';

const PATH = '日向坂46/messages/66 石塚 瑶季/120 石塚 瑶季';
const groups = [
    {
        id: '66', name: '石塚 瑶季', service: 'hinatazaka46', dir_name: '66 石塚 瑶季',
        group_path: '日向坂46/messages/66 石塚 瑶季', member_count: 1, is_group_chat: false,
        is_active: true, server_unread_count: 120,
        members: [{ id: '120', name: '石塚 瑶季', path: PATH }],
    },
    {
        id: '70', name: '卒業 メンバー', service: 'hinatazaka46', dir_name: '70 卒業 メンバー',
        group_path: '日向坂46/messages/70 卒業 メンバー', member_count: 1, is_group_chat: false,
        is_active: false, is_graduated: true, server_unread_count: 0,
        members: [{ id: '130', name: '卒業 メンバー', path: '日向坂46/messages/70 卒業 メンバー/130 卒業 メンバー' }],
    },
];

beforeAll(async () => { await i18n.changeLanguage('en'); });

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups, last_sync: {} })),
        http.post('/api/content/unread_counts', () => HttpResponse.json({ [PATH]: 120 })),
    );
}

describe('MemberList (D2a)', () => {
    it('selects with a white ring and the group glow, and caps the badge at 99+', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" selectedGroupDir={PATH} onSelectGroup={vi.fn()} />);
        expect(await screen.findByText('99+')).toHaveClass('bg-group-badge');
        const avatar = screen.getByRole('img', { name: /石塚/ }).parentElement!;
        expect(avatar).toHaveClass('ring-2', 'ring-white', 'shadow-group-glow');
    });

    it('uses sticky pill headings and a floating sync pill, with no divider lines or own gradient', async () => {
        serve();
        const onSyncNow = vi.fn();
        const { container } = render(<MemberList activeService="hinatazaka46" onSelectGroup={vi.fn()} onSyncNow={onSyncNow} />);
        const online = await screen.findByRole('heading', { name: 'Online' });
        expect(online).toHaveClass('rounded-pill', 'shadow-pill');
        expect(online.parentElement).toHaveClass('sticky');
        expect(screen.getByRole('heading', { name: 'Graduated' })).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('Sync now'));
        expect(onSyncNow).toHaveBeenCalledOnce();
        expect(container.innerHTML).not.toMatch(/border-t|border-b/);
        expect(container.querySelector('[style*="gradient"]')).toBeNull();
    });
});
```

Run: `npx vitest run src/features/messages/components/MemberList.d2a.test.tsx`
Expected: FAIL.

- [ ] **Step 2: Rebuild the grid, headings, root and sync pill**

In `frontend/src/features/messages/components/MemberList.tsx`:

(a) Imports: remove `useMemo` from the React import and remove `import { useMessagesTheme } from '../hooks/useMessagesTheme';`; add `import { Avatar, Badge, IconButton } from '../../../design/primitives';`.

(b) Delete the two theme lines:

```tsx
    const theme = useMessagesTheme();
    const sidebarGradient = useMemo(() => theme.messages.sidebarGradient, [theme.messages.sidebarGradient]);
```

(c) Replace the whole `renderGroupGrid` function with:

```tsx
    const renderGroupGrid = (groupList: GroupInfo[], isGraduated = false) => (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-x-2 gap-y-4">
            {groupList.map(group => {
                const info = getGroupDisplayInfo(group);
                const isSelected = selectedGroupDir === info.path;
                const unreadCount = unreadCounts[info.path] || 0;

                return (
                    <button
                        key={group.id}
                        type="button"
                        onClick={() => onSelectGroup(info.path, info.isGroupChat, info.displayName)}
                        onContextMenu={info.isGroupChat ? undefined : (e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, path: info.path });
                        }}
                        className="group relative flex flex-col items-center gap-1 rounded-card py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                        title={isGraduated ? t('memberList.graduatedTooltip') : undefined}
                    >
                        {/* Hover: the avatar lifts slightly. Graduated / inactive members keep their muted look. */}
                        <span
                            className="transition-transform duration-fast ease-standard group-hover:scale-105"
                            style={isGraduated
                                ? { filter: 'sepia(0.3) saturate(0.6) contrast(0.9)' }
                                : !info.isActive ? { filter: 'saturate(0.5) contrast(0.8)' } : undefined}
                        >
                            {info.isGroupChat && !info.avatar ? (
                                <span className={cn(
                                    'flex h-16 w-16 items-center justify-center rounded-pill bg-sunken text-secondary',
                                    'transition-shadow duration-fast ease-standard',
                                    isSelected ? 'ring-2 ring-white shadow-group-glow' : 'group-hover:shadow-card',
                                )}>
                                    <Users className="h-6 w-6" />
                                </span>
                            ) : (
                                <Avatar
                                    src={info.avatar ?? undefined}
                                    name={info.displayName}
                                    size="lg"
                                    selected={isSelected}
                                    className={cn('h-16 w-16', !isSelected && 'group-hover:shadow-card')}
                                />
                            )}
                        </span>

                        <Badge count={unreadCount} className="absolute right-1 top-0 z-10" />

                        <span className={cn(
                            'line-clamp-2 max-w-full text-center text-caption transition-colors duration-fast ease-standard',
                            isSelected ? 'font-semibold text-group-strong' : 'text-secondary group-hover:text-primary',
                        )}>
                            {info.displayName}
                        </span>
                    </button>
                );
            })}
        </div>
    );
```

(d) Add at module scope, directly above `export const MemberList`:

```tsx
/** Sticky section heading (online / offline / graduated), styled as a small pill. */
const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="sticky top-0 z-20 flex justify-center py-2">
        <h2 className="rounded-pill bg-pill px-3 py-1 text-caption font-semibold text-secondary shadow-pill">{children}</h2>
    </div>
);
```

(e) Replace everything from `return (` (the component's outer `<div className="w-80 h-full flex flex-col" style={{ background: … }}>`) down to, but not including, `{menu && (` with:

```tsx
    return (
        <div className="relative flex h-full w-80 flex-col min-[1600px]:w-[376px] min-[1920px]:w-[432px]">
            {/* Title row */}
            <div className="relative flex items-center justify-center px-4 py-3">
                <h1 className="text-title font-semibold text-primary">{t('memberList.title')}</h1>
                <div className="absolute right-4 flex items-center gap-2">
                    {isSyncing && <RefreshCw className="h-4 w-4 animate-spin text-secondary" />}
                </div>
            </div>

            {/* Group grid; bottom padding keeps the last row clear of the floating sync pill */}
            <div className="flex-1 overflow-y-auto px-2 pb-16">
                {loading ? (
                    <div className="flex flex-col items-center gap-2 p-6 text-center text-small text-secondary">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span>{t('memberList.loadingConversations')}</span>
                    </div>
                ) : groups.length === 0 ? (
                    <div className="p-6 text-center text-small text-secondary">
                        {t('memberList.noConversations')}
                    </div>
                ) : null}

                {onlineGroups.length > 0 && (
                    <>
                        <SectionHeading>{t('memberList.online')}</SectionHeading>
                        {renderGroupGrid(onlineGroups)}
                    </>
                )}

                {offlineGroups.length > 0 && (
                    <div className="mt-4">
                        <SectionHeading>{t('memberList.offline')}</SectionHeading>
                        {renderGroupGrid(offlineGroups)}
                    </div>
                )}

                {/* Graduated Section - only shown when members have local backup */}
                {graduatedGroups.length > 0 && (
                    <div className="mt-4">
                        <SectionHeading>{t('memberList.graduated')}</SectionHeading>
                        {renderGroupGrid(graduatedGroups, true)}
                    </div>
                )}
            </div>

            {/* Floating sync pill */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <div className="pointer-events-auto inline-flex items-center gap-1 rounded-pill bg-pill py-1 pl-3 pr-1 text-caption text-secondary shadow-pill">
                    {isSyncing ? (
                        <span className="flex items-center gap-1 py-1 pr-2 font-semibold">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            {t('sync.syncing')}
                        </span>
                    ) : (
                        <>
                            <span className={onSyncNow ? undefined : 'pr-2'}>
                                {activeService && lastSyncMap[activeService]
                                    ? t('sync.lastSynced', { time: formatRelativeTime(lastSyncMap[activeService], t) })
                                    : t('sync.notSynced')}
                            </span>
                            {onSyncNow && (
                                <IconButton
                                    size="sm"
                                    className="h-6 w-6"
                                    aria-label={t('sync.syncNow')}
                                    title={t('sync.syncNow')}
                                    icon={<RefreshCw className="h-3 w-3" />}
                                    onClick={onSyncNow}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

```

(the existing `{menu && (…)}`, `{viewer && (…)}` and the closing `</div>` / `);` stay).

- [ ] **Step 3: Run the sidebar tests and lower the guard**

Run: `npx vitest run src/features/messages/components/MemberList`
Expected: PASS (the new test plus the existing collision / unreadKept / contextMenu tests).

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `MemberList.tsx` lowered (or removed).

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/messages/components/MemberList.tsx frontend/src/features/messages/components/MemberList.d2a.test.tsx frontend/src/design/guard-baseline.json
uv run git commit -m "feat(sidebar): restyle the member grid with avatars, badges and pills" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Chat — header, runs, bubbles

**Files:**
- Modify: `frontend/src/design/tokens/radius.ts`, `frontend/src/design/tokens/tokens.test.ts:110`, `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts`, `frontend/src/design/DesignPage.tsx`, `docs/design/DESIGN_SYSTEM.md`
- Create: `frontend/src/features/messages/hooks/useMemberStreak.ts` + `useMemberStreak.test.ts`
- Modify: `frontend/src/features/messages/components/MemberProfilePopup.tsx` + create `MemberProfilePopup.streak.test.tsx`
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx` + `MessageBubble.test.tsx` (+ snapshot)
- Modify: `frontend/src/features/messages/components/MessageList.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: locale files, `src/i18n/d2a.test.ts`, `src/design/guard-baseline.json`
- Modify: `frontend/e2e/fixtures/bigRoom.ts`; create `frontend/e2e/chat-frame.spec.ts`

**Interfaces:**
- Consumes: `TimelineItem.runStart` (Task 3); `FadeOnChange` (Task 8); the `streak_load` client-log event (Task 7).
- Produces: tokens `radius.tail = '4px'` (utility `rounded-tl-tail`) and `bg-group-title` (the official title gradient from `--ds-group-title-from/via/to`); `useMemberStreak(groupId?: string, service?: string, now?: () => Date) → { streak: StreakState; retry: () => void }` backed by a module-level session cache keyed `streakCacheKey(service, groupId, now) = "<service>|<groupId>|<toLocalDateStr(now)>"` (at most one request per room per local day; concurrent callers share one in-flight promise; failures are not cached and log `streak_load` `{outcome: 'error'}`, successes `{outcome: 'ok'}`), plus `resetStreakCache()` for tests, with `type StreakState = { status: 'idle' } | { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; days: number }`; `MemberProfilePopup` props `streak?: StreakState; onRetryStreak?: () => void` (replaces its own fetch and the `groupId` prop); `MessageBubble` prop `runStart?: boolean` (default true); i18n key `messageList.openConversations`.

- [ ] **Step 1: Add the two tokens**

`frontend/src/design/tokens/radius.ts` becomes:

```ts
/** Corner radius, one step per visual level (background has none). */
export const radius = {
    none: '0px',
    /** Only the first bubble of a run: its small top-left corner (`rounded-tl-tail`). */
    tail: '4px',
    card: '14px',
    sheet: '20px',
    pill: '9999px',
} as const;

export type RadiusStep = keyof typeof radius;
```

In `frontend/src/design/tokens/tokens.test.ts:110` change the pinned object to `{ none: '0px', tail: '4px', card: '14px', sheet: '20px', pill: '9999px' }`.

In `frontend/tailwind.config.js`: add `'group-title': 'linear-gradient(to right, var(--ds-group-title-from), var(--ds-group-title-via), var(--ds-group-title-to))',` to `backgroundImage` (above `'group-title-bar'`), and `tail: 'var(--ds-radius-tail)',` to `borderRadius` (above `card`).

In `frontend/src/utils/classnames.ts` replace the `bg-image` and `rounded` entries with:

```ts
            'bg-image': [{ bg: ['group-canvas', 'group-title', 'group-title-bar'] }],
            rounded: [{ rounded: ['tail', 'card', 'sheet', 'pill'] }],
            'rounded-tl': [{ 'rounded-tl': ['tail'] }],
```

In `frontend/src/design/DesignPage.tsx`: `RADIUS_CLASS` gets `tail: 'rounded-tail',` (after `none`), and `groupSwatches` gets, before `['title.text', …]`:

```ts
        ['title.gradient', `linear-gradient(to right, ${groupTokenVars(group)['--ds-group-title-from']}, ${groupTokenVars(group)['--ds-group-title-via']}, ${groupTokenVars(group)['--ds-group-title-to']})`],
```

In `docs/design/DESIGN_SYSTEM.md`, replace the radius row of the Scales table

```markdown
| Radius | `rounded-card` `rounded-sheet` `rounded-pill` (and Tailwind's built-in `rounded-none`) | 14px, 20px, full |
```

with

```markdown
| Radius | `rounded-tail` `rounded-card` `rounded-sheet` `rounded-pill` (and Tailwind's built-in `rounded-none`) | 4px (only the first bubble's top-left corner, as `rounded-tl-tail`), 14px, 20px, full |
```

and the bullet

```markdown
- **Official layer:** `bg-group-title-bar`, `text-group-title`, `--ds-group-title-*`,
  the canvas and the shelters.
```

with

```markdown
- **Official layer:** `bg-group-title` (the title gradient), `bg-group-title-bar`,
  `text-group-title`, `--ds-group-title-*`, the canvas and the shelters.
```

Run: `npx vitest run src/design`
Expected: PASS (tokens, tailwind var check, DesignPage).

- [ ] **Step 2: Write the failing streak tests**

`frontend/src/features/messages/hooks/useMemberStreak.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { useMemberStreak, resetStreakCache, streakCacheKey } from './useMemberStreak';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

/** Serves /api/chat/streak/:id (days = id * 2) and counts the requests. */
function serveStreak(opts: { fail?: () => boolean; wait?: number } = {}) {
    const calls = { count: 0 };
    server.use(http.get('/api/chat/streak/:id', async ({ params }) => {
        calls.count += 1;
        if (opts.wait) await delay(opts.wait);
        if (opts.fail?.()) return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
        return HttpResponse.json({ days: Number(params.id) * 2, is_active: true });
    }));
    return calls;
}

beforeEach(() => {
    resetStreakCache();
    vi.mocked(clientLog).mockClear();
});

describe('useMemberStreak', () => {
    it('is idle without a group id and makes no request', () => {
        const calls = serveStreak();
        const { result } = renderHook(() => useMemberStreak(undefined, 'hinatazaka46'));
        expect(result.current.streak).toEqual({ status: 'idle' });
        expect(calls.count).toBe(0);
    });

    it('keys the cache by service, group and local day', () => {
        expect(streakCacheKey('hinatazaka46', '64', new Date(2026, 10, 4, 23, 59))).toBe('hinatazaka46|64|2026-11-04');
        expect(streakCacheKey('hinatazaka46', '64', new Date(2026, 10, 5, 0, 1))).toBe('hinatazaka46|64|2026-11-05');
    });

    it('fetches once across repeated opens of the same room on the same day', async () => {
        const calls = serveStreak();
        const first = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(first.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        first.unmount();
        // Another room in between, then back: the cached value is used at once.
        const other = renderHook(({ id }) => useMemberStreak(id, 'hinatazaka46'), { initialProps: { id: '5' } });
        await waitFor(() => expect(other.result.current.streak).toEqual({ status: 'ready', days: 10 }));
        other.rerender({ id: '64' });
        expect(other.result.current.streak).toEqual({ status: 'ready', days: 128 });
        const again = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        expect(again.result.current.streak).toEqual({ status: 'ready', days: 128 });
        expect(calls.count).toBe(2); // room 64 once, room 5 once
    });

    it('fetches again once the local date has changed', async () => {
        const calls = serveStreak();
        let now = new Date(2026, 10, 4, 23, 50);
        const first = renderHook(() => useMemberStreak('64', 'hinatazaka46', () => now));
        await waitFor(() => expect(first.result.current.streak.status).toBe('ready'));
        first.unmount();
        now = new Date(2026, 10, 5, 0, 10);
        const next = renderHook(() => useMemberStreak('64', 'hinatazaka46', () => now));
        await waitFor(() => expect(next.result.current.streak.status).toBe('ready'));
        expect(calls.count).toBe(2);
    });

    it('shares one in-flight request between concurrent users of the same room', async () => {
        const calls = serveStreak({ wait: 30 });
        const header = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        const popup = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(header.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        await waitFor(() => expect(popup.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        expect(calls.count).toBe(1);
        expect(vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'streak_load')).toEqual([
            ['streak_load', { outcome: 'ok' }],
        ]);
    });

    it('does not cache a failure: it logs, and the next open (or retry) fetches again', async () => {
        let fail = true;
        const calls = serveStreak({ fail: () => fail });
        const first = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(first.result.current.streak).toEqual({ status: 'error', message: 'Not authenticated' }));
        expect(clientLog).toHaveBeenCalledWith('streak_load', { outcome: 'error' });
        first.unmount();
        fail = false;
        const again = renderHook(() => useMemberStreak('64', 'hinatazaka46'));
        await waitFor(() => expect(again.result.current.streak).toEqual({ status: 'ready', days: 128 }));
        expect(calls.count).toBe(2);
        fail = true;
        resetStreakCache();
        act(() => again.result.current.retry());
        await waitFor(() => expect(again.result.current.streak.status).toBe('error'));
        fail = false;
        act(() => again.result.current.retry());
        await waitFor(() => expect(again.result.current.streak).toEqual({ status: 'ready', days: 128 }));
    });

    it('ignores a late answer for the previous room', async () => {
        server.use(http.get('/api/chat/streak/:id', async ({ params }) => {
            if (params.id === '1') await delay(50);
            return HttpResponse.json({ days: Number(params.id), is_active: true });
        }));
        const { result, rerender } = renderHook(({ id }) => useMemberStreak(id, 'hinatazaka46'), { initialProps: { id: '1' } });
        rerender({ id: '2' });
        await waitFor(() => expect(result.current.streak).toEqual({ status: 'ready', days: 2 }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(result.current.streak).toEqual({ status: 'ready', days: 2 });
    });
});
```

`frontend/src/features/messages/components/MemberProfilePopup.streak.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { MemberProfilePopup } from './MemberProfilePopup';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('MemberProfilePopup streak', () => {
    it('shows the shared streak and retries through the callback', async () => {
        const onRetry = vi.fn();
        const { rerender } = render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" streak={{ status: 'ready', days: 128 }} />);
        expect(screen.getByText('128')).toBeInTheDocument();
        rerender(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" streak={{ status: 'error', message: 'boom' }} onRetryStreak={onRetry} />);
        expect(screen.getByText('boom')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('never fetches the streak itself', () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="A" />);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
```

Run: `npx vitest run src/features/messages/hooks/useMemberStreak.test.ts src/features/messages/components/MemberProfilePopup.streak.test.tsx`
Expected: FAIL.

- [ ] **Step 3: One streak source**

`frontend/src/features/messages/hooks/useMemberStreak.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { parseErrorDetail } from '../../../utils/httpError';
import { clientLog } from '../../../utils/clientLog';
import { toLocalDateStr } from '../../../utils/dateFormatters';

export type StreakState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; days: number };

/**
 * App-session cache of the official subscription streak: at most one request per room per
 * local day. Successful answers only; a failure is never cached. In-flight requests are
 * shared, so the header and the profile popup (or a quick re-open) never ask twice.
 */
const streakCache = new Map<string, number>();
const inFlight = new Map<string, Promise<number>>();

/** Cache key: service, group id and the local day (toLocalDateStr) of `now`. */
export function streakCacheKey(service: string, groupId: string, now: Date): string {
    return `${service}|${groupId}|${toLocalDateStr(now)}`;
}

/** Test seam: forget every cached and in-flight streak. */
export function resetStreakCache(): void {
    streakCache.clear();
    inFlight.clear();
}

/** One shared request per key; caches the days on success and logs one `streak_load` breadcrumb per request. */
function loadStreak(key: string, service: string, groupId: string, fallbackError: string): Promise<number> {
    const running = inFlight.get(key);
    if (running) return running;
    const request = (async () => {
        try {
            const url = `/api/chat/streak/${encodeURIComponent(groupId)}?service=${encodeURIComponent(service)}`;
            const res = await fetch(url);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(parseErrorDetail(body, fallbackError));
            }
            const data = await res.json() as { days?: number };
            const days = data.days ?? 0;
            streakCache.set(key, days);
            clientLog('streak_load', { outcome: 'ok' });
            return days;
        } catch (err: unknown) {
            clientLog('streak_load', { outcome: 'error' });
            throw err instanceof Error ? err : new Error(fallbackError);
        } finally {
            inFlight.delete(key);
        }
    })();
    inFlight.set(key, request);
    return request;
}

/**
 * The subscription streak of the open room (GET /api/chat/streak/{groupId}), shared by the
 * chat header and the profile popup. Served from the session cache when this room was already
 * fetched today (local date), otherwise fetched once (concurrent callers share the request).
 * A late answer for a room the user has left is ignored (SD-FE-GAP-B-01). On failure the state
 * is 'error' (the header omits the day count; the popup offers `retry`, which fetches again).
 * `now` is a test seam for the clock.
 */
export function useMemberStreak(
    groupId: string | undefined,
    service: string | undefined,
    now: () => Date = () => new Date(),
) {
    const { t } = useTranslation();
    const [streak, setStreak] = useState<StreakState>({ status: 'idle' });
    const [attempt, setAttempt] = useState(0);
    const retry = useCallback(() => setAttempt((a) => a + 1), []);

    useEffect(() => {
        if (!groupId) {
            setStreak({ status: 'idle' });
            return;
        }
        // `service` is a required backend query param; without it the request would 422.
        if (!service) {
            setStreak({ status: 'error', message: t('memberProfile.noService') });
            return;
        }
        const key = streakCacheKey(service, groupId, now());
        const cached = streakCache.get(key);
        if (cached !== undefined) {
            setStreak({ status: 'ready', days: cached });
            return;
        }
        let cancelled = false;
        setStreak({ status: 'loading' });
        loadStreak(key, service, groupId, t('memberProfile.fetchFailed'))
            .then((days) => { if (!cancelled) setStreak({ status: 'ready', days }); })
            .catch((err: unknown) => {
                if (cancelled) return;
                setStreak({ status: 'error', message: err instanceof Error ? err.message : t('memberProfile.fetchFailed') });
            });
        return () => { cancelled = true; };
        // The clock is read when the effect runs (room open / retry); it is not a dependency.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, service, attempt, t]);

    return { streak, retry };
}
```

In `frontend/src/features/messages/components/MemberProfilePopup.tsx`:
- Imports: `import React, { useState, useEffect, useMemo } from 'react';` (drop `useCallback`); remove `import { parseErrorDetail } from '../../../utils/httpError';`; add `import type { StreakState } from '../hooks/useMemberStreak';`.
- Delete `interface StreakData { … }`.
- In `MemberProfilePopupProps` replace `groupId?: string;` with:

```ts
    /** The room's streak from MessagesFeature's useMemberStreak (session cache, once per room per day). */
    streak?: StreakState;
    onRetryStreak?: () => void;
```

- In the destructuring replace `groupId,` with `streak = { status: 'idle' },` and `onRetryStreak,`.
- Delete the state lines for `streak`, `loading`, `error`, `retryCounter`, `retry`, and delete the whole streak-fetch `useEffect` (the one with the SD-FE-GAP-B-01 comment).
- In the "Reset when closed" effect keep only `setViewerKind(null);`.
- Replace the `{/* Streak Display */}` conditional with:

```tsx
                        {/* Streak Display */}
                        {streak.status === 'loading' ? (
                            <div className="flex items-center justify-center py-4">
                                <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                            </div>
                        ) : streak.status === 'error' ? (
                            <div className="text-center text-red-600 py-2">
                                <p className="text-sm">{streak.message}</p>
                                <button
                                    onClick={onRetryStreak}
                                    className="text-xs text-red-500 hover:underline mt-1"
                                >
                                    {t('memberProfile.retry')}
                                </button>
                            </div>
                        ) : streak.status === 'ready' && streak.days > 0 ? (
                            <p className="text-lg text-gray-700">
                                <Trans
                                    i18nKey="memberProfile.subscribedDays"
                                    values={{ days: streak.days }}
                                    components={{ num: <span className="font-bold text-2xl text-gray-900" /> }}
                                />
                            </p>
                        ) : (
                            <p className="text-lg text-gray-500">
                                {t('memberProfile.startSubscription')}
                            </p>
                        )}
```

(The popup's look is a dialog and stays for D2c; only its data source changes.)

Run: `npx vitest run src/features/messages/hooks/useMemberStreak.test.ts src/features/messages/components/MemberProfilePopup`
Expected: PASS (new tests and the existing `MemberProfilePopup.images.test.tsx`).

- [ ] **Step 4: Write the failing bubble tests**

In `frontend/src/features/messages/components/MessageBubble.test.tsx`:
- `'should render timestamp in expected format'`: replace its two body lines after `render(...)` with `expect(screen.getByText('10:30')).toBeInTheDocument()` (the run time is `HH:mm`; the date is in the date pill).
- `'makes the avatar look clickable only with onAvatarClick'`: replace `'hover:ring'` with `'hover:shadow-card'` and `'hover:ring-2'` with `'hover:shadow-card'`.
- `'should render initials when no avatar provided'`: expect `screen.getByText('T')` (the `Avatar` primitive shows the first character).
- Append inside `describe('MessageBubble component', …)`:

```tsx
  it('a later bubble of a run hides avatar and name and shows its time on hover', () => {
    render(<MessageBubble {...defaultProps} runStart={false} />)
    expect(screen.queryByText('Test User')).toBeNull()
    expect(screen.queryByRole('img', { name: 'Test User' })).toBeNull()
    expect(screen.getByText('10:30')).toHaveClass('opacity-0', 'group-hover/row:opacity-100')
  })

  it('only the first bubble of a run keeps the small top-left corner', () => {
    const { container, rerender } = render(<MessageBubble {...defaultProps} />)
    expect(container.querySelector('.border-group-bubble')).toHaveClass('rounded-card', 'rounded-tl-tail', 'shadow-card')
    rerender(<MessageBubble {...defaultProps} runStart={false} />)
    expect(container.querySelector('.border-group-bubble')).toHaveClass('rounded-card')
    expect(container.querySelector('.border-group-bubble')).not.toHaveClass('rounded-tl-tail')
  })

  it('names the sender with the strong group role', () => {
    render(<MessageBubble {...defaultProps} />)
    expect(screen.getByText('Test User')).toHaveClass('text-group-strong')
  })
```

Run: `npx vitest run src/features/messages/components/MessageBubble.test.tsx`
Expected: FAIL (new and changed expectations; snapshots also differ).

- [ ] **Step 5: Runs and token bubbles**

In `frontend/src/features/messages/components/MessageBubble.tsx`:

(a) Add `import { Avatar } from '../../../design/primitives';`.

(b) In `MessageBubbleProps` add:

```ts
    /** First message of a run (same sender, same day, ≤ 5 min apart): shows avatar, name and time. */
    runStart?: boolean;
```

and `runStart = true,` to the destructuring (after `userNickname,`).

(c) Replace the `const dateStr = …;` line with:

```ts
    const time = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    // Card radius; the first bubble of a run keeps a small top-left corner.
    const bubbleCorners = cn('rounded-card', runStart && 'rounded-tl-tail');
```

(d) In `ShelterOverlay`, delete `const bgColor = isLightStyle ? '#FFFFFF' : themeColor;` and replace

```tsx
                className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer transition-colors rounded-2xl"
                style={{ backgroundColor: bgColor, border: borderStyle }}
```

with

```tsx
                className={cn('absolute inset-0 z-10 flex cursor-pointer items-center justify-center transition-colors', bubbleCorners, isLightStyle && 'bg-card')}
                style={{ backgroundColor: isLightStyle ? undefined : themeColor, border: borderStyle }}
```

(e) Replace the component's main `return ( … );` (from the `return (` above `{/* Context Menu */}` to the `);` right before the closing `};` of `MessageBubbleComponent`) with:

```tsx
    const favoriteStar = message.is_favorite && (
        <Star
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: theme?.favoriteColor || '#3b82f6', fill: theme?.favoriteColor || '#3b82f6' }}
        />
    );
    const translateButton = translationEnabled && hasTextContent && !isUnread && translationState !== 'done' && (
        <div className={cn(
            'transition-opacity duration-fast ease-standard',
            translationState === 'loading' || translationState === 'error' ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
        )}>
            <TranslateButton
                state={translationState}
                onClick={triggerTranslation}
                error={translationError}
                accentColor={service ? getServiceTheme(service).primaryColor : undefined}
            />
        </div>
    );

    return (
        <div
            className={cn('group/row relative flex gap-3', runStart ? 'pt-3' : 'pt-1')}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStartFavorite}
            onTouchEnd={handleTouchEndFavorite}
            onTouchCancel={handleTouchEndFavorite}
        >
            {/* Context Menu */}
            {contextMenu && (
                <MessageContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    isFavorite={message.is_favorite}
                    onToggleFavorite={handleToggleFavorite}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Avatar column: the avatar shows once, at the top of a run */}
            <div className="w-10 shrink-0">
                {runStart && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAvatarClick?.();
                        }}
                        // Only a clickable avatar (it opens a profile card) looks
                        // clickable; the room author (member 0) gets no handler.
                        className={cn(
                            'block rounded-pill',
                            onAvatarClick
                                ? 'cursor-pointer transition-shadow duration-fast ease-standard hover:shadow-card'
                                : 'cursor-default',
                        )}
                    >
                        <Avatar src={member_avatar} name={member_name} size="md" />
                    </button>
                )}
            </div>

            <div className="flex min-w-0 max-w-[80%] flex-col">
                {/* Name, time, favorite star and translate button: once per run */}
                {runStart && (
                    <div className="mb-1 flex items-center gap-2">
                        <span className="text-small font-semibold text-group-strong">{member_name}</span>
                        <time className="text-caption text-muted" dateTime={message.timestamp}>{time}</time>
                        {favoriteStar}
                        {translateButton && <div className="ml-auto">{translateButton}</div>}
                    </div>
                )}

                {/* Bubble Container */}
                <div className="relative">
                    {isUnread && <ShelterOverlay />}

                    <div
                        className={cn(
                            'border border-group-bubble bg-card shadow-card transition-opacity duration-base ease-standard',
                            bubbleCorners,
                            message.type === 'voice' ? 'overflow-visible p-0' : 'overflow-hidden p-3',
                            isUnread && 'pointer-events-none opacity-0', // Hide content but keep layout
                        )}
                    >

                        {/* Picture */}
                        {message.type === 'picture' && mediaUrl && (
                            <MediaContainer message={message}>
                                <PhotoPlayer
                                    variant="bubble"
                                    src={mediaUrl}
                                    alt={t('messageList.attachment')}
                                    onClick={() => onMediaClick?.(mediaUrl, 'picture', message.timestamp)}
                                />
                            </MediaContainer>
                        )}

                        {/* Video */}
                        {message.type === 'video' && mediaUrl && (
                            <MediaContainer message={message} isVideo>
                                <VideoPlayer
                                    src={mediaUrl}
                                    messageTimestamp={message.timestamp}
                                    noAudio={message.is_muted}
                                    className="w-full h-full"
                                    videoClassName="w-full h-full object-contain"
                                    onTimeUpdate={setPlayerTime}
                                    seekTo={seekTarget}
                                    transcriptionSegments={transcription?.segments}
                                />
                            </MediaContainer>
                        )}

                        {/* Voice */}
                        {message.type === 'voice' && mediaUrl && (
                            <VoicePlayer
                                src={mediaUrl}
                                accentColor={theme?.voicePlayerAccent}
                                messageTimestamp={message.timestamp}
                                onTimeUpdate={setPlayerTime}
                                seekTo={seekTarget}
                            />
                        )}

                        {/* Text */}
                        {message.content && (
                            <div className={cn(
                                'whitespace-pre-wrap text-body text-primary',
                                message.type === 'voice' && 'p-3 pt-2',
                            )}>
                                <LinkifiedText text={message.content} linkColor={theme?.linkColor} />
                            </div>
                        )}

                        {/* Inline translation display */}
                        {translationEnabled && hasTextContent && !isUnread && translation && (
                            <InlineTranslation
                                translation={translation}
                                variant="message"
                                onRerun={retriggerTranslation}
                                defaultExpanded={translationJustCompleted}
                                messageId={message.id}
                            />
                        )}

                        {/* Fallback for missing content */}
                        {!message.content && !mediaUrl && (
                            <div className="text-small italic text-muted">
                                {t('messageList.noContent')}
                            </div>
                        )}
                    </div>
                </div>

                {/* Transcription footer — only for voice/video, hidden when unread shelter is active */}
                {transcriptionEnabled && isTranscribable && !isUnread && (
                    <div
                        className="rounded-b-xl border-t-0 border px-3 py-1.5 -mt-1"
                        style={{
                            borderColor: `${theme?.voicePlayerAccent || FALLBACK_ACTION_COLOR}30`,
                            background: `${theme?.voicePlayerAccent || FALLBACK_ACTION_COLOR}05`,
                        }}
                    >
                        {transcriptionState !== 'done' ? (
                            <TranscribeButton
                                state={transcriptionState}
                                onClick={triggerTranscription}
                                error={transcriptionError}
                                accentColor={theme?.voicePlayerAccent}
                                variant="dark"
                            />
                        ) : (
                            transcription && (
                                <TranscriptPanel
                                    segments={transcription.segments}
                                    noSpeech={transcription.no_speech}
                                    currentTime={playerTime}
                                    onSeek={setSeekTarget}
                                    onRerun={retriggerTranscription}
                                    accentColor={theme?.voicePlayerAccent}
                                    variant="dark"
                                    defaultExpanded={transcriptionJustCompleted}
                                    messageId={message.id}
                                />
                            )
                        )}
                    </div>
                )}
            </div>

            {/* Later bubbles of a run: star, translate button and the time (on hover) beside the bubble */}
            {!runStart && (
                <div className="flex shrink-0 flex-col items-start justify-end gap-1 pb-1">
                    {favoriteStar}
                    {translateButton}
                    <time
                        className="text-caption text-muted opacity-0 transition-opacity duration-fast ease-standard group-hover/row:opacity-100"
                        dateTime={message.timestamp}
                    >
                        {time}
                    </time>
                </div>
            )}
        </div>
    );
```

In `frontend/src/features/messages/components/MessageList.tsx`, in `renderItem`: change the row class to `cn('rounded-card px-4 pb-1', highlightedRowKey === rowKey && 'animate-landing')` and pass `runStart={item.runStart}` to `<MessageBubble>`.

Run: `npx vitest run src/features/messages/components/MessageBubble.test.tsx -u`, then review `git diff src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap`: only class names (token classes), the `HH:mm` time and the `Avatar` markup may change. Then run the whole folder without `-u`:

Run: `npx vitest run src/features/messages`
Expected: PASS.

- [ ] **Step 6: The chat header, unread arrows and the fade**

In `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Imports: change the i18n import to `import { useTranslation, Trans } from '../../i18n';` and add:

```ts
import { Avatar, IconButton } from '../../design/primitives';
import { FadeOnChange } from '../../core/layout/FadeOnChange';
import { useMemberStreak } from './hooks/useMemberStreak';
```

(b) Directly above `const getSenderInfo = useCallback(` add:

```ts
    // The 1:1 room's member: header avatar, the ⋯ menu and the profile popup.
    const headerMember = Object.values(membersMap)[0];
    const headerAvatar = memberImageUrl(headerMember, 'thumbnail') || headerMember?.portrait || undefined;
    const isLightHeader = theme.messages.headerStyle === 'light';
    // Streak from the session cache (one official request per room per local day), shared by the header and the profile popup.
    const groupId = selectedGroupDir?.split('/')[2]?.split(' ')[0];
    const { streak, retry: retryStreak } = useMemberStreak(groupId, activeService ?? undefined);
```

(c) Replace everything from `{/* Header */}` through the end of the `{/* Gradient Bar below header (only for light style) */}` block with:

```tsx
                {/* Header: the official title layer (gradient, or Sakurazaka's white header + thin bar) */}
                <header
                    className={cn(
                        'z-20 flex h-16 shrink-0 items-center gap-3 px-4',
                        isLightHeader ? 'bg-sheet text-group-title' : 'bg-group-title text-inverse',
                    )}
                >
                    <IconButton
                        className="text-current md:hidden"
                        aria-label={t('messageList.openConversations')}
                        icon={<Menu />}
                        onClick={() => setIsSidebarOpen(true)}
                    />
                    {selectedGroupDir && !isGroupChat && (
                        <Avatar src={headerAvatar} name={selectedName || ''} size="md" className="ring-2 ring-white" />
                    )}
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-title font-semibold">{selectedName || t('messageList.selectConversation')}</h2>
                        {isGroupChat ? (
                            <p className="text-caption">{t('messageList.groupChat')}</p>
                        ) : streak.status === 'ready' && streak.days > 0 ? (
                            <p className="text-caption">
                                <Trans
                                    i18nKey="memberProfile.subscribedDays"
                                    values={{ days: streak.days }}
                                    components={{ num: <span className="font-semibold" /> }}
                                />
                            </p>
                        ) : null}
                    </div>
                    {displayUnreadCount > 0 && (
                        <span className="rounded-pill bg-pill px-3 py-1 text-caption font-semibold text-secondary shadow-pill">
                            {t('messageList.unread', { count: displayUnreadCount })}
                        </span>
                    )}
                    {syncProgress.state === 'running' && (
                        <span className="flex items-center gap-2 rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>{getSyncDetail(syncProgress, t, t('sync.syncing'))}</span>
                        </span>
                    )}
                    {selectedGroupDir && (
                        <ConversationMenu
                            conversationPath={selectedGroupDir}
                            isGroupChat={isGroupChat}
                            messages={messages}
                            memberName={selectedName || ''}
                            memberAvatar={headerAvatar}
                            groupId={groupId}
                            activeService={activeService || undefined}
                            onOpenCalendar={openCalendar}
                            onBackgroundChange={setBackgroundSettings}
                            iconColor={isLightHeader ? theme.messages.headerTextColor : undefined}
                        />
                    )}
                </header>

                {isLightHeader && <div className="h-1 shrink-0 bg-group-title-bar" />}
```

(d) Wrap the timeline for the member-switch fade: put `<FadeOnChange changeKey={selectedGroupDir} className="flex min-h-0 flex-1 flex-col">` directly before `{/* Virtualized Timeline */}` and `</FadeOnChange>` directly after the timeline `<div>`'s closing tag (right before `{/* Navigation Buttons */}`). Inside the timeline, change the welcome/loading/error texts' classes: `text-gray-400` → `text-muted`, `text-gray-500` → `text-secondary`, `text-red-500` → `text-feedback-error`, `text-lg mb-2` → `mb-2 text-title`, `text-sm` → `text-small`.

(e) Replace the two `{/* Up arrow … */}` / `{/* Down arrow … */}` blocks with:

```tsx
                {/* Up arrow: bottom-right, when the oldest unread is ABOVE the view */}
                {selectedGroupDir && hasUnreadAbove && !callActive && (
                    <IconButton
                        variant="secondary"
                        className="absolute bottom-4 right-4 z-20 bg-group-accent text-inverse shadow-card hover:bg-group-accent hover:text-inverse hover:brightness-105"
                        aria-label={t('messageList.jumpToOldestUnread')}
                        title={t('messageList.jumpToOldestUnread')}
                        icon={<ChevronUp className="h-5 w-5" />}
                        onClick={scrollToFirstUnread}
                    />
                )}
                {/* Down arrow: top-right below the header, when the oldest unread is BELOW the view */}
                {selectedGroupDir && hasUnreadBelow && !callActive && (
                    <IconButton
                        variant="secondary"
                        className="absolute right-4 top-20 z-20 bg-group-accent text-inverse shadow-card hover:bg-group-accent hover:text-inverse hover:brightness-105"
                        aria-label={t('messageList.jumpToOldestUnread')}
                        title={t('messageList.jumpToOldestUnread')}
                        icon={<ChevronDown className="h-5 w-5" />}
                        onClick={scrollToFirstUnread}
                    />
                )}
```

(f) In `<MemberProfilePopup … />`: replace `memberAvatar={…}` with `memberAvatar={headerAvatar}`, delete the `groupId={…}` line and add `streak={streak}` and `onRetryStreak={retryStreak}`.

- [ ] **Step 7: i18n, guard, unit checks**

Run the one-liner with:

```json
{"en":{"messageList.openConversations":"Show conversations"},"ja":{"messageList.openConversations":"トーク一覧を表示"},"zh-CN":{"messageList.openConversations":"显示对话列表"},"zh-TW":{"messageList.openConversations":"顯示對話列表"},"yue":{"messageList.openConversations":"顯示對話列表"}}
```

Add `'messageList.openConversations',` to `D2A_KEYS`.

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `MessagesFeature.tsx` and `MessageBubble.tsx` lowered only.

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 8: Header in the browser**

In `frontend/e2e/fixtures/bigRoom.ts` `pinBigRoom`, add after the `message_dates` route:

```ts
  await page.route('**/api/chat/streak/**', (route) => route.fulfill({ json: { days: 128, is_active: true } }))
```

`frontend/e2e/chat-frame.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ } from './fixtures/bigRoom'

// Non-scroll behaviour of the D2a chat frame (scrolling lives in timeline-scroll.spec.ts).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await pinBigRoom(page, { messages: { current: buildBigRoom() } })
})

test('the chat header shows the member and the subscription streak', async ({ page }) => {
  await page.goto('/')
  await page.getByText('Big Room', { exact: true }).click()
  await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
  const header = page.locator('header').first()
  await expect(header.getByRole('heading', { name: 'Big Room' })).toBeVisible()
  await expect(header.getByText(/Subscribed for\s*128\s*days/)).toBeVisible()
})
```

Run: `npm run build && npx playwright test e2e/timeline-scroll.spec.ts e2e/chat-frame.spec.ts --reporter=line`
Expected: 11 passed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/design docs/design/DESIGN_SYSTEM.md frontend/tailwind.config.js frontend/src/utils/classnames.ts frontend/src/features/messages frontend/src/i18n frontend/e2e/fixtures/bigRoom.ts frontend/e2e/chat-frame.spec.ts
uv run git commit -m "feat(chat): add header avatar and streak, message runs, token bubbles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Sent letters in the chat

**Files:**
- Modify: `frontend/src/features/messages/letters.ts` + create `letters.test.ts`
- Create: `frontend/src/features/messages/hooks/useRoomLetters.ts` + `useRoomLetters.test.ts`
- Create: `frontend/src/features/messages/components/LetterRow.tsx` + `LetterRow.test.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: locale files, `src/i18n/d2a.test.ts`
- Modify: `frontend/e2e/fixtures/bigRoom.ts`, `frontend/e2e/timeline-scroll.spec.ts`

**Interfaces:**
- Consumes: `GET /api/chat/letters_local`, `GET /api/account/profile`, client-log events (Task 7); `MessageList.renderLetter` (Task 5); `buildTimeline(messages, letters)` (Task 3).
- Produces (in `letters.ts`): `interface AccountAvatar { url: string; first_seen: string }`, `interface AccountProfile { name: string | null; avatars: AccountAvatar[] }`, `LETTER_WIDTH = 180`, `letterImageHeight(letter): number`, `fetchLocalLetters(service, memberPath, signal?) → Promise<Letter[]>`, `fetchAccountProfile(service, signal?) → Promise<AccountProfile>`, `type AvatarSource = 'history' | 'fallback' | 'none'`, `pickLetterAvatar(avatars, createdAt) → { url: string | null; source: AvatarSource }`, `letterAvatars(letters, avatars) → { byId: Map<number, string | null>; history: number; fallback: number }`. `useRoomLetters(service: string | null, memberPath: string | undefined, isGroupChat: boolean, refreshKey: number, waitMs = LETTERS_WAIT_MS /* 3000 */) → { letters: readonly Letter[]; profile: AccountProfile | null; ready: boolean }`. `LetterRow({ letter, avatarUrl, userName, onOpenImage })`. i18n keys `letters.openImage`, `letters.you`. Fixture `LETTERS` (ids 9001, 100, 9002, 9003; 100 collides with message 100) and `isRowInViewport(page, row: number | string)`.

- [ ] **Step 1: Write the failing letters-module tests**

`frontend/src/features/messages/letters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import {
    fetchAccountProfile, fetchLocalLetters, letterAvatars, letterImageHeight, pickLetterAvatar, LETTER_WIDTH, type Letter,
} from './letters';

const PATH = '日向坂46/messages/90 高井 俐香/142 高井 俐香';
const letter = (id: number, created_at: string): Letter => ({ id, text: 'ありがとう🌸', created_at, image_url: null, width: 341, height: 512 });
const avatars = [
    { url: '/a.jpg', first_seen: '2024-01-01T00:00:00Z' },
    { url: '/b.jpg', first_seen: '2025-06-01T00:00:00Z' },
];

describe('pickLetterAvatar', () => {
    it('takes the newest avatar first seen at or before the send time', () => {
        expect(pickLetterAvatar(avatars, '2025-07-01T00:00:00Z')).toEqual({ url: '/b.jpg', source: 'history' });
        expect(pickLetterAvatar(avatars, '2025-06-01T00:00:00Z')).toEqual({ url: '/b.jpg', source: 'history' });
        expect(pickLetterAvatar(avatars, '2025-05-31T23:59:59Z')).toEqual({ url: '/a.jpg', source: 'history' });
    });

    it('falls back to the earliest known avatar, whatever the order', () => {
        expect(pickLetterAvatar([...avatars].reverse(), '2023-01-01T00:00:00Z')).toEqual({ url: '/a.jpg', source: 'fallback' });
    });

    it('has none without avatars', () => {
        expect(pickLetterAvatar([], '2025-01-01T00:00:00Z')).toEqual({ url: null, source: 'none' });
    });
});

describe('letterAvatars', () => {
    it('maps every letter and counts the sources', () => {
        const out = letterAvatars([letter(1, '2023-01-01T00:00:00Z'), letter(2, '2025-07-01T00:00:00Z')], avatars);
        expect(out.byId.get(1)).toBe('/a.jpg');
        expect(out.byId.get(2)).toBe('/b.jpg');
        expect([out.history, out.fallback]).toEqual([1, 1]);
    });
});

describe('letterImageHeight', () => {
    it('reserves the height for a LETTER_WIDTH-wide image', () => {
        expect(LETTER_WIDTH).toBe(180);
        expect(letterImageHeight({ width: 341, height: 512 })).toBe(270);
        expect(letterImageHeight({ width: null, height: null })).toBe(240);
    });
});

describe('fetchers', () => {
    it('fetchLocalLetters sends the service and the member path', async () => {
        const seen: { params?: URLSearchParams } = {};
        server.use(http.get('/api/chat/letters_local', ({ request }) => {
            seen.params = new URL(request.url).searchParams;
            return HttpResponse.json({ letters: [letter(1, '2025-01-01T00:00:00Z')] });
        }));
        await expect(fetchLocalLetters('hinatazaka46', PATH)).resolves.toEqual([letter(1, '2025-01-01T00:00:00Z')]);
        expect(seen.params?.get('service')).toBe('hinatazaka46');
        expect(seen.params?.get('path')).toBe(PATH);
    });

    it('fetchLocalLetters rejects on an error status', async () => {
        server.use(http.get('/api/chat/letters_local', () => HttpResponse.json({}, { status: 403 })));
        await expect(fetchLocalLetters('hinatazaka46', '../x')).rejects.toThrow();
    });

    it('fetchAccountProfile returns the name and avatars', async () => {
        server.use(http.get('/api/account/profile', () => HttpResponse.json({ name: 'ゆき', avatars })));
        await expect(fetchAccountProfile('hinatazaka46')).resolves.toEqual({ name: 'ゆき', avatars });
    });
});
```

Run: `npx vitest run src/features/messages/letters.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement the letters module**

Full replacement of `frontend/src/features/messages/letters.ts`:

```ts
/** One sent letter from the local archive (`GET /api/chat/letters_local`). */
export interface Letter {
    id: number;
    text: string;
    /** ISO timestamp (UTC). */
    created_at: string;
    /** Media-route URL of the archived letter image; null when the file is missing. */
    image_url: string | null;
    width: number | null;
    height: number | null;
}

/** One of the account's archived avatars (`GET /api/account/profile`). */
export interface AccountAvatar {
    /** Media-route URL (never the signed CDN URL). */
    url: string;
    first_seen: string;
}

export interface AccountProfile {
    name: string | null;
    avatars: AccountAvatar[];
}

/** A letter image is shown this wide in the chat. */
export const LETTER_WIDTH = 180;
const DEFAULT_LETTER_HEIGHT = 240;

/** Height (px) reserved for a letter image shown LETTER_WIDTH wide, so landings do not drift. */
export function letterImageHeight(letter: Pick<Letter, 'width' | 'height'>): number {
    return letter.width && letter.height
        ? Math.round((LETTER_WIDTH * letter.height) / letter.width)
        : DEFAULT_LETTER_HEIGHT;
}

export async function fetchLocalLetters(service: string, memberPath: string, signal?: AbortSignal): Promise<Letter[]> {
    const params = new URLSearchParams({ service, path: memberPath });
    const res = await fetch(`/api/chat/letters_local?${params}`, { signal });
    if (!res.ok) throw new Error(`letters_local ${res.status}`);
    const data = await res.json() as { letters?: Letter[] };
    return data.letters ?? [];
}

export async function fetchAccountProfile(service: string, signal?: AbortSignal): Promise<AccountProfile> {
    const res = await fetch(`/api/account/profile?${new URLSearchParams({ service })}`, { signal });
    if (!res.ok) throw new Error(`account_profile ${res.status}`);
    const data = await res.json() as Partial<AccountProfile>;
    return { name: data.name ?? null, avatars: data.avatars ?? [] };
}

export type AvatarSource = 'history' | 'fallback' | 'none';

/**
 * The user's avatar when a letter was sent: the newest one whose first_seen is at or before
 * `createdAt` ('history'); if none qualifies, the earliest known one ('fallback').
 */
export function pickLetterAvatar(
    avatars: readonly AccountAvatar[],
    createdAt: string,
): { url: string | null; source: AvatarSource } {
    const sent = Date.parse(createdAt);
    let best: { url: string; seen: number } | null = null;
    let earliest: { url: string; seen: number } | null = null;
    for (const avatar of avatars) {
        const seen = Date.parse(avatar.first_seen);
        if (Number.isNaN(seen)) continue;
        if (!earliest || seen < earliest.seen) earliest = { url: avatar.url, seen };
        if (!Number.isNaN(sent) && seen <= sent && (!best || seen > best.seen)) best = { url: avatar.url, seen };
    }
    if (best) return { url: best.url, source: 'history' };
    if (earliest) return { url: earliest.url, source: 'fallback' };
    return { url: null, source: 'none' };
}

/** pickLetterAvatar for every letter, plus how many came from the history vs the fallback (for the breadcrumb). */
export function letterAvatars(letters: readonly Letter[], avatars: readonly AccountAvatar[]) {
    const byId = new Map<number, string | null>();
    let history = 0;
    let fallback = 0;
    for (const letter of letters) {
        const pick = pickLetterAvatar(avatars, letter.created_at);
        byId.set(letter.id, pick.url);
        if (pick.source === 'history') history += 1;
        else if (pick.source === 'fallback') fallback += 1;
    }
    return { byId, history, fallback };
}
```

Run: `npx vitest run src/features/messages/letters.test.ts` — Expected: PASS.

- [ ] **Step 3: Write the failing hook and row tests**

`frontend/src/features/messages/hooks/useRoomLetters.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import { useRoomLetters } from './useRoomLetters';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const L = { id: 1, text: '🌸', created_at: '2025-01-01T00:00:00Z', image_url: null, width: null, height: null };
const PROFILE = { name: 'ゆき', avatars: [] };

beforeEach(() => vi.mocked(clientLog).mockClear());

describe('useRoomLetters', () => {
    it('a group chat has no letters and is ready at once, without a letters request', async () => {
        let asked = false;
        server.use(
            http.get('/api/chat/letters_local', () => { asked = true; return HttpResponse.json({ letters: [L] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'group/a', true, 0));
        expect(result.current.ready).toBe(true);
        expect(result.current.letters).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'skipped_group' });
        await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
        expect(asked).toBe(false);
    });

    it('loads a 1:1 room, then is ready; a revisit is ready at once from the cache', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [L] })),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const first = renderHook(() => useRoomLetters('hinatazaka46', 'room/b', false, 0));
        expect(first.result.current.ready).toBe(false);
        await waitFor(() => expect(first.result.current.ready).toBe(true));
        expect(first.result.current.letters).toEqual([L]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'ok', count: 1 });
        first.unmount();
        const again = renderHook(() => useRoomLetters('hinatazaka46', 'room/b', false, 0));
        expect(again.result.current.ready).toBe(true);
        expect(again.result.current.letters).toEqual([L]);
    });

    it('a failed request logs and leaves the room ready without letters', async () => {
        server.use(
            http.get('/api/chat/letters_local', () => HttpResponse.json({}, { status: 500 })),
            http.get('/api/account/profile', () => HttpResponse.json({}, { status: 500 })),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/c', false, 0));
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('account_profile_load', { outcome: 'error' }));
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'error' });
        expect(result.current.profile).toBeNull();
    });

    it('never holds the messages back: a hanging request times out to no letters', async () => {
        server.use(
            http.get('/api/chat/letters_local', async () => { await delay('infinite'); return HttpResponse.json({ letters: [] }); }),
            http.get('/api/account/profile', () => HttpResponse.json(PROFILE)),
        );
        const { result } = renderHook(() => useRoomLetters('hinatazaka46', 'room/d', false, 0, 20));
        expect(result.current.ready).toBe(false);
        await waitFor(() => expect(result.current.ready).toBe(true));
        expect(result.current.letters).toEqual([]);
        expect(clientLog).toHaveBeenCalledWith('letters_load', { outcome: 'timeout' });
    });
});
```

`frontend/src/features/messages/components/LetterRow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { LetterRow } from './LetterRow';
import type { Letter } from '../letters';

const base: Letter = { id: 7, text: 'いつもありがとう🌸', created_at: '2025-10-31T16:19:35Z', image_url: '/l/7.jpg', width: 341, height: 512 };

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('LetterRow', () => {
    it('shows the full letter image at 180 px with its height reserved, and opens it', () => {
        const onOpenImage = vi.fn();
        render(<LetterRow letter={base} avatarUrl="/me.jpg" userName="ゆき" onOpenImage={onOpenImage} />);
        const button = screen.getByRole('button', { name: 'Open letter' });
        expect(button).toHaveStyle({ width: '180px', height: '270px' });
        fireEvent.click(button);
        expect(onOpenImage).toHaveBeenCalledWith(base);
        expect(screen.getByRole('img', { name: 'ゆき' })).toHaveAttribute('src', '/me.jpg');
        expect(screen.getByText('ゆき')).toBeInTheDocument();
    });

    it('shows the letter text when the image is missing or fails to load', () => {
        const { rerender, container } = render(<LetterRow letter={{ ...base, image_url: null }} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        expect(screen.getByText('いつもありがとう🌸')).toBeInTheDocument();
        rerender(<LetterRow letter={base} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        fireEvent.error(container.querySelector('button img')!);
        expect(screen.getByText('いつもありがとう🌸')).toBeInTheDocument();
    });

    it('carries no "sent letter" tag', () => {
        render(<LetterRow letter={base} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        expect(screen.queryByText(/sent letter/i)).toBeNull();
    });
});
```

Run: `npx vitest run src/features/messages/hooks/useRoomLetters.test.ts src/features/messages/components/LetterRow.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the hook and the row**

`frontend/src/features/messages/hooks/useRoomLetters.ts`:

```ts
import { useEffect, useState } from 'react';
import { clientLog } from '../../../utils/clientLog';
import { fetchAccountProfile, fetchLocalLetters, type AccountProfile, type Letter } from '../letters';

const NO_LETTERS: readonly Letter[] = [];
/** Last letters per room, so a revisited room renders at once (like the message cache). */
const lettersCache = new Map<string, readonly Letter[]>();
/** The chat waits at most this long for a room's letters, then renders without them. */
export const LETTERS_WAIT_MS = 3000;

export interface RoomLetters {
    letters: readonly Letter[];
    /** The account's nickname and avatar history; null until loaded or when unavailable. */
    profile: AccountProfile | null;
    /** True once THIS room's letters are known: loaded, cached, failed, or a group chat. */
    ready: boolean;
}

/**
 * Sent letters of the open 1:1 room and the account profile, both from the local archive.
 * Group chats have no letters (no request). A failed request logs a breadcrumb and leaves the
 * room without letters; a request still pending after `waitMs` lets the room render without
 * them, so letters never block the messages. `refreshKey` (the sync version) re-reads both.
 */
export function useRoomLetters(
    service: string | null,
    memberPath: string | undefined,
    isGroupChat: boolean,
    refreshKey: number,
    waitMs: number = LETTERS_WAIT_MS,
): RoomLetters {
    const roomKey = service && memberPath ? `${service}|${memberPath}` : null;
    const [loaded, setLoaded] = useState<{ key: string; letters: readonly Letter[] } | null>(null);
    const [profile, setProfile] = useState<{ service: string; profile: AccountProfile } | null>(null);

    useEffect(() => {
        if (!roomKey || !service || !memberPath) return;
        if (isGroupChat) {
            setLoaded({ key: roomKey, letters: NO_LETTERS });
            clientLog('letters_load', { outcome: 'skipped_group' });
            return;
        }
        const cached = lettersCache.get(roomKey);
        if (cached) setLoaded({ key: roomKey, letters: cached });
        const controller = new AbortController();
        // Without a cached list the chat waits for the letters, but never longer than waitMs.
        const timer = cached ? null : setTimeout(() => {
            setLoaded((prev) => (prev?.key === roomKey ? prev : { key: roomKey, letters: NO_LETTERS }));
            clientLog('letters_load', { outcome: 'timeout' });
        }, waitMs);
        const stopWaiting = () => { if (timer !== null) clearTimeout(timer); };
        fetchLocalLetters(service, memberPath, controller.signal)
            .then((letters) => {
                if (controller.signal.aborted) return;
                stopWaiting();
                lettersCache.set(roomKey, letters);
                setLoaded({ key: roomKey, letters });
                clientLog('letters_load', { outcome: 'ok', count: letters.length });
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                stopWaiting();
                setLoaded({ key: roomKey, letters: cached ?? NO_LETTERS });
                clientLog('letters_load', { outcome: 'error' });
            });
        return () => {
            stopWaiting();
            controller.abort();
        };
    }, [roomKey, service, memberPath, isGroupChat, refreshKey, waitMs]);

    useEffect(() => {
        if (!service) return;
        const controller = new AbortController();
        fetchAccountProfile(service, controller.signal)
            .then((p) => {
                if (controller.signal.aborted) return;
                setProfile({ service, profile: p });
                clientLog('account_profile_load', { outcome: 'ok' });
            })
            .catch(() => {
                if (!controller.signal.aborted) clientLog('account_profile_load', { outcome: 'error' });
            });
        return () => controller.abort();
    }, [service, refreshKey]);

    return {
        letters: loaded && loaded.key === roomKey ? loaded.letters : NO_LETTERS,
        profile: profile && profile.service === service ? profile.profile : null,
        ready: roomKey !== null && loaded?.key === roomKey,
    };
}
```

`frontend/src/features/messages/components/LetterRow.tsx`:

```tsx
import React, { useState } from 'react';
import { Avatar, Card } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { LETTER_WIDTH, letterImageHeight, type Letter } from '../letters';

export interface LetterRowProps {
    letter: Letter;
    /** The user's avatar when the letter was sent (pickLetterAvatar); null shows the initial. */
    avatarUrl: string | null;
    /** The user's nickname. */
    userName: string;
    onOpenImage: (letter: Letter) => void;
}

const timeOf = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * A sent letter in the chat timeline, right-aligned like the official app: the full letter
 * image (LETTER_WIDTH wide, height reserved from its size), or the letter text when the image
 * is missing; the user's avatar and name and the send time. No "sent letter" tag.
 */
export const LetterRow: React.FC<LetterRowProps> = ({ letter, avatarUrl, userName, onOpenImage }) => {
    const { t } = useTranslation();
    const [imageFailed, setImageFailed] = useState(false);
    const imageUrl = imageFailed ? null : letter.image_url;
    return (
        <div className="flex justify-end gap-3 pt-3">
            <div className="flex min-w-0 flex-col items-end">
                <div className="mb-1 flex items-center gap-2">
                    <time className="text-caption text-muted" dateTime={letter.created_at}>{timeOf(letter.created_at)}</time>
                    <span className="text-small font-semibold text-primary">{userName}</span>
                </div>
                {imageUrl ? (
                    <button
                        type="button"
                        onClick={() => onOpenImage(letter)}
                        aria-label={t('letters.openImage')}
                        title={t('letters.openImage')}
                        className="cursor-zoom-in overflow-hidden rounded-card bg-card shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                        style={{ width: LETTER_WIDTH, height: letterImageHeight(letter) }}
                    >
                        <img src={imageUrl} alt="" draggable={false} className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
                    </button>
                ) : (
                    <Card className="max-w-xs whitespace-pre-wrap p-3 text-body text-primary">
                        {letter.text || t('sentLetters.noTextContent')}
                    </Card>
                )}
            </div>
            <Avatar src={avatarUrl ?? undefined} name={userName} size="md" />
        </div>
    );
};
```

Run: `npx vitest run src/features/messages/hooks/useRoomLetters.test.ts src/features/messages/components/LetterRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Letters join the timeline**

In `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Add imports:

```ts
import { useRoomLetters } from './hooks/useRoomLetters';
import { LetterRow } from './components/LetterRow';
import { letterAvatars } from './letters';
import { clientLog } from '../../utils/clientLog';
```

(b) Delete the module-level `NO_LETTERS` constant (and its comment) added in Task 5.

(c) Replace `const timeline = useMemo(() => buildTimeline(displayMessages, NO_LETTERS), [displayMessages]);` with:

```ts
    // Sent letters (local archive) and the account profile; group chats have none.
    const roomLetters = useRoomLetters(activeService, selectedGroupDir, isGroupChat, syncVersion);
    const timeline = useMemo(() => buildTimeline(displayMessages, roomLetters.letters), [displayMessages, roomLetters.letters]);
    const letterAvatar = useMemo(
        () => letterAvatars(roomLetters.letters, roomLetters.profile?.avatars ?? []),
        [roomLetters.letters, roomLetters.profile],
    );
    // Breadcrumb: how each letter's avatar was chosen (history vs earliest-known fallback).
    useEffect(() => {
        if (!roomLetters.profile || roomLetters.letters.length === 0) return;
        clientLog('letter_avatar', {
            count: roomLetters.letters.length,
            history: letterAvatar.history,
            fallback: letterAvatar.fallback,
        });
    }, [letterAvatar, roomLetters.profile, roomLetters.letters.length]);
    const letterUserName = roomLetters.profile?.name || userNickname || t('letters.you');
    const [letterViewer, setLetterViewer] = useState<Letter | null>(null);
    const renderLetter = useCallback((letter: Letter) => (
        <LetterRow
            letter={letter}
            avatarUrl={letterAvatar.byId.get(letter.id) ?? null}
            userName={letterUserName}
            onOpenImage={setLetterViewer}
        />
    ), [letterAvatar, letterUserName]);
```

(d) The `MessageList` render condition `{selectedGroupDir && messages.length > 0 && messagesService && messagesForDir === selectedGroupDir && (` becomes `{selectedGroupDir && messages.length > 0 && messagesService && messagesForDir === selectedGroupDir && roomLetters.ready && (` (rendering waits for the room's letters, at most `LETTERS_WAIT_MS`, so they do not shift rows after the first paint); pass `renderLetter={renderLetter}` to `<MessageList>`.

(e) After the `{/* Media Viewer Modal */}` block add:

```tsx
            {/* Letter image viewer */}
            {letterViewer?.image_url && (
                <MediaViewerModal
                    mediaItems={[{ src: letterViewer.image_url, type: 'picture', timestamp: letterViewer.created_at }]}
                    currentIndex={0}
                    onClose={() => setLetterViewer(null)}
                    onNavigate={() => {}}
                />
            )}
```

- [ ] **Step 6: i18n**

Run the one-liner with:

```json
{"en":{"letters.openImage":"Open letter","letters.you":"You"},"ja":{"letters.openImage":"レターを開く","letters.you":"あなた"},"zh-CN":{"letters.openImage":"打开信件","letters.you":"你"},"zh-TW":{"letters.openImage":"開啟信件","letters.you":"你"},"yue":{"letters.openImage":"打開信","letters.you":"你"}}
```

Add `'letters.openImage', 'letters.you',` to `D2A_KEYS`.

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: all green.

- [ ] **Step 7: Letters in the browser fixture**

In `frontend/e2e/fixtures/bigRoom.ts`:

(a) Add below `PICTURE_IDS`:

```ts
export interface FixtureLetter { id: number; created_at: string; text: string; width: number; height: number }

/** Sent letters of the big room (23:00 JST, after that day's messages). Letter 100 shares its id with message 100, a picture. */
export const LETTERS: FixtureLetter[] = [
  { id: 9001, created_at: '2022-02-10T14:00:00Z', text: 'Letter 9001 🌸', width: 341, height: 512 },
  { id: 100, created_at: '2023-06-01T14:00:00Z', text: 'Letter 100', width: 341, height: 512 },
  { id: 9002, created_at: '2025-05-05T14:00:00Z', text: 'Letter 9002', width: 341, height: 512 },
  { id: 9003, created_at: '2026-11-02T14:00:00Z', text: 'Letter 9003', width: 341, height: 512 },
]
```

(b) Add to `PinOptions`:

```ts
  /** Letters of the big room (default LETTERS); the other room has none. */
  letters?: FixtureLetter[]
```

(c) Add in `pinBigRoom` after the streak route:

```ts
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
```

(d) Replace `isRowInViewport` with:

```ts
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
```

Append to `frontend/e2e/timeline-scroll.spec.ts` inside the `describe`:

```ts
  test('a sent letter shows on its day, keyed apart from messages', async ({ page }) => {
    await openBigRoom(page)
    const dialog = await openCalendarAt(page, 'February 2022')
    await dialog.getByRole('button', { name: '10', exact: true }).click()
    await expect(page.locator('#letter-9001')).toBeAttached({ timeout: 2000 })
    await expect(page.locator('#letter-9001 img').first()).toHaveAttribute('src', /letters\/9001\.jpg$/)
  })
```

Run: `npm run build && npx playwright test e2e/timeline-scroll.spec.ts e2e/chat-frame.spec.ts --reporter=line`
Expected: 12 passed (every locked test stays green with letters in the room).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/messages frontend/src/i18n frontend/e2e/fixtures/bigRoom.ts frontend/e2e/timeline-scroll.spec.ts
uv run git commit -m "feat(chat): show sent letters in the timeline" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Sent-letters overview

**Files:**
- Modify: `frontend/src/core/modals/SentLettersModal.tsx` (full replacement)
- Create: `frontend/src/core/modals/SentLettersModal.test.tsx`
- Modify: `frontend/src/features/messages/components/ConversationMenu.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: `frontend/e2e/timeline-scroll.spec.ts`, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `roomLetters.letters` (Task 11, the same list the timeline shows: no second fetch); `jumpTo({ kind: 'letter', id })` (Task 5).
- Produces: `SentLettersModal({ isOpen, onClose, letters: readonly Letter[], onSelectLetter: (id: number) => void })`; `ConversationMenu` props `letters` and `onJumpToLetter` (its `groupId` prop is removed).

- [ ] **Step 1: Write the failing overview test**

`frontend/src/core/modals/SentLettersModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SentLettersModal } from './SentLettersModal';
import type { Letter } from '../../features/messages/letters';

const letter = (id: number, created_at: string, image_url: string | null, text = ''): Letter =>
    ({ id, text, created_at, image_url, width: 341, height: 512 });

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('SentLettersModal', () => {
    it('lists the letters newest first and jumps to the chosen one after closing', async () => {
        const onClose = vi.fn();
        const onSelectLetter = vi.fn();
        render(
            <SentLettersModal
                isOpen
                onClose={onClose}
                letters={[letter(1, '2023-06-01T14:00:00Z', '/l/1.jpg'), letter(2, '2025-05-05T14:00:00Z', null, 'ありがとう🌸')]}
                onSelectLetter={onSelectLetter}
            />,
        );
        const dialog = await screen.findByRole('dialog', { name: 'Sent Letters' });
        const cards = within(dialog).getAllByRole('button');
        expect(cards[0]).toHaveTextContent('2025');
        expect(cards[0]).toHaveTextContent('ありがとう🌸');
        expect(cards[1].querySelector('img')).toHaveAttribute('src', '/l/1.jpg');
        await userEvent.click(cards[1]);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onSelectLetter).toHaveBeenCalledWith(1);
    });

    it('says so when there are no letters', async () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={[]} onSelectLetter={vi.fn()} />);
        expect(await screen.findByText('No letters sent yet')).toBeInTheDocument();
    });
});
```

Run: `npx vitest run src/core/modals/SentLettersModal.test.tsx` — Expected: FAIL.

- [ ] **Step 2: Rebuild the overview**

Full replacement of `frontend/src/core/modals/SentLettersModal.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Card, Modal } from '../../design/primitives';
import { useTranslation } from '../../i18n';
import type { Letter } from '../../features/messages/letters';

export interface SentLettersModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** The open room's letters: the same list the chat timeline shows (local archive). */
    letters: readonly Letter[];
    /** Called with a letter id after the dialog closed itself; the caller jumps the chat there. */
    onSelectLetter: (id: number) => void;
}

/**
 * Overview of the letters sent to this member: a grid of letter thumbnails, newest first,
 * with their dates. Choosing one closes the dialog and jumps to the letter in the chat.
 */
export const SentLettersModal: React.FC<SentLettersModalProps> = ({ isOpen, onClose, letters, onSelectLetter }) => {
    const { t, i18n } = useTranslation();
    const newestFirst = useMemo(
        () => [...letters].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
        [letters],
    );
    const dateFormat = useMemo(
        () => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
        [i18n.language],
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={t('sentLetters.title')} className="max-w-2xl">
            {newestFirst.length === 0 ? (
                <p className="py-10 text-center text-small text-muted">{t('sentLetters.noLetters')}</p>
            ) : (
                <div className="grid grid-cols-3 gap-3">
                    {newestFirst.map((letter) => (
                        <button
                            key={letter.id}
                            type="button"
                            onClick={() => {
                                onClose();
                                onSelectLetter(letter.id);
                            }}
                            className="group flex flex-col gap-2 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                        >
                            <Card className="aspect-[3/4] overflow-hidden transition-shadow duration-fast ease-standard group-hover:shadow-sheet">
                                {letter.image_url ? (
                                    <img src={letter.image_url} alt="" draggable={false} className="h-full w-full object-cover" />
                                ) : (
                                    <p className="line-clamp-6 whitespace-pre-wrap p-3 text-small text-secondary">
                                        {letter.text || t('sentLetters.noContent')}
                                    </p>
                                )}
                            </Card>
                            <time dateTime={letter.created_at} className="text-caption text-secondary">
                                {dateFormat.format(new Date(letter.created_at))}
                            </time>
                        </button>
                    ))}
                </div>
            )}
        </Modal>
    );
};
```

Run: `npx vitest run src/core/modals/SentLettersModal.test.tsx` — Expected: PASS.

- [ ] **Step 3: Wire it to the chat**

In `frontend/src/features/messages/components/ConversationMenu.tsx`:
- Add `import type { Letter } from '../letters';`.
- In `ChatHeaderMenuProps` delete `groupId?: string;` and add:

```ts
    /** The room's sent letters (the timeline's list), for the overview. */
    letters: readonly Letter[];
    /** Jumps the chat to a letter chosen in the overview. */
    onJumpToLetter: (id: number) => void;
```

- In the destructuring replace `groupId,` with `letters,` and `onJumpToLetter,`.
- Replace the `<SentLettersModal … />` element with:

```tsx
            <SentLettersModal
                isOpen={activeModal === 'letters'}
                onClose={() => setActiveModal(null)}
                letters={letters}
                onSelectLetter={onJumpToLetter}
            />
```

In `frontend/src/features/messages/MessagesFeature.tsx`:
- Below `jumpToTargetMessage` add:

```ts
    const jumpToLetter = useCallback((id: number) => {
        void jumpTo({ kind: 'letter', id });
    }, [jumpTo]);
```

- In `<ConversationMenu … />` replace `groupId={groupId}` with `letters={roomLetters.letters}` and `onJumpToLetter={jumpToLetter}`.

- [ ] **Step 4: Lock the jump in the browser**

Append to `frontend/e2e/timeline-scroll.spec.ts` inside the `describe`:

```ts
  test('the sent-letters overview jumps to a letter and highlights it', async ({ page }) => {
    await openBigRoom(page)
    await page.getByTitle('More options').click()
    await page.getByText('Sent Letters', { exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /2023/ }).click()
    await expect.poll(() => isRowInViewport(page, 'letter-100'), { timeout: 1000, intervals: [50] }).toBe(true)
    await expect(page.locator('#letter-100')).toHaveClass(/animate-landing/)
  })
```

- [ ] **Step 5: Checks**

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/modals/SentLettersModal.tsx` removed (0).

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npx playwright test e2e/timeline-scroll.spec.ts e2e/chat-frame.spec.ts --reporter=line`
Expected: all green; 13 e2e passed.

Run: `grep -rn "api/chat/letters/" src --include=*.ts --include=*.tsx`
Expected: no output (the live letters endpoint is now unused by the UI; Task 13 records it for the E clean-up list).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/core/modals/SentLettersModal.tsx frontend/src/core/modals/SentLettersModal.test.tsx frontend/src/features/messages/components/ConversationMenu.tsx frontend/src/features/messages/MessagesFeature.tsx frontend/e2e/timeline-scroll.spec.ts frontend/src/design/guard-baseline.json
uv run git commit -m "feat(chat): turn sent letters into an overview that jumps to the letter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Final checks, screenshots, docs, Windows build, PR

**Files:**
- Modify: `frontend/e2e/visual-zero-pixel.spec.ts` (pin the new endpoints)
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md`

**Interfaces:**
- Consumes: everything above; `e2e-shots/before/` (Task 2).

- [ ] **Step 1: The guard only went down**

Run (in `frontend/`): `npx vitest run src/design/guard.test.ts && git diff dev -- src/design/guard-baseline.json`
Expected: PASS, and the diff against `dev` only lowers numbers or removes entries (at least `core/layout/{Layout,ContentArea,FeatureRail}.tsx`, `core/modals/SentLettersModal.tsx`, `features/messages/{MessagesFeature,components/MemberList}.tsx` gone or lower, `MessageBubble.tsx` lower). Any increase is a bug: fix the file, never raise the baseline.

Run: `git diff dev --stat -- src | tail -1 && git diff dev -U0 -- src | grep -E "^\+" | grep -nE "\b(bg|text|border|ring)-(gray|red|blue|green|black|white|orange)-|bg-white\b|bg-black/" | grep -v "ring-white" || true`
Expected: no named palette classes in added lines (`ring-white` of the `Avatar` selection is the documented exception).

- [ ] **Step 2: Full test suites**

Run (in `SakaDesk/`): `uv run pytest backend -q && uv run ruff check backend && uv run ruff format --check backend && uv run mypy backend/`
Run (in `frontend/`): `npx vitest run && npx tsc --noEmit && npm run lint && npm run build && npx playwright test e2e/timeline-scroll.spec.ts e2e/chat-frame.spec.ts --reporter=line && npx playwright test -c playwright.probe.config.ts --reporter=line`
Expected: all green (backend: the pysaka keyring test may error headless in WSL, pre-existing). e2e: 13 + 5 probe passed. Write the counts down for the PR's Testing section.

- [ ] **Step 3: "After" screenshots (controller, with the user)**

Run: `SHOT_LABEL=after npx playwright test e2e/d2a-screens.spec.ts --reporter=line`
Expected: 4 passed; `e2e-shots/after/` holds 8 PNGs next to `e2e-shots/before/`.

Controller: show the user each before/after pair for all four groups (hinatazaka46, sakurazaka46, nogizaka46, yodel; home + chat). Open them in the Windows browser/viewer with `powershell.exe Start-Process` (never the Playwright MCP). Check with the user: the neutral group rail, the canvas block with the feature rail and sidebar, the chat sheet, Sakurazaka's white header + thin bar, the date pills, the floating sync pill, and the letter in the chat. Fix what the user rejects before going on.

- [ ] **Step 4: Re-baseline the zero-pixel spec (after the user approved the look)**

The redesign changes pixels on purpose, so the D1 zero-pixel baselines (local-only, git-ignored) are retired and re-captured on the D2a look; from then on the spec guards D2a against unintended pixel changes in later refactors.

In `frontend/e2e/visual-zero-pixel.spec.ts`, at the end of `pinData` add:

```ts
  // D2a: letters, account profile and streak are pinned so the shots do not depend on the machine.
  await page.route('**/api/chat/letters_local*', (route) => route.fulfill({ json: { letters: [] } }))
  await page.route('**/api/account/profile*', (route) => route.fulfill({ json: { name: null, avatars: [] } }))
  await page.route('**/api/chat/streak/**', (route) => route.fulfill({ json: { days: 0, is_active: false } }))
```

Run: `npx playwright test e2e/visual-zero-pixel.spec.ts --update-snapshots --reporter=line && npx playwright test e2e/visual-zero-pixel.spec.ts --reporter=line`
Expected: 3 passed, then 3 passed again against the new baselines. Commit only the spec change (the PNGs stay local):

```bash
git add frontend/e2e/visual-zero-pixel.spec.ts
uv run git commit -m "test(e2e): pin D2a endpoints in the zero-pixel spec" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Changelog**

Read `docs/DOC_FORMATS.md` and follow it. In `CHANGELOG.md` under `## [Unreleased]`:

(a) In `### Added`, replace the entry

```markdown
- **Your sent letters are now kept in your archive**, even after a
  subscription ends. They are only saved for now; showing them in the chat
  will come later.
```

with

```markdown
- **Your sent letters are now kept in your archive**, even after a
  subscription ends, and they appear in the chat where you sent them, with
  the avatar you had at the time. Sent Letters in the chat menu shows them
  all; click one to jump to it.
```

(b) Add to `### Added`:

```markdown
- **Dates stay at the top of the chat while you scroll.** Each day starts
  with a date label (Today, Yesterday, or the date); click it to open the
  calendar and jump to another day.
```

(c) Add to `### Changed`:

```markdown
- **A cleaner main window.** The group list on the left is now neutral, the
  feature list shows names under its icons and shares the group's background
  with the member list, and chats and blogs sit on one rounded page. The
  member list widens on large windows to show four or five members per row.
- **Chats are easier to read.** Messages sent in a row show the name, photo
  and time only once (hover a message to see its time), and the chat title
  shows the member's photo and how many days you have been subscribed.
```

- [ ] **Step 6: Spec zero drift**

Edit `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md`, part "D2a — the redesign", so it describes what was built:
- Section 1: state that the canvas block holds the feature rail and each feature's own sidebar; `ContentArea` wraps blogs, the placeholders and the initial-sync view in a `ContentSheet` (8 px from the frame), while `MessagesFeature` puts its member sidebar on the canvas and its chat on a `ContentSheet`. The fade is `FadeOnChange` (no remount; none with reduced motion).
- Section 2: widths 320 / 376 / 432 px at window widths < 1600 / ≥ 1600 / ≥ 1920 px, `auto-fill` cells of at least 72 px; section headings are pill-styled sticky `h2` headings (a `Pill` is a button, so the heading uses the pill tokens instead).
- Section 3: the header uses `bg-group-title` (new utility over the official title gradient) or Sakurazaka's white header + `bg-group-title-bar`; the streak comes from `useMemberStreak`: a module-level session cache keyed by service, group id and local date, so the official API is asked at most once per room per local day (shared in-flight request; failures not cached, `streak_load` breadcrumb, header omits the count), and the same value is passed to `MemberProfilePopup`; the run's time is shown as `HH:mm` (the date is in the date pill); the first bubble's corner is the new `rounded-tl-tail` token (4 px); the calendar is owned by `MessagesFeature` and opened by the ⋯ menu and the date pills.
- Section 4: replace the `Timeline` interface with the built one (adds `groupStarts`, `groupIndexOfDate`, `groupOfIndex`, `indexOfRowKey`, `rowKeyAt`, `messageIdNear`; `RowKey`; `RUN_GAP_MS`). Record the probe results (`e2e/probe/grouped-virtuoso.spec.ts`): ranges are item indices, the range start may be a row hidden behind the sticky header, `scrollToIndex({index, align:'start'})` and a numeric `initialTopMostItemIndex` land the row right below the sticky header, `{groupIndex}` lands the group's first row below its own header, `offset` shifts by `-offset`. State that `measureLanding` measures `start` from the sticky header's bottom (`stickyHeaderBottom`) and that `useChatScroll` resolves the top visible row one frame after `rangeChanged` (`topVisibleRowIndex`), saving on room switch, unmount and pagehide. `useTimelineJump` takes `timeline` and calls `onLanded(rowKey)`; `useLandingHighlight` returns `highlightedRowKey`.
- Section 5: the exact response shapes and outcomes from Task 7 (`letters_local` outcomes found/empty/missing/invalid/wrong_service/bad_service; `account_profile` outcomes found/empty/missing/invalid/bad_service), the client-log events `letters_load`, `account_profile_load`, `letter_avatar`, the 240 px default letter height, the chat rendering only after the room's letters are known or `LETTERS_WAIT_MS` (3 s) passed (no row shift; `letters_load` outcome `timeout`), the overview reading the timeline's letter list (no second fetch), and that `GET /api/chat/letters/{group_id}` is no longer used by the UI (E clean-up list).

- [ ] **Step 7: Commit the docs**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md
uv run git commit -m "docs: record the D2a chat frame in the spec and changelog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Windows test build (controller, with the user)**

Build the Windows test build the same way as for D2a-0, pointed at the archive copy `C:\D\saka-verify` (never the live `C:\D\SakaDesk Output`). The user allows closing the installed app to launch the test build; launch the dev exe with `-WorkingDirectory`. Check by hand, for all four groups where an archive exists:
- The frame: neutral group rail, canvas block (feature rail with labels + member sidebar), chat on the sheet; member sidebar width and columns at a normal window, ≥ 1600 px and ≥ 1920 px wide.
- 高井 俐香's room (日向坂46): sticky date pills; clicking one opens the calendar; a 2022 day jumps there instantly with the date pill on top; letters appear inline with the avatar of their time; Sent Letters overview jumps to a letter and highlights it; message runs; header avatar + "Subscribed for N days".
- Restore: leave and re-open the room; it opens where you left it. Search result and media-gallery "jump to message" still land and highlight.
Ask the user to confirm.

- [ ] **Step 9: Push and open the PR (after the user's check)**

```bash
uv run git push -u origin feat/d2a-chat-frame
```

Title: `feat(chat): D2a chat frame, date pills and letters in chat`, base `dev`. The body has `## Why`, `## What` (grouped **Backend** / **Frontend**), `## Testing` (suite counts from Step 2; say that the look was checked by hand on Windows and with before/after screenshots, and that the zero-pixel baselines are local), `## Changelog` (quote the Step 5 entries in a fenced block), then `## Notes`: `GET /api/chat/letters/{group_id}` (live API) is no longer used by the UI and goes on the E clean-up list. Pass it with `--body-file`, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Spec coverage

| Spec item | Task |
|---|---|
| Implementation order 1: lock scroll behaviour (restore, follow, first unread both arrows, message jump, date jump, keys, panel auto-collapse), `waitForRequest` | 1 |
| Before/after screenshots for all four groups | 2, 13 |
| §4 `buildTimeline` (day boundaries, letter-only days, 5-minute runs, ties, local midnight) | 3 |
| §4 probe `rangeChanged` / sticky header semantics first | 4 |
| §4 one index source; row keys `msg-`/`letter-` in DOM, measure, highlight, `JumpTarget {kind:'letter'}`; restore saves the top message; unread ignores letters; key nav steps through letters | 5 |
| §3 date headers: `GroupedVirtuoso`, `DatePill`, push each other, click opens the calendar; §4 date jumps by `groupIndex`, landing below the sticky header, e2e helper ignores hidden rows | 6 |
| §5 backend endpoints, path validation, breadcrumbs, no signed URL; error handling (letters/profile failures log, never block) | 7, 11 |
| §1 frame: neutral group rail, white ring + glow, neutral hovers, canvas block, `RailItem` labels from i18n, `Sheet` with 8 px gap, placeholders in i18n, fade on feature/service change | 8 |
| §2 member sidebar: widths/columns, `Avatar`/`Badge`, hover lift, greyscale graduated, sticky pill headings, floating sync pill | 9 |
| §3 header (official layer verbatim, avatar, streak from the shared source), runs, bubbles from tokens, unread `IconButton`s in the action colour, fade on member switch | 10 |
| §5 letters in chat: right-aligned full image 180 px with reserved height, avatar by history / earliest fallback, text card when the image is missing, viewer, no group-chat fetch | 11 |
| §5 overview: local archive, thumbnails newest first with dates, jump + highlight | 12 |
| Implementation order 6: tests, tsc, lint, guard only down, screenshots, Windows check; CHANGELOG; spec zero drift | 13 |
