# Design language v2 re-apply, part R-d (entry flows and brand moments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the v2 screen re-apply: put the first-launch flow (boot, ToS, landing, login carousel backdrop, setup, first sync, inline sync) on brand context with the L2 aurora atmosphere and group markers, restore the pre-D2 (`e4e4118`) colours through tokens (ToS amber disclaimer as semantic warning, per-group ToS links and landing cards, sync bar, sync warnings), wire the brand moments (empty states, About hero with "your archive" stats from a new backend endpoint, the first-sync toast, the milestone cards), and fold in four small cleanups (VoicePlayer neutrals, the Yodel geo-warning's scope, the search filter's "members" string, the Diagnostics footer). Before/after evidence against `e4e4118`.

**Architecture:** One new token role (`progress`, the sync bar fill: aurora in brand, the official title gradient or bar in a group) and one new utility (`ring-accent-logo`), the existing `useGroupMarker` hook reused with three new targets, `ScopeContext` widened to carry a group scope through a portal, `EmptyState` adopted by `DialogStatus` / `BlogStatus`, a small read-only backend endpoint (`GET /api/archive/stats`, cached per file on the stat key like `messages_cache`), two pure decision modules (`shell/firstSyncCelebration.ts`, `features/messages/milestones.ts`) with thin React wrappers, and three new breadcrumb events. Every task is guarded by unit tests, the guard ratchet (`guard-baseline.json` only goes down) and, for the backend, pytest.

**Tech Stack:** React 18 + TypeScript, Tailwind 3 (utilities read `var(--ds-*)`), Vitest + Testing Library + msw, Playwright (headless capture), FastAPI + structlog (backend), pytest.

Spec (governs): `docs/superpowers/specs/2026-11-05-design-language-v2-design.md`: §3.3 (large surfaces stay white), §3.4 (semantic colours; "semantic over context": 推 = oshi pink, bookmark star yellow, warning / danger / success fixed), §4 (context table: boot, ToS, setup wizard, landing, sync progress and first sync are brand; rows / group cards are markers), §5 (L2 atmosphere on landing, empty states, about, first launch; restore inventory "Landing per-group cards, ToS gradient button"), §6 (serif display for landing hero, empty-state titles, about, celebration numbers; `tabular-nums`), §8 (states: disabled keeps its colour and shows a reason; forms validate on click), §9 (first launch = boot → ToS → choose groups → first sync on aurora + orbs with serif headings, dark ToS header text, the amber disclaimer in warning colours, per-group ToS links as group markers, group cards as markers; empty-state pattern; About = aurora hero + serif wordmark + "your archive" stats; celebrations B and C), §12 (accepted deviations). Current system: `docs/design/DESIGN_SYSTEM.md`. D2d structure (kept unless a decision below says otherwise): `docs/superpowers/specs/2026-11-05-d2d-entry-design.md`. Model plans: `docs/superpowers/plans/2026-11-05-v2-reapply-a-frame-chat.md`, `2026-11-06-v2-reapply-b-blogs.md`, `2026-11-06-v2-reapply-c-dialogs.md`.

Colour mapping used throughout (from `e4e4118` `config/serviceThemes.ts` `buildTheme` + `design/tokens/roles.ts`, as in R-c): `theme.modals.accentColor` = step 600 → `accent`; `accentColorLight` = step 50 → `accent-subtle`; `accentColorMuted` = step 200 → `accent-border`; `primaryColor` = `r.logo` → `accent-logo`. Text that was step 600 becomes `text-accent-strong` (step 700, spec §8). The pre-D2 pastel `from-[#b4dcff] to-[#f0bede]` of the entry dialogs is the ancestor of the brand aurora (spec §3.1) → `bg-expressive-header` / `bg-aurora` in brand context. Off-logo blues in brand screens (`blue-400/500/600`, `ring-blue-100`, `bg-blue-50`) map to the ink through the same roles (spec §3.4: info uses ink). Ambers map to `*-semantic-warning*` (spec §3.4, §9). Grays map to the ink neutrals: `gray-800` → `text-primary`, `gray-600` / `gray-500` / `gray-700` → `text-secondary`, `gray-400` / `gray-300` → `text-muted`, `gray-50` → `bg-elevated`, `gray-100` → `bg-sunken`, `white` → `bg-sheet` / `text-inverse`.

---

## Decisions needed from the user

> **Resolved (user, 2026-11-06): every decision D1–D13 takes its recommendation.** D13 (VoicePlayer opaque `bg-sheet` + card shadow) is provisional: the user will judge it on the acceptance build, so the after shots must include the voice player. Steps marked "pending decision" are final as written.

The user's rule: any change to the original design (`e4e4118` / `0725cc3`) that the spec has not decided, any off-logo colour without a semantic meaning, any colour whose meaning is unclear and any contrast problem not already accepted is asked first. The tasks assume the **recommendation**; steps that depend on one are marked `(pending decision D<n>)`. If the user picks another option, only those steps change. Every `e4e4118` value below was read with `git show e4e4118:<path>`.

**D1 — Header icons of the entry dialogs (ToS, setup, sync).** `TosDialog.tsx`, `SetupWizard.tsx`, `SyncModal.tsx`.
- `e4e4118`: ToS `<FileText className="w-8 h-8 text-white" />` beside a `text-xl font-bold text-white` title with the subtitle `text-sm text-white/80` inside the `bg-gradient-to-r from-[#b4dcff] to-[#f0bede]` header; setup the same with `<FolderOpen className="w-8 h-8 text-white" />`; sync `<div className="w-10 h-10 rounded-full bg-white/20 …"><Download className="w-5 h-5 text-white" /></div>`.
- Now: D2d dropped the icons; the subtitles are the first body line.
- Already decided by the spec: the header becomes the brand aurora with **dark** text (§9: "fixes the original white-on-pastel 1.5:1").
- Options: (a) restore the three icons through `Modal icon` (20 px, header text colour, i.e. dark on the aurora; the sync icon without its disc), subtitles stay in the body; (b) no icons.
- **Recommendation: (a).** Same treatment the user accepted for every other dialog in R-c (D2 (a)).

**D2 — The ToS disclaimer box.** `TosDialog.tsx`.
- `e4e4118`: `bg-amber-50 border border-amber-200 rounded-xl p-4`, heading `font-semibold text-amber-800`, text `text-sm text-amber-700`, **no icon**.
- Now: `bg-sunken` box with an `AlertTriangle text-status-warning` icon (added in D2d), neutral text.
- Already decided by the spec: the amber returns in the warning colours (§9), i.e. `bg-semantic-warning-subtle`, `border-semantic-warning`, `text-semantic-warning` (`#824c13`, 7.6:1 on the subtle fill; there is one text step, so the `amber-800` heading and `amber-700` text both become it).
- Options: (a) warning box as above and keep D2d's triangle in the warning text colour; (b) exactly `e4e4118`: warning box, no icon.
- **Recommendation: (a).** The icon carries the meaning without relying on colour alone (WCAG 1.4.1) and is in the same colour, so the box still reads as the original amber note.

