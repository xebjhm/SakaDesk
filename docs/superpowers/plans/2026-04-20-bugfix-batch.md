# Bugfix Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs — fullscreen video menu, Japanese i18n text, window geometry persistence, and auto-expand/collapse for transcription/translation.

**Architecture:** Each bug is independent. Tasks are ordered by complexity (simplest first). No new files are created — all changes modify existing files.

**Tech Stack:** React/TypeScript (frontend), Python (desktop.py), i18n JSON locales.

---

### Task 1: Fix Japanese subscription text (i18n)

**Files:**
- Modify: `frontend/src/i18n/locales/ja.json:421-422`

- [ ] **Step 1: Update Japanese locale strings**

In `frontend/src/i18n/locales/ja.json`, change the `memberProfile` keys:

```json
"memberProfile": {
    "subscribedFor": "購読して",
    "days": "日間！",
    "startSubscription": "メンバーシップを始めよう！",
    "retry": "再試行"
},
```

Only `subscribedFor` and `days` change. The other keys stay the same.

- [ ] **Step 2: Verify rendered text makes sense**

Confirm the template in `frontend/src/features/messages/components/MemberProfilePopup.tsx:197` produces:

```
購読して 30 日間！
```

This is a visual check — no automated test needed for locale string content.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/locales/ja.json
git commit -m "fix(i18n): improve Japanese subscription duration text"
```

---

### Task 2: Fix three-dot menu invisible in fullscreen video

**Files:**
- Modify: `frontend/src/core/media/VideoPlayer.tsx:205-218, 489-538`

- [ ] **Step 1: Update menu position calculation to handle fullscreen**

In `frontend/src/core/media/VideoPlayer.tsx`, replace the `handleMenuToggle` callback (lines 205-219):

```typescript
    const handleMenuToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setShowMenu(prev => {
            if (!prev && menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                if (isFullscreen && containerRef.current) {
                    // In fullscreen, position relative to the container
                    const containerRect = containerRef.current.getBoundingClientRect();
                    setMenuStyle({
                        position: 'absolute' as const,
                        bottom: `${containerRect.bottom - rect.top + 8}px`,
                        right: `${containerRect.right - rect.right}px`,
                    });
                } else {
                    setMenuStyle({
                        position: 'fixed' as const,
                        bottom: `${window.innerHeight - rect.top + 8}px`,
                        right: `${window.innerWidth - rect.right}px`,
                    });
                }
            }
            return !prev;
        });
    }, [isFullscreen]);
```

- [ ] **Step 2: Change portal target based on fullscreen state**

In the same file, replace the portal target (line 537) from `document.body` to a conditional:

Change:
```typescript
            {showMenu && createPortal(
                <div
                    ref={menuPortalRef}
                    style={menuStyle}
                    className="flex flex-col bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] w-max whitespace-nowrap z-[9999]"
                >
                    {/* ... menu content unchanged ... */}
                </div>,
                document.body
            )}
```

To:
```typescript
            {showMenu && createPortal(
                <div
                    ref={menuPortalRef}
                    style={menuStyle}
                    className="flex flex-col bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[160px] w-max whitespace-nowrap z-[9999]"
                >
                    {/* ... menu content unchanged ... */}
                </div>,
                isFullscreen && containerRef.current ? containerRef.current : document.body
            )}
```

Only the last line (portal target) changes. All menu content stays identical.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/media/VideoPlayer.tsx
git commit -m "fix(video): show three-dot menu in fullscreen mode"
```

---

### Task 3: Migrate window geometry to settings.json

**Files:**
- Modify: `desktop.py:201-286`

- [ ] **Step 1: Replace `_get_window_file` with settings.json path helper**

In `desktop.py`, remove `_get_window_file()` (lines 201-203) and replace `_load_window_geometry` and `_save_window_geometry` with versions that use `settings.json`.

Replace lines 201-286 (from `_get_window_file` through end of `_save_window_geometry`) with:

```python
def _load_window_geometry() -> dict:
    """Load saved window size/position from settings.json, or return defaults.

    Window geometry is stored under the ``"window"`` key in settings.json.
    Values are in logical (DPI-independent) coordinates, matching what
    pywebview's create_window() expects.

    Migrates from the legacy ``window.json`` file on first run after upgrade.
    """
    defaults = {"width": 1200, "height": 800}
    settings_path = get_app_data_dir() / "settings.json"
    legacy_path = get_app_data_dir() / "window.json"

    # --- Try loading from settings.json ---
    data = None
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
            data = settings.get("window")
        except Exception:
            logger.warning("Failed to read window geometry from settings.json")

    # --- Migrate from legacy window.json if no window key in settings ---
    if data is None and legacy_path.exists():
        try:
            data = json.loads(legacy_path.read_text(encoding="utf-8"))
            logger.info("Migrating window geometry from window.json to settings.json")
            # Save into settings.json immediately
            _save_window_data_to_settings(data, settings_path)
            # Remove legacy file
            legacy_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("Failed to migrate window.json", exc_info=True)
            data = None

    if data is None:
        return defaults

    try:
        w = int(data.get("width", 0))
        h = int(data.get("height", 0))
        if w < 400 or h < 300 or w > 7680 or h > 4320:
            return defaults

        # Migrate old physical-coordinate files to logical
        if data.get("format") != "logical":
            scale = _get_dpi_scale()
            w = round(w / scale)
            h = round(h / scale)

        result = {"width": w, "height": h}
        if "x" in data and "y" in data:
            x = int(data["x"])
            y = int(data["y"])
            if data.get("format") != "logical":
                x = round(x / scale)
                y = round(y / scale)
            result["x"] = x
            result["y"] = y
        return result
    except Exception:
        logger.warning("Failed to parse window geometry", exc_info=True)
        return defaults


def _save_window_data_to_settings(window_data: dict, settings_path: Path) -> None:
    """Write the window data dict into settings.json under the 'window' key."""
    settings: dict = {}
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    settings["window"] = window_data
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")


def _save_window_geometry(geometry: dict) -> None:
    """Save window geometry to settings.json in logical (DPI-independent) coordinates.

    pywebview's moved/resized events report physical pixel values, but
    create_window() expects logical values (WinForms multiplies both
    position and size by the DPI scale factor internally).  Dividing
    by the scale factor on save prevents drift on every restart.
    """
    try:
        scale = _get_dpi_scale()
        logical: dict = {
            "width": round(geometry["width"] / scale),
            "height": round(geometry["height"] / scale),
            "format": "logical",
        }
        if "x" in geometry and "y" in geometry:
            logical["x"] = round(geometry["x"] / scale)
            logical["y"] = round(geometry["y"] / scale)
        settings_path = get_app_data_dir() / "settings.json"
        _save_window_data_to_settings(logical, settings_path)
        logger.debug("Window geometry saved", geometry=logical)
    except Exception:
        logger.warning("Failed to save window geometry", exc_info=True)
```

- [ ] **Step 2: Run existing tests to verify no regressions**

```bash
cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/ -x -q
```

Expected: All pass (desktop.py has no dedicated tests; settings tests should be unaffected since we're writing to settings.json directly, not through the async settings_store).

- [ ] **Step 3: Commit**

```bash
git add desktop.py
git commit -m "fix(desktop): migrate window geometry from window.json to settings.json"
```

---

### Task 4: Auto-expand/collapse for transcription and translation

**Files:**
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx:463`
- Modify: `frontend/src/core/media/TranscriptPanel.tsx:33-36, 75-76`
- Modify: `frontend/src/core/common/InlineTranslation.tsx:24, 30-51, 55-79`

- [ ] **Step 1: Change TranscriptPanel defaultExpanded in MessageBubble**

In `frontend/src/features/messages/components/MessageBubble.tsx`, line 463, change:

```typescript
                                    defaultExpanded={false}
```

to:

```typescript
                                    defaultExpanded
```

This passes `defaultExpanded={true}` (boolean attribute shorthand), so transcriptions auto-expand when done. The viewer modal in `PhotoDetailModal.tsx:175,204` already passes `defaultExpanded` explicitly — no change needed there.

- [ ] **Step 2: Add IntersectionObserver auto-collapse to TranscriptPanel**

In `frontend/src/core/media/TranscriptPanel.tsx`, add a `useRef` for the wrapper div and an `IntersectionObserver` effect that collapses the panel when it scrolls out of view.

Add after the existing `useEffect` for resetting `userScrolledRef` (after line 63):

```typescript
    // Auto-collapse when scrolled out of view
    const wrapperRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!expanded || !wrapperRef.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) setExpanded(false);
            },
            { threshold: 0 }
        );
        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, [expanded]);
```

Then wrap the existing return JSX. Change line 76 from:

```tsx
        <div>
```

to:

```tsx
        <div ref={wrapperRef}>
```

- [ ] **Step 3: Add IntersectionObserver auto-collapse to InlineTranslation**

In `frontend/src/core/common/InlineTranslation.tsx`, add the same auto-collapse pattern.

Add `useRef` to the imports on line 1:

```typescript
import React, { useState, useRef, useEffect } from 'react';
```

Add after line 24 (`const [expanded, setExpanded] = useState(defaultExpanded);`):

```typescript
    const wrapperRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!expanded || !wrapperRef.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) setExpanded(false);
            },
            { threshold: 0 }
        );
        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, [expanded]);
```

Then add `ref={wrapperRef}` to both wrapper divs:

For the 'message' variant (line 33), change:

```tsx
            <div className="mt-2 pt-1.5" style={{ borderTop: '1px dashed #e2e8f0' }}>
```

to:

```tsx
            <div ref={wrapperRef} className="mt-2 pt-1.5" style={{ borderTop: '1px dashed #e2e8f0' }}>
```

For the 'blog' variant (line 56), change:

```tsx
        <div className="mt-1 mb-3">
```

to:

```tsx
        <div ref={wrapperRef} className="mt-1 mb-3">
```

- [ ] **Step 4: Run frontend type check**

```bash
cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Run frontend tests**

```bash
cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx vitest run
```

Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/messages/components/MessageBubble.tsx frontend/src/core/media/TranscriptPanel.tsx frontend/src/core/common/InlineTranslation.tsx
git commit -m "feat(ui): auto-expand/collapse transcription and translation panels"
```
