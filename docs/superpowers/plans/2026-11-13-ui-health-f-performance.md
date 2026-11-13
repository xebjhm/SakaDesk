# UI Health F — Rendering Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

First of three plans for the UI-health findings of the 0.5.0 audit (`/home/xtorker/repos/Project-Saka/audits/2026-11-13-sakadesk-0.5.0/ui/UI-HEALTH-REPORT.md` and `report-performance.md`). **G** (accessibility, `2026-11-13-ui-health-g-accessibility.md`) and **H** (CSS and theming, `2026-11-13-ui-health-h-css-theming.md`) are independent of this plan; where they edit the same files (`MessageBubble.tsx`, `MessagesFeature.tsx`, `PhotoPlayer.tsx`), each task names the exact lines it touches, so the plans can land in any order. Recommended order: F → G → H.

**What this plan closes** (report ids: `#n` = UI-HEALTH-REPORT priority; `P-xx` = the row in Appendix A, taken from `report-performance.md`):

| Task | Closes |
|---|---|
| 1 | #1 part 1, P-B1a: a refresh of an unchanged room parses and re-renders the whole history |
| 2 | #1 part 2, P-B1b/c: ★ rebuilds the timeline; two date parses per message; the room cache is unbounded |
| 3 | #2 part 1, P-A1: the 1 Hz sync-progress poll re-renders the whole visible UI |
| 4 | #2 part 2, P-A2, P-A4: inline callbacks defeat `React.memo(MessageBubble)`; `useAppStore()` without a selector |
| 5 | #11, P-A5: switching to Blogs or Memories unmounts Messages and throws its room cache away (kept mounted, with its dialogs hidden and its side effects gated while hidden) |
| 6 | #8, P-C1, P-C3: chat photos decode full-size originals; every voice/video bubble asks for a transcript |
| 7 | P-B2, P-B3: reveal is O(U²·R); the closed gallery and favourites dialogs sort on every change |
| 8 | P-F1: the sidebar polls two endpoints every 2 s and re-sorts the grid on each tick |
| 9 | #13 (part), P-E2: no code splitting — Memories and html-to-image are in the main chunk |
| 10 | P-B6 (formatter part), P-B7, P-D2, P-C2b: `Intl.DateTimeFormat` per call, uncapped card stagger, blog images all eager (the rail hover throttle is won't-fix, Appendix A) |
| 11 | P-D1a (owner-gated): three 100 px-blurred orbs animate forever behind the blog feed |
| 12 | CHANGELOG and final verification |

**Goal:** Opening, refreshing and syncing a chat does work in proportion to what changed, not to the size of the room or the frequency of the sync poll.

**Architecture:** The room fetch becomes conditional (ETag/304, already served by the backend) and the ★ toggle moves into a per-room override map, so an unchanged room never rebuilds its timeline. Sync progress moves from `App` state into a zustand store that only the progress views subscribe to. Messages stays mounted (hidden with `content-visibility: hidden` and `inert`) when another feature shows. Smaller fixes go to the component that owns the behaviour.

**Tech Stack:** React 18.3, TypeScript 5 (strict, `noUnusedLocals`), zustand 5 (`useShallow`), react-virtuoso 4.18, Vite 7, Tailwind 3.4; vitest 4 + Testing Library + msw 2; Playwright 1.57 (Chromium). No new dependencies.

## Global Constraints

- Worktree: `/home/xtorker/repos/Project-Saka/SakaDesk-hardening`, branch `fix/050-security-hardening`. **Re-read every file before editing it and match code by text, not line number.** Where a snippet shows surrounding code that has changed (another plan may have landed first), keep the current code and apply only the change described.
- Runtime: WebView2 (evergreen Chromium) only. Current stable Chromium features are allowed without fallbacks (UI-HEALTH-REPORT §4).
- **UI design system is mandatory** (`SakaDesk-hardening/CLAUDE.md`, `docs/design/DESIGN_SYSTEM.md`): tokens and primitives from `frontend/src/design/`; no hex/`rgb()`/`hsl()` literals, no arbitrary radius/shadow/text/spacing values, no named palette classes; `frontend/src/design/guard.test.ts` stays green. **No visual change** except where the Decisions section names one.
- i18n: any new user-facing string gets a key in all five locales (`frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`). This plan adds one (`memories.chunkFailed`, Task 9).
- If `frontend/src/design/drift-guard-baseline.json` exists (Plan H Task 9), a task that removes palette classes or arbitrary values (e.g. Task 11's `blur-[100px]`) lowers it: `UPDATE_DRIFT_BASELINE=1 npx vitest run src/design/guard.test.ts` (the diff only goes down).
- Breadcrumbs: every new decision, skip or failure path calls `clientLog(event, fields)` (`frontend/src/utils/clientLog.ts`) with codes, counts and ids only — never text, names, URLs or paths. This plan reuses existing events with new `outcome` codes (the backend accepts any `^[a-z0-9_]{1,40}$` value); a new event name would need adding to both `clientLog.ts` and `backend/api/client_log.py`.
- Frontend commands run from `frontend/`: `npx vitest run <path>`, `npx tsc --noEmit`, `npm run lint` (0 errors, ≤ 20 warnings). E2E: `npm run build && npx playwright test <spec> --reporter=line` with port 8000 free (the config starts the backend in test mode).
- Python (none expected here): `uv run`, never pip.
- Commits: Conventional Commits `type(scope): subject`, imperative, whole line ≤ 72 chars, no trailing period (`docs/DOC_FORMATS.md`). Commit with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH) and end every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- CHANGELOG entries go under `## [Unreleased]` → `### Changed` / `### Fixed`, end-user wording: **bold lead-in**, at most 3 sentences, no code identifiers.
- WSL safety: never `find /` or scan `/mnt/*`; limit `find` to the worktree with `-xdev` and exclude `node_modules`; wrap long searches in `timeout 60`.

## Decisions (reviewers: these are deliberate; the owner confirms the ones marked ⚑)

1. **Conditional room fetch.** The frontend keeps each cached room's `ETag` and sends `If-None-Match`. An author-set conditional header makes Chromium skip its HTTP cache, so the backend's `304` reaches the page (today the browser revalidates on its own and hands the page the full cached body to parse). A 304 sets no state except `freshFetch` (the incoming-call hook re-evaluates on every successful fetch, as before) and logs `chat_load` `outcome=not_modified`.
2. **`last_read_id` is no longer sent with the room fetch.** The backend keys the ETag on it, but the frontend never reads `unread_count` (it counts unread from its own read state) and `max_message_id` does not depend on it (`backend/api/content.py` `_load_member_messages` / `_load_group_messages`). Sending it made every read position a different ETag.
3. **★ is an override map, not a rewrite of the room.** `favoriteOverrides` (message id → starred) lives in `MessagesFeature`; the bubble reads `isFavorite`, the ConversationMenu dialogs get the messages with the overrides applied. A fresh 200 prunes overrides the server now agrees with; a saved ★ also patches the cached room so a later visit shows it. The timeline is never rebuilt for a ★.
4. **Room cache bound:** at most 20 rooms (unchanged) **and** 60 000 messages in total; the oldest rooms are evicted first and the room just stored always stays.
5. **Paging the timeline (`firstItemIndex`/`startReached`) and a timeline Worker are won't-fix in this wave.** Every whole-history consumer (calendar jump, media gallery, favourites, search target, unread arrows, letters merge) would need a second data path. Tasks 1–2 remove the repeat work; the first open of a huge room keeps one parse. Revisit if Task 1's e2e annotation `longest-task-first-open-ms` (5 000-message fixture) exceeds 200 ms.
6. **Sync progress has one store** (`frontend/src/shell/syncProgressStore.ts`, zustand) written only by `useSync`; `App` no longer holds it. Consumers subscribe with selectors: the sync dialog and the inline first-sync view read the progress, the chat header pill reads the active progress, `MessagesFeature` and `ContentArea` read booleans. `byService` is the primary data (no copy left in `App`). `active` is, as before, a derived copy: a microtask follower keeps it equal to the active service's (or the running sequence step's) entry, and `useSync` still writes it directly in a few places (the lost-connection error, the start of a sequence). This is a like-for-like move of today's two pieces of state, so the single-source rule is claimed for the store, not for `active`.
7. **Messages stays mounted after its first visit.** When another feature shows it is hidden with `content-visibility: hidden` (layout and scroll state kept, skipped from rendering, focus and the accessibility tree) plus `inert`, and `useFeatureActive()` is false inside it (the context reaches portaled children too). Mechanism, in one place per concern:
   - **Its dialogs and menus are not rendered while hidden.** `Modal` and `Menu` render nothing when `useFeatureActive()` is false (they are portaled to `<body>`, outside `KeepMounted`, so neither `content-visibility` nor `inert` would hide them). Their open state is kept, so a dialog left open (reachable only through a toast click or a search result that switches feature) comes back with Talk. Unmounting pops the dialog stack, so `#root` is never left inert (Plan G Task 5).
   - **Side effects wait for Talk to show.** Gated on `featureActive`: the sidebar poll; the room fetch on a finished sync and on a selection change (`chat_load outcome=deferred`, `reason=hidden` / `hidden_select`); restoring the new group's saved room after a group switch made from Blogs or Memories (`reason=hidden_restore`, restored on the hidden → shown edge); the read sync to the official app (never fired while hidden; the hidden → shown edge counts as opening the room, as the remount did; `reason=hidden_read_sync`); milestones (`useMilestone` gets no room key); the room extras (letters, profile, the once-a-day streak keep the last shown room's answers and ask nothing new); the open chat is not reported as viewed (notifications for it come through); the incoming call is off.
   - **Showing it again** runs one background refresh (cheap through Task 1), restores a deferred room and lets the extras catch up.
   - ⚑ **Differences from the old unmount** (default: accepted): an incoming call declined before the trip does not ring again on return (`useIncomingCall` keeps its dismissed set; the remount cleared it); a call ringing when Talk is hidden ends with the hook's off path, logged `call_cancel reason=disabled`; Messages-side UI state (an open drawer, a scrolled list, an open dialog) survives the trip.
8. **Chat photos use a thumbnail only when a pre-generated one covers the box, otherwise the original (rule: no visible difference and no extra backend work).** The bubble box (≤ 320 × 500 CSS px, fitted like `MediaContainer`) × device pixel ratio must fit in a width at or under `THUMB_PREGEN_WIDTH` (480: pre-generated for every picture), the same cap `thumbWidthFor` uses, and the chat then asks for the 480 itself: 320 / 160 would be derived on demand and 640 is rendered on demand only (`backend/services/photo_thumb.py` docstring), so neither is asked for. A picture whose long side is already ≤ 480 px keeps its original (a thumbnail would only re-encode it). GIFs (a thumbnail is one still frame) and pictures without stored dimensions keep the original. In practice: 100 % scaling uses thumbnails; landscape photos also at 125–150 %; portrait photos and anything at 200 % keep the original. ⚑ Residual (default: accepted): a picture synced moments ago, before the background worker made its 480, is rendered once on its first request (as in the media gallery), so its pulse can last a little longer the first time.
9. **Transcript lookups only when a transcript can show:** a voice/video bubble asks `GET /api/transcription/...` only when transcription is on and the bubble is revealed, and aborts on unmount. ⚑ With transcription off, a bubble video opened full screen no longer shows subtitles from a cached transcript (the user turned transcripts off).
10. ⚑ **Sidebar poll 2 s → 10 s**, and an unchanged groups payload or unread map sets no state. A sync end, a reveal and a room switch still refresh at once (existing triggers). Visible: without such a trigger (a read made on the phone and picked up by a sync this window did not see end), the conversation list and its unread badges update up to 10 s later instead of 2 s (default: accepted). An unchanged streak logs `sidebar_load` `outcome=unchanged` once.
11. **Code splitting:** Memories (`React.lazy`, Suspense fallback = the pane `StatusBlock` loading state, inside a small error boundary that shows `StatusBlock kind="error"` with Retry if the chunk fails, so a failed chunk never replaces the app with the crash screen) and `html-to-image` (dynamic import at export time). ⚑ Visible: the first Memories open shows the loading state for a moment (default: accepted). Locales stay bundled (the startup language decision is synchronous and ordered in `shell/language.ts`; 5 JSON files cost a few ms) and framer-motion stays (three fades; replacing them is a motion rewrite for little gain).
12. ⚑ **Card stagger capped at 8 steps** (`min(index, 8) × 50 ms`, in `features/blogs/components/stagger.ts`) in the blog feed and the member timeline: in a long list the last cards appear within 0.4 s instead of several seconds. Same animation, shorter tail (default: apply).
12a. ⚑ **Blog post images after the first load lazily** (`loading="lazy"`, all `decoding="async"`): they appear as you scroll the reader instead of all at once (default: apply; it also keeps pictures above a search highlight from pushing it away).
13. ⚑ **Task 11 is owner-gated:** dropping `blur-[100px]` + `will-change-transform` from the blog feed's orbs (they are radial gradients already) changes the look slightly. Execute it only after the owner compares the before/after screenshots it produces. The caption cards' `backdrop-blur-lg` is the accepted original look (DESIGN_SYSTEM "The blog feed") and stays.
14. **Measurement without new dependencies:** render counts through `React.memo` test doubles and Profiler-free counters in vitest; real-browser behaviour (304 passthrough, scroll state across a feature switch) in `frontend/e2e/perf-chat.spec.ts` (Task 1, landed, asserts the page's own `chat_load outcome=not_modified` breadcrumb and records long tasks as test annotations via `PerformanceObserver('longtask')`). `web-vitals` is not added.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/features/messages/MessagesFeature.tsx` | modify (Tasks 1–5, 7) | conditional fetch, ★ overrides, store reads, stable callbacks, hidden-mode gating, Set-based unread |
| `frontend/src/features/messages/roomCache.ts` | create (Task 2) | LRU store with a room and a message bound |
| `frontend/src/features/messages/favoriteOverrides.ts` | create (Task 2) | pure ★ override helpers |
| `frontend/src/features/messages/timeline/buildTimeline.ts` | modify (Task 2) | one date parse per message |
| `frontend/src/features/messages/components/MessageList.tsx` | modify (Tasks 2, 4, 6) | `favoriteOverrides`, stable per-id reveal, `React.memo`, chat thumbnails |
| `frontend/src/features/messages/components/MessageBubble.tsx` | modify (Tasks 2, 6) | `isFavorite` prop; transcript lookup gate; box constants from `mediaUrl.ts` |
| `frontend/src/shell/syncProgressStore.ts` | create (Task 3) | the sync progress store |
| `frontend/src/shell/hooks/useSync.ts` | modify (Tasks 3, 4) | writes the store; selector |
| `frontend/src/shell/App.tsx`, `frontend/src/shell/components/SyncModal.tsx`, `frontend/src/core/layout/{Layout,ContentArea,InlineSyncView}.tsx` | modify (Tasks 3–5, 9) | store consumers; keep-mounted; lazy Memories |
| `frontend/src/features/messages/components/SyncStatusPill.tsx` | create (Task 3) | the chat header's sync pill |
| `frontend/src/core/layout/KeepMounted.tsx`, `frontend/src/design/featureActive.ts`, `frontend/src/hooks/useInert.ts` | create (Task 5) | hidden-but-mounted feature, its context (design level: the primitives read it), the `inert` hook |
| `frontend/src/design/primitives/{Modal,Menu}.tsx` | modify (Task 5) | render nothing inside a hidden feature |
| `frontend/src/core/layout/MemoriesChunkBoundary.tsx`, `frontend/src/i18n/locales/*.json` | create / modify (Task 9) | Retry instead of the crash screen when the Memories chunk fails; its one string |
| `frontend/src/hooks/useVisiblePolling.ts` | modify (Task 5) | `enabled` flag |
| `frontend/src/features/messages/components/MemberList.tsx` | modify (Tasks 4, 5, 8) | `React.memo`, paused polling, unchanged payloads |
| `frontend/src/features/messages/mediaUrl.ts`, `frontend/src/core/media/PhotoPlayer.tsx`, `frontend/src/hooks/useTranscription.ts` | modify (Task 6) | chat thumbnail width, `decoding="async"`, aborted lookups |
| `frontend/src/features/messages/readStateStore.ts`, `frontend/src/utils/timeOrder.ts`, `frontend/src/core/modals/FavoritesModal.tsx`, `frontend/src/core/media/MediaGalleryModal.tsx` | modify (Task 7) | linear reveal; sorting once; closed dialogs idle |
| `frontend/src/config/uiConstants.ts` | modify (Task 8) | `sidebarMs: 10000` |
| `frontend/src/features/memories/recap/posterImage.ts` | modify (Task 9) | dynamic `html-to-image` |
| `frontend/src/utils/intlCache.ts`, `frontend/src/utils/dateFormatters.ts`, `frontend/src/features/blogs/components/stagger.ts`, `frontend/src/features/blogs/components/{RecentPostsFeed,MemberTimelineModal}.tsx`, `frontend/src/features/blogs/blogHtml.ts` | create/modify (Task 10) | formatter cache, stagger cap, image hints |
| `frontend/src/core/common/DynamicBackground.tsx` | modify (Task 11, gated) | orbs without filter |
| `frontend/e2e/perf-chat.spec.ts` | create (Tasks 1, 5) | real-browser checks |

---

### Task 1: An unchanged room is never parsed or re-rendered again

Landed: d74c6725..1bfd4ee0

**Files:**
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` (`MessageCacheEntry`, `fetchMessages`, its three callers)
- Create: `frontend/src/features/messages/MessagesFeature.refresh.test.tsx`
- Create: `frontend/e2e/perf-chat.spec.ts`

**Interfaces:**
- Produces: `MessageCacheEntry.etag: string | null`; `fetchMessages(path: string, groupChat: boolean)` (the `lastReadId` parameter is gone). Task 2 and Task 5 build on these.

- [ ] **Step 1: Write the failing unit test**

Create `frontend/src/features/messages/MessagesFeature.refresh.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import type { Timeline } from './timeline/buildTimeline';
import { MessagesFeature } from './MessagesFeature';

// Every timeline the list was given, in render order: a 304 must not produce a new one.
const timelines: Timeline[] = [];
vi.mock('./components/MessageList', () => ({
    MessageList: (p: { timeline: Timeline }) => {
        timelines.push(p.timeline);
        return <div data-testid="list">{p.timeline.items.length}</div>;
    },
}));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };
const body = (content: string) => ({
    member,
    messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content, is_favorite: false, media_file: null, width: null, height: null }],
    total_count: 1,
    max_message_id: 1,
});

interface Seen { tag: string | null; lastRead: string | null }
let seen: Seen[] = [];
let version = '"v1"';
let content = 'こんにちは';

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', ({ request }) => {
            const tag = request.headers.get('If-None-Match');
            seen.push({ tag, lastRead: new URL(request.url).searchParams.get('last_read_id') });
            if (tag === version) return new HttpResponse(null, { status: 304, headers: { ETag: version } });
            return HttpResponse.json(body(content), { headers: { ETag: version } });
        }),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}

const props = { appSettings: null, syncVersion: 0 };

describe('MessagesFeature: conditional room refresh (UI health #1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        timelines.length = 0;
        seen = [];
        version = '"v1"';
        content = 'こんにちは';
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('sends the ETag on a refresh and keeps the same timeline on a 304', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        const shown = timelines[timelines.length - 1];

        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(seen).toHaveLength(2));
        await new Promise((r) => setTimeout(r, 50));

        expect(seen.map((s) => s.tag)).toEqual([null, '"v1"']);
        expect(timelines[timelines.length - 1]).toBe(shown);
    });

    it('never sends last_read_id (the read position must not change the ETag)', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(seen).toHaveLength(2));
        expect(seen.map((s) => s.lastRead)).toEqual([null, null]);
    });

    it('replaces the room and remembers the new ETag when it changed', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        const before = timelines[timelines.length - 1];

        version = '"v2"';
        content = '更新';
        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(timelines[timelines.length - 1]).not.toBe(before));

        rerender(<MessagesFeature {...props} syncVersion={2} />);
        await waitFor(() => expect(seen).toHaveLength(3));
        expect(seen.map((s) => s.tag)).toEqual([null, '"v1"', '"v2"']);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/features/messages/MessagesFeature.refresh.test.tsx`
Expected: FAIL — the second request has `tag: null` (no `If-None-Match`) and `lastRead: "0"`; the 304 test also sees a new timeline (or a TypeScript error for the missing `syncProgress` prop if Task 3 has not run: it has not — keep `syncProgress: { state: 'idle' } as never` in `props` until Task 3, which removes the prop).

> Until Task 3 lands, set `const props = { appSettings: null, syncProgress: { state: 'idle' } as never, syncVersion: 0 };` in this file; Task 3 Step 6 removes `syncProgress` from it.

- [ ] **Step 3: Implement the conditional fetch**

In `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Extend the cache entry:

```tsx
interface MessageCacheEntry {
    messages: GroupMessage[];
    membersMap: Record<string, MemberInfo>;
    totalMessages: number;
    maxMessageId: number;
    service: string;
    /** The response's ETag: the next fetch of this room asks with `If-None-Match`. */
    etag: string | null;
}
```

