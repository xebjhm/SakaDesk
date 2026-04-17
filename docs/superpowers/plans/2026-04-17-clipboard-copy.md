# Clipboard Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ctrl+C keyboard shortcut to copy images (as PNG) and videos (as file) to the Windows clipboard from the full-screen media viewer, gated behind the golden finger easter egg.

**Architecture:** Two code paths — images use the browser's Clipboard API (frontend-only), videos use a new backend endpoint that calls Win32 clipboard APIs via ctypes. A toast notification provides feedback. Voice is deferred with a TODO comment.

**Tech Stack:** TypeScript/React (frontend), Python/FastAPI + ctypes (backend), Web Clipboard API, Win32 CF_HDROP

---

### Task 1: Backend — `copy_file_to_clipboard` in platform.py

**Files:**
- Modify: `backend/services/platform.py`
- Test: `backend/tests/test_platform_clipboard.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_platform_clipboard.py`:

```python
import sys
import struct
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


def test_copy_file_to_clipboard_not_windows():
    """On non-Windows, copy_file_to_clipboard raises RuntimeError."""
    from backend.services.platform import copy_file_to_clipboard

    with pytest.raises(RuntimeError, match="Windows"):
        copy_file_to_clipboard(Path("/some/file.mp4"))


def test_build_dropfiles_struct():
    """DROPFILES struct has correct layout: 20-byte header + wide-char path + double null."""
    from backend.services.platform import _build_dropfiles_data

    data = _build_dropfiles_data(Path(r"C:\test\video.mp4"))

    # Header: offset (4 bytes, little-endian) = 20
    offset = struct.unpack_from("<I", data, 0)[0]
    assert offset == 20

    # fWide flag at byte 16 (4 bytes) = 1
    f_wide = struct.unpack_from("<I", data, 16)[0]
    assert f_wide == 1

    # Path starts at offset 20, encoded as UTF-16LE
    path_bytes = data[20:]
    # Should end with double null terminator (4 zero bytes for UTF-16)
    assert path_bytes.endswith(b"\x00\x00\x00\x00")

    # Decode the path (strip trailing double-null)
    decoded = path_bytes[:-2].decode("utf-16-le").rstrip("\x00")
    assert decoded == r"C:\test\video.mp4"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_platform_clipboard.py -v`
Expected: FAIL — `ImportError` for `copy_file_to_clipboard` and `_build_dropfiles_data`

- [ ] **Step 3: Write the implementation**

Add to the end of `backend/services/platform.py`:

```python
import struct


def _build_dropfiles_data(file_path: Path) -> bytes:
    """
    Build a DROPFILES struct for CF_HDROP clipboard data.

    Layout:
    - DROPFILES header (20 bytes): pFiles offset, pt(0,0), fNC=0, fWide=1
    - File path as null-terminated UTF-16LE string
    - Extra null terminator (end of file list)
    """
    path_str = str(file_path)
    # Encode path as UTF-16LE with null terminator
    path_bytes = path_str.encode("utf-16-le") + b"\x00\x00"
    # Double null terminator marks end of file list
    path_bytes += b"\x00\x00"

    # DROPFILES header: pFiles (DWORD), pt.x (LONG), pt.y (LONG), fNC (BOOL), fWide (BOOL)
    header = struct.pack("<I ii I I", 20, 0, 0, 0, 1)

    return header + path_bytes


def copy_file_to_clipboard(file_path: Path) -> None:
    """
    Copy a file to the Windows clipboard using CF_HDROP format.

    The file appears on the clipboard as if the user had pressed Ctrl+C
    on it in Explorer. Paste into Discord, Telegram, folders, etc.

    Raises RuntimeError on non-Windows or if the clipboard operation fails.
    """
    if not is_windows():
        raise RuntimeError("copy_file_to_clipboard is only supported on Windows")

    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    import ctypes
    from ctypes import wintypes

    CF_HDROP = 15
    GMEM_MOVEABLE = 0x0002

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    data = _build_dropfiles_data(file_path.resolve())

    h_global = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    if not h_global:
        raise RuntimeError("GlobalAlloc failed")

    try:
        p_global = kernel32.GlobalLock(h_global)
        if not p_global:
            raise RuntimeError("GlobalLock failed")
        try:
            ctypes.memmove(p_global, data, len(data))
        finally:
            kernel32.GlobalUnlock(h_global)

        if not user32.OpenClipboard(None):
            raise RuntimeError("OpenClipboard failed")
        try:
            user32.EmptyClipboard()
            if not user32.SetClipboardData(CF_HDROP, h_global):
                raise RuntimeError("SetClipboardData failed")
            # Clipboard now owns the memory — do not free h_global
            h_global = None
        finally:
            user32.CloseClipboard()
    finally:
        # Only free if clipboard didn't take ownership
        if h_global:
            kernel32.GlobalFree(h_global)

    logger.info("File copied to clipboard", file=str(file_path))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_platform_clipboard.py -v`
