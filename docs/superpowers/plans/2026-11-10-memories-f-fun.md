# Memories F — Fun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship wave 4 "Fun" of the Memories spec:
- voice radio (§11): A, the 深夜ラジオ station with its programs and a sleep timer; B, the cassette year picker;
- 回憶扭蛋, the gacha (§12): 3 pulls per JST day, rarity, history;
- the calendar album (§13), which opens the 那一天 day view through a new `{page: 'day'}` route;
- the warm presentations (§14):
  1. 彼女の24時間;
  2. あの日と今日: the ⇆ toggle in On This Day detail, the timeline header slot, the 初見 vs 今 mode, and the recap's S08 slide drawn by the same component;
  3. 同じ時刻, on the hub;
  4. 時光膠囊: local sticky notes that resurface one year later on the hub and in On This Day;
- the album cover override (right-click 「この月の表紙にする」), which fills `covers.load_cover_overrides`.

Notifications (§15, M4) are **not** in this wave. This wave leaves clean hooks for them only: `capsule.due_notes`, plus the existing `cards.earned_keys` and `on_this_day.pick_year`.

**Architecture:**
- **Backend:** one service module per feature in `backend/services/memories/`: `radio.py`, `transcripts.py`, `gacha.py`, `calendar_album.py`, `capsule.py`, `day24.py`, `then_now.py` and `same_time.py`. `covers.py` gains its real body. Each module reads facts through `facts` and `people`, exactly like the core wave, and attaches her words after any `view_cache` read.
  - **User data** (capsule notes, cover overrides, gacha pulls and the gacha salt) lives in the existing `app_state.db`, never in the archive and never in the memory-index DB. It gets a versioned migration in `app_state.init_db` and one CRUD module, `memories/user_store.py`.
  - Routes are added to `backend/api/memories.py` and use its existing validators (`_service_dir`, `_person`, `_optional_person`, `MONTH_RE`, `_parse_day`, `_parse_flag`).
- **Frontend:** new pages inside `frontend/src/features/memories/`: `radio/`, `gacha/`, `calendar/`, `capsule/`, `thenNow/` and `day24/`.
  - The router gains `radio`, `gacha`, `calendar` and `day`. The memoir gains a `day24` tab.
  - The core hooks get filled: `HubSlots`, `HUB_CARDS`, `DayView.headerSlot`, a new `Timeline` header slot, and `covers`.
  - **One voice coordinator.** The recap's `ClipSequencer` moves to `shared/clipSequencer.ts`. `shared/voicePlayback.ts` learns to stop and fade the active player. `LazyVoice`, the recap's S06 and the radio all play through it.

**Tech Stack:** FastAPI, SQLite (stdlib), Pillow (already a dependency; no new Pillow code in this wave); pytest + time-machine; React 18 + TS, framer-motion 10, zustand, lucide-react; vitest + Testing Library.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-11-10-memories-design.md`. §1 is binding. §3.3 defines the selection rules, §3.4 the verified facts that drive the radio programs, and §8 the cover override; §11–§14 define this wave's screens. The core plan (`docs/superpowers/plans/2026-11-10-memories-c-core.md`) still holds for everything it defines: shared contracts, the message object, the API validation rules, `MemberPane`, `MemoryText`, `MemoryThumb`, `jumpToChat`, `useMemoriesQuery`, `sepiaClass` and the JST helpers.
- **Prerequisites:** the core wave is closed at `97d6f17` on `feat/memories`. Read `.superpowers/sdd/core/wave-review.md`, section "Wave-4 hooks", before Task F1.
- **Controller rulings** (ledger `.superpowers/sdd/progress.md`; binding):
  - **JST everywhere.** Every date, hour and clock in Memories is JST: `formatJstClock` / `formatJstDate` / `jstNow` from `shared/jst.ts`, and `selection.JST` in the backend. The gacha day, the capsule's "one year later", the radio programs' hours, the calendar cells and 同じ時刻 are all JST.
  - **A timestamp is metadata.** Show a message's real JST time next to it (radio now-playing, 24h slots, 同じ時刻, gacha card). Never present the time as something she chose for the fan.
  - **Titles and labels must be literally true.** There is no "met" wording, and nothing implies that she replied or knew. A label names what the rule actually found:
    - a 24h day from one year must not say "several years";
    - an あの日と今日 side shows its real year;
    - a gacha "最後のメッセージ" must be her real last message.
  - **At most one number per moment, and never "0".** Thin data switches presentation or hides the element. For example, gacha pulls left at 0 show 「また明日」, not a count.
  - **One voice coordinator:** `shared/voicePlayback.ts` (and `shared/LazyVoice`). Task F8 extends it; nothing else starts audio.
  - **Thumbnails** go through `/api/content/thumb` (`MemoryThumb px`, `thumbnailUrl`). Avatars go through `resizedAvatarUrl`.
  - **Saves** go through the export handoff (`POST /api/memories/export` → token → hidden-iframe GET), never `<a download>`. This wave has no save surface. If one is added, it must use the handoff.
  - **Pillow** uses a `formats=` allowlist and no `warnings` filter. This wave adds no Pillow code: cassette colours reuse `album_colors` probes.
  - **Client-log codes** are snake_case (`^[a-z0-9_]{1,40}$`) and every one is listed in `backend/tests/fixtures/memories_log_codes.json`. Both the backend test (`test_client_log_api.py`) and `memoriesLog.test.ts` read that fixture.
  - **Cached payloads never hold text.** `view_cache.contains_text` guards this. Task F2 widens its key list with `segments` and `note`.
- **Content limits (§1.1, §1.5):** her words are always shown next to the fact. Letters and capsule notes are the fan's own items and are never presented as hers. The gacha never draws promo. The radio's 精選 program appears only when it has real clips.
- **Per group (§1.2):** every screen and every stored row is scoped to the active service. Capsule notes, cover overrides and gacha pulls carry the service (or `service_dir`) column.
- **Layout (§1.3):** a list on the left and a content pane on the right. Pages are fixed-viewport, and inner areas scroll inside the pane.
- **Design system:** read `docs/design/DESIGN_SYSTEM.md` before any UI task. Use tokens and primitives only (`Card`, `Pill`, `Avatar`, `Button`, `IconButton`, `Modal`, `Menu` / `MenuItem`, `EmptyState`, `Atmosphere`, `Switch`, `Input` / `Select`). No hex, rgb or hsl literals, and no arbitrary radius, shadow, text or spacing values (`design/guard.test.ts`). No named palette classes.
  - Group colour is only for identity, the current state and one primary action. Gacha rarity colours, the radio night surface and the 24h sky are new **semantic** memories tokens (Task F7), never the group accent, 推 pink or the favourite yellow.
  - Headings use `font-display`. Her words get `lang="ja"`. ← / ‹ always means older, → / › newer.
- **i18n:** every user-facing string is a key in `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json` under `memories.*`. Japanese is the reference copy (given per task). `frontend/src/i18n/memoriesFun.test.ts` (Task F7) holds `MEMORIES_FUN_KEYS` and `MEMORIES_FUN_EN_PLURALS`, and every UI task appends to both.
- **Logs:** ids, codes, counts and scores only. Never log message text, transcript text, capsule note bodies, nicknames, names, paths, `person_key`, `member_path`, the gacha salt or a seed.
  - Backend breadcrumbs are the core ones (`memories_select`, `memories_skip`, `memories_view_cache`) plus one summary event per feature call: `memories_radio`, `memories_gacha`, `memories_calendar`, `memories_capsule`, `memories_day24`, `memories_then_now`, `memories_same_time`, `memories_cover`, `memories_user_store`.
  - Every decision, skip and fallback path leaves a breadcrumb.
  - Frontend: the core events plus three new ones, `memories_radio`, `memories_gacha` and `memories_capsule` (Task F7).
- **Data access:** the same rules as the core plan.
  - Facts come only from `facts.get_facts` / `get_person_facts` / `get_facts_on` and the new `facts.get_facts_at_clock` (Task F6).
  - Texts come from `facts.load_texts` (via `people.attach_texts`): once per room, with an id set, in `asyncio.to_thread`.
  - Transcripts come only through `memories/transcripts.py` (Task F2).
  - App-state rows come only through `memories/user_store.py`, in `asyncio.to_thread`.
- **Engineering:**
  - Use `uv run`, never pip. Commit with `uv run git commit` (pre-commit is only on the uv PATH). Commits follow Conventional Commits with a subject of at most 72 chars, plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - File I/O is `utf-8` and uses `pathlib`. No `print()`. Log through `structlog.get_logger(__name__)`.
  - CPU and disk work runs in `asyncio.to_thread`. Never use `time.sleep`. Date-dependent tests use `time-machine`.
- **WSL safety:** never run a recursive search from `/` or under `/mnt/<drive>`. Keep greps inside the repo and wrap them in `timeout 60`.
- **Branch:** `feat/memories` in SakaDesk.

## Shared contracts (all tasks)

**People, paths and the message object:** unchanged from the core plan ("Shared contracts" there). A gacha card, radio track, calendar cell photo, 24h slot, あの日と今日 side item, 同じ時刻 line and capsule "her message" are all the core message object (`people.message_ref` + `people.attach_texts`).

**Endpoints added by this wave.** All live under `/api/memories/{service}`. Each is `GET` unless marked.

| Method | Path | Query / body | Service function | Task |
|---|---|---|---|---|
| | `/radio/members` | — | `radio.radio_members` | F2 |
| | `/radio/program` | `program`, `member?`, `year?` | `radio.radio_program` | F2 |
| | `/radio/cassettes` | `member?` | `radio.radio_cassettes` | F2 |
| | `/gacha` | — | `gacha.gacha_state` | F3 |
| POST | `/gacha/pull` | — | `gacha.pull` | F3 |
| | `/calendar/months` | `member?` | `calendar_album.calendar_months` | F4 |
| | `/calendar/{month}` | `member?` | `calendar_album.calendar_month` | F4 |
| PUT | `/album/cover` | body `{"member": str \| null, "month": "YYYY-MM", "room": str, "id": int}` | `covers.set_cover_override` | F4 |
| DELETE | `/album/cover` | `member?`, `month` | `covers.clear_cover_override` | F4 |
| | `/capsule` | `date` (`YYYY-MM-DD`) **or** `member` + `card` | `capsule.notes_for_anchor` | F5 |
| | `/capsule/due` | `month_day` (`MM-DD`) | `capsule.resurfacing` | F5 |
| POST | `/capsule` | body `{"anchor": {"kind": "day", "date"} \| {"kind": "card", "member", "card_key", "date"}, "body": str}` | `capsule.create_note` | F5 |
| PUT | `/capsule/{note_id}` | body `{"body": str}` | `capsule.update_note` | F5 |
| DELETE | `/capsule/{note_id}` | — | `capsule.delete_note` | F5 |
| | `/same-time` | — (uses the current JST minute) | `same_time.same_time` | F5 |
| | `/memoir/day24` | `member`, `seed?` (int) | `day24.build_day24` | F6 |
| | `/then-now/day` | `date` (`YYYY-MM-DD`), `member?` | `then_now.then_now_day` | F6 |
| | `/then-now/first-week` | `member` | `then_now.then_now_first_week` | F6 |

API validation is the core's (400 for an unknown service, a bad path, date, month or kind, or a malformed body; 404 for an unknown person). It adds:
- an unknown `program` → 400;
- a `year` outside 2000–2100 → 400;
- a capsule `body` that is empty after stripping, or over `capsule.MAX_CHARS` (2000) → 400 `bad_note`;
- an unknown `note_id`, or one from another service → 404;
- `POST /gacha/pull` with no pulls left → 409 `no_pulls_left`;
- `PUT /album/cover` for a message that is not a picture/video of that month in that scope → 400 `not_in_month`.

No response contains an absolute path, a `person_key` or the gacha salt.

**Hub payload changes** (Task F5; `hub.VERSION` → 3):
- `counts` gains `voices` (voice messages; promo included, like the album count) and `days` (JST dates with at least one message).
- The response gains `gacha_left` (int; read from `user_store` after the cache read, never cached).
- `same_time` and `capsule` are filled (shapes in Task F5). Both are computed after the cache read and never cached.

**Frontend routes** added to `MemoriesRoute`:

```ts
| { page: 'radio'; memberPath?: string }
| { page: 'gacha' }
| { page: 'calendar'; month?: string; memberPath?: string }   // month = 'YYYY-MM' (JST)
| { page: 'day'; date: string; from?: 'calendar' }            // date = 'YYYY-MM-DD' (JST)
// memoir tab gains 'day24'
| { page: 'memoir'; memberPath?: string; tab?: 'binder' | 'timeline' | 'names' | 'day24' }
```

Page codes for `memories_page` (`MEMORIES_PAGE_CODES`): `radio`, `gacha`, `calendar`, `day`.

**User-state tables** (`app_state.db`, Task F1):

```sql
CREATE TABLE memories_capsule_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL,
  anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('day','card')),
  anchor_date TEXT NOT NULL,          -- JST YYYY-MM-DD the note is about
  member_path TEXT,                   -- card anchors: chat path of the person at write time
  card_key TEXT,                      -- card anchors: cards.Card.key
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,           -- UTC ISO
  updated_at TEXT NOT NULL            -- UTC ISO
);
CREATE INDEX memories_capsule_by_anchor ON memories_capsule_notes(service, anchor_date);
CREATE INDEX memories_capsule_by_created ON memories_capsule_notes(service, created_at);