(b) Replace the whole `fetchMessages` function (from the `// === FETCH MESSAGES (Load All) ===` comment to the end of its `finally` block) with:

```tsx
    // === FETCH MESSAGES (Load All) ===
    // limit=0 loads the whole room in one request. One AbortController per fetch: a newer fetch
    // aborts it (its result would be discarded anyway), and so does CHAT_LOAD_TIMEOUT_MS. A room
    // that never loaded then shows the timeout or failure state with Retry; a room already on
    // screen (a background refresh) is kept as it is, and the failure only leaves a breadcrumb.
    // While the room is not on screen yet (the skeleton may show), the result is held through
    // `settleDelay`, so a shown skeleton stays at least minVisible.
    // A cached room is asked with its ETag (`If-None-Match`). The author-set header also makes the
    // webview skip its HTTP cache, so an unchanged room answers 304 here and nothing is parsed or
    // set again (UI health #1); without it the browser revalidated on its own and handed us the
    // whole cached body. No `last_read_id`: unread is counted here, and the read position must not
    // change the room's ETag.
    const fetchMessages = async (path: string, groupChat: boolean) => {
        const thisId = ++fetchIdRef.current;
        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        const holdForSkeleton = shownDirRef.current !== path;
        const carried = holdForSkeleton && roomWaitRef.current?.path === path ? roomWaitRef.current.startedAt : null;
        const startedAt = carried ?? Date.now();
        roomWaitRef.current = { path, startedAt };
        let timedOut = false;
        const deadline = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, Math.max(0, CHAT_LOAD_TIMEOUT_MS - (Date.now() - startedAt)));
        const isCurrent = () => thisId === fetchIdRef.current;
        /** Wait out the skeleton's min-visible time (cut short by an abort); false when a newer fetch took over. */
        const settle = async () => {
            const hold = holdForSkeleton ? settleDelay(Date.now() - startedAt) : 0;
            if (hold > 0 && !controller.signal.aborted) {
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, hold);
                    controller.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                });
            }
            return isCurrent();
        };
        setLoadFailure(null);
        let httpStatus: number | undefined;
        const knownEtag = messagesCacheRef.current.get(path)?.etag ?? null;
        try {
            const params = new URLSearchParams({ limit: '0' });
            // Add service parameter if available
            if (activeService) {
                params.set('service', activeService);
            }
            const url = groupChat
                ? `/api/content/group_messages/${encodeURIComponent(path)}?${params}`
                : `/api/content/messages_by_path?path=${encodeURIComponent(path)}&${params}`;
            const res = await fetch(url, {
                signal: controller.signal,
                headers: knownEtag ? { 'If-None-Match': knownEtag } : undefined,
            });
            if (!isCurrent()) return; // stale — a newer fetch superseded this one
            if (res.status === 304) {
                const cached = messagesCacheRef.current.get(path);
                if (!cached) {
                    // Evicted while the request ran: nothing to keep. Treated as a failed load.
                    httpStatus = 304;
                    throw new Error('room not modified but no longer cached');
                }
                if (!(await settle())) return; // stale
                if (shownDirRef.current !== path) {
                    setMembersMap(cached.membersMap);
                    setMessages(cached.messages);
                    setTotalMessages(cached.totalMessages);
                    setMaxMessageId(cached.maxMessageId);
                    setMessagesService(cached.service);
                    showDir(path);
                }
                setCacheEntry(path, cached); // most recently used
                // The room is confirmed current: the incoming-call hook evaluates on it, as on a 200.
                setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
                clientLog('chat_load', { outcome: 'not_modified' });
                return;
            }
            if (!res.ok) {
                httpStatus = res.status;
                throw new Error('room list request failed');
            }
            const etag = res.headers.get('ETag');
            let entry: MessageCacheEntry;
            if (groupChat) {
                const data = await res.json() as GroupMessagesResponse;
                const map: Record<string, MemberInfo> = {};
                for (const m of data.members) map[m.id] = m;
                entry = { messages: data.messages || [], membersMap: map, totalMessages: data.total_messages || 0, maxMessageId: data.max_message_id || 0, service: activeService!, etag };
            } else {
                const data = await res.json();
                const memberInfo = data.member as MemberInfo;
                entry = {
                    messages: data.messages || [],
                    membersMap: memberInfo ? { [memberInfo.id]: memberInfo } : {},
                    totalMessages: data.total_count || 0,
                    maxMessageId: data.max_message_id || 0,
                    service: activeService!,
                    etag,
                };
            }
            if (!(await settle())) return; // stale
            setMembersMap(entry.membersMap);
            setMessages(entry.messages);
            setTotalMessages(entry.totalMessages);
            setMaxMessageId(entry.maxMessageId);
            setMessagesService(activeService);
            showDir(path);
            setCacheEntry(path, entry);
            setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
        } catch {
            if (!isCurrent()) return; // superseded (and aborted): never a failure
            const kind: ChatLoadFailure = timedOut ? 'timeout' : 'error';
            const background = !holdForSkeleton;
            if (timedOut) logWait('chat_room', 'timeout', Date.now() - startedAt);
            // Codes only: never the path or the error text (the user sees translated copy).
            if (import.meta.env.DEV) console.warn('[MessagesFeature] fetchMessages failed', { groupChat, httpStatus, kind, background });
            // Production breadcrumb for both paths (the timeout also posts ui_wait): codes and the HTTP status only.
            clientLog('chat_load', {
                outcome: background ? 'kept_room' : 'error_state',
                reason: kind,
                ...(httpStatus === undefined ? {} : { error_code: httpStatus }),
            });
            // A background refresh never clears the room the user is reading (nor its scroll position);
            // the next sync or room visit refreshes it again.
            if (background) return;
            if (!(await settle())) return;
            setLoadFailure({ dir: path, kind });
            setMessages([]);
            showDir(null);
            setMembersMap({});
        } finally {
            clearTimeout(deadline);
            if (isCurrent()) roomWaitRef.current = null;
        }
    };
```

(c) Update the three callers (drop the third argument):

```tsx
    useEffect(() => {
        if (syncVersion > 0 && selectedGroupDir) {
            fetchMessages(selectedGroupDir, isGroupChat);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    }, [syncVersion]);
```

```tsx
    const retryMessages = () => {
        if (selectedGroupDir) fetchMessages(selectedGroupDir, isGroupChat);
    };
```

and in the selection effect replace `fetchMessages(selectedGroupDir, isGroupChat, loadReadState(selectedGroupDir).lastReadId);` with `fetchMessages(selectedGroupDir, isGroupChat);`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd frontend && npx vitest run src/features/messages/MessagesFeature.refresh.test.tsx src/features/messages/MessagesFeature.loading.test.tsx src/features/messages/MessagesFeature.favorite.test.tsx src/features/messages/MessagesFeature.recovery.test.tsx`
Expected: PASS (all).

- [ ] **Step 5: Write the real-browser check**

Chromium's handling of an author-set `If-None-Match` (cache bypass, 304 passed to the page) is exactly what jsdom cannot show. Create `frontend/e2e/perf-chat.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Rendering-performance contracts that need a real browser (UI health plan F).

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 } })

/** Serve the rooms with ETags; a matching If-None-Match gets 304. Returns the requests seen. */
async function serveWithEtags(page: Page, messages: { current: FixtureMessage[] }) {
  const seen: { room: string; tag: string | null; status: number }[] = []
  await page.route('**/api/content/messages_by_path*', async (route) => {
    const url = new URL(route.request().url())
    const room = (url.searchParams.get('path') ?? '').includes('Other Room') ? 'other' : 'big'
    const tag = route.request().headers()['if-none-match'] ?? null
    const etag = `"${room}-v1"`
    if (tag === etag) {
      seen.push({ room, tag, status: 304 })
      return route.fulfill({ status: 304, headers: { ETag: etag } })
    }
    seen.push({ room, tag, status: 200 })
    const msgs = room === 'big' ? messages.current : [{ ...messages.current[0], id: 1, content: 'Other room message' }]
    return route.fulfill({
      headers: { ETag: etag, 'Cache-Control': 'no-cache' },
      json: { member: null, messages: msgs, total_count: msgs.length, unread_count: 0, max_message_id: msgs[msgs.length - 1].id },
    })
  })
  return seen
}

/** Record every long task (≥ 50 ms) the page runs, as { start, duration } in page time. */
async function recordLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: { start: number; duration: number }[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
}
const longTasks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __longTasks: { start: number; duration: number }[] }).__longTasks)
const pageNow = (page: Page) => page.evaluate(() => performance.now())

test.describe('chat performance contracts', () => {
  let messages: { current: FixtureMessage[] }

  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
    messages = { current: buildBigRoom() }
    await pinBigRoom(page, { messages })
    await recordLongTasks(page)
  })

  test('a revisited unchanged room is asked with its ETag and the 304 keeps the list', async ({ page }) => {
    const seen = await serveWithEtags(page, messages)
    await page.goto('/')
    const beforeOpen = await pageNow(page)
    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
    // The first open of the 5 000-message room keeps one parse (Decision 5): recorded, not asserted.
    const firstOpen = (await longTasks(page)).filter((t) => t.start >= beforeOpen)
    test.info().annotations.push({ type: 'longest-task-first-open-ms', description: String(Math.round(Math.max(0, ...firstOpen.map((t) => t.duration)))) })

    await page.getByText('Other Room', { exact: true }).click()
    await expect(page.getByText('Other room message')).toBeVisible()
    await page.getByText('Big Room', { exact: true }).click()
    await expect.poll(() => seen.filter((s) => s.room === 'big').length).toBe(2)
    const after304 = await pageNow(page)

    expect(seen.filter((s) => s.room === 'big')).toEqual([
      { room: 'big', tag: null, status: 200 },
      { room: 'big', tag: '"big-v1"', status: 304 },
    ])
    // The cached list stays on screen: no skeleton, the newest row still there.
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible()
    await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
    // A 304 sets no room state: nothing heavy runs once it has landed.
    await page.waitForTimeout(500)
    const afterwards = (await longTasks(page)).filter((t) => t.start >= after304 && t.duration >= 100)
    expect(afterwards).toEqual([])
  })
})
```

- [ ] **Step 6: Run the e2e spec**

Run: `cd frontend && npm run build && npx playwright test e2e/perf-chat.spec.ts --reporter=line`
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/messages/MessagesFeature.tsx frontend/src/features/messages/MessagesFeature.refresh.test.tsx frontend/e2e/perf-chat.spec.ts
uv run git commit -m "perf(chat): skip unchanged rooms with the ETag on refresh" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ★, the timeline build and the room cache do no whole-room work

**Files:**
- Create: `frontend/src/features/messages/favoriteOverrides.ts`, `frontend/src/features/messages/favoriteOverrides.test.ts`
- Create: `frontend/src/features/messages/roomCache.ts`, `frontend/src/features/messages/roomCache.test.ts`
- Modify: `frontend/src/features/messages/timeline/buildTimeline.ts`, `frontend/src/features/messages/timeline/buildTimeline.test.ts`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/features/messages/components/MessageList.tsx`, `frontend/src/features/messages/components/MessageBubble.tsx`
- Create: `frontend/src/features/messages/MessagesFeature.timeline.test.tsx`, `frontend/src/features/messages/MessagesFeature.evicted.test.tsx`

**Interfaces:**
- Consumes: `MessageCacheEntry` with `etag` (Task 1).
- Produces:
  - `favoriteOverrides.ts`: `EMPTY_FAVORITES: ReadonlyMap<number, boolean>`, `withFavorite(map, id: number, starred: boolean): ReadonlyMap<number, boolean>`, `pruneFavoriteOverrides(map, messages: readonly Message[]): ReadonlyMap<number, boolean>`, `applyFavoriteOverrides(messages: Message[], map): Message[]`, `setFavoriteIn(messages: Message[], id: number, starred: boolean): Message[]`.
  - `roomCache.ts`: `storeRoom<E extends { messages: readonly unknown[] }>(cache: Map<string, E>, key: string, entry: E, limits?: RoomCacheLimits): void`, `ROOM_CACHE_LIMITS = { rooms: 20, messages: 60000 }`.
  - `MessageList` prop `favoriteOverrides?: ReadonlyMap<number, boolean>`; `MessageBubble` prop `isFavorite?: boolean` (defaults to `message.is_favorite`). Plan G Task 10 reads the bubble's `starred` value introduced here.

- [ ] **Step 1: Write the failing helper tests**

Create `frontend/src/features/messages/favoriteOverrides.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Message } from '../../types';
import { EMPTY_FAVORITES, applyFavoriteOverrides, pruneFavoriteOverrides, setFavoriteIn, withFavorite } from './favoriteOverrides';

const m = (id: number, is_favorite = false): Message => ({ id, timestamp: '2024-01-01T00:00:00Z', type: 'text', content: 'x', is_favorite });

describe('favoriteOverrides', () => {
    it('withFavorite returns a new map and never mutates the old one', () => {
        const a = withFavorite(EMPTY_FAVORITES, 1, true);
        expect(a.get(1)).toBe(true);
        expect(EMPTY_FAVORITES.size).toBe(0);
    });

    it('applyFavoriteOverrides keeps the array identity when there is nothing to apply', () => {
        const list = [m(1), m(2)];
        expect(applyFavoriteOverrides(list, EMPTY_FAVORITES)).toBe(list);
    });

    it('applyFavoriteOverrides replaces only the overridden messages', () => {
        const list = [m(1), m(2)];
        const out = applyFavoriteOverrides(list, withFavorite(EMPTY_FAVORITES, 2, true));
        expect(out[0]).toBe(list[0]);
        expect(out[1]).toEqual({ ...list[1], is_favorite: true });
    });

    it('pruneFavoriteOverrides drops what the server now agrees with, and missing ids', () => {
        let map = withFavorite(EMPTY_FAVORITES, 1, true);
        map = withFavorite(map, 2, true);
        map = withFavorite(map, 9, false);
        const pruned = pruneFavoriteOverrides(map, [m(1, true), m(2, false)]);
        expect([...pruned]).toEqual([[2, true]]);
    });

    it('pruneFavoriteOverrides returns the same map when nothing changes', () => {
        const map = withFavorite(EMPTY_FAVORITES, 2, true);
        expect(pruneFavoriteOverrides(map, [m(2, false)])).toBe(map);
        expect(pruneFavoriteOverrides(EMPTY_FAVORITES, [m(1)])).toBe(EMPTY_FAVORITES);
    });

    it('setFavoriteIn sets one message and keeps the rest by identity', () => {
        const list = [m(1), m(2)];
        const out = setFavoriteIn(list, 1, true);
        expect(out[0].is_favorite).toBe(true);
        expect(out[1]).toBe(list[1]);
        expect(setFavoriteIn(list, 7, true)).toBe(list);
    });
});
```

Create `frontend/src/features/messages/roomCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { storeRoom } from './roomCache';

const room = (n: number) => ({ messages: Array.from({ length: n }, (_, i) => i) });

describe('storeRoom', () => {
    it('keeps at most `rooms` entries, evicting the least recently stored', () => {
        const cache = new Map<string, { messages: number[] }>();
        for (const k of ['a', 'b', 'c']) storeRoom(cache, k, room(1), { rooms: 2, messages: 100 });
        expect([...cache.keys()]).toEqual(['b', 'c']);
    });

    it('moves a stored key to the most recent position', () => {
        const cache = new Map<string, { messages: number[] }>();
        storeRoom(cache, 'a', room(1), { rooms: 2, messages: 100 });
        storeRoom(cache, 'b', room(1), { rooms: 2, messages: 100 });
        storeRoom(cache, 'a', room(1), { rooms: 2, messages: 100 });
        storeRoom(cache, 'c', room(1), { rooms: 2, messages: 100 });
        expect([...cache.keys()]).toEqual(['a', 'c']);
    });

    it('evicts the oldest rooms until the message total fits', () => {
        const cache = new Map<string, { messages: number[] }>();
        storeRoom(cache, 'a', room(40), { rooms: 20, messages: 100 });
        storeRoom(cache, 'b', room(40), { rooms: 20, messages: 100 });
        storeRoom(cache, 'c', room(40), { rooms: 20, messages: 100 });
        expect([...cache.keys()]).toEqual(['b', 'c']);
    });

    it('always keeps the room just stored, even alone over the bound', () => {
        const cache = new Map<string, { messages: number[] }>();
        storeRoom(cache, 'a', room(10), { rooms: 20, messages: 100 });
        storeRoom(cache, 'big', room(500), { rooms: 20, messages: 100 });
        expect([...cache.keys()]).toEqual(['big']);
    });
});
```

Append to `frontend/src/features/messages/timeline/buildTimeline.test.ts` (keep its existing imports; add `toLocalDateStr` to them if missing: `import { toLocalDateStr } from '../../../utils/dateFormatters';`):

```ts
describe('buildTimeline day keys', () => {
    it('groups by the same local day as toLocalDateStr for every message', () => {
        // Hourly for 40 days across a month end, plus an invalid timestamp at the end.
        const start = Date.UTC(2024, 2, 20, 0, 0, 0);
        const msgs = Array.from({ length: 40 * 24 }, (_, i) => ({
            id: i + 1, timestamp: new Date(start + i * 3600_000).toISOString(),
            type: 'text' as const, content: 'x', is_favorite: false, member_id: '1',
        }));
        msgs.push({ id: 999999, timestamp: 'not a date', type: 'text', content: 'x', is_favorite: false, member_id: '1' });
        const tl = buildTimeline(msgs, []);
        const expected: string[] = [];
        for (const msg of msgs) {
            const day = toLocalDateStr(msg.timestamp);
            if (expected[expected.length - 1] !== day) expected.push(day);
        }
        expect(tl.groupDates).toEqual(expected);
        expect(tl.groupCounts.reduce((a, b) => a + b, 0)).toBe(msgs.length);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/messages/favoriteOverrides.test.ts src/features/messages/roomCache.test.ts src/features/messages/timeline/buildTimeline.test.ts`
Expected: FAIL — `Cannot find module './favoriteOverrides'` / `'./roomCache'`; the day-key test PASSES already (it pins today's behaviour before the change).

- [ ] **Step 3: Implement the helpers**

Create `frontend/src/features/messages/favoriteOverrides.ts`:

```ts
import type { Message } from '../../types';

/**
 * ★ changes made in the open room since its last fresh load: message id → starred.
 * The list reads them per bubble, so a toggle never rebuilds the timeline (UI health #1).
 */
export const EMPTY_FAVORITES: ReadonlyMap<number, boolean> = new Map();

export function withFavorite(map: ReadonlyMap<number, boolean>, id: number, starred: boolean): ReadonlyMap<number, boolean> {
    const next = new Map(map);
    next.set(id, starred);
    return next;
}

/** Drops overrides the loaded room now agrees with (or whose message is gone); `map` itself when none. */
export function pruneFavoriteOverrides(map: ReadonlyMap<number, boolean>, messages: readonly Message[]): ReadonlyMap<number, boolean> {
    if (map.size === 0) return map;
    const loaded = new Map<number, boolean>();
    for (const msg of messages) if (map.has(msg.id)) loaded.set(msg.id, msg.is_favorite);
    let changed = false;
    const next = new Map<number, boolean>();
    for (const [id, starred] of map) {
        if (loaded.has(id) && loaded.get(id) !== starred) next.set(id, starred);
        else changed = true;
    }
    return changed ? next : map;
}

/** The messages as the user sees them (dialogs that list stars); the same array when there is nothing to apply. */
export function applyFavoriteOverrides(messages: Message[], map: ReadonlyMap<number, boolean>): Message[] {
    if (map.size === 0) return messages;
    return messages.map((msg) => {
        const starred = map.get(msg.id);
        return starred === undefined || starred === msg.is_favorite ? msg : { ...msg, is_favorite: starred };
    });
}

/** `messages` with one message's star set (the cached copy after a save); the same array when absent. */
export function setFavoriteIn(messages: Message[], id: number, starred: boolean): Message[] {
    const at = messages.findIndex((msg) => msg.id === id);
    if (at === -1) return messages;
    const next = messages.slice();
    next[at] = { ...messages[at], is_favorite: starred };
    return next;
}
```

Create `frontend/src/features/messages/roomCache.ts`:

```ts
export interface RoomCacheLimits {
    /** Rooms kept. */
    rooms: number;
    /** Messages kept across all rooms. */
    messages: number;
}

/** 20 rooms (as before) and at most 60 000 messages in all: whole histories are large. */
export const ROOM_CACHE_LIMITS: RoomCacheLimits = { rooms: 20, messages: 60_000 };

/**
 * Store `entry` under `key` as the most recently used room, then evict the least recently used
 * rooms until both limits hold. The room just stored always stays, even alone over the bound.
 */
export function storeRoom<E extends { messages: readonly unknown[] }>(
    cache: Map<string, E>, key: string, entry: E, limits: RoomCacheLimits = ROOM_CACHE_LIMITS,
): void {
    cache.delete(key); // Map keeps insertion order: re-inserting makes it the newest
    cache.set(key, entry);
    let total = 0;
    for (const e of cache.values()) total += e.messages.length;
    for (const [k, e] of cache) {
        if (cache.size <= limits.rooms && total <= limits.messages) break;
        if (k === key) continue;
        cache.delete(k);
        total -= e.messages.length;
    }
}
```

In `frontend/src/features/messages/timeline/buildTimeline.ts`, add after `timeOf`:

```ts
/**
 * Local "YYYY-MM-DD" (the same as toLocalDateStr) of a parsed time. Messages come in time order,
 * so the previous day's key is reused while the time stays inside that local day: one Date
 * per day instead of a second string parse per message (UI health #1).
 */
function makeDayKeyer(): (time: number | null, iso: string) => string {
    let start = Infinity;
    let end = -Infinity;
    let key = '';
    return (time, iso) => {
        if (time === null) return toLocalDateStr(iso); // invalid: '' (an undated group)
        if (time >= start && time < end) return key;
        const d = new Date(time);
        const y = d.getFullYear();
        const m = d.getMonth();
        const day = d.getDate();
        start = new Date(y, m, day).getTime();
        end = new Date(y, m, day + 1).getTime();
        key = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return key;
    };
}
```

and in `buildTimeline`, before the `for (const message of messages)` loop add `const dayOf = makeDayKeyer();`, then replace `const day = toLocalDateStr(message.timestamp);` with `const day = dayOf(time, message.timestamp);`.

- [ ] **Step 4: Run the helper tests**

Run: `cd frontend && npx vitest run src/features/messages/favoriteOverrides.test.ts src/features/messages/roomCache.test.ts src/features/messages/timeline/buildTimeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

Create `frontend/src/features/messages/MessagesFeature.timeline.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { clientLog } from '../../utils/clientLog';
import * as timelineModule from './timeline/buildTimeline';
import { MessagesFeature } from './MessagesFeature';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('./timeline/buildTimeline', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./timeline/buildTimeline')>();
    return { ...actual, buildTimeline: vi.fn(actual.buildTimeline) };
});
vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => HttpResponse.json({
            member,
            messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: false, media_file: null, width: null, height: null }],
            total_count: 1,
            max_message_id: 1,
        })),
        http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        http.post('/api/favorites/:id', () => HttpResponse.json({ success: true, message_id: 1, is_favorite: true })),
    );
}

