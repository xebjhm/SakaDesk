# D2a — App frame, member sidebar, chat, letters in chat (+ D2a-0 jump fix)

Date: 2026-11-04
Status: approved in brainstorming (user: "可以 寫完你就開工吧")
Branches: **D2a-0** `fix/timeline-jump` → `dev` (first PR); **D2a** `feat/d2a-chat-frame` → `dev`, cut from `dev` after D2a-0 merges

## Context

D1 built the design system (tokens, primitives, `?view=design`) without changing any pixels. D1.5 unified the group colours. D2 applies the D-4 layout ("one sheet on a coloured base") and the D-5 navigation (two visually distinct rails) to every screen. D2 is too large for one spec, so it is split up:

| Part | Scope |
|---|---|
| **D2a** (this spec) | App frame, member sidebar, chat, sent letters in the chat timeline, sticky date pills |
| D2b | Blog screens (recent feed, reader, timeline rail) |
| D2c | Every dialog (BaseModal → `Modal` primitive; settings, search, favourites, calendar, gallery, diagnostics, …) |
| D2d | Entry screens (login, landing, setup wizard, ToS, sync) |
| D2+ | New UX features: message right-click menu, member search/pin/mark-all-read, News tab, shortcuts |

The incoming-call screen (B) already uses the new glass style and is not touched.

**Virtual scrolling is the riskiest area of this app.** Past fixes include ID-based scroll restore (`e2c7c04`), panels that auto-collapse driven by `rangeChanged` (`7376093`, which replaced an IntersectionObserver that misbehaved inside react-virtuoso), and scroll hijacking (`f359ece`). This spec therefore puts scroll safety first: D2a-0 lands separately, and existing scroll behaviour is locked by tests before D2a changes the list.

## Decisions (from brainstorming)

| # | Decision |
|---|---|
| 1 | D2 = layout and look only, plus two features that were already decided: letters inline in chat and sticky date pills. Other UX features go to D2+. |
| 2 | Order: D2a → D2b → D2c → D2d. Each part goes spec → plan → implementation → user check → merge. |
| 3 | Sent letters are read from the **local archive** (pysaka 0.4.5 `letters.json`), not the live API. They work offline and for lapsed subscriptions. |
| 4 | The sent-letters dialog **stays**, as an overview: a card grid read from the local archive. Clicking a letter jumps to it in the chat. |
| 5 | A letter in chat shows the **full letter image** (option A, as in the official app), right-aligned, with **no "sent letter" tag**. |
| 6 | The member sidebar **does not collapse**. Only the content fades in when the member or feature changes. |
| 7 | Timeline: a pure `buildTimeline` model plus **`GroupedVirtuoso`** for the sticky date headers. The library is used instead of a hand-built floating pill. |
| 8 | Calendar jumps never scroll through history: far jumps land just short of the target and glide in (instant with reduced motion). All jumps go through one `jumpTo` helper. It ships first as its own PR (**D2a-0**). |
| 9 | A run of consecutive messages = same sender, same local day, ≤ 5 minutes between neighbours, and no letter in between. |
| 10 | A letter shows **the user's avatar at the time it was sent** (from the account avatar history), falling back to the earliest known avatar. |

## D2a-0 — fast, reliable jumps that glide into place

### Problem

Choosing a 2022 date in the calendar while viewing 2026 scrolls for a long time. `scrollToDate` (`MessagesFeature.tsx`) calls `scrollToIndex({ behavior: 'smooth' })`, so Virtuoso animates through every message in between. The other jumps already use `behavior: 'auto'`, but they each do it their own way and none of them checks where it landed.

### Design

New hook `frontend/src/features/messages/hooks/useTimelineJump.ts`:

```ts
type JumpTarget =
  | { kind: 'message'; id: number; align?: 'start' | 'center' }   // align defaults to 'start'
  | { kind: 'date'; date: string }      // local YYYY-MM-DD, same bucketing as toLocalDateStr
  | { kind: 'firstUnread' }
  | { kind: 'top' }
  | { kind: 'bottom' };

type JumpOutcome = 'landed' | 'not_found' | 'gave_up' | 'cancelled';

function useTimelineJump(args: {
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  messages: readonly Message[];
  isUnread: (id: number) => boolean;
  onLanded?: (messageId: number) => void;   // drives the highlight
  resetKey?: unknown;                       // a change cancels in-flight jumps (room switch)
  getScroller?: () => HTMLElement | null;   // Virtuoso's scroll element; without it jumps are instant
  visibleRange?: () => { startIndex: number; endIndex: number } | null;   // rendered rows; null/omitted = unknown → instant
  deps?: Partial<{ nextFrame; measure; now; reducedMotion }>;   // test seam
}): (target: JumpTarget) => Promise<JumpOutcome>;   // jumpTo
```

