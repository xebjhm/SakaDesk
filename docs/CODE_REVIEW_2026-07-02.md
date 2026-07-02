# SakaDesk — Code Review (2026-07-02)

Full read-only review of the FastAPI backend (`backend/`), the React/TS frontend
(`frontend/src/`), and a cross-repo security pass. Findings ranked by severity
with exact `file:line`, failure scenario, and suggested fix. IDs are referenced by
the fix branch. Duplicate findings from separate reviewers are merged (noted).

Legend: **Critical** = data loss / hang / corruption; **Important** = wrong
behavior or a real security gap in realistic conditions; **Minor** = latent trap
or correctness edge.

---

## Critical

### SVC-C1 — "Cancel sync" only resets a flag → two concurrent syncs corrupt shared state
- `backend/services/sync_service.py:150-153, 677-678`; `backend/api/sync.py:110`
  *(also reported as API-I5)*
- `start_sync` uses `self.running` as its only concurrency guard, but `/sync/cancel`
  force-sets `running = False` while the old task keeps executing and writing
  `messages.json` / `sync_metadata.json` / `sync_state.json`. A new `/start` sees
  `running == False` and launches a second sync over the same output dir; both
  reassign `self.manager` / `self.metadata_file` / `self.service_data_dir`
  (`174-175, 303`) → interleaved read-merge-write loses messages / corrupts
  cursors. The old task's `finally: running = False` also clears a newer run's flag.
- **Fix:** hold an `asyncio.Task` reference per service; implement cancel as real
  `task.cancel()` + await unwind; guard `running` with an ownership/generation
  token so a stale task cannot clear a newer run's flag.

---

## Important — Security

### SEC-1 / API-I1 — Path traversal / arbitrary local-file read in SPA catch-all
- `backend/main.py:214-219` (`serve_spa`)
- `frontend_dist / full_path` is served via `FileResponse` with only
  `.exists()/.is_file()` — none of the `validate_path_within_dir` containment used
  by every `/api/content` endpoint. Starlette does not collapse `..` in `:path`.
  Reproduced: `frontend/dist/../../pyproject.toml` resolves to `SakaDesk/pyproject.toml`.
- **Scenario:** `GET /..%2f..%2f..%2f..%2fetc%2fpasswd` returns arbitrary readable
  files (exfil to a third party requires the SEC-2 rebinding context).
- **Fix:** resolve the joined path and assert it stays within
  `frontend_dist.resolve()` (reuse `content.validate_path_within_dir`), else fall
  back to `index.html`; or mount `StaticFiles(..., html=True)`.

### SEC-2 / API-I4 — Local API has no auth, CSRF, or Host-header validation
- `backend/main.py:149-189` (no `TrustedHostMiddleware`, CORS is the only origin
  control); state-changing query-param endpoints incl. `api/version.py:262`
  (`/upgrade/install`), `api/sync.py:46` (`/start`), `api/blogs.py:279`
  (`DELETE /cache`), `api/favorites.py:155/192`, `api/translation.py:302`
  (`/configure`), `api/auth.py:35-58`.
- **Scenario:** (a) **DNS rebinding** — an attacker domain rebinds to `127.0.0.1`,
  becoming same-origin (CORS bypassed, no Host check), then reads
  `/api/content/media`, `/api/content/messages_by_path`, `/api/diagnostics`, and
  the SEC-1 file primitive — exfiltrating synced private DMs, media, and logs.
  (b) **CSRF** — query-param POST/DELETE are CORS "simple requests" that fire
  cross-origin without preflight (`/upgrade/install` launches an installer and
  force-exits; `/configure` overwrites the translation API key). Mitigations
  present: binds `127.0.0.1` only + randomized persisted port (guessable, not
  access control).
- **Fix (backend-only, no frontend changes needed):** add `TrustedHostMiddleware`
  allowing `127.0.0.1:<port>` / `localhost:<port>` (+ `testserver` for tests) to
  defeat rebinding; add a middleware that rejects `/api/*` requests whose `Origin`
  is present and not in the allowed localhost set (blocks cross-origin browser
  requests while allowing the same-origin webview and no-Origin CLI callers).