// Interim until Task 3 removes the prop: MessagesFeature still reads `syncProgress.state`.
const props = { appSettings: null, syncProgress: { state: 'idle' } as never, syncVersion: 0 };
const star = () => document.querySelector('.text-semantic-star');

/** Open the bubble's context menu (retrying on the current node: the bubble can be replaced right after it appears) and click ★. */
async function toggleStar() {
    await waitFor(() => {
        if (!screen.queryByRole('menuitem', { name: /favorites/ })) fireEvent.contextMenu(screen.getByText('こんにちは'));
        expect(screen.getByRole('menuitem', { name: /favorites/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('menuitem', { name: /favorites/ }));
}

describe('MessagesFeature: ★ without rebuilding the timeline (UI health #1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        vi.mocked(timelineModule.buildTimeline).mockClear();
        vi.mocked(clientLog).mockClear();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('lights the star without calling buildTimeline again', async () => {
        render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        const builds = vi.mocked(timelineModule.buildTimeline).mock.calls.length;

        await toggleStar();

        await waitFor(() => expect(star()).not.toBeNull());
        expect(vi.mocked(timelineModule.buildTimeline).mock.calls.length).toBe(builds);
    });

    it('takes the star back and leaves a code breadcrumb when the save fails', async () => {
        server.use(http.post('/api/favorites/:id', () => new HttpResponse(null, { status: 500 })));
        render(<MessagesFeature {...props} />);
        await screen.findByText('こんにちは');
        await toggleStar();
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith('chat_load', { outcome: 'favorite_not_saved' }));
        expect(star()).toBeNull();
    });
});
```

Create `frontend/src/features/messages/MessagesFeature.evicted.test.tsx` (a 304 for a room the 60 000-message bound evicted while it stays on screen):

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { clientLog } from '../../utils/clientLog';
import type { Timeline } from './timeline/buildTimeline';
import { MessagesFeature } from './MessagesFeature';

// vi.mock factories are hoisted above the imports: shared state comes from vi.hoisted.
const { timelines } = vi.hoisted(() => ({ timelines: [] as Timeline[] }));
vi.mock('./components/MessageList', () => ({
    MessageList: (p: { timeline: Timeline }) => { timelines.push(p.timeline); return <div data-testid="list" />; },
}));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
// Stands in for the 60 000-message bound evicting the room on screen: nothing stays cached.
vi.mock('./roomCache', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./roomCache')>()),
    storeRoom: (cache: Map<string, unknown>) => { cache.clear(); },
}));
vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };
// Interim until Task 3 removes the prop: MessagesFeature still reads `syncProgress.state`.
const props = { appSettings: null, syncProgress: { state: 'idle' } as never, syncVersion: 0 };

describe('MessagesFeature: a 304 for an evicted room (UI health #1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        timelines.length = 0;
        vi.mocked(clientLog).mockClear();
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        let calls = 0;
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
            http.get('/api/content/messages_by_path', () => {
                calls += 1;
                if (calls > 1) return new HttpResponse(null, { status: 304, headers: { ETag: '"v1"' } });
                return HttpResponse.json({
                    member,
                    messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: false, media_file: null, width: null, height: null }],
                    total_count: 1,
                    max_message_id: 1,
                }, { headers: { ETag: '"v1"' } });
            }),
            http.get('/api/chat/letters_local', () => HttpResponse.json({ letters: [] })),
            http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
            http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
            http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
        );
    });

    it('keeps the room on screen (no error state, same timeline) and logs the kept room', async () => {
        const { rerender, findByTestId } = render(<MessagesFeature {...props} />);
        await findByTestId('list');
        const shown = timelines[timelines.length - 1];

        rerender(<MessagesFeature {...props} syncVersion={1} />);
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith('chat_load', { outcome: 'kept_room', reason: 'error', error_code: 304 }));

        expect(screen.getByTestId('list')).toBeInTheDocument();
        expect(timelines[timelines.length - 1]).toBe(shown);
        expect(screen.queryByText(/Couldn't load the messages/)).toBeNull();
    });
});
```

(Task 1's background-refresh path already does this: the 304 with no cached entry is a failed background refresh, which keeps the room on screen. The test pins it now that the message bound makes eviction possible.)

- [ ] **Step 6: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/features/messages/MessagesFeature.timeline.test.tsx`
Expected: FAIL — `buildTimeline` is called once more after the click (the toggle maps the whole message array), and the failed save logs no breadcrumb.

- [ ] **Step 7: Wire the overrides, the cache bound and the bubble prop**

In `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Imports — add:

```tsx
import { EMPTY_FAVORITES, applyFavoriteOverrides, pruneFavoriteOverrides, setFavoriteIn, withFavorite } from './favoriteOverrides';
import { storeRoom } from './roomCache';
```

(b) Replace `const MAX_CACHED_CHATS = 20;` and the cache comment/`setCacheEntry` with:

```tsx
    // In-memory message cache: revisited chats render instantly from cache while a background refresh
    // runs (conditional, see fetchMessages). Bounded by roomCache.ts: 20 rooms and 60 000 messages in
    // all, least recently used first.
    const messagesCacheRef = useRef<Map<string, MessageCacheEntry>>(new Map());
```

```tsx
    const setCacheEntry = useCallback((key: string, entry: MessageCacheEntry) => {
        storeRoom(messagesCacheRef.current, key, entry);
    }, []);

    // A saved ★ in the cached copy, so a later visit renders it (Map.set keeps the LRU position).
    const patchCachedFavorite = useCallback((room: string, id: number, starred: boolean) => {
        const cache = messagesCacheRef.current;
        const entry = cache.get(room);
        if (entry) cache.set(room, { ...entry, messages: setFavoriteIn(entry.messages, id, starred) });
    }, []);
```

(delete the old `MAX_CACHED_CHATS` constant; nothing else uses it).

(c) After the `readState` state, add:

```tsx
    // ★ changes of the open room since its last fresh load (favoriteOverrides.ts).
    const [favoriteOverrides, setFavoriteOverrides] = useState<ReadonlyMap<number, boolean>>(EMPTY_FAVORITES);
    // The room the overrides belong to, read after an await (a failed save must not touch another room).
    const overridesRoomRef = useRef<string | undefined>(undefined);
```

(d) In the render-phase room block (`if (appliedDir !== selectedGroupDir) {`), add as its second line:

```tsx
        setFavoriteOverrides(EMPTY_FAVORITES);
```

and below the block add:

```tsx
    useLayoutEffect(() => {
        overridesRoomRef.current = selectedGroupDir;
    }, [selectedGroupDir]);
```

(e) In `fetchMessages`' 200 path, after `setMessages(entry.messages);` add:

```tsx
            setFavoriteOverrides(prev => pruneFavoriteOverrides(prev, entry.messages));
```

(f) Replace `handleToggleFavorite` with:

```tsx
    // Toggle favorite status: optimistic in `favoriteOverrides` (no timeline rebuild), then the API.
    const handleToggleFavorite = useCallback(async (messageId: number, currentState: boolean) => {
        if (!activeService) {
            console.error('No active service for favorite toggle');
            return;
        }
        const room = overridesRoomRef.current;
        setFavoriteOverrides(prev => withFavorite(prev, messageId, !currentState));

        // setFavorite resolves false on an HTTP error, a network failure or a
        // 200 with {success: false} (SD-CONTRACT-01), so a favourite that was
        // never saved never keeps its optimistic star.
        const saved = await setFavorite(activeService, messageId, !currentState);
        if (!saved) {
            if (overridesRoomRef.current === room) setFavoriteOverrides(prev => withFavorite(prev, messageId, currentState));
            console.error('Failed to toggle favorite');
            // Code only (no ids, no text), on an existing event: a ★ that did not save is findable in debug.log.
            clientLog('chat_load', { outcome: 'favorite_not_saved' });
            return;
        }
        if (room) patchCachedFavorite(room, messageId, !currentState);
    }, [activeService, patchCachedFavorite]);
```

(g) After `const displayMessages = useMemo(...)` add:

```tsx
    // What the ConversationMenu dialogs list (favourites, media): the stars as the user sees them.
    const menuMessages = useMemo(() => applyFavoriteOverrides(displayMessages, favoriteOverrides), [displayMessages, favoriteOverrides]);
```

and pass `messages={menuMessages}` (instead of `displayMessages`) to `<ConversationMenu>`.

(h) Pass `favoriteOverrides={favoriteOverrides}` to `<MessageList>`.

In `frontend/src/features/messages/components/MessageList.tsx`:

- add to `ChatListProps`:

```tsx
    /** ★ changes of the open room not yet in `timeline` (MessagesFeature's favoriteOverrides). */
    favoriteOverrides?: ReadonlyMap<number, boolean>;
```

- destructure `favoriteOverrides` in the component parameters and, in `renderItem`, pass to `<MessageBubble>`:

```tsx
                    isFavorite={favoriteOverrides?.get(msg.id) ?? msg.is_favorite}
```

In `frontend/src/features/messages/components/MessageBubble.tsx`:

- add to `MessageBubbleProps`:

```tsx
    /** The ★ as the user sees it (an unsaved or just-saved toggle); default `message.is_favorite`. */
    isFavorite?: boolean;
```

- destructure `isFavorite` in `MessageBubbleComponent`'s parameters, and right after `const { t } = useTranslation();` add:

```tsx
    const starred = isFavorite ?? message.is_favorite;
```

- replace the three reads of `message.is_favorite` with `starred`: in `handleToggleFavorite` (`onToggleFavorite(message.id, starred)`, deps `[onToggleFavorite, message.id, starred]`), in `<MessageContextMenu isFavorite={starred}`, and in `const favoriteStar = starred && (`.

- [ ] **Step 8: Run the tests**

Run: `cd frontend && npx vitest run src/features/messages`
Expected: PASS (including `MessagesFeature.favorite.test.tsx`: the star still lights at once, stays on save and goes out on failure; and `MessagesFeature.evicted.test.tsx`, which already passes on Task 1's code and pins the evicted-room path).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/messages
uv run git commit -m "perf(chat): toggle stars and build timelines without whole-room work" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sync progress lives in a store; a tick re-renders only the progress views

**Files:**
- Create: `frontend/src/shell/syncProgressStore.ts`, `frontend/src/shell/syncProgressStore.test.tsx`
- Create: `frontend/src/features/messages/components/SyncStatusPill.tsx`
- Modify: `frontend/src/shell/hooks/useSync.ts`, `frontend/src/shell/hooks/useSync.test.ts`
- Modify: `frontend/src/shell/App.tsx`, `frontend/src/shell/components/SyncModal.tsx`
- Modify: `frontend/src/core/layout/Layout.tsx`, `frontend/src/core/layout/ContentArea.tsx`, `frontend/src/core/layout/ContentArea.test.tsx`, `frontend/src/core/layout/InlineSyncView.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx` and its tests that pass `syncProgress`
- Create: `frontend/src/features/messages/MessagesFeature.syncTicks.test.tsx`

**Interfaces:**
- Produces (`syncProgressStore.ts`): `useSyncProgressStore` (zustand hook; state `{ active: SyncProgress; byService: Record<string, SyncProgress> }`), `setActiveProgress(p: SyncProgress): void`, `setServiceProgress(update: Record<string, SyncProgress> | ((prev: Record<string, SyncProgress>) => Record<string, SyncProgress>)): void`, `resetSyncProgressStore(): void`, `IDLE_PROGRESS`, `selectIsSyncing(s): boolean`. `MessagesFeature` loses its `syncProgress` prop; `Layout` loses `syncProgressByService`; `ContentArea` loses `syncProgress`; `useSync` no longer returns `syncProgress` / `syncProgressByService`. `SyncModal.tsx` exports `LiveSyncModal`; `InlineSyncView.tsx` exports `LiveInlineSyncView`.

- [ ] **Step 1: Write the failing store test**

Create `frontend/src/shell/syncProgressStore.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { IDLE_PROGRESS, resetSyncProgressStore, selectIsSyncing, setActiveProgress, setServiceProgress, useSyncProgressStore } from './syncProgressStore';

describe('syncProgressStore', () => {
    beforeEach(() => resetSyncProgressStore());

    it('starts idle with no services', () => {
        expect(useSyncProgressStore.getState()).toMatchObject({ active: IDLE_PROGRESS, byService: {} });
    });

    it('sets the shown progress and per-service progress (value or updater)', () => {
        setActiveProgress({ state: 'running', phase: 'syncing' });
        setServiceProgress({ hinatazaka46: { state: 'running' } });
        setServiceProgress((prev) => ({ ...prev, sakurazaka46: { state: 'queued', queue_position: 1 } }));
        const s = useSyncProgressStore.getState();
        expect(s.active.state).toBe('running');
        expect(Object.keys(s.byService)).toEqual(['hinatazaka46', 'sakurazaka46']);
        expect(selectIsSyncing(s)).toBe(true);
    });

    it('re-renders a selector subscriber only when its slice changes', () => {
        const renders: boolean[] = [];
        const Probe = () => {
            renders.push(useSyncProgressStore(selectIsSyncing));
            return null;
        };
        render(<Probe />);
        act(() => setActiveProgress({ state: 'running', completed: 1 }));
        act(() => setActiveProgress({ state: 'running', completed: 2 }));
        act(() => setActiveProgress({ state: 'running', completed: 3 }));
        act(() => setActiveProgress({ state: 'complete' }));
        expect(renders).toEqual([false, true, false]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/shell/syncProgressStore.test.tsx`
Expected: FAIL — `Cannot find module './syncProgressStore'`.

- [ ] **Step 3: Create the store**

Create `frontend/src/shell/syncProgressStore.ts`:

```ts
import { create } from 'zustand';
import type { SyncProgress } from '../features/messages/MessagesFeature';

export const IDLE_PROGRESS: SyncProgress = { state: 'idle' };

export interface SyncProgressState {
    /** The progress the app shows: the active service's, or the running step of a sequential sync. */
    active: SyncProgress;
    /** Every service's latest progress. */
    byService: Record<string, SyncProgress>;
}

/**
 * The one store of sync progress (UI health #2). Only `useSync` writes it (`setActiveProgress`,
 * `setServiceProgress`); views read it through a selector, so a progress tick re-renders the views
 * that show progress (the sync dialog, the inline first-sync view, the chat header pill) and
 * nothing else. It replaced the progress state `App` held, which re-rendered the whole UI every
 * second while a sync ran.
 */
export const useSyncProgressStore = create<SyncProgressState>()(() => ({ active: IDLE_PROGRESS, byService: {} }));

export function setActiveProgress(progress: SyncProgress): void {
    useSyncProgressStore.setState({ active: progress });
}

export function setServiceProgress(
    update: Record<string, SyncProgress> | ((prev: Record<string, SyncProgress>) => Record<string, SyncProgress>),
): void {
    useSyncProgressStore.setState((s) => ({ byService: typeof update === 'function' ? update(s.byService) : update }));
}

/** Tests and logout-like resets: back to idle, no services. */
export function resetSyncProgressStore(): void {
    useSyncProgressStore.setState({ active: IDLE_PROGRESS, byService: {} });
}

export const selectIsSyncing = (s: SyncProgressState): boolean => s.active.state === 'running';
```

Run: `cd frontend && npx vitest run src/shell/syncProgressStore.test.tsx`
Expected: PASS.

- [ ] **Step 4: Make useSync write the store**

In `frontend/src/shell/hooks/useSync.ts`:

(a) Import: `import { setActiveProgress, setServiceProgress, useSyncProgressStore } from '../syncProgressStore';`

(b) Replace the two state declarations

```ts
    // Per-service sync progress
    const [syncProgressByService, setSyncProgressByService] = useState<Record<string, SyncProgress>>({});

    // Legacy: single progress for active service (for backwards compat with UI)
    const [syncProgress, setSyncProgress] = useState<SyncProgress>({ state: 'idle' });
```

with

```ts
    // Sync progress lives in syncProgressStore (UI health #2): writing it re-renders only the views
    // that subscribe, never App. The aliases keep the setter names used throughout this hook.
    const setSyncProgressByService = setServiceProgress;
    const setSyncProgress = setActiveProgress;
```

(c) Delete the unused mirror:

```ts
    const syncProgressRef = useRef(syncProgress);

    useEffect(() => { syncProgressRef.current = syncProgress; }, [syncProgress]);
```

(d) Delete

```ts
    const syncProgressByServiceRef = useRef(syncProgressByService);
    useEffect(() => { syncProgressByServiceRef.current = syncProgressByService; }, [syncProgressByService]);
```

and replace each of its four reads `syncProgressByServiceRef.current[X]` (in `pollSyncProgress`' retry check, its `catch`, `startSync`'s `currentProgress`, and the sequence watcher's `known`) with `useSyncProgressStore.getState().byService[X]`.

(e) Replace the two "legacy follow" effects (`// Update legacy syncProgress when activeService changes` and `// During sequential sync, keep syncProgress in sync ...`) with:

```ts
    // The shown progress follows the active service and, during a sequential sync, its running step
    // (that one wins). Re-applied when either changes, and after every per-service update once that
    // update's synchronous work is done (a microtask), as the two commit-time effects this replaces did.
    const followRef = useRef<{ activeService: string | null; sequentialService: string | null }>({ activeService: null, sequentialService: null });
    useLayoutEffect(() => {
        followRef.current = { activeService, sequentialService: sequentialSyncInfo?.currentService ?? null };
    });
    useEffect(() => {
        const follow = () => {
            const { byService } = useSyncProgressStore.getState();
            const { activeService: shown, sequentialService } = followRef.current;
            if (shown && byService[shown]) setActiveProgress(byService[shown]);
            if (sequentialService && byService[sequentialService]) setActiveProgress(byService[sequentialService]);
        };
        follow();
        return useSyncProgressStore.subscribe((s, prev) => {
            if (s.byService !== prev.byService) queueMicrotask(follow);
        });
    }, [activeService, sequentialSyncInfo]);
```

(add `useLayoutEffect` to the React import if it is missing).

(f) In `UseSyncReturn` delete the `syncProgress` and `syncProgressByService` members, and delete them from the returned object. Update the hook's header example (the `@example` at the top of `useSync.ts`, which destructures `syncProgress`) so the docs match the code:

```ts
 *   const { startSync } = useSync({ … });
 *   const syncing = useSyncProgressStore(selectIsSyncing);
 *
 *   return (
 *     <button onClick={() => startSync(true)}>
 *       {syncing ? 'Syncing...' : 'Sync Now'}
 *     </button>
 *   );
```

(g) Remove now-unused imports (`useState` stays — other state uses it; keep `SyncProgress` type import, still used by the initial-progress literals).

- [ ] **Step 5: Point the useSync tests at the store**

In `frontend/src/shell/hooks/useSync.test.ts` add `import { resetSyncProgressStore, useSyncProgressStore } from '../syncProgressStore';`, call `resetSyncProgressStore();` first in its top-level `beforeEach` (add one if the file has none), then rewrite the reads:

```bash
cd frontend
sed -i 's/result\.current\.syncProgressByService/useSyncProgressStore.getState().byService/g; s/result\.current\.syncProgress\b/useSyncProgressStore.getState().active/g' src/shell/hooks/useSync.test.ts
grep -n "result.current.syncProgress" src/shell/hooks/useSync.test.ts || echo "none left"
```

Expected: `none left`. The two `expect(...).toBeDefined()` checks (store values are always defined) still pass. `expect(useSyncProgressStore.getState().byService).toEqual({})` at the old line 63 passes after the reset.

Run: `npx vitest run src/shell/hooks/useSync.test.ts`
Expected: PASS.

- [ ] **Step 6: Move the consumers to selectors**

(a) Create `frontend/src/features/messages/components/SyncStatusPill.tsx`:

```tsx
import React from 'react';
import { useTranslation } from '../../../i18n';
import { Spinner } from '../../../design/primitives';
import { getSyncDetail } from '../../../utils/syncFormatters';
import { useSyncProgressStore } from '../../../shell/syncProgressStore';
import { ChatHeaderPill } from './ChatHeaderPill';

/** The chat header's "syncing" pill: the only chat element that re-renders on each progress tick. */
export const SyncStatusPill: React.FC<{ light: boolean }> = ({ light }) => {
    const { t } = useTranslation();
    const progress = useSyncProgressStore((s) => s.active);
    if (progress.state !== 'running') return null;
    return (
        <ChatHeaderPill light={light} tone="status">
            <Spinner size="sm" tone="current" decorative className="h-3 w-3" />
            <span>{getSyncDetail(progress, t, t('sync.syncing'))}</span>
        </ChatHeaderPill>
    );
};
```

(b) `frontend/src/features/messages/MessagesFeature.tsx`:
- remove `syncProgress: SyncProgress;` from `MessagesFeatureProps` and `syncProgress,` from the destructured parameters;
- add imports `import { selectIsSyncing, useSyncProgressStore } from '../../shell/syncProgressStore';` and `import { SyncStatusPill } from './components/SyncStatusPill';`; remove `Spinner` from the primitives import and the `getSyncDetail` import (now unused);
- after `const { t } = useTranslation();` add `const isSyncing = useSyncProgressStore(selectIsSyncing);`
- `<MemberList ... isSyncing={isSyncing} ...>`;
- replace the header block `{syncProgress.state === 'running' && ( <ChatHeaderPill ...> ... </ChatHeaderPill> )}` with `<SyncStatusPill light={isLightHeader} />`.

(c) `frontend/src/shell/components/SyncModal.tsx` — add at the end:

```tsx
/** The sync dialog fed from the progress store: it, not App, re-renders on each tick. */
export const LiveSyncModal: React.FC<Omit<SyncModalProps, 'syncProgress'>> = (props) => {
    const syncProgress = useSyncProgressStore((s) => s.active);
    return <SyncModal {...props} syncProgress={syncProgress} />;
};
```

with `import { useSyncProgressStore } from '../syncProgressStore';` (export `SyncModalProps` if it is not exported: `export interface SyncModalProps`). Export `LiveSyncModal` from `frontend/src/shell/components/index.ts` next to `SyncModal`.

(d) `frontend/src/core/layout/InlineSyncView.tsx` — add at the end:

```tsx
/** The inline first-sync card fed from the progress store (re-renders on each tick, nothing around it does). */
export const LiveInlineSyncView: React.FC<{ service: string }> = ({ service }) => {
    const syncProgress = useSyncProgressStore((s) => s.byService[service]);
    return syncProgress ? <InlineSyncView service={service} syncProgress={syncProgress} /> : null;
};
```

with `import { useSyncProgressStore } from '../../shell/syncProgressStore';`.

(e) `frontend/src/core/layout/ContentArea.tsx`: remove the `syncProgress` prop (interface and parameter) and the `SyncProgress` type import; replace the `InlineSyncView` import with `import { LiveInlineSyncView } from './InlineSyncView';`; add `import { useSyncProgressStore } from '../../shell/syncProgressStore';`; then:

```tsx
    // A boolean slice: a progress tick re-renders the inline card only, never the feature beside it.
    const initialSyncActive = useSyncProgressStore((s) => isSyncActive(s.byService[service]));
```

and use `if (isInitialSyncing && initialSyncActive) { content = <ContentSheet><LiveInlineSyncView service={service} /></ContentSheet>; }`.

(f) `frontend/src/core/layout/Layout.tsx`: delete the `syncProgressByService` prop (interface, parameter, the `SyncProgress` import) and the `syncProgress={...}` attribute on `<ContentArea>`.

(g) `frontend/src/shell/App.tsx`: remove `syncProgress,` and `syncProgressByService,` from the `useSync` destructure; import `LiveSyncModal` instead of `SyncModal` from `./components`; render `{showSyncModal && <LiveSyncModal sequentialSyncInfo={sequentialSyncInfo} onClose={() => setShowSyncModal(false)} onCancel={() => cancelSync()} />}`; remove `syncProgressByService={syncProgressByService}` from `<Layout>` and `syncProgress={syncProgress}` from `<MessagesFeature>`.

(h) Tests:
- `frontend/src/core/layout/ContentArea.test.tsx`: change the mock to `vi.mock('./InlineSyncView', () => ({ InlineSyncView: () => <div>syncing</div>, LiveInlineSyncView: () => <div>syncing</div> }));`.
- In `MessagesFeature.{favorite,avatars,loading,galleryStatus,recovery,refresh,timeline,evicted}.test.tsx` remove `syncProgress: { state: 'idle' } as never, ` from `props` (and the interim comment above it).
- In `MessagesFeature.loading.test.tsx`, the test "the header sync pill uses a decorative spinner…": replace `render(<MessagesFeature {...props} syncProgress={{ state: 'running' } as never} />)` with

```tsx
        useSyncProgressStore.setState({ active: { state: 'running' } });
        const { container } = render(<MessagesFeature {...props} />);
```

and add `import { resetSyncProgressStore, useSyncProgressStore } from '../../shell/syncProgressStore';` plus `resetSyncProgressStore();` in that file's `beforeEach`.

- [ ] **Step 7: Write the render-count test**

Create `frontend/src/features/messages/MessagesFeature.syncTicks.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { resetSyncProgressStore, setActiveProgress } from '../../shell/syncProgressStore';
import { MessagesFeature } from './MessagesFeature';

// A non-memo stand-in: it renders exactly when MessagesFeature renders.
const renders = { feature: 0 };
vi.mock('./components/MemberList', () => ({
    MemberList: () => { renders.feature += 1; return null; },
}));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);

describe('MessagesFeature during a sync (UI health #2)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        renders.feature = 0;
        resetSyncProgressStore();
        useAppStore.setState({ activeService: 'hinatazaka46', selectedConversations: {} });
        server.use(http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })));
    });

    it('does not re-render on progress ticks; only the header pill changes', async () => {
        render(<MessagesFeature appSettings={null} syncVersion={0} />);
        act(() => setActiveProgress({ state: 'running', detail: 'Fetching page 1' }));
        const afterStart = renders.feature; // one render for isSyncing false → true
        for (let page = 2; page <= 6; page += 1) {
            act(() => setActiveProgress({ state: 'running', detail: `Fetching page ${page}` }));
        }
        expect(renders.feature).toBe(afterStart);
        expect(screen.getByText(/Fetching page 6/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 8: Run the affected suites and the type check**

Run: `cd frontend && npx vitest run src/shell src/core/layout src/features/messages && npx tsc --noEmit`
Expected: PASS; tsc clean (no leftover `syncProgress` references: `grep -rn "syncProgressByService\b" src --include=*.tsx | grep -v test` prints nothing outside `useSync.ts`).

- [ ] **Step 9: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(sync): keep sync progress in a store read by the progress views" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Stable chat callbacks keep the memo boundaries; no store-wide subscriptions

**Files:**
- Modify: `frontend/src/features/messages/components/MessageList.tsx`, `frontend/src/features/messages/components/MemberList.tsx`, `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/shell/App.tsx`
- Modify (selectors): `frontend/src/shell/App.tsx`, `frontend/src/shell/hooks/useSync.ts`, `frontend/src/shell/hooks/useSettings.ts`, `frontend/src/shell/context/AuthContext.tsx`, `frontend/src/core/layout/{Layout,ContentArea,FeatureRail,ServiceRail}.tsx`, `frontend/src/features/messages/MessagesFeature.tsx`
- Create: `frontend/src/features/messages/components/MessageList.memo.test.tsx`, `frontend/src/store/noWholeStoreSubscription.test.ts`

**Interfaces:**
- Produces: `MessageList` and `MemberList` are `React.memo` components (same props). `MessageList` passes each bubble a stable per-message `onReveal` that calls the latest `onReveal(id)`.

- [ ] **Step 1: Write the failing memo test**

Create `frontend/src/features/messages/components/MessageList.memo.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { buildTimeline } from '../timeline/buildTimeline';
import { messages } from '../../../__tests__/messageListHelpers';
import { MessageList } from './MessageList';

// vi.mock factories are hoisted above the imports: shared state comes from vi.hoisted.
const { bubbleRenders } = vi.hoisted(() => ({ bubbleRenders: [] as number[] }));
vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({ useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: () => {} }) }));
vi.mock('./MessageBubble', async () => {
    const { memo } = await import('react');
    // A memoised stand-in, like the real MessageBubble: it renders only when its props change.
    const Bubble = memo((p: { message: { id: number }; onReveal?: () => void }) => {
        bubbleRenders.push(p.message.id);
        return <button type="button" onClick={p.onReveal}>{`reveal ${p.message.id}`}</button>;
    });
    return { MessageBubble: Bubble };
});

const timeline = buildTimeline(messages, []);
const getSenderInfo = () => ({ name: 'n' });
const isUnread = () => true;
const onLongPress = () => {};

function list(onReveal: (id: number) => void) {
    return (
        <MessageList
            memberId="room"
            timeline={timeline}
            getSenderInfo={getSenderInfo}
            isUnread={isUnread}
            onReveal={onReveal}
            onLongPress={onLongPress}
        />
    );
}

describe('MessageList memo boundaries (UI health #2)', () => {
    beforeEach(() => { bubbleRenders.length = 0; });

    it('a new onReveal from the parent does not re-render any bubble', () => {
        const { rerender } = render(list(vi.fn()));
        const first = bubbleRenders.length;
        rerender(list(vi.fn()));
        expect(bubbleRenders.length).toBe(first);
    });

    it('a bubble reveal calls the latest onReveal with its id', () => {
        const older = vi.fn();
        const latest = vi.fn();
        const { rerender } = render(list(older));
        rerender(list(latest));
        fireEvent.click(screen.getByText('reveal 2'));
        expect(older).not.toHaveBeenCalled();
        expect(latest).toHaveBeenCalledWith(2);
    });
});
```

Create `frontend/src/store/noWholeStoreSubscription.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// `useAppStore()` without a selector re-renders on every change anywhere in the store
// (UI health P-A4). Components select fields (or `useShallow`) instead.
const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return sources(full);
        return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
    });
}

