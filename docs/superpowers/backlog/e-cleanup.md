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
