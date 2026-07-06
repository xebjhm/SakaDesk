# Port-Independent App State + Close→Reopen Safety — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all persistent frontend state off origin-scoped `localStorage` into a port-independent SQLite store, and make a fast close→reopen safe (state intact, no data-dir write race), so shifting the webview port never resets anything.

**Architecture:** A backend `app_state` service (SQLite `app_state.db`) is the source of truth; the frontend hydrates a Zustand-backed `persisted` layer from it at startup and write-throughs changes. An OS-level data-dir write lock, released by the outgoing instance only after it has stopped and drained every writer, serializes instances across a close→reopen. The `.port` reuse hack is removed.

**Tech Stack:** Python 3.12, FastAPI, SQLite (stdlib `sqlite3`, WAL), `msvcrt`/`fcntl` file locking, pytest; TypeScript, React, Zustand, Vitest.

## Global Constraints

- Python floor **3.12**; `pysaka>=0.4.2`. Windows is the primary platform; lock code must no-op safely on non-Windows (dev/CI runs on Linux too).
- Backend service modules stay framework-free (no FastAPI import in `services/`).
- All SQLite access via short-lived connections opened in **WAL** mode (`PRAGMA journal_mode=WAL`).
- Data dir = `get_app_data_dir()` (already honors `SAKADESK_DATA_DIR`). Never hardcode `%LOCALAPPDATA%`.
- Ruff + mypy must pass (`ruff check`, `ruff format --check`, `mypy backend/`); frontend `tsc --noEmit` + `npm run test:run` must pass.
- Commit after each task. Do NOT push; do NOT bump version (0.3.2 bump already committed).

## File Structure

**Backend**
- Create `backend/services/data_lock.py` — OS-level data-dir write lock (acquire/release/crash-safe). No other deps.
- Create `backend/services/app_state.py` — SQLite store: schema, prefs, conversation_state, translation_cache (LRU), migration ingest. No framework deps.
- Create `backend/api/app_state.py` — endpoints over the service.
- Modify `backend/main.py` — register the router; acquire the write lock before starting writers; ordered shutdown (quiesce → drain → final writes → release).
- Modify `backend/services/sync_service.py`, `blog_service.py`, `search_service.py` — expose a cooperative `stop()`/cancel hook the shutdown sequence can call (most already have shutdown paths; standardize).
- Modify `desktop.py` — remove `.port` reuse + `_port_is_active`; server binds an ephemeral port.

**Frontend**
- Create `frontend/src/core/persistence/persisted.ts` — backend-backed get/set for prefs, conversation state, translation cache; migration; Zustand hydration.
- Create `frontend/src/core/persistence/appStateApi.ts` — typed fetch wrappers for `/api/app-state/*`.
- Modify the ~15 audited call sites to use `persisted` instead of `localStorage`.

---

### Task 1: Data-dir write lock (`data_lock.py`)

**Files:**
- Create: `backend/services/data_lock.py`
- Test: `backend/tests/test_data_lock.py`

**Interfaces:**
- Produces: `class DataDirLock:` with `acquire(timeout: float = 10.0) -> bool`, `release() -> None`, `held: bool` property; context-manager support. Constructor `DataDirLock(lock_path: Path)`. OS-exclusive so a dead holder's lock is auto-released by the OS.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_data_lock.py
import multiprocessing
import time
from pathlib import Path

from backend.services.data_lock import DataDirLock


def _hold(lock_path, ready, release):
    lk = DataDirLock(Path(lock_path))
    assert lk.acquire(timeout=2.0)
    ready.set()
    release.wait(5.0)
    lk.release()


def test_second_acquire_blocks_until_first_releases(tmp_path):
    lp = tmp_path / ".write.lock"
    ready = multiprocessing.Event()
    release = multiprocessing.Event()
    p = multiprocessing.Process(target=_hold, args=(str(lp), ready, release))
    p.start()
    assert ready.wait(3.0)

    other = DataDirLock(lp)
    assert other.acquire(timeout=0.3) is False  # held by the child

    release.set()
    p.join(5.0)
    assert other.acquire(timeout=2.0) is True    # freed after child released
    other.release()


