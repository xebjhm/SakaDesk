# Design language v2 re-apply, part R-a (frame + chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the app frame and every chat screen on the v2 design language: brand context on the group rail's actions, group context everywhere else, `*-accent-*` utilities instead of the superseded `*-group-*` roles, the pre-D2 (`e4e4118`) colour and L1 expression restored through tokens, Japanese content marked `lang="ja"`, circular floating icon buttons, and before/after evidence against `e4e4118`.

**Architecture:** No new mechanism: the foundation (`docs/design/DESIGN_SYSTEM.md`) already provides accent roles, `BrandScope`, `groupScopeStyle` and the primitives. R-a adds a few tokens the chat needs (chat-header pill overlays, official shelter colours as CSS variables, a `ring-accent-border` utility, a `withAlpha()` helper for the pre-token media players), two primitive options (`IconButton` `shape` + `soft` variant, `MenuItem` `disabledReason`), then switches each frame/chat component over, one component family per task. Every task is guarded by unit tests, the guard ratchet (`guard-baseline.json` only goes down) and the style ratchet (`core/dialogs.style.test.ts`).

**Tech Stack:** React 18 + TypeScript, Tailwind 3 (utilities read `var(--ds-*)`), Vitest + Testing Library + msw, Playwright (headless, e2e and screenshots), FastAPI backend (`backend/api/client_log.py`, pytest).

Spec (governs): `docs/superpowers/specs/2026-11-05-design-language-v2-design.md` — read §4 (contexts), §5 (tiers + restore inventory), §7 (radius), §8 (states), §12 (accepted deviations: never "fix" them) before any task. Current system: `docs/design/DESIGN_SYSTEM.md`. Frame/chat structure: `docs/superpowers/specs/2026-11-04-d2a-chat-frame-design.md`.

---

## Decisions needed from the user

The user's rule: any change to the original design (`e4e4118` / `0725cc3`) that the spec has not already decided is asked first. These came up while mapping R-a. The tasks assume the **recommendation**; steps that depend on one are marked `(pending decision D<n>)`. If the user picks another option, only those steps change.

**D1 — Group rail actions (add service, search, settings): colour and shape.** `core/layout/ServiceRail.tsx`, `core/common/SettingsMenu.tsx`.
- `e4e4118`: grey circles (`bg-gray-200`, grey icon); hover fills **green** (add), **blue** (search) or darker grey (settings) with a white icon.
- Now (D2a): white rounded squares (12 px) with a grey border, neutral hover.
- The spec settles search and settings: brand ink (§4). It says nothing about add service, and green/blue are neither a logo nor a brand colour.
- Options: (a) all three: soft ink circles (`bg-accent-subtle` + ink icon, hover fills ink 600 with a white icon) inside `BrandScope`, i.e. the original fill-on-hover behaviour in ink; (b) as (a) but add service keeps a green hover through `semantic-success`; (c) keep the D2a neutral squares.
- **Recommendation: (a).** Same behaviour and shape as the original, one brand colour for the frame, and the circles match the round logos above them.

**D2 — Feature rail selected entry.** `design/primitives/RailItem.tsx`, `core/layout/FeatureRail.tsx`.
- `e4e4118`: selected icon on a 20 % logo-colour tint, icon in the logo colour, a 2 px logo-colour bar on the left.
- Now (D2a): a white card on the canvas, neutral text ("no group colour").
- Options: (a) keep the D2a white card and restore the colour on it: icon `text-accent`, label `text-accent-strong`, a 4 px `bg-accent` bar on the left; (b) go back to the original tint (`bg-accent-subtle`) with no card; (c) keep D2a as is.
- **Recommendation: (a).** Keeps D2a's structure (card on canvas), restores the original colour cues (coloured icon + bar). The icon uses step 600 rather than the logo colour because the Hinatazaka logo (`#7cc7e8`) on white is 1.9:1.

**D3 — Member list: selected avatar.** `design/primitives/Avatar.tsx` (only `MemberList` passes `selected`), `features/messages/components/MemberList.tsx`.
- `e4e4118`: a 2 px ring in the accent colour (step 600) with a 2 px white gap; no glow.
- Now (D2a + foundation): a white ring plus the group halo (`shadow-accent-halo`); no coloured ring.
- Options: (a) accent ring + white gap **and** the halo (the same treatment the selected group logo has on the rail); (b) the original ring only; (c) keep the halo only.
- **Recommendation: (a).** Restores the original coloured ring and keeps the spec's L1 selection glow.

