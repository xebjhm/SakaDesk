<p align="center">
  <img src="SakaDesk_logo.png" alt="SakaDesk" width="128" />
</p>

# SakaDesk

A desktop GUI application for browsing, synchronizing, and backing up content from Nogizaka46, Sakurazaka46, Hinatazaka46, and Yodel services.

## Features

- **Multi-service support** — browse Nogizaka46, Sakurazaka46, Hinatazaka46, and Yodel from a single app
- **Multi-group chat display** with member lists and thumbnails
- **Blog browsing and backup** with full content preservation
- **Global search** across messages and blogs (with Japanese transliteration)
- **Message synchronization** from cloud with adaptive progress tracking
- **Unread message management** with read state persistence
- **Virtual scrolling** for efficient display of 10k+ messages
- **Voice message playback** for audio content
- **Favorites and sent letters** management
- **Calendar navigation** for browsing messages by date
- **Notifications** panel for service alerts
- **Internationalization** — English, Japanese, Traditional Chinese, Simplified Chinese, Cantonese
- **Service-themed UI** with per-service color schemes
- **Background customization** for the content area
- **First-launch onboarding flow** with login carousel and sequential sync
- **Update checker** with in-app upgrade notifications
- **Secure credential storage** using platform-native keyring
- **Settings management** (output folder, auto-sync interval, blog backup status)
- **Diagnostics panel** for debugging and log access

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     SakaDesk                            │
├─────────────────────────────────────────────────────────┤
│  desktop.py (pywebview)                                 │
│     ├── Starts FastAPI backend on dynamic port          │
│     └── Creates native window pointing to localhost     │
├─────────────────────────────────────────────────────────┤
│  Backend (FastAPI + Python)                             │
│     ├── API Routes: auth, sync, content, settings,      │
│     │   blogs, search, notifications, favorites, ...    │
│     └── Services: auth, sync, blog, search, adaptive    │
│         sync, notifications, settings, upgrade, ...     │
├─────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript + Vite)                   │
│     ├── 3-zone layout: ServiceRail │ FeatureRail │      │
│     │   ContentArea                                     │
│     ├── Features: messages, blogs, search               │
│     └── State: Zustand store, i18n (5 languages)        │
└─────────────────────────────────────────────────────────┘
```

## Requirements

- Python 3.12+
- Node.js 18+ (for frontend development/building)
- [uv](https://docs.astral.sh/uv/) package manager

## Development Setup

### 1. Clone and setup dependencies

```bash
# Clone the repository
git clone https://github.com/xebjhm/Project-pysaka.git
cd Project-pysaka/SakaDesk

# Install Python dependencies with uv
uv sync

# Install frontend dependencies
cd frontend
npm ci
cd ..
```

### 2. Run in development mode

**Option A: Full desktop app (recommended)**
```bash
uv run python desktop.py
```

**Option B: Separate backend and frontend (for development)**

Terminal 1 - Backend:
```bash
uv run uvicorn backend.main:app --port 8000 --reload --reload-exclude "output/*" --reload-exclude "auth_data/*"
```

Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

Then open http://localhost:5173 in your browser.

### 3. Run tests

```bash
uv run pytest
```

## Building

### Verify Build (All Platforms)

```bash
uv run python scripts/verify_build.py
```

This script will:
1. Build the frontend (if needed)
2. Run tests
3. Verify the application starts correctly

### Windows Installer

Requires [Inno Setup 6](https://jrsoftware.org/isdl.php) installed.

```bash
# Full build with installer
uv run python scripts/verify_build.py --build
```

Or use the Windows batch script:
```cmd
scripts\build_windows.bat
```

## Project Structure

```
SakaDesk/
├── backend/                 # FastAPI backend
│   ├── api/                 # API route handlers
│   │   ├── auth.py          # Authentication endpoints
│   │   ├── blogs.py         # Blog browsing/backup
│   │   ├── chat_features.py # Letters, calendar, etc.
│   │   ├── content.py       # Message/group content
│   │   ├── diagnostics.py   # Debug utilities
│   │   ├── favorites.py     # Favorites management
│   │   ├── notifications.py # Service notifications
│   │   ├── profile.py       # User profile
│   │   ├── progress.py      # Sync progress
│   │   ├── read_states.py   # Unread tracking
│   │   ├── report.py        # Reporting
│   │   ├── search.py        # Global search
│   │   ├── settings.py      # Settings management
│   │   ├── sync.py          # Sync orchestration
│   │   └── version.py       # Version/update check
│   └── services/            # Business logic
│       ├── adaptive_sync.py # Adaptive sync scheduling
│       ├── auth_service.py  # Authentication logic
│       ├── blog_service.py  # Blog backup engine
│       ├── notification_service.py # Notification handling
│       ├── path_resolver.py # Data path resolution
│       ├── platform.py      # Cross-platform utilities
│       ├── search_service.py # Search index & query
│       ├── service_utils.py # Shared service helpers
│       ├── settings_store.py # Persistent settings
│       ├── sync_service.py  # Sync engine
│       └── upgrade_service.py # Update checker
├── frontend/                # React + TypeScript + Vite
│   ├── src/
│   │   ├── shell/           # App shell, layout, routing
│   │   ├── core/            # Shared layout & media components
│   │   ├── features/        # Feature modules (messages, blogs, search)
│   │   ├── store/           # Zustand state management
│   │   ├── config/          # Service themes, feature flags
│   │   ├── i18n/            # Translations (en, ja, zh-TW, zh-CN, yue)
│   │   ├── pages/           # Page components
│   │   ├── types/           # TypeScript interfaces
│   │   └── utils/           # Shared utilities
│   └── dist/                # Built frontend (generated)
├── tests/                   # Test suite
├── tooling/                 # Build scripts
│   ├── build_windows.spec   # PyInstaller configuration
│   └── windows/
│       ├── build_windows.py # Build orchestration
│       └── setup.iss        # Inno Setup installer script
├── scripts/                 # Development/CI scripts
│   ├── verify_build.py      # Build verification
│   └── build_windows.bat    # Windows build script
├── desktop.py               # Desktop app entry point
└── pyproject.toml           # Python project configuration
```

## Configuration

Application data is stored in:
- **Windows:** `%LOCALAPPDATA%\SakaDesk\`
- **Linux/macOS:** `~/.SakaDesk/`

Settings include:
- Output folder for synchronized messages
- Auto-sync enable/disable
- Sync interval (1, 5, 10, 30, 60 minutes)

## API Documentation

When running the backend, interactive API documentation is available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Dependencies

### Backend (Python)
- **pysaka** - Core sync SDK (local dependency)
- **FastAPI** + **uvicorn** - Web framework and ASGI server
- **python-multipart** + **aiofiles** - File upload and async file I/O
- **keyring** + **keyrings-alt** - Secure credential storage
- **structlog** - Structured logging
- **plyer** - Native desktop notifications
- **pykakasi** + **jaconv** - Japanese transliteration for search
- **tk** - Tkinter for native file dialogs

> `pywebview` is used at runtime to create the desktop window but is a build-time/system dependency, not listed in `pyproject.toml`.

### Frontend (TypeScript)
- **React 18** + **react-router-dom** - UI framework and routing
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **zustand** - State management
- **i18next** + **react-i18next** - Internationalization
- **framer-motion** - Animations
- **react-virtuoso** - Virtual scrolling
- **lucide-react** - Icon set
- **dompurify** - HTML sanitization
- **clsx** + **tailwind-merge** - Class name utilities

## License

MIT License - see LICENSE file for details.
