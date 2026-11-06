# Design language v2 re-apply, part R-c (dialogs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every remaining non-entry dialog (settings, search, about, diagnostics, report issue, add service, confirm, login, and the chat-opened calendar, favourites, media gallery, background and sent letters) on the v2 design language: brand scope on the brand dialogs, group context inherited by the chat dialogs, group markers where a brand dialog names one group, `*-accent-*` instead of the superseded `*-group-*` roles, the pre-D2 (`e4e4118`) dialog colour and header weight restored through tokens, semantic colours by meaning, Japanese content marked `lang="ja"`, and before/after evidence against `e4e4118`.

**Architecture:** No new mechanism. The foundation, R-a and R-b already provide `Modal scope="brand"`, the `ScopeContext` inheritance, `groupScopeStyle`, the accent / expressive / wash utilities, `text-semantic-star`, `DialogStatus` and the style / guard ratchets. R-c adds two small things: a `Modal` header `icon` slot plus the bold title (one primitive change that reaches every dialog), and a `useGroupMarker(serviceId, target)` hook (group scope for one piece of a brand dialog, with a `group_marker_fallback` breadcrumb when the service is unknown). Then it switches the dialogs over in four families: app confirm/about/diagnostics/report, add service + search, settings + login, the chat dialogs, the media gallery. Every task is guarded by unit tests, the guard ratchet (`guard-baseline.json` only goes down) and `core/dialogs.style.test.ts`.

**Tech Stack:** React 18 + TypeScript, Tailwind 3 (utilities read `var(--ds-*)`), Vitest + Testing Library, Playwright (headless capture), FastAPI backend (`backend/api/client_log.py`, pytest).

Spec (governs): `docs/superpowers/specs/2026-11-05-design-language-v2-design.md`: §3.4 (semantic colours, "semantic over context": 推 = oshi pink, the bookmarked-message star = `text-semantic-star` `#facc15`, danger / success / warning fixed), §4 (context table), §5 (tiers + restore inventory: "Modal accents (`accentColor/Light/Muted`) — Calendar, Favorites, MediaGallery, Background, SentLetters"; "Dialog gradient header — `core/common/BaseModal.tsx`"), §8 (states: selected = `accent-subtle` + `accent-border` + `accent-strong`), §12 (accepted deviations). Current system: `docs/design/DESIGN_SYSTEM.md`. D2c structure (kept unless a decision below says otherwise): `docs/superpowers/specs/2026-11-05-d2c-dialogs-design.md`. Model plans: `docs/superpowers/plans/2026-11-05-v2-reapply-a-frame-chat.md`, `docs/superpowers/plans/2026-11-06-v2-reapply-b-blogs.md`.

Colour mapping used throughout (from `e4e4118` `config/serviceThemes.ts` `buildTheme` + `design/tokens/roles.ts`): `theme.modals.accentColor` = `r.action` = step 600 → `accent`; `accentColorLight` = `r.subtle` = step 50 → `accent-subtle`; `accentColorMuted` = `r.subtleBorder` = step 200 → `accent-border`. Text that was step 600 becomes `text-accent-strong` (step 700), because spec §8 makes selected / link text `accent-strong` (600 small text is 3.0:1 on Hinatazaka). Off-logo blues (`blue-50/400/500/600/700`) in brand dialogs map to the brand ink through the same roles (spec §3.4: info uses ink, there is no separate blue).

---

## Decisions needed from the user

> **Resolved (user, 2026-11-06): every decision takes its recommendation** — D1 (a) bold title in the header text colour, contrast recorded in §12; D2 (a) header icons restored in the header text colour; D3 (a) expressive inherited header + semantic tile + secondary Cancel; D4 (a) white card + accent hover; D5 (a) group-marker scope + chip; D6 (a) ghost `text-semantic-warning`; D7 (a) brand scope + serif bold wordmark, hero/stats in R-d. Steps marked "pending decision" are therefore final as written.

The user's rule: any change to the original design (`e4e4118`) that the spec has not decided, any D2c structural decision, any off-logo colour without a semantic meaning, any colour whose meaning is unclear and any contrast problem not already accepted is asked first. The tasks assume the **recommendation**; steps that depend on one are marked `(pending decision D<n>)`. If the user picks another option, only those steps change.

