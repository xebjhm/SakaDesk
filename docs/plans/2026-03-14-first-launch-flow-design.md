# First-Launch Flow Redesign + Adaptive Concurrency

**Date**: 2026-03-14
**Status**: Approved

## Problem

Three issues discovered during fresh-install testing:

1. **Network saturation kills OAuth login**: Blog backup and message sync fire concurrently before/during login. 20+ concurrent connections saturate the network, causing Playwright's OAuth browser to fail loading pages. Only affects the 2nd+ service login (1st service succeeds before sync starts).

2. **No sequencing**: Blog backup starts before any auth happens. Message sync fires for all services concurrently. Fresh sync blocking dialog doesn't appear.

3. **Fixed concurrency ignores user environment**: All users get the same 20-connection blast regardless of RAM or network conditions. A 4GB laptop on hotel WiFi gets the same treatment as a 16GB desktop on fiber.

## Root Cause (from debug log analysis)

```
08:09:19  Blog backup starts (before any login!)
08:10:35  User completes hinatazaka login
08:10:35  Message sync fires: 20 TCP + 20 media downloads = 40 concurrent requests
08:10:36  User tries nogizaka login → Playwright can't load OAuth page → timeout → "Login failed"
```

---

## Design: First-Launch Flow

### Sequence

```
1. Landing Page
   └─ User selects which services to use

2. Login Carousel (sequential)
   └─ For each selected service:
      ├─ Show LoginModal (OAuth via Playwright popup)
      ├─ User completes login OR clicks "Maybe Later" to skip
      └─ Next service

3. Setup Wizard
   ├─ Choose output folder (Documents/HakoDesk default)
   └─ Toggle blog backup on/off

   *** ZERO network activity before this point ***

4. Blocking SyncModal — Message Sync (sequential)
   ├─ Service 1: metadata → media download → complete
   ├─ Service 2: metadata → media download → complete
   └─ Service 3: metadata → media download → complete
   Uses existing startSequentialSync() + SyncModal multi-service UI

5. Modal closes → Main layout unlocked
   └─ User can browse messages immediately

6. Background Blog Sync (non-blocking, sequential)
   └─ Low-concurrency blog backup runs in background
   └─ User can browse blogs on-demand while backup runs
```

### Key Rules

- **Zero network before step 4**: No blog backup, no sync, no API calls until auth + setup complete.
- **Sequential message sync**: One service at a time. Uses existing `startSequentialSync()` and `SyncModal` multi-service counter UI ("日向坂46 (1/3)").
- **Blog sync is always non-blocking**: Blog browsing is on-demand (fetches from public API or local cache). Background backup only populates the cache for offline access. Even blog-only users (no message accounts) don't need blocking blog sync.
- **"Maybe Later" for login**: Each service login is optional. Users can skip and login later from settings.

### Existing Infrastructure (already implemented, needs wiring)

| Component | Status | Location |
|-----------|--------|----------|
| `startSequentialSync(services[])` | Fully implemented, **never called** | `useSync.ts` |
| `SequentialSyncInfo` type | Exists | `useSync.ts` |
| SyncModal multi-service counter | Exists | `SyncModal.tsx` |
| Per-service progress tracking | Exists (frontend + backend) | `useSync.ts`, `sync_service.py` |
| LoginModal with skip | Exists | `LoginModal.tsx` |

### Bug Fixes Required

1. **Blog backup starts before auth**: The startup effect in App.tsx (or equivalent) triggers blog backup immediately. Must gate behind "setup complete" flag.
2. **Yodel blog backup error**: `Unsupported group: Group.YODEL` — Yodel doesn't have blog support. Blog backup should skip yodel gracefully.
3. **Fresh sync blocking dialog not appearing**: Timing issue in startup sync effect. The new sequential flow fixes this by design.

---

## Design: Adaptive Concurrency

### Architecture

One global connection pool with priority queues and adaptive sizing.
All HTTP requests across the entire app go through this single pool.

```
                    Global AdaptivePool
                    ┌──────────────────────────┐
                    │  Pool size: adaptive      │
                    │  Start: 5, Ceiling: 20    │
                    │  AIMD adjusts based on RTT│
                    └──────────┬───────────────┘
                               │
                         slot freed
                               │
                    ┌──────────▼───────────────┐
                    │   HIGH queue waiting?     │
                    │   ├─ YES → give to HIGH   │
                    │   └─ NO  → LOW queue?     │
                    │          ├─ YES → give LOW │
                    │          └─ NO  → return   │
                    └──────────────────────────┘

HIGH = message sync (metadata + media download)
LOW  = blog backup (metadata + content + images)
```

### Key Design Decisions

**One pool, one ceiling (20)**: The ceiling prevents runaway connections regardless
of operation type. The adaptive gradient finds the right operating point for the
current network. No per-operation-type ceilings — the pool handles everything.

