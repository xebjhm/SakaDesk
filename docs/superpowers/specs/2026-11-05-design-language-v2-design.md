# Design language v2: design spec

- Date: 2026-11-05
- Status: approved in brainstorming (session "設計語言 v2"); this spec records every decision.
- Replaces: the colour and expression rules of D1 (`2026-11-04-d1-design-system-design.md`) and the
  "group colour in four places only" rule. D1.5's group scales and official layer stay, with the
  Yodel change below.
- Mockups (Windows): `C:\D\saka-verify\mockups\v2\` (`q2` brand colour, `q4`/`q4b` neutrals,
  `q5`/`q5b` semantic colours and roles, `q7` expression tiers, `q7b` button gradient, `q8` display
  font, `q9` states, `q10` celebrations).

## 1. Why v2

D2a–D2d (PRs #13–#16) were merged but failed acceptance. Many colours the user designed were replaced
by neutral grey or white, and the app lost its style. The cause: D1's design language had component
specs only. It had no brand layer, no context rules and no expression layer, so D2 fell back to
neutral grey whenever a case was not covered.

v2 adds the missing layers. Ground rules (settled before this session):

1. Colour richness baseline = the look just before D2 (`e4e4118`). D2's structure is kept: canvas +
   one sheet, unified primitives, dialog behaviour, virtual scroll and jumps, login and sync fixes.
2. Radius = 6 steps (section 7).
3. SakaDesk has its own brand language, used in neutral, cross-group places; group contexts use the
   group's language.
4. Any change to the user's original design is raised and discussed first. Accepted deviations are
   listed in section 12 so nobody "fixes" them later.

## 2. Brand personality

**A skeleton + C surface.**

- **A 典藏館 (archive):** calm, refined, trustworthy. Governs working screens: stable layout, clear
  type hierarchy, few but well-made decorations.
- **C 清新空氣感 (airy):** light, soft glow, frosted glass, pastel gradients. Governs expressive
  moments.
- Rejected: B 應援感 (loud, saturated). The frame must not fight the four group colours.

## 3. Colour

### 3.1 Brand colour

The brand never takes a group's place; it hosts them.

| Role | Value | Notes |
|---|---|---|
| Ink scale (OKLCH h 262, C ≤ 0.06) | 50 `#f4f7fc` · 100 `#e9eef7` · 200 `#d5deee` · 300 `#bac8e0` · 400 `#9dafce` · 500 `#8296b9` · 600 `#63769a` · 700 `#4d5e7d` · 800 `#3a4860` · 900 `#293345` | 600 carries white text at 4.6:1 |
| Brand accent (action) | ink 600 `#63769a` | |
| Brand accent-strong | ink 700 `#4d5e7d` | links, selected text |
| Brand accent-subtle / border | ink 50 / ink 200 | |
| **Aurora** (expressive) | `linear-gradient(120deg, #cfe6ff 0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)` | sky → lavender → pink → peach |
| Aurora orbs | `#bfdcff`, `#ffd0e4`, `#e2d6ff` | the L2 orbs in brand context |
| Text on aurora | neutral 800/900 (dark) | never white |

The aurora mixes the groups' hues on purpose. The user's reason: "the app exists to serve the
Sakamichi groups". The solid ink sits next to group logos on the rail and never competes with them.

### 3.2 Group colours

Unchanged from D1.5 (10-step OKLCH scales, official layer kept verbatim, role mapping), except Yodel:

**Yodel is re-based on its logo periwinkle `#6060E0`.** The old green (`#5a8a6a`) was the colour of
one OG (松田好花). The official Yodel app switches colours per OG page.

- Scale (h 278, logo snapped into 600): 50 `#f3f6ff` · 100 `#e7ecff` · 200 `#d2daff` · 300 `#b5c0ff` ·
  400 `#98a2ff` · 500 `#7e85ff` · **600 `#6060e0`** · 700 `#4c4bbb` · 800 `#393992` · 900 `#28286b`.
  White on 600 = 4.9:1.