**D3 — The four official-terms links in ToS.** `TosDialog.tsx`.
- `e4e4118`: `text-xs text-purple-600 hover:text-purple-800 hover:underline` (Nogizaka), `text-pink-600` (Sakurazaka), `text-blue-600` (Hinatazaka), `text-indigo-600` (Yodel), separated by `<span className="text-gray-300">|</span>`, on a `bg-gray-50` box.
- Now: all four `text-group-strong underline decoration-group` on `bg-sunken`, i.e. the retired grey `default` group, permanently underlined.
- Already decided by the spec: each link returns in its group's colour as a group marker (§9). The link role is `accent-strong` (step 700, §3.5).
- Contrast found while planning: Hinatazaka 700 `#0d7aab` is 4.35:1 on `bg-sunken` (below 4.5 for small text) but 4.6:1 on `bg-elevated` (`#fafafa`, the token closest to `e4e4118`'s `gray-50`). So the box goes back to `e4e4118`'s near-white (`bg-elevated`), which also restores the original.
- Options: (a) each link in its own group's `text-accent-strong`, underline on hover only (as `e4e4118`), the `|` separators dropped (the existing `gap-x-4` separates them), box `bg-elevated`; (b) as (a) but always underlined (D2d); (c) as (a) with the separators restored in `text-muted`.
- **Recommendation: (a).** Closest to `e4e4118` without a decorative glyph; Yodel becomes its periwinkle 700 `#4c4bbb` (the old indigo-600 was close).

**D4 — Landing: the selected group card.** `pages/LandingPage.tsx`.
- `e4e4118`: white `rounded-2xl shadow-lg` card; selected = `ring-2` in the group's **logo** colour (`--tw-ring-color: getServicePrimaryColor(id)`, which is `r.logo`) + `shadow-xl`; the check disc filled with the logo colour and a white check; the logo circle `ring-[3px] ring-offset-2` in the logo colour; hover `scale-[1.02]`; page background `bg-gradient-to-br from-gray-50 to-gray-100`.
- Now (D2d): selected = `bg-group-subtle border-group-subtle` tint, check disc `bg-group-accent`, in the grey `default` group for every card.
- Already decided by the spec: cards are group markers (§4, §9), L2 orbs behind (§5), hover = lift + glow (§8), serif display heading (§6).
- Contrast: a white check on the logo colour is 1.9:1 (Hinatazaka `#7cc7e8`) and 2.1:1 (Sakurazaka `#f19db5`), below the 3:1 for a meaningful icon; on step 600 it is 3.0:1 (Hinatazaka, the §12 accepted value), 4.6:1 (Sakurazaka, Nogizaka), 4.9:1 (Yodel).
- Options: (a) white card, the `e4e4118` rings in the group's logo colour (`ring-accent-logo`, card ring and logo-circle ring), the check disc in step 600 (`bg-accent`) so the check reads, glow on hover and when selected; (b) exactly `e4e4118` (check disc in the logo colour, 1.9–2.1:1); (c) keep D2d's tint fill, now in each group's colours.
- **Recommendation: (a).**

**D5 — The sync dialog: context, step row and progress bar.** `SyncModal.tsx`, `core/common/SyncProgressPanel.tsx`, `core/layout/InlineSyncView.tsx`, `shell/hooks/useSync.ts`.
- `e4e4118` `SyncModal`: brand pastel header (white text); sequential step bars `bg-white` / `bg-white/30` in the header; progress track `h-4 bg-gray-100 rounded-full shadow-inner` with a `from-[#b4dcff] to-[#f0bede]` fill (plus a white sheen); active phase dot `bg-blue-500 ring-4 ring-blue-100`, label `text-blue-600`; detail row `bg-blue-50` with a `text-blue-500` spinner; media warning `bg-amber-50 border border-amber-100` with `text-amber-700`; unresolved list `border-amber-100`, heading `bg-amber-50 text-amber-700`, icons `text-amber-500`; stat tiles `bg-gray-50`. `e4e4118` `InlineSyncView` (a group's own first sync in the content area): official banner; fill = the title gradient (`headerBarGradient` on a light header); dot `accentColor` with a `0 0 0 4px accentColorLight` ring; detail row `accentColorLight`.
- Now (D2d): the whole sync dialog body is scoped to the syncing service (`groupScopeStyle`), bar `bg-group-accent` on an 8 px track, step dots `bg-group-accent shadow-group-glow`, detail `bg-group-subtle`, warnings neutral (`bg-sunken`) with only an amber spinner.
- Already decided by the spec: sync progress and first sync are **brand**, with rows as group markers (§4); warnings are semantic (§3.4); the warning colours, ink for the blues and the accent roles for `InlineSyncView` follow mechanically.
- Contrast: the aurora / pastel fill on the grey track is about 1.0–1.2:1 (it was the same at `e4e4118`); the `n / total` and `%` text above the bar carry the value.
- Options: (a) brand dialog (aurora header, ink dot / detail / spinner, the bar fill `bg-expressive-progress` = aurora on `e4e4118`'s 16 px track); the sequential step row as group markers (each bar in its own service's accent, the current service named by a marker chip: dot + name); `InlineSyncView` stays in its group (bar = that group's title gradient, as `e4e4118`); the media warning and unresolved list in the warning colours (the unresolved heading keeps D2d's triangle, as in D2); record the bar contrast in §12; (b) keep D2d (whole body in the syncing service's colours, 8 px accent bar); (c) (a) but the brand bar a solid ink `bg-accent` (4.6:1 on white, no aurora).
- **Recommendation: (a).**

**D6 — Empty states: icon colour, and the chat's "select a conversation" screen.** `design/primitives/EmptyState.tsx`, `core/common/DialogStatus.tsx`, `features/blogs/components/BlogStatus.tsx`, `features/messages/MessagesFeature.tsx`.
- `e4e4118`: dialogs (`core/common/ModalStates.tsx` `ModalEmptyState`) a `bg-gray-100` circle with a `text-gray-300` icon and plain text; the blog feed (`RecentPostsFeed` `.feed-state__icon`) a faint group-tinted tile with icon `color: #c4c4c4`; member select / timeline a faint tinted tile with `text-gray-300`; search a bare `text-gray-300` icon; the chat placeholder two `text-gray-400` lines (no icon).
- Now: `EmptyState` (foundation) draws the icon `text-accent-strong`; `DialogStatus` and `BlogStatus` do not use `EmptyState` and also draw `text-accent-strong` on a `rounded-card` tile.
- Already decided by the spec (§9): every empty state is the fixed pattern — aurora / group-soft **circle**, line icon, **serif** title, one sentence, one action. The icon colour is not specified.
- Options: (a) icon in `text-muted` (`#9ca3af`, the ink-neutral token nearest to `e4e4118`'s grey) on the soft circle; the Favorite-filter heart in the blog feed stays oshi pink (it has a fixed meaning, R-b); the chat placeholder becomes the same pattern (soft circle, message icon, serif title); (b) keep `text-accent-strong` (foundation); (c) (a) but leave the chat placeholder as two grey lines.
- **Recommendation: (a).** The circle carries the colour (aurora or group); a grey glyph is the original look and keeps the pattern calm (L2 is "atmosphere", not a second accent).

**D7 — Boot screen.** `shell/App.tsx`.
- `e4e4118`: `bg-[#F0F2F5]` with `<Loader2 className="animate-spin text-blue-500" />` (24 px).
- Now: `bg-window` with a `text-muted` spinner.
- The spec lists "boot" in the first-launch moment (aurora + orbs), but the boot screen also shows for a moment on **every** launch, before the app knows whether this is a first launch (prefs are not hydrated yet).
- Options: (a) brand scope, `bg-window`, the spinner in ink `text-accent` (the `e4e4118` look with blue → ink, §3.4); (b) the aurora orbs (`Atmosphere`) behind the ink spinner on every launch.
- **Recommendation: (a).** Orbs that flash for under a second on every start read as a glitch; the orbs start with ToS, which only a first launch sees.

**D8 — About: where the hero goes.** `core/modals/AboutModal.tsx`.
- `e4e4118`: neutral dialog (`text-lg font-bold text-gray-800` title, a 80 px logo, `text-xl font-bold` wordmark).
- Now (R-c D7 (a)): brand `Modal` (aurora header) + serif bold `text-heading` wordmark; "hero band, orbs and stats in R-d".
- Already decided by the spec: aurora hero + serif wordmark (display size, §6) + stats with tabular numerals (§9); About is L2 (§5).
- Options: (a) keep the aurora dialog header and make the top of the body the hero: the brand orbs (`Atmosphere`) drifting behind the logo, the `text-display` wordmark and the version, bleeding to the dialog edges, so header + orbs read as one aurora hero; (b) a bare dialog whose whole top is one tall aurora hero (own close button, title visually hidden); (c) header plus a second aurora band below it.
- **Recommendation: (a).** Keeps every brand dialog's header identical (R-c) and avoids a doubled gradient.

**D9 — What the three "your archive" numbers mean.** New `GET /api/archive/stats`, `AboutModal.tsx`.
- `e4e4118`: no stats. The frontend has no source today; the backend reads every `messages.json` anyway for the sidebar (`messages_cache`).
- Options for **messages / photos**: (a) chat messages the app shows (withdrawn ones hidden, as everywhere) across all groups, and the photos among them (`type == "picture"`); blog posts and blog photos not counted. For **days**: (a) calendar days from the earliest archived message to today, both counted (local dates); (b) days since the user's first sync with SakaDesk (no stored source: upgrading users would start at 0, so it needs a new stored date); (c) the number of distinct days that have messages.
- **Recommendation: (a) for all three.** All come from files the backend already reads (one cached pass), and "your archive spans N days" is a looking-back number, which is what §9's brand moment is for.

**D10 — Milestone cards: chats that already passed a milestone, and where the card sits.** `features/messages/milestones.ts`, `MessagesFeature.tsx`, `MessageList.tsx`.
- `e4e4118`: no celebrations. Spec §9: "A member reaches 1,000 / 5,000 / 10,000 messages → the next time that chat opens, a card in the timeline"; "Subscription day 100, then every full year"; each event once; never blocks; static under reduced motion.
- Open questions: on the first open after this release, a chat with 6,000 messages has "reached" 1,000 and 5,000 long ago; and "in the timeline" has no position.
- Options: (a) the first time a chat is seen, its already-reached milestones are recorded silently (only milestones reached from now on are celebrated); at most one card per open (a messages milestone first, else a days one, the highest new value of that kind); the card sits at the end of the timeline, after the newest message (it scrolls with the list); group chats have none (they are not one member); (b) as (a) but backfill: each chat celebrates the highest milestone it already passed, once, on its first open after the update; (c) as (a) but the card at the top of the timeline.
- **Recommendation: (a).** "Reaches" and "the next time that chat opens" describe an event since the last visit; backfilling would throw confetti in most chats on the first day after the update.

**D11 — First-sync toast: who sees it.** `shell/App.tsx`, `shell/firstSyncCelebration.ts`.
- Spec §9: "First complete sync | brand | B | toast + one aurora shimmer + about 10 sparkles; once ever".
- Options: (a) only the first-launch sequential sync (new users), when every service finished; the toast sits bottom-right for 6 s, ignores the pointer, and says "Your archive is ready" + "{n} messages saved" (the number from D9's endpoint, left out if it is not available); (b) also existing users, once, after their next complete sync.
- **Recommendation: (a).** Existing users had their first sync long ago; "once ever" for them has passed.

**D12 — Diagnostics: the footer that seems to overlap the last row.** `design/primitives/Modal.tsx`, `core/modals/DiagnosticsModal.tsx`.
- Seen in `/mnt/c/D/saka-verify/shots/r-c/after/hinatazaka46-diagnostics.png`: the body scrolls under a footer that has no top padding or rule, so the cut row ("Yodel … OK") touches the Refresh / Copy JSON row and reads as overlapped. The same `Modal` footer is used by every dialog; most never scroll that far.
- Options: (a) a `footerDivider` prop on `Modal` (a `border-subtle` hairline + 16 px above the buttons), used by Diagnostics only; (b) every dialog shows that hairline while its body has more content below (needs scroll / resize observers); (c) leave it.
- **Recommendation: (a).** Smallest change that fixes the one dialog where it shows.

**D13 — VoicePlayer's gallery / viewer card surface.** `core/media/VoicePlayer.tsx`.
- `e4e4118`: `backdrop-blur-xl bg-white/90 rounded-2xl p-3 … shadow-lg` (white glass at 90 %).
- Tokens have `bg-frost` (white 72 % + 20 px blur, the blog feed's frosted bar) and `bg-sheet` (opaque white); there is no 90 % glass.
- Options: (a) `bg-sheet` + `shadow-card` (on the white gallery body it looks the same; on the dark viewer it is 10 % whiter); (b) `bg-frost backdrop-blur-frost` (more see-through than `e4e4118`); (c) a new token `overlay.glassCard` = white at 90 % (exact restore).
- **Recommendation: (a).**

Already settled and therefore **not** asked: brand scope for boot, ToS, setup, landing and the sync dialog (§4); the aurora header with dark text on ToS / setup / sync (§9); the brand primary gradient for Accept / Get Started / Start (§5 "ToS gradient button"; `e4e4118` had `bg-blue-400` and a pastel gradient); off-logo blues → ink (§3.4); ambers → semantic warning (§3.4, §9); group cards and ToS links as markers (§4, §9); landing orbs and serif display heading (§5, §6; `e4e4118` `text-4xl font-bold`); the empty-state pattern with serif titles (§9); greyed-out disabled buttons (`e4e4118` `bg-gray-200 text-gray-400` / `disabled:opacity-50`) become `disabledReason` (§8: keep colour, show a reason) and the setup form validates on click (§8: forms never disable submit); Japanese ToS quotes and group names shown as data get `lang="ja"` (§6); `InlineSyncView` stays in its group (it is that group's content area, D2d decision 13); the Favorite-filter heart stays oshi (§3.4, R-b); the `default` group stays only as the document-level fallback before a group is chosen (its accent roles already equal the brand; no entry screen reads its group roles after this part).

**Out of scope:** Yodel per-OG colours (spec §13 TODO, needs an API check); member-birthday celebrations (spec §9: later, with Memories); the Windows acceptance build (done by the controller after R-d merges).

---

## Global Constraints

- Work in `/home/xtorker/repos/Project-Saka/SakaDesk` on branch `feat/v2-reapply-d` (from `dev` at `b0b71c5`). Frontend commands run from `frontend/`: one file `npx vitest run <path>`, full suite `npm run test:run`, types `npx tsc --noEmit`, lint `npm run lint`. Backend from the repo root: `uv run pytest backend/tests/<file> -q`, `uv run ruff check backend`, `uv run mypy backend` (only if the repo's CI runs it; check `.github/workflows`). Never use `pip`.
- Commit from the repo root with `uv run git commit` (bare `git commit` fails: pre-commit is not on PATH). Conventional Commits (`docs/DOC_FORMATS.md`): `type(scope): subject`, imperative, whole line <= 72 chars, no trailing period. Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (second `-m`).
- Hex / `rgb()` literals only inside `src/design/tokens/`. No named palette classes (`bg-gray-100`, `text-white`, `bg-black/40`, `text-blue-500`) and no inline `color` / `background` / `boxShadow` in files a task touches (inline custom properties from `groupScopeStyle` / `useGroupMarker` / `brandScopeStyle` and the existing `withAlpha` media styles are allowed); no arbitrary radius / shadow / text / spacing values (the one existing `text-[9px]` in `VoicePlayer` stays, see Task 11); no `rounded-2xl` / `rounded-3xl`.
- Context table (spec §4): BRAND = boot, ToS, landing, setup wizard, sync dialog (rows are markers), about, the entry backdrop → `<BrandScope>` / `Modal scope="brand"`. GROUP = login (its own group), `InlineSyncView` (its own group), chat empty state, milestone cards, blog / chat dialogs' empty states (inherit). Search's empty state is brand (search is brand).
- Group markers: a piece of a brand screen that names one group uses `useGroupMarker(serviceId, target)` (`design/useGroupMarker.ts`). It is a hook: call it in a small per-item component, never inside a `.map` callback.
- Semantic over context (spec §3.4): warnings are `*-semantic-warning*`, danger `*-semantic-danger*`, success `*-status-success` / `*-semantic-success*`; 推 hearts `*-semantic-oshi*`; the bookmark star `text-semantic-star`. Before mapping an old colour to the accent, check its meaning.
- Every "restore" quotes the `e4e4118` value it restores. Large surfaces stay white (spec §3.3).
- Spec §12 deviations stay as they are (primary gradient contrast, Hinatazaka `#389DD1`, Sakurazaka white header, chat header pills, dialog header titles).
- Radius steps: xs 4 · sm 8 · md 12 · lg 16 · xl 24 · full 9999. Floating icon buttons are circles (`rounded-full`); inline icon buttons (dialog close) `rounded-md`.
- States (spec §8): a blocked button uses `disabledReason` (translated), never a bare `disabled`; forms validate on click and say what is missing; hover = `hover:-translate-y-px` + glow, pressed = `active:scale-97`.
- `lang="ja"` on Japanese content only: the ToS article quotes, group names shown as data (`日向坂46` on landing cards and the sync chip), member names. UI chrome is never marked. Do not add `font-reading` / `font-display` to a `lang="ja"` element unless it is meant to be serif.
- Every new utility is registered in `frontend/src/utils/classnames.ts` and listed in `frontend/src/design/tailwindTokens.test.ts`. A file whose guard count drops gets its `guard-baseline.json` entry lowered (or removed at 0) **in the same commit**: `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts`, then `git diff src/design/guard-baseline.json` must show only decreases / removals.
- Logging: every new decision / failure / skip path logs `clientLog(event, fields)` (frontend) or a structlog event (backend); values match `^[a-z0-9_]{1,40}$`, never names, titles, paths or text. A new frontend event goes into both `frontend/src/utils/clientLog.ts` (`ClientLogEvent`) and `backend/api/client_log.py` (`ClientEvent`), with a pytest case. Backend logs carry counts and error types only (paths contain member names).
- i18n: no hard-coded user-facing strings. Every new key goes into all five locales `frontend/src/i18n/locales/{en,ja,zh-CN,zh-TW,yue}.json` and into `frontend/src/i18n/rD.test.ts` (Task 1 creates it; later tasks append). Plurals follow the existing pattern: `key` (singular / only form) plus `key_other` in `en.json` only.
- Backend (repo `CLAUDE.md`): `pathlib.Path`, `open(..., encoding="utf-8")`, no `print()`, no `time.sleep()`, blocking file work through `asyncio.to_thread`, 100 % coverage of new code.
- Screenshots and e2e run headless (Playwright CLI). Never open a WSLg window; to show a page on Windows use `powershell.exe -NoProfile -Command "Start-Process '<windows path>'"`. Never write to `/mnt/c/D/SakaDesk Output`. Shots go to `/mnt/c/D/saka-verify/shots/r-d/{base,dev,after}` and a `#r-d` section of `/mnt/c/D/saka-verify/shots/index.html`.
- Docs and code comments in English. Zero-drift: `docs/design/DESIGN_SYSTEM.md` matches the code at the end; `CHANGELOG.md` gets end-user entries under `[Unreleased]`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `frontend/e2e/r-d-screens.spec.ts` (new) | capture-only shots of every R-d screen | 0 |
| `frontend/src/design/tokens/accent.ts`, `cssVars.ts`, `frontend/tailwind.config.js`, `utils/classnames.ts`, `design/tailwindTokens.test.ts` | `progress` role → `bg-expressive-progress`; `ring-accent-logo` | 1 |
| `frontend/src/design/scopeContext.ts`, `useGroupMarker.ts`, `primitives/EmptyState.tsx` | group scope through portals; marker targets `landing`, `tos_link`, `sync_row`; muted empty-state icon (D6) | 1 |
| `frontend/src/design/rDShared.test.tsx` (new), `frontend/src/i18n/rD.test.ts` (new) | tests for the above; R-d i18n key list | 1 |
| `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py` | events `entry_validation`, `archive_stats_load`, `celebration` | 1 |
| `frontend/src/shell/components/EntryBackdrop.tsx` (new), `TosDialog.tsx`, `shell/App.tsx`, `shell/App.entry.rD.test.tsx` (new), `shell/components/entryDialogs.test.tsx`, `entryFlow.test.tsx` | entry backdrop, boot (D7), ToS (D1–D3) | 2 |
| `frontend/src/pages/LandingPage.tsx`, `pages/LandingPage.rD.test.tsx` (new) | brand landing, marker cards (D4) | 3 |
| `frontend/src/shell/components/SetupWizard.tsx` (+ tests) | brand setup, icon, validate on click | 4 |
| `frontend/src/core/common/SyncProgressPanel.tsx`, `shell/components/SyncModal.tsx`, `core/layout/InlineSyncView.tsx`, `shell/hooks/useSync.ts`, `shell/components/syncScreens.test.tsx` (+ the tests `tsc` flags) | sync rows (D1, D5) | 5 |
| `frontend/src/core/common/DialogStatus.tsx`, `features/blogs/components/BlogStatus.tsx`, `features/messages/MessagesFeature.tsx` (+ tests) | empty states on `EmptyState` (D6) | 6 |
| `backend/services/archive_stats.py` (new), `backend/api/archive.py` (new), `backend/main.py`, `backend/tests/test_archive_stats_api.py` (new) | `GET /api/archive/stats` (D9) | 7 |
| `frontend/src/core/modals/archiveStats.ts` (new), `AboutModal.tsx`, `AboutModal.test.tsx`, `__tests__/mocks/handlers.ts` | About hero + stats (D8, D9) | 8 |
| `frontend/src/shell/firstSyncCelebration.ts` (new), `shell/components/FirstSyncToast.tsx` (new), `shell/hooks/useSync.ts`, `shell/App.tsx` (+ tests) | first-sync toast (D11) | 9 |
| `frontend/src/features/messages/milestones.ts` (new), `components/MilestoneFooter.tsx` (new), `components/MessageList.tsx`, `MessagesFeature.tsx`, `__tests__/virtuosoMock.tsx` (+ tests) | milestone cards (D10) | 10 |
| `frontend/src/core/media/VoicePlayer.tsx` (+ test) | neutral tokens (D13) | 11 |
| `frontend/src/shell/components/LoginModal.tsx`, `entryDialogs.test.tsx` | geo-warning in the login's group | 12 |
| `frontend/src/features/search/components/SearchFilterBar.tsx` (+ test), locales | "members" count key | 13 |
| `frontend/src/design/primitives/Modal.tsx`, `core/modals/DiagnosticsModal.tsx` (+ tests) | `footerDivider` (D12) | 14 |
| `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md`, spec §12 (D5 (a)) | zero-drift docs | 15 |
| `/mnt/c/D/saka-verify/shots/r-d/`, `index.html` | before/after page | 16 |

Guard baseline entries that reach 0 and are removed: `core/common/SyncProgressPanel.tsx` (5), `core/layout/InlineSyncView.tsx` (1), `pages/LandingPage.tsx` (4), `shell/components/SetupWizard.tsx` (1), `shell/components/SyncModal.tsx` (2), `shell/components/TosDialog.tsx` (3); lowered: `core/media/VoicePlayer.tsx` 3 → 1. (All removed counts are superseded `*-group-*` utilities; VoicePlayer's two `text-[10px]` go, its `text-[9px]` stays.)

---

### Task 0: Capture spec and the "base" and "dev" shots

**Files:**
- Create: `frontend/e2e/r-d-screens.spec.ts`

**Interfaces:**
- Consumes: `pinEntry`, `RUNNING`, `MEDIA`, `COMPLETE` from `frontend/e2e/fixtures/entry.ts`; `pinBigRoom`, `buildBigRoom`, `COUNT`, `TZ`, `roomDir`, `type FixtureMessage` from `frontend/e2e/fixtures/bigRoom.ts`; `pinBlogs` from `frontend/e2e/fixtures/blogs.ts`.
- Produces: `frontend/e2e-shots/r-d/{base,dev}/*.png` (git-ignored), copied to `/mnt/c/D/saka-verify/shots/r-d/{base,dev}/`. Task 16 adds `after`.

- [ ] **Step 1: Write the capture spec** — `frontend/e2e/r-d-screens.spec.ts`

```ts
import { test, expect, type Locator, type Page } from '@playwright/test'
import { pinEntry, RUNNING, MEDIA, COMPLETE } from './fixtures/entry'
import { buildBigRoom, pinBigRoom, roomDir, COUNT, TZ, type FixtureMessage } from './fixtures/bigRoom'
import { pinBlogs } from './fixtures/blogs'

// Captures (does not compare) every R-d screen so the v2 re-apply can be reviewed against the
// pre-D2 look. The same spec runs on three builds:
//   SHOT_LABEL=base  - e4e4118 (colour baseline), from a worktree
//   SHOT_LABEL=dev   - dev before R-d
//   SHOT_LABEL=after - this branch at the end
// Command (from frontend/, with port 8000 free; serial, so capture never competes for CPU):
//   SHOT_LABEL=after npx playwright test e2e/r-d-screens.spec.ts --reporter=line
// Files land in frontend/e2e-shots/r-d/<label>/ (git-ignored). Every auth call is mocked
// (fixtures/entry.ts): never a real login.

const LABEL = process.env.SHOT_LABEL

test.use({ timezoneId: TZ, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })
test.skip(!LABEL, 'capture only: set SHOT_LABEL=base, dev or after')
test.describe.configure({ mode: 'serial' })

/** Visible, in the viewport and with a stable box (two reads 250 ms apart equal). */
async function settled(page: Page, locator: Locator) {
  await expect(locator).toBeVisible({ timeout: 30000 })
  await expect(locator).toBeInViewport({ timeout: 30000 })
  let last = JSON.stringify(await locator.boundingBox())
  await expect.poll(async () => {
    await page.waitForTimeout(250)
    const now = JSON.stringify(await locator.boundingBox())
    const same = now === last
    last = now
    return same
  }, { timeout: 15000 }).toBe(true)
}

/** Two animation frames: progress polling never goes network-idle, so no networkidle wait here. */
async function shot(page: Page, name: string) {
  await page.mouse.move(1270, 795)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  await page.screenshot({ path: `e2e-shots/r-d/${LABEL}/${name}.png`, animations: 'disabled' })
}

async function startWith(page: Page, ...names: string[]) {
  await expect(page.getByRole('heading', { name: 'Welcome to SakaDesk' })).toBeVisible({ timeout: 30000 })
  for (const name of names) await page.getByRole('button', { name: new RegExp(name) }).click()
  await page.getByRole('button', { name: /^Get Started/ }).click()
}

async function railMenu(page: Page, item: string) {
  await page.getByTitle('Settings', { exact: true }).click()
  await page.getByRole('menu').first().getByText(item, { exact: true }).click()
}

/** The big room plus a voice message (the compact voice player). */
function voiceRoom(): FixtureMessage[] {
  const voice = {
    id: COUNT + 1, member_id: '1', timestamp: new Date(Date.UTC(2026, 10, 3, 4, 0)).toISOString(), type: 'voice',
    content: null, is_favorite: false, media_file: 'messages/1 Big Room/1 Big Room/voice/5001.m4a', width: null, height: null,
  } as unknown as FixtureMessage
  return [...buildBigRoom(), voice]
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+09:00'))
  await page.route((url) => url.pathname === '/api/archive/stats', (route) =>
    route.fulfill({ json: { messages: 12846, photos: 2301, first_message_at: '2023-02-14T03:00:00Z' } }),
  )
})

test('boot', async ({ page }) => {
  await pinEntry(page)
  // Prefs never answer, so the app stays on its boot screen.
  await page.route('**/api/app-state/prefs', () => { /* never fulfilled */ })
  await page.goto('/')
  await settled(page, page.locator('.animate-spin').first())
  await shot(page, 'boot')
})

test('terms of service', async ({ page }) => {
  await pinEntry(page)
  await page.goto('/')
  const tos = page.getByRole('dialog', { name: 'Terms of Service' })
  await settled(page, tos)
  await shot(page, 'tos')
  await tos.getByText('Key excerpts from the official Terms of Service:').click()
  await shot(page, 'tos-excerpts')
})

test('landing', async ({ page }) => {
  await pinEntry(page, { tosAccepted: true })
  await page.goto('/')
  await settled(page, page.getByRole('heading', { name: 'Welcome to SakaDesk' }))
  await shot(page, 'landing-empty')
  await page.getByRole('button', { name: /日向坂46/ }).click()
  await page.getByRole('button', { name: /櫻坂46/ }).click()
  await shot(page, 'landing-two')
})

test('login over the entry backdrop and the Yodel warning', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.geoBlocked = true
  await page.goto('/')
  await startWith(page, 'Yodel')
  const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
  await settled(page, login)
  await shot(page, 'login-yodel')
  await login.getByRole('button', { name: 'Connect Account' }).click()
  await settled(page, page.getByRole('dialog', { name: 'Yodel is available in Japan only' }))
  await shot(page, 'login-yodel-geo')
})

test('setup, a sequential first sync and the first-sync toast', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true })
  state.progress.hinatazaka46 = RUNNING
  state.progress.sakurazaka46 = RUNNING
  await page.goto('/')
  await startWith(page, '日向坂46', '櫻坂46')
  for (const [i, name] of ['日向坂46', '櫻坂46'].entries()) {
    const login = page.getByRole('dialog', { name: 'Connect Your Account?' })
    await expect(login).toContainText(name)
    await login.getByRole('button', { name: 'Connect Account' }).click()
    await expect.poll(() => state.loginCalls.length, { timeout: 10000 }).toBe(i + 1)
  }
  const setup = page.getByRole('dialog', { name: 'Welcome to SakaDesk' })
  await settled(page, setup)
  await shot(page, 'setup')
  await setup.getByRole('button', { name: 'Start Using SakaDesk' }).click()
  await shot(page, 'setup-missing')
  await setup.getByPlaceholder('C:\\Users\\YourName\\SakaDesk-data').fill('C:\\SakaDesk-データ')
  await setup.getByRole('button', { name: 'Start Using SakaDesk' }).click()
  const sync = page.getByRole('dialog', { name: /^Phase/ })
  await expect(sync.getByText('5 / 20')).toBeVisible({ timeout: 30000 })
  await shot(page, 'sync-running')
  state.progress.sakurazaka46 = MEDIA
  await expect(page.getByText('Downloading media... Please do not close the app.')).toBeVisible({ timeout: 30000 })
  await shot(page, 'sync-media')
  state.progress.sakurazaka46 = COMPLETE
  await expect(page.getByText(/\(2\/2\)/)).toBeVisible({ timeout: 30000 })
  state.progress.hinatazaka46 = COMPLETE
  await expect(page.getByRole('dialog', { name: 'Complete' })).toBeVisible({ timeout: 30000 })
  await shot(page, 'sync-complete')
  // The toast exists only on builds with R-d; base and dev skip the shot.
  const toast = page.getByRole('status').filter({ hasText: 'Your archive is ready' })
  if (await toast.count()) await shot(page, 'first-sync-toast')
})

test('inline sync of 櫻坂46 added to 日向坂46', async ({ page }) => {
  const state = await pinEntry(page, { tosAccepted: true, services: ['hinatazaka46'], configured: true, authed: ['hinatazaka46'] })
  state.progress.sakurazaka46 = RUNNING
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Groups' })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Add Service' }).click()
  await page.getByRole('dialog', { name: 'Add Service' }).getByRole('button', { name: /櫻坂46/ }).click()
  await page.getByRole('dialog', { name: 'Connect Your Account?' }).getByRole('button', { name: 'Connect Account' }).click()
  await expect(page.getByText('5 / 20')).toBeVisible({ timeout: 30000 })
  await shot(page, 'inline-sync-sakurazaka46')
})

for (const service of ['hinatazaka46', 'sakurazaka46'] as const) {
  test(`${service}: about, diagnostics, empty states, milestone, voice`, async ({ page }) => {
    await pinBigRoom(page, { messages: { current: voiceRoom() }, service })
    // A seen chat that has passed 1,000 messages before: 5,000 and day 100 are new (R-d builds only).
    const dir = roomDir(service)
    await page.route('**/api/app-state/prefs', (route) => {
      if (route.request().method() !== 'GET') return route.fulfill({ status: 204 })
      return route.fulfill({
        json: {
          tos_accepted_at: '2026-01-01T00:00:00Z',
          language: 'en',
          celebrated_milestones: { [`${service}|${dir}`]: { messages: [1000], days: [] } },
          'sakadesk-app-state': JSON.stringify({ state: { selectedServices: [service], activeService: service, activeFeatures: { [service]: 'messages' } }, version: 4 }),
        },
      })
    })
    await page.route((url) => url.pathname === '/api/search/status', (route) => route.fulfill({ json: { is_building: false } }))
    await page.route((url) => url.pathname === '/api/search', (route) =>
      route.fulfill({ json: { query: 'zzz', normalized_query: 'zzz', total_count: 0, has_more: false, results: [] } }),
    )
    await page.goto('/')
    await settled(page, page.getByText('Big Room', { exact: true }))
    await shot(page, `${service}-chat-welcome`)

    await railMenu(page, 'About')
    const about = page.getByRole('dialog').first()
    await settled(page, about)
    await shot(page, `${service}-about`)
    const version = about.getByText(/^Version /).first()
    for (let i = 0; i < 5; i++) await version.click()
    const diagnostics = page.getByRole('dialog', { name: 'Developer Diagnostics' })
    await settled(page, diagnostics)
    await expect(diagnostics.getByText('SYSTEM')).toBeVisible({ timeout: 30000 })
    await shot(page, `${service}-diagnostics`)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+k')
    await page.getByPlaceholder(/^Search messages/).fill('zzz')
    await settled(page, page.getByText(/No results/).first())
    await shot(page, `${service}-search-empty`)
    await page.keyboard.press('Escape')

    await page.getByText('Big Room', { exact: true }).click()
    await settled(page, page.locator(`#msg-${COUNT + 1}`))
    await page.getByTitle('More options').click()
    await page.getByRole('menu').first().getByText('Favorites', { exact: true }).click()
    await settled(page, page.getByRole('dialog').first())
    await shot(page, `${service}-favorites-empty`)
    await page.keyboard.press('Escape')

    await shot(page, `${service}-chat-end`)
  })
}

test('blog feed empty state', async ({ page }) => {
  await pinBlogs(page, { recent: 'empty' })
  await page.goto('/')
  await settled(page, page.getByText(/No blog posts found/).first())
  await shot(page, 'blog-feed-empty')
})
```

- [ ] **Step 2: Check it skips without a label**

Run (from `frontend/`): `npx playwright test e2e/r-d-screens.spec.ts --reporter=line`
Expected: `9 skipped`.

- [ ] **Step 3: Make sure nothing else serves port 8000, then capture "dev"**

Run: `ss -ltn | grep ':8000 ' || echo free`; expected `free`. Then (from `frontend/`): `npm run build && mkdir -p e2e-shots/r-d/dev && SHOT_LABEL=dev npx playwright test e2e/r-d-screens.spec.ts --reporter=line`
Expected: `9 passed`; about 30 PNGs in `e2e-shots/r-d/dev/` (no `first-sync-toast` on dev). If a locator text differs on dev (e.g. the excerpts summary or the search empty text), read the string from `src/i18n/locales/en.json` and fix the spec, not the app.

- [ ] **Step 4: Capture "base" from the `e4e4118` worktree**

The worktree `../SakaDesk-e4e4118` exists (it holds `fixtures/bigRoom.ts` and `fixtures/blogs.ts` from earlier parts, untracked). Copy the spec and the fixtures (never committed there): `cp frontend/e2e/r-d-screens.spec.ts ../SakaDesk-e4e4118/frontend/e2e/ && cp frontend/e2e/fixtures/entry.ts frontend/e2e/fixtures/bigRoom.ts frontend/e2e/fixtures/blogs.ts ../SakaDesk-e4e4118/frontend/e2e/fixtures/`. Then from `../SakaDesk-e4e4118/frontend`: `npm ci && npm run build && mkdir -p e2e-shots/r-d/base && SHOT_LABEL=base npx playwright test e2e/r-d-screens.spec.ts --reporter=line`.
Expected: all pass. `e4e4118` has the old DOM: ToS, setup and sync are plain `div`s (no `role="dialog"` name), Diagnostics and About differ. If a locator misses there, fix only that locator in the worktree copy (e.g. `page.getByText('Terms of Service')` instead of the dialog role; a shot may be left out and the page shows a `—` cell); never touch the repo spec.
Copy results: `mkdir -p /mnt/c/D/saka-verify/shots/r-d && cp -r e2e-shots/r-d/base /mnt/c/D/saka-verify/shots/r-d/ && cp -r /home/xtorker/repos/Project-Saka/SakaDesk/frontend/e2e-shots/r-d/dev /mnt/c/D/saka-verify/shots/r-d/`.

- [ ] **Step 5: Commit the spec**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk && git add frontend/e2e/r-d-screens.spec.ts
uv run git commit -m "test(e2e): add capture spec for the R-d entry screens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 1: Shared pieces: `progress` role, ring utilities, group scope through portals, marker targets, muted empty-state icon, breadcrumbs (pending decision D6)

**Files:**
- Modify: `frontend/src/design/tokens/accent.ts`, `frontend/src/design/cssVars.ts`, `frontend/tailwind.config.js`, `frontend/src/utils/classnames.ts`, `frontend/src/design/tailwindTokens.test.ts`
- Modify: `frontend/src/design/scopeContext.ts`, `frontend/src/design/useGroupMarker.ts`, `frontend/src/design/primitives/EmptyState.tsx`
- Modify: `frontend/src/utils/clientLog.ts`, `backend/api/client_log.py`, `backend/tests/test_client_log_api.py`
- Create: `frontend/src/design/rDShared.test.tsx`, `frontend/src/i18n/rD.test.ts`

**Interfaces:**
- Produces: `AccentRoles.progress: string` → CSS variable `--ds-expressive-progress` → utility `bg-expressive-progress`; utilities `ring-accent-logo` (`--ds-accent-logo`) and `ring-accent-subtle` (`--ds-accent-subtle`); `ScopeValue = { scope: 'brand' | 'group'; style: CSSProperties }`; `GroupMarkerTarget = 'add_service' | 'settings_row' | 'landing' | 'tos_link' | 'sync_row'`; `ClientLogEvent` gains `'entry_validation' | 'archive_stats_load' | 'celebration'`; `frontend/src/i18n/rD.test.ts` exports nothing but holds `RD_KEYS` / `RD_EN_PLURALS` arrays that later tasks append to.

- [ ] **Step 1: Write the failing tests** — `frontend/src/design/rDShared.test.tsx`

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { aurora, brandAccent, groupAccent, groupTokens } from './tokens';
import { accentTokenVars } from './cssVars';
import { EmptyState } from './primitives';
import { Modal } from './primitives/Modal';
import { useGroupMarker } from './useGroupMarker';
import { ScopeContext } from './scopeContext';
import { groupScopeStyle } from './groupScope';
import { resetDialogStack } from './dialog/dialogStack';

afterEach(() => {
    vi.mocked(clientLog).mockClear();
    resetDialogStack();
});

describe('progress role (R-d)', () => {
    it('is the aurora in brand context (e4e4118 sync bar: the pastel from-[#b4dcff] to-[#f0bede])', () => {
        expect(brandAccent().progress).toBe(aurora.gradient);
        expect(accentTokenVars(brandAccent())['--ds-expressive-progress']).toBe(aurora.gradient);
    });

    it('is the title gradient on a gradient header and the official bar on a light header (e4e4118 InlineSyncView)', () => {
        const t = groupTokens.hinatazaka.official.title;
        expect(groupAccent('hinatazaka').progress).toBe(`linear-gradient(to right, ${t.gradient.from}, ${t.gradient.via}, ${t.gradient.to})`);
        expect(groupAccent('sakurazaka').progress).toBe(groupTokens.sakurazaka.official.title.bar);
    });
});

describe('group scope through a portal (R-d)', () => {
    it('an inheriting Modal takes a group scope from ScopeContext', () => {
        render(
            <ScopeContext.Provider value={{ scope: 'group', style: groupScopeStyle('yodel') }}>
                <Modal isOpen onClose={vi.fn()} title="確認 ✅">x</Modal>
            </ScopeContext.Provider>,
        );
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('data-scope', 'group');
        expect(dialog.style.getPropertyValue('--ds-accent')).toBe(groupAccent('yodel').accent);
    });
});

describe('group marker targets (R-d)', () => {
    it.each(['landing', 'tos_link', 'sync_row'] as const)('%s leaves an unknown service in brand and logs it', (target) => {
        const { result } = renderHook(() => useGroupMarker('unknown', target));
        expect(result.current).toBeUndefined();
        expect(clientLog).toHaveBeenCalledWith('group_marker_fallback', { target, reason: 'unknown_service' });
    });
});

describe('EmptyState icon (R-d, pending decision D6)', () => {
    it('draws the line icon in the muted neutral on the soft circle, sized by the circle', () => {
        render(<EmptyState icon={<Inbox className="h-10 w-10" />} title="空です 📭" />);
        const circle = screen.getByTestId('empty-state-circle');
        expect(circle).toHaveClass('bg-expressive-soft', 'text-muted');
        expect(circle).not.toHaveClass('text-accent-strong');
        expect(circle.firstElementChild).toHaveClass('[&>svg]:h-7', '[&>svg]:w-7');
    });
});
```

- [ ] **Step 2: Create the R-d i18n check** — `frontend/src/i18n/rD.test.ts` (empty lists now; Tasks 2, 4, 8, 9, 10 and 13 append their keys)

```ts
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every string R-d adds (later tasks append). */
const RD_KEYS: readonly string[] = [];

/** R-d keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
const RD_EN_PLURALS: readonly string[] = [];

const lookup = (data: unknown, dotted: string): unknown => {
    const [section, key] = dotted.split('.');
    return (data as Record<string, Record<string, unknown>>)[section]?.[key];
};

describe('R-d strings', () => {
    it.each(Object.entries(locales))('%s has every R-d key', (_code, data) => {
        for (const dotted of RD_KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });

    it('English has the plural form of every counted R-d key', () => {
        for (const dotted of RD_EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });
});
```

- [ ] **Step 3: Add the two utility rows to** `frontend/src/design/tailwindTokens.test.ts` — inside `expected`, after `['backgroundImage', "'expressive-header-bar'", '--ds-expressive-header-bar'],` add:

```ts
        ['backgroundImage', "'expressive-progress'", '--ds-expressive-progress'],
        ['ringColor', "'accent-logo'", '--ds-accent-logo'],
        ['ringColor', "'accent-subtle'", '--ds-accent-subtle'],
```

- [ ] **Step 4: Add the backend cases** — in `backend/tests/test_client_log_api.py`, append to the parametrize list of `test_design_system_events_are_accepted` (after the `group_marker_fallback` case):

```python
        (
            "group_marker_fallback",
            {"target": "sync_row", "reason": "unknown_service"},
            "info",
        ),
        ("entry_validation", {"surface": "setup", "reason": "missing_folder"}, "info"),
        ("archive_stats_load", {"outcome": "ok"}, "info"),
        ("archive_stats_load", {"outcome": "failed"}, "info"),
        ("celebration", {"target": "first_sync", "outcome": "shown"}, "info"),
        (
            "celebration",
            {"target": "first_sync", "outcome": "skipped", "reason": "sync_failed"},
            "info",
        ),
        (
            "celebration",
            {"target": "milestone_messages", "outcome": "shown", "count": 5000},
            "info",
        ),
        ("celebration", {"target": "milestone_days", "outcome": "seeded"}, "info"),
```

- [ ] **Step 5: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/design/rDShared.test.tsx src/design/tailwindTokens.test.ts src/i18n/rD.test.ts`
Expected: FAIL (`progress` undefined, `data-scope` missing / type error on `scope: 'group'`, targets not in the union, `text-accent-strong` on the circle, missing tailwind keys). `rD.test.ts` passes (empty lists).
Run (repo root): `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: FAIL with 422 for the three new events.

- [ ] **Step 6: Implement the token role** — `frontend/src/design/tokens/accent.ts`:
  - in `AccentRoles`, after `headerBar: string;` add:

```ts
    /** Sync progress fill: the aurora (brand); the title gradient, or the official bar under a light header (group). */
    progress: string;
```

  - in `brandAccent()`, after `headerBar: 'none',` add `progress: aurora.gradient,`.
  - in `groupAccent()`, replace the `header:` line and add `progress` after `headerBar`:

```ts
        header: light ? color.surface.sheet : titleGradient,
        headerText: light ? t.text : color.text.inverse,
        headerBar: light ? t.bar : 'none',
        progress: light ? t.bar : titleGradient,
```

    with, just above the `return {`, `const titleGradient = \`linear-gradient(to right, ${t.gradient.from}, ${t.gradient.via}, ${t.gradient.to})\`;` (the same string the header used).
  - `frontend/src/design/cssVars.ts`, in `accentTokenVars`, after `'--ds-expressive-header-bar': a.headerBar,` add `'--ds-expressive-progress': a.progress,`.
  - `frontend/tailwind.config.js`: in `backgroundImage`, after `'expressive-header-bar': 'var(--ds-expressive-header-bar)',` add `'expressive-progress': 'var(--ds-expressive-progress)',`; in `ringColor`, after `'accent-border': 'var(--ds-accent-border)',` add `'accent-logo': 'var(--ds-accent-logo)',` and `'accent-subtle': 'var(--ds-accent-subtle)',`.
  - `frontend/src/utils/classnames.ts`: in the `bg-image` list add `'expressive-progress'` after `'expressive-header-bar'`; replace the `ring-color` group with `'ring-color': [{ ring: ['accent', 'accent-border', 'accent-logo', 'accent-subtle', 'semantic-oshi'] }],`.

- [ ] **Step 7: Implement scope, markers and the empty-state icon**
  - `frontend/src/design/scopeContext.ts`: replace the interface and the doc comment with

```ts
/** `brand`: set by BrandScope and a brand Modal. `group`: one service's scope (its login) handed to a portalled child dialog. */
export interface ScopeValue { scope: 'brand' | 'group'; style: CSSProperties }

/** Lets portalled dialogs inherit the brand context, or a group scope a parent passes explicitly. */
```

  - `frontend/src/design/useGroupMarker.ts`: `export type GroupMarkerTarget = 'add_service' | 'settings_row' | 'landing' | 'tos_link' | 'sync_row';` and extend the doc comment's examples: "(a group card, a per-group settings row, a ToS link, a landing card, a sync step: docs/design/DESIGN_SYSTEM.md, "Contexts")".
  - `frontend/src/design/primitives/EmptyState.tsx` (pending decision D6), the circle:

```tsx
        <div data-testid="empty-state-circle" className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-expressive-soft text-muted">
            <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center [&>svg]:h-7 [&>svg]:w-7">{icon}</span>
        </div>
```

    and the doc comment: `/** Brand moment (spec §9): soft circle + muted line icon (e4e4118's grey) + display-face title + one line + one action. */`

- [ ] **Step 8: Register the breadcrumbs**
  - `frontend/src/utils/clientLog.ts`: the last line of `ClientLogEvent` becomes `| 'menu_item_blocked' | 'blog_fallback' | 'group_marker_fallback' | 'entry_validation' | 'archive_stats_load' | 'celebration';`
  - `backend/api/client_log.py`: after `"group_marker_fallback",` in `ClientEvent` add `"entry_validation",`, `"archive_stats_load",`, `"celebration",`. (All field keys used — `surface`, `reason`, `outcome`, `target`, `count` — are already in `ALLOWED_FIELDS`.)

- [ ] **Step 9: Run to verify they pass**

Run (from `frontend/`): `npx vitest run src/design src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (`Moments.test.tsx` still passes: the circle keeps `bg-expressive-soft`).
Run (repo root): `uv run pytest backend/tests/test_client_log_api.py -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add frontend backend
uv run git commit -m "feat(design): add progress role, logo ring and R-d breadcrumbs" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Entry backdrop, boot screen and ToS (pending decisions D1, D2, D3, D7)

**Files:**
- Create: `frontend/src/shell/components/EntryBackdrop.tsx`, `frontend/src/shell/App.entry.rD.test.tsx`
- Modify: `frontend/src/shell/components/TosDialog.tsx`, `frontend/src/shell/App.tsx`, `frontend/src/shell/components/entryDialogs.test.tsx`, `frontend/src/shell/components/entryFlow.test.tsx`, `frontend/src/i18n/rD.test.ts`, the five locale files, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `useGroupMarker(…, 'tos_link')`, `Modal icon`, `Modal scope="brand"`, `Button disabledReason`, `BrandScope`, `Atmosphere` (Task 1 and earlier).
- Produces: `EntryBackdrop: React.FC` (`data-testid="entry-backdrop"`), used again by Task 9's App changes; i18n key `tos.acceptRequired`.

- [ ] **Step 1: Write the failing tests**
  - `frontend/src/shell/components/entryDialogs.test.tsx`: in `describe('ToS (D2d)'` replace the line `expect(screen.getByRole('checkbox')).toHaveClass('accent-group');` with `expect(screen.getByRole('checkbox')).toHaveClass('accent-accent');` and delete the whole `it('links the official terms with the neutral link role', …)`. Add `import { groupRoles } from '../../design/tokens';` if it is not imported (it is) and append:

```tsx
describe('ToS (R-d)', () => {
    it('is a brand dialog with the document icon on the dark aurora header (pending decision D1)', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: 'Terms of Service' })).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header')).toHaveClass('bg-expressive-header', 'text-expressive-header');
        expect(screen.getByTestId('modal-header-icon').querySelector('svg.lucide-file-text')).not.toBeNull();
    });

    it('restores the amber disclaimer in the semantic warning colours (pending decision D2)', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        const box = screen.getByTestId('tos-disclaimer');
        expect(box).toHaveClass('bg-semantic-warning-subtle', 'border', 'border-semantic-warning');
        expect(within(box).getByRole('heading', { name: 'Important Disclaimer' })).toHaveClass('text-semantic-warning');
        expect(within(box).getByText(i18n.t('tos.disclaimerText'))).toHaveClass('text-semantic-warning');
        expect(box.querySelector('svg')).toHaveClass('text-semantic-warning');
    });

    it('draws each official link in its own group colour on the near-white box (pending decision D3)', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        const links = [
            ['Nogizaka46 ToS', 'nogizaka'], ['Sakurazaka46 ToS', 'sakurazaka'],
            ['Hinatazaka46 ToS', 'hinatazaka'], ['Yodel ToS', 'yodel'],
        ] as const;
        for (const [name, group] of links) {
            const link = screen.getByRole('link', { name });
            expect(link).toHaveClass('text-accent-strong', 'hover:underline');
            expect(link).not.toHaveClass('underline');
            const item = link.closest('li') as HTMLElement;
            expect(item.style.getPropertyValue('--ds-accent-strong')).toBe(groupRoles(group).strong);
            expect(item.closest('section')).toHaveClass('bg-elevated');
        }
    });

    it('marks the quoted Japanese terms as ja, not the translated titles', () => {
        render(<TosDialog onAccept={vi.fn()} />);
        const quote = screen.getByText(/^当社が別に定める場合を除き/);
        expect(quote.closest('[lang="ja"]')).not.toBeNull();
        expect(screen.getByText(i18n.t('tos.articleIpTitle')).closest('[lang="ja"]')).toBeNull();
    });

    it('blocks Accept with a reason until the box is ticked', async () => {
        render(<TosDialog onAccept={vi.fn()} />);
        const accept = screen.getByRole('button', { name: 'Accept and Continue' });
        expect(accept).toHaveAttribute('aria-disabled', 'true');
        expect(accept).toHaveAttribute('title', i18n.t('tos.acceptRequired'));
        await userEvent.click(screen.getByRole('checkbox'));
        expect(accept).not.toHaveAttribute('aria-disabled');
    });
});
```

  - `frontend/src/shell/components/entryFlow.test.tsx`, in `it('Accept is disabled until the box is ticked, …')`: replace `expect(accept).toBeDisabled();` with `expect(accept).toHaveAttribute('aria-disabled', 'true');` and `expect(accept).toBeEnabled();` with `expect(accept).not.toHaveAttribute('aria-disabled');`.
  - `frontend/src/shell/App.entry.rD.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../__tests__/mocks/server';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { useAppStore } from '../store/appStore';
import { persisted } from '../core/persistence/persisted';

vi.mock('../core/layout', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../core/layout')>()),
    Layout: () => <div data-testid="layout-stub" />,
}));

function pinPrefs(tosAccepted: boolean) {
    vi.spyOn(persisted, 'getPref').mockImplementation(<T,>(key: string, fallback: T): T => {
        if (key === 'tos_accepted_at') return (tosAccepted ? '2024-01-01T00:00:00Z' : fallback) as unknown as T;
        if (key === 'language') return 'en' as unknown as T;
        return fallback;
    });
}

describe('first launch on the brand atmosphere (R-d)', () => {
    beforeEach(() => {
        server.use(
            http.get('*/api/app-state/prefs', () => HttpResponse.json({})),
            http.patch('*/api/app-state/prefs', () => HttpResponse.json({ ok: true })),
            http.get('*/api/app-state/migrate', () => HttpResponse.json({ migrated: true })),
            http.get('*/api/app-state/conversation-all', () => HttpResponse.json({})),
        );
    });

    it('the boot screen is brand with an ink spinner (pending decision D7)', () => {
        pinPrefs(false);
        useAppStore.setState({ selectedServices: [], activeService: null });
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);
        const boot = screen.getByTestId('boot-screen');
        expect(boot.closest('[data-scope="brand"]')).not.toBeNull();
        expect(boot.querySelector('svg')).toHaveClass('animate-spin', 'text-accent');
        unmount();
    });

    it('ToS sits on the brand orbs', async () => {
        pinPrefs(false);
        useAppStore.setState({ selectedServices: [], activeService: null });
        const { unmount } = render(<AuthProvider><App /></AuthProvider>);
        expect(await screen.findByRole('dialog', { name: 'Terms of Service' })).toHaveAttribute('data-scope', 'brand');
        const backdrop = screen.getByTestId('entry-backdrop');
        expect(backdrop.querySelector('[data-scope="brand"]')).not.toBeNull();
        expect(backdrop.querySelectorAll('[data-testid="atmosphere-orb"]')).toHaveLength(3);
        unmount();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/shell/components/entryDialogs.test.tsx src/shell/components/entryFlow.test.tsx src/shell/App.entry.rD.test.tsx`
Expected: FAIL (no brand scope, no icon, neutral disclaimer, no `boot-screen` / `entry-backdrop`).

- [ ] **Step 3: Add the key** `tos.acceptRequired` to the `tos` section of each locale and to `RD_KEYS` in `frontend/src/i18n/rD.test.ts` (`const RD_KEYS: readonly string[] = ['tos.acceptRequired'];`):
  - en: `"acceptRequired": "Tick the box above to continue"`
  - ja: `"acceptRequired": "上のチェックボックスにチェックを入れてください"`
  - zh-CN: `"acceptRequired": "请先勾选上方的复选框"`
  - zh-TW: `"acceptRequired": "請先勾選上方的核取方塊"`
  - yue: `"acceptRequired": "請先剔咗上面個格"`

- [ ] **Step 4: Create the backdrop** — `frontend/src/shell/components/EntryBackdrop.tsx`

```tsx
import React from 'react';
import { Atmosphere } from '../../design/primitives';
import { BrandScope } from '../../design/brandScope';

/**
 * The first-launch backdrop (spec §9: boot → ToS → choose groups → first sync on aurora + orbs,
 * L2): the brand orbs over the window base, behind the entry dialogs. Decorative only.
 */
export const EntryBackdrop: React.FC = () => (
    <div data-testid="entry-backdrop" aria-hidden="true" className="fixed inset-0">
        <BrandScope className="h-full bg-window">
            <Atmosphere className="h-full">{null}</Atmosphere>
        </BrandScope>
    </div>
);
```

  Export it from `frontend/src/shell/components/index.ts` (`export { EntryBackdrop } from './EntryBackdrop';`).

- [ ] **Step 5: Rewrite ToS (pending decisions D1, D2, D3)** — `frontend/src/shell/components/TosDialog.tsx`

```tsx
import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Modal } from '../../design/primitives';
import { useGroupMarker } from '../../design/useGroupMarker';
import { persisted } from '../../core/persistence/persisted';

interface TosDialogProps {
    onAccept: () => void;
}

const OFFICIAL_TOS = [
    { service: 'nogizaka46', href: 'https://contact.nogizaka46.com/s/n46app/page/app_terms', labelKey: 'tos.nogizakaTos' },
    { service: 'sakurazaka46', href: 'https://sakurazaka46.com/s/s46app/page/app_terms', labelKey: 'tos.sakurazakaTos' },
    { service: 'hinatazaka46', href: 'https://www.hinatazaka46.com/s/h46app/page/app_terms', labelKey: 'tos.hinatazakaTos' },
    { service: 'yodel', href: 'https://yodel-app.com/s/yodel/rule', labelKey: 'tos.yodelTos' },
] as const;

/**
 * One official-terms link in its own group's link colour: a group marker (spec §9; e4e4118 had
 * purple / pink / blue / indigo text with a hover underline; decision D3).
 */
const TosLink: React.FC<{ service: string; href: string; label: string }> = ({ service, href, label }) => {
    const marker = useGroupMarker(service, 'tos_link');
    return (
        <li style={marker}>
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md text-small text-accent-strong underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
                {label}
            </a>
        </li>
    );
};

/**
 * Terms of Service acknowledgment dialog shown on first launch: a brand dialog (spec §4, §9).
 * Blocks app usage until the user accepts the terms. Standard layout: the body scrolls and
 * Accept stays in the footer, so a short window never hides it (spec D2d decision 4).
 */
export const TosDialog: React.FC<TosDialogProps> = ({ onAccept }) => {
    const { t } = useTranslation();
    const [acknowledged, setAcknowledged] = useState(false);

    const handleAccept = () => {
        if (acknowledged) {
            // Store acceptance timestamp in the persisted app-state store
            persisted.setPref('tos_accepted_at', new Date().toISOString());
            onAccept();
        }
    };

    return (
        <Modal
            isOpen
            onClose={() => {}}
            scope="brand"
            title={t('tos.title')}
            icon={<FileText />}
            dismissible={false}
            logId="tos"
            className="max-w-lg"
            bodyClassName="flex flex-col gap-4"
            footer={
                <Button
                    variant="primary"
                    className="w-full"
                    onClick={handleAccept}
                    disabledReason={acknowledged ? undefined : t('tos.acceptRequired')}
                >
                    {t('tos.acceptAndContinue')}
                </Button>
            }
        >
            <p className="text-small text-muted">{t('tos.subtitle')}</p>

            {/* e4e4118: bg-amber-50 border-amber-200, text-amber-800 / -700 → semantic warning (spec §9). */}
            <section data-testid="tos-disclaimer" className="flex gap-3 rounded-lg border border-semantic-warning bg-semantic-warning-subtle p-4">
                <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-semantic-warning" />
                <div className="flex flex-col gap-1">
                    <h3 className="text-body font-semibold text-semantic-warning">{t('tos.disclaimer')}</h3>
                    <p className="text-small text-semantic-warning">{t('tos.disclaimerText')}</p>
                </div>
            </section>

            {/* Official ToS excerpts (collapsible). The articles quote the official Japanese terms verbatim. */}
            <details className="rounded-lg bg-elevated p-4">
                <summary className="cursor-pointer select-none text-small font-semibold text-secondary">
                    {t('tos.officialExcerpts')}
                </summary>
                <div className="mt-3 flex flex-col gap-3 text-caption text-secondary">
                    <div>
                        <p className="font-semibold">{t('tos.articleIpTitle')}</p>
                        <p lang="ja">当社が別に定める場合を除き、お客様が本コンテンツを複製、翻案、頒布、公衆送信等することは禁止します。</p>
                    </div>
                    <div>
                        <p className="font-semibold">{t('tos.articleProhibitedTitle')}</p>
                        <div lang="ja">
                            <p>(11) 当社または第三者の情報、データおよびソフトウェアを修正、改変、改ざん、リバースエンジニアリング、逆コンパイル、逆アッセンブルまたは消去等する行為</p>
                            <p>(16) 当社が指定するアクセス方法以外の手段で本サービスにアクセスし、またはアクセスを試みる行為</p>
                            <p>(17) 自動化された手段（クローラおよび類似の技術を含む）を用いて本サービスにアクセスし、またはアクセスを試みる行為</p>
                        </div>
                    </div>
                </div>
            </details>

            {/* e4e4118: bg-gray-50 box → bg-elevated (also keeps Hinatazaka 700 links at 4.6:1). */}
            <section className="flex flex-col gap-3 rounded-lg bg-elevated p-4">
                <p className="text-small text-secondary">{t('tos.reviewOfficialTos')}</p>
                <ul className="flex flex-wrap gap-x-4 gap-y-2">
                    {OFFICIAL_TOS.map((link) => (
                        <TosLink key={link.href} service={link.service} href={link.href} label={t(link.labelKey)} />
                    ))}
                </ul>
            </section>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors duration-fast ease-standard hover:bg-sunken">
                <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="text-body text-primary">{t('tos.acceptCheckbox')}</span>
            </label>
        </Modal>
    );
};
```

- [ ] **Step 6: Boot and ToS backdrop in the app (pending decision D7)** — `frontend/src/shell/App.tsx`:
  - imports: add `EntryBackdrop` to the `./components` import and `import { BrandScope } from '../design/brandScope'`.
  - the loading return becomes (`e4e4118`: `bg-[#F0F2F5]` + `Loader2 text-blue-500`; blue → ink):

```tsx
        return (
            <BrandScope className="flex h-screen items-center justify-center bg-window">
                <span data-testid="boot-screen" role="status" aria-label={t('common.loading')}>
                    <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-accent motion-reduce:animate-none" />
                </span>
            </BrandScope>
        );
```

  - the ToS return becomes:

```tsx
        return (
            <>
                <EntryBackdrop />
                <TosDialog onAccept={() => setTosAccepted(true)} />
            </>
        );
```

  - in the main return, as the first child of `<div className="flex flex-1 overflow-hidden">`, add `{(isOnboarding || showSyncModal) && <EntryBackdrop />}` with the comment `{/* First launch (login carousel, setup, first sync) and blocking syncs: the brand orbs behind the dialogs (spec §9). The layout is hidden meanwhile. */}`.
  - update the comment above `tokenGroup` to: "Group design tokens on the document: the active group's once ToS is accepted and a group is chosen, the `default` group before that. Its accent roles equal the brand; the entry screens set brand scope on themselves (R-d), so no screen reads its group roles."

- [ ] **Step 7: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/shell src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (`App.neutralTokens.test.tsx` still passes: the document keeps the `default` tokens). Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `shell/components/TosDialog.tsx` (3) removed; nothing else changes.

- [ ] **Step 8: Commit**

```bash
git add frontend
uv run git commit -m "feat(entry): put boot and ToS on the brand with group links" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Landing page: brand atmosphere and group-marker cards (pending decision D4)

**Files:**
- Modify: `frontend/src/pages/LandingPage.tsx`, `frontend/src/pages/LandingPage.test.tsx`, `frontend/src/shell/components/entryFlow.test.tsx`, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `useGroupMarker(…, 'landing')`, `ring-accent-logo` (Task 1), `BrandScope`, `Atmosphere`, `Button disabledReason`.
- Produces: `data-testid` hooks `landing-card-<serviceId>`, `landing-check`, `landing-logo` (used by Task 16's review only).

- [ ] **Step 1: Write the failing tests** — `frontend/src/pages/LandingPage.test.tsx`: replace the first three `it(…)` blocks (`'is one sheet on the canvas …'`, `'a picked card is a subtle selection …'`, `'keeps the feature chips visible …'`) with:

```tsx
    it('is a brand screen: one sheet on the aurora orbs with a serif display heading (R-d)', () => {
        const { container } = render(<LandingPage onComplete={vi.fn()} />);
        expect(container.firstChild).toHaveAttribute('data-scope', 'brand');
        expect(screen.getAllByTestId('atmosphere-orb')).toHaveLength(3);
        const heading = screen.getByRole('heading', { level: 1, name: 'Welcome to SakaDesk' });
        expect(heading).toHaveClass('font-display', 'text-display', 'font-bold');
        expect(heading.closest('.rounded-sheet')).not.toBeNull();
        expect(screen.getByRole('button', { name: /日向坂46/ })).toHaveAttribute('aria-pressed', 'false');
    });

    it('each card is a group marker; a picked card rings in its logo colour (R-d, pending decision D4)', async () => {
        render(<LandingPage onComplete={vi.fn()} />);
        const card = screen.getByTestId('landing-card-sakurazaka46');
        expect(card.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(card.style.getPropertyValue('--ds-accent-logo')).toBe(groupRoles('sakurazaka').logo);
        expect(card).toHaveClass('bg-card', 'hover:-translate-y-px', 'hover:shadow-accent-glow-hover');
        expect(card).not.toHaveClass('ring-accent-logo');
        await userEvent.click(card);
        expect(card).toHaveAttribute('aria-pressed', 'true');
        expect(card).toHaveClass('ring-2', 'ring-accent-logo', 'shadow-accent-glow');
        expect(within(card).getByTestId('landing-check')).toHaveClass('bg-accent', 'text-inverse');
        expect(within(card).getByTestId('landing-logo')).toHaveClass('ring-2', 'ring-accent-logo');
        expect(within(card).getByText('櫻坂46')).toHaveAttribute('lang', 'ja');
        expect(screen.getByRole('button', { name: 'Get Started' })).toHaveClass('bg-accent-gradient');
    });

    it('keeps the feature chips neutral (e4e4118: bg-gray-100 text-gray-500)', () => {
        render(<LandingPage onComplete={vi.fn()} />);
        const chip = screen.getAllByText('Messages')[0];
        expect(chip).toHaveClass('bg-sunken', 'text-secondary');
    });
```

  add `within` to the `@testing-library/react` import and `import { groupRoles } from '../design/tokens';`. In the last test (`'is disabled with nothing picked, …'`) replace both `toBeDisabled()` with `toHaveAttribute('aria-disabled', 'true')`, and rename it `'blocks Get Started with a reason while nothing is picked, …'`.
  - `frontend/src/shell/components/entryFlow.test.tsx`, `describe('landing page'`: replace `.toBeDisabled()` with `.toHaveAttribute('aria-disabled', 'true')`.

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/pages/LandingPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the landing page** — `frontend/src/pages/LandingPage.tsx`

```tsx
import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { SERVICES, type ServiceDefinition } from '../data/services';
import { SERVICE_FEATURES, FEATURE_DEFINITIONS } from '../config/features';
import { Atmosphere, Button, Sheet } from '../design/primitives';
import { BrandScope } from '../design/brandScope';
import { useGroupMarker } from '../design/useGroupMarker';
import { cn } from '../utils/classnames';
import { useTranslation } from '../i18n';

interface LandingPageProps {
    onComplete: (selectedServices: string[]) => void;
}

interface GroupCardProps {
    service: ServiceDefinition;
    selected: boolean;
    onToggle: () => void;
}

/**
 * One group's toggle card: a group marker in that group's colours (spec §4, §9). Picked: the
 * pre-D2 ring in the group's logo colour on the card and the logo circle; the check disc in
 * step 600 so the white check reads (decision D4). Hover lifts and glows (spec §8).
 */
const GroupCard: React.FC<GroupCardProps> = ({ service, selected, onToggle }) => {
    const { t } = useTranslation();
    const marker = useGroupMarker(service.id, 'landing');
    return (
        <button
            type="button"
            data-testid={`landing-card-${service.id}`}
            aria-pressed={selected}
            onClick={onToggle}
            style={marker}
            className={cn(
                'group relative flex flex-col items-start gap-3 rounded-lg bg-card p-6 text-left shadow-card transition duration-fast ease-standard',
                'hover:-translate-y-px hover:shadow-accent-glow-hover active:scale-97',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                selected && 'shadow-accent-glow ring-2 ring-accent-logo',
            )}
        >
            <span
                data-testid="landing-check"
                aria-hidden="true"
                className={cn(
                    'absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-fast ease-standard',
                    selected ? 'bg-accent text-inverse' : 'border-2 border-strong',
                )}
            >
                {selected && <Check className="h-4 w-4" />}
            </span>

            <span
                data-testid="landing-logo"
                className={cn(
                    'flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-card shadow-pill transition-shadow duration-fast ease-standard',
                    selected && 'ring-2 ring-accent-logo ring-offset-2 ring-offset-surface',
                )}
            >
                {/* Decorative: the card's name already says which group it is. */}
                {service.logoUrl ? (
                    <img
                        src={service.logoUrl}
                        alt=""
                        className="h-12 w-12 object-contain"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                    />
                ) : null}
                <span className={cn('text-title font-semibold text-secondary', service.logoUrl ? 'hidden' : '')}>
                    {service.shortCode}
                </span>
            </span>

            <span className="flex flex-col gap-1">
                <span lang="ja" className="text-title font-semibold text-primary">{service.displayName}</span>
                <span className="text-small text-secondary">{service.name}</span>
            </span>

            <span className="flex flex-wrap gap-1">
                {(SERVICE_FEATURES[service.id] || []).map((featureId) => {
                    const feature = FEATURE_DEFINITIONS[featureId];
                    const Icon = feature.icon;
                    return (
                        <span key={featureId} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-1 text-caption text-secondary">
                            <Icon className="h-3 w-3" />
                            {t(`features.${featureId}`)}
                        </span>
                    );
                })}
            </span>
        </button>
    );
};

/**
 * Pick the groups to follow (first launch, or every group removed): a brand screen on the aurora
 * orbs (spec §4, §5 L2, §9) with one sheet, one marker card per group and one primary button.
 */
export const LandingPage: React.FC<LandingPageProps> = ({ onComplete }) => {
    const { t } = useTranslation();
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const toggleService = (serviceId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(serviceId)) {
                next.delete(serviceId);
            } else {
                next.add(serviceId);
            }
            return next;
        });
    };

    const handleGetStarted = () => {
        if (selected.size > 0) {
            onComplete(Array.from(selected));
        }
    };

    return (
        <BrandScope className="min-h-screen bg-window">
            <Atmosphere className="min-h-screen">
                <div className="flex min-h-screen items-center justify-center p-4">
                    <Sheet className="flex w-full max-w-4xl flex-col gap-8 p-10 animate-reveal motion-reduce:animate-none">
                        <header className="flex flex-col gap-2 text-center">
                            <h1 className="font-display text-display font-bold text-primary">{t('landing.welcome')}</h1>
                            <p className="text-body text-secondary">{t('landing.selectGroups')}</p>
                        </header>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            {SERVICES.map((service) => (
                                <GroupCard
                                    key={service.id}
                                    service={service}
                                    selected={selected.has(service.id)}
                                    onToggle={() => toggleService(service.id)}
                                />
                            ))}
                        </div>

                        <div className="flex flex-col items-center gap-4">
                            <Button
                                variant="primary"
                                className="px-8"
                                onClick={handleGetStarted}
                                disabledReason={selected.size === 0 ? t('landing.selectAtLeastOne') : undefined}
                            >
                                {selected.size === 0
                                    ? t('landing.selectAtLeastOne')
                                    : selected.size === 1
                                        ? t('landing.getStarted')
                                        : t('landing.getStartedWith', { count: selected.size })}
                            </Button>
                            <p className="text-center text-small text-muted">{t('landing.footerNote')}</p>
                        </div>
                    </Sheet>
                </div>
            </Atmosphere>
        </BrandScope>
    );
};
```

  (`Sheet` renders `rounded-sheet`, which the first test checks. `useGroupMarker` returns the group scope, which includes `--ds-accent-logo`.)

- [ ] **Step 4: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/pages src/shell && npx tsc --noEmit && npm run lint`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `pages/LandingPage.tsx` (4) removed; nothing else changes.

- [ ] **Step 5: Commit**

```bash
git add frontend
uv run git commit -m "feat(entry): restore landing group cards as group markers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Setup wizard: brand, icon, validate on click (pending decision D1)

**Files:**
- Modify: `frontend/src/shell/components/SetupWizard.tsx`, `frontend/src/shell/components/entryDialogs.test.tsx`, `frontend/src/shell/components/entryFlow.test.tsx`, `frontend/src/i18n/rD.test.ts`, the five locale files, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `clientLog('entry_validation', { surface: 'setup', reason: 'missing_folder' })` (Task 1).
- Produces: i18n key `setup.folderRequired`. `SetupWizardProps` unchanged (`isValid` still decides; the button no longer disables).

- [ ] **Step 1: Write the failing tests**
  - `entryDialogs.test.tsx`, append:

```tsx
describe('setup (R-d)', () => {
    const props = { outputDirInput: '', setOutputDirInput: vi.fn(), setupBlogFullBackup: false, setSetupBlogFullBackup: vi.fn(), onSelectFolder: vi.fn(), onComplete: vi.fn() };

    it('is a brand dialog with the folder icon, the ink checkbox and the e4e4118 near-white option box (pending decision D1)', () => {
        render(<SetupWizard {...props} isValid={false} />);
        expect(screen.getByRole('dialog', { name: 'Welcome to SakaDesk' })).toHaveAttribute('data-scope', 'brand');
        expect(screen.getByTestId('modal-header-icon').querySelector('svg.lucide-folder-open')).not.toBeNull();
        const checkbox = screen.getByRole('checkbox', { name: /Download blogs for search/ });
        expect(checkbox).toHaveClass('accent-accent');
        expect(checkbox.closest('label')).toHaveClass('bg-elevated');
    });

    it('validates on click: says what is missing, focuses the field and logs it', async () => {
        const onComplete = vi.fn();
        const { rerender } = render(<SetupWizard {...props} onComplete={onComplete} isValid={false} />);
        const start = screen.getByRole('button', { name: 'Start Using SakaDesk' });
        expect(start).not.toBeDisabled();
        expect(start).not.toHaveAttribute('aria-disabled');
        await userEvent.click(start);
        expect(onComplete).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('setup.folderRequired'));
        const field = screen.getByLabelText('Output Folder Path');
        expect(field).toHaveFocus();
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(clientLog).toHaveBeenCalledWith('entry_validation', { surface: 'setup', reason: 'missing_folder' });
        rerender(<SetupWizard {...props} outputDirInput="C:\\データ" onComplete={onComplete} isValid />);
        expect(screen.queryByRole('alert')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Start Using SakaDesk' }));
        expect(onComplete).toHaveBeenCalledOnce();
    });
});
```

  - `entryFlow.test.tsx`, in `it('types the folder, browses, opts into blogs; Start waits for a valid folder'`: replace the last line `expect(screen.getByRole('button', { name: 'Start Using SakaDesk' })).toBeDisabled();` with:

```tsx
        await userEvent.click(screen.getByRole('button', { name: 'Start Using SakaDesk' }));
        expect(p.onComplete).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('setup.folderRequired'));
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/shell/components/entryDialogs.test.tsx src/shell/components/entryFlow.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the key** `setup.folderRequired` to the `setup` section of each locale, and append `'setup.folderRequired'` to `RD_KEYS`:
  - en: `"folderRequired": "Enter or choose a folder first"`
  - ja: `"folderRequired": "先にフォルダを入力するか選択してください"`
  - zh-CN: `"folderRequired": "请先输入或选择文件夹"`
  - zh-TW: `"folderRequired": "請先輸入或選擇資料夾"`
  - yue: `"folderRequired": "請先輸入或者揀一個資料夾"`

- [ ] **Step 4: Rewrite the wizard (pending decision D1)** — `frontend/src/shell/components/SetupWizard.tsx`

```tsx
import React, { useId, useRef, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Input, Modal } from '../../design/primitives';
import { clientLog } from '../../utils/clientLog';

interface SetupWizardProps {
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    setupBlogFullBackup: boolean;
    setSetupBlogFullBackup: (enabled: boolean) => void;
    onSelectFolder: () => void;
    onComplete: () => void;
    isValid: boolean;
}

/**
 * First-launch output folder: a brand dialog (spec §4), not dismissible, one primary (D2d
 * decisions 4, 17, 18). A form never disables its submit (spec §8): Start validates on click,
 * says what is missing and focuses the field.
 */
export const SetupWizard: React.FC<SetupWizardProps> = ({
    outputDirInput,
    setOutputDirInput,
    setupBlogFullBackup,
    setSetupBlogFullBackup,
    onSelectFolder,
    onComplete,
    isValid,
}) => {
    const { t } = useTranslation();
    const inputId = useId();
    const errorId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [triedEmpty, setTriedEmpty] = useState(false);
    // A folder chosen with Browse (or typed) clears the message without another click.
    const missing = triedEmpty && !isValid;

    const handleStart = () => {
        if (!isValid) {
            setTriedEmpty(true);
            clientLog('entry_validation', { surface: 'setup', reason: 'missing_folder' });
            inputRef.current?.focus();
            return;
        }
        onComplete();
    };

    return (
        <Modal
            isOpen
            onClose={() => {}}
            scope="brand"
            title={t('setup.welcome')}
            icon={<FolderOpen />}
            dismissible={false}
            logId="setup"
            className="max-w-md"
            bodyClassName="flex flex-col gap-4"
            footer={
                <Button variant="primary" className="w-full" onClick={handleStart}>
                    {t('setup.startUsing')}
                </Button>
            }
        >
            <p className="text-small text-muted">{t('setup.setupDataFolder')}</p>

            <div className="flex flex-col gap-2">
                <label htmlFor={inputId} className="text-small font-semibold text-secondary">
                    {t('setup.outputFolderPath')}
                </label>
                <div className="flex gap-2">
                    <Input
                        ref={inputRef}
                        id={inputId}
                        value={outputDirInput}
                        onChange={(e) => setOutputDirInput(e.target.value)}
                        placeholder={t('setup.outputFolderPlaceholder')}
                        aria-invalid={missing || undefined}
                        aria-describedby={missing ? errorId : undefined}
                        className="flex-1"
                    />
                    <Button variant="secondary" onClick={onSelectFolder}>{t('common.browse')}</Button>
                </div>
                <p className="text-caption text-muted">{t('setup.outputFolderHint')}</p>
                {missing && (
                    <p id={errorId} role="alert" className="text-caption text-status-danger">{t('setup.folderRequired')}</p>
                )}
            </div>

            {/* Blog Sync Mode Option (e4e4118: bg-gray-50 box, blue checkbox → bg-elevated, ink) */}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-elevated p-4">
                <input
                    type="checkbox"
                    checked={setupBlogFullBackup}
                    onChange={(e) => setSetupBlogFullBackup(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="flex flex-col gap-1">
                    <span className="text-small font-semibold text-primary">{t('setup.downloadBlogsOffline')}</span>
                    <span className="text-caption text-secondary">{t('setup.downloadBlogsHint')}</span>
                </span>
            </label>
        </Modal>
    );
};
```

- [ ] **Step 5: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/shell src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (`entryShells.test.tsx` still passes: setup stays a named, non-dismissible dialog). Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `shell/components/SetupWizard.tsx` (1) removed; nothing else changes.

- [ ] **Step 6: Commit**

```bash
git add frontend
uv run git commit -m "feat(entry): make setup a brand form that validates on click" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sync rows: brand sync dialog, marker step row, restored bar and warnings (pending decisions D1, D5)

**Files:**
- Modify: `frontend/src/shell/hooks/useSync.ts` (`SequentialSyncInfo.services`)
- Modify: `frontend/src/core/common/SyncProgressPanel.tsx`, `frontend/src/shell/components/SyncModal.tsx`, `frontend/src/core/layout/InlineSyncView.tsx`
- Modify: `frontend/src/shell/components/syncScreens.test.tsx`, `frontend/src/shell/components/entryFlow.test.tsx`, `frontend/src/shell/components/SyncModal.test.tsx`, `frontend/src/design/guard-baseline.json`

**Interfaces:**
- Consumes: `bg-expressive-progress`, `ring-accent-subtle`, `useGroupMarker(…, 'sync_row')` (Task 1), `Modal icon`.
- Produces: `SequentialSyncInfo = { total: number; currentIndex: number; currentService: string; services: string[] }` (Task 9 reads it unchanged); test ids `sync-progress-fill`, `sync-detail`, `sync-media-warning`, `sync-step-dot-<phase>`, `sync-step-<serviceId>`, `sync-service-chip`, `sync-unresolved`.

- [ ] **Step 1: Write the failing tests** — `frontend/src/shell/components/syncScreens.test.tsx`: replace the imports' `groupRoles` line with `import { brandAccent, groupAccent, groupRoles } from '../../design/tokens';`, add `within` to the testing-library import, delete the tests `'a sequential sync shows the syncing service’s colours and its step bars'` and `'keeps the last synced service’s colours on Complete after the sequence ends'`, and append:

```tsx
const VERIFIED: SyncProgress = {
    state: 'complete', phase: 'complete', phase_number: 3, completed: 40, total: 40,
    elapsed_seconds: 12, eta_seconds: 0, speed: 3, speed_unit: 'files',
    result: {
        members: 2, checked: 40, missing: 3, repaired: 1, failed: 0, still_missing: 2, unresolved: 1,
        unresolved_items: [{ member: '金村 美玖', timestamp: '2026-11-01T10:00:00Z', media_type: 'voice' }],
    },
};

describe('sync dialog (R-d, pending decision D5)', () => {
    it('is a brand dialog with the download icon and the aurora fill on a 16 px track (pending decision D1)', () => {
        render(<SyncModal syncProgress={RUNNING} />);
        const dialog = screen.getByRole('dialog', { name: 'Phase 1: Scanning Groups' });
        expect(dialog).toHaveAttribute('data-scope', 'brand');
        expect(dialog.style.getPropertyValue('--ds-expressive-progress')).toBe(brandAccent().progress);
        expect(screen.getByTestId('modal-header-icon').querySelector('svg.lucide-download')).not.toBeNull();
        expect(screen.getByRole('progressbar')).toHaveClass('h-4', 'bg-sunken');
        expect(screen.getByTestId('sync-progress-fill')).toHaveClass('bg-expressive-progress');
    });

    it('draws each step of a sequential sync in its own group colour and names the current group', () => {
        render(<SyncModal syncProgress={RUNNING} sequentialSyncInfo={{ total: 2, currentIndex: 1, currentService: 'sakurazaka46', services: ['hinatazaka46', 'sakurazaka46'] }} />);
        const done = screen.getByTestId('sync-step-hinatazaka46');
        const current = screen.getByTestId('sync-step-sakurazaka46');
        expect(done.style.getPropertyValue('--ds-accent')).toBe(groupRoles('hinatazaka').action);
        expect(current.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(done).toHaveClass('w-6', 'bg-accent');
        expect(current).toHaveClass('w-10', 'bg-accent');
        const chip = screen.getByTestId('sync-service-chip');
        expect(chip.style.getPropertyValue('--ds-accent')).toBe(groupRoles('sakurazaka').action);
        expect(within(chip).getByText('櫻坂46 (2/2)')).toHaveAttribute('lang', 'ja');
        // The panel itself stays brand.
        expect(screen.getByTestId('sync-detail').closest('[style*="--ds-group-accent"]')).toBeNull();
    });

    it('shows the running step and the detail row in the ink accent (e4e4118: blue-500, ring-blue-100, bg-blue-50)', () => {
        render(<SyncModal syncProgress={RUNNING} />);
        expect(screen.getByTestId('sync-step-dot-scanning')).toHaveClass('bg-accent', 'ring-4', 'ring-accent-subtle');
        expect(screen.getByText('Scan')).toHaveClass('text-accent-strong');
        expect(screen.getByTestId('sync-detail')).toHaveClass('bg-accent-subtle');
        expect(screen.getByTestId('sync-detail').querySelector('svg')).toHaveClass('text-accent');
    });

    it('warns about the media phase in the semantic warning colours (e4e4118: amber-50 / amber-100 / amber-700)', () => {
        render(<SyncModal syncProgress={{ ...RUNNING, phase: 'downloading', phase_number: 3 }} />);
        expect(screen.getByTestId('sync-media-warning')).toHaveClass('bg-semantic-warning-subtle', 'border-semantic-warning', 'text-semantic-warning');
    });

    it('lists unresolved items on a warning panel with Japanese member names', () => {
        render(<SyncModal syncProgress={VERIFIED} onClose={vi.fn()} />);
        const panel = screen.getByTestId('sync-unresolved');
        expect(panel).toHaveClass('border', 'border-semantic-warning');
        expect(panel.firstElementChild).toHaveClass('bg-semantic-warning-subtle', 'text-semantic-warning');
        expect(within(panel).getByText('金村 美玖')).toHaveAttribute('lang', 'ja');
    });
});

describe('inline sync view (R-d)', () => {
    it('keeps its group: the accent-subtle disc and the official bar as the progress fill on Sakurazaka', () => {
        render(<InlineSyncView service="sakurazaka46" syncProgress={RUNNING} />);
        const banner = screen.getByTestId('inline-sync-banner');
        expect(banner.querySelector('span[aria-hidden="true"]')).toHaveClass('bg-accent-subtle');
        const card = banner.parentElement as HTMLElement;
        expect(card.style.getPropertyValue('--ds-expressive-progress')).toBe(groupAccent('sakurazaka').progress);
        expect(screen.getByTestId('sync-progress-fill')).toHaveClass('bg-expressive-progress');
    });
});
```

  In the same file, in `'Done and Cancel are secondary buttons'` replace `.not.toHaveClass('bg-group-accent')` with `.not.toHaveClass('bg-accent-gradient')`.
  - `entryFlow.test.tsx`: the `sequentialSyncInfo` literal becomes `{ total: 3, currentIndex: 1, currentService: 'hinatazaka46', services: ['sakurazaka46', 'hinatazaka46', 'nogizaka46'] }`.
  - `SyncModal.test.tsx`: add `services: ['hinatazaka46', 'sakurazaka46'],` to the `total: 2` literal and `services: ['hinatazaka46'],` to the `total: 1` literal.

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/shell/components/syncScreens.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Carry the service list** — `frontend/src/shell/hooks/useSync.ts`: in `SequentialSyncInfo` add

```ts
    /** Every service of the sequence, in sync order (the dialog's step row shows one marker each). */
    services: string[];
```

  and in `startSequentialSync` the call becomes `setSequentialSyncInfo({ total: services.length, currentIndex: i, currentService: service, services });`. Run `npx tsc --noEmit` and add `services` to any other literal it flags.

- [ ] **Step 4: Restore the shared panel (pending decision D5)** — `frontend/src/core/common/SyncProgressPanel.tsx`, replace the returned JSX with:

```tsx
    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <div className="flex justify-between text-small font-semibold tabular-nums">
                    <span className="text-secondary">
                        {progress.completed?.toLocaleString() || 0} / {progress.total?.toLocaleString() || 0}
                    </span>
                    <span className="text-primary">{`${percent}%`}</span>
                </div>
                {/* e4e4118: h-4 bg-gray-100 track; fill = the pastel (dialog) or the title gradient (inline). */}
                <div
                    role="progressbar"
                    aria-label={t('sync.progress')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    aria-valuetext={`${progress.completed?.toLocaleString() || 0} / ${progress.total?.toLocaleString() || 0}`}
                    className="h-4 overflow-hidden rounded-full bg-sunken"
                >
                    <div
                        data-testid="sync-progress-fill"
                        className="h-full rounded-full bg-expressive-progress transition-all duration-base ease-standard motion-reduce:transition-none"
                        style={{ width: `${ratio * 100}%` }}
                    />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
                {stats.map((s) => (
                    <div key={s.key} className="flex flex-col gap-1 rounded-lg bg-elevated p-3 text-center">
                        <span className="text-caption text-secondary">{s.label}</span>
                        <span className="font-mono text-title font-semibold tabular-nums text-primary">{s.value}</span>
                        <span className="min-h-4 text-caption text-secondary">{s.unit}</span>
                    </div>
                ))}
            </div>

            {/* Only while running: on completion the backend leaves phase_number at 3, and the
                "do not close" line (and the spinner) would make a finished sync look stuck. */}
            {progress.state === 'running' && (progress.phase_number === 3 ? (
                <div
                    data-testid="sync-media-warning"
                    className="flex items-center justify-center gap-2 rounded-lg border border-semantic-warning bg-semantic-warning-subtle px-4 py-3 text-semantic-warning"
                >
                    <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
                    <span className="text-small font-semibold">{t('sync.downloadingMedia')}</span>
                </div>
            ) : (
                <div data-testid="sync-detail" className="flex items-center gap-2 rounded-lg bg-accent-subtle px-4 py-3">
                    <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
                    <span className="truncate text-small font-semibold text-primary">
                        {getSyncDetail(progress, t, t('sync.processing'))}
                        {progress.detail_extra && ` ${progress.detail_extra}`}
                    </span>
                </div>
            ))}

            <ol className="flex justify-center gap-6">
                {steps.map((step) => {
                    const isActive = progress.phase === step.phase || (step.phase === 'scanning' && progress.phase === 'discovering');
                    const isComplete = currentIndex > PHASE_ORDER.indexOf(step.phase);
                    return (
                        <li key={step.phase} aria-current={isActive ? 'step' : undefined} className="flex flex-col items-center gap-1">
                            <span
                                data-testid={`sync-step-dot-${step.phase}`}
                                aria-hidden="true"
                                className={cn(
                                    'flex h-3 w-3 items-center justify-center rounded-full transition-colors duration-fast ease-standard',
                                    isActive ? 'bg-accent ring-4 ring-accent-subtle' : isComplete ? 'bg-status-success' : 'bg-control-off',
                                )}
                            >
                                {isComplete && !isActive && <Check className="h-2 w-2 text-inverse" strokeWidth={4} />}
                            </span>
                            <span className={cn('text-caption', isActive ? 'font-semibold text-accent-strong' : 'text-secondary')}>{step.label}</span>
                            <span className="sr-only">{isActive ? t('sync.stepCurrent') : isComplete ? t('sync.stepDone') : t('sync.stepPending')}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
```

  and update the doc comment: "The shared body of the sync dialog (brand) and the inline sync view (its group): count and percent, the progress bar (`bg-expressive-progress`: aurora in brand, the title gradient in a group, as `e4e4118`), three stat tiles, the detail row (accent) or the media warning (semantic warning) while running, and the phase steps."

- [ ] **Step 5: Rewrite the sync dialog (pending decisions D1, D5)** — `frontend/src/shell/components/SyncModal.tsx`

```tsx
// frontend/src/shell/components/SyncModal.tsx
import React from 'react';
import { AlertTriangle, Download, Image as ImageIcon, Mic, Video } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Modal } from '../../design/primitives';
import { useGroupMarker } from '../../design/useGroupMarker';
import { cn, formatDateTime } from '../../utils/classnames';
import { getServiceById } from '../../data/services';
import { getSyncPhaseName, getSyncUnitLabel } from '../../utils/syncFormatters';
import { SyncProgressPanel } from '../../core/common/SyncProgressPanel';
import type { SyncProgress } from '../../features/messages/MessagesFeature';
import type { SequentialSyncInfo } from '../hooks/useSync';

interface SyncModalProps {
    syncProgress: SyncProgress;
    sequentialSyncInfo?: SequentialSyncInfo | null;
    onClose?: () => void;
    /** SD-FE-GAP-B-08: cancel a running sync so the user is never locked to a
        non-terminating spinner (e.g. a hung verify). */
    onCancel?: () => void;
}

/** One service's step in a sequential sync: a group marker (spec §4 "rows are markers"; decision D5). */
const SyncStepBar: React.FC<{ serviceId: string; state: 'done' | 'current' | 'pending' }> = ({ serviceId, state }) => {
    const marker = useGroupMarker(serviceId, 'sync_row');
    return (
        <span
            data-testid={`sync-step-${serviceId}`}
            aria-hidden="true"
            style={marker}
            className={cn(
                'h-1 rounded-full transition-all duration-base ease-standard motion-reduce:transition-none',
                state === 'pending' ? 'w-6 bg-control-off' : state === 'current' ? 'w-10 bg-accent' : 'w-6 bg-accent',
            )}
        />
    );
};

/** The service being synced and its place in the sequence, in that group's colour. */
const SyncServiceChip: React.FC<{ serviceId: string; label: string }> = ({ serviceId, label }) => {
    const marker = useGroupMarker(serviceId, 'sync_row');
    return (
        <span data-testid="sync-service-chip" style={marker} className="ml-2 inline-flex items-center gap-1 text-caption font-semibold">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent" />
            <span lang="ja" className="text-accent-strong">{label}</span>
        </span>
    );
};

/**
 * The blocking sync dialog: a brand dialog (spec §4) whose sequential step row names each group
 * as a marker (decision D5). Not dismissible; Done or Cancel (D2d decisions 4, 6, 9–11, 17, 19).
 */
export const SyncModal: React.FC<SyncModalProps> = ({ syncProgress, sequentialSyncInfo, onClose, onCancel }) => {
    const { t } = useTranslation();
    const isComplete = syncProgress.phase === 'complete';
    const title = isComplete
        ? t('sync.complete')
        : t('sync.phase', { number: syncProgress.phase_number || 1, name: getSyncPhaseName(syncProgress, t) });
    const subtitle = isComplete
        ? t('sync.syncComplete')
        : syncProgress.total
            ? `${syncProgress.total.toLocaleString()} ${getSyncUnitLabel(syncProgress, t)}`
            : t('sync.pleaseWait');
    const serviceName = sequentialSyncInfo
        ? getServiceById(sequentialSyncInfo.currentService)?.displayName ?? sequentialSyncInfo.currentService
        : null;
    const result = syncProgress.state === 'complete' ? syncProgress.result : null;
    const unresolved = result?.unresolved ?? 0;

    const footer = (syncProgress.state === 'complete' || syncProgress.state === 'error') && onClose
        ? <Button variant="secondary" onClick={onClose}>{t('common.done')}</Button>
        // SD-FE-GAP-B-08: while running, offer a Cancel so the user is never trapped by a spinner.
        : syncProgress.state === 'running' && onCancel
            ? <Button variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
            : undefined;

    return (
        <Modal
            isOpen
            onClose={onClose ?? (() => {})}
            scope="brand"
            title={title}
            icon={<Download />}
            dismissible={false}
            logId="sync"
            className="max-w-lg"
            footer={footer}
        >
            <div className="flex flex-col gap-5">
                {sequentialSyncInfo && sequentialSyncInfo.total > 1 && (
                    <div className="flex items-center justify-center gap-2">
                        {sequentialSyncInfo.services.map((serviceId, i) => (
                            <SyncStepBar
                                key={serviceId}
                                serviceId={serviceId}
                                state={i < sequentialSyncInfo.currentIndex ? 'done' : i === sequentialSyncInfo.currentIndex ? 'current' : 'pending'}
                            />
                        ))}
                        <SyncServiceChip
                            serviceId={sequentialSyncInfo.currentService}
                            label={`${serviceName} (${sequentialSyncInfo.currentIndex + 1}/${sequentialSyncInfo.total})`}
                        />
                    </div>
                )}

                <p className="text-small text-secondary">{subtitle}</p>

                {result && (
                    <div className="flex flex-col gap-2 text-small text-secondary">
                        <p>
                            {result.missing === 0 && unresolved === 0
                                ? t('settings.verifyNoGaps')
                                : t('settings.verifySummary', {
                                    checked: result.checked,
                                    repaired: result.repaired,
                                    stillMissing: result.still_missing,
                                })}
                        </p>
                        {/* e4e4118: border-amber-100, heading bg-amber-50 text-amber-700, icons amber-500. */}
                        {unresolved > 0 && (
                            <div data-testid="sync-unresolved" className="flex flex-col overflow-hidden rounded-lg border border-semantic-warning">
                                <p className="flex items-center gap-2 bg-semantic-warning-subtle px-4 py-3 font-semibold text-semantic-warning">
                                    <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
                                    {t('settings.verifyUnresolved', { count: unresolved })}
                                </p>
                                {(result.unresolved_items?.length ?? 0) > 0 && (
                                    <ul className="flex max-h-44 flex-col divide-y divide-subtle overflow-y-auto">
                                        {result.unresolved_items!.map((it, i) => {
                                            const Icon = it.media_type === 'video' ? Video : it.media_type === 'voice' ? Mic : ImageIcon;
                                            return (
                                                <li key={i} className="flex items-center gap-2 px-4 py-2">
                                                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-semantic-warning" />
                                                    <span lang="ja" className="flex-1 truncate text-secondary">{it.member}</span>
                                                    <span className="shrink-0 tabular-nums text-muted">
                                                        {it.timestamp ? formatDateTime(it.timestamp) : ''}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <SyncProgressPanel progress={syncProgress} />
            </div>
        </Modal>
    );
};
```

  (`divide-subtle` reads the `subtle` border colour; Tailwind's divide utilities use the `borderColor` theme.)

- [ ] **Step 6: The inline view's disc** — `frontend/src/core/layout/InlineSyncView.tsx`: in the icon disc replace `'bg-group-subtle'` with `'bg-accent-subtle'` (`e4e4118`: `theme.modals.accentColorLight`); update its doc comment's last sentence to "a card scoped to the service (its group context, D2d decision 13) with its official banner (like the chat header) and the shared panel, whose bar is that group's title gradient (`e4e4118`)."

- [ ] **Step 7: Run to verify they pass, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/shell src/core && npx tsc --noEmit && npm run lint`
Expected: PASS. Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/common/SyncProgressPanel.tsx` (5), `core/layout/InlineSyncView.tsx` (1), `shell/components/SyncModal.tsx` (2) removed; nothing else changes.

- [ ] **Step 8: Commit**

```bash
git add frontend
uv run git commit -m "feat(sync): brand sync dialog with group-marker steps and warnings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Empty states on the `EmptyState` pattern (pending decision D6)

**Files:**
- Modify: `frontend/src/core/common/DialogStatus.tsx`, `frontend/src/core/common/DialogStatus.test.tsx`
- Modify: `frontend/src/features/blogs/components/BlogStatus.tsx`, `frontend/src/features/blogs/components/BlogStatus.test.tsx`
- Modify: `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/shell/App.integration.test.tsx`

**Interfaces:**
- Consumes: `EmptyState` with the muted icon (Task 1).
- Produces: `DialogStatus` / `BlogStatus` props unchanged; `kind="empty"` now renders `EmptyState` inside a `role="status"` wrapper (title = `title`, description = `hint`, action = the retry button when both `onRetry` and `retryLabel` are given).

- [ ] **Step 1: Write the failing tests**
  - `frontend/src/core/common/DialogStatus.test.tsx`: in `'tints the spinner and tiles, …'` replace `expect(container.querySelector('span[aria-hidden]')).toHaveClass('bg-expressive-soft', 'text-accent-strong');` with:

```tsx
        expect(screen.getByTestId('empty-state-circle')).toHaveClass('bg-expressive-soft', 'text-muted');
```

    and append:

```tsx
    it('draws an empty dialog as the brand-moment pattern: soft circle, serif title, hint (R-d)', () => {
        render(<DialogStatus kind="empty" icon={<Star />} title="お気に入りなし" hint="長押しで追加 ⭐" className="py-8" />);
        const status = screen.getByRole('status');
        expect(status).toHaveClass('py-8');
        expect(screen.getByRole('heading', { name: 'お気に入りなし' })).toHaveClass('font-display');
        expect(status).toContainElement(screen.getByTestId('empty-state-circle'));
        expect(screen.getByText('長押しで追加 ⭐')).toHaveClass('text-secondary');
    });
```

  - `frontend/src/features/blogs/components/BlogStatus.test.tsx`: in `'tints the loading spinner …'` replace the last line with:

```tsx
        expect(screen.getByTestId('empty-state-circle')).toHaveClass('bg-expressive-soft', 'text-muted');
        expect(screen.getByRole('heading', { name: 'None' })).toHaveClass('font-display');
```

    add `import { render, screen, fireEvent, within } from '@testing-library/react';` if `within` is needed (it is not) and append:

```tsx
    it('keeps the empty block height and fills the area for the first sync (R-d)', () => {
        const { rerender } = render(<BlogStatus kind="empty" title="記事がありません 📰" icon={<svg data-testid="i" />} />);
        expect(screen.getByRole('status')).toHaveClass('h-72');
        rerender(<BlogStatus kind="empty" fill title="記事がありません 📰" icon={<svg data-testid="i" />} />);
        expect(screen.getByRole('status')).toHaveClass('h-full', 'min-h-96');
    });
```

  - `frontend/src/shell/App.integration.test.tsx`, append inside the `describe`:

```tsx
  it('shows the no-conversation screen as the empty-state pattern (R-d, pending decision D6)', async () => {
    renderApp()
    const title = await screen.findByRole('heading', { name: 'Welcome to SakaDesk' })
    expect(title).toHaveClass('font-display')
    expect(title.parentElement?.querySelector('[data-testid="empty-state-circle"]')).not.toBeNull()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/core/common/DialogStatus.test.tsx src/features/blogs/components/BlogStatus.test.tsx src/shell/App.integration.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** — `frontend/src/core/common/DialogStatus.tsx`

```tsx
import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button, EmptyState } from '../../design/primitives';
import { cn } from '../../utils/classnames';

export interface DialogStatusProps {
    kind: 'loading' | 'empty' | 'error';
    title?: string;        // translated
    hint?: string;         // translated
    icon?: React.ReactNode;
    onRetry?: () => void;
    retryLabel?: string;   // translated
    retryVariant?: 'secondary' | 'primary'; // default secondary
    className?: string;
}

/**
 * Loading, empty and error states inside a dialog (one component for every dialog's states).
 * Empty is the brand-moment pattern (`EmptyState`, spec §9): soft circle, muted line icon,
 * serif title, the hint as its one sentence, the retry as its one action.
 */
export const DialogStatus: React.FC<DialogStatusProps> = ({ kind, title, hint, icon, onRetry, retryLabel, retryVariant = 'secondary', className }) => {
    const retry = onRetry && retryLabel ? <Button variant={retryVariant} size="sm" onClick={onRetry}>{retryLabel}</Button> : undefined;
    if (kind === 'empty') {
        return (
            <div role="status" className={cn('flex flex-col items-center justify-center', className)}>
                <EmptyState icon={icon} title={title ?? ''} description={hint} action={retry} />
            </div>
        );
    }
    return (
        <div
            role={kind === 'error' ? 'alert' : 'status'}
            className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}
        >
            {kind === 'loading' && <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-accent motion-reduce:animate-none" />}
            {kind === 'error' && icon && (
                <span aria-hidden="true" className="flex rounded-card bg-semantic-danger-icon p-4 text-semantic-danger [&_svg]:h-8 [&_svg]:w-8">
                    {icon}
                </span>
            )}
            {title && <p className={cn('text-body', kind === 'error' ? 'text-status-danger' : 'text-secondary')}>{title}</p>}
            {hint && <p className="text-small text-muted">{hint}</p>}
            {retry}
        </div>
    );
};
```

  `frontend/src/features/blogs/components/BlogStatus.tsx`, the component becomes:

```tsx
/**
 * Loading, empty and error block of the blog screens (accent spinner, danger error tile; errors
 * are alerts). Empty is the brand-moment pattern (`EmptyState`, spec §9).
 */
export const BlogStatus: React.FC<BlogStatusProps> = ({ kind, title, hint, icon, onRetry, retryLabel, fill = false }) => {
    const retry = onRetry && retryLabel ? <Button variant="primary" size="sm" onClick={onRetry}>{retryLabel}</Button> : undefined;
    const height = fill ? 'h-full min-h-96' : 'h-72';
    if (kind === 'empty') {
        return (
            <div role="status" className={cn('flex flex-col items-center justify-center', height)}>
                <EmptyState icon={icon} title={title} description={hint} action={retry} />
            </div>
        );
    }
    return (
        <div
            role={kind === 'error' ? 'alert' : 'status'}
            className={cn('flex flex-col items-center justify-center gap-4 px-6 text-center', height)}
        >
            {kind === 'loading' ? (
                <Loader2 aria-hidden="true" className={cn('animate-spin text-accent motion-reduce:animate-none', fill ? 'h-10 w-10' : 'h-8 w-8')} />
            ) : icon ? (
                <div aria-hidden="true" className="rounded-card bg-semantic-danger-icon p-5 text-semantic-danger">
                    {icon}
                </div>
            ) : null}
            <div className="flex flex-col gap-1">
                <p className="text-body text-secondary">{title}</p>
                {hint && <p className="text-small text-muted">{hint}</p>}
            </div>
            {retry}
        </div>
    );
};
```

  with `import { Button, EmptyState } from '../../../design/primitives';`. (The Favorite-filter heart in `RecentPostsFeed` keeps its own `text-semantic-oshi`, which wins over the circle's `text-muted`; `EmptyState` sizes every icon to 28 px, so the callers' `h-10 w-10` stays harmless.)

  `frontend/src/features/messages/MessagesFeature.tsx` (pending decision D6): add `EmptyState` to the `../../design/primitives` import and `MessageCircle` to the `lucide-react` import, and replace the `{!selectedGroupDir && (…)}` block (`e4e4118`: two `text-gray-400` lines) with:

```tsx
                    {!selectedGroupDir && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <EmptyState icon={<MessageCircle />} title={t('messageList.welcomeTitle')} description={t('messageList.welcomeSubtitle')} />
                        </div>
                    )}
```

- [ ] **Step 4: Run to verify they pass**

Run (from `frontend/`): `npx vitest run src/core src/features src/shell src/design && npx tsc --noEmit && npm run lint`
Expected: PASS (dialog / blog screens that render empty states — Favorites, media gallery, search, member select, timeline, blog gallery, feed — keep their texts). If a screen test asserted the old tile (`rounded-card` + `text-accent-strong` on an empty icon), update it to `getByTestId('empty-state-circle')`.

- [ ] **Step 5: Commit**

```bash
git add frontend
uv run git commit -m "feat(frontend): draw empty states with the brand-moment pattern" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backend: `GET /api/archive/stats` (pending decision D9)

**Files:**
- Create: `backend/services/archive_stats.py`, `backend/api/archive.py`, `backend/tests/test_archive_stats_api.py`
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: `StatCache` (`backend/services/messages_cache.py`), `is_hidden_message` (`backend/services/message_visibility.py`), `content.get_output_dir()` (`backend/api/content.py`).
- Produces: `GET /api/archive/stats` → `{ "messages": int, "photos": int, "first_message_at": str | null }` (ISO 8601 as archived, UTC). Python: `summarize_messages(data) -> FileStats`, `collect_archive_stats(output_dir: Path) -> ArchiveStats`. Logs: `archive_stats` (info: `messages`, `photos`, `files`, `skipped`), `archive_stats_skipped` (info, `reason="no_output_dir"`), `archive_stats_file_skipped` (warning, `error_type`).

- [ ] **Step 1: Write the failing tests** — `backend/tests/test_archive_stats_api.py`

```python
"""Tests for GET /api/archive/stats and the archive totals behind it (About, R-d)."""

import json
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from backend.main import app
from backend.services.archive_stats import (
    ArchiveStats,
    FileStats,
    collect_archive_stats,
    summarize_messages,
)

client = TestClient(app)

HINATA = "日向坂46/messages/58 金村 美玖/58 金村 美玖"
SAKURA = "櫻坂46/messages/79 中川 智尋/134 中川 智尋"
GROUP_CHAT_MEMBER = "日向坂46/messages/1 日向坂46/58 金村 美玖"


def _msg(msg_id: int, timestamp: object, kind: str = "text", **extra: object) -> dict:
    return {"id": msg_id, "timestamp": timestamp, "type": kind, "content": "おはよう🌸", **extra}


def _write(root: Path, member: str, messages: object) -> Path:
    member_dir = root / member
    member_dir.mkdir(parents=True, exist_ok=True)
    path = member_dir / "messages.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"member": {"id": 58, "name": "金村 美玖"}, "messages": messages}, f, ensure_ascii=False)
    return path


def test_summarize_counts_shown_messages_photos_and_the_earliest_time():
    stats = summarize_messages(
        {
            "messages": [
                _msg(1, "2024-03-01T10:00:00Z"),
                _msg(2, "2023-12-24T09:00:00Z", "picture"),
                _msg(3, "2023-01-01T00:00:00Z", "picture", state="canceled"),  # withdrawn: hidden
                _msg(4, None, "voice"),
                "not a row",
            ]
        }
    )
    assert stats == FileStats(messages=3, photos=1, first_at="2023-12-24T09:00:00Z")


def test_summarize_tolerates_files_without_a_message_list():
    assert summarize_messages([]) == FileStats(0, 0, None)
    assert summarize_messages({"messages": None}) == FileStats(0, 0, None)
    assert summarize_messages({}) == FileStats(0, 0, None)


def test_collect_sums_every_member_file_including_group_chat_members(tmp_path):
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z"), _msg(2, "2024-01-16T09:00:00Z", "picture")])
    _write(tmp_path, SAKURA, [_msg(1, "2022-05-01T00:00:00Z", "picture")])
    _write(tmp_path, GROUP_CHAT_MEMBER, [_msg(9, "2025-01-01T00:00:00Z")])
    (tmp_path / "日向坂46" / "blogs").mkdir()  # not a message folder
    assert collect_archive_stats(tmp_path) == ArchiveStats(
        messages=4, photos=2, first_message_at="2022-05-01T00:00:00Z", files=3, skipped=0
    )


def test_collect_reads_a_changed_file_again(tmp_path):
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z")])
    assert collect_archive_stats(tmp_path).messages == 1
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z"), _msg(2, "2024-01-15T10:00:00Z")])
    assert collect_archive_stats(tmp_path).messages == 2


def test_collect_without_an_output_folder_logs_the_skip(tmp_path):
    with capture_logs() as logs:
        stats = collect_archive_stats(tmp_path / "missing")
    assert stats == ArchiveStats(0, 0, None, 0, 0)
    (entry,) = [e for e in logs if e["event"] == "archive_stats_skipped"]
    assert (entry["log_level"], entry["reason"]) == ("info", "no_output_dir")


def test_collect_skips_a_broken_file_and_logs_only_its_error_type(tmp_path):
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z")])
    broken = tmp_path / SAKURA
    broken.mkdir(parents=True)
    (broken / "messages.json").write_text("{not json", encoding="utf-8")
    with capture_logs() as logs:
        stats = collect_archive_stats(tmp_path)
    assert (stats.messages, stats.files, stats.skipped) == (1, 1, 1)
    (entry,) = [e for e in logs if e["event"] == "archive_stats_file_skipped"]
    assert (entry["log_level"], entry["error_type"]) == ("warning", "JSONDecodeError")
    assert "中川" not in json.dumps(entry, ensure_ascii=False)


def test_endpoint_returns_the_totals_and_logs_counts_only(tmp_path):
    _write(tmp_path, HINATA, [_msg(1, "2024-01-15T09:00:00Z", "picture"), _msg(2, "2024-02-01T09:00:00Z")])
    with patch("backend.api.content.get_output_dir", return_value=tmp_path), capture_logs() as logs:
        res = client.get("/api/archive/stats")
    assert res.status_code == 200
    assert res.json() == {"messages": 2, "photos": 1, "first_message_at": "2024-01-15T09:00:00Z"}
    (entry,) = [e for e in logs if e["event"] == "archive_stats"]
    assert (entry["messages"], entry["photos"], entry["files"], entry["skipped"]) == (2, 1, 1, 0)
    assert "金村" not in json.dumps(entry, ensure_ascii=False)


def test_endpoint_on_an_empty_archive(tmp_path):
    with patch("backend.api.content.get_output_dir", return_value=tmp_path):
        res = client.get("/api/archive/stats")
    assert res.json() == {"messages": 0, "photos": 0, "first_message_at": None}
```

- [ ] **Step 2: Run to verify it fails**

Run (repo root): `uv run pytest backend/tests/test_archive_stats_api.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.services.archive_stats'`.

- [ ] **Step 3: Implement the service** — `backend/services/archive_stats.py`

```python
"""Totals for the About dialog's "your archive" stats.

Counts the chat messages the app shows (``message_visibility``), the photos
among them (``type == "picture"``) and the earliest message time, over every
member's ``messages.json`` under the output folder::

    output_dir/{service}/messages/{group_id} {group}/{member_id} {member}/messages.json

Group chats keep one file per member, so each member's posts count once.
Blogs are not counted. Per-file totals are cached on the file's stat key
(``messages_cache.StatCache``), so reopening About re-reads only files a sync
changed. Timestamps are compared as strings: the archive writes them in one
UTC ISO 8601 format. Logs carry counts and error types only: paths contain
member names.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import structlog

from backend.services.message_visibility import is_hidden_message
from backend.services.messages_cache import StatCache

logger = structlog.get_logger(__name__)

#: Every member's message file, relative to the output folder.
MESSAGE_FILES = "*/messages/*/*/messages.json"


@dataclass(frozen=True)
class FileStats:
    """Totals of one ``messages.json``."""

    messages: int
    photos: int
    first_at: Optional[str]


@dataclass(frozen=True)
class ArchiveStats:
    """Totals of the whole archive, plus how many files were read and skipped."""

    messages: int
    photos: int
    first_message_at: Optional[str]
    files: int
    skipped: int


def summarize_messages(data: Any) -> FileStats:
    """Totals of one parsed file; rows that are not dicts and hidden messages are not counted."""
    rows = data.get("messages") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return FileStats(0, 0, None)
    messages = 0
    photos = 0
    first: Optional[str] = None
    for row in rows:
        if not isinstance(row, dict) or is_hidden_message(row):
            continue
        messages += 1
        if row.get("type") == "picture":
            photos += 1
        timestamp = row.get("timestamp")
        if isinstance(timestamp, str) and timestamp and (first is None or timestamp < first):
            first = timestamp
    return FileStats(messages, photos, first)


_CACHE = StatCache()


def collect_archive_stats(output_dir: Path) -> ArchiveStats:
    """Walk the output folder (blocking: call through ``asyncio.to_thread``)."""
    if not output_dir.is_dir():
        logger.info("archive_stats_skipped", reason="no_output_dir")
        return ArchiveStats(0, 0, None, 0, 0)
    messages = photos = files = skipped = 0
    first: Optional[str] = None
    for path in sorted(output_dir.glob(MESSAGE_FILES)):
        try:
            stats = _CACHE.get(path, summarize_messages)
        except (OSError, ValueError) as err:  # unreadable or not JSON (JSONDecodeError is a ValueError)
            skipped += 1
            logger.warning("archive_stats_file_skipped", error_type=type(err).__name__)
            continue
        files += 1
        messages += stats.messages
        photos += stats.photos
        if stats.first_at and (first is None or stats.first_at < first):
            first = stats.first_at
    return ArchiveStats(messages, photos, first, files, skipped)
```

- [ ] **Step 4: Implement the endpoint** — `backend/api/archive.py`

```python
"""About's "your archive" stats: GET /api/archive/stats."""

import asyncio
from typing import Optional

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from backend.api import content
from backend.services.archive_stats import collect_archive_stats

router = APIRouter(prefix="/api/archive", tags=["archive"])
logger = structlog.get_logger(__name__)


class ArchiveStatsResponse(BaseModel):
    messages: int
    photos: int
    #: Earliest shown chat message (ISO 8601, UTC as archived); None for an empty archive.
    first_message_at: Optional[str] = None


@router.get("/stats", response_model=ArchiveStatsResponse)
async def get_archive_stats() -> ArchiveStatsResponse:
    """Shown chat messages, the photos among them and the earliest message time."""
    stats = await asyncio.to_thread(collect_archive_stats, content.get_output_dir())
    logger.info(
        "archive_stats",
        messages=stats.messages,
        photos=stats.photos,
        files=stats.files,
        skipped=stats.skipped,
    )
    return ArchiveStatsResponse(
        messages=stats.messages,
        photos=stats.photos,
        first_message_at=stats.first_message_at,
    )
```

  `backend/main.py`: add `archive,` to the `from backend.api import (` list (after `app_state as app_state_api,` is fine: keep it before the closing parenthesis) and `app.include_router(archive.router)` after `app.include_router(client_log.router)`.

- [ ] **Step 5: Run to verify it passes**

Run (repo root): `uv run pytest backend/tests/test_archive_stats_api.py -q && uv run ruff check backend && uv run ruff format --check backend/services/archive_stats.py backend/api/archive.py backend/tests/test_archive_stats_api.py`
Expected: PASS (8 tests); ruff clean (run `uv run ruff format <files>` if the format check complains). Then `uv run pytest backend/tests/test_archive_stats_api.py --cov=backend.services.archive_stats --cov=backend.api.archive --cov-report=term-missing -q` shows 100 % for both modules (if `pytest-cov` is not installed, skip this line; do not add it).

- [ ] **Step 6: Commit**

```bash
git add backend
uv run git commit -m "feat(api): add archive stats endpoint for the About dialog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: About: orbs hero, display wordmark and "your archive" stats (pending decisions D8, D9)

**Files:**
- Create: `frontend/src/core/modals/archiveStats.ts`, `frontend/src/core/modals/archiveStats.test.ts`
- Modify: `frontend/src/core/modals/AboutModal.tsx`, `frontend/src/core/modals/AboutModal.test.tsx`, `frontend/src/__tests__/mocks/handlers.ts`, `frontend/src/i18n/rD.test.ts`, the five locale files

**Interfaces:**
- Consumes: `GET /api/archive/stats` (Task 7); `clientLog('archive_stats_load', { outcome })` (Task 1); `Atmosphere`.
- Produces: `archiveDays(firstMessageAt: string | null, now: Date): number`; `useArchiveStats(isOpen: boolean): ArchiveStatsState` with `ArchiveStatsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: ArchiveStats }` and `ArchiveStats = { messages: number; photos: number; days: number }` (Task 9 reuses the hook); i18n keys `about.archiveTitle`, `about.statMessages`, `about.statPhotos`, `about.statDays`.

- [ ] **Step 1: Write the failing tests**
  - `frontend/src/core/modals/archiveStats.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import { archiveDays, useArchiveStats } from './archiveStats';

afterEach(() => vi.mocked(clientLog).mockClear());

describe('archiveDays (decision D9)', () => {
    it('counts calendar days from the earliest message to today, both included', () => {
        expect(archiveDays(new Date(2026, 10, 1, 12).toISOString(), new Date(2026, 10, 6, 9))).toBe(6);
        expect(archiveDays(new Date(2026, 10, 6, 0, 30).toISOString(), new Date(2026, 10, 6, 23))).toBe(1);
    });

    it('is 0 for an empty archive or an unreadable time', () => {
        expect(archiveDays(null, new Date(2026, 10, 6))).toBe(0);
        expect(archiveDays('not a date', new Date(2026, 10, 6))).toBe(0);
    });
});

describe('useArchiveStats', () => {
    it('loads the totals once the dialog opens and logs the load', async () => {
        server.use(http.get('/api/archive/stats', () => HttpResponse.json({ messages: 12846, photos: 2301, first_message_at: null })));
        const { result, rerender } = renderHook(({ open }) => useArchiveStats(open), { initialProps: { open: false } });
        expect(result.current).toEqual({ status: 'loading' });
        rerender({ open: true });
        await waitFor(() => expect(result.current).toEqual({ status: 'ready', stats: { messages: 12846, photos: 2301, days: 0 } }));
        expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'ok' });
    });

    it('reports and logs a failed load', async () => {
        server.use(http.get('/api/archive/stats', () => new HttpResponse(null, { status: 500 })));
        const { result } = renderHook(() => useArchiveStats(true));
        await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
        expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'failed' });
    });
});
```

  - `frontend/src/core/modals/AboutModal.test.tsx`: add at the top `vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));`, `import { clientLog } from '../../utils/clientLog';`, `import { http, HttpResponse } from 'msw';`, `import { server } from '../../__tests__/mocks/server';`, add `within, waitFor` to the testing-library import, add `beforeAll(async () => { await i18n.changeLanguage('en'); });` (and `beforeAll` to the vitest import), and append inside the `describe`:

```tsx
    it('opens on a hero of brand orbs with the display wordmark (pending decision D8)', () => {
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const hero = screen.getByTestId('about-hero');
        expect(hero.parentElement?.parentElement?.querySelectorAll('[data-testid="atmosphere-orb"]')).toHaveLength(3);
        expect(screen.getByText('SakaDesk', { selector: 'h3' })).toHaveClass('text-display');
    });

    it('shows the archive stats in the display face with tabular numerals (pending decision D9)', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 10, 6, 12));
        server.use(http.get('/api/archive/stats', () => HttpResponse.json({
            messages: 12846, photos: 2301, first_message_at: new Date(2026, 10, 1, 12).toISOString(),
        })));
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        const stats = screen.getByTestId('about-stats');
        expect(within(stats).getByRole('heading', { name: 'Your archive' })).toBeInTheDocument();
        const messages = await within(stats).findByText('12,846');
        expect(messages).toHaveClass('font-display', 'tabular-nums');
        expect(within(stats).getByText('2,301')).toBeInTheDocument();
        expect(within(stats).getByText('6')).toBeInTheDocument();
        expect(within(stats).getByText('Days')).toBeInTheDocument();
        expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'ok' });
        vi.useRealTimers();
    });

    it('hides the stats when they cannot be loaded', async () => {
        server.use(http.get('/api/archive/stats', () => new HttpResponse(null, { status: 500 })));
        render(<AboutModal isOpen onClose={vi.fn()} onOpenDiagnostics={vi.fn()} />);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'failed' }));
        expect(screen.queryByTestId('about-stats')).toBeNull();
    });
```

  - `frontend/src/__tests__/mocks/handlers.ts`: add a default handler next to the others (every dialog test that opens About would otherwise hit msw's unhandled-request error):

```ts
  http.get('/api/archive/stats', () => {
    return HttpResponse.json({ messages: 0, photos: 0, first_message_at: null })
  }),
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/core/modals/archiveStats.test.ts src/core/modals/AboutModal.test.tsx`
Expected: FAIL (`./archiveStats` missing; no hero / stats).

- [ ] **Step 3: Add the keys** to the `about` section of each locale, and append `'about.archiveTitle', 'about.statMessages', 'about.statPhotos', 'about.statDays'` to `RD_KEYS`:

| key | en | ja | zh-CN | zh-TW | yue |
|---|---|---|---|---|---|
| `archiveTitle` | Your archive | あなたのアーカイブ | 你的存档 | 你的存檔 | 你嘅存檔 |
| `statMessages` | Messages | メッセージ | 消息 | 訊息 | 訊息 |
| `statPhotos` | Photos | 写真 | 照片 | 照片 | 相片 |
| `statDays` | Days | 日間 | 天 | 天 | 日 |

- [ ] **Step 4: Implement the hook** — `frontend/src/core/modals/archiveStats.ts`

```ts
import { useEffect, useState } from 'react';
import { clientLog } from '../../utils/clientLog';
import { fromLocalDateStr, toLocalDateStr } from '../../utils/dateFormatters';

/** About's "your archive" numbers (decision D9). */
export interface ArchiveStats {
    messages: number;
    photos: number;
    days: number;
}

export type ArchiveStatsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: ArchiveStats };

const DAY_MS = 86_400_000;

/**
 * Calendar days from the earliest archived message to today, both counted (local dates, so the
 * number changes at the user's midnight); 0 for an empty archive or an unreadable time.
 */
export function archiveDays(firstMessageAt: string | null, now: Date): number {
    if (!firstMessageAt) return 0;
    const first = fromLocalDateStr(toLocalDateStr(firstMessageAt));
    const today = fromLocalDateStr(toLocalDateStr(now));
    if (!first || !today) return 0;
    // Rounded: a daylight-saving day is 23 or 25 hours long.
    return Math.max(1, Math.round((today.getTime() - first.getTime()) / DAY_MS) + 1);
}

/** Loads `GET /api/archive/stats` each time `isOpen` becomes true; one `archive_stats_load` breadcrumb per load. */
export function useArchiveStats(isOpen: boolean): ArchiveStatsState {
    const [state, setState] = useState<ArchiveStatsState>({ status: 'loading' });
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setState({ status: 'loading' });
        (async () => {
            try {
                const res = await fetch('/api/archive/stats');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json() as { messages?: number; photos?: number; first_message_at?: string | null };
                if (cancelled) return;
                setState({
                    status: 'ready',
                    stats: { messages: data.messages ?? 0, photos: data.photos ?? 0, days: archiveDays(data.first_message_at ?? null, new Date()) },
                });
                clientLog('archive_stats_load', { outcome: 'ok' });
            } catch {
                if (cancelled) return;
                setState({ status: 'error' });
                clientLog('archive_stats_load', { outcome: 'failed' });
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen]);
    return state;
}
```

  (`toLocalDateStr` returns `''` for an unreadable time and `fromLocalDateStr('')` returns `null`, which gives 0.)

- [ ] **Step 5: Implement the hero and stats (pending decisions D8, D9)** — `frontend/src/core/modals/AboutModal.tsx`:
  - imports: `import { useState, useRef, useCallback, useEffect, useId } from 'react';`, `import { Atmosphere, Modal } from '../../design/primitives';`, `import { useArchiveStats } from './archiveStats';`; `const { t, i18n } = useTranslation();`.
  - after `const appVersion = __APP_VERSION__;` add:

```tsx
    // "Your archive" (spec §9): loaded each time About opens; hidden if it fails.
    const archive = useArchiveStats(isOpen);
    const statsId = useId();
    const totals = archive.status === 'ready' ? archive.stats : null;
    const statValue = (n: number | undefined) => (totals && n !== undefined ? n.toLocaleString(i18n.language) : '—');
    const statItems = [
        { key: 'messages', label: t('about.statMessages'), value: statValue(totals?.messages) },
        { key: 'photos', label: t('about.statPhotos'), value: statValue(totals?.photos) },
        { key: 'days', label: t('about.statDays'), value: statValue(totals?.days) },
    ];
```

  - replace the opening of the body — from `<div className="flex flex-col items-center px-2 py-4 text-center">` through the identity block's closing `</div>` (the one holding `about.identity` / `about.features`) — with:

```tsx
            <div className="flex flex-col items-center text-center">
                {/* Hero (spec §9, decision D8): the brand orbs behind the logo and the display
                    wordmark, bled to the dialog edges under the aurora header. */}
                <Atmosphere className="-mx-6 -mt-4 self-stretch">
                    <div data-testid="about-hero" className="flex flex-col items-center px-6 pb-6 pt-8">
                        <div className="mb-4 h-20 w-20 overflow-hidden rounded-xl shadow-card">
                            <img src="/logo-192.png" alt="SakaDesk" className="h-full w-full select-none" />
                        </div>
                        <h3 className="font-display text-display font-bold text-primary">SakaDesk</h3>
                        {/* Plain text that is secretly clickable (5 clicks: diagnostics). */}
                        <p onClick={handleVersionClick} className="cursor-text select-none text-small text-muted">
                            {appVersion ? t('about.version', { version: appVersion }) : ' '}
                        </p>
                    </div>
                </Atmosphere>

                {archive.status !== 'error' && (
                    <section data-testid="about-stats" aria-labelledby={statsId} className="mb-6 w-full">
                        <h4 id={statsId} className="mb-2 text-caption font-semibold text-muted">{t('about.archiveTitle')}</h4>
                        <dl className="grid grid-cols-3 gap-2">
                            {statItems.map((item) => (
                                <div key={item.key} className="flex flex-col items-center gap-1 rounded-lg bg-elevated px-2 py-3">
                                    <dt className="order-2 text-caption text-muted">{item.label}</dt>
                                    <dd className="order-1 font-display text-heading font-semibold tabular-nums text-primary">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                )}

                <div className="mb-6 flex flex-col gap-1">
                    <p className="text-small text-muted">{t('about.identity')}</p>
                    <p className="text-small text-secondary">{t('about.features')}</p>
                </div>
```

    (the heart row, the toast and the closing `</div>` stay as they are).

- [ ] **Step 6: Run to verify they pass**

Run (from `frontend/`): `npx vitest run src/core src/i18n src/shell && npx tsc --noEmit && npm run lint`
Expected: PASS (`dialogs.style.test.ts` still passes for `AboutModal.tsx`: no palette class, no inline colour).

- [ ] **Step 7: Commit**

```bash
git add frontend
uv run git commit -m "feat(about): add the aurora hero and your-archive stats" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The first-sync celebration (pending decision D11)

**Files:**
- Create: `frontend/src/shell/firstSyncCelebration.ts`, `frontend/src/shell/firstSyncCelebration.test.ts`, `frontend/src/shell/components/FirstSyncToast.tsx`, `frontend/src/shell/components/FirstSyncToast.test.tsx`
- Modify: `frontend/src/shell/hooks/useSync.ts`, `frontend/src/shell/hooks/useSync.test.ts`, `frontend/src/shell/App.tsx`, `frontend/src/core/dialogs.style.test.ts`, `frontend/src/i18n/rD.test.ts`, the five locale files

**Interfaces:**
- Consumes: `useArchiveStats` (Task 8), `CelebrationToast`, `BrandScope`, `Z_INDEX.TOAST`, `persisted`, `clientLog('celebration', …)` (Task 1).
- Produces: `SequentialSyncOutcome = { completed: number; failed: number }` (exported from `shell/hooks/useSync.ts`); `startSequentialSync(services: string[]): Promise<SequentialSyncOutcome>`; `FIRST_SYNC_PREF = 'first_sync_celebrated_at'`; `decideFirstSync(outcome, celebratedAt: string | null): 'show' | 'already_celebrated' | 'sync_failed'`; `celebrateFirstSync(outcome): boolean`; `FirstSyncToast: React.FC<{ onDone: () => void }>`, `FIRST_SYNC_TOAST_MS = 6000`; i18n keys `celebration.firstSyncTitle`, `celebration.firstSyncBody` (+ `_other` in en).

- [ ] **Step 1: Write the failing tests**
  - `frontend/src/shell/firstSyncCelebration.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../utils/clientLog';
import { persisted } from '../core/persistence/persisted';
import { FIRST_SYNC_PREF, celebrateFirstSync, decideFirstSync } from './firstSyncCelebration';

describe('decideFirstSync (decision D11)', () => {
    it('celebrates a first sync where every service finished', () => {
        expect(decideFirstSync({ completed: 2, failed: 0 }, null)).toBe('show');
    });
    it('never celebrates twice', () => {
        expect(decideFirstSync({ completed: 2, failed: 0 }, '2026-11-06T03:00:00Z')).toBe('already_celebrated');
    });
    it('does not celebrate a sync where a service failed or nothing ran', () => {
        expect(decideFirstSync({ completed: 1, failed: 1 }, null)).toBe('sync_failed');
        expect(decideFirstSync({ completed: 0, failed: 0 }, null)).toBe('sync_failed');
    });
});

describe('celebrateFirstSync', () => {
    let stored: Record<string, unknown>;
    beforeEach(() => {
        stored = {};
        vi.spyOn(persisted, 'getPref').mockImplementation(((key: string, fallback: unknown) => (key in stored ? stored[key] : fallback)) as never);
        vi.spyOn(persisted, 'setPref').mockImplementation(((key: string, value: unknown) => { stored[key] = value; }) as never);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.mocked(clientLog).mockClear(); });

    it('records the first celebration, logs it and refuses the second', () => {
        expect(celebrateFirstSync({ completed: 2, failed: 0 })).toBe(true);
        expect(stored[FIRST_SYNC_PREF]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'first_sync', outcome: 'shown' });
        expect(celebrateFirstSync({ completed: 2, failed: 0 })).toBe(false);
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'first_sync', outcome: 'skipped', reason: 'already_celebrated' });
    });

    it('logs a skipped celebration after a failed sync and stores nothing', () => {
        expect(celebrateFirstSync({ completed: 0, failed: 2 })).toBe(false);
        expect(stored).toEqual({});
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'first_sync', outcome: 'skipped', reason: 'sync_failed' });
    });
});
```

  - `frontend/src/shell/components/FirstSyncToast.test.tsx`

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { FirstSyncToast, FIRST_SYNC_TOAST_MS } from './FirstSyncToast';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('FirstSyncToast (decision D11)', () => {
    it('is a brand tier-B toast on the toast layer that never takes the pointer, with the saved count', async () => {
        server.use(http.get('/api/archive/stats', () => HttpResponse.json({ messages: 12846, photos: 10, first_message_at: null })));
        render(<FirstSyncToast onDone={vi.fn()} />);
        const layer = screen.getByTestId('first-sync-toast');
        expect(layer).toHaveClass('pointer-events-none', 'fixed', 'bottom-4', 'right-4');
        expect(layer.querySelector('[data-scope="brand"]')).not.toBeNull();
        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Your archive is ready');
        expect(await screen.findByText('12,846 messages saved')).toBeInTheDocument();
        expect(toast.querySelectorAll('[data-sparkle]')).toHaveLength(10);
    });

    it('leaves out the count when it is unknown and goes away by itself', () => {
        vi.useFakeTimers();
        const onDone = vi.fn();
        const { unmount } = render(<FirstSyncToast onDone={onDone} />);
        expect(screen.queryByText(/messages saved/)).toBeNull();
        vi.advanceTimersByTime(FIRST_SYNC_TOAST_MS);
        expect(onDone).toHaveBeenCalledOnce();
        unmount();
        vi.useRealTimers();
    });
});
```

  - `frontend/src/shell/hooks/useSync.test.ts`, append inside `describe('useSync'`:

```ts
    it('reports how many services of a sequential sync finished, and goes on after a failed start', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input)
            const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body })
            if (url.includes('/api/sync/start')) {
                return url.includes('nogizaka46') ? reply({ detail: 'invalid service' }, false, 400) : reply({ status: 'started' })
            }
            if (url.includes('/api/sync/progress')) {
                return url.includes('sakurazaka46')
                    ? reply({ state: 'error', detail: 'failed' })
                    : reply({ state: 'complete', completed: 3, total: 3 })
            }
            return reply({})
        }))
        const { result } = renderHook(() => useSync({ ...defaultOptions, appSettings: { ...defaultOptions.appSettings, is_configured: false } }))
        let outcome: unknown
        await act(async () => {
            outcome = await result.current.startSequentialSync(['hinatazaka46', 'sakurazaka46', 'nogizaka46'])
        })
        expect(outcome).toEqual({ completed: 1, failed: 2 })
    })
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/shell/firstSyncCelebration.test.ts src/shell/components/FirstSyncToast.test.tsx src/shell/hooks/useSync.test.ts`
Expected: FAIL (modules missing; `startSequentialSync` resolves `undefined` and hangs on the failed `nogizaka46` start — the test times out at 15 s).

- [ ] **Step 3: Add the keys** — a new top-level section `"celebration"` in each locale (Task 10 adds more to it), and append `'celebration.firstSyncTitle', 'celebration.firstSyncBody'` to `RD_KEYS` and `'celebration.firstSyncBody'` to `RD_EN_PLURALS`:
  - en: `"celebration": { "firstSyncTitle": "Your archive is ready", "firstSyncBody": "{{value}} message saved", "firstSyncBody_other": "{{value}} messages saved" }`
  - ja: `"celebration": { "firstSyncTitle": "アーカイブの準備ができました", "firstSyncBody": "{{value}}件のメッセージを保存しました" }`
  - zh-CN: `"celebration": { "firstSyncTitle": "你的存档已准备就绪", "firstSyncBody": "已保存 {{value}} 条消息" }`
  - zh-TW: `"celebration": { "firstSyncTitle": "你的存檔已準備就緒", "firstSyncBody": "已儲存 {{value}} 則訊息" }`
  - yue: `"celebration": { "firstSyncTitle": "你嘅存檔準備好喇", "firstSyncBody": "已經儲存咗 {{value}} 條訊息" }`
  (`count` picks the plural form; `value` is the number formatted for the UI language.)

- [ ] **Step 4: Report the sequence outcome** — `frontend/src/shell/hooks/useSync.ts`:
  - after `SequentialSyncInfo`, add:

```ts
/** How a sequential sync ended: services that reached `complete`, and the rest (error, idle, failed start). */
export interface SequentialSyncOutcome {
    completed: number;
    failed: number;
}
```

  - `UseSyncReturn.startSequentialSync: (services: string[]) => Promise<SequentialSyncOutcome>;`
  - `const syncCompleteCallbacks = useRef<Record<string, (completed: boolean) => void>>({});`
  - `resolveSyncCallback` takes the outcome:

```ts
    // Helper: resolve any pending sequential-sync callback for a service
    const resolveSyncCallback = useCallback((service: string, completed: boolean) => {
        if (syncCompleteCallbacks.current[service]) {
            syncCompleteCallbacks.current[service](completed);
            delete syncCompleteCallbacks.current[service];
        }
    }, []);