**D1 — Dialog title weight and colour (affects every dialog through `Modal`, plus `LoginModal`'s banner).** `design/primitives/Modal.tsx`, `shell/components/LoginModal.tsx`.
- `e4e4118` (`core/common/BaseModal.tsx`): `<h3 className="text-lg font-bold" style={{ color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white' }}>`. `headerTextColor` is `o.title.text`, the **official title text**, Sakurazaka `#d892aa` (the pale official pink), not `r.strong`. So the pre-D2 title was 18 px **bold**, white on the gradient groups and the pale official pink on Sakurazaka's white header. `LoginModal` at `e4e4118`: also `text-lg font-bold` in `headerTextColor`.
- Now: `text-title font-semibold` (16 px semibold) in `text-expressive-header`, which resolves to the **same** colours (white on the gradient, `#d892aa` on Sakurazaka, dark text on the brand aurora). So the colour already matches `e4e4118`; only the weight (and 2 px of size) changed.
- Correction to the brief: the premise "the `e4e4118` title was `r.strong` on light headers" is wrong (see the quote above). Restoring `e4e4118` means bold + the pale official pink.
- Contrast (not in §12): `#d892aa` on white is 2.4:1; white on the light left end of the title gradients is about 1.7:1 (Hinatazaka `#a8c4e8`) to 2.0:1 (Nogizaka `#d8c8e8`). Both are below 3:1 even for bold large text. They match the chat header title next to them (official layer) and `e4e4118`.
- Size: there is no 18 px step (`text-title` 16, `text-heading` 20; arbitrary sizes are banned).
- Options: (a) bold `text-title`, keep the header colours (exactly `e4e4118` apart from 16 vs 18 px), and record the dialog title contrast in §12 next to the chat header pills; (b) bold, and on light headers use `text-accent-strong` (Sakurazaka `#a72f5d`, about 6:1) instead of the official pink, a deviation from `e4e4118` and from the chat header beside it; (c) bold `text-heading` (20 px) with (a)'s colours; (d) leave semibold.
- **Recommendation: (a).** It is the pre-D2 look and keeps the dialog header identical to the chat header it sits over; the text is a short title.

**D2 — Header icons (D2c dropped them).** `Modal` (new `icon` slot) and the dialogs that had one.
- `e4e4118`: every `BaseModal` dialog passed `icon`, drawn `w-5 h-5` before the title in the header text colour: Calendar `icon={Calendar}`, Favorites `icon={Star}`, Sent letters `icon={Mail}`, Background `icon={Palette}`, Media gallery `icon={Image}`, Blog photo gallery `icon={Image}` (both of its dialogs). Report issue had `<Bug className="w-5 h-5 text-amber-400" />` on its `bg-gray-900` header.
- Now: D2c decision 6 removed the icons with the neutral header; the foundation brought the gradient header back without them.
- Colour questions inside this decision: Favorites' header star is title iconography (white / official pink at `e4e4118`), not the bookmark mark on a message; Report's bug was `amber-400` on a dark header (amber here reads as "bug", not as a warning state).
- Options: (a) restore the icons through `Modal icon`, all in the header text colour (Favorites' header star included; the bug loses its amber); (b) as (a) but the bug keeps a semantic warning colour; (c) no icons (D2c).
- **Recommendation: (a).** The icons were part of the pre-D2 header; one colour per header keeps it calm, and the yellow star stays the mark of a bookmarked message (spec §3.4).

**D3 — Confirm dialog header (foundation chose `header="plain"`).** `shell/components/ConfirmDialog.tsx`.
- `e4e4118`: `bg-gradient-to-r from-[#b4dcff] to-[#f0bede]` header with a white `AlertTriangle w-6 h-6` and a white bold title; Cancel `bg-gray-100` filled, Confirm amber / red / blue fills.
- Now: plain header (no gradient), `AlertTriangle` in `text-status-warning` / `text-status-danger` / `text-secondary` beside the title; Cancel ghost; Confirm primary or danger.
- Spec §5 lists gradient dialog headers under L1 for everything interactive, but the foundation documented `plain` "for small confirms; `ConfirmDialog` uses it".
- Options: (a) expressive header (it inherits: aurora when opened from Settings, the group header from a chat or the login dialog), the warning / danger meaning kept by a semantic icon tile in the header (`bg-semantic-*-icon` circle, `border-semantic-*` outline, `text-semantic-*` glyph, spec §3.4 icon rule; info ink for `default`), Cancel `secondary` (spec §5.1: cancel = secondary); (b) keep the plain header.
- **Recommendation: (a).** It brings back the pre-D2 coloured header without losing the meaning colour, which a white glyph on a gradient would.

**D4 — Sent letters "paper" card.** `core/modals/SentLettersModal.tsx`.
- `e4e4118` (a different, fetch-based dialog, replaced in D2a): each letter card was `bg-[#f8f5f0]` (cream "letter paper", off-logo, no semantic meaning) with `rounded-lg p-3`, hover border `theme.modals.accentColorMuted` and the "To. name" line turning `theme.modals.accentColor`.
- Now: white `Card` thumbnails (D2a), hover `shadow-sheet`, no accent.
- Spec §3.3: large surfaces including cards stay white.
- Options: (a) keep the white card and restore the hover accent (`ring-accent-border` outline, date turning `text-accent-strong`, `shadow-accent-glow-hover`); (b) add a `surface.paper` token (`#f8f5f0`) for letter cards; (c) leave as is.
- **Recommendation: (a).**

**D5 — Per-group rows in Settings.** `shell/components/SettingsModal.tsx` (Sync tab: "Verify & Fix Media" and "Deep re-sync" act on the active service only).
- `e4e4118`: plain text buttons (`text-blue-600` "Verify now", `text-amber-600` "Re-sync all"), nothing says which group they act on.
- Now: two `secondary` buttons; nothing says which group.
- Spec §4: in Settings, per-group rows are group markers (`groupScopeStyle(groupId)`).
- Options: (a) wrap the two rows in the active group's marker scope and add a small marker chip beside each label (a dot in the group colour + the group's name, which is data: `getServiceDisplayName`), with "Verify now" as a ghost button in that group's accent; (b) wrap only (the buttons change colour, nothing names the group); (c) no marker.
- **Recommendation: (a).** It is the only place in Settings that acts on one group, and the chip answers "which group?" without new copy.

**D6 — "Re-sync all" colour.** Same file.
- `e4e4118`: `text-amber-600 hover:text-amber-800` (a caution colour; its confirm is `variant="warning"`).
- Now: neutral `secondary` button.
- Options: (a) ghost button in the semantic warning text colour (`text-semantic-warning`, `#824c13`, 7.6:1), the same in every group; (b) ghost in the group accent like "Verify now"; (c) keep `secondary`.
- **Recommendation: (a).** Amber here means "this is heavy", a fixed meaning (spec §3.4).

**D7 — How much of the About brand moment belongs to R-c.** `core/modals/AboutModal.tsx`.
- `e4e4118`: neutral dialog (`text-lg font-bold text-gray-800` title, `text-xl font-bold` wordmark, red-400 heart).
- Spec §9: About = aurora hero + serif wordmark + "your archive" stats (messages, photos, days) with tabular numerals; §5 lists About as an L2 screen.
- The stats need data the frontend does not have today (a new endpoint).
- Options: (a) R-c: brand scope (aurora header from `Modal`) + serif wordmark (`font-display`, bold as at `e4e4118`); the hero band, orbs and stats go to R-d with the other brand moments; (b) the whole §9 About now, including a stats endpoint; (c) brand scope only.
- **Recommendation: (a).**

Already settled and therefore **not** asked: brand scope for settings, search, about, diagnostics, report issue and add service, and group context for the chat dialogs and login (§4); the brand aurora header replacing `e4e4118`'s `bg-gray-900` (Report, Diagnostics), `bg-gray-100` (Settings) and pastel (Add service) headers (§5 restore inventory); off-logo blues in brand dialogs → ink (§3.4); the Favorites bookmark star → `text-semantic-star` instead of `e4e4118`'s `theme.modals.accentColor` (§3.4 names it); About's heart stays `text-heart` (not oshi, §3.4); the calendar's Sundays stay `text-sunday`; Add service cards as group markers (§4, reversing D2c decision 16); selected states per §8; search keeps its cross-group dots (`groupMarkerStyle`, D2c decision 16); floating viewer controls = circles, inline close = 12 px (user rule; already true, locked by tests here); the D2c structures (circle calendar cells, Settings `SettingRow` layout, search layout).

**Out of scope (R-d, entry flows and brand moments):** spec §9 defines first launch as boot → ToS → choose groups → first sync. The setup wizard (`SetupWizard`, choosing the output folder during onboarding) and the first sync (`SyncModal`) are entry flows; `SyncModal`, `SyncProgressPanel` and `InlineSyncView` share one set of sync rows, so "sync progress (rows = markers)" moves to R-d with them, together with `TosDialog`, `LandingPage` and the boot screen. Also R-d: empty states (`EmptyState`), celebrations, the About hero / stats (D7). The update prompt is `UpgradeIcon`, which already sits in the group rail's `BrandScope` (R-a); it has no dialog. Menus and the profile card were R-a; the blog dialogs R-b (R-c only adds the header icon to the blog photo gallery, D2).

---

## Global Constraints

- Work in `/home/xtorker/repos/Project-Saka/SakaDesk` on branch `feat/v2-reapply-c` (from `dev` at `fd00fae`). Frontend commands run from `frontend/`: one file `npx vitest run <path>`, full suite `npm run test:run`, types `npx tsc --noEmit`, lint `npm run lint`. Backend tests from the repo root: `uv run pytest backend/tests/<file> -q`.
- Commit from the repo root with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Conventional Commits (`docs/DOC_FORMATS.md`): `type(scope): subject`, imperative, whole line <= 72 chars, no trailing period. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (second `-m`).
- Hex / `rgb()` literals only inside `src/design/tokens/`. No named palette classes (`bg-gray-100`, `text-white`, `bg-black/40`) and no inline `color` / `background` / `boxShadow` in files a task touches (inline custom properties from `groupScopeStyle` / `useGroupMarker` are allowed); no arbitrary radius / shadow / text / spacing values; no `rounded-2xl` / `rounded-3xl`.
- Context table (spec §4): BRAND = settings (per-group rows are markers), search (always; each result keeps its group dot), about, diagnostics, report issue, add service (group cards are markers) → `Modal scope="brand"`. GROUP = calendar, favourites, media gallery, background, sent letters (opened from a chat: they inherit), login (its own group through `groupScopeStyle`), confirm (inherits). VIEWER = media viewer, photo detail (dark; controls only).
- Semantic over context (spec §3.4): a bookmarked-message star is `text-semantic-star` (`#facc15`) in every group; anything meaning 推 uses `*-semantic-oshi*`; danger / success / warning stay semantic. Before mapping an old colour to the accent, check its meaning.
- Every "restore" quotes the `e4e4118` value it restores (see the colour mapping above). Large surfaces stay white (spec §3.3).
- Spec §12 deviations stay as they are (primary gradient contrast, Hinatazaka `#389DD1`, Sakurazaka white header, chat header pills).
- Radius steps: xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full 9999. Floating icon buttons (viewer overlay controls) are circles (`rounded-full`); inline icon buttons (dialog close) are `rounded-md` (12 px).
- Japanese content inside dialogs gets `lang="ja"`: member names, message text and transcripts (favourites, media gallery voice rows, viewer captions), letter text, search result member / room names, blog titles and snippets, filter chips naming members, group names shown as data (add service, settings marker chip). UI chrome is never marked. Do not add `font-reading` / `font-display` to a `lang="ja"` element unless it is meant to be serif (the companion CSS rule keeps those serif).
- A control that was a light tint at rest with a stronger fill on hover uses `bg-accent-wash border border-accent-wash` at rest (and `hover:bg-accent-subtle` or the gradient on hover), not a full tonal fill.
- Every new utility is registered in `frontend/src/utils/classnames.ts` (this plan adds none). A file whose guard count drops gets its `guard-baseline.json` entry lowered (or removed at 0) **in the same commit**: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts`, then check `git diff src/design/guard-baseline.json` shows only decreases / removals.
- Logging: every new decision / failure path logs `clientLog(event, fields)`; values match `^[a-z0-9_]{1,40}$`, never names, titles or text. A new event goes into both `frontend/src/utils/clientLog.ts` (`ClientLogEvent`) and `backend/api/client_log.py` (`ClientEvent`), with a pytest case.
- i18n: no hard-coded user-facing strings. This part adds no keys (group names are data from `data/services.ts`; Diagnostics' English labels are D2c decision 22). If a step ever adds a key it goes into all five locales `frontend/src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json`.
- Screenshots and e2e run headless (Playwright CLI). Never open a WSLg window; to show a page on Windows use `powershell.exe -NoProfile -Command "Start-Process '<windows path>'"`.
- Docs and code comments in English.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `frontend/e2e/r-c-screens.spec.ts` (new) | capture-only shots of every R-c dialog (chat dialogs in 4 groups, brand dialogs in 2) | 0 |
| `frontend/src/design/primitives/Modal.tsx` | bold title (D1), `icon` slot (D2) | 1 |
| `frontend/src/design/useGroupMarker.ts` (new) | group scope for one piece of a brand dialog + fallback breadcrumb | 1 |
| `frontend/src/design/rCDialogs.test.tsx` (new) | tests for the two above | 1 |
| `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py` | `group_marker_fallback` event | 1 |
| `frontend/src/shell/components/ConfirmDialog.tsx` (+ test) | expressive header + semantic tile (D3) | 2 |
| `frontend/src/core/modals/AboutModal.tsx`, `DiagnosticsModal.tsx`, `ReportIssueModal.tsx` (+ tests) | brand scope, serif wordmark (D7), header icon (D2), ink selection | 2 |
| `frontend/src/core/layout/AddServiceModal.tsx`, `AddServiceModal.test.tsx` (new) | brand scope, group-marker cards | 3 |
| `frontend/src/features/search/SearchModal.tsx`, `components/SearchInput.tsx`, `SearchFilterBar.tsx`, `SearchResultItem.tsx`, `rCSearch.test.tsx` (new) | brand scope, accent roles, `lang="ja"` | 3 |
| `frontend/src/shell/components/SettingsModal.tsx`, `SettingsModal.rC.test.tsx` (new) | brand scope, selected nav, marker rows (D5), warning re-sync (D6), wash Check Now | 4 |
| `frontend/src/shell/components/LoginModal.tsx`, `entryDialogs.test.tsx` | accent roles, bold title (D1) | 4 |
| `frontend/src/core/modals/CalendarModal.tsx`, `BackgroundModal.tsx`, `FavoritesModal.tsx`, `SentLettersModal.tsx`, `features/blogs/components/BlogPhotoGalleryModal.tsx`, `core/modals/rCChatDialogs.test.tsx` (new) | modal accents, yellow star, header icons, `lang="ja"` | 5 |
| `frontend/src/core/media/MediaGalleryModal.tsx`, `MediaGalleryModal.rC.test.tsx` (new) | tabs, voice rows, header icon, `lang="ja"`, viewer controls | 6 |
| `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md`, spec §12 (D1 (a)) | zero-drift docs | 7 |
| `/mnt/c/D/saka-verify/shots/r-c/`, `index.html` | before/after page | 8 |

`frontend/src/core/dialogs.style.test.ts` already lists every file touched here (`FILES`); no new entries are needed. The guard baseline entries that reach 0 and are removed: `core/layout/AddServiceModal.tsx` (1), `core/media/MediaGalleryModal.tsx` (8), `core/modals/AboutModal.tsx` (1), `BackgroundModal.tsx` (2), `CalendarModal.tsx` (3), `FavoritesModal.tsx` (3), `ReportIssueModal.tsx` (4), `SentLettersModal.tsx` (1), `features/search/components/SearchFilterBar.tsx` (5), `SearchResultItem.tsx` (1), `shell/components/LoginModal.tsx` (1), `SettingsModal.tsx` (4). (All their counts are superseded `*-group-*` utilities; none has a hex or arbitrary value.)

---

### Task 0: Capture spec and the "base" and "dev" shots

**Files:**
- Create: `frontend/e2e/r-c-screens.spec.ts`

**Interfaces:**
- Consumes: `buildBigRoom`, `pinBigRoom`, `COUNT`, `TZ`, `FixtureMessage` from `frontend/e2e/fixtures/bigRoom.ts` (the default `LETTERS` fixture feeds Sent letters).
- Produces: `frontend/e2e-shots/r-c/{base,dev}/*.png` (git-ignored), copied to `/mnt/c/D/saka-verify/shots/r-c/{base,dev}/`. Task 8 adds `after`.

- [ ] **Step 1: Write the capture spec** — `frontend/e2e/r-c-screens.spec.ts`

```ts
import { test, expect, type Locator, type Page } from '@playwright/test'
import { buildBigRoom, pinBigRoom, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'

// Captures (does not compare) every R-c dialog so the v2 re-apply can be reviewed against the
// pre-D2 look. The same spec runs on three builds:
//   SHOT_LABEL=base  - e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   - dev before R-c
//   SHOT_LABEL=after - this branch at the end
// Command (from frontend/, with port 8000 free; the tests run serially, so capture never competes for CPU):
//   SHOT_LABEL=after npx playwright test e2e/r-c-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-c/<label>/ (git-ignored). Chat dialogs are captured in all four
// groups (they follow the group); brand dialogs in two groups (they must look the same in both).

const LABEL = process.env.SHOT_LABEL
const GROUPS = ['hinatazaka46', 'sakurazaka46', 'nogizaka46', 'yodel'] as const
const BRAND_CHECK = ['hinatazaka46', 'sakurazaka46'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')
test.describe.configure({ mode: 'serial' })

/** Visible, in the viewport and with a stable box (two reads 250 ms apart equal): dialogs animate in. */
async function settled(page: Page, locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30000 })
  await expect(locator).toBeInViewport({ timeout: 30000 })
  let last = JSON.stringify(await locator.boundingBox())
  await expect.poll(async () => {
    await page.waitForTimeout(250)
    const now = JSON.stringify(await locator.boundingBox())
    const same = now === last
    last = now
    return same
  }, { timeout: 15000 }).toBe(true)
}

