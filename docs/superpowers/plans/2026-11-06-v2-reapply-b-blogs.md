# Design language v2 re-apply, part R-b (blogs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every blog screen (feed, reader, timeline rail, member select, member timeline, blog photo viewer controls) on the v2 design language: group context throughout, `*-accent-*` utilities instead of the superseded `*-group-*` roles, the pre-D2 (`e4e4118`) colour and L1/L2 expression restored through tokens, Japanese blog content marked `lang="ja"`, circular floating icon buttons, and before/after evidence against `e4e4118`.

**Architecture:** No new mechanism. The foundation and R-a already provide accent roles, `groupScopeStyle`, the primitives, `expressive-orb-*`, `shadow-accent-glow*`, `bg-accent-tonal` and the style/guard ratchets. R-b adds one token (`bg-frost`), one `Pill` change, one `blog_fallback` breadcrumb and two small status-component options, then switches each blog component family over: feed + card (with `DynamicBackground` moved onto the expressive orbs), reader + rail + nav pills, then the two blog dialogs and the viewer check. Every task is guarded by unit tests, the guard ratchet (`guard-baseline.json` only goes down) and the style ratchets (`blogScreens.style.test.ts`, `core/dialogs.style.test.ts`).

**Tech Stack:** React 18 + TypeScript, Tailwind 3 (utilities read `var(--ds-*)`), Vitest + Testing Library, Playwright (headless, e2e and screenshots), FastAPI backend (`backend/api/client_log.py`, pytest).

Spec (governs): `docs/superpowers/specs/2026-11-05-design-language-v2-design.md`: §4 (blogs are GROUP context), §5 (the feed is an L2 atmosphere screen; restore inventory), §7 (radius), §8 (states), §12 (accepted deviations: never "fix" them). Current system: `docs/design/DESIGN_SYSTEM.md`. D2b structure (kept): `docs/superpowers/specs/2026-11-05-d2b-blogs-design.md`. Model plan: `docs/superpowers/plans/2026-11-05-v2-reapply-a-frame-chat.md`.

---

## Decisions needed from the user

> **Resolved 2026-11-06:** the user accepted D1, D2, D5, D6 as recommended, and D3/D4 with the oshi override below.
> **OSHI OVERRIDE (user, 2026-11-06) — applies to D3/D4 and supersedes their heart/Favorite parts.** Hearts and the "Favorite" filter mean 推 (oshi), a fixed meaning, NOT the group accent. New rule "semantic over context": elements with a fixed meaning keep their meaning colour in every context. Add a global semantic token set `color.semantic.oshi` = harmonized hot pink (from the original `#ff69b4`): `subtle #fff0f8`, `border #ffcbe1`, `solid #de5f99` (white glyph 3.4:1, icon use), `text #aa376f` (6.0:1 on white, 5.5:1 on subtle); emit `--ds-semantic-oshi-*` and utilities `bg-semantic-oshi-subtle`, `bg-semantic-oshi-solid`, `border-semantic-oshi`, `text-semantic-oshi`, `fill-semantic-oshi` as needed (register in classnames.ts, cover in tailwindTokens.test.ts). Uses: (1) MemberSelectModal favourite heart badge — set: white heart on `bg-semantic-oshi-solid`; unset: outline heart `text-semantic-oshi` on the white badge; (2) the blog feed All / Favorite toggle: `Pill` gets `tone?: 'accent' | 'oshi'` (default accent); the Favorite pill uses `tone="oshi"` (selected = `bg-semantic-oshi-subtle text-semantic-oshi ring-semantic-oshi`-style border), "All" stays accent; any other heart that means 推 uses oshi. NOT oshi: About's "made with love" heart (keep `decor.heart`), the chat message star uses its own yellow (see STAR OVERRIDE). Other D3/D4 items (non-heart placeholder / hover / generic Pill selected = accent) stay as recommended. Docs task: add the "semantic over context" rule + oshi set to DESIGN_SYSTEM.md and spec §3.4.


The user's rule: any change to the original design (`e4e4118`) that the spec has not decided, any D2b structural decision, any off-logo colour and any contrast problem not already accepted is asked first. These came up while mapping R-b. The tasks assume the **recommendation**; steps that depend on one are marked `(pending decision D<n>)`. If the user picks another option, only those steps change.

**D1 — Frosted glass on the feed header.** `RecentPostsFeed.tsx`, `core/common/DynamicBackground.tsx`, `design/tokens/ambient.ts`.
- `e4e4118`: a frosted white header bar (`rgba(255,255,255,.72)` + blur 20 px) over the orbs; orb 1 at 0.4 / 0.5 / 0.5 / 0.45 (Hinatazaka / Sakurazaka / Nogizaka / Yodel).
- Now (D2b decision 6 + 9a): no bar, the header sits on the sheet; orb 1 raised by 0.1 to make up for the lost glass.
- Spec §5 defines L2 as "orbs + frosted glass" for the blog feed, but D2b explicitly dropped the bar.
- Options: (a) glass bar on the feed header only (the reader is an L0 reading surface: no glass) and undo the +0.1 on orb 1; (b) keep D2b (no bar, stronger orb 1); (c) glass on the feed header and the reader breadcrumb bar (as at `e4e4118`).
- **Recommendation: (a).** Restores the L2 pairing the spec names without putting a tinted bar over reading text.

**D2 — Blog card caption.** `BlogCard.tsx`.
- `e4e4118`: a full-bleed 3:4 photo with a small glass label hanging off the bottom-right corner (date, serif title, member), a radial colour aura behind the card on hover and a 3 px logo-colour focus ring.
- Now (D2b decision 8): caption inside the card below the photo; hover is a 4 px lift only; focus ring in the group colour.
- Options: (a) keep D2b's structure and restore the colour: hover glow (`hover:shadow-accent-glow-hover`, the spec's "hover glow on interactive cards"), the soft tinted placeholder (`bg-expressive-soft`) behind the photo, accent focus ring; (b) bring the hanging glass label back; (c) keep today's neutral card.
- **Recommendation: (a).** Colour and glow come back, the structure D2b settled stays.

**D3 — `Pill` selected state.** `design/primitives/Pill.tsx` (used by the feed's All / Favorite toggle and by `DiagnosticsModal`).
- `e4e4118`: the active toggle is a white pill with hot-pink text (`#ff69b4`, off-logo) on a grey track.
- Now: `Pill selected` is neutral (`bg-sunken text-primary`), documented "never the group colour"; spec §8 says selected = `accent-subtle` background + `accent-border` + `accent-strong` text.
- Options: (a) selected pills follow spec §8 (accent roles; ink in Diagnostics, group colour in blogs); (b) neutral stays; (c) keep the original pink.
- **Recommendation: (a).**

**D4 — Off-logo colours in the member select dialog.** `MemberSelectModal.tsx`.
- `e4e4118`: favourite heart badge in hot pink `#ff69b4` (white heart on pink when set); avatar placeholder `from-sky-50 to-sky-100`, initial `text-sky-400`, name hover `text-sky-600` (sky is Hinatazaka-only; wrong for Sakurazaka / Nogizaka).
- Now: neutral (heart `fill-current text-primary`, `bg-sunken`, name hover `text-primary`).
- Options: (a) map to the accent roles: heart filled `text-accent` on the white badge, placeholder `bg-accent-subtle` + `text-accent-strong`, hover `text-accent-strong`; (b) neutral stays; (c) restore pink and sky literally.
- **Recommendation: (a).** Same shape and behaviour, one colour per group, no off-logo hue.

**D5 — Feed title contrast.** `RecentPostsFeed.tsx` (`text-group-title`, the official title colour on the white sheet, 20 px semibold).
- `e4e4118` and now: the same official colour. Contrast on white: Hinatazaka 3.3, Sakurazaka 2.4, Nogizaka 9.2, Yodel 5.0. Sakurazaka is below the 3:1 large-text bar. D2b accepted it as a controller decision; the spec's §12 does not list it.
- Options: (a) keep and record it in §12 next to the chat-header deviation; (b) use `text-accent-strong` (readable, loses the official colour); (c) keep without recording.
- **Recommendation: (a).**
- Superseded 2026-11-06: premise wrong — e4e4118 used r.strong; title restored to accent-strong, no deviation.

**D6 — Timeline rail effects.** `TimelineRail.tsx`.
- `e4e4118`: a tinted "light through a lens" gradient over the zoomed track, the hover ring in the logo colour when zoomed (grey otherwise), a tooltip with a logo-colour glow. D2b decision 14 removed the lens.
- Options: (a) restore the ring colour (`border-accent` when zoomed) and the tooltip glow (`shadow-accent-glow`), keep the lens gone (an effect, not a lost colour); (b) restore the lens too; (c) leave the rail neutral.
- **Recommendation: (a).**

No other conflicts were found. Already settled and therefore **not** asked: group context for the blog dialogs (§4: they inherit); the reader's penlight wash stays as member data (D2b 5a); search-mark colours; the Modal expressive header (foundation); disabled/loading rules (§8); floating = circle, inline = 12 px (the user's rule); `decoration-group` (link underline) is the official layer and stays.

