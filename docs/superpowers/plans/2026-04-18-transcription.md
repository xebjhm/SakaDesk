# Japanese Audio Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local-first Japanese audio transcription for voice/video messages with timeline-synced display, on-demand + background processing, and search integration.

**Architecture:** Backend transcription service with provider abstraction (local faster-whisper first), priority queue with async worker, JSON sidecar storage enriching the existing SQLite search index. Frontend components for transcript display (collapsible panel with timeline sync), transcribe trigger button, video subtitle overlay, and search result type differentiation.

**Tech Stack:** Python (faster-whisper, asyncio, ctypes-free), React/TypeScript, Zustand, SQLite FTS5, Tailwind CSS

---

## File Structure

### Backend (New)
| File | Responsibility |
|------|---------------|
| `backend/services/transcription_service.py` | TranscriptionProvider ABC, LocalWhisperProvider, TranscriptionStorage (JSON sidecar R/W), priority queue, background worker |
| `backend/api/transcription.py` | REST endpoints: POST transcribe, GET status, GET cached transcript |

### Backend (Modified)
| File | Change |
|------|--------|
| `backend/services/search_service.py` | Add `type` column migration, populate type during indexing, update content on transcription save, return real type in results |
| `backend/main.py` | Register transcription router, start background worker in lifespan |
| `pyproject.toml` / `uv.lock` | Add `faster-whisper` dependency |

### Frontend (New)
| File | Responsibility |
|------|---------------|
| `frontend/src/core/media/TranscriptPanel.tsx` | Reusable transcript display: segments with timestamps, active highlight, click-to-seek, auto-scroll, collapsible toggle |
| `frontend/src/core/media/TranscribeButton.tsx` | Trigger button with loading/idle/done states |
| `frontend/src/core/media/SubtitleOverlay.tsx` | Video subtitle overlay synced with playback |
| `frontend/src/hooks/useTranscription.ts` | Hook: fetch cached, trigger on-demand, manage loading/error state |

### Frontend (Modified)
| File | Change |
|------|--------|
| `frontend/src/features/messages/components/MessageBubble.tsx` | Add TranscribeButton footer + TranscriptPanel for voice/video |
| `frontend/src/core/media/PhotoDetailModal.tsx` | Add TranscribeButton + TranscriptPanel below voice/video players |
| `frontend/src/core/media/VideoPlayer.tsx` | Add SubtitleOverlay + CC toggle |
| `frontend/src/core/media/MediaGalleryModal.tsx` | Transcript preview in voice list, overlay panel above player |
| `frontend/src/features/search/components/SearchResultItem.tsx` | Type-specific icons, segment timestamp in snippet |
| `frontend/src/features/search/SearchModal.tsx` | Pass segment_start for seek-on-click |
| `frontend/src/features/search/types.ts` | Add `match_type` and `segment_start` fields |
| `frontend/src/i18n/locales/*.json` | Add 7 transcription keys × 5 locales |

---

### Task 1: Add faster-whisper dependency

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add the dependency**

```bash
cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv add faster-whisper
```

- [ ] **Step 2: Verify it installed**

```bash
uv run python -c "import faster_whisper; print(faster_whisper.__version__)"
```

Expected: Version prints without error.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "feat(transcription): add faster-whisper dependency"
```

---

### Task 2: Backend — TranscriptionProvider ABC + LocalWhisperProvider

**Files:**
- Create: `backend/services/transcription_service.py`
- Test: `backend/tests/test_transcription_service.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_transcription_service.py`:

```python
import json
from pathlib import Path

import pytest

from backend.services.transcription_service import (
    TranscriptionProvider,
    LocalWhisperProvider,
    TranscriptionStorage,
    TranscriptionResult,
    TranscriptionSegment,
)


class TestTranscriptionStorage:
    """Tests for JSON sidecar read/write."""

    def test_save_and_load_roundtrip(self, tmp_path: Path):
        storage = TranscriptionStorage()
        member_dir = tmp_path / "service" / "messages" / "1 Group" / "2 Member"
        member_dir.mkdir(parents=True)

        result = TranscriptionResult(
            message_id=123,
            media_type="voice",
            language="ja",
            model="faster-whisper-medium",
            duration_seconds=10.5,
            full_text="こんにちは",
            segments=[
                TranscriptionSegment(start=0.0, end=2.0, text="こんにちは", confidence=0.95),
            ],
        )

        storage.save(member_dir, result)

        loaded = storage.load(member_dir, 123)
        assert loaded is not None
        assert loaded.message_id == 123
        assert loaded.full_text == "こんにちは"
        assert loaded.segments[0].confidence == 0.95
        assert loaded.model == "faster-whisper-medium"

    def test_load_returns_none_when_missing(self, tmp_path: Path):
        storage = TranscriptionStorage()
        assert storage.load(tmp_path, 999) is None

    def test_save_appends_to_existing(self, tmp_path: Path):
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        r1 = TranscriptionResult(
            message_id=1, media_type="voice", language="ja",
            model="m", duration_seconds=5.0, full_text="first",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="first", confidence=0.9)],
        )
        r2 = TranscriptionResult(
            message_id=2, media_type="video", language="ja",
            model="m", duration_seconds=3.0, full_text="second",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="second", confidence=0.8)],
        )

        storage.save(member_dir, r1)
        storage.save(member_dir, r2)

        assert storage.load(member_dir, 1) is not None
        assert storage.load(member_dir, 2) is not None

    def test_save_overwrites_existing_message_id(self, tmp_path: Path):
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        r1 = TranscriptionResult(
            message_id=1, media_type="voice", language="ja",
            model="old", duration_seconds=5.0, full_text="old text",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="old", confidence=0.5)],
        )
        r2 = TranscriptionResult(
            message_id=1, media_type="voice", language="ja",
            model="new", duration_seconds=5.0, full_text="new text",
            segments=[TranscriptionSegment(start=0.0, end=1.0, text="new", confidence=0.9)],
        )

        storage.save(member_dir, r1)
        storage.save(member_dir, r2)

        loaded = storage.load(member_dir, 1)
        assert loaded is not None
        assert loaded.model == "new"
        assert loaded.full_text == "new text"

    def test_transcriptions_json_format(self, tmp_path: Path):
        """Verify the on-disk format matches the spec."""
        storage = TranscriptionStorage()
        member_dir = tmp_path / "member"
        member_dir.mkdir()

        result = TranscriptionResult(
            message_id=42, media_type="voice", language="ja",
            model="faster-whisper-medium", duration_seconds=10.0,
            full_text="test", segments=[
                TranscriptionSegment(start=0.0, end=1.0, text="test", confidence=0.9),
            ],
        )
        storage.save(member_dir, result)

        raw = json.loads((member_dir / "transcriptions.json").read_text(encoding="utf-8"))
        assert raw["version"] == 1
        assert isinstance(raw["transcriptions"], list)
        assert raw["transcriptions"][0]["message_id"] == 42
        assert "created_at" in raw["transcriptions"][0]