CREATE TABLE memories_cover_overrides (
  service_dir TEXT NOT NULL, scope TEXT NOT NULL, month TEXT NOT NULL,
  room TEXT NOT NULL, message_id INTEGER NOT NULL, set_at TEXT NOT NULL,
  PRIMARY KEY (service_dir, scope, month)
) WITHOUT ROWID;

CREATE TABLE memories_gacha_pulls (
  service TEXT NOT NULL, jst_date TEXT NOT NULL, pull_index INTEGER NOT NULL,
  room TEXT NOT NULL, message_id INTEGER NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('n','r','sr')), reason TEXT NOT NULL,
  pulled_at TEXT NOT NULL,
  PRIMARY KEY (service, jst_date, pull_index)
) WITHOUT ROWID;
```

The gacha salt is the `prefs` row `memories_gacha_salt` (16 hex chars, created on first use).

---

### Task F1: User-state storage and migration (`app_state` + `user_store`)

**Files:**
- Modify: `backend/services/app_state.py`
  - Add `SCHEMA_VERSION = 1` and `_MIGRATIONS: tuple[Callable[[sqlite3.Connection], None], ...]`.
  - `init_db()` keeps its `CREATE TABLE IF NOT EXISTS` block (version 0), then calls `_migrate(c)`. That reads `PRAGMA user_version`, runs each pending step in order inside the open transaction and sets `PRAGMA user_version = SCHEMA_VERSION`.
  - Step 1 creates the three tables and two indexes from "Shared contracts" with `IF NOT EXISTS`, so a half-applied DB heals.
  - Add a public `connect() -> sqlite3.Connection` (the existing `_connect`; keep `_connect` as an alias for current callers).
  - Docstring: the version table and the rule "append a step, never edit one".
- Create:
  - `backend/services/memories/user_store.py`: blocking CRUD plus `a*` wrappers through `asyncio.to_thread`. It is the only module that touches the three tables.
  - `backend/tests/test_app_state_migrations.py`;
  - `backend/tests/test_memories_user_store.py`.

**Interfaces (`user_store.py`):**

```python
@dataclass(frozen=True)
class CapsuleNote:
    id: int; service: str; anchor_kind: str; anchor_date: date
    member_path: str | None; card_key: str | None
    body: str; created_at: datetime; updated_at: datetime   # aware UTC

def add_note(service, *, anchor_kind, anchor_date: date, member_path=None, card_key=None,
             body: str, now: datetime) -> CapsuleNote
def update_note(service, note_id: int, body: str, *, now: datetime) -> CapsuleNote | None   # None = not found
def delete_note(service, note_id: int) -> bool
def notes_on_date(service, day: date) -> list[CapsuleNote]                       # anchor_date == day, oldest first
def notes_for_card(service, member_path_rooms: Sequence[str], card_key: str) -> list[CapsuleNote]
def notes_created_on_month_day(service, month_day: str, *, before_year: int) -> list[CapsuleNote]

def cover_overrides(service_dir: str, scope: str) -> dict[str, tuple[str, int]]
def set_cover_override(service_dir, scope, month, room, message_id, *, now) -> None
def clear_cover_override(service_dir, scope, month) -> bool

def gacha_salt() -> str                          # creates prefs memories_gacha_salt once (secrets.token_hex(8))
def gacha_pulls_on(service, jst_date: date) -> list[GachaPull]
def gacha_history(service, *, limit: int) -> list[GachaPull]     # newest first
def gacha_recent_keys(service, *, since: date) -> set[tuple[str, int]]
def record_gacha_pull(service, jst_date, *, room, message_id, rarity, reason, now,
                      max_pulls: int) -> GachaPull | None
```

- `GachaPull` is a frozen dataclass mirroring the table row.
- `record_gacha_pull` runs `BEGIN IMMEDIATE`, counts the day's rows and inserts at `pull_index = count`. When `count >= max_pulls`, it inserts nothing and returns `None`. This is the race guard for two clicks.
- `notes_for_card` matches the stored `member_path` against **any** of the person's current chat paths, because a person's newest room can change.
- `notes_created_on_month_day` compares the JST month-day of `created_at`. A Feb 29 note is also returned for `02-28` in non-leap years, and `before_year` excludes notes written this year.
- Every write logs `memories_user_store` with `op` (`note_add|note_update|note_delete|cover_set|cover_clear|gacha_pull`), the row id or `pull_index`, and `chars` (note length) where relevant. Bodies, paths, the salt and scopes are never logged.
- `sqlite3.Error` is logged as `memories_user_store` with `op`, `outcome=error` and `error_type`, then re-raised. The API maps it to 500 `user_store_failed`. User data is never silently dropped.

- [ ] **Step 1:** Write failing `test_app_state_migrations.py`:
  - a fresh DB ends at `user_version == 1` with all tables;
  - a version-0 DB built by the *old* `init_db` body, holding a `prefs` row, a `favorite_log` row and a `translation_cache` row, keeps all three rows after `init_db()` and gains the new tables;
  - running `init_db()` twice is a no-op (same `user_version`, no error);
  - a DB at `user_version 1` whose capsule table was dropped by hand heals on the next `init_db()`.
- [ ] **Step 2:** Write failing `test_memories_user_store.py` (`app_state.set_db_path(tmp_path / "s.db")` + `init_db()` in a fixture):
  - note add / update / delete round-trip, with non-ASCII, emoji and CJK bodies kept byte-exact;
  - `notes_on_date` is scoped by service;
  - `notes_for_card` matches through a second room path;
  - `notes_created_on_month_day` handles Feb 29 → Feb 28 and `before_year`;
  - cover set / overwrite / clear, scoped by `service_dir` and scope;
  - the gacha salt is stable across calls and is 16 hex chars;
  - `record_gacha_pull` refuses the fourth pull and keeps indexes 0, 1, 2;
  - two threads racing for the third pull produce exactly one row (use `threading.Barrier`);
  - `gacha_history` is newest first and honours `limit`;
  - `structlog.testing.capture_logs` shows no body, salt or path in any event.
- [ ] **Step 3:** Run `uv run pytest backend/tests/test_app_state_migrations.py backend/tests/test_memories_user_store.py -q`. Expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the same tests, plus `uv run pytest backend/tests/test_app_state_store.py backend/tests/test_app_state_integration.py backend/tests/test_memories_favorite_log.py -q` (existing app_state behaviour unchanged) and `uv run mypy backend/services/memories backend/services/app_state.py`. Expect PASS.
- [ ] **Step 6:** Commit `feat(memories): store capsule notes, covers and gacha pulls locally`.

### Task F2: Voice radio backend (programs, cassettes, transcripts)

**Files:**
- Create:
  - `backend/services/memories/transcripts.py`;
  - `backend/services/memories/radio.py`;
  - `backend/tests/test_memories_transcripts.py`;
  - `backend/tests/test_memories_radio.py`;
  - `backend/tests/test_memories_fun_api.py` (this wave's API test file; later tasks append to it).
- Modify:
  - `backend/services/transcription_service.py`, `TranscriptionStorage._load_raw`: the two warnings must no longer log `path=str(file_path)`. Log `transcriptions_unreadable` with `reason=malformed|corrupt` only. Memories reads these files, so the existing path leak must close (spec §1.7).
  - `backend/services/memories/view_cache.py`: `_TEXT_KEYS = ("text", "caption", "sentence", "segments", "note")`, with the docstring updated.
  - `backend/api/memories.py`: the three radio routes.
  - `backend/tests/test_memories_view_cache.py`: `segments` / `note` payloads are uncacheable.

**Programs (spec §11, facts from §3.4).** The hour bands partition the JST day:

| code | ja title | rule | order |
|---|---|---|---|
| `oyasumi` | おやすみ放送 | voices at JST 21:00–04:59 (after midnight counts as night, the cards' late-clock rule) | daily shuffle |
| `ohayo` | おはよう放送 | voices at 05:00–09:59 | daily shuffle |
| `otsukare` | おつかれチャージ | voices at 10:00–20:59 | daily shuffle |
| `chrono` | あの頃から順番に | every voice in the chosen `year` (default: her first year) | oldest first |
| `favorites` | ★ お気に入りの声 | favourited voices | oldest first |
| `oyasumi_clips` | 精選・おやすみだけ | transcript segments whose NFKC text matches `lexicon.GREETING_RES["oyasumi"]` | oldest first |

- Voices only: video audio is not on the radio. Promo voices are included, because a voice is her voice and the promo flag comes from nearby text; this matches the binder's count cards.
- **Daily shuffle:** `random.Random(int(sha256(f"{jst_date}|{program}|{scope}").hexdigest()[:16], 16)).shuffle(ids)`, where `scope` is `person_key` or `"all"`. Tonight's broadcast is stable on reopen and differs tomorrow. `scope` is never logged.
- A program with no tracks is left out of `programs` (never shown empty). `oyasumi_clips` is listed only when at least one clip exists.

**Interfaces (`transcripts.py`):**
- `transcript_ids(sdir, room) -> frozenset[int]`: blocking. The message ids in that room's `transcriptions.json` with at least one segment and `no_speech` false. It uses `TranscriptionStorage().load_all` (the only parser). Any exception gives `frozenset()` plus `memories_skip` with `view=transcripts`, `reason=unreadable` and `error_type`.
- `segments_for(sdir, room, ids) -> dict[int, list[dict]]`: blocking. `{"start", "end", "text"}` per id.
- `keyword_clips(segments: Mapping[int, list[dict]], pattern: re.Pattern, *, pad_s: float = 0.3) -> list[tuple[int, float, float, str]]`: pure. One clip per matching segment: `(message_id, max(0, start - pad), end + pad, text)`. The text is attached later and never cached.
- `transcripts_stat(sdir, rooms) -> tuple`: `(size, mtime_ns)` per room's `transcriptions.json` (or `None`), for cache hashes.

**Interfaces (`radio.py`):**
- `PROGRAMS = ("oyasumi", "ohayo", "otsukare", "chrono", "favorites", "oyasumi_clips")`, `NIGHT_HOURS = {21, 22, 23, 0, 1, 2, 3, 4}`, `MORNING_HOURS = range(5, 10)`, `RADIO_VERSION = 1`.
- `program_of(f: Fact) -> str`: pure. `oyasumi` / `ohayo` / `otsukare` by `f.hour`.
- `async radio_members(service, sdir) -> dict` returns `{"total_seconds": float | null, "members": [{"member_path", "member_id", "name", "avatar_url", "oshi", "voices": int, "seconds": float | null}]}`.
  - Only people with at least one voice appear. Order: oshi first, then `seconds` descending.
  - `seconds` is `null` when no voice has a known duration.
  - Cached with `cached_view(sdir, "radio_members", "all", view_hash(RADIO_VERSION, room hashes, oshi))`.
- `async radio_program(service, sdir, *, program, member: MemberSummary | None, year: int | None, now) -> dict` returns:

```json
{"program": "oyasumi", "programs": ["oyasumi", "ohayo", "otsukare", "chrono", "favorites", "oyasumi_clips"],
 "years": [2023, 2024, 2025],
 "tracks": [{"message": message, "start": 0, "end": 42.0 | null, "has_transcript": true, "segments": null}]}
