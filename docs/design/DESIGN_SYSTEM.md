# SakaDesk design system

Every screen uses one design language. This file says what it is and how to
use it. **Read it before you add or change any UI.**

- Tokens live in `frontend/src/design/tokens/`. They are the only place
  design-system style values are defined. Pre-D1 code still reads the legacy
  `frontend/src/config/colors/` and `frontend/src/config/serviceThemes.ts`;
  those are not design tokens and are not scanned by the guard.
- Primitives live in `frontend/src/design/primitives/`.
- See everything live at `http://localhost:5173/?view=design` (dev server
  only; `npm run dev` in `frontend/`). The page has a group switcher and
  contrast labels.

## The four levels

| Level | Primitive | Corners | Shadow | Holds |
|---|---|---|---|---|
| 0 Background | `Canvas` | none | none | rails, the space around the sheet |
| 1 Sheet | `Sheet`, `Modal` | `rounded-sheet` (20px) | `shadow-sheet` | the one content area: chat, blog, dialogs |
| 2 Card | `Card` | `rounded-card` (14px) | `shadow-card` | bubbles, photos, info cards |
| 3 Pill | `Pill`, `Badge`, `DatePill`, `Button` | `rounded-pill` | `shadow-pill` | tabs, filters, dates, badges, buttons |

A level sits on the level below it. Do not put a sheet on a card.

## Where group colour may appear

Group colour is used ONLY through the official layer (title gradient, title
bar and text, canvas, unread shelters) and the roles in the Colour system
table (`text-group-strong`, `bg-group-subtle`, `border-group-subtle`,
`decoration-group`, `bg-group-accent`, `ring-group`, `shadow-group-glow`, ...).
It is read via `groupTokens[id].official` or `groupRoles(id)` and follows the
active service automatically through CSS variables. It is never hard-coded,
and a primitive never takes a group id.

- **Official layer:** `bg-group-title` (the title gradient), `bg-group-title-bar`,
  `text-group-title`, `--ds-group-title-*`, the canvas and the shelters.
- **Roles:** the Colour system table; for example `Avatar selected` draws a white
  ring plus the group glow (`shadow-group-glow`), and `ring-group` is the keyboard
  focus ring of `Pill`, `Button`, `IconButton` and `RailItem`
  (`focus-visible:ring-2 focus-visible:ring-group`). The group rail's selected logo
  has a selection ring: a 2 px white gap plus a 2 px ring in the group logo colour
  (`ring-2 ring-offset-2 ring-group-logo`, from `--ds-group-logo`) and the group glow.
  It is the only place the logo colour is used as a ring.
- **Ambient orbs (decided in D2b):** the blog feed's slow-drifting background orbs,
  `bg-group-ambient-1/2/3` (the D1.5 `ambient` role, `groupRoles(id).ambient`), with the
  per-group size and opacity from `design/tokens/ambient.ts` (`--ds-group-ambient-N-size`,
  `--ds-group-ambient-N-opacity`). Only `DynamicBackground` draws them, only behind the
  recent-posts feed. Their 22–34 s drift (`animate-orb-drift-1/2`, `animate-orb-breathe`) is
  the one exception to the 150–200 ms motion rule besides `duration-glide`; it stops with
  reduced motion.

**Exception:** at most **one** `Button variant="primary"` per screen. It
uses `bg-group-accent` (the action colour, step 600), e.g. the call screen's
"answer", a dialog's "save".

**Member penlight colours (data-driven exception).** The blog reader's corner wash uses the
current member's two penlight colours from member data (`getMemberPenlightHex`), never a
literal. `memberWashStyle()` (`features/blogs/memberWash.ts`) sets `--ds-member-wash-1/2` on
the wash element, and the `bg-member-wash` utility mixes them at `--ds-member-wash-alpha`
(`memberWash.alpha`, 10 %). Both default to `transparent` (no wash for the mascot or an unknown
member). No other element uses member colours.

