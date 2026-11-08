# v2 acceptance round 3 (R-h) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's acceptance-round-3 decisions (2026-11-09) and fix the remaining low items.

**Architecture:** Mostly frontend component work; one new npm dependency (Japanese holiday data); one desktop-shell change (Windows title bar colour via DWM).

**Tech Stack:** React + TS + Tailwind tokens, Vitest; Python desktop shell (pywebview 5.3.2 on WebView2, ctypes/DWM); pytest.

## Global Constraints

- Same binding constraints as R-f/R-g: read "## Global Constraints" in `docs/superpowers/plans/2026-11-08-v2-qa-fixes-letters.md` (tokens only + guard baseline only decreases; i18n ×5; breadcrumbs on every decision/failure/skip path registered in `frontend/src/utils/clientLog.ts` AND `backend/api/client_log.py` with pytest; backend/desktop pathlib, utf-8, no `time.sleep`, logging not print; zero-drift docs incl. DESIGN_SYSTEM.md; Conventional Commits via `uv run git commit` ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never stage `.superpowers/`). CHANGELOG `[Unreleased]` entries are written in the last task only.
- Owner decisions (verbatim intent): ← always = older, → always = newer, app-wide; calendar Japanese style (Sunday start; Sunday + 祝日 red `#DC2626`; Saturday blue `#2563EB`; holiday name on hover; click the month title to pick year and month); translate = icon-only "文A" button at the bubble's bottom-right beside the time on every message; transcript 「顯示文字」 control neutral; image viewer zoom by wheel, ± buttons, reset, drag to pan, double-click toggle; native Windows title bar recoloured to match the app (not frameless); content sheet keeps its 8px margins; video play-button contrast unchanged.

---

### Task 1: Left/right = older/newer everywhere
- `frontend/src/core/media/MediaViewerModal.tsx` (shared viewer, index ± 1 today) and its callers: give it the same time-aware navigation the letter viewer has (an `order: 'oldest_first' | 'newest_first'` prop or equivalent), so ←/‹ = older and →/› = newer regardless of list order. Callers: chat viewer via `PhotoDetailModal.tsx` (oldest-first list), `core/media/MediaGalleryModal.tsx` detail view (own keydown at ~261-277, newest-first grid), `features/blogs/components/BlogPhotoGalleryModal.tsx` (newest-first), `ProfileImageViewer.tsx` (check its list order). Counter semantics stay as each viewer shows today unless it contradicts direction; prefer oldest = 1 like the letter viewer.
- Any visible prev/next buttons get older/newer accessible labels (i18n ×5: reuse `blogs.olderPost`/`newerPost` wording style, e.g. `common.older`/`common.newer`); the letter viewer's `letterViewer.previous/next` become older/newer labels too.
- DESIGN_SYSTEM.md: add the rule "Left is older, right is newer" under interaction conventions.
- Tests per caller (newest-first list: ArrowLeft moves to the older item). Commit `fix(media): left is older and right is newer in every viewer`.