---

## Global Constraints

- Work in `/home/xtorker/repos/Project-Saka/SakaDesk` on branch `feat/v2-reapply-b` (from `dev` at `4b52636`). Frontend commands run from `frontend/`: one file `npx vitest run <path>`, full suite `npm run test:run`, types `npx tsc --noEmit`, lint `npm run lint`. Backend tests from the repo root: `uv run pytest backend/tests/<file> -q`.
- Commit from the repo root with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Conventional Commits (`docs/DOC_FORMATS.md`): `type(scope): subject`, imperative, whole line <= 72 chars, no trailing period. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (second `-m`).
- Hex / `rgb()` literals only inside `src/design/tokens/`. No named palette classes (`bg-gray-100`, `text-white`, `bg-black/40`) and no inline `color` / `background` / `boxShadow` in files a task touches; no arbitrary radius/shadow/text/spacing values; no `rounded-2xl` / `rounded-3xl`.
- Context table (spec §4): blogs (feed, reader, member select, timeline) = group context; the dialogs inherit from the blog screen; the blog photo gallery viewer = no context (dark; controls only). The reader's member penlight wash is member data and stays inline (`memberWashStyle`).
- Expression (spec §5): the feed is L2 (orbs + frosted glass, per D1); the reader body is L0 (no tint on the sheet); L1 on interactive elements (gradient button, hover glow, accent selection, gradient dialog header from `Modal`). Large surfaces stay white.
- Spec §12 deviations stay as they are (primary gradient contrast, Hinatazaka `#389DD1`, Sakurazaka white header, chat header pills).
- Radius steps: xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full 9999. Floating icon buttons (viewer overlay controls) are circles; inline icon buttons (reader back, dialog close) keep `rounded-md` (12 px).
- Japanese content is marked `lang="ja"`: post titles (card, reader h1, breadcrumb, nav pills, rail tooltip, timeline rows), post bodies, member names (card, reader, member select, timeline title). UI chrome (dates, "Latest Blogs", button labels) is never marked.
- Every new utility is registered in `frontend/src/utils/classnames.ts`. A file whose guard count drops gets its `guard-baseline.json` entry lowered (or removed at 0) **in the same commit**: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts`, then check `git diff src/design/guard-baseline.json` shows only decreases/removals.
- Logging: every new decision/failure path logs `clientLog(event, fields)`; values match `^[a-z0-9_]{1,40}$`, never names, titles or text. A new event goes into both `frontend/src/utils/clientLog.ts` (`ClientLogEvent`) and `backend/api/client_log.py` (`ClientEvent`), with a pytest case.
- i18n: no hard-coded user-facing strings. This part adds none (the labels already exist); if a step adds a key it goes into all five locales `frontend/src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json`.
- Screenshots and e2e run headless (Playwright CLI). Never open a WSLg window; to show a page on Windows use `powershell.exe -NoProfile -Command "Start-Process '<windows path>'"`.
- Docs and code comments in English.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `frontend/e2e/r-b-screens.spec.ts` (new) | capture-only shots of every blog screen, 3 groups with blogs | 0 |
| `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py` | `blog_fallback` event | 1 |
| `frontend/src/design/tokens/color.ts`, `tailwind.config.js`, `utils/classnames.ts`, `design/rBTokens.test.ts` (new) | `bg-frost` token | 1 |
| `frontend/src/design/primitives/Pill.tsx`, `Pill.test.tsx` (new) | accent selected state (D3) | 1 |
| `features/blogs/components/BlogStatus.tsx`, `core/common/DialogStatus.tsx` | accent spinner, danger / soft tiles, primary retry | 1 |
| `core/common/DynamicBackground.tsx`, `design/tokens/ambient.ts` | expressive orbs; orb 1 back to `e4e4118` (D1) | 2 |
| `features/blogs/components/RecentPostsFeed.tsx`, `BlogCard.tsx` | glass header, gradient button + glow, card glow, `lang="ja"` | 2 |
| `features/blogs/memberWash.ts`, `components/BlogReader.tsx`, `blogProse.ts`, `BlogNavFooter.tsx`, `TimelineRail.tsx` | reader, rail and nav pills | 3 |
| `features/blogs/components/MemberSelectModal.tsx`, `MemberTimelineModal.tsx`, `BlogPhotoGalleryModal.tsx` | dialogs, viewer check | 4 |
| `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md` | zero-drift docs | 5 |
| `/mnt/c/D/saka-verify/shots/r-b/`, `index.html` | before/after page | 6 |

`frontend/src/features/blogs/blogScreens.style.test.ts` already lists the feed, card, reader, rail and nav files; `core/dialogs.style.test.ts` already lists the three dialogs. No new entries are needed.

---

### Task 0: Capture spec and the "base" and "dev" shots

**Files:**
- Create: `frontend/e2e/r-b-screens.spec.ts`

**Interfaces:**
- Consumes: `pinBlogs` from `frontend/e2e/fixtures/blogs.ts`, `TZ` from `fixtures/bigRoom.ts`.
- Produces: `frontend/e2e-shots/r-b/{base,dev}/*.png` (git-ignored), copied to `/mnt/c/D/saka-verify/shots/r-b/{base,dev}/`. Task 6 adds `after`.

- [ ] **Step 1: Write the capture spec** — `frontend/e2e/r-b-screens.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test'
import { TZ } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Captures (does not compare) every blog screen of the three groups with blogs, so the v2
// re-apply can be reviewed against the pre-D2 look. The same spec runs on three builds:
//   SHOT_LABEL=base  - e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   - dev before R-b
//   SHOT_LABEL=after - this branch at the end
//   SHOT_LABEL=after npx playwright test e2e/r-b-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-b/<label>/ (git-ignored). Yodel has no blogs.

const LABEL = process.env.SHOT_LABEL
const SERVICES = ['hinatazaka46', 'sakurazaka46', 'nogizaka46'] as const

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')

async function shot(page: Page, name: string, parkPointer = true) {
  // Park the pointer on the canvas below the sheet so no hover state is captured by accident.
  if (parkPointer) await page.mouse.move(1000, 797)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `e2e-shots/r-b/${LABEL}/${name}.png`, animations: 'disabled' })
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
})

for (const service of SERVICES) {
  test(`${service}: feed, hover states, reader and rail`, async ({ page }) => {
    await pinBlogs(page, { service })
    await page.goto('/')
    const card = page.getByRole('button', { name: /春の日記 42/ })
    await expect(card).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Checking for updates...')).toHaveCount(0)
    await shot(page, `${service}-feed`)

    await card.hover()
    await shot(page, `${service}-feed-card-hover`, false)
    await page.getByRole('button', { name: 'Select Member' }).hover()
    await shot(page, `${service}-feed-button-hover`, false)

    await card.click()
    await expect(page.getByRole('heading', { level: 1, name: '春の日記 42 🌸' })).toBeVisible()
    await expect(page.getByRole('button', { name: /春の日記 41/ })).toBeVisible()
    await shot(page, `${service}-reader`)

    const rail = page.getByTestId('timeline-rail')
    const box = (await rail.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + 30 + 0.3 * (box.height - 60))
    await expect(page.getByText('#30', { exact: true })).toBeVisible()
    await page.waitForTimeout(1000) // the dwell zoom is 800 ms
    await shot(page, `${service}-rail`, false)
  })

  test(`${service}: member select and member timeline`, async ({ page }) => {
    await pinBlogs(page, { service })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /春の日記 42/ })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Select Member' }).click()
    // The member cell is a button on dev and a div on e4e4118: match by text.
    await expect(page.getByText(/春野/).first()).toBeVisible()
    await shot(page, `${service}-member-select`)
    await page.getByText(/春野/).first().click()
    await expect(page.getByText(/春の日記 42/).first()).toBeVisible()
    await shot(page, `${service}-member-timeline`)
  })
}

test('hinatazaka46: empty feed', async ({ page }) => {
  await pinBlogs(page, { recent: 'empty' })
  await page.goto('/')
  await expect(page.getByText('No blog posts found')).toBeVisible({ timeout: 10000 })
  await shot(page, 'hinatazaka46-feed-empty')
})

test('hinatazaka46: error feed', async ({ page }) => {
  await pinBlogs(page, { recent: 'error' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 10000 })
  await shot(page, 'hinatazaka46-feed-error')
})
```

- [ ] **Step 2: Check it skips without a label**

Run (from `frontend/`): `npx playwright test e2e/r-b-screens.spec.ts --reporter=line`
Expected: `8 skipped`.

- [ ] **Step 3: Make sure nothing else serves port 8000, then capture "dev"**

Run: `ss -ltn | grep ':8000 ' || echo free`; expected `free`. Then (from `frontend/`): `npm run build && mkdir -p e2e-shots/r-b/dev && SHOT_LABEL=dev npx playwright test e2e/r-b-screens.spec.ts --reporter=line`
Expected: `8 passed`; 20 PNGs in `e2e-shots/r-b/dev/`.

- [ ] **Step 4: Capture "base" from the `e4e4118` worktree**

The worktree `../SakaDesk-e4e4118` exists. Copy the spec and the two fixtures in (untracked there, never committed): `cp frontend/e2e/r-b-screens.spec.ts ../SakaDesk-e4e4118/frontend/e2e/ && cp frontend/e2e/fixtures/blogs.ts frontend/e2e/fixtures/bigRoom.ts ../SakaDesk-e4e4118/frontend/e2e/fixtures/`. Then run from `../SakaDesk-e4e4118/frontend`: `npm ci && npm run build && mkdir -p e2e-shots/r-b/base && SHOT_LABEL=base npx playwright test e2e/r-b-screens.spec.ts --reporter=line`.
Expected: all pass. If a selector misses on `e4e4118` (old DOM), fix only that locator in the worktree copy (a shot may be left out; the page shows a `-` cell); do not touch the repo spec.
Copy results: `mkdir -p /mnt/c/D/saka-verify/shots/r-b && cp -r e2e-shots/r-b/base /mnt/c/D/saka-verify/shots/r-b/ && cp -r /home/xtorker/repos/Project-Saka/SakaDesk/frontend/e2e-shots/r-b/dev /mnt/c/D/saka-verify/shots/r-b/`.

- [ ] **Step 5: Commit the spec**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk && git add frontend/e2e/r-b-screens.spec.ts
uv run git commit -m "test(e2e): add capture spec for the R-b blog screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Shared pieces: breadcrumb event, `bg-frost`, accent `Pill`, status tiles (pending decision D3)

> **STAR OVERRIDE (user, 2026-11-06).** The chat message favourite star (bookmarked message, `MessageBubble.tsx` `favoriteStar`, currently `fill-current text-accent`) returns to its original yellow, under the same "semantic over context" rule: add `color.semantic.star = '#facc15'` (the original Tailwind yellow-400 from before commit 9854a52), emit `--ds-semantic-star`, utility `text-semantic-star` (register in classnames.ts text-color, cover in tailwindTokens.test.ts), and render the star as `fill-current text-semantic-star drop-shadow-sm` (drop-shadow as in the original, for definition on white). Same yellow in every group. Update the MessageBubble test that asserts the star class. Include this in Task 1's commit (or a separate `fix(chat): bring back the yellow favourite star` commit in Task 1).

> **OSHI OVERRIDE (user, 2026-11-06) — applies to D3/D4 and supersedes their heart/Favorite parts.** Hearts and the "Favorite" filter mean 推 (oshi), a fixed meaning, NOT the group accent. New rule "semantic over context": elements with a fixed meaning keep their meaning colour in every context. Add a global semantic token set `color.semantic.oshi` = harmonized hot pink (from the original `#ff69b4`): `subtle #fff0f8`, `border #ffcbe1`, `solid #de5f99` (white glyph 3.4:1, icon use), `text #aa376f` (6.0:1 on white, 5.5:1 on subtle); emit `--ds-semantic-oshi-*` and utilities `bg-semantic-oshi-subtle`, `bg-semantic-oshi-solid`, `border-semantic-oshi`, `text-semantic-oshi`, `fill-semantic-oshi` as needed (register in classnames.ts, cover in tailwindTokens.test.ts). Uses: (1) MemberSelectModal favourite heart badge — set: white heart on `bg-semantic-oshi-solid`; unset: outline heart `text-semantic-oshi` on the white badge; (2) the blog feed All / Favorite toggle: `Pill` gets `tone?: 'accent' | 'oshi'` (default accent); the Favorite pill uses `tone="oshi"` (selected = `bg-semantic-oshi-subtle text-semantic-oshi ring-semantic-oshi`-style border), "All" stays accent; any other heart that means 推 uses oshi. NOT oshi: About's "made with love" heart (keep `decor.heart`), the chat message star uses its own yellow (see STAR OVERRIDE). Other D3/D4 items (non-heart placeholder / hover / generic Pill selected = accent) stay as recommended. Docs task: add the "semantic over context" rule + oshi set to DESIGN_SYSTEM.md and spec §3.4.

**Files:**
- Modify: `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py`
- Modify: `frontend/src/design/tokens/color.ts`, `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts`
- Create: `frontend/src/design/rBTokens.test.ts`, `frontend/src/design/primitives/Pill.test.tsx`
- Modify: `frontend/src/design/primitives/Pill.tsx`, `frontend/src/features/blogs/components/BlogStatus.tsx` (+ test), `frontend/src/core/common/DialogStatus.tsx`

**Interfaces:**
- Produces: `ClientLogEvent` `'blog_fallback'` (fields `target`, `reason`); utility `bg-frost`; `Pill` `selected` = accent roles; `DialogStatus` prop `retryVariant?: 'secondary' | 'primary'` (default `'secondary'`); `BlogStatus` retry is `primary`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_client_log_api.py`: add this row to the `parametrize` list of `test_design_system_events_are_accepted` (after `menu_item_blocked`):

```python
        ("blog_fallback", {"target": "card_thumb", "reason": "image_error"}, "info"),
```

`frontend/src/design/rBTokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars } from './cssVars';
import { cn } from '../utils/classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('R-b tokens', () => {
    it('writes the frosted feed header overlay (the pre-D2 white at 72 %)', () => {
        expect(staticTokenVars()['--ds-overlay-frost']).toBe('rgba(255, 255, 255, 0.72)');
    });

    it('registers bg-frost as a colour', () => {
        expect(config).toContain("'frost': 'var(--ds-overlay-frost)'");
        expect(cn('bg-sheet', 'bg-frost')).toBe('bg-frost');
    });
});
```

`frontend/src/design/primitives/Pill.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
    it('selected follows the accent roles (spec section 8): subtle fill, border, strong text', () => {
        render(<Pill selected>All</Pill>);
        const pill = screen.getByRole('button', { name: 'All' });
        expect(pill).toHaveAttribute('aria-pressed', 'true');
        expect(pill).toHaveClass('bg-accent-subtle', 'text-accent-strong', 'ring-accent-border');
        expect(pill).not.toHaveClass('bg-sunken');
    });

    it('unselected stays a quiet white pill', () => {
        render(<Pill>Favorite</Pill>);
        const pill = screen.getByRole('button', { name: 'Favorite' });
        expect(pill).toHaveAttribute('aria-pressed', 'false');
        expect(pill).toHaveClass('bg-pill', 'text-secondary');
    });
});
```

Append to `frontend/src/features/blogs/components/BlogStatus.test.tsx` (inside the `describe`):

```tsx
    it('tints the loading spinner with the accent, the error tile with danger and the empty tile softly', () => {
        const { container, rerender } = render(<BlogStatus kind="loading" title="Loading" />);
        expect(container.querySelector('.animate-spin')).toHaveClass('text-accent');
        rerender(<BlogStatus kind="error" title="Failed" icon={<svg data-testid="i" />} />);
        expect(screen.getByTestId('i').parentElement).toHaveClass('bg-semantic-danger-icon', 'text-semantic-danger');
        rerender(<BlogStatus kind="empty" title="None" icon={<svg data-testid="i" />} />);
        expect(screen.getByTestId('i').parentElement).toHaveClass('bg-expressive-soft', 'text-accent-strong');
    });

    it('draws the retry as the gradient primary button', () => {
        render(<BlogStatus kind="error" title="Failed" onRetry={() => {}} retryLabel="Retry" />);
        expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('bg-accent-gradient');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest backend/tests/test_client_log_api.py -q -k design_system_events` (expect a failure for `blog_fallback`), then from `frontend/`: `npx vitest run src/design/rBTokens.test.ts src/design/primitives/Pill.test.tsx src/features/blogs/components/BlogStatus.test.tsx`
Expected: FAIL (token missing, classes missing).

- [ ] **Step 3: Implement the event** — `frontend/src/utils/clientLog.ts`: change the last union member to `| 'menu_item_blocked' | 'blog_fallback';`. `backend/api/client_log.py`: add `"blog_fallback",` after `"menu_item_blocked",` in `ClientEvent`'s literal list. `target` and `reason` are already allowed field keys.

- [ ] **Step 4: Implement `bg-frost`** — `color.ts` `overlay`: add after `shade`

```ts
        /** Frosted bar over the blog feed's orbs (L2): the pre-D2 white at 72 %. */
        frost: 'rgba(255, 255, 255, 0.72)',