class TestTranscriptionProviderInterface:
    """Verify the ABC contract."""

    def test_cannot_instantiate_abc(self):
        with pytest.raises(TypeError):
            TranscriptionProvider()  # type: ignore[abstract]

    def test_local_whisper_provider_is_subclass(self):
        assert issubclass(LocalWhisperProvider, TranscriptionProvider)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_transcription_service.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: Write the implementation**

Create `backend/services/transcription_service.py`:

```python
"""
Transcription service for SakaDesk.

Provides local-first Japanese audio transcription using faster-whisper,
with a provider abstraction for future cloud API support.

Storage: JSON sidecar files (transcriptions.json) alongside messages.json.
"""

import json
import asyncio
import structlog
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = structlog.get_logger(__name__)


@dataclass
class TranscriptionSegment:
    start: float
    end: float
    text: str
    confidence: float


@dataclass
class TranscriptionResult:
    message_id: int
    media_type: str  # "voice" or "video"
    language: str
    model: str
    duration_seconds: float
    full_text: str
    segments: list[TranscriptionSegment]
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TranscriptionProvider(ABC):
    """Abstract base for transcription engines."""

    @abstractmethod
    def transcribe(self, audio_path: Path, language: str = "ja") -> TranscriptionResult:
        """Transcribe an audio file and return timestamped segments."""
        ...

    @abstractmethod
    def is_available(self) -> bool:
        """Check if the provider is ready (model downloaded, API key set, etc.)."""
        ...


class LocalWhisperProvider(TranscriptionProvider):
    """Local transcription using faster-whisper (CTranslate2)."""

    def __init__(self, model_size: str = "medium", model_dir: Optional[Path] = None):
        self._model_size = model_size
        self._model_dir = model_dir
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        from faster_whisper import WhisperModel

        kwargs = {"device": "auto", "compute_type": "auto"}
        if self._model_dir:
            kwargs["download_root"] = str(self._model_dir)

        logger.info("Loading whisper model", model=self._model_size)
        self._model = WhisperModel(self._model_size, **kwargs)
        logger.info("Whisper model loaded", model=self._model_size)

    def is_available(self) -> bool:
        try:
            self._ensure_model()
            return True
        except Exception:
            return False

    def transcribe(self, audio_path: Path, language: str = "ja") -> TranscriptionResult:
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        self._ensure_model()

        segments_iter, info = self._model.transcribe(
            str(audio_path),
            language=language,
            beam_size=5,
            vad_filter=True,
        )

        segments = []
        full_text_parts = []
        for seg in segments_iter:
            segments.append(TranscriptionSegment(
                start=round(seg.start, 2),
                end=round(seg.end, 2),
                text=seg.text.strip(),
                confidence=round(seg.avg_log_prob, 4) if hasattr(seg, 'avg_log_prob') else 0.0,
            ))
            full_text_parts.append(seg.text.strip())

        return TranscriptionResult(
            message_id=0,  # Caller sets this
            media_type="voice",  # Caller sets this
            language=info.language,
            model=f"faster-whisper-{self._model_size}",
            duration_seconds=round(info.duration, 2),
            full_text="".join(full_text_parts),
            segments=segments,
        )


class TranscriptionStorage:
    """Read/write transcriptions.json sidecar files."""

    FILENAME = "transcriptions.json"

    def save(self, member_dir: Path, result: TranscriptionResult) -> None:
        """Save a transcription result to the member's transcriptions.json."""
        file_path = member_dir / self.FILENAME

        # Load existing
        data = self._load_raw(file_path)

        # Remove existing entry for same message_id (re-transcription)
        data["transcriptions"] = [
            t for t in data["transcriptions"]
            if t["message_id"] != result.message_id
        ]

        # Append new
        entry = asdict(result)
        data["transcriptions"].append(entry)

        # Write atomically
        tmp_path = file_path.with_suffix(".tmp")
        tmp_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(file_path)

    def load(self, member_dir: Path, message_id: int) -> Optional[TranscriptionResult]:
        """Load a specific transcription by message_id."""
        file_path = member_dir / self.FILENAME
        data = self._load_raw(file_path)

        for entry in data["transcriptions"]:
            if entry["message_id"] == message_id:
                return TranscriptionResult(
                    message_id=entry["message_id"],
                    media_type=entry["media_type"],
                    language=entry["language"],
                    model=entry["model"],
                    duration_seconds=entry["duration_seconds"],
                    full_text=entry["full_text"],
                    created_at=entry.get("created_at", ""),
                    segments=[
                        TranscriptionSegment(**s)
                        for s in entry.get("segments", [])
                    ],
                )
        return None

    def load_all(self, member_dir: Path) -> list[TranscriptionResult]:
        """Load all transcriptions for a member."""
        file_path = member_dir / self.FILENAME
        data = self._load_raw(file_path)
        results = []
        for entry in data["transcriptions"]:
            results.append(TranscriptionResult(
                message_id=entry["message_id"],
                media_type=entry["media_type"],
                language=entry["language"],
                model=entry["model"],
                duration_seconds=entry["duration_seconds"],
                full_text=entry["full_text"],
                created_at=entry.get("created_at", ""),
                segments=[
                    TranscriptionSegment(**s)
                    for s in entry.get("segments", [])
                ],
            ))
        return results

    def _load_raw(self, file_path: Path) -> dict:
        if file_path.exists():
            try:
                return json.loads(file_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, KeyError):
                logger.warning("Corrupt transcriptions.json, starting fresh", path=str(file_path))
        return {"version": 1, "transcriptions": []}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_transcription_service.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/transcription_service.py backend/tests/test_transcription_service.py
git commit -m "feat(transcription): add TranscriptionProvider, LocalWhisperProvider, and storage"
```