describe('useAppStore subscriptions', () => {
    it('no source file subscribes to the whole store', () => {
        const offenders = sources(SRC)
            .filter((file) => readFileSync(file, 'utf-8')
                .split('\n')
                .some((line) => /useAppStore\(\)/.test(line) && !/^\s*(\/\/|\*)/.test(line)))
            .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
        expect(offenders).toEqual([]);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageList.memo.test.tsx src/store/noWholeStoreSubscription.test.ts`
Expected: FAIL — the rerender re-renders all three bubbles (inline `() => onReveal(msg.id)`); the scan lists 10 files (`core/layout/{AddServiceModal,ContentArea,FeatureRail,Layout,ServiceRail}.tsx`, `features/messages/MessagesFeature.tsx`, `shell/App.tsx`, `shell/context/AuthContext.tsx`, `shell/hooks/{useSettings,useSync}.ts`).

- [ ] **Step 3: Stable per-message reveal and `React.memo` in MessageList**

In `frontend/src/features/messages/components/MessageList.tsx`:

(a) Rename the component: `export const MessageList: React.FC<ChatListProps> = ({` → `const MessageListComponent: React.FC<ChatListProps> = ({`, and at the end of the file add:

```tsx
/** Memoised: MessagesFeature re-renders for state the list does not show (dialogs, the header). */
export const MessageList = React.memo(MessageListComponent);
```

(b) Inside the component, after the `latest` ref block, add:

```tsx
    // One stable reveal callback per message id, calling the latest `onReveal`: an inline
    // `() => onReveal(msg.id)` was a new prop on every render and re-rendered every bubble.
    const onRevealRef = useRef(onReveal);
    useEffect(() => { onRevealRef.current = onReveal; }, [onReveal]);
    const revealCallbacks = useRef(new Map<number, () => void>());
    const revealFor = useCallback((id: number) => {
        let fn = revealCallbacks.current.get(id);
        if (!fn) {
            fn = () => onRevealRef.current(id);
            revealCallbacks.current.set(id, fn);
        }
        return fn;
    }, []);
    // The list is not remounted on a room switch: drop the previous room's callbacks, so the map holds
    // only the open room's ids.
    useEffect(() => () => revealCallbacks.current.clear(), [memberId]);
```

(c) In `renderItem`, replace `onReveal={() => onReveal(msg.id)}` with `onReveal={revealFor(msg.id)}`.

- [ ] **Step 4: Stable parents**

In `frontend/src/features/messages/MessagesFeature.tsx`:

(a) Add after the `jumpToLetter` callback:

```tsx
    // Stable props for the memoised list and sidebar.
    const openRevealConfirm = useCallback(() => setShowRevealConfirm(true), []);
    const openMemberProfile = useCallback(() => setShowMemberProfile(true), []);
    const clearTargetMessage = useCallback(() => setTargetMessageId(null), [setTargetMessageId]);
    const milestoneFooter = useMemo(() => (milestone ? <MilestoneFooter milestone={milestone} /> : undefined), [milestone]);
```

and in `<MessageList>` use `onLongPress={openRevealConfirm}`, `onAvatarClick={openMemberProfile}`, `onTargetMessageConsumed={clearTargetMessage}`, `footer={milestoneFooter}`.

(b) Wrap `handleSelectGroup` in `useCallback(..., [selectedGroupDir, activeService, setSelectedConversation])` (body unchanged).

(c) Replace `const { activeService, setSelectedConversation, getSelectedConversation } = useAppStore();` with

```tsx
    const { activeService, setSelectedConversation, getSelectedConversation } = useAppStore(useShallow((s) => ({
        activeService: s.activeService,
        setSelectedConversation: s.setSelectedConversation,
        getSelectedConversation: s.getSelectedConversation,
    })));
```

and add `import { useShallow } from 'zustand/react/shallow';`.

In `frontend/src/features/messages/components/MemberList.tsx`: rename `export const MemberList: React.FC<SidebarProps> = (` to `const MemberListComponent: React.FC<SidebarProps> = (` and add at the end of the file:

```tsx
/** Memoised: its parent re-renders for chat state the sidebar does not show. */
export const MemberList = React.memo(MemberListComponent);
```

In `frontend/src/shell/App.tsx`, add after the `useSync` call:

```tsx
    const syncNow = useCallback(() => startSync(false), [startSync]);
```

and pass `onSyncNow={syncNow}` to `<MessagesFeature>`.

- [ ] **Step 5: Selectors instead of whole-store subscriptions**

Apply these replacements (each file imports `useShallow` from `'zustand/react/shallow'` where used):

`frontend/src/shell/App.tsx`:

```tsx
    const {
        activeService,
        setActiveService,
        selectedServices,
        setSelectedServices,
        setActiveFeature,
        setFreshlyAddedService,
    } = useAppStore(useShallow((s) => ({
        activeService: s.activeService,
        setActiveService: s.setActiveService,
        selectedServices: s.selectedServices,
        setSelectedServices: s.setSelectedServices,
        setActiveFeature: s.setActiveFeature,
        setFreshlyAddedService: s.setFreshlyAddedService,
    })));
```

`frontend/src/shell/hooks/useSync.ts`: `const activeService = useAppStore((s) => s.activeService);`

`frontend/src/shell/hooks/useSettings.ts`: `const selectedServices = useAppStore((s) => s.selectedServices);`

`frontend/src/shell/context/AuthContext.tsx`: `const setActiveService = useAppStore((s) => s.setActiveService);`

`frontend/src/core/layout/Layout.tsx`:

```tsx
    const activeService = useAppStore((s) => s.activeService);
    const setActiveService = useAppStore((s) => s.setActiveService);
    const selectedServices = useAppStore((s) => s.selectedServices);
    // getServiceOrder() builds a new array when services are missing from the stored order: compare by content.
    const serviceOrder = useAppStore(useShallow((s) => s.getServiceOrder()));
```

and delete `const serviceOrder = getServiceOrder();`.

`frontend/src/core/layout/ContentArea.tsx`: replace `const { getActiveFeature } = useAppStore(); const activeFeature = getActiveFeature(service);` with `const activeFeature = useAppStore((s) => s.getActiveFeature(service));`.

`frontend/src/core/layout/FeatureRail.tsx`:

```tsx
    const activeFeature = useAppStore((s) => s.getActiveFeature(service));
    const featureOrder = useAppStore(useShallow((s) => s.getFeatureOrder(service)));
    const setActiveFeature = useAppStore((s) => s.setActiveFeature);
    const triggerBlogViewReset = useAppStore((s) => s.triggerBlogViewReset);
```

(delete the old destructure and the two `getActiveFeature(service)` / `getFeatureOrder(service)` lines).

`frontend/src/core/layout/ServiceRail.tsx`:

```tsx
    const activeService = useAppStore((s) => s.activeService);
    const setActiveService = useAppStore((s) => s.setActiveService);
    const removeSelectedService = useAppStore((s) => s.removeSelectedService);
    // Read at drop time (an event handler), so the function itself is selected.
    const getServiceOrder = useAppStore((s) => s.getServiceOrder);
    const setServiceOrder = useAppStore((s) => s.setServiceOrder);
```

`frontend/src/core/layout/AddServiceModal.tsx`:

```tsx
    const { addSelectedService, setActiveService, setActiveFeature, getServiceOrder, setFreshlyAddedService } = useAppStore(useShallow((s) => ({
        addSelectedService: s.addSelectedService,
        setActiveService: s.setActiveService,
        setActiveFeature: s.setActiveFeature,
        getServiceOrder: s.getServiceOrder,
        setFreshlyAddedService: s.setFreshlyAddedService,
    })));
```

Leave the JSDoc examples in `store/appStore.ts` as they are (comment lines are ignored by the scan).

- [ ] **Step 6: Run the tests and the type check**

Run: `cd frontend && npx vitest run src/features/messages src/store src/core/layout src/shell && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(chat): keep list memo boundaries and select store fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Messages stays mounted when another feature shows

**Files:**
- Create: `frontend/src/hooks/useInert.ts`, `frontend/src/design/featureActive.ts`, `frontend/src/core/layout/KeepMounted.tsx`, `frontend/src/core/layout/KeepMounted.test.tsx`
- Modify: `frontend/src/design/primitives/Modal.tsx`, `frontend/src/design/primitives/Menu.tsx`; create `frontend/src/design/primitives/featureHidden.test.tsx`
- Modify: `frontend/src/core/layout/ContentArea.tsx`, `frontend/src/core/layout/ContentArea.test.tsx`
- Modify: `frontend/src/hooks/useVisiblePolling.ts`, `frontend/src/hooks/useVisiblePolling.test.ts`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/features/messages/components/MemberList.tsx`
- Create: `frontend/src/features/messages/MessagesFeature.hidden.test.tsx`
- Modify: `frontend/e2e/perf-chat.spec.ts`

**Interfaces:**
- Consumes: `fetchMessages(path, groupChat)` (Task 1); `useSyncProgressStore` (Task 3).
- Produces: `useInert(ref: RefObject<HTMLElement | null>, on: boolean): void` (Plan G reuses it); `FeatureActiveContext`, `useFeatureActive(): boolean` (default `true`, in `design/featureActive.ts`); `Modal` and `Menu` render nothing while it is false; `KeepMounted({ active, children })`; `useVisiblePolling(callback, intervalMs, deps, options?: { enabled?: boolean })`; `MemberList` prop `paused?: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/core/layout/KeepMounted.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeepMounted } from './KeepMounted';
import { useFeatureActive } from '../../design/featureActive';

const Probe = () => <span data-testid="probe">{useFeatureActive() ? 'active' : 'hidden'}</span>;

describe('KeepMounted', () => {
    it('shows its child normally while active', () => {
        render(<KeepMounted active><Probe /></KeepMounted>);
        const box = screen.getByTestId('kept-feature');
        expect(box).not.toHaveAttribute('inert');
        expect(box.style.contentVisibility).toBe('');
        expect(screen.getByTestId('probe')).toHaveTextContent('active');
    });

    it('keeps the same child mounted, inert and skipped from rendering while hidden', () => {
        const { rerender } = render(<KeepMounted active><Probe /></KeepMounted>);
        const node = screen.getByTestId('probe');
        rerender(<KeepMounted active={false}><Probe /></KeepMounted>);
        const box = screen.getByTestId('kept-feature');
        expect(screen.getByTestId('probe')).toBe(node);
        expect(box).toHaveAttribute('inert');
        expect(box.style.contentVisibility).toBe('hidden');
        expect(node).toHaveTextContent('hidden');
    });
});
```

Append to `frontend/src/core/layout/ContentArea.test.tsx` (inside the `describe`):

```tsx
    it('keeps messages mounted (hidden) after switching to blogs, and shows the same node again', () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'messages' } });
        const { rerender } = render(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
        const node = screen.getByTestId('messages');
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'blogs' } });
        rerender(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
        expect(screen.getByText('blogs')).toBeInTheDocument();
        expect(screen.getByTestId('messages')).toBe(node);
        expect(node.closest('[data-testid="kept-feature"]')).toHaveAttribute('inert');
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'messages' } });
        rerender(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
        expect(screen.getByTestId('messages')).toBe(node);
        expect(node.closest('[data-testid="kept-feature"]')).not.toHaveAttribute('inert');
    });

    it('does not mount messages before its first visit', () => {
        show('blogs');
        expect(screen.queryByTestId('messages')).toBeNull();
    });
```

Append to `frontend/src/hooks/useVisiblePolling.test.ts` (inside the `describe`):

```ts
    it('does not run while disabled and refreshes at once when enabled again', () => {
        const cb = vi.fn();
        const { rerender } = renderHook(({ enabled }) => useVisiblePolling(cb, 1000, [], { enabled }), { initialProps: { enabled: false } });
        vi.advanceTimersByTime(5000);
        expect(cb).not.toHaveBeenCalled();
        rerender({ enabled: true });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenLastCalledWith('immediate');
    });
```

Create `frontend/src/features/messages/MessagesFeature.hidden.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { FeatureActiveContext } from '../../design/featureActive';
import { clientLog } from '../../utils/clientLog';
import { useMilestone } from './milestones';
import { MessagesFeature } from './MessagesFeature';

vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('./milestones', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./milestones')>();
    return { ...actual, useMilestone: vi.fn(actual.useMilestone) };
});
vi.mock('../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));

const SERVICE = 'hinatazaka46';
const ROOM = '日向坂46/messages/34 金村 美玖/58 金村 美玖';
const OTHER = 'sakurazaka46';
const OTHER_ROOM = '櫻坂46/messages/40 森田 ひかる/60 森田 ひかる';
const member = { id: '58', name: '金村 美玖', path: ROOM, thumbnail_local: null, thumbnail: null, portrait: null, phone_image: null };
let archived = false;
let roomFetches = 0;
let letterFetches = 0;
let readSyncs: string[] = [];
let uiStates: { group_id: string | null }[] = [];

function serve() {
    server.use(
        http.get('/api/content/groups', () => HttpResponse.json({ groups: [], last_sync: {} })),
        http.get('/api/content/messages_by_path', () => {
            roomFetches += 1;
            return HttpResponse.json({
                member,
                messages: [{ id: 1, timestamp: '2024-01-15T09:00:00Z', type: 'text', content: 'こんにちは', is_favorite: archived, media_file: null, width: null, height: null }],
                total_count: 1,
                max_message_id: 1,
            });
        }),
        http.post('/api/ui-state', async ({ request }) => {
            uiStates.push(await request.json() as { group_id: string | null });
            return new HttpResponse(null, { status: 204 });
        }),
        http.post('/api/chat/mark-room-read-remote', async ({ request }) => {
            readSyncs.push((await request.json() as { service: string }).service);
            return HttpResponse.json({ ok: true });
        }),
        http.get('/api/chat/letters_local', () => {
            letterFetches += 1;
            return HttpResponse.json({ letters: [] });
        }),
        http.get('/api/chat/message_dates/*', () => HttpResponse.json({ dates: [] })),
        http.get('/api/account/profile', () => HttpResponse.json({ name: 'me', avatars: [] })),
        http.get('/api/content/profile_images', () => HttpResponse.json({ kinds: {} })),
        http.get('/api/chat/streak/:id', () => HttpResponse.json({ status: 'unavailable' })),
    );
}

const READ_SYNC_ON = { sync_read_to_phone: true } as never;
const view = (active: boolean, syncVersion = 0, appSettings: never | null = null) => (
    <FeatureActiveContext.Provider value={active}>
        <MessagesFeature appSettings={appSettings} syncVersion={syncVersion} />
    </FeatureActiveContext.Provider>
);
const lastMilestoneRoom = () => vi.mocked(useMilestone).mock.calls.at(-1)?.[0].roomKey;
const star = () => document.querySelector('.text-semantic-star');

describe('MessagesFeature hidden behind another feature (UI health #11)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        archived = false;
        roomFetches = 0;
        letterFetches = 0;
        readSyncs = [];
        uiStates = [];
        vi.mocked(clientLog).mockClear();
        vi.mocked(useMilestone).mockClear();
        useAppStore.setState({
            activeService: SERVICE,
            selectedConversations: { [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false } },
        });
        serve();
    });

    it('does not fetch on a finished sync while hidden, and refreshes once when shown', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        expect(roomFetches).toBe(1);
        rerender(view(false));
        rerender(view(false, 1));
        await new Promise((r) => setTimeout(r, 50));
        expect(roomFetches).toBe(1);
        rerender(view(true, 1));
        await waitFor(() => expect(roomFetches).toBe(2));
    });

    it('stops reporting the chat as viewed while hidden', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        rerender(view(false));
        await waitFor(() => expect(uiStates[uiStates.length - 1]).toMatchObject({ group_id: null }));
    });

    it('shows a star set elsewhere (e.g. the Memories gacha) when shown again', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        expect(star()).toBeNull();
        rerender(view(false));
        archived = true;
        rerender(view(true));
        await waitFor(() => expect(star()).not.toBeNull());
    });

    it('asks for no room extras on a finished sync while hidden, and catches up when shown', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        const before = letterFetches;
        rerender(view(false));
        rerender(view(false, 1));
        await new Promise((r) => setTimeout(r, 50));
        expect(letterFetches).toBe(before);
        rerender(view(true, 1));
        await waitFor(() => expect(letterFetches).toBe(before + 1));
    });

    it('evaluates no milestone while hidden', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        rerender(view(false));
        expect(lastMilestoneRoom()).toBeNull();
        rerender(view(true));
        await waitFor(() => expect(lastMilestoneRoom()).not.toBeNull());
    });

    it('defers the room restore and the read sync of a group switch made while hidden', async () => {
        const { rerender } = render(view(true, 0, READ_SYNC_ON));
        await screen.findByText('こんにちは');
        await waitFor(() => expect(readSyncs).toEqual([SERVICE]));
        const fetchesBefore = roomFetches;
        rerender(view(false, 0, READ_SYNC_ON));
        act(() => {
            useAppStore.setState({
                activeService: OTHER,
                selectedConversations: {
                    [SERVICE]: { path: ROOM, name: '金村 美玖', isGroupChat: false },
                    [OTHER]: { path: OTHER_ROOM, name: '森田 ひかる', isGroupChat: false },
                },
            });
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(readSyncs).toEqual([SERVICE]);
        expect(roomFetches).toBe(fetchesBefore);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('chat_load', { outcome: 'deferred', reason: 'hidden_restore' });

        rerender(view(true, 0, READ_SYNC_ON));
        await waitFor(() => expect(readSyncs).toEqual([SERVICE, OTHER]));
        await waitFor(() => expect(roomFetches).toBe(fetchesBefore + 1));
    });

    it('does not show its dialogs while hidden, and brings an open one back with Talk', async () => {
        const { rerender } = render(view(true));
        await screen.findByText('こんにちは');
        await userEvent.click(screen.getByRole('button', { name: 'More options' }));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Date Search' }));
        expect(await screen.findByRole('dialog', { name: 'Date Search' })).toBeInTheDocument();
        rerender(view(false));
        expect(screen.queryByRole('dialog')).toBeNull();
        rerender(view(true));
        expect(await screen.findByRole('dialog', { name: 'Date Search' })).toBeInTheDocument();
    });
});
```

Create `frontend/src/design/primitives/featureHidden.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureActiveContext } from '../featureActive';
import { openDialogCount } from '../dialog/dialogStack';
import { Modal } from './Modal';
import { Menu, MenuItem } from './Menu';

