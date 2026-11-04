# E clean-up list

Items found during D2a that were left on purpose. Pick them up in E (or D2c where noted).

- **Live letters endpoint unused.** `GET /api/chat/letters/{group_id}` (`backend/api/chat_features.py`) is no longer called by the UI (letters come from `letters_local`); remove it and its model, or keep it only if something else needs it.
- **Visible range resolved twice per frame.** `MessageList.resolveVisibleRange` (`frontend/src/features/messages/components/MessageList.tsx`) and `useChatScroll.resolvePending` (`frontend/src/features/messages/hooks/useChatScroll.ts`) both resolve the visible range on each frame; share one result.
- **Backend layering.** `backend/services/archive_urls.py` imports fastapi and content helpers, so a service depends on the api layer (used by `backend/api/chat_features.py` and `backend/api/account.py`); move the HTTP parts up into `api`.
- **Duplicate helpers.** `LetterRow.timeOf` (`frontend/src/features/messages/components/LetterRow.tsx`) repeats the time format of `MessageBubble`; the single-item `MediaViewerModal` use for letters repeats what `frontend/src/core/media/PhotoDetailModal.tsx` already does.
- **Quick revisit after a failed first load.** In `frontend/src/features/messages/hooks/useRoomLetters.ts`, `alreadyReady` can let letter rows appear in an already mounted list after a failed first load, which shifts rows; keep the list stable.
- **Path forms differ.** `serviceOfPath` (`frontend/src/features/messages/readStatePath.ts`) accepts id folders, while the backend `letters_local` accepts display-name paths only; align them, or move the e2e fixture (`frontend/e2e/fixtures/bigRoom.ts`) to display-name paths.
- **Profile fetched for group chats.** `useRoomExtras` (`frontend/src/features/messages/hooks/useRoomExtras.ts`) fetches the account profile for group chats, where it is unused; skip it.
- **D2c: `ring-surface` token.** Add a `ring-surface` token to replace `ring-white` in `frontend/src/design/primitives/Avatar.tsx`, the chat header avatar and the group-chat cell in `frontend/src/features/messages/components/MemberList.tsx`.
- **D2c: `MemberProfilePopup` palette classes.** Replace the named palette classes in `frontend/src/features/messages/components/MemberProfilePopup.tsx` with tokens.
- **D2c: reveal-all dialog.** The inline "reveal all" confirm dialog in `frontend/src/features/messages/MessagesFeature.tsx` still uses its old look.
- **D2c: `IconButton` accent variant.** Give the unread arrows a real accent variant on `IconButton` instead of class overrides.
- **D2c: rail disconnected badge.** `frontend/src/core/layout/ServiceRail.tsx` uses `bg-orange-500` for the disconnected badge; use a status token.
- **D2c: calendar chevron labels.** Add aria-labels to the calendar chevrons, then drop the `button.p-2` selector in `frontend/e2e/timeline-scroll.spec.ts`.
- **Legacy blog theme.** After D2c restyles the blog dialogs, remove `useBlogTheme`, `ServiceTheme.blog` and `ServiceTheme.ambient` from `frontend/src/config/serviceThemes.ts`. Keep `groupRoles().ambient` and `design/tokens/ambient.ts`: `DynamicBackground` reads them through `--ds-group-ambient-*`.
- **`TranslateButton` palette.** `frontend/src/core/common/TranslateButton.tsx` builds its colours from hex + alpha; move it to tokens (shared with the chat).
- **D2c: blog dialogs.** Restyle `MemberSelectModal` (hard-coded pink `#ff69b4` favourite, the mascot's CDN thumbnail URL; it also uses member penlight colours), `MemberTimelineModal` and `BlogPhotoGalleryModal`; `frontend/e2e/blogs.spec.ts` selects these dialogs by role and text and may need new selectors.
- **D2c: search marks.** Move the search dialog's `.search-snippet mark` styles (`frontend/src/features/search/SearchModal.tsx`) to the `bg-mark-exact` / `bg-mark-reading` / `border-mark-underline` tokens.
- **D2c: `MemberTimelineModal` dialog semantics.** Add `role="dialog"`, `aria-modal` and focus management in `frontend/src/features/blogs/components/MemberTimelineModal.tsx`; D2b only guards the arrow keys through `keysEnabled`.
- **Rail: fast move then click selects nothing.** Moving fast and clicking at once in `frontend/src/features/blogs/components/TimelineRail.tsx` selects no post.
- **Back label on the timeline path.** "Back to latest blogs" in `frontend/src/features/blogs/components/BlogReader.tsx` is misleading when the reader was opened from a member timeline.
- **Fonts are not pinned in the shots.** `frontend/e2e/d2b-screens.spec.ts` and `frontend/e2e/visual-zero-pixel.spec.ts` depend on the Google Fonts load; pin or stub the fonts.
- **`formatBlogDate` tests.** Add zh-CN, yue, midnight and the ICU "at" separator cases to `frontend/src/utils/dateFormatters.test.ts`.
- **`d2b.test` only checks truthy.** Tighten the assertions in the D2b token test under `frontend/src/design/`.
- **A to B to A in-flight spinner.** Going A, B, A quickly in `frontend/src/features/blogs/BlogsFeature.tsx` can leave the spinner running while the in-flight guard skips the second load of A.
- **`nav_list` skip breadcrumbs.** `frontend/src/features/blogs/BlogsFeature.tsx` skips the member-list load silently in some paths; log them through `logBlogLoad`.
- **Breadcrumb test coverage.** `frontend/src/features/blogs/BlogsFeature.test.tsx` covers recent, sync and search_open only; add `content`, `nav_list` and `member_posts`.
- **`Math.random` animation delays.** `frontend/src/features/blogs/components/RecentPostsFeed.tsx` picks new-post reveal delays on every render; compute them once per post.
- **Breadcrumb as `<nav>`.** The reader's breadcrumb in `frontend/src/features/blogs/components/BlogReader.tsx` should be a `<nav>` with `aria-current` on the current item.
- **More `memberWash` cases.** Extend `frontend/src/features/blogs/memberWash.test.ts` (name without spaces, blog-id lookup, malformed hex).
- **Post HTML `class` is allowed.** DOMPurify `ALLOWED_ATTR` in `frontend/src/features/blogs/components/BlogReader.tsx` keeps `class`, so a post can pick up app utilities; remove it (hardening).
- **e2e ring locator.** The `.border-2` locator for the avatar ring in `frontend/e2e/blogs.spec.ts` follows a class, not a role; use a test id.
- **Hard-coded colon in the screen-reader prefix.** `frontend/src/features/blogs/components/BlogNavFooter.tsx` renders `{prefix}:`; move the separator into the i18n string.
- **Rail tooltip covers the year label.** The card tooltip in `frontend/src/features/blogs/components/TimelineRail.tsx` hides the year label beside it.