```

  - in `pollSyncProgress`: the `data.state === 'complete'` branch calls `resolveSyncCallback(service, true)`; the `idle`, `error`, unknown-state and `catch` branches call `resolveSyncCallback(service, false)`.
  - in `startSync`: a refused start that is not "already running" (the `else` branch after `log(\`${targetService}: failed to start\`, data.detail);`) and the `catch` both add `resolveSyncCallback(targetService, false);` (before this change a failed start left a sequential sync waiting forever); add `resolveSyncCallback` to `startSync`'s dependency list.
  - `startSequentialSync`:

```ts
    const startSequentialSync = useCallback(async (services: string[]): Promise<SequentialSyncOutcome> => {
        if (services.length === 0) return { completed: 0, failed: 0 };

        // Prevent startup sync effect from also triggering these services
        services.forEach(s => syncedServicesRef.current.add(s));
        hasStartedSyncRef.current = true;

        setShowSyncModal(true);

        let completed = 0;
        for (let i = 0; i < services.length; i++) {
            const service = services[i];
            sequentialSyncServiceRef.current = service;
            setSequentialSyncInfo({ total: services.length, currentIndex: i, currentService: service, services });

            // Force clear any stale polling state from previous syncs
            isPollingRef.current[service] = false;

            // Reset both legacy and per-service progress before starting
            const initialProgress: SyncProgress = {
                state: 'running',
                phase: 'starting',
                phase_name: i18n.t('sync.starting'),
                detail: i18n.t('sync.initializing')
            };
            setSyncProgressByService(prev => ({ ...prev, [service]: initialProgress }));
            setSyncProgress(initialProgress);

            const ok = await new Promise<boolean>((resolve) => {
                syncCompleteCallbacks.current[service] = resolve;
                startSync(false, service);
            });
            if (ok) completed += 1;
        }

        sequentialSyncServiceRef.current = null;
        setSequentialSyncInfo(null);
        setTimeout(() => setShowSyncModal(false), 2000);
        return { completed, failed: services.length - completed };
    }, [startSync]);
```

