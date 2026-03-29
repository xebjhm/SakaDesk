# SakaDesk Upgrade System Redesign

> **Date:** 2026-03-23
> **Status:** Approved

## Problem

The current in-place upgrade system uses a batch script intermediary that is fragile:
- `/VERYSILENT` swallows errors — installer failures are invisible
- Batch script has timing/path edge cases
- Version doesn't bump in Windows "Apps & Features" or in-app About when the installer silently fails
- Top banner UX feels intrusive and disconnected from the app layout

## Design

### Upgrade Flow

```
App startup
    │
    ├─▶ cleanup_upgrade_files() (remove leftover installer from last upgrade)
    │
    ├─▶ Check GitHub releases (hourly, 5-min retry on error)
    │
    ▼
New version available?
    │ yes
    ▼
Auto-download ON? ───no───▶ Show Stage 1 icon (download arrow + dot)
    │ yes                          │ user clicks
    ▼                              ▼
Download silently             Download with progress ring on icon
    │                              │
    ├─▶ Verify SHA-256 against GitHub asset.digest
    │
    ▼
Show Stage 2 icon (restart arrow + dot)
    │ user clicks
    ▼
subprocess.Popen(installer.exe /SILENT /SUPPRESSMSGBOXES /NORESTART)
    │
    ▼
Inno Setup:
    ├─▶ Shows progress dialog (small window, ~3 sec)
    ├─▶ CloseApplications=yes closes running SakaDesk
    ├─▶ Overwrites app files + updates Windows registry (AppVersion)
    └─▶ [Run] section relaunches SakaDesk.exe
```

### UI: Service Rail Upgrade Icon

Replace the top gradient banner with an icon in the service rail (Zone A), positioned above the search icon at the bottom.

**Icon states:**

| State | Visual | Tooltip | Click |
|-------|--------|---------|-------|
| No update | Hidden | — | — |
| Stage 1: Available | Download arrow + blue notification dot | "Update v0.2.3 available" | Start download |
| Downloading | Download arrow + circular progress ring (0-100%) | "Downloading v0.2.3... 65%" | Cancel download |
| Stage 2: Ready | Restart arrow + green notification dot | "Click to restart and update to v0.2.3" | Launch installer |

**Dismiss behavior:**
- Stage 1 icon can be dismissed (right-click → "Skip this version"), stored in localStorage per version
- Stage 2 icon cannot be dismissed (installer is already downloaded)
- If a newer version appears after dismissing, the icon reappears

### Settings

Add a toggle in Settings:

```
Auto-download updates: [ON/OFF]

When enabled, new versions are downloaded automatically in the background.
You'll only see the restart icon when the update is ready to install.
```

Default: **ON**

### SHA-256 Verification

GitHub provides `asset.digest` natively in the release API response:

```json
{
  "name": "SakaDesk-0.2.3-Setup.exe",
  "size": 56883125,
  "digest": "sha256:a0a6fd2fec696e89f25a41ec479dd7e9949492bc9a8c901a26b53427e05ea94c",
  "browser_download_url": "https://github.com/..."
}
```

After download:
1. Verify file size matches `asset.size`
2. Compute `hashlib.sha256()` on the downloaded file
3. Compare against `asset.digest` (strip the `sha256:` prefix)
4. If mismatch → delete file, set error state, log details

No build pipeline changes needed.

### Installer Storage

- **Location:** `%LOCALAPPDATA%\SakaDesk\upgrade\`
- **Cleanup:** `cleanup_upgrade_files()` runs on every app startup (already implemented)
- **Cancel:** Deletes partial download immediately

### Installer Invocation

Replace the batch script with a direct subprocess call:

```python
subprocess.Popen(
    [str(installer_path), "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    close_fds=True,
)
```

**Flags:**
- `/SILENT` — shows progress dialog, skips wizard pages
- `/SUPPRESSMSGBOXES` — no confirmation dialogs
- `/NORESTART` — don't restart Windows (Inno Setup's `[Run]` handles app relaunch)

**Why no batch script:**
- Inno Setup's `CloseApplications=yes` handles closing the running app
- Inno Setup's `[Run]` section handles relaunching after install
- No timing issues, no path escaping problems, no silent failures

### Version Bump Fix

The version not updating was caused by the batch script approach failing silently. With direct `/SILENT` invocation:
- Installer errors are visible (progress dialog shows failure)
- When install succeeds, Inno Setup updates the registry `AppVersion`
- New app bundle has new version in `pyproject.toml` → `importlib.metadata` reads it correctly

## What to Remove

- `UpdateBanner.tsx` — replaced by service rail icon
- `generate_upgrade_script()` — no more batch scripts
- `POST /upgrade/launch` endpoint — merged into the upgrade flow
- All batch script generation code in `upgrade_service.py`

## What to Add

- Service rail upgrade icon component (two-stage with progress ring)
- SHA-256 verification in `download_installer()`
- `auto_download_updates` setting (default: ON)
- Digest fetching in `get_installer_download_url()`

## What to Modify

- `upgrade_service.py` — remove batch script, add digest verification, direct `/SILENT` invocation
- `version.py` API — simplify endpoints (remove `/upgrade/launch`, merge into `/upgrade/start`)
- Settings store — add `auto_download_updates` field
- Service rail component — add upgrade icon slot
