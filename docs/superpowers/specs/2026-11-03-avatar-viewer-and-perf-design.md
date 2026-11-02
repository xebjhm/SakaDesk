# Sub-project A: Member Images, Avatar History, Service Names & Read-Path Performance — Design

**Date:** 2026-11-03
**Repos touched:** `SakaDesk` (this spec); depends on `pysaka` 0.4.5 (`pysaka/docs/superpowers/specs/2026-11-03-archive-integrity-v045-design.md`)
**Status:** Approved in brainstorming 2026-11-03 — awaiting written-spec review
**Programme context:** first of A (this) → B in-app incoming call → C tray/background/notifications/call popup → D visual redesign. Backlog from the 2026-11-03 app review is tracked separately.

---

## 1. Goals

1. The three member images — list icon, chat icon, call screen — are viewable in the existing media viewer; copy/save follow the 金手指 rule like every other photo.
2. Avatar history: every version pysaka archives is browsable, newest first, with the period it was in use.
3. Service rail hover shows the Japanese group name (`乃木坂46` / `櫻坂46` / `日向坂46`; `Yodel` unchanged).
4. Read-path performance: the sidebar stops re-parsing the whole archive every 2 s; opening a chat never blocks the backend; **API responses stay byte-identical**.
5. Adopt pysaka 0.4.5: favorites go through the locked writer (closes the lost-message race) and the pre-subscription backfill runs during sync.

Non-goals: incremental/delta message loading (rejected — existing records are mutated in place by favorites and late media metadata, so "fetch ids > N" would silently show stale data); any visual redesign (D); notifications and call UI (B/C).

---

## 2. Naming (all five locales)

| key | zh-TW | ja | en | zh-CN | yue |
|-----|-------|----|----|-------|-----|
| `profileImages.thumbnailGroup` (list icon) | 列表頭像 | 一覧アイコン | List icon | 列表头像 | 列表頭像 |
| `profileImages.thumbnail` (chat icon) | 聊天頭像 | トークアイコン | Chat icon | 聊天头像 | 聊天頭像 |
| `profileImages.phoneImage` (call screen) | 來電畫面 | 着信画面 | Call screen | 来电画面 | 來電畫面 |

Each also gets a `…Hint` tooltip key, e.g. zh-TW「顯示在聊天室列表上的圖示」. Plus `profileImages.viewImages` (member-list menu item, zh-TW「查看圖片」) and `profileImages.current` (「目前」).

Kind ↔ data mapping: list icon = `group_thumbnail`, chat icon = `thumbnail`, call screen = `phone_image`.

---

## 3. Entry points (UI)

### 3.1 Profile card (`MemberProfilePopup`)
- Under the member name: three small pill "nudges" (icon + label) — list icon (`List`), chat icon (`MessageCircle`), call screen (`Phone`) from lucide. A count chip appears only when that kind has ≥ 2 archived versions. A pill whose kind has no image at all is not rendered.
- Clicking a pill opens the viewer on that kind's tab. Clicking the large avatar opens it on the chat-icon tab; the avatar gets a `cursor: zoom-in`.
- Card height grows by one row only. (Local mockup, not committed: `.superpowers/brainstorm/30312-1793649737/content/avatar-nudges.html`.)

### 3.2 Member list context menu (`MemberList`)
- New right-click menu on a member row with one item, 「查看圖片」, opening the same viewer on the chat-icon tab. Reuses the existing `ConversationMenu` styling/positioning pattern; Escape/click-outside close it.

### 3.3 Viewer
- New `ProfileImageViewer` component composing the existing `MediaViewerModal` (no fork): a tab bar of the three kinds (only kinds with images), and the modal's `mediaItems` = that kind's versions **newest first**.
- Left/Right moves within a kind; clicking a tab switches kind and resets to its newest version.
- Footer label (`sourceLabel`): `YYYY/MM/DD – YYYY/MM/DD` (from this version's `first_seen` to the next version's `first_seen`), or `YYYY/MM/DD – 目前` for the current one. Dates are UTC in data and localized at display.
- Copy (button + Ctrl+C) and Save appear only when 金手指 is active — unchanged existing behaviour of `MediaViewerModal` / `useClipboardShortcut`. Saved filename: `<member>_<kind>_<basename>`.

---

## 4. Backend

### 4.1 Profile images API
`GET /api/content/profile_images?service=<id>&path=<member dir relative path>` →
```json
{
  "kinds": {
    "thumbnail": [{"url": "/api/content/media/…/profile_images/thumbnail/134-20260705-113257.jpeg",
                   "first_seen": "2026-11-03T04:12:00Z", "current": true}],
    "phone_image": [...], "group_thumbnail": [...]
  }
}
```
- Reads `profile_images/index.json` (in a thread). `current` comes from the index's `current` map (maintained by pysaka from fresh API data each sync), not from the possibly stale member block in `messages.json`.
- When the index is absent or a kind has no local file yet (before the first post-upgrade sync, or a failed download), that kind falls back to a single entry with the remote CDN URL and `"current": true`, so the viewer works on day one.
- Path is validated with the existing `validate_path_within_dir`; served files go through the existing `/api/content/media/{file_path}` route.