```

  - `programs` lists the programs that have tracks in this scope, always in `PROGRAMS` order. `years` lists the JST years with voices, which the cassettes use.
  - Tracks of regular programs have `start: 0`, `end` = `duration_s` (or `null`), `has_transcript` from `transcript_ids` and `segments: null`. The frontend loads the lyrics of the current track lazily from the existing `GET /api/transcription/{service}/{id}?member_path=` route.
  - `oyasumi_clips` tracks carry the clip window and `segments: [the matching segment]`. These are attached **after** the cache read.
  - Each `message` has `avatar_url` at its time.
  - The text-free part (ids, windows, flags) is cached with `cached_view(sdir, "radio_program", f"{scope}:{program}:{year}:{today}", view_hash(RADIO_VERSION, room hashes, transcripts_stat, today))`.
  - An unknown program gives `ValueError` (the API maps it to 400). A requested program with no tracks returns `tracks: []` and logs `memories_skip` with `view=radio`, `reason=empty_program`. The UI never offers that program.
  - Logs: `memories_radio` with `program`, `count`, `with_transcript` (count), `year` and `scoped` (bool).
- `async radio_cassettes(service, sdir, *, member) -> dict` returns `{"cassettes": [{"year", "voices", "seconds" | null, "color": "#rrggbb" | null}]}`, oldest first.
  - `color` = `album_colors.month_color` over the RGB values of that year's month colours from `album_colors.month_colors_for(service, sdir, member)` (hex parsed back to RGB). It is `null` when the year has no colours, and the UI then uses a neutral tape.
  - Cached with `cached_view(sdir, "radio_cassettes", scope, view_hash(RADIO_VERSION, room hashes, album_colors.COLORS_VERSION))`.

- [ ] **Step 1:** Write failing tests:
  - `transcripts`:
    - ids skip `no_speech` and empty segments;
    - a corrupt file gives `frozenset()` and the log carries no path (also assert that `TranscriptionStorage._load_raw` no longer logs `path`);
    - `keyword_clips` pads and clamps at 0, and matches full-width or emoji-adjacent おやすみ (`おやすみ🌙`, `ｵﾔｽﾐ` stays unmatched because it is katakana);
    - the stat changes when the file changes.
  - `radio`:
    - `program_of` boundaries: 04:59 → oyasumi, 05:00 → ohayo, 09:59 → ohayo, 10:00 → otsukare, 20:59 → otsukare, 21:00 → oyasumi;
    - the daily shuffle is stable for the same date (time-machine) and differs on the next day;
    - `chrono` filters by year and is oldest first;
    - `favorites` holds only ★;
    - `oyasumi_clips` is absent from `programs` without transcripts, present with one matching segment, and its `segments` are absent from the cached row (`contains_text` false on the stored payload) but present in the response;
    - empty programs are left out of `programs`;
    - members are ordered oshi first, then seconds; people without voices are omitted;
    - a cassette colour comes from the month colours (patch `month_colors_for`), and is `null` without them;
    - logs carry no text or names.
  - `test_memories_fun_api.py::test_radio_*`: the happy path for all three routes; an unknown program → 400; a bad year → 400; traversal → 400; an unknown member → 404; no absolute paths.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_transcripts.py backend/tests/test_memories_radio.py backend/tests/test_memories_view_cache.py backend/tests/test_memories_fun_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement. Reuse `people.sort_people`, `people.message_ref`, `people.attach_texts` (not needed for voices, but harmless for captions) and `facts.voice_durations`.
- [ ] **Step 4:** Run the tests, `uv run pytest backend/tests -q -k transcri` (the transcription API is unchanged) and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve the voice radio programs and cassettes`.

### Task F3: Gacha backend (deterministic daily pulls, rarity, history)

**Files:**
- Create: `backend/services/memories/gacha.py`, `backend/tests/test_memories_gacha.py`
- Modify: `backend/api/memories.py` (`GET /gacha`, `POST /gacha/pull`), `backend/tests/test_memories_fun_api.py`

**Rarity (spec §12, reusing `cards.py` / `binder.py` signals):**

| rarity | reason codes (first match wins) | rule |
|---|---|---|
| `sr` | `midnight` | a fact at 00:00–00:05 JST (the `moment.midnight` rule) |
| | `birthday` | her birthday's JST date (`cards.parse_birthday`; Feb 29 → Feb 28 in non-leap years, like `special.birthday`) |
| | `sub_anniversary` | `cards.anniversary_date(binder.subscription_start(summary), k)` for k ≥ 1 |
| | `last_message` | the graduated person's (`summary.graduated`) **last fact**, only when that fact is not promo (so 「最後のメッセージ」 is literally her last) |
| `r` | `nickname` | `has_nickname` |
| | `favorite` | `favorited` |
| | `voice` | `type == "voice"` |
| `n` | `message` / `photo` | any other non-promo text, or picture/video |

**Draw (deterministic per JST day):**
- **Pool:** every non-promo fact of every person in the service of type text (with `importance is not None`), picture, video or voice (`media_file` present). Promo is never in the pool. Facts drawn in the last 30 days (`user_store.gacha_recent_keys`) are removed while the pool keeps at least 10 other items.
- **Seed:** `int(sha256(f"{salt}|{service}|{jst_date}|{pull_index}").hexdigest()[:16], 16)`, where `salt = user_store.gacha_salt()`. Never logged.
- **Tier odds:** `TIER_ODDS = (("sr", 0.03), ("r", 0.17), ("n", 0.80))`. Roll the tier first. If the rolled tier is empty, fall to the next lower tier (sr → r → n), then upward if needed; log `memories_select` with `view=gacha` and `fallback=tier_empty`.
- **Within the tier:** weighted choice with `weight = 1 + min(9, score / 200)`. The score is `importance` for words, `photo_score` for media, and `100 + duration_s` for voice; a `None` score counts as 0.
- **Sorting:** candidates are sorted by `(room, id)` before drawing, so the result does not depend on the order facts were read in.
- **Pure core:** `draw(pool: Sequence[Candidate], seed: int) -> Candidate | None`, with `Candidate(room, fact, rarity, reason, score)`. All randomness lives in `draw` and `classify`.

**Interfaces (`gacha.py`):**
- `MAX_PULLS = 3`, `HISTORY_LIMIT = 60`, `RECENT_DAYS = 30`, `GACHA_VERSION = 1`.
- `classify(fact, *, birthday_md: tuple[int, int] | None, anniversaries: frozenset[date], last_key: MessageKey | None, room) -> tuple[str, str]`: pure; returns `(rarity, reason)`.
- `async build_pool(service, sdir, *, today) -> list[Candidate]`:
  - The text-free pool (keys, rarity, reason, score) is cached with `cached_view(sdir, "gacha_pool", "all", view_hash(GACHA_VERSION, all room hashes, today))`, where `today` covers the anniversary years.
  - Logs `memories_gacha` with `op=pool`, `count`, `sr`, `r` and `n` (counts).
- `async gacha_state(service, sdir, *, now) -> dict` returns:

```json
{"available": true, "pulls_left": 2, "max_pulls": 3,
 "today": [pull], "history": [pull]}
```

  - `pull` = `{"jst_date", "pull_index", "rarity", "reason", "pulled_at", "message": message}`.
  - `history` is newest first, at most 60, and includes today's pulls.
  - `available` is false when the pool is empty. The UI then shows a gentle empty state instead of the machine.
  - `pulls_left` can be 0; the frontend shows 「また明日」 and never the 0.
  - Texts are attached with one `attach_texts` per room. A pulled message that has since disappeared from the archive stays in the history with `message.text = null`, logs `memories_skip` with `view=gacha`, `reason=pull_missing`, and is rendered as a date-only card.
- `async pull(service, sdir, *, now) -> dict | None`:
  - `None` means no pulls are left; the API returns 409 `no_pulls_left`.
  - Otherwise it computes `pull_index = len(pulls today)`, draws and records with `user_store.record_gacha_pull(..., max_pulls=MAX_PULLS)`. A `None` from the store, because a racing click won, also means 409.
  - It returns `{"pull": pull, "pulls_left": int}`.
  - Logs `memories_gacha` with `op=pull`, `pull_index`, `rarity`, `reason`, `score` and `message_id`.
  - With an empty pool it returns `{"pull": null, "pulls_left": n}` and logs `reason=empty_pool`.

- [ ] **Step 1:** Write failing `test_memories_gacha.py`:
  - `classify` covers every reason, including the first-match order (a midnight voice is `sr/midnight`), Feb 29 birthdays, the anniversary k = 1 / 2, and the graduated last fact that is promo (→ not SR);
  - `draw` gives the same result for the same seed and a different result for another seed over a 50-item pool;
  - the tier fallback when SR is empty;
  - weighting: with seeded runs over 2,000 seeds, a high-score item is drawn more often than a low-score one in the same tier;
  - promo never appears in `build_pool`;
  - recent pulls are excluded while the pool stays at least 10;
  - time-machine 2026-11-10 23:59 JST vs 2026-11-11 00:00 JST resets `pulls_left` (the JST day boundary, not UTC);
  - the fourth pull returns `None`;
  - two concurrent `pull` calls for the last slot record one row;
  - `history` has text attached and the pool cache holds no text;
  - logs carry no salt, text or names.
  - API: `GET /gacha` shape; `POST /gacha/pull` 200 ×3 then 409; an unknown service → 400.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_gacha.py backend/tests/test_memories_fun_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement. Import `parse_birthday` / `anniversary_date` from `cards` and `subscription_start` from `binder`; do not copy them.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the daily memory gacha`.

### Task F4: Calendar album and cover override backend

**Files:**
- Create: `backend/services/memories/calendar_album.py`, `backend/tests/test_memories_calendar_album.py`, `backend/tests/test_memories_covers.py`
- Modify:
  - `backend/services/memories/covers.py`: the real `load_cover_overrides`, plus `set_cover_override` and `clear_cover_override`. Keep the module docstring contract and replace "Always `{}` in this wave".
  - `backend/services/memories/album.py`: no logic change. Confirm that the override is still part of the album hash. Bump `ALBUM_VERSION` to 5 so rows built under the always-empty stub rebuild once.
  - `backend/api/memories.py`: `/calendar/months`, `/calendar/{month}`, `PUT /album/cover`, `DELETE /album/cover`.
  - `backend/tests/test_memories_fun_api.py`.

**Interfaces (`covers.py`):**
- `async load_cover_overrides(sdir, scope) -> dict[str, tuple[str, int]]`: `user_store.cover_overrides(sdir.name, scope)` in a thread. A `sqlite3.Error` gives `{}` plus `memories_skip` with `view=album_cover`, `reason=override_read_failed`. The album still renders.
- `async set_cover_override(service, sdir, *, member: MemberSummary | None, month: str, room: str, message_id: int, now) -> None`:
  - The scope is `people.person_key(member)` or `"all"`.
  - Validates that `(room, message_id)` is a picture/video fact of that JST month within the scope (`people.scope_facts`, then `album.keep(f, "all")`). Otherwise it raises `ValueError("not_in_month")`.
  - Logs `memories_cover` with `op=set`, `message_id` and `scoped`.
- `async clear_cover_override(service, sdir, *, member, month) -> bool`: logs `memories_cover` with `op=clear` and `found`.
- Docstring: an override keyed by `person_key` stops applying when that person gains a room (the key changes). That is a stale override, never an error, and the fan can set it again.

**Interfaces (`calendar_album.py`):**
- `async calendar_months(service, sdir, *, member) -> dict` returns `{"months": ["2023-07", ...]}`: the JST months with at least one fact, oldest first. The month picker dims the others. Cached with `cached_view(sdir, "calendar_months", scope, view_hash(room hashes))`.
- `async calendar_month(service, sdir, month: str, *, member, now) -> dict` returns:

```json
{"month": "2024-09",
 "days": [{"date": "2024-09-14", "members": 5, "photo": message | null, "photo_rule": "favorite|score|burst|first" | null}]}