- [ ] **Step 5: Implement the decision** — `frontend/src/shell/firstSyncCelebration.ts`

```ts
import { persisted } from '../core/persistence/persisted';
import { clientLog } from '../utils/clientLog';
import type { SequentialSyncOutcome } from './hooks/useSync';

/** Set once the first-sync toast has been shown (spec §9: "once ever"). */
export const FIRST_SYNC_PREF = 'first_sync_celebrated_at';

export type FirstSyncDecision = 'show' | 'already_celebrated' | 'sync_failed';

/** Whether the first-launch sync earns the tier-B toast (decision D11): every service finished, never shown before. */
export function decideFirstSync(outcome: SequentialSyncOutcome, celebratedAt: string | null): FirstSyncDecision {
    if (celebratedAt) return 'already_celebrated';
    if (outcome.failed > 0 || outcome.completed === 0) return 'sync_failed';
    return 'show';
}

/** Decides, records and logs (`celebration`, target `first_sync`); true when the toast should show. */
export function celebrateFirstSync(outcome: SequentialSyncOutcome): boolean {
    const decision = decideFirstSync(outcome, persisted.getPref<string | null>(FIRST_SYNC_PREF, null));
    if (decision !== 'show') {
        clientLog('celebration', { target: 'first_sync', outcome: 'skipped', reason: decision });
        return false;
    }
    persisted.setPref(FIRST_SYNC_PREF, new Date().toISOString());
    clientLog('celebration', { target: 'first_sync', outcome: 'shown' });
    return true;
}
```

