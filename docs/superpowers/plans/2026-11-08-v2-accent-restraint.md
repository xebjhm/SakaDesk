# v2 accent restraint (R-e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull the group accent back to the places where it carries meaning (identity, current state, the one primary action) and make every other element neutral, per acceptance round 2.

**Architecture:** One root-cause fix in the `Button` primitive (ghost variant back to neutral) plus targeted per-screen edits: icon-only feature rail with a styled tooltip, the pre-v2 member-timeline header, a dark "console" Diagnostics panel, About without archive stats, and a handful of small accent clean-ups. The rule is written into `docs/design/DESIGN_SYSTEM.md` so later work can follow it.

**Tech Stack:** React 18 + TypeScript, Tailwind (design tokens in `frontend/src/design/`), Vitest + Testing Library, Playwright e2e (screens).

## Global Constraints

- THE RULE (verbatim, goes into DESIGN_SYSTEM.md): the group colour does exactly three jobs: **A. identity** (whose space this is: the group canvas and rail block, the chat header, the group's own content, group markers in cross-group lists, the dialog expressive header); **B. current state** (active tab, selected nav item or row, slider fill, switch on, checked, progress); **C. the one primary action** of a view (primary `Button`). Everything else is neutral: secondary and tertiary actions, disclosure and utility controls, counts and metadata, tooling surfaces. Decoration that stays group-coloured is pastel strength, never solid. Nothing accent-coloured sits on the accent gradient header. Semantic colours (danger, warning, success, oshi pink, yellow star) are unchanged.
- Pre-existing accents from the original design (e4e4118) that the owner has not asked to change stay: the ⋯ conversation-menu icons, the transcript "Show text" control, the member-timeline row hover tint and expanded month count pill, the sent-letters hover (decided R-c D4), the blog nav footer glow, the ToS per-group links.
- Use design tokens only; `frontend/src/design/guard.test.ts` must stay green and its baselines may only decrease. No hex / rgb / hsl literals, no arbitrary radius / shadow / text / spacing values, no named palette classes (`bg-gray-900`, `text-green-400`).
- No hard-coded user-facing strings: new strings go through i18n in all five locales (`frontend/src/i18n/locales/*`). The Diagnostics panel is developer-only and already uses literal English ("Developer Diagnostics", "Hidden Panel", "Copy JSON"); keep that existing convention, do not add new literals elsewhere.
- Breadcrumbs: no new decision paths are introduced; do not remove existing `clientLog` calls.
- Docs: zero drift. Every changed primitive keeps its JSDoc accurate; DESIGN_SYSTEM.md sections touched are updated in the same task. CHANGELOG `[Unreleased]` entries written for end users (bold lead-in, ≤ 3 sentences, no code identifiers) per `docs/DOC_FORMATS.md`.
- Commits: Conventional Commits ≤ 72 chars, via `uv run git commit` from the SakaDesk repo root. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `cd frontend && npx vitest run <files>` for the touched files, plus `npx tsc --noEmit` and `npx eslint <files>`; backend untouched except nothing (no backend changes in this plan).

---

### Task 1: Neutral ghost button + the rule in the design system

**Files:**
- Modify: `frontend/src/design/primitives/Button.tsx` (ghost variant, line ~33, and its JSDoc)
- Modify: `frontend/src/design/primitives/Modal.tsx:159` (expressive-header close button hover)
- Modify: `frontend/src/shell/components/SettingsModal.tsx` (~505-507 "Verify now": drop `className="text-accent-strong"`; ~625 "Check Now": drop the `border-accent-wash bg-accent-wash text-accent-strong` override, keep `variant="secondary"`)
- Modify: `frontend/src/core/modals/BackgroundModal.tsx` (~152 Upload Image hover: `hover:border-accent-border hover:text-accent-strong` → `hover:border-strong hover:text-primary` or the closest existing neutral border token)
- Modify: `frontend/src/design/primitives/DatePill.tsx:33` (`hover:text-accent-strong` → `hover:text-primary`)
- Modify: `docs/design/DESIGN_SYSTEM.md` (new subsection "When to use the group colour" at the end of §4 Colour, before §5; §9 Buttons: ghost is neutral; §13 Do/Don't: add one Do and one Don't)
- Test: `frontend/src/design/primitives/Button*.test.tsx` / `Controls.test.tsx` (whichever asserts the ghost classes), `Modal.test.tsx`, touched component tests

**Interfaces:**
- Produces: `Button` `variant="ghost"` = `bg-transparent text-secondary hover:bg-sunken hover:text-primary` (the e4e4118 string; it already matches `IconButton`'s `ICON_VARIANT.ghost`). Later tasks rely on ghost being neutral.

- [ ] **Step 1: Write the failing test** — in the Button test, assert a ghost Button has `text-secondary` and `hover:bg-sunken` and does NOT contain `accent`. In `Modal.test.tsx`, assert the expressive close button's class does not contain `accent`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/design/primitives` — expect the new assertions to FAIL.
- [ ] **Step 3: Implement**
  - `Button.tsx` ghost: `'bg-transparent text-secondary hover:bg-sunken hover:text-primary'`; update the variant JSDoc ("ghost: neutral text action for secondary / tertiary actions; never the group colour").
  - `Modal.tsx:159` close button on the expressive header: `'text-expressive-header hover:bg-header-glass'` (the existing glass token used by chat header pills); keep the plain-header branch as is.
  - SettingsModal, BackgroundModal, DatePill edits as listed in Files.
  - Grep for any other call site that relied on ghost being accent: `grep -rn 'variant="ghost"' frontend/src --include=*.tsx | grep -v test`. A ghost that must stay accent does not exist under the rule; if a call site adds its own accent class back (`text-accent*`) on a secondary action, remove it. Leave `DANGER_GHOST` / warning overrides alone.
- [ ] **Step 4: DESIGN_SYSTEM.md** — add "### When to use the group colour" with THE RULE from Global Constraints verbatim, then a short table of examples: identity (chat header, rail block, group markers, dialog header), state (active tab, selected rail item, slider fill), primary (Done / Save), neutral (Reset to Default, Jump to Date, Today, Refresh, Cancel, Verify now, Check now, counts), pastel decoration (empty-state soft circle, milestone card surface), plus the line "Pre-existing accents from the original design stay until the owner revisits them" naming the list from Global Constraints. Update §9 ghost description and §13 Do/Don't.
- [ ] **Step 5: Run** the touched tests + `npx vitest run src/design/guard.test.ts` + `npx tsc --noEmit` — all PASS. Update any snapshot or class assertion that encoded the old accent ghost (only where the expectation was the accent ghost itself).
- [ ] **Step 6: Commit** `fix(design): make ghost buttons neutral and document accent rule`

### Task 2: Icon-only feature rail with a hover tooltip

**Files:**
- Modify: `frontend/src/design/primitives/RailItem.tsx`
- Modify: `frontend/src/core/layout/FeatureRail.tsx` (rail width `w-20` → narrower so the 40 px tiles sit as in e4e4118; keep it on the group canvas block from R-a)
- Modify: `docs/design/DESIGN_SYSTEM.md` ("The group rail and the profile card" section: feature rail is icon-only with a tooltip)
- Test: `frontend/src/core/layout/FeatureRail.test.tsx`, a new or existing `RailItem` test

**Interfaces:**
- Consumes: Task 1 nothing.
- Produces: `RailItem` keeps its props (`icon`, `label`, `selected`, `onClick`, `className`); `label` becomes the accessible name (`aria-label`) and the tooltip text, no longer visible text.

Design (e4e4118 look, v2 tokens): a 40×40 `rounded-lg` icon tile, icon 20 px. Selected: `bg-sheet shadow-card` white tile, icon `text-accent`, the left bar `bg-accent` (state, clause B). Unselected: `text-secondary hover:bg-elevated hover:text-primary`. Tooltip: a styled label to the right of the tile (not the native `title`), shown on hover and on `focus-visible`, after a short delay (`delay-300` on the opacity transition; `motion-reduce` shows without transition), `role="tooltip"` with `aria-describedby` NOT needed because `aria-label` already names the button — mark the tooltip `aria-hidden="true"`. Tooltip style: neutral, never accent: `bg-inverse text-inverse`-family tokens if they exist (check `tailwind.config.js`; use the dark neutral used by the viewer controls `bg-viewer-control text-viewer` otherwise), `rounded-md px-2 py-1 text-caption shadow-card whitespace-nowrap`, positioned `absolute left-full ml-2 top-1/2 -translate-y-1/2`, `pointer-events-none`, layered above the content sheet (use the existing `Z_INDEX` / z token that menus use).

- [ ] **Step 1: Failing tests** — RailItem: no visible label text node outside the tooltip; button has `aria-label` = label; tooltip element exists with the label and `aria-hidden`; selected renders `[data-rail-bar]` and `aria-current="page"`. FeatureRail: `getByRole('button', { name: <label> })` still works for each feature.
- [ ] **Step 2: Run** `npx vitest run src/design/primitives src/core/layout/FeatureRail.test.tsx` — FAIL.
- [ ] **Step 3: Implement** per the design above. Remove the visible `<span>{label}</span>`.
- [ ] **Step 4: Run** tests + guard + tsc — PASS. Fix e2e selectors in `frontend/e2e/*.spec.ts` that located rail items by visible text (`getByText('Messages')` within the rail) to use role + name.
- [ ] **Step 5: Docs** — DESIGN_SYSTEM.md rail section.
- [ ] **Step 6: Commit** `feat(rail): show feature rail as icons with hover tooltips`

### Task 3: Member timeline back to its original header

**Files:**
- Modify: `frontend/src/design/primitives/Modal.tsx` (only if needed: a `titleClassName?: string` prop applied to the h2, documented in the props JSDoc and in DESIGN_SYSTEM.md "Dialogs" prop table)
- Modify: `frontend/src/features/blogs/components/MemberTimelineModal.tsx` (~91-129 header, ~102 Photo Album, ~167 chevron disc)
- Modify: `docs/design/DESIGN_SYSTEM.md` (Dialogs table: `header="plain"` is now used by the member timeline; `titleClassName` if added)
- Test: `MemberTimelineModal` test file (find with `ls frontend/src/features/blogs/components/*Timeline*test*`), `Modal.test.tsx`

Target (screenshot `C:\D\saka-verify\shots\r-b\base\hinatazaka46-member-timeline.png`, i.e. `/mnt/c/D/saka-verify/shots/r-b/base/hinatazaka46-member-timeline.png`): white plain header, member name bold in the group colour (identity, clause A: `text-accent-strong`), "Photo Album" a pastel tonal pill (`bg-accent-wash text-accent-strong hover:bg-accent-subtle`, rounded-pill — it sits on white now, not on the gradient), post count `text-muted`. Month disclosure disc: expanded = the light logo colour (`bg-accent-logo text-inverse`; if `bg-accent-logo` is not a background utility, add it as a colour token mapping `var(--ds-accent-logo)` in `tailwind.config.js` next to the existing `accent-logo` entry and register it in `utils/classnames.ts` if tailwind-merge needs it), collapsed = `bg-sunken text-secondary`. Month label expanded `text-accent-strong` (state), count pill unchanged.

- [ ] **Step 1: Failing tests** — Modal renders header without `bg-expressive-header` when `header="plain"` (likely already tested; add if missing) and applies `titleClassName`; MemberTimelineModal: header testid has no `bg-expressive-header`, title has `text-accent-strong`, expanded chevron disc has `bg-accent-logo` and not `bg-accent ` (solid).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `header="plain"`, `titleClassName="text-accent-strong"`, Photo Album pill classes as above (keep `size="sm"`; it can stay a ghost `Button` with the explicit tonal classes, or use the `tonal` variant if its look matches the base pill — pick the one matching the base screenshot), chevron disc.
- [ ] **Step 4: Run** tests + guard + tsc — PASS.
- [ ] **Step 5: Commit** `fix(blogs): restore the member timeline's plain header`

### Task 4: Diagnostics as a dark developer console

**Files:**
- Modify: `frontend/src/design/primitives/Modal.tsx` (`header` gains `'console'`: dark ink header, documented in JSDoc)
- Modify: `frontend/src/design/tokens/*` + `frontend/tailwind.config.js` (console tokens: background, text, muted text, prompt green, badge amber; light and dark mode values like the other tokens; names e.g. `bg-console`, `text-console`, `text-console-muted`, `text-console-prompt`, `bg-console-badge`, `text-console-badge`)
- Modify: `frontend/src/core/modals/DiagnosticsModal.tsx` (~217-229 header, badge, footer buttons; ~492 log block)
- Modify: `frontend/src/core/modals/DiagnosticsModal` test, `Modal.test.tsx`, `docs/design/DESIGN_SYSTEM.md` (Dialogs `header` row; new short "Developer surfaces" note: Diagnostics is outside brand and group contexts on purpose)

Design: header `bg-console` (near-black ink, the e4e4118 `gray-900` value `#111827` as the token value), title `text-console` (white), terminal icon `text-console-prompt` (the e4e4118 `green-400` `#4ade80`), "HIDDEN PANEL" badge monospace uppercase tracking-wide caption, `bg-console-badge text-console-badge` amber on dark (e.g. amber-400 text on a 15 % amber tint), close button `text-console-muted hover:text-console hover:bg-[glass token]`; no expressive bar under it. Body unchanged (neutral cards). Footer: Refresh stays the neutral ghost (Task 1); Copy JSON becomes a solid ink button — use `Button variant="secondary"` with `bg-console text-console hover:opacity-90` override, or add `variant="ink"` only if the primitive already has a pattern for it (prefer the override; do NOT add a new Button variant for one call site). Remove `scope="brand"` only if the console header makes it irrelevant — keep it, because nested confirms still need a scope. The log block (~492) goes back to the console look (`bg-console text-console-muted font-mono`). No group colour, no brand gradient anywhere in the panel.

- [ ] **Step 1: Failing tests** — Modal `header="console"` renders `bg-console` header and no `modal-header-bar`; Diagnostics header has `bg-console`, the badge text "Hidden Panel" has `font-mono`, Copy JSON button has no `bg-accent-gradient`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** tokens (add to the token source the same way existing tokens like `viewer-*` are added; guard baselines must not rise — token definition files are where literals belong), Modal variant, Diagnostics.
- [ ] **Step 4: Run** tests + guard + tsc — PASS.
- [ ] **Step 5: Commit** `feat(diagnostics): give the hidden panel a dark console look`

### Task 5: About shows only SakaDesk information

**Files:**
- Modify: `frontend/src/core/modals/AboutModal.tsx` (remove the "Your archive" stats block and the `useArchiveStats` import)
- Modify: `frontend/src/core/modals/AboutModal.test.tsx` (drop stats assertions; assert no stats region)
- Keep: `frontend/src/core/modals/archiveStats.ts` (still used by `shell/components/FirstSyncToast.tsx`), backend `GET /api/archive/stats`
- Modify: i18n — remove About-only stats keys from all five locales ONLY if no other file uses them (`grep -rn "<key>" frontend/src`); update `frontend/src/i18n/rD.test.ts` `RD_KEYS` / `RD_EN_PLURALS` accordingly
- Modify: `docs/ROADMAP.md` P1.1 Phase 4 "Personal analytics (local summaries)": add a note that `GET /api/archive/stats` (messages, photos, days since earliest message, per archive) already exists and was moved out of About in 2026-11; the personal-summary view is its home
- Modify: `docs/design/DESIGN_SYSTEM.md` / spec references that say About shows stats (grep `About` + `stats` in `docs/`)

- [ ] **Step 1: Failing test** — About renders no element with the stats labels (Messages / Photos / Days) and does not call `/api/archive/stats` (MSW handler spy or `fetch` mock).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** removal; keep the hero, version, tagline, credits, link.
- [ ] **Step 4: Run** About, FirstSyncToast, archiveStats, rD tests + tsc — PASS.
- [ ] **Step 5: Commit** `refactor(about): move archive stats out of About`

### Task 6: Small accent clean-ups

**Files:**
- Modify: `frontend/src/design/primitives/Celebration.tsx:41-42` — milestone card keeps `bg-expressive-soft` and `border-accent-border`; numeral `text-accent-strong` → `text-primary`; drop `shadow-accent-glow`. Confetti unchanged.
- Modify: `frontend/src/features/messages/components/ProfileImagePills.tsx:34,39` — count badge `bg-accent text-inverse` → `bg-sunken text-secondary`; pill hover `hover:bg-accent-subtle hover:text-accent-strong` → `hover:bg-sunken hover:text-primary` (keep the selected pill's accent state if there is one — clause B).
- Modify: `frontend/src/features/messages/components/MessageContextMenu.tsx:20` — favourite icon `fill-current text-accent` → `fill-current text-semantic-star` (match the bubble star's class exactly, including its drop shadow if the bubble uses one); unfilled stays `text-muted`.
- Modify: the matching tests (`Moments.test.tsx` or Celebration test, ProfileImagePills test, MessageContextMenu test) and DESIGN_SYSTEM.md where the milestone card / star are described.

- [ ] **Step 1: Failing tests** for each of the three changes (class assertions).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests + guard + tsc — PASS.
- [ ] **Step 5: Commit** `fix(ui): keep counts and the menu star out of group colour`

### Task 7: CHANGELOG and e2e screens

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]` — one `### Changed` entry: **Calmer colours** — group colour now marks only where you are, what is selected and the main action; secondary buttons, counts and tool panels are neutral. One entry: **Simpler side rail** — feature icons show their names on hover. One entry: **About** — focuses on the app itself; archive statistics will return in a future personal summary view. (Adjust wording to DOC_FORMATS; no code identifiers.)
- Modify: `frontend/e2e/r-c-screens.spec.ts` / other screen specs only if selectors broke (rail text, About stats).

- [ ] **Step 1:** Run the full frontend suite `cd frontend && npx vitest run`, `npx tsc --noEmit`, `npx eslint src`, and `cd .. && uv run pytest -q` — all PASS (keyring test in pysaka is not part of this repo).
- [ ] **Step 2:** Update CHANGELOG.
- [ ] **Step 3: Commit** `docs(changelog): note calmer group colour usage`
