# D1 — Design-system foundation

Date: 2026-11-04
Status: approved in brainstorming, awaiting spec review
Branch: `feat/d1-design-system` → `dev`

## Context

Sub-project D redesigns SakaDesk's UI in three steps:

- **D1 — design-system foundation** (this spec)
- **D2 — apply the "background + one sheet" layout and the two-rail navigation to every screen**
- **D3 — Memories (回憶)**

The direction was settled earlier:

- Keep the official-app look and polish it.
- Layout uses four visual levels: Background → Sheet → Card → Pill.
- Group colour appears in only four places: title gradient, selection ring, bubble border and badge.
- Fixed scales: 5 text sizes, spacing in multiples of 4 px, motion durations of 150–200 ms.
- The style page lives inside the app in dev mode. Storybook was rejected.

The user wants a design language that every future feature reuses without having to rediscuss it.

### What exists today

- `frontend/src/config/serviceThemes.ts` (612 lines) is the brand source.
  - It holds per-group `primaryColor` and similar colours.
  - It also holds many colours tied to specific features: `messages.*`, `modals.*`, `blog.*` and `shelterColors`.
  - 23 non-test files read it, mostly through inline styles.
- `frontend/src/config/colors/` (`palette.ts`, `semantic.ts`, `css-variables.ts`) derives a small set of CSS variables. `applyThemeToDocument(groupId)` writes them, and Tailwind maps some utility names to them (`theme-primary`, `surface-*`, `text-*`, `feedback-*`).
- `data/services.getServicePrimaryColor` already reads `serviceThemes`. There are exactly two colour sources, not three.
- No component uses `dark:`.
- 32 `.tsx` files contain hard-coded hex colours.
- Radii are mixed: `rounded-full`, `-lg`, `-xl`, `-2xl`, `-3xl` and `-md`. Shadows are mixed: `sm`, `md`, `lg`, `xl`, `2xl`, `inner` and custom ones.
- There is no router. Alternate entry points use a query parameter, e.g. `?view=call-popup` in `shell/main.tsx`.

## Decisions (from brainstorming)

| # | Decision |
|---|---|
| 1 | **Dark mode: reserve, do not build.** Tokens get semantic, role-based names so that a dark set is only extra values later. D1 ships light values only, and D2 does no dark-mode checking. |
| 2 | **D1 changes zero pixels on existing screens.** D1 delivers tokens, primitives, the `/design` page, docs, and a guard that stops new violations. D2 switches screens over one at a time. |
| 3 | The token architecture, primitive set and tooling are as described below. All three sections were approved. |
| 4 | Hinatazaka badge stays `#7cc7e8`. The `/design` page shows its contrast ratio (white text 1.9:1) so the user can decide later. |
| 5 | **Exception to the four colour places:** a `primary` button may use the group accent colour, at most one per screen. This matches the B incoming-call "answer" button. |

## Architecture

### Directory

```
frontend/src/design/
  tokens/
    color.ts      neutral scale + semantic roles
    groups.ts     per-group colour tokens (the only place group colours live)
    radius.ts     none / card / sheet / pill
    shadow.ts     none / pill / card / sheet
    type.ts       caption / small / body / title / heading
    space.ts      documents the 4 px scale (Tailwind default spacing)
    motion.ts     fast / base durations + standard easing
    index.ts
  applyTokens.ts  writes every token to :root as CSS variables
  primitives/     Canvas, Sheet, Card, Pill, Badge, Avatar, DatePill,
                  Button, IconButton, RailItem, Modal (+ index.ts)
  DesignPage.tsx  dev-only living style page
  guard.test.ts   hard-coded style ratchet
  guard-baseline.json
```

### Token values

**Semantic colours (`color.ts`).** These are role names and are never colour names.

| Role | Tokens | Value / source |
|---|---|---|
| Surfaces | `surface.canvas`, `surface.sheet`, `surface.card`, `surface.pill`, `surface.sunken` | from the existing `NEUTRAL_COLORS` / `UI_TOKENS` |
| Text | `text.primary`, `text.secondary`, `text.muted`, `text.inverse` | from the existing values |
| Border | `border.subtle` | from the existing values |
| Feedback | `feedback.success`, `feedback.warning`, `feedback.error` | from the existing values |

Values are copied from the current `NEUTRAL_COLORS` / `UI_TOKENS` / `FEEDBACK_COLORS` so nothing shifts.

**Group tokens (`groups.ts`).** Defined for all five `GroupId`s, including `yodel` and `default`. Every value is copied from the current `serviceThemes` field shown below.

| Token | Copied from `serviceThemes` |
|---|---|
| `accent` | `primaryColor` |
| `canvas` (gradient stops) | `messages.sidebarGradient` |
| `title.gradient` (from / via / to) | `messages.headerGradient` |
| `title.bar` | `messages.headerBarGradient` |
| `title.text` | `messages.headerTextColor` |
| `ring` | `interaction.focusRing` |
| `glow` | `interaction.hoverGlow` |
| `bubbleBorder` | `messages.bubbleBorder` |
| `badge` | `messages.unreadBadge` |

