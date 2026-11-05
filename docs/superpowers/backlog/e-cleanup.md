# E clean-up list

Items found during D2a, D2b, D2c and D2d that were left on purpose. Pick them up in E.

- **Live letters endpoint unused.** `GET /api/chat/letters/{group_id}` (`backend/api/chat_features.py`) is no longer called by the UI (letters come from `letters_local`); remove it and its model, or keep it only if something else needs it.
- **Visible range resolved twice per frame.** `MessageList.resolveVisibleRange` (`frontend/src/features/messages/components/MessageList.tsx`) and `useChatScroll.resolvePending` (`frontend/src/features/messages/hooks/useChatScroll.ts`) both resolve the visible range on each frame; share one result.
- **Backend layering.** `backend/services/archive_urls.py` imports fastapi and content helpers, so a service depends on the api layer (used by `backend/api/chat_features.py` and `backend/api/account.py`); move the HTTP parts up into `api`.
- **Duplicate helpers.** `LetterRow.timeOf` (`frontend/src/features/messages/components/LetterRow.tsx`) repeats the time format of `MessageBubble`; the single-item `MediaViewerModal` use for letters repeats what `frontend/src/core/media/PhotoDetailModal.tsx` already does.
- **Quick revisit after a failed first load.** In `frontend/src/features/messages/hooks/useRoomLetters.ts`, `alreadyReady` can let letter rows appear in an already mounted list after a failed first load, which shifts rows; keep the list stable.
- **Path forms differ.** `serviceOfPath` (`frontend/src/features/messages/readStatePath.ts`) accepts id folders, while the backend `letters_local` accepts display-name paths only; align them, or move the e2e fixture (`frontend/e2e/fixtures/bigRoom.ts`) to display-name paths.
- **Profile fetched for group chats.** `useRoomExtras` (`frontend/src/features/messages/hooks/useRoomExtras.ts`) fetches the account profile for group chats, where it is unused; skip it.
- **`TranslateButton` palette.** `frontend/src/core/common/TranslateButton.tsx` builds its colours from hex + alpha; move it to tokens (shared with the chat).
- **Rail: fast move then click selects nothing.** Moving fast and clicking at once in `frontend/src/features/blogs/components/TimelineRail.tsx` selects no post.
- **Back label on the timeline path.** "Back to latest blogs" in `frontend/src/features/blogs/components/BlogReader.tsx` is misleading when the reader was opened from a member timeline.
- **Fonts are not pinned in the shots.** `frontend/e2e/d2b-screens.spec.ts` and `frontend/e2e/visual-zero-pixel.spec.ts` depend on the Google Fonts load; pin or stub the fonts.
- **`formatBlogDate` tests.** Add zh-CN, yue, midnight and the ICU "at" separator cases to `frontend/src/utils/dateFormatters.test.ts`.
- **`d2b.test` only checks truthy.** Tighten the assertions in `frontend/src/i18n/d2b.test.ts` (line 27).
- **A to B to A in-flight spinner.** Going A, B, A quickly in `frontend/src/features/blogs/BlogsFeature.tsx` can leave the spinner running while the in-flight guard skips the second load of A.
- **`nav_list` skip breadcrumbs.** `frontend/src/features/blogs/BlogsFeature.tsx` skips the member-list load silently in some paths; log them through `logBlogLoad`.
- **Breadcrumb test coverage.** `frontend/src/features/blogs/BlogsFeature.test.tsx` covers recent, sync and search_open only; add `content`, `nav_list` and `member_posts`.
- **`Math.random` animation delays.** `frontend/src/features/blogs/components/RecentPostsFeed.tsx` picks new-post reveal delays on every render; compute them once per post.
- **Breadcrumb as `<nav>`.** The reader's breadcrumb in `frontend/src/features/blogs/components/BlogReader.tsx` should be a `<nav>` with `aria-current` on the current item.
- **More `memberWash` cases.** Extend `frontend/src/features/blogs/memberWash.test.ts` (name without spaces, blog-id lookup, malformed hex).
- **Post HTML `class` is allowed.** DOMPurify `ALLOWED_ATTR` in `frontend/src/features/blogs/components/BlogReader.tsx` keeps `class`, so a post can pick up app utilities; remove it (hardening).
- **e2e ring locator.** The `.border-2` locator for the rail hover ring in `frontend/e2e/d2b-screens.spec.ts:46` follows a class, not a role; use a test id.
- **Hard-coded colon in the screen-reader prefix.** `frontend/src/features/blogs/components/BlogNavFooter.tsx` renders `{prefix}:`; move the separator into the i18n string.
- **Rail tooltip covers the year label.** The card tooltip in `frontend/src/features/blogs/components/TimelineRail.tsx` hides the year label beside it.

## From D2c

