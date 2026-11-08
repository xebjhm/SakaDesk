# v2 real-data QA fixes + sent-letter viewer (R-f) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every defect the real-data QA run found (report: `/mnt/c/D/saka-verify/qa/report.md`, screenshots `/mnt/c/D/saka-verify/qa/shots/`), apply the owner's decisions from acceptance round 2, and add a sent-letter viewer.

**Architecture:** Mostly local CSS/markup fixes in the affected components, one new `Modal` slot (a non-scrolling toolbar under the header), a backend avatar-resize route with an on-disk cache, and a new `LetterViewerModal` reusing the media-viewer frame.

**Tech Stack:** React 18 + TypeScript + Tailwind tokens (`frontend/src/design/`), Vitest + Testing Library; FastAPI backend + pytest; Pillow (already in `uv.lock`, promoted to a direct dependency).

## Global Constraints

- Owner decisions (2026-11-08), binding: muted text token becomes `#6b7280`; the 翻譯 (translate) control becomes neutral; the "jump to earliest unread" floating button keeps the group colour (original design); fix the call popup's edge ring so Windows 11 window-corner rounding cannot cut it; Hinatazaka unread shelters take the official-app colours picture `#b2caed`, video `#ceadec`, voice `#b7acec`, text `#85badd` (style `classic`; icons unchanged — keep the current lucide outline icons); sent letters open a viewer (letter image left, full letter text right, a timestamp link at the bottom that jumps to the letter in the chat, like the photo/video viewer).
- NOT in scope (decided earlier, do not change): bubble border and unread badge colours (v2 colour spec, owner-picked), primary button gradient contrast (accepted deviation §12), header white text on pale gradients (official look).
- THE colour rule in `docs/design/DESIGN_SYSTEM.md` "When to use the group colour" applies to anything you touch.
- Tokens only: `frontend/src/design/guard.test.ts` must pass and baselines may only decrease; no hex / rgb / hsl literals in components, no arbitrary radius / shadow / text / spacing / z values, no named palette classes. New colours go in the token sources and are registered in `tailwind.config.js`, `design/cssVars.ts` (if a CSS var), and `utils/classnames.ts` (tailwind-merge). The incoming-call CSS (`features/incomingCall/callScreen.css`) is an existing hand-written stylesheet; edit it in place using its existing custom properties.
- i18n: every new user-facing string through `t()` with keys in all five locales (`frontend/src/i18n/locales/*`).
- Breadcrumbs: every new decision / failure / skip path logs a structured `clientLog` event (no text, no PII); register new event names in `frontend/src/utils/clientLog.ts` AND `backend/api/client_log.py` allow-list with a pytest case. Backend logs via `structlog`/`logging`, never `print`.
- Backend: `pathlib.Path`, `open(..., encoding="utf-8")` for text, no `time.sleep`, CPU-bound work (image resize) off the event loop (`asyncio.to_thread` / executor), never serve files outside the output dir (reuse the existing media path validation).
- Docs zero drift: JSDoc, DESIGN_SYSTEM.md and CHANGELOG `[Unreleased]` (end-user wording per `docs/DOC_FORMATS.md`) updated in the task that changes the behaviour.
- Commits: Conventional Commits ≤ 72 chars via `uv run git commit` from the SakaDesk repo root; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: frontend `cd frontend && npx vitest run <files>` + `npx vitest run src/design/guard.test.ts` + `npx tsc --noEmit` + `npx eslint <files>`; backend `uv run pytest <files> -q`.

---

### Task 1: Incoming-call card and popup edges (H1, M6)

**Files:** `frontend/src/features/incomingCall/callScreen.css` (~32-66, ~169-179), `features/incomingCall/CallScreen.tsx` (~41-44, 73-77), `features/callPopup/PopupCall.tsx` (~100), their tests.

- Clip the whole call screen to its rounded shape so the masked `backdrop-filter` bands cannot paint outside the corners: `clip-path: inset(0 round var(--sd-rad))` on `.sd-call-screen` (keep `overflow:hidden`), and give `.sd-call-band--top` / `--bottom` matching corner radii as a belt-and-braces measure.
- Draw exactly one edge line: remove the screen's own `0 0 0 1px` white ring OR move the halo outside (`inset:-2px`), so ringing shows one accent halo and connected one 1px line — never two stacked lines.
- Popup window (`--sd-rad:0px`, square page in a Windows 11 rounded window): do not draw an inset ring along the page edges at all (corner rounding would cut it). Keep the ringing pulse/halo effect inside the card area only, inset from the window edge by at least 8px, or drop the popup ring if it has no other role. Document the reason in a CSS comment.
- Tests: assert the class/style hooks (e.g. a test that the popup root has no edge ring class/variable; the CSS file contains `clip-path: inset(0 round var(--sd-rad))` for `.sd-call-screen` — read the CSS file in the test).
- Commit: `fix(call): clip call card corners and draw one edge line`

