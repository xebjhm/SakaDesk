# Media Pipeline (0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every gallery in the app open fast, including the first time, by shipping one shared media pipeline in 0.5.0 next to Memories:
- the Memories album (`frontend/src/features/memories/album/`, about 11 s to the first grid on the Windows acceptance run, D4);
- the member blog photo gallery (`frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx`);
- the message media gallery (`frontend/src/core/media/MediaGalleryModal.tsx`, opened from `ConversationMenu`);
- the videos in all three.

**Measured baseline (read before Task M1):**
- **Album:** 11 s to the first grid; every month shows 「載入中...」 for about 7 s (`.superpowers/sdd/windows-acceptance.md`, D4 and D18).
- **Message gallery:** renders **every** photo of the room as a full-size `<img>` (`PhotoPlayer variant="gallery-thumb"`), with no thumbnail and no virtualisation. Videos mount a `<video preload=metadata>` per tile (`LazyVideo`).
- **Blog gallery:** sends one `getBlogContent` request per cached blog, and each request reloads the blog index on the server. Nothing paints until all of them settle. Then it renders every image at full size, with no virtualisation.
- **Memories video stills:** `MemoryThumb` mounts a `<video preload=metadata>` near the viewport.

**Architecture (the five agreed moves):**
1. **Pre-generated thumbnails.** A background worker (`backend/services/media_pregen.py`) runs at low priority, on one background-priority thread. It is throttled and pauses while any sync, Memories refresh, blog backup or foreground media request is active. It writes the exact cache variants that `/api/content/thumb` serves:
   - the variants are 160 and 320 for everything, plus 640 for ★ items and album covers (superseded: one pre-generated 480 for everything, see the revised rulings under "Cache budget");
   - every size comes from **one** decode of the source;
   - the route keeps a miss path only as a safety net.
2. **Video poster frames**, generated once and cached in their own bounded cache:
   - **primary:** the Windows Shell thumbnail API (`IShellItemImageFactory` via `ctypes`), run in the background worker;
   - **fallback:** a client-side frame capture (`<video>` + canvas), posted back to the backend, which re-encodes it;
   - once a poster exists, the thumbnail route serves video thumbnails from it.
3. **Placeholders.** Each media item gets a mean colour and a 16 px blur preview, stored in a cache DB (`media_meta.db`) and served in batches by `POST /api/media/meta`. A cell paints its colour and blur at once, then the image fades in.
4. **One shared grid layer** in `frontend/src/core/media/grid/`:
   - `MediaTile`: placeholder, then thumbnail, then fade-in, or a poster for a video;
   - a priority load scheduler (visible first, then near-viewport, at most 4 in flight);
   - a batched meta store;
   - `VirtualMediaGrid` (`GroupedVirtuoso` rows with sticky month headers).

   The message and blog galleries move onto `VirtualMediaGrid`. The album keeps its month-band windowing (`useAlbumWindow`, which already unmounts far bands); its tiles move onto `MediaTile` through `MemoryThumb`. See **Decision D-1**.
5. **HTTP caching.** Thumbnail URLs carry a content version `v` (a hash of size and mtime). A matching `v` gets `Cache-Control: private, max-age=31536000, immutable`, so a second open is served from the WebView2 cache. ETag and 304 stay.

**Tech Stack:** FastAPI, SQLite (stdlib), Pillow (already a dependency), `ctypes` (stdlib; no new Windows dependency), structlog; pytest + time-machine; React 18 + TS, `react-virtuoso` 4.18 (already a dependency), zustand; vitest + Testing Library. **No new dependencies.**

## Global Constraints

- **Tile sizing (acceptance r2, 2026-11-11):** column/tile maths come from the single constant module `frontend/src/core/media/tileGrid.ts` (tiles ≥ 9rem, ≤ 6 per row; ~250 px wide on wide windows). `VirtualMediaGrid`/`useGridColumns` must import it instead of the `min 112 / max 180` defaults below, and tiles pick the thumbnail variant by rendered width × DPR using `thumbWidthFor` (smallest allowed width ≥ rendered width × DPR, capped at 480 for grid tiles; ★ items and album covers pass `large` and may use 640, which the route renders on demand — it is not pre-generated, see the revised ruling under Cache budget). M9 measures the per-item estimate.

- **User decisions (2026-11-11):** cache budget ~1.4 GB total as planned (thumbs 1 GiB + posters 256 MiB) is approved. Album keeps its own layout, tiles shared (D-1). On-demand fallback stays (D-3).
- **Loading feedback is mandatory (user, 2026-11-11):** a tile waiting for its image must clearly look *loading*, never blank or frozen: the dominant-colour/blur placeholder carries a subtle shimmer/pulse (design-system motion token; static under `prefers-reduced-motion`, where a small spinner or progress indicator is used instead), and it fades into the image on load. A tile that failed shows a quiet retry state, never an empty box. Grid-level loading (first page, more pages, background pre-generation in progress) shows a visible indicator too. Every gallery task (P5–P8) must test the loading, loaded and failed states.

- **Prerequisites:**
  - `feat/memories` at or after `cc4c65ee`.
  - Another agent is fixing D4 (album first open). Before Task M1, read `.superpowers/sdd/acceptance-fix-report.md` (D4 and D18 sections) and the commits it names. Build on those changes and never revert them.
  - If D4 already warms the album views after the index build, Task M4's `warm_album` step calls that code instead of adding its own (M4, Step 3).
  - If the report does not exist yet when M1 starts, stop and ask the controller. M1–M3 do not touch album code, so they may proceed. M4 and M8 must wait for the report.
- **Binding project rules:**
  - **Logs** carry ids, codes and counts only. Never log paths, `rel_path`, file names, member or blog names, titles or text. A service id such as `hinatazaka46` is an id and is allowed.
  - **CPU and IO work runs off the event loop:** `asyncio.to_thread`, or the pre-generation worker thread. A request handler never decodes, stats in bulk or walks a directory on the loop.
  - **Untrusted image input** (archive pictures, blog images, Shell bitmaps, client-captured posters) is opened only with the Pillow `formats=` allowlist (`photo_thumb.picture_formats()`, or the narrower lists named per task), and the pixel bound is checked from the header before any decode. **No `warnings` filters** (process-wide, not thread-safe).
  - **Nothing is written to the user's archive** (`output_dir`). Caches live under `get_app_data_dir() / "cache"`, are bounded by constants, and evict (oldest or least recently used first). The Windows Shell's own `thumbcache_*.db` lives in the user's profile, is managed by Windows, and is not ours.
  - **Background generation never slows sync or the UI:**
    - one worker thread at background priority (Windows `THREAD_MODE_BACKGROUND_BEGIN`, which lowers CPU, IO and memory priority);
    - a duty cycle of at most one third of a core;
    - paused while a sync job is queued or running, a Memories refresh is pending, a blog backup runs, or a foreground media request came in during the last `IDLE_AFTER_S`;
    - stopped on shutdown (`shutdown_state`) and quiesced by a `_writer_stops` hook before `drain_background_tasks`.
  - **Design system:**
    - read `docs/design/DESIGN_SYSTEM.md` before any UI task;
    - use tokens and primitives only (`design/guard.test.ts`: no hex, rgb or hsl literals, no arbitrary values);
    - the placeholder colour is runtime data applied through `style`, the documented data-driven exception (like the album band tint);
    - the blur radius is a new token (`blur-placeholder`, Task M5).
  - **i18n:** every user-facing string goes in all 5 locales (`frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`). Task M5 adds `frontend/src/i18n/mediaPipeline.test.ts` with `MEDIA_PIPELINE_KEYS`, and each UI task appends to it. Japanese is the reference copy (given per task).
  - **Coverage:** 100% line coverage on every new backend module: `media_meta.py`, `video_poster.py`, `win_shell_thumb.py`, `low_priority.py`, `media_pregen.py`, `backend/api/media.py` and the new blog-gallery service function.
    - The only exclusions allowed are the Windows binding loaders. Each gets a one-line `# pragma: no cover - Windows binding, exercised on Windows (M9)`.
    - Everything those loaders return is exercised through injected fakes, following the precedent of `backend/services/quiet_state.py` and `test_quiet_state.py`.
  - **Windows-only path** (the Shell API and thread priority):
    - guarded by `sys.platform == "win32"`, with no `ctypes.WinDLL` access at import time;
    - tested with fakes on Linux;
    - on Linux and macOS, `available()` is `False` and the pipeline falls back cleanly: no posters from Shell, client capture instead, thread priority left unchanged.
  - **Cache sizes** are constants with a written justification (see "Cache budget" below).
- **Controller rulings (binding for this wave):**
  - **One thumbnail cache.** Pre-generated and on-demand variants are the same files: `photo_thumb.variant_name(rel_path, size, mtime_ns, width)` under `cache/photo_thumbs/`. The key's `rel_path` is the **output-dir-relative POSIX path of the resolved file**, computed by one helper (`photo_thumb.archive_rel`) that both the route and the worker use. A message picture, its album tile and its gallery tile are one file, so they share one cache entry.
  - **Pre-generation is primary; the route's miss path is a safety net.** A miss is not an error; it is logged as `photo_thumb_cache outcome=miss`. After a completed pass, the miss rate is measured in M9 (target: under 2% of tile requests). The route never blocks on a poster: no poster means 404, and the client falls back.
  - **The fallback chain never breaks a tile.**
    - Picture: `thumb?v` → `thumb` (without `v`) → full file → `onFail`.
    - Video: poster thumbnail → client capture (only while visible) → film tile → the full player on open.
  - **Saves** (download) keep `frontend/src/utils/download.ts` and the viewer's existing paths. Grids never download.
  - **WebView2 allows 6 connections per host.** The image scheduler keeps at most `MAX_IMAGE_INFLIGHT = 4` thumbnail loads in flight, so voices, video and API polls are never starved.
  - **Client-log events** are whitelisted in both `frontend/src/utils/clientLog.ts` (`ClientLogEvent`, `ClientLogFieldKey`) and `backend/api/client_log.py` (`ClientEvent`, field keys); `test_client_log_api.py` covers them. This wave adds `media_grid` and `media_poster` (Task M5).
- **Engineering:**
  - Use `uv run`, never pip. Commit with `uv run git commit` (pre-commit is only on the uv PATH). Commits follow Conventional Commits with a subject of at most 72 chars and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - File I/O is `utf-8` (text) and uses `pathlib`. No `print()`. Log through `structlog.get_logger(__name__)`. Never use `time.sleep` in async code. The worker thread's pacing is `asyncio.sleep` in the loop task. Date-dependent tests use `time-machine`.
  - Other agents commit on `feat/memories`. Before each commit, run `git pull --rebase` if the remote moved, and stage only this task's files by name (never `git add -A`).
- **WSL safety:** never run `find /` or any recursive search or scan from `/` or under `/mnt/<drive>`. Keep greps inside the repo with `timeout 60`. On the Windows side, read single known files by exact path only (`C:\D\saka-verify\...`).
- **Windows-side testing** is authorised (memory `windows-side-testing-authorized`):
  - reuse the Windows login and never log in from WSL;
  - launch the dev exe with `-WorkingDirectory` set to the exe dir;
  - the live SakaDesk may be closed to launch a test build;
  - open pages in the Windows browser with `powershell Start-Process`, never Playwright on WSLg.
- **Branch:** `feat/memories` in SakaDesk.

## Cache budget (decided; constants in code)