const ui = (active: boolean) => (
    <FeatureActiveContext.Provider value={active}>
        <Modal isOpen onClose={vi.fn()} title="日付で探す" closeLabel="閉じる" logId="calendar">本文</Modal>
        <Menu aria-label="操作" onClose={vi.fn()} point={{ x: 10, y: 10 }}><MenuItem>一</MenuItem></Menu>
    </FeatureActiveContext.Provider>
);

describe('dialogs and menus of a hidden feature (plan F Task 5)', () => {
    it('render nothing while the feature is hidden, and leave the dialog stack', () => {
        const { rerender } = render(ui(true));
        expect(screen.getByRole('dialog', { name: '日付で探す' })).toBeInTheDocument();
        expect(screen.getByRole('menu', { name: '操作' })).toBeInTheDocument();
        rerender(ui(false));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(openDialogCount()).toBe(0);
        rerender(ui(true));
        expect(screen.getByRole('dialog', { name: '日付で探す' })).toBeInTheDocument();
    });
});
```

(`logId` must be a `DialogLogId`: use the id `CalendarModal` passes.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/core/layout/KeepMounted.test.tsx src/core/layout/ContentArea.test.tsx src/hooks/useVisiblePolling.test.ts src/features/messages/MessagesFeature.hidden.test.tsx src/design/primitives/featureHidden.test.tsx`
Expected: FAIL — missing modules `./KeepMounted` / `design/featureActive`; ContentArea replaces the messages node; the polling hook ignores `enabled`; the hidden MessagesFeature fetches on the sync bump, asks for letters, evaluates milestones, restores the new group's room and syncs its read state, keeps reporting the chat and keeps its dialog. ("does not mount messages before its first visit" already passes on today's code: it is a guard, not one of the failures.)

- [ ] **Step 3: Implement the hook, the context and KeepMounted**

Create `frontend/src/hooks/useInert.ts`:

```ts
import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sets or removes `inert` on the element (no focus, no clicks, out of the accessibility tree).
 * Set directly because React 18 does not pass `inert` through as a boolean prop (same pattern as
 * BusyContent and listSnapshot).
 */
export function useInert(ref: RefObject<HTMLElement | null>, on: boolean): void {
    useLayoutEffect(() => {
        ref.current?.toggleAttribute('inert', on);
    }, [ref, on]);
}
```

Create `frontend/src/design/featureActive.ts` (a design-level context, like `design/scopeContext.ts`: the `Modal` and `Menu` primitives read it):

```ts
import { createContext, useContext } from 'react';

/** False while a kept-mounted feature (Messages) is hidden behind another one (ContentArea). */
export const FeatureActiveContext = createContext(true);

export const useFeatureActive = (): boolean => useContext(FeatureActiveContext);
```

`frontend/src/design/primitives/Modal.tsx` — replace the `Modal` wrapper with:

```tsx
/** Level 1 dialog on the dialog layer (docs/design/DESIGN_SYSTEM.md, "Dialogs"). */
export const Modal: React.FC<ModalProps> = (props) => {
    // A dialog of a feature kept mounted behind another one (Messages behind Blogs) is not shown: it is
    // portaled outside the hidden box, so neither content-visibility nor inert would hide it, and it
    // would keep the app behind it inert. Its open state is kept: it comes back with the feature.
    const featureActive = useFeatureActive();
    return props.isOpen && featureActive ? <OpenModal {...props} /> : null;
};
```

(`import { useFeatureActive } from '../featureActive';`).

`frontend/src/design/primitives/Menu.tsx` — rename the component `export const Menu: React.FC<MenuProps> = ({` to `const OpenMenu: React.FC<MenuProps> = ({` and add after it:

```tsx
/** Level-2 popover menu (docs/design/DESIGN_SYSTEM.md, "Menus"); nothing while its feature is hidden (as `Modal`). */
export const Menu: React.FC<MenuProps> = (props) => (useFeatureActive() ? <OpenMenu {...props} /> : null);
```

(`import { useFeatureActive } from '../featureActive';`). In `docs/design/DESIGN_SYSTEM.md`, add to "Dialogs" and to "Menus": "Inside a feature kept mounted behind another one (`useFeatureActive()` false, `design/featureActive.ts`), `Modal` and `Menu` render nothing; their open state is kept, so they come back with the feature."

Create `frontend/src/core/layout/KeepMounted.tsx`:

```tsx
import React, { useRef } from 'react';
import { useInert } from '../../hooks/useInert';
import { FeatureActiveContext } from '../../design/featureActive';

const HIDDEN: React.CSSProperties = { contentVisibility: 'hidden' };

/**
 * Keeps a feature mounted while another one shows (UI health #11). Hidden, it fills the same box
 * (`absolute inset-0`, so its scrollers keep their size and position) with `content-visibility:
 * hidden` (layout state kept, skipped from rendering, focus, find-in-page and the accessibility
 * tree) and `inert`. Children read `useFeatureActive()` to pause their own work.
 */
export const KeepMounted: React.FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    useInert(ref, !active);
    return (
        <div
            ref={ref}
            data-testid="kept-feature"
            data-active={active ? 'true' : 'false'}
            className={active ? 'flex h-full min-w-0 flex-1' : 'pointer-events-none absolute inset-0 flex min-w-0'}
            style={active ? undefined : HIDDEN}
        >
            <FeatureActiveContext.Provider value={active}>{children}</FeatureActiveContext.Provider>
        </div>
    );
};
```

- [ ] **Step 4: ContentArea keeps Messages after its first visit**

Replace the body of `ContentArea` in `frontend/src/core/layout/ContentArea.tsx` (keep `ComingSoon` and the imports; add `useState` to the React import, `import { KeepMounted } from './KeepMounted';`) with:

```tsx
export const ContentArea: React.FC<ContentAreaProps> = ({
    service,
    messagesContent,
    isInitialSyncing,
    blogBackupEnabled,
    userNickname,
}) => {
    const activeFeature = useAppStore((s) => s.getActiveFeature(service));
    // A boolean slice: a progress tick re-renders the inline card only, never the feature beside it.
    const initialSyncActive = useSyncProgressStore((s) => isSyncActive(s.byService[service]));
    const syncCard = Boolean(isInitialSyncing) && initialSyncActive;
    const messagesShown = !syncCard && activeFeature === 'messages';
    // Messages mounts on its first visit and then stays, hidden while another feature shows (KeepMounted):
    // its room cache, scroll position and sidebar survive a trip to Blogs or Memories (UI health #11).
    const [messagesVisited, setMessagesVisited] = useState(messagesShown);
    if (messagesShown && !messagesVisited) setMessagesVisited(true);

    let other: React.ReactNode = null;
    // A queued first sync (another service is syncing) shows its card too.
    if (syncCard) {
        other = <ContentSheet><LiveInlineSyncView service={service} /></ContentSheet>;
    } else if (activeFeature === 'blogs') {
        other = <ContentSheet><BlogsFeature blogBackupEnabled={blogBackupEnabled} /></ContentSheet>;
    } else if (activeFeature === 'memories') {
        other = <ContentSheet><MemoriesFeature service={service} nickname={userNickname} /></ContentSheet>;
    } else if (activeFeature === 'news' || activeFeature === 'fanclub' || activeFeature === 'ai') {
        other = <ContentSheet><ComingSoon feature={activeFeature} /></ContentSheet>;
    }

    return (
        <FadeOnChange changeKey={`${service}:${activeFeature}`} className="relative flex h-full min-w-0 flex-1">
            {messagesVisited && <KeepMounted active={messagesShown}>{messagesContent}</KeepMounted>}
            {other}
        </FadeOnChange>
    );
};
```

Update the doc comment above it: "Messages lays out its own member sidebar and chat sheet and stays mounted after its first visit (hidden while another feature shows)."

- [ ] **Step 5: Polling can be paused**

Replace `useVisiblePolling` in `frontend/src/hooks/useVisiblePolling.ts` with:

```ts
/**
 * Poll `callback` every `intervalMs`, skipping ticks while the window is hidden
 * (minimized / background tab) and refreshing once as soon as it is visible
 * again. Runs `callback` immediately on mount and whenever `deps` change; the
 * callback receives the trigger so event-driven runs can supersede a pending request.
 * `enabled: false` stops everything (a kept-mounted feature behind another one); turning it
 * back on runs `callback('immediate')` at once.
 *
 * `deps` must keep a constant length across renders (they are spread into the
 * effect's dependency array, like any other hook dependency list).
 */
export function useVisiblePolling(
    callback: (trigger: PollTrigger) => void,
    intervalMs: number,
    deps: DependencyList,
    { enabled = true }: { enabled?: boolean } = {},
): void {
    const cbRef = useRef(callback);
    cbRef.current = callback;

    useEffect(() => {
        if (!enabled) return;
        cbRef.current('immediate');
        const interval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            cbRef.current('tick');
        }, intervalMs);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') cbRef.current('visible');
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-controlled deps
    }, [intervalMs, enabled, ...deps]);
}
```

- [ ] **Step 6: MessagesFeature pauses its work while hidden**

In `frontend/src/features/messages/MessagesFeature.tsx` (add `import { useFeatureActive } from '../../design/featureActive';`):

(a) After `const { t } = useTranslation();` add:

```tsx
    // False while Messages is kept mounted behind another feature (ContentArea, Decision 7 of plan F).
    const featureActive = useFeatureActive();
```

(b) Group switch: lift the restore out of the service-switch effect, and defer it while hidden. Before the effect add:

```tsx
    // Restores the saved room of `service`, or clears the selection. Used by the group-switch effect
    // and by the hidden → shown edge (a group switch made from Blogs or Memories restores on show).
    const restoreSavedConversation = useCallback((service: string | null) => {
        const saved = service ? getSelectedConversation(service) : null;
        if (saved) {
            console.debug('[MessagesFeature] service switch → restoring', { service, isGroupChat: saved.isGroupChat });
            setSelectedGroupDir(saved.path);
            setSelectedName(saved.name);
            setIsGroupChat(saved.isGroupChat);
            setBackgroundSettings(loadBackgroundSettings(saved.path));
        } else {
            setSelectedGroupDir(undefined);
            setSelectedName(undefined);
            setIsGroupChat(false);
        }
    }, [getSelectedConversation]);
    // Set by a group switch made while hidden: the show edge restores the new group's room.
    const restoreOnShowRef = useRef(false);
```

and replace everything in the effect from `// Restore previous selection for the new service (if any)` down to (not including) `// Update ref for next switch` with:

```tsx
        if (featureActive) {
            restoreSavedConversation(activeService);
        } else {
            // Hidden: no room is opened behind another feature (no fetch, no read sync, no extras).
            setSelectedGroupDir(undefined);
            setSelectedName(undefined);
            setIsGroupChat(false);
            restoreOnShowRef.current = true;
            clientLog('chat_load', { outcome: 'deferred', reason: 'hidden_restore' });
        }
```

Its dependency list becomes `[activeService, getSelectedConversation, setSelectedConversation, showDir, restoreSavedConversation]` (with `// eslint-disable-next-line react-hooks/exhaustive-deps -- featureActive is read, not a trigger: the show edge below handles it` above it; the existing note on the excluded selection fields stays).

(c) Replace the sync-refresh effect with:

```tsx
    useEffect(() => {
        if (syncVersion > 0 && selectedGroupDir) {
            // Hidden: the show effect below refreshes the room when Messages comes back.
            if (!featureActive) {
                clientLog('chat_load', { outcome: 'deferred', reason: 'hidden' });
                return;
            }
            fetchMessages(selectedGroupDir, isGroupChat);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    }, [syncVersion]);

    // Shown again after another feature: restore the room of a group switch made while hidden (the
    // selection effect then loads it), else one background refresh (a 304 when nothing changed). It
    // also lets the incoming call evaluate, as the remount did before Messages was kept mounted.
    const wasActiveRef = useRef(featureActive);
    useEffect(() => {
        const was = wasActiveRef.current;
        wasActiveRef.current = featureActive;
        if (was || !featureActive) return;
        if (restoreOnShowRef.current) {
            restoreOnShowRef.current = false;
            restoreSavedConversation(activeService);
        } else if (selectedGroupDir) {
            fetchMessages(selectedGroupDir, isGroupChat);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the hidden → shown edge only
    }, [featureActive]);
```

(c1) In the selection effect, guard the fetch:

