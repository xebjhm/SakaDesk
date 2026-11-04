# D2d — Entry screens on the design system

Date: 2026-11-05
Status: designed by the agent in autonomous mode within the user's settled D2 rules. The user reviews D2a–D2d together on one Windows build at the end. Every call is marked in the Decisions table; the controller may override any agent decision.
Branch: `feat/d2d-entry` → `dev`, cut from `dev` after D2a (#13), D2b (#14) and D2c (#15) merged

## Context

D2 applies the D-4 layout ("one sheet on a coloured base") to every screen. It is split up (see the D2a spec, `2026-11-04-d2a-chat-frame-design.md`):

| Part | Scope |
|---|---|
| D2a (merged) | App frame, member sidebar, chat, letters in chat, sticky date pills |
| D2b (merged) | Blog screens: recent feed, reader, timeline rail |
| D2c (merged) | Every dialog, viewer, menu and popover; the dialog layer itself |
| **D2d** (this spec) | Entry screens: ToS, landing, login, setup wizard, sync (their content), the inline sync view; the D2d items of the E list |

D2c moved the four entry-flow dialog **shells** (`LoginModal`, `SyncModal`, `SetupWizard`, `TosDialog`) onto `Modal` with `layout="bare"` and left their content for D2d (D2c decision 4). D2d restyles that content, plus `LandingPage`, `LoginPage` and `InlineSyncView`, and closes the "D2d notes" section of `docs/superpowers/backlog/e-cleanup.md`.

### How the entry screens are shown

`shell/App.tsx` decides, in this order:

1. Boot: while auth and prefs hydrate, a full-window spinner on `bg-[#F0F2F5]` (`text-blue-500`).
2. `TosDialog` alone while ToS is not accepted (first launch).
3. `LandingPage` alone while no service is selected (first launch, or every service removed).
4. The app shell (root `bg-[#F0F2F5]`), where during onboarding the main layout is hidden ("clean background") and these dialogs show on it: the login carousel (`LoginModal` with `isFreshPrompt`, one per selected service with messages), then `SetupWizard` (output folder; `is_configured` false), then `SyncModal` (sequential first sync, one service at a time, with a "2 / 3" counter).
5. Later in normal use: `LoginModal` for an expired session, a disconnected service or a freshly added service; `SyncModal` for a blocking sync, verify & fix (with its result) or a deep re-sync; `InlineSyncView` inside the content sheet while a newly added service runs its first sync.

Before a service is selected no group tokens are applied (`applyGroupTokens` runs only for an active service), so `--ds-group-*` are undefined on the ToS and landing screens; and when every service has been removed, the landing page still carries the last group's tokens.

`LoginPage` (`pages/LoginPage.tsx`) is imported by nothing but its own test: `LoginModal` replaced it when the app became multi-service.

### What each D2d file hard-codes today

Guard counts are from `frontend/src/design/guard-baseline.json` at the start of D2d. Named palette classes are not counted by the guard but are still forbidden.

| File | Guard | Hard-coded or legacy today |
|---|---|---|
| `shell/components/TosDialog.tsx` | 2 | pastel `#b4dcff → #f0bede` header with white text, amber disclaimer box, `bg-gray-50` panels, per-group link colours (`purple-600`, `pink-600`, `blue-600`, `indigo-600`) with `|` separators, `text-blue-600` checkbox, `bg-blue-400` button; the bare frame clips the tall card in a short window (E list); fixed title id `tos-title` |
| `shell/components/SetupWizard.tsx` | 2 | pastel header, `border-gray-200` input with `ring-blue-500`, `bg-gray-100` Browse, `bg-gray-50` option card, `bg-blue-400` button, label not tied to the input; fixed id `setup-title` |
| `shell/components/SyncModal.tsx` | 4 | pastel header with white text and `bg-white/30` counter bars, pastel progress fill with a white gloss, `bg-gray-50` stat tiles, amber / `bg-blue-50` detail rows, blue/green/gray phase dots, amber "unresolved" box with `divide-y`, `bg-gray-100` Done / Cancel, `duration-300`; fixed id `sync-title` |
| `shell/components/LoginModal.tsx` | 3 | the per-service header from `getServiceTheme` hex via inline styles (gradient, `#FFFFFF`, `${headerTextColor}15`, `rgba(255,255,255,0.2)`), an unnamed close button, `bg-red-50` error box, bordered Cancel, Login button in the **logo colour with white text** (D1.5 deferral: 1.9:1 for Hinatazaka); fixed id `login-title` |
| `core/layout/InlineSyncView.tsx` | 4 | `bg-[#F0F2F5]` page fill inside the content sheet (sheet on sheet), `bg-white rounded-2xl shadow-2xl` card, header and progress fill from `getServiceTheme` + `groupRoles` hex via inline styles, the same stat / detail / dots markup as `SyncModal` duplicated |
| `pages/LandingPage.tsx` | 4 | `from-gray-50 to-gray-100` page, `bg-white rounded-2xl shadow-lg` cards with `hover:scale-[1.02]`, each group's **logo colour** as the selection ring and the check disc with a white check (D1.5 deferral), `ring-[3px]`, pastel Get Started button with white text, `text-gray-*` |
| `pages/LoginPage.tsx` | 3 | unused page: `bg-[#F0F2F5]`, pastel button, `bg-blue-50` icon tile |
| `shell/App.tsx` | 2 | `bg-[#F0F2F5]` boot and root, `text-blue-500` boot spinner; the settings error toast (`bg-red-50 border-red-200`, a non-spinning `Loader2` as its icon, hard-coded English "Error" and "Debug", `bg-white/50` button) |
| `features/incomingCall/CallOverlay.tsx` | 0 | `absolute inset-0 z-30` inside the chat area, which is an `isolate` stacking context: an open dialog always covers a ringing call (E list) |

## Decisions

| # | Decision | Source |
|---|---|---|
| 1 | Restyle only: structure and behaviour stay, no new features. Official-app look where an official counterpart exists (official-layer colours verbatim); group colour only in the allowed places; **at most one `primary` or `danger` Button per screen and per dialog**. | user |
| 2 | D2d restyles the content of `LoginModal`, `SyncModal`, `SetupWizard` and `TosDialog`, plus `LandingPage`, `LoginPage` and `InlineSyncView`, and covers every "D2d notes" item of the E list and the D1.5 deferral "white text on the logo colour" (login button, landing check). | user |
| 3 | **Neutral before a group is chosen.** While ToS is not accepted or no service is selected, `App` applies the `default` group's tokens (`applyGroupTokens('default')`), so the ToS and landing screens have defined, neutral grey group roles (action `#4b5563`, subtle `#f9fafb`, canvas grey) instead of undefined variables or a stale group. Once a service is active its group applies as today. | agent |
| 4 | **ToS, setup and sync use the standard dialog layout** (`layout="standard"`): the title is the dialog's `h2` (named by `Modal`'s own `useId`), the body scrolls, the footer holds the action. They stay non-dismissible (no close button, Escape and backdrop do nothing). The pastel brand header goes, as it went from Add service and Confirm in D2c (D2c decision 6: neutral dialog header); the subtitle becomes the first body line (`text-small text-muted`). Because only the body scrolls and the footer stays, **a short window no longer clips the ToS card** (E list). | agent |
| 5 | **Login keeps the official banner** (bare layout), drawn like the chat header and the profile card (D2c decision 33): `bg-group-title text-inverse`, or for Sakurazaka's `light` header `bg-sheet text-group-title` with the 4 px `bg-group-title-bar` under it. The icon disc is `bg-viewer-control` on the gradient (today's white 0.2) and `bg-group-subtle` on the light header; the close button is an `IconButton` (`overlay` on the gradient, `ghost` on light) named `common.close`; the title id comes from `useId`. The service name under the title is full-strength `text-inverse` on the gradient (today 80 %), for contrast. **Light banners:** on a light official banner (Sakurazaka) only the large title keeps the official `text-group-title`; small secondary text (the service line) is `text-secondary`, in both the login banner and the inline sync banner. | agent |
| 6 | **Group scope.** A surface that belongs to one service other than the active one sets that group's variables on itself: `groupScopeStyle(groupId)` (`design/groupScope.ts`) returns `groupTokenVars(groupId)` as inline custom properties, so every `*-group-*` utility inside follows that group. Used by `LoginModal` (its `serviceId`: the login carousel shows each service while the first one is active), `SyncModal` during a sequential sync (the service being synced; the dialog keeps the last scoped service until it closes, so "Complete" does not switch to the active group's colours when the sequence info is cleared) and `InlineSyncView` (its `service`). Documented in `DESIGN_SYSTEM.md` as the only way to show a specific group's colours on a surface. | agent |
| 7 | **Contrast (D1.5 deferral).** Login's sign-in button becomes `Button variant="primary"` (`bg-group-accent`, the action colour, white text ≥ 3:1 by the D1.5 floor) instead of the logo colour; the landing check disc is `bg-group-accent` with `text-inverse` (`default` action, 7.6:1). No white text on a logo colour remains in the entry screens. | agent |
| 8 | **Landing** = level 0 `Canvas` (the `default` canvas, decision 3) with one level-1 `Sheet` (`max-w-4xl p-10`, `animate-reveal`) holding the title (`text-heading font-semibold`), the subtitle, the service cards, the one primary Button and the footer note. Each service is a selectable level-2 card with `aria-pressed`, following Report issue (D2c decision 23): `rounded-card border-2 p-6 shadow-card`, selected `border-group-subtle bg-group-subtle`, else `border-transparent bg-card hover:bg-sunken`; the check disc `bg-group-accent text-inverse` when selected, else a `border-2 border-strong` ring. The card is a Tailwind `group`, and its feature chips turn `bg-card` on hover (`group-hover:bg-card`) so they stay visible on the `bg-sunken` hover. The logo is decorative (`alt=""`): the card's visible name already names the group. No per-group colours (D2c decision 16 removed Add service's per-group hover for the same reason: the logos identify the groups); the hover scale goes. | agent |
| 9 | **One sync progress panel.** `SyncModal` and `InlineSyncView` share `SyncProgressPanel` (`core/common/SyncProgressPanel.tsx`): count and percent (`text-small font-semibold tabular-nums`), a `role="progressbar"` bar (`h-2 rounded-pill bg-sunken`, fill `bg-group-accent`, width transition `duration-base ease-standard`, none with reduced motion), three stat tiles (`grid grid-cols-3 gap-4`; each `flex flex-col gap-1 rounded-card bg-sunken p-3 text-center`, label `text-caption text-secondary`, value `font-mono text-title font-semibold tabular-nums`, then a unit line `min-h-4 text-caption text-secondary`: the speed's unit such as `files/s` sits under its number, and the empty line of the other two keeps the tiles equal), the running detail row and the phase steps (count `text-secondary`, percent `text-primary`). "Progress fill" joins the `bg-group-accent` role list. The panel shows the detail row only while running (`SyncModal`'s rule; `InlineSyncView` is only shown while running, so nothing changes there). | agent |
| 10 | **Phase steps**: pending `bg-control-off`, active `bg-group-accent shadow-group-glow` with its label `font-semibold text-group-strong` (selected-text role) and `aria-current="step"`, done `bg-status-success` with a small `Check` in `text-inverse` (new `bg-status-success` utility of the existing `status.success` token). Labels `text-caption`, the others `text-secondary`. Each step also carries a non-colour cue, an `sr-only` `sync.stepCurrent` / `sync.stepDone` / `sync.stepPending`. | agent |
| 11 | **Status panels are neutral** (D2c decision 13): the ToS disclaimer, the sync "downloading media, do not close" row and the verify "unresolved" list sit on `bg-sunken` with an `AlertTriangle` / spinner in `text-status-warning` and `text-primary` / `text-secondary` text; errors (login) are a `role="alert"` line in `text-status-danger` with an `AlertCircle`, never on `bg-sunken`. The running detail row is `bg-group-subtle` with a `text-secondary` spinner (today `bg-blue-50` in the modal and the group subtle colour inline). | agent |
| 12 | **ToS links** use the link role (`text-small text-group-strong underline decoration-group underline-offset-2`, with a small `ExternalLink` icon), grey under the `default` group; the four per-group link colours and the `|` separators go (spacing separates them). The quoted Japanese ToS articles stay verbatim: they quote the official terms, they are not UI strings. | agent |
| 13 | **Inline sync view**: the grey page fill and the sheet-on-sheet go; a level-2 `Card` (`max-w-lg`, scoped to its service, decision 6) is centred on the content sheet with the service banner on top (official layer as in decision 5, `data-testid="inline-sync-banner"`) and the shared panel below. The banner is `bg-group-title text-inverse` on a gradient group; on a light group it is `bg-card text-group-title` (the card's own surface, not `bg-sheet`) with the 4 px `bg-group-title-bar` under it, and its subtitle is `text-secondary` (decision 5's light-banner rule). | agent |
| 14 | **`LoginPage` is deleted** with its test and snapshot, and the three i18n keys only it used (`login.browserPrompt`, `login.launchBrowserLogin`, `login.waitingForBrowser`). Restyling a page nothing renders adds no value; `LoginModal` is the only login UI. | agent |
| 15 | **Window base token** `color.surface.window` = `#F0F2F5` (`bg-window`), today's value verbatim (it matches pywebview's `background_color` and the `body` colour in `index.css`, which stays a literal because it paints before the tokens load). Used by the App root and the boot screen; the boot spinner becomes `text-muted`. | agent |
| 16 | **The App error toast is restyled in D2d** (it was on the E list; `App.tsx` is in D2d's scope and D2d is the last D2 part): a floating level-2 status card (`rounded-card bg-card p-4 shadow-card`, `animate-reveal`), `AlertCircle text-status-danger`, title `common.error` (`text-small font-semibold`), message `text-caption text-secondary`, a ghost Debug Button (`common.debug`, new), `role="alert"`, still on `Z_INDEX.TOAST` with `data-testid="settings-error-toast"`. A ghost `IconButton` named `common.close` dismisses it. `useSettings` stores the i18n key `settings.saveFailed` (`settingsErrorKey`, instead of the English literal "Failed to save settings") and `App` translates it at display time, so the toast follows a language change; every save clears the key first, so a later successful save removes the toast. A card, not `bg-toast`: it carries an action and a sentence to read. | agent |
| 17 | **Buttons**: one primary each — ToS "Accept and Continue", Setup "Start Using SakaDesk", Login "Connect Account" / "Login", Landing "Get Started" (all `w-full` where they are today, else `flex-1` / `px-8`). Sync's Done and Cancel stay `secondary` (no primary in a progress dialog). Login's Cancel / Maybe later is `secondary`; Setup's Browse is `secondary`. | agent |
| 18 | **Setup form**: the folder field is the `Input` primitive tied to its label (`htmlFor` / `useId`); the blog option is a `bg-sunken` card with an `accent-group` checkbox; the ToS checkbox is `accent-group` too (D2c decision 12). | agent |
| 19 | **Sequential sync counter** moves from the pastel header into the sync body: bars `h-1 rounded-pill`, done and current `bg-group-accent` (current `w-10`, others `w-6`), pending `bg-control-off`; label `text-caption font-semibold text-secondary` ("日向坂46 (1/3)", the format today). | agent |
| 20 | **Incoming-call layering (E list).** A call that starts ringing while a dialog is open is **lifted**: portaled to `document.body`, `fixed` over the chat area's measured rectangle (`useAnchorRect`, an in-place anchor; `rounded-b-sheet` to match the sheet's corners), with a z-index **interleaved by opening order**: `dialogStack.interleavedZIndex(order)` = `Z_INDEX.DIALOG + (open dialogs opened before the call) × DIALOG_STEP − DIALOG_STEP / 2`, so it sits above the dialogs that were open when it rang and below any dialog opened during the call (the order is taken with `nextDialogOrder()` when the call first shows). It is always below `POPOVER`. A call that starts with no dialog open renders in the frame exactly as today (no pixel change); the mode is fixed for the call's life so the audio never remounts, and it is forgotten when the call goes away, so the same message ringing again (after leaving the chat) decides afresh. Not a fixed `Z_INDEX` constant: a fixed layer above all dialogs would hide a confirm or a search opened during a call. | agent |
| 21 | **Keys inside a lifted call.** The dialog layer leaves Escape and Tab whose target is inside a dialog that is not on the layer (the call overlay) to it: `useDialog` returns early for such keys. Clicking into a lifted call and pressing Escape declines it instead of closing the dialog below. The call's focus rule is unchanged (it never takes focus from a dialog or a text field), so with focus still in the dialog Escape closes the dialog first, as today. Because the dialog layer does not track the call, a lifted call that goes away with focus inside it hands focus back to the top-most dialog itself; it leaves focus alone when focus is already in a dialog. Breadcrumb `call_layer` (`phase` `lifted` / `in_frame`, `count` = dialogs open at ring start; new whitelisted event) and, when a lifted call goes away, `phase` `focus` with `outcome` `restored` / `kept` / `dropped` (no dialog left to take focus). | agent |
| 22 | **Login breadcrumbs** (every decision path): `dialog_load` surface `login` (`ok`; `error` reason `failed`; `cancelled` when the geo warning is closed; `skipped` when the dialog moved to another service before the login, or its Yodel geo check, finished: then it neither advances nor logs `ok`) and `login_geo` (Yodel only: `ok`; `skipped` reason `blocked` when the warning shows; `error` reason `failed` for a non-OK answer or `unreachable` when the check throws — login then proceeds, as today). New `DialogLoadSurface` values `login`, `login_geo` and `DialogLoadReason` `blocked`; no backend change (values are code strings). **One login at a time** (single-session token): the first click takes an in-flight lock before the Yodel geo check, so a second click during the check cannot start a second login; the lock is released when the geo warning shows, when a stale geo result is skipped, or after the login settles, and it holds until the awaited `onSuccess` has settled. | agent |
| 23 | **Locks first.** Entry-flow behaviour is locked on the unchanged code by vitest (ToS, setup, login flow with success / failure / geo warning, sync modal, inline sync view, landing) and by Playwright on mocked APIs (first launch end to end, login failure, Yodel geo warning, add and remove a service, inline sync of a newly added service). The e2e fixture answers **every** `/api/auth/**` request itself and aborts any it does not know, so no test can reach the real login (single-session tokens). `e2e/save-auth.spec.ts` (a manual real-login script) is never run. | agent |
| 24 | **Zero-pixel**: `visual-zero-pixel.spec.ts` (the Messages main screens) must pass **unchanged**, with no new masks and no re-capture: nothing D2d changes is on those screens (`bg-window` is the same value; the in-frame call is unchanged). | agent |
| 25 | **Add service lock (E list)**: the existing add-service test in `dialogs-app.spec.ts` also adds a group (its fresh login prompt → Maybe Later), checks the rail has two groups, removes one through the rail's right-click menu, and removing the last group shows the landing page. | agent |