Expected: `test_copy_file_to_clipboard_not_windows` PASS (we're on Linux), `test_build_dropfiles_struct` PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/platform.py backend/tests/test_platform_clipboard.py
git commit -m "feat(clipboard): add copy_file_to_clipboard for Win32 CF_HDROP"
```

---

### Task 2: Backend — `POST /api/content/clipboard` endpoint

**Files:**
- Modify: `backend/api/content.py`
- Test: `backend/tests/test_content_clipboard.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_content_clipboard.py`:

```python
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_clipboard_requires_media_url():
    """POST /api/content/clipboard requires media_url in body."""
    response = client.post("/api/content/clipboard", json={})
    assert response.status_code == 422


def test_clipboard_non_windows_returns_501():
    """On non-Windows, the endpoint returns 501."""
    with patch("backend.api.content.is_windows", return_value=False):
        response = client.post(
            "/api/content/clipboard",
            json={"media_url": "/api/content/media/hinatazaka46/messages/test/video/1.mp4"},
        )
    assert response.status_code == 501


def test_clipboard_file_not_found(tmp_path):
    """Returns ok=false when the resolved file doesn't exist."""
    with (
        patch("backend.api.content.is_windows", return_value=True),
        patch("backend.api.content.get_output_dir", return_value=tmp_path),
    ):
        response = client.post(
            "/api/content/clipboard",
            json={"media_url": "/api/content/media/hinatazaka46/messages/test/video/1.mp4"},
        )
    # 404 because file doesn't exist after path resolution
    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_content_clipboard.py -v`
Expected: FAIL — 404 on the POST route (route doesn't exist yet)

- [ ] **Step 3: Write the implementation**

Add to `backend/api/content.py`. First, add the import at the top (alongside existing platform imports):

```python
from backend.services.platform import (
    get_settings_path,
    is_test_mode,
    get_default_output_dir,
    is_windows,
    copy_file_to_clipboard,
)
```

Then add the endpoint at the end of the file:

```python
class ClipboardRequest(BaseModel):
    media_url: str


@router.post("/clipboard")
async def copy_to_clipboard(request: ClipboardRequest):
    """Copy a media file to the Windows clipboard.

    Resolves the media URL to a local file path and places it on the
    clipboard using CF_HDROP format so it can be pasted into other apps.

    Returns 501 on non-Windows platforms.
    """
    if not is_windows():
        raise HTTPException(status_code=501, detail="Clipboard copy is only supported on Windows")

    # Extract the file path from the media URL.
    # media_url is like "/api/content/media/hinatazaka46/messages/.../video/1.mp4"
    prefix = "/api/content/media/"
    if not request.media_url.startswith(prefix):
        raise HTTPException(status_code=400, detail="Invalid media URL format")

    file_path_str = request.media_url[len(prefix):]
    safe_path = _resolve_media_path(file_path_str)

    try:
        copy_file_to_clipboard(safe_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except RuntimeError as e:
        logger.error("Clipboard operation failed", error=str(e))
        raise HTTPException(status_code=500, detail="Clipboard operation failed")

    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_content_clipboard.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Run existing content tests to check for regressions**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_content_api.py backend/tests/test_content_api_extended.py -v`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/api/content.py backend/tests/test_content_clipboard.py
git commit -m "feat(clipboard): add POST /api/content/clipboard endpoint"
```

---

### Task 3: Frontend — `clipboard.ts` utility

**Files:**
- Create: `frontend/src/utils/clipboard.ts`
- Test: `frontend/src/utils/clipboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/clipboard.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyImageToClipboard, copyVideoToClipboard } from './clipboard';

describe('copyImageToClipboard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should fetch image, convert to PNG blob, and write to clipboard', async () => {
        // Create a tiny 1x1 PNG as test data
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const pngBlob = await new Promise<Blob>((resolve) =>
            canvas.toBlob((b) => resolve(b!), 'image/png')
        );

        // Mock fetch to return image blob
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: () => Promise.resolve(pngBlob),
        });
        vi.stubGlobal('fetch', mockFetch);

        // Mock clipboard
        const mockWrite = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { write: mockWrite },
            writable: true,
            configurable: true,
        });

        // Mock ClipboardItem
        vi.stubGlobal('ClipboardItem', class {
            constructor(public items: Record<string, Blob>) {}
        });

        await copyImageToClipboard('/api/content/media/test.jpg');

        expect(mockFetch).toHaveBeenCalledWith('/api/content/media/test.jpg');
        expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('should throw on fetch failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

        await expect(copyImageToClipboard('/bad-url')).rejects.toThrow();
    });
});

describe('copyVideoToClipboard', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should POST to /api/content/clipboard with the media URL', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ok: true }),
        });
        vi.stubGlobal('fetch', mockFetch);

        await copyVideoToClipboard('/api/content/media/test.mp4');

        expect(mockFetch).toHaveBeenCalledWith('/api/content/clipboard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media_url: '/api/content/media/test.mp4' }),
        });
    });

    it('should throw when backend returns ok: false', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ok: false, error: 'file_not_found' }),
        }));

        await expect(copyVideoToClipboard('/api/content/media/test.mp4')).rejects.toThrow();
    });

    it('should throw when backend returns non-200', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 501,
        }));

        await expect(copyVideoToClipboard('/api/content/media/test.mp4')).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run vitest run frontend/src/utils/clipboard.test.ts`
Expected: FAIL — module `./clipboard` not found

- [ ] **Step 3: Write the implementation**

Create `frontend/src/utils/clipboard.ts`:

```typescript
/**
 * Clipboard utilities for copying media to the system clipboard.
 * Used by MediaViewerModal when golden finger is active.
 */

/**
 * Copy an image to the clipboard as PNG.
 *
 * Fetches the image, draws it onto an offscreen canvas to convert
 * to PNG (Clipboard API requires image/png), and writes to clipboard.
 */
export async function copyImageToClipboard(src: string): Promise<void> {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const sourceBlob = await response.blob();

    // Convert to PNG via canvas (source may be JPEG/WebP)
    const pngBlob = await convertToPng(sourceBlob);

    await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob }),
    ]);
}

/**
 * Copy a video file to the Windows clipboard via the backend.
 *
 * The backend places the file on the clipboard using CF_HDROP format,
 * so it can be pasted into Discord, Telegram, file explorers, etc.
 */
export async function copyVideoToClipboard(mediaUrl: string): Promise<void> {
    const response = await fetch('/api/content/clipboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_url: mediaUrl }),
    });

    if (!response.ok) {
        throw new Error(`Clipboard API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(data.error || 'Clipboard operation failed');
    }
}