- [ ] **Step 6: Implement the toast** — `frontend/src/shell/components/FirstSyncToast.tsx`

```tsx
import React, { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { CelebrationToast } from '../../design/primitives';
import { BrandScope } from '../../design/brandScope';
import { Z_INDEX } from '../../constants/zIndex';
import { useArchiveStats } from '../../core/modals/archiveStats';

/** How long the first-sync toast stays (spec §9: a celebration never needs dismissing). */
export const FIRST_SYNC_TOAST_MS = 6000;

/**
 * Tier-B celebration of the first complete sync (spec §9, decision D11): a brand toast at the
 * bottom right on the toast layer, with the saved message count when it is known. It never
 * takes the pointer, so it cannot block input.
 */
export const FirstSyncToast: React.FC<{ onDone: () => void }> = ({ onDone }) => {
    const { t, i18n } = useTranslation();
    const archive = useArchiveStats(true);
    useEffect(() => {
        const timer = setTimeout(onDone, FIRST_SYNC_TOAST_MS);
        return () => clearTimeout(timer);
    }, [onDone]);
    const messages = archive.status === 'ready' ? archive.stats.messages : 0;
    return (
        <div data-testid="first-sync-toast" style={{ zIndex: Z_INDEX.TOAST }} className="pointer-events-none fixed bottom-4 right-4">
            <BrandScope>
                <CelebrationToast
                    icon={<Sparkles aria-hidden="true" className="h-4 w-4" />}
                    title={t('celebration.firstSyncTitle')}
                    description={messages > 0 ? t('celebration.firstSyncBody', { count: messages, value: messages.toLocaleString(i18n.language) }) : undefined}
                />
            </BrandScope>
        </div>
    );
};
```

  Export it from `frontend/src/shell/components/index.ts`. Add `'../shell/components/FirstSyncToast.tsx',` and `'../shell/components/EntryBackdrop.tsx',` under a `// R-d` comment at the end of `FILES` in `frontend/src/core/dialogs.style.test.ts`.