## Per-screen target

All dialogs: `Modal` with their D2c `logId` (`tos`, `setup`, `sync`, `login`), translated labels, no fixed ids.

| Screen | Frame | Target |
|---|---|---|
| ToS | `Modal` standard, `max-w-lg`, `dismissible={false}`, `title` `tos.title`, body `flex flex-col gap-4` | decisions 4, 11, 12; subtitle `text-small text-muted`; disclaimer `flex gap-3 rounded-card bg-sunken p-4` (`AlertTriangle h-5 w-5 text-status-warning`, heading `text-body font-semibold text-primary`, text `text-small text-secondary`); excerpts `details` `rounded-card bg-sunken p-4`, summary `cursor-pointer select-none text-small font-semibold text-secondary`, articles `mt-3 flex flex-col gap-3 text-caption text-secondary`, article titles `font-semibold`; links block `flex flex-col gap-3 rounded-card bg-sunken p-4` with its intro `text-small text-secondary` and a `ul` `flex flex-wrap gap-x-4 gap-y-2`; acknowledgement `label` `flex cursor-pointer items-start gap-3 rounded-card p-3 hover:bg-sunken` (checkbox `mt-1 h-4 w-4 shrink-0 accent-group`, text `text-body text-primary`); footer primary `w-full` |
| Setup | `Modal` standard, `max-w-md`, `dismissible={false}`, `title` `setup.welcome`, body `flex flex-col gap-4` | decisions 4, 17, 18; subtitle `text-small text-muted`; label `text-small font-semibold text-secondary`; `Input` + secondary Browse in `flex gap-2`; hint `text-caption text-muted`; option card `flex cursor-pointer items-start gap-3 rounded-card bg-sunken p-4` (title `text-small font-semibold text-primary`, hint `text-caption text-secondary`); footer primary `w-full` |
| Sync | `Modal` standard, `max-w-lg`, `dismissible={false}`, `title` the phase (`sync.complete` / `sync.phase`), body `flex flex-col gap-5`, scoped to the syncing service during a sequential sync | decisions 4, 6, 9–11, 17, 19; first the counter (sequential, more than one service), then the subtitle (`text-small text-secondary`: count + unit, `sync.pleaseWait` or `sync.syncComplete`), the verify result (`text-small text-secondary`; unresolved panel `rounded-card bg-sunken`, header `flex items-center gap-2 px-4 py-3 text-small font-semibold text-primary` with `AlertTriangle text-status-warning`, list `flex max-h-44 flex-col gap-1 overflow-y-auto px-2 pb-2`, rows `flex items-center gap-2 rounded-pill px-2 py-1 text-small`, icon `h-4 w-4 text-secondary`, name `truncate text-primary`, time `tabular-nums text-secondary`), then `SyncProgressPanel`; footer Done (complete / error, with `onClose`) or Cancel (running, with `onCancel`), both `secondary` |
| Login | `Modal` bare, `max-w-md`, `labelledBy` from `useId`, wrapper scoped to the service | decisions 5–7, 17, 22; banner `flex items-center gap-3 px-6 py-4` (+ title bar on light), title `text-title font-semibold`, service `text-small` (`text-secondary` on the light banner); content `flex flex-col gap-4 p-6`: description `text-body text-secondary`, error `role="alert"` `flex items-center gap-2 text-small text-status-danger`, buttons `flex gap-3` (secondary + primary, both `flex-1`; the primary shows `Loader2` + `login.connecting` while loading), note `text-center text-caption text-muted`; the geo warning stays the `ConfirmDialog` (`warning`) |
| Inline sync | `div` `flex flex-1 items-center justify-center p-6` on the content sheet | decision 13; `Card` `flex w-full max-w-lg flex-col overflow-hidden` scoped to the service; banner as Login's but `bg-card` on light (icon `Download`, title `h3` the phase, subtitle the count, `text-secondary` on light); body `p-6` with `SyncProgressPanel` |
| Landing | `Canvas` `flex min-h-screen items-center justify-center p-4` | decision 8; `Sheet` `flex w-full max-w-4xl flex-col gap-8 p-10`; header `flex flex-col gap-2 text-center` (`h1` `text-heading font-semibold text-primary`, subtitle `text-body text-secondary`); grid `grid grid-cols-1 gap-4 md:grid-cols-3`; card contents `flex flex-col items-start gap-3`: logo disc `flex h-16 w-16 items-center justify-center overflow-hidden rounded-pill bg-card shadow-pill` (logo `h-12 w-12`, fallback short code `text-title font-semibold text-secondary`), name `text-title font-semibold text-primary`, romaji `text-small text-secondary`, feature chips as Add service's (`rounded-pill bg-sunken px-2 py-1 text-caption text-secondary`, `group-hover:bg-card`); logo `alt=""`; actions `flex flex-col items-center gap-4`: primary `px-8`, footer note `text-small text-muted` |
| Boot | `div` `flex h-screen items-center justify-center bg-window` | decision 15; `Loader2 h-6 w-6 animate-spin text-muted motion-reduce:animate-none` |
| App root | `flex h-screen flex-col overflow-hidden bg-window font-sans` | decision 15 |
| Error toast | `fixed bottom-4 right-4`, `Z_INDEX.TOAST` | decision 16; `flex max-w-sm items-center gap-3 rounded-card bg-card p-4 shadow-card animate-reveal motion-reduce:animate-none`; ghost Debug `Button` and a ghost close `IconButton` |
| Call overlay | in frame as today, or lifted | decisions 20, 21; lifted: `sd-call-overlay fixed overflow-hidden rounded-b-sheet outline-none`, inline `left/top/width/height` from the anchor and the interleaved `zIndex`, `data-layer="lifted"`; the anchor `pointer-events-none absolute inset-0` (`aria-hidden`) |