- Yodel has no official layer data for periwinkle, so its "official" fields become system-derived and
  are labelled that way in `groups.ts`:
  - title gradient 200 → 400 → 600, bar 200 → 600, title text 700, header style `gradient`;
  - canvas `['#e7ecff', '#f3f6ff', '#f8f9ff']` (100 → 50 → near white);
  - shelters: picture 300, video 400, voice 500, text 600, style `classic`;
  - bubble border and glow = logo `#6060e0` (glow alpha 0.3).
- **Reserved: per-OG layer.** A room-level override through `groupScopeStyle`, falling back to Yodel
  periwinkle. Not built in v2. TODO: read a raw Yodel API response (Windows side, reuse the existing
  login, never log in on WSL) to check for an OG theme colour. If there is none, use an official
  table that the user samples from the app.

### 3.3 Neutrals ("ink neutral")

Keep the current values (`color.surface`, `color.text`, `color.border`). The Tailwind grays they come
from already sit at hue 257–264 with chroma ≤ 0.03, the same hue as the brand ink. v2 only renames and
documents them as **ink neutral**.

Rule: **large surfaces (sheet, card, bubble, chat background, dialog body) stay pure white or
near-white with no tint. Tint lives only in text, borders and inputs.** A tinted, darker surface set
was tried and rejected as too blue and dark.

### 3.4 Semantic colours

Semantic colours are global. They never follow context: danger is always the same red, in brand and in
group screens. They are "harmonized" (chroma about 35 % lower than signal colours) so they sit with
the aurora.

| | 50 (bg) | 100 (icon bg) | 200 (border) | 600 (solid) | 700 (text) | white on 600 |
|---|---|---|---|---|---|---|
| success (h 160) | `#f0fbf4` | `#e3f6ea` | `#cae8d7` | `#2e805a` | `#216a49` | 4.9 |
| warning (h 62) | `#fff5ed` | `#feedde` | `#f6dac3` | `#9b5e1e` | `#824c13` | 5.3 |
| danger (h 24) | `#fff3f1` | `#ffe7e4` | `#ffd1cd` | `#b44543` | `#963635` | 5.3 |
| info | ink 50 | ink 100 | ink 200 | ink 600 | ink 700 | 4.6 |

- Danger's hue stays brick red; it is deliberately not pulled toward the brand, which would read as
  Sakurazaka pink.
- Icons: a 100 background with a 200 outline and a 700 glyph. Solid 600 is only for destructive
  buttons.
- Info uses the brand ink. There is no separate blue, because it would be confused with Hinatazaka.
- **Semantic over context.** An element with a fixed meaning keeps its meaning colour in every context. 推 (oshi) hearts and the Favorite filter use the global oshi pink `color.semantic.oshi` (50 `#fff0f8`, 200 `#ffcbe1`, solid `#de5f99`, text `#aa376f`; text 6.0:1 on white). The chat favourite star uses the original yellow `color.semantic.star` `#facc15`. Not oshi: About's "made with love" heart (`decor.heart`) and anything merely pink.
- Clean-up: the duplicate `color.feedback` (`#10B981/#F59E0B/#EF4444`) and `color.status` sets merge
  into this one `semantic` set. `status.attention` (rail disconnected badge) maps to warning 600.

### 3.5 Colour roles: the context mechanism

Components ask for a **role**, never a hue. The context decides what the role resolves to (Material 3
colour roles):

| Role | Brand context | Group context | Used for |
|---|---|---|---|
| `accent` | ink 600 | group 600 | primary fill, switches, selection ring, focus ring |
| `accent-strong` | ink 700 | group 700 | links, selected text |
| `accent-subtle` | ink 50 | group 50 | selected background, hover |
| `accent-border` | ink 200 | group 200 | selected border |
| `accent-logo` | ink 400 | group logo | the light end of the button gradient, badge glows |
| `glow` | ink 500 @ 0.35 | group glow | L1 glows |
| `expressive` | aurora + aurora orbs | title gradient + group orbs | headers, heroes, L2 |
| neutral | ink neutral (same in both) | | text, borders, surfaces |
| semantic | fixed (section 3.4) | | status, destructive |