**Per-HTTP-request granularity**: The pool slot is held for one HTTP request
(~100ms-1s), not for an entire logical operation (up to 90s). This ensures
high-priority requests wait at most one HTTP request duration for a slot.

**No hardware detection**: Payloads are small (photos ~100KB-2MB, metadata ~KB).
Even 20 concurrent downloads buffer only ~40MB in RAM. The real bottleneck is
network bandwidth, which the adaptive gradient measures directly.

### Why Per-HTTP-Request Granularity

Current code holds semaphore slots for entire logical operations:

| Operation | Current slot hold time |
|-----------|----------------------|
| Message metadata (per member) | Up to 2 min (unbounded pagination) |
| Media download (per file) | Up to 2 min (large videos) |
| Blog metadata (per member) | Up to 90s (100 pages + detail fetches) |
| Blog content (per blog) | Up to 40s (HTML + all images) |

With coarse holds, a high-priority request must wait for a long-running
low-priority operation to finish. Per-HTTP-request granularity caps wait
time to ~100ms-1s (one HTTP round-trip).

### PooledSession: Per-Request Pool Integration

Wrap `aiohttp.ClientSession` to auto-acquire/release per HTTP request:

```python
class PooledSession:
    """aiohttp session wrapper — acquires pool slot per HTTP request."""

    def __init__(self, session: aiohttp.ClientSession,
                 pool: AdaptivePool, priority: str = 'low'):
        self._session = session
        self._pool = pool
        self._priority = priority

    @asynccontextmanager
    async def get(self, url, **kwargs):
        start = await self._pool.acquire(self._priority)
        try:
            async with self._session.get(url, **kwargs) as resp:
                yield resp
        finally:
            self._pool.release(start)

    @asynccontextmanager
    async def post(self, url, **kwargs):
        start = await self._pool.acquire(self._priority)
        try:
            async with self._session.post(url, **kwargs) as resp:
                yield resp
        finally:
            self._pool.release(start)
```

Usage — sync code passes `PooledSession` instead of raw session:

```python
# sync_service.py — message sync (high priority)
pooled = PooledSession(raw_session, pool, priority='high')
await manager.sync_member(pooled, group, member, ...)

# blog_service.py — blog backup (low priority)
pooled = PooledSession(raw_session, pool, priority='low')
await scraper.get_blogs_metadata(pooled, member_id, ...)
```

### AdaptivePool: Global Pool with Priority + AIMD

```python
class AdaptivePool:
    """
    Global connection pool with priority queues and adaptive sizing.

    Uses AIMD (Additive Increase, Multiplicative Decrease) inspired by
    Netflix's Gradient algorithm and TCP congestion control:
    - Starts conservative (start=5)
    - Measures HTTP request RTTs (rolling window of 50)
    - gradient = min_rtt / p90_rtt
    - gradient >= 0.9 → increase pool by 1 (additive)
    - gradient < 0.7  → decrease pool by 10% (multiplicative)
    - Never exceeds ceiling (20)

    Priority queues ensure HIGH requests (message sync) always get
    the next available slot before LOW requests (blog backup).
    """

    def __init__(self, start: int = 5, ceiling: int = 20):
        self._ceiling = ceiling
        self._pool_size = start
        self._in_use = 0
        self._high_queue: deque[asyncio.Future] = deque()
        self._low_queue: deque[asyncio.Future] = deque()

        # AIMD state
        self._rtts: deque[float] = deque(maxlen=50)
        self._min_rtt: float | None = None
        self._min_rtt_reset_at: float = 0

    async def acquire(self, priority: str = 'low') -> float:
        if self._in_use < self._pool_size:
            self._in_use += 1
            return time.monotonic()

        # Pool full — wait in priority queue
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        if priority == 'high':
            self._high_queue.append(future)
        else:
            self._low_queue.append(future)
        await future
        return time.monotonic()

    def release(self, start_time: float):
        rtt = time.monotonic() - start_time
        self._rtts.append(rtt)
        self._maybe_resize()

        # Give slot to next waiter: HIGH first, then LOW
        if self._high_queue:
            future = self._high_queue.popleft()
            if not future.done():
                future.set_result(None)
        elif self._low_queue:
            future = self._low_queue.popleft()
            if not future.done():
                future.set_result(None)
        else:
            self._in_use -= 1

    def _maybe_resize(self):
        if len(self._rtts) < 10:
            return

        now = time.monotonic()
        if self._min_rtt is None or now > self._min_rtt_reset_at:
            self._min_rtt = min(self._rtts)
            self._min_rtt_reset_at = now + 60

        sorted_rtts = sorted(self._rtts)
        p90_rtt = sorted_rtts[int(len(sorted_rtts) * 0.9)]
        gradient = self._min_rtt / p90_rtt if p90_rtt > 0 else 1.0

        if gradient >= 0.9:
            self._pool_size = min(self._pool_size + 1, self._ceiling)
        elif gradient < 0.7:
            self._pool_size = max(int(self._pool_size * 0.9), 1)
```