```

`tailwind.config.js`: add next to `'header-shade'`: `'frost': 'var(--ds-overlay-frost)',`. `utils/classnames.ts`: add `'frost'` to the `bg-color` list (`bg: ['accent', ..., 'frost']`).

- [ ] **Step 5: Implement `Pill`** (D3) — `Pill.tsx`: replace the doc comment `/** Selected tab/filter. Neutral emphasis — never the group colour. */` with `/** Selected tab/filter: the accent roles (spec section 8). */` and the `selected ?` branch with:

```tsx
                selected
                    ? 'bg-accent-subtle font-semibold text-accent-strong ring-1 ring-inset ring-accent-border'
                    : 'bg-pill text-secondary hover:text-primary',
```

- [ ] **Step 6: Implement the status tiles**

`BlogStatus.tsx`: loading icon class `text-muted` -> `text-accent`; the tile:

```tsx
        ) : icon ? (
            <div
                aria-hidden="true"
                className={cn('rounded-card p-5', kind === 'error' ? 'bg-semantic-danger-icon text-semantic-danger' : 'bg-expressive-soft text-accent-strong')}
            >
                {icon}
            </div>
        ) : null}
```

and the retry `<Button variant="primary" size="sm" ...>`. Update the component doc comment to "(accent spinner, danger error tile; errors are alerts)".
`DialogStatus.tsx`: add `retryVariant?: 'secondary' | 'primary'; // default secondary` to the props (destructure with default `'secondary'`), spinner `text-muted` -> `text-accent`, `<Button variant={retryVariant} size="sm" ...>`, and the tile `className={cn('flex rounded-card p-4 [&_svg]:h-8 [&_svg]:w-8', kind === 'error' ? 'bg-semantic-danger-icon text-semantic-danger' : 'bg-expressive-soft text-accent-strong')}`.

