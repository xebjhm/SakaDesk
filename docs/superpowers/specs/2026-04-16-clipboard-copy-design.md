# Feature 1: Ctrl+C Clipboard Copy in Media Viewer

## Overview

Add Ctrl+C keyboard shortcut to copy images and videos directly to the Windows clipboard from the full-screen media viewer (PhotoDetailModal), gated behind the golden finger easter egg. Voice support is deferred.

## Scope

- **Where**: PhotoDetailModal only (full-screen media viewer)
- **Gate**: `goldenFingerActive === true` (same gate as the download button)
- **Trigger**: `Ctrl+C` keydown event
- **Feedback**: Localized toast notification via existing toast system
- **Platform**: Windows primary. Image copy works cross-platform; video copy is Windows-only.

## Behavior by Media Type

| Type | Action | Implementation Path |
|------|--------|---------------------|
| Image (picture) | Copy as PNG to clipboard | Frontend — Web Clipboard API |
| Video | Copy as file to clipboard | Backend — Win32 CF_HDROP via ctypes |
| Voice | No-op | Deferred — TODO comment in code |

## Frontend

### Keyboard Handler (PhotoDetailModal.tsx)

Extend the existing `useEffect` keydown listener:

1. Guard: `goldenFingerActive && event.ctrlKey && event.key === 'c'`
2. `event.preventDefault()` to suppress default browser copy
3. Read `currentItem` (already in component state) — has `src` and `type`
4. Branch:
   - `picture` → `copyImageToClipboard(currentItem.src)`
   - `video` → `copyVideoToClipboard(currentItem.src)`
   - `voice` → no-op with `// TODO: add voice clipboard support`
5. On success: `toast(t('goldenFinger.copiedToClipboard'))`
6. On error: `toast(t('goldenFinger.copyFailed'))`

### New Utility: `frontend/src/utils/clipboard.ts`

**`copyImageToClipboard(src: string): Promise<void>`**
1. `fetch(src)` → get Response
2. `response.blob()` → get source Blob
3. Draw blob onto an offscreen `<canvas>` to convert to PNG (Clipboard API requires `image/png`; source may be JPEG/WebP)
4. `canvas.toBlob('image/png')` → PNG Blob
5. `navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })])`

**`copyVideoToClipboard(mediaUrl: string): Promise<void>`**
1. `POST /api/content/clipboard` with body `{ media_url: mediaUrl }`
2. Check response `{ ok: true }` or throw on failure
3. Skip entirely on non-Windows platforms (`navigator.platform` check)

## Backend

### New Endpoint: `POST /api/content/clipboard`

**Location**: `backend/api/content.py` (alongside existing media/download routes)

**Request body**:
```json
{ "media_url": "/api/content/media/..." }
```

**Response (success)**:
```json
{ "ok": true }
```

**Response (error)**:
```json
{ "ok": false, "error": "file_not_found" }
```

**Logic**:
1. Parse `media_url` to extract the file path (reuse existing path resolution logic from the download flow)
2. Validate: file exists and is within the allowed output directory (prevent path traversal)
3. Call `copy_file_to_clipboard(file_path)` from platform service
4. Return JSON result

**Platform guard**: Returns HTTP 501 on non-Windows platforms.

### New Function: `backend/services/platform.py`

**`copy_file_to_clipboard(file_path: Path) -> None`**

Uses `ctypes` to call Win32 clipboard APIs:
1. `ctypes.windll.user32.OpenClipboard(None)`
2. `ctypes.windll.user32.EmptyClipboard()`
3. Build `DROPFILES` struct:
   - `DROPFILES` header (20 bytes): offset to file list, point (0,0), fNC=0, fWide=1 (Unicode)
   - Followed by the file path as null-terminated wide string
   - Followed by an extra null terminator
4. `GlobalAlloc(GMEM_MOVEABLE, size)` → `GlobalLock` → copy struct → `GlobalUnlock`
5. `ctypes.windll.user32.SetClipboardData(CF_HDROP, hGlobal)` where `CF_HDROP = 15`
6. `ctypes.windll.user32.CloseClipboard()`

Wrapped in try/finally to ensure `CloseClipboard()` is always called. Raises on failure.

**No new dependencies**: `ctypes` is Python standard library.

## i18n

Two new keys added to all 5 locale files (`en.json`, `ja.json`, `yue.json`, `zh-CN.json`, `zh-TW.json`):

| Key | en | ja | zh-TW | zh-CN | yue |
|-----|----|----|-------|-------|-----|
| `goldenFinger.copiedToClipboard` | Copied to clipboard | (localized) | (localized) | (localized) | (localized) |
| `goldenFinger.copyFailed` | Failed to copy | (localized) | (localized) | (localized) | (localized) |

## Error Handling

- Image fetch fails → catch, show error toast
- Canvas conversion fails → catch, show error toast
- Clipboard API permission denied → catch, show error toast
- Backend file not found → return `{ ok: false, error: "file_not_found" }`, frontend shows error toast
- Backend clipboard operation fails → return 500, frontend shows error toast
- Non-Windows + video → frontend skips silently (only images work cross-platform)

## Keyboard Shortcut Summary

Existing PhotoDetailModal shortcuts (no conflicts):

| Shortcut | Action |
|----------|--------|
| ←/→ | Navigate prev/next |
| ↑/↓ | Zoom in/out (images) |
| Esc | Close viewer |
| Space | Play/pause (video) |
| D | Download (golden finger) |
| F | Fullscreen (video) |
| M | Mute (video) |
| **Ctrl+C** | **Copy to clipboard (golden finger) — NEW** |

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/utils/clipboard.ts` | **New** — `copyImageToClipboard`, `copyVideoToClipboard` |
| `frontend/src/core/media/PhotoDetailModal.tsx` | Add Ctrl+C handler in existing keydown listener |
| `backend/api/content.py` | Add `POST /api/content/clipboard` route |
| `backend/services/platform.py` | Add `copy_file_to_clipboard(path)` function |
| `frontend/src/i18n/locales/en.json` | Add 2 keys |
| `frontend/src/i18n/locales/ja.json` | Add 2 keys |
| `frontend/src/i18n/locales/yue.json` | Add 2 keys |
| `frontend/src/i18n/locales/zh-CN.json` | Add 2 keys |
| `frontend/src/i18n/locales/zh-TW.json` | Add 2 keys |

## Out of Scope

- Voice clipboard support (deferred — TODO comments only)
- Inline message bubble copy (future extension)
- Non-Windows video clipboard (no equivalent cross-platform API)
- Blog image clipboard copy (separate feature scope)