---

### Task 3: Backend — Transcription API endpoints

**Files:**
- Create: `backend/api/transcription.py`
- Modify: `backend/main.py`
- Test: `backend/tests/test_transcription_api.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_transcription_api.py`:

```python
from unittest.mock import patch, MagicMock
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_transcription_routes_registered():
    """Transcription endpoints should be accessible."""
    response = client.get("/api/transcription/status")
    assert response.status_code == 200


def test_get_cached_returns_404_when_not_found():
    """GET cached transcript returns 404 for non-existent transcription."""
    response = client.get("/api/transcription/hinatazaka46/99999")
    assert response.status_code == 404


def test_transcribe_requires_fields():
    """POST /api/transcription/transcribe requires all fields."""
    response = client.post("/api/transcription/transcribe", json={})
    assert response.status_code == 422


def test_status_returns_queue_info():
    """GET /api/transcription/status returns queue info."""
    response = client.get("/api/transcription/status")
    data = response.json()
    assert "queue_size" in data
    assert "processing" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_transcription_api.py -v`
Expected: FAIL — routes not registered

- [ ] **Step 3: Write the API**

Create `backend/api/transcription.py`:

```python
"""
Transcription API for SakaDesk.
Handles on-demand transcription requests and cached transcript retrieval.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import structlog

from backend.services.transcription_service import (
    TranscriptionStorage,
    TranscriptionResult,
)
from backend.services.platform import get_app_data_dir
from backend.api.content import get_output_dir, validate_path_within_dir
from backend.services.service_utils import validate_service, get_service_display_name

router = APIRouter()
logger = structlog.get_logger(__name__)

storage = TranscriptionStorage()


class TranscribeRequest(BaseModel):
    message_id: int
    service: str
    member_path: str  # Relative path to member dir from output dir


@router.post("/transcribe")
async def transcribe(request: TranscribeRequest):
    """On-demand transcription of a single message."""
    try:
        validate_service(request.service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    output_dir = get_output_dir()
    member_dir = validate_path_within_dir(output_dir, request.member_path)

    if not member_dir.is_dir():
        raise HTTPException(status_code=404, detail="Member directory not found")

    # Check cache first
    cached = storage.load(member_dir, request.message_id)
    if cached:
        return {"ok": True, "transcription": _result_to_dict(cached)}

    # Find the media file for this message
    messages_file = member_dir / "messages.json"
    if not messages_file.exists():
        raise HTTPException(status_code=404, detail="Messages file not found")

    import json
    with open(messages_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    message = None
    for msg in data.get("messages", []):
        if msg.get("id") == request.message_id:
            message = msg
            break

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    media_type = message.get("type")
    if media_type not in ("voice", "video"):
        raise HTTPException(status_code=400, detail="Message is not voice or video")

    media_file = message.get("media_file")
    if not media_file:
        raise HTTPException(status_code=400, detail="Message has no media file")

    # Resolve media path
    media_path = validate_path_within_dir(output_dir, media_file)
    if not media_path.exists():
        raise HTTPException(status_code=404, detail="Media file not found on disk")

    # Transcribe
    try:
        from backend.services.transcription_service import LocalWhisperProvider

        model_dir = get_app_data_dir() / "models"
        model_dir.mkdir(parents=True, exist_ok=True)
        provider = LocalWhisperProvider(model_size="medium", model_dir=model_dir)

        import asyncio
        result = await asyncio.to_thread(provider.transcribe, media_path, "ja")
        result.message_id = request.message_id
        result.media_type = media_type

        # Save to JSON sidecar
        storage.save(member_dir, result)

        logger.info(
            "Transcription complete",
            message_id=request.message_id,
            duration=result.duration_seconds,
            segments=len(result.segments),
        )

        return {"ok": True, "transcription": _result_to_dict(result)}

    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error("Transcription failed", message_id=request.message_id, error=str(e))
        raise HTTPException(status_code=500, detail="Transcription failed")


@router.get("/status")
async def get_status():
    """Get background transcription pipeline status."""
    # Background pipeline not yet implemented — return idle status
    return {
        "queue_size": 0,
        "processing": False,
        "current_message_id": None,
    }


@router.get("/{service}/{message_id}")
async def get_cached(service: str, message_id: int):
    """Get a cached transcription by service and message_id."""
    try:
        validate_service(service)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    output_dir = get_output_dir()

    # Search all member directories under this service for the message
    try:
        display_name = get_service_display_name(service)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown service: {service}")

    service_dir = output_dir / display_name / "messages"
    if not service_dir.exists():
        raise HTTPException(status_code=404, detail="Service directory not found")

    # Search through group/member dirs for this message_id
    for group_dir in service_dir.iterdir():
        if not group_dir.is_dir():
            continue
        for member_dir in group_dir.iterdir():
            if not member_dir.is_dir():
                continue
            result = storage.load(member_dir, message_id)
            if result:
                return {"ok": True, "transcription": _result_to_dict(result)}

    raise HTTPException(status_code=404, detail="Transcription not found")


def _result_to_dict(result: TranscriptionResult) -> dict:
    """Convert TranscriptionResult to API response dict."""
    return {
        "message_id": result.message_id,
        "media_type": result.media_type,
        "language": result.language,
        "model": result.model,
        "created_at": result.created_at,
        "duration_seconds": result.duration_seconds,
        "full_text": result.full_text,
        "segments": [
            {
                "start": s.start,
                "end": s.end,
                "text": s.text,
                "confidence": s.confidence,
            }
            for s in result.segments
        ],
    }
```