| Cache | Constant | Value | Holds |
|---|---|---|---|
| Thumbnails (`cache/photo_thumbs/`) | `photo_thumb.CACHE_CAP_BYTES` | **1 GiB** (was 300 MB) | WebP 480 variants (pre-generated for every item), on-demand 320 / 160 derived from the 480, on-demand 640 for `large` requests, and toast JPEGs |
| Pre-generation fill line | `media_pregen.PREGEN_FILL_RATIO` | **0.85** of the thumbnail cap (870 MiB) | the worker stops adding variants once the cache passes it (it still makes placeholders and Shell posters), so on-demand misses and toasts keep headroom and the worker never evicts what it just made |
| Eviction low water | `photo_thumb.CACHE_LOW_WATER` | **0.75** of a cap | an eviction (above the cap) trims to here, below the fill line, so the worker can add again after an eviction (hysteresis) |
| Video posters (`cache/video_posters/`) | `video_poster.POSTER_CACHE_CAP_BYTES` | **256 MiB** | one WebP of at most 640 px per video |
| Placeholder / meta rows (`cache/media_meta.db`) | `media_meta.MAX_ROWS` | **300,000** rows | colour, a 16 px blur (`BLUR_MAX_BYTES = 600`), size and poster state |

**Justification** (sizes are WebP q82 of phone photos):
- **Revised ruling (M4 fix round 1):** one pre-generated size, `PREGEN_WIDTHS = (480,)`; 640 only for ★ and covers. Grid tiles ask for the smallest allowed width ≥ rendered width × DPR, capped at 480 for non-★ tiles (★ and covers may use 640). 320 and 160 requests are rendered on demand from the cached 480 (a derived miss: no source decode). The earlier (160, 320) set, then the (320, 480) proposal, are superseded: (320, 480) roughly doubled the per-item cost.
- **Revised ruling (M9 fix wave B, D-M7):** 640 is no longer pre-generated for ★ items or covers. M9 measured covers requesting `w=320` and only 7 `w=640` requests in a whole session, so the 640 work was wasted. `ALLOWED_WIDTHS` keeps 640, so `large` requests are rendered on demand; `LARGE_WIDTH` was removed from the backend.
- **Per-size averages:** 160 px ≈ 4 KB, 320 px ≈ 11 KB, 480 px ≈ **24 KB**, 640 px ≈ 33 KB (measured in M9 on a real archive: 18,370 `-480.webp` files averaged 23.0 KB on disk, and the pass logged 24.2 KB per done item; the planning estimate was 35 KB). The default set (480) is about **24 KB per item**, so the 870 MiB fill line holds about 38k items.
- **One large service** (the acceptance run shows 13,518 album items for 日向坂46) at the default set: 14k × 24 KB ≈ **336 MB**.
- **640 px for ★ and covers:** none pre-generated (D-M7); on-demand 640 variants are rare (7 requests in the M9 session).
- **That service's blog images:** assume 15k × 24 KB ≈ **360 MB**.
- **Total:** about **0.7 GB** for one large service with its blogs, under the 870 MiB fill line. The rest of the line (≈ 200 MB, ≈ 9k items) goes to the other services. On-demand 320 / 160 derivatives of viewed tiles add a little and are evicted first when unused.
- **Several large services** do not fit completely (the M9 archive totals ≈ 63k items ≈ 1.5 GB). The worker therefore pre-generates the message media of **every** service before any blog images, the oshi service first in both rounds (D-M2), and LRU eviction removes the least recently viewed variants. Within a service the ★ and newest-months phases come first, so what users open first stays cached.
- **Posters:** at about 45 KB each, 256 MiB holds about 5,800 videos, which covers every service's videos with headroom. They get their own cap because a poster costs a Shell call or a client capture to recreate, so thumbnail churn must never evict them.
- **Meta rows** are about 400 B each: 300k rows ≈ 120 MB at worst, about 26 MB for 65k real items.
- **Worst-case total ≈ 1.4 GB**, about 2–5% of a typical archive. The Windows Explorer thumbnail cache is in the same range.
- **M9 measured the real averages** (`media_pregen_pass bytes / done`): 23–24 KB per 480 px item, 31–34% under the 35 KB estimate. This table now uses ≈ 24 KB. The budget values (1 GiB thumbnails, 0.85 fill line, 256 MiB posters) are unchanged: the user approved them (2026-11-11).

## Shared contracts (all tasks)

**Content version `v`:** `photo_thumb.version_token(size, mtime_ns) -> str` = the first 12 hex chars of `sha256(f"{size}:{mtime_ns}")`. For a video, the version is the **video's** size and mtime; its poster is derived from that video.