- [ ] **Step 7: Run to verify they pass, plus every `Pill` / `DialogStatus` user**

Run: `uv run pytest backend/tests/test_client_log_api.py -q`; from `frontend/`: `npx vitest run src/design src/core src/features/blogs && npx tsc --noEmit`
Expected: PASS. If a snapshot or a `DiagnosticsModal` / dialog test asserts the old neutral classes, update the expectation to the new roles (that is decision D3 / the tile change, not a regression).

- [ ] **Step 8: Commit**

```bash
git add backend frontend/src frontend/tailwind.config.js
uv run git commit -m "feat(ui): add frost token, accent Pill and blog_fallback event" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Blog feed and card: L2 atmosphere, glass header, gradient button, hover glow (pending decisions D1, D2, D5)

**Files:**
- Modify: `frontend/src/core/common/DynamicBackground.tsx` (+ `.test.tsx`), `frontend/src/design/tokens/ambient.ts`, `frontend/src/design/d2bTokens.test.ts`
- Modify: `frontend/src/features/blogs/components/RecentPostsFeed.tsx`, `BlogCard.tsx` (+ their tests), `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `bg-frost`, `Pill`, `BlogStatus` (Task 1), `bg-expressive-orb-1/2/3`, `Button variant="tonal"`, `shadow-accent-glow-hover`, `bg-expressive-soft`, `clientLog('blog_fallback', ...)`.
- Produces: `DynamicBackground` drawing `bg-expressive-orb-N` (so it also works in brand context) with the per-group size/opacity variables unchanged; no API change.

- [ ] **Step 1: Write the failing tests**

`DynamicBackground.test.tsx`: replace both `bg-group-ambient-${n}` / `.bg-group-ambient-3` lookups with `bg-expressive-orb-${n}` / `.bg-expressive-orb-3` (the size/opacity `var(--ds-group-ambient-N-...)` class assertions stay).

`d2bTokens.test.ts` line 43: change `opacity: 0.5` to `opacity: 0.4` (Hinatazaka orb 1 back to `e4e4118`) and add

```ts
    it('orb 1 is back at its pre-D2 strength now that the feed header is frosted glass again (D1)', () => {
        expect([
            ambientLayout.hinatazaka.orb1.opacity, ambientLayout.sakurazaka.orb1.opacity,
            ambientLayout.nogizaka.orb1.opacity, ambientLayout.yodel.orb1.opacity, ambientLayout.default.orb1.opacity,
        ]).toEqual([0.4, 0.5, 0.5, 0.45, 0.4]);
    });
```

`BlogCard.test.tsx` (add; the file already mocks `memberData`; add `vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));` and `import { clientLog } from '../../../utils/clientLog';` at the top):

```tsx
describe('BlogCard v2 look', () => {
  it('glows on hover with the accent, focuses with the accent ring and rests on a soft tint', () => {
    const { container } = render(<BlogCard post={makePost({ thumbnail: null })} onClick={() => {}} />);
    const card = screen.getByRole('button');
    expect(card).toHaveClass('hover:shadow-accent-glow-hover', 'focus-visible:ring-accent');
    expect(container.querySelector('.bg-expressive-soft')).not.toBeNull();
  });

  it('marks the Japanese title and member name, not the date', () => {
    render(<BlogCard post={makePost({ title: '春の日記', member_name: '佐々木 久美' })} onClick={() => {}} />);
    expect(screen.getByText('春の日記')).toHaveAttribute('lang', 'ja');
    expect(screen.getByText('佐々木 久美')).toHaveAttribute('lang', 'ja');
    expect(screen.getByText('佐々木 久美')).toHaveClass('text-accent-strong');
    expect(document.querySelector('.text-caption.text-muted')).not.toHaveAttribute('lang');
  });

  it('breadcrumbs a broken thumbnail', () => {
    const { container } = render(<BlogCard post={makePost({})} onClick={() => {}} />);
    fireEvent.error(container.querySelector('img')!);
    expect(clientLog).toHaveBeenCalledWith('blog_fallback', { target: 'card_thumb', reason: 'image_error' });
  });
});
```