- [ ] **Step 4: Register routes in main.py**

Add import at top of `backend/main.py` alongside other router imports:

```python
from backend.api import transcription
```

Add router registration alongside other routers:

```python
app.include_router(transcription.router, prefix="/api/transcription", tags=["transcription"])
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_transcription_api.py -v`
Expected: All 4 tests PASS

- [ ] **Step 6: Run all backend tests for regressions**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/ -v --timeout=30`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/api/transcription.py backend/main.py backend/tests/test_transcription_api.py
git commit -m "feat(transcription): add transcription API endpoints"
```

---

### Task 4: Backend — Search schema migration (add type column)

**Files:**
- Modify: `backend/services/search_service.py`
- Test: `backend/tests/test_search_migration.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_search_migration.py`:

```python
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest


def test_type_column_exists_after_migration(tmp_path: Path):
    """After migration, search_messages should have a type column."""
    db_path = tmp_path / "search_index.db"
    conn = sqlite3.connect(str(db_path))

    # Create old schema (without type column)
    conn.execute("""
        CREATE TABLE search_messages (
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            group_name TEXT NOT NULL,
            member_id INTEGER NOT NULL,
            member_name TEXT NOT NULL,
            timestamp TEXT,
            content TEXT,
            content_normalized TEXT,
            UNIQUE(message_id, service)
        )
    """)
    conn.commit()

    from backend.services.search_service import _migrate_add_type_column
    _migrate_add_type_column(conn)

    # Verify type column exists with default 'text'
    conn.execute("INSERT INTO search_messages (message_id, service, group_id, group_name, member_id, member_name) VALUES (1, 's', 1, 'g', 1, 'm')")
    conn.commit()
    row = conn.execute("SELECT type FROM search_messages WHERE message_id=1").fetchone()
    assert row[0] == "text"
    conn.close()


def test_migration_is_idempotent(tmp_path: Path):
    """Running migration twice should not error."""
    db_path = tmp_path / "search_index.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE search_messages (
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            service TEXT NOT NULL,
            group_id INTEGER NOT NULL,
            group_name TEXT NOT NULL,
            member_id INTEGER NOT NULL,
            member_name TEXT NOT NULL,
            timestamp TEXT,
            content TEXT,
            content_normalized TEXT,
            type TEXT DEFAULT 'text',
            UNIQUE(message_id, service)
        )
    """)
    conn.commit()

    from backend.services.search_service import _migrate_add_type_column
    _migrate_add_type_column(conn)  # Should not raise
    _migrate_add_type_column(conn)  # Should not raise
    conn.close()


def test_result_returns_real_type():
    """Search results should return the actual message type, not hardcoded 'text'."""
    from backend.services.search_service import SearchService

    svc = SearchService.__new__(SearchService)
    # Build a mock row with type at index 9
    # Row: (message_id, content, content_normalized, service, group_id, group_name, member_id, member_name, timestamp, type)
    row = (42, "content", "content", "hinatazaka46", "1", "Group", "2", "Member", "2026-04-16T12:00:00", "voice")
    query_info = {"query": "test", "normalized": "test", "reading_forms": []}

    result = svc._build_message_result_dict(row, query_info)
    assert result["type"] == "voice"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_search_migration.py -v`
Expected: FAIL — `_migrate_add_type_column` not found, result test fails because type is hardcoded "text"

- [ ] **Step 3: Add migration function to search_service.py**

Add this function to `backend/services/search_service.py` (module-level, near the schema constants):

