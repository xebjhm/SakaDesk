# Bugfix Batch — 4 Bug Fixes

**Date:** 2026-04-20
**Branch:** feat/translation (current working branch)

---

## Bug 2: Three-dot menu invisible in fullscreen video player

### Root Cause
`VideoPlayer.tsx:537` portals the menu to `document.body`. When the video container enters fullscreen via `container.requestFullscreen()`, the fullscreen element creates a new top-level stacking context. Anything portaled to `document.body` renders behind this stacking context and is invisible to the user.

### Fix
- Portal the menu to `containerRef.current` when `isFullscreen` is true, otherwise to `document.body`.
- Adjust `menuStyle` position calculation: in fullscreen mode, coordinates must be relative to the container (the fullscreen element), not the viewport.

### Files
- `frontend/src/core/media/VideoPlayer.tsx`

---

## Bug 3: i18n subscription text — Japanese wording

### Root Cause
Japanese locale uses "メンバーシップ継続" which is awkward and doesn't flow naturally with the `{subscribedFor} {N} {days}` template.

### Fix
Update `ja.json` only:
- `"subscribedFor"`: "メンバーシップ継続" → "購読して"
- `"days"`: "日！" → "日間！"

Rendered: "購読して **30** 日間！" — natural, grammatically complete.

All other locales (en, zh-CN, zh-TW, yue) are unchanged — they already read naturally.

### Files
- `frontend/src/i18n/locales/ja.json`

---

## Bug 4: Window size/location not persisting across restarts

### Root Cause
1. Window geometry is stored in a separate `window.json` file instead of `settings.json`.
2. Save/load functions swallow all exceptions with bare `except: pass`, making failures invisible.
3. The separate file doesn't survive app upgrades/reinstalls even when `settings.json` does.

### Fix
- Migrate window geometry into `settings.json` under a `"window"` key (e.g., `{"window": {"width": 1200, "height": 800, "x": 100, "y": 100}}`).
- `desktop.py` reads/writes `settings.json` directly using sync file I/O (it runs before/after the async backend, so no race condition).
- Add `structlog` logging to save/load so failures are visible in logs instead of silently swallowed.
- On first run after migration, if `window.json` exists, migrate its data into `settings.json` and delete the old file.

### Files
- `desktop.py` — modify `_load_window_geometry()`, `_save_window_geometry()`, remove `_get_window_file()`

---

## Bug 5: Auto-expand/collapse for transcription and translation

### Root Cause
Both `TranscriptPanel` and `InlineTranslation` use local `useState(defaultExpanded)`. In `MessageBubble.tsx`, transcription panels always start with `defaultExpanded={false}`, so results are hidden even when content is available. When the user switches conversations, components unmount and state is lost.

### Fix
- **Auto-expand when content is ready:** Pass `defaultExpanded={true}` for `TranscriptPanel` in `MessageBubble.tsx` (currently hardcoded to `false`). `InlineTranslation` already defaults to `true` for messages, so no change needed there.
- **Auto-collapse on conversation switch:** Already happens naturally — components unmount when the message list is cleared on conversation switch, so they reset to their `defaultExpanded` state on remount.
- **Auto-collapse on scroll-away:** Use `IntersectionObserver` in `TranscriptPanel` and `InlineTranslation` to detect when the component scrolls out of view, and collapse it automatically. This keeps expand/collapse state local (no store needed).

### Files
- `frontend/src/features/messages/components/MessageBubble.tsx`
- `frontend/src/core/media/TranscriptPanel.tsx`
- `frontend/src/core/common/InlineTranslation.tsx`