**D4 — Chat bubble avatar hover.** `features/messages/components/MessageBubble.tsx`.
- `e4e4118`: `hover:ring-2 hover:ring-blue-300` (Tailwind blue, off-logo, off-brand).
- Now: `hover:shadow-card` (neutral lift).
- Options: (a) `hover:ring-2 hover:ring-accent-border` (same shape, the group's step 200 instead of blue); (b) the L1 hover glow `hover:shadow-accent-glow-hover`; (c) keep the neutral lift.
- **Recommendation: (a).**

**D5 — Profile card image pills.** `features/messages/components/ProfileImagePills.tsx`.
- `e4e4118`: hover `bg-sky-50 border-sky-200 text-sky-700`; the version count chip is `bg-sky-400` with white text (sky blue, off-logo).
- Now (D2c): neutral white pills, grey count.
- Options: (a) map sky to the accent roles: hover `bg-accent-subtle` + `text-accent-strong`, count chip `bg-accent` + `text-inverse`; (b) keep neutral.
- **Recommendation: (a).**

**D6 — Radii that grew when the 6-step scale landed.** The foundation (`bc35163`) redefined Tailwind's `sm/md/lg/xl` as 8/12/16/24 px. Un-migrated R-a files still carry pre-D1 class names, so they now render larger than at `e4e4118`:

| File | Class | `e4e4118` | now |
|---|---|---|---|
| `MessageBubble.tsx` (media box) | `rounded-lg` | 8 | 16 |
| `MessageBubble.tsx` (transcript footer) | `rounded-b-xl` | 12 | 24 |
| `TranscribeButton.tsx` | `rounded-md` | 6 | 12 |
| `TranscriptPanel.tsx` (backdrop) | `rounded-md` | 6 | 12 |
| `VideoPlayer.tsx` (toast) | `rounded-lg` | 8 | 16 |

- Options: (a) restore the original pixels where a step exists (8 → `rounded-sm`, 12 → `rounded-b-md`) and round the two 6 px corners to `rounded-sm` (8; there is no 6 px step); (b) round 6 px down to `rounded-xs` (4); (c) keep today's larger corners.
- **Recommendation: (a).** (Outside R-a, `core/common/ErrorBoundary.tsx` has the same drift; it belongs to R-d.)

**D7 — Where the unread glow goes.** `design/primitives/Badge.tsx`.
- The spec lists "badge and unread glow" (L1) and the token `shadow-accent-unread` (`0 0 12px logo@0.4`), but `e4e4118` never rendered it (the value existed in `useMessagesTheme` and was unused), so there is no original placement.
- Options: (a) on the unread `Badge` (member list and anywhere else a badge shows), replacing its neutral `shadow-pill`; (b) on the avatar of a member with unread messages; (c) nowhere yet.
- **Recommendation: (a).** Small, clearly tied to "unread", no change to avatars.

**D8 — Chat header pills on the title gradient: contrast.** `features/messages/components/ChatHeaderPill.tsx`.
- `e4e4118`: on a gradient header the unread pill is white glass (`rgba(255,255,255,.2)`) with white text and the sync pill a dark shade (`rgba(0,0,0,.2)`) with white text; on Sakurazaka's white header both are tinted with the title text colour (12.5 % / 8 %) and use that colour as text.
- Now (D2a): solid white pills with grey text; on the white header a grey sunken pill.
- Restoring the original brings back low contrast that §12 does not list: white 11 px text on the right end of the title gradient is about 3.4:1 (Hinatazaka `#9181c4`), 4.5:1 (Nogizaka), 6.0:1 (Yodel); Sakurazaka's `#d892aa` on its own tint is about 2.4:1. The header title itself already uses these colours (official layer).
- Options: (a) restore the original exactly through tokens; (b) restore the original on gradient headers but use `text-accent-strong` on Sakurazaka's white header; (c) keep the D2a neutral pills.
- **Recommendation: (a)**, recorded as an accepted deviation next to §12 once the user confirms (the pills use the same colours as the official title text beside them).

No other conflicts were found. Already settled by the spec and therefore **not** asked: brand-ink search/settings icons (§4); `UpgradeIcon` blue → info ink, green → success, red → danger (§3.4: "there is no separate blue"); the disabled "Sent letters" item keeps its colour at 40 % with a reason instead of the original grey (§8); menu items `rounded-sm` (§7); the unread arrows' gradient `accent` look (foundation, `DESIGN_SYSTEM.md` §9); the user's floating = circle / inline = 12 px icon-button rule.

---

## Global Constraints

- Work in `/home/xtorker/repos/Project-Saka/SakaDesk` on branch `feat/v2-reapply-a` (from `dev` at `9a8200f`). Frontend commands run from `frontend/`: one test file `npx vitest run <path>`, full suite `npm run test:run`, types `npx tsc --noEmit`, lint `npm run lint`. Backend tests from the repo root: `uv run pytest backend/tests/<file> -q`.
- Commit from the repo root with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Conventional Commits (`docs/DOC_FORMATS.md`): `type(scope): subject`, imperative, whole line ≤ 72 chars, no trailing period. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hex / `rgb()` literals only inside `src/design/tokens/`. No named palette classes (`bg-gray-100`, `text-white`, `bg-black/40`) in files a task touches; no arbitrary radius/shadow/text/spacing values; no `rounded-2xl` / `rounded-3xl` (banned from Task 3 on).
- Context table (spec §4): group rail frame = brand (search, settings and add-service icons in ink via `BrandScope`; logos keep their colours; the selected logo's `ring-group-logo` is the official layer and stays); feature rail, member list, chat, letters, profile card, member/message/conversation menus, call popup and incoming call = group context; photo/video viewers = no context (controls only).
- Expression: L0 for message text and lists; L1 (hover glow, selection glow, unread glow, menu/modal accents, gradient buttons) on interactive elements. Large surfaces stay white (no tint on sheet, card, bubble, chat background).
- Spec §12 deviations stay as they are: primary gradient `logo → 600` contrast, Hinatazaka 600 `#389DD1` badge/action colour, Sakurazaka's white `light` header.
- Radius steps: xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full 9999. Floating icon buttons (viewer overlay controls, chat unread arrows) are circles; inline icon buttons (dialog close, header menu trigger) keep `rounded-md` (12 px).
- Japanese content is marked `lang="ja"`: message text, member names, letter text, profile-card names, voice transcript segments, call-screen names. UI chrome is never marked.
- Every new utility is registered in `frontend/src/utils/classnames.ts`. A file whose guard count drops gets its `guard-baseline.json` entry lowered (or removed at 0) **in the same commit**: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts`, then check `git diff src/design/guard-baseline.json` shows only decreases/removals.
- Logging: every new decision/failure path logs `clientLog(event, fields)`; field values match `^[a-z0-9_]{1,40}$`, never names or text. A new event is added to both `frontend/src/utils/clientLog.ts` (`ClientLogEvent`) and `backend/api/client_log.py` (`ClientEvent`), with a pytest case.
- i18n: no hard-coded user-facing strings; new keys go into all five locales `frontend/src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json`.
- Screenshots and e2e run headless (Playwright CLI). Never open a WSLg window; to show a page on Windows use `powershell.exe -NoProfile -Command "Start-Process '<windows path>'"`.
- Docs and code comments in English.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `frontend/e2e/r-a-screens.spec.ts` (new) | capture-only shots of every R-a screen, 4 groups | 0 |
| `backend/api/client_log.py`, `backend/tests/test_client_log_api.py` | `design_fonts_fallback` → warning; `menu_item_blocked` event | 1, 4 |
| `frontend/src/design/primitives/Celebration.tsx` | comment fix | 1 |
| `frontend/src/design/primitives/Button.tsx` | `IconButton` `shape` + `soft` variant | 2 |
| `frontend/src/design/guard.ts`, `guard.test.ts` | ban `rounded-2xl` / `rounded-3xl` | 3 |
| `frontend/src/design/primitives/Menu.tsx` | `MenuItem` `rounded-sm`, `disabledReason`, no grey-out | 4 |
| `frontend/src/design/tokens/color.ts`, `design/cssVars.ts`, `tailwind.config.js`, `utils/classnames.ts`, `design/colorMix.ts` (new) | header pill overlays, shelter vars, `ring-accent-border`, `withAlpha()` | 5 |
| `core/layout/ServiceRail.tsx`, `core/common/SettingsMenu.tsx`, `core/layout/UpgradeIcon.tsx` | group rail | 6 |
| `design/primitives/RailItem.tsx`, `core/layout/FeatureRail.tsx` | feature rail | 7 |
| `design/primitives/Avatar.tsx`, `design/primitives/Badge.tsx`, `features/messages/components/MemberList.tsx` | member list | 8 |
| `features/messages/components/ChatHeaderPill.tsx`, `features/messages/MessagesFeature.tsx`, `features/messages/components/ConversationMenu.tsx`, `design/primitives/DatePill.tsx` | chat header, ⋯ menu, date pills, floating arrows | 9 |
| `features/messages/components/MessageBubble.tsx`, `MessageList.tsx`, `MessageContextMenu.tsx`, `LetterRow.tsx`, `hooks/useMessagesTheme.ts` (deleted) | bubbles, shelters, letters, message menu | 10 |
| `core/media/VoicePlayer.tsx`, `TranscriptPanel.tsx`, `TranscribeButton.tsx`, `core/common/TranslateButton.tsx`, `core/media/PhotoPlayer.tsx`, `LazyVideo.tsx`, `PhotoDetailModal.tsx`, `VideoPlayer.tsx` | player accents and focus rings | 11 |
| `features/messages/components/MemberProfilePopup.tsx`, `ProfileImagePills.tsx`, `ProfileImageViewer.tsx` | profile card | 12 |
| `features/callPopup/PopupCall.tsx`, `features/incomingCall/CallOverlay.tsx`, `CallScreen.tsx` | call accents, member group scope | 13 |
| `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md` | zero-drift docs | 14 |
| `/mnt/c/D/saka-verify/shots/r-a/`, `index.html` | before/after page | 15 |

`frontend/src/core/dialogs.style.test.ts` (`FILES`) grows in Tasks 6–13: each task appends the files it makes clean, first (failing), then fixes them.

---

### Task 0: Capture spec and the "base" and "dev" shots

**Files:**
- Create: `frontend/e2e/r-a-screens.spec.ts`

**Interfaces:**
- Consumes: `buildBigRoom`, `pinBigRoom`, `roomDir`, `COUNT`, `TZ`, `FixtureMessage` from `frontend/e2e/fixtures/bigRoom.ts`.
- Produces: `frontend/e2e-shots/r-a/{base,dev}/*.png` (git-ignored), copied to `/mnt/c/D/saka-verify/shots/r-a/{base,dev}/`. Task 15 adds `after`.

- [ ] **Step 1: Write the capture spec** — `frontend/e2e/r-a-screens.spec.ts`

```ts
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
```

- [ ] **Step 2: Check it skips without a label**

Run (from `frontend/`): `npx playwright test e2e/r-a-screens.spec.ts --reporter=line`
Expected: `12 skipped`.

- [ ] **Step 3: Make sure nothing else serves port 8000**

Run: `curl -sf http://localhost:8000/api/auth/status >/dev/null && echo RUNNING || echo free`
Expected: `free`. If `RUNNING`, stop that server first (Playwright's `reuseExistingServer` would otherwise shoot the wrong build).

- [ ] **Step 4: Capture "base" on `e4e4118` in a worktree**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git worktree add ../SakaDesk-e4e4118 e4e4118
cd ../SakaDesk-e4e4118 && uv sync
cp ../SakaDesk/frontend/e2e/fixtures/bigRoom.ts frontend/e2e/fixtures/bigRoom.ts
cp ../SakaDesk/frontend/e2e/r-a-screens.spec.ts frontend/e2e/r-a-screens.spec.ts
cd frontend && npm ci && npm run build
SHOT_LABEL=base npx playwright test e2e/r-a-screens.spec.ts --reporter=line
```

Expected: `12 passed`; `e2e-shots/r-a/base/` holds 32 PNGs (8 per group). The worktree path keeps `../pysaka` resolving to the sibling SDK checkout, so `uv sync` works. If a call-popup test times out before `.sd-call-ring`, list the API calls the page made without opening any window:

```bash
SHOT_LABEL=base npx playwright test e2e/r-a-screens.spec.ts -g "call popup" --trace on --reporter=line
for z in test-results/*call-popup*/trace.zip; do unzip -p "$z" trace.network | grep -o '"url":"[^"]*/api/[^"?]*' | sort -u; done
```

add a route for any `/api/` call the spec does not answer, in **both** trees' copy of the spec, and re-run. Do not drop the shot.

- [ ] **Step 5: Capture "dev" on this branch before any change**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npm run build
SHOT_LABEL=dev npx playwright test e2e/r-a-screens.spec.ts --reporter=line
```

Expected: `12 passed`; `e2e-shots/r-a/dev/` holds 32 PNGs.

- [ ] **Step 6: Copy both sets to the Windows comparison folder**

```bash
mkdir -p /mnt/c/D/saka-verify/shots/r-a
cp -r /home/xtorker/repos/Project-Saka/SakaDesk-e4e4118/frontend/e2e-shots/r-a/base /mnt/c/D/saka-verify/shots/r-a/
cp -r /home/xtorker/repos/Project-Saka/SakaDesk/frontend/e2e-shots/r-a/dev /mnt/c/D/saka-verify/shots/r-a/
ls /mnt/c/D/saka-verify/shots/r-a/base | wc -l; ls /mnt/c/D/saka-verify/shots/r-a/dev | wc -l
```

Expected: `32` and `32`. Keep the worktree until Task 15.

- [ ] **Step 7: Commit the spec**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
git add frontend/e2e/r-a-screens.spec.ts
uv run git commit -m "test(e2e): capture the frame and chat screens for R-a" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Foundation leftovers (font fallback warning, toast comment)

**Files:**
- Modify: `backend/api/client_log.py:87`, `backend/tests/test_client_log_api.py:276`, `frontend/src/design/primitives/Celebration.tsx:17`

**Interfaces:** none.

- [ ] **Step 1: Make the test expect a warning** — in `backend/tests/test_client_log_api.py` replace

```python
        ("design_fonts_fallback", {"target": "zh_tw"}, "info"),
```

with

```python
        ("design_fonts_fallback", {"target": "zh_tw"}, "warning"),
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv run pytest backend/tests/test_client_log_api.py -q -k design_system_events`
Expected: 1 failed (`assert 'info' == 'warning'`).

- [ ] **Step 3: Log the font fallback as a warning** — in `backend/api/client_log.py` replace

```python
WARNING_EVENTS = frozenset({"call_error", "app_load_failed", "design_tokens_fallback"})
```

with

```python
WARNING_EVENTS = frozenset(
    {"call_error", "app_load_failed", "design_tokens_fallback", "design_fonts_fallback"}
)
```

- [ ] **Step 4: Fix the toast comment** — in `frontend/src/design/primitives/Celebration.tsx` replace

```tsx
/** Tier B celebration (spec §9): glass toast + one aurora shimmer + sparkles. Never blocks input. */
```

with

```tsx
/** Tier B celebration (spec §9): solid sheet toast + one aurora shimmer + sparkles. Never blocks input. */
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest backend/tests/test_client_log_api.py -q` then (from `frontend/`) `npx vitest run src/design/primitives/Moments.test.tsx`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/client_log.py backend/tests/test_client_log_api.py frontend/src/design/primitives/Celebration.tsx
uv run git commit -m "fix(log): treat a font fallback as a warning" -m "Also corrects the celebration toast comment (a solid sheet, not glass)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: IconButton shape and the soft variant

**Files:**
- Modify: `frontend/src/design/primitives/Button.tsx`, `frontend/src/design/primitives/index.ts` (type export), `frontend/src/design/DesignPage.tsx:209-217`
- Test: `frontend/src/design/primitives/Controls.test.tsx`

**Interfaces:**
- Produces: `type IconButtonShape = 'rounded' | 'circle'`; `IconButtonVariant` gains `'soft'`; `IconButtonProps.shape?: IconButtonShape` (default `circle` for `overlay` and `accent`, `rounded` otherwise); the rendered button carries `data-shape`.

- [ ] **Step 1: Write the failing tests** — append to `frontend/src/design/primitives/Controls.test.tsx`

```tsx
describe('IconButton shape (floating = circle, inline = 12 px)', () => {
    it.each(['overlay', 'accent'] as const)('%s is a circle by default (floating)', (variant) => {
        render(<IconButton variant={variant} aria-label="浮動" icon={<X />} />);
        const b = screen.getByRole('button', { name: '浮動' });
        expect(b).toHaveClass('rounded-full');
        expect(b).not.toHaveClass('rounded-md');
        expect(b).toHaveAttribute('data-shape', 'circle');
    });

    it.each(['ghost', 'secondary', 'soft'] as const)('%s keeps the button radius by default (inline)', (variant) => {
        render(<IconButton variant={variant} aria-label="閉じる" icon={<X />} />);
        const b = screen.getByRole('button', { name: '閉じる' });
        expect(b).toHaveClass('rounded-md');
        expect(b).not.toHaveClass('rounded-full');
        expect(b).toHaveAttribute('data-shape', 'rounded');
    });

    it('shape overrides the default both ways', () => {
        render(
            <>
                <IconButton variant="ghost" shape="circle" aria-label="丸" icon={<X />} />
                <IconButton variant="overlay" shape="rounded" aria-label="角" icon={<X />} />
            </>,
        );
        expect(screen.getByRole('button', { name: '丸' })).toHaveClass('rounded-full');
        expect(screen.getByRole('button', { name: '角' })).toHaveClass('rounded-md');
    });

    it('soft is the accent on a subtle tint and fills on hover', () => {
        render(<IconButton variant="soft" aria-label="検索" icon={<X />} />);
        expect(screen.getByRole('button', { name: '検索' })).toHaveClass(
            'bg-accent-subtle', 'text-accent', 'hover:bg-accent', 'hover:text-inverse',
        );
    });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/design/primitives/Controls.test.tsx`
Expected: FAIL (no `data-shape`, overlay is `rounded-md`, `soft` is not a variant — tsc error surfaces as a failed assertion on classes).

- [ ] **Step 3: Implement** — in `frontend/src/design/primitives/Button.tsx`

Replace the two type lines at the top

```tsx
export type ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger' | 'overlay';
export type IconButtonVariant = 'secondary' | 'ghost' | 'overlay' | 'accent';
```

with

```tsx
export type ButtonVariant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger' | 'overlay';
export type IconButtonVariant = 'secondary' | 'ghost' | 'overlay' | 'accent' | 'soft';
/** `circle` for floating buttons (over content or the viewer), `rounded` (12 px) for inline ones. */
export type IconButtonShape = 'rounded' | 'circle';
```

Replace the `ICON_VARIANT` block

```tsx
const ICON_VARIANT: Record<IconButtonVariant, string> = {
    secondary: VARIANT.secondary,
    ghost: 'bg-transparent text-secondary hover:bg-sunken hover:text-primary',
    overlay: VARIANT.overlay,
    /** Floating accent button (the chat's unread arrows). */
    accent: cn('bg-accent-gradient text-inverse', GLOW, LIFT),
};
```

with

```tsx
const ICON_VARIANT: Record<IconButtonVariant, string> = {
    secondary: VARIANT.secondary,
    ghost: 'bg-transparent text-secondary hover:bg-sunken hover:text-primary',
    overlay: VARIANT.overlay,
    /** Floating accent button (the chat's unread arrows). */
    accent: cn('bg-accent-gradient text-inverse', GLOW, LIFT),
    /** The accent on its subtle tint, filled on hover (the group rail's actions, in brand ink). */
    soft: 'bg-accent-subtle text-accent hover:bg-accent hover:text-inverse',
};

/** Floating variants default to a circle; the rest keep the button radius. */
const FLOATING: ReadonlySet<IconButtonVariant> = new Set<IconButtonVariant>(['overlay', 'accent']);
const SHAPE: Record<IconButtonShape, string> = { rounded: 'rounded-md', circle: 'rounded-full' };
```

Replace the `IconButtonProps` interface and `IconButton` component

```tsx
export interface IconButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
    /** Required: an icon-only button has no other accessible name. */
    'aria-label': string;
    icon: React.ReactNode;
    variant?: IconButtonVariant;
    size?: ButtonSize;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ icon, variant = 'ghost', size = 'md', type = 'button', className, ...rest }, ref) => (
        <button {...rest} ref={ref} type={type} className={cn(BASE, ICON_VARIANT[variant], ICON_SIZE[size], className)}>
            <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">{icon}</span>
        </button>
    ),
);
```

with

```tsx
export interface IconButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
    /** Required: an icon-only button has no other accessible name. */
    'aria-label': string;
    icon: React.ReactNode;
    variant?: IconButtonVariant;
    size?: ButtonSize;
    /** Defaults to `circle` for `overlay` / `accent` (floating) and `rounded` otherwise (inline). */
    shape?: IconButtonShape;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ icon, variant = 'ghost', size = 'md', shape, type = 'button', className, ...rest }, ref) => {
        const resolved: IconButtonShape = shape ?? (FLOATING.has(variant) ? 'circle' : 'rounded');
        return (
            <button
                {...rest}
                ref={ref}
                type={type}
                data-shape={resolved}
                className={cn(BASE, ICON_VARIANT[variant], ICON_SIZE[size], SHAPE[resolved], className)}
            >
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center">{icon}</span>
            </button>
        );
    },
);
```

In `frontend/src/design/primitives/index.ts`, line 8, change `type IconButtonVariant, type ButtonSize,` to `type IconButtonVariant, type IconButtonShape, type ButtonSize,`.

- [ ] **Step 4: Show it on the style page** — in `frontend/src/design/DesignPage.tsx` replace

```tsx
                        <IconButton aria-label={t('designPage.close')} icon={<X />} />
                        <IconButton aria-label={t('designPage.close')} icon={<Settings />} variant="secondary" size="sm" />
```

with

```tsx
                        <IconButton aria-label={t('designPage.close')} icon={<X />} />
                        <IconButton aria-label={t('designPage.close')} icon={<Settings />} variant="secondary" size="sm" />
                        <IconButton aria-label={t('designPage.accent')} icon={<Settings />} variant="soft" shape="circle" />
                        <IconButton aria-label={t('designPage.accent')} icon={<Settings />} variant="soft" />
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/design/primitives src/design/DesignPage.test.tsx && npx tsc --noEmit`
Expected: all pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design/primitives/Button.tsx frontend/src/design/primitives/index.ts frontend/src/design/primitives/Controls.test.tsx frontend/src/design/DesignPage.tsx
uv run git commit -m "feat(design): add icon button shapes and the soft variant" -m "Floating icon buttons (viewer controls, unread arrows) default to a circle; inline ones keep the 12 px button radius." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ban `rounded-2xl` / `rounded-3xl`; restore the drifted radii (pending decision D6)

Why ban instead of remapping in `tailwind.config.js`: the only uses are two in `VoicePlayer.tsx`, both 16 px = token `lg` today. Remapping `2xl` to `xl` (24 px) would silently enlarge them (a pixel change nobody asked for), and keeping Tailwind's `2xl` (16) next to token `xl` (24) is the confusing part. Migrating the uses to `rounded-lg` (same pixels) and letting the guard count any new `2xl`/`3xl` keeps the scale at six names with no pixel change.

**Files:**
- Modify: `frontend/src/design/guard.ts:14-19`, `frontend/src/design/guard.test.ts`, `frontend/src/core/media/VoicePlayer.tsx:424,674`, `frontend/src/features/messages/components/MessageBubble.tsx:115,467`, `frontend/src/core/media/TranscribeButton.tsx:47`, `frontend/src/core/media/TranscriptPanel.tsx:169`, `frontend/src/core/media/VideoPlayer.tsx:556`

**Interfaces:** none.

- [ ] **Step 1: Write the failing guard test** — in `frontend/src/design/guard.test.ts`, add rows to the first `it.each([...])('counts %s as %i', …)` table:

```ts
        ['className="rounded-2xl rounded-t-3xl hover:rounded-bl-2xl"', 3],
```

and to the `ignores %s` table:

```ts
        'className="rounded-xl rounded-lg rounded-b-md rounded-tl-xs rounded-full"',
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/design/guard.test.ts`
Expected: FAIL (`expected 0 to be 3`).

- [ ] **Step 3: Add the pattern** — in `frontend/src/design/guard.ts` replace

```ts
    /(?<![\w-])(?:bg-group-(?:accent|badge|subtle)|text-group-strong|border-group-subtle|ring-group(?![\w-])|accent-group|shadow-group-glow)(?![\w-])/g,
];
```

with

```ts
    /(?<![\w-])(?:bg-group-(?:accent|badge|subtle)|text-group-strong|border-group-subtle|ring-group(?![\w-])|accent-group|shadow-group-glow)(?![\w-])/g,
    // Tailwind's 2xl (16 px) and 3xl (24 px) sit outside the six radius steps (2xl reads larger than token xl).
    /(?<![\w-])rounded(?:-[trblxyse]{1,2})?-(?:2xl|3xl)(?![\w-])/g,
];
```

and add one line to the header comment's list: `Tailwind's rounded-2xl / rounded-3xl (outside the six radius steps),`.

- [ ] **Step 4: Migrate the two uses (same pixels)** — in `frontend/src/core/media/VoicePlayer.tsx`
  - line 424: `className="backdrop-blur-xl bg-white/90 rounded-2xl p-3 outline-none focus:ring-2 shadow-lg"` → `className="backdrop-blur-xl bg-white/90 rounded-lg p-3 outline-none focus:ring-2 shadow-lg"`
  - line 674: `className="bg-[#F3F4F6] rounded-2xl p-3 min-w-[300px] outline-none focus:ring-2"` → `className="bg-[#F3F4F6] rounded-lg p-3 min-w-[300px] outline-none focus:ring-2"` (the `bg-[#F3F4F6]` goes in Task 11)

- [ ] **Step 5: Restore the drifted radii (pending decision D6)**
  - `MessageBubble.tsx:115`: `"rounded-lg overflow-hidden mb-2 flex items-center justify-center",` → `"rounded-sm overflow-hidden mb-2 flex items-center justify-center",` (8 px, as at `e4e4118`)
  - `MessageBubble.tsx:467`: `className="rounded-b-xl border-t-0 border px-3 py-1.5 -mt-1"` → `className="rounded-b-md border-t-0 border px-3 py-1.5 -mt-1"` (12 px)
  - `TranscribeButton.tsx:47`: `"text-xs py-1 px-2 rounded-md border transition-colors flex items-center gap-1"` → `"text-xs py-1 px-2 rounded-sm border transition-colors flex items-center gap-1"` (6 → 8 px)
  - `TranscriptPanel.tsx:169`: `` ` rounded-md px-2 py-1.5 backdrop-blur-sm ${isLight ? 'bg-black/40' : 'bg-white/85'}` `` → `` ` rounded-sm px-2 py-1.5 backdrop-blur-sm ${isLight ? 'bg-black/40' : 'bg-white/85'}` `` (6 → 8 px)
  - `VideoPlayer.tsx:556`: `rounded-lg z-50">` → `rounded-sm z-50">` (8 px)

- [ ] **Step 6: Run the guard, the media and bubble tests**

Run: `npx vitest run src/design/guard.test.ts src/core/media src/features/messages/components/MessageBubble.test.tsx`
Expected: guard passes with no baseline change (no file has a `2xl`/`3xl` left). MessageBubble snapshots fail only on `rounded-lg` → `rounded-sm` / `rounded-b-xl` → `rounded-b-md`; update them with `npx vitest run src/features/messages/components/MessageBubble.test.tsx -u` and re-run to see them pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/guard.ts frontend/src/design/guard.test.ts frontend/src/core/media/VoicePlayer.tsx frontend/src/core/media/TranscribeButton.tsx frontend/src/core/media/TranscriptPanel.tsx frontend/src/core/media/VideoPlayer.tsx frontend/src/features/messages/components/MessageBubble.tsx frontend/src/features/messages/components/__snapshots__/MessageBubble.test.tsx.snap
uv run git commit -m "fix(design): ban 2xl radii and restore grown chat corners" -m "The six-step scale redefined lg and xl, so pre-D1 classes in the chat grew; they get their pre-D2 pixels back on the nearest step." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Menu items: small radius, colour-keeping disabled state with a reason

**Files:**
- Modify: `frontend/src/design/primitives/Menu.tsx:123-158`, `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py`
- Test: `frontend/src/design/primitives/Menu.test.tsx`

**Interfaces:**
- Produces: `MenuItemProps.disabledReason?: string`, `MenuItemProps.logTarget?: string`; breadcrumb `menu_item_blocked` `{ target }`.

- [ ] **Step 1: Write the failing frontend tests** — in `frontend/src/design/primitives/Menu.test.tsx` add after the imports:

```tsx
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
```

and append:

```tsx
describe('MenuItem v2', () => {
    it('is a small-radius row (spec §7: menu items sm)', () => {
        render(<Menu aria-label="m" onClose={vi.fn()}><MenuItem>一</MenuItem></Menu>);
        const item = screen.getByRole('menuitem', { name: '一' });
        expect(item).toHaveClass('rounded-sm');
        expect(item).not.toHaveClass('rounded-pill');
    });

    it('a disabled item keeps its colour at 40 % instead of greying out', () => {
        render(<Menu aria-label="m" onClose={vi.fn()}><MenuItem disabled>二</MenuItem></Menu>);
        const item = screen.getByRole('menuitem', { name: '二' });
        expect(item).toHaveClass('disabled:opacity-40');
        expect(item.className).not.toMatch(/disabled:text-muted/);
    });

    it('with a reason it stays focusable, explains itself and logs a blocked click', async () => {
        const onClick = vi.fn();
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem>一</MenuItem>
                <MenuItem disabledReason="グループには無い" logTarget="sent_letters" onClick={onClick}>二</MenuItem>
            </Menu>,
        );
        const item = screen.getByRole('menuitem', { name: '二' });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        expect(item).toHaveAttribute('title', 'グループには無い');
        expect(item).toHaveAccessibleDescription('グループには無い');
        expect(item).toHaveClass('aria-disabled:opacity-40', 'aria-disabled:cursor-not-allowed');
        await userEvent.keyboard('{End}');
        expect(item).toHaveFocus();
        await userEvent.click(item);
        expect(onClick).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('menu_item_blocked', { target: 'sent_letters' });
    });
});
```

(`userEvent` and `screen` are already imported in this file; if not, add `import userEvent from '@testing-library/user-event';` and `screen` to the Testing Library import.)

- [ ] **Step 2: Write the failing backend test** — in `backend/tests/test_client_log_api.py` add to the `test_design_system_events_are_accepted` parameter list:

```python
        ("menu_item_blocked", {"target": "sent_letters"}, "info"),
```

- [ ] **Step 3: Run both to see them fail**

Run: `npx vitest run src/design/primitives/Menu.test.tsx` and `uv run pytest backend/tests/test_client_log_api.py -q -k design_system_events`
Expected: frontend FAIL (no `rounded-sm`, no `aria-disabled`); backend FAIL (422 for the unknown event).

- [ ] **Step 4: Register the event** — in `frontend/src/utils/clientLog.ts` replace

```ts
    | 'blog_load' | 'dialog' | 'dialog_load' | 'call_layer' | 'sync_start_skipped';
```

with

```ts
    | 'blog_load' | 'dialog' | 'dialog_load' | 'call_layer' | 'sync_start_skipped'
    | 'menu_item_blocked';
```

and in `backend/api/client_log.py` add `"menu_item_blocked",` after `"sync_start_skipped",` in the event list.

- [ ] **Step 5: Implement MenuItem** — in `frontend/src/design/primitives/Menu.tsx` add `useId` to the React import and `import { clientLog } from '../../utils/clientLog';`, then replace the whole `MenuItemProps` interface and `MenuItem` component with:

```tsx
export interface MenuItemProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'role'> {
    icon?: React.ReactNode;
    /** Selected option (speed, loop): `text-accent-strong`, the selected-text role. */
    selected?: boolean;
    destructive?: boolean;
    /** One of a set of options: `menuitemradio` with `aria-checked`. */
    radio?: boolean;
    /**
     * Translated reason the item cannot be used now (spec §8: never grey out without a reason).
     * The item stays focusable (`aria-disabled`), shows the reason as tooltip and description,
     * keeps its colour at 40 %, and swallows clicks (logged as `menu_item_blocked`).
     */
    disabledReason?: string;
    /** `target` of the `menu_item_blocked` breadcrumb; `^[a-z0-9_]{1,40}$`. */
    logTarget?: string;
}

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(
    ({ icon, selected = false, destructive = false, radio = false, disabledReason, logTarget, className, children, onClick, title, type = 'button', ...rest }, ref) => {
        const reasonId = useId();
        const reason = disabledReason || undefined;
        return (
            <button
                {...rest}
                ref={ref}
                type={type}
                role={radio ? 'menuitemradio' : 'menuitem'}
                aria-checked={radio ? selected : undefined}
                aria-disabled={reason !== undefined ? true : undefined}
                aria-describedby={reason !== undefined ? reasonId : undefined}
                title={reason ?? title}
                tabIndex={-1}
                className={cn(
                    'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-small',
                    'transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none',
                    'disabled:pointer-events-none disabled:opacity-40',
                    'aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent',
                    destructive ? 'text-status-danger' : selected ? 'font-semibold text-accent-strong' : 'text-primary',
                    className,
                )}
                onClick={reason !== undefined
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        clientLog('menu_item_blocked', { target: logTarget ?? 'unknown' });
                    }
                    : onClick}
            >
                {icon && (
                    <span aria-hidden="true" className={cn('flex h-4 w-4 shrink-0 items-center justify-center', !destructive && !selected && 'text-secondary')}>
                        {icon}
                    </span>
                )}
                {children}
                {reason !== undefined && <span id={reasonId} aria-hidden="true" className="sr-only">{reason}</span>}
            </button>
        );
    },
);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/design/primitives src/core src/features` and `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: all pass. (`MenuItem` was a `rounded-pill` before; if any other test asserts `rounded-pill` on a menu item, change that assertion to `rounded-sm`.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/primitives/Menu.tsx frontend/src/design/primitives/Menu.test.tsx frontend/src/utils/clientLog.ts backend/api/client_log.py backend/tests/test_client_log_api.py
uv run git commit -m "feat(design): give menu items a reasoned disabled state" -m "Menu items use the sm radius (spec §7), keep their colour when disabled (§8) and can explain why; blocked clicks log menu_item_blocked." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Tokens the chat needs

**Files:**
- Create: `frontend/src/design/colorMix.ts`, `frontend/src/design/rATokens.test.ts`
- Modify: `frontend/src/design/tokens/color.ts` (overlay), `frontend/src/design/cssVars.ts` (`groupTokenVars`), `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts`, `frontend/src/design/applyTokens.test.ts:25,40`

**Interfaces:**
- Produces: CSS vars `--ds-overlay-glass`, `--ds-overlay-shade`, `--ds-group-shelter-{picture,video,voice,text}`; utilities `bg-header-glass`, `bg-header-shade`, `bg-group-title-tint` (12.5 %), `bg-group-title-wash` (8 %), `bg-/border-/text-group-shelter-{picture,video,voice,text}`, `ring-accent-border`; `withAlpha(colour: string, percent: number): string`, `ACCENT = 'var(--ds-accent)'`, `ACCENT_LOGO = 'var(--ds-accent-logo)'`.

- [ ] **Step 1: Write the failing test** — `frontend/src/design/rATokens.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars, groupTokenVars } from './cssVars';
import { groupTokens } from './tokens';
import { cn } from '../utils/classnames';
import { ACCENT, ACCENT_LOGO, withAlpha } from './colorMix';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('R-a tokens', () => {
    it('writes the chat-header pill overlays (the pre-D2 white glass and dark shade)', () => {
        const v = staticTokenVars();
        expect(v['--ds-overlay-glass']).toBe('rgba(255, 255, 255, 0.2)');
        expect(v['--ds-overlay-shade']).toBe('rgba(0, 0, 0, 0.2)');
    });

    it.each(['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel'] as const)('%s writes its official shelter colours', (id) => {
        const v = groupTokenVars(id);
        const s = groupTokens[id].official.shelter;
        expect([
            v['--ds-group-shelter-picture'], v['--ds-group-shelter-video'],
            v['--ds-group-shelter-voice'], v['--ds-group-shelter-text'],
        ]).toEqual([s.picture, s.video, s.voice, s.text]);
    });

    it.each([
        "'header-glass': 'var(--ds-overlay-glass)'",
        "'header-shade': 'var(--ds-overlay-shade)'",
        "'group-title-tint': 'color-mix(in srgb, var(--ds-group-title-text) 12.5%, transparent)'",
        "'group-title-wash': 'color-mix(in srgb, var(--ds-group-title-text) 8%, transparent)'",
        "'group-shelter-picture': 'var(--ds-group-shelter-picture)'",
        "'group-shelter-text': 'var(--ds-group-shelter-text)'",
        "'accent-border': 'var(--ds-accent-border)'",
    ])('tailwind.config.js defines %s', (entry) => {
        expect(config).toContain(entry);
    });

    it('class merging keeps the new colours apart from sizes and widths', () => {
        expect(cn('text-caption', 'text-group-shelter-voice')).toBe('text-caption text-group-shelter-voice');
        expect(cn('bg-header-glass', 'bg-group-title-tint')).toBe('bg-group-title-tint');
        expect(cn('border-2', 'border-group-shelter-picture')).toBe('border-2 border-group-shelter-picture');
        expect(cn('ring-2', 'ring-accent-border')).toBe('ring-2 ring-accent-border');
    });

    it('withAlpha mixes any colour with transparency for inline styles', () => {
        expect(withAlpha(ACCENT, 25)).toBe('color-mix(in srgb, var(--ds-accent) 25%, transparent)');
        expect(withAlpha('#389dd1', 50)).toBe('color-mix(in srgb, #389dd1 50%, transparent)');
        expect(ACCENT_LOGO).toBe('var(--ds-accent-logo)');
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/design/rATokens.test.ts`
Expected: FAIL (module `./colorMix` not found).

- [ ] **Step 3: Add the helper** — `frontend/src/design/colorMix.ts`

```ts
/**
 * Inline-style colour helpers for the pre-token media components (voice player, transcript,
 * translate/transcribe buttons), which mix their accent with transparency in inline styles.
 * They take a CSS variable instead of a hex, so the accent follows the context
 * (docs/design/DESIGN_SYSTEM.md, "Accent roles"). New components use utilities instead.
 */
export const ACCENT = 'var(--ds-accent)';
export const ACCENT_LOGO = 'var(--ds-accent-logo)';

/** `colour` at `percent` % opacity; works with hex and with var(). */
export function withAlpha(colour: string, percent: number): string {
    return `color-mix(in srgb, ${colour} ${percent}%, transparent)`;
}
```

- [ ] **Step 4: Add the overlay tokens** — in `frontend/src/design/tokens/color.ts`, inside `overlay`, after `toast`:

```ts
        /** Unread pill on a gradient chat header: the pre-D2 white glass. */
        glass: 'rgba(255, 255, 255, 0.2)',
        /** Sync pill on a gradient chat header: the pre-D2 dark shade. */
        shade: 'rgba(0, 0, 0, 0.2)',
```

- [ ] **Step 5: Add the shelter variables** — in `frontend/src/design/cssVars.ts`, inside `groupTokenVars`'s returned object after `'--ds-group-title-text': o.title.text,`:

```ts
        // Official unread-shelter colours (per message type).
        '--ds-group-shelter-picture': o.shelter.picture,
        '--ds-group-shelter-video': o.shelter.video,
        '--ds-group-shelter-voice': o.shelter.voice,
        '--ds-group-shelter-text': o.shelter.text,
```

- [ ] **Step 6: Add the utilities** — in `frontend/tailwind.config.js`:
  - `backgroundColor`, after `'group-marker': 'var(--ds-group-marker)',`:

```js
                // Chat header pills (pre-D2 look): glass / shade on the title gradient, title-text tints on a light header.
                'header-glass': 'var(--ds-overlay-glass)',
                'header-shade': 'var(--ds-overlay-shade)',
                'group-title-tint': 'color-mix(in srgb, var(--ds-group-title-text) 12.5%, transparent)',
                'group-title-wash': 'color-mix(in srgb, var(--ds-group-title-text) 8%, transparent)',
                // Official unread shelters.
                'group-shelter-picture': 'var(--ds-group-shelter-picture)',
                'group-shelter-video': 'var(--ds-group-shelter-video)',
                'group-shelter-voice': 'var(--ds-group-shelter-voice)',
                'group-shelter-text': 'var(--ds-group-shelter-text)',
```

  - `textColor`, after `heart: 'var(--ds-decor-heart)',`:

```js
                'group-shelter-picture': 'var(--ds-group-shelter-picture)',
                'group-shelter-video': 'var(--ds-group-shelter-video)',
                'group-shelter-voice': 'var(--ds-group-shelter-voice)',
                'group-shelter-text': 'var(--ds-group-shelter-text)',
```

  - `borderColor`, after `surface: 'var(--ds-surface-sheet)',`: the same four `group-shelter-*` lines.
  - `ringColor`, after `accent: 'var(--ds-accent)',`: `'accent-border': 'var(--ds-accent-border)',`

- [ ] **Step 7: Register them** — in `frontend/src/utils/classnames.ts`:
  - `'text-color'` list: append `'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text'`
  - `'bg-color'` list: append `'header-glass', 'header-shade', 'group-title-tint', 'group-title-wash', 'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text'`
  - `'border-color'` list: append `'group-shelter-picture', 'group-shelter-video', 'group-shelter-voice', 'group-shelter-text'`
  - `'ring-color'`: `[{ ring: ['accent', 'accent-border'] }]`

- [ ] **Step 8: Update the variable counts** — in `frontend/src/design/applyTokens.test.ts`, line 25: append ` + 2` before `);` and `; header pill overlays (+2)` to the trailing comment; line 40: `toHaveLength(27 + 19 + 1)` → `toHaveLength(27 + 19 + 1 + 4)` with comment `// accent halo (+1); shelters (+4)`.

- [ ] **Step 9: Run the design tests**

Run: `npx vitest run src/design src/utils/classnames.test.ts`
Expected: all pass (including `tailwindTokens.test.ts`: every referenced `--ds-` variable is written).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/design/colorMix.ts frontend/src/design/rATokens.test.ts frontend/src/design/tokens/color.ts frontend/src/design/cssVars.ts frontend/tailwind.config.js frontend/src/utils/classnames.ts frontend/src/design/applyTokens.test.ts
uv run git commit -m "feat(design): add chat header, shelter and accent mix tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Group rail — brand-ink actions, group halo, semantic upgrade icon (pending decision D1)

**Files:**
- Modify: `frontend/src/core/layout/ServiceRail.tsx`, `frontend/src/core/common/SettingsMenu.tsx:73-83`, `frontend/src/core/layout/UpgradeIcon.tsx:232-294`, `frontend/src/core/dialogs.style.test.ts` (`FILES`), `frontend/src/design/guard-baseline.json`
- Test: `frontend/src/core/layout/ServiceRail.test.tsx`

**Interfaces:**
- Consumes: `IconButton` `variant="soft"` + `shape="circle"` (Task 2); `BrandScope` from `../../design/brandScope`.

- [ ] **Step 1: Write the failing tests** — in `frontend/src/core/layout/ServiceRail.test.tsx` replace the first test with:

```tsx
    it('is a neutral rail; the active group gets the logo ring and the group halo', () => {
        useAppStore.setState({ activeService: 'hinatazaka46' });
        const { container } = renderRail();
        const rail = container.firstChild as HTMLElement;
        expect(rail).toHaveClass('bg-elevated');
        expect(rail.className).not.toMatch(/border-r/);
        const logos = container.querySelectorAll('.rounded-pill.bg-card');
        expect(logos[0]).toHaveClass('ring-2', 'ring-group-logo', 'ring-offset-2', 'shadow-accent-halo');
        expect(logos[1]).not.toHaveClass('shadow-accent-halo');
        // Only the brand scope around the bottom actions carries inline (custom property) styles.
        const styled = [...container.querySelectorAll('[style]')];
        expect(styled.length).toBe(1);
        expect(styled[0]).toHaveAttribute('data-scope', 'brand');
    });

    it('puts add and search in the brand scope as soft ink circles (pending D1)', () => {
        const { container } = renderRail();
        const scope = container.querySelector('[data-scope="brand"]') as HTMLElement;
        for (const name of [/^Search/, 'Add Service']) {
            const b = screen.getByRole('button', { name });
            expect(scope).toContainElement(b);
            expect(b).toHaveClass('bg-accent-subtle', 'text-accent', 'rounded-full');
        }
    });
```

and append `'layout/UpgradeIcon.tsx',` after `'layout/ServiceRail.tsx',` in `FILES` of `frontend/src/core/dialogs.style.test.ts`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/core/layout/ServiceRail.test.tsx src/core/dialogs.style.test.ts`
Expected: FAIL (`shadow-group-glow`, no brand scope; `UpgradeIcon` palette classes).

- [ ] **Step 3: Implement the rail** — in `frontend/src/core/layout/ServiceRail.tsx`:
  - add `import { BrandScope } from '../../design/brandScope';`
  - logo button: `focus-visible:ring-group` → `focus-visible:ring-accent`
  - logo container: `isActive ? 'ring-2 ring-group-logo ring-offset-2 shadow-group-glow' : 'shadow-pill hover:shadow-card',` → `isActive ? 'ring-2 ring-group-logo ring-offset-2 shadow-accent-halo' : 'shadow-pill hover:shadow-card',`
  - replace the bottom actions block

```tsx
            {/* Bottom actions */}
            <div className="mt-4 flex flex-col items-center gap-2">
```

…through its closing `</div>` (the one after `<SettingsMenu … />`) with:

```tsx
            {/* Bottom actions: brand context (spec §4: the rail frame's icons use the brand ink) */}
            <BrandScope className="mt-4 flex flex-col items-center gap-2">
                {/* Add Service Button - only show if not all services selected */}
                {!allServicesSelected && (
                    <IconButton
                        variant="soft"
                        shape="circle"
                        className="h-11 w-11"
                        aria-label={t('serviceRail.addService')}
                        title={t('serviceRail.addService')}
                        icon={<Plus className="h-5 w-5" />}
                        onClick={() => setShowAddModal(true)}
                    />
                )}

                {/* Upgrade Icon — appears when an update is available */}
                <UpgradeIcon />

                {/* Search Button */}
                <IconButton
                    variant="soft"
                    shape="circle"
                    className="h-11 w-11"
                    aria-label={t('search.placeholder')}
                    title={`${t('search.placeholder')} (${navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}K)`}
                    icon={<Search className="h-5 w-5" />}
                    onClick={onOpenSearch}
                />

                {/* Settings Menu */}
                <SettingsMenu
                    onOpenSettings={onOpenSettings}
                    onReportIssue={onReportIssue}
                    onOpenAbout={onOpenAbout}
                />
            </BrandScope>
```

- [ ] **Step 4: Settings trigger** — in `frontend/src/core/common/SettingsMenu.tsx` replace

```tsx
                variant="secondary"
                className="h-11 w-11"
```

with

```tsx
                variant="soft"
                shape="circle"
                className="h-11 w-11"
```

- [ ] **Step 5: Upgrade icon on semantic tokens (spec §3.4)** — in `frontend/src/core/layout/UpgradeIcon.tsx` replace the `return (…);` of the component (from `<div className="relative group">` to its closing `</div>`) with:

```tsx
    return (
        <div className="relative group">
            <button
                onClick={handleClick}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (stage === 'available') handleDismiss(e);
                }}
                className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-full transition duration-fast ease-standard hover:brightness-94',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    stage === 'error'
                        ? 'bg-semantic-danger-icon text-semantic-danger'
                        : stage === 'ready'
                        ? 'bg-semantic-success-icon text-semantic-success'
                        : 'bg-semantic-info-icon text-semantic-info',
                )}
                title={tooltip}
            >
                {/* Progress ring for downloading state */}
                {stage === 'downloading' && (
                    <svg className="absolute inset-0 h-11 w-11 -rotate-90" viewBox="0 0 44 44">
                        <circle
                            cx="22" cy="22" r={RING_RADIUS}
                            fill="none" stroke="currentColor" strokeWidth="2.5"
                            strokeDasharray={RING_CIRCUMFERENCE}
                            strokeDashoffset={ringOffset}
                            className="text-accent transition-[stroke-dashoffset] duration-base ease-standard"
                            strokeLinecap="round"
                        />
                    </svg>
                )}

                {/* Icon */}
                {stage === 'error' ? (
                    <AlertCircle className="h-5 w-5" />
                ) : stage === 'launching' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                ) : stage === 'ready' ? (
                    <ArrowUpCircle className="h-5 w-5" />
                ) : (
                    <Download className="h-5 w-5" />
                )}

                {/* Notification dot */}
                {(stage === 'available' || stage === 'ready') && (
                    <span className={cn(
                        'absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-surface',
                        stage === 'available' ? 'bg-accent' : 'bg-status-success',
                    )} />
                )}
            </button>

            {/* Dismiss button on hover for available/error stages */}
            {(stage === 'available' || stage === 'error') && (
                <button
                    onClick={handleDismiss}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-control-off text-primary transition-colors duration-fast ease-standard hover:bg-sunken group-hover:flex"
                    title={stage === 'error' ? t('common.cancel') : t('update.skipVersion')}
                >
                    <X className="h-2.5 w-2.5" />
                </button>
            )}
        </div>
    );