**Thumbnail route** (`GET /api/content/thumb/{file_path:path}?w=&v=`; existing, extended in M1 and M3):
- `w` ∈ `ALLOWED_WIDTHS = {160, 320, 480, 640}` (480 added in M4 fix round 1; `THUMB_WIDTHS` in the frontend mirrors it).
- `v` is optional.
  - `v` matches the current file → `Cache-Control: private, max-age=31536000, immutable`.
  - `v` is stale → the current variant, sent with `Cache-Control: private, no-cache`.
  - No `v` → `private, max-age=86400` (today's behaviour).
  - `ETag`, `If-None-Match` → 304, and `X-Content-Type-Options: nosniff` are unchanged in every case.
- **Videos** (M3): when a poster exists, the variant is rendered from the poster. Otherwise the route answers 404 `No thumbnail`, and the client falls back.

**New endpoints:**

| Method | Path | Body / query | Service function | Task |
|---|---|---|---|---|
| POST | `/api/media/meta` | `{"urls": [str, ...]}` (1–`META_BATCH_MAX` = 500 media-route URLs) | `media_meta.meta_for_urls` | M2 |
| PUT | `/api/media/poster/{file_path:path}` | raw `image/webp` / `image/jpeg` body, at most `POSTER_UPLOAD_MAX_BYTES` (1 MiB) | `video_poster.ingest_client` | M3 |
| GET | `/api/media/status` | — | `media_pregen.status` | M4 |
| DELETE | `/api/media/cache` | — | `media_pregen.clear_caches` | M4 |
| GET | `/api/blogs/gallery` | `service`, `member_id` | `blog_service.gallery_images` | M7 |

`/api/media/meta` response:

```json
{"items": {
  "/api/content/media/hinatazaka46/messages/…/picture/123.jpg":
    {"kind": "picture", "v": "a1b2c3d4e5f6", "color": "#a08070", "blur": "data:image/webp;base64,…",
     "w": 1440, "h": 1080, "poster": false},
  "/api/content/media/hinatazaka46/messages/…/video/124.mp4":
    {"kind": "video", "v": "0f1e2d3c4b5a", "color": "#203040", "blur": "data:…", "w": 640, "h": 360, "poster": true},
  "/api/content/media/hinatazaka46/messages/…/gone.jpg": null
}}
```

- `null` means the URL is invalid, outside the output dir, missing, or neither a picture nor a video. Each such case logs one aggregated `media_meta` breadcrumb with `invalid` / `missing` counts.
- `color`, `blur`, `w` and `h` are `null` until the worker has processed the current version of the file. `v` is always present for an existing file.
- A missing or stale row (its stat key differs from the file's) is **hinted** to the worker (`media_pregen.hint`), which moves it to the front of the queue. The request itself never decodes.
- Errors: 400 for an empty list, more than 500 URLs, or a non-list body. The response never contains an absolute path. It contains only the URLs the client sent.

`PUT /api/media/poster/...` answers:
- 201 `{"v": str}` when the poster is stored;
- 200 when a poster already exists for this version (the first one wins, so it is idempotent);
- 400 `bad_image` (undecodable, the wrong format, or over the pixel bound);
- 404 when the target is not a regular archive video;
- 413 when the body is over 1 MiB.

`GET /api/media/status`:

```json
{"state": "idle|running|paused|stopped", "paused_reason": "sync|refresh|blog_backup|foreground|budget_full|shutdown" | null,
 "services": {"hinatazaka46": {"done": 9120, "total": 13518}}, "posters": {"ready": 812, "failed": 3, "pending_client": 40},
 "cache": {"thumbs_bytes": 412000000, "posters_bytes": 31000000, "thumbs_cap": 1073741824, "posters_cap": 268435456}}
```

`DELETE /api/media/cache` → `{"freed_bytes": int}`. It pauses the worker, empties both cache dirs and `media_meta.db`, resets `photo_thumb` state, then lets the worker restart on the next idle pass.

`GET /api/blogs/gallery` → `{"images": [{"blog_id", "published_at", "title", "image_index", "media_url", "src"}]}`, newest first.
- `media_url` is the media-route URL (`/api/content/media/<service>/blogs/<member>/<date>_<id>/images/img_N.jpg`), used for thumbnails and meta.
- `src` is the existing `/api/blogs/image?...` URL, used by the viewer.

**Cache layout** (`get_app_data_dir() / "cache"`):

```
photo_thumbs/   <sha256>-<w>.webp | <sha256>-1024.jpg   (existing; cap 1 GiB)
video_posters/  <sha256(rel|size|mtime_ns)>.webp       (new; cap 256 MiB)
media_meta.db                                         (new; WAL; MAX_ROWS)
```

`media_meta.db` (a cache: a schema mismatch drops and recreates it, logging `media_meta_reset`):

```sql
CREATE TABLE IF NOT EXISTS media_meta (
  rel_path TEXT PRIMARY KEY,          -- output-relative POSIX path (never logged)
  stat_key TEXT NOT NULL,             -- "size:mtime_ns" of the source (the video for a video)
  kind TEXT NOT NULL CHECK (kind IN ('picture','video')),
  width INTEGER, height INTEGER,      -- source header size (the poster size for a video)
  rgb INTEGER,                        -- mean colour 0xRRGGBB
  blur BLOB,                          -- 16 px WebP, at most BLUR_MAX_BYTES
  status TEXT NOT NULL CHECK (status IN ('ready','failed')),
  reason TEXT,                        -- failure code: too_large|unreadable|unavailable|...
  poster TEXT CHECK (poster IN ('ready','failed','pending','none')),  -- videos only
  poster_source TEXT CHECK (poster_source IN ('shell','client')),
  updated_at INTEGER NOT NULL         -- unix seconds; row eviction order
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS media_meta_by_updated ON media_meta(updated_at);
```

**Backend log events** (ids, codes and counts only):
- `photo_thumb_cache`: `outcome=hit|miss|derived`, `width`.
- `media_meta`: `requested`, `ready`, `stale`, `missing`, `invalid`, `hinted`.
- `media_meta_reset`; `media_meta_failed`: `op`, `error_type`.
- `video_poster`: `source=shell|client`, `outcome=ready|failed|exists`, `reason`.
- `media_pregen_pass`: `service`, `phase`, `queued`, `done`, `skipped`, `failed`, `bytes`, `elapsed_ms`.
- `media_pregen_pause`: `reason`, `paused_ms`.
- `media_pregen_state`: `state`.
- `media_pregen_item_failed` (debug): `kind`, `reason`, `error_type`.

**Client events** (Task M5):
- `media_grid`: `grid=album|messages|blogs`, `first_tile_ms`, `visible`, `count`, `reason?` (`meta_failed`).
- `media_poster`: `outcome=captured|failed|skipped`, `reason=timeout|decode|upload|limit`.

**Frontend shared layer** (`frontend/src/core/media/grid/`):

```ts
// mediaMeta.ts
export interface MediaMeta { kind: 'picture' | 'video'; v: string; color: string | null; blur: string | null;
                             w: number | null; h: number | null; poster: boolean }
export const META_BATCH_MAX = 200;          // client batch (the server allows 500)
export const META_CACHE_MAX = 20_000;       // LRU entries
export function useMediaMeta(url: string | null | undefined): MediaMeta | null | undefined; // undefined = loading
export function primeMediaMeta(urls: readonly (string | null | undefined)[]): void;
export function invalidateMediaMeta(url: string): void;

// loadScheduler.ts
export type LoadPriority = 'visible' | 'near';
export const MAX_IMAGE_INFLIGHT = 4;
export const READY_CACHE_MAX = 3_000;        // srcs known decoded this session (skip the queue)
export interface LoadTicket { setPriority(p: LoadPriority): void; cancel(): void }
export function scheduleImage(src: string, priority: LoadPriority, onReady: () => void, onError: () => void): LoadTicket;

// MediaTile.tsx
export interface MediaTileProps { url: string | null | undefined; kind: 'picture' | 'video'; cssPx: number;
  className?: string; eager?: boolean; capturePoster?: boolean; onFail?: () => void; testId?: string }

// VirtualMediaGrid.tsx
export interface MediaGridGroup<T> { key: string; label: string; items: T[] }
export interface VirtualMediaGridHandle { scrollToGroup(key: string): void; scrollToItem(flatIndex: number): void }
export interface VirtualMediaGridProps<T> { groups: MediaGridGroup<T>[]; itemKey(item: T): string;
  mediaUrl(item: T): string | null | undefined;
  renderTile(item: T, flatIndex: number, tilePx: number): React.ReactNode;
  scrollParent: HTMLElement | null; grid: 'messages' | 'blogs';
  minTilePx?: number /* from tileGrid.ts */; maxTilePx?: number /* from tileGrid.ts */; gapPx?: number /* from tileGrid.ts */ }
```

`thumbnailUrl(url, width, v?)` in `features/messages/mediaUrl.ts` gains an optional `v` and appends `&v=` when it is given.

---

### Task M1: Thumbnail core: one decode for every size, derived misses, content-addressed URLs

**Files:**
- Modify: `backend/services/photo_thumb.py`
  - Raise `CACHE_CAP_BYTES` to `1 * 1024**3`, with the justification comment pointing at this plan's budget table.
  - Add `PREGEN_WIDTHS: tuple[int, ...] = (160, 320)` and `LARGE_WIDTH = 640`.
  - Add `version_token(size, mtime_ns) -> str`.
  - Add `archive_rel(output_dir: Path, path: Path) -> str`, the single key helper: the resolved path relative to the resolved output dir, in POSIX form. The route and the worker both use it.
  - Add `Placeholder` (a frozen dataclass: `rgb: RGB`, `blur: bytes | None`) and `placeholder_of(img: Image.Image) -> Placeholder`:
    - the mean colour comes from `ImageStat.Stat(img.convert("RGB")).mean`;
    - the blur is a copy thumbnailed to 16 px and saved as WebP at `quality=40`;
    - a blur over `BLUR_MAX_BYTES = 600` becomes `None`;
    - it is pure and blocking.
  - Add `make_set(source, rel_path, widths, root, cap=CACHE_CAP_BYTES, *, formats=None) -> SetResult`, which is blocking and never raises:
    - it stats once and decodes **once** at the largest requested width (`_render`, draft for JPEG / MPO);
    - it downsizes in memory to each smaller width;
    - it writes the missing variants atomically (`_write`) and accounts them (`_added`);
    - `SetResult(stat: tuple[int, int] | None, written: dict[int, Path], present: dict[int, Path], placeholder: Placeholder | None, size: tuple[int, int] | None, reason: str | None)`;
    - when every requested variant is already present, it skips the decode, unless `need_placeholder=True` is passed;
    - `formats=None` means `picture_formats()`, and M3 passes `("WEBP",)` for posters;
    - it reuses `_skip` reasons (`too_large|unavailable|unreadable`).
  - `thumbnail()` miss path: before decoding the source, look for a cached **larger** variant of the same key (`variant_name` at each larger allowed width). If one is found, render from it with `formats=("WEBP",)`; the source is our own cache file, but the allowlist still applies. Log `photo_thumb_cache outcome=derived`. Only otherwise decode the source.
  - Make the per-root cache helpers public under stable names (`cache_state_add = _added`, `lookup`, `read_variant`) so `video_poster` reuses them for its own root and cap. Keep the private aliases for current callers.
  - Module docstring: the new constants, `make_set`, derived misses, `version_token`, and the pre-generation relationship (same files, same keys).
- Modify: `backend/api/content.py` `get_thumb`:
  - accept `v: Optional[str] = Query(None, pattern="^[0-9a-f]{12}$")`;
  - compute the current token from the stat that `lookup` already does (return it from `thumbnail()` as `ThumbResult(path, token)`, or add `photo_thumb.thumbnail_with_token`; keep `thumbnail()`'s return type for existing callers);
  - set `Cache-Control` per "Shared contracts";
  - use `photo_thumb.archive_rel` for `rel`;
  - update the docstring.
- Modify: `frontend/src/features/messages/mediaUrl.ts`: `thumbnailUrl(url, width, v?)`, with the docstring updated.
- Test: `backend/tests/test_photo_thumb.py` (extend) and `frontend/src/features/messages/mediaUrl.test.ts` (extend or create).

- [ ] **Step 1:** Write failing tests in `test_photo_thumb.py`:
  - `make_set` over a JPEG fixture writes 160 and 320 with a single `Image.open`. Patch `photo_thumb.Image.open` with a counting wrapper and assert it ran once.
  - A second `make_set` with everything present opens nothing, and `need_placeholder=True` opens once.
  - The set's variant names equal `variant_name(archive_rel(...), size, mtime_ns, w)`, so the route's `lookup` sees them as hits.
  - `placeholder_of` gives the mean colour of a two-colour image within ±2, and a blur of at most 600 bytes that decodes as WebP. A noisy 16 px image whose blur exceeds the limit gives `blur=None` (patch `BLUR_MAX_BYTES` low).
  - A bomb (header over the bound), an EPS-disguised file and a truncated JPEG each give `reason` and no file, and `capture_logs` shows no path.
  - Derived miss: with only the 320 variant cached, `thumbnail(..., 160)` never opens the source (patch it to raise) and logs `outcome=derived`.
  - `version_token` is stable and changes with size or mtime.
  - `archive_rel` resolves symlinks and `..` the same way the route does.
  - The cap constant is `1 GiB`.
  - Route:
    - a matching `v` → `immutable` and `max-age=31536000`;
    - a stale `v` → `no-cache`, with the current body;
    - no `v` → `max-age=86400`;
    - a malformed `v` → 422 (FastAPI pattern);
    - a matching `If-None-Match` still → 304.
- [ ] **Step 2:** Add a frontend test: `thumbnailUrl(u, 320, 'a1b2c3d4e5f6')` appends `&v=`, and without `v` the URL is unchanged.
- [ ] **Step 3:** Run `uv run pytest backend/tests/test_photo_thumb.py -q` and `cd frontend && npx vitest run src/features/messages/mediaUrl.test.ts`. Expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the same, plus `uv run pytest backend/tests/test_content_api.py backend/tests/test_content_etag.py backend/tests/test_memories_notify_content.py -q` (toast images unchanged) and `uv run mypy backend/services/photo_thumb.py backend/api/content.py`. Expect PASS.
- [ ] **Step 6:** Commit `perf(thumbs): render every size from one decode, version the urls`.

### Task M2: Placeholder store and the batched meta endpoint

**Files:**
- Create:
  - `backend/services/media_meta.py`;
  - `backend/api/media.py` (router prefix `/api/media`, registered in `backend/main.py` next to `content`);
  - `backend/tests/test_media_meta.py`;
  - `backend/tests/test_media_api.py` (this wave's API test file; later tasks append to it).
- Modify:
  - `backend/services/archive_urls.py`: add `media_route_path(output_dir: Path, url: str) -> Path | None`. It accepts only `/api/content/media/<service>/<rest>` (URL-decoded), translates the service id to its display dir exactly like `content._resolve_media_path`, validates with `resolve_within`, and returns `None` for anything else, never raising.
  - `backend/api/content.py`: `_resolve_media_path` delegates its translation and validation to the shared helper. Its behaviour is unchanged: 403 / 404 as today.

**Interfaces (`media_meta.py`):**
- Constants:
  - `DB_NAME = "media_meta.db"`, `SCHEMA_VERSION = 1`;
  - `MAX_ROWS = 300_000`, `PRUNE_SLACK = 0.9` (prune to 90%);
  - `META_BATCH_MAX = 500`;
  - `PICTURE_SUFFIXES` (from `photo_thumb`) and `VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".m4v"})`.
- `db_path() -> Path` is `photo_thumb.cache_dir().parent / DB_NAME`. Add `set_db_path(path)` for tests.
- `@dataclass(frozen=True) MetaRow`, mirroring the table.
- Blocking functions:
  - `get_many(rel_paths: Sequence[str]) -> dict[str, MetaRow]`, chunked at 500 per `IN` query;
  - `put(row: MetaRow) -> None` (`INSERT OR REPLACE`, `updated_at = now`);
  - `set_poster(rel_path, stat_key, state, source) -> None`;
  - `mark_poster_pending(rel_path, stat_key) -> None` commits **before** the Shell call (crash guard, M3);
  - `recover_pending() -> int` runs at worker start and turns every `pending` row into `failed` with `reason=shell_crash_suspect`, so the worker never retries Shell on that file;
  - `prune() -> int` deletes the oldest rows by `updated_at` down to `MAX_ROWS * PRUNE_SLACK` and runs when a `put` crosses `MAX_ROWS`;
  - `clear() -> None`;
  - `counts() -> dict` for status.
- `_connect()`:
  - opens WAL with `busy_timeout=5000`;
  - checks `PRAGMA user_version` and, on a mismatch, drops and recreates (`media_meta_reset`);
  - uses `contextlib.closing` per call;
  - a `sqlite3.Error` is logged as `media_meta_failed` with `op` and `error_type`. Reads then return empty and writes are dropped, because this is a cache and must never fail a request.
- `kind_of(path: Path) -> str | None` returns `picture` or `video` by suffix.
- `async meta_for_urls(urls: Sequence[str]) -> dict[str, dict | None]`:
  - in one `asyncio.to_thread`, it resolves each URL (`archive_urls.media_route_path`), checks `archive_file_ok`, stats the file, and computes `rel` (`photo_thumb.archive_rel`), `stat_key` and `v`;
  - it reads rows with `get_many`;
  - a row is fresh when its `stat_key` matches;
  - a fresh `ready` row → the full item;
  - a `failed` row → `v` and `kind`, with `color` and `blur` null;
  - a missing or stale row → `v` and `kind`, with the rest null, and the item is collected for `hint`;
  - a video item's `poster` is true only when `poster == "ready"` and its `stat_key` matches;
  - `blur` is returned as a `data:image/webp;base64,` URI built here;
  - it then calls `media_pregen.hint(service_of_rel, rel_paths)` through a late import (M4 provides it; until then, a module-level no-op `_hint` that M4 replaces);
  - it logs `media_meta` with counts.
- `backend/api/media.py`:
  - `POST /meta` takes a body model `{"urls": list[str]}` and validates the length (1–500, else 400 `bad_batch`);
  - it calls `media_pregen.note_foreground()` (a no-op until M4) and returns `{"items": ...}`;
  - JSON responses get `no-store` from `ApiNoStoreMiddleware`, because the meta is fresh state.

- [ ] **Step 1:** Write failing `test_media_meta.py` (tmp `set_db_path`, tmp output dir with real JPEG / MP4-named fixtures):
  - put / get round-trip, including CJK and emoji path components stored byte-exact;
  - a stale `stat_key` reports `v` only and is hinted (capture the hint list);
  - a `failed` row → color null and no hint;
  - a video with a `ready` poster → `poster: true`; a stale video → `poster: false`;
  - `recover_pending` turns pending into failed with `shell_crash_suspect`;
  - `prune` keeps the newest rows (patch `MAX_ROWS = 10`);
  - a schema mismatch resets the DB and logs `media_meta_reset`;
  - a forced `sqlite3.Error` (a patched `_connect`) → empty read, a logged `media_meta_failed`, no raise;
  - `media_route_path` rejects `..`, absolute paths, non-media prefixes, an unknown service, and a URL with a query that escapes;
  - `capture_logs`: no event carries a path or URL.
- [ ] **Step 2:** Write failing `test_media_api.py::test_meta_*`:
  - the happy path for a mixed batch (a picture, a video, a missing file, a traversal URL → `null`);
  - 0 URLs → 400, 501 URLs → 400, a non-list body → 422 or 400;
  - the response contains no absolute path (assert `str(tmp_path)` is absent);
  - `Cache-Control: no-store`.
- [ ] **Step 3:** Add a regression test in `test_content_api.py`: the existing `/media` 403 / 404 behaviour is unchanged after the resolver refactor.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_media_meta.py backend/tests/test_media_api.py backend/tests/test_content_api.py -q`. Expect FAIL.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run the tests and `uv run pytest --cov=backend.services.media_meta --cov=backend.api.media --cov-report=term-missing --cov-fail-under=100 backend/tests/test_media_meta.py backend/tests/test_media_api.py -q`, then `uv run mypy backend/services/media_meta.py backend/api/media.py backend/services/archive_urls.py`. Expect PASS.
- [ ] **Step 7:** Commit `feat(media): store placeholders and serve batched media metadata`.

### Task M3: Video poster frames (Windows Shell primary, client capture fallback)

**Recommendation (decided):** the **Windows Shell thumbnail API** is the primary source, generated in the background worker. **Client capture** is the fallback.

| Option | For | Against | Verdict |
|---|---|---|---|
| Windows Shell `IShellItemImageFactory` (ctypes) | No new dependency: ctypes is stdlib and needs no pythonnet. Uses the OS Media Foundation codecs, the same family WebView2 plays with. About 20–80 ms per file, with no browser or network. Runs fully in the background before the user opens anything. | Windows only. Some codecs (HEVC without the Store extension) give no frame. A broken handler could crash or hang in process. | **Primary.** Crash and hang guards are below. |
| Client capture (`<video>` + canvas → `PUT`) | Works for anything the app can play, and on every OS (the Linux dev path). | Needs the UI open and costs a renderer decode per video. It is on-demand by nature, so it only runs for visible tiles. | **Fallback**, for videos Shell could not do and on non-Windows platforms. |
| pysaka-side (download the API's `thumbnail` URL at sync) | A server-made poster. | Writes new files into the archive (a pysaka format change plus pysaka and saka-cli releases). The signed URLs expire, so old videos cannot be backfilled. It is network-bound and not 0.5.0-sized. | Rejected for 0.5.0. Recorded as a possible future enhancement. |

**Files:**
- Create:
  - `backend/services/low_priority.py`: `enter_background_mode(kernel32=None) -> bool`.
    - On Windows, it calls `SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN = 0x00010000)` on the calling thread and returns its success.
    - Elsewhere it does nothing and returns `False`.
    - The `kernel32` parameter is injectable. The `ctypes.WinDLL("kernel32")` loader line carries the Windows pragma.
  - `backend/services/win_shell_thumb.py`:
    - `available() -> bool` (`sys.platform == "win32"` and the binding loads; the result is cached).
    - `com_init(ole32=None) -> None` calls `CoInitializeEx(None, COINIT_APARTMENTTHREADED)` once per thread and remembers it in thread-local state. `S_FALSE` and `RPC_E_CHANGED_MODE` count as initialised.
    - `shell_thumbnail(path: Path, size: int, api: ShellApi | None = None) -> Image.Image | None`:
      - `SHCreateItemFromParsingName(str(path), None, IID_IShellItemImageFactory, &factory)`;
      - `factory->GetImage(SIZE(size, size), SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK, &hbitmap)` (vtable slot 3);
      - `GetObjectW` → `BITMAP`, then `GetDIBits` into a top-down 32 bpp `BI_RGB` buffer;
      - `Image.frombuffer("RGB", (w, h), buf, "raw", "BGRX", 0, 1)`. The alpha channel is unreliable from video providers, so it is ignored.
      - The `HBITMAP` is always freed with `DeleteObject`, and `Release` is always called, in `finally`.
      - It returns `None` (with a `video_poster` breadcrumb, `source=shell`, `outcome=failed`) for: an `HRESULT` failure (`reason=no_frame`, `error_type` = hex code name only), `len(str(path)) > MAX_SHELL_PATH = 259` (`reason=long_path`, because the Shell parser does not take `\\?\` paths), a bitmap over 4096 px on a side (`reason=too_large`), or a near-black frame (mean luminance < `BLACK_LUMA = 8`, `reason=black_frame`, so the client capture at 10% gets its chance).
    - `ShellApi` is a small `Protocol` or dataclass bundling the ctypes callables (`SHCreateItemFromParsingName`, `GetObjectW`, `GetDIBits`, `DeleteObject`, `CreateCompatibleDC`, `DeleteDC`) plus a `get_image(factory, size, flags)` / `release(factory)` pair that wraps the vtable calls. `_load_api()` builds the real one (Windows pragma). Tests inject a fake that returns synthetic BGRX buffers.
  - `backend/services/video_poster.py`:
    - `POSTER_CACHE_CAP_BYTES = 256 * 1024**2`, `POSTER_PX = 640`, `POSTER_UPLOAD_MAX_BYTES = 1024**2`, `UPLOAD_MAX_PIXELS = 16_000_000`, `UPLOAD_FORMATS = ("WEBP", "JPEG", "PNG")`, `SHELL_TIMEOUT_S = 20`.
    - `poster_dir() -> Path`; `poster_name(rel_path, size, mtime_ns) -> str`; `poster_path(source, rel_path) -> Path | None` returns the existing poster for the current version, else `None` (blocking).
    - `generate_shell(source, rel_path) -> Path | None` (blocking; worker thread only):
      - it calls `media_meta.mark_poster_pending`, then `win_shell_thumb.shell_thumbnail(source, POSTER_PX)`;
      - it resizes to at most 640 px and writes WebP atomically (`photo_thumb._write`), accounting with `photo_thumb.cache_state_add(poster_dir(), size, POSTER_CACHE_CAP_BYTES)`;
      - then `media_meta.set_poster(ready|failed, "shell")`.
    - `ingest_client(source, rel_path, body: bytes, content_type: str) -> tuple[str, str | None]` (blocking; returns `(outcome, v)`):
      - it refuses a non-video target, a body over the limit, a content type not in `image/webp` / `image/jpeg`, any decode failure under `UPLOAD_FORMATS` with the header pixel bound, and a size over 4096 px on a side;
      - it **re-encodes** the image, never storing the client's bytes;
      - when a poster already exists for this version → `exists`;
      - it writes the poster, calls `set_poster(ready, "client")`, and logs `video_poster`.
    - Its docstring states the fallback order and the crash guard.
- Modify:
  - `backend/services/photo_thumb.py`, `thumbnail()`: a source whose suffix is in `media_meta.VIDEO_SUFFIXES` (import the constant from one place; `photo_thumb` owns `PICTURE_SUFFIXES`, `media_meta` owns `VIDEO_SUFFIXES`, and keep the import direction acyclic, for example by moving both suffix sets into `photo_thumb`) resolves `video_poster.poster_path`. With a poster, it renders the variant from the poster with `formats=("WEBP",)` under the **video's** key (`variant_name(rel, video_size, video_mtime_ns, w)`). Without one, it returns `None` (404). It never calls Shell in the request path.
  - `backend/api/media.py`: `PUT /poster/{file_path:path}` reads the body with a hard 1 MiB cap (stream `request.stream()` and stop at limit + 1 → 413), resolves it like `/media`, requires `archive_file_ok` and a video suffix, and runs `ingest_client` in `asyncio.to_thread`. On success it calls `media_meta.set_poster`. It answers per "Shared contracts".
- Test:
  - `backend/tests/test_low_priority.py`;
  - `backend/tests/test_win_shell_thumb.py`;
  - `backend/tests/test_video_poster.py`;
  - `backend/tests/test_media_api.py` (append);
  - `backend/tests/test_photo_thumb.py` (append).

- [ ] **Step 1:** Write failing tests:
  - `low_priority`:
    - `sys.platform` patched to `win32` with a fake `kernel32` → `SetThreadPriority` gets `0x00010000` and the result is `True`;
    - the fake returns 0 → `False`, with a debug breadcrumb;
    - on Linux, no call is made and the result is `False`.
  - `win_shell_thumb` (fake `ShellApi`):
    - a 4×2 BGRX buffer comes back as the right RGB pixels;
    - `DeleteObject` and `release` are called on success **and** when `GetDIBits` fails;
    - an HRESULT failure → `None` with `reason=no_frame`;
    - a long path → `None` with no API call;
    - a black frame → `None` with `black_frame`;
    - an oversized bitmap → `None`;
    - `available()` is `False` on Linux and never touches `ctypes.WinDLL` (patch it to raise);
    - `com_init` runs once per thread (two threads → two calls) and accepts `S_FALSE` / `RPC_E_CHANGED_MODE`;
    - logs carry no path.
  - `video_poster`:
    - `generate_shell` with the fake Shell writes a WebP of at most 640 px, marks the poster pending before the call (assert the order with a recording fake), and ends `ready`;
    - a Shell failure ends `failed`;
    - `ingest_client`:
      - accepts a WebP and a JPEG and re-encodes them (the stored bytes differ from the input);
      - refuses a PNG content type with WebP bytes, a GIF, an EPS payload, a header bomb, an over-limit body and a non-video target;
      - the second upload → `exists`;
    - the poster cache evicts the oldest past its cap (patch the cap low);
    - logs carry no path.
  - `photo_thumb`: a video with a poster → `/thumb?w=160` gives WebP from the poster, keyed by the video's stat; a video without one → 404; the Shell is never called from the route (patch `win_shell_thumb.shell_thumbnail` to raise).
  - API `test_poster_*`: 201 then 200; 400 `bad_image`; 404 for a picture target or a traversal; 413 for 1 MiB + 1 byte (streamed, so the full body is never read into memory).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_low_priority.py backend/tests/test_win_shell_thumb.py backend/tests/test_video_poster.py backend/tests/test_photo_thumb.py backend/tests/test_media_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement. Constants for `SIIGBF_*`, `IID_IShellItemImageFactory` (`{bcc18b79-ba16-442f-80c4-8a59c30c463b}`), `DIB_RGB_COLORS` and `BI_RGB` live in `win_shell_thumb.py` with a comment naming the Windows SDK header (`shobjidl_core.h`, `wingdi.h`).
- [ ] **Step 4:** Run the tests with `--cov=backend.services.low_priority --cov=backend.services.win_shell_thumb --cov=backend.services.video_poster --cov-fail-under=100 --cov-report=term-missing`, then `uv run mypy backend/services/low_priority.py backend/services/win_shell_thumb.py backend/services/video_poster.py backend/services/photo_thumb.py backend/api/media.py`. Expect PASS. The only uncovered lines must be the pragma'd loaders.
- [ ] **Step 5:** Commit `feat(media): cache video poster frames via the Windows Shell`.

### Task M4: Background pre-generation worker (idle, throttled, quiesced)

**Files:**
- Create:
  - `backend/services/media_pregen.py`;
  - `backend/tests/test_media_pregen.py`.
- Modify:
  - `backend/services/memories/index.py`: add `media_rows(service_data_dir) -> list[MediaRow]`, which is blocking and read-only. `MediaRow(member_dir, media_file, type, ts_utc, favorited)` comes from `message_facts` where `type IN ('picture','video') AND media_file IS NOT NULL`, ordered `favorited DESC, ts_utc DESC`.
  - `backend/services/sync_coordinator.py`: add a public `busy() -> bool` (`self._running is not None or bool(self._queue)`), with a test in `test_sync_coordinator.py`.
  - `backend/services/sync_service.py`, `_refresh_memories`: after `build_memory_index(sdir)` succeeds, call `media_pregen.request(self._service)`. It never raises, and a failure is logged as `media_pregen_request_failed` with `error_type`.
  - `backend/services/blog_service.py`: when a blog backup run for a service finishes (the place that drops it from `running_services()`), call `media_pregen.request(service)` the same way.
  - `backend/main.py` (lifespan):
    - create the worker after the `_writer_stops` registration;
    - append `media_pregen.stop` **before** `drain_background_tasks`;
    - start it under `scheduler_allowed_in_env()` (skipped in pytest and E2E, logging `media_pregen_skipped reason=env`).
  - `backend/api/content.py`: `get_thumb` and `get_media` call `media_pregen.note_foreground()` (cheap: one `time.monotonic()` store).
  - `backend/api/media.py`: `GET /status` and `DELETE /cache`; `media_meta` loses its no-op hint shim.
  - `frontend/src/shell/components/SettingsModal.tsx`: a "Thumbnail cache" row next to the blog cache size. It shows the size from `/api/media/status`, a "Preparing thumbnails… {{done}} / {{total}}" line while `state` is `running` or `paused`, and a **Clear** button (`DELETE /api/media/cache`, then a toast).
  - The five locale files.
- Create: `frontend/src/i18n/mediaPipeline.test.ts`.

**Interfaces (`media_pregen.py`):**
- Constants:
  - `STARTUP_DELAY_S = 45`, `IDLE_AFTER_S = 3.0`, `POLL_PAUSED_S = 2.0`;
  - `PREGEN_BATCH = 8` (files per thread hop), `PREGEN_DUTY_SLEEP = 2.0` (sleep = 2 × work time), `PREGEN_MIN_PAUSE_S = 0.05`;
  - `PREGEN_FILL_RATIO = 0.85`, `STOP_TIMEOUT_S = 5.0`;
  - `ALBUM_WARM_MONTHS = 3`, `NEWEST_DAYS = 62` (phase 1 window).
- `class MediaPregen`. Its constructor takes injectable dependencies for tests:
  - `services: Sequence[str]`;
  - `is_busy: Callable[[], str | None]`, which returns the pause reason;
  - `clock` and `sleep`;
  - `enumerate_fn`;
  - `process_fn`;
  - `thread_factory`.
- The **worker thread** is a plain `threading.Thread(daemon=True)` fed by a `queue.SimpleQueue`, **not** a `ThreadPoolExecutor`: its threads are joined at interpreter exit, so a hung Shell call would block app exit. The thread's first act is `low_priority.enter_background_mode()`, then `win_shell_thumb.com_init()` when the Shell is available. The loop task awaits each batch through an `asyncio.Future` completed with `loop.call_soon_threadsafe`.
- **Pause predicate** (`default_is_busy`), first match wins:
  1. `shutdown` when `shutdown_state.is_shutting_down()`;
  2. `sync` when `sync_coordinator.get_coordinator().busy()`;
  3. `refresh` when any service's `memory_index.refresh_pending(sdir)` is true;
  4. `blog_backup` when `get_blog_backup_manager().running_services()` is not empty;
  5. `foreground` when the last `note_foreground()` was less than `IDLE_AFTER_S` ago;
  6. `budget_full` when `photo_thumb` state total ≥ `PREGEN_FILL_RATIO × CACHE_CAP_BYTES`.

  While paused, the task sleeps `POLL_PAUSED_S` and re-checks. Each pause or resume logs `media_pregen_pause` once with `reason` and `paused_ms`, never every poll.
- **Pass** per service, in order: services in `order_services` order, with the service that has a pending `request()` first.
  - **Phase 0 `warm_album`:** if D4 did not already add a post-index warm-up, it calls `album.album_months(service, sdir, member=None, kind="all")` and then `album.album_month` for the newest `ALBUM_WARM_MONTHS` months (all cached views, run on the loop as the API does). The album covers it returns (`cover.media_url`) join phase 1 with the 640 width. If D4 provides the warm-up, this phase calls that code and only collects the covers.
  - **Phase 1 `newest`:** message media with `ts_utc` within `NEWEST_DAYS` of the newest item in each room, at widths `PREGEN_WIDTHS`.
  - **Phase 2 `favorites`:** ★ items at `PREGEN_WIDTHS + (LARGE_WIDTH,)`.
  - **Phase 3 `messages`:** all remaining message media, newest first, at `PREGEN_WIDTHS`.
  - **Phase 4 `blogs`:** the cached blog images of the service (from `blog_service.gallery_images` over every member, Task M7; until M7 lands, this phase is a logged no-op `reason=not_available`), newest first, at `PREGEN_WIDTHS`.
  - Hinted rels (`hint()`) jump the queue at every batch boundary, deduplicated and capped at 2,000 pending hints. A hint for a rel outside every known service is dropped.
- **Process one file** (`default_process`, blocking, on the worker thread). It checks `shutdown_event()` first.
  - **Picture:** `photo_thumb.make_set(source, rel, widths, root, need_placeholder=row_missing_or_stale)`, then `media_meta.put(ready|failed)` with the placeholder and size.
  - **Video:**
    - when no poster exists for this version and the meta row's poster is not `failed` for this version, and `win_shell_thumb.available()`: `video_poster.generate_shell` under a watchdog. The loop awaits the batch future with `asyncio.wait_for(..., SHELL_TIMEOUT_S × batch)`. On a timeout it logs `media_pregen_pause reason=shell_hung`, disables Shell for the session, abandons that daemon thread and starts a fresh one. The abandoned thread can only finish its own atomic write;
    - when the Shell is not available: `set_poster("none")`, and the client capture fills it later;
    - when a poster exists: `make_set(poster, rel_video_key, widths, formats=("WEBP",))`, then `media_meta.put` with the placeholder from the poster.
  - It skips a file whose variants and fresh meta row are all present, with one stat and no decode (`skipped` count).
  - It returns a small result (`bytes`, `failed`, `skipped`) and never raises. Each exception is counted with its `error_type` (`media_pregen_item_failed`).
- **Public module API:**
  - `start(services)`, `async stop()`, `request(service)`, `hint(service, rels)`, `note_foreground()`;
  - `status() -> dict` (see "Shared contracts");
  - `async clear_caches() -> int` pauses, deletes both cache dirs' files and `media_meta.clear()`, calls `photo_thumb.reset_cache_state()`, then resumes;
  - all of them are safe before `start` (no-ops) and after `stop`.
- **Startup:** `recover_pending()`, then wait `STARTUP_DELAY_S`, then one full pass over all services. Afterwards it runs only on `request()` or `hint()`.
- **Logs:**
  - `media_pregen_state` on start, stop and idle;
  - `media_pregen_pass` per phase, with counts, `bytes` and `elapsed_ms`;
  - never a path, `rel` or name.

**Settings strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `settings.mediaCache` | サムネイルキャッシュ | Thumbnail cache | 縮圖快取 | 缩略图缓存 | 縮圖快取 |
| `settings.mediaCacheSize` | {{size}} 使用中 | {{size}} used | 已使用 {{size}} | 已使用 {{size}} | 用咗 {{size}} |
| `settings.mediaCachePreparing` | サムネイルを準備中… {{done}} / {{total}} | Preparing thumbnails… {{done}} / {{total}} | 正在準備縮圖… {{done}} / {{total}} | 正在准备缩略图… {{done}} / {{total}} | 準備緊縮圖… {{done}} / {{total}} |
| `settings.mediaCacheClear` | 削除 | Clear | 清除 | 清除 | 清除 |
| `settings.mediaCacheCleared` | サムネイルキャッシュを削除しました | Thumbnail cache cleared | 已清除縮圖快取 | 已清除缩略图缓存 | 已經清除咗縮圖快取 |

- [ ] **Step 1:** Write failing `test_media_pregen.py`. Use a fake clock and sleep, tmp caches and fixtures, and inject `is_busy`.
  - **Order:** phase order and priority within each phase: newest → ★ (with 640) → rest → blogs; a requested service comes first.
  - **Hints:** a hint jumps the queue at the next batch boundary, is deduplicated, and is capped at 2,000.
  - **Pausing:**
    - `is_busy` returning `sync` mid-pass stops new batches; the in-flight batch finishes;
    - the pass resumes when the predicate clears;
    - exactly one `media_pregen_pause` per transition;
    - foreground backoff: `note_foreground()` pauses for `IDLE_AFTER_S`;
    - `budget_full` stops adding (patch the cap low) and logs it once.
  - **Duty cycle:** after a batch that took *t* seconds, the fake sleep receives ≥ `max(0.05, 2t)`.
  - **Shutdown:**
    - `shutdown_event` set → the worker stops before the next file;
    - `stop()` returns within `STOP_TIMEOUT_S`, even with a hung fake `process_fn` (the thread is abandoned, `stop` logs `media_pregen_state state=stopped`, and the test asserts it returned);
    - `stop()` before `start()` is a no-op.
  - **Shell watchdog:** a hanging fake Shell → `shell_hung`, Shell disabled for the session, the rest of the videos processed with `poster="none"`.
  - **Crash recovery:** a pending poster row at start → `failed` / `shell_crash_suspect`, and no Shell call for it.
  - **Skip:** variants plus a fresh row → `skipped`, with no `Image.open` (counting patch).
  - **Picture end-to-end:** after a pass, `/api/content/thumb?w=320` for that file is a **hit** (`photo_thumb_cache outcome=hit`), which proves the key parity.
  - **Video end-to-end with the fake Shell:** poster plus 160 and 320 variants, the meta `poster=ready`.
  - **`clear_caches`:** frees the bytes, empties the meta, and the worker can run again.
  - **Phase 0:** calls the warm functions and collects covers into the 640 set (patch `album.album_months`).
  - **Logs:** `capture_logs` shows no path, `rel` or name.
  - **Lifecycle:** `main` registers `media_pregen.stop` before `drain_background_tasks` (extend `test_shutdown_write_barrier.py`); `_refresh_memories` calls `request` only after a successful build (extend the sync-service tests); the coordinator's `busy()` covers running and queued jobs.
- [ ] **Step 2:** API: `GET /status` shape; `DELETE /cache` → `freed_bytes`, with the next status at 0 bytes.
- [ ] **Step 3:** Settings UI:
  - `SettingsModal` shows the size and the preparing line (mock `/api/media/status` in `__tests__/mocks/handlers.ts`), and Clear calls DELETE and shows the toast;
  - `mediaPipeline.test.ts` lists the five keys in all five locales.
- [ ] **Step 4:** Run:

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run pytest backend/tests/test_media_pregen.py backend/tests/test_media_api.py backend/tests/test_sync_coordinator.py backend/tests/test_shutdown_write_barrier.py backend/tests/test_photo_thumb.py -q
cd frontend && npx vitest run src/shell/components src/i18n/mediaPipeline.test.ts
```

  Expect FAIL.
- [ ] **Step 5:** Implement.
- [ ] **Step 6:** Run the same commands, plus `uv run pytest --cov=backend.services.media_pregen --cov=backend.api.media --cov-fail-under=100 --cov-report=term-missing backend/tests/test_media_pregen.py backend/tests/test_media_api.py -q`, `uv run pytest backend/tests -q -k "sync or blog_backup or memories_index"` (no regressions in the hooked paths), `uv run mypy backend/services/media_pregen.py backend/services/memories/index.py backend/services/sync_coordinator.py` and `cd frontend && npx tsc --noEmit`. Expect PASS.
- [ ] **Step 7:** Commit `perf(media): pre-generate thumbnails in the background when idle`.

### Task M5: Shared frontend layer: meta store, load scheduler, MediaTile, poster capture, VirtualMediaGrid

**Files:**
- Create in `frontend/src/core/media/grid/`:
  - `mediaMeta.ts` and `mediaMeta.test.ts`;
  - `loadScheduler.ts` and `loadScheduler.test.ts`;
  - `useTileVisibility.ts`;
  - `MediaTile.tsx` and `MediaTile.test.tsx`;
  - `posterCapture.ts` and `posterCapture.test.ts`;
  - `useGridColumns.ts`;
  - `VirtualMediaGrid.tsx` and `VirtualMediaGrid.test.tsx`;
  - `index.ts`.
- Modify:
  - `frontend/tailwind.config.js`: `blur: { placeholder: '12px' }` (a token);
  - `docs/design/DESIGN_SYSTEM.md`: one paragraph documenting the media tile (the placeholder colour as data-driven `style`, `blur-placeholder`, fade `duration-base ease-standard`, `motion-reduce` no fade);
  - `frontend/src/design/guard.test.ts` baseline only if the guard requires listing the new token;
  - `frontend/src/utils/clientLog.ts` and `backend/api/client_log.py`: events `media_grid` and `media_poster`; field keys `grid`, `first_tile_ms`, `visible`, `count`, `outcome` (reuse the keys that already exist); code values match `^[a-z0-9_]{1,40}$`;
  - `backend/tests/test_client_log_api.py`: accept and reject cases for the new events.

**Behaviour:**
- **`mediaMeta.ts`** is a module-level store with a `useSyncExternalStore` hook.
  - `primeMediaMeta` and `useMediaMeta` enqueue unknown URLs; a 16 ms timer flushes up to `META_BATCH_MAX` per `POST /api/media/meta`.
  - In-flight URLs are deduplicated. Entries live in an LRU of `META_CACHE_MAX`.
  - A failed request marks those URLs `null` for this session (tiles still load the plain thumbnail without `v`) and logs `media_grid` with `reason=meta_failed` once per minute.
  - `invalidateMediaMeta` drops an entry and refetches it on the next read.
  - Only media-route URLs are sent. Any other URL resolves to `null` immediately.
- **`loadScheduler.ts`** keeps two FIFO queues (`visible` and `near`) with at most `MAX_IMAGE_INFLIGHT` running.
  - Each job is `const img = new Image(); img.decoding = 'async'; img.src = src; await img.decode()`. `decode()` rejection falls back to the `onload` / `onerror` result.
  - `setPriority` moves a waiting job between queues. `cancel` removes a waiting job; for a running one, it sets `img.src = ''` and frees the slot.
  - A src decoded once this session is remembered (an LRU of `READY_CACHE_MAX`), and a later `scheduleImage` for it calls `onReady` synchronously, which makes the second open in a session instant.
- **`useTileVisibility(ref, root)`** shares one `IntersectionObserver` per root element (`rootMargin: '0px'`). It returns `'visible'` while the tile intersects and `'near'` otherwise; a mounted tile is by definition within the grid's overscan. Without `IntersectionObserver` (jsdom, old engines) it returns `'visible'`.
- **`MediaTile`:**
  - **Wrapper:** `style={{ backgroundColor: meta?.color ?? undefined }}`, with `bg-sunken` when there is no colour; `overflow-hidden` plus the caller's `className`.
  - **Blur layer:** when `meta.blur` exists, an `aria-hidden` `<img>` with `blur-placeholder scale-110 object-cover`.
  - **Main image:**
    - its URL is `thumbnailUrl(url, thumbWidthFor(cssPx, dpr), meta?.v)`;
    - it is scheduled with the tile's visibility priority (`eager` → plain `<img loading="eager">`, with no scheduler, no meta wait and the same fallbacks, for the recap poster export);
    - it is rendered once ready with `opacity-0` → `opacity-100` (`transition-opacity duration-base ease-standard motion-reduce:transition-none`);
    - its fallback chain is `?v` → without `v` → the full `url` → `onFail`.
  - **Video:**
    - `meta.poster` → the same thumbnail URL as a picture (the route serves poster variants);
    - else, when `capturePoster` (default `true`) and the tile is visible for 300 ms → `posterCapture.request(url)` while the film tile shows; on success, `invalidateMediaMeta(url)`;
    - else the film tile (`Film` icon, `bg-sunken text-muted`);
    - a video **never** mounts a `<video>` in the grid itself.
  - **Meta not yet loaded:** it does not wait for meta to start loading the image. With `meta === undefined`, it schedules the plain thumbnail without `v` after one frame. When meta arrives first, it uses `?v`. This keeps first paint independent of the meta round-trip.
- **`posterCapture.ts`:**
  - one capture at a time, a session cap `POSTER_CAPTURE_MAX = 300`, and a per-URL attempt only once per session;
  - it creates a detached `<video muted playsInline preload="metadata" crossOrigin="anonymous">` (same origin), seeks to `min(1, duration × 0.1)`, and on `seeked` draws to a canvas with its longest side at most 640;
  - `canvas.toBlob('image/webp', 0.8)` (JPEG if WebP encoding is unavailable), then `PUT /api/media/poster/<path>` with the blob;
  - an 8 s timeout per capture;
  - it always releases the element (pause, `removeAttribute('src')`, `load()`, the `mediaElement` pattern);
  - it logs `media_poster` with `outcome` and `reason`.
- **`useGridColumns(width, min, max, gap)`:**
  - `cols = max(1, ceil((width + gap) / (max + gap)))`, then reduced while the tile is narrower than `min`;
  - `tilePx = floor((width - gap × (cols - 1)) / cols)`;
  - the width comes from a `ResizeObserver` on the grid wrapper.
  - Defaults come from `tileGrid.ts` (≥ 9rem, ≤ 6 per row). Tiles request `thumbWidthFor(tilePx × DPR)`: 480 covers a ~250 px tile at DPR 1.75 (≈ 440); grid tiles never ask above 480 unless `large` (★ / covers → 640).
- **`VirtualMediaGrid`:**
  - `GroupedVirtuoso` with `customScrollParent={scrollParent}` (the Modal body);
  - `groupCounts` = rows per group (`ceil(items / cols)`), and sticky group headers (`bg-sheet px-4 py-3 text-small font-semibold text-secondary`, as today);
  - each row is a CSS grid of `cols` columns with `gapPx`;
  - `increaseViewportBy={{ top: 400, bottom: 1200 }}`. Rows outside it unmount, so DOM and image memory stay bounded;
  - `rangeChanged` primes meta for the rendered rows plus the next two screens of items;
  - `scrollToItem(flatIndex)` maps the item to its group and row, then to the Virtuoso index, then calls `scrollToIndex({ index, align: 'start' })`. `scrollToGroup(key)` scrolls to the group header;
  - the `media_grid` breadcrumb fires once per mount: `grid`, `first_tile_ms` (mount → first visible tile ready, reported by `MediaTile` through context), `visible` (tiles visible at that moment) and `count`.
- **Strings:** this task adds none that are user-visible (tiles are decorative; callers label their buttons). The M6 keys are introduced there.

- [ ] **Step 1:** Write failing tests:
  - **`mediaMeta`:** batching (three hooks in one tick → one POST with three URLs); more than 200 URLs → two POSTs; deduplication; LRU eviction at a patched max of 3; failure → `null` and one log; non-media URLs never POSTed; `invalidate` refetches.
  - **`loadScheduler`** (mock `Image` with controllable `decode`):
    - never more than 4 in flight;
    - visible jobs run before near ones;
    - `setPriority` reorders and `cancel` frees a slot;
    - a ready src is synchronous the second time.
  - **`MediaTile`:**
    - the colour paints through `style` before the image loads;
    - the blur `<img>` is `aria-hidden`;
    - the fade class arrives after ready;
    - the fallback chain `?v` → no `v` → full → `onFail`;
    - `eager` renders a plain `<img>` synchronously;
    - a video with a poster uses the thumbnail URL; a video without one shows the film tile, and `posterCapture.request` is called only after 300 ms visible;
    - a video never renders a `<video>`;
    - with no meta, the image still starts after one frame;
    - non-ASCII (CJK and emoji) media paths encode correctly.
  - **`posterCapture`** (stub `HTMLVideoElement` and canvas):
    - seeks to 10% (capped at 1 s);
    - PUTs a WebP blob;
    - releases the element on success, timeout and error;
    - one at a time; the cap is honoured (`outcome=skipped reason=limit`); no retry of a URL in the session.
  - **`VirtualMediaGrid`** (`virtuosoMock` `GroupedVirtuoso`):
    - rows are chunked by the computed columns (stub `ResizeObserver` at width 800 → `cols = ceil(804 / 184) = 5`);
    - the group headers render;
    - `scrollToItem` maps to the right Virtuoso index;
    - `rangeChanged` primes meta;
    - the breadcrumb fires once with `first_tile_ms`.
  - **Client log:** the backend accepts `media_grid` / `media_poster` with valid codes and rejects text values.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/core/media/grid src/utils` and `uv run pytest backend/tests/test_client_log_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, `npx vitest run src/design/guard.test.ts` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `feat(media): add the shared media tile, loader and virtual grid`.

### Task M6: Migrate the message media gallery

**Files:**
- Modify:
  - `frontend/src/core/media/MediaGalleryModal.tsx`: the **photos** and **videos** tabs render through `VirtualMediaGrid` (`grid="messages"`, `scrollParent` = the Modal body ref it already has).
  - The locale files and `frontend/src/i18n/mediaPipeline.test.ts`.
- Test: `frontend/src/core/media/MediaGalleryModal.rC.test.tsx` (keep it green), plus a new `frontend/src/core/media/MediaGalleryModal.grid.test.tsx`.

**Migration rules (nothing may regress):**
- **Groups** keep today's month grouping and labels: `groupedItems`, newest first, in local month order exactly as now. Items are `Message`.
- **Each tile** is a `<button>` with `aria-label`: `media.gallery.openPhoto` or `openVideo`, with `{{date}}` formatted by the existing `formatDateTime`. Inside it:
  - `<MediaTile url={mediaUrl} kind={picture|video} cssPx={tilePx} />`;
  - for videos, the mute and duration overlays, moved unchanged from the `LazyVideo` children;
  - `onClick` → `setSelectedMedia(item)` as today.
- **Jump to date:** `CalendarModal` selection → `gridRef.current.scrollToItem(flatIndexOfFirstItemOnDate)`. This replaces the `itemRefs` / `monthRefs` DOM lookups, which cannot work on unmounted rows. Build the date → first flat index map in a `useMemo`.
- **Unchanged:** the tab-change scroll reset (`bodyRef.scrollTop = 0`), the detail view, `useZoomPan`, the golden-finger overlay, `useClipboardShortcut`, `onSourceJump` and the **voice** tab (a list, not a grid; untouched).
- `LazyVideo` stays exported. Other users (favourites) keep it, and this task does not delete it.
- `PhotoPlayer variant="gallery-thumb"` stays until M7 removes its last caller.

**Strings** (Japanese reference):

| key | ja | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `media.gallery.openPhoto` | {{date}} の写真を開く | Open photo from {{date}} | 開啟 {{date}} 的照片 | 打开 {{date}} 的照片 | 打開 {{date}} 嘅相 |
| `media.gallery.openVideo` | {{date}} の動画を開く | Open video from {{date}} | 開啟 {{date}} 的影片 | 打开 {{date}} 的视频 | 打開 {{date}} 嘅片 |

- [ ] **Step 1:** Write failing `MediaGalleryModal.grid.test.tsx`, with `virtuosoMock` and `/api/media/meta` mocked in `handlers.ts`:
  - the photos tab renders `MediaTile`s, and the requested image URLs are `/api/content/thumb/...` (no full-size `<img>` src in the grid);
  - the videos tab renders no `<video>` and keeps the duration and mute overlays;
  - clicking a tile opens the same detail item as before;
  - a calendar date calls `scrollToItem` with the first index of that date;
  - switching tabs resets the scroll;
  - the voice tab is unchanged (its existing assertions pass);
  - the tile buttons have the localised `aria-label`;
  - append the two keys to `MEDIA_PIPELINE_KEYS`.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/core/media src/i18n/mediaPipeline.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same, plus `npx vitest run src/features/messages src/design/guard.test.ts` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `perf(messages): virtualise the media gallery on the shared grid`.

### Task M7: Blog gallery: one backend call, then the shared grid

**Files:**
- Modify:
  - `backend/services/blog_service.py`: add `gallery_images(service: str, member_id: str | None = None) -> list[dict]` (async):
    - it loads the blog index **once**;
    - for the member (or every member when `None`; M4 phase 4 uses that), it reads each cached blog's `blog.json` in one `asyncio.to_thread` pass, reusing the folder helper `_blog_folder` with the base path resolved once;
    - for each image with a local file, it emits `{blog_id, published_at, title, image_index, media_url, src}`;
    - the order is newest `published_at` first, then `image_index`;
    - the result is memoised per `(service, member_id)` on `(index mtime_ns, count of blog.json files seen)`;
    - an unreadable `blog.json` is skipped with `blog_gallery_skip reason=unreadable error_type`;
    - one summary log `blog_gallery` with `blogs`, `images` and `skipped`, and never titles or names.
  - `backend/api/blogs.py`: `GET /gallery` (`service`, `member_id`) → `{"images": [...]}`. An unknown service → 400. Blog backup disabled → `{"images": []}`.
  - `frontend/src/features/blogs/api.ts`: `getBlogGallery(service, memberId)`.
  - `frontend/src/features/blogs/components/BlogPhotoGalleryModal.tsx`:
    - one `getBlogGallery` call replaces the `Promise.allSettled(getBlogContent…)` fan-out;
    - the photos render through `VirtualMediaGrid` (`grid="blogs"`); the tiles are buttons labelled with `media.gallery.openPhoto`, around `<MediaTile url={item.media_url} kind="picture" cssPx={tilePx} />`;
    - the viewer keeps `src` (the `/api/blogs/image` URL), `blogTitle`, `onJumpToBlog` and the `newest_first` order;
    - the calendar jump uses `scrollToItem`;
    - `logDialogLoad('blog_gallery', ...)` keeps its outcomes (`ok` / `error`, with the image count);
    - the empty and no-backup states are unchanged.
  - The caller (`BlogsFeature.tsx`) passes the timeline member's id (`memberId` prop). Keep the `blogs` prop only if the calendar or `dateCounts` still need it; otherwise derive from the images.
  - `frontend/src/core/media/PhotoPlayer.tsx`: if `grep -rn "gallery-thumb" frontend/src` (inside the repo, `timeout 60`) shows no remaining caller, remove the `gallery-thumb` variant and its docs and tests. Otherwise leave it and note the caller in the report.
- Test: `backend/tests/test_blogs_api.py` (append `test_gallery_*`), `backend/tests/test_blog_service.py` (append) and `frontend/src/features/blogs/components/BlogPhotoGalleryModal.test.tsx` (update).

- [ ] **Step 1:** Write failing tests:
  - **Backend:**
    - two blogs with images and one without a local file → the images in order;
    - `media_url` resolves through `archive_urls.media_route_path` to the real file (round-trip), and the existing `/api/content/thumb` serves it;
    - the index is loaded once (a counting patch);
    - the memo is hit on the second call and invalidated when the index mtime changes;
    - an unreadable `blog.json` is skipped and logged;
    - a CJK member name and emoji title survive in the response but are absent from the logs;
    - API 400 for an unknown service, and `[]` without backup.
  - **Frontend:**
    - exactly one request on open (no `getBlogContent`);
    - tiles use thumbnail URLs;
    - the viewer opens at the right index with the `src` URL;
    - the calendar jump calls `scrollToItem`;
    - the loading, empty and no-backup states;
    - `logDialogLoad` outcomes.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_blogs_api.py backend/tests/test_blog_service.py -q` and `cd frontend && npx vitest run src/features/blogs src/core/media`. Expect FAIL.
- [ ] **Step 3:** Implement. Then wire M4 phase 4 to `gallery_images(service, None)` and remove its `not_available` no-op, extending `test_media_pregen.py` with a blog-phase case.
- [ ] **Step 4:** Run the tests, `uv run pytest backend/tests/test_media_pregen.py -q`, the coverage gate for `gallery_images` (`--cov=backend.services.blog_service` and check that the new function's lines are all covered in `term-missing`), and `npx tsc --noEmit` plus the guard. Expect PASS.
- [ ] **Step 5:** Commit `perf(blogs): serve the photo gallery in one call on the shared grid`.

### Task M8: Memories album and every MemoryThumb on the shared tile

**Files:**
- Modify:
  - `frontend/src/features/memories/shared/MemoryThumb.tsx`: its public props are unchanged (`message`, `className`, `px`, `onFail`, `loading`), and it now renders `MediaTile`:
    - picture → `<MediaTile kind="picture" cssPx={px ?? FULL_FALLBACK_PX} eager={loading === 'eager'} … />`. Without `px`, keep today's full-file behaviour: pass `eager` plus the full URL, because these are callers that need the original.
    - video → `<MediaTile kind="video" … />`, so the grid never mounts `<video preload=metadata>` again;
    - a video with no URL → the film tile (unchanged).
  - `frontend/src/features/memories/album/MonthSection.tsx`, `MonthGrid`: `useEffect(() => primeMediaMeta(data.items.map(i => i.media_url)), [data])` when the payload lands.
  - `frontend/src/features/memories/album/AlbumPage.tsx`: wrap the grid area in the `media_grid` breadcrumb provider (`grid="album"`; `first_tile_ms` from AlbumPage mount).
  - **Keep `useAlbumWindow`** (Decision D-1) and every D4 change listed in `acceptance-fix-report.md`. The load scheduler and visibility hook already serve visible tiles first inside the live bands.
  - `frontend/src/features/memories/album/PolaroidCover.tsx` and `BurstStack.tsx`: no API change. Confirm that they render through `MemoryThumb` with `px`; if one passes no `px`, give it its drawn size so it uses thumbnails.
- Test:
  - `frontend/src/features/memories/shared/MemoryThumb.test.tsx` (update);
  - `frontend/src/features/memories/album/AlbumPage.test.tsx` and `PhotoTile.test.tsx` (keep green; update any assertions that looked for `<video data-testid="memory-thumb-video">`);
  - the recap poster tests (the `eager` path) must pass unchanged.

- [ ] **Step 0:** Read `.superpowers/sdd/acceptance-fix-report.md` (D4 and D18) and list in the task report which D4 mechanisms exist (for example an earlier months fetch, a backend warm-up or a payload change). This task must not undo any of them. If D4 changed `MemoryThumb` or `useAlbumWindow`, merge on top of it.
- [ ] **Step 1:** Write failing tests:
  - **`MemoryThumb`:**
    - with `px`, a picture requests `/api/content/thumb/...?w=…` (with `&v=` once meta is mocked);
    - the placeholder colour paints first;
    - `onFail` fires only after the full-file fallback fails;
    - `loading="eager"` renders a synchronous `<img>` (recap export);
    - a video renders no `<video>` and shows the poster thumbnail when `meta.poster`, else the film tile;
    - CJK paths are encoded.
  - **Album:**
    - priming sends one meta batch per loaded month;
    - the breadcrumb fires once;
    - the existing band windowing, ribbon jump, cover menu and small-window tests are unchanged.
  - Grep the Memories tests for `memory-thumb-video` and update each one to the new poster/film expectations.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/features/memories src/core/media src/design/guard.test.ts src/i18n` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `perf(memories): paint album tiles from placeholders and posters`.

### Task M9: Whole-wave verification (Linux, then Windows performance)

**Files:**
- Modify:
  - `CHANGELOG.md` `[Unreleased]`: one end-user line per `docs/DOC_FORMATS.md` (bold lead-in, at most 3 sentences, no code identifiers), next to the Memories entries. For example: **Galleries open instantly.** Photos and videos in the album, chat galleries and blog galleries are prepared in the background, so they appear right away with a soft preview while the full image loads.
  - The budget table and constants, if Step 6 measures a deviation over 25%.
- No other new code. Fix whatever the checks find, inside the task that owns the file.

- [ ] **Step 1: Full backend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run pytest backend/tests -q
uv run pytest -q --cov=backend.services.media_meta --cov=backend.services.video_poster --cov=backend.services.win_shell_thumb \
  --cov=backend.services.low_priority --cov=backend.services.media_pregen --cov=backend.api.media \
  --cov-report=term-missing --cov-fail-under=100 \
  backend/tests/test_media_meta.py backend/tests/test_video_poster.py backend/tests/test_win_shell_thumb.py \
  backend/tests/test_low_priority.py backend/tests/test_media_pregen.py backend/tests/test_media_api.py
uv run mypy backend/services backend/api
uv run ruff check backend && uv run ruff format --check backend
```

  The keyring test that fails headless is pre-existing (memory `keyring-test-fails-headless`). Note it and do not count it as a regression.
- [ ] **Step 2: Full frontend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npx tsc --noEmit
npx vitest run
```

  The run includes `src/design/guard.test.ts` (0 violations in new files) and `src/i18n/mediaPipeline.test.ts` (five locales).
- [ ] **Step 3: Log and safety hygiene:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
timeout 60 grep -rnE "logger\.(info|warning|debug|error)\([^)]*(path|rel|file|name|title|url|src)=" \
  backend/services/media_meta.py backend/services/video_poster.py backend/services/win_shell_thumb.py \
  backend/services/media_pregen.py backend/services/low_priority.py backend/api/media.py backend/services/photo_thumb.py
timeout 60 grep -rn "warnings\.\(filter\|simple\)" backend/services backend/api
timeout 60 grep -rn "Image.open(" backend/services backend/api | grep -v "formats="
timeout 60 grep -rn "ctypes.WinDLL\|windll" backend/services | grep -v "pragma: no cover"
```

  Expect no hits. The last grep may show the loader lines only, and they carry the pragma.
- [ ] **Step 4: Linux smoke (dev server).**
  - Start the dev backend and frontend as usual. Pre-generation is skipped in pytest only, so run the dev server.
  - Open each of the three galleries. The tiles paint their colour and blur, then fade in.
  - Video tiles show the film tile, then a client-captured poster: one `media_poster outcome=captured` per visible video, and none for off-screen videos.
  - `/api/media/status` progresses, and a running sync shows `paused_reason=sync`.
- [ ] **Step 5: Windows build and pipeline check** (the verify copy, as in `.superpowers/sdd/windows-acceptance.md` § Build):
  - `git fetch` and `checkout -B feat/memories origin/feat/memories` in `C:\D\saka-verify\SakaDesk`, then `.\build.ps1 -ExeOnly`.
  - Launch `dist\SakaDesk\SakaDesk.exe` with `SAKADESK_DATA_DIR=C:\D\saka-verify\appdata`, CDP on 9222 and `-WorkingDirectory` set to the exe dir. Close the live app if it holds the single-instance guard.
  - Wait for the log line `media_pregen_state state=idle` after `media_pregen_pass phase=blogs`, polling `/api/media/status`. Record the pass duration and `bytes / done`.
  - During the startup sync, every `media_pregen_pause reason=sync` window must contain no `media_pregen_pass` progress lines.
  - With the window open on the hub and idle, sample `Get-Counter '\Process(SakaDesk*)\% Processor Time'` while pre-generation runs: on average at most about 35% of one core.
  - The startup sync duration stays within 10% of the 0.5.0 acceptance run's.
  - Posters: `video_poster source=shell outcome=ready` for most videos. Record the counts of `failed` by reason; those videos should show client-captured posters when they scroll into view.
- [ ] **Step 6: Windows performance targets** (pre-generation complete, app restarted cold, with the WebView2 HTTP cache cleared through CDP `Network.clearBrowserCache` for the **first-open** run only):
  - **First album open:** click 回憶 → アルバム. Read `media_grid grid=album first_tile_ms` from the log, and cross-check with CDP (the click timestamp → the first viewport `img` in `album-grid` with `complete && naturalWidth > 0`). **Target: under 1,500 ms.**
  - **Second album open:** go to the hub, then back to the album in the same session. **Target: under 500 ms.** Network shows the thumbnails `(disk cache)` / `(memory cache)` with no 200 from the server.
  - **Message gallery** of the largest room (photos tab), and the **blog gallery** of the member with the most images: record `first_tile_ms`. The target is under 1,000 ms; it is reported, and failing it does not block the release.
  - **Memory bound:** scroll the largest message gallery top to bottom. The CDP `DOM.getDocument` node count stays under 5,000, and `Performance.getMetrics` `JSHeapUsedSize` stays under 300 MB.
  - **Miss rate:** count `photo_thumb_cache outcome=miss` over `outcome=hit|derived|miss` during Step 6. **Target: under 2%.**
  - Record every number (and the 11 s D4 baseline) in `.superpowers/sdd/media-pipeline-verify.md`. Store screenshots in `C:\D\saka-verify\shots\media\`.
- [ ] **Step 7: Clear and recover:** Settings → Thumbnail cache → Clear. The status shows 0 bytes. The galleries still work through the route's safety net and posters fall back. Pre-generation restarts on the next idle pass.
- [ ] **Step 8:** Record in the ledger (`.superpowers/sdd/progress.md`): the measured numbers, the budget check (the average KB per item compared with the 25 KB assumption), the poster success rate, and any follow-ups.
- [ ] **Step 9:** Commit `docs(changelog): note faster galleries and video posters`.

---

## Decisions for the user

- **D-1 (recommended: keep it).** The album keeps its month-band windowing; only its tiles move onto the shared layer. The message and blog galleries use `VirtualMediaGrid`.
  - **Why:**
    - The album lays out dense 2×2 ★ tiles, burst stacks and a polaroid cover beside each month's grid. Fixed virtual rows cannot express that without dropping those designs.
    - `useAlbumWindow` already unmounts bands more than two screens away, which bounds memory.
    - The D4 fix is landing in this same code.
  - **Alternative:** move the album onto `VirtualMediaGrid` rows as well. That means one grid component everywhere, but it loses the dense ★ pin and the polaroid-beside-grid layout, and it reopens D4. Choose this only if one literal component matters more than the album's design.
- **D-2: cache budget.** Thumbnails get 1 GiB (pre-generation fills up to 85%), posters 256 MiB, and meta rows 300k: about 1.4 GB at worst. A smaller budget (for example 500 MB) still works, but a second large service and blogs would cycle through LRU and the first open of older months would hit the safety net more often. A Settings choice of size is out of scope for 0.5.0 unless asked.
- **D-3: the on-demand safety net.** The route still generates a thumbnail on a cache miss (new items before the worker reaches them, or evicted items), so no tile ever breaks. Pre-generation makes misses rare (target under 2%). Removing the miss path entirely would mean grey tiles until the worker catches up. Recommendation: keep it.

## Self-review

**Requirement coverage:**

| Requirement | Where |
|---|---|
| Pre-generated thumbnails at several sizes, after sync, idle, low priority, not on demand | M1 `make_set` (one decode, 160 + 320, 640 for ★ / covers); M4 worker (post-index `request`, blog-backup `request`, startup pass, pause predicate, background thread priority, duty cycle); D-3 documents the miss safety net |
| Paused while a sync runs; never slows sync or UI; stopped on shutdown / quiesce | M4 `default_is_busy` (coordinator `busy()`, `refresh_pending`, blog backup, foreground backoff), `shutdown_event` checks, `_writer_stops` hook before `drain_background_tasks`, a daemon thread (no exit join), the Shell watchdog; M9 Step 5 measures it |
| Video posters, generated once and cached; grid shows the poster and loads the video only on open | M3 (Shell primary, client fallback, own cache, crash guard `pending` → `shell_crash_suspect`); M5 `MediaTile` never mounts `<video>`; M6 / M8 remove `LazyVideo` / `<video preload>` from grids |
| Evaluate Shell / client / pysaka and recommend one with a fallback | M3 decision table |
| Placeholders: colour plus a tiny blur, per item, paint immediately, fade in | M1 `placeholder_of`; M2 `media_meta` table plus `/api/media/meta`; M5 `MediaTile` colour / blur / fade, with no wait on meta |
| One shared virtualised grid; visible first, prefetch near the viewport; unmount far rows; bounded memory | M5 `VirtualMediaGrid` (`increaseViewportBy`, row unmount), `loadScheduler` (visible > near, 4 in flight, cancel), `useTileVisibility`; M6, M7 adopt it; M8 album per D-1; M9 memory-bound check |
| HTTP caching: content-addressed URL or ETag, long-lived, instant second open | M1 `v` token → `immutable, max-age=31536000`, ETag / 304 kept; M5 session ready-cache; M9 second-open target |
| Build on `photo_thumb`, `album_colors`, `avatar_resize`, sync hooks, quiesce, `MemoryThumb`, the album windowing, `useBubbleVoices`, `LazyVoice`, `download.ts` | `photo_thumb` extended, not forked (M1, M3); the poster cache reuses its cache-state helpers; `album_colors` untouched (its ribbon colour means something else: the most frequent vivid bucket, not the mean); `avatar_resize` untouched (a different route, a different width ladder); the hook in `_refresh_memories` follows `_schedule_memories_refresh`; `_writer_stops` / `shutdown_state` reused; `MemoryThumb`'s API kept (M8); `useAlbumWindow` kept (D-1); voices (`useBubbleVoices`, `LazyVoice`) are not media grids and stay untouched; `download.ts` untouched (no grid downloads) |
| Build on D4 | Global Constraints prerequisite; M4 phase 0 is conditional on D4; M8 Step 0 |
| Logs ids / codes / counts only | Shared contracts log list; per-task `capture_logs` assertions; M9 Step 3 greps |
| CPU / IO off the loop | `asyncio.to_thread` in M2 / M3 / M7; the worker thread in M4 |
| Pillow allowlist and pixel bound, no `warnings` filters | M1 (sources and derived WebP), M3 (Shell size bound, upload `UPLOAD_FORMATS` plus `UPLOAD_MAX_PIXELS`, re-encode); M9 Step 3 greps |
| Nothing written to the archive; bounded, evicting caches | Cache layout under `cache/`; caps per cache; meta `prune` |
| Design-system guard; strings in 5 locales | M5 token plus DESIGN_SYSTEM.md; M4 / M6 string tables; `mediaPipeline.test.ts` |
| 100% coverage on new backend modules | Each backend task's coverage command; M9 Step 1 aggregate gate |
| Windows-only path guarded, tested with fakes, clean Linux fallback | M3 `low_priority` / `win_shell_thumb` injected APIs, `available()` false on Linux, client fallback; M9 Step 4 (Linux) and Step 5 (Windows) |
| Cache budget decided, justified, a constant | "Cache budget" table; D-2; M9 Step 6 measurement |
| Migration path, no regressions | M6 / M7 / M8 migration rules (jump-to-date via `scrollToItem`, viewer, voice tab, overlays, recap `eager`, `LazyVideo` kept, `gallery-thumb` removed only when unused); every existing gallery test kept green |
| Windows perf: first album grid under 1.5 s, second under 0.5 s | M9 Step 6 |

**Placeholders:** none. Every task names its files, interfaces, tests, commands and commit message. Two conditional points are deliberate, and each has a defined default:
- whether D4 already warms the album views (M4 phase 0, decided by reading the D4 report);
- whether `gallery-thumb` still has a caller (M7, decided by a repo grep).

**Name consistency:** the same names are used throughout:
- the modules `photo_thumb`, `media_meta`, `video_poster`, `win_shell_thumb`, `low_priority`, `media_pregen` and `blog_service.gallery_images`;
- the routes `/api/content/thumb` (`w`, `v`), `/api/media/meta`, `/api/media/poster/{path}`, `/api/media/status`, `/api/media/cache` and `/api/blogs/gallery`;
- the constants `CACHE_CAP_BYTES`, `PREGEN_FILL_RATIO`, `POSTER_CACHE_CAP_BYTES`, `MAX_ROWS`, `BLUR_MAX_BYTES`, `META_BATCH_MAX`, `MAX_IMAGE_INFLIGHT`, `READY_CACHE_MAX`, `META_CACHE_MAX`, `POSTER_CAPTURE_MAX`, `SHELL_TIMEOUT_S`, `IDLE_AFTER_S`, `PREGEN_WIDTHS` and `LARGE_WIDTH`;
- the phases `warm_album`, `newest`, `favorites`, `messages` and `blogs`;
- the pause reasons `sync`, `refresh`, `blog_backup`, `foreground`, `budget_full`, `shutdown` and `shell_hung`;
- the frontend `MediaTile`, `VirtualMediaGrid`, `mediaMeta`, `loadScheduler`, `posterCapture`, `useTileVisibility` and `useGridColumns`;
- the client events `media_grid` and `media_poster`.

**Risks and mitigations:**
- **A Shell thumbnail handler crashes the process.** The `pending` row is committed before the call, and the next start marks that file `shell_crash_suspect` and never retries it with Shell.
- **A Shell call hangs.** A per-batch watchdog disables Shell for the session, and the daemon thread is abandoned without blocking app exit.
- **`customScrollParent` inside `Modal`.** It follows the existing pattern in the timeline and is covered by `virtuosoMock` tests. The real scroll behaviour is checked in M9 on Windows.
- **The meta round-trip delays first paint.** `MediaTile` starts the plain thumbnail after one frame without waiting for meta. Meta only adds the colour, the blur and the `v` upgrade.
- **Cache key drift between the worker and the route.** One `archive_rel` helper, plus the M4 end-to-end "pass then route hit" test.