```python
def _migrate_add_type_column(conn: sqlite3.Connection) -> None:
    """Add 'type' column to search_messages if it doesn't exist."""
    cursor = conn.execute("PRAGMA table_info(search_messages)")
    columns = {row[1] for row in cursor.fetchall()}
    if "type" not in columns:
        conn.execute("ALTER TABLE search_messages ADD COLUMN type TEXT DEFAULT 'text'")
        conn.commit()
        logger.info("Migrated search_messages: added type column")
```

- [ ] **Step 4: Update the schema creation to include type column**

In the `_SCHEMA` string constant, add `type TEXT DEFAULT 'text'` to the CREATE TABLE for `search_messages`, after the `content_normalized TEXT` line.

- [ ] **Step 5: Call migration after DB connection**

In the method that opens/initializes the database connection (the `_ensure_db` or `_get_connection` method), call `_migrate_add_type_column(conn)` after the schema creation to handle existing databases.

- [ ] **Step 6: Update result building to use real type**

In `_build_message_result_dict`, change line 1428 from:
```python
"type": "text",
```
to:
```python
"type": row[9] if len(row) > 9 and row[9] else "text",
```

And update the SELECT query that feeds this method to include the `type` column.

- [ ] **Step 7: Update indexing to store message type**

In the batch INSERT statements, add `type` to the columns and values. The message type comes from the message data's `type` field.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_search_migration.py -v`
Expected: All 3 tests PASS

- [ ] **Step 9: Run existing search tests for regressions**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk && uv run pytest backend/tests/test_search_api.py backend/tests/test_search_service_units.py backend/tests/test_search_service_core.py -v`
Expected: All existing tests PASS

- [ ] **Step 10: Commit**

```bash
git add backend/services/search_service.py backend/tests/test_search_migration.py
git commit -m "feat(search): add type column migration and return real message types"
```

---

### Task 5: Frontend — i18n keys for transcription

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/ja.json`
- Modify: `frontend/src/i18n/locales/zh-TW.json`
- Modify: `frontend/src/i18n/locales/zh-CN.json`
- Modify: `frontend/src/i18n/locales/yue.json`

- [ ] **Step 1: Add keys to all 5 locales**

Add a new `"transcription"` section to each locale file.

**en.json:**
```json
"transcription": {
    "transcribe": "Transcribe",
    "transcribing": "Transcribing...",
    "transcript": "Transcript",
    "noTranscript": "No transcript",
    "clickToJump": "click to jump",
    "failed": "Transcription failed",
    "cc": "Subtitles"
}
```

**ja.json:**
```json
"transcription": {
    "transcribe": "文字起こし",
    "transcribing": "文字起こし中...",
    "transcript": "文字起こし",
    "noTranscript": "文字起こしなし",
    "clickToJump": "クリックでジャンプ",
    "failed": "文字起こしに失敗しました",
    "cc": "字幕"
}
```

**zh-TW.json:**
```json
"transcription": {
    "transcribe": "轉錄",
    "transcribing": "轉錄中...",
    "transcript": "逐字稿",
    "noTranscript": "無逐字稿",
    "clickToJump": "點擊跳轉",
    "failed": "轉錄失敗",
    "cc": "字幕"
}
```

**zh-CN.json:**
```json
"transcription": {
    "transcribe": "转录",
    "transcribing": "转录中...",
    "transcript": "逐字稿",
    "noTranscript": "无逐字稿",
    "clickToJump": "点击跳转",
    "failed": "转录失败",
    "cc": "字幕"
}
```

**yue.json:**
```json
"transcription": {
    "transcribe": "轉錄",
    "transcribing": "轉錄緊...",
    "transcript": "逐字稿",
    "noTranscript": "冇逐字稿",
    "clickToJump": "撳嚟跳轉",
    "failed": "轉錄失敗",
    "cc": "字幕"
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/i18n/locales/*.json
git commit -m "feat(i18n): add transcription keys for all 5 locales"
```

---

### Task 6: Frontend — useTranscription hook

**Files:**
- Create: `frontend/src/hooks/useTranscription.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useState, useEffect, useCallback } from 'react';

export interface TranscriptionSegment {
    start: number;
    end: number;
    text: string;
    confidence: number;
}

export interface Transcription {
    message_id: number;
    media_type: string;
    language: string;
    model: string;
    created_at: string;
    duration_seconds: number;
    full_text: string;
    segments: TranscriptionSegment[];
}

type TranscriptionState = 'idle' | 'loading' | 'done' | 'error';

interface UseTranscriptionReturn {
    transcription: Transcription | null;
    state: TranscriptionState;
    trigger: () => Promise<void>;
    error: string | null;
}

/**
 * Hook for managing transcription state for a single message.
 * Fetches cached transcription on mount, provides trigger for on-demand.
 */
export function useTranscription(
    service: string | undefined,
    messageId: number | undefined,
    memberPath: string | undefined,
): UseTranscriptionReturn {
    const [transcription, setTranscription] = useState<Transcription | null>(null);
    const [state, setState] = useState<TranscriptionState>('idle');
    const [error, setError] = useState<string | null>(null);

    // Fetch cached transcription on mount
    useEffect(() => {
        if (!service || !messageId) return;

        let cancelled = false;
        const fetchCached = async () => {
            try {
                const res = await fetch(
                    `/api/transcription/${encodeURIComponent(service)}/${messageId}`
                );
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled && data.ok) {
                        setTranscription(data.transcription);
                        setState('done');
                    }
                }
                // 404 = not transcribed yet, stay in 'idle'
            } catch {
                // Network error — stay idle, don't show error
            }
        };

        fetchCached();
        return () => { cancelled = true; };
    }, [service, messageId]);

    // Trigger on-demand transcription
    const trigger = useCallback(async () => {
        if (!service || !messageId || !memberPath) return;
        setState('loading');
        setError(null);

        try {
            const res = await fetch('/api/transcription/transcribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message_id: messageId,
                    service,
                    member_path: memberPath,
                }),
            });

            if (!res.ok) {
                const detail = await res.json().catch(() => ({}));
                throw new Error(detail.detail || `Request failed: ${res.status}`);
            }

            const data = await res.json();
            if (data.ok) {
                setTranscription(data.transcription);
                setState('done');
            } else {
                throw new Error('Transcription returned not ok');
            }
        } catch (e) {
            setState('error');
            setError(e instanceof Error ? e.message : 'Transcription failed');
        }
    }, [service, messageId, memberPath]);

    return { transcription, state, trigger, error };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useTranscription.ts
git commit -m "feat(transcription): add useTranscription hook"
```