async function shot(page: Page, name: string, parkPointer = true) {
  // Park the pointer in the bottom-right corner (on the scrim) so no hover state is captured by accident.
  if (parkPointer) await page.mouse.move(1270, 795)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/r-c/${LABEL}/${name}.png`, animations: 'disabled' })
}

/** Presses Escape until no dialog is left (nested viewer / voice selection close one at a time). */
async function closeAll(page: Page) {
  for (let i = 0; i < 4 && (await page.getByRole('dialog').count()) > 0; i++) await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30000 })
}

/** The big room plus a voice, a video and a favourite Japanese text (all read). */
function mediaRoom(): FixtureMessage[] {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 3, 4, minute)).toISOString()
  const extra = [
    { id: COUNT + 1, member_id: '1', timestamp: at(0), type: 'voice', content: null, is_favorite: true,
      media_file: 'messages/1 Big Room/1 Big Room/voice/5001.m4a', width: null, height: null },
    { id: COUNT + 2, member_id: '1', timestamp: at(1), type: 'video', content: null, is_favorite: false,
      media_file: 'messages/1 Big Room/1 Big Room/video/5002.mp4', width: 640, height: 360 },
    { id: COUNT + 3, member_id: '1', timestamp: at(2), type: 'text', content: '今日もありがとう🌸',
      is_favorite: true, media_file: null, width: null, height: null },
  ] as unknown as FixtureMessage[]
  return [...buildBigRoom(), ...extra]
}

async function railMenu(page: Page, item: string) {
  await page.getByTitle('Settings', { exact: true }).click()
  await page.getByRole('menu').first().getByText(item, { exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await page.route('**/api/favorites/**', (route) => route.fulfill({ json: { success: true } }))
  await page.route((url) => url.pathname === '/api/search/status', (route) => route.fulfill({ json: { is_building: false } }))
  await page.route((url) => url.pathname === '/api/search', (route) =>
    route.fulfill({
      json: {
        query: 'おはよう', normalized_query: 'おはよう', total_count: 2, has_more: false,
        results: [
          { result_type: 'message', message_id: 42, content: 'おはよう😊', snippet: '<mark>おはよう</mark>😊', service: 'hinatazaka46', group_id: 1, group_name: 'Big Room', member_id: 1, member_name: 'Big Room', timestamp: '2026-11-03T10:00:00Z', type: 'text', is_group_chat: false },
          { result_type: 'message', message_id: 43, content: 'お早う', snippet: '<mark class="reading">お早う</mark>', service: 'sakurazaka46', group_id: 2, group_name: 'Other', member_id: 2, member_name: 'Other', timestamp: '2026-11-02T10:00:00Z', type: 'text', is_group_chat: false },
        ],
      },
    }),
  )
})

for (const service of GROUPS) {
  test(`${service}: chat dialogs`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: mediaRoom() }, service })
    await page.goto('/')
    await page.getByText('Big Room', { exact: true }).click()
    await settled(page, page.locator(`#msg-${COUNT + 3}`))

    for (const [item, name] of [['Date Search', 'calendar'], ['Favorites', 'favorites'], ['Background', 'background'], ['Sent Letters', 'sent-letters'], ['Media', 'media-gallery']] as const) {
      await page.getByTitle('More options').click()
      await page.getByRole('menu').first().getByText(item, { exact: true }).click()
      await settled(page, page.getByRole('dialog').first())
      await shot(page, `${service}-${name}`)
      if (name !== 'media-gallery') await closeAll(page)
    }

    const gallery = page.getByRole('dialog', { name: 'Media' })
    await gallery.locator('button:has(img)').first().click()
    await settled(page, page.getByRole('dialog', { name: /media viewer/i }))
    await shot(page, `${service}-media-viewer`)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /media viewer/i })).toHaveCount(0, { timeout: 30000 })

    await gallery.getByRole('tab', { name: 'Voice messages' }).click()
    const voiceRow = gallery.locator('button[aria-pressed]').first()
    await settled(page, voiceRow)
    await voiceRow.click()
    await shot(page, `${service}-media-voice`)
    await closeAll(page)
  })
}

for (const service of BRAND_CHECK) {
  test(`${service}: brand dialogs`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: buildBigRoom(50) }, service })
    await page.goto('/')
    await settled(page, page.getByText('Big Room', { exact: true }))

    await railMenu(page, 'Settings')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settled(page, settings)
    await shot(page, `${service}-settings-general`)
    await settings.getByRole('navigation').getByRole('button', { name: 'Sync', exact: true }).click()
    await shot(page, `${service}-settings-sync`)
    await settings.getByRole('button', { name: 'Re-sync all', exact: true }).click()
    await settled(page, page.getByRole('dialog').last())
    await shot(page, `${service}-confirm`)
    await page.keyboard.press('Escape')
    await settings.getByRole('navigation').getByRole('button', { name: 'Updates', exact: true }).click()
    await shot(page, `${service}-settings-updates`)
    await closeAll(page)

    await railMenu(page, 'About')
    await settled(page, page.getByRole('dialog').first())
    await shot(page, `${service}-about`)
    const version = page.getByRole('dialog').first().getByText(/^Version /).first()
    for (let i = 0; i < 5; i++) await version.click()
    await settled(page, page.getByRole('dialog', { name: 'Developer Diagnostics' }))
    await shot(page, `${service}-diagnostics`)
    await closeAll(page)

    await railMenu(page, 'Report Issue')
    const report = page.getByRole('dialog').first()
    await settled(page, report)
    await report.getByRole('button', { name: /Sync \/ Data/ }).click()
    await shot(page, `${service}-report-issue`)
    await closeAll(page)

    await page.getByRole('button', { name: 'Add Service' }).click()
    await settled(page, page.getByRole('dialog').first())
    await shot(page, `${service}-add-service`)
    await closeAll(page)

    await page.keyboard.press('Control+k')
    await page.getByPlaceholder(/^Search messages/).fill('おはよう')
    await settled(page, page.locator('mark', { hasText: 'おはよう' }).first())
    await page.keyboard.press('ArrowDown')
    await shot(page, `${service}-search`)
    await closeAll(page)
  })
}
```

- [ ] **Step 2: Check it skips without a label**

Run (from `frontend/`): `npx playwright test e2e/r-c-screens.spec.ts --reporter=line`
Expected: `6 skipped`.

- [ ] **Step 3: Make sure nothing else serves port 8000, then capture "dev"**

Run: `ss -ltn | grep ':8000 ' || echo free`; expected `free`. Then (from `frontend/`): `npm run build && mkdir -p e2e-shots/r-c/dev && SHOT_LABEL=dev npx playwright test e2e/r-c-screens.spec.ts --reporter=line`
Expected: `6 passed`; 46 PNGs in `e2e-shots/r-c/dev/` (4 groups × 7 chat shots + 2 groups × 9 brand shots).

- [ ] **Step 4: Capture "base" from the `e4e4118` worktree**

The worktree `../SakaDesk-e4e4118` exists (it already holds `fixtures/bigRoom.ts` and `fixtures/blogs.ts` from R-a / R-b). Copy the spec and refresh the fixture (untracked there, never committed): `cp frontend/e2e/r-c-screens.spec.ts ../SakaDesk-e4e4118/frontend/e2e/ && cp frontend/e2e/fixtures/bigRoom.ts ../SakaDesk-e4e4118/frontend/e2e/fixtures/`. Then run from `../SakaDesk-e4e4118/frontend`: `npm ci && npm run build && mkdir -p e2e-shots/r-c/base && SHOT_LABEL=base npx playwright test e2e/r-c-screens.spec.ts --reporter=line`.
Expected: all pass. `e4e4118` has the old DOM (no `role="tab"` on the media tabs, no `aria-pressed` on voice rows, the old settings menu and dialogs without `role="dialog"` names in places). If a locator misses there, fix only that locator in the worktree copy (a shot may be left out; the page shows a `—` cell); do not touch the repo spec.
Copy results: `mkdir -p /mnt/c/D/saka-verify/shots/r-c && cp -r e2e-shots/r-c/base /mnt/c/D/saka-verify/shots/r-c/ && cp -r /home/xtorker/repos/Project-Saka/SakaDesk/frontend/e2e-shots/r-c/dev /mnt/c/D/saka-verify/shots/r-c/`.

- [ ] **Step 5: Commit the spec**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk && git add frontend/e2e/r-c-screens.spec.ts
uv run git commit -m "test(e2e): add capture spec for the R-c dialogs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Shared pieces: bold `Modal` title, header `icon`, `useGroupMarker`, breadcrumb (pending decisions D1, D2)

**Files:**
- Modify: `frontend/src/design/primitives/Modal.tsx`
- Create: `frontend/src/design/useGroupMarker.ts`, `frontend/src/design/rCDialogs.test.tsx`
- Modify: `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py`

**Interfaces:**
- Produces: `ModalProps.icon?: React.ReactNode` (decorative, before the title, `data-testid="modal-header-icon"`); the title `h2` is `text-title font-bold`; `useGroupMarker(serviceId: string | null, target: GroupMarkerTarget): React.CSSProperties | undefined` with `type GroupMarkerTarget = 'add_service' | 'settings_row'` (exported from `frontend/src/design/useGroupMarker.ts`); `ClientLogEvent` `'group_marker_fallback'` (fields `target`, `reason: 'unknown_service'`).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_client_log_api.py`: add this row to the `parametrize` list of `test_design_system_events_are_accepted` (after the last `blog_fallback` tuple):

```python
        ("group_marker_fallback", {"target": "add_service", "reason": "unknown_service"}, "info"),
```