The flow of a jump:

1. Resolve the target to a message row with a pure function (`resolveJump`). If there is none, the outcome is `not_found`.
2. **Move there.** Message and date targets align `start` unless the message target asks for `center`; first-unread aligns `center`; bottom aligns `end`. Never `behavior: 'smooth'`: the glide is the hook's own rAF animation on `scrollTop` (`timeline/glide.ts`), `motion.duration.glide` (400 ms) along `motion.easing.standard`. It homes in on the target row as soon as that row renders, and absorbs scroll changes Virtuoso makes meanwhile (height compensation) over the remaining frames.
   - **No scroller, or `prefers-reduced-motion`:** one instant `scrollToIndex({ index, align, behavior: 'auto' })`.
   - **On screen** (inside the visible range): glide straight by the measured distance; no `scrollToIndex`. If the row cannot be measured, scroll instantly instead.
   - **Close** (estimated within 2 viewports, from the visible rows' average height): glide from where the list is toward twice the estimate, homing in on the row once it renders; if it still is not rendered at the end, scroll instantly. A lead-in here could land on the wrong side of the target.
   - **Far:** an instant `scrollToIndex` with `offset` lands 0.8 viewport short of the target in the direction of travel (Virtuoso adds a positive offset to the scroll position, so a downward jump uses a negative one). Virtuoso re-issues that scroll each time row heights change until they have been still for 150 ms, so the hook waits until `scrollTop` and the total height have been still that long (at most 60 frames; if they never settle, it scrolls instantly to the target), then glides the last 0.8 viewport. It waits one frame (16 ms) longer than Virtuoso's window (`STILLNESS_MS` = 166 ms). Near the bottom of the list Virtuoso clamps the offset, so the lead-in shrinks, possibly to zero (no glide); the jump still lands. Wheel or touch input during a glide is overridden until the glide ends.
   - Top and bottom take the same paths and are not verified afterwards.
3. **Settle and correct.** The hook waits up to 60 frames for the row to render, then settles 2 frames and measures. If the row is off the aligned position by more than 8 px, it re-finds the row by message id (gone: `cancelled`) and issues an instant `scrollToIndex` again, at most 2 times. A row that vanishes after settling sends the jump back to waiting, which is bounded too (at most 2 × 2 + 1 wait cycles in total). The outcome is `landed` or `gave_up`. A jump is `cancelled` (also mid-glide) by a newer jump, an unmount, a room switch (the hook takes a `resetKey`; `MessagesFeature` passes the selected room), or when the target message has left the list while its row cannot be measured. Virtuoso estimates heights it has not measured yet, so the first jump can land a little off.
4. **Landing highlight.** For message and date jumps, the landed row breathes once (`animate-landing`: the group highlight fades in and out over `motion.duration.landing`, 1.4 s). It adds no new colour. First-unread, top and bottom jumps are not highlighted.
5. **Breadcrumb log** `timeline_jump` for every jump, with `target`, `index`, `corrections`, `outcome`, `path` and `jump_ms`. `path` records the branch that ran: `instant` (no scroller, reduced motion, or unknown visible range), `onscreen`, `onscreen_snap` (on screen but not measurable, so instant), `close`, `close_snap` (close glide ended without the row rendered, so instant), `far`, `far_unsettled` (the lead-in never went still, so instant), or `none` (not found, or no list handle, before any scroll). No message text and no names.

Media with known `width` / `height` reserves its box before the image loads, so landing positions do not drift. Pictures and videos already carry those fields.

Every entry point moves onto `jumpTo`:

| Entry point | Today | After |
|---|---|---|
| Calendar date (`scrollToDate`) | smooth scroll | `jumpTo({kind:'date'})` |
| First unread (two arrow buttons) | `scrollToIndex` auto | `jumpTo({kind:'firstUnread'})` |
| Same-room `targetMessageId` (search, notification toast, media gallery "jump to message", conversation menu) | `scrollToIndex` in a `MessageList` effect | `jumpTo({kind:'message', align:'start'})` through `MessageList`'s `onJumpToMessage` |
| Cross-room `targetMessageId` (Virtuoso mounts fresh) | `initialTopMostItemIndex` | the same `onJumpToMessage` jump runs on a fresh mount too |
| Incoming call ended → its message (`scrollToMessage`) | `scrollToIndex` auto | `jumpTo({kind:'message', align:'center'})`, highlighted |
| Home / End keys (`useTimelineKeyNav`) | `scrollToIndex` auto | `jumpTo({kind:'top'/'bottom'})`, no highlight |

### Real-browser tests (new)

jsdom cannot measure layout, so the scroll behaviour is tested with Playwright: `frontend/e2e/timeline-scroll.spec.ts` against the backend on :8000 serving `frontend/dist` (the `webServer` in `playwright.config.ts`), not the Vite dev server, with the API mocked by `page.route`, as the D1 visual tests do. The fixture room has 5,000 messages from 2022-01 to 2026-11, mixed text and pictures with dimensions (no voice). The tests check:

- From the bottom, jumping to a 2022 date finishes in < 1 s, and the first date visible at the top is the target date.
- Jumping to a message id leaves that message in the viewport and highlighted.
- Re-opening the room restores the last top message (ID-based restore).
- At the bottom, an appended message is followed (`followOutput`).
- First-unread jump brings the first unread message into view.

### Verification

Frontend unit tests, `tsc`, lint and the new e2e spec all pass. On Windows, a test build using the archive copy `C:\D\saka-verify` jumps from 2026 to a 2022 day in 高井 俐香's room, and that is checked by hand.

## D2a — the redesign

### 1. Frame (D-4 + D-5)

- **Group rail** (`ServiceRail`): neutral light background token. The right border line goes, and so does the grey divider (spacing separates instead). Logos are round; the selected group gets a white ring plus `shadow-group-glow`, replacing the blue bars above and below. Add-service, search and settings stay pinned at the bottom. The green and blue hover colours of add/search go (they break the "group colour in four places" rule); hover is neutral.
- **Feature rail + member sidebar** share one level-0 `Canvas` block (`bg-group-canvas`, official gradient), rounded on the left, so they read as one piece. Feature entries use the `RailItem` primitive (icon above label). The selected entry is a white card. Labels come from i18n keys, replacing `label` / `labelJa` in `config/features.ts`. "⋯ more" and hiding features in settings are not built (YAGNI: there are at most 2 features).
- **Content**: `ContentArea` renders inside a `Sheet` (rounded right side, `rounded-sheet`, `shadow-sheet`) with an 8 px gap to the frame. Blogs land on the same sheet automatically; their inside is D2b. The hard-coded "News / Fan Club / AI — Coming soon" placeholders are moved to i18n.
- **Motion**: content fades in for `duration-base` on feature or service change.

### 2. Member sidebar (`MemberList`)

- Width grows with the window: 320 px by default, up to about 432 px on wide windows. The grid uses `auto-fill`, so it shows 3 columns by default, 4 at a window width ≥ 1600 px and 5 at ≥ 1920 px. Drag-to-resize is not built.
- Cells use `Avatar` (`selected` = white ring + group glow) and `Badge` (action colour, `99+` cap). On hover the avatar lifts slightly (scale + `shadow-card`, `duration-fast`). Graduated members keep their greyscale and tooltip.
- The section headings (online / offline / graduated) stay sticky and become small `Pill`s.
- The bottom sync status becomes a floating pill ("Last synced 3 min ago ⟳"), and the border line above it goes.
- Unchanged: the right-click menu, ordering, the title row and the sync spinner.

### 3. Chat

- **Header**: the official title gradient (Sakurazaka: white header + thin bar) stays verbatim. The member avatar (white border) is added on the left. Under the name, the header shows "Subscribed for N days" (`memberProfile.subscribedDays`, from the same streak source the profile popup uses; one fetch, no second copy). Group chats keep the "group chat" subtitle. The unread and sync indicators become token-based `Pill`s. The ⋯ menu is unchanged.
- **Runs**: avatar, name and time show once, at the top of a run (decision 9). Later bubbles in the run show their time on hover. The first bubble keeps the small top-left corner; the others are fully rounded.
- **Date headers**: `GroupedVirtuoso` with one group per local day. Each group header is a `DatePill` (D1 format: today / yesterday / same year "11月2日（日）" / other years with the year). Headers stick and push each other. **Clicking a date pill opens the calendar.** Choosing a day calls `jumpTo({kind:'date'})`.
- **Bubbles**: same look (white, group bubble border). Radius and shadow come from tokens. The user's chat background (colour / image / opacity) still applies to the timeline area.
- Content fades in on member switch. The unread arrow buttons become `IconButton`s using the action colour.
- The inline "reveal all" confirm dialog stays as it is until D2c.

### 4. Timeline model

`frontend/src/features/messages/timeline/buildTimeline.ts` is pure, with no React:

```ts
type TimelineItem =
  | { kind: 'message'; message: Message; runStart: boolean }
  | { kind: 'letter'; letter: Letter; runStart: true };

interface Timeline {
  items: TimelineItem[];          // chronological, letters merged by created_at
  groupCounts: number[];          // items per local day, for GroupedVirtuoso
  groupDates: string[];           // local YYYY-MM-DD per group
  indexOfMessage: (id: number) => number;
  indexOfLetter: (id: number) => number;
  indexOfDate: (date: string) => number;   // first item of that day, or -1
}
```

- Letters and messages are merged by timestamp. Ties go to the message first.
- Days are bucketed with `toLocalDateStr`, the same function the calendar and backend use (SD-FE-CORE-02).
- Every index-based caller (`useChatScroll`, unread navigation, `jumpTo`, the visibility registry, key navigation) asks the model for an index by **id**. None of them indexes `messages[]` directly any more. `useChatScroll` keeps saving the top **message** id. If the top item is a letter, it saves the nearest message above it.
- Unread logic ignores letters: they are never unread, are not counted, and are skipped by the unread arrows and "reveal all". Key navigation does step through them.
- **First step of the plan:** a test establishes whether `GroupedVirtuoso`'s `rangeChanged` reports item indices with or without group headers. The model's index helpers are written to match that result.

### 5. Letters in chat

- **Backend** (`backend/api/chat_features.py` or a new `backend/api/account.py`), both reading local files only:
  - `GET /api/chat/letters_local?service=…&path=<member dir>` returns `{letters: [{id, text, created_at, image_url, width, height}]}` from `letters.json`. A missing file gives an empty list. An invalid file gives an empty list and a warning log.
  - `GET /api/account/profile?service=…` returns `{name, avatars: [{url, first_seen}]}` from `account/profile.json` and `account/profile_images/index.json` (thumbnails only).
  - Images are served through the existing media route. Every branch (found / empty / missing / invalid) logs a structured breadcrumb without letter text or nickname. Paths are validated to stay inside the output directory.
- **Chat**: letters render right-aligned with the user's avatar and name, plus the send time. The letter image is 180 px wide, and its height is reserved from width/height. Clicking opens the existing image viewer. The avatar is the newest one whose `first_seen` ≤ the letter's `created_at`; if none qualifies, the earliest known one. If the image file is missing, a text card shows the letter text. Group chats do not fetch letters.
- **Overview** (`SentLettersModal`): it reads `letters_local` instead of the live API and shows a grid of letter thumbnails, newest first, with dates. Clicking one closes the dialog and calls `jumpTo` for that letter (with the highlight). The live endpoint `GET /api/chat/letters/{group_id}` is kept; if nothing else uses it, its removal goes on the E clean-up list.

### Implementation order (D2a)

1. **Lock current behaviour.** Extend the e2e spec and unit tests over every scroll behaviour (restore, follow, first unread, message jump, date jump, keys, panel auto-collapse via `rangeChanged`, unread arrows) and confirm they pass on the unchanged code.
2. `buildTimeline` + unit tests: day boundaries, days with only letters, the 5-minute run rule, ties, local midnight in non-UTC zones.
3. Probe `rangeChanged` semantics (see section 4), then swap `Virtuoso` → `GroupedVirtuoso`. Step 1's tests must stay green.
4. Backend endpoints + pytest (missing / invalid files, CJK and emoji text, path traversal).
5. Visuals: frame, sidebar, chat, letters, overview.
6. Checks: frontend + backend tests, `tsc`, lint, the guard count must only go down, before/after screenshots for all four groups, and the user's check on a Windows test build.

## Error handling and logging

- A failed jump never throws to the UI. `not_found` and `gave_up` are logged, and the view stays where it was.
- A failed letters or profile fetch logs, and the chat renders without letters. It never blocks messages.
- There are structured breadcrumbs on every decision path, as the project requires: jump outcome, letters found / empty / missing / invalid, avatar chosen by history / fallback.

## Out of scope

The inside of the blog screens (D2b); every dialog except the sent-letters overview (D2c); the entry screens (D2d); the D2+ UX features; sidebar collapse; dark mode; the Hinatazaka badge colour (stays as is).