### SEC-3 / PY-I7 — Credential store silently falls back to plaintext on disk
- `pysaka/src/pysaka/credentials.py:92-109` — tracked and fixed in the **pysaka**
  review (PY-I7). Listed here for cross-repo visibility.

### API-I2 — Path traversal in `get_message_dates`
- `backend/api/chat_features.py:228` (`full_path = output_dir / member_path`)
- `member_path` (`:path`) joined with no containment (unlike the parallel
  `content.py` endpoints). `GET /api/chat/message_dates/../../../../dir` reads a
  `messages.json` anywhere on disk → arbitrary-location info disclosure.
- **Fix:** route `member_path` through `content.validate_path_within_dir(output_dir, member_path)`.

### API-I3 — SSRF via redirect + unbounded read in the blog image proxy
- `backend/api/blogs.py:404` (allowlist on initial URL only), `408-409`
  (`follow_redirects=True`), `421` (`resp.content`)
- The host allowlist is checked only against the initial hostname; redirects are
  followed, so an allowed host that open-redirects can steer the server-side fetch
  to an internal address (e.g. `169.254.169.254`) whose body is returned. No
  response-size cap → unbounded memory.
- **Fix:** `follow_redirects=False` (or re-validate every hop's host); enforce a
  max content-length / streamed size limit.

### SEC-4 — Self-upgrade download lacks URL scheme/host validation
- `backend/services/upgrade_service.py:104-133` (download), `80-94` (URL from
  `browser_download_url`)
- `follow_redirects=True` with no assertion the URL (or its redirect targets) is
  `https://` on a GitHub host; the SHA-256 is compared against the `digest` from
  the *same* API response, so integrity rests entirely on the api.github.com TLS
  session (no independent signature). *(Bounds — size cap, content-length match,
  mandatory SHA-256 — are already enforced at `146-187`.)*
- **Fix:** assert `scheme == "https"` and host in `{github.com, *.githubusercontent.com}`
  before and after redirects; ideally verify an Authenticode/detached signature.

### SEC-5 — Unauthenticated diagnostics/report endpoints leak logs, paths, metadata
- `backend/api/diagnostics.py:313-359` (no redaction) and `api/report.py:88-141`
  (redacts only OS username + cached nickname)
- Combined with SEC-2 rebinding, a malicious site harvests absolute filesystem
  paths, followed group/member names, token-expiry timing, and recent log content.
  Tokens themselves are not exposed (keeps this Important-adjacent, gated by SEC-2).
- **Fix:** gate behind the SEC-2 origin/host protection; apply report.py-style
  redaction + a token/JWT regex scrub to the diagnostics log output.

---

## Important — Backend correctness

### SVC-I1 — Session-expiry codes never reach the frontend → re-login flow is dead code
- `backend/services/sync_service.py:673-676`; `backend/api/sync.py:35-43`
- `start_sync`'s `except Exception` → `progress.error(str(e))` makes the
  `SESSION_EXPIRED` / `REFRESH_FAILED` sentinels in `run_sync_task` unreachable.
  The frontend checks `data.detail === 'SESSION_EXPIRED'` (`shell/hooks/useSync.ts:278`),
  so the login modal never opens and auto-sync keeps retrying dead credentials.
- **Fix:** re-raise `SessionExpiredError` / `RefreshFailedError` (or map to the
  sentinel strings) before `progress.error`.

### SVC-I2 — New member in an already-synced group permanently loses history
- `backend/services/sync_service.py:420-446`; `pysaka manager.py:176-182`
- The group timeline is fetched with `min_since_ts = min(synced cursors) - 300s`;
  a new member with no cursor receives only messages since that timestamp, then
  `update_sync_state` records the new member's cursor → their earlier history is
  never fetched on any future sync.
- **Fix:** do a separate full fetch (`since_ts=None`) for unsynced members when a
  group mixes synced and unsynced members.

### SVC-I3 — `asyncio.gather` without `return_exceptions` leaves orphaned sync tasks
- `backend/services/sync_service.py:493-495`
- If one `sync_group` raises, `gather` propagates immediately but siblings are not
  cancelled; they keep writing files while `start_sync` closes the session and
  clears `running` — compounding SVC-C1 and surfacing "Task exception was never
  retrieved".
- **Fix:** `return_exceptions=True` + aggregate per-group failures, or
  `asyncio.TaskGroup` (cancels siblings on failure).

### SVC-I4 — Search rebuild crashes: `_read_conn` closed from the wrong thread
- `backend/services/search_service.py:2583-2592` (via `2929-2930`; conn created in
  the read executor at `2775, 2852`)
- `_clear_db_sync` runs on the write executor and calls
  `self._read_conn.close()` on a connection created in the read thread; with
  `check_same_thread=True` this raises `sqlite3.ProgrammingError`. Any search then
  `POST /api/search/rebuild` → 500, DB never deleted, rebuild broken for the session.
- **Fix:** close `_read_conn` on the read executor, or use `check_same_thread=False`
  with proper locking.

### SVC-I5 — `INSERT OR REPLACE` bypasses FTS delete triggers → ghost FTS rows accumulate
- `backend/services/search_service.py:61-76` (triggers), `292-298 / 2099-2105`
  (REPLACE inserts), `2819-2823 / 2980-2985` (rebuild-over-existing DB)
- With `recursive_triggers` OFF (default), the implicit DELETE from
  `INSERT OR REPLACE` does not fire the `AFTER DELETE` triggers that keep the
  external-content FTS5 tables in sync → every replaced row leaves a stale FTS
  entry. `get_members` → `build_full_index` re-inserts every message without
  clearing → unbounded index growth, slower MATCH, drifting counts.
- **Fix:** `PRAGMA recursive_triggers=ON` on every connection, or explicitly
  `DELETE` conflicting rows before insert, or clear + FTS-`rebuild` before a full build.

### SVC-I6 — Failed image download (non-200) poisons the blog cache with `null`
- `backend/services/blog_service.py:830-833` (with `809, 1002-1005`)
- The non-200 branch only logs; `results[idx]` stays `None` (the exception branch
  sets a fallback dict, this branch doesn't) → `null` serialized into `blog.json`'s
  `images` → `_rewrite_local_images` calls `img.get()` on `None` →
  `get_blog_content` 500s forever (cache exists, never re-fetched).
- **Fix:** in the non-200 branch set `results[idx] = {"original_url": img_url, "local_path": None}`.

### SVC-I7 — `blog.json` written non-atomically; a truncated file is "cached" forever
- `backend/services/blog_service.py:790-791` (with `577, 1060-1063`)
- `_download_single_blog` writes directly (no tmp + `os.replace`, unlike
  `save_blog_index`); a crash mid-write leaves a truncated `blog.json` that
  `skip_cached` skips and `get_blog_content` fails to parse — permanently.
- **Fix:** write to a temp file and `os.replace`; optionally validate JSON before
  trusting existence.

### SVC-I8 — `BlogBackupManager` force-restart race: old run's `finally` deregisters the new run
- `backend/services/blog_service.py:1348-1351` (vs `1256-1268`)
- `start(force=True)` registers a new cancel-event + running flag, but the old
  `_run_backup`'s `finally` unconditionally discards `self._running` and pops
  `self._cancel_events` — removing the *new* run's bookkeeping. `is_running()`
  then returns False while a backup is active, `stop()` can't cancel it, and a
  later `start()` launches a duplicate concurrent backup.
- **Fix:** `_run_backup` should discard only its own registration (compare stored
  cancel-event identity before popping).

### SVC-I9 — `initial_limit` / `include_inactive` silently ignored → unbounded first sync
- `backend/services/sync_service.py:138-148` (declared), `308` (`include_inactive`
  hardcoded), `initial_limit` unused
- Docs promise a 1000-message cap (`DEFAULT_INITIAL_MESSAGE_LIMIT`, `:33`) but the
  first sync calls `get_messages(since_ts=None)` and paginates the entire timeline
  — thousands of pages, heavy load on the fan-service API (counter to the
  avoid-detection design goal).
- **Fix:** implement the limit (max pages/count for members with no cursor), or
  delete both parameters and the misleading docs/constant.

---

## Minor — Backend

- **API-M1** `api/favorites.py:133-152` — aiohttp session created before `Client()`;
  if the constructor raises, the session leaks (the `chat_features.py:116-124`
  helper closes it). Close on any exception.
- **API-M2** `api/content.py:326, 393` — `offset` accepted but never applied (only
  `limit` tail-slice). Implement offset or drop the param.
- **API-M3** `api/content.py:188` (bare `[]`) vs `321` (`{groups, last_sync}`) vs
  `183` (fixture dict) — three response shapes. Always return `{groups, last_sync}`.
- **API-M4** `api/content.py:601-612` (`get_media` via `_resolve_media_path:579-598`)
  — serves any file under the output dir (e.g. `messages.json`), not just media,
  unlike the param-based `/media_file`. Restrict to known media subfolders/extensions.
- **API-M5** `api/settings.py:226-248` (`select_folder`) — `tk.Tk()` created inside
  a thread-pool executor; Tkinter requires the main thread on macOS → crash/hang.
  Drive the picker through the pywebview main-thread API.
- **SVC-M1** `sync_service.py:553`; `search_service.py:2823, 2906, 2985` —
  fire-and-forget `create_task` without a strong reference → GC mid-execution +
  "Task exception was never retrieved". Hold refs in a set + `add_done_callback`.
- **SVC-M2** `sync_service.py:756` — `check_new_messages` uses inclusive `>=` on
  the cursor → the newest already-synced message is always counted "new"; cursors
  only refreshed when `count > 0`. Latent (no frontend caller). Use strict `>`,
  dedupe by id, update cursors even when `count == 0`.
- **SVC-M3** `sync_service.py:773-778` — exception log reports `gid` (leaked loop
  var), not `gid_str`; `msgs is None` (auth failure) hidden at debug level. Log
  `gid_str`, handle `None`.
- **SVC-M4** `search_service.py:2583-2592` — `rebuild()` unlinks the DB that also
  holds `read_states` (user data) and leaves `-wal`/`-shm`. Separate read_states or
  preserve/restore; unlink WAL/SHM. (Partially self-heals via frontend push.)
- **SVC-M5** `auth_service.py:187-190, 236-237` — browser-login supersede registers
  `_active_login_task` only after acquiring the lock (race window recreates the
  documented deadlock); `contextlib.suppress` swallows the *current* task's
  cancellation. Register intent before awaiting; suppress only the awaited task.
- **SVC-M6** `search_service.py:652-659, 2323-2332` (blog at `390, 518`) —
  incremental index builds construct paths from **unsanitized** server names while
  pysaka writes dirs via `sanitize_name` → members whose names contain `/` or
  whitespace are silently never indexed incrementally. Apply `sanitize_name`.
- **SVC-M7** `translation_service.py:331-332, 365-366` — batch/blog prompts embed
  user text in pseudo-JSON via f-strings without escaping `"`, `\`, newlines →
  malformed / misaligned model output (`json.loads`-parsed at
  `api/translation.py:501, 592`). Build with `json.dumps(..., ensure_ascii=False)`.
- **SVC-M8** `blog_service.py:525-530` — stage-1 metadata sync is `gather` without
  `return_exceptions` and unbounded concurrency; one member failure discards all
  scanned metadata (the stage-2 timeout-storm fix at `659-663` isn't applied here).
  `return_exceptions=True`, persist partial, add a member semaphore.
- **SVC-M9** `path_resolver.py:20-28` — bare `except Exception: pass` silently
  redirects **all** path resolution to `~/Documents/SakaDesk` on any settings read
  error, with no log. Log it; fail loudly or route through `settings_store`.
- **SVC-M10** `search_service.py:1687-1692, 1273-1285` — LIKE fallback doesn't
  escape `%`/`_` (parameterized, so no injection — correctness only). Add `ESCAPE`.
- **SVC-M11** `auth_service.py:352-373` vs `sync_service.py:231, 281-288` —
  uncoordinated token refresh between the frontend poll and sync, last-writer-wins
  on save → spurious `SessionExpiredError` with single-use cookie rotation.
  **Largely subsumed by pysaka PY-I5** (lock in `Client.refresh_access_token`).

---

## Important — Frontend

### FE-I1 — `startSync` failure never resolves the sync callback → app permanently stuck
- `frontend/src/shell/hooks/useSync.ts:378-397` (with `startSequentialSync:440-443`)
- On a non-400 error / fetch throw, `startSync` never calls `resolveSyncCallback`,
  so the sequential loop's `await new Promise(...)` hangs forever. During
  onboarding, one `/api/sync/start` 500 leaves `SyncModal` (no close button) on
  screen and `App.tsx:380` keeps the Layout unmounted — stuck until restart.
- **Fix:** call `resolveSyncCallback(targetService)` in the error branches (or add
  a per-service timeout/failure path in `startSequentialSync`).

### FE-I2 — `MemberList.loadGroups` no `res.ok`/shape check → `setGroups(undefined)` crashes app
- `frontend/src/features/messages/components/MemberList.tsx:64-71` (crash at `197/304`)
- A 500 `{"detail": ...}` → `data.groups` undefined → `groups.filter is not a
  function` → whole app to the ErrorBoundary. Runs every poll tick (`137`).
- **Fix:** `if (!res.ok) throw`; `const groupList = Array.isArray(data) ? data : (data.groups ?? [])`.

### FE-I3 — `loadReadState` doesn't normalize missing fields → `revealedIds.includes` crash
- `frontend/src/features/messages/MessagesFeature.tsx:454-461` (crash at `172, 417`)
- A legacy `read_state_*` entry lacking `revealedIds` (the shape `MemberList.tsx:89-92`
  already defends against) → `displayUnreadCount` throws.
- **Fix:** normalize `{ lastReadId: …||0, readCount: …||0, revealedIds: …||[] }`.

### FE-I4 — Blog content fetch race attaches the wrong blog's content
- `frontend/src/features/blogs/BlogsFeature.tsx:363-365` (effect `331-372`)
- The resolution guard checks only `prev.view === 'reader' && !prev.content`, not
  the blog id. Clicking "next" twice quickly → slow response for A is written into
  B's view state (A's body under B's breadcrumb); B's response discarded.
- **Fix:** capture `blogId` and guard `prev.blog.id === blogId` in both updaters +
  the `.catch`.

### FE-I5 — Anchor clicks in remote blog HTML navigate the pywebview window (no back)
- `frontend/src/features/blogs/components/BlogReader.tsx:518-522` (only IMG clicks
  intercepted at `280-307`)
- The app ships inside pywebview (no browser chrome/back). Clicking a link in
  sanitized remote blog HTML navigates the desktop window to the external site,
  losing all app state — remote HTML controls navigation. `target` allowed without
  `rel="noopener"`.
- **Fix:** intercept `A` tags in the container handler (`closest('a')`,
  `preventDefault`), open via a backend "open in system browser" path; or a
  DOMPurify hook forcing `target="_blank" rel="noopener noreferrer"`.

### FE-I6 — Global arrow-key blog nav fires while typing in modals
- `frontend/src/features/blogs/components/BlogNavFooter.tsx:19-30`
- The `window` keydown listener navigates on Arrow keys with no input-focus/modal
  check → arrow keys in Search/Settings inputs silently navigate the reader behind.
- **Fix:** ignore when `e.target` is input/textarea/contentEditable (or
  `e.defaultPrevented`); scope to the reader container.

### FE-I7 — Background opacity applied to the whole message timeline
- `frontend/src/features/messages/MessagesFeature.tsx:758` (container `747-799`)
- `opacity: backgroundSettings.opacity / 100` is on the div containing the entire
  timeline → setting 30% renders all bubbles/text/media at 30% (the
  BackgroundModal preview fades only the background).
- **Fix:** render the background as a separate absolutely-positioned layer and apply
  opacity only to it.

### FE-I8 — Reader "Retry" button navigates to the feed instead of retrying
- `frontend/src/features/blogs/BlogsFeature.tsx:471-475` (button at `BlogReader.tsx:459-466`)
- `handleRetry` does `setViewState({ view: 'recent' })` → kicks the user out of the
  reader instead of refetching the failed content.
- **Fix:** for reader view, clear `error` and re-trigger the content fetch for
  `viewState.blog.id`.

### FC-I1 — `persist` version 4 with no `migrate` → old state silently discarded (data loss)
- `frontend/src/store/appStore.ts:389`
- zustand `persist` `version: 4` with no `migrate` → state from any older version
  is dropped on rehydration → `selectedServices` becomes `[]`, dropping the user to
  the LandingPage and wiping favorites, conversation memory, service order, and
  translation settings. Repeats on every version bump.
- **Fix:** add `migrate(persisted, version)` that upgrades old shapes (or passes
  through unchanged); bump `version` only alongside a migration step.

### FC-I2 — Traditional-Chinese users get Simplified (locale match order)
- `frontend/src/i18n/index.ts:36`
- `startsWith(code.split('-')[0])` over `{en, ja, 'zh-CN', 'zh-TW', yue}` in
  insertion order → any `zh-*` matches `zh-CN` first → `zh-TW`/`zh-HK` browsers get
  `zh-CN`, then persisted and locked.
- **Fix:** exact-match pass over all codes before prefix fallback; prefer `zh-TW`
  for `zh-HK`/`zh-Hant`.

### FC-I3 — Stacked `BaseModal`s: one Escape closes all
- `frontend/src/core/common/BaseModal.tsx:69` (with `MediaGalleryModal.tsx:675-681`)
- Each open `BaseModal` registers its own bubble-phase document `keydown` with no
  stacking coordination → opening a CalendarModal over the gallery and pressing
  Escape closes both.
- **Fix:** module-level modal stack; only the top-of-stack modal handles Escape.

### FC-I4 — Stacked `DetailModal`s: Escape closes the wrong (bottom) one
- `frontend/src/core/common/BaseModal.tsx:229-241` (with `SentLettersModal.tsx:249-250`)
- Two `DetailModal`s add capture-phase listeners fired in registration order → the
  bottom one handles Escape first and `stopImmediatePropagation` suppresses the top.
- **Fix:** the same modal-stack (topmost-only) handling.

### FC-I5 — `ReportIssueModal` seeds `crashError` only in `useState` init; leaks stale crash text
- `frontend/src/core/modals/ReportIssueModal.tsx:40-42, 94`
- The modal is mounted persistently (`App.tsx:278-286`), so a later `crashError`
  never prefills; `handleClose` copies the current `crashError` into `whatWrong`
  right before the parent clears it → the next unrelated report is prefilled with
  the previous crash's error and submits it.
- **Fix:** sync from props via `useEffect(..., [isOpen, crashError])`; reset to
  blanks (not `crashError`) on close.

### FC-I6 — `useMessageTranslation` has no staleness check → wrong-language translation shown
- `frontend/src/hooks/useMessageTranslation.ts:101-105` (reset effect `68-73`)
- An in-flight response for a previous `cacheKey` (previous target language)
  overwrites state after the reset effect cleared it → the bubble shows an English
  translation labeled as the current (Japanese) one; `trigger` won't refetch
  (state is `done`).
- **Fix:** capture `cacheKey` at request start and bail if it changed before
  `setTranslation`/`setState`; or an `AbortController` as `useTranscription` uses.

---

## Minor — Frontend

- **FE-M1** `features/search/SearchModal.tsx:237-254` — Load-more appends stale
  results after a query change. Snapshot query/filters or use a fetch-generation counter.
- **FE-M2** `features/search/components/SearchResultList.tsx:40` — list key is bare
  `message_id`/`blog_id`; per-service ids collide. Key as
  `` `${service}-${result_type}-${id}` ``.
- **FE-M3** `features/messages/MessagesFeature.tsx:289-296` — server error `detail`
  discarded (throw inside the try whose catch rethrows generic). Parse in try, throw
  after.
- **FE-M4** `features/messages/hooks/useChatScroll.ts:108-121, 131-137` — unmount
  cancels the debounced position save without flushing; save-previous-room effect is
  dead code. Flush the pending save in cleanup.
- **FE-M5** `features/messages/components/MessageBubble.tsx:270-300` — `ShelterOverlay`
  defined inside the render body → remounts every re-render (DOM churn / mid-gesture
  replacement). Hoist to module scope.
- **FE-M6** `features/search/components/SearchResultItem.tsx:126-131` — segment-time
  prefix computed but never rendered for snippet results (voice/video transcripts).
  Prepend `segmentPrefix` as a sibling text node.
- **FE-M7** `features/messages/MessagesFeature.tsx:498-518` — `revealMessage`
  consolidation is O(n²)–O(n³) → click-to-reveal jank with thousands unread. Use a
  `Set` + single forward scan.
- **FE-M8** `shell/App.tsx:289-305` (set at `useSettings.ts:135`) — `settingsError`
  toast has no dismiss and is never cleared on later success. Clear on successful
  save + add a close button.
- **FE-M9** `features/blogs/components/RecentPostsFeed.tsx:169-171` — `Math.random()`
  in render → new-post cards flicker on any re-render. Derive a stable delay from `post.id`.
- **FE-M10** `features/messages/components/MessageBubble.tsx:183-189` — 600ms
  favorite long-press timer not cancelled on `touchmove` → pops mid-scroll on touch.
  Clear on movement past a threshold.
- **FE-M11** `features/messages/MessagesFeature.tsx:118` — `useAppStore()` with no
  selector re-renders the whole chat view on every store write. Use per-field selectors.
- **FC-M1** `core/media/VideoPlayer.tsx:196-201` / `VoicePlayer.tsx:222-227` —
  external `seekTo` (bare number) deduped by React state bail-out → seeking the same
  time twice is a dead click. Use the internal `{ time, seq }` shape.
- **FC-M2** `core/media/VoicePlayer.tsx:204` / `VideoPlayer.tsx:179` — media-listener
  effect has a stale `onTimeUpdate` closure (deps `[connectElement]`). Keep it in a
  ref updated each render.
- **FC-M3** `core/common/SafeImage.tsx:32` — `hasError` never reset on `src` change →
  one 404 latches the fallback for all later sources (PhotoPlayer already fixed this).
  `useEffect(() => setHasError(false), [src])`.
- **FC-M4** `core/common/BaseModal.tsx:76, 246` — modal close unconditionally restores
  `body.style.overflow` → closing a nested modal re-enables scroll while the parent is
  open. Reference-count the scroll lock.
- **FC-M5** `core/modals/CalendarModal.tsx:113-138` — API `fetchDates` has no
  cancellation/out-of-order guard and `apiDates` isn't cleared on path change → stale
  response clobbers a newer one. Track a request id / clear on path change.
- **FC-M6** `core/modals/BackgroundModal.tsx:160-166` (+ `utils/backgroundSettings.ts:33-35`)
  — file input value not cleared (re-selecting the same file does nothing) and
  `saveBackgroundSettings` swallows localStorage quota errors (background reverts after
  restart with no feedback). Reset `e.target.value`; surface a toast on quota failure.
- **FC-M7** `core/layout/{ServiceRail,Layout,FeatureRail,ContentArea}.tsx`,
  `AddServiceModal.tsx` — `useAppStore()` with no selector (the anti-pattern the store
  docstring warns against). Select individual slices / `useShallow`.
- **FC-M8** `store/appStore.ts:255-267` — `removeSelectedService` leaves all
  per-service persisted maps intact → dead conversation paths restored on re-add;
  unbounded localStorage growth. Purge the service's keys.
- **FC-M9** `core/modals/DiagnosticsModal.tsx:196-198` — `handleCopy` doesn't
  await/catch `clipboard.writeText` (false "Copied!", unhandled rejection) and the
  reset timer isn't cleared on unmount. `await` + try/catch + cleanup.
- **FC-M10** `core/media/MediaGalleryModal.tsx:166-167` — `monthRefs`/`itemRefs` map
  entries are added but never deleted on `null` → detached DOM retained. Delete on
  `null`; clear on `activeTab` change.
- **FC-M11** `core/media/useClipboardShortcut.ts:44-48` — window Ctrl+C unconditionally
  `preventDefault`s for picture/video → hijacks text copy. Skip when a text selection
  is non-empty.
- **FC-M12** `hooks/useMessageTranslation.ts:188-194` — `translateBatch` (dead export)
  treats `ok: false` as success. Throw on `!data.ok` or delete until needed.
- **FC-M13** `config/groupConfig.ts:9-10` — hardcodes unverified group-chat IDs
  (`sakurazaka: ['45']`, `nogizaka: ['46']`, "TBD confirm"). Derive `is_group_chat`
  from the backend `Group.is_group_chat` field (`types/index.ts:47`) instead.
