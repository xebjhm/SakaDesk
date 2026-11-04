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

Group colour comes from `groupTokens` and follows the active service
automatically through CSS variables. A primitive never takes a group id.

1. **Title gradient:** `bg-group-title-bar`, `text-group-title`, `--ds-group-title-*`
2. **Selection glow:** `Avatar selected` draws a white ring plus the group-colour
   glow (`shadow-group-glow`); `ring-group` is the keyboard focus ring: `Pill`, `Button`, `IconButton` and `RailItem` use
   `focus-visible:ring-2 focus-visible:ring-group`.
3. **Bubble border:** `border-group-bubble`
4. **Badge:** `Badge`, `bg-group-badge`

**Exception:** at most **one** `Button variant="primary"` per screen, which
uses `bg-group-accent` (e.g. the call screen's "answer", a dialog's "save").

The level-0 background (`Canvas`, `bg-group-canvas`) is the official sidebar
gradient. Everything else is neutral: `bg-sheet/card/pill/elevated/sunken`,
`bg-scrim` (the modal backdrop) and `text-primary/secondary/muted/inverse`.
Overlays use `bg-scrim` (`color.overlay.scrim`, `rgba(0, 0, 0, 0.4)`), never
`bg-black/NN`: the token carries its own alpha.

## Scales

| Scale | Utilities | Values |
|---|---|---|
| Text | `text-caption` `text-small` `text-body` `text-title` `text-heading` | 11/16, 13/20, 14/22, 16/24, 20/28 px |
| Radius | `rounded-card` `rounded-sheet` `rounded-pill` (and Tailwind's built-in `rounded-none`) | 14px, 20px, full |
| Shadow | `shadow-pill` `shadow-card` `shadow-sheet` | faint, small, large-soft |
| Spacing | Tailwind default scale (`p-4` = 16px) | multiples of 4px only |
| Motion | `duration-fast` `duration-base` `ease-standard` | 150ms, 200ms, `cubic-bezier(0.2, 0, 0, 1)` |

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
| Keep group colour in the four places, plus one primary button | Colour any other element with the group colour |
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