### What Gets Removed

All existing application-level semaphores are replaced by the single global pool:

| Removed | Was |
|---------|-----|
| `sync_service.py` member sync semaphore | `Semaphore(20\|5)` |
| `sync_service.py` "Smart Concurrency" logic | Fresh/incremental detection |
| `manager.py` media download semaphore | `Semaphore(concurrency)` |
| `blog_service.py` metadata sync semaphore | `Semaphore(20\|5)` |
| `blog_service.py` content download semaphore | `Semaphore(20\|5)` |
| `blog_service.py` per-blog image semaphore | `Semaphore(5)` per call (BUG: not global) |
| `config.py` fresh/incremental constants | `MEDIA_DOWNLOAD_CONCURRENCY_*` |
| `blog/config.py` fresh/incremental constants | `SYNC_CONCURRENCY_*`, `DOWNLOAD_CONCURRENCY_*` |

The `aiohttp.TCPConnector(limit=20)` stays as a safety net at the HTTP layer,
but the pool manages the actual adaptive limit + priority above it.

### How Priority Resolves Contention

```
Scenario: Blog sync using 15 slots, incremental message sync fires

1. Pool at 15/15 (all LOW blog requests)
2. HIGH message request arrives → waits in HIGH queue
3. Next blog request finishes → slot freed
4. Pool checks: HIGH queue has waiter → gives slot to message sync
5. Blog requests keep finishing → each freed slot goes to HIGH first
6. Message sync gets rapid access, blog sync slows naturally
7. Message sync finishes → all freed slots go back to LOW
8. Blog sync resumes at full speed
```

HIGH never waits more than one HTTP request duration (~100ms-1s) for a slot.

### Fresh vs Incremental

The adaptive pool eliminates the need for separate fresh/incremental constants:

- **Fresh sync**: Pool starts at 5, ramps up based on RTT. Fast network → reaches 20. Slow → stays low.
- **Incremental sync**: Same pool. If blog sync is running, priority ensures message sync gets slots first.

The only remaining difference: **fresh sync is blocking** (SyncModal visible), **incremental is background** (no modal).

---

## Design: Search Index

### Placement in First-Launch Flow

Search indexing runs per-service, immediately after that service's sync completes.
Same code path for both fresh and incremental — no branching.

```
4. Blocking SyncModal — Message Sync (sequential)
   ├─ Service 1: metadata → media → indexing → complete
   ├─ Service 2: metadata → media → indexing → complete
   └─ Service 3: metadata → media → indexing → complete

   "Indexing" is a visible sub-stage in the SyncModal UI per service.
   Message search is fully ready when modal closes.

5. Modal closes → Main layout unlocked
   └─ Message search works immediately (all messages indexed)

6. Background Blog Sync (non-blocking, sequential)
   └─ Per service: metadata → content → indexing → complete
   └─ Blog search results grow as each service finishes
```

`sync_service.py` already calls `search_svc.index_members()` after message sync
and `search_svc.index_blogs_for_service()` after blog content download. Same
per-service pattern for fresh and incremental — no special-casing needed.

### Search Modal Notices

Three states when searching blog content:

| State | Condition | Notice |
|-------|-----------|--------|
| **A** Backup OFF | `(blogs \|\| all) && !blogBackupEnabled` | Existing: "Blog search only covers cached posts." |
| **B** Backup in progress | `(blogs \|\| all) && blogBackupEnabled && blogSyncInProgress` | New: "Blog backup in progress — search results may be incomplete" |
| **C** Backup complete | `(blogs \|\| all) && blogBackupEnabled && !blogSyncInProgress` | No notice |

Both notices share the same visibility gate: only when `contentType` includes blogs.
State A and B are mutually exclusive. Same amber banner style, same location in
`SearchFilterBar.tsx`. State B auto-disappears when blog sync finishes (polled via
existing sync status endpoint).

### Reader-Writer Separation (search_service.py)

**Problem**: Single-threaded executor (`max_workers=1`) means any long-running
write (full index build, blog indexing) blocks all reads (search queries, member
lists). Current code has ad-hoc workarounds (`_get_members_readonly`).

**Solution**: Two executors, leveraging SQLite WAL's concurrent read support.

```python
# Writer executor — single-threaded (SQLite allows one writer)
self._write_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="search-write")
# Handles: build_full_index, index_members, index_blogs_for_service,
#          upsert_read_states, rebuild

# Reader executor — single-threaded (reads are fast, <100ms)
self._read_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="search-read")
# Handles: search, get_members, get_status, get_all_read_states

# Separate connections (same DB file, both WAL mode)
self._write_conn: sqlite3.Connection  # used by write executor only
self._read_conn: sqlite3.Connection   # used by read executor only
```