---

### Task 7: Frontend — TranscribeButton component

**Files:**
- Create: `frontend/src/core/media/TranscribeButton.tsx`

- [ ] **Step 1: Write the component**

```typescript
import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranscribeButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    /** Accent color for button border/text (service theme) */
    accentColor?: string;
    /** 'light' for dark backgrounds (media viewer), 'dark' for light backgrounds (chat bubble) */
    variant?: 'light' | 'dark';
}

/**
 * Transcription trigger button with loading/idle/error states.
 * Hidden when state is 'done' (transcript panel takes over).
 */
export const TranscribeButton: React.FC<TranscribeButtonProps> = ({
    state,
    onClick,
    accentColor = '#6da0d4',
    variant = 'dark',
}) => {
    const { t } = useTranslation();

    if (state === 'done') return null;

    const isLight = variant === 'light';

    if (state === 'loading') {
        return (
            <div className="flex items-center gap-2 text-xs py-1" style={{ color: isLight ? 'rgba(255,255,255,0.6)' : accentColor }}>
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('transcription.transcribing')}
            </div>
        );
    }

    return (
        <button
            onClick={onClick}
            className="text-xs py-1 px-2 rounded-md border transition-colors flex items-center gap-1"
            style={{
                color: isLight ? 'rgba(255,255,255,0.7)' : accentColor,
                borderColor: isLight ? 'rgba(255,255,255,0.15)' : `${accentColor}40`,
                background: isLight ? 'rgba(255,255,255,0.06)' : `${accentColor}08`,
            }}
            type="button"
        >
            {t(state === 'error' ? 'transcription.transcribe' : 'transcription.transcribe')}
        </button>
    );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/media/TranscribeButton.tsx
git commit -m "feat(transcription): add TranscribeButton component"
```

---

### Task 8: Frontend — TranscriptPanel component

**Files:**
- Create: `frontend/src/core/media/TranscriptPanel.tsx`

- [ ] **Step 1: Write the component**

```typescript
import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n';
import type { TranscriptionSegment } from '../../hooks/useTranscription';

interface TranscriptPanelProps {
    segments: TranscriptionSegment[];
    /** Current playback time in seconds (for highlighting active segment) */
    currentTime?: number;
    /** Called when user clicks a segment timestamp to seek */
    onSeek?: (time: number) => void;
    /** Accent color for active segment highlight */
    accentColor?: string;
    /** 'light' for dark backgrounds, 'dark' for light backgrounds */
    variant?: 'light' | 'dark';
    /** Start expanded or collapsed */
    defaultExpanded?: boolean;
}

/**
 * Collapsible transcript panel showing timeline-synced segments.
 * Active segment highlights during playback. Click timestamps to seek.
 */
export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
    segments,
    currentTime = 0,
    onSeek,
    accentColor = '#6da0d4',
    variant = 'dark',
    defaultExpanded = false,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const activeRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const userScrolledRef = useRef(false);

    // Find active segment
    const activeIndex = segments.findIndex(
        (seg, i) =>
            currentTime >= seg.start &&
            (i === segments.length - 1 || currentTime < segments[i + 1].start)
    );

    // Auto-scroll to active segment
    useEffect(() => {
        if (expanded && activeRef.current && !userScrolledRef.current) {
            activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [activeIndex, expanded]);

    // Reset user scroll flag when playback resumes
    useEffect(() => {
        userScrolledRef.current = false;
    }, [Math.floor(currentTime / 5)]); // Reset every ~5 seconds

    const isLight = variant === 'light';

    const formatTimestamp = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const Chevron = expanded ? ChevronDown : ChevronRight;

    return (
        <div>
            {/* Toggle header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs w-full text-left py-1"
                style={{ color: isLight ? 'rgba(255,255,255,0.5)' : accentColor }}
                type="button"
            >
                <Chevron className="w-3 h-3" />
                {t('transcription.transcript')}
            </button>

            {/* Segments */}
            {expanded && (
                <div
                    ref={containerRef}
                    className="max-h-32 overflow-y-auto text-xs leading-relaxed mt-1"
                    onScroll={() => { userScrolledRef.current = true; }}
                >
                    {segments.map((seg, i) => {
                        const isActive = i === activeIndex;
                        return (
                            <div
                                key={i}
                                ref={isActive ? activeRef : undefined}
                                className="py-0.5 px-1 rounded cursor-pointer transition-colors"
                                style={isActive ? {
                                    background: isLight ? `rgba(255,255,255,0.08)` : `${accentColor}15`,
                                } : undefined}
                                onClick={() => onSeek?.(seg.start)}
                            >
                                <span
                                    className="tabular-nums mr-1.5"
                                    style={{
                                        color: isActive
                                            ? (isLight ? 'rgba(255,255,255,0.7)' : accentColor)
                                            : (isLight ? 'rgba(255,255,255,0.3)' : '#999'),
                                    }}
                                >
                                    {formatTimestamp(seg.start)}
                                </span>
                                <span
                                    style={{
                                        color: isActive
                                            ? (isLight ? 'rgba(255,255,255,0.9)' : '#333')
                                            : (isLight ? 'rgba(255,255,255,0.4)' : '#666'),
                                        fontWeight: isActive ? 500 : 400,
                                    }}
                                >
                                    {seg.text}
                                </span>
                            </div>
                        );
                    })}
                    <div
                        className="text-right mt-1"
                        style={{ color: isLight ? 'rgba(255,255,255,0.2)' : '#bbb', fontSize: '10px' }}
                    >
                        {t('transcription.clickToJump')}
                    </div>
                </div>
            )}
        </div>
    );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/media/TranscriptPanel.tsx
git commit -m "feat(transcription): add TranscriptPanel component"
```