```

  - Only days with at least one fact are listed; the UI greys the rest.
  - `members` = the people who posted that day. The UI draws dots capped at 5 and never prints the number.
  - `photo` = `album.choose_cover(day_candidates, override=None, oshi_rooms=oshi, screenshot_like=...)` over that day's non-promo pictures. A video is used only when the day has no picture (the `MemoryThumb` still), which is the same spec §3.3 best-photo rule as the album. The screenshot check consults `album_colors.probes` for the top 3 candidates of each day, exactly like `album._consulted_probes`. Import that helper rather than copying it; make it public as `album.consulted_probes` if needed.
  - Photos carry `avatar_url: null` (a cell needs none). The payload holds no text, so the whole month is cached with `cached_view(sdir, "calendar_month", f"{scope}:{month}", view_hash(room hashes, COLORS_VERSION, oshi))`.
  - A month outside the scope's range returns `days: []` (the calendar can browse any month). Logs `memories_calendar` with `month_days` (count) and `with_photo` (count), and `memories_select` per day with `view=calendar_cell`, `rule`, `score` and `message_id` at debug level, because there are up to 31 per call.

- [ ] **Step 1:** Write failing tests:
  - `covers`:
    - a set override is returned by `load_cover_overrides` and wins in `album_months` (the cover rule `override`);
    - a stale override (the message is gone or not in the month) falls back silently;
    - set validation raises `not_in_month` for a text message or another month;
    - a clear restores the automatic cover;
    - the album cache rebuilds after a set (the hash changes);
    - a store read failure logs and yields `{}`.
  - `calendar_album`:
    - only days with facts are listed, and `members` counts people;
    - the photo rule order: an oshi ★ beats a higher-score non-★, promo is never the cell photo, a screenshot-like photo is demoted (patch `album_colors.probes`);
    - a video stands in only without a picture;
    - the member scope;
    - a month with no data gives `days: []`;
    - the cache holds no text;
    - JST day bucketing (a 23:30 UTC message lands on the next JST date).
  - API:
    - the calendar routes, with a bad month → 400;
    - `PUT /album/cover` 204 and then reflected in `/album/months`; 400 `not_in_month`; traversal → 400;
    - `DELETE /album/cover` 204.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_covers.py backend/tests/test_memories_calendar_album.py backend/tests/test_memories_album.py backend/tests/test_memories_fun_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve the calendar album and cover overrides`.

### Task F5: 時光膠囊, 同じ時刻 and the hub wiring backend

**Files:**
- Create: `backend/services/memories/capsule.py`, `backend/services/memories/same_time.py`, `backend/tests/test_memories_capsule.py`, `backend/tests/test_memories_same_time.py`
- Modify:
  - `backend/services/memories/facts.py`: add `facts_at_clock(service_data_dir, member_dir, start_minute: int, end_minute: int) -> list[Fact]` (blocking; `WHERE service_dir=? AND member_dir=? AND (hour*60+minute) BETWEEN ? AND ?`, with a midnight wrap split into two ranges) and `async get_facts_at_clock(...)` with the usual freshness check. List both in the module docstring.
  - `backend/services/memories/hub.py`: fill `same_time` and `capsule`, add `counts.voices` / `counts.days` and `gacha_left`, set `VERSION = 3`, and update the docstring.
  - `backend/api/memories.py`: the capsule routes and `/same-time`.
  - `backend/tests/test_memories_hub.py`, `backend/tests/test_memories_facts.py`, `backend/tests/test_memories_fun_api.py`.