`frontend/src/design/rCDialogs.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { Calendar } from 'lucide-react';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { Modal } from './primitives/Modal';
import { useGroupMarker } from './useGroupMarker';
import { groupRoles } from './tokens';
import { resetDialogStack } from './dialog/dialogStack';

beforeEach(() => resetDialogStack());
afterEach(() => vi.mocked(clientLog).mockClear());

describe('Modal header (R-c)', () => {
    it('draws the title bold, as the pre-D2 dialog header did', () => {
        render(<Modal isOpen onClose={vi.fn()} title="日付検索 📅" closeLabel="閉じる">x</Modal>);
        expect(screen.getByRole('heading', { level: 2, name: '日付検索 📅' })).toHaveClass('text-title', 'font-bold');
    });

    it('shows a decorative icon before the title, in the header text colour', () => {
        render(<Modal isOpen onClose={vi.fn()} title="t" icon={<Calendar />}>x</Modal>);
        const slot = screen.getByTestId('modal-header-icon');
        expect(slot).toHaveAttribute('aria-hidden', 'true');
        expect(slot.querySelector('svg')).not.toBeNull();
        expect(screen.getByTestId('modal-header')).toContainElement(slot);
        expect(slot.nextElementSibling?.tagName).toBe('H2');
        expect(slot.className).not.toMatch(/text-/);
    });

    it('has no icon slot without an icon, and keeps the inline close button at 12 px', () => {
        render(<Modal isOpen onClose={vi.fn()} title="t" closeLabel="閉じる">x</Modal>);
        expect(screen.queryByTestId('modal-header-icon')).toBeNull();
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveClass('rounded-md');
    });
});

describe('useGroupMarker', () => {
    it('scopes a marker to the named service', () => {
        const { result } = renderHook(() => useGroupMarker('sakurazaka46', 'add_service'));
        const vars = result.current as Record<string, string>;
        expect(vars['--ds-group-accent']).toBe(groupRoles('sakurazaka').action);
        expect(vars['--ds-accent']).toBeDefined();
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('leaves an unknown service in the surrounding context and logs one fallback', () => {
        const { result, rerender } = renderHook(() => useGroupMarker('unknown_svc', 'settings_row'));
        expect(result.current).toBeUndefined();
        rerender();
        expect(clientLog).toHaveBeenCalledTimes(1);
        expect(clientLog).toHaveBeenCalledWith('group_marker_fallback', { target: 'settings_row', reason: 'unknown_service' });
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/design/rCDialogs.test.tsx`
Expected: FAIL (`font-bold` missing, no `modal-header-icon`, cannot resolve `./useGroupMarker`).
Run (repo root): `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: FAIL on the `group_marker_fallback` case (422).

- [ ] **Step 3: Implement the event** — `frontend/src/utils/clientLog.ts`: change the last union member line to `| 'menu_item_blocked' | 'blog_fallback' | 'group_marker_fallback';`. `backend/api/client_log.py`: add `"group_marker_fallback",` after `"blog_fallback",` in `ClientEvent`'s literal list. `target` and `reason` are already allowed field keys.

- [ ] **Step 4: Implement `useGroupMarker`** — `frontend/src/design/useGroupMarker.ts`

```ts
import { useEffect, useMemo, type CSSProperties } from 'react';
import { groupScopeStyle } from './groupScope';
import { serviceGroupId } from '../config/serviceGroup';
import { clientLog } from '../utils/clientLog';

/** Where a group marker sits; logged when its service is unknown. */
export type GroupMarkerTarget = 'add_service' | 'settings_row';

/**
 * Group scope for one piece of a brand dialog that names one service (a group card, a per-group
 * settings row: docs/design/DESIGN_SYSTEM.md, "Contexts"). Inside it every `*-accent-*` and
 * `*-group-*` utility follows that service's group. An unknown service has no group: the piece
 * stays in the surrounding (brand) context and one `group_marker_fallback` breadcrumb is logged.
 */
export function useGroupMarker(serviceId: string | null, target: GroupMarkerTarget): CSSProperties | undefined {
    const groupId = serviceGroupId(serviceId);
    const style = useMemo(() => (groupId === 'default' ? undefined : groupScopeStyle(groupId)), [groupId]);
    useEffect(() => {
        if (groupId === 'default') clientLog('group_marker_fallback', { target, reason: 'unknown_service' });
    }, [groupId, target]);
    return style;
}
```

- [ ] **Step 5: Implement the `Modal` header** — `frontend/src/design/primitives/Modal.tsx`:
  - In `ModalProps`, after the `title` prop add:

```ts
    /** Decorative icon before the title (standard layout). It takes the header text colour; pass an unsized lucide icon (drawn at 20 px). */
    icon?: React.ReactNode;
```

  - In `OpenModal`'s destructuring change `onClose, title, 'aria-label': ariaLabel,` to `onClose, title, icon, 'aria-label': ariaLabel,`.
  - Replace the title block (pending decisions D1 and D2):

```tsx
                            {title !== undefined && (
                                <h2 id={titleId} className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
                            )}
```

  with

```tsx
                            {title !== undefined && icon && (
                                <span data-testid="modal-header-icon" aria-hidden="true" className="flex shrink-0 items-center [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
                            )}
                            {title !== undefined && (
                                <h2 id={titleId} className="min-w-0 flex-1 truncate text-title font-bold">{title}</h2>
                            )}
```

- [ ] **Step 6: Run to verify they pass, plus every `Modal` user**

Run (from `frontend/`): `npx vitest run src/design src/core src/shell src/features && npx tsc --noEmit`
Expected: PASS. Run (repo root): `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design frontend/src/utils/clientLog.ts backend/api/client_log.py backend/tests/test_client_log_api.py
uv run git commit -m "feat(design): bold dialog titles, header icons, group marker hook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Confirm, About, Diagnostics, Report issue (pending decisions D2, D3, D7)

**Files:**
- Modify: `frontend/src/shell/components/ConfirmDialog.tsx`, `ConfirmDialog.test.tsx`
- Modify: `frontend/src/core/modals/AboutModal.tsx`, `AboutModal.test.tsx`
- Modify: `frontend/src/core/modals/DiagnosticsModal.tsx`, `DiagnosticsModal.test.tsx`
- Modify: `frontend/src/core/modals/ReportIssueModal.tsx`, `ReportIssueModal.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `Modal` `scope="brand"`, `icon` (Task 1).
- Produces: nothing new for later tasks; `ConfirmDialog` keeps its props.

- [ ] **Step 1: Write the failing tests**

`frontend/src/shell/components/ConfirmDialog.test.tsx`: replace the whole `it('renders the plain header', ...)` block with

```tsx
    it('renders the expressive header of its context with a semantic icon tile (D3)', () => {
        renderDialog({ variant: 'warning' });
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        expect(screen.getByTestId('modal-header-bar')).toBeInTheDocument();
        expect(screen.getByTestId('modal-header-icon').firstElementChild).toHaveClass('bg-semantic-warning-icon', 'border-semantic-warning', 'text-semantic-warning');
    });

    it('uses the danger tile for a danger confirm and the info tile otherwise, and Cancel is secondary', () => {
        renderDialog({ variant: 'danger' });
        expect(screen.getByTestId('modal-header-icon').firstElementChild).toHaveClass('bg-semantic-danger-icon', 'text-semantic-danger');
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('border-strong');
    });

    it('inherits the brand context inside a brand dialog', () => {
        render(
            <BrandScope>
                <ConfirmDialog open title="確認" message="m" confirmLabel="OK" onConfirm={vi.fn()} onCancel={vi.fn()} />
            </BrandScope>,
        );
        expect(screen.getByRole('dialog', { name: '確認' })).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header-icon').firstElementChild).toHaveClass('bg-semantic-info-icon', 'text-semantic-info');
    });
```

and add `import { BrandScope } from '../../design/brandScope';` to its imports.

`frontend/src/core/modals/AboutModal.test.tsx`: add inside `describe('AboutModal', ...)`:

```tsx
    it('is a brand dialog with the aurora header and a serif wordmark (D7)', () => {
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        expect(screen.getByRole('dialog')).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        expect(screen.getByText('SakaDesk', { selector: 'h3' })).toHaveClass('font-display', 'font-bold');
        expect(screen.getByRole('link', { name: /github\.com/ })).toHaveClass('focus-visible:ring-accent');
    });
```

`frontend/src/core/modals/DiagnosticsModal.test.tsx`: add inside `describe('DiagnosticsModal', ...)`:

```tsx
    it('is a brand dialog whose header note sits on a white pill', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        const dialog = await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByText('Hidden Panel')).toHaveClass('bg-sheet', 'text-secondary');
    });