- [ ] **Step 7: Wire it into the app** — `frontend/src/shell/App.tsx`:
  - imports: `FirstSyncToast` from `./components`, `import { celebrateFirstSync } from './firstSyncCelebration'`.
  - with the other UI state hooks (before any early return): `const [showFirstSyncToast, setShowFirstSyncToast] = useState(false);` and `const hideFirstSyncToast = useCallback(() => setShowFirstSyncToast(false), []);`
  - in `handleSetupComplete`, replace `await startSequentialSync(servicesToSync);` with:

```tsx
                    const outcome = await startSequentialSync(servicesToSync);
                    // Tier-B celebration of the first complete sync (spec §9, decision D11).
                    if (celebrateFirstSync(outcome)) setShowFirstSyncToast(true);
```

  - right after the settings error toast block: `{showFirstSyncToast && <FirstSyncToast onDone={hideFirstSyncToast} />}`.

- [ ] **Step 8: Run to verify they pass**

Run (from `frontend/`): `npx vitest run src/shell src/core src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (existing `useSync` tests unchanged; `entryFlow` still green).

- [ ] **Step 9: Commit**

```bash
git add frontend
uv run git commit -m "feat(entry): celebrate the first complete sync with a toast" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Milestone cards in the chat timeline (pending decision D10)