The level-0 background (`Canvas`, `bg-group-canvas`) is the official sidebar
gradient. Everything else is neutral: `bg-sheet/card/pill/elevated/sunken`,
`bg-scrim` (the modal backdrop) and `text-primary/secondary/muted/inverse`. Search matches inside text use the neutral mark tokens `bg-mark-exact`, `bg-mark-reading` and `border-mark-underline` (`color.mark`).
Overlays use `bg-scrim` (`color.overlay.scrim`, `rgba(0, 0, 0, 0.4)`), never
`bg-black/NN`: the token carries its own alpha.

## Colour system

Every group colour comes from `frontend/src/design/tokens/groups.ts` through
one of two layers:

- **Official layer** (`groupTokens[id].official`): title gradient, thin bar and
  title text, the canvas (sidebar) gradient, unread-shelter colours and the
  `shelterStyle` / `headerStyle` switches. These were copied from the official
  apps and are kept verbatim — tests pin them. Do not "fix" them to match the
  scale.
- **System layer**: each group has its logo colour and a 10-step scale
  (50 lightest … 900 darkest, logo colour snapped into its step). Colours are
  taken by **role**, never by step, through `groupRoles(id)` in
  `design/tokens/roles.ts`:

| Role | Step | Used for | Utility |
|---|---|---|---|
| `action` | 600 | badge, primary button, play / scroll buttons | `bg-group-accent`, `bg-group-badge` |
| `strong` | 700 | member names, links, selected text | `text-group-strong` |
| `subtle` | 50 | selected / hover background | `bg-group-subtle` |
| `highlight` | 100 | landed-row highlight | `animate-landing` |
| `subtleBorder` | 200 | border of subtle selections | `border-group-subtle` |
| `linkUnderline` | 300 | link underline | `decoration-group` |
| `ring` | 600 | keyboard focus ring | `ring-group` |
| `bubbleBorder` | logo (Nogizaka 600) | message bubble border | `border-group-bubble` |
| `glow` | logo at alpha | selection glow | `shadow-group-glow` |
| `ring-group-logo` | logo | group rail selection ring (with a white gap) | `ring-group-logo` |

Contrast floors are enforced by tests: `action` with white text ≥ 3:1 and
`strong` on white ≥ 4.5:1. Sakurazaka is the one stylistic exception: a white
base with pink accents (`light` header and shelters). `--ds-group-accent` is
the **action** colour; the logo colour itself is `--ds-group-logo`.

To add a colour, add a **role** in `roles.ts` (and a CSS variable and utility
if components need it). Never add a new hex to a component or to
`serviceThemes.ts` (a test fails if that file contains any colour literal).

## Scales

| Scale | Utilities | Values |
|---|---|---|
| Text | `text-caption` `text-small` `text-body` `text-title` `text-heading` `text-reading` | 11/16, 13/20, 14/22, 16/24, 20/28 px; `text-reading` 16/28 px is for long-form reading (blog posts) only |
| Font | `font-sans` (default) `font-reading` | Noto Sans JP; Noto Serif JP for blog titles only (`fontFamily.reading`); post bodies stay in the sans. Both load from Google Fonts in `index.html` |
| Radius | `rounded-tail` `rounded-card` `rounded-sheet` `rounded-pill` (and Tailwind's built-in `rounded-none`) | 4px (only the first bubble's top-left corner, as `rounded-tl-tail`), 14px, 20px, full |
| Shadow | `shadow-pill` `shadow-card` `shadow-sheet` | faint, small, large-soft |
| Spacing | Tailwind default scale (`p-4` = 16px) | multiples of 4px only |
| Motion | `duration-fast` `duration-base` `duration-glide` `animate-landing` `animate-reveal` `ease-standard` | 150ms, 200ms, 400ms, 1400ms, 200ms, `cubic-bezier(0.2, 0, 0, 1)` |