```tsx
    useEffect(() => {
        if (selectedGroupDir) {
            // The ref mirror for fetchMessages (the state was set while rendering, above): a cached
            // room is on screen, so its fetch is a background refresh.
            if (messagesCacheRef.current.has(selectedGroupDir)) showDir(selectedGroupDir);
            if (featureActive) {
                fetchMessages(selectedGroupDir, isGroupChat);
            } else {
                // Hidden (a selection made by a search or a restore behind another feature): the
                // show effect refreshes it.
                clientLog('chat_load', { outcome: 'deferred', reason: 'hidden_select' });
            }
            setIsSidebarOpen(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- featureActive is handled by the show effect
    }, [selectedGroupDir, isGroupChat, showDir]);
```

(c2) The read sync to the official app never fires while hidden; the hidden → shown edge counts as opening the room (the remount did that before). Replace `syncReadPrevRef` and its effect with:

```tsx
    const syncReadPrevRef = useRef<{ dir: string | undefined; on: boolean | undefined; active: boolean }>({
        dir: undefined,
        on: undefined,
        active: featureActive,
    });
    useEffect(() => {
        const on = appSettings?.sync_read_to_phone;
        const prev = syncReadPrevRef.current;
        if (!featureActive) {
            // Hidden: nothing is opened behind another feature. The room as last shown is kept, so
            // the show edge decides.
            if (selectedGroupDir && on && (selectedGroupDir !== prev.dir || prev.on === undefined)) {
                clientLog('chat_load', { outcome: 'deferred', reason: 'hidden_read_sync' });
            }
            syncReadPrevRef.current = { ...prev, active: false };
            return;
        }
        syncReadPrevRef.current = { dir: selectedGroupDir, on, active: true };
        if (!selectedGroupDir || !on) return;
        // Shown again after another feature counts as opening the room.
        const roomOpened = selectedGroupDir !== prev.dir || !prev.active;
        const settingsJustLoaded = prev.on === undefined; // null → loaded transition
        if (!roomOpened && !settingsJustLoaded) return; // pure setting toggle → ignore
        const parsedOpen = parseReadStatePath(selectedGroupDir);
        if (!parsedOpen) return;
        fetch('/api/chat/mark-room-read-remote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: parsedOpen.service, group_id: parsedOpen.groupId }),
        }).catch(() => {});
    }, [selectedGroupDir, appSettings?.sync_read_to_phone, featureActive]);
```

(keep the existing comment block above it and its fire-and-forget comment above the `fetch`).

(c3) The room extras keep the arguments of the room as last shown while hidden, so a finished sync or a group switch made from another feature asks nothing (no letters, profile or once-a-day streak request), and the shown room keeps its letters (no skeleton, no lost scroll position). They catch up in the render that shows Messages again. Replace `const roomExtras = useRoomExtras(activeService, selectedGroupDir, isGroupChat, syncVersion);` with:

```tsx
    const liveExtrasArgs = useMemo(
        () => ({ service: activeService, dir: selectedGroupDir, isGroupChat, syncVersion }),
        [activeService, selectedGroupDir, isGroupChat, syncVersion],
    );
    const [extrasArgs, setExtrasArgs] = useState(liveExtrasArgs);
    // Updated while rendering (the "adjust state on a prop change" pattern), so the render that shows
    // Messages again already asks for the current room.
    if (featureActive && extrasArgs !== liveExtrasArgs) setExtrasArgs(liveExtrasArgs);
    const roomExtras = useRoomExtras(extrasArgs.service, extrasArgs.dir, extrasArgs.isGroupChat, extrasArgs.syncVersion);
```

(c4) No milestone is evaluated while hidden (the room's open ends, as the unmount did; the show edge opens it again). In the `useMilestone({...})` arguments:

```tsx
        roomKey: featureActive && selectedGroupDir && messagesService && !isGroupChat ? `${messagesService}|${selectedGroupDir}` : null,
```

(d) `useUiStateReporter(featureActive ? selectedGroupDir : undefined);`

(e) In the `useIncomingCall({...})` arguments:

```tsx
        // Hidden: off (a ringing call ends, as when the feature unmounted); undefined until settings
        // load → no ring; a loaded value without the field defaults on.
        enabled: !featureActive ? false : appSettings ? (appSettings.incoming_call_enabled ?? true) : undefined,
```

(f) `<MemberList ... paused={!featureActive} />`.

In `frontend/src/features/messages/components/MemberList.tsx`: add `paused?: boolean;` to `SidebarProps` (doc: `/** Kept mounted behind another feature: no polling until shown again. */`), destructure `paused`, and change the polling call to:

```tsx
    useVisiblePolling(
        trigger => { void loadGroups(trigger === 'immediate'); },
        UI_CONSTANTS.polling.sidebarMs,
        [activeService],
        { enabled: !paused },
    );
```

- [ ] **Step 7: Run the unit tests**

Run: `cd frontend && npx vitest run src/core/layout src/hooks src/features/messages src/design`
Expected: PASS (the old "shows a star set elsewhere … when the chat opens again" test in `MessagesFeature.favorite.test.tsx` still passes: an unmount and a fresh mount behave as before).

- [ ] **Step 8: Add the real-browser check**

Append to `frontend/e2e/perf-chat.spec.ts` (add `pinBlogs` and `topVisibleMessageId` imports: `import { pinBlogs } from './fixtures/blogs'` and add `topVisibleMessageId` to the `./fixtures/bigRoom` import), inside the `describe`:

```ts
  test('switching to Blogs and back keeps the chat where it was without reloading it', async ({ page }) => {
    // Blog routes, then the big room again on top (later routes win), opening on Talk.
    await pinBlogs(page)
    await pinBigRoom(page, { messages })
    const seen = await serveWithEtags(page, messages)
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await expect(page.locator(`#msg-${COUNT}`)).toBeVisible({ timeout: 10000 })
    await page.locator('[data-virtuoso-scroller]').evaluate((el) => { el.scrollTop -= 1500 })
    await page.waitForTimeout(400)
    const before = await topVisibleMessageId(page)

    await page.getByRole('button', { name: 'Blogs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Latest Blogs' })).toBeVisible()
    await expect(page.locator('[data-testid="kept-feature"][data-active="false"]')).toHaveCount(1)

    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    await expect.poll(() => seen.filter((s) => s.room === 'big').length).toBe(2)
    expect(seen.filter((s) => s.room === 'big')[1].status).toBe(304)
    await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
    expect(await topVisibleMessageId(page)).toBe(before)
  })
```

Run: `cd frontend && npm run build && npx playwright test e2e/perf-chat.spec.ts e2e/timeline-scroll.spec.ts e2e/blogs.spec.ts --reporter=line`
Expected: all passed.

- [ ] **Step 9: Commit**

```bash
git add frontend/src frontend/e2e/perf-chat.spec.ts docs/design/DESIGN_SYSTEM.md
uv run git commit -m "perf(layout): keep Messages mounted while another feature shows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Chat photos from thumbnails; transcripts asked only when they can show

**Files:**
- Modify: `frontend/src/features/messages/mediaUrl.ts`, `frontend/src/features/messages/mediaUrl.test.ts`
- Modify: `frontend/src/features/messages/components/MessageList.tsx`, `frontend/src/features/messages/components/MessageBubble.tsx`
- Modify: `frontend/src/core/media/PhotoPlayer.tsx`
- Modify: `frontend/src/hooks/useTranscription.ts`
- Create: `frontend/src/features/messages/components/MessageList.thumbs.test.tsx`, `frontend/src/hooks/useTranscription.abort.test.ts`, `frontend/src/features/messages/components/MessageBubble.transcriptGate.test.tsx`

**Interfaces:**
- Produces: `CHAT_MEDIA_MAX_WIDTH = 320`, `CHAT_MEDIA_MAX_HEIGHT = 500`, `chatPictureThumbWidth(width, height, mediaFile, dpr): typeof THUMB_PREGEN_WIDTH | undefined` in `mediaUrl.ts` (480 or the original; Decision 8).

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/messages/mediaUrl.test.ts` (add `chatPictureThumbWidth` to its import from `./mediaUrl`):

```ts
describe('chatPictureThumbWidth', () => {
    it('uses the pre-generated 480 when it covers the bubble box at the screen density', () => {
        // 800×600 fits 320×240: the long side is 320 CSS px.
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 1)).toBe(480);
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 1.25)).toBe(480);
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 1.5)).toBe(480);
        // 600×800 fits 320×427: the long side is 427 CSS px.
        expect(chatPictureThumbWidth(600, 800, 'p/1.jpg', 1)).toBe(480);
    });

    it('keeps the original when the box needs more than 480 px (no 640, no upscale)', () => {
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 2)).toBeUndefined();
        expect(chatPictureThumbWidth(800, 600, 'p/1.jpg', 2.5)).toBeUndefined();
        expect(chatPictureThumbWidth(600, 800, 'p/1.jpg', 1.25)).toBeUndefined();
        expect(chatPictureThumbWidth(600, 800, 'p/1.jpg', 1.5)).toBeUndefined();
    });

    it('keeps the original when it is no larger than the thumbnail', () => {
        expect(chatPictureThumbWidth(400, 300, 'p/1.jpg', 1)).toBeUndefined();
        expect(chatPictureThumbWidth(480, 360, 'p/1.jpg', 1)).toBeUndefined();
    });

    it('keeps the original for GIFs and for pictures without dimensions', () => {
        expect(chatPictureThumbWidth(800, 600, 'p/1.GIF', 1)).toBeUndefined();
        expect(chatPictureThumbWidth(null, 600, 'p/1.jpg', 1)).toBeUndefined();
        expect(chatPictureThumbWidth(800, 600, null, 1)).toBeUndefined();
    });
});
```

Create `frontend/src/features/messages/components/MessageList.thumbs.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTimeline } from '../timeline/buildTimeline';
import { renderList } from '../../../__tests__/messageListHelpers';
import type { Message } from '../../../types';

// Last thumbnail width each bubble was given, by message id (the list may render more than once).
const { thumbs } = vi.hoisted(() => ({ thumbs: new Map<number, number | undefined>() }));
vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({ useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: () => {} }) }));
vi.mock('./MessageBubble', () => ({
    MessageBubble: (p: { message: { id: number }; mediaThumbWidth?: number }) => { thumbs.set(p.message.id, p.mediaThumbWidth); return null; },
}));

const pic = (id: number, file: string): Message => ({
    id, timestamp: `2026-01-0${id}T00:00:00Z`, type: 'picture', is_favorite: false, content: null,
    media_file: file, width: 800, height: 600,
} as Message);

describe('MessageList chat thumbnails (UI health #8)', () => {
    beforeEach(() => {
        thumbs.clear();
        Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    });

    it('asks pictures for the pre-generated thumbnail when it covers their box; GIFs keep the original', () => {
        renderList({ timeline: buildTimeline([pic(1, 'p/1.jpg'), pic(2, 'p/2.gif')], []) });
        expect(thumbs.get(1)).toBe(480);
        expect(thumbs.has(2)).toBe(true);
        expect(thumbs.get(2)).toBeUndefined();
    });
});
```

Create `frontend/src/hooks/useTranscription.abort.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTranscription } from './useTranscription';

describe('useTranscription cached lookup', () => {
    afterEach(() => vi.restoreAllMocks());

    it('aborts the lookup when the bubble unmounts', () => {
        const signals: (AbortSignal | undefined)[] = [];
        vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
            signals.push(init?.signal ?? undefined);
            return new Promise(() => {});
        });
        const { unmount } = renderHook(() => useTranscription('hinatazaka46', 7, 'room/member'));
        expect(signals).toHaveLength(1);
        unmount();
        expect(signals[0]?.aborted).toBe(true);
    });

    it('asks nothing without a service and message', () => {
        const spy = vi.spyOn(globalThis, 'fetch');
        renderHook(() => useTranscription(undefined, undefined, undefined));
        expect(spy).not.toHaveBeenCalled();
    });
});
```

Create `frontend/src/features/messages/components/MessageBubble.transcriptGate.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { useAppStore } from '../../../store/appStore';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const voice: Message = {
    id: 5, timestamp: '2024-01-15T09:00:00Z', type: 'voice', content: null, is_favorite: false,
    media_file: 'messages/1 R/1 R/voice/5.m4a',
} as Message;
let lookups = 0;

describe('MessageBubble transcript lookups (UI health P-C3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        lookups = 0;
        server.use(
            http.get('/api/app-state/translations', () => HttpResponse.json({})),
            http.get('/api/transcription/:service/:id', () => {
                lookups += 1;
                return new HttpResponse(null, { status: 404 });
            }),
        );
    });

    const bubble = (isUnread: boolean) => (
        <MessageBubble message={voice} member_name="n" service="hinatazaka46" memberPath="hinatazaka46/messages/1 R/1 R" isUnread={isUnread} />
    );

    it('asks nothing while transcription is off', async () => {
        useAppStore.setState({ transcriptionEnabled: false });
        render(bubble(false));
        await new Promise((r) => setTimeout(r, 30));
        expect(lookups).toBe(0);
    });

    it('asks nothing for an unread (sheltered) bubble', async () => {
        useAppStore.setState({ transcriptionEnabled: true });
        render(bubble(true));
        await new Promise((r) => setTimeout(r, 30));
        expect(lookups).toBe(0);
    });

    it('asks once for a revealed bubble with transcription on', async () => {
        useAppStore.setState({ transcriptionEnabled: true });
        render(bubble(false));
        await new Promise((r) => setTimeout(r, 30));
        expect(lookups).toBe(1);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/messages/mediaUrl.test.ts src/features/messages/components/MessageList.thumbs.test.tsx src/hooks/useTranscription.abort.test.ts src/features/messages/components/MessageBubble.transcriptGate.test.tsx`
Expected: FAIL — `chatPictureThumbWidth` is not exported; MessageList passes no thumbnail width; the lookup is not aborted; the bubble asks while transcription is off and while unread.

- [ ] **Step 3: Implement**

In `frontend/src/features/messages/mediaUrl.ts`, after `thumbWidthFor` add:

```ts
/** The chat bubble's picture box (MessageBubble's MediaContainer), in CSS px. */
export const CHAT_MEDIA_MAX_WIDTH = 320;
export const CHAT_MEDIA_MAX_HEIGHT = 500;

/**
 * The thumbnail width for a chat picture (UI health #8), or undefined to keep the original. Rule:
 * no visible difference and no extra backend work, so only the pre-generated `THUMB_PREGEN_WIDTH`
 * (480) is used, and only when the picture's box (fitted like MediaContainer) × `dpr` fits in it:
 * 320 / 160 would be derived on demand and 640 is rendered on demand only. At 200 % chat photos
 * keep their original. GIFs keep it too (a thumbnail is one still frame), and so do pictures
 * without stored dimensions (their box is unknown) or no larger than the thumbnail (it would only
 * re-encode them).
 */
export function chatPictureThumbWidth(
    width: number | null | undefined, height: number | null | undefined, mediaFile: string | null | undefined, dpr: number,
): typeof THUMB_PREGEN_WIDTH | undefined {
    if (!width || !height || !mediaFile || /\.gif$/i.test(mediaFile)) return undefined;
    if (Math.max(width, height) <= THUMB_PREGEN_WIDTH) return undefined;
    const ratio = width / height;
    let boxWidth = Math.min(CHAT_MEDIA_MAX_WIDTH, width);
    let boxHeight = boxWidth / ratio;
    if (boxHeight > CHAT_MEDIA_MAX_HEIGHT) {
        boxHeight = CHAT_MEDIA_MAX_HEIGHT;
        boxWidth = boxHeight * ratio;
    }
    const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const needed = Math.ceil(Math.max(boxWidth, boxHeight) * scale - 0.01);
    return needed <= THUMB_PREGEN_WIDTH ? THUMB_PREGEN_WIDTH : undefined;
}
```

In `frontend/src/features/messages/components/MessageBubble.tsx`:
- extend the `../mediaUrl` import with `CHAT_MEDIA_MAX_HEIGHT, CHAT_MEDIA_MAX_WIDTH` and replace `const MAX_MEDIA_WIDTH = 320;` / `const MAX_MEDIA_HEIGHT = 500;` with `const MAX_MEDIA_WIDTH = CHAT_MEDIA_MAX_WIDTH;` / `const MAX_MEDIA_HEIGHT = CHAT_MEDIA_MAX_HEIGHT;`;
- move `const transcriptionEnabled = useAppStore(s => s.transcriptionEnabled);` from the `// Feature toggles` block up to just before the `useTranscription` call, and replace the call with:

```tsx
    // Only a transcript that can show is asked for (UI health P-C3): transcription on, bubble revealed.
    const lookupTranscript = isTranscribable && transcriptionEnabled && !isUnread;
    const {
        transcription,
        state: transcriptionState,
        trigger: triggerTranscription,
        retrigger: retriggerTranscription,
        error: transcriptionError,
    } = useTranscription(
        lookupTranscript ? service : undefined,
        lookupTranscript ? message.id : undefined,
        lookupTranscript ? memberPath : undefined,
    );
```

In `frontend/src/features/messages/components/MessageList.tsx`: import `chatPictureThumbWidth` from `../mediaUrl` and `useDevicePixelRatio` from `../../../hooks/useDevicePixelRatio`; in the component add `const dpr = useDevicePixelRatio();`; in `renderItem` pass to `<MessageBubble>`:

```tsx
                    mediaThumbWidth={msg.type === 'picture' ? chatPictureThumbWidth(msg.width, msg.height, msg.media_file, dpr) : undefined}
```

In `frontend/src/core/media/PhotoPlayer.tsx`, in the bubble `<img ref={imgRef} ...>` add `decoding="async"` after `loading={effectiveLoading}` (the fullscreen variant keeps the default).

In `frontend/src/hooks/useTranscription.ts`, replace the cached-lookup effect with:

```ts
    useEffect(() => {
        setTranscription(null);
        setState('idle');
        setError(null);
        if (!service || !messageId) return;

        // Aborted when the bubble scrolls away or the message changes: it must not hold one of the
        // six connections the media and the next lookups need.
        const controller = new AbortController();
        // 404 = not transcribed yet, and a network error or abort: stay idle, don't show an error.
        fetchCachedTranscription(service, messageId, memberPath, controller.signal).then(
            (cached) => {
                if (!controller.signal.aborted && cached) {
                    setTranscription(cached);
                    setState('done');
                }
            },
            () => {},
        );
        return () => {
            controller.abort();
            // Cancel any in-flight transcribe POST for the message we're leaving.
            abortRef.current?.abort();
        };
    }, [service, messageId, memberPath]);
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/features/messages/components/MessageBubble.test.tsx -u && git diff --stat -- src/features/messages/components/__snapshots__`
Expected: the picture snapshot gains only `decoding="async"` on its `<img>` (inspect `git diff` of the `.snap` file: no other line changes).

Run: `cd frontend && npx vitest run src/features/messages src/hooks src/core/media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(chat): draw chat photos from thumbnails and gate transcripts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Linear reveal; the closed gallery and favourites dialogs stay idle

**Files:**
- Modify: `frontend/src/features/messages/readStateStore.ts`, `frontend/src/features/messages/readStateStore.test.ts`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`
- Modify: `frontend/src/utils/timeOrder.ts` (+ `frontend/src/utils/timeOrder.test.ts`; create the test file if absent)
- Modify: `frontend/src/core/modals/FavoritesModal.tsx`, `frontend/src/core/media/MediaGalleryModal.tsx`
- Create: `frontend/src/core/modals/FavoritesModal.idle.test.tsx`

**Interfaces:**
- Produces: `sortNewestFirst<T extends { timestamp: string }>(items: readonly T[]): T[]` in `utils/timeOrder.ts`; `applyReveal` keeps its signature and results.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/messages/readStateStore.test.ts` (add `applyReveal` and `ReadState` to its imports if missing):

```ts
/** The pre-0.5.1 implementation, kept as the reference for equivalence. */
function referenceApplyReveal(prev: ReadState, msgId: number, messageIds: number[]): ReadState {
    if (prev.revealedIds.includes(msgId)) return prev;
    const newRevealedIds = [...prev.revealedIds, msgId];
    const unreadMsgIds = messageIds.filter(id => id > prev.lastReadId).sort((a, b) => a - b);
    let newLastReadId = prev.lastReadId;
    for (const id of unreadMsgIds) {
        if (newRevealedIds.includes(id)) {
            const allPreviousRead = unreadMsgIds.filter(uid => uid <= id && uid > newLastReadId).every(uid => newRevealedIds.includes(uid));
            if (allPreviousRead) newLastReadId = id;
        }
    }
    return { lastReadId: newLastReadId, revealedIds: newRevealedIds.filter(id => id > newLastReadId), readCount: (prev.readCount || 0) + 1 };
}

describe('applyReveal is linear and unchanged in meaning (UI health P-B2)', () => {
    it('matches the reference on 2 000 generated cases', () => {
        let seed = 7;
        const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
        for (let c = 0; c < 2000; c += 1) {
            const ids = Array.from({ length: 1 + rand(30) }, (_, i) => i + 1 + rand(3) * 100);
            const lastReadId = rand(20);
            const revealedIds = ids.filter(() => rand(3) === 0).filter(id => id > lastReadId);
            const prev: ReadState = { lastReadId, readCount: rand(5), revealedIds };
            const msgId = ids[rand(ids.length)];
            expect(applyReveal(prev, msgId, ids)).toEqual(referenceApplyReveal(prev, msgId, ids));
        }
    });
});
```

Create or extend `frontend/src/utils/timeOrder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sortNewestFirst } from './timeOrder';

describe('sortNewestFirst', () => {
    it('sorts by time, newest first, keeping equal times in input order and unparsable last', () => {
        const items = [
            { id: 1, timestamp: '2024-01-01T00:00:00Z' },
            { id: 2, timestamp: 'bad' },
            { id: 3, timestamp: '2024-03-01T00:00:00+09:00' },
            { id: 4, timestamp: '2024-01-01T00:00:00Z' },
        ];
        expect(sortNewestFirst(items).map((i) => i.id)).toEqual([3, 1, 4, 2]);
    });
});
```

Create `frontend/src/core/modals/FavoritesModal.idle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../../i18n';
import type { Message } from '../../types';
import * as timeOrder from '../../utils/timeOrder';
import { FavoritesModal } from './FavoritesModal';

vi.mock('../../utils/timeOrder', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/timeOrder')>();
    return { ...actual, sortNewestFirst: vi.fn(actual.sortNewestFirst) };
});