**Why this works**:
- SQLite WAL allows one writer + multiple concurrent readers at the DB level
- Writer executor stays single-threaded (only one write at a time)
- Reader executor uses its own connection, never blocks behind writes
- Reads always return whatever's committed so far (partial results during build)

**What gets removed**:
- `_get_members_readonly()` workaround (line 1931)
- `_building` check gating `search()` to return empty results (line 2070)
- Ad-hoc read-only connection creation

**What stays**:
- `_building` flag — still needed for frontend "Building index" banner
- Failsafe build trigger on first search (but search returns partial results
  instead of empty)

---

## Implementation Order

### Phase 1: First-Launch Flow (frontend-heavy)
1. Gate all network activity behind "setup complete" flag
2. Wire up login carousel (sequential, per-service)
3. Wire up `startSequentialSync()` (already implemented)
4. Fix: skip yodel in blog backup
5. Fix: blog backup waits for setup complete

### Phase 2: AdaptivePool + PooledSession (backend + SDK)
1. Implement `AdaptivePool` class (global pool with priority + AIMD)
2. Implement `PooledSession` wrapper (per-request acquire/release)
3. Update `PyHako` SDK: `client.py`, `manager.py` to accept session interface
4. Update `PyHako` blog scrapers to accept session interface
5. Update `sync_service.py`: remove semaphores, create PooledSession(priority='high')
6. Update `blog_service.py`: remove all semaphores (member, content, image), create PooledSession(priority='low')
7. Remove fresh/incremental concurrency constants from config files
8. Set `aiohttp.TCPConnector(limit=20)` as safety net
9. Add pool logging (debug level): acquire wait time, pool size changes, gradient

### Phase 3: Search Index Reader-Writer Separation
1. Split `search_service.py` single executor into `_write_executor` + `_read_executor`
2. Add `_read_conn` (separate SQLite connection, WAL mode)
3. Route read methods (`search`, `get_members`, `get_status`, `get_all_read_states`) to `_read_executor`
4. Remove `_get_members_readonly()` workaround
5. Remove `_building` gate in `search()` — return partial results instead of empty
6. Add blog-sync-in-progress notice to `SearchFilterBar.tsx`
7. Add i18n keys for new notice text

### Phase 4: Testing
1. Test fresh sync with all 4 services
2. Test blog sync + incremental message sync contention
3. Test login flow with network-heavy background activity
4. Verify adaptive ramp-up/ramp-down in debug logs
5. Verify HIGH priority preemption in logs (blog yields to message sync)
6. Test search during active index build (returns partial results, not empty)
7. Test blog-sync-in-progress notice appears/disappears correctly

---

## Files Changed Summary

### Phase 1
| File | Change |
|------|--------|
| `frontend/src/App.tsx` (or startup orchestrator) | Gate network behind setup-complete flag |
| `frontend/src/shell/hooks/useSync.ts` | Call `startSequentialSync()` instead of parallel sync |
| `frontend/src/shell/components/SyncModal.tsx` | Minor: ensure sequential UI works end-to-end |
| `backend/services/blog_service.py` | Skip yodel gracefully, respect setup-complete gate |
| `backend/main.py` or startup hooks | Add setup-complete endpoint/state |

### Phase 2
| File | Change |
|------|--------|
| `backend/services/concurrency.py` (new) | `AdaptivePool` + `PooledSession` classes |
| `backend/services/sync_service.py` | Remove semaphores, use PooledSession(priority='high') |
| `backend/services/blog_service.py` | Remove all semaphores, use PooledSession(priority='low') |
| `PyHako/src/pyhako/client.py` | Accept session interface (PooledSession compatible) |
| `PyHako/src/pyhako/manager.py` | Remove media download semaphore, use passed session |
| `PyHako/src/pyhako/blog/hinatazaka.py` | Accept session interface |
| `PyHako/src/pyhako/blog/sakurazaka.py` | Accept session interface |
| `PyHako/src/pyhako/blog/nogizaka.py` | Accept session interface |
| `PyHako/src/pyhako/config.py` | Remove `MEDIA_DOWNLOAD_CONCURRENCY_*` constants |
| `PyHako/src/pyhako/blog/config.py` | Remove `SYNC_CONCURRENCY_*`, `DOWNLOAD_CONCURRENCY_*`, `IMAGE_DOWNLOAD_CONCURRENCY` |

### Phase 3
| File | Change |
|------|--------|
| `backend/services/search_service.py` | Split to reader-writer executors, remove workarounds |
| `frontend/src/features/search/components/SearchFilterBar.tsx` | Add blog-sync-in-progress notice |
| `frontend/src/i18n/locales/*.json` | Add i18n keys for new notice |