```

(It sits inside the rail's `BrandScope`, so `bg-accent` / `text-accent` are brand ink = the info colour; there is no separate blue.)

- [ ] **Step 6: Lower the guard baseline**

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: only `"core/layout/ServiceRail.tsx": 2` removed.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/core src/design && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/core/layout/ServiceRail.tsx frontend/src/core/layout/ServiceRail.test.tsx frontend/src/core/common/SettingsMenu.tsx frontend/src/core/layout/UpgradeIcon.tsx frontend/src/core/dialogs.style.test.ts frontend/src/design/guard-baseline.json
uv run git commit -m "feat(ui): give the group rail brand-ink actions" -m "Search, settings and add service are soft ink circles in a brand scope; the selected logo keeps its logo ring with the group halo; the update icon uses the semantic colours." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Feature rail — colour on the selected card (pending decision D2)

**Files:**
- Modify: `frontend/src/design/primitives/RailItem.tsx`, `frontend/src/core/layout/FeatureRail.tsx:14-17`, `frontend/src/core/dialogs.style.test.ts`
- Test: `frontend/src/design/primitives/Controls.test.tsx` (`RailItem`)

- [ ] **Step 1: Write the failing test** — in `Controls.test.tsx`, inside `describe('RailItem', …)` add:

```tsx
    it('the selected entry is a white card with the accent icon, label and bar (pending D2)', () => {
        render(
            <>
                <RailItem icon={<MessageCircle />} label="トーク" selected />
                <RailItem icon={<MessageCircle />} label="ブログ" />
            </>,
        );
        const on = screen.getByRole('button', { name: 'トーク' });
        expect(on).toHaveClass('bg-sheet', 'shadow-card', 'text-accent-strong');
        expect(on.querySelector('[data-rail-bar]')).toHaveClass('bg-accent');
        expect(on.querySelector('[aria-hidden="true"]:not([data-rail-bar])')).toHaveClass('text-accent');
        expect(screen.getByRole('button', { name: 'ブログ' }).querySelector('[data-rail-bar]')).toBeNull();
    });