const fav = (id: number): Message => ({ id, timestamp: `2024-01-0${id}T00:00:00Z`, type: 'text', content: `m${id}`, is_favorite: true });

describe('FavoritesModal while closed (UI health P-B3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('sorts nothing while closed and the favourites once open', () => {
        const props = { onClose: () => {}, memberName: 'n', serviceId: 'hinatazaka46' };
        const { rerender } = render(<FavoritesModal {...props} isOpen={false} messages={[fav(1)]} />);
        rerender(<FavoritesModal {...props} isOpen={false} messages={[fav(1), fav(2), fav(3)]} />);
        const sorted = vi.mocked(timeOrder.sortNewestFirst).mock.calls.map(([items]) => items.length);
        expect(sorted.every((n) => n === 0)).toBe(true);
        rerender(<FavoritesModal {...props} isOpen messages={[fav(1), fav(2), fav(3)]} />);
        expect(vi.mocked(timeOrder.sortNewestFirst).mock.calls.some(([items]) => items.length === 3)).toBe(true);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/features/messages/readStateStore.test.ts src/utils/timeOrder.test.ts src/core/modals/FavoritesModal.idle.test.tsx`
Expected: the equivalence test PASSES (it pins today's meaning); `sortNewestFirst` is missing (FAIL); the FavoritesModal test FAILS.

- [ ] **Step 3: Implement**

`frontend/src/features/messages/readStateStore.ts` — replace `applyReveal` with:

```ts
/**
 * Reveal one message. Pure: returns `prev` itself when the id is already
 * revealed. `messageIds` are the ids of the loaded chat, used to consolidate
 * contiguous revealed ids into `lastReadId`: it advances through the longest run
 * of revealed ids just above it. One sort and one pass (UI health P-B2; the
 * previous version was O(U²·R) on a room with many unread messages).
 */
export function applyReveal(prev: ReadState, msgId: number, messageIds: number[]): ReadState {
    if (prev.revealedIds.includes(msgId)) return prev;
    const revealed = new Set(prev.revealedIds);
    revealed.add(msgId);
    const unread = messageIds.filter(id => id > prev.lastReadId).sort((a, b) => a - b);
    let lastReadId = prev.lastReadId;
    for (const id of unread) {
        if (!revealed.has(id)) break;
        lastReadId = id;
    }
    return {
        lastReadId,
        revealedIds: [...revealed].filter(id => id > lastReadId),
        readCount: (prev.readCount || 0) + 1,
    };
}
```

`frontend/src/features/messages/MessagesFeature.tsx` — replace `displayUnreadCount` and `isUnread` with Set lookups:

```tsx
    // Revealed ids as a Set: unread checks run per message and per bubble.
    const revealedSet = useMemo(() => new Set(readState.revealedIds), [readState.revealedIds]);
    // Compute unread count from messages and readState (single source of truth)
    const displayUnreadCount = useMemo(
        () => messages.filter(m => m.id > readState.lastReadId && !revealedSet.has(m.id)).length,
        [messages, readState.lastReadId, revealedSet],
    );
```

```tsx
    const isUnread = useCallback((msgId: number) => {
        return msgId > readState.lastReadId && !revealedSet.has(msgId);
    }, [readState.lastReadId, revealedSet]);
```

`frontend/src/utils/timeOrder.ts` — append:

```ts
/**
 * `items` newest first by their ISO `timestamp`, parsing each timestamp once (not twice per
 * comparison). Equal times keep their input order; unparsable timestamps go last.
 */
export function sortNewestFirst<T extends { timestamp: string }>(items: readonly T[]): T[] {
    return items
        .map((item) => {
            const t = Date.parse(item.timestamp);
            return { item, t: Number.isNaN(t) ? -Infinity : t };
        })
        .sort((a, b) => (a.t === b.t ? 0 : a.t < b.t ? 1 : -1))
        .map(({ item }) => item);
}
```

`frontend/src/core/modals/FavoritesModal.tsx` — add `import { sortNewestFirst } from '../../utils/timeOrder';`, a module constant `const NO_MESSAGES: Message[] = [];` and replace `favoriteMessages`:

```tsx
    // Closed (it stays mounted in ConversationMenu): nothing to list, so no filter and no sort on
    // every change of the room (UI health P-B3).
    const source = isOpen ? messages : NO_MESSAGES;
    const favoriteMessages = useMemo(() => sortNewestFirst(source.filter(m => m.is_favorite)), [source]);
```

`frontend/src/core/media/MediaGalleryModal.tsx` — add the same import and `NO_MESSAGES` constant; in `mediaItems` filter `source` (`const source = isOpen ? messages : NO_MESSAGES;` declared just above it, deps `[source]`); in `groupedItems` replace the sort with `const sorted = sortNewestFirst(items);`; in `currentTabItems` return `sortNewestFirst(items)`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/features/messages src/utils src/core/modals src/core/media`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(chat): reveal in one pass; keep closed dialogs idle" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The sidebar polls every 10 s and ignores unchanged answers

**Files:**
- Create: `frontend/src/utils/shallowEqualRecord.ts`, `frontend/src/utils/shallowEqualRecord.test.ts`
- Modify: `frontend/src/config/uiConstants.ts`, `frontend/src/features/messages/components/MemberList.tsx`
- Create: `frontend/src/features/messages/components/MemberList.unchanged.test.tsx`

**Interfaces:**
- Produces: `shallowEqualRecord<V>(a: Record<string, V>, b: Record<string, V>): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/utils/shallowEqualRecord.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shallowEqualRecord } from './shallowEqualRecord';

describe('shallowEqualRecord', () => {
    it('compares keys and values one level deep', () => {
        expect(shallowEqualRecord({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
        expect(shallowEqualRecord({ a: 1 }, { a: 2 })).toBe(false);
        expect(shallowEqualRecord({ a: 1 }, { a: 1, b: 0 })).toBe(false);
        expect(shallowEqualRecord({}, {})).toBe(true);
    });
});
```

Create `frontend/src/features/messages/components/MemberList.unchanged.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';
import { MemberList } from './MemberList';

const renders = { badge: 0 };
vi.mock('../../../config/uiConstants', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../config/uiConstants')>();
    return { UI_CONSTANTS: { ...actual.UI_CONSTANTS, polling: { ...actual.UI_CONSTANTS.polling, sidebarMs: 50 } } };
});
vi.mock('../../../utils/clientLog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../utils/clientLog')>()),
    clientLog: vi.fn(),
}));
vi.mock('../../../design/primitives', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../design/primitives')>();
    // Badge renders once per tile per MemberList render: it counts the list's renders.
    return { ...actual, Badge: (p: { count: number }) => { renders.badge += 1; return actual.Badge(p); } };
});

const group = {
    id: '34', name: '金村 美玖', service: 'hinatazaka46', dir_name: '34 金村 美玖', group_path: 'g/34',
    member_count: 1, is_group_chat: false, is_active: true, members: [{ id: '58', name: '金村 美玖', path: 'g/34/58' }],
};

describe('MemberList with unchanged answers (UI health P-F1)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        renders.badge = 0;
        vi.mocked(clientLog).mockClear();
        server.use(
            http.get('/api/content/groups', () => HttpResponse.json({ groups: [group], last_sync: { hinatazaka46: '2026-11-01T00:00:00Z' } })),
            http.post('/api/content/unread_counts', () => HttpResponse.json({ 'g/34/58': 2 })),
        );
    });

    it('does not re-render on ticks that bring the same list, and says so once', async () => {
        render(<MemberList onSelectGroup={() => {}} activeService="hinatazaka46" />);
        await screen.findByText('金村 美玖');
        await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
        const settled = renders.badge;
        await new Promise((r) => setTimeout(r, 300)); // several 50 ms ticks
        expect(renders.badge).toBe(settled);
        const unchanged = vi.mocked(clientLog).mock.calls.filter(([e, f]) => e === 'sidebar_load' && f?.outcome === 'unchanged');
        expect(unchanged).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/utils/shallowEqualRecord.test.ts src/features/messages/components/MemberList.unchanged.test.tsx`
Expected: FAIL — missing module; the badge count grows with every tick and no `unchanged` breadcrumb is logged.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/shallowEqualRecord.ts`:

```ts
/** True when both records have the same keys with `===` values (one level deep). */
export function shallowEqualRecord<V>(a: Record<string, V>, b: Record<string, V>): boolean {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}
```

`frontend/src/config/uiConstants.ts`: `sidebarMs: 10000,` (comment: `// Content changes only with a sync; a sync end, a reveal and a room switch refresh at once.`).

`frontend/src/features/messages/components/MemberList.tsx` (import `shallowEqualRecord` from `../../../utils/shallowEqualRecord`):

(a) Add a ref next to `lastFailureLog`:

```tsx
    // An unchanged answer is logged once per streak (sidebar_load outcome=unchanged), not every tick.
    const unchangedLogged = useRef(false);
```

(b) In `loadGroups`, replace the `if (result.status === 'ok') { ... }` branch with:

```tsx
        if (result.status === 'ok') {
            const data = result.data;
            // Support both old format (array) and new format (object with groups + last_sync)
            const groupList = Array.isArray(data) ? data : data.groups;
            // An unchanged list sets no state: no re-sort and no re-render on each tick (UI health P-F1).
            if (JSON.stringify(groupList) !== JSON.stringify(groupsRef.current)) {
                setGroups(groupList);
                unchangedLogged.current = false;
            } else if (!unchangedLogged.current) {
                unchangedLogged.current = true;
                clientLog('sidebar_load', { ...(service ? { service } : {}), outcome: 'unchanged' });
            }
            setLoadError(false);
            lastFailureLog.current = null;
            if (!Array.isArray(data) && data.last_sync) {
                const lastSync = data.last_sync;
                setLastSyncMap(prev => (shallowEqualRecord(prev, lastSync) ? prev : lastSync));
            }
            checkUnread(groupList, replace);
        }
```

(c) In `checkUnread`, replace `setUnreadCounts(counts);` with `setUnreadCounts(prev => (shallowEqualRecord(prev, counts) ? prev : counts));`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/utils src/features/messages/components`
Expected: PASS (the existing `MemberList.*.test.tsx` mock `sidebarMs: 50` and keep working).

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(sidebar): poll every 10 s and skip unchanged answers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Memories and html-to-image load when first needed

**Files:**
- Modify: `frontend/src/core/layout/ContentArea.tsx`, `frontend/src/core/layout/ContentArea.test.tsx`
- Create: `frontend/src/core/layout/MemoriesChunkBoundary.tsx`, `frontend/src/core/layout/MemoriesChunkBoundary.test.tsx`
- Modify: `frontend/src/features/memories/recap/posterImage.ts`
- Modify: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json` (one key, `memories.chunkFailed`)

**Interfaces:**
- Produces: `MemoriesChunkError` (the lazy import's rejection, wrapped) and `MemoriesChunkBoundary` (props `children`, `title`, `retryLabel`, `onRetry`) in `core/layout/MemoriesChunkBoundary.tsx`. It shows `StatusBlock kind="error"` with Retry for a `MemoriesChunkError` and re-throws anything else to the root `ErrorBoundary` (a render crash inside Memories keeps today's crash screen).

- [ ] **Step 1: Record the current bundle**

Run: `cd frontend && npm run build >/dev/null && ls -l dist/assets/*.js | awk '{print $5, $9}' | sort -n | tail -3`
Expected: the largest is `App-*.js` (about 1.1 MB). Note its size for the commit body.

- [ ] **Step 2: Make the ContentArea tests async (they will need it)**

In `frontend/src/core/layout/ContentArea.test.tsx`, change the two Memories tests to await the lazy feature:

```tsx
    it('puts memories on the content sheet', async () => {
        show('memories');
        expect((await screen.findByText('memories')).closest('.bg-sheet')).toHaveClass('rounded-sheet', 'shadow-sheet');
    });

    it('hands the service nickname to memories', async () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'memories' } });
        render(<ContentArea service="hinatazaka46" messagesContent={<div />} userNickname="ゆき" />);
        expect(await screen.findByText('memories')).toHaveAttribute('data-nickname', 'ゆき');
    });
```

and change the mock target to the module the lazy import loads:

```tsx
vi.mock('../../features/memories/MemoriesFeature', () => ({
    MemoriesFeature: ({ nickname }: { nickname?: string }) => <div data-nickname={nickname ?? ''}>memories</div>,
}));
```

and add the test that pins the lazy load (inside the `describe`):

```tsx
    it('shows the pane loading state while Memories loads, then Memories', async () => {
        show('memories');
        expect(screen.getByRole('status')).toBeInTheDocument(); // the Suspense fallback (StatusBlock, hidden stage)
        expect(await screen.findByText('memories')).toBeInTheDocument();
    });
```

Run: `cd frontend && npx vitest run src/core/layout/ContentArea.test.tsx`
Expected: FAIL — only the new test: Memories renders at once (static import), so there is no loading status.

Create `frontend/src/core/layout/MemoriesChunkBoundary.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Component, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoriesChunkBoundary, MemoriesChunkError } from './MemoriesChunkBoundary';

class Outer extends Component<{ children: ReactNode }, { crashed: boolean }> {
    state = { crashed: false };
    static getDerivedStateFromError() { return { crashed: true }; }
    render() { return this.state.crashed ? <p>crash screen</p> : this.props.children; }
}

describe('MemoriesChunkBoundary (plan F Task 9)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('shows an error with Retry when the chunk fails, and renders Memories after Retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = true;
        const Child = () => {
            if (fail) throw new MemoriesChunkError(new TypeError('Failed to fetch dynamically imported module'));
            return <p>思い出</p>;
        };
        const onRetry = vi.fn(() => { fail = false; });
        render(
            <Outer>
                <MemoriesChunkBoundary title="思い出を開けませんでした" retryLabel="再試行" onRetry={onRetry}>
                    <Child />
                </MemoriesChunkBoundary>
            </Outer>,
        );
        expect(screen.getByText('思い出を開けませんでした')).toBeInTheDocument();
        expect(screen.queryByText('crash screen')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: '再試行' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(screen.getByText('思い出')).toBeInTheDocument();
    });

    it('leaves any other error to the root boundary', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const Child = () => { throw new Error('render bug'); };
        render(
            <Outer>
                <MemoriesChunkBoundary title="t" retryLabel="r" onRetry={vi.fn()}>
                    <Child />
                </MemoriesChunkBoundary>
            </Outer>,
        );
        expect(screen.getByText('crash screen')).toBeInTheDocument();
    });
});
```

Run: `cd frontend && npx vitest run src/core/layout/MemoriesChunkBoundary.test.tsx`
Expected: FAIL — module `./MemoriesChunkBoundary` not found.

- [ ] **Step 3: Lazy-load Memories inside the chunk boundary**

Create `frontend/src/core/layout/MemoriesChunkBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StatusBlock } from '../../design/primitives';
import { clientLog } from '../../utils/clientLog';

/** The lazy Memories import failed (a missing or unreadable chunk), as opposed to a render crash. */
export class MemoriesChunkError extends Error {
    /** The import's rejection (kept as a field: `lib` is ES2020, without `ErrorOptions`). */
    readonly reason: unknown;
    constructor(reason: unknown) {
        super('memories chunk failed to load');
        this.name = 'MemoriesChunkError';
        this.reason = reason;
    }
}

interface Props {
    children: ReactNode;
    title: string;
    retryLabel: string;
    /** Re-creates the lazy component (React.lazy keeps a rejected import), before the children render again. */
    onRetry: () => void;
}

/**
 * Between the Memories Suspense and the root: a chunk that fails to load shows an error with Retry
 * inside the pane, instead of the app-wide crash screen. Any other error is thrown on to the root
 * `ErrorBoundary`, so a render crash inside Memories behaves as before.
 */
export class MemoriesChunkBoundary extends Component<Props, { error: unknown }> {
    state: { error: unknown } = { error: null };

    static getDerivedStateFromError(error: unknown) {
        return { error };
    }

    componentDidCatch(error: unknown, _info: ErrorInfo) {
        if (error instanceof MemoriesChunkError) clientLog('app_load_failed', { target: 'memories_chunk', outcome: 'shown' });
    }

    private retry = () => {
        clientLog('app_load_failed', { target: 'memories_chunk', outcome: 'retry' });
        this.props.onRetry();
        this.setState({ error: null });
    };

    render() {
        const { error } = this.state;
        if (error === null) return this.props.children;
        if (!(error instanceof MemoriesChunkError)) throw error;
        return (
            <StatusBlock kind="error" variant="pane" surface="memories_chunk" title={this.props.title}
                onRetry={this.retry} retryLabel={this.props.retryLabel} />
        );
    }
}
```

(`target` and `outcome` are whitelisted `clientLog` fields; any `^[a-z0-9_]{1,40}$` value is accepted.)

Add the key to each locale under `memories` (next to `home`): en `"chunkFailed": "Couldn't open Memories"`, ja `"思い出を開けませんでした"`, zh-TW `"無法開啟回憶"`, zh-CN `"无法打开回忆"`, yue `"開唔到回憶"`.

In `frontend/src/core/layout/ContentArea.tsx`: remove `import { MemoriesFeature } from '../../features/memories';`, add `lazy, Suspense, useState` to the React import, `import { StatusBlock } from '../../design/primitives';`, `import { clientLog } from '../../utils/clientLog';` and `import { MemoriesChunkBoundary, MemoriesChunkError } from './MemoriesChunkBoundary';`, then at module level:

```tsx
// Memories (about 20 000 lines, with the recap's canvas export) loads on its first visit (UI health #13).
const loadMemories = () =>
    import('../../features/memories/MemoriesFeature')
        .then((m) => ({ default: m.MemoriesFeature }))
        .catch((err: unknown) => {
            clientLog('app_load_failed', { target: 'memories_chunk' });
            throw new MemoriesChunkError(err);
        });
const InitialMemories = lazy(loadMemories);
```

In the component (it already has `const { t } = useTranslation();`; add it if not):

```tsx
    // React.lazy keeps a rejected import: Retry needs a new lazy component.
    const [MemoriesFeature, setMemoriesFeature] = useState(() => InitialMemories);
```

and render it inside the boundary and a Suspense:

```tsx
    } else if (activeFeature === 'memories') {
        other = (
            <ContentSheet>
                <MemoriesChunkBoundary
                    title={t('memories.chunkFailed')}
                    retryLabel={t('common.retry')}
                    onRetry={() => setMemoriesFeature(() => lazy(loadMemories))}
                >
                    <Suspense fallback={<StatusBlock kind="loading" variant="pane" surface="memories_chunk" />}>
                        <MemoriesFeature service={service} nickname={userNickname} />
                    </Suspense>
                </MemoriesChunkBoundary>
            </ContentSheet>
        );
    }
```

- [ ] **Step 4: html-to-image at export time**

In `frontend/src/features/memories/recap/posterImage.ts`: delete `import { toCanvas } from 'html-to-image';` and, in the function that renders (just before `const canvas = await toCanvas(node, {`), add:

```ts
    // Loaded at export time: the library is only needed when the user saves a poster or a share image.
    const { toCanvas } = await import('html-to-image');
```

(`posterImage.test.ts` mocks `'html-to-image'`; vitest applies the mock to the dynamic import too.)

- [ ] **Step 5: Run the tests and rebuild**

Run: `cd frontend && npx vitest run src/core/layout src/features/memories/recap src/i18n && npm run build >/dev/null && ls -l dist/assets/*.js | awk '{print $5, $9}' | sort -n | tail -5`
Expected: tests PASS; the listing now has a `MemoriesFeature-*.js` chunk and an `html-to-image`-named (or hashed) chunk, and `App-*.js` is smaller than in Step 1.

Run: `npx playwright test e2e/csp.spec.ts --reporter=line`
Expected: passed (the lazy chunks load under the app CSP, `script-src 'self'`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(bundle): load Memories and html-to-image on first use" -m "App chunk: <before> → <after> bytes (npm run build)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Fill the two numbers from Steps 1 and 5.)

---

### Task 10: Shared date formatters, capped card stagger, blog image hints

**Files:**
- Create: `frontend/src/utils/intlCache.ts`, `frontend/src/utils/intlCache.test.ts`, `frontend/src/features/blogs/components/stagger.ts`, `frontend/src/features/blogs/components/stagger.test.ts`
- Modify: `frontend/src/utils/dateFormatters.ts`, `frontend/src/features/messages/components/MessageBubble.tsx` (`clockLabel`), `frontend/src/features/memories/day/format.ts`, `frontend/src/features/memories/home/SameTimeLine.tsx`
- Modify: `frontend/src/features/blogs/components/RecentPostsFeed.tsx`, `frontend/src/features/blogs/components/MemberTimelineModal.tsx`
- Modify: `frontend/src/features/blogs/blogHtml.ts`, `frontend/src/features/blogs/blogHtml.test.ts`

**Interfaces:**
- Produces: `dateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat`; `STAGGER_STEP_MS = 50`, `STAGGER_MAX_STEPS = 8`, `staggerDelay(index: number): number` in `features/blogs/components/stagger.ts` (not in `RecentPostsFeed.tsx`: a non-component export there trips `react-refresh/only-export-components` and spends the lint warning budget).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/utils/intlCache.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dateTimeFormat } from './intlCache';

