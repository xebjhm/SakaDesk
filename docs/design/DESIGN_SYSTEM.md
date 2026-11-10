# SakaDesk design system (language v2)

Every screen uses one design language. This file says what it is and how to
use it. **Read it before you add or change any UI.**

## 1. How to use this file

- Tokens live in `frontend/src/design/tokens/`. They are the only place
  design-system style values are defined. Pre-D1 code still reads the legacy
  `frontend/src/config/colors/` and `frontend/src/config/serviceThemes.ts`;
  those are not design tokens and are not scanned by the guard.
- Primitives live in `frontend/src/design/primitives/`.
- See everything live at `http://localhost:5173/?view=design` (dev server
  only; `npm run dev` in `frontend/`). The page has a **context switcher**
  (brand, or one of the groups), contrast labels, the brand ink and aurora,
  every colour role, the expression tiers and every primitive state.
- Components ask for a **role** (`accent`, `accent-strong`, ...), never a hue.
  The surrounding context decides what the role resolves to.
- Token colours are CSS variables, so Tailwind opacity modifiers such as
  `bg-sheet/50` do not work. Add a token instead.

## 2. Brand personality

**A skeleton + C surface.**

- **A, the archive:** calm, refined, trustworthy. Governs working screens:
  stable layout, clear type hierarchy, few but well-made decorations.
- **C, airy:** light, soft glow, frosted glass, pastel gradients. Governs
  expressive moments.
- Rejected: loud, saturated "cheering" styles. The frame must not fight the
  four group colours.

**Doing vs. waiting/finishing.** While the user is **doing** something
(reading, finding, configuring), use tiers L0 and L1. When the user is
**waiting, starting, finishing or looking back**, L2 and celebrations are
allowed. Why: a calm working surface is the product; expression is a reward at
the edges.

## 3. Contexts

The rule is **whose content is it?**

- Content of one group: **group context**.
- The app, the user's account, or anything that spans groups: **brand
  context**.
- A dialog inherits its opener's context (`scope="inherit"`: the scope in `ScopeContext`, which a `BrandScope` or a brand `Modal` provides as brand, else the active group). App-level dialogs are always brand (`scope="brand"`). A group-scoped surface hands its scope to a portalled child dialog with `<ScopeContext.Provider value={{ scope: 'group', style }}>` (`design/scopeContext.ts`); the login dialog does this for the Yodel location warning.
- **Viewer mode** (dark, full screen) belongs to no context; only the content
  shows.