`duration-glide` (400 ms) is only for scroll glides and `animate-landing`
(1400 ms, `--ds-group-highlight` fading in and out) only for the landed-row
highlight. Every other animation stays at 150-200 ms. `animate-reveal` (fade in with an 8 px rise, `duration-base`) is for cards appearing in a feed; pair it with `motion-reduce:animate-none`. The ambient orbs' drift is the documented exception (see Where group colour may appear). `bezierEasing` in
`design/tokens/motion.ts` evaluates the standard curve in JS.

framer-motion reads numbers from `design/tokens/motion.ts`:
`transition={{ duration: motion.duration.base / 1000, ease: motion.easing.standard }}`.

Token colours are CSS variables, so Tailwind opacity modifiers such as
`bg-sheet/50` do not work. Add a token instead.

## Which primitive when

| Need | Use |
|---|---|
| Group background behind everything | `Canvas` |
| Main content area or dialog body | `Sheet` / `Modal` |
| A boxed item on a sheet | `Card` |
| Tab or filter | `Pill` (`selected` is neutral, never group colour) |
| Unread count | `Badge count={n}` (hidden at 0, `99+` cap) |
| Person or member | `Avatar` (`selected` for the current member) |
| Timeline date | `DatePill` (`sticky` inside scrolling timelines) |
| Action | `Button` (`primary` max once per screen, else `secondary` / `ghost`) |
| Icon-only action | `IconButton` (`aria-label` is required) |
| Feature-rail entry | `RailItem` |

Screen-specific components (message bubble, member grid cell, chat header)
are composed from these in the feature folder. They are not primitives.

## Do / Don't

| Do | Don't |
|---|---|
| Separate blocks with spacing and levels | Draw straight divider lines (`border-b` between list items, `<hr>`) |
| Use token classes (`rounded-card`, `text-body`, `bg-sheet`) | Hard-code `#hex`, `rgb()`, or arbitrary `rounded-[..]`, `shadow-[..]`, `text-[..]`, `p-[..]` |
| Dim overlays with `bg-scrim` | Dim overlays with `bg-black/NN` or `bg-white/NN` |
| Take group colour from the official layer and the Colour system roles (`groupTokens` / `groupRoles`) | Hard-code a group colour, or colour any other element with it |
| Translate every visible string (`t('…')`) | Put text in primitives; callers pass translated labels |
| Use role names for new tokens (`surface.x`) | Name tokens after hues (`lightBlue`) — dark mode will reuse the names |

## Adding or changing a token

1. Edit the right file in `frontend/src/design/tokens/`.
2. Expose it in `frontend/src/design/cssVars.ts`, and in `tailwind.config.js`
   if it needs a utility (and in `utils/classnames.ts` if the utility uses a
   `text-`, `bg-` (image/gradient utilities), `rounded-`, `shadow-`, `duration-` or `ease-` prefix).
3. Show it on `DesignPage.tsx`.
4. Document it here.
5. Changing a pre-D1 value changes pixels on existing screens. Update
   `design/__fixtures__/legacy-theme-values.json` only when that change is
   intended, and say so in the PR.

## The guard (ratchet)

`frontend/src/design/guard.test.ts` counts hard-coded style values per file:
hex colours, `rgb()`/`hsl()`, and arbitrary radius / shadow / text / spacing
values. Width, height and position arbitrary values are allowed. Comments are
ignored, but string contents are still scanned (hex colours live in strings).
Named palette classes (e.g. `bg-gray-100`, `bg-black/40`) are not caught by the
guard but are still forbidden by the rules above.
Token files (`design/tokens/`), `config/colors/`, `config/serviceThemes.ts`,
tests and `.d.ts` files are not scanned. The test compares the counts with
`guard-baseline.json`:

- A new file must have 0.
- An existing file may not go up.
- When a file goes down, the test fails until you lower its number (or
  remove the entry at 0).

To rewrite the baseline after converting screens, from `frontend/`:

    UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts

Review the diff: numbers should only go down.

## Dark mode

Not built yet. Token names are roles so a dark value set can be added
later without renaming anything.