### Task 2: Dialog toolbar slot; gallery and album scroll bleed (H2)

**Files:** `design/primitives/Modal.tsx` (~165 body), `core/media/MediaGalleryModal.tsx` (~364 tablist, ~411/503 month headers, ~583), `features/blogs/components/BlogPhotoGalleryModal.tsx` (~203, 223), tests, DESIGN_SYSTEM.md Dialogs table.

- Add `toolbar?: React.ReactNode` to `Modal` (standard layout): rendered between the header (and its bar) and the scrolling body, not scrolling, opaque `bg-sheet`, with the body's horizontal padding rules left to the caller. JSDoc + Dialogs table row.
- Media gallery and blog photo gallery: move the tab bar into `toolbar`; body `pt-0`; month headers `sticky top-0` (they now stick to the scroller's top edge). The scrollbar then starts below the tabs.
- Tests: Modal renders `toolbar` outside the scroll container (`modal-body` testid or equivalent); gallery tablist is not a descendant of the scroller; month header has `top-0`.
- Commit: `fix(media): keep gallery tabs out of the scrolling area`

### Task 3: Avatar button and focus rings (H3, M5)

**Files:** `features/messages/components/MessageBubble.tsx` (~332-347), `design/primitives/Button.tsx` (~14 focus ring) / `IconButton`, `design/primitives/Modal.tsx` (expressive header buttons), chat header ⋯ button (`features/messages/components/ConversationMenu.tsx` or the chat header file — find the ⋯ trigger), tests.

- Chat avatar button: `flex` (or make `Avatar` `block`) so the button box is exactly the avatar size (40×40); round focus-visible ring with tokens `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface`; the hover ring stays circular.
- Buttons on the expressive (gradient) header (chat header ⋯, dialog close): focus-visible ring in the header text colour (`focus-visible:ring-expressive-header` — add the ring colour mapping if missing) instead of the accent, so no accent sits on the gradient. Keep keyboard focus visible.
- Tests: avatar button has `flex` and the focus ring classes; header buttons' focus ring is not `ring-accent`.
- Commit: `fix(chat): round avatar focus ring and neutral header focus`

### Task 4: Member list ring and avatar sharpness (H4, H5)

**Files:** backend: new route in `backend/api/` (follow the existing media-serving module that serves `group_thumbnail` / `thumbnail_local` — find it with `grep -rn "thumbnail" backend/api`), a small `backend/services/avatar_resize.py`, `pyproject.toml` (`uv add pillow` — already in `uv.lock`), tests `backend/tests/test_avatar_resize*.py`. Frontend: `features/messages/components/MemberList.tsx` (~253-274), `design/primitives/Avatar.tsx` (~40), tests.

- Backend: `GET` route that returns a square-cropped-or-fit, Lanczos-downscaled JPEG/WebP of a local archived avatar at a requested width from an allow-list (`64, 128, 192, 256`), cached on disk under the app cache dir keyed by source path + mtime + width; resize runs in a thread; path validation identical to the existing media route (reject anything outside the output dir → 404); if Pillow fails to open the file, log a structured warning and return the original file. Never upscale.
- Frontend: member-list avatars request the 192 px variant when the source is a local archived file (fall back to the current URL for remote/unknown sources).
- Move the offline/graduated filter and the hover scale from the wrapper to the `<img>` only (new `Avatar` prop `imgClassName` / `imgStyle`, documented), so the selection ring and its white gap are never filtered or scaled. Soften the inactive look to `opacity` + `saturate` without `contrast(.8)` — use the closest existing classes (`opacity-75 saturate-50`) — and keep graduated sepia on the image only. Drop the hover scale for the selected avatar.
- Tests: pytest for the route (resize, cache hit, allow-list rejection, path traversal 404, non-image fallback); vitest that the ring element carries no filter/transform and the img does.
- Commit(s): `feat(media): serve resized archived avatars` and `fix(members): keep the selection ring sharp and unfiltered`

### Task 5: Chat date pill and floating sync pill (H6, M9)

**Files:** `design/primitives/DatePill.tsx` (~25), `features/messages/components/MessageBubble.tsx` (~275 shelter z, ~359 translate), `features/messages/components/MessageList.tsx` (~71-77), `features/messages/components/MemberList.tsx` (sync pill), tests.

- The sticky date pill must paint above message rows, shelters included: give message rows their own stacking context (`isolate`) so the shelter's z-index stays inside the row, and keep the pill on the existing sticky layer (use the z token pattern the codebase already uses — inline `Z_INDEX` constant if classes are guarded).
- The pill must not cover hover tools: the translate button must remain clickable when the first visible message sits under the pill (e.g. pill `pointer-events-none` except the pill itself, and the row's hover tools not under the centre column — choose the minimal fix and test it).
- Member list: add bottom padding to the scrolling list equal to the floating 上次同步 pill height + gap so the last row can scroll clear of it.
- Tests for each behaviour (classes / DOM order assertions).
- Commit: `fix(chat): keep the date pill above covers and clear of tools`

### Task 6: Small visual fixes and owner colour decisions (M3, M7, L1, L7, Hinatazaka shelters)

**Files:** `design/tokens/color.ts` (`text.muted` → `#6b7280`), `design/tokens/groups.ts` (hinatazaka `official.shelter` → `{ picture: '#b2caed', video: '#ceadec', voice: '#b7acec', text: '#85badd' }`, comment "taken from the official app screenshots, 2026-11-08"), `features/messages/components/MessageBubble.tsx` (~288 classic shelter icon opacity → 100%; ~447 transcript footer: no second border colour — reuse the bubble border colour or drop the footer's own border so one edge line remains), the translate control (find with `grep -rn "translate" features/messages/components/*.tsx`) → neutral (`text-secondary hover:text-primary`, no accent), token/unit tests that pin these values, DESIGN_SYSTEM.md (muted value, shelter note, translate under neutral examples), the v2 spec shelter table if it lists Hinatazaka values.
- Nogizaka and Yodel `official.shelter` values are approximations from the first theme commit (67fa58a), not verified against the official apps. Leave the values unchanged and add a code comment above each saying so and that they are to be re-taken from official-app screenshots later (owner decision 2026-11-08).
- Commit: `fix(ui): darker muted text, official Hina covers, neutral translate`

### Task 7: Loading placeholders (L4, L5)

**Files:** `core/modals/FavoritesModal.tsx`, the member select dialog (`features/blogs/components/MemberSelectModal.tsx` or similar), tests.

- While media/avatars load, show a neutral skeleton (`bg-sunken animate-pulse motion-reduce:animate-none`) instead of empty white cards / blank pale circles; once the image loads (or fails → existing fallback), replace it. Reuse an existing skeleton pattern if the codebase has one (`grep -rn "animate-pulse" frontend/src`).
- Commit: `fix(ui): show placeholders while favourites and members load`

### Task 8: Sent-letter viewer

**Files:** new `frontend/src/core/modals/LetterViewerModal.tsx` (+ test), `core/modals/SentLettersModal.tsx`, `features/messages/MessagesFeature.tsx` (~460 `setLetterViewer`), `features/messages/components/LetterRow.tsx`, i18n keys ×5, `clientLog` + backend allow-list + pytest, DESIGN_SYSTEM.md (which primitive when), CHANGELOG.

Behaviour:
- Clicking a letter in the Sent letters dialog opens `LetterViewerModal` instead of jumping to the chat. Clicking a letter image in the chat timeline (`LetterRow` → today's `setLetterViewer`) opens the same viewer.
- Layout (sheet dialog, `Modal tone="sheet"`, wide, group scope inherited): left the letter image (fit, `object-contain`, on a neutral `bg-sunken` stage; if `image_url` is null show the existing missing-media fallback), right the full `letter.text` (scrollable, `whitespace-pre-wrap`, `lang="ja"`, reading font as message text), below them a footer with the send date/time as a link button (neutral text, underline on hover — not accent) that closes the viewer (and the Sent letters dialog if open) and jumps to the letter in the chat — reuse the existing `onSelectLetter(id)` jump path. Prev/next between letters (buttons + ←/→ keys) in the order of the list it was opened from, like the photo viewer. Below ~900 px width stack image above text.
- Breadcrumbs: `letter_viewer` open (source: `sent_letters` | `timeline`) and `letter_jump`.
- Tests: opens from both entry points; shows image + full text; timestamp link calls the jump with the right id and closes; prev/next and keys; null image fallback; i18n keys present in all locales.
- Commit: `feat(letters): open sent letters in a viewer with full text`

### Task 9: CHANGELOG and full checks

- CHANGELOG `[Unreleased]`: Fixed — call card corners; gallery photos no longer slide under the tabs; sharper member photos and a clean selection ring; the date label stays on top; lighter text is easier to read (Changed); Hinatazaka unread covers use the official colours (Changed); Added — sent letters open in a viewer with the full text. End-user wording, no identifiers, merge into existing sections.
- Full suites: `cd frontend && npx vitest run && npx tsc --noEmit && npx eslint src`; `uv run pytest -q`.
- Commit: `docs(changelog): note QA fixes and the letter viewer`
