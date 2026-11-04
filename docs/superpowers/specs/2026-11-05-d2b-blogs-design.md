# D2b — Blog screens (recent feed, reader, timeline rail)

Date: 2026-11-05
Status: designed by the agent in autonomous mode within the user's settled D2b rules, then amended by the controller (keep the ambient orbs, the penlight wash and the serif; fix three bugs found while reading). The user reviews D2a–D2d together on one Windows build at the end. Every call is marked in the Decisions table.
Branch: `feat/d2b-blogs` → `dev`, cut from `dev` after D2a merged (PR #13)

## Context

D2 applies the D-4 layout ("one sheet on a coloured base") to every screen. It is split up (see the D2a spec, `2026-11-04-d2a-chat-frame-design.md`):

| Part | Scope |
|---|---|
| D2a (merged) | App frame, member sidebar, chat, letters in chat, sticky date pills |
| **D2b** (this spec) | Blog screens: recent feed, reader, timeline rail |
| D2c | Every dialog and viewer, including the three blog dialogs |
| D2d | Entry screens |

Since D2a the blog feature already sits on the content sheet (`ContentArea` wraps `BlogsFeature` in a `ContentSheet`), but everything inside the sheet still uses the pre-D1 look: an inline stylesheet per file, glass panels, ambient group-colour orbs, hex-alpha group colours, a serif web font from Google Fonts and fixed en-US / ja-JP dates. D2b rebuilds the inside of the sheet on the design-system tokens and primitives (`docs/design/DESIGN_SYSTEM.md`) without changing what the screens do.

### What each blog file hard-codes today

Guard counts are from `frontend/src/design/guard-baseline.json` at the start of D2b. Named palette classes (`text-gray-500`, `bg-white`) are not counted by the guard but are still forbidden.

| File | Guard | Hard-coded or legacy today |
|---|---|---|
| `features/blogs/BlogsFeature.tsx` | 0 | `bg-white` root, `text-gray-500`; `console.error` / `console.debug` and silent `catch` blocks instead of breadcrumbs |
| `components/RecentPostsFeed.tsx` | 10 | a 340-line inline `<style>`: glass header (`rgba(255,255,255,0.72)` + blur), serif title loaded by a Google Fonts `@import`, pink `#ff69b4` for the active toggle, `rgba` toggle and shadow values, red error colours (`rgba(239,68,68,…)`, `#f87171`), `#c4c4c4` icon; group colour through `theme.primaryColor` + hex alpha (button gradient, conic spinner, icon tile); `DynamicBackground` ambient orbs (group scale); `rem` font sizes; 0.3–0.45 s transitions |
| `components/BlogCard.tsx` | 9 | a glow aura in the logo colour + alpha (blur 24 px), arbitrary shadows with the logo colour, `rgba(0,0,0,…)` vignette, a glass label (`rgba(255,255,255,0.92)` + blur) hanging over the card corner, 8 / 12 px radii, `#a0a0a0` and `#1f2937` text, `rem` sizes, serif font, an inset focus ring in the logo colour, 500–700 ms transitions, en-US upper-case date |
| `components/BlogReader.tsx` | 6 | a two-colour radial wash in the member's penlight colours (`#ffffff` fallbacks), `border-b border-gray-200/60 bg-white/70 backdrop-blur` breadcrumb bar, `text-gray-*`, `text-red-600`, a hard-coded English "Retry", spinner and retry button in the penlight colour, serif title, `max-w-3xl … pr-16`, an inline `<style>` for links (theme colours) and search marks (`rgb(254 240 138)`, `rgb(219 234 254)`, `rgb(96 165 250)`), `prose prose-sm` (a no-op: the typography plugin is not installed), a ja-JP date in every language, `TranslateButton accentColor="#6b7280"` |
| `components/TimelineRail.tsx` | 8 | `#e5e7eb` track, `#9ca3af` / `#d1d5db` labels and ticks, the current dot in the legacy `timelineIndicator` colour with a hex-alpha glow, a group-tinted zoom "lens" gradient, a `bg-white rounded-xl` tooltip with three arbitrary shadows (logo colour alpha), `text-gray-*`, serif title, en-US month, 300 ms `cubic-bezier(0.4, 0, 0.2, 1)` transitions |
| `components/BlogNavFooter.tsx` | 2 | a white `rgba` gradient bar + blur, `rounded-lg`, `hover:bg-gray-100/80`, `text-gray-*`, en-US date |
| `hooks/useInlineBlogTranslations.ts` | 2 | the injected translation line sets `style.cssText` with `#555`, `#d1d5db`, 14 px / 1.65 |
| `hooks/useBlogTheme.ts` | – | the legacy `ServiceTheme` view that all of the above read; the D2c dialogs still read it |
| `core/common/DynamicBackground.tsx` | 0 | ambient orbs; used only by the feed |
| Dialogs (D2c): `MemberSelectModal.tsx` 11, `MemberTimelineModal.tsx` 17, `BlogPhotoGalleryModal.tsx` 0 | | not touched in D2b |

## Decisions

| # | Decision | Source |
|---|---|---|
| 1 | Keep the structure: the recent feed and the reader on the sheet; a member is picked with the existing member-select dialog, which opens the member timeline dialog. No new sidebar and no new features. | user |
| 2 | Tidy the reader's reading width, leading and paragraph rhythm with the type scale and spacing tokens. | user |
| 3 | Photo and video viewers (incl. the blog photo gallery) stay dark full-screen. All dialogs and viewers are D2c, so D2b does **not** restyle `MemberSelectModal`, `MemberTimelineModal`, `BlogPhotoGalleryModal` or `MediaViewerModal`. | user |
| 4 | Official-app look stays verbatim through the official layer; group colour only in the allowed places. The blog screens have no official-app element of their own (the official layer they show is the canvas around the sheet). | user / agent |
| 5 | **Keep the feed's ambient group-colour orbs.** D1.5 tokenised them as the `ambient` role (`groupRoles().ambient.orb1/2/3`). `DynamicBackground` is kept and rebuilt on tokens: the colours come from new `--ds-group-ambient-{1,2,3}` variables (`bg-group-ambient-1/2/3`), the per-group size and opacity move from `serviceThemes.ts` to `design/tokens/ambient.ts`, the drift animations become Tailwind keyframes. `DESIGN_SYSTEM.md` lists the orbs as an allowed group-colour place (decided). Elsewhere group colour appears only through roles: member names and links `text-group-strong`, link underline `decoration-group`, the rail's current dot `bg-group-accent` + `shadow-group-glow`, the member-name button's hover `bg-group-subtle`, focus rings `ring-group`. | controller decision: keep existing character |
| 5a | **Keep the reader's member penlight wash.** It is member data, not group colour. `memberWashStyle()` sets `--ds-member-wash-1/2` inline from the member's penlight colours; the `bg-member-wash` utility mixes them at the `memberWash.alpha` token (10 %, today's `1a` alpha) into the two corner gradients. Defaults are `transparent` (mascot, unknown member: no wash). `DESIGN_SYSTEM.md` records member penlight colours as a data-driven exception. | controller decision: keep existing character |
| 6 | The feed and reader headers sit on the sheet with no bar (no official title gradient: the official blog pages have no title bar to copy). The feed title keeps the official title colour, `text-group-title` (`--ds-group-title-text`, controller decision after review: keep existing character); the reader's post title stays `text-primary`. Contrast of the title colour on the white sheet at 20 px semibold: hinatazaka 3.3, nogizaka 9.2, yodel 5.0, default 7.6, sakurazaka 2.4 (below the 3:1 large-text bar; it is the official colour, kept as is). | agent / controller |
| 7 | **Keep the serif.** It becomes the type token `font-reading` (`--ds-font-family-reading`: `"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif`) and applies exactly where serif is used today: titles only (feed title, card titles, post title, rail tooltip title). The post body stays in the app font. Noto Serif JP keeps loading from Google Fonts (allowed; Noto Sans JP already loads there), now from the `<link>` in `index.html` instead of an `@import` inside the feed. | controller decision: keep existing character |
| 8 | Blog cards are level-2 `Card`s with the caption **inside the card, below the photo** (date, title, member), replacing the glass label that hung over the card's corner. The 2×2 "hero" cards at positions 0, 5 and 11 and the column breakpoints stay. | agent |
| 9 | All / Favorite becomes two neutral `Pill`s (the heart no longer turns pink). Select member is a `Button variant="secondary"`. The blog screens use no primary button. | agent |
| 9a | Orb 1 opacity is raised by 0.1 in every group (hinatazaka 0.4 to 0.5, sakurazaka 0.5 to 0.6, nogizaka 0.5 to 0.6, yodel 0.45 to 0.55, default 0.4 to 0.5) in `design/tokens/ambient.ts`. The other values are verbatim from `serviceThemes.ts`; the loss of presence came from dropping the tinted glass header, so the top-left wash is strengthened modestly. | agent (review follow-up) |
| 10 | Reader text uses a new type step `text-reading` (16 / 28 px) for long-form Japanese text; the article is at most `max-w-2xl` (672 px, about 38 CJK characters per line: `max-w-2xl` minus `px-8` leaves 608 px) with `px-8`; paragraphs are 16 px apart. | agent |
| 11 | New tokens: `text-reading`; search-mark colours `bg-mark-exact`, `bg-mark-reading`, `border-mark-underline` (the reader's current values, verbatim); `animate-reveal` (cards appearing, 200 ms). | agent |
| 12 | Photos inside a post keep their own corners and size (the member's content is shown as is); only `max-width: 100%` and the click-to-view cursor apply. | agent |
| 13 | The timeline rail gets its own 56 px column beside the scroll area, always reserved, so the scrollbar is not under the rail and the article does not shift when the member's post list arrives. | agent |
| 14 | The rail stays a pointer control (fisheye zoom unchanged) and is `aria-hidden`; keyboard users have ← / → and the older / newer buttons. The tinted zoom lens goes; the track stays 2 px. | agent |
| 15 | Older / newer navigation becomes two floating level-3 pills at the bottom of the post, replacing the white gradient bar; each has a screen-reader prefix ("Older post: …"). The arrow keys keep working as today. | agent |
| 16 | Loading, empty and error states share one feature-local `BlogStatus` (neutral, lucide icons, secondary Retry). Errors show a translated sentence instead of the raw HTTP message, which goes to a breadcrumb. | agent |
| 17 | Blog dates follow the app language through one helper, `formatBlogDate` (card: short, rail: medium, reader: long, 24-hour), replacing fixed en-US / ja-JP formats. | agent |
| 18 | Feed ↔ reader and post → post fade in through `FadeOnChange` (`duration-base`, none with reduced motion). The scroll to the first search match is instant with reduced motion. | agent |
| 19 | A `blog_load` breadcrumb covers every blog load path (target, outcome, count), replacing `console.error`, `console.debug` and silent catches. | agent |
| 20 | `ServiceTheme.blog` and `useBlogTheme` stay until the D2c dialogs stop reading them (E list). `ServiceTheme.ambient` now reads `ambientLayout` from the tokens. | agent |
| 21 | Behaviour is locked by tests on the unchanged code before any restyle: open a recent post, older/newer + arrow keys, rail click, back, member timeline → post → back to the timeline, member name → timeline, search → blog with highlights. | agent |
| 22 | **Fix three bugs found while reading**, each test-first: the feed's Retry refetches the recent posts (it set the same view, so nothing ran); the reader's Retry reloads the post (it returned to the feed); ← / → are ignored when the event was already handled (`defaultPrevented`, e.g. the photo viewer) or its target is an `input`, `textarea`, `select`, a content-editable element, or inside a dialog (`[role="dialog"]`, `dialog`, `[aria-modal="true"]`). | controller decision |

## Design per screen

Levels: canvas (level 0, around the sheet, unchanged) → sheet (level 1, `ContentSheet`, unchanged) → cards (level 2) → pills (level 3). Spacing is the Tailwind scale (multiples of 4 px); no arbitrary radius / shadow / text / spacing values.

### BlogsFeature (container)

- Root `flex h-full min-h-0 flex-1 flex-col overflow-hidden` (the sheet already paints `bg-sheet`; `bg-white` goes).
- The feed or the reader sits inside `FadeOnChange` with `changeKey` = `recent` or `reader:<blog id>`, `className="flex min-h-0 flex-1 flex-col"`. The three dialogs stay outside the fade.
- No service: `flex flex-1 items-center justify-center text-body text-muted` with `blogs.selectService`.
- All data loading, caching, cancellation and navigation logic stays as it is; only breadcrumbs are added (see Error handling).

### Recent feed (`RecentPostsFeed`)

- `<section aria-labelledby="blogs-feed-title" className="relative flex h-full min-h-0 flex-col">`. The inline `<style>` goes; `<DynamicBackground />` (no props any more) stays as the first child, and the header and the scroll area are `relative` so they sit above it.
- **Ambient orbs** (`core/common/DynamicBackground.tsx`, rebuilt): `aria-hidden` layer `pointer-events-none absolute inset-0 z-0 overflow-hidden`; three orbs `absolute rounded-pill blur-[100px] will-change-transform motion-reduce:animate-none` at today's places (`-left-[12%] -top-[18%]`, `-right-[15%] top-[18%]`, `-bottom-[22%] left-[28%]`), coloured by `bg-group-ambient-1/2/3` (orb 3 also sets `[--orb-opacity:var(--ds-group-ambient-3-opacity)]`, because the `orb-breathe` keyframes read `--orb-opacity`; before D2b it breathed at about 0.35 in every group, now it uses the group's orb 3 opacity), sized and faded by `var(--ds-group-ambient-N-size)` / `var(--ds-group-ambient-N-opacity)` (max 850 / 750 / 650 px), animated by `animate-orb-drift-1` (28 s), `animate-orb-drift-2` (34 s, delay −8 s), `animate-orb-breathe` (22 s, delay −15 s), keyframes copied verbatim; plus today's film-noise layer (`opacity-[0.018] mix-blend-multiply`, inline SVG). The per-group near-white base (`legacyNeutral.surfaceBackground`) gives way to the sheet.
- **Header** `flex shrink-0 items-center justify-between gap-4 px-6 pb-3 pt-5`, no border, no glass; the title and the syncing status sit in a `flex min-w-0 items-baseline gap-3` wrapper and the right side is a `flex shrink-0 items-center gap-3` group:
  - `h2#blogs-feed-title` `font-reading text-heading font-semibold text-group-title` (Latest Blogs; the header bar stays neutral).
  - While syncing: `span role="status"` `flex items-center gap-1 text-caption text-muted` with a `RefreshCw h-3 w-3 animate-spin motion-reduce:animate-none` and `blogs.checkingUpdates`.
  - Right: a `div role="group" aria-label={t('blogs.postsFrom')}` `flex items-center gap-1` with `Pill selected={mode === 'all'}` All and `Pill selected={mode === 'favorite'}` Favorite (`Heart h-3 w-3`, filled, current text colour); then `Button size="sm" variant="secondary"` with `Users h-4 w-4` and `blogs.selectMember`.
- **Grid** (scroll area `relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden`): `grid auto-rows-fr grid-flow-dense grid-cols-2 gap-4 p-6 min-[641px]:grid-cols-3 min-[641px]:gap-5 min-[901px]:grid-cols-4 min-[1201px]:grid-cols-5 min-[1201px]:gap-6` (the same window breakpoints as today). Hero items `col-span-2 row-span-2`.
- **Card reveal**: each grid item `animate-reveal motion-reduce:animate-none` with the existing delays (known posts `index × 50 ms`, posts new since the last visit a random 0–400 ms).
- **States** through `BlogStatus`: loading (`blogs.loadingPosts`), error (`AlertCircle`, `blogs.feedLoadFailed`, Retry — which now refetches), first sync (`fill`, `blogs.syncingBlogs` + `blogs.firstSyncHint`), empty (`Heart` or `Newspaper`, the existing favourite / all texts and hints).

### Blog card (`BlogCard`)

- The `<button type="button">` is itself the level-2 card (the `Card` primitive's classes; a `div` may not sit inside a `button`): `group flex aspect-[3/4] w-full flex-col overflow-hidden rounded-card bg-card text-left shadow-card transition-transform duration-base ease-standard hover:-translate-y-1 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group`. Its parts are `span`s:
  - Photo area `relative block min-h-0 flex-1 overflow-hidden bg-sunken` (the placeholder is the sunken surface). The `<img alt="">` (decorative: the caption names the post) is `absolute inset-0 h-full w-full object-cover object-top transition duration-base ease-standard group-hover:scale-105 motion-reduce:transform-none`, `opacity-0` until loaded, then `opacity-100`. The load/error reset on a new thumbnail (SD-FE-GAP-B-10) stays.
  - Caption `flex shrink-0 flex-col gap-1`, `p-4` (hero) or `p-3` (normal): date `text-caption text-muted` (`formatBlogDate` short), title `line-clamp-2 font-reading font-semibold text-primary` (`text-title` hero, `text-small` normal), member `truncate text-caption font-semibold text-group-strong`. Caption parts are `span`s (a heading inside a button is invalid).
- The glow aura, vignette, glass label and `useBlogTheme` go; `isHovered` state is replaced by CSS hover.

### Reader (`BlogReader`)

Layout:

```
div  relative flex h-full min-h-0 flex-col
├─ wash         pointer-events-none absolute inset-0 bg-member-wash (style = memberWashStyle)
├─ breadcrumb   relative flex shrink-0 items-center gap-1 px-4 pb-2 pt-3 text-small
├─ body         relative flex min-h-0 flex-1
│  ├─ column    relative min-w-0 flex-1
│  │  ├─ scroll h-full overflow-y-auto → status or article
│  │  └─ BlogNavFooter (absolute, floats over the bottom of the column)
│  └─ rail col  relative z-10 w-14 shrink-0 → TimelineRail when the member has > 1 post
└─ MediaViewerModal (unchanged, D2c)
```

- **Breadcrumb**: `IconButton size="sm"` (ghost, `ChevronLeft`, `aria-label={t('blogs.back')}`); the member name as a `button` `rounded-pill px-2 py-1 font-semibold text-group-strong transition-colors duration-fast ease-standard hover:bg-group-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group`; `/` `text-muted` (`aria-hidden`); the post title `min-w-0 truncate px-1 text-secondary`. No border and no glass.
- **Article** `mx-auto w-full max-w-2xl px-8 pb-24 pt-6` (`pb-24` keeps the last line clear of the floating older/newer pills):
  - `header` `mb-8 flex flex-col gap-2`: `h1` `font-reading text-heading font-semibold text-primary`; meta row `flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-muted` with the member-name button (`rounded-pill font-semibold text-group-strong decoration-group underline-offset-4 hover:underline` + focus ring), `·` (`aria-hidden`), `<time dateTime={iso}>` in `formatBlogDate` long, and the translate button (`ml-auto`) with `accentColor={color.text.secondary}` from the tokens.
  - Body `div` with `BLOG_PROSE` (below).
- **Reader typography** (`features/blogs/components/blogProse.ts`, Tailwind arbitrary variants on the sanitized HTML; every value is a token):

| Element | Classes |
|---|---|
| container | `break-words text-reading text-primary` (app font, 16 px / 28 px) |
| `p` | `mb-4`, last `mb-0` |
| `h1`–`h4` | `mt-8 mb-3 text-title font-semibold` |
| `ul` / `ol` | `mb-4 pl-6`, `list-disc` / `list-decimal` |
| `a` | `text-group-strong underline decoration-group underline-offset-4`, hover `decoration-2` |
| `img` | `h-auto max-w-full cursor-pointer` (own corners, no rounding) |
| exact search match `mark.search-highlight` | `bg-mark-exact px-1 text-inherit` |
| match by reading `mark.search-highlight.reading` | `bg-mark-reading border-b-2 border-dashed border-mark-underline` |

  Posts written with `<br>` runs keep their own blank lines; the 28 px leading carries the rhythm.
- **Inline translations** (`useInlineBlogTranslations`): the injected line uses classes instead of `style.cssText`: `blog-translation-inline inline-block border-l-2 border-strong pl-3 text-body italic text-secondary`.
- **Penlight wash**: `features/blogs/memberWash.ts` `memberWashStyle(member, groupId)` returns `{ '--ds-member-wash-1': c1, '--ds-member-wash-2': c2 }` from `getMemberPenlightHex` (same member lookup as today: name, name without spaces, blog id), or `undefined` for the mascot (id `000` / ポカ) and unknown members. The `bg-member-wash` utility draws today's two gradients (`ellipse 80% 50% at 0% 0%` and `ellipse 60% 40% at 100% 100%`, each fading out at 50 %) with `color-mix(in srgb, var(--ds-member-wash-N) var(--ds-member-wash-alpha), transparent)`.
- **States**: loading `BlogStatus` (`blogs.loadingPost`); error `BlogStatus` (`AlertCircle`, `blogs.postLoadFailed`, Retry — which now reloads the post instead of returning to the feed).
- The inline `<style>`, the penlight-coloured spinner and retry, and `useBlogTheme` go.

### Timeline rail (`TimelineRail`)

- Root (inside the rail column) `absolute inset-x-0 top-1/2 flex h-[70%] min-h-[300px] -translate-y-1/2 cursor-pointer select-none flex-col items-center`, `data-testid="timeline-rail"`, `aria-hidden="true"`.
- Track: `absolute left-1/2 -translate-x-1/2 border-l-2 border-subtle`, 30 px from the top and bottom (constant 2 px; the zoom lens gradient goes).
- Year markers: `absolute right-full mr-2 flex -translate-y-1/2 items-center transition-[top] duration-base ease-standard`, year `whitespace-nowrap text-caption font-medium text-muted`, tick `ml-2 w-1.5 border-t border-strong`.
- Current post: `absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-group-accent shadow-group-glow transition-[top] duration-base ease-standard`.
- Hover ring: `pointer-events-none absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-strong transition-opacity duration-base ease-standard`, `opacity-60` (`opacity-90` while zoomed).
- Tooltip: `Card` `pointer-events-none absolute right-full z-50 mr-4 min-w-[180px] max-w-[240px] -translate-y-1/2 overflow-hidden` (top clamped as today); thumbnail `aspect-[3/4] w-full bg-sunken bg-cover bg-center`; text block `flex flex-col gap-1 p-3`: title `line-clamp-2 font-reading text-small font-semibold text-primary`, row `flex items-center justify-between gap-2 text-caption tabular-nums text-muted` with `formatBlogDate` medium and `#n`.
- Position label `absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-caption font-medium tabular-nums text-muted` (`n/total`).
- The fisheye mapping, dwell zoom (800 ms, ±10 posts), click selection and year-label collision rule are unchanged; motion moves from 300 ms to `duration-base` (200 ms).

### Older / newer (`BlogNavFooter`)

- `<nav aria-label={t('blogs.postNavigation')}>` `pointer-events-none absolute inset-x-6 bottom-4 z-10 flex items-center justify-between gap-4`.
- Each side is a `button` `pointer-events-auto group flex max-w-[45%] items-center gap-2 rounded-pill bg-pill py-2 shadow-pill transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group` (`pl-3 pr-4 text-left` older, `pl-4 pr-3 text-right` newer). Chevron `h-4 w-4 shrink-0 text-muted group-hover:text-primary`. An `sr-only` prefix `blogs.olderPost` / `blogs.newerPost` + ": ". Title `block max-w-[160px] truncate text-small font-semibold text-primary` (still cut at 18 characters), date `block text-caption text-muted` (`formatBlogDate` short). A missing side is an empty `span`.
- Unchanged: Older = ← = the next-older post (higher index), Newer = → ; hidden when neither exists; the window-level arrow-key listener.
- Fixed: the listener ignores a key that was already handled (`defaultPrevented`: the photo viewer handles its own arrows) or whose target is an `input`, `textarea`, `select`, a content-editable element, or inside `[role="dialog"]`, `dialog` or `[aria-modal="true"]` (`ignoresPostKeys(e)` in `components/arrowKeys.ts`). It also ignores every key while any `[aria-modal="true"]` or `dialog[open]` exists on the page, and `BlogsFeature` passes `keysEnabled={!isTimelineModalOpen && !isPhotoGalleryOpen && !isMemberModalOpen}` through `BlogReader` to `BlogNavFooter`, because `MemberTimelineModal` has no dialog role and focus stays on the reader (D2c adds the role).

### BlogStatus (new, feature-local)

```ts
interface BlogStatusProps {
  kind: 'loading' | 'empty' | 'error';
  title: string;          // translated
  hint?: string;          // translated
  icon?: React.ReactNode; // empty / error
  onRetry?: () => void;
  retryLabel?: string;    // translated
  fill?: boolean;         // first sync: fill the scroll area
}
```

`role="alert"` for errors, `role="status"` otherwise; `flex flex-col items-center justify-center gap-4 px-6 text-center`, `h-72` (or `h-full min-h-96` with `fill`); loading shows `Loader2 animate-spin text-muted` (`h-8 w-8`, `h-10 w-10` with `fill`); the icon sits in `rounded-card bg-sunken p-5 text-muted`; title `text-body text-secondary`, hint `text-small text-muted`; Retry is `Button variant="secondary" size="sm"`.

### Fade transitions and motion

- Content fades in for `duration-base` on feed ↔ reader and on every post change (`FadeOnChange`, no remount); `ContentArea` already fades on feature and service changes.
- Cards reveal with `animate-reveal` (opacity 0 → 1, 8 px rise, 200 ms, `ease-standard`); hover lift `-translate-y-1` and photo zoom `scale-105` in `duration-base`.
- The ambient orbs drift slowly (22–34 s loops, today's keyframes): a documented exception to the 150–200 ms rule, like `duration-glide`.
- `prefers-reduced-motion`: no fade (`FadeOnChange`), no reveal, no orb drift, no hover lift or zoom (`motion-reduce:`), and the scroll to the first search match uses `behavior: 'auto'`.

### Accessibility

- The back button has a name (`blogs.back`); the member name and the older/newer controls are real buttons; the footer is a `nav` landmark with screen-reader prefixes; the feed is a `section` labelled by its heading.
- Cards are buttons whose name is the caption (date, title, member); the photo is decorative (`alt=""`).
- The All / Favorite pills are toggle buttons (`aria-pressed`, from `Pill`) in a labelled group.
- Loading and empty states are `status`, errors are `alert`.
- Every interactive element shows the `ring-group` focus ring.
- The rail is pointer-only and `aria-hidden`; ← / → and the footer cover it.
- Text uses `text-primary` / `text-secondary` on white (≥ 4.5:1); `text-muted` is used only for dates, counts and hints, as elsewhere in the app.

### i18n

New keys, in all 5 locales (`en`, `ja`, `zh-CN`, `zh-TW`, `yue`): `blogs.back`, `blogs.postsFrom`, `blogs.feedLoadFailed`, `blogs.postLoadFailed`, `blogs.loadingPost`, `blogs.olderPost`, `blogs.newerPost`, `blogs.postNavigation`. The hard-coded "Retry" uses `blogs.retry`. Dates use `formatBlogDate(date, i18n.language, style)` in `utils/dateFormatters.ts`:

| Style | Options | en / ja example |
|---|---|---|
| `short` (card, older/newer) | month short, day | Nov 4 / 11月4日 |
| `medium` (rail tooltip) | year, month short, day | Nov 4, 2026 / 2026年11月4日 |
| `long` (reader) | year, month long, day, 2-digit hour and minute, `hourCycle: 'h23'` | November 4, 2026 at 09:05 / 2026年11月4日 09:05 |

An invalid date gives `''`; an unknown locale falls back to the runtime default.

## Tokens added

| Token | Value | Utility | Use |
|---|---|---|---|
| `typeScale.reading` | 16 px / 28 px | `text-reading` | long-form reading (blog posts) only |
| `color.mark.exact` | `#FEF08A` | `bg-mark-exact` | exact search match in a post |
| `color.mark.reading` | `#DBEAFE` | `bg-mark-reading` | search match by reading |
| `color.mark.underline` | `#60A5FA` | `border-mark-underline` | dashed underline of a match by reading |
| keyframes `reveal` | opacity 0 → 1, `translateY(8px)` → 0 | `animate-reveal` | cards appearing in a feed (`duration-base`, `ease-standard`) |
| `fontFamily.reading` | `"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif` | `font-reading` | blog titles only (feed, cards, post, rail tooltip) |
| `--ds-group-ambient-{1,2,3}` | `groupRoles(id).ambient.orbN` (D1.5) | `bg-group-ambient-1/2/3` | the feed's ambient orbs |
| `ambientLayout[id].orbN` (`design/tokens/ambient.ts`) | today's per-group `size` / `opacity` / `position`, moved from `serviceThemes.ts` | `--ds-group-ambient-N-size`, `--ds-group-ambient-N-opacity` | orb size and opacity |
| keyframes `orb-drift-1`, `orb-drift-2`, `orb-breathe` | today's keyframes, verbatim | `animate-orb-drift-1` (28 s), `animate-orb-drift-2` (34 s), `animate-orb-breathe` (22 s) | the orbs' slow drift |
| `memberWash.alpha` (`design/tokens/member.ts`) | `10%`; `--ds-member-wash-1/2` default `transparent` | `bg-member-wash` | the reader's penlight wash |

Each one goes into `design/tokens`, `design/cssVars.ts`, `tailwind.config.js`, `utils/classnames.ts` (font size, font family, background images, animations), `DesignPage.tsx` (the type list, the ambient swatches; the mark colours show up in the neutral swatches) and `DESIGN_SYSTEM.md`.

## Error handling and logging

- Nothing in the blog screens throws to the UI. Failures show `BlogStatus` (feed, reader) or the dialogs' own states (D2c), exactly where they show today.
- New client breadcrumb `blog_load` (backend whitelist in `backend/api/client_log.py`, type in `utils/clientLog.ts`), fields `target`, `outcome`, `count`, sent through `logBlogLoad(target, outcome, count?)` in `features/blogs/blogLog.ts`:

| `target` | Path | Outcomes |
|---|---|---|
| `recent` | recent posts for the feed | `ok` (count = posts), `error` |
| `sync` | background metadata sync + refetch | `ok` (count = posts after the refetch), `error`, `cancelled` (service or view changed) |
| `content` | post content for the reader | `ok`, `cache_hit`, `error`, `cancelled` (another post or service meanwhile) |
| `search_open` | a post opened from search | `ok`, `error` |
| `members` | member list (pre-fetch and dialog) | `ok` (count), `error` |
| `member_posts` | the member timeline dialog's list | `ok` (count), `error` |
| `nav_list` | the reader's member post list (older/newer, rail) | `ok` (count), `error` |

  No titles, names, ids, URLs or error text are logged. `console.error` and `console.debug` leave `BlogsFeature`.
- Errors show a translated sentence (`blogs.feedLoadFailed`, `blogs.postLoadFailed`) instead of `Failed to fetch …: 500`.
- Retry works: `BlogsFeature` splits `handleRetry` into a feed retry (bumps a `recentReloadKey` that the recent-posts effect depends on) and a reader retry (`content: null` on a fresh reader state, which re-runs the content effect for the same post).

## Testing

### Behaviour locks (before any restyle, must pass on the unchanged code)

Test seams added first, with no visible change: `data-testid="timeline-rail"` on the rail and `aria-label={t('blogs.back')}` on the back button.

- **e2e** `frontend/e2e/blogs.spec.ts` with a pinned fixture `frontend/e2e/fixtures/blogs.ts` (two fictional members with CJK names, 42 + 6 posts with CJK + emoji titles, SVG thumbnails, pinned at the network layer on top of `pinBigRoom`, which gains a `feature` option):
  1. A card in the recent feed opens that post in the reader (content request for its id, the title as `h1`, the body text).
  2. The older/newer buttons and ← / → walk the member's posts (no newer button on the newest post).
  3. A click near the bottom of the rail opens the oldest post (`1/42`).
  4. Back returns to the recent feed.
  5. Select member → member → member timeline → a post → reader; back re-opens that member's timeline.
  6. The member name in the reader opens the member's timeline.
- **vitest**
  - `BlogsFeature.test.tsx`: a search target opens the reader, highlights exact matches (`mark.search-highlight`) and reading matches (`.reading`), clears the target and scrolls the first match into view.
  - `TimelineRail.test.tsx`: click → index mapping (top newest, bottom oldest, middle), dwell zoom changes the mapping, the `n/total` label, nothing for an empty list.
  - `BlogNavFooter.test.tsx`: ← / → call older / newer only when that side exists; nothing renders without either; clicks.
- Existing: `BlogCard.test.tsx` (image state reset), `useInlineBlogTranslations.test.tsx`, `useBlogTranslationVisibility.test.ts`.

### New unit tests

`formatBlogDate`; the new tokens (`staticTokenVars` / `groupTokenVars` write them, the type-scale keys, `ambientLayout` matches the old theme values); `DynamicBackground` (token classes, no inline colour, reduced motion); `memberWashStyle` (mascot, unknown, known member); the three bug fixes, test-first (feed Retry refetches, reader Retry reloads the post, ← / → ignored in inputs, dialogs and already-handled events); `BlogStatus` (roles, retry); `logBlogLoad` and the `blog_load` whitelist (pytest); the injected translation line has no inline style; `i18n/d2b.test.ts` (every new key in every locale); `features/blogs/blogScreens.style.test.ts` (the restyled files contain no named palette classes, no colour through inline styles and no `useBlogTheme` / `serviceThemes`).

### Screenshots

`frontend/e2e/d2b-screens.spec.ts` captures (no comparison) with the pinned blog fixture, reduced motion and a fixed clock: for Hinatazaka, Sakurazaka and Nogizaka the feed, the reader and the reader with the rail tooltip; for Hinatazaka also the empty and the failed feed. Yodel has no blogs. Run with `SHOT_LABEL=before` on the unchanged code (after the locks) and `SHOT_LABEL=after` at the end; files go to the git-ignored `frontend/e2e-shots/<label>/`.

### Zero-pixel and guard

- D2b changes no pixel outside the blog feature. `e2e/visual-zero-pixel.spec.ts` (home, member chat, group chat) is re-captured on the unchanged branch at the start and must pass unchanged at the end. The new CSS variables and utilities change nothing on those screens.
- The guard only goes down: `BlogCard.tsx`, `BlogNavFooter.tsx`, `BlogReader.tsx`, `RecentPostsFeed.tsx`, `TimelineRail.tsx` and `hooks/useInlineBlogTranslations.ts` reach 0 and leave `guard-baseline.json`. New files start at 0.

### Verification

Frontend unit tests, `tsc`, lint, `npm run build`, the blog e2e locks, the zero-pixel spec, backend `pytest` for the client-log whitelist, `ruff` and `mypy`. No Windows build in D2b: the user checks D2a–D2d together on one Windows build at the end.

## Implementation order

1. Locks: test seams, the blog fixture, e2e + vitest locks, zero-pixel re-capture, before shots.
2. Tokens (reading type and serif, marks, reveal, ambient orbs, penlight wash), `formatBlogDate`, i18n keys.
3. `blog_load` breadcrumb, `BlogStatus`, `BlogsFeature` (neutral root, fade, breadcrumbs, both Retry fixes), the style ratchet test.
4. Feed, cards and the token-based ambient orbs.
5. Reader layout, typography, penlight wash, search marks, inline translations.
6. Timeline rail and older/newer pills (arrow-key fix).
7. Final checks, after shots, `CHANGELOG.md`, E list, spec zero drift.

## Out of scope

- The blog dialogs (`MemberSelectModal`, `MemberTimelineModal`, `BlogPhotoGalleryModal`) and the photo/video viewers (`MediaViewerModal`, `PhotoPlayer`): D2c. Notes for D2c: `MemberSelectModal` hard-codes a pink `#ff69b4` favourite and the mascot's CDN thumbnail URL; both dialogs read `useBlogTheme`; the search dialog's `.search-snippet mark` styles should move to the new mark tokens; the blog e2e locks select the dialogs by text and role and may need new selectors after D2c.
- `TranslateButton` / `InlineTranslation` (shared with the chat; `core/common`).
- New blog features (a member sidebar, search inside blogs, keyboard rail), dark mode, the entry screens (D2d).

## Verification notes

- **Spinner stop.** In the reader's content effect an `applied` flag is set once a fetch's content is applied (applying it re-runs the effect, whose cleanup marks the fetch cancelled); `setLoading(false)` then runs when `!cancelled || applied`, so the spinner cannot stay on.
- **Breadcrumbs.** `content` also logs `in_flight` when a load is skipped because the same post is already being fetched; a `sync` that fails after the view changed logs `cancelled`, not `error`.
- **Penlight wash.** The wash is checked in `components/BlogReader.test.tsx` with a real member from member data: the wash element has `--ds-member-wash-1/2` set to that member's penlight hex. The fixture members in the d2b-screens shots are not in member data, so the wash is not visible there.
- **Accepted for the D2 review.** Sakurazaka's feed title in its official colour has 2.44:1 contrast on white. It was the same before D2b.