def test_crash_releases_lock(tmp_path):
    lp = tmp_path / ".write.lock"
    ready = multiprocessing.Event()
    never = multiprocessing.Event()
    p = multiprocessing.Process(target=_hold, args=(str(lp), ready, never))
    p.start()
    assert ready.wait(3.0)
    p.kill()  # die without release()
    p.join(5.0)
    other = DataDirLock(lp)
    assert other.acquire(timeout=2.0) is True   # OS released it on process death
    other.release()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_data_lock.py -q`
Expected: FAIL — `ModuleNotFoundError: backend.services.data_lock`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/data_lock.py
"""OS-level exclusive lock over the data directory's writer subsystem.

Exclusive so the OS auto-releases it if the holding process dies (crash-safe).
Held for the lifetime a process owns data-dir writes; released only after that
process has stopped and drained every writer. Reads never take this lock.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Optional

_IS_WINDOWS = os.name == "nt"


class DataDirLock:
    def __init__(self, lock_path: Path) -> None:
        self._path = lock_path
        self._fh: Optional[object] = None

    @property
    def held(self) -> bool:
        return self._fh is not None

    def acquire(self, timeout: float = 10.0) -> bool:
        if self.held:
            return True
        self._path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + timeout
        # Open (create) the lock file; keep the handle for the lock's lifetime.
        fh = open(self._path, "a+b")
        while True:
            if self._try_lock(fh):
                self._fh = fh
                return True
            if time.monotonic() >= deadline:
                fh.close()
                return False
            time.sleep(0.05)

    def release(self) -> None:
        if self._fh is None:
            return
        try:
            self._unlock(self._fh)
        finally:
            self._fh.close()
            self._fh = None

    def __enter__(self) -> "DataDirLock":
        self.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self.release()

    # --- platform primitives ---
    @staticmethod
    def _try_lock(fh) -> bool:
        try:
            if _IS_WINDOWS:
                import msvcrt

                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            return False

    @staticmethod
    def _unlock(fh) -> None:
        try:
            if _IS_WINDOWS:
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_data_lock.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/services/data_lock.py backend/tests/test_data_lock.py
git commit -m "feat(lock): OS-level crash-safe data-dir write lock"
```

---

### Task 2: App-state SQLite store (`app_state.py`)

**Files:**
- Create: `backend/services/app_state.py`
- Test: `backend/tests/test_app_state_store.py`

**Interfaces:**
- Produces (all take `db_path: Path` via a module-level `set_db_path` / default `get_app_data_dir()/"app_state.db"`, lazy `_connect()` in WAL):
  - `get_prefs() -> dict[str, Any]`, `set_prefs(patch: dict[str, Any]) -> None`
  - `get_conversation(path: str) -> dict[str, Any]`, `set_conversation(path: str, patch: dict[str, Any]) -> None`
  - `get_translations(keys: list[str]) -> dict[str, str]`, `put_translations(items: dict[str, str]) -> None` (key = `"<message_id>:<lang>"`), with LRU cap `_MAX_TRANSLATIONS = 50000`
  - `migrate_dump(dump: dict) -> None` (idempotent; sets a `migrated` pref flag), `is_migrated() -> bool`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_app_state_store.py
from backend.services import app_state