### Task 2: Image viewer zoom and pan
`frontend/src/core/media/PhotoDetailModal.tsx` (~102-112 ↑/↓ zoom today) — the dark viewer used by chat, gallery, blog and letter images:
- Mouse wheel zooms around the cursor (clamped to the existing 1–4× range, smooth step), ↑/↓ keep working.
- On-screen controls (viewer overlay style, full-circle floating icon buttons per the settled IconButton rule): zoom out (−), zoom in (+), reset (1:1 / fit), with i18n labels.
- When zoomed: drag with the mouse to pan (grab/grabbing cursor, clamp so the image can't be dragged fully off-screen); double-click toggles fit ↔ 2× at the click point.
- Reset zoom/pan when the item changes. Keyboard ←/→ still navigate (not pan) — document it.
- Tests: wheel changes scale, buttons, drag changes translate only when zoomed, double-click toggle, reset on item change. Commit `feat(media): zoom with the wheel and drag to pan in the viewer`.

### Task 3: Calendar, Japanese style
`frontend/src/core/modals/CalendarModal.tsx`:
- Add dependency `@holiday-jp/holiday_jp` (check the current maintained package name/version on npm first; offline data, no network). Wrap it in a tiny `utils/jpHolidays.ts` (`holidayName(date): string | null`) with unit tests (e.g. 2026-11-03 文化の日, 2026-11-23 勤労感謝の日, a substitute holiday).
- Week starts Sunday (keep). Sunday and holidays red (new token `text-calendar-holiday` = `#DC2626`), Saturday blue (new token `text-calendar-saturday` = `#2563EB`), replacing `text-sunday` (#EF4444) — register tokens in `design/tokens/color.ts`, `cssVars.ts`, `tailwind.config.js`, `utils/classnames.ts`, token tests, DesignPage swatches; remove the old `decor-sunday` token if unused. Weekday header labels coloured the same way. Out-of-month days keep a muted look (raise from 1.47:1 to at least 3:1 with an existing neutral token).
- Holiday name: native-feeling tooltip on hover/focus of the day cell (title or the app's tooltip style) and in the cell's accessible name; holiday names are shown in Japanese (`lang="ja"`).
- Month title becomes a button: opens a picker with a year list (years that have messages first-class, range = archive's first message year … current year) and a 12-month grid; months without messages are dimmed but selectable; Escape/back returns to the day grid. i18n ×5 for labels.
- Breadcrumb for picker open/select if it's a new decision path (register both sides).
- Tests: header order, colour classes for Sun/Sat/holiday, tooltip text, picker navigation. Commit `feat(calendar): Japanese holidays, weekend colours and a year-month picker`.

### Task 4: Translate icon and transcript control
`frontend/src/features/messages/components/MessageBubble.tsx` (translate at ~296-308, rendered at ~354-362 for run-start and ~479-492 for continuation), `core/common/TranslateButton.tsx`, `core/media/TranscribeButton.tsx` (~47-58):
- Translate becomes an icon-only button (a "文A"-style language icon from lucide, e.g. `Languages`), neutral (`text-secondary hover:text-primary`), with tooltip + accessible label (existing i18n key), shown on row hover / focus, loading and error states kept (spinner / error icon). It sits in ONE place for every message: the trailing column at the bubble's bottom-right, aligned with the bubble bottom, next to where the hover time appears on continuation messages. Run-start messages keep their time in the header row, but their translate icon also moves to this trailing column. Remove it from the run-start header. The blog reader's translate button keeps its text label (different surface) but stays neutral.
- Transcribe 「顯示文字」 control: neutral colours like TranslateButton (no accent text/border); contrast ≥ 4.5:1.
- Update DESIGN_SYSTEM.md (translate placement; transcript control under neutral examples; remove it from the "pre-existing accents stay" list).
- Tests: icon button present in the trailing column for run-start and continuation; not in the header; neutral classes. Commit `fix(chat): one translate icon beside the time and a neutral transcript control`.

### Task 5: Voice bubble top-left corner
`MessageBubble.tsx` (~166 `rounded-tl-tail`, ~371 voice `overflow-visible`) and `core/media/VoicePlayer.tsx` (~681 `rounded-lg`): when the voice message starts a run (tail corner), give the compact player the same tail top-left radius (prop like `joinedBelow`, e.g. `tailCorner`), so no white wedge shows. Evidence `/mnt/c/D/saka-verify/qa3/shots/hinatazaka46/voice-footer-corner-tl-zoom-1280.png`. Test. Commit `fix(chat): match the voice player to the bubble's tail corner`.

### Task 6: Muted text on grey fills
Use `text-secondary` (or a new `text-muted-on-sunken` only if secondary looks too strong) where muted text sits on grey: `features/blogs/components/RecentPostsFeed.tsx:45` (unselected segment on the segment track), `features/search/SearchModal.tsx:477` (footer on `bg-sunken`), `core/modals/BackgroundModal.tsx:143` ("預覽" on #E2E6EB; also don't let the opacity setting dim the label), `core/media/LazyVideo.tsx:70-76` (icon). Target ≥ 4.5:1 for text. Tests. Commit `fix(ui): readable grey text on grey surfaces`.

### Task 7: Favourite video loading
`core/modals/FavoritesModal.tsx` (~36-52): replace the faint pulse with a clearer loading placeholder — a shimmer sweep (new keyframes in tailwind config, `motion-reduce` → static) plus a centred Film icon (`text-secondary`) — and only mount the `<video>` when the card scrolls into view (IntersectionObserver, like `LazyVideo`), so opening Favourites doesn't load every video at once. Keep the load-error breadcrumb. Tests. Commit `fix(favorites): clearer video placeholders that load on scroll`.

### Task 8: Styled scrollbars
Global, token-based scrollbar style in `frontend/src/index.css` (WebView2/Chromium): thin (≈6px) rounded thumb in a translucent ink colour on a transparent track, growing to ≈10px and darker on hover of the scrollbar; `scrollbar-gutter` unchanged; Firefox fallback `scrollbar-width: thin; scrollbar-color`. Dark viewer surfaces use a light thumb. Add tokens for the thumb colours. DESIGN_SYSTEM.md note. Test: a style test that the rules exist (read the CSS file). Commit `feat(ui): slim styled scrollbars`.

### Task 9: Blog member thumbnails resized
`features/blogs/components/MemberSelectModal.tsx` loads `/api/blogs/member-thumbnail…` full images. Route them through the same resize path (extend the avatar resize route to accept that source, or add a `w` param to the member-thumbnail route reusing `avatar_resize.py`), with the density-matched width helper. Path validation, cache and breadcrumbs as in R-f/R-g. Tests backend + frontend. Commit `fix(blogs): resized member thumbnails in the member picker`.

### Task 10: Windows title bar colour
`desktop.py` (~1011 main window, native frame, `background_color="#F0F2F5"`): after the window is shown on Windows 11 (build ≥ 22000), set `DWMWA_CAPTION_COLOR` (35) to the app window surface colour and `DWMWA_TEXT_COLOR` (36) to the primary ink, and keep `DWMWA_USE_IMMERSIVE_DARK_MODE` off; use the HWND pywebview exposes (see how `call_popup_window.py` `_apply_styles` gets the HWND and calls DWM). Older Windows: skip with a structured log. Expose the colours from one place (shared with the frontend window surface token value). Desktop-shell code must stay testable: put the DWM call behind a seam and unit-test the decision logic (version gate, colour packing as COLORREF 0x00BBGGRR). Commit `feat(desktop): match the Windows title bar to the app colour`.

### Task 11: CHANGELOG and full checks
`[Unreleased]` end-user entries: arrows always go older/newer; zoom with the mouse and drag in the photo viewer; calendar with Japanese holidays, coloured weekends and a year/month picker; tidier translate button; neutral show-transcript button; voice bubble corner; readable grey text; clearer video placeholders; slim scrollbars; sharper blog member photos; title bar matches the app. Full suites: frontend vitest/tsc/eslint, backend pytest/ruff/mypy. Commit `docs(changelog): note acceptance round 3 changes`.

### Task 12: Media streaming that never jams (backend)
Root cause (investigation 2026-11-09): videos stall/never load because Chromium caps low-priority requests per host at 6; `GET /api/content/media/...` answers open-ended `Range: bytes=N-` with the whole rest of the file via `FileResponse` (`backend/api/content.py:~871-882`), so paused/abandoned media downloads hold those slots forever and new video/voice/picture requests queue indefinitely. Disk is not the cause (NVMe, 5–50 ms TTFB, ~20 MB/s, files fast-start).
- Serve media ranges in bounded chunks: every 206 response is at most 2 MiB (`bytes=N-` → `N-(N+cap-1)`; explicit ranges larger than the cap are trimmed; correct `Content-Range: bytes a-b/size`, `Accept-Ranges: bytes`, `Content-Length`); requests without Range keep 200 for small files but are also capped to a 206 for media types if that is safe for `<img>` (images: keep 200 full body). Stop reading as soon as the client disconnects (check `request.is_disconnected()` or use a streaming body that ends on send failure). Keep the existing path validation and the avatar route untouched.
- Logging: extend the `media_request` log with range, status, bytes sent, elapsed ms and `client_disconnected` (no path, no PII).
- Windows: the logs show thousands of `_ProactorBasePipeTransport._call_connection_lost` / `socket.send() raised exception` warnings (WinError 10022/10054) leaving half-open sockets; make uvicorn run on a selector event loop on Windows or otherwise handle these resets cleanly (find where uvicorn is started in `desktop.py`/backend entry; justify the choice in the report).
- Tests: open-ended, middle, end-of-file, over-the-end (416), multi-range rejected or first range only, disconnect stops reading, log fields. Commit `fix(media): serve video in bounded ranges so playback never jams`.

### Task 13: Release media elements and show playback state (frontend)
- On unmount and before switching source, release every media element: `el.pause(); el.removeAttribute('src'); el.load()` — `core/media/VideoPlayer.tsx` (~421-428), `VoicePlayer.tsx`, `LazyVideo.tsx` (~78-87), the incoming-call `CallAudio` and `features/incomingCall/preloadAudio.ts` (~35-36, detached `preload='auto'` Audio). The viewer mounts `<VideoPlayer key={item.src}>` (`PhotoDetailModal.tsx:~139`) so state never carries over between items.
- Playback state: handle `waiting`, `stalled`, `error`, `emptied`, `canplay` in VideoPlayer (and VoicePlayer): spinner while waiting/stalled, an error state with Retry (i18n ×5) on error; don't swallow `play()` rejections silently — log them. Breadcrumbs via clientLog (`media_playback` with phase, readyState, networkState, error code; no URL/PII), registered both sides with pytest.
- Create the Web Audio `AudioContext` used for amplified volume (`useAmplifiedVolume.ts:~93-143`) on first play instead of on mount, and resume it if suspended when playback starts.
- Tests for release on unmount/source change, key reset, waiting/error UI, lazy AudioContext. Commit `fix(media): release players and show buffering and errors`.