---

### Task 9: Frontend — SubtitleOverlay component

**Files:**
- Create: `frontend/src/core/media/SubtitleOverlay.tsx`

- [ ] **Step 1: Write the component**

```typescript
import React from 'react';
import type { TranscriptionSegment } from '../../hooks/useTranscription';

interface SubtitleOverlayProps {
    segments: TranscriptionSegment[];
    currentTime: number;
    visible: boolean;
}

/**
 * Semi-transparent subtitle overlay for video playback.
 * Positioned absolutely at the bottom of the video container.
 */
export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
    segments,
    currentTime,
    visible,
}) => {
    if (!visible) return null;

    const activeSegment = segments.find(
        (seg, i) =>
            currentTime >= seg.start &&
            (i === segments.length - 1 || currentTime < segments[i + 1].start)
    );

    if (!activeSegment) return null;

    return (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 pointer-events-none max-w-[80%]">
            <span className="bg-black/75 text-white text-sm px-3 py-1 rounded">
                {activeSegment.text}
            </span>
        </div>
    );
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/media/SubtitleOverlay.tsx
git commit -m "feat(transcription): add SubtitleOverlay component"
```

---

### Task 10: Frontend — Integrate into MessageBubble

**Files:**
- Modify: `frontend/src/features/messages/components/MessageBubble.tsx`

This task adds the TranscribeButton footer and TranscriptPanel below voice/video message bubbles (Option B — outside bubble as attached footer). The implementer must:

- [ ] **Step 1: Read the current MessageBubble.tsx**

Understand the component structure, props, and where the bubble content ends (~line 357).

- [ ] **Step 2: Add imports**

Add at top of file:
```typescript
import { TranscribeButton } from '../../../core/media/TranscribeButton';
import { TranscriptPanel } from '../../../core/media/TranscriptPanel';
import { useTranscription } from '../../../hooks/useTranscription';
```

- [ ] **Step 3: Add useTranscription hook call**

Inside the MessageBubble component, after the existing hooks/state, add:

```typescript
const isTranscribable = message.type === 'voice' || message.type === 'video';
const { transcription, state: transcriptionState, trigger: triggerTranscription } = useTranscription(
    isTranscribable ? service : undefined,
    isTranscribable ? message.id : undefined,
    isTranscribable ? /* member path from props or context */ undefined : undefined,
);
```

Note: The `memberPath` needs to be derived from the component context. The implementer should check what path information is available in MessageBubble or its parent (MessageList/MessagesFeature) and thread it through as a new prop if needed.

- [ ] **Step 4: Add TranscribeButton footer after the bubble div**

After the bubble content div (the one with `rounded-2xl` class), add:

```tsx
{/* Transcription footer (outside bubble) */}
{isTranscribable && !isUnread && transcriptionState !== 'done' && (
    <div
        className="border border-t-0 rounded-b-lg px-3 py-1.5 -mt-1"
        style={{
            borderColor: `${theme?.voicePlayerAccent || '#6da0d4'}20`,
            background: `${theme?.voicePlayerAccent || '#6da0d4'}06`,
        }}
    >
        <TranscribeButton
            state={transcriptionState}
            onClick={triggerTranscription}
            accentColor={theme?.voicePlayerAccent}
        />
    </div>
)}

{/* Transcript panel (outside bubble, below footer) */}
{transcriptionState === 'done' && transcription && (
    <div
        className="border rounded-lg px-3 py-2 mt-1"
        style={{
            borderColor: `${theme?.voicePlayerAccent || '#6da0d4'}15`,
            background: `${theme?.voicePlayerAccent || '#6da0d4'}05`,
        }}
    >
        <TranscriptPanel
            segments={transcription.segments}
            accentColor={theme?.voicePlayerAccent}
        />
    </div>
)}
```