```

`frontend/src/core/modals/ReportIssueModal.test.tsx`: add inside `describe('ReportIssueModal', ...)`:

```tsx
    it('is a brand dialog with the bug icon, and the chosen category uses the accent roles', async () => {
        render(<ReportIssueModal isOpen onClose={vi.fn()} currentScreen="Home" />);
        expect(screen.getByRole('dialog', { name: 'Report an Issue' })).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const sync = screen.getByRole('button', { name: /Sync \/ Data/ });
        await userEvent.click(sync);
        expect(sync).toHaveAttribute('aria-pressed', 'true');
        expect(sync).toHaveClass('border-accent', 'bg-accent-subtle');
        expect(screen.getByText('Sync / Data')).toHaveClass('text-accent-strong');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/shell/components/ConfirmDialog.test.tsx src/core/modals/AboutModal.test.tsx src/core/modals/DiagnosticsModal.test.tsx src/core/modals/ReportIssueModal.test.tsx`
Expected: FAIL (plain header, no `data-scope="brand"`, neutral selection).

- [ ] **Step 3: Implement the confirm dialog (pending decision D3)** — `ConfirmDialog.tsx`: replace `ICON_TONE` and the `Modal` element:

```tsx
/** The meaning stays semantic on any header (spec 3.4 icon rule: icon-step fill, border-step outline, text-step glyph). */
const ICON_TILE: Record<NonNullable<ConfirmDialogProps['variant']>, string> = {
    warning: 'bg-semantic-warning-icon border-semantic-warning text-semantic-warning',
    danger: 'bg-semantic-danger-icon border-semantic-danger text-semantic-danger',
    default: 'bg-semantic-info-icon border-semantic-info text-semantic-info',
};

/** In-app confirmation dialog. Escape cancels; at most one emphasised button. The header follows the opener's context. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open, title, message, confirmLabel, cancelLabel, variant = 'default', onConfirm, onCancel, logId = 'confirm',
}) => {
    const { t } = useTranslation();
    const cancelRef = useRef<HTMLButtonElement>(null);
    return (
        <Modal
            isOpen={open}
            onClose={onCancel}
            title={title}
            icon={
                <span className={cn('flex h-8 w-8 items-center justify-center rounded-full border', ICON_TILE[variant])}>
                    <AlertTriangle className="h-4 w-4" />
                </span>
            }
            logId={logId}
            initialFocusRef={cancelRef}
            className="max-w-md"
            footer={
                <>
                    <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel ?? t('common.cancel')}</Button>
                    <Button variant={variant === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
                </>
            }
        >
            <p className="whitespace-pre-line text-body text-secondary">{message}</p>
        </Modal>
    );
};
```

- [ ] **Step 4: Implement About (pending decision D7)** — `AboutModal.tsx`: on the `<Modal` add `scope="brand"`; the footer link's `focus-visible:ring-group` → `focus-visible:ring-accent`; the wordmark `<h3 className="text-heading font-semibold text-primary">SakaDesk</h3>` → `<h3 className="font-display text-heading font-bold text-primary">SakaDesk</h3>` (`e4e4118`: `text-xl font-bold`). The heart keeps `text-heart` (not 推).

- [ ] **Step 5: Implement Diagnostics** — `DiagnosticsModal.tsx`: on the `<Modal` add `scope="brand"`; `headerExtra={<span className="rounded-pill bg-sunken px-2 py-1 text-caption text-muted">Hidden Panel</span>}` → `headerExtra={<span className="rounded-pill bg-sheet px-2 py-1 text-caption text-secondary">Hidden Panel</span>}` (it sits on the aurora header, where `text-muted` on `bg-sunken` read as disabled; the English label stays, D2c decision 22). The log `Pill`s already use the accent selected state (R-b) and turn ink in brand scope.

- [ ] **Step 6: Implement Report issue (pending decision D2)** — `ReportIssueModal.tsx`: on the `<Modal` add `scope="brand"` and `icon={<Bug />}` (`e4e4118`: `<Bug className="w-5 h-5 text-amber-400" />`; header text colour per D2 (a)). The category button classes (`e4e4118`: selected `border-blue-500 bg-blue-50`, icon `text-blue-600`, label `text-blue-700`; rest `border-gray-200`):

```tsx
                                className={cn(
                                    'flex flex-col gap-1 rounded-card border-2 p-4 text-left shadow-card transition-colors duration-fast ease-standard',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                    isSelected ? 'border-accent bg-accent-subtle' : 'border-transparent bg-card hover:bg-sunken',
                                )}
                            >
                                <span className="flex items-center gap-2 text-body font-semibold">
                                    <Icon className={cn('h-4 w-4', isSelected ? 'text-accent' : 'text-secondary')} />
                                    <span className={isSelected ? 'text-accent-strong' : 'text-primary'}>{t(cat.labelKey)}</span>
                                </span>
```

(the help line below stays `text-caption text-muted`; Cancel stays ghost, as at `e4e4118`'s text-only Cancel).

- [ ] **Step 7: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/shell/components src/core/modals src/core/dialogs.style.test.ts && npx tsc --noEmit`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/modals/AboutModal.tsx` (1) and `core/modals/ReportIssueModal.tsx` (4) removed; nothing else changes.

- [ ] **Step 8: Commit**

```bash
git add frontend
uv run git commit -m "feat(dialogs): brand scope and colour for app dialogs and confirm" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Add service and search: brand scope, group markers, `lang="ja"`

**Files:**
- Modify: `frontend/src/core/layout/AddServiceModal.tsx`
- Create: `frontend/src/core/layout/AddServiceModal.test.tsx`
- Modify: `frontend/src/features/search/SearchModal.tsx`, `components/SearchInput.tsx`, `components/SearchFilterBar.tsx`, `components/SearchResultItem.tsx`
- Create: `frontend/src/features/search/rCSearch.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `useGroupMarker(serviceId, 'add_service')` (Task 1), `serviceGroupId` (`config/serviceGroup.ts`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests**

`frontend/src/core/layout/AddServiceModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { AddServiceModal } from './AddServiceModal';
import { groupRoles } from '../../design/tokens';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => resetDialogStack());

describe('AddServiceModal (R-c)', () => {
    it('is a brand dialog with the aurora header', () => {
        render(<AddServiceModal selectedServices={[]} onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Add Service' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
    });

    it('makes each card a marker of its own group that lights up in that colour on hover', () => {
        render(<AddServiceModal selectedServices={[]} onClose={vi.fn()} />);
        const sakura = screen.getByRole('button', { name: /櫻坂46/ });
        expect(sakura.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        expect(sakura).toHaveClass('border-subtle', 'hover:border-accent', 'hover:shadow-accent-glow-hover', 'focus-visible:ring-accent');
        const hinata = screen.getByRole('button', { name: /日向坂46/ });
        expect(hinata.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('hinatazaka').action);
    });

    it('marks the group name as Japanese content', () => {
        render(<AddServiceModal selectedServices={[]} onClose={vi.fn()} />);
        expect(screen.getByText('櫻坂46')).toHaveAttribute('lang', 'ja');
    });
});
```

`frontend/src/features/search/rCSearch.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import { SearchModal, type SearchModalHandle } from './SearchModal';
import { SearchResultItem } from './components/SearchResultItem';
import type { SearchResult } from './types';

const MESSAGE: SearchResult = {
    result_type: 'message', message_id: 1, content: 'おはよう😊', snippet: '<mark>おはよう</mark>😊',
    service: 'sakurazaka46', group_id: 2, group_name: '山下 瞳月', member_id: 3, member_name: '山下 瞳月',
    timestamp: '2026-11-04T10:00:00Z', type: 'text', is_group_chat: false,
} as SearchResult;

describe('Search (R-c)', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'] });
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })));
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is a brand dialog whichever group is active', () => {
        const ref = createRef<SearchModalHandle>();
        render(<SearchModal ref={ref} />);
        act(() => ref.current!.open());
        expect(screen.getByRole('dialog', { name: 'Search' })).toHaveAttribute('data-scope', 'brand');
    });

    it('selects a result with the accent roles and keeps its group dot', () => {
        render(<SearchResultItem result={MESSAGE} isSelected onSelect={vi.fn()} onMouseEnter={vi.fn()} />);
        const row = screen.getByText('山下 瞳月', { selector: 'span.font-semibold' }).closest('div.flex.w-full') as HTMLElement;
        expect(row).toHaveClass('bg-accent-subtle');
        expect(row.querySelector('.bg-group-marker')).not.toBeNull();
    });

    it('marks member names, room names and snippets as Japanese content', () => {
        render(<SearchResultItem result={MESSAGE} isSelected={false} onSelect={vi.fn()} onMouseEnter={vi.fn()} />);
        for (const el of screen.getAllByText('山下 瞳月')) expect(el).toHaveAttribute('lang', 'ja');
        expect(screen.getByText('おはよう', { selector: 'mark' }).closest('p')).toHaveAttribute('lang', 'ja');
    });
});
```

(`formatName` keeps `山下 瞳月` as is; if the row's DOM wrapper differs, locate the row by `closest('[class*="rounded-card"]')` instead, keep the assertions.)

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/core/layout/AddServiceModal.test.tsx src/features/search/rCSearch.test.tsx`
Expected: FAIL (no brand scope, no marker style, `bg-group-subtle`, no `lang`).

- [ ] **Step 3: Implement Add service** — `AddServiceModal.tsx`: add `import { useGroupMarker } from '../../design/useGroupMarker';` and `import type { ServiceDefinition } from '../../data/services';`; on the `<Modal` add `scope="brand"`; replace the `availableServices.map(...)` body with `<ServiceCard key={service.id} service={service} onSelect={handleSelect} />`, and add below the component:

```tsx
/** One service as a group marker (spec section 4): its accent roles follow its own group (`e4e4118`: hover border in the group's logo colour). */
const ServiceCard: React.FC<{ service: ServiceDefinition; onSelect: (id: string) => void }> = ({ service, onSelect }) => {
    const { t } = useTranslation();
    const marker = useGroupMarker(service.id, 'add_service');
    return (
        <button
            type="button"
            onClick={() => onSelect(service.id)}
            style={marker}
            className="flex w-full items-center gap-4 rounded-card border border-subtle bg-card p-4 text-left shadow-card transition-[border-color,box-shadow] duration-fast ease-standard hover:border-accent hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-pill bg-card shadow-pill">
                {service.logoUrl ? (
                    <img
                        src={service.logoUrl}
                        alt=""
                        className="h-9 w-9 object-contain"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                    />
                ) : null}
                <span className={cn('font-semibold text-secondary', service.logoUrl ? 'hidden' : '')}>{service.shortCode}</span>
            </span>
            <span className="flex min-w-0 flex-col gap-1">
                <span lang="ja" className="text-body font-semibold text-primary">{service.displayName}</span>
                <span className="flex flex-wrap gap-1">
                    {(SERVICE_FEATURES[service.id] || []).map((featureId) => {
                        const feature = FEATURE_DEFINITIONS[featureId];
                        const Icon = feature.icon;
                        return (
                            <span key={featureId} className="inline-flex items-center gap-1 rounded-pill bg-sunken px-2 py-1 text-caption text-secondary">
                                <Icon className="h-3 w-3" />
                                {t(`features.${featureId}`)}
                            </span>
                        );
                    })}
                </span>
            </span>
        </button>
    );
};
```

(`e4e4118` used the logo colour, `getServicePrimaryColor`, for the hover border; there is no logo border utility, so the border is the group's step 600 `accent` and the glow comes from the logo through `shadow-accent-glow-hover`. `transition-[border-color,box-shadow]` is an arbitrary transition property, which the guard allows.)

- [ ] **Step 4: Implement search** —
  - `SearchModal.tsx`: on the `<Modal` add `scope="brand"`.
  - `SearchInput.tsx`: `className={cn(filtersActive && 'bg-sunken text-primary')}` → `className={cn(filtersActive && 'bg-accent-subtle text-accent-strong')}` (a toggled control = selected, spec §8).
  - `SearchResultItem.tsx` (`e4e4118`: selected `bg-blue-50`): `isSelected ? 'bg-group-subtle' : 'hover:bg-sunken'` → `isSelected ? 'bg-accent-subtle' : 'hover:bg-sunken'`; add `lang="ja"` to the member-name span (`{formatName(result.member_name)}`), the group-name span (`{result.group_name}`), the blog title `<p>` (`{result.title}`) and both snippet / content `<p>` elements.
  - `SearchFilterBar.tsx`: both `accent-group` → `accent-accent`; both `focus-visible:ring-group` → `focus-visible:ring-accent`; the "enable full backup" link `text-group-strong underline decoration-group` → `text-accent-strong underline` (`decoration-group` is the active group's underline and would leak a group colour into brand search; the underline now takes the text colour); add `lang="ja"` to the chip label (`{chip.label}` is a member or group name: wrap it as `<span lang="ja">{chip.label}</span>`) and to the dropdown item label span (`{item.label}`).

- [ ] **Step 5: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/core/layout src/features/search src/core/dialogs.style.test.ts && npx tsc --noEmit`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/layout/AddServiceModal.tsx` (1), `features/search/components/SearchFilterBar.tsx` (5) and `features/search/components/SearchResultItem.tsx` (1) removed; nothing else changes.

- [ ] **Step 6: Commit**

```bash
git add frontend
uv run git commit -m "feat(dialogs): brand add service and search with group markers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Settings and login (pending decisions D1, D5, D6)

**Files:**
- Modify: `frontend/src/shell/components/SettingsModal.tsx`
- Create: `frontend/src/shell/components/SettingsModal.rC.test.tsx`
- Modify: `frontend/src/shell/components/LoginModal.tsx`, `entryDialogs.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `useGroupMarker(activeService, 'settings_row')` (Task 1), `getServiceDisplayName(id)` (`data/services.ts`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests**

`frontend/src/shell/components/SettingsModal.rC.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { SettingsModal } from './SettingsModal';
import { groupRoles } from '../../design/tokens';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
});

const settings = { output_dir: '/out', auto_sync_enabled: true, sync_interval_minutes: 15, is_configured: true };

function renderModal(activeService = 'sakurazaka46') {
    render(
        <SettingsModal appSettings={settings} outputDirInput="/out" setOutputDirInput={() => {}} onSaveSettings={vi.fn().mockResolvedValue(true)}
            onClose={vi.fn()} activeService={activeService} onVerifyAndFix={() => {}} onDeepResync={() => {}} />,
    );
}