### 4.2 Prefer local images everywhere
- Member payloads (`/groups` member entries, `messages_by_path` / `group_messages` `member`) gain `thumbnail_local`, `phone_image_local`, `group_thumbnail_local` (media URLs of the index's `current` files, or `null`). Existing fields are untouched.
- Frontend helper `memberImageUrl(member, kind)` returns the local URL when present, else the remote one; existing avatar call sites switch to it. Side effect: avatars render offline.

### 4.3 Favorites → pysaka locked writer
`_update_local_favorite` keeps its per-service scan to locate the file, but the write becomes `SyncManager.update_message_fields(file, message_id, {"is_favorite": …})` (pysaka 0.4.5). The scan itself moves onto the summary cache (§5.1) to find the owning file without parsing every file.

### 4.4 Backfill orchestration
`sync_service` calls `manager.backfill_past_messages(...)` for each member task after its `sync_member`, before the media phase so backfilled media joins the same download queue. Backfill errors are logged and never fail the sync. Progress UI needs no change (counts fold into the existing totals). Changelog tells users their archive may gain a few days of older messages after upgrading.

---

## 5. Performance (correctness first)

Measured 2026-11-03 on the user's archive: 51 `messages.json`, 14.7 MB total, largest 2.5 MB. The sidebar polls `/groups` + `/unread_counts` every 2 s and each fully parses every file ⇒ ~30 MB of JSON parsed every 2 s.

### 5.1 Stat-keyed summary cache
- Key: `(resolved path, st_mtime_ns, st_size, st_ino)` — any write by any writer (pysaka sync, favorites, future code) changes it, so invalidation needs no cooperation from writers. Atomic `os.replace` changes `st_ino`, which also covers same-size rewrites within one mtime tick.
- Value: an immutable per-file summary, **not** the raw message dicts (current handlers mutate dicts, e.g. adding `member_id`; caching raw objects would leak those mutations into later requests):
  - member block fields used by `/groups`;
  - sorted tuple of visible message ids (after `_visible_messages`) for unread counting against any `lastReadId` / `revealedIds`;
  - last message id / timestamp / preview fields used by the sidebar.
- Process-local dict guarded by a `threading.Lock`; bounded only by file count (one entry per conversation). Entries whose path vanished are dropped on the next scan.
- `/groups`, `/unread_counts` and the favorites file lookup read summaries; a file is parsed only when its stat key changes.

### 5.2 No JSON parsing on the event loop
`messages_by_path` and `group_messages` move their `json.load` + shaping into `asyncio.to_thread` (`/groups` and `/unread_counts` already are).

### 5.3 Conditional GET for chat loads
- `messages_by_path` / `group_messages` return `ETag` = hash of (stat keys of the files read, every query parameter that shapes the response, app version). `If-None-Match` match ⇒ `304`, body skipped.
- Frontend `fetchMessages` sends the last ETag for the same path+params and keeps its current state on `304`; anything else is handled exactly as today.

### 5.4 Frontend polling
- Interval stays 2 s (now near-free). Polling pauses while `document.visibilityState === 'hidden'` and runs once immediately on becoming visible.
- `checkUnread` keeps the last known counts on a failed request instead of clearing them (`MemberList.tsx` catch block), so one hiccup no longer blanks every badge.

### 5.5 Verification of "byte-identical"
- Golden test: for a fixture tree (CJK/emoji names, favorites, hidden messages, group chat), responses of `/groups`, `/unread_counts`, `messages_by_path`, `group_messages` are compared before/after the change — exact JSON equality.
- Invalidation tests: rewrite (same size), atomic replace, append, delete, favorite toggle ⇒ next response reflects it.
- Benchmark script `scripts/bench_read_path.py` run on a **copy** of the real archive (never the live folder); before/after timings and CPU for one sidebar poll cycle and for opening the 2.5 MB chat go in the PR.

---

## 6. Service rail tooltip
`ServiceRail.tsx:150` `title={service}` → `title={getServiceDisplayName(service)}` (existing helper in `data/services.ts`). Test asserts the three Japanese names and `Yodel`.

---

## 7. Error handling
- Profile image API: missing index/file ⇒ remote fallback; unreadable index ⇒ logged, remote fallback; never a 500 for missing images.
- Viewer: an image failing to load shows the existing `SafeImage` placeholder; other versions remain navigable.
- Cache: any exception while building a summary ⇒ entry not cached, request falls back to the current uncached code path (logged once per file version).

## 8. Testing
- Backend (`uv run pytest`): profile_images API (local, partial, none, corrupt index, traversal attempt), local-URL fields, cache golden + invalidation tests, ETag/304, favorites via `update_message_fields`, backfill orchestration (called once per member, error isolation), service rail name mapping.
- Frontend (vitest): `memberImageUrl`, viewer tab/arrow navigation and date labels, pill visibility rules (no image / single / multiple), member-list menu, polling pause/resume, unread counts retained on error.
- i18n: all new keys in the five locale files; tests run with CJK/emoji member names.
- Manual on Windows: install a local dev build, open profile card / member menu / viewer with 金手指 on and off, confirm offline avatars, sidebar CPU idle.

## 9. Delivery
- Branch `feat/avatar-viewer-and-perf`, pinned to the pysaka branch during development; switches to `pysaka==0.4.5` once released (SakaDesk CI installs with `--no-sources`, so pysaka must be published before this PR can go green).
- CHANGELOG `[Unreleased]` entries (end-user wording) for: viewing/saving member images, avatar history, Japanese group names on hover, faster sidebar, recovered pre-subscription messages, the favorite/sync data-loss fix.