- The CSS variables become `--ds-accent-*` (context-neutral names). The current `--ds-group-*`
  variables stay for the official layer (title, canvas, shelters), which only exists in group context.
- `brandScopeStyle()` (new, next to `groupScopeStyle()`) sets the accent variables to brand values on
  a surface. App-level dialogs and brand screens apply it to themselves.
- The `default` group (used today before a group is chosen) is retired. ToS and landing use brand
  scope.
- Result: "settings wrongly takes the group colour" cannot happen any more. A brand dialog sets brand
  scope on itself no matter which group is active.

## 4. Context rules

Principle: **whose content is it?**

- Content of one group → **group context**.
- The app, the user's account, or anything that spans groups → **brand context**.
- A dialog inherits its opener's context. App-level dialogs are always brand.
- **Viewer mode** (dark, full screen) belongs to no context; only the content shows.
- **Group markers:** inside a brand screen, a piece that names one specific group (a group card, a
  per-group settings row, a search result's source) uses `groupScopeStyle(groupId)`.

| Context | Screens |
|---|---|
| Brand | boot screen; ToS; setup wizard; landing; add service (group cards = markers); settings (per-group rows = markers); search, always, even when opened from a chat (each result carries a group marker); about; diagnostics; report issue; update prompt; sync progress and first sync (rows = markers); the group rail frame (search and settings icons use ink; logos keep their colours) |
| Group | feature rail; member list; chat and letters; member profile card; member and message context menus; dialogs opened from a chat (calendar jump, favourites, media gallery, background, sent letters); blogs (feed, reader, member select, timeline); login dialog (that group); incoming call screen and call popup (the member's group; future Yodel OG layer); confirm dialog (inherits) |
| Viewer | media viewer, photo detail, blog photo gallery, avatar viewer (D2 decision: stay dark; only controls restyled) |

## 5. Expression layer: three tiers

Expression is about intensity, not on or off.

| Tier | What | Where |
|---|---|---|
| **L0 Quiet** | accent roles only: subtle selected background, selection bar, link colour | dense reading and work surfaces: lists, settings rows, message text, blog body |
| **L1 Interactive** | primary button gradient; hover glow; selection glow; badge and unread glow; gradient dialog headers (the chat title gradient; aurora in brand context); modal accents (subtle background, border, selected states) | everything interactive, in both contexts |
| **L2 Atmosphere** | slow drifting orbs + frosted glass | low-density screens only: blog feed, landing, empty states, about, incoming call, first launch |

**All pre-D2 expressive elements return** as formal tokens. Sources at `e4e4118`:

| Element | Pre-D2 source | v2 token / rule |
|---|---|---|
| Button gradient `linear-gradient(135deg, logo, 600)` | `roles.ts` `buttonGradient`; `RecentPostsFeed`, `MemberTimelineModal` | `bg-accent-gradient` (primary button) |
| Hover glow `0 4px 20px glow` | `RecentPostsFeed` | `shadow-accent-glow` on hover of interactive cards |
| Dialog gradient header (+ bar for light-header groups) | `core/common/BaseModal.tsx` | `Modal` header: group → title gradient / Sakura light header + bar; brand → aurora + dark text |
| Modal accents (`accentColor/Light/Muted`) | Calendar, Favorites, MediaGallery, Background, SentLetters, InlineSyncView, PopupCall, MemberList, menus | `accent`, `accent-subtle`, `accent-border` |
| Unread shadow `0 0 12px logo@0.4` | `useMessagesTheme` | `shadow-accent-unread` |
| Ambient orbs | `DynamicBackground`, `CallOverlay` | L2, group or brand orbs |
| Landing per-group cards, ToS gradient button | `LandingPage` | group markers + brand primary button |

### 5.1 Buttons

| Variant | Look | Rule |
|---|---|---|
| `primary` | `linear-gradient(135deg, accent-logo, accent)`, white bold text, `glow` shadow | at most one per screen and one per dialog (D1 rule kept) |
| `tonal` (secondary emphasis) | `linear-gradient(135deg, accent-border, accent-logo mixed 35 % with white)`, text group/ink 800 | e.g. "mark all read"; warmer than the outline button, never competes with primary |
| `secondary` | white, neutral 300 border, neutral 800 text | cancel and so on |
| `ghost` | text only, accent-strong | inline actions |
| `danger` | danger 600 solid, white text | takes the place of the primary |

## 6. Typography

- Body/UI: **Noto Sans**. Brand-moment headings (landing hero, empty-state titles, about, celebration
  numbers, future Memories pages): **Noto Serif**. It is already loaded for blog titles, so brand and
  blog share one voice.
- **Language-aware glyphs for every UI language:**

  | UI language | Sans | Serif |
  |---|---|---|
  | ja | Noto Sans JP | Noto Serif JP |
  | zh-TW | Noto Sans TC | Noto Serif TC |
  | yue | Noto Sans HK | Noto Serif HK |
  | zh-CN | Noto Sans SC | Noto Serif SC |
  | en | Noto Sans | Noto Serif |

  Japanese content (messages, blogs, member names) is marked `lang="ja"` and always uses JP glyphs,
  whatever the UI language. Only the active language's family is loaded (Google Fonts `unicode-range`
  slicing).
- New size step **display**: 32 px / 40 px leading (28 px allowed in compact places). The five D1 steps
  and `reading` stay.
- `font-variant-numeric: tabular-nums` for stats, times and counters.

## 7. Radius (6 steps, settled)

| Token | px | Use |
|---|---|---|
| `xs` | 4 | bubble tail corner, small inner chips |
| `sm` | 8 | menu items, list items, tabs inside a container |
| `md` | 12 | **buttons**, inputs, small cards, toasts |
| `lg` | 16 | cards, bubbles, popovers, member cards |
| `xl` | 24 | sheet, dialogs, heroes |
| `full` | 9999 | tag-like items only: date pill, filter chips, badges, avatars, switches |

- Mapping from D1: `card` 14 → `lg` 16, `sheet` 20 → `xl` 24, `tail` 4 → `xs`. `pill` on buttons goes
  back to `md` (the original `rounded-xl`).
- Nested boxes use concentric radii: inner radius = outer radius − padding, floored at `xs`.

## 8. States

| State | Rule |
|---|---|
| default | as specified per variant |
| hover | brightness +6 %, lift 1 px, glow grows (L1) |
| pressed | scale 0.97, brightness −6 %, glow shrinks |
| focus-visible | 2 px white gap + 2 px `accent` ring (keeps existing focus behaviour) |
| loading | spinner inside the control; the width does not change; not clickable |
| selected | `accent-subtle` background + `accent-border` inset + `accent-strong` text |
| **disabled** | **keeps its colour** at about 42 % opacity, no glow or shadow, `cursor: not-allowed`, **and always shows a reason** (hint text or tooltip) |

- Greying out (grey background, grey text) is **banned**: it looks broken.
- Forms (login, add service) never disable the submit button. They validate on click and show what
  is missing (Polaris / NN/g guidance).

## 9. Brand moments and celebrations

**Division of work:** while the user is **doing** something (reading, finding, configuring), use
L0/L1. When the user is **waiting, starting, finishing or looking back**, L2 and celebrations are
allowed.

| Moment | Design |
|---|---|
| First launch (boot → ToS → choose groups → first sync) | aurora + orbs (L2), serif headings. ToS header text becomes dark (fixes the original white-on-pastel 1.5:1). The original amber disclaimer returns in the new warning colours. The original per-group ToS link colours return as group markers. The group cards use group markers |
| Empty states | fixed pattern: aurora circle (group-tinted 50 → 100 in group context) + line icon + serif title + one sentence + one action |
| About | aurora hero + serif wordmark + "your archive" stats (messages, photos, days), tabular numerals |

**Celebrations**: tiers B and C only. No full-screen tier.

| Event | Context | Tier | Form |
|---|---|---|---|
| First complete sync | brand | B | bottom-right glass toast + one aurora shimmer + about 10 sparkles; once ever |
| A member reaches 1,000 / 5,000 / 10,000 messages | group | C | the next time that chat opens, a card in the timeline (serif number, group subtle gradient, glow) + ≤ 1.2 s group-coloured confetti |
| Subscription day 100, then every full year | group | C | same as above (the chat title already shows the day count) |
| Member birthday | group | C | later, together with Memories #15 |

Rules: each event is celebrated once; a celebration never blocks input and never needs dismissing;
with `prefers-reduced-motion` only the static card shows.

## 10. Motion and elevation

- Durations stay 150–200 ms. Exceptions: `glide` 400, `landing` 1400, orb drift 22–34 s (existing),
  plus celebrations: toast enter 350 ms, shimmer 1.2 s, confetti ≤ 1.2 s. All stop or become static
  with reduced motion.
- The four shadow levels stay. L1 glows are coloured (`glow` role); level shadows stay neutral.

## 11. Implementation outline (for the plan; not part of this spec's scope)

Two separate plans:

1. **v2 foundation:** tokens (brand ink, aurora, Yodel re-base, semantic merge, accent roles +
   `brandScopeStyle`, radius 6 steps, display size, language-aware fonts), primitives (Button variants,
   Modal header, EmptyState, Celebration toast/card), `?view=design` with a brand/group context
   switcher and contrast labels, and **`docs/design/DESIGN_SYSTEM.md` rewritten to v2 in the same PR**
   (zero-drift rule: the doc must match the code, so it is not rewritten before the code exists).
   The CLAUDE.md rule and the guard ratchet test are updated.
2. **Screen re-apply:** apply v2 to every D2 screen using the context table (section 4) and the restore
   inventory (section 5). Check before/after against `e4e4118`.

## 12. Accepted deviations (do not "fix")

- **Primary button gradient contrast.** It stays the original `logo → 600`. White text at the
  gradient's middle is about Hinatazaka 2.4:1, Sakurazaka 3.1, brand 3.1, Yodel 3.3 and Nogizaka 6.6.
  The user compared four options (`q7b`) and chose the original: "I don't see any place where it is
  actually hard to read."
- **Hinatazaka 600 `#389DD1`** (white 3.0:1) stays the badge and action colour (D1.5 decision).
- Sakurazaka keeps its white `light` header (official layer).
- **Chat header pills** keep the pre-D2 white glass / title-text tint: on light parts of the title gradient and on Sakurazaka's white header their caption text is below 4.5:1 (about 2.4–3.4:1), like the official title beside them (user decision D8, 2026-11-05).
- **Dialog header titles** keep the header text colour: white on the title gradients (about 1.8:1 at Hinatazaka's light end) and the official `#d892aa` on Sakurazaka's white header (2.4:1), as the pre-D2 dialogs and the chat header beside them (user decision D1, R-c).
- **Sync progress fill** is the aurora (brand) or the official title gradient (inline sync) on a grey track, about 1.0–1.2:1, as the pre-D2 pastel bar; the count and percent above it carry the value (user decision D5, R-d).

## 13. Out of scope / TODO

- Yodel per-OG colour layer (section 3.2): reserved; needs the API check.
- Dark mode: still reserved (semantic token names only), not built.
- App icon / wordmark redesign: not part of v2.
- D2+ UX features (right-click menu additions, member search/pin/mark-all-read, News, shortcuts) and
  Memories (D3) will use v2 but are separate projects.