`RecentPostsFeed.test.tsx` (add; use the file's existing render helper, named `renderFeed` below, or build the props inline as the other tests in that file do):

```tsx
  it('puts the header on frosted glass and draws the select-member button as the tonal gradient with a hover glow', () => {
    renderFeed();
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('bg-frost', 'backdrop-blur-lg');
    const button = screen.getByRole('button', { name: 'Select Member' });
    expect(button).toHaveClass('bg-accent-tonal', 'hover:bg-accent-gradient', 'hover:shadow-accent-glow-hover');
  });

  it('shows the selected All / Favorite pill in the accent roles', () => {
    renderFeed();
    expect(screen.getByRole('button', { name: 'All' })).toHaveClass('bg-accent-subtle', 'text-accent-strong');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/core/common/DynamicBackground.test.tsx src/design/d2bTokens.test.ts src/features/blogs/components/BlogCard.test.tsx src/features/blogs/components/RecentPostsFeed.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the orbs** — `DynamicBackground.tsx`: in `ORBS` replace `bg-group-ambient-1` / `-2` / `-3` with `bg-expressive-orb-1` / `-2` / `-3` (keep every other class), and change the header comment to "Ambient orbs behind the blog feed (L2 atmosphere, spec section 5): the context's `expressive` orb colours, with the per-group size and opacity from `--ds-group-ambient-N-*` (`design/tokens/ambient.ts`)." `ambient.ts` (pending decision D1): orb 1 opacity `0.5 -> 0.4` (hinatazaka), `0.6 -> 0.5` (sakurazaka), `0.6 -> 0.5` (nogizaka), `0.55 -> 0.45` (yodel), `0.5 -> 0.4` (default); in the doc comment delete "orb 1 is 0.1 stronger than there, to make up for the tinted glass header it replaced" and write "orb 1 is at its pre-D2 strength (the feed header is frosted glass again)".

- [ ] **Step 4: Implement the feed header and button** — `RecentPostsFeed.tsx`: the header opening tag (pending decision D1):

```tsx
            <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 bg-frost px-6 pb-3 pt-5 backdrop-blur-lg">
```

(`z-10` keeps the glass above the scrolling grid; the scroll area below stays `relative`.) The Select member button (spec restore inventory: gradient + hover glow; at rest the tonal gradient stands in for the old 15 % / 10 % tint):

```tsx
                    <Button
                        variant="tonal"
                        size="sm"
                        className="hover:bg-accent-gradient hover:text-inverse hover:shadow-accent-glow-hover"
                        onClick={onMemberSelect}
                    >
```

The title keeps `text-group-title` (D5; the official layer). Update the file's header comment: "the group's expressive orbs behind a frosted header and a card grid".

- [ ] **Step 5: Implement the card** — `BlogCard.tsx`: add `import { clientLog } from '../../../utils/clientLog';`, then (pending decision D2 (a); with (b) the caption would move back over the photo's corner):

```tsx
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'group flex aspect-[3/4] w-full flex-col overflow-hidden rounded-card bg-card text-left shadow-card',
                'transition duration-base ease-standard hover:-translate-y-1 hover:shadow-accent-glow-hover motion-reduce:transform-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
        >
            <span className="relative block min-h-0 flex-1 overflow-hidden bg-expressive-soft">
                {post.thumbnail && !imageError && (
                    <img
                        src={post.thumbnail}
                        alt=""
                        loading="lazy"
                        onLoad={() => setImageLoaded(true)}
                        onError={() => {
                            setImageError(true);
                            clientLog('blog_fallback', { target: 'card_thumb', reason: 'image_error' });
                        }}
                        className={cn(
                            'absolute inset-0 h-full w-full object-cover object-top',
                            'transition duration-base ease-standard group-hover:scale-105 motion-reduce:transform-none',
                            imageLoaded ? 'opacity-100' : 'opacity-0',
                        )}
                    />
                )}
            </span>
            <span className={cn('flex shrink-0 flex-col gap-1', isFeatured ? 'p-4' : 'p-3')}>
                <span className="text-caption text-muted">
                    {formatBlogDate(new Date(post.published_at), i18n.language, 'short')}
                </span>
                <span lang="ja" className={cn('line-clamp-2 font-reading font-semibold text-primary', isFeatured ? 'text-title' : 'text-small')}>
                    {post.title}
                </span>
                <span lang="ja" className="truncate text-caption font-semibold text-accent-strong">
                    {getMemberNameKanji(post.member_name)}
                </span>
            </span>
        </button>
```

- [ ] **Step 6: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/core/common src/design src/features/blogs && npx tsc --noEmit`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `features/blogs/components/BlogCard.tsx` removed (2 -> 0); only decreases/removals.

- [ ] **Step 7: Commit**

```bash
git add frontend
uv run git commit -m "feat(blogs): restore the feed's orbs, glass header and card glow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Blog reader, nav pills and timeline rail: accent roles, `lang="ja"`, member wash breadcrumb (pending decision D6)

**Files:**
- Modify: `frontend/src/features/blogs/memberWash.ts` (+ `memberWash.test.ts`), `components/BlogReader.tsx`, `blogProse.ts`, `BlogNavFooter.tsx`, `TimelineRail.tsx` (+ tests: `BlogReader.test.tsx`, `BlogNavFooter.test.tsx`, `TimelineRail.test.tsx`)
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `clientLog('blog_fallback', ...)` (Task 1).
- Produces: `resolveWash(member, groupId): { style: CSSProperties | undefined; fallback: 'mascot' | 'no_member_data' | null }` (`memberWashStyle` keeps its signature and returns `resolveWash(...).style`).

- [ ] **Step 1: Write the failing tests**

`memberWash.test.ts` (add, same mock setup as the file):

```ts
import { resolveWash } from './memberWash';

describe('resolveWash', () => {
    it('returns the style and no fallback for a known member', () => {
        expect(resolveWash({ id: '9901', name: '春野 ひなた' }, 'hinatazaka')).toEqual({
            style: { '--ds-member-wash-1': '#5bbee4', '--ds-member-wash-2': '#f2a0c0' },
            fallback: null,
        });
    });

    it('names why there is no wash', () => {
        expect(resolveWash({ id: '000', name: 'ポカ' }, 'hinatazaka')).toEqual({ style: undefined, fallback: 'mascot' });
        expect(resolveWash({ id: '1', name: '誰か' }, 'hinatazaka')).toEqual({ style: undefined, fallback: 'no_member_data' });
    });
});
```

`BlogReader.test.tsx` (add; use the file's existing render helper, `renderReader` below, and add `vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }))` with the matching import):

```tsx
  it('marks the post title, member names and body as Japanese and uses the accent roles', async () => {
    const { container } = renderReader();
    const title = await screen.findByRole('heading', { level: 1 });
    expect(title).toHaveAttribute('lang', 'ja');
    for (const name of screen.getAllByRole('button', { name: '春野 ひなた' })) {
      expect(name).toHaveAttribute('lang', 'ja');
      expect(name).toHaveClass('text-accent-strong');
    }
    expect(container.querySelector('article > div[lang="ja"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/-group-(subtle|strong|accent)|ring-group\b/);
  });

  it('breadcrumbs a post that has no member wash', async () => {
    renderReader({ member: { id: '000', name: 'ポカ' } });
    await screen.findByRole('heading', { level: 1 });
    expect(clientLog).toHaveBeenCalledWith('blog_fallback', { target: 'wash', reason: 'mascot' });
  });
```

`BlogNavFooter.test.tsx` (add):

```tsx
    it('glows with the accent on hover, focuses with the accent ring and marks titles as Japanese', () => {
        render(<BlogNavFooter prevBlog={OLDER} nextBlog={NEWER} onPrev={() => {}} onNext={() => {}} />);
        const older = screen.getByRole('button', { name: /春の日記 41/ });
        expect(older).toHaveClass('hover:shadow-accent-glow', 'focus-visible:ring-accent');
        expect(older.querySelector('[lang="ja"]')).not.toBeNull();
    });
```

`TimelineRail.test.tsx` (add; reuse the file's `renderRail` / props as its other tests do):

```tsx
    it('uses the accent for the current dot and no superseded group roles', () => {
        const { container } = renderRail();
        expect(container.querySelector('.bg-accent.shadow-accent-glow')).not.toBeNull();
        expect(container.innerHTML).not.toMatch(/-group-(accent|glow|subtle|strong)/);
    });
```

(For the zoomed ring: reuse the hover event of the file's existing hover test, then assert the `.border-2` element has `border-accent` once zoomed.)

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/features/blogs`
Expected: FAIL in the added tests.

- [ ] **Step 3: Implement `resolveWash`** — `memberWash.ts`: replace `memberWashStyle` with the following (keep the existing doc comment above `memberWashStyle`):

```ts
export type WashFallback = 'mascot' | 'no_member_data';

/** The wash style plus, when there is none, why (for the `blog_fallback` breadcrumb). */
export function resolveWash(
    member: BlogMember,
    groupId: GroupId,
): { style: CSSProperties | undefined; fallback: WashFallback | null } {
    if (isMascot(member)) return { style: undefined, fallback: 'mascot' };
    const data =
        getMemberByName(member.name, groupId) ??
        getMemberByName(member.name.replace(/\s+/g, ''), groupId) ??
        getMemberByBlogId(member.id, groupId);
    if (!data) return { style: undefined, fallback: 'no_member_data' };
    const [first, second] = getMemberPenlightHex(data, groupId);
    return {
        style: { '--ds-member-wash-1': safeHex(first), '--ds-member-wash-2': safeHex(second) } as CSSProperties,
        fallback: null,
    };
}

export function memberWashStyle(member: BlogMember, groupId: GroupId): CSSProperties | undefined {
    return resolveWash(member, groupId).style;
}
```

- [ ] **Step 4: Implement the reader** — `BlogReader.tsx`: add `import { clientLog } from '../../../utils/clientLog';` and `resolveWash` to the memberWash import; replace line 90 with `const { style: washStyle, fallback: washFallback } = resolveWash(member, groupId);` and add after it

```tsx
    useEffect(() => {
        if (washFallback) clientLog('blog_fallback', { target: 'wash', reason: washFallback });
    }, [washFallback, blog.id]);
```

(`useEffect` is already imported in this file; if not, add it.) Breadcrumb member button:

```tsx
                <button
                    type="button"
                    onClick={onMemberClick}
                    lang="ja"
                    className="rounded-pill px-2 py-1 font-semibold text-accent-strong transition-colors duration-fast ease-standard hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
```

Then: `<span lang="ja" className="min-w-0 truncate px-1 text-secondary">{blog.title}</span>`; `<h1 lang="ja" className="font-reading text-heading font-semibold text-primary">`; the in-header member button gets `lang="ja"`, `text-accent-strong` and `focus-visible:ring-accent` (keep `decoration-group`: the official link underline); the body `<div ref={blogContentRef} lang="ja" className={BLOG_PROSE} dangerouslySetInnerHTML=... />`. At `e4e4118` the member name and links were already coloured in the group colour, so this restores it through the accent roles.
`blogProse.ts`: `'[&_a]:text-group-strong [&_a]:underline [&_a]:decoration-group ...'` -> `'[&_a]:text-accent-strong [&_a]:underline [&_a]:decoration-group ...'` and the comment to "the accent-strong text with the official link underline".

- [ ] **Step 5: Implement the nav pills** — `BlogNavFooter.tsx`:

```tsx
const SIDE = cn(
    'pointer-events-auto group flex max-w-[45%] items-center gap-2 rounded-pill bg-pill py-2 shadow-pill',
    'transition duration-fast ease-standard hover:bg-accent-subtle hover:shadow-accent-glow',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
);
const CHEVRON = 'h-4 w-4 shrink-0 text-muted transition-colors duration-fast ease-standard group-hover:text-accent-strong';
```

and in `label()` mark only the Japanese title (the screen-reader prefix stays unmarked):

```tsx
            <span className="block max-w-[160px] truncate text-small font-semibold text-primary">
                <span className="sr-only">{prefix}:</span>{' '}
                <span lang="ja">{truncateTitle(blog.title)}</span>
            </span>
```

- [ ] **Step 6: Implement the rail (pending decision D6)** — `TimelineRail.tsx`: current dot `bg-group-accent shadow-group-glow` -> `bg-accent shadow-accent-glow`; the hover ring `border-strong` -> `isZoomed ? 'border-accent' : 'border-strong'` (keep the `border-2` class and the opacity values the e2e polls); the tooltip `<Card className="... overflow-hidden shadow-accent-glow">`; the tooltip title `<div lang="ja" className="line-clamp-2 font-reading ...">`.

- [ ] **Step 7: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/features/blogs && npx tsc --noEmit`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `BlogNavFooter.tsx`, `blogProse.ts`, `BlogReader.tsx`, `TimelineRail.tsx` lowered or removed; only decreases/removals. Then `grep -rn "group-subtle\|group-strong\|group-accent\|ring-group\b\|group-glow" src/features/blogs --include=*.tsx --include=*.ts | grep -v test` must show only `MemberSelectModal.tsx` and `MemberTimelineModal.tsx` (Task 4).

- [ ] **Step 8: Commit**

```bash
git add frontend
uv run git commit -m "feat(blogs): apply accent roles and lang ja to the reader" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Member select and member timeline dialogs, blog photo viewer controls (pending decision D4)

> **OSHI OVERRIDE (user, 2026-11-06) — applies to D3/D4 and supersedes their heart/Favorite parts.** Hearts and the "Favorite" filter mean 推 (oshi), a fixed meaning, NOT the group accent. New rule "semantic over context": elements with a fixed meaning keep their meaning colour in every context. Add a global semantic token set `color.semantic.oshi` = harmonized hot pink (from the original `#ff69b4`): `subtle #fff0f8`, `border #ffcbe1`, `solid #de5f99` (white glyph 3.4:1, icon use), `text #aa376f` (6.0:1 on white, 5.5:1 on subtle); emit `--ds-semantic-oshi-*` and utilities `bg-semantic-oshi-subtle`, `bg-semantic-oshi-solid`, `border-semantic-oshi`, `text-semantic-oshi`, `fill-semantic-oshi` as needed (register in classnames.ts, cover in tailwindTokens.test.ts). Uses: (1) MemberSelectModal favourite heart badge — set: white heart on `bg-semantic-oshi-solid`; unset: outline heart `text-semantic-oshi` on the white badge; (2) the blog feed All / Favorite toggle: `Pill` gets `tone?: 'accent' | 'oshi'` (default accent); the Favorite pill uses `tone="oshi"` (selected = `bg-semantic-oshi-subtle text-semantic-oshi ring-semantic-oshi`-style border), "All" stays accent; any other heart that means 推 uses oshi. NOT oshi: About's "made with love" heart (keep `decor.heart`), the chat message star uses its own yellow (see STAR OVERRIDE). Other D3/D4 items (non-heart placeholder / hover / generic Pill selected = accent) stay as recommended. Docs task: add the "semantic over context" rule + oshi set to DESIGN_SYSTEM.md and spec §3.4.

**Files:**
- Modify: `frontend/src/features/blogs/components/MemberSelectModal.tsx`, `MemberTimelineModal.tsx` (+ `MemberSelectModal.test.tsx`, `MemberTimelineModal.test.tsx`), `BlogPhotoGalleryModal.test.tsx`
- Modify: `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `DialogStatus retryVariant` (Task 1) and the accent utilities.
- Produces: no API change. The viewer (`MediaViewerModal` in `core/media/PhotoDetailModal.tsx`, restyled in R-a) is verified, not changed, unless Step 5 finds a regression.

- [ ] **Step 1: Write the failing tests**

`MemberSelectModal.test.tsx` (add; reuse the file's `renderModal` / props, its member data and its favourites seeding):

```tsx
    it('uses the accent roles for focus, placeholder, hover name and the favourite heart (D4)', () => {
        renderModal();
        const cell = screen.getAllByRole('button', { name: /春野/ })[0];
        expect(cell).toHaveClass('focus-visible:ring-accent');
        expect(cell.querySelector('.group-hover\\:text-accent-strong')).not.toBeNull();
        const heart = screen.getAllByRole('button', { name: /favorite/i })[0];
        expect(heart).toHaveClass('focus-visible:ring-accent');
        expect(heart.querySelector('svg')).toHaveClass('text-muted');
    });

    it('marks member names as Japanese', () => {
        renderModal();
        expect(screen.getAllByText(/春野/)[0].closest('[lang="ja"]')).not.toBeNull();
    });

    it('fills the heart in the accent once the member is a favourite', () => {
        // Seed the store as the file's other favourite test does (favorites[serviceId] = ['9901']).
        renderModal();
        const heart = screen.getAllByRole('button', { name: /favorite/i }).find((b) => b.getAttribute('aria-pressed') === 'true')!;
        expect(heart.querySelector('svg')).toHaveClass('fill-current', 'text-accent');
    });
```

`MemberTimelineModal.test.tsx` (add):

```tsx
    it('shows the expanded month in the accent, rows hover in accent-subtle and marks titles as Japanese', () => {
        renderModal();
        const month = screen.getAllByRole('button', { expanded: true })[0];
        expect(month.querySelector('.text-accent-strong')).not.toBeNull();
        expect(month.querySelector('.bg-accent')).not.toBeNull(); // the filled chevron chip
        const row = screen.getByRole('button', { name: /今日の日記/ });
        expect(row).toHaveClass('hover:bg-accent-subtle', 'focus-visible:ring-accent');
        expect(screen.getByText('今日の日記 🌸')).toHaveAttribute('lang', 'ja');
    });

    it('titles the dialog with the Japanese member name', () => {
        renderModal();
        expect(screen.getByText('春野 ひなた').closest('[lang="ja"]')).not.toBeNull();
    });
```

`BlogPhotoGalleryModal.test.tsx` (add; open the viewer with the steps the file's existing "opens the viewer" test uses, then):

```tsx
    it('draws the viewer controls as circles on the dark chrome', async () => {
        await openViewer(); // the file's existing steps that click a thumbnail
        expect(screen.getByRole('button', { name: /close/i })).toHaveAttribute('data-shape', 'circle');
        for (const name of [/next/i, /previous/i]) {
            const control = screen.queryByRole('button', { name });
            if (control) expect(control).toHaveAttribute('data-shape', 'circle');
        }
    });
```

(`data-shape` is the `IconButton` marker.)

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/features/blogs/components/MemberSelectModal.test.tsx src/features/blogs/components/MemberTimelineModal.test.tsx src/features/blogs/components/BlogPhotoGalleryModal.test.tsx`
Expected: FAIL for the select and timeline additions; the viewer test passes if R-a left the controls as circles (it locks them).

- [ ] **Step 3: Implement the member select** — `MemberSelectModal.tsx` (pending decision D4 (a)). Pass `retryVariant="primary"` to its error `DialogStatus` (the `e4e4118` retry was the gradient button). The cell button:

```tsx
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectMember(member)}
                                                    className="group flex flex-col items-center gap-3 rounded-card p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                                >
                                                    <span className="block h-20 w-20 overflow-hidden rounded-pill bg-accent-subtle transition duration-base ease-standard group-hover:scale-105 group-hover:shadow-accent-glow motion-reduce:transform-none">
                                                        {thumbnailUrl ? (
                                                            <img src={thumbnailUrl} alt="" loading="lazy" className="h-full w-full scale-[1.15] object-cover object-top" />
                                                        ) : (
                                                            <span aria-hidden="true" lang="ja" className="flex h-full w-full items-center justify-center text-title font-semibold text-accent-strong">
                                                                {member.nameJp.substring(0, 1)}
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span lang="ja" className="text-center text-small tracking-wide text-secondary transition-colors duration-fast ease-standard group-hover:text-accent-strong">
                                                        {formatName(member.nameJp)}
                                                    </span>
                                                </button>
```

The heart button: `focus-visible:ring-accent` instead of `focus-visible:ring-group`, and the icon `className={cn('h-4 w-4', isFavorited ? 'fill-current text-accent' : 'text-muted')}`.

- [ ] **Step 4: Implement the member timeline** — `MemberTimelineModal.tsx`: pass `retryVariant="primary"` to its error `DialogStatus`. Title: `title={<span lang="ja">{memberNameJp}</span>}` (check that `Modal`'s `title` accepts a node; if it is typed `string`, widen it to `React.ReactNode` in `design/primitives/Modal.tsx`, which renders it inside the heading, and keep the Modal's own tests green). Month section (restores `e4e4118`'s expanded colour through roles):

```tsx
            <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center justify-between px-4 py-3 transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
                <span className="flex items-center gap-3">
                    <span className={cn('flex h-6 w-6 items-center justify-center rounded-pill transition-colors duration-base ease-standard', expanded ? 'bg-accent text-inverse' : 'bg-sunken text-secondary')}>
                        <ChevronRight className={cn('h-3 w-3 transition-transform duration-base ease-standard motion-reduce:transition-none', expanded && 'rotate-90')} />
                    </span>
                    <span className={cn('text-body font-semibold', expanded ? 'text-accent-strong' : 'text-secondary')}>{monthLabel}</span>
                </span>
                <span className={cn('rounded-pill px-3 py-1 text-small transition-colors duration-base ease-standard', expanded ? 'bg-accent-subtle text-accent-strong' : 'bg-sunken text-secondary')}>{t('blogs.post', { count: postCount })}</span>
            </button>
```

Blog row: `hover:bg-accent-subtle focus-visible:ring-accent`, the thumbnail `shadow-card group-hover:shadow-accent-glow`, the title `<span lang="ja" className="line-clamp-2 font-reading text-body font-semibold text-primary group-hover:text-accent-strong">`, the recent dot `bg-accent`, the chevron `text-accent-strong`. The month cards stay white `Card`s (large surface, no tint).

- [ ] **Step 5: Verify the viewer controls** — `grep -n "IconButton\|variant=\"overlay\"\|rounded" frontend/src/core/media/PhotoDetailModal.tsx` must show the viewer's close / prev / next as `IconButton variant="overlay"` (circle by default). If any is a hand-made button with `rounded-md` / `rounded-full` classes, replace it with `<IconButton variant="overlay" ... />` (an `aria-label` is required) and keep its handler; the Step 1 viewer test then locks it.

- [ ] **Step 6: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/features/blogs src/design src/core && npx tsc --noEmit`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `MemberSelectModal.tsx` and `MemberTimelineModal.tsx` removed (2 and 7 -> 0); only decreases/removals. Then `grep -rn "group-subtle\|group-strong\|group-accent\|ring-group\b\|group-glow" src/features/blogs --include=*.tsx --include=*.ts | grep -v test` must print nothing.

- [ ] **Step 7: Commit**

```bash
git add frontend
uv run git commit -m "feat(blogs): restore dialog accents and mark member names ja" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Zero-drift docs and changelog

> **STAR OVERRIDE (document it) (user, 2026-11-06).** The chat message favourite star (bookmarked message, `MessageBubble.tsx` `favoriteStar`, currently `fill-current text-accent`) returns to its original yellow, under the same "semantic over context" rule: add `color.semantic.star = '#facc15'` (the original Tailwind yellow-400 from before commit 9854a52), emit `--ds-semantic-star`, utility `text-semantic-star` (register in classnames.ts text-color, cover in tailwindTokens.test.ts), and render the star as `fill-current text-semantic-star drop-shadow-sm` (drop-shadow as in the original, for definition on white). Same yellow in every group. Update the MessageBubble test that asserts the star class. Include this in Task 1's commit (or a separate `fix(chat): bring back the yellow favourite star` commit in Task 1).

> **OSHI OVERRIDE (user, 2026-11-06) — applies to D3/D4 and supersedes their heart/Favorite parts.** Hearts and the "Favorite" filter mean 推 (oshi), a fixed meaning, NOT the group accent. New rule "semantic over context": elements with a fixed meaning keep their meaning colour in every context. Add a global semantic token set `color.semantic.oshi` = harmonized hot pink (from the original `#ff69b4`): `subtle #fff0f8`, `border #ffcbe1`, `solid #de5f99` (white glyph 3.4:1, icon use), `text #aa376f` (6.0:1 on white, 5.5:1 on subtle); emit `--ds-semantic-oshi-*` and utilities `bg-semantic-oshi-subtle`, `bg-semantic-oshi-solid`, `border-semantic-oshi`, `text-semantic-oshi`, `fill-semantic-oshi` as needed (register in classnames.ts, cover in tailwindTokens.test.ts). Uses: (1) MemberSelectModal favourite heart badge — set: white heart on `bg-semantic-oshi-solid`; unset: outline heart `text-semantic-oshi` on the white badge; (2) the blog feed All / Favorite toggle: `Pill` gets `tone?: 'accent' | 'oshi'` (default accent); the Favorite pill uses `tone="oshi"` (selected = `bg-semantic-oshi-subtle text-semantic-oshi ring-semantic-oshi`-style border), "All" stays accent; any other heart that means 推 uses oshi. NOT oshi: About's "made with love" heart (keep `decor.heart`), the chat message star uses its own yellow (see STAR OVERRIDE). Other D3/D4 items (non-heart placeholder / hover / generic Pill selected = accent) stay as recommended. Docs task: add the "semantic over context" rule + oshi set to DESIGN_SYSTEM.md and spec §3.4.

**Files:**
- Modify: `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-05-design-language-v2-design.md` (only the §12 bullet, if D5 (a) is accepted)

- [ ] **Step 1: Update `docs/design/DESIGN_SYSTEM.md`** — make each statement match the code (find each anchor with `grep -n`):
  - Status paragraph (near line 78): "...call popup) apply this table. Blogs, the other dialogs and the entry screens follow in the next parts of the re-apply." -> "...call popup) and the blog screens (feed, reader, rail, member select, member timeline) apply this table. The other dialogs and the entry screens follow in the next parts of the re-apply."
  - Neutral utilities: add "`bg-frost`: the frosted bar over the blog feed's orbs (`--ds-overlay-frost`, white at 72 %), paired with `backdrop-blur-lg`."
  - Expression table row "Ambient orbs" (near line 237): replace the second clause with "the blog feed's `DynamicBackground` draws `bg-expressive-orb-*` with the per-group size and opacity from `design/tokens/ambient.ts` (orb 1 at its pre-D2 strength under the frosted header)".
  - The `Atmosphere` / L2 paragraph: add "The blog feed pairs its orbs with a `bg-frost` header (L2: orbs + frosted glass); the reader is L0 and has no glass."
  - "Which primitive when" (line 428): "| Tab or filter | `Pill` (`selected` is neutral, never group colour) |" -> "| Tab or filter | `Pill` (`selected`: `bg-accent-subtle`, `text-accent-strong`, `ring-accent-border`) |"; fix the Pill sentence in the primitives section if there is one.
  - `DialogStatus` / `BlogStatus` paragraph (grep `DialogStatus`): "spinner `text-accent`; the error tile is `bg-semantic-danger-icon`, the empty tile `bg-expressive-soft`; `retryVariant` (`secondary` default, `primary` for the gradient retry the blog dialogs use); `BlogStatus`'s retry is always `primary`".
  - §8 Japanese content rule (near line 303): "Blog content is marked in the blog part of the re-apply." -> "Blog content (post titles, bodies, member names on cards, in the reader, in the member select and the timeline) is marked too. UI chrome is never marked."
  - Member penlight paragraph (near line 524): after the `memberWashStyle` sentence add "`resolveWash` also reports why there is none (`mascot`, `no_member_data`), logged as `blog_fallback`."
  - Logging section (grep `menu_item_blocked`): add `blog_fallback` (`target`: `card_thumb` or `wash`; `reason`: `image_error`, `mascot`, `no_member_data`).
  - §12 mirror (only if D5 (a) is accepted): add "- **Blog feed title** keeps the official title colour on the white sheet (Sakurazaka 2.4:1), like the chat header title (user decision D5, R-b)." Add the same bullet to the spec's §12.
  - §14 migration note (line 657): "R-a (frame and chat) is done; the list below applies to blogs, the remaining..." -> "R-a (frame and chat) and R-b (blogs) are done; the list below applies to the remaining dialogs and the entry screens."

- [ ] **Step 2: Changelog** — in `CHANGELOG.md` under `## [Unreleased]` -> `### Changed`, add:

```markdown
- **Blogs have their group colours back.** The blog feed shows soft group
  colour glows behind a frosted header, cards glow when you point at them,
  and the member picker, the member's post list and the post reader use the
  group's colour again. Japanese titles and member names always use
  Japanese letter shapes, whatever language the app is in.
```

- [ ] **Step 3: Check the docs against the code**

Run: `grep -n "selected. is neutral\|not yet marked\|Blog content is marked in the blog part" docs/design/DESIGN_SYSTEM.md`
Expected: no output. Also `grep -rn "bg-group-ambient" frontend/src --include=*.tsx | grep -v test` prints nothing (the utility stays defined for the legacy theme; no blog file uses it).

- [ ] **Step 4: Commit**

```bash
git add docs CHANGELOG.md
uv run git commit -m "docs(design): record the blogs re-apply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification and the before/after page

**Files:**
- Create (git-ignored): `frontend/e2e-shots/r-b/section.mjs`
- Modify (outside the repo): `/mnt/c/D/saka-verify/shots/index.html`, `/mnt/c/D/saka-verify/shots/r-b/after/`

- [ ] **Step 1: Full checks**

Run (from `frontend/`): `npm run test:run && npx tsc --noEmit && npm run lint`, then from the repo root `uv run pytest backend/tests -q`
Expected: all pass. Record the counts for the PR. `git diff 4b52636 -- frontend/src/design/guard-baseline.json` must show only decreases/removals.

- [ ] **Step 2: e2e locks**

Run (from `frontend/`, port 8000 free): `npm run build && npx playwright test e2e/blogs.spec.ts e2e/chat-frame.spec.ts e2e/dialogs-chat.spec.ts --reporter=line`
Expected: all pass (`blogs.spec.ts` locks open post, older/newer, rail click, back, timeline round trip, search highlights).

- [ ] **Step 3: Capture "after"**

Run: `SHOT_LABEL=after npx playwright test e2e/r-b-screens.spec.ts --reporter=line && mkdir -p /mnt/c/D/saka-verify/shots/r-b && cp -r e2e-shots/r-b/after /mnt/c/D/saka-verify/shots/r-b/`
Expected: `8 passed`; 20 PNGs in `/mnt/c/D/saka-verify/shots/r-b/after/`.

- [ ] **Step 4: Write the page generator** — `frontend/e2e-shots/r-b/section.mjs`

```js
// Adds (or replaces) the R-b section of the Windows comparison page: base (e4e4118) / dev / after.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = '/mnt/c/D/saka-verify/shots'
const cols = [['base', 'e4e4118（D2 前）'], ['dev', 'dev（R-b 前）'], ['after', 'R-b 後']]
const names = readdirSync(`${root}/r-b/after`).filter((f) => f.endsWith('.png')).sort()
const fig = ([label, caption], file) => existsSync(`${root}/r-b/${label}/${file}`)
  ? `<figure><figcaption>${caption}</figcaption><a href="r-b/${label}/${file}" target="_blank"><img loading="lazy" src="r-b/${label}/${file}"></a></figure>`
  : `<figure><figcaption>${caption}</figcaption><div class="none">—</div></figure>`
const rows = names.map((f) => `<div class="row"><h3>${f.replace('.png', '')}</h3><div class="pair trio">${cols.map((c) => fig(c, f)).join('')}</div></div>`).join('')
const section = `<section id="r-b"><h2>R-b 部落格（v2 重新套用）</h2><style>.trio{grid-template-columns:1fr 1fr 1fr}</style>${rows}</section>`

let html = readFileSync(`${root}/index.html`, 'utf-8')
html = html.replace(/<section id="r-b">[\s\S]*?<\/section>/, '').replace(/<a href="#r-b">[^<]*<\/a>/, '')
html = html.replace('</nav>', `<a href="#r-b">R-b 部落格（${names.length}）</a></nav>`)
html = html.replace('</main>', `${section}</main>`)
writeFileSync(`${root}/index.html`, html)
console.log(`r-b: ${names.length} rows`)
```

- [ ] **Step 5: Build the section**

Run: `node e2e-shots/r-b/section.mjs`
Expected: `r-b: 20 rows`. Optionally show it on Windows (no WSLg): `powershell.exe -NoProfile -Command "Start-Process 'C:\D\saka-verify\shots\index.html'"`.

- [ ] **Step 6: Review the shots** — for every row compare `after` with `base` and note in the PR body any place where `after` is still neutral where `base` had colour, or differs from the decisions D1-D6. Check specifically: feed orbs visible through the frosted header; the Select Member button at rest (tonal) and on hover (gradient + glow); card glow on hover; reader member names and links in the group colour; rail ring colour; member select placeholder tint and heart; timeline expanded month. Fix in a follow-up task before asking for review; do not commit the shots.

- [ ] **Step 7: Remove the base worktree**

Run: `cd /home/xtorker/repos/Project-Saka/SakaDesk && git worktree remove ../SakaDesk-e4e4118 --force`
Expected: `git worktree list` shows only the main tree. (Skip if R-c will reuse the worktree; ask the user.)

---

## Self-review notes

- Spec coverage: §4 blogs = group context -> Tasks 2-4 (accent roles, no brand scope; dialogs inherit); §5 L2 feed (orbs + frosted glass) -> Task 2 (`bg-frost`, expressive orbs); restore inventory "RecentPostsFeed button gradient + hover glow" -> Task 2 step 4; "MemberTimelineModal gradient" -> Task 4 step 4 (primary retry via `retryVariant`, expanded-month accent fill) with the gradient header supplied by `Modal`; §7 radius -> no `rounded-2xl/3xl` left in blog files (guard) and inline icon buttons unchanged; §8 states -> `Pill` selected, hover/focus accents; §12 untouched (D5 adds one bullet only if accepted). Brief items: `*-group-*` migration + baseline -> Tasks 2-4 (guard steps); `lang="ja"` -> Tasks 2-4 tests; circle floating buttons -> Task 4 steps 1 and 5; breadcrumbs -> Tasks 1-3 (`blog_fallback`, frontend + backend + pytest); i18n -> none needed, stated; docs -> Task 5; verification + after shots -> Task 6; before shots -> Task 0.
- Out of scope, untouched: other dialogs (R-c), entry screens (R-d), `ErrorBoundary` radius drift (R-d), the blog photo gallery's thumbnail grid and calendar (group-context dialogs restyled in D2c; only the viewer controls are locked here), Yodel blogs (none).
- Names used across tasks: `bg-frost` / `--ds-overlay-frost` (1 -> 2); `Pill selected` accent classes (1 -> 2); `DialogStatus retryVariant` (1 -> 4); `BlogStatus` primary retry (1 -> 2); `clientLog('blog_fallback', { target: 'card_thumb' | 'wash', reason: 'image_error' | 'mascot' | 'no_member_data' })` (1 -> 2, 3); `resolveWash` / `WashFallback` (3); `bg-expressive-orb-N` in `DynamicBackground` (2).
- Soft spots to confirm while executing: the existing tests' render helpers (`renderFeed`, `renderReader`, `renderRail`, `renderModal`, `openViewer`) are named after what each file already does, so adapt the call, not the assertion; `Modal`'s `title` prop type (Task 4 step 4); `backdrop-blur-lg` is 16 px against the original 20 px (no 20 px step exists and arbitrary values are banned).
