# Bug Report System Design

## Overview

A streamlined bug reporting system that collects diagnostics and creates GitHub issues with one click.

## User Flow

### Entry Points

1. **Crash (automatic)** - React Error Boundary catches crash → Shows error page with "Report Issue" button
2. **Manual (Settings)** - User clicks "Report Issue" in Settings page

### Report Modal Flow

```
User clicks "Report Issue"
    ↓
Modal opens with:
  - 4 category buttons (Sync/Data, Playback, Login, Other)
  - 2 guided text fields
  - Optional screenshot checkbox
    ↓
User fills form, clicks "Create GitHub Issue"
    ↓
App fetches diagnostics from backend
    ↓
Opens browser with pre-filled GitHub issue URL
    ↓
User reviews and submits on GitHub
```

## Bug Categories

| Category | Help Text | Context Collected |
|----------|-----------|-------------------|
| **Sync / Data** | Missing or wrong messages | member_path, local_count, server_count, sync_state |
| **Playback** | Audio/video won't play | member_path, message_id, media_file_exists, file_size |
| **Login** | Can't sign in or session expired | has_token, token_expires_in, groups_configured |
| **Other** | Something else is broken | current_screen, browser_info |

## Diagnostics Collection

### Always Collected

```json
{
  "generated_at": "ISO timestamp",
  "category": "sync_data | playback | login | other",
  "system": {
    "os": "Windows | Linux | Darwin",
    "os_release": "version",
    "python_version": "3.x.x",
    "app_version": "0.x.x",
    "pyhako_version": "0.x.x"
  },
  "auth": {
    "has_token": true,
    "token_expires_in": "2h 15m",
    "groups_configured": ["hinatazaka46"]
  },
  "logs": {
    "errors": ["ERROR and WARNING lines"],
    "recent": ["last 30 lines of any level"]
  }
}
```

### Smart Log Filtering

- Source: Single `debug.log` file (captures all levels)
- Filter at report time:
  1. All ERROR and WARNING lines (no limit)
  2. Last 30 lines of any level (recent context)
  3. Deduplicated
  4. Capped at 150 lines total

### Redaction

- File paths: `/home/username/...` → `/[REDACTED]/...`
- User nickname: replaced with `[REDACTED]`
- Auth tokens: never included (only expiry info)

## GitHub Issue Format

```markdown
## Bug Report

**Category:** Sync / Data
**What I was doing:** [user input]
**What went wrong:** [user input]

---

<details>
<summary>Diagnostics (click to expand)</summary>

\`\`\`json
{ ... redacted diagnostics JSON ... }
\`\`\`

</details>
```

Target URL: `https://github.com/xtorker/HakoDesk/issues/new?title=...&body=...`

## Error Boundary (Crash Handler)

Shows recovery UI instead of white screen:
- Error message display
- "Try Again" button (re-render attempt)
- "Report Issue" button (opens modal with crash info pre-filled)

## Files to Create/Modify

### New Files
- `frontend/src/components/ReportIssueModal.tsx`
- `frontend/src/components/ErrorBoundary.tsx`
- `backend/api/report.py`

### Modified Files
- `backend/main.py` - Remove app.log, keep only debug.log
- `frontend/src/App.tsx` - Wrap with ErrorBoundary, add state for report modal
- Settings section in App.tsx - Add "Report Issue" button

## Implementation Order

1. Simplify logging (single debug.log)
2. Create backend `/api/report` endpoint with smart filtering + redaction
3. Create ReportIssueModal component
4. Create ErrorBoundary component
5. Integrate into App.tsx
6. Add to Settings UI
