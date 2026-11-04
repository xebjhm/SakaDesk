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
- **Form control on state (decided in D2c):** a `Switch` that is on is `bg-group-accent`, and native
  radios, checkboxes and range sliders use `accent-group` (`--ds-group-accent`, the action colour).
  A switch that is off is `bg-control-off` (neutral).
- **Profile card banner (decided in D2c):** the member profile card's banner is the official
  layer, drawn like that group's chat header: `bg-group-title` (gradient groups) or `bg-sheet`
  with the thin `bg-group-title-bar` under it (Sakurazaka's `light` header). It is an allowed
  official-layer use, like the chat header itself.
- **Cross-group markers (decided in D2c):** see [Cross-group markers](#cross-group-markers).
- **Group scope (decided in D2d):** a surface that belongs to one specific service other than the
  active one (that service's login dialog, its sync during the first-launch sync, its inline sync
  view) sets that group's variables on itself with `groupScopeStyle(groupId)`
  (`design/groupScope.ts`); every `*-group-*` utility inside then follows that group. It is the only
  way to show a particular group's colours, and it is never used in lists that mix groups.
- **Neutral before a group is chosen (decided in D2d):** until ToS is accepted and a group is
  selected, `App` applies the `default` group's tokens, so the ToS and landing screens use neutral
  greys through the same roles.

**Exception:** at most **one** `primary` or `danger` Button per screen, and **one per
dialog** (each dialog counts on its own). `primary` uses `bg-group-accent` (the action
colour, step 600), e.g. the call screen's "answer", a dialog's "save"; `danger`
(`bg-status-danger`) is a destructive confirm and takes the place of the primary.

**Member penlight colours (data-driven exception).** The blog reader's corner wash uses the
current member's two penlight colours from member data (`getMemberPenlightHex`), never a
literal. `memberWashStyle()` (`features/blogs/memberWash.ts`) sets `--ds-member-wash-1/2` on
the wash element, and the `bg-member-wash` utility mixes them at `--ds-member-wash-alpha`
(`memberWash.alpha`, 10 %). Both default to `transparent` (no wash for the mascot or an
unknown member). No other element uses member colours.

The level-0 background (`Canvas`, `bg-group-canvas`) is the official sidebar
gradient. Everything else is neutral: `bg-sheet/card/pill/elevated/sunken`,
`bg-scrim` (the modal backdrop) and `text-primary/secondary/muted/inverse`. Search
matches inside text use the neutral mark tokens `bg-mark-exact`, `bg-mark-reading` and
`border-mark-underline` (`color.mark`).
Overlays use `bg-scrim` (`color.overlay.scrim`, `rgba(0, 0, 0, 0.4)`), never
`bg-black/NN`: the token carries its own alpha.

The neutral tokens D2c added (`design/tokens/color.ts`):

- **`status.*`:** status text and icons use `text-status-danger`, `text-status-success` and
  `text-status-warning` (all ≥ 4.5:1 on white, pinned by `d2cTokens.test.ts`), and the
  danger fill is `bg-status-danger` (the `danger` Button). `danger` is 4.8:1 on white only:
  it falls under 4.5:1 on `bg-sunken`, so never put danger text on a sunken surface.
  `bg-status-attention` is only the rail's disconnected badge.
  `bg-status-success` (added in D2d) marks a finished step: the sync phase steps.
- **`overlay.toast`:** toasts use `bg-toast` (with `text-viewer`).
- **`viewer.*`:** the dark photo/video viewer: `bg-viewer-scrim` (its backdrop),
  `bg-viewer-stage`, `bg-viewer-control` (+ `-hover`), `text-viewer`, `text-viewer-muted`
  and `decoration-viewer`.
- **`decor.*`:** the calendar's Sundays use `text-sunday` and About's heart `text-heart`
  (pre-D2c values kept).
- **`mark.*`:** the search marks above (`bg-mark-exact`, `bg-mark-reading`,
  `border-mark-underline`), shared by the blog reader and the search results.
- **The surface ring:** `ring-surface` / `border-surface` are the white gap around avatars,
  and `ring-offset-surface` (`ringOffsetColor.surface`) is the gap colour of a selection ring
  with an offset (the background presets). All three are `--ds-surface-sheet`. There is no
  `bg-surface`: use `bg-sheet`.
- **`surface.window` (D2d):** `bg-window` (`#F0F2F5`) is the window base behind the app (the root
  and the boot screen). It matches pywebview's `background_color` and the `body` colour in
  `index.css`, which stays a literal because it paints before the tokens load.

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
| `action` | 600 | badge, primary button, play / scroll buttons, progress fill | `bg-group-accent`, `bg-group-badge` |
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
highlight. Every other animation stays at 150-200 ms. `animate-reveal` (fade in with an 8 px rise, `duration-base`) is for cards appearing in a feed; pair it with `motion-reduce:animate-none`. The ambient orbs' drift is the documented exception (see Where group colour may appear). `animate-reveal` is also how a sheet dialog enters (`Modal`, see [Dialogs](#dialogs)) and how a toast appears. About's easter egg (`animate-heart-float` 800 ms, `animate-heartbeat` 1.2 s) is the second documented exception; both stop with reduced motion. `bezierEasing` in
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
| Action | `Button`: `primary` or `danger` at most once per screen and per dialog, else `secondary` / `ghost`; `overlay` on the dark viewer |
| Icon-only action | `IconButton` (`aria-label` is required): `secondary`, `ghost`, `overlay` (dark viewer) or `accent` (a floating action in the group action colour, e.g. the chat's unread arrows) |
| Feature-rail entry | `RailItem` |
| Dialog, sheet or dark viewer | `Modal` (`tone="viewer"` for photos and videos) |
| Menu or dropdown of actions | `Menu` + `MenuItem` (`radio` for one-of options) |
| On/off setting | `Switch` |
| Text field / choice | `Input` / `Select` |
| Loading, empty, error inside a dialog | `DialogStatus` |

Screen-specific components (message bubble, member grid cell, chat header)
are composed from these in the feature folder. They are not primitives.

## Dialogs

Every dialog renders through `Modal` (`design/primitives/Modal.tsx`) on the dialog layer
(`design/dialog/`). The frame is `role="dialog"` with `aria-modal`, and it is named by
`title` (the visible h2), `aria-label` or `labelledBy` (an element inside a bare dialog).

| Prop | Values |
|---|---|
| `tone` | `sheet` (default: a level-1 sheet, `bg-sheet rounded-sheet shadow-sheet` on `bg-scrim`) or `viewer` (dark, full screen, on `bg-viewer-scrim`; photos and videos) |
| `layout` | `standard` (header with the title and a ghost close button, body, footer) or `bare` (children straight in the frame: search, the profile card, the entry flows) |
| `placement` | `center` (default) or `top` (15 vh from the top: search) |
| `dismissible` | `true` (default); `false` for flows that must not be skipped (ToS, setup, sync): no close button, and Escape and the backdrop do nothing |
| `closeLabel` | Required whenever the dialog has a close button: `t('common.close')`. Without it there is no close button |
| `logId` | Required on every dialog: its `DialogLogId`, which logs the `dialog` open / close breadcrumbs (data loads inside log `dialog_load`) |
| `initialFocusRef`, `onKeyDown`, `headerExtra`, `footer`, `className`, `bodyClassName` | first focus, the content's own keys, header extras, footer actions, frame and body classes |

- **Escape** goes to the **top-most** dialog only, which closes and claims it
  (`preventDefault`) so the incoming-call overlay does not also decline. It is skipped when
  the key was already handled, during IME composition (`isComposing` / key code 229) and
  while something is fullscreen (the browser leaves fullscreen first).
- **Non-dismissible dialogs do not claim Escape:** a handler further out (the call overlay)
  still sees the key.
- **Focus** moves into the dialog on open (`initialFocusRef`, else the frame) and is restored
  to the opener on close, after the commit. **Tab is trapped:** it cycles over the frame's
  tabbable elements in DOM order, and focus that lands outside the top-most frame is pulled
  back (except in a menu).
- **Nested stacks:** dialogs stack in opening order (`dialogStack.ts`), even when a parent
  and a child open in the same render. Each level is `Z_INDEX.DIALOG` + depth ×
  `Z_INDEX.DIALOG_STEP`, the body scroll is locked while any dialog is open, and closing the
  top one returns focus and Escape to the one below.
- **Scrims:** `bg-scrim` behind sheet dialogs, `bg-viewer-scrim` behind the dark viewer.
  Never `bg-black/NN`.
- **Motion:** a sheet dialog enters with `animate-reveal` (`motion-reduce:animate-none`).
- **Content:** the header is neutral (the title on the sheet plus a ghost close button), a
  dialog has at most one `primary` or `danger` Button, confirms are `ConfirmDialog` (focus
  starts on Cancel) and never `window.confirm`, and loading, empty and error states are
  `DialogStatus`.

## Menus

`Menu` (`design/primitives/Menu.tsx`) is a level-2 popover (`bg-card rounded-card shadow-card`)
with `role="menu"` and an `aria-label`. Its parts:

- `MenuItem`: a `rounded-pill` row with an optional icon; `radio` + `selected` for one-of
  options (`menuitemradio`), `destructive` for a danger action.
- `MenuLabel`: a small heading over a group of items.
- `MenuSeparator`: space between groups, never a line.

Uses: a **point** menu (context menus pass `point` and an `estimatedSize`; it is portaled to
`document.body`, fixed, clamped to the viewport and on `Z_INDEX.POPOVER`), a **dropdown**
anchored inside the frame and positioned by the caller (`Z_INDEX.DROPDOWN`), and a
**popover** the caller portals itself (`layer="popover"`, the player menus).

Keys: the menu takes focus on open; ↑ / ↓ / Home / End move between enabled items; Enter
and Space activate; Tab and an outside mouse-down close it; focus returns to the trigger
(`returnFocusRef`). Escape is handled in the **capture phase**, before a dialog sees it, and
only by the top-most open menu (`menuStack.ts`), so a menu inside a dialog closes alone. The
menu stops its keys from bubbling to a dialog around its trigger (the viewer's arrows).

A text field's suggestion list is not a `Menu` (focus must stay in the field): give it the
same surface classes and `role="listbox"`.

## Cross-group markers

In lists that mix groups (search results and their member filter chips), a 6–8 px dot shows
each row's group in that group's logo colour. The colour is data:
`groupMarkerStyle(getServicePrimaryColor(service))` (`features/search/groupMarker.ts`) sets
`--ds-group-marker` on the dot and `bg-group-marker` draws it (default `transparent`). No other
element uses another group's colour.

## Layering

`Z_INDEX` (`frontend/src/constants/zIndex.ts`) is the only source of layering for
overlays: `DROPDOWN` 50 (menus anchored in the frame), `DIALOG` 100 plus `DIALOG_STEP` 10 per
stacked dialog, `POPOVER` 1000 (portaled menus, above any dialog) and `TOAST` 1100 (above
everything, e.g. the settings error toast). No `z-[…]`, `z-40` or `z-50` classes; `z-10` /
`z-20` stay for stacking inside one frame (sticky headers, viewer chrome).

**The incoming call (D2d).** A call that starts with no dialog open is drawn inside the chat
frame (its `z-30` is local to the chat area). A call that starts while a dialog is open is
**lifted**: portaled over the chat area's rectangle at `interleavedZIndex(order)`
(`dialogStack.ts`), half a `DIALOG_STEP` above the dialogs that were open when it rang, so a
dialog opened during the call still goes above it. It is not on the dialog layer: the layer
leaves Escape and Tab pressed inside it to the call (`useDialog`), and focus there is allowed.
Because the layer does not track the call, a lifted call that goes away with focus inside it
hands focus back to the top-most dialog itself (breadcrumb `call_layer`, `phase` `focus`).

## Do / Don't

| Do | Don't |
|---|---|
| Separate blocks with spacing and levels | Draw straight divider lines (`border-b` between list items, `<hr>`) |
| Use token classes (`rounded-card`, `text-body`, `bg-sheet`) | Hard-code `#hex`, `rgb()`, or arbitrary `rounded-[..]`, `shadow-[..]`, `text-[..]`, `p-[..]` |
| Dim overlays with `bg-scrim` | Dim overlays with `bg-black/NN` or `bg-white/NN` |
| Take group colour from the official layer and the Colour system roles (`groupTokens` / `groupRoles`) | Hard-code a group colour, or colour any other element with it |
| Translate every visible string (`t('…')`) | Put text in primitives; callers pass translated labels |
| Use role names for new tokens (`surface.x`) | Name tokens after hues (`lightBlue`) — dark mode will reuse the names |
| Open dialogs with `Modal` and confirm with `ConfirmDialog` | Build a fixed overlay by hand, or call `window.confirm` / `alert` |
| Layer with `Z_INDEX` | Use `z-[…]`, `z-40` or `z-50` classes |

## Adding or changing a token

1. Edit the right file in `frontend/src/design/tokens/`.
2. Expose it in `frontend/src/design/cssVars.ts`, and in `tailwind.config.js`
   if it needs a utility (and in `utils/classnames.ts` if the utility uses a
   `text-`, `bg-` (image/gradient utilities), `rounded-`, `shadow-`, `duration-` or
   `ease-` prefix).
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

### The dialog style ratchet

`frontend/src/core/dialogs.style.test.ts` checks what the guard does not, for every file D2c
moved onto the system (its `FILES` list; add a file when you restyle it). Each file must have:

- no named palette classes (`bg-gray-100`, `text-white`, `bg-black/50`, …);
- no colour through inline styles (`color:`, `background:`, `boxShadow:` …), except the files
  whose colour is data (`DATA_COLOUR`: the background presets, the search chips' group dot);
- no legacy theme reads (`getServiceTheme`, `useBlogTheme`, `serviceThemes`, …);
- no `window.confirm` / `alert(`, no `z-[…]` / `z-40` / `z-50` classes and no old modal
  shells (`BaseModal`, `DetailModal`, `useModalClose`, the old modal state components).

## Dark mode

Not built yet. Token names are roles so a dark value set can be added
later without renaming anything.