## Tokens added

| Token | Value | Utility | Use |
|---|---|---|---|
| `color.surface.window` | `#F0F2F5` (today's value) | `bg-window` | the window base behind the app (root, boot screen) |
| `backgroundColor['status-success']` | `var(--ds-status-success)` (`#15803D`, existing token) | `bg-status-success` | a finished sync phase |
| `groupScopeStyle(groupId)` | `groupTokenVars(groupId)` inline | every `*-group-*` utility inside | decision 6 |
| `interleavedZIndex(order)` (`design/dialog/dialogStack.ts`) | `Z_INDEX.DIALOG + below × DIALOG_STEP − DIALOG_STEP / 2` | inline `zIndex` | the lifted call (decision 20) |

`DESIGN_SYSTEM.md` gains: `bg-window`; `bg-status-success`; "progress fill" in the `bg-group-accent` roles; a **Group scope** paragraph (decision 6); in **Layering**, the lifted call between dialogs by opening order and the key rule (decisions 20, 21); "neutral before a group is chosen" (decision 3).

## Accessibility

- ToS, setup and sync are named by their visible `h2`; login by its banner title (`useId`); no fixed ids remain.
- Login's close button is named (`common.close`); the setup field is tied to its label; landing cards are toggle buttons (`aria-pressed`) with decorative logos (`alt=""`); the sync bar is a `progressbar` named `sync.progress` with `aria-valuenow` in percent; the active phase step has `aria-current="step"`, and every step has an `sr-only` state cue (current, done, pending), so the state never rests on colour alone.
- Login and toast errors are `role="alert"`; danger text is never on `bg-sunken` (4.8:1 on white only).
- No white text on a logo colour (decision 7). Every animation has a `motion-reduce:` off switch.

## i18n

New keys in all 5 locales (`en`, `ja`, `zh-CN`, `zh-TW`, `yue`): `common.debug` ("Debug" / "デバッグ" / "调试" / "偵錯" / "除錯"), `sync.progress` ("Sync progress" / "同期の進行状況" / "同步进度" / "同步進度" / "同步進度"), and the step cues `sync.stepDone` ("Done" / "完了" / "已完成" / "已完成" / "已完成"), `sync.stepCurrent` ("Current step" / "現在のステップ" / "当前步骤" / "目前步驟" / "目前步驟") and `sync.stepPending` ("Pending" / "未完了" / "待处理" / "待處理" / "待處理"). `i18n/d2d.test.ts` checks all five. Removed (decision 14): `login.browserPrompt`, `login.launchBrowserLogin`, `login.waitingForBrowser`. Hard-coded strings that go: the toast's "Error" and "Debug", `useSettings`' "Failed to save settings". The quoted Japanese ToS articles stay (decision 12).

## Breadcrumbs

| Event | Fields | Sent by |
|---|---|---|
| `dialog_load` (existing) | surface `login` (`ok`, `error` + `failed`, `cancelled`, `skipped`), `login_geo` (`ok`, `skipped` + `blocked`, `error` + `failed` / `unreachable`) | `LoginModal` (decision 22) |
| `call_layer` (new, whitelisted in `backend/api/client_log.py` and `utils/clientLog.ts`) | `phase` (`lifted` / `in_frame`), `count`; or `phase` `focus` + `outcome` (`restored` / `kept` / `dropped`) | `CallOverlay`, once per call when it first shows, and once when a lifted call goes away (decision 21) |
| `sync_start_skipped` (new, whitelisted in both) | `reason` (`polling` / `starting`) | `useSync.startSync`, when a start for a service that is already polling or starting is skipped (Verification notes) |

The existing `dialog` open / close breadcrumbs of the four entry dialogs stay. Never names, ids, paths or text.

## Testing

### Behaviour locks (before any restyle, must pass on the unchanged code)

Locks use roles, headings, labels and visible text that exist both before and after D2d. Two stricter assertions cannot pass on the old code and are added in the task that makes them true: the ToS footer button is in the viewport of a short window (Task 5), and the lifted call layering (Task 7).

- **vitest** `frontend/src/shell/components/entryFlow.test.tsx` (real `en` i18n, msw for the network):
  1. ToS: Accept is disabled until the checkbox is ticked; Accept stores `tos_accepted_at` and calls `onAccept`; the four official ToS links keep their URLs.
  2. Setup: typing calls `setOutputDirInput`; Browse calls `onSelectFolder`; the blog option calls `setSetupBlogFullBackup(true)`; Start is disabled when invalid and calls `onComplete` when valid.
  3. Login: the three titles and their button labels (fresh, disconnected, required); success POSTs `/api/auth/login?service=…` then `/api/settings/service/…/init` and calls `onSuccess`; a 500 shows `login.loginFailed`, never calls `onSuccess` and re-enables both buttons; Cancel / Maybe Later call `onClose` without a POST; Yodel with `blocked: true` shows the Japan-only warning, Close there makes no login POST, Log in anyway POSTs; a failing geo check lets the login proceed.
  4. Sync modal: a sequential sync shows "日向坂46 (2/3)"; a running phase 3 shows the do-not-close line and Cancel (→ `onCancel`) but no Done; a completed verify shows the summary, the unresolved count and each item's member, and Done calls `onClose`.
  5. Inline sync view: phase title, `5 / 20`, `25%`, the detail line, for Hinatazaka (gradient) and Sakurazaka (light).
  6. Landing: no selection → "Select at least one group" disabled; one → "Get Started"; two → "Get Started with 2 groups"; a second click deselects; Get Started calls `onComplete` with the services in click order.
- **e2e** `frontend/e2e/entry-flow.spec.ts` on the new fixture `frontend/e2e/fixtures/entry.ts` (all of `/api/auth/**`, settings, sync, profile and app-state answered by the test):
  1. First launch: ToS (Accept disabled → tick → Accept) → landing → pick 日向坂46 → Get Started → "Connect Your Account?" → Connect Account (mocked login) → setup → type a folder → Start Using SakaDesk (POST `/api/settings`) → the sync dialog shows the pinned progress (`5 / 20`) → progress completes → "Complete" → the dialog closes and the rail shows.
  2. Login failure: the login answers 500 → "Login failed or cancelled" → Maybe Later moves on.
  3. Yodel: pick Yodel → Connect Account → the Japan-only warning → Log in anyway → the login POST happens.
  4. Inline sync: from the home screen add 櫻坂46 → Connect Account → the inline sync view shows the pinned progress while its first sync runs, each group's sync starts exactly once (`['hinatazaka46', 'sakurazaka46']`), and the view goes away when it completes.
- **e2e** `dialogs-app.spec.ts`: the add-service test gains adding and removing (decision 25).

### New unit tests

`groupScopeStyle` (sets the group's variables, two groups differ); `App` applies the `default` tokens with no service and the group's once one is active; `SyncProgressPanel` (progressbar value, detail only while running, phase step states); `interleavedZIndex` (above earlier dialogs, below later ones, recomputed on pop); `useAnchorRect` (measures, follows resize, tolerates no `ResizeObserver`); `CallOverlay` lifted vs in-frame, `call_layer` breadcrumb, audio not remounted; `useDialog` leaves Escape / Tab from an off-layer dialog alone; `incomingCall.integration` (a call ringing over an open `Modal` sits above it; a confirm opened during the call sits above the call); `LoginModal` breadcrumbs; the toast (`role="alert"`, translated title and Debug); `i18n/d2d.test.ts` (new keys in every locale, removed keys gone); `d2dTokens.test.ts` (`--ds-surface-window`, the two utilities); backend `test_client_log_api.py` accepts `call_layer`; `core/dialogs.style.test.ts` FILES gain every D2d file.

### Screenshots

`frontend/e2e/entry-screens.spec.ts` captures (no comparison) with the entry fixture, `reducedMotion: 'reduce'`, `animations: 'disabled'` and a fixed clock: ToS (1280×800 and a short 1280×480 window), landing (empty, two picked), login (Hinatazaka gradient, Sakurazaka light, an error, the Yodel warning), setup, sync (sequential running with two services, the media phase, complete), the inline sync view (Hinatazaka, Sakurazaka) and the error toast over Settings. `SHOT_LABEL=before` on the unchanged code (Task 2), `SHOT_LABEL=after` at the end; files go to the git-ignored `frontend/e2e-shots/<label>/`.

### Zero-pixel and guard

- `e2e/visual-zero-pixel.spec.ts` passes unchanged (decision 24): never update its snapshots in D2d.
- The guard only goes down: `TosDialog.tsx`, `SetupWizard.tsx`, `SyncModal.tsx`, `LoginModal.tsx`, `InlineSyncView.tsx`, `LandingPage.tsx` and `App.tsx` reach 0 and leave `guard-baseline.json`; `LoginPage.tsx` is deleted. New files start at 0.

### Verification

Frontend unit tests, `tsc`, lint, `npm run build`, every e2e spec except `save-auth.spec.ts` (the new locks, `dialogs-app.spec.ts`, `dialogs-chat.spec.ts`, `blogs.spec.ts`, `timeline-scroll.spec.ts`, `chat-frame.spec.ts`), the zero-pixel spec, backend `pytest` for the client-log whitelist, `ruff`, `mypy`. No Windows build in D2d (the controller builds once for D2a–D2d).

## Verification notes

What the implementation had to decide beyond the sections above:

- **Entry fixture.** `frontend/e2e/fixtures/entry.ts` (`pinEntry`) answers every `/api/auth/**` request, settings, sync, profile and app-state route itself and aborts any auth path it does not know. The first-launch sequential sync runs in the app's service order (櫻坂46 before 日向坂46), not click order, so `entry-screens.spec.ts` drives the media and complete progress on 櫻坂46 first.
- **Login dialog reused across services.** The login carousel reuses one `LoginModal`; a new `serviceId` clears the error and the geo warning (never a failed login's error on the next service), but keeps the in-flight state, so a login still running blocks the next service's (single-session token). A login or geo result that finishes for an earlier service is `skipped` (decision 22).
- **Login lock across the geo check.** The lock is a ref taken synchronously on the first click, before the Yodel geo check, and `onSuccess` is typed `() => void | Promise<void>` and awaited, so the lock holds until App's `checkAuth()` has advanced (decision 22).
- **Stat tile units.** The speed's unit wrapped under its number in a narrow tile, so every tile has a unit line (decision 9); the phase steps gained `sr-only` state cues (decision 10).
- **Sync dialog colour on Complete.** A sequential sync clears its info when it ends; the dialog keeps the last scoped service until it closes (decision 6).
- **Duplicate sync start (pre-existing).** `useSync.startSync` skipped only a service that was already polling, not one whose `/api/sync/start` POST was still in flight, so two overlapping starts both hit the official API. It now skips either case, still raises the modal for a blocking caller (the live poller reads `blockingRef` at completion and closes it), and logs `sync_start_skipped` (`reason` `polling` / `starting`). The inline-sync e2e locks one start per group.
- **Settings error toast.** The hook stores an i18n key and clears it on every save; the toast has a close button (decision 16).
- **Call layer.** The layer is decided during render from `openDialogCount()`: a dialog that opens in the same commit as the call has not pushed yet, so it counts as opened after the call and covers it. The layer resets when the call goes away, and a lifted call hands focus back to the top dialog (decisions 20, 21).
- **Backup status poll.** Settings' 5 s blog-backup status poll now clears its timer when the dialog closes; before, one more status request went out after close.
- **Test-only.** `applyTokens.test.ts` counts one more static variable (`--ds-surface-window`). `App.neutralTokens.test.tsx` stubs `Layout` so the App mount does not fetch after teardown. Under heavy parallel load (several vitest runs at once), first renders exceeded the 5 s test and 1 s `findBy` limits, so `vitest.config.ts` sets `testTimeout: 15000` and the test setup sets `asyncUtilTimeout: 3000`.
- **Not done in D2d (E list).** A lifted call stays lifted after the dialog below closes; a lifted call never takes focus; an `/init` failure after a successful login shows as a failed login; the sync speed unit is the backend's untranslated code.

## Implementation order

1. Locks I: vitest entry-flow locks.
2. Locks II: e2e entry fixture and flows, the add / remove service lock, before shots.
3. Foundation: tokens, `groupScopeStyle`, neutral tokens before a group, i18n keys, breadcrumb types.
4. Sync: `SyncProgressPanel`, `SyncModal`, `InlineSyncView`.
5. ToS, setup and login (with breadcrumbs); `LoginPage` removed.
6. Landing; App boot, root and error toast.
7. Incoming-call layering.
8. Final checks, after shots, `CHANGELOG.md`, E list, `DESIGN_SYSTEM.md`, spec zero drift.

## Out of scope

- The incoming-call screen itself (B's glass design) and the popup call window: only the overlay's layering changes.
- Player internals, `TranslateButton`, `UpgradeIcon` and the other E items outside "D2d notes".
- New entry-flow features (skipping ToS, choosing a folder on the landing page, …), dark mode.