- **Group markers:** inside a brand screen, a piece that names one specific
  group (a group card, a per-group settings row, a search result's source) uses
  `groupScopeStyle(groupId)`.

| Context | Screens |
|---|---|
| Brand | boot screen; ToS; setup wizard; landing; add service (group cards are markers); settings (per-group rows are markers); search, always, even when opened from a chat (each result carries a group marker); about; diagnostics; report issue; update prompt; sync progress and first sync (rows are markers); the group rail frame (search and settings icons use ink; logos keep their colours) |
| Group | feature rail; member list; chat and letters; member profile card; member and message context menus; dialogs opened from a chat (calendar jump, favourites, media gallery, background, sent letters); blogs (feed, reader, member select, timeline); login dialog (that group); incoming call screen and call popup (the member's group); confirm dialog (inherits) |
| Viewer | media viewer, photo detail, blog photo gallery, avatar viewer (stay dark; only the controls are restyled) |

How a context is set:

- **Group context** is the default: `applyTokens` writes the active group's
  variables on the document, and the `*-accent-*` / `*-expressive-*` utilities
  read them.
- **Brand context:** `brandScopeStyle()` (`design/brandScope.ts`) returns inline
  custom properties that set every accent / expressive variable to the brand
  values (ink and aurora) on one element. `<BrandScope>` is a `div` that applies
  it (`data-scope="brand"`). `Modal scope="brand"` applies it to the dialog.
  Brand screens and app-level dialogs apply it to themselves, so a brand dialog
  is brand whichever group is active.
- **Group scope:** `groupScopeStyle(groupId)` (`design/groupScope.ts`) sets one
  specific group's variables on a surface that belongs to that service (its login dialog, its inline sync view, a group marker inside a brand screen). Every `*-group-*` utility, and the
  official layer, inside then follows that group. It is never used in lists
  that mix groups. A primitive never takes a group id.
- **Group markers in a brand dialog** use `useGroupMarker(serviceId, target)`
  (`design/useGroupMarker.ts`): it returns `groupScopeStyle` for that service's
  group, so the `*-accent-*` utilities inside follow it (the add-service cards, the per-group rows in Settings' Sync tab with a chip naming the group, the landing cards, the ToS links, each step of a sequential sync and its chip). An
  unknown service leaves the piece in brand and logs `group_marker_fallback`
  (`target`: `add_service`, `settings_row`, `landing`, `tos_link` or `sync_row`; `reason`: `unknown_service`).
  It is a hook: call it in a small per-item component, never inside a `.map` callback.

Status: the frame and chat screens (group rail, feature rail, member list, chat,
letters, profile card, chat menus, call popup) and the blog screens (feed, reader,
rail, member select, member timeline) and the dialogs (settings, search, about,
diagnostics, report issue, add service, confirm, login, and the chat dialogs:
calendar, favourites, media gallery, background, sent letters) apply this table.
The entry screens (boot, ToS, landing, setup, sync) apply it too: the screen re-apply is complete.

## 4. Colour

### Brand: ink and aurora

The brand never takes a group's place; it hosts them (`design/tokens/brand.ts`).

- **Ink scale** (`brandInk`, hue 262, chroma at most 0.06): 50 `#f4f7fc` ·
  100 `#e9eef7` · 200 `#d5deee` · 300 `#bac8e0` · 400 `#9dafce` ·
  500 `#8296b9` · 600 `#63769a` · 700 `#4d5e7d` · 800 `#3a4860` ·
  900 `#293345`. Step 600 carries white text at 4.6:1. The solid ink sits next
  to group logos on the rail and never competes with them.
- **Aurora** (`aurora.gradient`, `bg-aurora`): `linear-gradient(120deg, #cfe6ff
  0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)`, sky to lavender to pink to
  peach. Text on it is always dark (`text-primary`), never white. Its orbs are
  `#bfdcff`, `#ffd0e4`, `#e2d6ff`.
- The aurora mixes the groups' hues on purpose: the app exists to serve the
  Sakamichi groups.

### Group colours

Every group colour comes from `frontend/src/design/tokens/groups.ts` through
one of two layers:

- **Official layer** (`groupTokens[id].official`): title gradient, thin bar and
  title text, the canvas (sidebar) gradient, unread-shelter colours and the
  `shelterStyle` / `headerStyle` switches. For Hinatazaka, Sakurazaka and
  Nogizaka these were copied from the official apps and are kept verbatim;
  tests pin them. Do not "fix" them to match the scale. Hinatazaka's unread
  shelters were re-taken from the official app screenshots on 2026-11-08
  (picture `#b2caed`, video `#ceadec`, voice `#b7acec`, text `#85badd`, style
  `classic`). Nogizaka's shelter values are approximations from the first theme
  commit, not yet verified against the official app (code comments mark them;
  to be re-taken from screenshots later). Yodel's shelters are logo-derived on
  purpose (owner decision 2026-11-09); a per-OG penlight layer is planned.
  Shelter icons are drawn at full opacity.
- **System layer:** each group has its logo colour and a 10-step scale (50
  lightest to 900 darkest, logo colour snapped into its step).

**Yodel** is based on its logo periwinkle `#6060e0` (step 600): 50 `#f3f6ff` ·
100 `#e7ecff` · 200 `#d2daff` · 300 `#b5c0ff` · 400 `#98a2ff` · 500 `#7e85ff` ·
600 `#6060e0` · 700 `#4c4bbb` · 800 `#393992` · 900 `#28286b`. The old green
was the colour of one member's page. Yodel has no official periwinkle data, so
its official fields are **system-derived** from the scale (title gradient
200 → 400 → 600, bar 200 → 600, title text 700, canvas 100 → 50 → near white,
shelters 300 / 400 / 500 / 600, bubble border and glow from the logo). They are
labelled that way in `groups.ts`. The logo-derived shelters are on purpose
(owner decision 2026-11-09); a per-OG (penlight) colour layer is planned.

**Reserved: per-OG layer.** A room-level Yodel override through
`groupScopeStyle`, falling back to periwinkle. Not built.

Group roles come from `groupRoles(id)` in `design/tokens/roles.ts`. Contrast
floors are pinned by tests: the action colour with white text at 3:1 or better
(Hinatazaka 600 `#389DD1`, 3.0:1, is an accepted deviation, see section 12).

### Ink neutral and the "no tint on large surfaces" rule

Surfaces, text and borders (`color.surface`, `color.text`, `color.border`) are
the **ink neutral**: Tailwind grays at hue 257-264 and chroma at most 0.03, the
same hue as the brand ink. They are the same in both contexts.

**Large surfaces (sheet, card, bubble, chat background, dialog body) stay pure
white or near-white with no tint. Tint lives only in text, borders and
inputs.** A tinted, darker surface set was tried and rejected as too blue and
dark.

Neutral utilities: the level-0 background (`Canvas`, `bg-group-canvas`) is the
official sidebar gradient; everything else is `bg-sheet`, `bg-card`, `bg-pill`,
`bg-elevated`, `bg-sunken`, `bg-window` (the window base behind the app, the
colour of pywebview's `background_color`), `bg-frost` (the frosted bar over the blog
feed's orbs: `--ds-overlay-frost`, white at 72 %, paired with `backdrop-blur-frost` (20 px), `backdrop-saturate-180` and
`border-b border-frost`, the white hairline at 40 %: `--ds-overlay-frost-border`), `bg-scrim` (the modal backdrop,
carries its own alpha, never `bg-black/NN`), `text-primary`, `text-secondary`,
`text-muted` (`#6b7280` since 2026-11-08, darker than the old `#9ca3af` for readable metadata),
`text-inverse`, `border-subtle`, `border-strong`. Search matches
use `bg-mark-exact`, `bg-mark-reading` and `border-mark-underline`. The white
gap around avatars and selection rings is `ring-surface` / `border-surface` /
`ring-offset-surface` (there is no `bg-surface`: use `bg-sheet`). Toasts use
`bg-toast` with `text-viewer`. The calendar's Sundays and public holidays use
`text-calendar-holiday` (`#DC2626`) and its Saturdays `text-calendar-saturday` (`#2563EB`)
(`color.calendar`, `--ds-calendar-*`; see "Date-search calendar"), and About's heart
`text-heart`. `bg-control-off` is an off switch.

Chat header pills: `bg-header-glass` (unread) and `bg-header-shade` (sync) on a
title gradient; on a light header `bg-group-title-tint` / `bg-group-title-wash`
with `text-group-title` (official layer).

Unread shelters: `bg-` / `border-` / `text-group-shelter-{picture,video,voice,text}`
(official layer, `--ds-group-shelter-*`).

Viewer chrome (dark photo and video viewer): `bg-viewer-scrim`,
`bg-viewer-stage`, `bg-viewer-control` (+ `-hover`), `text-viewer`,
`text-viewer-muted`, `decoration-viewer`.

Photo zoom in the dark viewer (`core/media/useZoomPan.ts`, 1–4×): the mouse wheel zooms around
the cursor anywhere in the viewer (a non-passive listener that never scrolls the page behind);
↑ / ↓ step 0.25× around the centre; the top-left zoom out / fit / zoom in controls are `overlay`
`IconButton`s (full circles, `aria-disabled` at the limits so focus and ← / → survive); when
zoomed the photo pans by dragging (`cursor-grab` / `cursor-grabbing`, pointer capture, clamped so
the photo always covers its own box), and a double-click toggles fit ↔ 2× at the click point.
← / → always step older / newer, never pan. The transform eases with `duration-fast`, not while
dragging and not with reduced motion. Zoom and pan reset when the item changes. Video and voice
have no zoom and leave the wheel and ↑ / ↓ to the player.
The media gallery's own detail view (`MediaGalleryModal`, photos only) uses the same hook and
the same three controls, with ↑ / ↓ zoom and ← / → still older / newer.

Developer console (the hidden Diagnostics panel only): `bg-console`, `bg-console-badge`,
`text-console`, `text-console-muted`, `text-console-prompt`, `text-console-error`,
`text-console-warning`, `text-console-badge`.

### Semantic colours

Global: they never follow context. Danger is always the same brick red, in
brand and in group screens. They are harmonized (chroma about 35 % below signal
colours) so they sit with the aurora. `color.semantic` has five steps per set:

| | subtle (banner bg) | icon (icon circle bg) | border | solid (destructive fill) | text |
|---|---|---|---|---|---|
| success | `#f0fbf4` | `#e3f6ea` | `#cae8d7` | `#2e805a` | `#216a49` |
| warning | `#fff5ed` | `#feedde` | `#f6dac3` | `#9b5e1e` | `#824c13` |
| danger | `#fff3f1` | `#ffe7e4` | `#ffd1cd` | `#b44543` | `#963635` |
| info | ink 50 | ink 100 | ink 200 | ink 600 | ink 700 |

- Utilities: `bg-semantic-{success,warning,danger,info}-subtle`,
  `bg-semantic-{...}-icon`, `border-semantic-{...}`, `text-semantic-{...}`
  (the `text` step). The old names still work and map to the new steps:
  `bg-status-danger`, `bg-status-success`, `bg-status-attention` (solid; attention
  is warning) and `text-status-danger`, `text-status-success`,
  `text-status-warning` (text).
- Icons: an icon-step background, a border-step outline and a text-step glyph.
  The solid step is only for destructive buttons and finished-step marks.
- Danger is deliberately not pulled toward the brand, which would read as
  Sakurazaka pink. Info uses the brand ink; there is no separate blue (it
  would be confused with Hinatazaka).
- Danger text is 4.8:1 on white only. Never put danger text on `bg-sunken`.

### Semantic over context

An element with a fixed meaning keeps its meaning colour in every context. The
group accent says where you are; a meaning colour says what a thing is.

- **Muted text on grey.** `text-muted` (#6b7280) is for white and near-white surfaces only. On a grey fill
  (`bg-sunken`, the segment track, the Background preview) use `text-secondary` (#4b5563, at least 4.5:1).
- **Windows title bar.** The main window keeps the native frame; on Windows 11 (build ≥ 22000) the
  caption, caption text and window border are recoloured to `color.surface.window` (#F0F2F5) and
  `color.text.primary` (#1F2937) through DWM (`window_chrome.py`, which mirrors these two values; a test
  cross-checks them against `design/tokens/color.ts`). Older Windows keeps the default bar.
- **Scrollbars** are slim and app-wide (`index.css`): a constant 10 px scrollbar box with a 6 px
  rounded thumb drawn inside a transparent border, which grows to 8 px and darkens on hover (no
  layout change). Scrollers that reach a rounded sheet's bottom corner (the chat timeline and a Modal body with no footer and not `tone="viewer"`) carry
  `sd-sheet-scroll`, which insets the track bottom by `--ds-radius-xl` (24 px, the sheet
  radius) so the thumb is not clipped by the corner; there is no top inset (a header sits above). Thumb colours are the `--ds-scrollbar-thumb*`
  tokens (`color.scrollbar`: translucent ink on light surfaces; `thumbOnDark*`, translucent white, inside
  `[data-surface="dark"]`, which `Modal tone="viewer"` sets, the call overlay and the Diagnostics console). Firefox gets
  `scrollbar-width: thin` + `scrollbar-color` only where `::-webkit-scrollbar` is unsupported.
- **Favourites video cards** show a shimmer sweep and a centred `Film` icon (`text-secondary`) on `bg-skeleton`
  (`--ds-border-strong`) and mount the `<video>` only when the card nears the dialog body's visible area.
  Favourites voice cards lazy-mount the same way: until the card nears the visible area a same-height
  placeholder holds the layout and the voice player (and its audio request) is not mounted.
- **推 (oshi)** hearts and the Favorite filter use the global oshi pink,
  `color.semantic.oshi`: subtle `#fff0f8`, border `#ffcbe1`, solid `#de5f99`
  (white glyph 3.4:1, icons only), text `#aa376f` (6.0:1 on white, 5.5:1 on
  subtle). Utilities: `text-semantic-oshi`, `bg-semantic-oshi-subtle`,
  `bg-semantic-oshi-solid`, `border-semantic-oshi`, `ring-semantic-oshi`,
  `fill-semantic-oshi`. The blog feed's All / Favorite control shows its selected
  segment in `text-semantic-oshi` (the heart `text-semantic-oshi-solid`), and
  `Pill tone="oshi"` gives any other 推 filter the oshi roles. An unselected
  heart outline uses `text-semantic-oshi-solid` (the vivid pink, 3:1 for an icon).
- **The favourite star** on a bookmarked chat message is the original yellow,
  `color.semantic.star` `#facc15` (`text-semantic-star`, with a small drop
  shadow for definition on white), the same in every group. Favourites shows the
  same yellow star on each bookmarked message, and so does the favourite icon in
  the message context menu.
- Danger and success stay semantic as above.
- Not oshi: About's "made with love" heart (`text-heart`, `decor.heart`) and
  anything else that is merely pink.

### Accent roles (the context mechanism)

Components ask for a role; the context decides the value
(`design/tokens/accent.ts`, `AccentRoles`):

| Role | Brand context | Group context | Utilities |
|---|---|---|---|
| `accent` (step 600) | ink 600 | group 600 | `bg-accent`, `text-accent`, `border-accent`, `ring-accent`, `accent-accent` (native controls) |
| `strong` (700) | ink 700 | group 700 | `text-accent-strong` |
| `subtle` (50) | ink 50 | group 50 | `bg-accent-subtle`, `ring-accent-subtle` (the running sync step's halo) |
| `border` (200) | ink 200 | group 200 | `bg-accent-border`, `border-accent-border`, `ring-accent-border` |
| `logo` | ink 400 | group logo | the light end of the gradient; `bg-accent-logo` (the member-timeline expanded month disc); `ring-accent-logo` (the landing card selection ring) |
| `glow` | ink 500 at 0.35 | group glow | `shadow-accent-glow`, `shadow-accent-glow-hover`, `shadow-accent-halo` (selection halo on avatars and the rail logo) |
| `gradient` | ink 400 → 600 | logo → 600 | `bg-accent-gradient` (primary button) |
| `wash` / `wash-border` | logo 8 % → accent 6 % at 135°; logo 19 % hairline | same | `bg-accent-wash` / `border-accent-wash` (a quiet accent control at rest: Select Member, Photo Album; hover fills with the gradient or `bg-accent-subtle`) |
| `tonal`, `tonalText` | ink 200 → 400 mixed 35 % with white; ink 800 | the same from the group scale | `bg-accent-tonal`, `text-accent-tonal` |
| `unread` | ink 400 glow | group unread shadow | `shadow-accent-unread` |
| `soft` | aurora | group 50 → 100 | `bg-expressive-soft` |
| `header`, `headerText`, `headerBar` | aurora, dark text, no bar | title gradient (Sakurazaka: white sheet, dark text, bar) | `bg-expressive-header`, `text-expressive-header`, `bg-expressive-header-bar` |
| `headerFocus` | dark text (= `headerText`) | white (= `headerText`) on a gradient header; step 700 (`strong`) on a light header | `ring-expressive-header-focus` (focus ring of buttons on the expressive header) |
| `progress` | aurora | the title gradient (a light header: the official bar) | `bg-expressive-progress` (the sync progress fill) |
| `orb1`-`orb3` | aurora orbs | the group's ambient orbs | `bg-expressive-orb-1`, `-2`, `-3` |

The CSS variables are `--ds-accent-*` and `--ds-expressive-*`
(`design/cssVars.ts`). The `--ds-group-*` variables stay for the official layer
(title, canvas, shelters) and the legacy group utilities.

**Pre-token media parts** (voice player, transcript and transcribe
buttons) mix their accent in inline styles: they default to `ACCENT`
(`var(--ds-accent)`) and mix through `withAlpha(colour, percent)`
(`design/colorMix.ts`). New components use utilities. On the compact voice
player's `bg-sunken` card, the mute and menu buttons hover one step darker
(`hover:bg-sunken hover:brightness-94`), never lighter.

### When to use the group colour

The group colour does exactly three jobs: **A. identity** (whose space this is: the group canvas and rail block, the chat header, the group's own content, group markers in cross-group lists, the dialog expressive header); **B. current state** (active tab, selected nav item or row, slider fill, switch on, checked, progress); **C. the one primary action** of a view (primary `Button`). Everything else is neutral: secondary and tertiary actions, disclosure and utility controls, counts and metadata, tooling surfaces. Decoration that stays group-coloured is pastel strength, never solid. Nothing accent-coloured sits on the accent gradient header. Semantic colours (danger, warning, success, oshi pink, yellow star) are unchanged. The 翻譯 translate control (`TranslateButton`, dark variant) is a neutral utility control: `text-secondary hover:text-primary`, no accent. In chat it is one icon-only "文A" button (`iconOnly`, lucide `Languages`; the label is its `aria-label` and `title`; spinner while loading, alert icon on error) in the trailing column at the bubble's bottom-right of every message, run start and continuation alike (never in the run-start header); the blog reader keeps the text-label form. The voice/video transcript 「顯示文字」 control (`TranscribeButton`, dark variant) is neutral in the same way: `border-subtle text-secondary hover:text-primary`.

| Job | Examples |
|---|---|
| A. identity | chat header, group rail block, group markers in cross-group lists, dialog expressive header |
| B. state | active tab, selected rail item, slider fill |
| C. primary | Done, Save |
| Neutral | the transcript "Show text" control, Reset to Default, Jump to Date, Today, Refresh, Cancel, Verify now, Check now, counts, the letter viewer's date link and older / newer buttons |
| Pastel decoration | empty-state soft circle, milestone card surface |

Pre-existing accents from the original design stay until the owner revisits
them: the ⋯ conversation-menu icons, the
member-timeline row hover tint and expanded month count pill, the sent-letters
hover, the blog-feed "Select member" pill (pastel tint with a gradient hover), the
blog nav footer glow, and the ToS per-group links.

## 5. Expression tiers

Expression is about intensity, not on or off.

| Tier | What | Where it is allowed |
|---|---|---|
| **L0 Quiet** | accent roles only: subtle selected background, selection bar, link colour | dense reading and work surfaces: lists, settings rows, message text, blog body |
| **L1 Interactive** | primary button gradient; hover glow; selection glow; badge and unread glow; gradient dialog headers; modal accents (subtle background, border, selected states) | everything interactive, in both contexts |
| **L2 Atmosphere** | slow drifting orbs and frosted glass (`Atmosphere`) | low-density screens only: blog feed, landing, empty states, about, incoming call, first launch |

The restore inventory: the expressive elements of the pre-D2 look, as tokens.

| Element | Utility or primitive |
|---|---|
| Button gradient `linear-gradient(135deg, logo, 600)` | `bg-accent-gradient` (primary `Button`) |
| Hover glow on interactive cards | `shadow-accent-glow-hover` (`hover:` on the card) |
| Dialog gradient header (and the bar under a light header) | `Modal` expressive header: `bg-expressive-header`, `text-expressive-header`, `bg-expressive-header-bar` |
| Modal accents (selected row, border, tint) | `bg-accent-subtle`, `border-accent-border`, `text-accent-strong` |
| Unread shadow | `shadow-accent-unread` |
| Ambient orbs | `Atmosphere` (`bg-expressive-orb-*`); the blog feed's `DynamicBackground` draws `bg-expressive-orb-*` with the per-group size and opacity from `design/tokens/ambient.ts` (orb 1 at its pre-D2 strength under the frosted header) |
| Soft panels (empty-state circle, milestone card) | `bg-expressive-soft` |
| Landing per-group cards, ToS gradient button | group markers (`useGroupMarker(…, 'landing')`, selected ring `ring-accent-logo`, check disc `bg-accent`) + the primary `Button` |
| ToS per-group links | group markers (`'tos_link'`), `text-accent-strong`, underline on hover |
| ToS amber disclaimer, sync media warning and unresolved list | `bg-semantic-warning-subtle`, `border-semantic-warning`, `text-semantic-warning` |
| Sync progress bar (pastel in the dialog, title gradient inline) | `bg-expressive-progress` |

## 6. The four levels

| Level | Primitive | Corners | Shadow | Holds |
|---|---|---|---|---|
| 0 Background | `Canvas` | none | none | rails, the space around the sheet |
| 1 Sheet | `Sheet`, `Modal` | `rounded-xl` (24px) | `shadow-sheet` | the one content area: chat, blog, dialogs |
| 2 Card | `Card` | `rounded-lg` (16px) | `shadow-card` | bubbles, photos, info cards |
| 3 Tag-like | `Pill`, `Badge`, `DatePill` | `rounded-full` | `shadow-pill` | tabs, filters, dates, badges |

A level sits on the level below it. Do not put a sheet on a card. `Button` is
not a level-3 pill: it is `rounded-md`. The primitives still write the
deprecated names (`rounded-sheet`, `rounded-card`, `rounded-pill`), which are
aliases for the same values.

## 7. Radius

Six steps (`design/tokens/radius.ts`), used through `rounded-*`:

| Step | px | Use |
|---|---|---|
| `xs` | 4 | bubble tail corner (`rounded-tl-xs` is the target name; `MessageBubble` still uses `rounded-tl-tail` today), small inner chips |
| `sm` | 8 | menu items, list items, tabs inside a container |
| `md` | 12 | buttons, inputs, small cards, toasts |
| `lg` | 16 | cards, bubbles, popovers, member cards |
| `xl` | 24 | sheet, dialogs, heroes |
| `full` | 9999 | tag-like items only: date pill, filter chips, badges, avatars, switches |

`rounded-none` is also defined.

- **Concentric rule:** a nested box has inner radius = outer radius minus
  padding, never below `xs`.
- **Deprecated aliases** still resolve: `rounded-tail` (= `xs`), `rounded-card`
  (= `lg`), `rounded-sheet` (= `xl`), `rounded-pill` (= `full`). New code uses
  the steps.
- `rounded-2xl` / `rounded-3xl` are banned (the guard counts them): Tailwind's
  2xl (16 px) reads larger than the token `xl` (24 px). Use `lg` / `xl`.

## 8. Typography

- **Faces:** `font-sans` (default, body and UI) and `font-display` (serif, for
  brand-moment headings only: landing hero, empty-state titles, about,
  celebration numbers, year-recap slide titles).
  The year recap (`features/memories/recap/slides/common.tsx`) has three type roles: the slide
  title (`Headline`: `font-display text-heading font-semibold`, UI language, never `lang="ja"`),
  her quoted words (`Quote`: `font-display` marked `lang="ja"`) and the app's narration
  (`Narration`: `font-sans text-small`, so it never reads as her words). The year poster (`recap/PosterView.tsx`) keeps the same roles; its polaroid caption uses `font-display` (there is no handwritten face in the stack). The share export (`recap/share/ShareRenderer.ts`) draws on a canvas with the same roles: the UI language's display serif for headings and numbers, the Japanese serif (`fontFamily.reading`) for her words, the sans for narration; it loads them with `document.fonts.load` (with a timeout, else system fonts) and reads every colour from the token CSS variables. The multi-member opening (`recap/Opening.tsx`, slides in `recap/slides/OpeningSlides.tsx`) plays through the same story player with the same roles: a serif `Headline`, member names as `lang="ja"` sans, role titles as neutral `bg-expressive-soft` chips, sans `Narration`; its stars are one equal size in `text-primary` (never the yellow favourite star, never sized by message volume), laid out by `starGrid` in a size-container grid whose star and caption sizes are container units, so every member fits the stage at any roster size (names truncate, stars never clip). The container-unit sizing needs CSS that has no token, so it lives in named `tailwind.config.js` utilities rather than arbitrary values: `recap-star-grid` (the size container: `--star-cols` x `--star-rows` equal cells, at most 5.5rem a row), `recap-star-size` (the star, `--star-size`) and `recap-star-label` (the captions, `--star-label` at line height 1.2, `STAR_LINE_HEIGHT`); the slide sets the four variables from `starGrid`. `size-em` sizes an inline icon (the oshi heart) to one text height. `font-reading` is the Japanese serif for blog titles
  only; post bodies stay in the sans.
- **Per UI language** (`design/fonts.ts`, `fontStacks`): the UI language picks
  the glyph set, and only that language's family is loaded from Google Fonts
  (`unicode-range` slicing). `installLanguageFonts()` runs once in
  `shell/main.tsx` and again on every language change.

  | UI language | Sans | Serif |
  |---|---|---|
  | `ja` | Noto Sans JP | Noto Serif JP |
  | `zh-TW` | Noto Sans TC | Noto Serif TC |
  | `yue` | Noto Sans HK | Noto Serif HK |
  | `zh-CN` | Noto Sans SC | Noto Serif SC |
  | `en` | Noto Sans | Noto Serif |

  Every stack falls back to the Japanese stack.
- **Japanese content rule:** `[lang="ja"]:not(html)` in `@layer base`
  (`frontend/src/index.css`) switches the font variables to the Japanese
  families for any element marked `lang="ja"`, whatever the UI language. It is
  scoped to marked content, not `<html>`, so the UI's stacks keep working.
  Companion rules `[lang="ja"]:not(html).font-reading` and `.font-display` keep
  the serif reading and display faces on marked titles (the base rule would
  otherwise win on the same element and render them sans).
  Marked so far: message text, member names (member list, chat header,
  bubbles, profile card, call screen), letter text and voice transcripts. Blog
  content (post titles, bodies, member names on cards, in the reader, in the member
  select and the timeline) is marked too. Dialogs mark member names and message text
  in favourites and the media gallery (lists and their viewer captions), letter text, search results
  (member, room, blog title, snippet) and filter chips, and group names shown as data
  (add service, the settings marker chip). Entry screens mark the ToS article quotes, group names on the landing cards and the sync chip, and member names in the sync's unresolved list. UI chrome is never marked.
- `index.html` still loads Noto Sans JP and Noto Serif JP statically, because
  Japanese content always needs them.
- **Sizes** (`text-*`, size / line height): `text-caption` 11/16,
  `text-small` 13/20, `text-body` 14/22, `text-title` 16/24,
  `text-heading` 20/28, `text-display` 32/40 (brand moments only),
  `text-reading` 16/28 (long-form reading, blog posts only).
- Use Tailwind's `tabular-nums` for stats, times and counters.

## 9. Buttons and states

`Button` and `IconButton` (`design/primitives/Button.tsx`).

| Variant | Look | Rule |
|---|---|---|
| `primary` | `bg-accent-gradient`, white bold text, glow shadow | at most one `primary`, `warning` or `danger` per screen and one per dialog (each dialog counts on its own) |
| `tonal` | `bg-accent-tonal`, dark accent text | reserved: no production call site. Do not use it for secondary actions under the colour rule (those are `secondary` or `ghost`); never competes with primary |
| `secondary` | white, neutral border, neutral text | cancel and so on |
| `ghost` | text only, `text-secondary`, `hover:bg-sunken` | neutral secondary / tertiary action; never the group colour (matches `IconButton` ghost) |
| `warning` | `bg-status-attention`, white text | a cautionary confirm; takes the place of the primary |
| `danger` | `bg-status-danger`, white text | a destructive confirm; takes the place of the primary |
| `overlay` | `bg-viewer-control` | controls on the dark viewer |

`IconButton` (an `aria-label` is required) has `secondary`, `ghost`, `overlay`,
`accent` (a floating action, e.g. the chat's unread arrows) and `soft` (the
accent on its subtle tint, filled on hover: the group rail's actions). `shape`
is `circle` for floating buttons (`overlay` and `accent` by default) and
`rounded` (12 px) for inline ones. Sizes: `sm` (`h-8`) and `md` (`h-10`).

| State | Rule |
|---|---|
| default | as specified per variant |
| hover | `hover:brightness-106` and `hover:-translate-y-px`; the glow grows (`shadow-accent-glow-hover`) |
| pressed | `active:scale-97` and `active:brightness-94`; the glow shrinks |
| focus-visible | 2 px `ring-accent` with a 2 px `ring-offset-surface` gap. **Exception, buttons on the expressive header** (the dialog close button, the chat header ⋯): no accent on the title layer, so `ring-expressive-header-focus` with `ring-offset-0`. That ring is the header text colour on a gradient header (the same colour as `ring-expressive-header`) and the group's strong title tone (step 700) on a light title header (Sakurazaka: `#a72f5d`, 6.5:1 on white, where the pale title text is only 2.4:1) |
| loading | `loading` prop: a spinner is overlaid, the label stays so the width does not change, clicks are swallowed, `aria-busy` is set |
| selected | `bg-accent-subtle` background + `border-accent-border` + `text-accent-strong` text |
| **disabled** | **keeps its colour** at 40 % opacity, no shadow, `cursor-not-allowed`, and **always shows a reason** |

- `disabledReason` (a translated string) makes the button `aria-disabled`: it
  stays focusable, the reason is its `title` and its `aria-describedby` text,
  and clicks do nothing. A native `disabled` **without** a reason logs a
  development warning.
- **Greying out is banned** (grey background, grey text): it looks broken.
- **Forms never disable the submit button** (login, add service, setup). They validate
  on click and show what is missing. Setup logs a missing folder as `entry_validation` (`surface` `setup`, `reason` `missing_folder`).

## 10. Brand moments

Brand moments are for waiting, starting, finishing and looking back
(`design/primitives/`).

- **`EmptyState`** (`icon`, `title`, `description`, `action`): a fixed
  pattern. A `bg-expressive-soft` circle (aurora in brand context, group 50 →
  100 in group context) holding a line icon in `text-muted` (the pre-D2 grey), a `font-display` title, one
  sentence and one action. `DialogStatus` and `BlogStatus` draw their `empty` kind with it (the hint is its sentence, the retry its action); the chat's no-conversation screen uses it too, and so does the Talk sidebar's failed-load state (a `CloudOff` icon, a reassuring sentence and a `secondary` Retry). A meaning icon keeps its own colour (the blog feed's Favorite-filter heart stays oshi).
- **`Atmosphere`** (`fade`): L2. Three drifting orbs (`bg-expressive-orb-*`,
  `animate-orb-drift-1/2`, `animate-orb-breathe`) behind its children.
  Each orb is a square box (a width plus `aspect-square`, never a separate height),
  so the circular gradient ends inside its `rounded-full` box and never shows a
  straight edge. `fade` wraps only the orb layer in `mask-fade-y` (transparent at
  the top and bottom edges, a `tailwind.config.js` utility) for a short box that
  would otherwise cut the orbs flat; About's hero uses it.
  Low-density screens only. The blog feed pairs its orbs with a `bg-frost` header
  (L2: orbs + frosted glass); the reader is L0 and has no glass. The feed's
  All / Favorite filter is one segmented control (see "The blog feed").
- **`CelebrationToast`** (`title`, `description`, `icon`): tier B. A solid
  sheet toast (`bg-sheet`, `animate-toast-in`; the caller positions it, typically bottom-right) with one aurora shimmer (`animate-shimmer`)
  and ten sparkles (`animate-sparkle`). `role="status"`.
- **`MilestoneCard`** (`value`, `label`): tier C. A card in the timeline
  (`font-display` number with `tabular-nums` in `text-primary`, `bg-expressive-soft`
  surface with an accent border, no glow, `animate-pop`) with 26 pieces of short confetti (`animate-confetti`) in the
  context accent colours.

Celebration events (tiers B and C only; there is no full-screen tier):

| Event | Context | Tier | Form |
|---|---|---|---|
| First complete sync | brand | B | toast + one shimmer + about 10 sparkles; once ever |
| A member reaches 1,000 / 5,000 / 10,000 messages | group | C | the next time that chat opens, a milestone card in the timeline + confetti of at most 1.2 s in the group colours |
| Subscription day 100, then every full year | group | C | the same card |
| Member birthday | group | C | later, together with the Memories project |

Rules: each event is celebrated once; a celebration never blocks input and
never needs dismissing; with `prefers-reduced-motion` only the static card
shows (the motion classes carry `motion-reduce:` variants). The primitives
exist and are shown on `?view=design`.

Wiring:

- **First complete sync:** `FirstSyncToast` (`shell/components/FirstSyncToast.tsx`) at the
  bottom right on the toast layer for 6 s, `pointer-events-none`, in brand scope, with the
  saved message count from `GET /api/archive/stats` when known. Shown once, after the
  first-launch sequential sync when every service finished (`shell/firstSyncCelebration.ts`,
  pref `first_sync_celebrated_at`). Breadcrumb `celebration` (`target` `first_sync`,
  `outcome` `shown`, or `skipped` with `reason` `already_celebrated` / `sync_cancelled` /
  `sync_failed`). The sequence itself logs `sync_sequence` (`outcome` `all_complete` /
  `partial` / `none` / `cancelled`, `count` of finished services); Cancel ends the whole
  first-launch sync, not just the running step.
- **Milestones:** `useMilestone` (`features/messages/milestones.ts`) decides once per chat
  open for member chats (not group chats); pref `celebrated_milestones`. The first time a
  chat is seen its already-reached milestones are recorded silently; then at most one card
  per open (a messages milestone first, else a days one). A milestone not shown waits for a
  later open, and an empty room seeds nothing. `MilestoneFooter` shows the card in
  `MessageList`'s `footer` slot, after the newest message. Breadcrumb `celebration`
  (`target` `milestone_messages` / `milestone_days`, `outcome` `shown` with `count`, or
  `seeded`, or `skipped` with `reason` `no_messages`).

Other brand moments: first launch (ToS, the login carousel, setup and the first sync) sits on `EntryBackdrop` (`shell/components/EntryBackdrop.tsx`: the brand orbs over `bg-window`, also behind a blocking sync); the boot screen is brand with an ink spinner and no orbs (it shows on every launch); the landing page is a brand sheet on the orbs with a serif `text-display` heading. About opens on a hero of brand orbs under its aurora header (logo, `text-display` serif wordmark, version) and the tagline, credits and repository link. About shows only SakaDesk's own information; the archive statistics (`GET /api/archive/stats`, `core/modals/archiveStats.ts`) now feed only the first-sync toast, and the personal-summary view is their long-term home (ROADMAP P1.1 Phase 4).

## 11. Motion and elevation

- `motion.duration` (`design/tokens/motion.ts`): `fast` 150, `base` 200,
  `glide` 400, `landing` 1400, `toast` 350 ms. Utilities: `duration-fast`,
  `duration-base`, `duration-glide`, `ease-standard`
  (`cubic-bezier(0.2, 0, 0, 1)`). framer-motion reads numbers:
  `transition={{ duration: motion.duration.base / 1000, ease: motion.easing.standard }}`.
- Every animation is 150-200 ms. The listed exceptions: `duration-glide`
  (scroll glides, and the blog feed caption card's hover nudge through
  `transition-caption`), `animate-landing` (1400 ms, the landed-row highlight),
  the ambient orbs' 22-34 s drift (`animate-orb-drift-1/2`,
  `animate-orb-breathe`), About's easter egg (`animate-heart-float` 800 ms,
  `animate-heartbeat` 1.2 s), and the celebrations: `animate-toast-in` 350 ms
  (the toast entrance), `animate-shimmer` 1.2 s, `animate-shimmer-sweep` 1.4 s (the looping
  loading sweep on a Favourites video placeholder; hidden under reduced motion), `animate-pop` 500 ms,
  `animate-confetti` 1.2 s, `animate-sparkle` 900 ms, the year recap's slide motion
  (`animate-star-fall` 600 ms, `animate-fan-in` 500 ms, `animate-petal-fall` 1.6 s and the
  long letter's `animate-letter-scroll` 6 s, all on the `ease-standard` curve; the letter scroll
  reads its distance from `--letter-scroll`;
  every recap slide's motion (reveals, star fall, photo fan, petals, letter scroll) holds while the player is paused through
  `animation-play-state`), and the blog feed's
  original motion (`duration-lift` 500 ms, `duration-zoom` 700 ms and the
  caption's `transition-caption` on the feed tile, `duration-lens` 300 ms on the
  timeline rail's zoom; see "The blog feed"). All stop or become static with reduced motion
  (`motion-reduce:`).
- `animate-reveal` (a fade in with an 8 px rise, `duration-base`) is for cards
  appearing in a feed and for a sheet dialog entering; pair it with
  `motion-reduce:animate-none`.
- Three shadow levels, `shadow-pill`, `shadow-card`, `shadow-sheet`, stay
  neutral. The blog feed tile keeps its original shadows (`shadow-tile`,
  `shadow-caption` and their logo-glow `-hover` forms). L1 glows are coloured through the accent `glow` role
  (`shadow-accent-glow`, `shadow-accent-glow-hover`, `shadow-accent-unread`).
- `bezierEasing` in `design/tokens/motion.ts` evaluates the standard curve in JS.

## Reference (kept from v1)

### Scales

| Scale | Utilities |
|---|---|
| Spacing | Tailwind default scale (`p-4` = 16px), multiples of 4px only |
| Group-only roles | `bg-group-canvas`, `bg-group-title`, `bg-group-title-bar`, `text-group-title`, `border-group-bubble`, `decoration-group`, `ring-group-logo`, `animate-landing` |

### Which primitive when

| Need | Use |
|---|---|
| Group background behind everything | `Canvas` |
| Main content area or dialog body | `Sheet` / `Modal` |
| A boxed item on a sheet | `Card` |
| Tab or filter | `Pill` (`selected`: `bg-accent-subtle`, `text-accent-strong`, `ring-accent-border`; `tone="oshi"` for a 推 filter). The blog feed's All / Favorite is its own segmented control (see "The blog feed") |
| Unread count | `Badge count={n}` (hidden at 0, `99+` cap, unread glow) |
| Person or member | `Avatar` (`selected`: accent ring with a white gap + halo; a muted look or hover zoom goes on the image via `imgClassName` / `imgStyle`, never on a wrapper, so the ring stays sharp and in place; an archived avatar drawn small gets `resizedAvatarUrl(url, useAvatarWidth(<drawn CSS px>))`, a resized copy matched to the screen density, never the ~1000 px original) |
| Timeline date | `DatePill` (`sticky` inside scrolling timelines) |
| Action | `Button` (variants in section 9) |
| Icon-only action | `IconButton` |
| Feature-rail entry | `RailItem` |
| Dialog, sheet or dark viewer | `Modal` (`tone="viewer"` for photos and videos). A sent letter opens in `LetterViewerModal`, a wide sheet (not the dark viewer, because the letter's full text is read beside the image): the image on a `bg-sunken` stage, the text in message type, and the photo viewer's footer (a neutral date link that jumps to the letter in the chat, the `n / total` counter, older / newer buttons and ← / →, always in time order (› / → newer, from the chat and from the newest-first Sent letters list alike), and with golden finger a ghost Download). Clicking the image opens it in the dark viewer on top for zoom and golden-finger copy / download; Escape returns to the letter |
| Menu or dropdown of actions | `Menu` + `MenuItem` (`radio` for one-of options) |
| On/off setting | `Switch` |
| Text field / choice | `Input` / `Select` |
| Loading, empty, error inside a dialog | `DialogStatus` |
| Empty list or screen | `EmptyState` |
| Image still loading | Neutral skeleton `bg-sunken animate-pulse motion-reduce:animate-none` (`SafeImage` `skeletonClassName`); keep the `<img>` laid out at `opacity-0`, never `hidden`, so `loading="lazy"` can fire |
| Video or voice buffering / failed | `useMediaPlayback` (`core/media/useMediaPlayback.ts`). Buffering (waiting for data while playing): a `Loader2` spinner with `animate-spin motion-reduce:animate-none`, centred over the video in `text-viewer` (`role="status"`, `common.loading`), or in place of the voice player's play icon (`aria-busy`). Failed: a neutral message (`videoPlayer.playbackError` / `voicePlayer.playbackError`, never danger red) with a Retry (`common.retry`) that reloads the element at the same position and plays: on the video a `bg-viewer-scrim` panel with an `overlay` Button, on the voice player a `text-secondary` caption with a `ghost` Button. Every `<video>` / `<audio>` element gets its source through `useMediaSource` (`core/media/mediaElement.ts`), which releases it (pause, drop `src`, `load()`) before the source changes and on unmount; viewers key the player by source. The one detached preload `Audio()` in `preloadAudio.ts` has no element to hook, so it is released manually |
| Low-density screen background | `Atmosphere` |
| One-time celebration | `CelebrationToast` / `MilestoneCard` |

Screen-specific components (message bubble, member grid cell, chat header)
are composed from these in the feature folder. They are not primitives.

### Dialogs

Every dialog renders through `Modal` (`design/primitives/Modal.tsx`) on the dialog layer
(`design/dialog/`). The frame is `role="dialog"` with `aria-modal`, and it is named by
`title` (the visible h2), `aria-label` or `labelledBy` (an element inside a bare dialog).

| Prop | Values |
|---|---|
| `tone` | `sheet` (default: a level-1 sheet, `bg-sheet rounded-xl shadow-sheet` on `bg-scrim`) or `viewer` (dark, full screen, on `bg-viewer-scrim`; photos and videos) |
| `layout` | `standard` (header with the title and a ghost close button, body, footer) or `bare` (children straight in the frame: search, the profile card, the entry flows) |
| `scope` | `inherit` (default: the scope in `ScopeContext`: brand from a `BrandScope` or a brand `Modal`, or a group scope a parent provides with `ScopeContext.Provider`, else the active group) or `brand` (applies `brandScopeStyle()` and provides the brand context to nested dialogs) |
| `header` | `expressive` (default: the context's gradient header and bar, L1; `ConfirmDialog` uses it too, with a semantic icon tile), `plain` (a quiet white header; the member timeline uses it) or `console` (a dark ink header, `bg-console` / `text-console`, no bar and no group or brand colour; Developer Diagnostics only) |
| `icon` | A decorative lucide icon before the title, in the header text colour; plain dialog icons are drawn at 20 px, while `ConfirmDialog` passes its own 32 px semantic tile (drawn as given). Only the standard layout with a title draws it (`Modal` ignores it, with no title or in the bare layout). Used by Calendar, Favorites (star), Sent letters and the letter viewer (mail), Background (palette), Media gallery and Blog photo gallery (image), Report issue (bug) and Diagnostics (terminal); `ConfirmDialog` passes its icon tile |
| `placement` | `center` (default) or `top` (15 vh from the top: search) |
| `dismissible` | `true` (default); `false` for flows that must not be skipped (ToS, setup, sync): no close button, and Escape and the backdrop do nothing |
| `closeLabel` | Required whenever the dialog has a close button: `t('common.close')`. Without it there is no close button |
| `logId` | Required on every dialog: its `DialogLogId`, which logs the `dialog` open / close breadcrumbs (data loads inside log `dialog_load`) |
| `footerDivider` | A `border-subtle` hairline and 16 px above the footer, for a long body that scrolls under it (Diagnostics) |
| `toolbar` | Standard layout only (the bare layout ignores it, with a development warning). A non-scrolling strip between the header and the body (the media gallery's tab bar): opaque `bg-sheet`, outside the scroller so the scrollbar starts below it; a body with sticky headers under it takes `pt-0` and the headers stick at `top-0` |
| `bodyRef` | Standard layout only. A ref to the scrolling body element, for callers that must move its scroll (the media gallery resets it to the top when the tab changes) |
| `titleClassName` | Extra classes for the title (the member timeline sets `text-accent-strong` on its plain header) |
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
- **Header title:** `text-title font-bold` in the header text colour (white on a title
  gradient, the official title colour on Sakurazaka's white header, dark on the brand
  aurora), as the pre-D2 dialog header.
- **Content:** a dialog has at most one `primary`, `warning` or `danger` Button, confirms are
  `ConfirmDialog` (expressive header of its opener's context, the warning / danger / info
  meaning in a semantic icon tile, a `secondary` Cancel where focus starts, then `primary`,
  `warning` or `danger`) and never `window.confirm`, and loading, empty and
  error states are `DialogStatus` (spinner `text-accent`; the error tile is
  `bg-semantic-danger-icon`, the empty tile `bg-expressive-soft`; `retryVariant` is
  `secondary` by default and `primary` for the gradient retry the blog dialogs use).
  `BlogStatus`'s retry is always `primary`.

### Developer surfaces

The hidden Developer Diagnostics panel uses no brand or group colour in its chrome, on purpose, so it
is unmistakable next to user screens (it still sits in brand scope for any nested dialog): a dark ink `Modal` `header="console"`, a terminal icon in
`text-console-prompt`, a monospace uppercase "Hidden Panel" badge (`bg-console-badge`,
`text-console-badge`), a solid ink Copy JSON button (`Button variant="secondary"` with a
`bg-console text-console` override, kept dark on hover and when disabled) and the log block in
`bg-console text-console-muted font-mono` (errors `text-console-error`, warnings
`text-console-warning`). The `console` tokens (`color.console`, `--ds-console-*`) hold the
pre-D2 panel's values; use them for developer tooling only.

### Date-search calendar

`CalendarModal` follows the Japanese wall-calendar convention (owner decision, R-h):

- **Week** starts on Sunday. Sundays and Japanese public holidays (祝日, from the offline
  `@holiday-jp/holiday_jp` dataset through `utils/jpHolidays.ts` `holidayName()`) are
  `text-calendar-holiday` (`#DC2626`, 4.8:1 on white), Saturdays `text-calendar-saturday`
  (`#2563EB`, 5.2:1); the weekday header labels use the same colours, the other labels
  `text-muted`. These are fixed meanings ("semantic over context"): they never follow the group
  accent. Out-of-month days are uniformly `text-muted opacity-80` (3.3:1), without weekend colour.
- **Day tooltip:** a day's holiday name (in Japanese, `lang="ja"`) and its item count show in the
  dark app tooltip (`bg-toast text-viewer`, as the feature rail's) above the cell on hover and
  keyboard focus (below it in the first row, so it never covers the weekday header or gets
  clipped); edge columns align it to their edge. The holiday is part of the day's accessible
  name ("3, 文化の日") and the count is its accessible description.
- **Month title:** numeric in Chinese, Cantonese and Japanese (`2026年11月`), "November 2026" in
  English (`calendar.monthYear` with `calendar.months.*`; the picker's month grid uses the same
  month names).
- **Year / month picker:** the month title is a button (`aria-expanded`) that swaps the day grid
  for a year list (the first dated year, or the last ten years when there are no dates, up to
  this year; the selected year is scrolled into view) and a 12-month grid. Years and months with dates are `text-primary` (months with
  the accent dot), the others `text-muted` but still selectable; the selected year and the
  month on screen are the state (`bg-accent-subtle text-accent-strong`). Picking a month, the
  back button or Escape (claimed, so the dialog stays open) returns to the day grid, and
  focus goes back to the title. Opening the picker moves focus to the month on screen; opened
  while the dates are still loading, focus stays on the title and moves into the picker once it
  renders (unless the user has moved focus elsewhere). `calendar_picker` breadcrumbs: `phase` `open` (`count` years),
  `select` (`has_target`: the month has dates) and `back` (`reason` `escape` / `button`).
- **Free date picker:** in Dates mode, `selectAnyDay` makes every day selectable and
  `text-primary` (On This Day's 日付をえらぶ picks any month-day); dated days keep their count, and
  the year / month picker shows every year and month as available. `initialMonth` (any mode)
  sets the month shown on each open (On This Day opens on the month being viewed).

### Menus

`Menu` (`design/primitives/Menu.tsx`) is a level-2 popover (`bg-card rounded-card shadow-card`)
with `role="menu"` and an `aria-label`. Its parts:

- `MenuItem`: a `rounded-sm` row with an optional icon; `radio` + `selected` for one-of
  options (`menuitemradio`), `destructive` for a danger action. `disabledReason` keeps the
  item focusable (`aria-disabled`) at 40 % with the reason as tooltip and description; a
  click is swallowed and logged (`menu_item_blocked`). A plain `disabled` item also keeps
  its colour at 40 %.
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

### Cross-group markers

In lists that mix groups (search results and their member filter chips), a 6–8 px dot shows
each row's group in that group's logo colour. The colour is data:
`groupMarkerStyle(getServicePrimaryColor(service))` (`features/search/groupMarker.ts`) sets
`--ds-group-marker` on the dot and `bg-group-marker` draws it (default `transparent`). No other
element uses another group's colour.

### Member penlight colours (data-driven exception)

The blog reader's corner wash uses the current member's two penlight colours from member data
(`getMemberPenlightHex`), never a literal. `memberWashStyle()` (`features/blogs/memberWash.ts`)
sets `--ds-member-wash-1/2` on the wash element, and the `bg-member-wash` utility mixes them at
`--ds-member-wash-alpha` (`memberWash.alpha`, 10 %). Both default to `transparent` (no wash for
the mascot or an unknown member). `resolveWash` also reports why there is none
(`mascot`, `no_member_data`), logged as `blog_fallback` (`target`: `card_thumb` or
`wash`; `reason`: `image_error`, `mascot`, `no_member_data`). No other element uses
member colours.

### The blog feed (the original look)

The blog feed keeps its original design (commit `e4e4118`), restored with tokens after the
D2b replacements were rejected. Its values live in `design/tokens/blogFeed.ts`.

- **Feed tile** (`BlogCard`): the photo tile fills the whole 3:4 card (`rounded-md`, featured
  `rounded-lg`; `bg-accent-tile`, the logo 9 % → accent 7 % placeholder; `shadow-tile`; a
  `bg-tile-vignette` fade along the bottom). The caption is a small frosted card
  (`bg-tile-glass`, `border-tile-glass`, `backdrop-blur-lg backdrop-saturate-180`,
  `shadow-caption`) anchored at the bottom-right and deliberately offset past the photo edge
  (`-bottom-2 -right-2`, padding `px-2.5 py-2`, `rounded-sm`, 95–150 px wide; featured
  `-bottom-3 -right-3`, `px-3.5 py-3`, `rounded-md`, 130–200 px). It holds the date in small
  caps (`text-tile-date`, `uppercase tracking-wider text-muted`), the serif title
  (`text-tile-title`, `font-reading`, `lang="ja"`) and the member name (`text-tile-name`,
  `text-accent-strong`, `lang="ja"`); featured cards use the `-lg` sizes. On hover the card
  lifts 6 px (`duration-lift`, 500 ms), a blurred `bg-accent-aura` glows behind it, the tile
  shadow becomes `shadow-tile-hover` (logo-colour glow), the photo zooms to 105 %
  (`duration-zoom`, 700 ms) and the caption nudges 4 px up-left with `shadow-caption-hover`.
  The caption uses `transition-caption` (a `tailwind.config.js` utility, as e4e4118's inline
  transition): `transform` on `ease-spring` and `box-shadow` on `ease`, both `duration-glide`
  (400 ms), so only the nudge overshoots, never the glow. Reduced motion keeps the hover look
  (aura, glows) but nothing moves: no transitions, no lift, zoom or nudge
  (`motion-reduce:hover:translate-y-0` and the like). Focus shows a
  `ring-2 ring-inset ring-accent` over the photo.
  The caption's min / max widths (`min-w-[95px] max-w-[150px]`, featured
  `min-w-[130px] max-w-[200px]`) are arbitrary width values on purpose: fixed layout sizes the
  guard allows, copied from e4e4118, with no matching spacing step.
- **All / Favorite filter** (`RecentPostsFeed`): one segmented control, not two pills. A grey
  track (`role="group"`, `rounded-full bg-segment-track`, black at 5 %; `p-0.5` plus a
  transparent 1 px border for the original 3 px inset, `gap-0.5`) holds two `aria-pressed`
  segments (`rounded-full px-3.5 py-1.5 text-segment font-medium`, 12 px). The unselected one
  is `text-muted` on the track (`hover:text-secondary`); the selected one is a raised white pill
  (`bg-pill shadow-segment`) in the oshi colour (`text-semantic-oshi`; the Favorite heart
  `text-semantic-oshi-solid`), for All as well, as in the original: the control is the 推 filter.

- **Timeline rail** (`TimelineRail`): the current post is a `bg-accent-strong` dot with
  `shadow-accent-beacon` (the strong colour glowing at 38 % / 25 %). After an 800 ms dwell the
  fisheye zoom shows the original "light through a lens": the `border-subtle` track widens from
  2 to 3 px and a 20 px `bg-accent-lens` band (a radial glow of the strong colour at 8 %)
  fades in (`ease-out`, as e4e4118) over the magnified zone, centred by `--ds-rail-lens-y` (set
  on the element from the last zoom centre, kept in state). Unlike e4e4118, which removed it at
  once, it also fades out on leave. The 3 px zoomed track is `border-l-[3px]`, an arbitrary
  border width kept on purpose: Tailwind has no 3 px border step and the value is e4e4118's. The hover ring is `border-accent-strong` when
  zoomed (`border-strong` otherwise) and the tooltip glows with `shadow-accent-glow`. The zoom
  transitions run `duration-lens` (300 ms): track width, year markers and dot `ease-in-out`,
  the lens `ease-out`; none with reduced motion.

### Memories keepsake surfaces

The Memories screens (hub, memoir, On This Day, album, favorites) show the fan's keepsakes on
neutral materials. Their values live in `design/tokens/memories.ts` and are written as
`--ds-mem-*` variables; none of them follows the group accent.

| Utility | Variable | Use |
|---|---|---|
| `bg-memories-paper` / `border-memories-paper` | `--ds-mem-paper` / `--ds-mem-paper-line` | Letter and polaroid white (a warm paper, never pure white) and its hairline. |
| `bg-memories-cork` | `--ds-mem-cork` | The favourites cork board base. |
| `bg-memories-washi` | `--ds-mem-washi` | Translucent washi tape pinning a polaroid. |
| `bg-memories-foil` | `--ds-mem-foil` | The holographic sheen of a special card, built from the aurora stops (`aurora.stops`). |
| `shadow-memories-polaroid` | `--ds-mem-shadow-polaroid` | A polaroid lying on a surface. |
| `border-memories-silhouette` | `--ds-mem-silhouette` | The dashed outline of an unearned card (`border-dashed`), the neutral `border-strong` value. |
| `sepia-memories-1/2/3` | `--ds-mem-sepia-1/2/3` | A photo aged by its year (see below). |

- **Sepia by age.** `sepiaClass(year)` (`features/memories/shared/sepia.ts`) gives a keepsake
  from this year no filter, last year `sepia-memories-1`, two years ago `sepia-memories-2` and
  three or more years ago `sepia-memories-3` (full sepia). Years are counted in JST. The year
  recap's 去年の、同じ日 slide (S08) is not age-graded: its older card always uses
  `sepia-memories-3`, the approved full-sepia look. Apply it to the photo or card, never to text
  you need to read at full contrast. `sepiaClass` returns literal class names from a lookup, so
  Tailwind sees them; never build a `sepia-memories-${n}` name at runtime.
- **Foil only for special cards.** `bg-memories-foil` marks a binder card the catalogue flags as
  foil (`foil: true`) and nothing else: not hover states, not headings, not the hub.
- **Paper, cork and tape are materials, not colours.** Use them for the surfaces they name; text
  on them uses the ordinary text roles.
- **Album colour ribbon (data-driven exception).** Like the member penlight colours, the
  album's monthly ribbon colours are runtime data: the backend's `cover_color` and
  `/album/colors` values (`#rrggbb` probed from her photos). They are applied through `style`
  on the ribbon element, never written as literals in source, and no other element uses them.

### The group rail and the profile card

The group rail's selected logo has a selection ring: a 2 px white gap plus a 2 px ring in the
group logo colour (`ring-2 ring-offset-2 ring-group-logo`, from `--ds-group-logo`) and the group
glow. It is the only place the logo colour is used as a ring. The member profile card's banner is
the official layer, drawn like that group's chat header: `bg-group-title` (gradient groups) or
`bg-sheet` with the thin `bg-group-title-bar` under it (Sakurazaka's `light` header).

The rail's bottom actions (add service, search, settings, update) sit in a `BrandScope`:
`soft` ink circles; the update icon uses the semantic info / success / danger colours. The
selected logo's halo is `shadow-accent-halo` in the active group's context.

The feature rail is icon-only (a `w-12` column of 40 px `RailItem` tiles, 20 px icons). The
feature name is the button's `aria-label` and a neutral dark tooltip (`bg-toast text-viewer`,
never the group colour) to the right of the tile, shown on hover and keyboard focus after a short
delay. The selected `RailItem` is a white card with a `text-accent` icon and a `bg-accent` bar on
the left.

### Left is older, right is newer

Everywhere something steps through items in time (the photo / video / voice viewer, the media
gallery detail, the blog photo gallery, member image history, the sent-letter viewer, blog posts,
the calendar), ← / ‹ goes to the **older** item and → / › to the **newer** one, whichever way the
list is sorted on screen. A newest-first grid therefore steps with its index reversed, and a
visible counter counts the oldest item as 1. Buttons that step carry older / newer labels
(`letterViewer.older` / `letterViewer.newer`), not previous / next. `utils/timeOrder.ts`
(`timeNeighbours`) is the one helper; `MediaViewerModal` takes `order` (`oldest_first` by default,
`newest_first` for a newest-first list).

The rule is for time-ordered items only. Images inside one blog post are not a timeline: the blog
reader's photo viewer keeps the post's reading order (← / ‹ the image above, → / › the one below).

### Layering

`Z_INDEX` (`frontend/src/constants/zIndex.ts`) is the only source of layering for
overlays: `DROPDOWN` 50 (menus anchored in the frame), `DIALOG` 100 plus `DIALOG_STEP` 10 per
stacked dialog, `POPOVER` 1000 (portaled menus, above any dialog) and `TOAST` 1100 (above
everything, e.g. the settings error toast). No `z-[…]`, `z-40` or `z-50` classes; `z-10` /
`z-20` stay for stacking inside one frame (sticky headers, viewer chrome).

**The incoming call.** A call that starts with no dialog open is drawn inside the chat
frame (its `z-30` is local to the chat area). A call that starts while a dialog is open is
**lifted**: portaled over the chat area's rectangle at `interleavedZIndex(order)`
(`dialogStack.ts`), half a `DIALOG_STEP` above the dialogs that were open when it rang, so a
dialog opened during the call still goes above it. It is not on the dialog layer: the layer
leaves Escape and Tab pressed inside it to the call (`useDialog`), and focus there is allowed.
Because the layer does not track the call, a lifted call that goes away with focus inside it
hands focus back to the top-most dialog itself (breadcrumb `call_layer`, `phase` `focus`).

### Adding or changing a token

1. Edit the right file in `frontend/src/design/tokens/`.
2. Expose it in `frontend/src/design/cssVars.ts`, and in `tailwind.config.js`
   if it needs a utility. **Register every new token utility in
   `frontend/src/utils/classnames.ts`** (`extendTailwindMerge`), or `cn()` will
   treat it as a conflicting built-in class and drop one of them. All the v2
   utilities (`accent`, `expressive`, `semantic`, `shimmer`, `toast-in`, ...)
   are registered there.
3. Show it on `DesignPage.tsx`.
4. Document it here.
5. Changing a pre-D1 value changes pixels on existing screens. Update
   `design/__fixtures__/legacy-theme-values.json` only when that change is
   intended, and say so in the PR.

### The guard (ratchet)

`frontend/src/design/guard.test.ts` counts hard-coded style values per file:
hex colours, `rgb()`/`hsl()`, arbitrary radius / shadow / text / spacing
values, and the D1 group role utilities superseded by `*-accent-*`
(`bg-group-accent`, `bg-group-badge`, `bg-group-subtle`, `text-group-strong`,
`border-group-subtle`, `ring-group`, `accent-group`, `shadow-group-glow`; the
official layer is not counted) and Tailwind's `rounded-2xl` / `rounded-3xl`. Width, height and position arbitrary values are
allowed. Comments are ignored, but string contents are still scanned (hex
colours live in strings). Named palette classes (e.g. `bg-gray-100`,
`bg-black/40`) are not caught by the guard but are still forbidden by the
rules here. Token files (`design/tokens/`), `config/colors/`,
`config/serviceThemes.ts`, tests and `.d.ts` files are not scanned. The test
compares the counts with `guard-baseline.json`:

- A new file must have 0.
- An existing file may not go up.
- When a file goes down, the test fails until you lower its number (or
  remove the entry at 0).
- No file under `design/` may appear in the baseline.

To rewrite the baseline after converting screens, from `frontend/`:

    UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts

Review the diff: numbers should only go down.

The v2 foundation added the superseded group-role utilities to the ratchet, so
the baseline lists the files that still use them; counts only go down from
here.

#### The dialog style ratchet

`frontend/src/core/dialogs.style.test.ts` checks what the guard does not, for every file D2c
moved onto the system (its `FILES` list; add a file when you restyle it). Each file must have:

- no named palette classes (`bg-gray-100`, `text-white`, `bg-black/50`, …);
- no colour through inline styles (`color:`, `background:`, `boxShadow:` …), except the files
  whose colour is data (`DATA_COLOUR`: the background presets, the search chips' group dot);
- no legacy theme reads (`getServiceTheme`, `useBlogTheme`, `serviceThemes`, …);
- no `window.confirm` / `alert(`, no `z-[…]` / `z-40` / `z-50` classes and no old modal
  shells (`BaseModal`, `DetailModal`, `useModalClose`, the old modal state components).

### Dark mode

Not built yet. Token names are roles so a dark value set can be added
later without renaming anything.

## 12. Accepted deviations

Do not "fix" these.

- **Primary button gradient contrast.** It stays the original `logo → 600`.
  White text at the gradient's middle is about Hinatazaka 2.4:1, Sakurazaka
  3.1, brand 3.1, Yodel 3.3 and Nogizaka 6.6. The user compared four options
  and chose the original: "I don't see any place where it is actually hard to
  read."
- **Hinatazaka 600 `#389DD1`** (white 3.0:1) stays the badge and action colour.
- Sakurazaka keeps its white `light` header (official layer).
- **Chat header pills** keep the pre-D2 white glass / title-text tint: on light
  parts of the title gradient and on Sakurazaka's white header their caption text
  is below 4.5:1, like the official title beside them.
- **Dialog header titles** keep the header text colour: white on the title
  gradients (about 1.8:1 at Hinatazaka's light end) and the official `#d892aa` on
  Sakurazaka's white header (2.4:1), as the pre-D2 dialogs and the chat header
  beside them (user decision D1, R-c).
- **Sync progress fill** is the aurora (brand) or the official title gradient (inline sync) on a grey track, about 1.0–1.2:1, as the pre-D2 pastel bar; the count and percent above it carry the value (user decision D5, R-d).

## 13. Do / Don't

| Do | Don't |
|---|---|
| Separate blocks with spacing and levels | Draw straight divider lines (`border-b` between list items, `<hr>`) |
| Give a fixed-meaning element its meaning colour in every context (推 hearts `text-semantic-oshi`, the favourite star `text-semantic-star`) | Recolour it with the group accent, or use oshi pink for a heart that is not 推 (About's `text-heart`) or for anything just because it is pink |
| Keep secondary and tertiary actions neutral (`ghost`, `secondary`); spend the group colour on identity, current state and the one primary action | Tint a utility, disclosure or Cancel-style control with `text-accent-strong` or an accent wash |
| Use token classes (`rounded-lg`, `text-body`, `bg-sheet`) | Hard-code `#hex`, `rgb()`, or arbitrary `rounded-[..]`, `shadow-[..]`, `text-[..]`, `p-[..]` |
| Dim overlays with `bg-scrim` | Dim overlays with `bg-black/NN` or `bg-white/NN` |
| Ask for a role (`bg-accent`, `text-accent-strong`, `bg-expressive-soft`) so the component follows its context | Hard-code a colour, or use group colour in brand screens |
| Pick an expression tier (L0, L1, L2) for a place that needs life | Use neutral grey where the original design had colour: pick the tier instead |
| Keep a disabled control's colour and give it a reason (`disabledReason`) | Grey out disabled controls, or disable a form's submit button |
| Translate every visible string (`t('…')`) | Put text in primitives; callers pass translated labels |
| Use role names for new tokens (`surface.x`) | Name tokens after hues (`lightBlue`): dark mode will reuse the names |
| Open dialogs with `Modal` and confirm with `ConfirmDialog` | Build a fixed overlay by hand, or call `window.confirm` / `alert` |
| Layer with `Z_INDEX` | Use `z-[…]`, `z-40` or `z-50` classes |
| Use `groupScopeStyle(groupId)` for a marker that names one group | Put a primitive's group id in its props |

## 14. Migration note

The screen re-apply (R-a frame and chat, R-b blogs, R-c dialogs, R-d entry screens and brand moments) is done. No screen applies the `default` group's roles any more; it remains only as the document-level fallback before a group is chosen (its accent roles equal the brand).

The `*-group-accent`, `*-group-strong`, `*-group-subtle` and `*-group-badge`
utilities (`bg-group-accent`, `bg-group-badge`, `bg-group-subtle`,
`text-group-strong`, `border-group-subtle`, `ring-group`, `accent-group`,
`shadow-group-glow`) still work and still read the group variables. No re-applied screen uses them; `guard-baseline.json` lists the files that still carry ratcheted literals (pre-token media parts and data files).

The guard ratchets the old utilities: a file may not use more of them than its
baseline entry. New code uses `*-accent-*` and `*-expressive-*`.