```

and append `'layout/FeatureRail.tsx',` to `FILES` in `core/dialogs.style.test.ts`.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/design/primitives/Controls.test.tsx`
Expected: FAIL (`text-primary`, no bar).

- [ ] **Step 3: Implement** — replace the `RailItem` component in `frontend/src/design/primitives/RailItem.tsx` with:

```tsx
/** Feature-rail entry: icon above a text label. Selected: a white card with the accent icon, label and left bar. */
export const RailItem: React.FC<RailItemProps> = ({ icon, label, selected = false, onClick, className }) => (
    <button
        type="button"
        onClick={onClick}
        aria-current={selected ? 'page' : undefined}
        className={cn(
            'relative flex w-full flex-col items-center gap-1 rounded-lg px-2 py-2 text-caption',
            'transition-colors duration-fast ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            selected ? 'bg-sheet font-semibold text-accent-strong shadow-card' : 'text-secondary hover:bg-elevated hover:text-primary',
            className,
        )}
    >
        {selected && (
            <span data-rail-bar aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
        )}
        <span aria-hidden="true" className={cn('flex h-6 w-6 items-center justify-center', selected && 'text-accent')}>{icon}</span>
        <span>{label}</span>
    </button>
);
```

and in `frontend/src/core/layout/FeatureRail.tsx` replace the component doc comment with:

```tsx
/**
 * Feature rail (D-5): icon + label entries on the group canvas, in the same level-0 block as
 * the feature's sidebar. The selected entry is a white card (RailItem) with the group accent on
 * its icon, label and left bar (the pre-D2 colour cues).
 */
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/design/primitives src/core/layout src/core/dialogs.style.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design/primitives/RailItem.tsx frontend/src/design/primitives/Controls.test.tsx frontend/src/core/layout/FeatureRail.tsx frontend/src/core/dialogs.style.test.ts
uv run git commit -m "feat(ui): bring the group colour back to the feature rail" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Member list — accent selection, unread glow, Japanese names (pending decisions D3, D7)

**Files:**
- Modify: `frontend/src/design/primitives/Avatar.tsx:20,41`, `frontend/src/design/primitives/Badge.tsx`, `frontend/src/features/messages/components/MemberList.tsx`, `frontend/src/core/dialogs.style.test.ts`, `frontend/src/design/guard-baseline.json`
- Test: `frontend/src/design/primitives/Indicators.test.tsx`, `frontend/src/features/messages/components/MemberList.d2a.test.tsx`

- [ ] **Step 1: Write the failing tests**
  - `Indicators.test.tsx`: replace the test `'adds the white ring and group glow when selected'` with:

```tsx
    it('adds the accent ring with a white gap and the halo when selected (pending D3)', () => {
        const { container } = render(<Avatar name="A" selected />);
        expect(container.firstChild).toHaveClass('ring-2', 'ring-accent', 'ring-offset-2', 'ring-offset-surface', 'shadow-accent-halo');
    });
```

  - `Indicators.test.tsx`, in the Badge `it.each`: after `expect(badge).toHaveClass('bg-accent', 'rounded-pill');` add `expect(badge).toHaveClass('shadow-accent-unread'); // pending D7`
  - `MemberList.d2a.test.tsx`: in the first test replace `expect(avatar).toHaveClass('ring-2', 'ring-surface', 'shadow-accent-halo');` with `expect(avatar).toHaveClass('ring-2', 'ring-accent', 'ring-offset-2', 'shadow-accent-halo');` and add a test:

```tsx
    it('marks member names as Japanese content and colours the selected one', async () => {
        serve();
        render(<MemberList activeService="hinatazaka46" selectedGroupDir={PATH} onSelectGroup={vi.fn()} />);
        const cell = await screen.findByRole('button', { name: /石塚 瑶季/ });
        const name = cell.querySelector('[lang="ja"]');
        expect(name).not.toBeNull();
        expect(name).toHaveClass('font-semibold', 'text-accent-strong');
    });
```

  - append `'../features/messages/components/MemberList.tsx',` to `FILES` in `core/dialogs.style.test.ts`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/design/primitives/Indicators.test.tsx src/features/messages/components/MemberList.d2a.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Avatar and Badge** —
  - `Avatar.tsx`: doc comment `/** Selected member: white ring + group-colour glow. */` → `/** Selected member: accent ring with a white gap + the accent halo. */`; `selected && 'ring-2 ring-surface shadow-accent-halo',` → `selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface shadow-accent-halo',`
  - `Badge.tsx`: doc comment → `/** Level 3 — unread count in the accent colour with the unread glow. Hidden at 0, capped at 99+. */`; `'text-caption font-semibold text-inverse shadow-pill',` → `'text-caption font-semibold text-inverse shadow-accent-unread',`

- [ ] **Step 4: MemberList** — in `frontend/src/features/messages/components/MemberList.tsx`:
  - cell button: `focus-visible:ring-group` → `focus-visible:ring-accent`
  - group-chat placeholder: `isSelected ? 'ring-2 ring-surface shadow-group-glow' : 'group-hover:shadow-card',` → `isSelected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface shadow-accent-halo' : 'group-hover:shadow-card',`
  - name span: replace

```tsx
                        <span className={cn(
                            'line-clamp-2 max-w-full text-center text-caption transition-colors duration-fast ease-standard',
                            isSelected ? 'font-semibold text-group-strong' : 'text-secondary group-hover:text-primary',
                        )}>
```

with

```tsx
                        <span lang="ja" className={cn(
                            'line-clamp-2 max-w-full text-center text-caption transition-colors duration-fast ease-standard',
                            isSelected ? 'font-semibold text-accent-strong' : 'text-secondary group-hover:text-primary',
                        )}>
```

  - title row spinner: `<RefreshCw className="h-4 w-4 animate-spin text-secondary" />` → `<RefreshCw className="h-4 w-4 animate-spin text-accent" />`
  - loading block: `<RefreshCw className="h-5 w-5 animate-spin" />` → `<RefreshCw className="h-5 w-5 animate-spin text-accent" />`
  - syncing pill: `<span className="flex items-center gap-1 py-1 pr-2 font-semibold">` → `<span className="flex items-center gap-1 py-1 pr-2 font-semibold text-accent">`
  - sync-now `IconButton`: add `shape="circle"` (it sits in a pill).

- [ ] **Step 5: Lower the guard baseline**

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: only `"features/messages/components/MemberList.tsx": 3` removed.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/design src/features/messages src/core/dialogs.style.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/design/primitives/Avatar.tsx frontend/src/design/primitives/Badge.tsx frontend/src/design/primitives/Indicators.test.tsx frontend/src/features/messages/components/MemberList.tsx frontend/src/features/messages/components/MemberList.d2a.test.tsx frontend/src/core/dialogs.style.test.ts frontend/src/design/guard-baseline.json
uv run git commit -m "feat(chat): restore member list colours and the unread glow" -m "The selected member gets the accent ring and halo, badges glow, names are marked as Japanese content." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Chat header, ⋯ menu, date pills, floating arrows (pending decision D8)

**Files:**
- Modify: `frontend/src/features/messages/components/ChatHeaderPill.tsx`, `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/features/messages/components/ConversationMenu.tsx:63-110`, `frontend/src/design/primitives/DatePill.tsx:36`, `frontend/src/i18n/locales/*.json`, `frontend/src/core/dialogs.style.test.ts`, `frontend/e2e/chat-frame.spec.ts`
- Create: `frontend/src/i18n/rA.test.ts`
- Test: `frontend/src/features/messages/components/ChatHeaderPill.test.tsx`, `frontend/src/design/primitives/Indicators.test.tsx` (DatePill)

**Interfaces:**
- Consumes: tokens from Task 5, `MenuItem disabledReason/logTarget` (Task 4).
- Produces: `ChatHeaderPillProps.tone?: 'count' | 'status'` (default `count`).

- [ ] **Step 1: Write the failing tests**
  - replace `ChatHeaderPill.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatHeaderPill } from './ChatHeaderPill';

// The pre-D2 header pills, through tokens (pending D8).
describe('ChatHeaderPill', () => {
    it('on a gradient header the count is white glass and the status a dark shade, both white text', () => {
        render(<><ChatHeaderPill light={false}>3 unread</ChatHeaderPill><ChatHeaderPill light={false} tone="status">同期中</ChatHeaderPill></>);
        expect(screen.getByText('3 unread')).toHaveClass('bg-header-glass', 'text-inverse');
        expect(screen.getByText('同期中')).toHaveClass('bg-header-shade', 'text-inverse');
    });

    it('on the light (white) header both are tinted with the official title text colour', () => {
        render(<><ChatHeaderPill light>3 unread</ChatHeaderPill><ChatHeaderPill light tone="status">同期中</ChatHeaderPill></>);
        expect(screen.getByText('3 unread')).toHaveClass('bg-group-title-tint', 'text-group-title');
        expect(screen.getByText('同期中')).toHaveClass('bg-group-title-wash', 'text-group-title');
        expect(screen.getByText('3 unread')).not.toHaveClass('bg-sunken');
    });
});
```

  - `Indicators.test.tsx` DatePill button test: after `expect(button).toHaveClass('rounded-pill', 'focus-visible:ring-accent');` add `expect(button).toHaveClass('hover:text-accent-strong');`
  - create `frontend/src/i18n/rA.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string R-a adds (later tasks append). */
const RA_KEYS = ['conversationMenu.sentLettersGroupChat'] as const;

describe('R-a strings', () => {
    it.each(Object.entries(locales))('%s has every R-a key', (_code, data) => {
        const tree = data as unknown as Record<string, Record<string, string>>;
        for (const dotted of RA_KEYS) {
            const [section, key] = dotted.split('.');
            expect(tree[section]?.[key], dotted).toBeTruthy();
        }
    });
});
```

  - `core/dialogs.style.test.ts`: append `'../features/messages/components/ChatHeaderPill.tsx',` and `'../features/messages/MessagesFeature.tsx',` to `FILES`, and add `'../features/messages/MessagesFeature.tsx'` to `DATA_COLOUR` with the comment `/** MessagesFeature: the chat background colour/image is the user's own setting (data). */`.
  - `e2e/chat-frame.spec.ts`: after the heading assertion add `await expect(header.getByRole('heading', { name: 'Big Room' })).toHaveAttribute('lang', 'ja')`.
  - `frontend/src/features/incomingCall/CallOverlay.test.tsx`: append inside `describe('CallOverlay', …)`:

```tsx
    it('takes the context accent when no colour is passed', () => {
        render(<CallOverlay call={call()} answerStyle="solid" groupLabel="日向坂46" />);
        expect(screen.getByTestId('call-overlay').style.getPropertyValue('--sd-accent')).toBe('var(--ds-accent)');
    });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/messages/components/ChatHeaderPill.test.tsx src/design/primitives/Indicators.test.tsx src/i18n/rA.test.ts src/core/dialogs.style.test.ts src/features/incomingCall/CallOverlay.test.tsx`