**Files:**
- Create: `frontend/src/features/messages/milestones.ts`, `frontend/src/features/messages/milestones.test.ts`, `frontend/src/features/messages/components/MilestoneFooter.tsx`, `frontend/src/features/messages/components/MessageList.footer.test.tsx`
- Modify: `frontend/src/features/messages/components/MessageList.tsx`, `frontend/src/features/messages/MessagesFeature.tsx`, `frontend/src/__tests__/virtuosoMock.tsx`, `frontend/src/core/dialogs.style.test.ts`, `frontend/src/i18n/rD.test.ts`, the five locale files

**Interfaces:**
- Consumes: `MilestoneCard` (foundation), `persisted`, `clientLog('celebration', …)`, the room's `totalMessages` and `streak` already in `MessagesFeature`.
- Produces: `MESSAGE_MILESTONES = [1000, 5000, 10000]`, `reachedMessageMilestones(total: number): number[]`, `reachedDayMilestones(days: number): number[]`, `MILESTONES_PREF = 'celebrated_milestones'`, `type MilestoneKind = 'messages' | 'days'`, `interface Milestone { kind: MilestoneKind; value: number }`, `type MilestoneStore = Record<string, Partial<Record<MilestoneKind, number[]>>>`, `decideMilestone(roomKey, reached: Record<MilestoneKind, number[] | null>, store): { show: Milestone | null; seeded: MilestoneKind[]; next: MilestoneStore }`, `useMilestone({ roomKey, totalMessages, streakDays }): Milestone | null`; `MessageList` prop `footer?: React.ReactNode`; `MilestoneFooter: React.FC<{ milestone: Milestone }>`; i18n keys `celebration.milestoneMessages`, `celebration.milestoneDays`, `celebration.milestoneYears` (+ `_other` in en).

- [ ] **Step 1: Write the failing tests**
  - `frontend/src/features/messages/milestones.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import { persisted } from '../../core/persistence/persisted';
import {
    MILESTONES_PREF, decideMilestone, reachedDayMilestones, reachedMessageMilestones, useMilestone,
    type MilestoneStore,
} from './milestones';

describe('reached milestones (spec §9)', () => {
    it('messages: 1,000 / 5,000 / 10,000', () => {
        expect(reachedMessageMilestones(999)).toEqual([]);
        expect(reachedMessageMilestones(5000)).toEqual([1000, 5000]);
        expect(reachedMessageMilestones(25000)).toEqual([1000, 5000, 10000]);
    });
    it('days: day 100, then every full year', () => {
        expect(reachedDayMilestones(99)).toEqual([]);
        expect(reachedDayMilestones(128)).toEqual([100]);
        expect(reachedDayMilestones(800)).toEqual([100, 365, 730]);
    });
});

describe('decideMilestone (decision D10)', () => {
    it('seeds a kind silently the first time a room is seen', () => {
        const r = decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, {});
        expect(r.show).toBeNull();
        expect(r.seeded).toEqual(['messages', 'days']);
        expect(r.next).toEqual({ 'h|room': { messages: [1000, 5000], days: [100] } });
    });

    it('shows the highest new messages milestone first and records the lower ones with it', () => {
        const store: MilestoneStore = { 'h|room': { messages: [], days: [] } };
        const r = decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, store);
        expect(r.show).toEqual({ kind: 'messages', value: 5000 });
        expect(r.next['h|room']).toEqual({ messages: [1000, 5000], days: [] });
        const again = decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, r.next);
        expect(again.show).toEqual({ kind: 'days', value: 100 });
        expect(decideMilestone('h|room', { messages: [1000, 5000], days: [100] }, again.next).show).toBeNull();
    });

    it('skips a kind whose data is not known yet', () => {
        const r = decideMilestone('h|room', { messages: null, days: [100] }, { 'h|room': { days: [] } });
        expect(r.show).toEqual({ kind: 'days', value: 100 });
        expect(r.next['h|room'].messages).toBeUndefined();
    });
});

describe('useMilestone', () => {
    let stored: Record<string, unknown>;
    beforeEach(() => {
        stored = {};
        vi.spyOn(persisted, 'getPref').mockImplementation(((key: string, fallback: unknown) => (key in stored ? stored[key] : fallback)) as never);
        vi.spyOn(persisted, 'setPref').mockImplementation(((key: string, value: unknown) => { stored[key] = value; }) as never);
    });
    afterEach(() => { vi.restoreAllMocks(); vi.mocked(clientLog).mockClear(); });

    it('seeds on the first open, celebrates a milestone reached since then on the next open, once', () => {
        const first = renderHook((p) => useMilestone(p), { initialProps: { roomKey: 'h|room', totalMessages: 4990, streakDays: 99 as number | null } });
        expect(first.result.current).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'milestone_messages', outcome: 'seeded' });
        // Messages arriving while the chat is open wait for the next open.
        first.rerender({ roomKey: 'h|room', totalMessages: 5001, streakDays: 99 });
        expect(first.result.current).toBeNull();
        first.unmount();

        const next = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 5001, streakDays: 99 }));
        expect(next.result.current).toEqual({ kind: 'messages', value: 5000 });
        expect(clientLog).toHaveBeenCalledWith('celebration', { target: 'milestone_messages', outcome: 'shown', count: 5000 });
        expect((stored[MILESTONES_PREF] as MilestoneStore)['h|room'].messages).toEqual([1000, 5000]);
        next.unmount();

        const later = renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: 5001, streakDays: 99 }));
        expect(later.result.current).toBeNull();
    });

    it('does nothing for a group chat (no room key) or before the counts are known', () => {
        const { result } = renderHook(() => useMilestone({ roomKey: null, totalMessages: 20000, streakDays: 800 }));
        expect(result.current).toBeNull();
        renderHook(() => useMilestone({ roomKey: 'h|room', totalMessages: null, streakDays: null }));
        expect(persisted.setPref).not.toHaveBeenCalled();
    });
});
```

  - `frontend/src/features/messages/components/MessageList.footer.test.tsx`

```tsx
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import type { Message } from '../../../types';
import { MessageList } from './MessageList';
import { MilestoneFooter } from './MilestoneFooter';
import { buildTimeline } from '../timeline/buildTimeline';

vi.mock('react-virtuoso', async () => (await import('../../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: vi.fn() }),
}));
vi.mock('./MessageBubble', () => ({ MessageBubble: ({ message }: { message: Message }) => <span>{message.content}</span> }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

const msg = (id: number, timestamp: string): Message => ({ id, timestamp, type: 'text', is_favorite: false, content: `m${id}` });

describe('MessageList footer (R-d)', () => {
    it('shows the footer node after the newest message', () => {
        const timeline = buildTimeline([msg(1, '2025-01-01T03:00:00Z'), msg(2, '2025-01-02T03:00:00Z')], []);
        render(
            <MessageList memberId="room" timeline={timeline} getSenderInfo={() => ({ name: 'n' })} isUnread={() => false}
                onReveal={vi.fn()} onLongPress={vi.fn()} footer={<p>🎉 5,000</p>} />,
        );
        const last = screen.getByText('m2');
        const footer = screen.getByText('🎉 5,000');
        expect(last.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('MilestoneFooter', () => {
    it.each([
        [{ kind: 'messages', value: 5000 }, '5,000', 'messages in this chat'],
        [{ kind: 'days', value: 100 }, '100', 'days subscribed'],
        [{ kind: 'days', value: 365 }, '1', 'year subscribed'],
        [{ kind: 'days', value: 730 }, '2', 'years subscribed'],
    ] as const)('%o shows %s / %s', (milestone, value, label) => {
        render(<MilestoneFooter milestone={milestone} />);
        expect(screen.getByText(value)).toHaveClass('font-display', 'tabular-nums');
        expect(screen.getByText(label)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/features/messages/milestones.test.ts src/features/messages/components/MessageList.footer.test.tsx`
Expected: FAIL (modules missing; no `footer` prop).

- [ ] **Step 3: Add the keys** to the `celebration` section (Task 9) of each locale; append `'celebration.milestoneMessages', 'celebration.milestoneDays', 'celebration.milestoneYears'` to `RD_KEYS` and `'celebration.milestoneYears'` to `RD_EN_PLURALS`:

| key | en | ja | zh-CN | zh-TW | yue |
|---|---|---|---|---|---|
| `milestoneMessages` | messages in this chat | 通のメッセージ | 条消息 | 則訊息 | 條訊息 |
| `milestoneDays` | days subscribed | 日間の購読 | 天的订阅 | 天的訂閱 | 日嘅訂閱 |
| `milestoneYears` | year subscribed (+ `milestoneYears_other`: years subscribed) | 年間の購読 | 年的订阅 | 年的訂閱 | 年嘅訂閱 |

- [ ] **Step 4: Implement the decision module** — `frontend/src/features/messages/milestones.ts`

```ts
import { useEffect, useRef, useState } from 'react';
import { persisted } from '../../core/persistence/persisted';
import { clientLog } from '../../utils/clientLog';

/** Message counts a member chat celebrates (spec §9). */
export const MESSAGE_MILESTONES = [1000, 5000, 10000] as const;
/** Celebrated (and seeded) milestones per room: `{ "<service>|<room dir>": { messages: [...], days: [...] } }`. */
export const MILESTONES_PREF = 'celebrated_milestones';

export type MilestoneKind = 'messages' | 'days';
export interface Milestone { kind: MilestoneKind; value: number }
export type MilestoneStore = Record<string, Partial<Record<MilestoneKind, number[]>>>;

const DAYS_PER_YEAR = 365;

export function reachedMessageMilestones(total: number): number[] {
    return MESSAGE_MILESTONES.filter((n) => total >= n);
}

/** Subscription day 100, then every full year (spec §9). */
export function reachedDayMilestones(days: number): number[] {
    const reached: number[] = days >= 100 ? [100] : [];
    for (let d = DAYS_PER_YEAR; d <= days; d += DAYS_PER_YEAR) reached.push(d);
    return reached;
}

/**
 * What one chat open celebrates, and the store to save (decision D10). A kind seen for the
 * first time in a room is seeded silently: only milestones reached from then on are celebrated.
 * At most one card per open: a new messages milestone first, else a new days one; the highest
 * new value of that kind shows and every lower new value is recorded with it. A kind given as
 * `null` (its data is not known yet) is left alone.
 */
export function decideMilestone(
    roomKey: string,
    reached: Record<MilestoneKind, number[] | null>,
    store: MilestoneStore,
): { show: Milestone | null; seeded: MilestoneKind[]; next: MilestoneStore } {
    const room: Partial<Record<MilestoneKind, number[]>> = { ...(store[roomKey] ?? {}) };
    const seeded: MilestoneKind[] = [];
    let show: Milestone | null = null;
    for (const kind of ['messages', 'days'] as const) {
        const values = reached[kind];
        if (values === null) continue;
        const seen = room[kind];
        if (seen === undefined) {
            room[kind] = [...values];
            seeded.push(kind);
            continue;
        }
        const fresh = values.filter((v) => !seen.includes(v));
        if (fresh.length === 0 || show) continue;
        show = { kind, value: Math.max(...fresh) };
        room[kind] = [...seen, ...fresh].sort((a, b) => a - b);
    }
    return { show, seeded, next: { ...store, [roomKey]: room } };
}

interface UseMilestoneArgs {
    /** `<service>|<room dir>` of a member chat; null for a group chat or no chat. */
    roomKey: string | null;
    /** The room's message count once loaded for this room, else null. */
    totalMessages: number | null;
    /** The subscription day count once loaded for this room, else null. */
    streakDays: number | null;
}

/**
 * The milestone card for the open chat, decided once per kind per open (spec §9: "the next time
 * that chat opens"), recorded in `celebrated_milestones` and logged as `celebration`.
 */
export function useMilestone({ roomKey, totalMessages, streakDays }: UseMilestoneArgs): Milestone | null {
    const [shown, setShown] = useState<{ roomKey: string; milestone: Milestone } | null>(null);
    const evaluated = useRef(new Set<string>());

    // Leaving a room ends its open: the next open decides again.
    useEffect(() => () => {
        if (!roomKey) return;
        evaluated.current.delete(`${roomKey}|messages`);
        evaluated.current.delete(`${roomKey}|days`);
    }, [roomKey]);

    useEffect(() => {
        if (!roomKey) return;
        const messagesDue = totalMessages !== null && !evaluated.current.has(`${roomKey}|messages`);
        const daysDue = streakDays !== null && !evaluated.current.has(`${roomKey}|days`);
        if (!messagesDue && !daysDue) return;
        if (messagesDue) evaluated.current.add(`${roomKey}|messages`);
        if (daysDue) evaluated.current.add(`${roomKey}|days`);
        const { show, seeded, next } = decideMilestone(
            roomKey,
            {
                messages: messagesDue ? reachedMessageMilestones(totalMessages as number) : null,
                days: daysDue ? reachedDayMilestones(streakDays as number) : null,
            },
            persisted.getPref<MilestoneStore>(MILESTONES_PREF, {}),
        );
        persisted.setPref(MILESTONES_PREF, next);
        for (const kind of seeded) clientLog('celebration', { target: `milestone_${kind}`, outcome: 'seeded' });
        if (show) {
            setShown({ roomKey, milestone: show });
            clientLog('celebration', { target: `milestone_${show.kind}`, outcome: 'shown', count: show.value });
        }
    }, [roomKey, totalMessages, streakDays]);

    return shown && shown.roomKey === roomKey ? shown.milestone : null;
}
```

- [ ] **Step 5: The card** — `frontend/src/features/messages/components/MilestoneFooter.tsx`

```tsx
import React from 'react';
import { useTranslation } from '../../../i18n';
import { MilestoneCard } from '../../../design/primitives';
import type { Milestone } from '../milestones';

/**
 * The tier-C milestone card at the end of the chat timeline (spec §9, decision D10), in the
 * chat's group context: the number in the display face and what it counts. Full years show
 * as years.
 */
export const MilestoneFooter: React.FC<{ milestone: Milestone }> = ({ milestone }) => {
    const { t, i18n } = useTranslation();
    const years = milestone.kind === 'days' && milestone.value % 365 === 0 ? milestone.value / 365 : 0;
    const value = years > 0 ? String(years) : milestone.value.toLocaleString(i18n.language);
    const label = milestone.kind === 'messages'
        ? t('celebration.milestoneMessages')
        : years > 0
            ? t('celebration.milestoneYears', { count: years })
            : t('celebration.milestoneDays');
    return (
        <div data-testid="milestone-footer" className="px-4 pb-6 pt-2">
            <MilestoneCard value={value} label={label} />
        </div>
    );
};
```

- [ ] **Step 6: The list's footer slot** — `frontend/src/features/messages/components/MessageList.tsx`:
  - above `const LIST_COMPONENTS`, add:

```tsx
/** What the list shows after the newest message (a milestone card); read by Virtuoso's Footer slot. */
const TimelineFooterContext = React.createContext<React.ReactNode>(null);

const TimelineFooter: React.FC = () => {
    const node = React.useContext(TimelineFooterContext);
    return node ? <>{node}</> : null;
};
```

  - `const LIST_COMPONENTS: GroupedVirtuosoProps<unknown, unknown>['components'] = { TopItemList: StickyHeaderBand, Footer: TimelineFooter };`
  - in `ChatListProps` add `/** Shown after the newest message (the milestone card, spec §9). */ footer?: React.ReactNode;`, destructure `footer` in `MessageList`, and wrap the returned `<GroupedVirtuoso … />` in `<TimelineFooterContext.Provider value={footer ?? null}> … </TimelineFooterContext.Provider>` (the components object stays stable, so Virtuoso never remounts its slots).
  - `frontend/src/__tests__/virtuosoMock.tsx`: in `GroupedProps` add `components?: { Footer?: React.ComponentType }`; destructure `components` in the `GroupedVirtuoso` mock and render the footer after the rows:

```tsx
    const Footer = components?.Footer;
    return <div>{rows}{Footer ? <Footer /> : null}</div>;
```

    and add "`components.Footer`" to the mock's doc comment list of what it renders.

- [ ] **Step 7: Wire it into the chat (pending decision D10)** — `frontend/src/features/messages/MessagesFeature.tsx`:
  - imports: `import { useMilestone } from './milestones';` and `import { MilestoneFooter } from './components/MilestoneFooter';`
  - after `const { streak, retryStreak } = roomExtras;` add:

```tsx
    // Milestone cards (spec §9, decision D10): member chats only; counts only once loaded for this room.
    const milestone = useMilestone({
        roomKey: selectedGroupDir && messagesService && !isGroupChat ? `${messagesService}|${selectedGroupDir}` : null,
        totalMessages: selectedGroupDir && messagesForDir === selectedGroupDir ? totalMessages : null,
        streakDays: streak.status === 'ready' ? streak.days : null,
    });
```

  - on `<MessageList …>` add `footer={milestone ? <MilestoneFooter milestone={milestone} /> : undefined}`.
  - add `'../features/messages/components/MilestoneFooter.tsx',` to the `// R-d` block of `FILES` in `frontend/src/core/dialogs.style.test.ts`.

- [ ] **Step 8: Run to verify they pass**

Run (from `frontend/`): `npx vitest run src/features/messages src/core src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (the existing `MessageList.*.test.tsx` files still pass with the extended mock).

- [ ] **Step 9: Commit**

```bash
git add frontend
uv run git commit -m "feat(messages): celebrate message and subscription milestones" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: VoicePlayer on the ink neutrals (pending decision D13)

**Files:**
- Modify: `frontend/src/core/media/VoicePlayer.tsx`, `frontend/src/design/guard-baseline.json`
- Create: `frontend/src/core/media/VoicePlayer.neutral.test.ts`

**Interfaces:**
- Consumes: nothing new. The accent mixes stay inline (`ACCENT`, `withAlpha`: the documented "pre-token media parts").
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing test** — `frontend/src/core/media/VoicePlayer.neutral.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Same pattern as core/dialogs.style.test.ts (VoicePlayer is not listed there: its accent mixes are inline by design).
const PALETTE = /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|from|via|to|fill|stroke|decoration|outline|divide|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g;
const source = readFileSync(path.resolve(__dirname, 'VoicePlayer.tsx'), 'utf-8');

describe('VoicePlayer neutrals (R-d)', () => {
    it('uses no named palette classes', () => {
        expect(source.match(PALETTE) ?? []).toEqual([]);
    });

    it('keeps only the skip button’s 9 px digit as an arbitrary text size', () => {
        expect(source.match(/text-\[\d+px\]/g)).toEqual(['text-[9px]']);
    });

    it('draws its gallery card on the sheet surface with a token shadow (pending decision D13)', () => {
        expect(source).toContain('bg-sheet rounded-lg p-3 outline-none focus:ring-2 shadow-card');
        expect(source).not.toMatch(/backdrop-blur-xl|\bshadow-(?:md|lg|xl)\b/);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npx vitest run src/core/media/VoicePlayer.neutral.test.ts`
Expected: FAIL (about 30 palette matches, three arbitrary sizes, the glass card).

- [ ] **Step 3: Replace the classes** in `frontend/src/core/media/VoicePlayer.tsx` (old → new; "all" means every occurrence; `e4e4118` had the same greys):

| old | new | where |
|---|---|---|
| `"hover:bg-gray-100 active:bg-gray-200",` | `"hover:bg-sunken active:brightness-94",` | skip button |
| `<Icon className="w-6 h-6 text-gray-600" strokeWidth={2} />` | `<Icon className="w-6 h-6 text-secondary" strokeWidth={2} />` | skip button |
| `text-[9px] font-bold text-gray-600 mt-0.5` | `text-[9px] font-bold text-secondary mt-0.5` | the "5" (its 9 px stays: it sits inside a 24 px icon ring, and there is no smaller text step) |
| `backdrop-blur-xl bg-white/90 rounded-lg p-3 outline-none focus:ring-2 shadow-lg` | `bg-sheet rounded-lg p-3 outline-none focus:ring-2 shadow-card` | premium card (D13) |
| `rounded-full overflow-hidden bg-white"` | `rounded-full overflow-hidden bg-sheet"` | avatar ring |
| `text-gray-400 text-sm font-medium bg-gray-100` | `text-muted text-sm font-medium bg-sunken` | avatar fallback |
| `text-sm font-semibold text-gray-800 truncate` | `text-sm font-semibold text-primary truncate` | member name |
| `<p className="text-xs text-gray-500">` | `<p className="text-xs text-secondary">` | time / duration line |
| `hover:text-gray-700 underline underline-offset-2 decoration-gray-300 hover:decoration-gray-500 transition-colors` | `underline decoration-current underline-offset-2 transition-colors hover:text-primary` | timestamp link |
| `<span className="mx-1 text-gray-300">•</span>` | `<span className="mx-1 text-muted">•</span>` | separator |
| `p-1.5 hover:bg-white/50 rounded-full transition-colors` | `p-1.5 hover:bg-sunken rounded-full transition-colors` | premium menu trigger |
| `p-1 hover:bg-white/50 rounded-full transition-colors` | `p-1 hover:bg-sunken rounded-full transition-colors` | premium mute |
| `w-4 h-4 text-gray-500` (all) | `w-4 h-4 text-secondary` | menu and volume icons, both variants |
| `relative h-1 bg-gray-200/60 rounded-full overflow-hidden` | `relative h-1 bg-sunken rounded-full overflow-hidden` | premium track |
| `<span className="text-[10px] text-gray-500">` (all) | `<span className="text-caption text-secondary">` | premium times |
| `shadow-lg flex items-center justify-center hover:shadow-xl hover:scale-105` | `shadow-card flex items-center justify-center hover:shadow-sheet hover:scale-105` | premium play |
| `text-white fill-current` (all) | `text-inverse fill-current` | play / pause glyphs |
| `relative h-1 bg-gray-300 rounded-full overflow-hidden` | `relative h-1 bg-control-off rounded-full overflow-hidden` | compact track |
| `p-1.5 hover:bg-gray-200 rounded-full transition-colors` (all) | `p-1.5 hover:bg-sheet rounded-full transition-colors` | compact mute / menu (white on the grey bubble) |
| `shadow-md flex items-center justify-center transition-colors` | `shadow-pill flex items-center justify-center transition-colors` | compact play |
| `<div className="text-xs text-gray-500 whitespace-nowrap">` | `<div className="text-xs text-secondary whitespace-nowrap">` | compact time |

  Then `grep -nE "gray-|white|shadow-(md|lg|xl)|text-\[" src/core/media/VoicePlayer.tsx` must print only the `text-[9px]` line.

- [ ] **Step 4: Run to verify it passes, lower the guard baseline**

Run (from `frontend/`): `npx vitest run src/core/media && npx tsc --noEmit && npm run lint`
Expected: PASS (`VoicePlayer.test.tsx`, `accent.test.tsx` unchanged). Then `UPDATE_GUARD_BASELINE=1 npx vitest run src/design/guard.test.ts && git diff src/design/guard-baseline.json`
Expected: `core/media/VoicePlayer.tsx` 3 → 1; nothing else changes.

- [ ] **Step 5: Commit**