- **Player internals on tokens.** `VideoPlayer`'s control bar, the `VoicePlayer` cards, `TranscriptPanel`, `TranscribeButton` and `SubtitleOverlay` (`frontend/src/core/media/`) still take the group colour as a hex prop and use palette classes; move them to tokens together with `TranslateButton` (D2c spec decision 15).
- **`UpgradeIcon` ring.** `frontend/src/core/layout/UpgradeIcon.tsx` uses `text-blue-500` and palette classes for its progress ring.
- **Search autocomplete keys.** The member autocomplete in `frontend/src/features/search/components/SearchFilterBar.tsx` has no ↑ / ↓ selection.
- **`BlogsFeature` `keysEnabled`.** Now that the blog dialogs are `aria-modal`, `arrowKeys.ts` alone covers them; the `keysEnabled` prop through `BlogReader` to `BlogNavFooter` can go.
- **One viewer key model, three viewers.** `MediaGalleryModal` (`frontend/src/core/media/MediaGalleryModal.tsx`), `FavoritesModal` (`frontend/src/core/modals/FavoritesModal.tsx`) and `MediaViewerModal` (`frontend/src/core/media/PhotoDetailModal.tsx`) each wire ← / → / ↑ / ↓ and the video and voice key hand-off themselves; define one viewer key model (who owns which key while a video, a voice note or a menu has focus) and share one implementation.
- **Search keyboard scope.** In `frontend/src/features/search/SearchModal.tsx`, Tab and Enter move through and open results from anywhere in the dialog; scope them to the input so the filter controls are reachable by keyboard (today Tab never leaves the result list).
- **Search mention combobox semantics.** The member mention field in `SearchFilterBar.tsx` should be a real combobox: `aria-selected` on the active option, arrow keys, and its own label instead of the shared "Filters" label the date and type menus also use.
- **Narrow the `DATA_COLOUR` exemption.** `frontend/src/core/dialogs.style.test.ts` skips the inline-colour check for whole files (`BackgroundModal`, `SearchFilterBar`); allow only the specific data-colour lines instead.
- **Heart touch target.** About's heart button (`frontend/src/core/modals/AboutModal.tsx`) is a 12 px icon; give it at least a 24 px hit area without moving the icon.
- **Re-indent `DiagnosticsModal`.** `frontend/src/core/modals/DiagnosticsModal.tsx` kept its old indentation when it moved onto `Modal`; re-indent it in a whitespace-only commit.
- **Fragile locators.** The context-menu position lock (inline `style.left` / `style.top` in `frontend/src/features/messages/components/MemberContextMenu.test.tsx`), the ReportIssue category pick (first button that is not Cancel, `frontend/src/core/modals/ReportIssueModal.test.tsx`) and the search-row lookup through `parentElement.parentElement` (`frontend/src/features/search/SearchModal.test.tsx`) follow layout, not roles; give them roles or test ids.
- **Config substring test.** `frontend/src/design/d2cTokens.test.ts` checks `tailwind.config.js` by substring; load the config and assert on the parsed values.
- **Dev warning naming.** `Modal`'s development `console.warn` messages (`frontend/src/design/primitives/Modal.tsx`) use a `[Modal]` prefix that matches nothing else; use one naming scheme for dev warnings across the primitives.
- **`checkVisibility` needs Chromium 121+.** `frontend/src/design/dialog/tabbables.ts` relies on `Element.checkVisibility` (with a fallback for jsdom); confirm the WebView2 floor or keep the fallback tested.
- **`Z_INDEX` depth.** `dialogZIndex` (`frontend/src/design/dialog/dialogStack.ts`) assumes at most about 20 stacked dialogs so `DIALOG + depth × DIALOG_STEP` stays far below `POPOVER`; cap or assert it.
- **Style-ratchet gaps.** `VideoPlayer`, `VoicePlayer` and `MessagesFeature` are not in the `FILES` list of `frontend/src/core/dialogs.style.test.ts` (they still have palette classes); add them once the player internals and the chat screen are on tokens.
- **Reset row error.** In `frontend/src/shell/components/SettingsModal.tsx`, `save('reset', …)` can set `failedRow = 'reset'`, but no row renders `rowError('reset')`, so a failed Reset to defaults shows only the App toast. Either show the error on the footer row or drop `'reset'` from `SaveRow`.
- **Inline settings error announcement.** `frontend/src/shell/components/SettingRow.tsx` mounts its `role="status"` paragraph together with its text, so some screen readers may not announce it. Keep the region mounted empty, as the AI tab does.
- **Leftover `z-50` classes.** The DESIGN_SYSTEM "Layering" rule says use `Z_INDEX` only, but `frontend/src/features/blogs/components/TimelineRail.tsx` (rail tooltip) and `frontend/src/core/media/VideoPlayer.tsx` (player toast) still use `z-50`.

## From D2d

- **A lifted call stays lifted.** A call that started over a dialog (`frontend/src/features/incomingCall/CallOverlay.tsx`) keeps its portaled layer after that dialog closes, so for the rest of the call it is above menus anchored in the frame (`Z_INDEX.DROPDOWN`), e.g. the chat ⋯ menu; consider dropping back into the frame when no earlier dialog is left (without remounting the audio).
- **Call focus under a lifted call.** When a call is lifted above a dialog, focus stays in the dialog (the call never takes focus from a dialog), so Escape closes the dialog before it declines the call; decide whether a lifted call should take focus.
- **`/init` failure after a successful login.** In `frontend/src/shell/components/LoginModal.tsx` (`doLogin`), the login POST succeeds but a thrown `/api/settings/service/…/init` request lands in the same `catch`, so the dialog shows "failed" (or the raw error text) and the user retries a login that already worked (single-session token); a non-OK `/init` answer is not checked at all.
- **Sync speed unit is not translated.** The stat tile's unit (`frontend/src/utils/syncFormatters.ts`, `formatSyncSpeedParts`) is the backend's `speed_unit` code plus "/s" (e.g. `groups/s`), shown as is in every language (pre-existing).
- **A second login dialog cannot be closed while another login runs.** `LoginModal` (`frontend/src/shell/components/LoginModal.tsx`) bases `dismissible` and its Close and Cancel buttons on the app-wide login lock (`loginLock.ts`), so a dialog App mounts while another dialog's login is in flight stays open for up to the 300 s browser-login timeout, with no reason shown. Track lock ownership per dialog: keep the primary disabled on the global lock, but let a dialog that does not own the lock close.
- **A refused start can clear a verify's modal flag.** In `frontend/src/shell/hooks/useSync.ts`, the refused and failed branches of `startSync` clear `blockingRef` for the service, and `verifyAndFix` does not check `startingRef`, so a verify started while a start POST is in flight can lose its modal flag (very unlikely).