Expected: FAIL (old classes; missing key; MessagesFeature reads `useMessagesTheme`; `--sd-accent` is empty without a prop).

- [ ] **Step 3: ChatHeaderPill** — replace the component file body with:

```tsx
import React from 'react';
import { cn } from '../../../utils/classnames';

export interface ChatHeaderPillProps {
    /** Light-style (white) header, e.g. Sakurazaka. */
    light: boolean;
    /** `count` (unread) or `status` (sync); as before D2 they differ slightly. */
    tone?: 'count' | 'status';
    className?: string;
    children: React.ReactNode;
}

/**
 * A status pill in the chat header (the pre-D2 look through tokens): white glass or a dark shade
 * on the title gradient, the official title-text colour tinted on a light header.
 */
const TONE = {
    count: { gradient: 'bg-header-glass text-inverse', light: 'bg-group-title-tint text-group-title' },
    status: { gradient: 'bg-header-shade text-inverse', light: 'bg-group-title-wash text-group-title' },
} as const;

export const ChatHeaderPill: React.FC<ChatHeaderPillProps> = ({ light, tone = 'count', className, children }) => (
    <span className={cn('flex items-center gap-2 rounded-pill px-3 py-1 text-caption', TONE[tone][light ? 'light' : 'gradient'], className)}>
        {children}
    </span>
);
```

- [ ] **Step 4: DatePill hover** — in `frontend/src/design/primitives/DatePill.tsx` replace `'transition-colors duration-fast ease-standard hover:text-primary',` with `'transition-colors duration-fast ease-standard hover:text-accent-strong',`.

- [ ] **Step 5: MessagesFeature** — in `frontend/src/features/messages/MessagesFeature.tsx`:
  - imports: delete `import { useMessagesTheme } from './hooks/useMessagesTheme';`; replace `import { groupRoles } from '../../design/tokens';` with `import { groupTokens } from '../../design/tokens';` and add `import { serviceGroupId } from '../../config/serviceGroup';`
  - delete the two lines `// Get theme for current service` and `const theme = useMessagesTheme();`
  - `const isLightHeader = theme.messages.headerStyle === 'light';` → `const isLightHeader = groupTokens[serviceGroupId(activeService)].official.headerStyle === 'light';`
  - header title: `<h2 className="truncate text-title font-semibold">{selectedName || t('messageList.selectConversation')}</h2>` → `<h2 lang={selectedName ? 'ja' : undefined} className="truncate text-title font-semibold">{selectedName || t('messageList.selectConversation')}</h2>`
  - sync pill: `<ChatHeaderPill light={isLightHeader}>` (the one wrapping `Loader2`) → `<ChatHeaderPill light={isLightHeader} tone="status">`
  - error block: `<div className="p-10 text-center text-feedback-error">` → `<div className="p-10 text-center text-status-danger">`
  - `CallOverlay`: replace

```tsx
                        // The accent is the group action colour (step 600); light-style services (櫻坂) get a white answer button.
                        accentColor={groupRoles(theme.id).action}
                        answerStyle={theme.messages.headerStyle === 'light' ? 'light' : 'solid'}
```

with

```tsx
                        // The accent follows the chat's group context (--ds-accent); light-style services (櫻坂) get a white answer button.
                        answerStyle={isLightHeader ? 'light' : 'solid'}
```

  The unread arrows need no change: `variant="accent"` is a circle by default since Task 2.
  - `frontend/src/features/incomingCall/CallOverlay.tsx` (the prop the step above stops passing): add `import { ACCENT } from '../../design/colorMix';`; `accentColor: string;` →

```tsx
    /** Overrides the call accent; defaults to the surrounding context (--ds-accent). */
    accentColor?: string;
```

  and `({ call, accentColor, answerStyle, groupLabel })` → `({ call, accentColor = ACCENT, answerStyle, groupLabel })`.

- [ ] **Step 6: ConversationMenu** — in `frontend/src/features/messages/components/ConversationMenu.tsx` replace the `menuItems` array and the `MenuItem` mapping:

```tsx
    const menuItems = [
        { id: 'calendar' as ModalType, icon: Calendar, label: t('conversationMenu.dateSearch'), blockedReason: undefined },
        { id: 'favorites' as ModalType, icon: Star, label: t('conversationMenu.favorites'), blockedReason: undefined },
        { id: 'media' as ModalType, icon: Image, label: t('conversationMenu.media'), blockedReason: undefined },
        { id: 'background' as ModalType, icon: Palette, label: t('conversationMenu.background'), blockedReason: undefined },
        {
            id: 'letters' as ModalType, icon: Mail, label: t('conversationMenu.sentLetters'),
            blockedReason: isGroupChat ? t('conversationMenu.sentLettersGroupChat') : undefined,
        },
    ];
```

and

```tsx
                        {menuItems.map((item) => (
                            <MenuItem
                                key={item.id}
                                // Pre-D2: the menu's icons carry the group accent.
                                icon={<item.icon className="h-4 w-4 text-accent" />}
                                disabledReason={item.blockedReason}
                                logTarget={item.id === 'letters' ? 'sent_letters' : undefined}
                                onClick={() => handleMenuItemClick(item.id)}
                            >
                                {item.label}
                            </MenuItem>
                        ))}
```

- [ ] **Step 7: Strings** — add `"sentLettersGroupChat"` to the `conversationMenu` object of each locale (after `"sentLetters"`, mind the comma):
  - `en.json`: `"sentLettersGroupChat": "Group chats have no sent letters"`
  - `ja.json`: `"sentLettersGroupChat": "グループトークにはレターがありません"`
  - `zh-CN.json`: `"sentLettersGroupChat": "群聊没有已发送的信件"`
  - `zh-TW.json`: `"sentLettersGroupChat": "群組聊天沒有已傳送的信件"`
  - `yue.json`: `"sentLettersGroupChat": "群組傾偈冇寄出嘅信"`

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/features/messages src/design src/i18n src/core/dialogs.style.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 9: Run the e2e chat locks** (backend serves `dist`, so build first)

Run: `npm run build && npx playwright test e2e/chat-frame.spec.ts e2e/dialogs-chat.spec.ts --reporter=line`
Expected: all pass (header heading has `lang="ja"`).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/messages/components/ChatHeaderPill.tsx frontend/src/features/messages/components/ChatHeaderPill.test.tsx frontend/src/features/messages/MessagesFeature.tsx frontend/src/features/messages/components/ConversationMenu.tsx frontend/src/design/primitives/DatePill.tsx frontend/src/design/primitives/Indicators.test.tsx frontend/src/i18n frontend/src/core/dialogs.style.test.ts frontend/e2e/chat-frame.spec.ts frontend/src/features/incomingCall/CallOverlay.tsx frontend/src/features/incomingCall/CallOverlay.test.tsx
uv run git commit -m "feat(chat): restore the chat header pills and menu accents" -m "Header pills get the pre-D2 glass and title tints back, menu icons the group accent, the group-chat letters item explains why it is unavailable." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Bubbles, shelters, letters and the message menu (pending decision D4)

**Files:**
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`, `MessageList.tsx:5,125-133,217`, `MessageContextMenu.tsx:20`, `LetterRow.tsx:49,55`, `frontend/src/features/messages/hooks/index.ts:3-4`, `frontend/src/core/dialogs.style.test.ts`, `frontend/src/design/guard-baseline.json`
- Delete: `frontend/src/features/messages/hooks/useMessagesTheme.ts`
- Test: `MessageBubble.test.tsx`, `MessageContextMenu.test.tsx`, `LetterRow.test.tsx`

**Interfaces:**
- Consumes: shelter utilities (Task 5), `ACCENT_LOGO` (Task 5).
- Produces: `MessageBubbleProps` without `theme` (removed); `MessageList` no longer reads a theme.

- [ ] **Step 1: Write the failing tests**
  - `MessageBubble.test.tsx`: drop the `FALLBACK_ACTION_COLOR` import; replace the test `'without a theme, the favourite star uses the neutral action colour'` with:

```tsx
  it('draws the favourite star in the accent colour', () => {
    const { container } = render(<MessageBubble {...defaultProps} message={createMessage({ is_favorite: true })} />)
    expect(container.querySelector('svg.h-3\\.5')).toHaveClass('fill-current', 'text-accent')
  })

  it('marks the text and the member name as Japanese content', () => {
    render(<MessageBubble {...defaultProps} message={createMessage({ content: 'おはよう🌸' })} />)
    expect(screen.getByText('おはよう🌸').closest('[lang="ja"]')).not.toBeNull()
    expect(screen.getByText('Test User')).toHaveAttribute('lang', 'ja')
  })

  it('links use the accent colour', () => {
    render(<MessageBubble {...defaultProps} message={createMessage({ content: 'see https://example.com' })} />)
    expect(screen.getByRole('link', { name: 'https://example.com' })).toHaveClass('text-accent')
  })

  it('the unread shelter uses the official shelter colour of the message type', () => {
    render(<MessageBubble {...defaultProps} isUnread message={createMessage({ type: 'voice', content: null })} />)
    const shelter = screen.getByTestId('unread-shelter')
    expect(shelter).toHaveClass('bg-group-shelter-voice', 'text-inverse')
    expect(shelter.getAttribute('style')).toBeNull()
  })