/**
 * Convert any image blob to PNG format using an offscreen canvas.
 */
function convertToPng(blob: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to get canvas context'));
                return;
            }

            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);

            canvas.toBlob((pngBlob) => {
                if (!pngBlob) {
                    reject(new Error('Failed to convert image to PNG'));
                    return;
                }
                resolve(pngBlob);
            }, 'image/png');
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for clipboard'));
        };

        img.src = url;
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run vitest run frontend/src/utils/clipboard.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/clipboard.ts frontend/src/utils/clipboard.test.ts
git commit -m "feat(clipboard): add clipboard utility for images and videos"
```

---

### Task 4: Frontend — i18n keys for all 5 locales

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/i18n/locales/zh-TW.json`
- Modify: `frontend/src/i18n/locales/zh-CN.json`
- Modify: `frontend/src/i18n/locales/yue.json`

- [ ] **Step 1: Add keys to en.json**

In the `"about"` section, after the `"goldenFingerDisabled"` line, add:

```json
    "goldenFingerCopied": "Copied to clipboard",
    "goldenFingerCopyFailed": "Failed to copy"
```

- [ ] **Step 2: Add keys to ja.json**

In the `"about"` section, after the `"goldenFingerDisabled"` line, add:

```json
    "goldenFingerCopied": "クリップボードにコピーしました",
    "goldenFingerCopyFailed": "コピーに失敗しました"
```

- [ ] **Step 3: Add keys to zh-TW.json**

In the `"about"` section, after the `"goldenFingerDisabled"` line, add:

```json
    "goldenFingerCopied": "已複製到剪貼簿",
    "goldenFingerCopyFailed": "複製失敗"
```

- [ ] **Step 4: Add keys to zh-CN.json**

In the `"about"` section, after the `"goldenFingerDisabled"` line, add:

```json
    "goldenFingerCopied": "已复制到剪贴板",
    "goldenFingerCopyFailed": "复制失败"
```

- [ ] **Step 5: Add keys to yue.json**

In the `"about"` section, after the `"goldenFingerDisabled"` line, add:

```json
    "goldenFingerCopied": "已複製到剪貼簿",
    "goldenFingerCopyFailed": "複製失敗"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/locales/*.json
git commit -m "feat(i18n): add clipboard copy toast messages for all locales"
```

---

### Task 5: Frontend — Ctrl+C handler in MediaViewerModal

**Files:**
- Modify: `frontend/src/core/media/PhotoDetailModal.tsx`

- [ ] **Step 1: Add imports**

At the top of `PhotoDetailModal.tsx`, add to the existing imports:

```typescript
import { copyImageToClipboard, copyVideoToClipboard } from '../../utils/clipboard';
```

- [ ] **Step 2: Add toast state and helper inside MediaViewerModal component**

Inside the `MediaViewerModal` component, after the `const [zoom, setZoom] = useState(1);` line (line 52), add:

```typescript
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Cleanup toast timer on unmount
    useEffect(() => {
        return () => {
            if (toastTimeout.current) clearTimeout(toastTimeout.current);
        };
    }, []);

    const showToast = useCallback((message: string) => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToastMessage(message);
        toastTimeout.current = setTimeout(() => setToastMessage(null), 2000);
    }, []);
```

- [ ] **Step 3: Add Ctrl+C handling to the existing handleKeyDown callback**

In the `handleKeyDown` callback (line 74), add a new case before the closing of the switch block. Insert after the `'ArrowDown'` case (after line 101):

```typescript
            default:
                // Ctrl+C: copy media to clipboard (golden finger only)
                if (goldenFingerActive && e.ctrlKey && e.key === 'c') {
                    e.preventDefault();
                    if (item?.type === 'picture') {
                        copyImageToClipboard(item.src)
                            .then(() => showToast(t('about.goldenFingerCopied')))
                            .catch(() => showToast(t('about.goldenFingerCopyFailed')));
                    } else if (item?.type === 'video') {
                        copyVideoToClipboard(item.src)
                            .then(() => showToast(t('about.goldenFingerCopied')))
                            .catch(() => showToast(t('about.goldenFingerCopyFailed')));
                    }
                    // TODO: add voice clipboard support
                }
                break;
```

Update the `useCallback` dependencies to include `showToast`, `t`, and `goldenFingerActive`:

```typescript
    }, [onClose, hasPrev, hasNext, currentIndex, onNavigate, item?.type, item?.src, goldenFingerActive, showToast, t]);
```

- [ ] **Step 4: Add toast UI to the render**

Inside the JSX return, after the source label button (after line 188) and before the closing `</div>`, add:

```tsx
            {/* Clipboard toast */}
            {toastMessage && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/80 text-white text-sm rounded-lg animate-fade-in z-20">
                    {toastMessage}
                </div>
            )}
```

- [ ] **Step 5: Verify the app compiles**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Run all frontend tests to check for regressions**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/core/media/PhotoDetailModal.tsx
git commit -m "feat(clipboard): add Ctrl+C copy handler to MediaViewerModal"
```

---

### Task 6: Manual Integration Testing

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run uvicorn backend.main:app --reload --port 39281`

Open browser at `http://localhost:5173` (Vite dev server).

- [ ] **Step 2: Test image copy (golden finger OFF)**

1. Open a conversation with images
2. Click an image to open MediaViewerModal
3. Press Ctrl+C
4. Verify: nothing happens (golden finger not active)

- [ ] **Step 3: Enable golden finger**

1. Go to Settings → About
2. Click the heart icon 5 times quickly
3. Verify toast: "Download button enabled ✨"

- [ ] **Step 4: Test image copy (golden finger ON)**

1. Open an image in MediaViewerModal
2. Press Ctrl+C
3. Verify: toast shows "Copied to clipboard"
4. Open an image editor (Paint, Discord message box, etc.)
5. Press Ctrl+V
6. Verify: the image pastes correctly

- [ ] **Step 5: Test video copy (golden finger ON, Windows only)**

1. Open a video in MediaViewerModal
2. Press Ctrl+C
3. Verify: toast shows "Copied to clipboard"
4. Open a file explorer or Discord
5. Press Ctrl+V
6. Verify: the video file pastes

- [ ] **Step 6: Test voice (no-op)**

1. Open a voice message in MediaViewerModal
2. Press Ctrl+C
3. Verify: nothing happens (no toast, no error)

- [ ] **Step 7: Test keyboard shortcuts don't conflict**

1. In MediaViewerModal with an image, test: ←→ (navigate), ↑↓ (zoom), Esc (close), Space, D (download)
2. Verify all existing shortcuts still work correctly alongside Ctrl+C