describe('dateTimeFormat', () => {
    it('returns one shared formatter per locale and options', () => {
        const a = dateTimeFormat('ja', { month: 'long', day: 'numeric' });
        expect(dateTimeFormat('ja', { month: 'long', day: 'numeric' })).toBe(a);
        expect(dateTimeFormat('en', { month: 'long', day: 'numeric' })).not.toBe(a);
        expect(a.format(new Date(2024, 0, 15))).toBe('1月15日');
    });

    it('throws on an invalid locale like the constructor', () => {
        expect(() => dateTimeFormat('not a locale!', {})).toThrow(RangeError);
    });
});
```

Append to `frontend/src/features/blogs/blogHtml.test.ts`:

```ts
describe('buildBlogFragment image loading hints (UI health P-C2)', () => {
    it('loads the first picture at once and the rest lazily, all decoded off the main thread', () => {
        const fragment = buildBlogFragment(
            '<p><img src="https://example.com/a.jpg"><img src="https://example.com/b.jpg"><img src="https://example.com/c.jpg"></p>',
            { exact: [], reading: [] },
            'https://example.com',
            'http://127.0.0.1:8000',
        );
        const imgs = Array.from(fragment.querySelectorAll('img'));
        expect(imgs.map((i) => i.getAttribute('loading'))).toEqual([null, 'lazy', 'lazy']);
        expect(imgs.every((i) => i.getAttribute('decoding') === 'async')).toBe(true);
    });
});
```

(add `buildBlogFragment` to the file's import from `./blogHtml` if it is not there).

Create `frontend/src/features/blogs/components/stagger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { staggerDelay } from './stagger';

describe('staggerDelay', () => {
    it('steps 50 ms per card and stops after 8 steps', () => {
        expect([0, 1, 7, 8, 9, 120].map(staggerDelay)).toEqual([0, 50, 350, 400, 400, 400]);
    });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/utils/intlCache.test.ts src/features/blogs/blogHtml.test.ts src/features/blogs/components/stagger.test.ts`
Expected: FAIL — missing `./intlCache` and `./stagger`, no loading hints.

- [ ] **Step 3: Implement**

Create `frontend/src/utils/intlCache.ts`:

```ts
const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * One shared Intl.DateTimeFormat per locale and options (UI health P-B7): building one per call
 * showed in long lists (bubbles, search results, Memories days). Throws a RangeError on an invalid
 * locale, like the constructor (callers that fall back keep their try/catch).
 */
export function dateTimeFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale ?? ''}|${JSON.stringify(options)}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options);
        formatters.set(key, formatter);
    }
    return formatter;
}
```

Replace `new Intl.DateTimeFormat(` with `dateTimeFormat(` (importing it from the right relative path to `utils/intlCache`) at exactly these sites — same arguments:
- `frontend/src/utils/dateFormatters.ts`: `formatDatePillLabel` and both lines of `formatBlogDate` (the `try` keeps its `catch`);
- `frontend/src/features/messages/components/MessageBubble.tsx`: `clockLabel`;
- `frontend/src/features/memories/day/format.ts`: the three functions;
- `frontend/src/features/memories/home/SameTimeLine.tsx`: the `dateFormat` constant.

Create `frontend/src/features/blogs/components/stagger.ts`:

```ts
/** The blog cards' reveal stagger: 50 ms per card, at most 8 steps, so a long list never waits seconds. */
export const STAGGER_STEP_MS = 50;
export const STAGGER_MAX_STEPS = 8;
export const staggerDelay = (index: number): number => Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS;
```

`frontend/src/features/blogs/components/RecentPostsFeed.tsx` — `import { staggerDelay } from './stagger';` and replace `const delay = isNew ? Math.random() * 400 : index * 50;` with `const delay = isNew ? Math.random() * 400 : staggerDelay(index);`.

`frontend/src/features/blogs/components/MemberTimelineModal.tsx` — `import { staggerDelay } from './stagger';` and replace `animationDelay={index * 50}` with `animationDelay={staggerDelay(index)}`.

`frontend/src/features/blogs/blogHtml.ts` — in `buildBlogFragment`, after `resolveBlogUrls(...)`, add:

```ts
    // Loading hints (UI health P-C2): the first picture (usually in view) loads at once, the rest
    // when scrolled near, so pictures above a search highlight do not push it away while loading;
    // every picture decodes off the main thread.
    fragment.querySelectorAll('img').forEach((img, i) => {
        img.setAttribute('decoding', 'async');
        if (i > 0) img.setAttribute('loading', 'lazy');
    });
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npx vitest run src/utils src/features/blogs src/features/messages src/features/memories/day src/features/memories/home`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
uv run git commit -m "perf(ui): share date formatters, cap card stagger, hint blog images" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11 (owner-gated, Decision 13): Blog feed orbs without a blur filter

Run this task only after the owner has compared the two screenshots of Step 2 and approved. If the owner declines, skip it and record "P-D1a won't-fix (owner kept the look)" in Appendix A.

**Files:**
- Modify: `frontend/src/core/common/DynamicBackground.tsx`
- Create: `frontend/e2e/blog-orbs.spec.ts`

- [ ] **Step 1: Write the screenshot spec**

Create `frontend/e2e/blog-orbs.spec.ts`:

```ts
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
```

- [ ] **Step 2: Take the "before" shot, change the orbs, take the "after" shot**

Run: `cd frontend && npm run build && ORBS_SHOT=before npx playwright test e2e/blog-orbs.spec.ts --reporter=line`

In `frontend/src/core/common/DynamicBackground.tsx`, change the orb class from

```tsx
                className={cn('absolute rounded-pill blur-[100px] will-change-transform motion-reduce:animate-none', orb)}
```

to

```tsx
                // The orbs are radial gradients that already fade out: a 100 px blur on three large,
                // always-animating layers cost GPU time on every frame for almost no visible change.
                className={cn('absolute rounded-pill motion-reduce:animate-none', orb)}
```

Run: `npm run build && ORBS_SHOT=after npx playwright test e2e/blog-orbs.spec.ts --reporter=line`
Expected: `frontend/e2e-shots/blog-orbs-before.png` and `blog-orbs-after.png` exist. Hand both to the owner.

- [ ] **Step 3: On approval, run the blog tests and commit**

Run: `cd frontend && npx vitest run src/features/blogs src/core/common`
Expected: PASS.

```bash
git add frontend/src/core/common/DynamicBackground.tsx frontend/e2e/blog-orbs.spec.ts
uv run git commit -m "perf(blog): draw the feed orbs without a blur filter" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: CHANGELOG and final verification

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

- [ ] **Step 1: Add the entries**

Under `## [Unreleased]` → `### Changed` (after the existing entries):

```markdown
- **Chats reopen and refresh faster.** Coming back to a chat, or finishing a
  sync that brought nothing new, no longer reloads the whole conversation, and
  starring a message no longer redraws the chat.
- **The window stays smooth while syncing.** It no longer redraws everything
  every second during a sync; only the progress itself updates.
- **Talk is where you left it.** Switching to Blogs or Memories and back keeps
  the open chat, its scroll position and the member list, instead of loading
  them again.
- **Chat photos load lighter.** Photos in a chat are shown from smaller copies
  wherever they look the same on your screen, and the viewer still opens the
  full photo. Voice and
  video messages only look up their text when it can be shown.
- **SakaDesk starts with less to load.** Memories now loads the first time you
  open it, and the conversation list checks for changes less often.
```

(If Task 11 ran, append to the last entry: "The blog feed's background also uses less graphics power.")

- [ ] **Step 2: Full verification**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest run
npm run build && npx playwright test e2e/perf-chat.spec.ts e2e/timeline-scroll.spec.ts e2e/blogs.spec.ts e2e/csp.spec.ts --reporter=line
```

Expected: tsc clean; eslint 0 errors (≤ 20 warnings); vitest all pass (guard tests included); the four e2e specs pass.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
uv run git commit -m "docs(changelog): note the chat and sync performance work" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Guidance used (modern-web-guidance)

- **`performance`** — Tasks 1–4 remove repeat main-thread work instead of slicing it ("Any JavaScript execution exceeding 50ms should be split"); Task 8 slows the sidebar poll ("DON'T block the thread with recurring timers"); Task 9 splits Memories and html-to-image ("DON'T ship a single, enormous `app.js` bundle", "DO use dynamic imports"); Task 10 keeps the first blog picture eager ("DON'T lazy-load the LCP image").
- **`break-up-long-tasks`** — the reason paging/Worker are deferred with a measurement (Decision 5) rather than dropped: the first open of a huge room is still one task, and the guide's tiers ("> 250ms: Offload to a Web Worker", quoted in `performance`) are the trigger to revisit.
- **`defer-rendering-heavy-content`** — Task 5 hides kept-mounted Messages with `content-visibility: hidden` ("Skips layout calculations for hidden divs but preserves style containment state, allowing for instantaneous toggling without structural shifts (superior to `display: none`)"), adds `inert`, and accepts that it leaves find-in-page ("DO NOT use it if the content must remain discoverable while hidden" — hidden Messages must not be discoverable). `content-visibility: auto` for blog month sections was rejected per "DO NOT apply this property to elements within the initial, above-the-fold viewport".
- **`efficient-background-processing`** — Task 5 pauses the sidebar poll and the sync refresh while Messages is hidden ("pause expensive operations like … high-frequency WebSocket data polling when they are not needed, and resume them just-in-time").
- **`identify-inp-causes`** — Task 1's e2e records long tasks after the 304 lands instead of guessing ("DO attempt to identify the biggest blocking JavaScript"); the sync-tick and memo tests target processing and presentation work ("Presentation Delay (delays that are due to rendering the next frame after the interaction)").
- **`optimize-image-priority`** — blog post images: lazy for all but the first, no `fetchpriority` games ("For standard below-the-fold images, `loading="lazy"` is sufficient").
- **`lazy-load-video-and-audio`** — the basis for P-C4's won't-fix: `preload="none"` without a guaranteed poster gives empty players, and "`preload="metadata"` still initiates range requests" only for mounted (virtualised) bubbles.
- **`dynamic-sibling-animations`** — Task 10 keeps the JS index stagger (the cap needs `min()` over an index, and the existing `motion-reduce:animate-none` satisfies "**MANDATORY:** Respect user preferences by disabling the animation for users who prefer reduced motion").

## Windows owner checks

Record results in `.superpowers/sdd/windows-acceptance.md` under "Plan F".

1. **No-op sync (Tasks 1, 3).** Open a long chat (several thousand messages), press Sync now with nothing new: the chat does not flicker or jump, and during the sync the window stays responsive (scroll the chat, hover the member list). `debug.log` shows `chat_load outcome=not_modified` after the sync.
2. **★ in a long chat (Task 2).** Star and unstar a message near the bottom of a long chat: the star appears at once, the list does not jump; reopen the chat later and the star is still there; Favorites lists it.
3. **Blogs and back (Task 5).** Scroll a chat to the middle, open Blogs, wait for a sync to finish (or press Sync now there), come back to Talk: same position, no loading skeleton, new messages present. While on Blogs, a notification for the chat that was open in Talk does arrive. An incoming call does not ring while you are on Blogs; one ringing when you switch to Blogs stops; one you declined before the trip does not ring again when you come back (⚑ Decision 7). Switch group on the rail while on Blogs, then come back to Talk: the new group's last room opens (with sync-read-to-phone on, its unread clears on the phone only now). A dialog opened from Talk never shows over Blogs.
4. **Chat photos at 100 / 125 / 150 / 200 % display scaling (Task 6).** Photos look as sharp as before at each scale (thumbnails at 100 %, landscape photos also at 125–150 %; portrait photos above 100 % and every photo at 200 % come from the original, Decision 8); a GIF in a chat still animates; clicking a photo opens the full-size original in the viewer.
5. **Transcription off (Task 6, Decision 9).** With transcription off, voice/video bubbles show no transcript footer; full-screen video shows no subtitles. With it on, revealed voice bubbles show their saved text as before.
6. **Memories first open (Task 9).** The first Memories open shows the loading state for a moment at most, then Memories; later opens are immediate. (A chunk that fails to load shows an error with Retry inside the pane, not the crash screen: covered by the unit test, no manual step.)
7. **Blog feed GPU (Task 11, if run).** Task Manager → GPU column: with the blog feed open and idle, GPU use is lower than before; the background looks the same to you.
8. **CJK IME (regression).** Typing Japanese / Chinese in Search and Settings fields still works (no task here touches input, listed as a smoke check).

## Self-review

- **Spec coverage:** every row of `report-performance.md` maps to a task here, to Plan G (search rendering, shelter component, voice listeners — their code is rewritten there), to Plan B (fonts, BlogReader sanitize) or to a won't-fix with a reason (Appendix A). UI-HEALTH-REPORT priorities #1, #2, #8, #11, #13 and the perf quick wins (memo search results → Plan G Task 2; BlogReader `useMemo` → closed; `Intl` cache → Task 10; stagger cap → Task 10) are covered.
- **Placeholders:** none; the one fill-in is the measured bundle size in Task 9's commit body, with the command that produces it.
- **Pre-flight review** (`.superpowers/sdd/ui-plans-preflight-review.md`) applied: F2-1 (★ save failure breadcrumb, evicted-room 304 test), F3-1/2/3, F4-1, F5-1 (dialogs and menus render nothing while hidden), F5-2 (every hidden side effect gated, one test each), F5-3 (documented as a ⚑ difference), F5-4, F6-1 (480 cap), F8-1, F9-1, F10-1/2. Task 1 had landed (d74c6725..1bfd4ee0) and is unchanged apart from its note.
- **Names:** `etag`, `fetchMessages(path, groupChat)`, `favoriteOverrides`, `withFavorite`, `pruneFavoriteOverrides`, `applyFavoriteOverrides`, `setFavoriteIn`, `storeRoom`, `ROOM_CACHE_LIMITS`, `useSyncProgressStore`, `setActiveProgress`, `setServiceProgress`, `resetSyncProgressStore`, `selectIsSyncing`, `SyncStatusPill`, `LiveSyncModal`, `LiveInlineSyncView`, `useInert`, `FeatureActiveContext`, `useFeatureActive` (in `design/featureActive.ts`), `KeepMounted`, `restoreSavedConversation`, `chatPictureThumbWidth`, `THUMB_PREGEN_WIDTH`, `CHAT_MEDIA_MAX_WIDTH/HEIGHT`, `MemoriesChunkBoundary`, `MemoriesChunkError`, `sortNewestFirst`, `shallowEqualRecord`, `dateTimeFormat`, `staggerDelay` (in `stagger.ts`) are used consistently across tasks and tests.

## Appendix A — Triage of `report-performance.md`

Status: **closed** (already done on this branch), **task** (this plan or another UI-health plan), **won't-fix** (with reason).

| Id | Finding (report section) | Status |
|---|---|---|
| P-B1a | Whole-room re-parse on open and after every sync (B, Top 1) | task F1 |
| P-B1b | ★ maps the whole array and rebuilds the timeline (B, Top 1) | task F2 |
| P-B1c | 20-room cache of full histories, comment undercounts (B, Top 1) | task F2 |
| P-B1d | Paging with `firstItemIndex`/`startReached`, or `buildTimeline` in a Worker (B) | won't-fix (Decision 5): every whole-history consumer needs a second path; F1/F2 remove the repeat work; revisit if the F1 e2e shows a > 200 ms task |
| P-B1e | `buildTimeline` parses each date twice (B) | task F2 |
| P-A1 | Sync progress in App state, polled 1 Hz (A) | task F3 |
| P-A2 | Inline callbacks defeat `React.memo(MessageBubble)` (A) | task F4 |
| P-A3 | `ShelterOverlay` declared inside render (A) | task G1 (rewritten as a module-scope button) |
| P-A4 | `useAppStore()` without selector in 9 components (A) | task F4 (10 sites incl. AddServiceModal; a test keeps it at zero) |
| P-A5 | Feature switch unmounts MessagesFeature (A, Top 4) | task F5 (dialogs and menus hidden, side effects gated while hidden; Decision 7) |
| P-B2 | `applyReveal` O(U²·R); `revealedIds.includes` (B) | task F7 |
| P-B3 | Always-mounted gallery/favourites filter and sort while closed (B) | task F7 |
| P-B4 | Search results re-render on hover; DOMPurify per render (B) | task G2 (search rewrite) |
| P-B5 | VoicePlayer sets state every rAF while playing; width animation (B) | won't-fix: one player plays at a time, the re-render is one small component; changing the bar to `scaleX` alters the accepted player look at its rounded ends |
| P-B6 | TimelineRail unthrottled mousemove, `top` transitions, `Intl` per render (B) | task F10 for the formatter; won't-fix for the rest: React batches the per-event update, and the `top` transitions are the accepted e4e4118 rail motion |
| P-B7 | `new Intl.DateTimeFormat` per call in lists (B) | task F10 |
| P-B8 | One window keydown listener per inline voice bubble (B) | task G4 (container key handling) |
| P-C1 | Chat photos decode originals; no `decoding="async"` (C, Top 3) | task F6 (the pre-generated 480 only where it covers the box, else the original; Decision 8) |
| P-C2a | BlogReader sanitize/highlight on every render (C) | closed — security Plan B (`buildBlogFragment` in a `useMemo`, BlogReader.tsx) |
| P-C2b | Blog post images eager, no size (C) | task F10 (lazy after the first, async decode); sizes are unknown in remote HTML — won't-fix |
| P-C3 | Transcript GET on every voice/video mount, not aborted (C) | task F6 (batching: won't-fix, the endpoint is per message and the gate removes most calls) |
| P-C4 | No `preload`/`poster` on chat videos (C) | won't-fix: Chromium's default is `preload=metadata` already; posters are made in the background and not guaranteed, so `preload=none` would show black boxes |
| P-D1a | Blog feed orbs `blur(100px)` + `will-change`, animated forever (D, Top 5) | task F11 (owner-gated) |
| P-D1b | `backdrop-blur-lg` caption on every card (D) | won't-fix: the accepted original feed look (DESIGN_SYSTEM "The blog feed") |
| P-D2 | Uncapped stagger; `content-visibility: auto` for month sections (D) | task F10 (cap, in `stagger.ts`); `content-visibility` won't-fix: the member timeline groups are short lists and the guide forbids it above the fold |
| P-E1 | Render-blocking Google Fonts (E) | closed — security Plan B Task 8 (bundled `@fontsource-variable/*`, CHANGELOG "Fonts now come with the app") |
| P-E2 | No `React.lazy`: Memories, html-to-image, holidays, locales, framer-motion (E) | task F9 for Memories (with a chunk error boundary) + html-to-image; the holiday data is used by the chat calendar (stays); locales and framer-motion won't-fix (Decision 11) |
| P-E3 | Startup steps run one after another (E) | won't-fix: local-server round trips of a few ms each; the order is the tested startup contract (`App.tsx` hydrate → migrate → language → rehydrate) |
| P-F1 | Sidebar polls every 2 s, re-sorts each tick, recount on every reveal (F) | task F8 (the reveal recount is the read-state trigger and stays) |
| P-F2 | Search fetch without AbortController; stale results; load-more races (F) | task G2 |
| P-F3 | `JSON.stringify` of up to 50 MB GIF frames on the main thread (F) | won't-fix: needs a multipart backend endpoint; a rare, explicit export with its own progress state |