def _fresh(tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    return app_state


def test_prefs_round_trip_and_partial_update(tmp_path):
    s = _fresh(tmp_path)
    assert s.get_prefs() == {}
    s.set_prefs({"tos_accepted_at": "2026-07-07T00:00:00Z", "language": "zh-TW"})
    s.set_prefs({"language": "ja"})  # partial: keeps tos
    p = s.get_prefs()
    assert p["tos_accepted_at"] == "2026-07-07T00:00:00Z"
    assert p["language"] == "ja"


def test_conversation_state_round_trip(tmp_path):
    s = _fresh(tmp_path)
    s.set_conversation("hinatazaka46/1", {"scroll_msg_id": 42, "read_up_to": 41})
    s.set_conversation("hinatazaka46/1", {"background": "dark"})
    assert s.get_conversation("hinatazaka46/1") == {
        "scroll_msg_id": 42, "read_up_to": 41, "background": "dark",
    }
    assert s.get_conversation("unknown") == {}


def test_translation_cache_and_lru(tmp_path, monkeypatch):
    s = _fresh(tmp_path)
    monkeypatch.setattr(s, "_MAX_TRANSLATIONS", 2)
    s.put_translations({"1:ja": "A", "2:ja": "B"})
    assert s.get_translations(["1:ja", "2:ja"]) == {"1:ja": "A", "2:ja": "B"}
    s.get_translations(["1:ja"])                 # touch 1 -> newest
    s.put_translations({"3:ja": "C"})            # over cap -> evict LRU (2)
    got = s.get_translations(["1:ja", "2:ja", "3:ja"])
    assert "2:ja" not in got and got["1:ja"] == "A" and got["3:ja"] == "C"


def test_migrate_dump_is_idempotent(tmp_path):
    s = _fresh(tmp_path)
    assert s.is_migrated() is False
    s.migrate_dump({"prefs": {"language": "yue"},
                    "conversations": {"a/1": {"read_up_to": 9}},
                    "translations": {"5:ja": "x"}})
    assert s.is_migrated() is True
    s.migrate_dump({"prefs": {"language": "en"}})  # ignored once migrated
    assert s.get_prefs()["language"] == "yue"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_app_state_store.py -q`
Expected: FAIL — module/attributes missing.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/services/app_state.py
"""Port-independent app state (SQLite, WAL). Source of truth for state the
frontend used to keep in origin-scoped localStorage."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

from backend.services.platform import get_app_data_dir

_db_path: Optional[Path] = None
_MAX_TRANSLATIONS = 50000


def set_db_path(path: Path) -> None:
    global _db_path
    _db_path = path


def _path() -> Path:
    return _db_path or (get_app_data_dir() / "app_state.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_path())
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db() -> None:
    with _connect() as c:
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS conversation_state (path TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS translation_cache (
                k TEXT PRIMARY KEY, v TEXT, last_used REAL
            );
            """
        )


def get_prefs() -> dict[str, Any]:
    with _connect() as c:
        rows = c.execute("SELECT key, value FROM prefs").fetchall()
    return {k: json.loads(v) for k, v in rows}


def set_prefs(patch: dict[str, Any]) -> None:
    with _connect() as c:
        for k, v in patch.items():
            c.execute(
                "INSERT INTO prefs(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, json.dumps(v)),
            )


def get_conversation(path: str) -> dict[str, Any]:
    with _connect() as c:
        row = c.execute(
            "SELECT data FROM conversation_state WHERE path=?", (path,)
        ).fetchone()
    return json.loads(row[0]) if row else {}


def set_conversation(path: str, patch: dict[str, Any]) -> None:
    merged = get_conversation(path)
    merged.update(patch)
    with _connect() as c:
        c.execute(
            "INSERT INTO conversation_state(path,data) VALUES(?,?) "
            "ON CONFLICT(path) DO UPDATE SET data=excluded.data",
            (path, json.dumps(merged)),
        )


def get_translations(keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    q = ",".join("?" * len(keys))
    now = time.time()
    with _connect() as c:
        rows = c.execute(
            f"SELECT k, v FROM translation_cache WHERE k IN ({q})", keys
        ).fetchall()
        if rows:
            c.execute(
                f"UPDATE translation_cache SET last_used=? WHERE k IN ({q})",
                [now, *[k for k, _ in rows]],
            )
    return {k: v for k, v in rows}


def put_translations(items: dict[str, str]) -> None:
    now = time.time()
    with _connect() as c:
        for k, v in items.items():
            c.execute(
                "INSERT INTO translation_cache(k,v,last_used) VALUES(?,?,?) "
                "ON CONFLICT(k) DO UPDATE SET v=excluded.v, last_used=excluded.last_used",
                (k, v, now),
            )
        (count,) = c.execute("SELECT COUNT(*) FROM translation_cache").fetchone()
        if count > _MAX_TRANSLATIONS:
            c.execute(
                "DELETE FROM translation_cache WHERE k IN ("
                "SELECT k FROM translation_cache ORDER BY last_used ASC LIMIT ?)",
                (count - _MAX_TRANSLATIONS,),
            )


def is_migrated() -> bool:
    return bool(get_prefs().get("_migrated"))


def migrate_dump(dump: dict) -> None:
    if is_migrated():
        return
    set_prefs(dump.get("prefs", {}))
    for path, data in dump.get("conversations", {}).items():
        set_conversation(path, data)
    if dump.get("translations"):
        put_translations(dump["translations"])
    set_prefs({"_migrated": True})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_app_state_store.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/services/app_state.py backend/tests/test_app_state_store.py
git commit -m "feat(app-state): SQLite store for prefs/conversation/translation-cache"
```

---

### Task 3: App-state HTTP endpoints

**Files:**
- Create: `backend/api/app_state.py`
- Modify: `backend/main.py` (register router — find the existing `app.include_router(...)` block and add `app.include_router(app_state_router, prefix="/api/app-state")`)
- Test: `backend/tests/test_app_state_api.py`

**Interfaces:**
- Consumes: `backend.services.app_state`
- Produces routes: `GET /api/app-state/prefs`, `PATCH /api/app-state/prefs`, `GET /api/app-state/conversation?path=`, `PATCH /api/app-state/conversation?path=`, `GET /api/app-state/translations?keys=a,b`, `PATCH /api/app-state/translations`, `POST /api/app-state/migrate`, `GET /api/app-state/migrate` (returns `{"migrated": bool}`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_app_state_api.py
from backend.services import app_state


def test_prefs_and_migrate_endpoints(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()

    assert client.get("/api/app-state/migrate").json() == {"migrated": False}
    client.patch("/api/app-state/prefs", json={"language": "ja"})
    assert client.get("/api/app-state/prefs").json()["language"] == "ja"

    client.post("/api/app-state/migrate", json={"prefs": {"volume": 0.5}})
    assert client.get("/api/app-state/migrate").json() == {"migrated": True}
    assert client.get("/api/app-state/prefs").json()["volume"] == 0.5


def test_conversation_and_translations_endpoints(client, tmp_path):
    app_state.set_db_path(tmp_path / "app_state.db")
    app_state.init_db()
    client.patch("/api/app-state/conversation?path=a/1", json={"read_up_to": 9})
    assert client.get("/api/app-state/conversation?path=a/1").json()["read_up_to"] == 9
    client.patch("/api/app-state/translations", json={"1:ja": "hi"})
    assert client.get("/api/app-state/translations?keys=1:ja").json() == {"1:ja": "hi"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_app_state_api.py -q`
Expected: FAIL — 404 (router not registered).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/api/app_state.py
from fastapi import APIRouter, Body
from pydantic import BaseModel

from backend.services import app_state

router = APIRouter()


@router.get("/prefs")
async def get_prefs():
    return app_state.get_prefs()


@router.patch("/prefs")
async def patch_prefs(patch: dict = Body(...)):
    app_state.set_prefs(patch)
    return {"ok": True}


@router.get("/conversation")
async def get_conversation(path: str):
    return app_state.get_conversation(path)


@router.patch("/conversation")
async def patch_conversation(path: str, patch: dict = Body(...)):
    app_state.set_conversation(path, patch)
    return {"ok": True}


@router.get("/translations")
async def get_translations(keys: str = ""):
    wanted = [k for k in keys.split(",") if k]
    return app_state.get_translations(wanted)


@router.patch("/translations")
async def patch_translations(items: dict = Body(...)):
    app_state.put_translations({k: str(v) for k, v in items.items()})
    return {"ok": True}


class MigrateDump(BaseModel):
    prefs: dict = {}
    conversations: dict = {}
    translations: dict = {}


@router.get("/migrate")
async def migrate_status():
    return {"migrated": app_state.is_migrated()}


@router.post("/migrate")
async def migrate(dump: MigrateDump):
    app_state.migrate_dump(dump.model_dump())
    return {"migrated": app_state.is_migrated()}
```

Then in `backend/main.py`, next to the other routers:

```python
from backend.api.app_state import router as app_state_router
app.include_router(app_state_router, prefix="/api/app-state")
```

- [ ] **Step 4: Run tests + confirm existing suite green**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_app_state_api.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/api/app_state.py backend/main.py backend/tests/test_app_state_api.py
git commit -m "feat(app-state): HTTP endpoints for prefs/conversation/translations/migrate"
```

---

### Task 4: Startup DB init + write-lock acquire + ordered shutdown

**Files:**
- Modify: `backend/main.py` (lifespan: `app_state.init_db()`; acquire `DataDirLock` before enabling writers; on shutdown run quiesce→drain→final-writes→release)
- Modify: `backend/services/sync_service.py`, `blog_service.py`, `search_service.py` — ensure each exposes an idempotent, awaitable/callable `stop()` that cancels its loop/tasks and returns only once no further write will occur.
- Test: `backend/tests/test_shutdown_write_barrier.py`

**Interfaces:**
- Consumes: `DataDirLock`, `app_state.init_db`, service `stop()` hooks.
- Produces: module-level `data_lock: DataDirLock` in `backend/main.py`; a `quiesce_writers()` coroutine that awaits every service `stop()` then returns.

- [ ] **Step 1: Write the failing test** (unit-level barrier: quiesce must complete before release, and a post-release write flag must be false)

```python
# backend/tests/test_shutdown_write_barrier.py
import asyncio

import backend.main as m


def test_quiesce_stops_all_writers(monkeypatch):
    stopped = []

    async def fake_stop(name):
        await asyncio.sleep(0)   # simulate drain
        stopped.append(name)

    monkeypatch.setattr(m, "_writer_stops", [
        lambda: fake_stop("sync"),
        lambda: fake_stop("blog"),
        lambda: fake_stop("search"),
    ])
    asyncio.run(m.quiesce_writers())
    assert set(stopped) == {"sync", "blog", "search"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_shutdown_write_barrier.py -q`
Expected: FAIL — `quiesce_writers` / `_writer_stops` missing.

- [ ] **Step 3: Write minimal implementation** (in `backend/main.py`)

```python
# near other imports
from pathlib import Path
from backend.services import app_state
from backend.services.data_lock import DataDirLock
from backend.services.platform import get_app_data_dir

data_lock = DataDirLock(get_app_data_dir() / ".write.lock")

# Registry of writer-stop thunks (each returns an awaitable). Services register
# their real stop() during startup; kept indirection so it is unit-testable.
_writer_stops: list = []

async def quiesce_writers() -> None:
    """Stop and drain every data-dir writer. Returns only once none can write."""
    for make in list(_writer_stops):
        try:
            await make()
        except Exception:
            logger.warning("writer stop failed", exc_info=True)
```

Wire into the existing lifespan (extend, don't duplicate): after startup, `app_state.init_db()` then `data_lock.acquire(timeout=10.0)` in a background thread so the server/UI never blocks; register each service's `stop` into `_writer_stops`. On shutdown, in this exact order: `await quiesce_writers()` → run final synchronous writes (window geometry is saved in `desktop.py`, already before exit) → `data_lock.release()`.

Standardize each service `stop()` (e.g. `sync_service`): set a `_stopping` flag, cancel the run task, `await` its unwind, ensure any in-flight atomic write finished. Most services already cancel on shutdown — this task makes the stop awaitable and registered.

- [ ] **Step 4: Run tests to verify they pass** (unit barrier + full backend suite)

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_shutdown_write_barrier.py -q && .venv/Scripts/python.exe -m pytest -q`
Expected: PASS; full suite still green (only known clipboard env-fail).

- [ ] **Step 5: Commit**

```bash
git add backend/main.py backend/services/sync_service.py backend/services/blog_service.py backend/services/search_service.py backend/tests/test_shutdown_write_barrier.py
git commit -m "feat(shutdown): acquire write lock; quiesce+drain writers before release"
```

---

### Task 5: Remove `.port` reuse (ephemeral port)

**Files:**
- Modify: `desktop.py` — replace `create_server_socket` body with a bare ephemeral bind; delete `_port_is_active`, `_get_port_file`, and the `.port` read/write. Keep `SO_REUSEADDR` (TIME_WAIT friendliness).
- Test: `backend/tests/test_desktop_port.py` (import-guarded — `desktop.py` imports `webview`; test only the socket helper via monkeypatch, or skip if webview absent).

**Interfaces:**
- Produces: `create_server_socket() -> tuple[int, socket.socket]` binding `HOST:0`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_desktop_port.py
import importlib.util
import socket

import pytest

pytest.importorskip("webview")  # desktop.py needs the GUI backend to import
import desktop  # noqa: E402


def test_create_server_socket_binds_ephemeral():
    port, sock = desktop.create_server_socket()
    try:
        assert 1024 < port < 65536
        assert sock.getsockname()[1] == port
    finally:
        sock.close()


def test_no_dot_port_helpers():
    assert not hasattr(desktop, "_port_is_active")
    assert not hasattr(desktop, "_get_port_file")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_desktop_port.py -q`
Expected: FAIL — `_port_is_active` still exists (or skipped if no webview; then verify manually on Windows build).

- [ ] **Step 3: Write minimal implementation** (replace `create_server_socket`)

```python
def create_server_socket() -> tuple:
    """Bind an ephemeral loopback port. State is backend-persisted, so the port
    is no longer sticky (the old .port-reuse heuristic caused a close->reopen
    race that shifted the origin and reset localStorage)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, 0))
    return sock.getsockname()[1], sock
```

Delete `_get_port_file`, `_port_is_active`, and any `.port` references.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest backend/tests/test_desktop_port.py -q`
Expected: PASS (or skipped on Linux — then rely on the Windows build test).

- [ ] **Step 5: Commit**

```bash
git add desktop.py backend/tests/test_desktop_port.py
git commit -m "refactor(desktop): drop sticky .port reuse; bind ephemeral port"
```

---

### Task 6: Frontend `persisted` layer + prefs hydration

**Files:**
- Create: `frontend/src/core/persistence/appStateApi.ts`
- Create: `frontend/src/core/persistence/persisted.ts`
- Modify: the app's startup/loading path to `await persisted.hydratePrefs()` before first render of gated UI (follow the existing config-fetch/loading gate in `App.tsx`).
- Test: `frontend/src/core/persistence/persisted.test.ts`

**Interfaces:**
- Produces:
  - `appStateApi`: `getPrefs()`, `patchPrefs(p)`, `getConversation(path)`, `patchConversation(path, p)`, `getTranslations(keys)`, `patchTranslations(items)`, `getMigrated()`, `postMigrate(dump)`.
  - `persisted`: `hydratePrefs(): Promise<void>`; `getPref<T>(key, fallback): T` (sync, from hydrated cache); `setPref(key, value): void` (memory + debounced PATCH); `getConversation(path)`, `setConversation(path, patch)`; translation cache `getTranslations`, `putTranslations`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/core/persistence/persisted.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './appStateApi';
import { persisted } from './persisted';

beforeEach(() => vi.restoreAllMocks());

describe('persisted prefs', () => {
  it('hydrates then serves sync reads', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({ language: 'ja' });
    await persisted.hydratePrefs();
    expect(persisted.getPref('language', 'en')).toBe('ja');
    expect(persisted.getPref('missing', 'def')).toBe('def');
  });

  it('setPref updates memory immediately and PATCHes backend', async () => {
    vi.spyOn(api, 'getPrefs').mockResolvedValue({});
    const patch = vi.spyOn(api, 'patchPrefs').mockResolvedValue(undefined as never);
    await persisted.hydratePrefs();
    persisted.setPref('language', 'yue');
    expect(persisted.getPref('language', 'en')).toBe('yue'); // sync
    await vi.waitFor(() => expect(patch).toHaveBeenCalledWith({ language: 'yue' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/persistence/persisted.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/core/persistence/appStateApi.ts
const BASE = '/api/app-state';
async function j<T>(r: Response): Promise<T> { return r.json() as Promise<T>; }
export const getPrefs = () => fetch(`${BASE}/prefs`).then(j<Record<string, unknown>>);
export const patchPrefs = (p: Record<string, unknown>) =>
  fetch(`${BASE}/prefs`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(() => undefined);
export const getConversation = (path: string) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`).then(j<Record<string, unknown>>);
export const patchConversation = (path: string, p: Record<string, unknown>) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(() => undefined);
export const getTranslations = (keys: string[]) =>
  fetch(`${BASE}/translations?keys=${keys.map(encodeURIComponent).join(',')}`).then(j<Record<string, string>>);
export const patchTranslations = (items: Record<string, string>) =>
  fetch(`${BASE}/translations`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) }).then(() => undefined);
export const getMigrated = () => fetch(`${BASE}/migrate`).then(j<{ migrated: boolean }>);
export const postMigrate = (dump: unknown) =>
  fetch(`${BASE}/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dump) }).then(() => undefined);
```

```ts
// frontend/src/core/persistence/persisted.ts
import * as api from './appStateApi';

let prefs: Record<string, unknown> = {};
const pending: Record<string, unknown> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const patch = { ...pending };
  for (const k of Object.keys(pending)) delete pending[k];
  api.patchPrefs(patch).catch(() => {/* logged; retried on next set */});
}

export const persisted = {
  async hydratePrefs(): Promise<void> {
    try { prefs = await api.getPrefs(); } catch { prefs = {}; }
  },
  getPref<T>(key: string, fallback: T): T {
    return (key in prefs ? (prefs[key] as T) : fallback);
  },
  setPref(key: string, value: unknown): void {
    prefs[key] = value; pending[key] = value;
    if (!flushTimer) flushTimer = setTimeout(flush, 300);
  },
  getConversation: api.getConversation,
  setConversation: api.patchConversation,
  getTranslations: api.getTranslations,
  putTranslations: api.patchTranslations,
};
```

Then in `App.tsx`'s startup loading path, `await persisted.hydratePrefs()` before rendering the ToS gate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/persistence/persisted.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/persistence/ frontend/src/shell/App.tsx
git commit -m "feat(persist): backend-backed persisted layer + prefs hydration"
```

---

### Task 7: One-time migration (localStorage → backend)

**Files:**
- Modify: `frontend/src/core/persistence/persisted.ts` — add `migrateOnce()`.
- Modify: startup path — call `await persisted.migrateOnce()` right after `hydratePrefs()` and before gating.
- Test: `frontend/src/core/persistence/persisted.migrate.test.ts`

**Interfaces:**
- Produces: `persisted.migrateOnce(): Promise<void>` — if backend `getMigrated()` is false, collect known localStorage keys into a dump and `postMigrate`, then re-hydrate.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/core/persistence/persisted.migrate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as api from './appStateApi';
import { persisted } from './persisted';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('migrates known localStorage keys once', async () => {
  localStorage.setItem('tos_accepted_at', '2026-01-01T00:00:00Z');
  localStorage.setItem('sakadesk-language', 'ja');
  vi.spyOn(api, 'getMigrated').mockResolvedValue({ migrated: false });
  const post = vi.spyOn(api, 'postMigrate').mockResolvedValue(undefined as never);
  vi.spyOn(api, 'getPrefs').mockResolvedValue({});
  await persisted.migrateOnce();
  expect(post).toHaveBeenCalledTimes(1);
  const dump = post.mock.calls[0][0] as any;
  expect(dump.prefs.tos_accepted_at).toBe('2026-01-01T00:00:00Z');
  expect(dump.prefs.language).toBe('ja');
});

it('does nothing if already migrated', async () => {
  vi.spyOn(api, 'getMigrated').mockResolvedValue({ migrated: true });
  const post = vi.spyOn(api, 'postMigrate').mockResolvedValue(undefined as never);
  await persisted.migrateOnce();
  expect(post).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/persistence/persisted.migrate.test.ts`
Expected: FAIL — `migrateOnce` missing.

- [ ] **Step 3: Write minimal implementation** (append to `persisted.ts`)

```ts
export async function migrateOnce(): Promise<void> {
  const { migrated } = await api.getMigrated();
  if (migrated) return;
  const prefs: Record<string, unknown> = {};
  const map: Record<string, string> = {
    tos_accepted_at: 'tos_accepted_at',
    'sakadesk-language': 'language',
    sakadesk_dismissed_update: 'dismissed_update',
  };
  for (const [ls, key] of Object.entries(map)) {
    const v = localStorage.getItem(ls);
    if (v !== null) prefs[key] = v;
  }
  const conversations: Record<string, unknown> = {};
  const translations: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    const v = localStorage.getItem(k)!;
    if (k.startsWith('read_state_')) conversations[k.slice('read_state_'.length)] = { ...(conversations[k.slice(11)] as object || {}), read_state: JSON.parse(v) };
    else if (k.startsWith('sakadesk_scroll_')) conversations[k.slice('sakadesk_scroll_'.length)] = { ...(conversations[k.slice(16)] as object || {}), scroll_msg_id: Number(v) };
    else if (k.startsWith('bg_settings_')) conversations[k.slice('bg_settings_'.length)] = { ...(conversations[k.slice(12)] as object || {}), background: JSON.parse(v) };
    else if (k.startsWith('translation:message:')) translations[k.slice('translation:message:'.length)] = v;
  }
  await api.postMigrate({ prefs, conversations, translations });
  await (persisted as any).hydratePrefs();
}
// add `migrateOnce` to the exported `persisted` object.
```

(Attach `migrateOnce` to the `persisted` export.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/persistence/persisted.migrate.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/persistence/persisted.ts frontend/src/shell/App.tsx frontend/src/core/persistence/persisted.migrate.test.ts
git commit -m "feat(persist): one-time localStorage -> backend migration"
```

---

### Task 8: Swap call sites off `localStorage`

Do these as **separate commits**, one category per commit, each keeping `tsc` + `vitest` green. For every site: replace `localStorage.getItem/setItem(<key>)` with the matching `persisted` call, preserving existing debounce/immediate-flush logic.

**8a — ToS** (`shell/App.tsx:166-173`, `shell/components/TosDialog.tsx:20`): read `persisted.getPref('tos_accepted_at', null)`; on accept `persisted.setPref('tos_accepted_at', new Date().toISOString())`. Update `shell/App.integration.test.tsx` mock to stub `persisted.getPref`.

**8b — Language** (`i18n/index.ts`): initialize from `persisted.getPref('language', <detect>)`; on change `persisted.setPref('language', lang)`. (Backend `settings.json.language` stays as-is; app-state prefs is now the UI source.)

**8c — Read state** (`features/messages/MessagesFeature.tsx:447-456`, `MemberList.tsx:84`): read `await persisted.getConversation(path)` → `.read_state`; write `persisted.setConversation(path, { read_state })`.

**8d — Scroll** (`features/messages/hooks/useChatScroll.ts:49,79`, `BlogReader.tsx`): in `saveToStorage`, replace `localStorage.setItem(key, id)` with `persisted.setConversation(path, { scroll_msg_id: id })` — **keep the existing 500ms debounce + savePositionImmediate**; restore reads `persisted.getConversation(path).scroll_msg_id`.

**8e — Background** (`core/modals/BackgroundModal.tsx:98`, `utils/backgroundSettings.ts`): via `persisted.getConversation/setConversation` `.background`.

**8f — Translation cache** (`hooks/useMessageTranslation.ts` — 7 sites): batch reads via `persisted.getTranslations(keys)`, writes via `persisted.putTranslations(items)`; `clearTranslationCache` PATCHes an empty/clear (or a dedicated clear endpoint if added).

**8g — Misc prefs** (volume `core/media/useAmplifiedVolume.ts`, dismissed-update `core/layout/UpgradeIcon.tsx`): `persisted.getPref/setPref`.

For each 8x: **Step A** update the site; **Step B** run `npx tsc --noEmit && npx vitest run <touched test>`; **Step C** commit `refactor(persist): move <category> to backend app-state`.

Leave `DEBUG_AUTH`/`DEBUG_SYNC` and any purely-ephemeral UI keys in `localStorage`.

---

### Task 9: Integration — reopen keeps state; full gate

**Files:**
- Test: `backend/tests/test_app_state_integration.py` + a manual checklist.

- [ ] **Step 1: Automated** — round-trip through the API that a prefs value written by "instance A" is readable by a fresh store handle "instance B" pointed at the same db (simulates reopen on a new port):

```python
def test_reopen_sees_prior_state(client, tmp_path):
    from backend.services import app_state
    app_state.set_db_path(tmp_path / "app_state.db"); app_state.init_db()
    client.patch("/api/app-state/prefs", json={"tos_accepted_at": "t"})
    app_state.set_db_path(tmp_path / "app_state.db")  # "reopen"
    assert app_state.get_prefs()["tos_accepted_at"] == "t"
```

- [ ] **Step 2: Full gate** — `.venv/Scripts/python.exe -m pytest -q` (only known clipboard fail), `ruff check backend/`, `ruff format --check backend/`, `mypy backend/`, and `npx tsc --noEmit && npm run test:run` in `frontend/`. All green.

- [ ] **Step 3: Manual (Windows build)** — build installer; accept ToS, scroll a room, switch language; **close and immediately reopen**; confirm ToS not shown, scroll/read/language intact, and `.port` may differ. Confirm sync resumes within ~2s (background write-lock handoff).

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_app_state_integration.py
git commit -m "test(app-state): reopen keeps state; integration"
```

---

## Self-Review

- **Spec coverage:** store→Task 2; endpoints→Task 3; frontend layer+hydration→Task 6; migration→Task 7; call-site moves (all categories incl. scroll)→Task 8; write lock + ordered shutdown (no-write-after-release)→Tasks 1 & 4; `.port` removal→Task 5; reopen-keeps-state→Task 9. SQLite + reuse-debounce decisions reflected in Tasks 2 & 8d.
- **Placeholder scan:** none — code shown in each code step; Task 8 shows the uniform swap pattern + exact sites (DRY).
- **Type consistency:** `persisted.getPref/setPref/getConversation/setConversation/getTranslations/putTranslations/hydratePrefs/migrateOnce` used identically across Tasks 6–8; backend `app_state` signatures match Tasks 2/3.

## Notes / risks

- Read-state migration heuristic assumes `read_state_${path}` maps 1:1 to a conversation path — verify the exact key shape when doing 8c and adjust the slice.
- `desktop.py` can't run under pytest without `webview`; Task 5's test skips on Linux — the Windows manual build is the real gate for the shell wiring (Tasks 4/5).
- Keep each 8x commit independently green so a reviewer can bisect a regression to one category.