**Capsule rules (spec §14.4):**
- A note is anchored to a **day** (`anchor_date`, for the service) or to a **card** (`member_path`, `card_key`, and `anchor_date` = the card's `date`).
- The fan can always read and edit a note on its anchor. It is not sealed.
- **Resurfacing:** a note resurfaces on every yearly anniversary of the JST date it was **written** (`created_at`), starting one year later. Feb 29 resurfaces on Feb 28 in non-leap years (`cards.anniversary_date`). It resurfaces with her message of the **anchor** day: the best words of that date, from the card's person for a card anchor, else oshi first then importance (`on_this_day.pick_year` over `people.service_facts_on(day=anchor_date)`). Without a message that day, the note resurfaces alone.
- `years_ago` = the current JST year minus the year written (≥ 1). It drives the literal label 「{{count}}年前のあなたが書いたメモ」.

**Interfaces (`capsule.py`):**
- `MAX_CHARS = 2000`, `HUB_LIMIT = 1`.
- `async notes_for_anchor(service, sdir, *, day: date | None, member: MemberSummary | None, card_key: str | None) -> dict` returns `{"notes": [note]}`, where `note = {"id", "anchor": {"kind", "date", "card_key"}, "body", "created_at", "updated_at"}`. Never cached.
- `async create_note(service, sdir, *, anchor, body, now) -> dict`: strips the body, validates 1–2000 chars (else `ValueError("bad_note")`) and the anchor (a valid date; for cards, `member` resolves and `card_key` matches `^[a-z0-9_.@-]{1,80}$`).
- `async update_note(...)` / `async delete_note(...)`.
- `async resurfacing(service, sdir, *, month_day: str, now) -> dict` returns `{"notes": [{"note": note, "years_ago": int, "message": message | null, "member_path": str | null, "name": str | null}]}`, oldest written first.
- `async due_notes(service, today: date) -> list[user_store.CapsuleNote]`: the M4 hook. Notes due today (written on today's month-day in an earlier year, with the Feb 29 rule). Pure query, no text attached. The docstring states that M4's notification calls it.
- Logs: `memories_capsule` with `op` (`list|create|update|delete|resurface`), `count`, `note_id` and `chars`. Never the body.

**Interfaces (`same_time.py`):**
- `WINDOW_MIN = 2`.
- `async same_time(service, sdir, *, now) -> dict | None` returns `{"clock": "21:03", "year": 2024, "date": "2024-06-02", "member_path", "name", "message": message}`.
  - Candidates are non-promo facts within ±2 min of now's JST time of day (`get_facts_at_clock` per room) on an **earlier JST date**. Each is words with `importance`, or a picture with a caption.
  - Preference: earlier years first (any date before Jan 1 of this year). Only when none exist, earlier dates of this year.
  - Within the preferred band: oshi first, then a seeded weighted choice among the top 5 by importance. The seed is `sha256(f"{jst_date}|{hh:mm}")`, so the line is stable within a minute and changes the next minute.
  - `None` when there are no candidates; the line then hides.
  - Never cached (text). Logs `memories_same_time` with `band=past_years|this_year|none`, `count` and `message_id`.

**Hub additions:**
- `same_time` = `await same_time.same_time(...)`.
- `capsule` = the first item of `capsule.resurfacing(month_day=today)` or `None`.
- `counts.voices` and `counts.days` go in the cached `numbers` (`_counts`).
- `gacha_left = gacha.MAX_PULLS - len(user_store.gacha_pulls_on(service, today))`, read after the cache.
- All three are attached after `cached_view`. The `capsule` body and the `same_time` text never enter the cache.

- [ ] **Step 1:** Write failing tests:
  - `facts_at_clock`: a 23:59 ±2 window wraps to 00:01; plain ranges.
  - `capsule`:
    - create / list / update / delete;
    - an empty or 2001-char body → `bad_note`;
    - a card anchor resolves through another room path;
    - resurfacing on the first anniversary (time-machine), not before (364 days), and again on the second with `years_ago: 2`;
    - Feb 29 → Feb 28;
    - her message is from the card's person for card anchors, and oshi first for day anchors;
    - a note with no message that day resurfaces alone;
    - `due_notes` returns the same set as `resurfacing` without text;
    - logs carry no body.
  - `same_time`:
    - a ±2 min window match;
    - earlier years beat this year;
    - oshi first;
    - stable within the same minute and possibly different in the next minute (seeded);
    - promo excluded;
    - `None` without candidates.
  - `hub`:
    - `same_time` / `capsule` filled (fixtures), `null` when absent;
    - `counts.voices` / `counts.days`;
    - `gacha_left` after a recorded pull;
    - the cached numbers row holds no text (`contains_text` false) while the response has the note and line;
    - `VERSION` 3.
  - API: capsule routes (400 / 404 / cross-service 404), `/capsule/due` month_day validation, `/same-time` 200 with `null` body allowed.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_capsule.py backend/tests/test_memories_same_time.py backend/tests/test_memories_hub.py backend/tests/test_memories_facts.py backend/tests/test_memories_fun_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add time capsules, same-time line and hub wiring`.

### Task F6: 彼女の24時間 and あの日と今日 backend

**Files:**
- Create: `backend/services/memories/day24.py`, `backend/services/memories/then_now.py`, `backend/tests/test_memories_day24.py`, `backend/tests/test_memories_then_now.py`
- Modify:
  - `backend/services/memories/lexicon.py`: move `ECHO_KEYWORDS` and `ECHO_KEYWORD_SCORE` here from `recap.py`.
  - `backend/services/memories/recap.py`: import them, plus `then_now.keywords_in` and `then_now.first_week_window`, in place of its own `_keywords` and the first-week window arithmetic in `_s08_echo`. The recap's selection is unchanged and `test_memories_recap.py` must pass unchanged. Never keep two copies.
  - `backend/api/memories.py`: `/memoir/day24`, `/then-now/day`, `/then-now/first-week`.
  - `backend/tests/test_memories_fun_api.py`.

**彼女の24時間 (spec §14.1, slots from §3.3):**
- **Slots:** from her JST hour histogram (`facts.aggregate(...).hours`, non-promo words and pictures):
  - the greeting slots `ohayo` (5–9h), `ohiru` (11–13h), `otsukare` (17–19h) and `oyasumi` (21–23h) are kept when she has candidates there;
  - then the busiest remaining hours, at least 2 h from any chosen slot, are added until there are 7 slots or no hour has 1% or more of her messages;
  - fewer than 5 slots → the payload is `{"slots": []}`, and the UI shows the gentle thin-data card, never a sparse day.
- **Slot time:** the histogram's peak hour inside the band, `:30`.
- **Candidates:** her non-promo facts within ±30 min of the slot time of day, in any year.
- **Score:** `slot greeting match (has_greeting(code)) +200, picture/video +100 (+ photo_score / 10), has_nickname +80, favorited +300`, and −150 when the fact's year is already used by an earlier slot (years varied). Promo is excluded, not down-ranked, because spec §3.3 never picks promo as her words.
- **Choice:** a weighted pick among the top 5 by score with `random.Random(seed)`. `seed` = the request's `seed` (🎲), else the JST date ordinal, so reopening on the same day shows the same day.
- `async build_day24(service, sdir, summary, *, seed: int | None, now) -> dict` returns `{"seed": 123, "years": 3, "slots": [{"code": "ohayo" | "hour", "message": message}]}`.
  - Slots are in time-of-day order. Each `message` shows its real JST time and year (metadata).
  - `years` = the distinct years used. The UI uses different copy for 1 year.
  - Not cached: the facts are index-cached and the texts are ≤ 7 ids.
  - Logs `memories_day24` with `slots`, `years` and `rerolled` (bool), and `memories_select` per slot with `view=day24`, `rule=<code>`, `score` and `message_id`.

**あの日と今日 (spec §14.2):**
- `keywords_in(text) -> list[str]`: the `ECHO_KEYWORDS` contained in the NFKC text. Shared with the recap.
- `first_week_window(begin: date) -> tuple[date, date]` = `(begin, begin + 6 days)`. Shared with the recap.
- `async then_now_day(service, sdir, day: date, *, member: MemberSummary | None, now) -> dict | None` returns:

```json
{"mode": "day",
 "then": {"year": 2023, "date": "2023-11-10", "member_path", "name", "avatar_url", "items": [message]},
 "now":  {"year": 2025, "date": "2025-11-10", "member_path", "name", "avatar_url", "items": [message]},
 "shared_keyword": "誕生日" | null}
```

  - `then` is `day`.
  - `now` is the same month-day this year when that date is ≤ today and has messages, else the latest later year that has messages on that month-day. If no later year exists, the result is `None` and the toggle is hidden.
  - **Person:** `member` if given. Otherwise the person who posted on both dates (oshi first, then the higher importance sum). Otherwise each side's own best person, with its own name, so each label is true.
  - **Items per side** (at most 3, the person's facts on that date): the best photo (`photo_score`), the best words (importance), then a voice if any. A message is never repeated.
  - `avatar_url` = the avatar at each side's date.
  - `shared_keyword` = the first `ECHO_KEYWORDS` entry present in both sides' item texts (keywords are checked after `attach_texts`).
  - Never cached (text). Logs `memories_then_now` with `mode=day`, `now_rule=this_year|latest_year|none` and `person=same|split`.
- `async then_now_first_week(service, sdir, summary, *, now) -> dict | None` returns `{"mode": "first_week", "then_range": ["2025-03-01", "2025-03-07"], "now_range": [...], "rows": [{"kind": "photo" | "ohayo" | "voice", "then": message, "now": message}], "avatar_then", "avatar_now"}`.
  - `begin` = the subscription start (`binder.subscription_start`), else her first fact's date (the recap rule).
  - The latest week is the 7 JST days ending today. If it overlaps the first week, the result is `None`.
  - Rows (spec: photo / おはよう / voice): `photo` is the best `photo_score` in each week; `ohayo` is the first `ohayo` greeting in the first week and the latest in the latest week; `voice` is the first voice and the latest voice. A row is kept only when both sides exist.
  - No rows → `None`. Logs `memories_then_now` with `mode=first_week` and `rows`.

- [ ] **Step 1:** Write failing tests:
  - `day24`:
    - the greeting slots are kept and extras are spaced ≥ 2 h;
    - fewer than 5 slots → `[]`;
    - the same seed gives the same day and another seed a different one;
    - years vary when possible;
    - promo is never picked;
    - `years` counts distinct years;
    - the ±30 min window across midnight (23:50 vs 00:10).
  - `then_now_day`:
    - this year is used when available;
    - the latest-year fallback when this year's date is in the future (time-machine 2026-11-10, day 2024-12-24 → `now` 2025-12-24);
    - `None` without a later year;
    - a common person is preferred, and the split person labels;
    - at most 3 items with no repeat;
    - `shared_keyword` with a CJK keyword and emoji around it;
    - the avatar at each date.
  - `then_now_first_week`: sub start vs first-fact fallback; overlap → `None`; a row is dropped when one side is missing.
  - `test_memories_recap.py` passes unchanged after the move (run it).
  - API: the three routes (400 for a bad date, 404 for an unknown member).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_day24.py backend/tests/test_memories_then_now.py backend/tests/test_memories_recap.py backend/tests/test_memories_fun_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement. Move the recap constants first, re-run `test_memories_recap.py`, then build the new modules.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve her 24 hours and then-and-now pairs`.

### Task F7: Frontend foundation (types, API, routes, log codes, tokens, i18n test, hub cards)

**Files:**
- Modify:
  - `frontend/src/features/memories/types.ts`:
    - payload types for every endpoint in "Shared contracts": `RadioMembersPayload`, `RadioProgramPayload`, `RadioTrack`, `RadioProgram`, `RadioCassettesPayload`, `GachaStatePayload`, `GachaPull`, `GachaPullPayload`, `CalendarMonthsPayload`, `CalendarMonthPayload`, `CapsuleNote`, `CapsuleNotesPayload`, `CapsuleResurfacePayload`, `SameTimeMoment`, `Day24Payload`, `ThenNowDayPayload` and `ThenNowFirstWeekPayload`;
    - widen `HubPayload.same_time: SameTimeMoment | null`, `capsule: CapsuleResurfaceItem | null` and `gacha_left: number`;
    - `HubCounts` gains `voices` and `days`.
  - `frontend/src/features/memories/api.ts`: `fetchRadioMembers`, `fetchRadioProgram`, `fetchRadioCassettes`, `fetchGacha`, `postGachaPull` (409 → a typed `{status: 'no_pulls_left'}`), `fetchCalendarMonths`, `fetchCalendarMonth`, `putAlbumCover`, `deleteAlbumCover`, `fetchCapsule`, `fetchCapsuleDue`, `postCapsule`, `putCapsule`, `deleteCapsule`, `fetchSameTime`, `fetchDay24` and `fetchThenNowDay`, `fetchThenNowFirstWeek`.
    - Writes use the same timeout and error classes as reads.
    - Add a small `sendJson(method, url, body, signal)` beside `getJson`.
  - `frontend/src/features/memories/MemoriesFeature.tsx`: the four routes and the `day24` memoir tab (placeholders until their tasks). Update the `MemoriesRoute` comment ("wave 4 adds …" becomes the real union).
  - `frontend/src/features/memories/memoriesLog.ts`:
    - `MEMORIES_PAGES` / `MEMORIES_PAGE_CODES` add `radio`, `gacha`, `calendar` and `day`;
    - `MEMORIES_VIEWS` adds `radio`, `radio_members`, `radio_program`, `radio_cassettes`, `gacha`, `calendar`, `calendar_months`, `capsule`, `capsule_due`, `same_time`, `day24` and `then_now`;
    - `MEMORIES_TOGGLES` adds `radio_program`, `cassette`, `sleep_timer`, `then_now`, `then_now_mode`, `calendar_member` and `album_cover`;
    - `MEMORIES_SKIP_REASONS` adds `transcript_missing`, `pull_missing`, `day24_thin`, `note_empty` and `same_time_none`;
    - new loggers `logMemoriesRadio(phase, extra)` with phases `play`, `track`, `track_error`, `pause`, `resume`, `sleep_set`, `sleep_fade`, `end` and fields `kind` (program code), `index`, `count`, `reason`, `outcome`;
    - `logMemoriesGacha(phase, extra)` with phases `open`, `pull`, `reveal`, `refused`, `favorite`, `context` and fields `kind` (rarity), `reason`, `count`, `index`, `outcome`, `message_id`;
    - `logMemoriesCapsule(phase, extra)` with phases `open`, `save`, `delete`, `failed`, `resurface_open` and fields `kind` (`day|card`), `count`, `outcome`, `error_code`. Never the body.
  - `backend/api/client_log.py`: the events `memories_radio`, `memories_gacha` and `memories_capsule`. Add field names only if missing; `phase`, `kind`, `index`, `count`, `reason`, `outcome`, `message_id` and `error_code` already exist.
  - `backend/tests/fixtures/memories_log_codes.json`: every new code above, under its `event.field` key (`memories_radio.phase`, `memories_gacha.phase`, `memories_gacha.kind`, `memories_capsule.phase`, …).
  - `frontend/src/features/memories/home/hubCards.ts`: append `radio` (`Radio` icon, count `voices`, `memories.home.countVoices`), `gacha` (`Gift` icon, count `gacha_left`, `memories.home.countGacha`) and `calendar` (`CalendarDays` icon, count `days`, `memories.home.countDays`).
    - `HubCounts` keys must match. `gacha_left` comes from the payload's top level, so `hubCardCount` gets an optional `extra` map, or the hub merges `{...counts, gacha_left}`: pick one and document it.
    - A 0 count is hidden (existing rule).
  - `frontend/src/design/tokens/memories.ts`, `design/cssVars.ts`, `frontend/tailwind.config.js` and `docs/design/DESIGN_SYSTEM.md` ("Memories keepsake surfaces"): new semantic tokens and utilities, following the core pattern:
    - `gacha` rarity: `bg-memories-rarity-n` (neutral, `border-strong` family), `bg-memories-rarity-r` (a rose distinct from the oshi pink) and `bg-memories-rarity-sr` (the gold from the `foil` stops);
    - the radio night: `bg-memories-night` (a deep navy gradient from the aurora stops) and `text-memories-night-ink`;
    - `memories-onair` (a warm red lamp distinct from danger), documented as an indicator, not an error;
    - the 24h sky: `bg-memories-sky` (dawn → day → dusk → night stops for a vertical gradient);
    - the capsule note: `bg-memories-note` (a warm paper yellow distinct from the favourite star).
    - Document each one as semantic (it never follows the group accent).
- Create:
  - `frontend/src/i18n/memoriesFun.test.ts` (`MEMORIES_FUN_KEYS`, `MEMORIES_FUN_EN_PLURALS`, the recursive lookup in 5 locales, modelled on `memoriesCore.test.ts`);
  - `frontend/src/design/memoriesFunTokens.test.ts`.
- Tests: extend `api.test.ts`, `memoriesLog.test.ts` (fixture parity for the new lists), `MemoriesFeature.test.tsx` (each new route renders its placeholder and logs its snake_case page code) and `home/hubCards.test.ts` (new cards, hidden zero) in place. Extend `backend/tests/test_client_log_api.py` to post every new code from the fixture.
- Locales (ja reference): `memories.home.radio` 「ボイスラジオ」, `.gacha` 「思い出ガチャ」, `.calendar` 「カレンダー」, `.countVoices` 「{{count}} 件のボイス」, `.countGacha` 「今日はあと {{count}} 回」, `.countDays` 「{{count}} 日分」.

- [ ] **Step 1:** Write the failing tests above.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories src/design src/i18n/memoriesFun.test.ts && cd ..` and `uv run pytest backend/tests/test_client_log_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same commands, plus `cd frontend && npx vitest run src/design/guard.test.ts && npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the fun-wave routes, API client, codes and tokens`.

### Task F8: One voice coordinator for every Memories player

**Files:**
- Create:
  - `frontend/src/features/memories/shared/clipSequencer.ts`: moved from `recap/voicePlayback.ts` with `git mv`, so history follows. Keep `ClipSequencer`, `SequencerClip`, `CROSSFADE_MS` and `createAudioElement`. `SequencerClip.segments` becomes the shared `TranscriptSegment` type (`{start, end, text}`), declared in `types.ts`; the recap's `RecapTranscriptSegment` aliases it.
  - `frontend/src/features/memories/shared/clipSequencer.test.ts`: moved from `recap/voicePlayback.test.ts`, plus the new cases.
  - `frontend/src/features/memories/shared/voicePlayback.test.ts`.
- Modify:
  - `shared/clipSequencer.ts` additions, keeping existing behaviour:
    - options `{ crossfadeMs?: number (default CROSSFADE_MS); gapMs?: number (default 0) }`, where `crossfadeMs: 0` + `gapMs` plays whole clips back to back with a silent gap;
    - `skipTo(index)`, `next()`, `prev()` (prev restarts the current clip when it is more than 3 s in);
    - `fadeOut(ms): Promise<void>`: ramps every live slot to 0 over `ms`, then `stop()`;
    - `onProgress?: (index, currentTime) => void` in the events;
    - `analyser(): HTMLAudioElement | null` returns the live element for the waveform.
  - `shared/voicePlayback.ts`: the coordinator becomes `{ playing: string | null; handle: PlayerHandle | null }`, with `PlayerHandle = { stop(): void; fadeOut(ms: number): Promise<void> }`.
    - `play(key, handle?)` stops the previous handle and stores the new one.
    - `stop(key?)` calls the handle's `stop`.
    - `fadeOutMemoriesVoices(ms)` fades the current handle, or stops one that cannot fade. The radio's sleep timer uses it.
    - `stopMemoriesVoices()` is unchanged for callers.
    - Docstring: "the only place that decides which Memories voice plays".
  - `shared/LazyVoice.tsx`: registers a handle whose `fadeOut` is an immediate stop, because the compact `VoicePlayer` has no ramp.
  - `recap/slides/S06Voice.tsx`: import from `shared/clipSequencer` and join the coordinator with key `recap|s06`. Pressing ▶ stops any other Memories voice, and another voice starting stops the slide's sequence (`onEnd` is not called for an external stop; log `recap_play` `voice_end` with `reason=preempted`).
  - Delete `recap/voicePlayback.ts` once its imports move.
  - Add `preempted` to `recap_play` reasons in the docstring. `reason` is a free code field, so the fixture needs no change.
- Tests:
  - the existing sequencer tests pass unchanged after the move;
  - new: `crossfadeMs: 0` with `gapMs` hands over without overlap;
  - `skipTo` / `next` / `prev`;
  - `fadeOut` ramps to 0 and resolves;
  - `voicePlayback`: playing B stops A's handle; `fadeOutMemoriesVoices` calls `fadeOut` on a fading handle and `stop` on a plain one;
  - `LazyVoice` stops when the radio key plays;
  - `S06Voice`: an external `play` stops the sequence and logs `preempted`. The existing S06 tests pass.

- [ ] **Step 1:** `git mv` the two recap files to `shared/`, fix the imports and run `cd frontend && npx vitest run src/features/memories/recap src/features/memories/shared`. Expect PASS (a pure move).
- [ ] **Step 2:** Write the failing new tests.
- [ ] **Step 3:** Run `cd frontend && npx vitest run src/features/memories/shared src/features/memories/recap src/features/memories/favorites`. Expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the same command, plus the guard and `npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 6:** Commit `refactor(memories): share one voice coordinator and clip sequencer`.

### Task F9: Voice radio page (station, programs, sleep timer, cassettes)

**Files:**
- Create in `frontend/src/features/memories/radio/`:
  - `RadioPage.tsx`:
    - Left: `MemberPane` with 「全員」 plus the members from `fetchRadioMembers`. The trailing slot shows the total length only (`formatVoiceLength`: 「3時間12分」 / 「42分」), which keeps one number per row. Oshi heart as in the core.
    - Right: `Station`.
    - Leaving the page or switching member calls `stopMemoriesVoices()`.
  - `Station.tsx`: a `bg-memories-night` surface with `text-memories-night-ink`. The night look is the station's brand moment and does not depend on the clock.
    - Header: the ON AIR lamp (`memories-onair`; lit only while playing, with `aria-live="polite"` announcing on air / off air) and the serif station title: 「{{name}}の深夜放送局」 for a member, 「深夜放送局」 for 全員.
    - A program card row, `ProgramCard` × available programs: title, subtitle and one number (the track count). Only `payload.programs` are drawn, so 精選 appears only when it has clips.
    - Now playing (`NowPlaying`), the controls and the sleep timer.
    - Picking `chrono` reveals the `CassetteShelf` above the queue.
  - `NowPlaying.tsx`:
    - her avatar at the time (`resizedAvatarUrl(track.message.avatar_url, …)`), the JST date and time (`formatJstDate` + `formatJstClock`; metadata) and the duration;
    - a `Waveform`;
    - lyrics (`Lyrics`) when `has_transcript` (or the clip's `segments`).
  - `Waveform.tsx`: live bars from a Web Audio `AnalyserNode` attached once per sequencer element (`createMediaElementSource`, guarded). Without `AudioContext`, or under `prefers-reduced-motion`, it draws a static bar row. Bar colours come from tokens via CSS variables.
  - `Lyrics.tsx`: segments as lines, the current one highlighted by `currentTime`, scrolled into view inside its own box (`MemoryText`, so `%%%` → nickname). The current track's transcript is loaded on demand through the existing `GET /api/transcription/{service}/{id}?member_path=` (reuse the fetch from `hooks/useTranscription.ts`; do not copy it). A 404 or a failure hides the lyrics and logs `memories_skip` with `reason=transcript_missing`.
  - `useRadioPlayer.ts`: owns one `ClipSequencer` per program start.
    - Regular programs use `{crossfadeMs: 0, gapMs: 800}`, playing whole voices. `oyasumi_clips` uses `{crossfadeMs: CROSSFADE_MS}` over the clip windows.
    - It registers with the coordinator under the key `radio`, and exposes `{status, index, track, play(program), toggle(), next(), prev(), stop()}`.
    - Errors skip on (`track_error`). The end of the queue → `end`, and the lamp goes off.
  - `SleepTimer.tsx`: a `Pill` menu with off / 15 / 30 / 60 min. When the timer expires it calls `fadeOutMemoriesVoices(10_000)` and turns the lamp off. While armed it shows 「あと {{count}} 分」. Logs `sleep_set` (`count` minutes) and `sleep_fade`.
  - `CassetteShelf.tsx` (spec §11 B): one tape per year from `fetchRadioCassettes`. The label colour is the year colour through `style` (the data-driven exception already documented for the album ribbon), with a neutral tape for `null`. The label carries the year and the length. ← / → move between tapes (older / newer), Enter loads the year (`year` query), and the selected tape has a pressed state. Logs `memories_toggle` with `target=cassette`.
  - `radioFormat.ts`: `formatVoiceLength(seconds)` (reuse `formatDuration` from `utils/classnames` where it fits) and `programCopy(code)` → i18n keys.
  - Tests: `RadioPage.test.tsx`, `Station.test.tsx`, `useRadioPlayer.test.ts` (fake element factory), `SleepTimer.test.tsx` (fake timers), `CassetteShelf.test.tsx`, `Lyrics.test.tsx`.
- Modify: `MemoriesFeature.tsx` (the `radio` route).
- Locales (ja reference):
  - `memories.radio.title` 「ボイスラジオ」, `.all` 「全員」, `.station` 「{{name}}の深夜放送局」, `.stationAll` 「深夜放送局」, `.onAir` 「ON AIR」, `.offAir` 「OFF AIR」;
  - programs `.programs.oyasumi` 「おやすみ放送」 / `.programs.oyasumiSub` 「夜9時から明け方までの声」, `.ohayo` 「おはよう放送」 / 「朝5時から10時までの声」, `.otsukare` 「おつかれチャージ」 / 「昼から夜までの声」, `.chrono` 「あの頃から順番に」 / 「選んだ年を、はじめから」, `.favorites` 「★ お気に入りの声」 / 「★をつけたボイス」, `.oyasumiClips` 「精選・おやすみだけ」 / 「“おやすみ”のところだけ」;
  - `.trackCount` 「{{count}} 件」, `.play` 「再生」, `.pause` 「一時停止」, `.next` 「次の声」, `.prev` 「前の声」;
  - `.sleep` 「おやすみタイマー」, `.sleepOff` 「タイマーなし」, `.sleepMinutes` 「{{count}} 分後に止める」, `.sleepLeft` 「あと {{count}} 分」;
  - `.cassette` 「{{year}}年のテープ」, `.cassetteLength` 「{{length}}」, `.empty` 「ここで流せる声は、まだありません。」.

- [ ] **Step 1:** Write failing tests:
  - the member list trailing shows the length and no count;
  - only the payload's programs are drawn, and 精選 is absent without clips;
  - picking a program starts the sequencer with the right options (gap vs crossfade) and lights the lamp;
  - next / prev / pause;
  - a track error skips and logs;
  - another Memories voice (`useVoicePlayback.play('x')`) stops the radio and turns the lamp off;
  - the sleep timer fades through `fadeOutMemoriesVoices` at expiry (fake timers) and logs;
  - lyrics highlight the current segment and hide on a 404;
  - the cassette shelf: keyboard selection loads `year`, and a `null` colour gets the neutral tape;
  - the waveform falls back to static without `AudioContext`;
  - the empty state appears with no voices (no "0").

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/radio src/i18n/memoriesFun.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. The station is fixed-viewport: only the lyrics box and the cassette row scroll.
- [ ] **Step 4:** Run the tests plus `npx vitest run src/design/guard.test.ts && npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the late-night voice radio`.

### Task F10: Gacha page

**Files:**
- Create:
  - `frontend/src/utils/favoriteApi.ts`: `setFavorite(service, messageId, on, signal?) -> Promise<boolean>`, extracted from `MessagesFeature.tsx` (the POST / DELETE `/api/favorites/{id}?service=` call with the SD-CONTRACT-01 `success: false` check). `MessagesFeature.tsx` calls it; its behaviour and tests are unchanged. Add `frontend/src/utils/favoriteApi.test.ts`.
  - In `frontend/src/features/memories/gacha/`:
    - `GachaPage.tsx`: `PageHeader`, the machine stage on the left and the revealed card on the right (they stack under `md`), with the history strip along the bottom. With `available: false`, show an `EmptyState` with gentle copy.
    - `CapsuleMachine.tsx`: a glass dome with capsules, the knob and the slot (CSS shapes from tokens).
      - The knob turns by pointer drag (rotate past 270° to pull) or by click, or Enter / Space when focused (`role="button"`, `aria-label`).
      - It is disabled while a pull is in flight and when `pulls_left === 0`. Under the knob it shows 「今日はあと {{count}} 回」, or 「また明日」 at 0.
      - The capsule rolls out (framer-motion) in its rarity colour (`bg-memories-rarity-*`) and opens into the card. Under reduced motion it fades.
    - `GachaCard.tsx`:
      - the rarity label (`N` / `R` / `SR`) with its reason line;
      - the content: her words (`MemoryText`), a photo (`MemoryThumb px={320}`) or a voice (`LazyVoice`, key `gacha|<room>|<id>`);
      - the member name and the JST date and time (metadata);
      - a context link (opens `FilmStrip` from the core for that date and id);
      - a ★ button (`setFavorite`, optimistic, reverted on failure, favourite-yellow token).
      - SR wears the foil overlay (`bg-memories-foil`, static under reduced motion).
      - A `pull_missing` history item renders as a date-only card.
    - `PullHistory.tsx`: a horizontal row of small capsules (rarity colour) with dates, newest first. Clicking one reopens its card. It scrolls inside itself.
    - `rarityCopy.ts`: reason code → i18n key (every code from F3).
    - Tests: `GachaPage.test.tsx`, `CapsuleMachine.test.tsx`, `GachaCard.test.tsx`, `PullHistory.test.tsx`, `rarityCopy.test.ts`.
- Modify: `MemoriesFeature.tsx` (the `gacha` route), `frontend/src/features/messages/MessagesFeature.tsx` (use `setFavorite`).
- Locales (ja reference):
  - `memories.gacha.title` 「思い出ガチャ」, `.turn` 「ハンドルを回す」, `.left` 「今日はあと {{count}} 回」, `.tomorrow` 「また明日」, `.history` 「これまでに出た思い出」, `.context` 「この日の前後を見る」, `.favorite` 「★をつける」, `.unfavorite` 「★をはずす」, `.empty` 「ガチャに入れる思い出が、まだありません。」, `.missing` 「このメッセージは見つかりませんでした」;
  - rarity `.rarity.n` 「ノーマル」, `.rarity.r` 「R」, `.rarity.sr` 「SR」;
  - reasons `.reason.midnight` 「日付が変わった瞬間」, `.birthday` 「お誕生日のメッセージ」, `.subAnniversary` 「あなたの記念日のメッセージ」, `.lastMessage` 「最後のメッセージ」, `.nickname` 「名前を呼んでくれた」, `.favorite` 「★をつけたメッセージ」, `.voice` 「声」, `.message` 「メッセージ」, `.photo` 「写真」.

- [ ] **Step 1:** Write failing tests:
  - the knob click and Enter pull once (`postGachaPull` mocked) and log `pull` + `reveal` with the rarity;
  - a drag of less than 270° does not pull;
  - double clicks while in flight make one request;
  - 409 shows 「また明日」 and logs `refused`;
  - `pulls_left` 0 disables the knob and shows no "0";
  - an SR card has the foil class and is static under reduced motion;
  - a voice card plays through `LazyVoice` (coordinator);
  - ★ is optimistic and reverts on `success: false`;
  - the context link opens `FilmStrip` with the id;
  - a history click reopens the card;
  - a `pull_missing` card is date-only;
  - every reason has copy;
  - `favoriteApi` covers the success, HTTP error and `success: false` paths, and `MessagesFeature`'s existing favourite tests still pass.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/gacha src/utils/favoriteApi.test.ts src/features/messages src/i18n/memoriesFun.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the memory gacha`.

### Task F11: Calendar album, the day route and the cover override UI

**Files:**
- Create:
  - `frontend/src/core/calendar/monthGrid.ts`: `buildMonthGrid(year, month0) -> {date: Date, dateStr: string, inMonth: boolean}[]` (42 cells, Sunday first) and `dayTone(date: Date) -> 'holiday' | 'saturday' | null` (Sunday or a 祝日 → holiday; uses `utils/jpHolidays.holidayName`). Both are extracted from `CalendarModal.tsx`'s `calendarDays` and its weekday tone helper. `dateStr` is built from the cell's own Y/M/D, so no time zone applies.
  - `frontend/src/core/calendar/monthGrid.test.ts`.
  - `frontend/src/core/calendar/MonthYearPicker.tsx`: the year column and month grid, extracted from `CalendarModal`'s picker view, with the same focus and `calendar_picker` logging. Props: `years`, `year`, `month`, `hasData(ym)`, `onPick(year, month0)`, `onBack()`.
  - In `frontend/src/features/memories/calendar/`:
    - `CalendarAlbumPage.tsx`:
      - The header has ‹ › months (‹ = older), the title button that opens `MonthYearPicker` (months from `fetchCalendarMonths`; months without data dimmed) and the member filter: a `Select` with 「全員」 plus the members of `fetchMemoirMembers`, oshi first. The filter logs `calendar_member`.
      - The grid fills the pane: weekday header with 日 red, 土 blue (`text-calendar-holiday` / `text-calendar-saturday`), then `DayCell` × 42.
      - The route keeps `month` and `memberPath`.
    - `DayCell.tsx`:
      - the date number (holiday / Saturday tone), the holiday name (`lang="ja"`, truncated);
      - the best photo as the cell background (`MemoryThumb px={cellPx}` with `loading="lazy"`);
      - member dots, at most 5 and never a number. The cell's `aria-label` carries the date, the holiday and 「{{count}} 人のメンバー」, which is the one number, in the accessible name only.
      - Days without data are grey and not clickable. Out-of-month cells are faded.
      - Clicking a day → `go({page: 'day', date, from: 'calendar'})`.
    - `DayPage.tsx`: `PageHeader` (back → `{page: 'calendar', month: date.slice(0, 7)}` when `from === 'calendar'`, else home) plus `DayView` (core) for `route.date`. The capsule strip arrives with Task F12 inside `DayView`.
    - Tests: `CalendarAlbumPage.test.tsx`, `DayCell.test.tsx`, `DayPage.test.tsx`.
- Modify:
  - `frontend/src/core/modals/CalendarModal.tsx`: use `buildMonthGrid`, `dayTone` and `MonthYearPicker`. No behaviour change; every existing `CalendarModal` test passes unchanged.
  - `frontend/src/features/memories/MemoriesFeature.tsx`: the `calendar` and `day` routes.
  - **Cover override UI** (spec §8):
    - `album/PhotoTile.tsx` and `album/PolaroidCover.tsx`: right-click (and the context-menu key / Shift+F10) on a picture or video tile opens a design `Menu` with 「この月の表紙にする」 (`putAlbumCover`). On the cover, when its rule is `override`, the menu offers 「表紙を自動にもどす」 (`deleteAlbumCover`).
    - After either action, `album/AlbumPage.tsx` refetches the months (the existing `useMemoriesQuery` deps gain a `coverVersion` counter).
    - A failure shows the existing inline error toast pattern and logs `memories_toggle` with `target=album_cover` and `outcome=off`.
    - New props: `PhotoTile.onSetCover?(item)`, `PolaroidCover.onResetCover?()`.
  - `album/AlbumPage.test.tsx`, `album/PhotoTile` tests: the context menu.
- Locales (ja reference): `memories.calendar.title` 「カレンダー」, `.all` 「全員」, `.members` 「{{count}} 人のメンバー」, `.prevMonth` 「前の月」, `.nextMonth` 「次の月」, `.pickMonth` 「年月をえらぶ」, `.empty` 「この月の思い出は、まだありません。」; `memories.album.setCover` 「この月の表紙にする」, `.resetCover` 「表紙を自動にもどす」, `.coverFailed` 「表紙を変えられませんでした」.

- [ ] **Step 1:** Write failing tests:
  - `monthGrid`: 42 cells, Sunday first, a month starting on Saturday, the leap February, the holiday tone (2024-09-16 敬老の日 → holiday), Saturday blue;
  - `CalendarModal`: the existing suite is unchanged (run it);
  - `CalendarAlbumPage`: ‹ › change the month (‹ older); the picker dims months without data; the member filter refetches with `member` and logs;
  - cells render the photo thumb through the thumb route; at most 5 dots with no visible digits; grey days are not clickable;
  - a day click routes to `{page: 'day', date, from: 'calendar'}` and logs the `day` page code;
  - `DayPage` back returns to the calendar month;
  - the album context menu sets and resets the cover and refetches; a failure logs `album_cover` `off`.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/core/calendar src/core/modals src/features/memories/calendar src/features/memories/album src/i18n/memoriesFun.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement: extract `monthGrid` / `MonthYearPicker` first and re-run the `CalendarModal` tests, then build the page.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the calendar album and album cover choice`.

### Task F12: 時光膠囊 UI and the 同じ時刻 line (hub and On This Day)

**Files:**
- Create in `frontend/src/features/memories/capsule/`:
  - `CapsuleNoteCard.tsx`: a sticky note (`bg-memories-note`, a `bg-memories-washi` tape strip, a deterministic −2…2° tilt from the id) showing the body (plain text, `whitespace-pre-wrap`; the fan's own words, so no `lang="ja"`) and 「{{date}}に書いたメモ」.
  - `CapsuleEditor.tsx`: a `Modal` with a textarea (the `FIELD_CLASS` style), a live length limit (2000; the count appears only once 1800 is passed), save, delete (with confirm) and cancel. The body is never logged. A failure keeps the draft and shows the error.
  - `CapsuleStrip.tsx`: the notes for one anchor plus an 「メモを貼る」 `Button`. Props `service`, `anchor: {kind: 'day', date} | {kind: 'card', memberPath, cardKey, date}`. Loads `fetchCapsule`, opens the editor and refetches after a save or delete.
  - `CapsuleResurface.tsx`: a resurfaced note beside her message of that day: the note card, 「{{count}}年前のあなたが書いたメモ」 and her message (`MemoryText` + a thumb if it is a photo) with its JST date. Clicking her message opens `{page: 'onThisDay', monthDay, year}` for the anchor date.
  - Tests: `CapsuleStrip.test.tsx`, `CapsuleEditor.test.tsx`, `CapsuleResurface.test.tsx`.
- Create in `frontend/src/features/memories/home/`:
  - `SameTimeLine.tsx` (spec §14.3): a quiet line: 「いま {{clock}}」 (JST, `formatJstClock(now)`) · 「{{year}}年のこの時刻、{{name}}は」 (or 「{{date}}のこの時刻、{{name}}は」 for a this-year moment) · her words in one line (`MemoryText`, clamp 1).
    - It starts from `hub.same_time` and refetches `fetchSameTime` at each JST minute boundary (a `setTimeout` to the next minute), only while the document is visible (`design/primitives/useVisiblePolling` or the `visibilitychange` pattern it uses). It aborts on unmount and hides when `null`.
    - Clicking it opens that day (`{page: 'day', date}`).
  - `SameTimeLine.test.tsx`.
- Modify:
  - `home/HubSlots.tsx`: render `SameTimeLine` above and `CapsuleResurface` below the wrapped On This Day card when non-null. Keep the "renders only children for `null`" test.
  - `day/DayView.tsx`: render `CapsuleStrip` (day anchor, `date`) under the header, for every DayView (OTD detail, the day page, the film strip is not a DayView). Hide it when `memberPath` is set (the film strip / card contexts).
  - `memoir/CardDetail.tsx`: a `CapsuleStrip` with the card anchor (`card.key`, `card.date`). Earned cards only; a silhouette has no date.
  - `onThisDay/OnThisDayPage.tsx` (overview): above the year strip, `CapsuleResurface` × the items of `fetchCapsuleDue(monthDay)`: notes written on this month-day in earlier years. Hidden when empty.
- Locales (ja reference): `memories.capsule.add` 「メモを貼る」, `.edit` 「メモを書きなおす」, `.save` 「しまう」, `.delete` 「はがす」, `.deleteConfirm` 「このメモをはがしますか？」, `.cancel` 「やめる」, `.placeholder` 「この日のこと、あなたの言葉で。」, `.written` 「{{date}}に書いたメモ」, `.yearsAgo` 「{{count}}年前のあなたが書いたメモ」, `.limit` 「あと {{count}} 文字」, `.failed` 「メモを保存できませんでした」, `.local` 「このメモはこのパソコンにだけ保存されます」; `memories.sameTime.now` 「いま {{clock}}」, `.pastYear` 「{{year}}年のこの時刻、{{name}}は」, `.thisYear` 「{{date}}のこの時刻、{{name}}は」.

- [ ] **Step 1:** Write failing tests:
  - the strip lists notes and adds one (`postCapsule` body), and edit / delete refetch;
  - the editor shows the limit only past 1800, blocks an empty body, keeps the draft on failure, and logs `save` / `failed` without the body (assert `clientLog` args);
  - the card anchor in `CardDetail` (earned only);
  - the day anchor in `DayView`, hidden with `memberPath`;
  - `CapsuleResurface` shows the literal `yearsAgo` copy and its message click routes to OTD;
  - the OTD overview shows due notes and hides when empty;
  - `HubSlots` renders the line above and the note below;
  - `SameTimeLine`: refetches at the minute boundary (fake timers), pauses while hidden, hides on `null`, shows the JST clock (frozen `Date` 12:03 UTC → 「いま 21:03」), uses the this-year copy for a this-year moment, and its click routes to the day.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/capsule src/features/memories/home src/features/memories/day src/features/memories/memoir src/features/memories/onThisDay src/i18n/memoriesFun.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add time capsule notes and the same-time line`.

### Task F13: あの日と今日 (OTD ⇆, timeline slot, recap S08) and 彼女の24時間

**Files:**
- Create in `frontend/src/features/memories/thenNow/`:
  - `ThenNowPair.tsx` (shared; the recap uses it too): two sides with a gap marker between them (「{{count}}年」 when both years are known; an arrow only for `first_week`).
    - Each side: the year (serif) or the date range, the avatar at the time, the name when the sides differ, and its items (`MemoryText` / `MemoryThumb px` / `LazyVoice` key `then_now|<room>|<id>`).
    - The older side gets `sepiaClass(year)`.
    - Props: `then`, `now`, `sharedKeyword?`, `variant: 'pane' | 'slide'`. The `slide` variant keeps the recap's typography.
    - `sharedKeyword` is highlighted in both sides through `MemoryText`'s new `highlight?: string` prop (`underline decoration-accent`, the same treatment as the nickname underline).
  - `ThenNowPanel.tsx`: loads `fetchThenNowDay` / `fetchThenNowFirstWeek`.
    - Mode pills 「あの日と今日」 / 「初見と今」; a mode is shown only when its payload is non-null.
    - The 初見と今 mode renders rows (photo / おはよう / voice) as stacked `ThenNowPair`s with row labels.
    - Logs `memories_toggle` `then_now_mode`.
  - `ThenNowToggle.tsx`: an `IconButton` / `Pill` 「⇆ 今年とならべる」 that switches its host between the normal view and `ThenNowPanel`. Logs `memories_toggle` `then_now`. It renders nothing when told the comparison is unavailable.
  - Tests: `ThenNowPair.test.tsx`, `ThenNowPanel.test.tsx`.
- Create in `frontend/src/features/memories/day24/`:
  - `Day24View.tsx` (spec §14.1): the memoir tab `day24`.
    - Title 「{{name}}の一日」 and the subtitle 「{{count}}年分のメッセージから」 (or 「ある年のメッセージから」 when `years === 1`).
    - A vertical day line with the `bg-memories-sky` gradient (morning → night) and 5–7 slots. Each slot shows its JST time and year label (metadata) and her message (`MemoryText`, a thumb or `LazyVoice`).
    - 🎲 (`IconButton`, `memories.day24.reroll` 「ほかの一日をつくる」) refetches with a new random `seed`, logging `memories_load` `day24`.
    - An empty `slots` shows the thin-data card 「もう少しメッセージが届いたら、ここに一日ができます。」 and logs `memories_skip` `day24_thin`.
    - A slot click opens that day (`{page: 'day', date}`).
  - `Day24View.test.tsx`.
- Modify:
  - `onThisDay/OnThisDayDetail.tsx`: pass `DayView` a `headerSlot` with `ThenNowToggle` (available when at least 2 years with messages exist for this month-day). While toggled, the right pane shows `ThenNowPanel` (day mode for `${year}-${monthDay}`) instead of `DayView`. Switching years resets the toggle.
  - `memoir/Timeline.tsx`: add `headerSlot?: React.ReactNode` to `MonthView`'s header (replacing the comment) and pass a `ThenNowToggle`. When toggled, it shows `ThenNowPanel` with the day mode for the month's anchor date (`messages.top`'s JST date, else the first photo's) and the first-week mode for the person. For the current month the day mode is unavailable, so only 初見と今 can show.
  - `memoir/MemoirPage.tsx` and `memoir/MemoirHeader.tsx`: a header chip button 「彼女の24時間」 → `tab: 'day24'` (like the names chip). The `day24` tab renders `Day24View`, with neither binder nor timeline pill selected.
  - `shared/MemoryText.tsx`: the `highlight?: string` prop, plus a test.
  - `recap/slides/S08Echo.tsx`: render through `ThenNowPair variant="slide"`. Keep its narration, pause behaviour and the existing S08 tests; adjust only selectors that name removed internal elements, and say so in the commit body.
- Locales (ja reference): `memories.thenNow.toggle` 「今年とならべる」, `.back` 「もとの表示へ」, `.modeDay` 「あの日と今日」, `.modeFirstWeek` 「初見と今」, `.gap` 「{{count}}年」, `.firstWeek` 「はじめの一週間」, `.latestWeek` 「この一週間」, `.rowPhoto` 「写真」, `.rowOhayo` 「おはよう」, `.rowVoice` 「声」; `memories.day24.tab` 「彼女の24時間」, `.title` 「{{name}}の一日」, `.fromYears` 「{{count}}年分のメッセージから」, `.fromOneYear` 「ある年のメッセージから」, `.reroll` 「ほかの一日をつくる」, `.thin` 「もう少しメッセージが届いたら、ここに一日ができます。」.

- [ ] **Step 1:** Write failing tests:
  - `ThenNowPair`: the older side is sepia, the year gap copy is shown, the keyword is highlighted on both sides, and names are shown only when the people differ.
  - `ThenNowPanel`: hides a mode whose payload is `null`, the pills switch and log.
  - OTD detail: the toggle exists only with ≥ 2 years; toggling swaps `DayView` for the panel with the right date; a year change resets it.
  - Timeline: the header slot renders the toggle; the current month offers only 初見と今.
  - `Day24View`: slots in order with year labels; 🎲 refetches with a different seed; the 1-year copy; the thin state logs `day24_thin`; a slot click routes to the day.
  - The memoir chip routes to `day24`.
  - The recap S08 suite passes.
  - `MemoryText` highlights with emoji and CJK around the keyword.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/thenNow src/features/memories/day24 src/features/memories/onThisDay src/features/memories/memoir src/features/memories/recap src/features/memories/shared src/i18n/memoriesFun.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add then-and-now pairs and her 24 hours`.

### Task F14: Whole-wave verification

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]` → `Added`. Add one end-user line per `docs/DOC_FORMATS.md` (bold lead-in, at most 3 sentences, no code identifiers), merged next to the existing Memories entries. For example: **Listen, draw and leave notes in Memories.** A late-night voice radio with a sleep timer, a daily memory gacha, a photo calendar, and little notes to yourself that come back a year later.
- No new code. Fix whatever the checks below find, inside the task that owns the file.

- [ ] **Step 1: Full backend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run pytest backend/tests -q
uv run mypy backend/services/memories backend/services/app_state.py
uv run ruff check backend && uv run ruff format --check backend
```

- [ ] **Step 2: Full frontend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npx tsc --noEmit
npx vitest run
```

  The run includes `src/design/guard.test.ts` (0 violations in new files), `src/i18n/memoriesCore.test.ts`, `src/i18n/memoriesFun.test.ts` (five locales) and `memoriesLog.test.ts` (fixture parity).
- [ ] **Step 3: Log hygiene:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
timeout 60 grep -rnE "logger\.(info|warning|debug|error)\([^)]*(text|name|path|nickname|member_dir|media_file|body|salt|seed|scope|person_key|segments)=" backend/services/memories backend/api/memories.py backend/services/transcription_service.py
timeout 60 grep -rnE "clientLog\([^)]*(body|text|name|path)" frontend/src/features/memories
```

  Expect no hits other than event *names*. Also confirm that `memories_log_codes.json` lists every code the new loggers can send: `memoriesLog.test.ts` and `test_client_log_api.py` pass.
- [ ] **Step 4: Spec walk-through:**
  - Tick every bullet of spec §4 (the 同じ時刻 line, the voice radio / gacha / calendar entry cards, the 時光膠囊 note on Home), §5.4 (the あの日と今日 toggle), §6 (⇆ side by side), §8 (the override wins), §11, §12, §13 and §14.1–§14.4 against the screens, plus the self-review table below.
  - Record in the ledger:
    - the M4 hooks (`capsule.due_notes`, `cards.earned_keys`, `on_this_day.pick_year`, `gacha_left`);
    - the acceptance items: radio night surface and waveform feel, gacha odds feel, capsule copy, 24h copy, the cassette colours, and the yue / zh-CN native read.
- [ ] **Step 5:** Commit `docs(changelog): note the Memories radio, gacha, calendar and notes`.

---

## Self-review

**Spec coverage:**

| Spec | Where |
|---|---|
| §4 同じ時刻 line above the On This Day card | F5 `same_time` + hub, F12 `SameTimeLine` in `HubSlots` |
| §4 entry cards: voice radio, gacha, calendar album (with counts) | F5 `counts.voices/days`, `gacha_left`; F7 `HUB_CARDS` |
| §4 時光膠囊 note on Home | F5 `hub.capsule` via `capsule.resurfacing`; F12 `CapsuleResurface` in `HubSlots` |
| §5.4 あの日と今日 toggle in the timeline | F6 `then_now`, F13 `Timeline` `headerSlot` + `ThenNowToggle` |
| §6 ⇆ side by side with this year (OTD detail) | F6 `then_now_day`, F13 `OnThisDayDetail` via `DayView.headerSlot` |
| §7 那一天 shared by the calendar | F11 `{page: 'day'}` + `DayPage` → core `DayView` |
| §8 user override wins for album covers | F1 table, F4 `covers.*` + routes, F11 `PhotoTile` / `PolaroidCover` menu |
| §11 A station: ON AIR lamp, station title, program cards, now-playing with avatar at the time + waveform, lyrics transcript, controls, sleep timer fade-out | F2 `radio_program`, F8 coordinator / `fadeOut`, F9 `Station` / `NowPlaying` / `Waveform` / `Lyrics` / `SleepTimer` |
| §11 programs おやすみ / おはよう / おつかれ by verified hours, あの頃から順番に, ★, 精選・おやすみだけ (transcripts only, crossfaded) | F2 `PROGRAMS`, `program_of`, `transcripts.keyword_clips`; F9 `useRadioPlayer` options |
| §11 B cassettes, one per year, label colour from that year's photos | F2 `radio_cassettes` (album colours), F9 `CassetteShelf` |
| §11 left list 全員 + members with voice totals | F2 `radio_members`, F9 `RadioPage` |
| §12 capsule machine, knob drag / click, capsule colour = rarity, card with words / photo / voice, date, context link, ★ | F10 `CapsuleMachine` / `GachaCard` / `favoriteApi` |
| §12 3 pulls per day, history below | F1 `memories_gacha_pulls`, F3 `MAX_PULLS` / `gacha_state`, F10 `PullHistory` |
| §12 rarity N / R / SR rules, promo never drawn, weighted by rarity and importance | F3 `classify`, pool, `TIER_ODDS`, weights; deterministic per JST day (seeded) |
| §13 Japanese calendar (Sunday first, Sun / 祝日 red, Sat blue, holiday names, year / month picker), best photo per cell, member dots, empty days grey, member filter, click → 那一天 | F4 `calendar_album`, F11 `monthGrid` / `MonthYearPicker` / `CalendarAlbumPage` / `DayCell` |
| §14.1 彼女の24時間: 5–7 slots from her histogram, ±30 min, scoring, years varied, sky gradient, 🎲, on the member page | F6 `day24`, F13 `Day24View` (memoir `day24` tab) |
| §14.2 あの日と今日: N years ago vs this year, older side sepia, avatar at the time; 初見 vs 今 (photo / おはよう / voice); in OTD, the timeline and the recap | F6 `then_now_*`, F13 `ThenNowPair` / `ThenNowPanel`; recap S08 drawn by `ThenNowPair`, keyword logic shared through `lexicon` / `then_now` |
| §14.3 同じ時刻: refreshed each minute, ±2 min, oshi first | F5 `same_time` + `facts_at_clock`, F12 `SameTimeLine` |
| §14.4 時光膠囊: notes on any card or day, local only, resurface one year later on Home and in On This Day | F1 table, F5 `capsule.*`, F12 `CapsuleStrip` (DayView, CardDetail), `CapsuleResurface` (hub, OTD) |
| §15 M4 hooks only | `capsule.due_notes` (F5); `cards.earned_keys`, `on_this_day.pick_year` unchanged |
| §1 principles (one number, never 0, truthful labels, per group, layout, design system, logs, i18n, executors) | Global Constraints; F7 tokens / i18n / codes; F14 checks |

**Placeholders:** none. Every task names its files, interfaces, tests, commands and commit message. The F7 placeholders for the new routes are deliberate and are replaced by F9–F13.

**Name consistency:** the same names are used everywhere:
- the service modules `user_store`, `transcripts`, `radio`, `gacha`, `calendar_album`, `covers`, `capsule`, `same_time`, `day24`, `then_now`;
- the view codes `radio`, `radio_members`, `radio_program`, `radio_cassettes`, `gacha`, `gacha_pool`, `calendar`, `calendar_months`, `calendar_month`, `calendar_cell`, `capsule`, `capsule_due`, `same_time`, `day24`, `then_now`;
- the routes `radio`, `gacha`, `calendar`, `day` and the memoir tab `day24`;
- the program codes `oyasumi`, `ohayo`, `otsukare`, `chrono`, `favorites`, `oyasumi_clips`;
- the rarity codes `n`, `r`, `sr` and the reason codes `midnight`, `birthday`, `sub_anniversary`, `last_message`, `nickname`, `favorite`, `voice`, `message`, `photo`;
- the client events `memories_radio`, `memories_gacha`, `memories_capsule`;
- the backend summary events `memories_radio`, `memories_gacha`, `memories_calendar`, `memories_capsule`, `memories_day24`, `memories_then_now`, `memories_same_time`, `memories_cover`, `memories_user_store`.