**Scales:**

| Scale | Steps |
|---|---|
| Radius | `none` 0, `card` 14px, `sheet` 20px, `pill` 9999px |
| Shadow | `none`; `pill` = faint; `card` = small; `sheet` = large and soft (exact values chosen in the plan and shown on `/design`) |
| Type (size / line-height) | `caption` 11/16, `small` 13/20, `body` 14/22, `title` 16/24, `heading` 20/28 |
| Motion | `fast` 150ms, `base` 200ms, easing `cubic-bezier(0.2, 0, 0, 1)` |

The motion values are exported both as CSS variables and as numbers for framer-motion.

### Single source of truth

- The TypeScript token modules are the only definitions.
- `applyTokens(groupId)`:
  - It writes every token as a CSS variable (`--ds-*`) on `document.documentElement`.
  - It also keeps writing the existing `--color-*` variables with identical values, so current Tailwind classes keep working.
  - `shell/main.tsx` calls it synchronously before the first render, so there is no flash.
  - It replaces `applyThemeToDocument`. The old export becomes a thin alias until D2 removes its callers.
- `tailwind.config.js` maps new utilities to the variables only:
  - `bg-canvas`, `bg-sheet`, `bg-card`, `bg-pill`
  - `text-primary`, `text-secondary`, `text-muted`
  - `rounded-card`, `rounded-sheet`, `rounded-pill`
  - `shadow-card`, `shadow-sheet`, `shadow-pill`
  - `text-caption`, `text-small`, `text-body`, `text-title`, `text-heading`
  - `duration-fast`, `duration-base`, `ease-standard`
  - Group utilities `bg-group-accent`, `ring-group`, `border-group-bubble`, `bg-group-badge`
- `serviceThemes.ts` keeps its public interface. Its group-brand fields (the nine listed above) are read from `groups.ts`. Every other field (`shelterColors`, `modals.*`, `blog.*`, `ambient`, …) stays as-is until D2 deletes the consumers. `config/colors/*` re-exports from `design/tokens` for the same reason.

### Primitives

Rules for all primitives:

- They are presentational only: props in, markup out. No store access and no API calls.
- They style themselves with token utilities only and accept `className`.
- Group colour comes from the CSS variables, so a primitive never takes a group id.
- There is **no Divider** primitive. Separation comes from spacing and levels. This is a documented "Don't".

| Primitive | Level | Contract |
|---|---|---|
| `Canvas` | 0 | Group gradient background; no radius or shadow. |
| `Sheet` | 1 | `rounded-sheet shadow-sheet bg-sheet`; the content area. |
| `Card` | 2 | `rounded-card shadow-card bg-card`; photos and info cards. D2 builds message bubbles from it. |
| `Pill` | 3 | Fully rounded, faint shadow; `selected` state. Used for tabs, filters and chips. |
| `Badge` | 3 | Props: `count`. Renders nothing at 0, shows `99+` above 99, uses the group badge colour, and gets an i18n `aria-label`. |
| `Avatar` | — | Sizes `sm`/`md`/`lg`/`xl`. `selected` adds a white ring and the group glow. On image error it shows the name's first character. |
| `DatePill` | 3 | Props: `date`, optional `sticky`. The label comes from `formatDatePillLabel`. |
| `Button` | 3 | Variants `primary` (group accent, at most one per screen), `secondary` and `ghost`; sizes `sm`/`md`. |
| `IconButton` | 3 | `aria-label` is a **required** prop (enforced by the type). |
| `RailItem` | — | Icon, label and `selected`, for the D2 feature rail. |
| `Modal` | 1 | Sheet-styled shell with title and footer slots. Escape, backdrop click and portal behaviour reuse the existing `useModalClose` and `Portal`, not new code. |

These are deliberately **not** in D1: message bubble, member grid cell and chat header. They are tied to one screen, so D2 composes them from the primitives above.

### Date label

`formatDatePillLabel(date: Date, now: Date, locale: string): string` is a pure function in `utils/dateFormatters.ts`:

1. Same local day as `now` → i18n key `date.today`.
2. Previous local day → i18n key `date.yesterday`.
3. Same year → month, day and weekday only, e.g. `11月2日（日）`.
4. Any earlier year → always includes the year, e.g. `2025年11月2日（日）`.

The formatting uses `Intl.DateTimeFormat(locale, …)` and follows the UI language. Comparisons use local calendar days. Stored timestamps stay UTC.

### `/design` page

- `?view=design` selects the page, mirroring `isCallPopupView`. The check sits behind `import.meta.env.DEV` and the page is imported with a dynamic `import()`, so production builds tree-shake it out entirely. In production the parameter is ignored and the normal app loads.
- The page shows, in order:
  1. A group switcher (all five groups, applied live through `applyTokens`).
  2. Colour swatches with token names and their white-text contrast ratio. This is where the Hinatazaka badge's 1.9:1 is visible.
  3. Radius, shadow, type and motion samples.
  4. Every primitive in every state.
  5. Do/Don't pairs.