```bash
git add frontend
uv run git commit -m "refactor(media): move the voice player to ink neutral tokens" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The Yodel geo warning takes its login's group

**Files:**
- Modify: `frontend/src/shell/components/LoginModal.tsx`, `frontend/src/shell/components/entryDialogs.test.tsx`

**Interfaces:**
- Consumes: `ScopeValue` with `scope: 'group'` (Task 1), `groupScopeStyle`.
- Produces: nothing for later tasks.

Why: `LoginModal`'s group scope is a `style` on a `div` inside its portal; the `ConfirmDialog` it opens is another portal, so it inherits the screen behind the login (brand on the landing carousel, the active group elsewhere), not Yodel. Spec §4: the login dialog is "that group", and a dialog inherits its opener's context.

- [ ] **Step 1: Write the failing test** — append to `entryDialogs.test.tsx` (add `import { BrandScope } from '../../design/brandScope';`):

```tsx
describe('login geo warning scope (R-d)', () => {
    it('takes the Yodel login’s colours, even over a brand screen', async () => {
        server.use(http.get('/api/auth/geo-availability', () => HttpResponse.json({ blocked: true })));
        render(
            <BrandScope>
                <LoginModal serviceId="yodel" featureId="messages" onClose={vi.fn()} onSuccess={vi.fn()} isFreshPrompt />
            </BrandScope>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Connect Account' }));
        const warning = await screen.findByRole('dialog', { name: 'Yodel is available in Japan only' });
        expect(warning).toHaveAttribute('data-scope', 'group');
        expect(warning.style.getPropertyValue('--ds-accent')).toBe(groupRoles('yodel').action);
        expect(within(warning).getByTestId('modal-header')).toHaveClass('bg-expressive-header');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npx vitest run src/shell/components/entryDialogs.test.tsx -t "geo warning scope"`
Expected: FAIL (`data-scope` is `brand`).

- [ ] **Step 3: Implement** — `frontend/src/shell/components/LoginModal.tsx`:
  - `import { ScopeContext } from '../../design/scopeContext';`
  - before the `return`, `const scopeStyle = groupScopeStyle(groupId);`; the login's inner wrapper uses `style={scopeStyle}`.
  - wrap the `<ConfirmDialog … />`:

```tsx
            {/* The warning is its own portal: hand it this login's group so it does not inherit the screen behind (spec §4). */}
            <ScopeContext.Provider value={{ scope: 'group', style: scopeStyle }}>
                <ConfirmDialog
                    open={showGeoWarning}
                    title={t('login.yodelJpOnlyTitle')}
                    message={t('login.yodelJpOnlyMessage')}
                    confirmLabel={t('login.loginAnyway')}
                    cancelLabel={t('common.close')}
                    variant="warning"
                    onConfirm={confirmGeoWarning}
                    onCancel={() => { logDialogLoad('login', 'cancelled'); setShowGeoWarning(false); }}
                />
            </ScopeContext.Provider>
```

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`): `npx vitest run src/shell && npx tsc --noEmit && npm run lint`
Expected: PASS (the warning's semantic tile and `warning` button stay amber: semantic over context).

- [ ] **Step 5: Commit**

```bash
git add frontend
uv run git commit -m "fix(login): show the Yodel geo warning in the login's group" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Translate the search filter's member count

**Files:**
- Modify: `frontend/src/features/search/components/SearchFilterBar.tsx:119`, `frontend/src/features/search/components/SearchFilterBar.test.tsx`, `frontend/src/i18n/rD.test.ts`, the five locale files

**Interfaces:**
- Produces: i18n key `search.memberCount` (+ `memberCount_other` in en).

- [ ] **Step 1: Write the failing test** — append inside `describe('SearchFilterBar'` in `SearchFilterBar.test.tsx`:

```tsx
    it.each([
        ['en', 1, '1 member'],
        ['en', 3, '3 members'],
        ['ja', 3, '3人のメンバー'],
        ['zh-TW', 3, '3 位成員'],
    ] as const)('%s: counts a group’s %i member(s) in the UI language (R-d)', async (lang, count, text) => {
        await i18n.changeLanguage(lang);
        server.use(http.get('/api/search/members', () => HttpResponse.json({
            members: [], services: [{ service: 'hinatazaka46', member_count: count }],
        })));
        renderBar();
        fireEvent.focus(screen.getByRole('textbox', { name: i18n.t('search.filterByMember') }));
        expect(await screen.findByText(text)).not.toHaveAttribute('lang');
        await i18n.changeLanguage('en');
    });
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npx vitest run src/features/search/components/SearchFilterBar.test.tsx`
Expected: FAIL for `en` 1 (shows "1 members"), `ja` and `zh-TW` (show English).

- [ ] **Step 3: Add the key** to the `search` section of each locale; append `'search.memberCount'` to `RD_KEYS` and to `RD_EN_PLURALS`:
  - en: `"memberCount": "{{count}} member"`, `"memberCount_other": "{{count}} members"`
  - ja: `"memberCount": "{{count}}人のメンバー"`
  - zh-CN: `"memberCount": "{{count}} 位成员"`
  - zh-TW: `"memberCount": "{{count}} 位成員"`
  - yue: `"memberCount": "{{count}} 位成員"`

- [ ] **Step 4: Implement** — `SearchFilterBar.tsx`, the service suggestion: `sublabel: t('search.memberCount', { count: svc.member_count }),` (the component already has `const { t } = useTranslation();`; add `t` to the `useMemo` dependency list that builds `items` if it has one).

- [ ] **Step 5: Run to verify it passes**

Run (from `frontend/`): `npx vitest run src/features/search src/i18n && npx tsc --noEmit && npm run lint`
Expected: PASS (the earlier `'3 members'` assertion in the same file still holds in `en`).

- [ ] **Step 6: Commit**

```bash
git add frontend
uv run git commit -m "fix(search): translate the member count in the filter list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Diagnostics footer divider (pending decision D12)

**Files:**
- Modify: `frontend/src/design/primitives/Modal.tsx`, `frontend/src/design/rDShared.test.tsx`, `frontend/src/core/modals/DiagnosticsModal.tsx`, `frontend/src/core/modals/DiagnosticsModal.test.tsx`

**Interfaces:**
- Produces: `ModalProps.footerDivider?: boolean`; the footer element carries `data-testid="modal-footer"`.

- [ ] **Step 1: Write the failing tests**
  - append to `frontend/src/design/rDShared.test.tsx`:

```tsx
describe('Modal footer divider (R-d, pending decision D12)', () => {
    it('separates a scrolling body from its footer only when asked', () => {
        const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="t" footer={<button>OK</button>}>x</Modal>);
        expect(screen.getByTestId('modal-footer')).not.toHaveClass('border-t');
        rerender(<Modal isOpen onClose={vi.fn()} title="t" footer={<button>OK</button>} footerDivider>x</Modal>);
        expect(screen.getByTestId('modal-footer')).toHaveClass('border-t', 'border-subtle', 'pt-4');
    });
});
```

  - append inside `describe('DiagnosticsModal'` in `DiagnosticsModal.test.tsx`:

```tsx
    it('keeps the last scrolled row clear of the footer (R-d)', async () => {
        render(<DiagnosticsModal isOpen onClose={vi.fn()} />);
        await screen.findByRole('dialog', { name: 'Developer Diagnostics' });
        expect(screen.getByTestId('modal-footer')).toHaveClass('border-t', 'pt-4');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run (from `frontend/`): `npx vitest run src/design/rDShared.test.tsx src/core/modals/DiagnosticsModal.test.tsx`
Expected: FAIL (`modal-footer` not found).

- [ ] **Step 3: Implement** — `frontend/src/design/primitives/Modal.tsx`:
  - in `ModalProps` (next to `footer`): `/** A hairline and 16 px above the footer, for a long body that scrolls under it (Diagnostics). */ footerDivider?: boolean;`
  - destructure `footerDivider = false` in `OpenModal`.
  - the footer line becomes:

```tsx
                        {footer && (
                            <div data-testid="modal-footer" className={cn('flex shrink-0 items-center justify-end gap-2 px-6 pb-6', footerDivider && 'border-t border-subtle pt-4')}>
                                {footer}
                            </div>
                        )}
```

  - `frontend/src/core/modals/DiagnosticsModal.tsx`: add `footerDivider` to its `<Modal …>` props.

- [ ] **Step 4: Run to verify they pass**

Run (from `frontend/`): `npx vitest run src/design src/core && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
uv run git commit -m "fix(diagnostics): divide the footer from the scrolling body" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Zero-drift docs and changelog

**Files:**
- Modify: `docs/design/DESIGN_SYSTEM.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-11-05-design-language-v2-design.md` (§12 only, if D5 (a) is accepted)

- [ ] **Step 1: Update `docs/design/DESIGN_SYSTEM.md`** — make each statement match the code (find each anchor with `grep -n`):
  - §3, the bullet "A dialog inherits its opener's context …": replace its last sentence ("Group-scoped surfaces (`groupScopeStyle`) are not propagated through the portal: pass their style to the dialog explicitly.") with "A group-scoped surface hands its scope to a portalled child dialog with `<ScopeContext.Provider value={{ scope: 'group', style }}>` (`design/scopeContext.ts`); the login dialog does this for the Yodel location warning."
  - §3 "Group scope" bullet: replace "(its login dialog, its sync during the first-launch sync, its inline sync view, a group marker inside a brand screen)" with "(its login dialog, its inline sync view, a group marker inside a brand screen)".
  - §3 "Group markers in a brand dialog" bullet: replace "(the add-service cards, the per-group rows in Settings' Sync tab with a chip naming the group)" with "(the add-service cards, the per-group rows in Settings' Sync tab with a chip naming the group, the landing cards, the ToS links, each step of a sequential sync and its chip)" and the target list with "(`target`: `add_service`, `settings_row`, `landing`, `tos_link` or `sync_row`; `reason`: `unknown_service`)". Add: "It is a hook: call it in a small per-item component, never inside a `.map` callback."
  - §3 Status paragraph: replace its last sentence ("The entry screens (ToS, landing, setup, sync) follow …") with "The entry screens (boot, ToS, landing, setup, sync) apply it too: the screen re-apply is complete."
  - §4 Accent roles table: add a row after `header, headerText, headerBar`: "| `progress` | aurora | the title gradient (a light header: the official bar) | `bg-expressive-progress` (the sync progress fill) |"; in the `logo` row's utilities write "the light end of the gradient; `ring-accent-logo` (the landing card selection ring)"; in the `subtle` row add "`ring-accent-subtle` (the running sync step's halo)".
  - §5 restore inventory: replace the row "Landing per-group cards, ToS gradient button | group markers + the primary `Button`" with "| Landing per-group cards, ToS gradient button | group markers (`useGroupMarker(…, 'landing')`, selected ring `ring-accent-logo`, check disc `bg-accent`) + the primary `Button` |" and add "| ToS per-group links | group markers (`'tos_link'`), `text-accent-strong`, underline on hover |", "| ToS amber disclaimer, sync media warning and unresolved list | `bg-semantic-warning-subtle`, `border-semantic-warning`, `text-semantic-warning` |", "| Sync progress bar (pastel in the dialog, title gradient inline) | `bg-expressive-progress` |".
  - §8 "Marked so far" sentence: append "Entry screens mark the ToS article quotes, group names on the landing cards and the sync chip, and member names in the sync's unresolved list."
  - §9: in "**Forms never disable the submit button** (login, add service)" add "setup" to the list and append "Setup logs a missing folder as `entry_validation` (`surface` `setup`, `reason` `missing_folder`)."
  - §10 `EmptyState` bullet: replace "holding a line icon" with "holding a line icon in `text-muted` (the pre-D2 grey)" and append "`DialogStatus` and `BlogStatus` draw their `empty` kind with it (the hint is its sentence, the retry its action); the chat's no-conversation screen uses it too. A meaning icon keeps its own colour (the blog feed's Favorite-filter heart stays oshi)."
  - §10: replace the sentence "The primitives exist and are shown on `?view=design`; wiring the events into screens is the next plan." with:

```markdown
Wiring:

- **First complete sync:** `FirstSyncToast` (`shell/components/FirstSyncToast.tsx`) at the
  bottom right on the toast layer for 6 s, `pointer-events-none`, in brand scope, with the
  saved message count from `GET /api/archive/stats` when known. Shown once, after the
  first-launch sequential sync when every service finished (`shell/firstSyncCelebration.ts`,
  pref `first_sync_celebrated_at`). Breadcrumb `celebration` (`target` `first_sync`,
  `outcome` `shown`, or `skipped` with `reason` `already_celebrated` / `sync_failed`).
- **Milestones:** `useMilestone` (`features/messages/milestones.ts`) decides once per chat
  open for member chats (not group chats); pref `celebrated_milestones`. The first time a
  chat is seen its already-reached milestones are recorded silently; then at most one card
  per open (a messages milestone first, else a days one). `MilestoneFooter` shows it in
  `MessageList`'s `footer` slot, after the newest message. Breadcrumb `celebration`
  (`target` `milestone_messages` / `milestone_days`, `outcome` `shown` with `count`, or
  `seeded`).
```

  - §10 "Other brand moments" paragraph: replace with "Other brand moments: first launch (ToS, the login carousel, setup and the first sync) sits on `EntryBackdrop` (`shell/components/EntryBackdrop.tsx`: the brand orbs over `bg-window`); the boot screen is brand with an ink spinner and no orbs (it shows on every launch); the landing page is a brand sheet on the orbs with a serif `text-display` heading. About opens on a hero of brand orbs under its aurora header (logo, `text-display` serif wordmark, version) and a "your archive" row (messages, photos, days; `font-display` `tabular-nums`) from `GET /api/archive/stats` (`core/modals/archiveStats.ts`; breadcrumb `archive_stats_load`, `outcome` `ok` / `failed`; hidden on failure)."
  - Reference → Dialogs table: add "| `footerDivider` | A `border-subtle` hairline and 16 px above the footer, for a long body that scrolls under it (Diagnostics) |".
  - §12 (only if D5 (a) is accepted): add "- **Sync progress fill** is the aurora (brand) or the official title gradient (inline sync) on a grey track, about 1.0–1.2:1, as the pre-D2 pastel bar; the count and percent above it carry the value (user decision D5, R-d)." Add the same bullet to the spec's §12.
  - §14 Migration note: replace the first paragraph with "The screen re-apply (R-a frame and chat, R-b blogs, R-c dialogs, R-d entry screens and brand moments) is done. No screen applies the `default` group's roles any more; it remains only as the document-level fallback before a group is chosen (its accent roles equal the brand)." and replace "They are migrated to `*-accent-*` by the screen re-apply plan, which also:" plus its bullet list with "No re-applied screen uses them; `guard-baseline.json` lists the files that still carry ratcheted literals (pre-token media parts and data files)."

- [ ] **Step 2: Changelog** — in `CHANGELOG.md` under `## [Unreleased]`: add to `### Added`:

```markdown
- **Your archive at a glance.** About now shows how many messages and photos
  you have saved and how many days your archive spans.
- **Small celebrations.** Your first complete sync ends with a short
  celebration, and a chat shows a card when a member passes 1,000, 5,000 or
  10,000 messages, or when your subscription reaches day 100 and each full
  year. Nothing needs to be closed, and reduced motion keeps them still.
```

  and to `### Changed` (create it after `### Added` if it does not exist):

```markdown
- **First launch has its colours back.** The welcome, terms, group picker,
  folder setup and first sync use SakaDesk's soft aurora again, each group
  card and terms link in its own group colour, and the disclaimer in its
  original amber.
- **Empty screens are friendlier.** An empty list now shows a soft circle, a
  short title and a hint instead of grey text.
```

  and to `### Fixed` (create it after `### Changed` if needed):

```markdown
- **Yodel's location warning uses Yodel's colours** instead of those of the
  screen behind it.
- **The member count in the search filter is translated** into your app
  language.
```

- [ ] **Step 3: Check the docs against the code**

Run: `grep -n "its sync during the first-launch sync\|wiring the events into screens is the next plan\|applied by the next plan" docs/design/DESIGN_SYSTEM.md`
Expected: no output. Then `grep -n "bg-expressive-progress\|ring-accent-logo\|footerDivider\|useMilestone\|FirstSyncToast\|EntryBackdrop\|archive_stats_load" docs/design/DESIGN_SYSTEM.md` shows the new text, and `grep -rn "expressive-progress\|accent-logo" frontend/tailwind.config.js` shows both utilities.

- [ ] **Step 4: Commit**

```bash
git add docs CHANGELOG.md
uv run git commit -m "docs(design): record the entry and brand-moment re-apply" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Full verification and the before/after page

**Files:**
- Create (git-ignored): `frontend/e2e-shots/r-d/section.mjs`
- Modify (outside the repo): `/mnt/c/D/saka-verify/shots/index.html`, `/mnt/c/D/saka-verify/shots/r-d/after/`

- [ ] **Step 1: Full checks**

Run (from `frontend/`): `npm run test:run && npx tsc --noEmit && npm run lint`, then from the repo root `uv run pytest backend/tests -q && uv run ruff check backend`
Expected: all pass (the known headless keyring failure lives in pysaka, not here). Record the counts for the PR. `git diff b0b71c5 -- frontend/src/design/guard-baseline.json` must show only removals and the VoicePlayer 3 → 1.

- [ ] **Step 2: e2e locks**

Run (from `frontend/`, port 8000 free): `npm run build && npx playwright test e2e/entry-flow.spec.ts e2e/dialogs-app.spec.ts e2e/chat-frame.spec.ts e2e/blogs.spec.ts --reporter=line`
Expected: all pass. `entry-flow.spec.ts` may assert the old disabled Accept / Start / Get Started (`toBeDisabled()`) or the D2d sync colours: change only those assertions to the R-d behaviour (`aria-disabled="true"` for ToS / landing, click-to-validate for setup, brand dialog), in a separate commit `test(e2e): follow the R-d entry behaviour`.

- [ ] **Step 3: Capture "after"**

Run: `SHOT_LABEL=after npx playwright test e2e/r-d-screens.spec.ts --reporter=line && mkdir -p /mnt/c/D/saka-verify/shots/r-d && cp -r e2e-shots/r-d/after /mnt/c/D/saka-verify/shots/r-d/`
Expected: `9 passed`; the `dev` file names plus `first-sync-toast.png`.

- [ ] **Step 4: Write the page generator** — `frontend/e2e-shots/r-d/section.mjs`

```js
// Adds (or replaces) the R-d section of the Windows comparison page: base (e4e4118) / dev / after.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = '/mnt/c/D/saka-verify/shots'
const cols = [['base', 'e4e4118（D2 前）'], ['dev', 'dev（R-d 前）'], ['after', 'R-d 後']]
const names = readdirSync(`${root}/r-d/after`).filter((f) => f.endsWith('.png')).sort()
const fig = ([label, caption], file) => existsSync(`${root}/r-d/${label}/${file}`)
  ? `<figure><figcaption>${caption}</figcaption><a href="r-d/${label}/${file}" target="_blank"><img loading="lazy" src="r-d/${label}/${file}"></a></figure>`
  : `<figure><figcaption>${caption}</figcaption><div class="none">—</div></figure>`
const rows = names.map((f) => `<div class="row"><h3>${f.replace('.png', '')}</h3><div class="pair trio">${cols.map((c) => fig(c, f)).join('')}</div></div>`).join('')
const section = `<section id="r-d"><h2>R-d 進入畫面與品牌時刻（v2 重新套用）</h2><style>.trio{grid-template-columns:1fr 1fr 1fr}</style>${rows}</section>`

let html = readFileSync(`${root}/index.html`, 'utf-8')
html = html.replace(/<section id="r-d">[\s\S]*?<\/section>/, '').replace(/<a href="#r-d">[^<]*<\/a>/, '')
html = html.replace('</nav>', `<a href="#r-d">R-d 進入畫面（${names.length}）</a></nav>`)
html = html.replace('</main>', `${section}</main>`)
writeFileSync(`${root}/index.html`, html)
console.log(`r-d: ${names.length} rows`)
```

- [ ] **Step 5: Build the section**

Run: `node e2e-shots/r-d/section.mjs`
Expected: `r-d: <n> rows` with `n` = the number of PNGs in `after/`. Optionally show it on Windows (no WSLg): `powershell.exe -NoProfile -Command "Start-Process 'C:\D\saka-verify\shots\index.html'"`.

- [ ] **Step 6: Review the shots** — for every row compare `after` with `base` and note in the PR body any place where `after` is still neutral where `base` had colour, or differs from decisions D1–D13. Check specifically: the boot spinner in ink; ToS on the orbs with a dark aurora header, the document icon, the amber disclaimer, four links in four group colours, ink checkbox, gradient Accept; landing orbs, serif heading, white cards with logo-colour rings when picked; login over the orbs; setup icon and the missing-folder message; the sync dialog's aurora header, aurora bar, coloured step bars and chip, ink dot and detail, amber media warning; the inline sync's title-gradient bar; About's orbs hero, display wordmark and stats; Diagnostics' footer hairline; empty states (search, favourites, blog feed, chat welcome) with soft circles, grey icons and serif titles; the 5,000 milestone card at the end of the chat (`chat-end`); the first-sync toast. Fix in a follow-up task before asking for review; do not commit the shots.

- [ ] **Step 7: Keep the base worktree** — leave `../SakaDesk-e4e4118` (the Windows acceptance pass may reuse it); `git worktree list` shows it.

---

## Self-review notes

- Spec coverage: §4 BRAND entry screens → Task 2 (boot, ToS, backdrop), 3 (landing), 4 (setup), 5 (sync dialog); markers → Tasks 2 (ToS links), 3 (landing cards), 5 (sync steps + chip); GROUP → login keeps its scope and now hands it to its warning (Task 12), `InlineSyncView` stays group (Task 5). §3.3 white surfaces → landing sheet, white cards, `bg-elevated` boxes. §3.4 semantic → ToS disclaimer, sync media warning, unresolved list (Tasks 2, 5); oshi heart untouched (Task 6). §5 L2 → `EntryBackdrop`, landing `Atmosphere`, About hero (Tasks 2, 3, 8); restore inventory "Landing per-group cards, ToS gradient button" → Tasks 2–3. §6 → serif display (landing, About, empty-state titles, celebration numbers), `tabular-nums` (About stats, milestone card), `lang="ja"` (ToS quotes, group names, member names). §8 → `disabledReason` (ToS, landing), validate on click (setup), hover lift + glow (landing cards). §9 first launch → Tasks 2–5, 9; empty states → Tasks 1, 6; About → Tasks 7–8; celebrations → Tasks 9 (B), 10 (C); birthday out of scope (spec: later). §12 → D5 bar contrast added if accepted (Task 15). Brief cleanups → Tasks 11 (VoicePlayer), 12 (LoginModal geo warning), 13 (SearchFilterBar "members", five locales), 14 (Diagnostics footer). Breadcrumbs → Task 1 registers `entry_validation`, `archive_stats_load`, `celebration` and the new marker targets (frontend + backend + pytest); backend structlog events in Task 7. Base / dev shots → Task 0; after + page → Task 16.
- Names used across tasks: `AccentRoles.progress` / `--ds-expressive-progress` / `bg-expressive-progress` (1 → 5); `ring-accent-logo` (1 → 3), `ring-accent-subtle` (1 → 5); `ScopeValue.scope: 'group'` (1 → 12); `GroupMarkerTarget` `landing` / `tos_link` / `sync_row` (1 → 3, 2, 5); `EntryBackdrop` (2 → 9's App edits sit next to it); `SequentialSyncInfo.services` (5 → 9); `SequentialSyncOutcome` + `startSequentialSync(): Promise<SequentialSyncOutcome>` (9); `useArchiveStats`, `archiveDays` (8 → 9); `FIRST_SYNC_PREF`, `decideFirstSync`, `celebrateFirstSync`, `FirstSyncToast`, `FIRST_SYNC_TOAST_MS` (9); `MILESTONES_PREF`, `decideMilestone`, `useMilestone`, `MilestoneFooter`, `MessageList footer` (10); `ModalProps.footerDivider`, `data-testid="modal-footer"` (14); `RD_KEYS` / `RD_EN_PLURALS` (1 → 2, 4, 8, 9, 10, 13).
- Checked while planning: `groupScopeStyle` = `groupTokenVars`, which includes `accentTokenVars(groupAccent(id))`, so markers carry `--ds-accent`, `--ds-accent-strong`, `--ds-accent-logo` and (after Task 1) `--ds-expressive-progress`; `brandScopeStyle` sets accent variables only, never `--ds-group-accent`; `Button disabledReason` makes the button `aria-disabled` (tests that used `toBeDisabled()` are updated); the 1:1 chat's count is `data.total_count` (fixture `total_count` = 5,000, so the `chat-end` shot gets the 5,000 card); msw rejects unhandled requests, hence the default `/api/archive/stats` handler; the search index skips messages without text, so it cannot count photos (hence the per-file stat cache in Task 7); `startSync` never resolved a sequential callback on a refused start (fixed in Task 9 so a failed start counts and the sequence goes on); contrast numbers in D3 / D4 / D5 computed with the WCAG formula.
- Soft spots to confirm while executing: the exact locale section order (keys may be appended anywhere inside the section); `e4e4118` locators in the base worktree (Task 0 Step 4); whether `uv run mypy backend` is part of CI (run it if it is); `entry-flow.spec.ts` assertions on disabled buttons (Task 16 Step 2).