- [ ] **Step 5: Verify TypeScript compiles and tests pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit && npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/messages/components/MessageBubble.tsx
git commit -m "feat(transcription): add transcribe button and panel to MessageBubble"
```

---

### Task 11: Frontend — Integrate into MediaViewerModal

**Files:**
- Modify: `frontend/src/core/media/PhotoDetailModal.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { TranscribeButton } from './TranscribeButton';
import { TranscriptPanel } from './TranscriptPanel';
import { useTranscription } from '../../hooks/useTranscription';
```

- [ ] **Step 2: Add useTranscription hook**

Inside MediaViewerModal, after the `useClipboardShortcut` call:

```typescript
const isTranscribable = item?.type === 'voice' || item?.type === 'video';
const { transcription, state: txState, trigger: triggerTx } = useTranscription(
    /* service */ undefined, // Needs to be threaded via props or MediaViewerItem
    isTranscribable ? /* message id */ undefined : undefined,
    /* member path */ undefined,
);
```

Note: The implementer needs to extend `MediaViewerItem` to include `messageId` and determine how service/memberPath are threaded. Check where MediaViewerModal is used (MessagesFeature, MediaGalleryModal, BlogPhotoGallery) and add the needed fields.

- [ ] **Step 3: Add TranscribeButton and TranscriptPanel below voice/video**

After the voice player `<div className="w-96">` block and after the VideoPlayer block, add the transcribe button and panel, styled for dark backgrounds (`variant="light"`).

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

Run: `cd /home/xtorker/repos/Project-PyHako/SakaDesk/frontend && npx tsc --noEmit && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/media/PhotoDetailModal.tsx
git commit -m "feat(transcription): add transcription to MediaViewerModal"
```

---

### Task 12: Frontend — Integrate into VideoPlayer (subtitles + CC toggle)

**Files:**
- Modify: `frontend/src/core/media/VideoPlayer.tsx`

- [ ] **Step 1: Add SubtitleOverlay import and props**

Add new optional props to VideoPlayerProps:

```typescript
/** Transcription segments for subtitle display */
transcriptionSegments?: TranscriptionSegment[];
```

Import SubtitleOverlay and add CC toggle state.

- [ ] **Step 2: Add SubtitleOverlay to the render**

Inside the video container div, add `<SubtitleOverlay>` positioned absolutely at the bottom of the video. Add a CC toggle button to the controls bar.

- [ ] **Step 3: Verify TypeScript compiles and tests pass**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/media/VideoPlayer.tsx frontend/src/core/media/SubtitleOverlay.tsx
git commit -m "feat(transcription): add subtitle overlay and CC toggle to VideoPlayer"
```

---

### Task 13: Frontend — Integrate into MediaGalleryModal (voice tab)

**Files:**
- Modify: `frontend/src/core/media/MediaGalleryModal.tsx`

- [ ] **Step 1: Add transcript preview to voice list items**

In the voice list item rendering (`renderVoiceList`), add a one-line transcript preview below the member name. Show "No transcript" in italic gray when no transcript exists.

- [ ] **Step 2: Add overlay transcript panel above player**

Add a collapsible transcript panel that overlays the list (same glassmorphism effect as the player bar), sitting between the list and the player.

- [ ] **Step 3: Verify TypeScript compiles and tests pass**

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/media/MediaGalleryModal.tsx
git commit -m "feat(transcription): add transcript preview and panel to media gallery voice tab"
```

---

### Task 14: Frontend — Search result type icons and navigation

**Files:**
- Modify: `frontend/src/features/search/components/SearchResultItem.tsx`
- Modify: `frontend/src/features/search/SearchModal.tsx`
- Modify: `frontend/src/features/search/types.ts`

- [ ] **Step 1: Update search types**

In `types.ts`, add `segment_start?: number` to `MessageSearchResult`.

- [ ] **Step 2: Update SearchResultItem icons**

Replace the hardcoded `MessageSquare` icon with type-specific icons:
- `type === 'voice'` → `Volume2`
- `type === 'video'` → `Video`
- default → `MessageSquare`

For voice/video results with `segment_start`, prefix the snippet with `[M:SS]` timestamp.

- [ ] **Step 3: Update SearchModal navigation**

When clicking a voice/video search result, pass `segment_start` to enable seek-on-navigate. The target message should auto-expand its transcript panel and seek the player.

- [ ] **Step 4: Verify TypeScript compiles and tests pass**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/search/components/SearchResultItem.tsx frontend/src/features/search/SearchModal.tsx frontend/src/features/search/types.ts
git commit -m "feat(search): add type-specific icons and transcript seek for voice/video results"
```

---

### Task 15: Manual Integration Testing

**Files:** None (testing only)

- [ ] **Step 1: Start dev server and test on-demand transcription**
1. Open a conversation with voice messages
2. Click "Transcribe" button on a voice message
3. Wait for transcription to complete (first time downloads the model)
4. Verify transcript panel appears with timestamped segments

- [ ] **Step 2: Test timeline sync**
1. Play the voice message
2. Verify active segment highlights as playback progresses
3. Click a timestamp to seek
4. Verify playback jumps to that point

- [ ] **Step 3: Test in MediaViewerModal**
1. Open voice message in full-screen viewer
2. Click Transcribe, verify transcript panel appears below player
3. Test timeline sync in full-screen mode

- [ ] **Step 4: Test video subtitles**
1. Transcribe a video message
2. Open in full-screen viewer
3. Toggle CC button
4. Verify subtitles appear over the video

- [ ] **Step 5: Test media gallery voice tab**
1. Open media gallery, go to voice tab
2. Verify transcript previews show for transcribed messages
3. Verify "No transcript" for non-transcribed
4. Select a transcribed message, verify overlay panel above player

- [ ] **Step 6: Test search integration**
1. Search for a word that appears in a transcription
2. Verify voice/video results show correct icon (Volume2/Video)
3. Click the result
4. Verify navigation to message with transcript expanded
