# HakoDesk

A desktop GUI application for viewing and synchronizing group chat messages from the Hako platform.

## Features

- **Multi-group chat display** with member lists and thumbnails
- **Message synchronization** from cloud with real-time progress tracking
- **Unread message management** with read state persistence
- **Virtual scrolling** for efficient display of 10k+ messages
- **Voice message playback** for audio content
- **Secure credential storage** using platform-native keyring (Windows Credential Manager)
- **Settings management** (output folder, auto-sync interval)
- **Diagnostics panel** for debugging and log access

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     HakoDesk                            │
├─────────────────────────────────────────────────────────┤
│  desktop.py (pywebview)                                 │
│     ├── Starts FastAPI backend on dynamic port          │
│     └── Creates native window pointing to localhost     │
├─────────────────────────────────────────────────────────┤
│  Backend (FastAPI + Python)                             │
│     ├── API Routes: auth, sync, content, settings       │
│     └── Services: auth_service, sync_service, platform  │
├─────────────────────────────────────────────────────────┤
│  Frontend (React + TypeScript + Vite)                   │
│     ├── Components: Message display, Settings, Login    │
│     └── State: Unread tracking, scroll position, sync   │
└─────────────────────────────────────────────────────────┘
```

## Requirements

- Python 3.9+
- Node.js 18+ (for frontend development/building)
- [uv](https://docs.astral.sh/uv/) package manager

## Development Setup

### 1. Clone and setup dependencies

```bash
# Clone the repository
git clone https://github.com/xtorker/Project-PyHako.git
cd Project-PyHako/HakoDesk

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
HakoDesk/
├── backend/                 # FastAPI backend
│   ├── api/                 # API route handlers
│   │   ├── auth.py          # Authentication endpoints
│   │   ├── content.py       # Message/group content
│   │   ├── settings.py      # Settings management
│   │   ├── sync.py          # Sync orchestration
│   │   └── diagnostics.py   # Debug utilities
│   └── services/            # Business logic
│       ├── auth_service.py  # Authentication logic
│       ├── sync_service.py  # Sync engine
│       ├── credential_store.py # Secure storage
│       └── platform.py      # Cross-platform utilities
├── frontend/                # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx          # Main application component
│   │   ├── components/      # UI components
│   │   ├── pages/           # Page components
│   │   └── types/           # TypeScript interfaces
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
- **Windows:** `%LOCALAPPDATA%\pymsg\`
- **Linux/macOS:** `~/.config/pymsg/`

Settings include:
- Output folder for synchronized messages
- Auto-sync enable/disable
- Sync interval (1, 5, 10, 30, 60 minutes)

## API Documentation

When running the backend, interactive API documentation is available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Dependencies

### Runtime
- **PyHako** - Core sync SDK (local dependency)
- **FastAPI** - Web framework
- **uvicorn** - ASGI server
- **pywebview** - Desktop window wrapper
- **keyring** - Secure credential storage
- **structlog** - Structured logging

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **react-virtuoso** - Virtual scrolling

## License

MIT License - see LICENSE file for details.
