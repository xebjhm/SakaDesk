# D2c — Every dialog, viewer and menu on the design system

Date: 2026-11-05
Status: designed by the agent in autonomous mode within the user's settled D2c rules. The user reviews D2a–D2d together on one Windows build at the end. Every call is marked in the Decisions table; the controller may override any agent decision.
Branch: `feat/d2c-dialogs` → `dev`, cut from `dev` after D2a (#13) and D2b (#14) merged

## Context

D2 applies the D-4 layout ("one sheet on a coloured base") to every screen. It is split up (see the D2a spec, `2026-11-04-d2a-chat-frame-design.md`):

| Part | Scope |
|---|---|
| D2a (merged) | App frame, member sidebar, chat, letters in chat, sticky date pills |
| D2b (merged) | Blog screens: recent feed, reader, timeline rail |
| **D2c** (this spec) | Every dialog, viewer, menu and popover; the dialog layer itself |
| D2d | Entry screens: login, landing, setup wizard, ToS, sync (their content) |

D1 built a `Modal` primitive (level-1 sheet, `bg-scrim`, Escape and backdrop close) but noted that it has no focus trap and no focus restore. Only `SentLettersModal` (D2a) and the design page use it. Every other dialog is one of four pre-D1 shells:

| Shell | Used by | What it does today |
|---|---|---|
| `core/common/BaseModal.tsx` `BaseModal` (390 lines, 3 variants) | Calendar, Background, Favorites, Media gallery, Blog photo gallery | `role="dialog"` + `aria-modal`, container focus and restore, Escape on `document`, body scroll lock (`overflow = ''` on close, so nested dialogs unlock too early), the official title gradient as the dialog header (hex from `getServiceTheme`), `bg-black/60`, `z-[100]`, `rounded-xl shadow-2xl` |
| `BaseModal` `DetailModal` (header mode unused; fullscreen mode) | Favorites detail, Media gallery detail | `bg-black/90`, `z-[110]`, Escape in the capture phase with `stopImmediatePropagation` |
| `useModalClose(isOpen, onClose)` + a hand-written backdrop | About, Report issue, Diagnostics, Add service, Settings | Escape + backdrop only; **no** `role="dialog"`, no `aria-modal`, no focus handling; `bg-black/50–60`, `z-50` |
| Hand-written, no hook | Member select, Member timeline, Search, Member profile, Confirm, Login, Sync, Setup, ToS, reveal-all | Each its own Escape (or none), backdrop, z-index (`z-50`, `z-[60]`, `z-[100]`) and look; only Member profile is a real dialog |

The photo/video viewer `MediaViewerModal` (`core/media/PhotoDetailModal.tsx`) is a focused `div` with its own keys, no dialog role, `z-[110]`. Menus (`ConversationMenu`, `MessageContextMenu`, `MemberContextMenu`, `SettingsMenu`, the service rail's context menu, the search filter dropdowns and the three player menus) are each a white `rounded-lg shadow-lg border` box with its own outside-click and Escape code and z-index (`z-50`, `z-[100]`, `z-[9999]`).

### What each D2c file hard-codes today

Guard counts are from `frontend/src/design/guard-baseline.json` at the start of D2c. Named palette classes are not counted by the guard but are still forbidden.

| File | Guard | Hard-coded or legacy today |
|---|---|---|
| `core/common/BaseModal.tsx` | 6 | official gradient header via inline style, `#FFFFFF`, `rgba(255,255,255,0.8)`, `bg-white rounded-xl shadow-2xl`, `bg-black/60/70/90`, hard-coded English `aria-label="Close modal"` |
| `core/common/ModalStates.tsx` | 0 | `text-blue-500` spinner, `bg-red-50 text-red-700` error box, English default `Retry`, `bg-gray-100` icon tile |
| `core/modals/AboutModal.tsx` | 0 | `bg-black/60`, `bg-white rounded-xl`, `text-gray-*`, `text-red-400` heart, `bg-gray-800` toast, an inline `<style>` with 0.8 s / 1.2 s keyframes, `aria-label="heart"` |
| `core/modals/BackgroundModal.tsx` | 2 | `theme.modals.*` via inline style and `onMouseEnter` handlers, `#d1d5db` / `#4b5563` resets, `alert()` for errors, hard-coded "Preview" |
| `core/modals/CalendarModal.tsx` | 0 | `theme.modals.*` inline styles and hover handlers, `text-red-500` Sundays, chevrons without a name (the e2e uses `button.p-2`) |
| `core/modals/DiagnosticsModal.tsx` | 0 | `bg-gray-900` header, `bg-slate-900` log console, green/amber/red/blue palette classes |
| `core/modals/FavoritesModal.tsx` | 0 | `theme.modals.accentColor` star and voice accent, `divide-y`, `border border-gray-200` cards, a `MoreHorizontal` button with no action |
| `core/modals/ReportIssueModal.tsx` | 0 | `bg-gray-900` header, blue selection palette, `bg-red-50` error |
| `core/layout/AddServiceModal.tsx` | 2 | pastel `#b4dcff → #f0bede` header, per-group logo-colour hover border via `onMouseEnter` |
| `core/media/MediaGalleryModal.tsx` | 2 | `theme.modals.*` tab colour and indicator, glass voice bar (`backdrop-blur-xl` + mask + white fade), `bg-black/50/60/80` badges and toast, `z-[60]` |
| `core/media/PhotoDetailModal.tsx` | 0 | no dialog role; `bg-black/90`, `text-white/70`, `bg-white/20`, `bg-black/80` toast |
| `core/media/PhotoPlayer.tsx` | 0 | `bg-gray-100/200` placeholders, `text-gray-400` |
| `core/media/VideoPlayer.tsx`, `VoicePlayer.tsx` (menus) | 3, 8 | three copies of a white menu: `#3b82f6` / `#374151` speed colours, `text-blue-500`, `border-t` dividers, `z-[9999]` |
| `features/blogs/components/MemberSelectModal.tsx` | 11 | glass panel (`rgba(255,255,255,0.95)` + blur), pink `#ff69b4` favourite, `#ff9ccb` spinner, `sky-*` palette, the mascot's CDN thumbnail URL inline, hard-coded Japanese favourite labels, an inline `<style>`; computes member penlight colours it never draws; no title, no dialog role |
| `features/blogs/components/MemberTimelineModal.tsx` | 17 | glass panel, `useBlogTheme()` logo colour + hex alpha everywhere, `#999` / `#666` / `#333`, inline serif font family, 300–500 ms transitions, an inline `<style>`; no dialog role |
| `features/blogs/components/BlogPhotoGalleryModal.tsx` | 0 | `BaseModal`, `useBlogTheme().primaryColor` conic spinner |
| `features/messages/components/MemberProfilePopup.tsx` | 0 | official gradient via inline style, `theme.surface.background`, `border-white`, `text-gray-*`, `text-red-*` |
| `features/messages/components/ProfileImagePills.tsx` | 2 | `text-[11px]` / `text-[9px]`, `sky-*` palette |
| `features/messages/components/ProfileImageViewer.tsx` | 0 | `bg-white/15`, `text-white/80` tabs |
| `features/messages/components/MessageContextMenu.tsx` | 1 | `theme.modals.accentColor` star, `#9ca3af` |
| `features/messages/components/MemberContextMenu.tsx`, `ConversationMenu.tsx`, `core/common/SettingsMenu.tsx` | 0 | white menus, `theme.modals.accentColor` icons, `bg-gray-200` trigger, `h-px` divider |
| `features/messages/MessagesFeature.tsx` (reveal-all) | 0 | inline dialog with `bg-black/50`, `text-gray-*`, `theme.modals.accentColor` confirm |
| `core/layout/ServiceRail.tsx` | 0 | `bg-orange-500` disconnected badge, white context menu with `text-red-500` |
| `features/search/SearchModal.tsx` + `components/*` | 5 | no dialog role; `bg-amber-50` banners, `text-blue-500` load more, an inline `<style>` for `<mark>` (`rgb(254 240 138)` …), `text-[10px]`, per-group dot colours via inline style |
| `shell/components/SettingsModal.tsx` | 0 | `bg-gray-100` header with a literal "X", blue switches (`bg-blue-400`), `border-t` section dividers, `window.confirm` ×4, `console.error` ×2 |
| `shell/components/ConfirmDialog.tsx` | 2 | pastel header, amber/red/blue buttons, `z-[60]`, no Escape |
| `shell/components/LoginModal.tsx`, `SyncModal.tsx`, `SetupWizard.tsx`, `TosDialog.tsx` | 3, 4, 2, 2 | hand-written shells without dialog semantics; content is D2d |

### Legacy theme fields and their readers at the start of D2c

| `ServiceTheme` field | Read by |
|---|---|
| `blog.*` (via `useBlogTheme`) | `MemberTimelineModal`, `BlogPhotoGalleryModal` |
| `ambient` | nothing (D2b moved the orbs to tokens); `d2bTokens.test.ts` |
| `modals.*` | Background, Calendar, Favorites, Media gallery, `MessageContextMenu`, `ConversationMenu`, reveal-all and the `CallOverlay` accent in `MessagesFeature`, `useMessagesTheme` (favourite and link colour of the bubbles), `InlineSyncView` (D2d), `PopupCall` |
| `interaction.buttonGradient` | `MemberTimelineModal` |
| `surface.background` | `MemberProfilePopup` |
| `text`, `vibe` | nothing |
| `messages.*` | chat (`MessagesFeature`, `MessageList`, `MessageBubble`), `BaseModal`, `MemberProfilePopup`, `LoginModal` (D2d), `InlineSyncView` (D2d), `PopupCall` |
| `primaryColor` / `secondaryColor` / `accentColor` | `config/colors/semantic.ts` (legacy CSS variables), `data/services.ts` `getServicePrimaryColor` |

## Decisions

| # | Decision | Source |
|---|---|---|
| 1 | Photo/video viewers (the media gallery's and favourites' detail view, the chat and letter viewer, the blog reader's and blog photo gallery's viewer, the avatar viewer) stay **dark full-screen**; only their chrome (close, counter, download, source link, toast, tabs) is restyled to tokens. | user |
| 2 | Settings stays a **large dialog with left-side tabs**, restyled (not a page). | user |
| 3 | Restyle only: structure and behaviour stay, no new features. Official-layer colours verbatim; group colour only in the allowed places; **at most one primary Button per dialog** (a `danger` Button counts as that one). | user |
| 4 | **D2c / D2d boundary.** D2c moves **every** dialog shell onto the upgraded `Modal`, including `LoginModal`, `SyncModal`, `SetupWizard` and `TosDialog` (as `layout="bare"`, so dialog semantics, focus, Escape rules, scrim and layering are uniform). Their **content** (pastel headers, forms, progress, the per-service login header) is left untouched for D2d, together with `LandingPage`, `LoginPage` and `InlineSyncView`. | agent (user's suggestion) |
| 5 | The two galleries (media gallery, blog photo gallery) stay **light** large dialogs with a thumbnail grid, as today; the photo/video they open is the dark viewer (decision 1). | agent |
| 6 | **Neutral dialog header**: the title sits on the sheet (`text-title font-semibold text-primary`) with a ghost close `IconButton`; the official title gradient leaves the five `BaseModal` dialogs. Precedent: the D1 `Modal` and D2a's `SentLettersModal`. Only `MemberProfilePopup` keeps the official title banner, because it mirrors the official profile card. | agent |
| 7 | **Own dialog layer, no new dependency.** A module-level dialog stack (`design/dialog/dialogStack.ts`) plus a `useDialog` hook give: Escape for the top-most dialog only, a Tab focus trap, focus restore to the opener, a reference-counted body scroll lock and a z-index per stack depth. The needs are small (~150 lines, fully unit-tested) and app-specific (the incoming-call overlay's Escape claim, the fullscreen-video Escape, the viewer's own arrow keys), so a headless library would add a dependency and new event rules for no gain. | agent |
| 8 | **Escape**: only the top-most dialog reacts; it ignores a key that is already handled (`defaultPrevented`), typed during IME composition (`isComposing` / key code 229) or pressed while an element is fullscreen (the browser exits fullscreen); when it closes it calls `preventDefault()` so the incoming-call overlay does not also decline. Intended change: a stacked dialog (calendar over the media gallery, calendar over the blog photo gallery, settings' confirm) no longer closes the dialog below it too. | agent |
| 9 | **Focus**: on open, focus moves to `initialFocusRef` if given (search input, ConfirmDialog's cancel), else to the dialog frame (`tabIndex={-1}`, no ring); Tab / Shift+Tab cycle inside the top-most dialog; on close focus returns to the element that had it. | agent |
| 10 | `dismissible={false}` for ToS, Setup and Sync (no Escape, no backdrop close, no close button, as today). ConfirmDialog becomes dismissible by Escape (= Cancel); today it ignores Escape. | agent |
| 11 | **One menu look and behaviour**: a new `Menu` primitive (level-2 popover: `bg-card rounded-card shadow-card p-1`, items `rounded-pill`, hover `bg-sunken`) with `role="menu"` / `menuitem` (`menuitemradio` for the player speed), ↑ / ↓ / Home / End between items, Escape (claimed) and Tab close it, an outside mouse-down closes it, focus returns to the trigger. Groups are separated by 8 px of space, never a line. Used by every menu and dropdown in the app. | agent |
| 12 | **Form controls**: new `Switch` primitive and `Input` / `Select` primitives (`h-10 rounded-pill bg-sunken px-4 text-body`, `ring-group` focus). A switch's on state is `bg-group-accent`, and native radios, checkboxes and range sliders use `accent-group` (the action colour). This adds one allowed group-colour place, "form control on state", to `DESIGN_SYSTEM.md`. The controller may switch it to neutral (`bg-primary`-style token) if the review finds it too loud. | agent |
| 13 | **Status colours** become tokens named by role and safe for small text on white: `status.danger` `#DC2626` (4.8:1), `status.success` `#15803D` (5.0:1), `status.warning` `#B45309` (5.0:1); `status.attention` `#F97316` is the rail's disconnected badge fill, today's `orange-500` verbatim. Error and warning panels are neutral (`bg-sunken`) with a status-coloured icon and text; tinted red/amber boxes go. | agent |
| 14 | **Viewer tokens** (`color.viewer.*`: scrim 0.9 black, stage black, control white 0.2 / hover 0.3, text white, muted text white 0.7, underline white 0.3) and one shared `overlay.toast` (black 0.8) carry the dark chrome. `Button` and `IconButton` gain an `overlay` variant for viewer controls. | agent |
| 15 | **Player internals stay for E.** The `VideoPlayer` control bar, the `VoicePlayer` cards, `TranscriptPanel`, `TranscribeButton` and `SubtitleOverlay` are the same components as in the chat bubbles and take the group colour as a hex prop; they move to tokens in E together with `TranslateButton` (one colour-mix pass). D2c restyles only their three popover menus (on `Menu`) and `PhotoPlayer`'s placeholder / error tile. | agent |
| 16 | **Cross-group markers** in search (the 6 px dot per result and per filter chip, which tells groups apart in a cross-group list) keep each group's logo colour as data: `groupMarkerStyle(serviceId)` sets `--ds-group-marker` from `groupRoles(id).logo`, drawn by `bg-group-marker` (default `transparent`). Documented as a data-driven exception like the member wash. `AddServiceModal`'s per-group hover border goes (neutral hover; the logos identify the groups). | agent |
| 17 | **Member select dialog**: gets a visible title (`blogs.selectMember`) and the standard close button, replacing the "tap outside to close" hint; members are real `button`s (avatar + name), the favourite heart a sibling `button` (a button cannot hold a button). The favourite heart is neutral like D2b's All/Favorite pill: filled `text-primary` when favourited, outline `text-muted` otherwise, on a `bg-pill shadow-pill` disc. The unused penlight computation is removed (no member colours in this dialog). The mascot rule and its CDN thumbnail URL move to `features/blogs/mascot.ts` (`isMascot`, `MASCOT_THUMBNAIL_URL`), also used by `memberWash.ts`. | agent |
| 18 | **Member timeline dialog**: a real dialog on `Modal` (title = member name, `headerExtra` = Photos button + post count). Month sections are level-2 `Card`s with a disclosure button (`aria-expanded`); the open month's label is `text-group-strong`; post rows hover `bg-group-subtle`, titles stay serif (`font-reading`, as D2b's blog titles), the "new in 24 h" dot is `bg-group-accent` (the badge role); motion is `animate-reveal` / `duration-base`. `BlogsFeature` keeps passing `keysEnabled` (belt and braces next to `arrowKeys.ts`). | agent |
| 19 | **Settings**: standard header; left nav of neutral pill buttons (`aria-current`; selected `bg-sunken font-semibold text-primary`); every row through a feature-local `SettingRow` (label, description, control) with `Switch`, `Input`, `Select`; sections separated by spacing, not `border-t`; the one primary Button is the output-folder Save; Reset defaults is a ghost Button in the footer. | agent |
| 20 | Native `window.confirm` (Settings ×4) becomes `ConfirmDialog` with the same texts and the same double confirmation for cleaning the blog cache; `alert()` in the background dialog becomes an inline `role="alert"` line. `console.error` in Settings becomes a breadcrumb. | agent |
| 21 | **ConfirmDialog**: standard header with its icon (`AlertTriangle`: `text-status-warning` for `warning`, `text-status-danger` for `danger`, `text-secondary` for `default`); Cancel is a ghost Button; Confirm is `primary` (default, warning) or `danger`. The pastel header goes. | agent |
| 22 | **Diagnostics** is a hidden developer panel: its English labels stay (they are read next to English logs and are not user-facing); it gets the standard dialog, neutral info cards, status-coloured icons, and a light log view (`bg-sunken font-mono text-caption`, ERROR lines `text-status-danger`, WARNING `text-status-warning`) instead of the dark console. | agent |
| 23 | **Report issue**: category choices are level-2 cards with `aria-pressed`; selected `bg-group-subtle border-group-subtle` (the subtle-selection role); fields are `Input`; Create issue is the primary Button. | agent |
| 24 | **About** keeps its character: the red heart (`text-heart`, `#F87171` verbatim) and the golden-finger easter egg animations, moved from the inline `<style>` to Tailwind keyframes (`animate-heart-float` 800 ms, `animate-heartbeat` 1.2 s) as documented exceptions to the motion rule, off with reduced motion. | agent |
| 25 | **Calendar**: Sundays stay red (`text-sunday`, `#EF4444` verbatim: Japanese calendar convention); day cells are `rounded-pill` circles, hover `bg-group-subtle`, the message dot `bg-group-accent` (badge role), today `bg-sunken font-semibold`; chevrons are ghost `IconButton`s named `calendar.prevMonth` / `calendar.nextMonth`. | agent |
| 26 | **Background**: Upload is a secondary Button; the preset swatches keep the user's chosen colours as data (inline background, as the chat background itself), selected `ring-2 ring-offset-2 ring-strong`; the opacity slider uses `accent-group`; Reset is ghost, Done is primary. | agent |
| 27 | **Favorites**: one level-2 `Card` per favourite on the sheet (no dividers), `Avatar`, star `text-group-strong` filled (selected-text role, also in the message context menu); the no-op ⋯ button is removed; the detail view moves from `DetailModal` to `Modal tone="viewer"` with its current content. | agent |
| 28 | **Breadcrumbs**: `Modal` takes an optional `logId` and logs `dialog` (`surface`, `phase` open/close, `reason` escape/backdrop/button/app). Dialog data loads log `dialog_load` (`surface`, `outcome`, `count`). Never names, ids, paths or text. | agent |
| 29 | **Zero-pixel**: the Messages main screens (home, member chat, group chat) must stay pixel-identical. Two triggers on them are restyled on purpose and are **masked** in `visual-zero-pixel.spec.ts`: the rail's settings button and the chat header's ⋯ button. The masks are added in Task 2 and the baselines re-captured on the unchanged code; the spec must then pass unchanged at the end. Everything else that D2c touches on those screens is value-identical (`ring-surface` = the white ring, `IconButton variant="accent"` = today's unread-arrow classes). | agent |
| 30 | **Search** is a top-placed dialog (`placement="top"`, `aria-label` `search.title`): input row on the sheet, filter bar on `bg-sunken`, chips as `Pill`s with the group marker, dropdowns on `Menu`, the selected result `bg-group-subtle`, matches via the mark tokens (`[&_mark]:bg-mark-exact`, reading `bg-mark-reading` + dashed `border-mark-underline`), banners neutral with an icon. Its keyboard model (↑ / ↓ / Tab / Enter / Escape) is unchanged. | agent |
| 31 | **Layering** has one source, `constants/zIndex.ts`: `DROPDOWN` 50 (menus anchored inside the frame), `DIALOG` 100 + `DIALOG_STEP` 10 per stacked dialog, `POPOVER` 1000 (portaled menus above any dialog), `TOAST` 1100. `z-[60]`, `z-[100]`, `z-[110]`, `z-[9999]` go. | agent |
| 32 | **Legacy theme removal**: `useBlogTheme` and `ServiceTheme.blog`, `.ambient`, `.modals`, `.interaction`, `.surface`, `.text`, `.vibe` are removed, with `groupTokens[*].legacyNeutral` and `groupRoles().buttonGradient` once nothing reads them. Remaining `modals.*` readers outside D2c's restyle (`InlineSyncView`, `PopupCall`, the `CallOverlay` accent and `useMessagesTheme`'s favourite/link colour) switch to `groupRoles(id).action` / `.subtle`, the identical values (no pixel changes). `messages.*` and the three brand colours stay (chat, `LoginModal`, legacy CSS variables). `serviceThemes.ts` must stay free of colour literals. | agent |
| 33 | **Member profile popup**: official banner verbatim (`bg-group-title`, or `bg-sheet` + the 4 px `bg-group-title-bar` for light-header groups, as the chat header), large avatar `ring-4 ring-surface`, image kinds as `Pill`s with a `Badge`-style count, streak in tokens, error neutral with `text-status-danger` and a secondary Retry. | agent |
| 34 | The media gallery's sticky voice player bar loses the glass (blur + mask + white fade) for a solid `bg-sheet` bar with `shadow-card`. | agent |
| 35 | Sheet dialogs enter with `animate-reveal` (200 ms fade + 8 px rise, none with reduced motion), as the blog dialogs did; the viewer has no entry animation. | agent |
| 36 | The `button.p-2` selector in `e2e/timeline-scroll.spec.ts` is replaced by the chevron's name (`Previous month`) in Task 1, when the names are added as a test seam. | agent |

## The dialog layer

### `design/dialog/dialogStack.ts`

Module state, no React:

```ts
export interface DialogEntry { id: number; node: () => HTMLElement | null; dismissible: boolean }

pushDialog(entry: Omit<DialogEntry, 'id'>): DialogEntry   // also locks body scroll (count 0 → 1)
popDialog(entry: DialogEntry): void                       // removes wherever it is; unlocks at count 0
isTopDialog(entry: DialogEntry): boolean
dialogDepth(entry: DialogEntry): number                   // 0 for the first open dialog
dialogZIndex(entry: DialogEntry): number                  // Z_INDEX.DIALOG + depth * Z_INDEX.DIALOG_STEP
openDialogCount(): number
```

Scroll lock keeps the body's previous `overflow` value and restores it when the last dialog closes (today each dialog wrote `''` on close).

### `design/dialog/useDialog.ts`

```ts
useDialog({ isOpen, onClose, dismissible, initialFocusRef, frameRef }): {
  zIndex: number;
  requestClose: (reason: 'escape' | 'backdrop' | 'button') => void;
}
```

- On open: push, remember `document.activeElement`, focus `initialFocusRef` or the frame (after paint).
- `document` `keydown` (bubble phase): only if this entry is top-most. Escape → see decision 8. Tab → collect the frame's tabbable elements (`a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`) and wrap first ↔ last; if focus is outside the frame (and not inside an open `role="menu"`, which handles Tab itself), move it to the first (or the frame when there is none). There is no `focusin` guard: portaled menus (the player menus) must be able to take focus outside the frame.
- `Menu` listens for Escape on `document` in the **capture** phase and claims it, so a menu inside a dialog closes before the dialog sees the key.
- On close / unmount: pop, restore focus to the remembered element if it is still in the document.

### `Modal` primitive (upgraded, `design/primitives/Modal.tsx`)

```ts
export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;          // visible h2; names the dialog
  'aria-label'?: string;            // name when there is no visible title (search, viewer)
  labelledBy?: string;              // name from an element inside a bare dialog
  closeLabel?: string;              // translated; shows the header close button (standard layout)
  headerExtra?: React.ReactNode;    // between the title and the close button
  children: React.ReactNode;
  footer?: React.ReactNode;
  tone?: 'sheet' | 'viewer';        // default 'sheet'
  layout?: 'standard' | 'bare';     // default 'standard'
  placement?: 'center' | 'top';     // default 'center'
  dismissible?: boolean;            // default true
  initialFocusRef?: React.RefObject<HTMLElement>;
  className?: string;               // frame (width, height)
  bodyClassName?: string;           // standard body (padding)
  logId?: DialogLogId;              // breadcrumb surface
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>; // the viewer's own keys
}
```

Rendering (`createPortal` into `document.body` directly; the `Portal` component mounts one render late, so the frame ref would still be empty when the open effect runs):

- Backdrop `div` `data-testid="modal-backdrop"`, `fixed inset-0 flex justify-center p-4`, `items-center` (center) or `items-start` with an inline `paddingTop: 15vh` (top; arbitrary padding classes are guarded), `bg-scrim` (sheet) or `bg-viewer-scrim` (viewer), `style={{ zIndex }}`. A click on the backdrop itself closes when dismissible (`reason: 'backdrop'`).
- Frame `role="dialog" aria-modal="true"`, `aria-labelledby` (title id or `labelledBy`) or `aria-label`, `tabIndex={-1}`, `outline-none`.
  - sheet: `flex max-h-full w-full max-w-lg flex-col overflow-hidden bg-sheet rounded-sheet shadow-sheet animate-reveal motion-reduce:animate-none` + `className`.
  - viewer: `relative flex h-full w-full items-center justify-center` + `className` (children own the layout; the viewer scrim is the background).
- Standard layout: header `flex shrink-0 items-center gap-3 px-6 pb-2 pt-5` with `h2` `min-w-0 flex-1 truncate text-title font-semibold text-primary`, `headerExtra`, and the close `IconButton size="sm"` (`X`, `aria-label={closeLabel}`) when `closeLabel` and dismissible; body `min-h-0 flex-1 overflow-y-auto px-6 pb-6 text-body text-primary` + `bodyClassName`; footer `flex shrink-0 items-center justify-end gap-2 px-6 pb-6`.
- Bare layout: children directly inside the frame.
- `useModalClose` and `BaseModal` / `DetailModal` are deleted once nothing uses them; `core/common/index.ts` stops exporting them.

### Viewer chrome (`MediaViewerModal`)

`Modal tone="viewer" layout="bare" aria-label={t('common.mediaViewer')}` with the current content and keys (← / → navigate, ↑ / ↓ zoom; the viewer's own Escape case goes, the dialog layer closes it):

- Close: `IconButton variant="overlay" size="md"` `absolute right-4 top-4` (`aria-label` `common.close`).
- `headerSlot` (avatar tabs) `absolute left-1/2 top-4 -translate-x-1/2`.
- Counter `absolute bottom-6 left-6 text-small tabular-nums text-viewer-muted` (`bottom-14` with a source link).
- Download (golden finger, photos only): `Button variant="overlay" size="sm"` `absolute right-6`.
- Source link `absolute bottom-6 left-1/2 max-w-[60vw] -translate-x-1/2 truncate text-small text-viewer-muted underline decoration-viewer underline-offset-2 hover:text-viewer`.
- Clipboard toast `absolute left-1/2 top-4 -translate-x-1/2 rounded-pill bg-toast px-4 py-2 text-small text-viewer`.
- Avatar viewer tabs (`ProfileImageViewer`): `Pill`-shaped buttons, selected `bg-pill text-primary`, others `bg-viewer-control text-viewer-muted hover:bg-viewer-control-hover`.

The media gallery's and favourites' detail views use the same chrome (`Modal tone="viewer"`), keeping their own footers (member · time link · n / total, Download) as `text-small text-viewer-muted` on the stage.

## Per-dialog target

All dialogs: `Modal` (sheet, standard layout, `closeLabel={t('common.close')}`, a `logId`) unless noted. Loading, empty and error states inside dialogs use one shared `DialogStatus` (`core/common/DialogStatus.tsx`, replaces `ModalStates.tsx`): `role="status"` / `role="alert"`, `Loader2 animate-spin text-muted`, icon tile `rounded-card bg-sunken p-4 text-muted`, title `text-body text-secondary`, hint `text-small text-muted`, error text `text-status-danger`, Retry `Button variant="secondary" size="sm"` (`common.retry`).

| Dialog | Frame | Target |
|---|---|---|
| Calendar | `max-w-md` | decision 25; month row `flex items-center justify-between px-6 pb-2`; grid `grid grid-cols-7 gap-1`; weekday labels `text-caption text-muted` (Sunday `text-sunday`); footer hint `text-small text-muted`; `dialog_load` surface `calendar` (API mode) |
| Background | `max-w-md` | decision 26; preview `h-32 rounded-card shadow-card` (inline user colour/image as today); labels `text-small font-semibold text-secondary`; hints `text-caption text-muted`; inline error `text-small text-status-danger role="alert"` |
| Favorites | `max-w-3xl h-[80vh]`, body `bg-sunken` edge to edge | decision 27; card `Card p-4 flex flex-col gap-3`; header row `Avatar size="md"`, name `text-body font-semibold`, star + time `text-small text-muted`; text `whitespace-pre-wrap text-body`; photos/videos `rounded-card overflow-hidden shadow-card`; play disc `bg-viewer-control`; footer count `text-small text-muted` |
| Media gallery | `max-w-4xl h-[80vh]` (as today), body edge to edge | tabs: `role="tablist"` (`aria-label` `media.typeTabs`), each tab `flex-1 py-3 text-muted`, selected `text-group-strong` with a 4 px `bg-group-accent rounded-pill` indicator; month headers `sticky bg-sheet px-4 py-3 text-small font-semibold text-secondary`; grid `grid grid-cols-4 gap-1 px-1` (gap 2 → 4 px); muted / duration badges `bg-toast text-viewer rounded-pill`; voice rows on the sheet with `bg-group-subtle` for the playing row; decision 34; footer count + Jump to date ghost Button; detail = viewer chrome |
| Blog photo gallery | `max-w-4xl h-[80vh]`, body edge to edge | as the media gallery grid; loading `DialogStatus`; footer like the media gallery; `dialog_load` surface `blog_gallery` (`ok` with count, `partial` when some posts failed, `error` when all failed) |
| Member select | dynamic `max-width` (inline px, as today) | decision 17; generation label `text-caption font-semibold text-muted` + spacing (the `h-px` line goes); avatar `h-20 w-20 rounded-pill bg-sunken overflow-hidden` with today's crop; name `text-small text-secondary group-hover:text-primary`; heart disc `absolute bottom-0 right-0 rounded-pill bg-pill p-1 shadow-pill`; states `DialogStatus` |
| Member timeline | `max-w-3xl` | decision 18; month card header `w-full flex items-center justify-between px-4 py-3`, chevron disc `h-6 w-6 rounded-pill bg-sunken`, count `Pill`-like `rounded-pill bg-sunken px-3 py-1 text-small text-secondary`; row `flex gap-4 rounded-card p-3 hover:bg-group-subtle`; thumb `h-[75px] w-[100px] rounded-card bg-sunken shadow-card` |
| About | `max-w-sm` | logo tile `h-20 w-20 rounded-sheet shadow-card overflow-hidden`; name `text-heading font-semibold`; version `text-small text-muted` (still the hidden 5-click target); lines `text-small text-muted` / `text-secondary`; heart decision 24 with `aria-label` `about.madeWithLove`; toast `bg-toast text-viewer rounded-pill text-caption`; footer link `text-small text-secondary hover:text-primary` |
| Report issue | `max-w-lg` | decision 23; context block `rounded-card bg-sunken p-3 text-caption text-secondary` (crash line `text-status-danger`); error `role="alert"` `text-small text-status-danger`; footer Cancel ghost + Create primary |
| Diagnostics | `max-w-3xl` | decision 22; info blocks `Card p-4`, section headings `text-caption font-semibold uppercase tracking-wider text-muted`, values `font-mono text-primary`; log filter tabs as `Pill`s; footer Refresh ghost + Copy JSON primary (copied state shows `CheckCircle2 text-status-success` inside); `dialog_load` surface `diagnostics` |
| Add service | `max-w-lg` | decision 16; rows `Card` buttons `flex items-center gap-4 p-4 hover:bg-sunken`; logo disc `h-12 w-12 rounded-pill bg-card shadow-pill`; feature chips `rounded-pill bg-sunken px-2 py-1 text-caption text-secondary` |
| Confirm | `max-w-md` | decision 21; message `whitespace-pre-line text-body text-secondary` |
| Reveal all (in `MessagesFeature`) | `max-w-sm` | title `messageList.revealAllTitle`; text `text-body text-secondary`; Cancel ghost, Confirm primary |
| Settings | `max-w-3xl h-[600px] max-h-[90vh]`, body edge to edge | decision 19, 20; nav `w-44 shrink-0 flex flex-col gap-1 overflow-y-auto p-3` (`aria-label` `settings.sections`); panel `min-w-0 flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-6`; `SettingRow` label `text-body font-semibold text-primary`, description `max-w-md text-small text-muted`; radio rows `rounded-card p-2 hover:bg-sunken`; `dialog_load` surfaces `settings_blog_cache`, `settings_blog_backup`, `settings_update_check` |
| Search | `max-w-xl max-h-[60vh]`, top placement, bare layout | decision 30; `initialFocusRef` = the input; `dialog_load` surface `search` (`ok` + count, `error`) |
| Member profile | `max-w-sm`, bare layout, `labelledBy` the name | decision 33; close `IconButton` (`overlay` on the gradient, `ghost` on light) `absolute right-4 top-4` |
| Login, Sync, Setup, ToS | as today, bare layout | shell only (decision 4); `dismissible={false}` for Sync, Setup, ToS |
| Sent letters | unchanged (already on `Modal`) | gains the new behaviour |

## Menus and popovers

`Menu` (`design/primitives/Menu.tsx`) with `MenuItem` (`icon`, `selected`, `destructive`, `disabled`), `MenuLabel` and `MenuSeparator` (8 px space). Two placements: **anchored** (rendered in place, the caller positions it, `Z_INDEX.DROPDOWN`) and **point** (portaled, `fixed` at a viewport point clamped by `clampToViewport`, `Z_INDEX.POPOVER`).

| Menu | Placement | Notes |
|---|---|---|
| Chat ⋯ (`ConversationMenu`) | anchored `right-0 top-full mt-1 w-48` | icons `text-secondary` (no group colour); the disabled Sent letters item in group chats; the trigger becomes a ghost `IconButton` with `text-current` (masked in the zero-pixel shots) |
| Message right-click (`MessageContextMenu`) | point | star `text-group-strong fill-current` when favourite, `text-muted` otherwise |
| Member right-click (`MemberContextMenu`) | point | unchanged item |
| Rail service right-click (`ServiceRail`) | point | Remove service is `destructive` (`text-status-danger`) |
| Settings menu (`SettingsMenu`) | anchored `bottom-0 left-full ml-2 w-48` | trigger becomes `IconButton variant="secondary" className="h-11 w-11"` like its two siblings, `aria-haspopup="menu"`, `aria-expanded` (masked in the zero-pixel shots); a separator before About |
| Player menus (`VideoPlayer`, `VoicePlayer` ×2) | point (their computed position) | speed items `menuitemradio`, selected `font-semibold text-group-strong`; Download item; Loop item `selected` when on |
| Search content type / date dropdowns | anchored | selected preset `selected` (radio) |
| Search member autocomplete | anchored, **not** a `Menu` | a `listbox` with the menu look (`rounded-card bg-card p-1 shadow-card`, `option` rows `rounded-pill hover:bg-sunken`): focus must stay in the text field while typing; rows carry the group marker dot |

## Tokens added

| Token | Value | Utility | Use |
|---|---|---|---|
| `ringColor.surface`, `borderColor.surface` | `var(--ds-surface-sheet)` | `ring-surface`, `border-surface` | the white gap ring of avatars (Avatar `selected`, chat header avatar, group-chat cell, profile avatar), the rail badge's border |
| `color.status.danger` | `#DC2626` | `text-status-danger`, `bg-status-danger` | error text and icons, destructive menu items, the `danger` Button |
| `color.status.success` | `#15803D` | `text-status-success` | OK states (diagnostics, copied, API key saved) |
| `color.status.warning` | `#B45309` | `text-status-warning` | warning text and icons |
| `color.status.attention` | `#F97316` | `bg-status-attention` | the rail's disconnected badge (today's value) |
| `color.decor.sunday` | `#EF4444` | `text-sunday` | Sundays in the calendar (today's value) |
| `color.decor.heart` | `#F87171` | `text-heart` | About's heart (today's value) |
| `color.overlay.toast` | `rgba(0, 0, 0, 0.8)` | `bg-toast` | toasts in viewers and About |
| `color.viewer.scrim` | `rgba(0, 0, 0, 0.9)` | `bg-viewer-scrim` | viewer backdrop |
| `color.viewer.stage` | `#000000` | `bg-viewer-stage` | the box behind a video |
| `color.viewer.control` / `controlHover` | `rgba(255, 255, 255, 0.2)` / `0.3` | `bg-viewer-control`, `hover:bg-viewer-control-hover` | overlay buttons and tabs |
| `color.viewer.text` / `textMuted` | `#FFFFFF` / `rgba(255, 255, 255, 0.7)` | `text-viewer`, `text-viewer-muted` | viewer text |
| `color.viewer.underline` | `rgba(255, 255, 255, 0.3)` | `decoration-viewer` | the viewer's source link |
| `accentColor.group` | `var(--ds-group-accent)` | `accent-group` | radios, checkboxes, range sliders (decision 12) |
| `--ds-group-marker` (inline per element, default `transparent`) | `groupRoles(id).logo` | `bg-group-marker` | cross-group dots in search (decision 16) |
| keyframes `heart-float`, `heartbeat` | today's keyframes | `animate-heart-float` (800 ms), `animate-heartbeat` (1.2 s) | About's easter egg only |
| `Z_INDEX` (`constants/zIndex.ts`) | `DROPDOWN` 50, `DIALOG` 100, `DIALOG_STEP` 10, `POPOVER` 1000, `TOAST` 1100 | inline `zIndex` | layering (decision 31) |

Primitive changes: `Button` variants `danger` (`bg-status-danger text-inverse shadow-pill hover:brightness-105`) and `overlay` (`bg-viewer-control text-viewer hover:bg-viewer-control-hover`); `IconButton` variants `accent` (`bg-group-accent text-inverse shadow-card hover:brightness-105`, the unread arrows) and `overlay`; new `Switch`, `Input`, `Select`, `Menu`; `Avatar selected` uses `ring-surface`. Each token goes through `design/tokens` → `design/cssVars.ts` → `tailwind.config.js` → `utils/classnames.ts` (for `text-`, `bg-` image, `shadow-`, `animate-` groups) → `DesignPage.tsx` → `DESIGN_SYSTEM.md`.

`DESIGN_SYSTEM.md` gains: the dialog layer (`Modal` props, stack, Escape and focus rules, `tone="viewer"`), the menu and form primitives, the status / viewer / decor tokens, "form control on state" (decision 12) and "cross-group markers" (decision 16) as allowed group-colour places, the two easter-egg animations as motion exceptions, and the removal of "(until D2c: `MemberSelectModal`)" from the member-colour paragraph.

## Accessibility

- Every dialog: `role="dialog"`, `aria-modal="true"`, a name, focus moved in and restored, Tab trapped, Escape for the top-most only. Once dialogs are `aria-modal`, `features/blogs/components/arrowKeys.ts` ignores ← / → while any is open (a unit test and an e2e test lock it).
- Close buttons, chevrons, the heart and favourite buttons, the viewer's controls and the settings trigger have translated names.
- Menus: roles, arrow keys, Escape, focus return (decision 11). Tabs that already are `tablist` (media gallery, avatar viewer) keep their roles; the settings nav uses `aria-current`.
- Status text is ≥ 4.5:1 on white (decision 13); `text-muted` only for hints, dates and counts.

## i18n

New keys in all 5 locales (`en`, `ja`, `zh-CN`, `zh-TW`, `yue`): `common.retry`, `common.confirm`, `common.mediaViewer`, `calendar.prevMonth`, `calendar.nextMonth`, `calendar.loadFailed`, `search.title`, `search.filters`, `search.searchFailed`, `settings.sections`, `media.typeTabs`, `about.madeWithLove`, `blogs.addFavorite`, `blogs.removeFavorite` (with `{{name}}`), `profileImages.kinds`. Hard-coded strings that go: `Close modal`, `heart`, `Preview`, `Media type tabs`, the Japanese favourite labels, `ModalErrorState`'s `Retry`, the settings close button's literal `X`. Diagnostics keeps its English labels (decision 22).

## Breadcrumbs

New whitelisted client events (backend `backend/api/client_log.py`, type in `utils/clientLog.ts`); all field keys exist already:

| Event | Fields | Sent by |
|---|---|---|
| `dialog` | `surface`, `phase` (`open` / `close`), `reason` (`escape` / `backdrop` / `button` / `app`) | `Modal` with a `logId` |
| `dialog_load` | `surface`, `outcome` (`ok` / `error` / `partial` / `cancelled`), `count` | the data loads in Calendar (API mode), Diagnostics, Blog photo gallery, Member profile images (`profile_images`), Search (`search`), Settings (`settings_blog_cache`, `settings_blog_backup`, `settings_update_check`, `settings_blog_clean`), Report issue (`report_issue`) |

`logId` values: `calendar`, `background`, `favorites`, `media_gallery`, `media_viewer`, `blog_gallery`, `member_select`, `member_timeline`, `about`, `report_issue`, `diagnostics`, `add_service`, `confirm`, `reveal_all`, `settings`, `search`, `member_profile`, `login`, `sync`, `setup`, `tos`, `sent_letters`. No titles, names, ids, paths, queries or error text.

## Testing

### Behaviour locks (before any restyle, must pass on the unchanged code)

Test seams added first, with no visible change: `aria-label` on the calendar chevrons (`calendar.prevMonth` / `nextMonth`) and `data-testid="unread-shelter"` on a message's unread cover (the reveal-all long press holds the mouse on it). Locks use roles, headings and visible text that exist both before and after D2c (a menu item is found by its text, a dialog before D2c by its heading). Two intended changes cannot be locked on the old code, so their stricter assertions are added in the task that makes them: Escape on a stacked dialog leaves the dialog below open (Tasks 6, 9).

- **e2e** `frontend/e2e/dialogs-chat.spec.ts` on `pinBigRoom` (+ favourite route):
  1. ⋯ → Date Search opens the calendar; Escape closes it; a day jump lands (the existing timeline-scroll tests already lock the landing; this one locks open/close).
  2. ⋯ → Media → Photos lists the three fixture photos; a photo opens the dark viewer; Escape closes the viewer only; clicking the viewer's time jumps to that message (`#msg-4990` visible) and closes both.
  3. Right-click a bubble → Add to favorites (route answers) → ⋯ → Favorites lists it.
  4. ⋯ → Background → a preset sets the chat background; Done closes.
  5. Header avatar → profile popup (dialog named by the member) → Escape closes.
  6. Long press on an unread shelter → reveal-all confirm → Confirm reveals.
  7. ⋯ → Sent letters lists the fixture letters (already on `Modal`).
- **e2e** `frontend/e2e/dialogs-app.spec.ts`:
  1. Rail settings → Settings; Sync tab shows the sync mode; the incoming-call switch POSTs `incoming_call_enabled: false`; Escape closes.
  2. Rail settings → About; Escape closes. Rail settings → Report issue opens; Cancel closes.
  3. Rail + → Add service lists the other groups; Escape closes.
  4. Ctrl+K → Search; typing shows a pinned `/api/search` result; Escape closes. (Enter → open the chat at the message is locked by the existing `SearchModal.test.tsx`.)
  5. Blogs: Select member → member → timeline → Photo Album → the blog photo gallery opens; Escape closes it; ← / → on the open timeline do not switch the post behind it.
- **vitest**: `ConfirmDialog` (confirm, cancel, labels), `SettingsMenu` (items call their actions), `ServiceRail` context menu (remove), `MessageContextMenu` (toggle + close), `MemberSelectModal` (select, favourite toggle), `MemberTimelineModal` (month toggle, select), `BackgroundModal` (preset persists), `ReportIssueModal` (submit needs a category), `DiagnosticsModal` (loads, copy), `arrowKeys` (ignored while an `aria-modal` element exists).

### New unit tests

`dialogStack` (push/pop order, top-most, depth/z-index, scroll lock count and restore); `useDialog` / `Modal` (role, name by title / `aria-label` / `labelledBy`, initial focus, Tab wrap, focus restore, Escape top-most only, ignores `defaultPrevented` / composition / fullscreen, claims Escape, backdrop, `dismissible={false}`, viewer tone classes, breadcrumbs with reasons); `Menu` (roles, arrow keys, Escape claim and focus return, outside click, `clampToViewport`); `Switch`, `Input`, `Select`; the new `Button` / `IconButton` variants; the tokens (`staticTokenVars`, `tailwind` utilities resolve); `groupMarkerStyle`; `isMascot`; `DialogStatus`; `logDialogLoad` and the backend whitelist (pytest); `i18n/d2c.test.ts` (every new key, every locale, non-empty, `{{name}}` kept); `core/dialogs.style.test.ts` (the D2c files contain no named palette classes, no colour through inline styles, no `getServiceTheme` / `useBlogTheme` / `serviceThemes`, no `window.confirm` / `alert(`, no `z-[`).

### Screenshots

`frontend/e2e/d2c-screens.spec.ts` captures (no comparison) with the pinned fixtures, `reducedMotion: 'reduce'`, `animations: 'disabled'` and a fixed clock, for Hinatazaka and Sakurazaka (light header): calendar, media gallery, media viewer, favourites, background, member profile, chat ⋯ menu, message context menu, settings (General, Sync), about, add service, search with results, confirm (settings Deep resync), member select, member timeline, blog photo gallery; for Hinatazaka also report issue, diagnostics and the reveal-all confirm. `SHOT_LABEL=before` on the unchanged code (after the locks), `SHOT_LABEL=after` at the end; files go to the git-ignored `frontend/e2e-shots/<label>/`.

### Zero-pixel and guard

- `e2e/visual-zero-pixel.spec.ts` gains masks for the rail's settings trigger and the chat header's ⋯ trigger (decision 29), is re-captured with `--update-snapshots` on the unchanged code in Task 2, and must pass unchanged at the end. Never update its snapshots after Task 2.
- The guard only goes down. `BaseModal.tsx` is deleted; `AddServiceModal.tsx`, `BackgroundModal.tsx`, `MediaGalleryModal.tsx`, `MemberSelectModal.tsx`, `MemberTimelineModal.tsx`, `MessageContextMenu.tsx`, `ProfileImagePills.tsx`, `SearchModal.tsx` and `ConfirmDialog.tsx` reach 0 and leave `guard-baseline.json`; `VideoPlayer.tsx` and `VoicePlayer.tsx` drop by their menu literals. `LoginModal`, `SyncModal`, `SetupWizard`, `TosDialog` keep their counts for D2d. New files start at 0.

### Verification

Frontend unit tests, `tsc`, lint, `npm run build`, every e2e spec (the new locks, `blogs.spec.ts`, `timeline-scroll.spec.ts`, `chat-frame.spec.ts`), the zero-pixel spec, backend `pytest` for the client-log whitelist, `ruff`, `mypy`. No Windows build in D2c.

## Implementation order

1. Locks I: chat dialogs and menus (e2e), the chevron seam, the timeline-scroll selector.
2. Locks II: app and blog dialogs (e2e + vitest), zero-pixel masks + re-capture, before shots.
3. Tokens, button variants, `ring-surface`, unread-arrow `accent`, rail badge.
4. Dialog layer: `dialogStack`, `useDialog`, `Modal`, breadcrumbs.
5. `Menu`, `Switch`, `Input`, `Select`, `DialogStatus`.
6. Chat-menu dialogs: Calendar, Background, Favorites.
7. App dialogs: About, Report issue, Diagnostics, Add service, Confirm, reveal-all.
8. Viewers and the media gallery; player menus; `PhotoPlayer` tiles.
9. Blog dialogs; `BaseModal`, `DetailModal`, `ModalStates` and `useModalClose` deleted.
10. Menus and the member profile popup.
11. Search.
12. Settings.
13. Entry-flow shells; legacy theme removal.
14. Final checks, after shots, `CHANGELOG.md`, E list, `DESIGN_SYSTEM.md`, spec zero drift.

## Out of scope

- Entry-flow content (login, landing, setup, ToS, sync, `InlineSyncView`): D2d.
- Player internals (`VideoPlayer` bar, `VoicePlayer` cards, `TranscriptPanel`, `TranscribeButton`, `SubtitleOverlay`) and `TranslateButton` / `InlineTranslation`: E (decision 15).
- The app-level error toast in `shell/App.tsx` and `UpgradeIcon`'s progress ring: E.
- New dialog features, dark mode, keyboard shortcuts.