describe('SettingsModal (R-c)', () => {
    it('is a brand dialog: aurora header, ink selection in the section nav', () => {
        renderModal();
        const dialog = screen.getByRole('dialog', { name: 'Settings' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header');
        const nav = within(dialog).getByRole('navigation', { name: 'Settings sections' });
        const current = within(nav).getByRole('button', { name: 'General' });
        expect(current).toHaveClass('bg-accent-subtle', 'text-accent-strong', 'font-semibold', 'focus-visible:ring-accent');
        expect(within(nav).getByRole('button', { name: 'Sync' })).not.toHaveClass('bg-accent-subtle');
    });

    it('marks the per-group sync rows with the active group (D5) and keeps re-sync in the warning colour (D6)', async () => {
        renderModal('sakurazaka46');
        await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
        const rows = screen.getByTestId('settings-group-rows');
        expect(rows.style.getPropertyValue('--ds-group-accent')).toBe(groupRoles('sakurazaka').action);
        const chips = within(rows).getAllByTestId('settings-group-chip');
        expect(chips).toHaveLength(2);
        expect(chips[0]).toHaveTextContent('櫻坂46');
        expect(chips[0]).toHaveAttribute('lang', 'ja');
        expect(within(rows).getByRole('button', { name: 'Verify now' })).toHaveClass('text-accent-strong');
        expect(within(rows).getByRole('button', { name: 'Re-sync all' })).toHaveClass('text-semantic-warning');
        for (const radio of screen.getAllByRole('radio')) expect(radio).toHaveClass('accent-accent');
    });

    it('draws Check Now as a quiet accent wash', async () => {
        renderModal();
        await userEvent.click(screen.getByRole('button', { name: 'Updates' }));
        expect(screen.getByRole('button', { name: 'Check Now' })).toHaveClass('bg-accent-wash', 'border-accent-wash', 'text-accent-strong');
    });
});
```

`frontend/src/shell/components/entryDialogs.test.tsx`: add at the end of the LoginModal `describe` block (the one containing the `櫻坂46` / `text-secondary` case):

```tsx
    it('draws the banner title bold and the light-header icon disc in the accent tint (R-c)', () => {
        render(<LoginModal serviceId="sakurazaka46" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />);
        const banner = screen.getByTestId('login-banner');
        expect(within(banner).getByRole('heading', { level: 2 })).toHaveClass('font-bold');
        expect(banner.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-subtle');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/shell/components/SettingsModal.rC.test.tsx src/shell/components/entryDialogs.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the settings frame** — `SettingsModal.tsx`:
  - imports: add `import { useGroupMarker } from '../../design/useGroupMarker';` and `import { getServiceDisplayName } from '../../data/services';`.
  - on the `<Modal` add `scope="brand"`.
  - nav button classes (`e4e4118`: selected `bg-white shadow-sm text-gray-800 font-medium`, neutral; spec §8 selected = accent roles, ink in brand):

```tsx
                        className={cn(
                            'flex w-full items-center gap-2 rounded-pill px-3 py-2 text-left text-small transition-colors duration-fast ease-standard',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            activeTab === id ? 'bg-accent-subtle font-semibold text-accent-strong' : 'text-secondary hover:bg-sunken hover:text-primary',
                        )}
```

  - the three sync-mode radios: `className="h-4 w-4 accent-group"` → `className="h-4 w-4 accent-accent"`.

- [ ] **Step 4: Implement the per-group rows (pending decisions D5, D6)** — in `SettingsModal` (the component that has `activeService`), after `const syncMode = ...` add `const groupMarker = useGroupMarker(activeService, 'settings_row');` and, above the component, a chip:

```tsx
/** The group a per-group row acts on (spec section 4 marker): a dot in the group colour and its name (data). */
const GroupChip: React.FC<{ serviceId: string }> = ({ serviceId }) => (
    <span data-testid="settings-group-chip" lang="ja" className="inline-flex items-center gap-1 rounded-pill bg-accent-subtle px-2 py-0.5 text-caption font-semibold text-accent-strong">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-pill bg-accent" />
        {getServiceDisplayName(serviceId)}
    </span>
);
```

Then wrap the "Verify & Fix Media" and "Deep re-sync" `SettingRow`s (keep their comment block) in

```tsx
                    <div data-testid="settings-group-rows" style={groupMarker} className="flex flex-col gap-6">
                        ...the two rows...
                    </div>
```

and change the two rows to:

```tsx
                        <SettingRow
                            label={<>{t('settings.verifyFixMedia')}<GroupChip serviceId={activeService} /></>}
                            description={t('settings.verifyFixMediaDesc')}
                            control={
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        // Close settings so the verify progress/result
                                        // (shown in the sync modal) is in focus.
                                        onVerifyAndFix(activeService);
                                        onClose();
                                    }}
                                >
                                    {t('settings.verifyFixButton')}
                                </Button>
                            }
                        />

                        {/* Deep re-verify: full re-sync (re-paginates every member from
                            scratch, skipping already-downloaded assets). Catches gaps the
                            media-only check can't (e.g. entirely-missing messages). */}
                        <SettingRow
                            label={<>{t('settings.deepResync')}<GroupChip serviceId={activeService} /></>}
                            description={t('settings.deepResyncDesc')}
                            control={
                                <Button variant="ghost" size="sm" className="text-semantic-warning hover:bg-semantic-warning-subtle" onClick={() => setConfirm('deep')}>
                                    {t('settings.deepResyncButton')}
                                </Button>
                            }
                        />
```

(`e4e4118`: "Verify now" `text-blue-600 hover:text-blue-800` → ghost `text-accent-strong` in the row's group scope; "Re-sync all" `text-amber-600 hover:text-amber-800` → semantic warning text, the same in every group. The confirm the re-sync opens is inside the brand `Modal`, so it stays brand.)

- [ ] **Step 5: Implement Check Now** — in `UpdatesSection` (`e4e4118`: `text-blue-600 bg-blue-50 hover:bg-blue-100`, a light tint at rest):

```tsx
                <Button variant="secondary" size="sm" className="border-accent-wash bg-accent-wash text-accent-strong hover:bg-accent-subtle" onClick={handleCheckNow} disabled={checking}>
```

- [ ] **Step 6: Implement login (pending decision D1)** — `LoginModal.tsx`: the icon disc `isLight ? 'bg-group-subtle' : 'bg-viewer-control'` → `isLight ? 'bg-accent-subtle' : 'bg-viewer-control'` (the scope wrapper sets that group's accent variables, so the tint is the same group 50); the title `<h2 id={titleId} className="truncate text-title font-semibold">` → `<h2 id={titleId} className="truncate text-title font-bold">` (`e4e4118`: `text-lg font-bold`).

- [ ] **Step 7: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/shell src/core/dialogs.style.test.ts && npx tsc --noEmit`
Expected: PASS (the existing `SettingsModal.*.test.tsx` files included: Verify now / Re-sync all keep their names). Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `shell/components/SettingsModal.tsx` (4) and `shell/components/LoginModal.tsx` (1) removed; nothing else changes.

- [ ] **Step 8: Commit**

```bash
git add frontend
uv run git commit -m "feat(settings): brand settings with group-marked sync rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Chat dialogs: calendar, background, favourites, sent letters (pending decisions D2, D4)

**Files:**
- Modify: `frontend/src/core/modals/CalendarModal.tsx`, `BackgroundModal.tsx`, `FavoritesModal.tsx`, `SentLettersModal.tsx`, `BackgroundModal.test.tsx`
- Modify: `frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx`
- Create: `frontend/src/core/modals/rCChatDialogs.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `Modal icon` (Task 1). `VoicePlayer`'s `accentColor` defaults to `ACCENT` (`var(--ds-accent)`), so omitting it follows the context.
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests** — `frontend/src/core/modals/rCChatDialogs.test.tsx`

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { CalendarModal } from './CalendarModal';
import { BackgroundModal } from './BackgroundModal';
import { FavoritesModal } from './FavoritesModal';
import { SentLettersModal } from './SentLettersModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../utils/backgroundSettings', async (orig) => ({
    ...(await orig<typeof import('../../utils/backgroundSettings')>()),
    saveBackgroundSettings: vi.fn(),
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

const msg = (over: Partial<Message>): Message => ({ id: 1, content: 'x', timestamp: '2026-06-10T03:00:00Z', type: 'text', is_favorite: false, ...over } as Message);

describe('CalendarModal (R-c)', () => {
    it('restores the modal accents: header icon, accent dots, accent hover and the ring on today', () => {
        render(<CalendarModal isOpen onClose={vi.fn()} messages={[msg({ media_file: 'p/1.jpg', type: 'picture' })]} onSelectDate={vi.fn()} />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const today = screen.getAllByRole('button', { name: '10' })[0];
        expect(today).toHaveClass('ring-2', 'ring-inset', 'ring-accent', 'hover:bg-accent-subtle', 'focus-visible:ring-accent');
        expect(today).not.toHaveClass('bg-sunken');
        expect(today.querySelector('span[aria-hidden="true"]')).toHaveClass('h-1.5', 'w-1.5', 'bg-accent');
    });
});

describe('BackgroundModal (R-c)', () => {
    it('restores the accent selection, dashed upload, accent slider and the palette icon', () => {
        render(<BackgroundModal isOpen onClose={vi.fn()} conversationPath="p" onSettingsChange={vi.fn()} />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('#FEE2E2'));
        expect(screen.getByTitle('#FEE2E2')).toHaveClass('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-surface');
        expect(screen.getByRole('button', { name: /Upload/ })).toHaveClass('border-dashed', 'hover:border-accent-border', 'hover:text-accent-strong');
        expect(screen.getByRole('slider')).toHaveClass('accent-accent');
    });
});

describe('FavoritesModal (R-c)', () => {
    const favs = [
        msg({ id: 1, content: '今日もありがとう🌸', is_favorite: true }),
        msg({ id: 2, type: 'picture', content: null as unknown as string, media_file: 'messages/a/picture/2.jpg', is_favorite: true, timestamp: '2026-06-09T03:00:00Z' }),
    ];

    it('marks a bookmarked message with the yellow semantic star, in every group', () => {
        render(<FavoritesModal isOpen onClose={vi.fn()} messages={favs} memberName="春野 ひなた" serviceId="sakurazaka46" />);
        const dialog = screen.getByRole('dialog', { name: 'Favorites' });
        const stars = dialog.querySelectorAll('svg.text-semantic-star');
        expect(stars.length).toBe(2);
        expect(stars[0]).toHaveClass('fill-current', 'drop-shadow-sm');
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
    });

    it('marks member names and message text as Japanese content', () => {
        render(<FavoritesModal isOpen onClose={vi.fn()} messages={favs} memberName="春野 ひなた" serviceId="sakurazaka46" />);
        for (const name of screen.getAllByText('春野 ひなた')) expect(name).toHaveAttribute('lang', 'ja');
        expect(screen.getByText('今日もありがとう🌸')).toHaveAttribute('lang', 'ja');
    });

    it('opens the dark viewer with a circular close button', async () => {
        vi.useRealTimers();
        render(<FavoritesModal isOpen onClose={vi.fn()} messages={favs} memberName="春野 ひなた" serviceId="sakurazaka46" />);
        await userEvent.click(within(screen.getByRole('dialog', { name: 'Favorites' })).getAllByRole('button').find((b) => b.querySelector('img'))!);
        const viewer = screen.getByRole('dialog', { name: /media viewer/i });
        expect(within(viewer).getByRole('button', { name: 'Close' })).toHaveClass('rounded-full');
        expect(within(viewer).getByText('春野 ひなた')).toHaveAttribute('lang', 'ja');
    });
});

describe('SentLettersModal (R-c)', () => {
    const letters = [{ id: 1, text: 'ありがとう🌸', created_at: '2025-05-05T14:00:00Z', image_url: null, width: null, height: null }];

    it('has the mail icon, marks letter text ja and lights the card in the accent on hover (D4)', () => {
        render(<SentLettersModal isOpen onClose={vi.fn()} letters={letters} status="ready" onSelectLetter={vi.fn()} />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        expect(screen.getByText('ありがとう🌸')).toHaveAttribute('lang', 'ja');
        const card = screen.getByRole('button', { name: /^Letter sent/ });
        expect(card).toHaveClass('focus-visible:ring-accent');
        expect(card.firstElementChild).toHaveClass('group-hover:ring-accent-border', 'group-hover:shadow-accent-glow-hover');
        expect(card.querySelector('time')).toHaveClass('group-hover:text-accent-strong');
    });
});
```

`frontend/src/core/modals/BackgroundModal.test.tsx`: in `it('marks the selected preset with a ring offset on the surface colour', ...)` change the expectation to `toHaveClass('ring-accent', 'ring-offset-2', 'ring-offset-surface')`.

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/core/modals/rCChatDialogs.test.tsx src/core/modals/BackgroundModal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the calendar (pending decision D2)** — `CalendarModal.tsx`: change the lucide import to `import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';`; on the `<Modal` add `icon={<CalendarIcon />}` (`e4e4118`: `icon={Calendar}`). The day button (`e4e4118`: hover `theme.modals.accentColorLight`, dot `w-1.5 h-1.5` in `theme.modals.accentColor`, today `boxShadow: 0 0 0 2px ${theme.modals.accentColor}`):

```tsx
                                    className={cn(
                                        'relative flex aspect-square flex-col items-center justify-center rounded-pill text-small',
                                        'transition-colors duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                                        !isCurrentMonth && 'opacity-30',
                                        hasMessages ? 'cursor-pointer text-primary hover:bg-accent-subtle' : 'text-muted',
                                        isCurrentMonth && date.getDay() === 0 && 'text-sunday',
                                        today && 'font-semibold ring-2 ring-inset ring-accent',
                                    )}
                                >
                                    <span>{date.getDate()}</span>
                                    {hasMessages && <span aria-hidden="true" className="absolute bottom-1 h-1.5 w-1.5 rounded-pill bg-accent" />}
```

- [ ] **Step 4: Implement the background dialog (pending decision D2)** — `BackgroundModal.tsx`: on the `<Modal` add `icon={<Palette />}` (`e4e4118`: `icon={Palette}`); the upload button (`e4e4118`: `border-2 border-dashed border-gray-300`, hover border `accentColorMuted` and text `accentColor`):

```tsx
                <Button variant="secondary" className="border-2 border-dashed hover:border-accent-border hover:text-accent-strong" onClick={() => fileInputRef.current?.click()}>
```

the preset swatch classes (`e4e4118`: selected `borderColor: accentColor` + `boxShadow: 0 0 0 2px accentColorLight`; the user's colour itself stays data):

```tsx
                                className={cn(
                                    'h-10 w-10 rounded-card shadow-pill transition-shadow duration-fast ease-standard',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                    isSelected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                                )}
```

and the slider `className="w-full cursor-pointer accent-group"` → `className="w-full cursor-pointer accent-accent"` (`e4e4118`: `accentColor: theme.modals.accentColor`).

- [ ] **Step 5: Implement favourites (pending decision D2)** — `FavoritesModal.tsx`:
  - remove `import { groupRoles } from '../../design/tokens';`, `import { serviceGroupId } from '../../config/serviceGroup';`, the `activeService` line and the `voiceAccent` line with its comment; `<VoicePlayer src={mediaUrl} accentColor={voiceAccent} />` → `<VoicePlayer src={mediaUrl} />` (the default is the context accent).
  - on the main `<Modal` add `icon={<Star />}` (`e4e4118`: `icon={Star}`; header text colour per D2 (a)).
  - the card's star (`e4e4118`: `theme.modals.accentColor`; spec §3.4 makes the bookmarked-message star the global yellow): `<Star aria-hidden="true" className="h-4 w-4 fill-current text-semantic-star drop-shadow-sm" />`.
  - the card's name: `<span lang="ja" className="min-w-0 flex-1 truncate text-body font-semibold text-primary">{memberName}</span>`; the text: `<p lang="ja" className="whitespace-pre-wrap text-body text-primary">{message.content}</p>`; the viewer caption: `<span lang="ja">{memberName}</span>`.
  - both media buttons: `focus-visible:ring-group` → `focus-visible:ring-accent`.

- [ ] **Step 6: Implement sent letters (pending decisions D2, D4)** — `SentLettersModal.tsx`: add `import { Mail } from 'lucide-react';`; on the `<Modal` add `icon={<Mail />}` (`e4e4118`: `icon={Mail}`). The card (D4 (a); `e4e4118`: hover border `accentColorMuted`, name text `accentColor`, `hover:shadow-md`):

```tsx
                        className="group flex flex-col gap-2 rounded-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <Card className="aspect-[3/4] overflow-hidden ring-1 ring-transparent transition-shadow duration-fast ease-standard group-hover:ring-accent-border group-hover:shadow-accent-glow-hover">
                            {letter.image_url ? (
                                <img src={letter.image_url} alt="" draggable={false} className="h-full w-full object-cover" />
                            ) : letter.text ? (
                                <p lang="ja" className="line-clamp-6 whitespace-pre-wrap p-3 text-small text-secondary">{letter.text}</p>
                            ) : (
                                <p className="line-clamp-6 whitespace-pre-wrap p-3 text-small text-secondary">{t('sentLetters.noContent')}</p>
                            )}
                        </Card>
                        <time dateTime={letter.created_at} className="text-caption text-secondary transition-colors duration-fast ease-standard group-hover:text-accent-strong">
                            {dateFormat.format(date)}
                        </time>
```

(`ring-transparent` is Tailwind's `transparent` keyword, which `dialogs.style.test.ts`'s `PALETTE` pattern does not match: it only catches `white`, `black` and numbered palette steps.)

- [ ] **Step 7: Blog photo gallery icon (pending decision D2)** — `BlogPhotoGalleryModal.tsx`: add `icon={<Image />}` to both `<Modal`s (`e4e4118`: `icon={Image}` on both `BaseModal`s).

- [ ] **Step 8: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/core src/features/blogs && npx tsc --noEmit && npm run lint`
Expected: PASS (the existing Calendar / Background / SentLetters / blog dialog tests included). Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/modals/BackgroundModal.tsx` (2), `CalendarModal.tsx` (3), `FavoritesModal.tsx` (3), `SentLettersModal.tsx` (1) removed; nothing else changes.

- [ ] **Step 9: Commit**

```bash
git add frontend
uv run git commit -m "feat(dialogs): restore chat dialog accents and the yellow star" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Media gallery: tabs, voice rows, header icon, viewer controls (pending decision D2)

**Files:**
- Modify: `frontend/src/core/media/MediaGalleryModal.tsx`
- Create: `frontend/src/core/media/MediaGalleryModal.rC.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `Modal icon` (Task 1).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test** — `frontend/src/core/media/MediaGalleryModal.rC.test.tsx`

```tsx
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

const voice = { id: 7, content: null, timestamp: '2026-11-03T04:00:00Z', type: 'voice', is_favorite: false, media_file: 'messages/a/voice/7.m4a', media_duration: 12 } as unknown as Message;

describe('MediaGalleryModal (R-c)', () => {
    it('has the image icon and an accent tab selection (e4e4118: accent text, accent-border bar)', () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        expect(screen.getByTestId('modal-header-icon')).toBeInTheDocument();
        const photos = screen.getByRole('tab', { name: 'Photos' });
        expect(photos).toHaveClass('text-accent-strong', 'focus-visible:ring-accent');
        expect(photos.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-border');
    });

    it('selects a voice row with the accent roles and marks the name ja', async () => {
        render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[voice]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
        await userEvent.click(screen.getByRole('tab', { name: 'Voice messages' }));
        const row = screen.getByRole('button', { pressed: false, name: /春野 ひなた/ });
        await userEvent.click(row);
        expect(row).toHaveAttribute('aria-pressed', 'true');
        expect(row).toHaveClass('bg-accent-subtle', 'focus-visible:ring-accent');
        const name = within(row).getByText('春野 ひなた');
        expect(name).toHaveAttribute('lang', 'ja');
        expect(name).toHaveClass('text-accent-strong');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npx vitest run src/core/media/MediaGalleryModal.rC.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement (pending decision D2)** — `MediaGalleryModal.tsx`:
  - remove `import { groupRoles } from '../../design/tokens';`, `import { serviceGroupId } from '../../config/serviceGroup';`, the `activeService` line, its `// Get per-service theme colors` comment and the `voiceAccent` line; delete `accentColor={voiceAccent}` from the bottom `VoicePlayer` (the default is the context accent).
  - on the main `<Modal` add `icon={<ImageIcon />}` (`e4e4118`: `icon={Image}`).
  - the voice row (`e4e4118`: selected background `accentColorLight`, name and duration `accentColor`):

```tsx
            className={cn(
                'flex w-full items-center gap-3 rounded-card px-4 py-4 text-left transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                isSelected ? 'bg-accent-subtle' : 'hover:bg-sunken',
            )}
        >
            <Avatar src={memberAvatar} name={memberName} size="md" className="h-12 w-12" decorative />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span lang="ja" className={cn('text-small font-semibold', isSelected ? 'text-accent-strong' : 'text-primary')}>{memberName}</span>
                {previewText ? (
                    <span lang="ja" className="truncate text-caption text-muted">{previewText}</span>
                ) : isSelected ? (
                    <span className="text-caption italic text-muted">{t('transcription.noTranscript')}</span>
                ) : null}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-small">
                <span className="text-muted">{formatDateTime(item.timestamp)}</span>
                <span className={cn('tabular-nums', isSelected ? 'text-accent-strong' : 'text-muted')}>{formatDuration(item.media_duration)}</span>
            </span>
```

  - the tabs (`e4e4118`: selected text `theme.modals.accentColor`, bar `theme.modals.accentColorMuted`):

```tsx
                        className={cn(
                            'relative flex flex-1 items-center justify-center py-3 transition-colors duration-fast ease-standard',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                            selected ? 'text-accent-strong' : 'text-muted hover:text-secondary',
                        )}
                    >
                        <tab.icon className="h-6 w-6" />
                        {selected && <span aria-hidden="true" className="absolute bottom-0 left-4 right-4 h-1 rounded-pill bg-accent-border" />}
```

  - the viewer: the source-jump button `focus-visible:ring-group` → `focus-visible:ring-accent`; the caption `<span>{memberName}</span>` → `<span lang="ja">{memberName}</span>`. The close button is already `IconButton variant="overlay"` (circle by default): check with `grep -n 'variant="overlay"' src/core/media/MediaGalleryModal.tsx src/core/media/PhotoDetailModal.tsx`, which must list the close button of both viewers and no `shape="rounded"`.

- [ ] **Step 4: Run to verify it passes, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/core/media src/core/dialogs.style.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/media/MediaGalleryModal.tsx` (8) removed; nothing else changes. Then `grep -rn "group-subtle\|group-strong\|group-accent\|ring-group\b\|accent-group\|group-glow" src/core/modals src/core/media src/core/layout/AddServiceModal.tsx src/features/search src/shell/components --include=*.tsx | grep -v test` must print only lines from R-d files (`SyncModal.tsx`, `SetupWizard.tsx`, `TosDialog.tsx`) or nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend
uv run git commit -m "feat(media): restore gallery accents and mark names ja" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Zero-drift docs and changelog

**Files:**
- Modify: `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-05-design-language-v2-design.md` (§12 only, if D1 (a) is accepted)

- [ ] **Step 1: Update `docs/design/DESIGN_SYSTEM.md`** — make each statement match the code (find each anchor with `grep -n`):
  - §3 Status paragraph ("Status: the frame and chat screens ..."): replace the last two sentences with "... and the blog screens (feed, reader, rail, member select, member timeline) and the dialogs (settings, search, about, diagnostics, report issue, add service, confirm, login, and the chat dialogs: calendar, favourites, media gallery, background, sent letters) apply this table. The entry screens (ToS, landing, setup, sync) follow in the last part of the re-apply."
  - §3 "Group scope" bullet: append "**Group markers in a brand dialog** use `useGroupMarker(serviceId, target)` (`design/useGroupMarker.ts`): it returns `groupScopeStyle` for that service's group, so the `*-accent-*` utilities inside follow it (the add-service cards, the per-group rows in Settings' Sync tab with a chip naming the group). An unknown service leaves the piece in brand and logs `group_marker_fallback` (`target`: `add_service` or `settings_row`; `reason`: `unknown_service`)."
  - Dialogs table, `header` row: "`expressive` (default: the context's gradient header and bar, L1; `ConfirmDialog` uses it too, with a semantic icon tile) or `plain` (a quiet title; no dialog uses it today)".
  - Dialogs table: add a row "| `icon` | A decorative lucide icon before the title (standard layout), drawn at 20 px in the header text colour: Calendar, Favorites (star), Sent letters (mail), Background (palette), Media gallery and Blog photo gallery (image), Report issue (bug) |".
  - Under the Dialogs table, add a bullet: "- **Header title:** `text-title font-bold` in the header text colour (white on a title gradient, the official title colour on Sakurazaka's white header, dark on the brand aurora), as the pre-D2 dialog header."
  - The "Content" bullet of Dialogs: replace "confirms are `ConfirmDialog` (focus starts on Cancel)" with "confirms are `ConfirmDialog` (expressive header of its opener's context, the warning / danger / info meaning in a semantic icon tile, a `secondary` Cancel where focus starts, then `primary` or `danger`)".
  - §8 Japanese content rule, the "Marked so far" sentence: append "Dialogs mark member names and message text in favourites, the media gallery and the viewers, letter text, search results (member, room, blog title, snippet) and filter chips, and group names shown as data (add service, the settings marker chip)."
  - §4 "Semantic over context", the star bullet: append "Favourites shows the same yellow star on each bookmarked message."
  - §12 (only if D1 (a) is accepted): add "- **Dialog header titles** keep the header text colour: white on the title gradients (about 1.7:1 at Hinatazaka's light end) and the official `#d892aa` on Sakurazaka's white header (2.4:1), as the pre-D2 dialogs and the chat header beside them (user decision D1, R-c)." Add the same bullet to the spec's §12.
  - §14 Migration note, first paragraph: "R-a (frame and chat), R-b (blogs) and R-c (dialogs) are done; the list below applies to the entry screens (ToS, landing, setup, sync, boot) and the brand moments (empty states, celebrations, the About hero)."

- [ ] **Step 2: Changelog** — in `CHANGELOG.md` under `## [Unreleased]` → `### Changed` (create the heading after `### Added` if it does not exist), add:

```markdown
- **Dialogs have their colours back.** Settings, search, About and the other
  app windows use SakaDesk's own soft colours, whichever group is open, while
  the calendar, favourites, media and background windows of a chat use that
  group's colours again. Bookmarked messages show the yellow star, and the
  sync repair rows in Settings say which group they act on.
```

- [ ] **Step 3: Check the docs against the code**

Run: `grep -n "ConfirmDialog. uses it)\|no dialog uses it today" docs/design/DESIGN_SYSTEM.md`
Expected: only the new "no dialog uses it today" line. Then `grep -rn 'header="plain"' frontend/src --include=*.tsx | grep -v test` prints nothing, and `grep -n "useGroupMarker\|group_marker_fallback" docs/design/DESIGN_SYSTEM.md` shows the new text.

- [ ] **Step 4: Commit**

```bash
git add docs CHANGELOG.md
uv run git commit -m "docs(design): record the dialogs re-apply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification and the before/after page

**Files:**
- Create (git-ignored): `frontend/e2e-shots/r-c/section.mjs`
- Modify (outside the repo): `/mnt/c/D/saka-verify/shots/index.html`, `/mnt/c/D/saka-verify/shots/r-c/after/`

- [ ] **Step 1: Full checks**

Run (from `frontend/`): `npm run test:run && npx tsc --noEmit && npm run lint`, then from the repo root `uv run pytest backend/tests -q`
Expected: all pass (the known headless keyring failure lives in pysaka, not here). Record the counts for the PR. `git diff fd00fae -- frontend/src/design/guard-baseline.json` must show only removals.

- [ ] **Step 2: e2e locks**

Run (from `frontend/`, port 8000 free): `npm run build && npx playwright test e2e/dialogs-app.spec.ts e2e/dialogs-chat.spec.ts e2e/chat-frame.spec.ts --reporter=line`
Expected: all pass (dialog keyboard model, nested Escape, focus return, search keys).

- [ ] **Step 3: Capture "after"**

Run: `SHOT_LABEL=after npx playwright test e2e/r-c-screens.spec.ts --reporter=line && mkdir -p /mnt/c/D/saka-verify/shots/r-c && cp -r e2e-shots/r-c/after /mnt/c/D/saka-verify/shots/r-c/`
Expected: `6 passed`; the same file names as `dev`.

- [ ] **Step 4: Write the page generator** — `frontend/e2e-shots/r-c/section.mjs`

```js
// Adds (or replaces) the R-c section of the Windows comparison page: base (e4e4118) / dev / after.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = '/mnt/c/D/saka-verify/shots'
const cols = [['base', 'e4e4118（D2 前）'], ['dev', 'dev（R-c 前）'], ['after', 'R-c 後']]
const names = readdirSync(`${root}/r-c/after`).filter((f) => f.endsWith('.png')).sort()
const fig = ([label, caption], file) => existsSync(`${root}/r-c/${label}/${file}`)
  ? `<figure><figcaption>${caption}</figcaption><a href="r-c/${label}/${file}" target="_blank"><img loading="lazy" src="r-c/${label}/${file}"></a></figure>`
  : `<figure><figcaption>${caption}</figcaption><div class="none">—</div></figure>`
const rows = names.map((f) => `<div class="row"><h3>${f.replace('.png', '')}</h3><div class="pair trio">${cols.map((c) => fig(c, f)).join('')}</div></div>`).join('')
const section = `<section id="r-c"><h2>R-c 對話框（v2 重新套用）</h2><style>.trio{grid-template-columns:1fr 1fr 1fr}</style>${rows}</section>`

let html = readFileSync(`${root}/index.html`, 'utf-8')
html = html.replace(/<section id="r-c">[\s\S]*?<\/section>/, '').replace(/<a href="#r-c">[^<]*<\/a>/, '')
html = html.replace('</nav>', `<a href="#r-c">R-c 對話框（${names.length}）</a></nav>`)
html = html.replace('</main>', `${section}</main>`)
writeFileSync(`${root}/index.html`, html)
console.log(`r-c: ${names.length} rows`)
```

- [ ] **Step 5: Build the section**

Run: `node e2e-shots/r-c/section.mjs`
Expected: `r-c: <n> rows` with `n` = the number of PNGs in `after/`. Optionally show it on Windows (no WSLg): `powershell.exe -NoProfile -Command "Start-Process 'C:\D\saka-verify\shots\index.html'"`.

- [ ] **Step 6: Review the shots** — for every row compare `after` with `base` and note in the PR body any place where `after` is still neutral where `base` had colour, or differs from decisions D1–D7. Check specifically: bold titles on every header (white on gradients, official pink on Sakurazaka, dark on aurora); header icons; Settings / search / about / report / diagnostics / add service identical between Hinatazaka and Sakurazaka (brand); add-service cards and the Settings sync chips in their own group colour; calendar dots and today ring; background selection ring, dashed upload; favourites yellow stars; sent-letter hover (if captured); media tab bar and selected voice row; confirm header with the warning tile. Fix in a follow-up task before asking for review; do not commit the shots.

- [ ] **Step 7: Keep the base worktree** — R-d will reuse `../SakaDesk-e4e4118`. Leave it; `git worktree list` shows it next to the main tree.

---

## Self-review notes

- Spec coverage: §4 BRAND dialogs → `scope="brand"` in Tasks 2 (about, diagnostics, report), 3 (add service, search), 4 (settings); group markers → Task 3 (add service cards via `useGroupMarker`), Task 4 (settings rows, D5), search dots kept; GROUP dialogs inherit → Tasks 5–6 (no scope prop), login keeps its `groupScopeStyle` (Task 4); confirm inherits → Task 2 test with `BrandScope`. §5 restore inventory "Modal accents" for Calendar, Favorites, MediaGallery, Background, SentLetters → Tasks 5–6 with the quoted `e4e4118` values; "Dialog gradient header" → foundation + the bold title / icons (Task 1, D1 / D2) + confirm (D3). §3.4 semantic over context → favourites star (Task 5), re-sync warning (D6), confirm tiles (D3), About heart untouched. §8 selected states → settings nav, search row and filter toggle, report categories, media tabs and voice rows. §7 radius / user rule → close buttons `rounded-md` (Task 1 test), viewer close `rounded-full` (Task 5 test, Task 6 grep). §6 `lang="ja"` → Tasks 3, 4, 5, 6 tests. Brief items: `ring-group` ×3 in MediaGallery and every superseded utility → Tasks 2–6 guard steps (12 baseline entries removed); breadcrumbs → Task 1 (`group_marker_fallback`, frontend + backend + pytest); i18n → none added, stated; docs → Task 7; verification + after shots → Task 8; base/dev shots → Task 0.
- Out of scope, untouched: `SyncModal`, `SyncProgressPanel`, `InlineSyncView`, `SetupWizard`, `TosDialog`, `LandingPage`, boot (R-d entry flows); `EmptyState` wiring, celebrations, the About hero / stats (R-d, D7); menus, profile card, call popup (R-a); blog dialogs other than the gallery's header icon (R-b); `UpgradeIcon` (already in the rail's `BrandScope`); Report issue's disabled submit (a behaviour change, not a re-apply).
- Names used across tasks: `ModalProps.icon` + `data-testid="modal-header-icon"` (1 → 2, 5, 6); `useGroupMarker(serviceId, 'add_service' | 'settings_row')` (1 → 3, 4); `clientLog('group_marker_fallback', { target, reason: 'unknown_service' })` (1); `data-testid="settings-group-rows"` / `"settings-group-chip"` (4).
- Checked while planning: `ServiceDefinition` is exported from `data/services.ts`; `formatName` only replaces `_`, so `山下 瞳月` renders unchanged; `common.mediaViewer` is "Media viewer"; `background.uploadImage` is "Upload Image"; every guard count removed above is made of superseded `*-group-*` utilities only.
- Soft spots to confirm while executing: the exact DOM wrapper of a search row (Task 3 test note); `e4e4118` locators in the base worktree (Task 0 step 4).