- Its strings use i18n keys, like the rest of the UI. Being dev-only does not exempt it.
- The user opens it in the Windows browser through `Start-Process`. Never use Playwright or a WSLg window.

### Documentation and rules

- **`docs/design/DESIGN_SYSTEM.md`** (new) covers:
  - The four levels, and what may sit on each.
  - The four group-colour places and the primary-button exception.
  - Which primitive to use when.
  - Do/Don't: no divider lines, no arbitrary values, no hard-coded colours, no new group colour usage.
  - How to add a token: edit `design/tokens`, show it on `/design`, document it here.
  - How the guard ratchet works.
- **`SakaDesk/CLAUDE.md`** gets a hard rule: new or changed UI must use design-system tokens and primitives, and agents must read `docs/design/DESIGN_SYSTEM.md` before touching UI.

### Guard (ratchet)

`design/guard.test.ts` runs in the normal vitest suite and CI.

**What it scans:** `src/**/*.{ts,tsx}`, excluding `src/design/tokens/**`, `src/config/serviceThemes.ts`, `src/config/colors/**` and test files.

**What counts as a violation:**

- hex colour literals (`#rgb`, `#rrggbb`, `#rrggbbaa`)
- `rgb(` / `rgba(` / `hsl(` literals
- Tailwind arbitrary values for radius, shadow, font size and spacing: `rounded-[`, `shadow-[`, `text-[<n>px]`, and `p|m|gap|space|w|h…-[<n>px]`

**How the ratchet works:** `guard-baseline.json` maps each file path to its current violation count.

| Situation | Result |
|---|---|
| A file not in the baseline has a violation | Fail |
| A baseline file's count goes up | Fail |
| A baseline file's count goes down but the baseline was not lowered | Fail, with a message asking to update the number |
| A baseline entry points at a file that no longer exists | Fail |

The counts can only go down, so D2 locks in every screen it converts.

### Logging

Breadcrumbs go through the existing `clientLog`. The whitelist lives in both the frontend `ClientLogEvent` type and the backend `api/client_log.py`, and both gain the new events.

| Event | Level | Fields | When |
|---|---|---|---|
| `design_tokens_applied` | info | `group_id` | `applyTokens` succeeded |
| `design_tokens_fallback` | warning | `reason=unknown_group` | an unknown group id falls back to `default`. The raw id is **not** logged because it is client text. |
| `avatar_fallback` | info | `surface=<size>` | an avatar image failed and the initial was shown |

No text, names, URLs or paths are logged.

## Testing

Unit tests run with vitest (frontend) and pytest (backend).

- **Token contract.**
  - Every `GroupId` defines every group token.
  - Each group token **equals** the legacy value it was copied from. This is the automated zero-pixel guarantee.
  - The legacy values come from a frozen fixture, `legacy-theme-values.json`, captured from `dev` before the refactor. Comparing against `serviceThemes` itself would be circular, because it now reads from `groups.ts`.
  - `applyTokens` writes every `--ds-*` variable and every legacy `--color-*` variable.
  - An unknown group falls back to `default` and logs `design_tokens_fallback`.
- **Primitives.**
  - `Badge`: 0, 1, 99, 100 → `99+`, and the aria-label.
  - `Avatar`: the ring when selected, and the fallback on image error (which logs).
  - `IconButton`: a type-level test that a missing `aria-label` fails to compile (`// @ts-expect-error`).
  - `Modal`: Escape and backdrop close.
  - `DatePill`: the sticky class.
  - `Pill`, `Button` and `RailItem`: their states.
- **`formatDatePillLabel`.** Today, yesterday, same year, a previous year, and the year boundary (1 Jan vs 31 Dec), for `ja`, `zh-TW` and `en`. Time is frozen with `vi.setSystemTime`.
- **`/design`.** A smoke render, switching through all five groups. Also a test that `?view=design` is ignored when not in DEV.
- **Guard.** Fixture-based tests for each ratchet rule, plus the real scan.
- **Backend.** `client_log` accepts the three new events and still rejects unknown ones.
- **Zero-pixel check.** Take Playwright headless screenshots of the main screens (member list, chat, blog, a modal, the call screen) on `dev` before the change and on the branch after it, and diff them pixel by pixel. Then the user checks visually once in the Windows dev build.
- **Full suites stay green:** frontend vitest, `tsc`, eslint; backend pytest, ruff, mypy.

## Out of scope (D2 / D3 / later)

- **D2:**
  - Restyling any screen, layout or rail.
  - Message bubbles, the member grid, the chat header, and sticky date pills inside the chat.
  - Inline sent letters.
  - Removing the legacy `serviceThemes` fields and `config/colors`.
- **D3:** Memories.
- **Later:**
  - Dark-mode values.
  - Darkening the Hinatazaka badge.
  - The feature-rail "⋯ 更多" threshold, and hiding features in settings.

## PR

- Title: `feat(design): add design-system foundation`
- `## Changelog`: `No user-facing change.`