```

  - same file: `'names the sender with the strong group role'` → assert `toHaveClass('text-accent-strong')` (rename to `'names the sender with the strong accent role'`); in the avatar test lines 72/77 replace `'hover:shadow-card'` with `'hover:ring-accent-border'` (pending D4).
  - `MessageContextMenu.test.tsx` line 34: `expect(item.querySelector('svg')).toHaveClass('fill-current');` → `expect(item.querySelector('svg')).toHaveClass('fill-current', 'text-accent');`
  - `LetterRow.test.tsx`: append inside `describe('LetterRow', …)` (it uses the file's `base` letter):

```tsx
    it('marks the letter text as Japanese content (not the UI fallback)', () => {
        const { rerender } = render(<LetterRow letter={{ ...base, image_url: null }} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        expect(screen.getByText('いつもありがとう🌸')).toHaveAttribute('lang', 'ja');
        rerender(<LetterRow letter={{ ...base, image_url: null, text: '' }} avatarUrl={null} userName="ゆき" onOpenImage={vi.fn()} />);
        expect(screen.getByText(i18n.t('sentLetters.noTextContent'))).not.toHaveAttribute('lang');
    });
```
  - `core/dialogs.style.test.ts`: append `'../features/messages/components/MessageBubble.tsx'`, `'../features/messages/components/MessageList.tsx'`, `'../features/messages/components/LetterRow.tsx'` to `FILES`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/messages/components src/core/dialogs.style.test.ts`
Expected: FAIL.

- [ ] **Step 3: MessageBubble** — in `frontend/src/features/messages/components/MessageBubble.tsx`:
  - imports: delete `import { DEFAULT_SHELTER_COLORS } from '../../../config/serviceThemes';`, `import { getServiceTheme } from '../../../config/serviceThemes';`, `import { FALLBACK_ACTION_COLOR } from '../../../design/tokens';`; add `import { groupTokens } from '../../../design/tokens';`, `import { serviceGroupId } from '../../../config/serviceGroup';`, `import { ACCENT_LOGO } from '../../../design/colorMix';`
  - delete the `ShelterColors`, `ShelterStyle` and `MessageBubbleTheme` interfaces/types, the `theme?: MessageBubbleTheme;` prop, and `theme,` in the component's destructuring; add after `SHELTER_ICONS` (keep it):

```tsx
type ShelterKind = 'picture' | 'video' | 'voice' | 'text';
/** Official unread shelters: `classic` = filled with a white icon, `light` = white with a coloured border and icon. */
const SHELTER_CLASSES: Record<ShelterKind, { classic: string; light: string }> = {
    picture: { classic: 'bg-group-shelter-picture text-inverse', light: 'border-2 border-group-shelter-picture bg-card text-group-shelter-picture' },
    video: { classic: 'bg-group-shelter-video text-inverse', light: 'border-2 border-group-shelter-video bg-card text-group-shelter-video' },
    voice: { classic: 'bg-group-shelter-voice text-inverse', light: 'border-2 border-group-shelter-voice bg-card text-group-shelter-voice' },
    text: { classic: 'bg-group-shelter-text text-inverse', light: 'border-2 border-group-shelter-text bg-card text-group-shelter-text' },
};
const shelterKind = (type: string): ShelterKind =>
    type === 'picture' || type === 'video' || type === 'voice' ? type : 'text';
```

  - `MediaContainer`: `isVideo ? "bg-black" : "bg-gray-50"` → `isVideo ? "bg-viewer-stage" : "bg-elevated"`
  - `LinkifiedText`: signature `({ text })` (drop `linkColor`), and the anchor `className="hover:underline break-all"` + `style={{ color: linkColor || '#2563eb' }}` → `className="break-all text-accent hover:underline"` (no style)
  - replace the whole `ShelterOverlay` with:

```tsx
    const ShelterOverlay = () => {
        const Icon = SHELTER_ICONS[message.type] || MessageSquare;
        const look = groupTokens[serviceGroupId(service ?? null)].official.shelterStyle;
        return (
            <div
                data-testid="unread-shelter"
                className={cn(
                    'absolute inset-0 z-10 flex cursor-pointer items-center justify-center transition-colors',
                    bubbleCorners,
                    SHELTER_CLASSES[shelterKind(message.type)][look],
                )}
                onClick={(e) => {
                    e.stopPropagation();
                    onReveal?.();
                }}
                onMouseDown={handleTouchStart}
                onMouseUp={handleTouchEnd}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                <Icon className={cn('h-8 w-8', look === 'classic' && 'opacity-90')} />
            </div>
        );
    };
```

  - favourite star: `<Star className="w-3.5 h-3.5 shrink-0" style={{ … }} />` → `<Star className="h-3.5 w-3.5 shrink-0 fill-current text-accent" />`
  - `TranslateButton`: `accentColor={service ? getServiceTheme(service).primaryColor : undefined}` → `accentColor={ACCENT_LOGO}` (pre-D2 used the logo colour)
  - avatar button (pending D4): `? 'cursor-pointer transition-shadow duration-fast ease-standard hover:shadow-card'` → `? 'cursor-pointer transition-shadow duration-fast ease-standard hover:ring-2 hover:ring-accent-border'`
  - name: `<span className="text-small font-semibold text-group-strong">{member_name}</span>` → `<span lang="ja" className="text-small font-semibold text-accent-strong">{member_name}</span>`
  - `VoicePlayer`: delete `accentColor={theme?.voicePlayerAccent}` (default follows the context after Task 11; until then its default is the neutral fallback — Task 11 lands next)
  - text: `<div className={cn('whitespace-pre-wrap text-body text-primary', …)}>` → add `lang="ja"`; `<LinkifiedText text={message.content} linkColor={theme?.linkColor} />` → `<LinkifiedText text={message.content} />`
  - transcript footer: replace

```tsx
                        className="rounded-b-md border-t-0 border px-3 py-1.5 -mt-1"
                        style={{
                            borderColor: `${theme?.voicePlayerAccent || FALLBACK_ACTION_COLOR}30`,
                            background: `${theme?.voicePlayerAccent || FALLBACK_ACTION_COLOR}05`,
                        }}
```

with

```tsx
                        className="-mt-1 rounded-b-md border border-t-0 border-accent-border bg-accent-subtle px-3 py-1.5"
```

  - delete `accentColor={theme?.voicePlayerAccent}` from `TranscribeButton` and `TranscriptPanel`.

- [ ] **Step 4: MessageList** — in `MessageList.tsx` delete the `useMessagesTheme` import, the `// Get theme colors for message bubbles` block (`const theme = useMessagesTheme();` and the `bubbleTheme` `useMemo`), and the `theme={bubbleTheme}` prop on `MessageBubble`.

- [ ] **Step 5: Remove the dead hook** — `git rm frontend/src/features/messages/hooks/useMessagesTheme.ts` and delete its two export lines from `frontend/src/features/messages/hooks/index.ts`. Check: `grep -rn "useMessagesTheme\|MessagesTheme" src --include=*.ts --include=*.tsx` → only the string inside `core/dialogs.style.test.ts`.

- [ ] **Step 6: MessageContextMenu and LetterRow**
  - `MessageContextMenu.tsx`: `isFavorite ? 'fill-current text-group-strong' : 'text-muted'` → `isFavorite ? 'fill-current text-accent' : 'text-muted'`
  - `LetterRow.tsx`: `focus-visible:ring-group` → `focus-visible:ring-accent`; `<Card className="max-w-xs whitespace-pre-wrap p-3 text-body text-primary">` → `<Card lang={letter.text ? 'ja' : undefined} className="max-w-xs whitespace-pre-wrap p-3 text-body text-primary">` (`Card` forwards div attributes; the fallback is UI text and stays unmarked).

- [ ] **Step 7: Snapshots and guard baseline**

Run: `npx vitest run src/features/messages/components/MessageBubble.test.tsx -u` (only the class changes above may appear in the snapshot diff: check with `git diff --stat` and `git diff src/features/messages/components/__snapshots__`), then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected baseline diff: `MessageBubble.tsx` (3), `MessageContextMenu.tsx` (1) and `LetterRow.tsx` (1) removed; nothing else.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/features/messages src/core src/design && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A frontend/src/features/messages frontend/src/core/dialogs.style.test.ts frontend/src/design/guard-baseline.json
uv run git commit -m "feat(chat): put bubbles, shelters and letters on accent tokens" -m "Links, stars and names follow the group accent, shelters read the official colours as tokens, message text and names are marked as Japanese; the old messages theme hook goes." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Player, transcript and translate accents; viewer focus rings

**Files:**
- Modify: `frontend/src/core/media/VoicePlayer.tsx:102,424-429,438-439,454,551,674-675,737`, `TranscriptPanel.tsx:51,187,208`, `TranscribeButton.tsx:25,54,57`, `frontend/src/core/common/TranslateButton.tsx:36,48,50,127`, `frontend/src/core/media/PhotoPlayer.tsx:74`, `LazyVideo.tsx:65`, `PhotoDetailModal.tsx:187`, `frontend/src/core/dialogs.style.test.ts` (already lists PhotoPlayer, LazyVideo, PhotoDetailModal), `frontend/src/design/guard-baseline.json`
- Test: `frontend/src/core/media/TranscriptPanel.test.tsx` (or create `frontend/src/core/media/accent.test.tsx`)

**Interfaces:**
- Consumes: `ACCENT`, `withAlpha` (Task 5).
- Produces: the `accentColor` props of `VoicePlayer`, `TranscriptPanel`, `TranscribeButton`, `TranslateButton` stay optional overrides and now default to `ACCENT` (`var(--ds-accent)`), so callers in a group or brand scope follow it; `FALLBACK_ACTION_COLOR` stays exported (blogs still use their own value).

- [ ] **Step 1: Write the failing test** — create `frontend/src/core/media/accent.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The pre-token media parts mix their accent in inline styles. A hex suffix (`${accent}40`)
// breaks with a CSS variable, so the accent must go through withAlpha() and default to the context.
const FILES = ['VoicePlayer.tsx', 'TranscriptPanel.tsx', 'TranscribeButton.tsx', '../common/TranslateButton.tsx'];

describe.each(FILES)('%s', (file) => {
    const source = readFileSync(path.resolve(__dirname, file), 'utf-8');
    it('defaults its accent to the context (var(--ds-accent))', () => {
        expect(source).toMatch(/accentColor = ACCENT\b|DEFAULT_ACCENT_COLOR = ACCENT\b/);
        expect(source).not.toMatch(/FALLBACK_ACTION_COLOR/);
    });
    it('never appends a hex alpha to the accent', () => {
        expect(source).not.toMatch(/\$\{accentColor\}[0-9a-fA-F]{2}/);
    });
});

describe('transcript segments', () => {
    it('are marked as Japanese content', () => {
        const source = readFileSync(path.resolve(__dirname, 'TranscriptPanel.tsx'), 'utf-8');
        expect(source).toMatch(/<span\s+lang="ja"/);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/core/media/accent.test.tsx`
Expected: FAIL.

- [ ] **Step 3: VoicePlayer** — in `frontend/src/core/media/VoicePlayer.tsx`:
  - imports: replace the `FALLBACK_ACTION_COLOR` import with `import { ACCENT, withAlpha } from '../../design/colorMix';`
  - `const DEFAULT_ACCENT_COLOR = FALLBACK_ACTION_COLOR; // neutral action colour when no group theme is given` → `const DEFAULT_ACCENT_COLOR = ACCENT; // the context's accent (group in a chat, ink in a brand scope)`
  - premium card style: `'--tw-ring-color': \`${accentColor}80\`,` → `'--tw-ring-color': withAlpha(accentColor, 50),`; `borderColor: \`${accentColor}33\`,` → `borderColor: withAlpha(accentColor, 20),`
  - avatar ring: ``style={{ background: `linear-gradient(to bottom right, ${accentColor}, ${accentColor}cc)` }}`` → ``style={{ background: `linear-gradient(to bottom right, ${accentColor}, ${withAlpha(accentColor, 80)})` }}``
  - member name: `<p className="text-sm font-semibold text-gray-800 truncate">{memberName}</p>` → `<p lang="ja" className="text-sm font-semibold text-gray-800 truncate">{memberName}</p>` (its grey palette classes are E clean-up; the file is not in the style ratchet)
  - both volume sliders: `#d1d5db ${volume * 100}%` → `var(--ds-border-strong) ${volume * 100}%`
  - compact card: `className="bg-[#F3F4F6] rounded-lg p-3 min-w-[300px] outline-none focus:ring-2"` → `className="bg-sunken rounded-lg p-3 min-w-[300px] outline-none focus:ring-2"`; `style={{ '--ring-color': \`${accentColor}80\` } as React.CSSProperties}` → `style={{ '--ring-color': withAlpha(accentColor, 50) } as React.CSSProperties}`

- [ ] **Step 4: TranscriptPanel, TranscribeButton, TranslateButton**
  - each: replace the `FALLBACK_ACTION_COLOR` import with `import { ACCENT, withAlpha } from '../../design/colorMix';` (`TranslateButton` is in `core/common/`: same relative path) and `accentColor = FALLBACK_ACTION_COLOR,` → `accentColor = ACCENT,`
  - `TranscriptPanel.tsx`: `` : `${accentColor}15`, `` → `: withAlpha(accentColor, 8),`; the segment text `<span` that renders `{seg.text}` → `<span lang="ja"` (keep its `style` and `title`)
  - `TranscribeButton.tsx`: `` : (isLight ? 'rgba(255,255,255,0.15)' : `${accentColor}40`), `` → `: (isLight ? 'rgba(255,255,255,0.15)' : withAlpha(accentColor, 25)),`; `` : (isLight ? 'rgba(255,255,255,0.06)' : `${accentColor}08`), `` → `: (isLight ? 'rgba(255,255,255,0.06)' : withAlpha(accentColor, 3)),`
  - `TranslateButton.tsx`: `` borderColor: isLight ? 'rgba(255,255,255,0.15)' : `${accentColor}40`, `` → `borderColor: isLight ? 'rgba(255,255,255,0.15)' : withAlpha(accentColor, 25),`; `` background: isLight ? 'rgba(255,255,255,0.06)' : `${accentColor}08`, `` → `background: isLight ? 'rgba(255,255,255,0.06)' : withAlpha(accentColor, 3),`; in `buttonPalette`: `` { border: `${accentColor}40`,        text: accentColor,            background: `${accentColor}08` } `` → `{ border: withAlpha(accentColor, 25), text: accentColor, background: withAlpha(accentColor, 3) }`

- [ ] **Step 5: Viewer focus rings** — `focus-visible:ring-group` → `focus-visible:ring-accent` in `PhotoPlayer.tsx:74`, `LazyVideo.tsx:65` and `PhotoDetailModal.tsx:187`. (`PhotoDetailModal`'s overlay close button is already a circle since Task 2.)

- [ ] **Step 6: Guard baseline**

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `VoicePlayer.tsx` 6 → 3; `PhotoPlayer.tsx`, `LazyVideo.tsx`, `PhotoDetailModal.tsx` (1 each) removed; nothing else.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/core src/features && npx tsc --noEmit`
Expected: all pass (VoicePlayer tests select by layout classes that did not change).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/core/media frontend/src/core/common/TranslateButton.tsx frontend/src/design/guard-baseline.json
uv run git commit -m "feat(media): let player and transcript accents follow the context" -m "Accents default to var(--ds-accent) and mix through withAlpha; transcripts are marked as Japanese; viewer focus rings use the accent." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Member profile card (pending decision D5)

**Files:**
- Modify: `frontend/src/features/messages/components/MemberProfilePopup.tsx:102,115,129`, `ProfileImagePills.tsx:34,39`, `ProfileImageViewer.tsx:55`, `frontend/src/design/guard-baseline.json`
- Test: `frontend/src/features/messages/components/MemberProfilePopup.banner.test.tsx`, `ProfileImagePills.test.tsx`

- [ ] **Step 1: Write the failing tests**
  - `MemberProfilePopup.banner.test.tsx`: append a new block:

```tsx
describe('MemberProfilePopup content', () => {
    it('marks the member name as Japanese content', () => {
        render(<MemberProfilePopup isOpen onClose={vi.fn()} memberName="森田 ひかる 🌸" activeService="sakurazaka46" />);
        expect(screen.getByRole('heading', { name: '森田 ひかる 🌸' })).toHaveAttribute('lang', 'ja');
    });
});
```

  - `ProfileImagePills.test.tsx`: append inside `describe('ProfileImagePills', …)`:

```tsx
    it('hovers in the accent and shows the version count on the accent (pending D5)', () => {
        render(
            <ProfileImagePills
                images={{ thumbnail: [{ url: 'a', first_seen: null, current: true }, { url: 'b', first_seen: null, current: false }] }}
                onOpen={vi.fn()}
            />,
        );
        const pill = screen.getByRole('button', { name: /Chat icon/ });
        expect(pill).toHaveClass('hover:bg-accent-subtle', 'hover:text-accent-strong', 'focus-visible:ring-accent');
        expect(screen.getByText('2')).toHaveClass('bg-accent', 'text-inverse');
    });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/messages/components/MemberProfilePopup.banner.test.tsx src/features/messages/components/ProfileImagePills.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `MemberProfilePopup.tsx`: `'focus-visible:outline-none focus-visible:ring-group',` → `'focus-visible:outline-none focus-visible:ring-accent',`; `<h2 id="profile-title" className="text-heading font-semibold text-primary">{memberName}</h2>` → `<h2 id="profile-title" lang="ja" className="text-heading font-semibold text-primary">{memberName}</h2>`; the streak number `components={{ num: <span className="text-heading font-semibold text-primary" /> }}` → `components={{ num: <span className="text-heading font-semibold tabular-nums text-primary" /> }}`. The close button is `overlay` on the gradient banner (now a circle, floating) and `ghost` on Sakurazaka's white banner (stays 12 px): no change needed.
  - `ProfileImagePills.tsx` (pending D5): pill class → `"inline-flex items-center gap-1 rounded-pill bg-pill px-3 py-1 text-caption text-secondary shadow-pill transition-colors duration-fast ease-standard hover:bg-accent-subtle hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"`; count chip `"rounded-pill bg-sunken px-1 tabular-nums text-secondary"` → `"rounded-pill bg-accent px-1 tabular-nums text-inverse"`
  - `ProfileImageViewer.tsx`: `'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',` → `'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',`

- [ ] **Step 4: Guard baseline**

Run: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `MemberProfilePopup.tsx`, `ProfileImagePills.tsx`, `ProfileImageViewer.tsx` (1 each) removed; nothing else.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/messages src/core/dialogs.style.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/messages/components frontend/src/design/guard-baseline.json
uv run git commit -m "feat(chat): give the profile card accent pills and a Japanese name" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Call popup and incoming call accents

**Files:**
- Modify: `frontend/src/features/incomingCall/CallScreen.tsx:48,79`, `frontend/src/features/callPopup/PopupCall.tsx:3-4,79-82,97`, `frontend/src/core/dialogs.style.test.ts`
- Test: `frontend/src/features/callPopup/PopupCall.test.tsx`

**Interfaces:**
- Consumes: `ACCENT` (Task 5), `groupScopeStyle` (`design/groupScope.ts`), `serviceGroupId` (`config/serviceGroup.ts`); `CallOverlay`'s optional accent already landed in Task 9.

- [ ] **Step 1: Write the failing tests**
  - `PopupCall.test.tsx`: replace the two `--sd-accent` / `groupRoles` expectations with:

```tsx
        const el = container.querySelector('.sd-call-popup') as HTMLElement;
        // The popup window has no active group: it scopes itself to the member's group (spec §4).
        expect(el.style.getPropertyValue('--sd-accent')).toBe('var(--ds-accent)');
        expect(el.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(screen.getAllByText('山下 瞳月')[0]).toHaveAttribute('lang', 'ja');
```

  - `core/dialogs.style.test.ts`: append `'../features/callPopup/PopupCall.tsx'` and `'../features/incomingCall/CallScreen.tsx'` to `FILES`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/callPopup src/features/incomingCall src/core/dialogs.style.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `CallScreen.tsx`: both `<div className="sd-call-name">{name}</div>` → `<div className="sd-call-name" lang="ja">{name}</div>`
  - `PopupCall.tsx`: imports — delete `import { getServiceTheme } from '../../config/serviceThemes';` and `import { groupRoles } from '../../design/tokens';`; add `import { groupTokens } from '../../design/tokens';`, `import { serviceGroupId } from '../../config/serviceGroup';`, `import { groupScopeStyle } from '../../design/groupScope';`, `import { ACCENT } from '../../design/colorMix';`. Replace

```tsx
    const theme = getServiceTheme(info.service);
    const light = theme.messages.headerStyle === 'light';
    // The accent is the group action colour (step 600): readable on the white answer button of light groups.
    const accent = groupRoles(theme.id).action;
```

with

```tsx
    // The popup window has no active group: it carries the member's group scope itself (spec §4),
    // and the call accent reads that scope's accent (step 600, readable on light groups' white answer button).
    const groupId = serviceGroupId(info.service);
    const light = groupTokens[groupId].official.headerStyle === 'light';
    const scope = useMemo(() => groupScopeStyle(groupId), [groupId]);
```

  and `<div className="sd-call-popup" style={{ '--sd-accent': accent, '--sd-rad': '0px' } as React.CSSProperties}>` → `<div className="sd-call-popup" style={{ ...scope, '--sd-accent': ACCENT, '--sd-rad': '0px' } as React.CSSProperties}>`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features src/core/dialogs.style.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/incomingCall frontend/src/features/callPopup frontend/src/core/dialogs.style.test.ts
uv run git commit -m "feat(call): take the call accent from the member's group scope" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Zero-drift docs and changelog

**Files:**
- Modify: `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md`

- [ ] **Step 1: Update `docs/design/DESIGN_SYSTEM.md`** — make each statement match the code:
  - §3, "Status of the table": replace the paragraph with: "Status: the frame and chat screens (group rail, feature rail, member list, chat, letters, profile card, chat menus, call popup) apply this table. Blogs, the other dialogs and the entry screens follow in the next parts of the re-apply."
  - §4 neutral utilities: add "Chat header pills: `bg-header-glass` (unread) and `bg-header-shade` (sync) on a title gradient; on a light header `bg-group-title-tint` / `bg-group-title-wash` with `text-group-title` (official layer)." and "Unread shelters: `bg-` / `border-` / `text-group-shelter-{picture,video,voice,text}` (official layer, `--ds-group-shelter-*`)."
  - §4 accent roles table, `border` row: utilities `bg-accent-border`, `border-accent-border`, `ring-accent-border`.
  - §4, new paragraph after the accent roles: "**Pre-token media parts** (voice player, transcript, translate and transcribe buttons) mix their accent in inline styles: they default to `ACCENT` (`var(--ds-accent)`) and mix through `withAlpha(colour, percent)` (`design/colorMix.ts`). New components use utilities."
  - §7 radius: add "`rounded-2xl` / `rounded-3xl` are banned (the guard counts them): Tailwind's 2xl (16 px) reads larger than the token `xl` (24 px). Use `lg` / `xl`."
  - §8 Japanese content rule: replace "Content components (messages, blogs, member names) are **not yet marked** `lang="ja"`; marking them is part of the next plan." with "Marked so far: message text, member names (member list, chat header, bubbles, profile card, call screen), letter text and voice transcripts. Blog content is marked in the blog part of the re-apply. UI chrome is never marked."
  - §9: `IconButton` sentence → "`IconButton` (an `aria-label` is required) has `secondary`, `ghost`, `overlay`, `accent` (a floating action, e.g. the chat's unread arrows) and `soft` (the accent on its subtle tint, filled on hover: the group rail's actions). `shape` is `circle` for floating buttons (`overlay` and `accent` by default) and `rounded` (12 px) for inline ones. Sizes: `sm` (`h-8`) and `md` (`h-10`)."
  - Menus: "`MenuItem`: a `rounded-pill` row" → "`MenuItem`: a `rounded-sm` row"; add "`disabledReason` keeps the item focusable (`aria-disabled`) at 40 % with the reason as tooltip and description; a click is swallowed and logged (`menu_item_blocked`). A plain `disabled` item also keeps its colour at 40 %."
  - "The group rail and the profile card": add "The rail's bottom actions (add service, search, settings, update) sit in a `BrandScope`: `soft` ink circles; the update icon uses the semantic info / success / danger colours. The selected logo's halo is `shadow-accent-halo` in the active group's context." and "The feature rail's selected `RailItem` is a white card with `text-accent` icon, `text-accent-strong` label and a `bg-accent` bar on the left." (adjust to the user's answers on D1/D2).
  - "Which primitive when", Avatar row: "(`selected`: accent ring with a white gap + halo)"; Badge: "(`99+` cap, unread glow)".
  - The guard section: add "Tailwind's `rounded-2xl` / `rounded-3xl`" to the list of counted values.
  - §14 migration note: add a first line "R-a (frame and chat) is done; the list below applies to blogs, the remaining dialogs and the entry screens."
  - If the user accepted D8 (a), add to §12: "- **Chat header pills** keep the pre-D2 white glass / title-text tint: on light parts of the title gradient and on Sakurazaka's white header their caption text is below 4.5:1, like the official title beside them."

- [ ] **Step 2: Changelog** — in `CHANGELOG.md` under `## [Unreleased]` → `### Changed`, add:

```markdown
- **Chats have their group colours back.** The member list, the chat
  header, menus, links, favourites and the feature buttons show each
  group's own colour again, and Japanese names and messages always use
  Japanese letter shapes, whatever language the app is in.
```

- [ ] **Step 3: Check the docs against the code**

Run: `grep -n "not yet marked\|rounded-pill. row\|group colour in four" docs/design/DESIGN_SYSTEM.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/design/DESIGN_SYSTEM.md CHANGELOG.md
uv run git commit -m "docs(design): record the frame and chat re-apply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Full verification and the before/after page

**Files:**
- Create (git-ignored): `frontend/e2e-shots/r-a/section.mjs`
- Modify (outside the repo): `/mnt/c/D/saka-verify/shots/index.html`, `/mnt/c/D/saka-verify/shots/r-a/after/`

- [ ] **Step 1: Full checks**

Run (from `frontend/`): `npm run test:run && npx tsc --noEmit && npm run lint`, then from the repo root `uv run pytest backend/tests -q`
Expected: all pass (the known headless keyring error in pysaka does not apply here). Record the counts for the PR.

- [ ] **Step 2: e2e locks**

Run (from `frontend/`, port 8000 free): `npm run build && npx playwright test e2e/chat-frame.spec.ts e2e/timeline-scroll.spec.ts e2e/dialogs-chat.spec.ts e2e/dialogs-app.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 3: Capture "after"**

Run: `SHOT_LABEL=after npx playwright test e2e/r-a-screens.spec.ts --reporter=line && mkdir -p /mnt/c/D/saka-verify/shots/r-a && cp -r e2e-shots/r-a/after /mnt/c/D/saka-verify/shots/r-a/`
Expected: `12 passed`; 32 PNGs in `/mnt/c/D/saka-verify/shots/r-a/after/`.

- [ ] **Step 4: Write the page generator** — `frontend/e2e-shots/r-a/section.mjs`

```js
// Adds (or replaces) the R-a section of the Windows comparison page: base (e4e4118) / dev / after.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = '/mnt/c/D/saka-verify/shots'
const cols = [['base', 'e4e4118（D2 前）'], ['dev', 'dev（R-a 前）'], ['after', 'R-a 後']]
const names = readdirSync(`${root}/r-a/after`).filter((f) => f.endsWith('.png')).sort()
const fig = ([label, caption], file) => existsSync(`${root}/r-a/${label}/${file}`)
  ? `<figure><figcaption>${caption}</figcaption><a href="r-a/${label}/${file}" target="_blank"><img loading="lazy" src="r-a/${label}/${file}"></a></figure>`
  : `<figure><figcaption>${caption}</figcaption><div class="none">—</div></figure>`
const rows = names.map((f) => `<div class="row"><h3>${f.replace('.png', '')}</h3><div class="pair trio">${cols.map((c) => fig(c, f)).join('')}</div></div>`).join('')
const section = `<section id="r-a"><h2>R-a 框架與聊天（v2 重新套用）</h2><style>.trio{grid-template-columns:1fr 1fr 1fr}</style>${rows}</section>`

let html = readFileSync(`${root}/index.html`, 'utf-8')
html = html.replace(/<section id="r-a">[\s\S]*?<\/section>/, '').replace(/<a href="#r-a">[^<]*<\/a>/, '')
html = html.replace('</nav>', `<a href="#r-a">R-a 框架與聊天（${names.length}）</a></nav>`)
html = html.replace('</main>', `${section}</main>`)
writeFileSync(`${root}/index.html`, html)
console.log(`r-a: ${names.length} rows`)
```

- [ ] **Step 5: Build the section**

Run: `node e2e-shots/r-a/section.mjs`
Expected: `r-a: 32 rows`. Optionally show it on Windows (no WSLg): `powershell.exe -NoProfile -Command "Start-Process 'C:\D\saka-verify\shots\index.html'"`.

- [ ] **Step 6: Review the shots** — for every row compare `after` with `base` and note in the PR body any place where `after` is still neutral where `base` had colour, or differs from the decisions D1–D8. Fix in a follow-up task before asking for review; do not commit the shots.

- [ ] **Step 7: Remove the base worktree**

Run: `cd /home/xtorker/repos/Project-Saka/SakaDesk && git worktree remove ../SakaDesk-e4e4118 --force`
Expected: `git worktree list` shows only the main tree.

---

## Self-review notes

- Spec coverage: §4 contexts → Tasks 6–13 (brand scope on the rail, group context elsewhere, popup group scope); §5 restore inventory → hover/selection/unread glow (Tasks 8, 10), modal/menu accents (Tasks 4, 9, 10), gradient buttons already in primitives (unread arrows); §6 `lang="ja"` + tabular numbers → Tasks 8–13; §7 radius → Tasks 3, 4; §8 states (disabled keeps colour + reason) → Task 4, 9; §12 untouched. Cross-cutting items 1–6 of the brief → Tasks 6–13 (migration + baseline), 6–13 (restore), 8–13 (lang), 2 (IconButton shape), 3 (2xl/3xl), 1 (leftovers). Evidence → Tasks 0, 15.
- Out of scope, untouched: blogs (R-b), other dialogs incl. `FavoritesModal` / `MediaGalleryModal` (they still pass their own group hex to `VoicePlayer`, same value; R-c), entry screens, empty states, celebration wiring, `ErrorBoundary` radius drift (R-d).
- Names used across tasks: `IconButtonShape`, `variant="soft"`, `shape="circle"` (2 → 6, 8); `disabledReason`, `logTarget`, `menu_item_blocked` (4 → 9); `withAlpha`, `ACCENT`, `ACCENT_LOGO` (5 → 10, 11, 13); `bg-header-glass` / `bg-header-shade` / `bg-group-title-tint` / `bg-group-title-wash` (5 → 9); `*-group-shelter-*` (5 → 10); `ring-accent-border` (5 → 10); `ChatHeaderPill tone` (9).
