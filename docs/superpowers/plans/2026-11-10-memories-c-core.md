# Memories C — Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the everyday Memories screens (wave 3 "Core" of the spec):
- the hub (§4);
- the member memoir: member list, header chips, 被叫名字的瞬間, the 卡冊 binder and the 時光軸 timeline (§5);
- On This Day (§6);
- the 那一天 day view: merged timeline A and swimlanes B (§7);
- the album (§8);
- the favorites cork board and the film strip (§10).

**Architecture:**
- **Backend:** one service module per screen in `backend/services/memories/`. Each module reads the M1 memory index through the `facts` helpers. Message text comes only from `facts.load_texts`, which is called once per room and only for the ids a payload shows. The routes are added to the `backend/api/memories.py` router that R3 creates.
  - Binder rules live in a pure `cards.py`. The M4 notifications wave reuses it.
  - Text-free payloads are cached in a `memories_view_cache` table in the memory-index DB. Her words are attached after the cache read and are never stored.
  - The album's monthly colours come from Pillow. They are computed in an executor and cached per photo.
- **Frontend:** new pages inside the `memories` feature that R1 created (`frontend/src/features/memories/`). The R1 router (`MemoriesRoute` in `MemoriesFeature.tsx`) gains `onThisDay`, `album`, `memoir` and `favorites` pages. The temporary `MemoriesHome.tsx` becomes the hub board.
  - Reused as they are: the chat `MessageBubble`, `MediaViewerModal`, `openChat`, `CalendarModal` and `Avatar`.
  - Reused after a small extraction: the blogs `TimelineRail` fisheye.

**Tech Stack:** FastAPI, SQLite (stdlib), Pillow (already a dependency); pytest + time-machine (already in the dev group); React 18 + TS, framer-motion 10 (already in `package.json`), lucide-react; vitest + Testing Library.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-11-10-memories-design.md`. The spec is the source of truth for screen content: §1 (principles, binding), §3.3 (selection), §4–§8 and §10. The §14 presentations (24h, あの日と今日, 同じ時刻, 時光膠囊), the calendar (§13), voice radio (§11) and gacha (§12) belong to wave 4. This wave leaves the hooks named below for them.
- **Prerequisites:** these recap tasks are merged on `feat/memories`:
  - R1: Memories feature entry, `MemoriesFeature` router, `memoriesLog.ts`, the `memories_open` / `memories_page` client-log events.
  - R3: `backend/api/memories.py` registered in `backend/main.py`, with the service, member-path and year validation helpers.
  - Read R2's `recap.py` before Task C1. If R2 already wrote a helper this plan names (a raw sentence splitter, a message-object builder, a letters reader, a test-archive builder), move that helper into the module named here and import it from both places. Never keep two copies.
- **Content limits (§1.1, §1.5):** at most one number per moment, always next to her real words, photo or voice. Never render "0" or call out an absence. Thin data switches to another presentation or hides the element. Nothing may imply that she replied to the fan or knew about the fan: letters are the fan's own items and are never paired with her messages.
- **Per group (§1.2):** every screen is scoped to the active service. The only cross-service data is the day view's 「包含其他團體」 toggle.
- **Layout (§1.3):** a list on the left and a content pane on the right. Use paged or fixed-viewport compositions; the content pane scrolls inside itself, never the whole page.
- **Design system:** read `docs/design/DESIGN_SYSTEM.md` before any UI task.
  - Use only `frontend/src/design/` tokens and primitives (`Card`, `Pill`, `Avatar`, `Button`, `IconButton`, `Modal`, `EmptyState`, `Atmosphere`, `DatePill`, `Switch`).
  - No hex/rgb literals in TS/CSS, and no arbitrary radius/shadow/text/spacing values (`design/guard.test.ts`).
  - Group colour is only for identity, the current state and one primary action. 推 pink (`tone="oshi"`), the yellow favourite star and danger are semantic and never follow the group accent.
  - Headings use the serif display face (`font-display`). Her words get `lang="ja"`.
  - ← / ‹ always means older and → / › newer (see "Left is older, right is newer").
  - The album's colour-ribbon colours are runtime data from the backend. They are applied through `style` and documented as a data-driven exception (Task C7).
- **i18n:** every user-facing string is a key in all five locales: `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`, under `memories.*`. Japanese is the reference copy (given per task). `frontend/src/i18n/memoriesCore.test.ts` (Task C7) holds the key list, and every UI task appends its keys to it. English plurals use the repo's `<key>_other` pattern.
- **Logs:** ids, codes, counts and scores only. Never log message text, nicknames, member names or paths, including `member_dir` and `media_file`. Use `member_id` or `person=<first member_id>` for people.
  - Every selection, skip and fallback writes a structured breadcrumb.
  - The backend logs a selection as `memories_select` with `view`, `rule`, `score`, `fallback`, `message_id`; a skip as `memories_skip` with `view` and `reason`; and a cache read as `memories_view_cache` with `view` and `outcome=hit|miss|uncacheable`.
  - The frontend logs `memories_load` (`target`=view code, `outcome`=`ok|error`, `count`), `memories_jump` (`target`=source view, `has_target`) and `memories_toggle` (`target`=control code, `outcome`=`on|off`).
- **Data access:** read facts only through `facts.get_facts`, `facts.get_person_facts` and the new `facts.get_facts_on`, then use the pure helpers (`select`, `aggregate`, `year_aggregates`, `on_date`, `bursts`, `voice_durations`, `first_last`). Read `messages.json` only through `facts.load_texts(service_data_dir, service_data_dir / room, ids)`: once per room per request, always with an id set, always in `asyncio.to_thread`.
- **Engineering:**
  - Use `uv run` and never pip. Commit with `uv run git commit`: Conventional Commits, subject ≤ 72 chars, plus the `Co-Authored-By` trailer.
  - File I/O is `utf-8`. Use `pathlib` only. No `print()`.
  - CPU or disk work runs in `asyncio.to_thread`. Use `time-machine` for date-dependent tests.
  - Logging uses `structlog.get_logger(__name__)`.
- **Branch:** `feat/memories` in SakaDesk.

## Shared contracts (all tasks)

**People and paths.**
- A *person* is an `index.MemberSummary`: one member across her 1:1 rooms. Communal rooms are already excluded.
- A *room* is a relative POSIX `member_dir` from `summary.member_dirs`, e.g. `messages/34 金村 美玖/58 金村 美玖`.
- `member_path` is the path the chat uses: `<service display name>/<room>`. The frontend sends the path of any of the person's rooms. The backend resolves it to the person and answers for the whole person.
- `person_key` = `"|".join(sorted(summary.member_dirs))`. It is used only as a cache key and is never logged.

**Message object.** Every payload that shows a message uses this shape. It extends the recap's message object, so the R4 components can render it too.

```json
{"id": 123, "room": "messages/34 金村 美玖/58 金村 美玖",
 "member_path": "日向坂46/messages/34 金村 美玖/58 金村 美玖", "service": "hinatazaka46",
 "ts": "2024-09-14T12:52:00Z", "type": "text|picture|video|voice",
 "text": "raw text with %%% kept" | null, "caption": "paired text" | null,
 "media_url": "/api/content/media/..." | null, "media_file": "messages/.../picture/123.jpg" | null,
 "duration_s": 12.5 | null, "favorited": false, "avatar_url": "/api/content/media/..." | null}
```

- `text` is the message's own content.
- `caption` is the text of `caption_id` when that id differs from the message's own id.
- `media_file` is service-relative with `/` separators. The frontend's `buildMediaUrl` and `MessageBubble` take it as it is.
- `avatar_url` is her avatar at that moment (`people.AvatarTimeline.at`), or `null` when unknown.
- The frontend replaces `%%%` / `％％％` with the nickname in private views only (`applyNickname` semantics, `frontend/src/features/messages/utils/nickname.ts`).

**Endpoints added by this wave.** All are `GET` under `/api/memories/{service}`.

| Path | Query | Service function | Task |
|---|---|---|---|
| `/memoir/cards` | `member` | `binder.build_binder` | C2 |
| `/memoir/members` | — | `memoir.list_memoir_members` | C3 |
| `/memoir` | `member` | `memoir.memoir_header` | C3 |
| `/memoir/names` | `member`, `year?` | `nickname_moments.nickname_moments` | C3 |
| `/memoir/timeline` | `member` | `timeline.timeline_months` | C3 |
| `/memoir/timeline/{month}` | `member` | `timeline.timeline_month` | C3 |
| `/on-this-day` | `date` (`MM-DD`) | `on_this_day.on_this_day` | C4 |
| `/day` | `date` (`YYYY-MM-DD`), `member?`, `others?` (bool) | `day_view.day_view` | C4 |
| `/album/members` | — | `album.album_members` | C5 |
| `/album/months` | `member?`, `kind` | `album.album_months` | C5 |
| `/album/month/{month}` | `member?`, `kind` | `album.album_month` | C5 |
| `/album/colors` | `member?` | `album_colors.month_colors_for` | C5 |
| `/favorites` | `member?` | `favorites_board.favorites_board` | C6 |
| `/hub` | — | `hub.build_hub` | C6 |

API validation is the same for every route:
- unknown service → 400;
- a `member` path that is malformed or escapes the output dir → 400 (`archive_urls.resolve_within`);
- a valid path with no matching person → 404;
- a bad `date`, `month` (`^\d{4}-(0[1-9]|1[0-2])$`) or `kind` (`all|picture|video|favorite`) → 400.

No response contains an absolute path.

**Frontend routes** added to `MemoriesRoute`:

```ts
| { page: 'onThisDay'; monthDay?: string; year?: number }   // year set = detail (A)
| { page: 'album'; memberPath?: string }
| { page: 'memoir'; memberPath?: string; tab?: 'binder' | 'timeline' | 'names' }
| { page: 'favorites'; memberPath?: string }
```

Wave 4 adds `{ page: 'day'; date: string }` for the calendar and reuses `DayView`.

---

### Task C1: Shared backend plumbing (people, view cache, date facts, lexicon)

**Files:**
- Create: `backend/services/memories/people.py`, `backend/services/memories/view_cache.py`, `backend/tests/memories_archive.py` (test-archive builder, a helper module rather than a conftest), `backend/tests/test_memories_people.py`, `backend/tests/test_memories_view_cache.py`
- Modify:
  - `backend/services/memories/facts.py`: add `facts_on_month_day` and `get_facts_on`, and list them in the module docstring's API section. `facts.py` and `index.py` were being edited while this plan was written, so re-read the current files first.
  - `backend/services/memories/lexicon.py`: add `RAW_SENTENCE_SPLIT_RE = re.compile(r"[。！？!?\n]+")` (matches raw, un-normalised text), `CHRISTMAS_RE = re.compile(r"クリスマス|メリクリ|🎄")` and `VALENTINE_RE = re.compile(r"バレンタイン|チョコ")`. Reuse R2's constants if R2 added equivalents. The lexicon fingerprint changes `INDEX_VERSION`, so every cached index row rebuilds once. This is acceptable because the index has not been released.
  - `backend/tests/test_memories_facts.py`: add tests for the date helpers.

**Interfaces:**

`facts.py`:
- `facts_on_month_day(service_data_dir, member_dir, month_day: str) -> list[Fact]`: blocking. Uses `WHERE service_dir=? AND member_dir=? AND substr(jst_date, 6)=?`, ordered by `(ts_utc, id)`.
- `async get_facts_on(service_data_dir, member_dir, *, day: date | None = None, month_day: str | None = None) -> list[Fact]`: exactly one of the two arguments must be given (else `ValueError`). Runs the freshness check that `get_facts` runs (`get_member_index`, `[]` when the index is unavailable), then `facts_for_date` or `facts_on_month_day` in a thread. Read errors give `[]` plus `memory_facts_read_failed`.

`people.py` (one importable home for the cross-screen helpers):
- `service_data_dir(service: str) -> Path`: `path_resolver.resolve_service_path(service)`. Raises `ValueError` for an unknown service.
- `output_dir() -> Path`: `path_resolver.get_output_dir()`.
- `person_key(summary) -> str`; `chat_path(sdir: Path, room: str) -> str` (`f"{sdir.name}/{room}"`).
- `async resolve_person(sdir: Path, member_path: str) -> MemberSummary | None`:
  - First validate `output_dir() / member_path` with `archive_urls.resolve_within`. Let `ArchiveReadError` propagate; the API maps it to 400.
  - Then require the first segment to equal `sdir.name` (else `ArchiveReadError`).
  - Match the rest against `summary.member_dirs` from `index.list_members(sdir)`. Log `memories_person_resolved` with `found` and `rooms` (count).
- `async oshi_rooms(service, summaries) -> set[str]`: the `name_norm`s from `oshi.oshi_names(service)`.
- `sort_people(summaries, oshi: set[str]) -> list[MemberSummary]`: oshi first, then the `list_members` order.
- `media_url_for(service: str, fact: Fact) -> str | None`: normalises `\` to `/`, then `archive_urls.media_url(service, parts)`.
- `media_file_for(fact) -> str | None`: the normalised POSIX `media_file`.
- `@dataclass(frozen=True) AvatarTimeline` with `entries: tuple[tuple[datetime | None, str], ...]` (oldest first) and `current: str | None`. `at(when: datetime) -> str | None` returns the newest entry with `first_seen <= when`. When no such entry exists, it returns the oldest entry (archiving began after `when`). With no entries it returns `current`.
- `avatar_timeline(sdir: Path, room: str) -> AvatarTimeline`: blocking. Uses `profile_images_service.list_images(output_dir(), sdir / room, {}, member_rel=chat_path(sdir, room))["kinds"]["thumbnail"]`, parsing `first_seen` with `archive_urls.parse_iso`.
- `async avatar_timelines(sdir, summary) -> AvatarTimeline`: merges every room's timeline, cached in-process per `(person_key, profile index mtimes)`.
- `message_ref(service, sdir, room, fact, *, avatar: AvatarTimeline | None = None) -> dict`: the shared message object with `text` and `caption` set to `None`.
- `async attach_texts(sdir, refs: list[dict]) -> None`: groups refs by `room`. Per room it calls one `asyncio.to_thread(load_texts, sdir, sdir / room, ids)`, where `ids` covers both own ids and caption ids. It then sets `text` (the own text, or `None` for media without text) and `caption`. A ref whose text is missing logs `memories_skip` with `view=attach_texts`, `reason=text_missing` and `count`.
- `async service_facts_on(sdir, summaries, *, day=None, month_day=None) -> list[tuple[MemberSummary, str, Fact]]`: calls `get_facts_on` for every room of every person and sorts by `(ts, id, room)`.
- `async room_hashes(sdir, summary) -> str`: sha256 over the rooms' `get_member_index(...).data_hash` values, first 16 hex chars.
- `async letters_of(service, sdir, summary) -> list[tuple[str, int, date]]`: `(room, letter_id, JST date)`, oldest first. Uses the letters reader from `backend/api/chat_features.py` (`_read_local_letters`). If R2 moved it into a service module, import it from there. If not, move it now to `backend/services/letters_local.py`, keeping `chat_features` as a thin caller, so that services never import `backend.api`. Outcomes `missing` and `empty` give `[]`. `invalid` gives `[]` plus `memories_skip` with `view=letters` and `reason=invalid`.

`view_cache.py`:
- Table `memories_view_cache(service_dir TEXT, view TEXT, key TEXT, data_hash TEXT, payload TEXT, PRIMARY KEY(service_dir, view, key)) WITHOUT ROWID`. It lives in the memory-index DB: open it with `index._connect()` and create the table with `CREATE TABLE IF NOT EXISTS` on first use.
- `async cached_view(sdir: Path, view: str, key: str, data_hash: str, build: Callable[[], Awaitable[dict]]) -> dict`:
  - Reads in a thread.
  - On a miss it awaits `build()` and then calls `contains_text(payload)`. That check is true when any dict has a non-null `text`, `caption` or `sentence` value. A payload with text is returned uncached and logged as `memories_view_cache` with `outcome=uncacheable`; this is a bug guard, and the tests assert it never happens for real views. Otherwise the payload is written.
  - SQLite errors are logged and fall through to `build()`. They never raise.
- `def view_hash(*parts: object) -> str`: sha256 of the `repr` of the parts, first 16 hex chars.

`backend/tests/memories_archive.py`:
- `write_room(sdir, gid_group: str, mid_name: str, msgs: list[dict], *, avatars: list | None = None, letters: list | None = None) -> Path`
- `msg(i, ts, type_="text", content="", fav=False, **extra) -> dict`: the shape in `test_memories_facts.py`.
- `write_side_inputs(sdir, *, birthdays=None, sub_starts=None, closed_groups=None)`: writes `member_profiles.json`, `subscriptions.json` and the `sync_metadata.json` `server_groups` in the formats that `member_profiles.load_birthdays`, `subscriptions.load_subscription_starts` and `index._load_inputs` read.

- [ ] **Step 1:** Write failing tests.
  - `get_facts_on`: `month_day` returns 11-10 rows across 3 years; `day` returns one date; passing both raises; an unavailable index gives `[]`.
  - `resolve_person`: any room of a two-room person resolves to the same summary; `../` raises `ArchiveReadError`; a path in another service raises; an unknown room gives `None`.
  - `AvatarTimeline.at`: before the first entry, between entries, after the last, no entries.
  - `attach_texts`: one `load_texts` call per room (patch and count the calls), caption text attached, a missing id logs `text_missing`.
  - `message_ref`: `media_file` with backslashes becomes a POSIX `media_url`; no absolute path anywhere in the output.
  - `cached_view`: a miss builds and writes; a hit skips `build`; a changed hash rebuilds; a payload with text is not stored; a SQLite error still returns the build result.
  - Logs: use `structlog.testing.capture_logs` to assert that no message text, room or name appears in any log event.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_people.py backend/tests/test_memories_view_cache.py backend/tests/test_memories_facts.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep `people.py` free of FastAPI imports (raise `ArchiveReadError` / `ValueError`).
- [ ] **Step 4:** Run the same tests, `uv run pytest backend/tests/test_memories_index.py -q` (the lexicon change must not break the index tests) and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add shared people, view cache and date facts`.

### Task C2: Binder card rules (`cards.py`) and the binder service

**Files:**
- Create: `backend/services/memories/cards.py` (pure: no I/O, no logging of content), `backend/services/memories/binder.py`, `backend/tests/test_memories_cards.py`, `backend/tests/test_memories_binder.py`, `backend/tests/test_memories_core_api.py` (the API test file for this wave; later tasks append to it)
- Modify: `backend/api/memories.py` (route `/memoir/cards`)

**Interfaces (`cards.py`):**

```python
SHELVES = ("first", "anniversary", "numbers", "special", "records", "moments", "you", "change", "graduation")

@dataclass(frozen=True)
class MessageKey: room: str; id: int

@dataclass(frozen=True)
class AvatarChange:
    changed_at: datetime          # aware UTC (profile_images first_seen of the new image)
    old_url: str | None
    new_url: str

@dataclass(frozen=True)
class CardInputs:
    facts: Sequence[tuple[str, Fact]]             # get_person_facts output, sorted
    today: date                                   # JST
    subscription_start: date | None
    birthday: str | None                          # "MM-DD" or "YYYY-MM-DD"
    graduated: bool
    letters: Sequence[tuple[str, int, date]]      # people.letters_of
    avatar_changes: Sequence[AvatarChange]        # real changes only (not the first archived entry per kind)
    keyword_hits: Mapping[MessageKey, frozenset[str]] = field(default_factory=dict)  # {"christmas","valentine"}

@dataclass(frozen=True)
class CardYear: year: int; date: date; message: MessageKey

@dataclass(frozen=True)
class Card:
    key: str                     # stable id, see the table
    shelf: str
    earned: bool
    foil: bool = False
    rare: bool = False
    date: date | None = None     # unlock date (JST); M4 notifies on it
    message: MessageKey | None = None              # the card face / detail anchor
    refs: Mapping[str, MessageKey] = field(default_factory=dict)   # "pair", "old_last", "new_first"
    progress: tuple[int, int] | None = None        # (current, target) for unearned count cards
    years: tuple[CardYear, ...] = ()               # yearly stacks, oldest first
    detail: Mapping[str, int | str] = field(default_factory=dict)
    letter: tuple[str, int] | None = None          # (room, letter_id) for the あなた shelf

def evaluate(inputs: CardInputs) -> list[Card]           # SHELVES order, then table order
def earned_keys(cards: Iterable[Card]) -> frozenset[str]  # M4: newly earned = now - previous
def progress_summary(cards: Iterable[Card]) -> tuple[int, int]   # (earned, total) for "18 / 30 張"
def subscription_day_date(start: date, n: int) -> date   # day 1 = start, so day n = start + (n - 1)
def anniversary_date(start: date, years: int) -> date     # same month-day; Feb 29 -> Feb 28
```

Card catalogue (spec §5.3). "Words" means a non-promo fact with `importance is not None`. "Best of a day" means the highest-importance words that day, else the first non-promo fact that day, else the first fact that day. "Nearest" means the non-promo fact closest in time to 12:00 JST of the date; ties go to the earlier one. Cards marked *hidden* are left out of the result and of the total when their condition is not met. Every other unmet card is returned with `earned=False` as a silhouette.

| key | shelf | rule (earned when …) | face `message` / extras | unearned |
|---|---|---|---|---|
| `first.message` | first | any fact | the first fact | — (always earned) |
| `first.picture` / `first.video` / `first.voice` | first | a fact of that type | the first of the type | silhouette |
| `first.nickname` (foil) | first | a fact with `has_nickname` (promo included) | the first such fact | silhouette |
| `anniv.d100`, `anniv.y1`, `anniv.d500`, `anniv.y2`, `anniv.d1000`, `anniv.y3`, `anniv.y4`, `anniv.y5`, then `anniv.y6`… | anniversary | date (`subscription_day_date` / `anniversary_date`) ≤ today | best of that day, else nearest | the fixed slots up to `y5` show `progress=(days so far, target days)`. Beyond y5, only reached years plus the next one appear. The whole shelf is *hidden* without a subscription start. |
| `count.messages.100/1000/5000/10000` (10000 foil) | numbers | the Nth fact (all types, promo included) | the Nth fact; `date` its JST date | `progress=(total, N)` |
| `count.pictures.100/1000` | numbers | the Nth picture | the Nth picture | progress |
| `count.voice_hour` | numbers | cumulative `duration_s` of voices ≥ 3600 | the voice that crosses it | `progress=(seconds, 3600)`; *hidden* with no voice at all |
| `count.nicknames.100` | numbers | the 100th `has_nickname` fact | that fact | progress; *hidden* when she never uses `%%%` |
| `special.newyear` | special | per year: any fact in that year (spec §5.3: 元旦 = her first message of the year) | per year: the year's first non-promo fact, wherever it falls (a Jan 1 message naturally wins); else the year's first fact | silhouette |
| `special.valentine` | special | per year: a fact on 02-14 | a `valentine` keyword hit, else best of the day | silhouette |
| `special.christmas` | special | per year: a fact between 12-24 18:00 and 12-25 23:59 JST | a `christmas` keyword hit, else best of the window | silhouette |
| `special.birthday` (foil) | special | per year: a fact on her birthday (Feb 29 → Feb 28 in non-leap years) | prefer 00:00–00:10, else best of the day | *hidden* without a birthday |
| `special.sub_anniversary` | special | per year ≥ start year + 1: a fact on `anniversary_date` | best of the day | *hidden* without a start |
| `record.longest` | records | any words | the max `chars`; ties go to the earlier one | *hidden* |
| `record.busiest_day` | records | ≥ 1 fact | best of the day with the most facts; `detail.count` = facts that day | *hidden* |
| `record.nickname_day` | records | ≥ 1 `has_nickname` | the highest-importance nickname fact of the day with the most nickname facts | *hidden* |
| `record.longest_voice` | records | a voice with a duration | the max `duration_s`; `detail.seconds` | *hidden* |
| `record.greeting_pair` | records | both exist | `message` = the earliest `ohayo` by time of day, hours 4–11 only; `refs.pair` = the latest `oyasumi`, where hours 0–4 count as 24–28 | *hidden* |
| `record.streak.7/30/100` | records | the first day a consecutive-day run (all facts) reaches N | best of that day | `progress=(longest streak, N)` |
| `moment.midnight` (foil) | moments | a non-promo fact at 00:00–00:05 JST | the first one; `detail.count` | silhouette |
| `moment.synchro` (rare, foil) | moments | two facts with the same JST `HH:MM:SS` on different dates | `message` = the later fact of the earliest completed pair, `refs.pair` = the earlier one | silhouette |
| `moment.oyasumi.1/100`, `moment.daisuki.1/100` | moments | the 1st / 100th fact from `select(facts, greeting="oyasumi"/"daisuki")` | that fact | 100th: `progress` |
| `you.letter.1/10/50` | you | the fan's 1st / 10th / 50th letter | `letter=(room, id)`, `date`; never a `message` | progress for 10/50; the shelf is *hidden* when the person has no letters file |
| `change.avatar.<YYYY-MM-DD>` | change | one card per `AvatarChange` | best of the change day, else the first fact after the change. `refs.old_last` = the last fact before the change, `refs.new_first` = the first fact at or after it. `detail` = `days` (the new avatar's run until the next change or today, inclusive), `messages` (facts in that run), `old_url`, `new_url` | *hidden* (no silhouettes) |
| `grad.last` (memorial foil) | graduation | `graduated` | the last fact | *hidden* |

Yearly stacks put one `CardYear` per qualifying year into `years`. The card's `message` / `date` is the newest year. Unearned special cards have `years=()`.

**Interfaces (`binder.py`):**
- `async evaluate_person(service, sdir, summary, *, now: datetime) -> list[cards.Card]`:
  1. Gather the inputs: `get_person_facts`; `people.letters_of`; avatar changes from `people.avatar_timelines` (consecutive entries; skip the first); the subscription start and birthday from the summary.
  2. Compute `keyword_hits` with one `load_texts` per room, only for the facts on 02-14 and 12-24/25. Match them against `lexicon.CHRISTMAS_RE` / `VALENTINE_RE` on the NFKC text.
  3. Call `cards.evaluate`.
  4. Log one `memories_cards` event: `person`, `earned`, `total`, `hidden` (count). Log each fallback as `memories_select` with `view=binder`, `rule=<key>` and `fallback=nearest|first_after|best_of_day`.
- `async build_binder(service, sdir, summary, *, now) -> dict`:
  - Uses `view_cache.cached_view(sdir, "binder", person_key, view_hash(room_hashes, today_jst, letters stat), build)`.
  - The cached payload holds message ids only. After the cache read, `people.attach_texts` fills the faces and refs.
  - Payload:

```json
{"progress": {"earned": 18, "total": 30},
 "shelves": [{"key": "first", "cards": [{"key": "first.message", "earned": true, "foil": false,
   "rare": false, "date": "2023-07-24", "face": message|null, "refs": {"pair": message},
   "progress": null | {"current": 8912, "target": 10000},
   "years": [{"year": 2024, "date": "2024-02-14", "face": message}],
   "detail": {}, "letter": null | {"date": "2024-03-01"}}]}]}
```

Shelves with no cards are omitted.

- [ ] **Step 1:** Write failing `test_memories_cards.py` with synthetic `Fact` lists (a small `fact(...)` factory in the test file):
  - every row of the table, earned and unearned;
  - Feb 29 birthday and anniversary;
  - day-100 date arithmetic (`subscription_day_date(start, 100) == start + 99 days`);
  - the nearest fallback for an anniversary with no message that day;
  - synchro picks the earliest completed pair;
  - the greeting pair treats 01:00 おやすみ as later than 23:00;
  - the streak threshold date;
  - hidden cards are left out of `progress_summary`;
  - `earned_keys` diff for M4 (earning `count.messages.1000` adds exactly that key);
  - no silhouette for avatar changes or graduation;
  - non-ASCII and emoji in the keyword hits.
- [ ] **Step 2:** Write failing `test_memories_binder.py` with `memories_archive` rooms:
  - a person with two rooms gives one binder;
  - letters count only from the person's rooms;
  - a Christmas keyword hit beats higher importance;
  - the cache payload has no text (`view_cache.contains_text` is false) while the response has faces with text;
  - the second call does not re-run `get_person_facts` (patch and count);
  - the logs contain no text or names.

  Also write `test_memories_core_api.py::test_cards_*`:
  - happy path;
  - traversal → 400;
  - unknown member → 404;
  - unknown service → 400;
  - no absolute paths in the JSON.
- [ ] **Step 3:** Run `uv run pytest backend/tests/test_memories_cards.py backend/tests/test_memories_binder.py backend/tests/test_memories_core_api.py -q`. Expect FAIL.
- [ ] **Step 4:** Implement `cards.py` as small pure functions per shelf (`_first_cards`, `_anniversary_cards`, …) combined by `evaluate`. Implement `binder.py` and the route: parse `member`, `resolve_person`, `build_binder(now=datetime.now(timezone.utc))`.
- [ ] **Step 5:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 6:** Commit `feat(memories): add the photocard binder rules and API`.

### Task C3: Memoir list, header, 被叫名字 and timeline backend

**Files:**
- Create: `backend/services/memories/memoir.py`, `backend/services/memories/nickname_moments.py`, `backend/services/memories/timeline.py`, `backend/tests/test_memories_memoir.py`, `backend/tests/test_memories_nickname_moments.py`, `backend/tests/test_memories_timeline.py`
- Modify: `backend/api/memories.py` (5 routes), `backend/tests/test_memories_core_api.py`

**Interfaces:**
- `async list_memoir_members(service, sdir, *, now) -> dict` returns `{"members": [{"member_path", "member_id", "name", "avatar_url", "oshi": bool, "graduated": bool, "progress": {"earned", "total"}}]}`.
  - Order: `people.sort_people` (oshi first).
  - `member_path` uses the newest room. `avatar_url` is the current avatar.
  - `progress` = `cards.progress_summary(await binder.evaluate_person(...))`. The whole list goes through `cached_view(sdir, "memoir_members", "all", view_hash(all room hashes, today, oshi set))`.
- `async memoir_header(service, sdir, summary, *, now) -> dict` returns `{"member_path", "name", "avatar_url", "graduated", "chips": {"subscription_days": int | null, "nickname_count": int | null, "voice_seconds": float | null}}`.
  - `subscription_days` = `(today_jst - start).days + 1` from the archived earliest start; `null` without a start.
  - `nickname_count` = `aggregate(facts).nickname_count`; `null` when it is 0, which hides the chip and the 被叫名字 entry.
  - `voice_seconds` = `aggregate(facts).voice_seconds`; `null` when it is 0.
- `async nickname_moments(service, sdir, summary, *, year: int | None) -> dict` returns `{"years": [2026, 2025, ...], "items": [{"message": message, "sentence": str}]}`, newest first.
  - Candidates: every fact with `has_nickname`, promo included, matching the chip count.
  - For each candidate, split its text with `lexicon.RAW_SENTENCE_SPLIT_RE` (original characters kept). Every sentence that contains `%%%` or `％％％` becomes its own item.
  - `years` lists every year that has items, before filtering. `year` filters the items.
  - Each `message` carries `avatar_url` at its time.
  - Texts come from one `load_texts` per room. The payload is not cached (it contains text).
  - Logs: `memories_names` with `person`, `count` and `year`.
- `async timeline_months(service, sdir, summary) -> dict` returns `{"months": [{"month": "2023-07", "count": 41}, ...]}`.
  - The list runs continuously from her first month to her last. Months without messages are included with `count: 0`; the rail draws them as empty bars and never shows the number.
  - Cached with `cached_view(sdir, "timeline_months", person_key, room_hashes)`.
- `async timeline_month(service, sdir, summary, month: str, *, now) -> dict` returns `{"month", "count", "avatar_url", "photos": [message], "messages": {"top": message|null, "late": message|null, "nickname": message|null}, "milestones": [{"key", "date", "foil"}]}`.
  - `count` is the month's facts, shown as the one number.
  - `avatar_url` = the avatar at the middle of the month (clamped to now).
  - `photos`: up to 12 non-promo pictures/videos with the highest `photo_score`, shown in time order.
  - `top`: the highest-importance words.
  - `late`: the words with the latest time of day, where 0–4 h counts as 24–28 h; only messages from 22:00 to 04:59.
  - `nickname`: the highest-importance `has_nickname` words.
  - A message appears in at most one slot, filled in the order top → nickname → late. A slot with no candidate is `null` and logs `memories_skip` with `view=timeline` and `reason=no_<slot>`.
  - `milestones`: earned cards whose `date` (or a `CardYear.date`) falls in the month, from `binder.evaluate_person`.
  - A month outside the person's range → 404 from the API.

- [ ] **Step 1:** Write failing tests:
  - `memoir`: oshi first (patch `oshi.oshi_names`); progress matches the binder; chips are `null` for a member without `%%%`, voice or start; `subscription_days` is frozen with time-machine (2026-11-10, start 2026-11-01 → 10).
  - `nickname_moments`: one message with two `%%%` sentences gives two items; fullwidth `％％％`; a promo message is included; year filter; years list; emoji kept in the sentence; newest first; an avatar per row.
  - `timeline`: continuous months with zero gaps; slot uniqueness; a 01:30 message wins `late` over 23:00; the photo cap of 12; milestones in the month.
  - API: all five routes with 200, 400 and 404 cases; a bad month → 400.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_memoir.py backend/tests/test_memories_nickname_moments.py backend/tests/test_memories_timeline.py backend/tests/test_memories_core_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement the services and routes.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve the memoir list, header, names and timeline`.

### Task C4: On This Day and 那一天 backend

**Files:**
- Create: `backend/services/memories/on_this_day.py`, `backend/services/memories/day_view.py`, `backend/tests/test_memories_on_this_day.py`, `backend/tests/test_memories_day_view.py`
- Modify: `backend/api/memories.py` (`/on-this-day`, `/day`), `backend/tests/test_memories_core_api.py`

**Interfaces:**
- `async on_this_day(service, sdir, month_day: str, *, now) -> dict` returns:

```json
{"month_day": "11-10",
 "years": [{"year": 2024, "has_messages": true, "message_count": 41, "member_count": 5,
            "preview": [message], "more": 38, "thumb": message|null}]}
```

  - Data comes from `people.service_facts_on(sdir, summaries, month_day=...)`.
  - `years` runs from the first JST year of any message in the service to the latest year in which that date is ≤ today (JST), newest last. Years with no messages are listed with `has_messages: false` and no other fields; the UI dims them in the year list and leaves them out of the overview strip. `02-29` lists every year, and non-leap years are simply empty.
  - `preview`: up to 3 non-promo words. Take one per person, oshi first, then by importance. Each preview item has an avatar at its time. `more` = `message_count - len(preview)`.
  - `thumb`: the highest `photo_score` photo of that date-year.
  - Texts come from one `load_texts` per room, for the preview ids only.
  - Logs: `memories_on_this_day` with `years`, `with_messages` and `count`.
- `async day_view(service, sdir, day: date, *, member: MemberSummary | None, include_other_services: bool, now) -> dict` returns:

```json
{"date": "2024-09-14",
 "members": [{"member_path", "member_id", "name", "avatar_url", "service", "oshi"}],
 "messages": [message],
 "other_services": ["sakurazaka46"]}
```

  - `messages` covers every fact on that date for every person (or for `member` only), sorted by `(ts, id)`, promo included (it is the real chat). Texts and captions come from one `load_texts` per room.
  - `members` lists those who posted that day, oshi first, with the avatar at that date.
  - `include_other_services`: for every `service_utils.get_all_services()` entry other than `service` whose `resolve_service_path` exists, add the same data with that `service`. `other_services` lists the services that had data. A failure in another service is logged as `memories_skip` with `view=day`, `reason=other_service_failed` and `error_type`, and never fails the request.
  - `include_other_services` is ignored when `member` is set.
  - The film strip (C10) calls this endpoint with `member` and centres on its id.
  - Logs: `memories_day` with `members`, `count`, `others` (bool) and `services` (count).

- [ ] **Step 1:** Write failing tests:
  - `on_this_day`: three years with one empty (`has_messages: false`); a future date this year is excluded (time-machine 2026-11-10, `12-24` → the last year is 2025); preview oshi first and at most one per person; `more`; `02-29`; promo excluded from the preview; preview texts present.
  - `day_view`: a merged order across two persons; `member` filter; other services included with their `service` code (build two service dirs, patch `get_all_services` and the output dir); a broken other service logs and is skipped; captions attached.
  - Logs: no text or names in any log event.
  - API: `date` formats → 400; `others=1` parsing.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_on_this_day.py backend/tests/test_memories_day_view.py backend/tests/test_memories_core_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement the services and routes.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve On This Day and the day view`.

### Task C5: Album backend (covers, bursts, colour ribbon)

**Files:**
- Create: `backend/services/memories/album.py`, `backend/services/memories/album_colors.py`, `backend/services/memories/covers.py` (the cover-override hook), `backend/tests/test_memories_album.py`, `backend/tests/test_memories_album_colors.py`
- Modify: `backend/api/memories.py` (4 routes), `backend/tests/test_memories_core_api.py`

**Interfaces:**
- `covers.py`: the hook that wave 4 implements, with right-click 「設為這個月的封面」 and its storage.
  - `async load_cover_overrides(sdir: Path, scope: str) -> dict[str, tuple[str, int]]` maps `month -> (room, message_id)`. `scope` is `person_key` or `"all"`.
  - This wave returns `{}`. The docstring states the contract: an override wins only when that message is still a picture/video in that month.
- `album_colors.py`:
  - Table `memories_photo_probe(service_dir, media_file, stat_key, width, height, fmt, rgb, PRIMARY KEY(service_dir, media_file)) WITHOUT ROWID` in the memory-index DB. `stat_key` = `f"{size}:{mtime_ns}"`.
  - `probe_image(path: Path) -> ImageProbe | None`: blocking. `ImageProbe` is a dataclass with `width`, `height`, `fmt` and `rgb: tuple[int, int, int] | None`.
    - Read with `Image.open`, then `img.draft("RGB", (64, 64))` for JPEG, `convert("RGB")`, `thumbnail((48, 48))` and `quantize(colors=8)`.
    - `rgb` = the most frequent palette colour with HSV saturation ≥ 0.15 and value in 0.15–0.95. If no colour qualifies, use the most frequent colour.
    - Unreadable files give `None` and log `memories_skip` with `view=album_color`, `reason=unreadable` and `error_type`. The path is never logged.
  - `async probes(sdir, media_files: list[str]) -> dict[str, ImageProbe | None]`:
    - First validates each file with `archive_urls.archive_file_ok(people.output_dir(), sdir / media_file)`. `ArchiveReadError` or an absent file gives `None`.
    - Uses the cache by `stat_key` and probes misses in `asyncio.to_thread`, at most 64 files per thread batch.
    - Logs `memories_album_probe` with `hits`, `probed` and `failed`.
  - `is_screenshot_like(p: ImageProbe) -> bool` = `p.fmt == "PNG" and p.height / p.width >= 1.9`.
  - `month_color(rgbs: list[tuple[int, int, int]]) -> str | None`: buckets colours by 4-bit RGB, takes the most frequent bucket (ties go to the higher-score photo, which comes earlier in the input), averages the colours in it and returns `"#rrggbb"`.
  - `async month_colors_for(service, sdir, member: MemberSummary | None) -> dict` returns `{"colors": {"2024-09": "#a1b2c3" | null}}`. Each month uses up to 8 non-promo pictures with the highest `photo_score` (videos are skipped). The result is cached with `cached_view(sdir, "album_colors", scope, view_hash(room hashes))`.
- `album.py`:
  - `async album_members(service, sdir) -> dict` returns `{"total": int, "members": [{"member_path", "member_id", "name", "avatar_url", "count"}]}`. Counts are pictures and videos, promo included. Order: oshi first, then by count descending. Members with 0 are omitted.
  - `choose_cover(cands: list[tuple[str, Fact]], *, override: tuple[str, int] | None, oshi_rooms: set[str], screenshot_like: Callable[[str, Fact], bool]) -> tuple[tuple[str, Fact], str] | None` (pure) returns the cover and the rule. The order is spec §8:
    1. `override` (rule `override`);
    2. ★ photos, oshi rooms first, then the highest `photo_score` (`favorite`);
    3. the highest `photo_score` (`score`);
    4. the first item of the month's largest burst (`burst`);
    5. anything else in time order (`first`).

    Promo items, and items for which `screenshot_like` is true, move to the end of each rule's list. `screenshot_like` is consulted only for the top 3 candidates.
  - `async album_months(service, sdir, *, member, kind) -> dict` returns `{"months": [{"month", "count", "cover": message|null, "cover_rule", "has_favorites"}]}`, newest first.
    - `kind` filters: `all` keeps pictures and videos, `picture` and `video` keep one type, `favorite` keeps `favorited` items.
    - The month structure (ids, rule) is cached with `cached_view(sdir, "album_months", f"{scope}:{kind}", view_hash(room hashes, overrides))`.
    - The cover's `caption` (her nearby text) is attached afterwards with `attach_texts`.
    - Logs `memories_select` per month with `view=album_cover`, `rule`, `score` and `message_id`, and `memories_album` with `months`, `count` and `kind`.
  - `async album_month(service, sdir, month, *, member, kind) -> dict` returns `{"month", "items": [message], "bursts": [{"burst_id", "room", "ids": [..]}]}`.
    - Items are in time order. Each carries its `caption` for the hover text and the burst sequence; texts are loaded once per room.
    - `bursts` lists the bursts with ≥ 3 items in the filtered set. Burst ids are per room, so the key is `(room, burst_id)`.

- [ ] **Step 1:** Write failing tests:
  - `choose_cover`: each rule in order; the override wins; an oshi ★ beats a non-oshi ★ with a higher score; promo and screenshot-like are demoted; burst fallback; `None` for an empty list.
  - `month_color`: a deterministic bucket choice.
  - `probe_image`: on generated Pillow images (a red JPEG gives a reddish hex; a tall PNG is screenshot-like; a corrupt file gives `None` and logs without the path).
  - `probes`: a cache hit skips Pillow (patch and count); a changed mtime re-probes; a path outside the output dir gives `None`.
  - `album_months`: `kind` filters; `has_favorites`; newest first; caption attached; the cache holds no text.
  - `album_month`: bursts keyed per room.
  - API: kind / month validation; `member` optional.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_album.py backend/tests/test_memories_album_colors.py backend/tests/test_memories_core_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement the services and routes.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve the album with covers and colour ribbon`.

### Task C6: Favorites board and hub backend

**Files:**
- Create: `backend/services/memories/favorites_board.py`, `backend/services/memories/hub.py`, `backend/tests/test_memories_favorites_board.py`, `backend/tests/test_memories_hub.py`
- Modify: `backend/api/memories.py` (`/favorites`, `/hub`), `backend/tests/test_memories_core_api.py`

**Interfaces:**
- `async favorites_board(service, sdir, *, member: MemberSummary | None) -> dict` returns `{"total": int, "members": [{"member_path", "member_id", "name", "avatar_url", "count"}], "items": [message + {"favorited_at": str | null}]}`.
  - Items are every fact with `favorited`, promo included, of the person or of everyone.
  - `favorited_at` comes from `app_state.favorited_at(service, ids)` in `asyncio.to_thread`. Message ids are per service, so the lookup is valid.
  - Order: `favorited_at` descending when known, then message `ts` descending.
  - `members` always covers everyone (it is the left list). Order: oshi first, then by count.
  - Text and captions come from one `load_texts` per room.
  - Logs: `memories_favorites` with `count`, `members` and `with_time` (count of known `favorited_at`).
- `async build_hub(service, sdir, *, now) -> dict` returns:

```json
{"on_this_day": {"rule": "today|week|first", "year": 2024, "years_ago": 2,
                  "member_path": "...", "name": "...", "message": message, "photo": message|null} | null,
 "counts": {"album": 8412, "members": 27, "favorites": 96},
 "countdown": {"kind": "birthday|anniversary", "member_path": "...", "name": "...",
               "date": "2026-11-15", "days_left": 5, "years": 3|null} | null}
```

  - `on_this_day` rules:
    - `today`: past years on today's month-day (from `on_this_day`). Choose oshi first, then the highest importance. `photo` = a photo from the same person and day with the highest `photo_score`.
    - `week`: if today has no past messages, search ±3 days in past years.
    - `first`: if the week has none either, use the first non-promo message ever of the first person in `sort_people`. The hub is never empty.

    Each fallback logs `memories_select` with `view=hub_otd`, `rule` and `fallback`.
  - `counts`:
    - `album` = pictures and videos, summed from `facts.aggregate` per person;
    - `members` = persons with at least one fact;
    - `favorites` = `aggregate().favorites`.

    The frontend shows only the numbers it needs.
  - `countdown`: the soonest upcoming event (today counts as `days_left: 0`, and the frontend shows "today" copy, never "0") among non-graduated persons' birthdays and their next subscription anniversary (`anniversary_date`, `years` = k ≥ 1). Ties go to oshi first. `null` when nobody has a birthday or a start.
  - The numeric part (counts, countdown) is cached with `cached_view(sdir, "hub", "all", view_hash(all room hashes, today, oshi))`. The `on_this_day` text is attached after the cache read.
  - Hooks for wave 4 (同じ時刻 §14.3, 時光膠囊 §14.4): the payload keeps two keys, `"same_time": null` and `"capsule": null`. The docstring says wave 4 fills them.

- [ ] **Step 1:** Write failing tests:
  - favorites: ordering with mixed known and unknown `favorited_at` (seed `app_state.record_favorite`); promo favourites included; member filter; voice items carry `duration_s`.
  - hub: `today`, `week` and `first` fallbacks (time-machine); oshi preference; countdown birthday vs anniversary; `days_left: 0` on the day; graduated persons excluded; `same_time` / `capsule` present and `null`; no text in the cache.
  - API routes.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_favorites_board.py backend/tests/test_memories_hub.py backend/tests/test_memories_core_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement the services and routes.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve the favorites board and hub`.

### Task C7: Frontend foundation (tokens, API client, shared pieces, router, i18n test)

**Files:**
- Create:
  - `frontend/src/design/tokens/memories.ts`: the keepsake surfaces.
    - `sepia` filter steps 1–3 for 1, 2 and 3+ years ago;
    - `paper` (letter or polaroid white plus its hairline);
    - `cork` (cork board base);
    - `washi` (translucent tape);
    - `foil` (a holographic gradient built from the aurora stops in `tokens/brand.ts`);
    - `polaroid` shadow;
    - `silhouette` dash colour (the neutral `border-strong` value).

    Export it from `tokens/index.ts`. Add the `--ds-mem-*` static variables in `design/cssVars.ts` (`staticTokenVars`) and the matching Tailwind utilities in `frontend/tailwind.config.js`: `bg-memories-paper`, `bg-memories-cork`, `bg-memories-washi`, `bg-memories-foil`, `shadow-memories-polaroid`, `border-memories-silhouette`, `sepia-memories-1/2/3`. Follow the `blogFeed` pattern.
  - `frontend/src/design/memoriesTokens.test.ts` (on the model of `blogFeedTokens.test.ts`).
  - `frontend/src/features/memories/types.ts`: `MemoryMessage` and the payload types for every endpoint in "Shared contracts".
  - `frontend/src/features/memories/api.ts`: one typed fetcher per endpoint (`fetchHub`, `fetchOnThisDay`, `fetchDay`, `fetchAlbumMembers`, `fetchAlbumMonths`, `fetchAlbumMonth`, `fetchAlbumColors`, `fetchFavorites`, `fetchMemoirMembers`, `fetchMemoirHeader`, `fetchMemoirCards`, `fetchNameMoments`, `fetchTimelineMonths`, `fetchTimelineMonth`). Each uses `encodeURIComponent` for query values and takes an `AbortSignal`.
  - `frontend/src/features/memories/shared/useMemoriesQuery.ts`: `useMemoriesQuery<T>(target: MemoriesView, load: (signal) => Promise<T>, deps)` returns `{ status: 'loading' | 'ready' | 'error', data, retry }`. It aborts on change and unmount, and logs `memories_load` (`target`, `outcome`, `count` = top-level list length when present).
  - `shared/useNickname.ts`: the nickname for the service. Reuse R4's source if R4 created one (then move it here). Otherwise fetch `GET /api/profile?service=` once per service (it returns the cached nickname).
  - `shared/MemoryText.tsx`: renders her raw text with `lang="ja"` and `whitespace-pre-wrap`. It replaces `%%%` / `％％％` with the nickname. With `underlineNickname`, it wraps each replaced span in `<span className="underline decoration-accent underline-offset-4">`. With no nickname it renders 『＊＊＊』.
  - `shared/MemberPane.tsx`: the left list used by album, favorites and memoir. Props: `items: {key, memberPath?, name, avatarUrl?, oshi?, trailing?: ReactNode}[]`, `selectedKey`, `onSelect`, `allLabel?` for the 「全員」 / 「全部收藏」 row. Built from `Avatar` (`resizedAvatarUrl(url, useAvatarWidth(32))` from `features/messages/mediaUrl.ts` and `features/messages/hooks/useAvatarWidth.ts`). An oshi member gets the `tone="oshi"` heart marker; group colour only on the selected row.
  - `shared/jumpToChat.ts`: `jumpToChat(msg: MemoryMessage, name: string, from: MemoriesView)` calls `openChat({ service: msg.service, path: msg.member_path, name, is_group_chat: false, message_id: msg.id })` from `frontend/src/shell/openChat.ts` and logs `memories_jump` (`target: from`, `has_target: true`).
  - `shared/sepia.ts`: `sepiaClass(year: number, now = new Date()): string`. Returns `''` for this year, then `sepia-memories-1/2/3`.
  - `shared/PageHeader.tsx`: a back `IconButton` (`common.back`), a serif `font-display text-heading` title and a right slot.
  - `shared/toMessage.ts`: `toChatMessage(m: MemoryMessage): Message` maps to the chat `Message` type (`frontend/src/types/index.ts`) so that `MessageBubble` can render it.
  - `frontend/src/i18n/memoriesCore.test.ts`: `MEMORIES_CORE_KEYS: string[]` (dotted, any depth; a recursive lookup) checked in all 5 locales, plus `MEMORIES_CORE_EN_PLURALS`. Every later task appends to both lists.
  - Tests: `shared/MemoryText.test.tsx`, `shared/MemberPane.test.tsx`, `shared/jumpToChat.test.ts`, `shared/sepia.test.ts`, `shared/useMemoriesQuery.test.tsx`, `api.test.ts`.
- Modify:
  - `MemoriesFeature.tsx`: add the four routes in "Shared contracts". The pages render placeholders until their tasks land, and each page receives `service`, `route` and `go`.
  - `memoriesLog.ts`: `MemoriesPage` adds `'onThisDay' | 'album' | 'memoir' | 'favorites'`. Add `MemoriesView` (`'hub' | 'on_this_day' | 'day' | 'album' | 'favorites' | 'memoir' | 'binder' | 'names' | 'timeline'`), `logMemoriesLoad`, `logMemoriesJump` and `logMemoriesToggle`.
  - `frontend/src/utils/clientLog.ts`: the events `memories_load`, `memories_jump` and `memories_toggle`.
  - `backend/api/client_log.py`: the same three event names in `ClientEvent`.
  - `docs/design/DESIGN_SYSTEM.md`: a "Memories keepsake surfaces" section after "The blog feed". It lists the new tokens, the sepia-by-age rule, foil only for special cards, and the album colour ribbon as a data-driven exception (like the member penlight colours).
- Locales (`memories.common.*`): `back`, `retry`, `loadError`, `jumpToChat`, `all`, `nicknameMasked`. ja reference: 「戻る」「もう一度」「読み込めませんでした」「トークで見る」「全員」「＊＊＊」.

- [ ] **Step 1:** Write failing tests:
  - tokens are present as variables and utilities;
  - `MemoryText` replaces both placeholder forms, underlines, masks without a nickname and keeps emoji;
  - `MemberPane` puts the oshi marker in the oshi tone and fires `onSelect`;
  - `jumpToChat` calls `openChat` with the message id and logs without the path;
  - `sepiaClass` boundaries;
  - `useMemoriesQuery` aborts on unmount and logs `ok` / `error`;
  - the router switches to each new page and resets to home on a service change (extend `MemoriesFeature.test.tsx`);
  - the i18n key test.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories src/design src/i18n/memoriesCore.test.ts && cd ..`. Expect FAIL.
- [ ] **Step 3:** Implement. Add the backend event names and run `uv run pytest backend/tests -q -k client_log`.
- [ ] **Step 4:** Run the vitest command again, `npx vitest run src/design/guard.test.ts` and `npx tsc --noEmit -p .` (from `frontend/`). Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add keepsake tokens and shared Memories pieces`.

### Task C8: 那一天 day view and On This Day pages

**Files:**
- Create in `frontend/src/features/memories/`:
  - `day/DayView.tsx`: props `service`, `date`, `memberPath?`, `headerSlot?`. The header slot is where wave 4 puts the ⇆ あの日と今日 toggle.
    - Header: the date with weekday, the holiday name from `utils/jpHolidays.ts` `holidayName` (`lang="ja"`), and one number (message count).
    - Member filter chips: `Pill`, with the avatar inside.
    - The 「包含其他團體」 `Switch`, which refetches with `others=1` and logs `memories_toggle` (`target=other_services`).
    - The A / B segmented toggle (`memories_toggle`, `target=day_mode`). It is remembered per session in component state (A by default).
  - `day/MergedTimeline.tsx` (A): renders each message with the chat's `MessageBubble` (`features/messages/components/MessageBubble.tsx`): `message={toChatMessage(m)}`, `member_name`, `member_avatar`, `service={m.service}` and `runStart` (same sender, ≤ 5 min). No favourite toggle or long-press handlers are passed (read-only). Text comes through the nickname. Clicking media opens `MediaViewerModal` (from `core/media/PhotoDetailModal.tsx`) over that day's media, with `onSourceJump` → `jumpToChat(…, 'day')`. Another service's messages carry a small service label.
  - `day/Swimlanes.tsx` (B): one column per member, with avatar and name at the top and an hour ruler on the left covering the floor of the first hour to the ceiling of the last hour.
    - Cards are absolutely positioned by time with `laneLayout`. A card shows the time, a 2-line clamp of the text or a media thumbnail, and expands on click (a `Card` with the full `MemoryText` and the jump button).
    - Columns get a minimum width; with more than 5 members the lane area scrolls horizontally inside the pane.
  - `day/laneLayout.ts`: `laneLayout(items: {key, minutes}[], opts: {pxPerMinute, cardHeight, gap}) -> {key, top}[]`. Pure. Each card sits at its time and is pushed down when it would overlap the previous card in the same lane.
  - `onThisDay/OnThisDayPage.tsx`:
    - Overview (B, `route.year` unset): `PageHeader` with ‹ › month-day navigation (‹ = previous day, › = next day) and a date button that opens `CalendarModal` (`core/modals/CalendarModal.tsx`) in Dates mode with an empty `dates` array; picking any date sets the month-day.
    - The year strip shows only years with messages. Each column has the year (serif), up to 3 preview bubbles and `+N` (`memories.onThisDay.more`). Columns are sepia by age.
    - Clicking a column goes to `{page: 'onThisDay', monthDay, year}`.
    - Thin data: when no year has messages, show an `EmptyState` with the gentle copy and the date picker as its action.
  - `onThisDay/YearStrip.tsx` plus `onThisDay/useDragScroll.ts`: pointer-drag horizontal scroll (a click is suppressed after a drag > 4 px), the wheel maps to horizontal scroll, ← / → step one column (older / newer). The strip starts scrolled to the newest year.
  - `onThisDay/OnThisDayDetail.tsx` (A): a year list on the left (`MemberPane`-like rows: year, one number, the thumb). Empty years are dimmed with 「この日はメッセージがありません」 and are not selectable. On the right is `DayView` for `YYYY-${monthDay}`. ← / → (or ‹ ›) move between years that have messages.
  - Tests: `day/laneLayout.test.ts`, `day/DayView.test.tsx`, `day/Swimlanes.test.tsx`, `onThisDay/OnThisDayPage.test.tsx`, `onThisDay/useDragScroll.test.tsx`.
- Modify: `MemoriesFeature.tsx` (render the `onThisDay` route).
- Locales (ja reference): `memories.onThisDay.title` 「あの年の今日」, `.more` 「ほか {{count}} 件」, `.noMessages` 「この日はメッセージがありません」, `.empty` 「この日の思い出は、まだここにありません。別の日を開いてみてください。」, `.pickDate` 「日付をえらぶ」, `.prevDay` 「前の日」, `.nextDay` 「次の日」; `memories.day.count` 「{{count}} 件のメッセージ」, `.otherGroups` 「ほかのグループも含める」, `.modeMerged` 「時系列」, `.modeLanes` 「メンバー別」, `.expand` 「ひらく」. zh-TW: 那年今日 / 這天沒有訊息 / 包含其他團體 / 合流 / 泳道.

- [ ] **Step 1:** Write failing tests:
  - `laneLayout`: no overlap within a lane; the order is kept; same-minute messages stack.
  - `DayView`: renders bubbles in time order; the member chip filters; the others switch refetches with `others=1` and shows a service label; the mode toggle switches to lanes and logs; the media click opens the viewer and its jump calls `openChat` with the id.
  - `Swimlanes`: one column per member; a card expands on click.
  - `OnThisDayPage`: overview columns only for years with messages; ‹ › change the day; the calendar pick sets the month-day; a column click routes to the detail; the detail year list dims empty years and they are not clickable; ← / → between years; the empty state.
  - `useDragScroll`: a drag scrolls and suppresses the click.
  - Append the keys to `memoriesCore.test.ts`.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/day src/features/memories/onThisDay src/i18n/memoriesCore.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. Keep the overview a fixed-viewport strip: no page scroll, only the strip scrolls horizontally.
- [ ] **Step 4:** Run the tests plus `npx vitest run src/design/guard.test.ts && npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add On This Day and the day view`.

### Task C9: Album page

**Files:**
- Create in `frontend/src/features/memories/album/`:
  - `AlbumPage.tsx`:
    - Left: `MemberPane` with 「全員」 plus per-member counts (`trailing`).
    - Right: the filter `Pill`s 全部 / 照片 / 影片 / ★, where the ★ pill uses the yellow favourite star, never the accent. Below them, the month-sectioned grid in the pane's own scroll container, and the colour ribbon on the right edge.
    - Month sections load lazily: `IntersectionObserver` calls `fetchAlbumMonth` when a section nears the viewport. Without `IntersectionObserver`, sections load in order.
  - `MonthSection.tsx`: a month band holding the polaroid cover and the grid. The band tint is the month colour applied through `style` (`color-mix(in srgb, <colour> 18%, transparent)`, the data-driven exception), with a neutral fallback when the colour is `null`. Old years get `sepiaClass`.
  - `PolaroidCover.tsx`: `bg-memories-paper` frame, `shadow-memories-polaroid`, the cover photo and a caption line with her nearby text (`MemoryText`, `font-display text-small`, 1 line). Without a caption, show the month label only.
  - `BurstStack.tsx`: a stacked thumbnail with 「{{count}} 枚」. Clicking opens the sequence: a `Modal` with the burst's photos in order and each caption beside it, plus the jump button.
  - `PhotoTile.tsx`: the hover caption shows her text within ±3 min (`caption` or `text`) in a frosted tooltip. A ★ tile spans 2×2 and wears a `bg-memories-washi` tape strip.
  - `ColorRibbon.tsx`: one vertical segment per month in the ribbon's colours (newest at the top). Click or drag scrolls the grid to that month. Keyboard ↑ / ↓ moves between months, and each segment has an `aria-label` with the month.
  - `albumViewer.ts`: builds `MediaViewerItem[]` for a month (or burst). `onSourceJump` → `jumpToChat(…, 'album')`. Order is `oldest_first`.
  - Tests: `AlbumPage.test.tsx`, `ColorRibbon.test.tsx`, `BurstStack.test.tsx`, `albumViewer.test.ts`.
- Modify: `MemoriesFeature.tsx` (the `album` route).
- Locales (ja reference): `memories.album.title` 「アルバム」, `.filterAll` 「すべて」, `.filterPhotos` 「写真」, `.filterVideos` 「動画」, `.filterFavorites` 「お気に入り」, `.burst` 「{{count}} 枚」, `.monthLabel` 「{{year}}年{{month}}月」, `.ribbonLabel` 「{{year}}年{{month}}月へ」, `.empty` 「ここに並べる写真は、まだありません。」.

- [ ] **Step 1:** Write failing tests:
  - member selection refetches the months;
  - the filters pass `kind`, and the ★ pill uses the favourite tone;
  - sections lazy-load (mock `IntersectionObserver`);
  - the cover caption goes through `MemoryText`;
  - ★ tiles get the large class and the tape;
  - a burst opens its sequence;
  - a tile click opens `MediaViewerModal` at the right index and its source jump calls `openChat`;
  - ribbon click and keyboard scroll the right section into view (mock `scrollIntoView`);
  - a `null` colour falls back;
  - sepia on old years.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/album src/i18n/memoriesCore.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the album`.

### Task C10: Favorites cork board and film strip

**Files:**
- Create in `frontend/src/features/memories/favorites/`:
  - `FavoritesPage.tsx`: left `MemberPane` with 「全部收藏」 plus counts; right the `CorkBoard`.
  - `CorkBoard.tsx`: a `bg-memories-cork` surface, scrolling inside the pane.
    - Text favourites are paper notes (`bg-memories-paper`, `MemoryText`, 6-line clamp).
    - Photo favourites are pinned prints with a caption.
    - Voice favourites are mini player cards: `VoicePlayer` (`core/media/VoicePlayer.tsx`, variant `compact`) with the duration.
    - Each item is held by a `bg-memories-washi` strip and has a small deterministic tilt (−2…2°) derived from its id, so the layout is stable across renders. Each item shows the member name and date.
  - `FilmStrip.tsx` (shared; the names list uses it too): props `service`, `memberPath`, `date`, `focusId`, `onClose`.
    - Loads `fetchDay(service, date, {member: memberPath})` and shows a `Modal` with a horizontal strip: the focused message in the centre (larger, with ★ for a favourite) and the previous and next messages of that day on each side, as frames with times.
    - ← / → (and ‹ ›) move the focus older / newer within the day. The footer has the jump button (`jumpToChat(…, 'favorites')`).
  - Tests: `FavoritesPage.test.tsx`, `CorkBoard.test.tsx`, `FilmStrip.test.tsx`.
- Modify: `MemoriesFeature.tsx` (the `favorites` route).
- Locales (ja reference): `memories.favorites.title` 「お気に入り」, `.all` 「すべてのお気に入り」, `.voice` 「ボイス」, `.empty` 「★をつけたメッセージが、ここに飾られます。」; `memories.filmStrip.older` 「前のメッセージ」, `.newer` 「次のメッセージ」, `.title` 「この日のつづき」.

- [ ] **Step 1:** Write failing tests:
  - the board renders the three item kinds; the tilt is stable for the same id;
  - the member filter refetches;
  - clicking an item opens `FilmStrip` centred on that id with its neighbours;
  - ← / → move the focus and stop at the day's edges;
  - jump calls `openChat` with the focused id;
  - the empty state shows the invitation copy (no "0").

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/favorites src/i18n/memoriesCore.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the favorites cork board and film strip`.

### Task C11: Member memoir — list, header and 卡冊 binder

**Files:**
- Create in `frontend/src/features/memories/memoir/`:
  - `MemoirPage.tsx`:
    - Left: `MemberPane` from `fetchMemoirMembers`. The trailing slot shows `「{{earned}} / {{total}} 枚」`. Graduated members carry a small memorial marker in neutral ink.
    - Right: `MemoirHeader` above the tabs 卡冊 / 時光軸 (`Pill` tabs, `route.tab`).
    - Without `memberPath`, the first member is selected.
  - `MemoirHeader.tsx`: the current avatar (`Avatar` size lg), the serif name and the chips. Each chip is hidden when its value is `null`.
    - 「メンバーシップ {{days}} 日」.
    - 「名前を呼んでくれた {{count}} 回」: a button to the `names` tab.
    - 「声 {{h}}時間{{m}}分」: under an hour it shows `{{m}}分` only.
    - Each chip is its own small moment, which satisfies the one-number rule per element.
  - `Binder.tsx`: shelves in `SHELVES` order. Each shelf has a serif Japanese shelf title and a subtitle, then a wrap row of `CardTile`s.
  - `CardTile.tsx`:
    - Earned: face up, showing the photo (`media_url`) or her words (`MemoryText`, 4-line clamp), the date and the title.
    - Unearned: a dashed `border-memories-silhouette` outline with the condition and, when `progress` is present, a thin progress bar (neutral fill, never danger).
    - Foil: a `bg-memories-foil` overlay with `animate-shimmer` (static under reduced motion).
    - Yearly stacks show 「×{{count}}」 and fan out into per-year tiles on click.
    - The あなた shelf shows an envelope and the date, never her words.
  - `CardDetail.tsx`: a `Modal` with the large card, then the day's messages from `fetchDay(service, date, {member})` (reuse `MergedTimeline` from C8) and the jump button.
    - Pair cards show both messages.
    - Avatar cards show the old and new avatar, 「この写真と、{{days}} 日」 and the last / first messages; the message count stays in the payload but is not shown, to keep one number.
    - Graduation shows 「最後のメッセージ」 and 「ずっと、ここに。」 with no shimmer.
  - `cardCopy.ts`: maps a card key to its i18n keys. Patterns are handled generically: `anniv.dN` → `memories.cards.annivDays` with `{{days}}`, `anniv.yN` → `annivYears` with `{{years}}`, `change.avatar.*` → `avatarChange`, `count.*` → `countMessages` / `countPictures` with `{{count}}`.
  - Tests: `MemoirPage.test.tsx`, `MemoirHeader.test.tsx`, `Binder.test.tsx`, `CardTile.test.tsx`, `CardDetail.test.tsx`, `cardCopy.test.ts`.
- Modify: `MemoriesFeature.tsx` (the `memoir` route).
- Locales (ja reference): `memories.memoir.title` 「メンバーの思い出」, `.tabBinder` 「生写真帳」, `.tabTimeline` 「タイムライン」, `.progress` 「{{earned}} / {{total}} 枚」, `.chipDays` 「メンバーシップ {{days}} 日」, `.chipNames` 「名前を呼んでくれた {{count}} 回」, `.chipVoice` 「声 {{h}}時間{{m}}分」, `.chipVoiceMinutes` 「声 {{m}}分」.

  Shelves `memories.shelves.<key>.title` / `.subtitle`: first 「初めて」, anniversary 「記念日」, numbers 「数字」, special 「特別な日」, records 「記録」, moments 「瞬間」, you 「あなた」, change 「変化」, graduation 「卒業」.

  Cards `memories.cards.*` (title / condition):
  - firstMessage 「最初のメッセージ」
  - firstPicture 「最初の写真」 / 「最初の写真が届いたら」
  - firstVideo 「最初の動画」
  - firstVoice 「最初のボイス」
  - firstNickname 「はじめて名前を呼んでくれた日」
  - annivDays 「{{days}}日目」
  - annivYears 「{{years}}年目の記念日」
  - countMessages 「{{count}}通目」
  - countPictures 「{{count}}枚目の写真」
  - voiceHour 「声を、1時間」
  - nicknames100 「100回目の名前」
  - newyear 「元旦」
  - valentine 「バレンタイン」
  - christmas 「クリスマス」
  - birthday 「お誕生日」
  - subAnniversary 「あなたの記念日」
  - longest 「いちばん長いメッセージ」
  - busiestDay 「いちばんにぎやかな日」
  - nicknameDay 「いちばん名前を呼んでくれた日」
  - longestVoice 「いちばん長いボイス」
  - greetingPair 「いちばん早いおはようと、いちばん遅いおやすみ」
  - streak 「{{days}}日つづけて」
  - midnight 「日付が変わった瞬間」
  - synchro 「シンクロ」
  - oyasumiFirst 「最初のおやすみ」
  - oyasumi100 「100回目のおやすみ」
  - daisukiFirst 「最初の大好き」
  - daisuki100 「100回目の大好き」
  - letterFirst 「はじめて送った手紙」
  - letters 「{{count}}通の手紙」
  - avatarChange 「新しい写真」
  - avatarDays 「この写真と、{{days}} 日」
  - lastMessage 「最後の一通」
  - stack 「×{{count}}」
  - notYet 「まだ」

- [ ] **Step 1:** Write failing tests:
  - the list puts oshi first with progress text; selecting a member loads the header and binder;
  - chips hide when `null`; the names chip routes to the `names` tab;
  - an earned tile shows the face text through the nickname; an unearned tile shows the condition and progress bar; foil gets the foil class and is static under `prefers-reduced-motion`;
  - a stack opens its year tiles; あなた tiles never render message text;
  - `CardDetail` loads the day and its jump calls `openChat`; the avatar-change detail shows the days and both avatars;
  - `cardCopy` covers every key pattern from C2.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories/memoir src/i18n/memoriesCore.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the member memoir and photocard binder`.

### Task C12: 被叫名字的瞬間 and the 時光軸 timeline

**Files:**
- Create:
  - `frontend/src/features/blogs/components/fisheye.ts`: pure `fisheyePosition(index, count, center: number | null): number` and `fisheyeIndex(pos, count, center: number | null): number`, extracted verbatim from `TimelineRail.tsx` (`indexToNormalizedPosition` / `normalizedPositionToIndex`), together with `ZOOM_CONFIG`.
  - `frontend/src/features/blogs/components/fisheye.test.ts`.
  - `frontend/src/features/memories/memoir/NameMoments.tsx`: the `names` tab.
    - Year filter `Pill`s (newest first, plus 「すべて」).
    - Rows are newest first. Each row has the date, her avatar at the time (`Avatar` size sm) and the sentence through `MemoryText underlineNickname`.
    - Clicking a row opens `FilmStrip` (C10) for that date and id.
    - The list scrolls inside the pane. A back link returns to the binder.
  - `frontend/src/features/memories/memoir/Timeline.tsx`: the `timeline` tab.
    - Top: the selected month, with her avatar at the time, the serif month label and one number (`count`).
    - A photo strip (up to 12; clicking opens `MediaViewerModal` with jump).
    - Representative messages as small labelled cards: 「いちばん想いのこもった一通」, 「夜ふけの一通」, 「名前を呼んでくれた一通」. Null slots are omitted.
    - Milestone chips from `milestones` (`cardCopy`; foil chips use the foil token).
    - Bottom: `MonthRail`.
  - `frontend/src/features/memories/memoir/MonthRail.tsx`: a horizontal rail of monthly bars (bar height ∝ count; empty months show as a baseline tick) with a lens.
    - Interaction matches the blogs `TimelineRail`: hover dwell → fisheye zoom (`fisheye.ts`), the `bg-accent-lens` lens, drag to scrub, wheel to step, ← older / → newer. Year markers sit under the first month of each year.
    - It starts at the newest month.
    - The rail is a `role="slider"` with `aria-valuetext` = the month label.
  - Tests: `NameMoments.test.tsx`, `Timeline.test.tsx`, `MonthRail.test.tsx`.
- Modify: `frontend/src/features/blogs/components/TimelineRail.tsx` to import `fisheye.ts`. There is no behaviour change, and the existing `TimelineRail.test.tsx` must pass unchanged. Also modify `memoir/MemoirPage.tsx` to wire the `names` and `timeline` tabs.
- Locales (ja reference): `memories.names.title` 「名前を呼ばれた瞬間」, `.allYears` 「すべて」, `.back` 「生写真帳へ」; `memories.timeline.count` 「{{count}} 件」, `.top` 「いちばん想いのこもった一通」, `.late` 「夜ふけの一通」, `.nickname` 「名前を呼んでくれた一通」, `.milestones` 「この月のできごと」, `.rail` 「月をえらぶ」, `.older` 「前の月」, `.newer` 「次の月」.

- [ ] **Step 1:** Write failing tests:
  - `fisheye`: identity without a centre; the inverse round-trips within 1 index; magnified spacing around the centre.
  - `NameMoments`: the year filter refetches with `year`; the nickname span is underlined and replaced; a row click opens `FilmStrip`.
  - `MonthRail`: ← / → step months; the wheel steps; a drag scrubs (pointer events); an empty month renders a tick; `aria-valuetext`.
  - `Timeline`: changing the month fetches `timeline/{month}`; null slots are omitted; the photo click opens the viewer; milestones are rendered.
  - Run the existing `TimelineRail.test.tsx` unchanged.

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/blogs/components src/features/memories/memoir src/i18n/memoriesCore.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement: extract `fisheye.ts` first, re-run `TimelineRail.test.tsx`, then build the memoir pieces.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add name moments and the memoir timeline`.

### Task C13: Hub board

**Files:**
- Modify: `frontend/src/features/memories/MemoriesHome.tsx`, rewritten as the hub. Keep R1/R9's recap entry behaviour: the `onOpenRecap` prop and the partial-phase 「2026年の、ここまで」 label. If R9 inlined that logic, extract it into `home/RecapHubCard.tsx` first, unchanged.
- Create in `frontend/src/features/memories/home/`:
  - `OnThisDayCard.tsx`: the large top card with year label (`memories.home.yearsAgo` with `{{count}}`; `week` and `first` rules have their own copy), the member name, her line (`MemoryText`, 3-line clamp) and the photo when present. A brand-moment surface (`Atmosphere` behind it is allowed, since the hub is low density). Clicking it routes to `{page: 'onThisDay'}`, or with `first` to `{page: 'memoir', memberPath}`.
  - `hubCards.ts`: a registry `HubCardDef[]` with `{id, icon, titleKey, route | action, countKey?}`. This wave registers album (`counts.album`), memoir (`counts.members`), favorites (`counts.favorites`) and the year recap (`RecapHubCard`). Wave 4 appends voice radio, gacha and calendar. A card whose count is 0 shows no number.
  - `CountdownCard.tsx`: the 生日・紀念日 card with 「{{name}}の誕生日まで、あと {{count}} 日」 / 「メンバーシップ {{years}} 年の記念日まで、あと {{count}} 日」. On the day itself it shows 「今日は{{name}}の誕生日」 / 「今日は {{years}} 年の記念日」. Clicking opens that member's memoir. Hidden when `countdown` is `null`.
  - `HubSlots.tsx`: renders `same_time` above the On This Day card and `capsule` below it when non-null. In this wave both are always `null`, so it renders nothing; wave 4 fills it. A test asserts that it renders nothing for `null`.
  - Tests: `MemoriesHome.test.tsx`, `OnThisDayCard.test.tsx`, `CountdownCard.test.tsx`, `hubCards.test.ts`.
- Modify: `MemoriesFeature.tsx` to pass `go` to the hub. The R1 `MemoriesFeature.test.tsx` expectations for the recap card must still pass.
- Locales (ja reference): `memories.home.title` 「思い出」, `.yearsAgo` 「{{count}}年前の今日」, `.thisWeek` 「{{count}}年前の、この週」, `.firstMessage` 「はじまりの一通」, `.open` 「ひらく」, `.album` 「アルバム」, `.memoir` 「メンバーの思い出」, `.favorites` 「お気に入り」, `.countAlbum` 「{{count}} 枚」, `.countMembers` 「{{count}} 人」, `.countFavorites` 「{{count}} 件」, `.birthdayIn` 「{{name}}の誕生日まで、あと {{count}} 日」, `.birthdayToday` 「今日は{{name}}の誕生日」, `.anniversaryIn` 「メンバーシップ {{years}} 年の記念日まで、あと {{count}} 日」, `.anniversaryToday` 「今日は {{years}} 年の記念日」. Keep R1's `memories.home.recapCard`.

- [ ] **Step 1:** Write failing tests:
  - the hub renders the On This Day card from a fixture `hub` payload, with `today` / `week` / `first` copy;
  - the card click routes correctly;
  - the entry cards show their counts and hide a zero count;
  - the recap card still opens the recap;
  - countdown today vs in N days, hidden for `null`;
  - `HubSlots` renders nothing for `null`;
  - load error shows a retry (`memories.common.retry`).

  Append the keys.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories src/i18n/memoriesCore.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement. The hub is a fixed-viewport board: the large card on top and a grid of entry cards below, fitting the pane without page scroll at the minimum window size. If it does not fit, the grid scrolls inside itself.
- [ ] **Step 4:** Run the tests plus the guard and `tsc`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): replace the temporary home with the hub board`.

### Task C14: Whole-wave verification

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]` → `Added`: one user-facing line for the Memories hub, memoir (binder, timeline, name moments), On This Day with the day view, the album and the favorites board. Merge it with the recap wave's Memories entry if that entry exists.
- No new code. Fix whatever the checks below find, inside the task that owns the file.

- [ ] **Step 1: Full backend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run pytest backend/tests -q
uv run mypy backend/services/memories
uv run ruff check backend && uv run ruff format --check backend
```

- [ ] **Step 2: Full frontend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npx tsc --noEmit
npx vitest run
```

  The run includes `src/design/guard.test.ts` (new files must have 0 violations; the baseline only goes down) and `src/i18n/memoriesCore.test.ts` (every key in five locales).
- [ ] **Step 3: Log hygiene:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
timeout 60 grep -rnE "logger\.(info|warning|debug|error)\([^)]*(text|name|path|nickname|member_dir|media_file)=" backend/services/memories backend/api/memories.py
```

  Expect no hits other than the event *names*. Every field must be an id, code, count or score.
- [ ] **Step 4: Spec walk-through:** tick every bullet of spec §4, §5.1–§5.4, §6, §7, §8 and §10 against the screens, plus the self-review table below. Record the deferred wave-4 hooks (`covers.load_cover_overrides`, `HubSlots`, `DayView.headerSlot`, the `{page: 'day'}` route, `hubCards` registry) in the ledger for wave 4.
- [ ] **Step 5:** Commit `docs(changelog): note the Memories core screens`.

---

## Self-review

**Spec coverage:**

| Spec | Where |
|---|---|
| §4 On This Day card (year, member, line, photo) | C6 `hub.on_this_day`, C13 `OnThisDayCard` |
| §4 同じ時刻 line | wave 4; hook `hub.same_time` + `HubSlots` (C6, C13) |
| §4 entry cards with counts | C6 `counts`, C13 `hubCards` (wave-4 cards appended by wave 4) |
| §4 生日・紀念日 countdown | C6 `countdown`, C13 `CountdownCard` |
| §4 時光膠囊 on Home | wave 4; hook `hub.capsule` + `HubSlots` |
| §5 member list, oshi first, "18 / 30 張" | C3 `list_memoir_members`, C11 `MemoirPage` |
| §5 / §5.1 header chips, hidden when missing, earliest start | C3 `memoir_header`, C11 `MemoirHeader` |
| §5.2 `%%%` sentences, underlined, newest first, year filter, avatar at the time, click → film strip, chip hidden without `%%%` | C3 `nickname_moments`, C12 `NameMoments`, C10 `FilmStrip` |
| §5.3 shelves and every card rule, silhouettes + progress, foil, yearly stacks ×N, large view with the day and jump | C2 `cards.py` / `binder.py`, C11 `Binder` / `CardTile` / `CardDetail` |
| §5.4 monthly bars rail with lens (TimelineRail interaction), month avatar, photos, representative messages, milestones | C3 `timeline`, C12 `Timeline` / `MonthRail` / `fisheye.ts` |
| §5.4 あの日と今日 toggle | wave 4 (§14.2) |
| §6 overview B: a column per year, sepia, drag / wheel / arrow scroll, ‹ › and any-date picker | C4 `on_this_day`, C8 `OnThisDayPage` / `YearStrip` / `useDragScroll` |
| §6 detail A: year list + day view; empty years dimmed in the list, not as columns | C8 `OnThisDayDetail` |
| §6 ⇆ side by side with this year | wave 4 (§14.2) through `DayView.headerSlot` |
| §7 A merged timeline, bubbles, names and times, member chips, 包含其他團體 | C4 `day_view`, C8 `MergedTimeline` / `DayView` |
| §7 B swimlanes, hour ruler, positioned cards, click to expand | C8 `Swimlanes` / `laneLayout` |
| §8 全員 + per-member counts; month grid; filters | C5 `album_members` / `album_months`, C9 `AlbumPage` |
| §8 polaroid cover + caption, band tint, cover order incl. override and promo / screenshot-like last | C5 `choose_cover`, `covers.py` hook, C9 `PolaroidCover` / `MonthSection` |
| §8 burst stacks, hover caption, ★ larger with washi tape | C5 `album_month.bursts`, C9 `BurstStack` / `PhotoTile` |
| §8 colour ribbon (Pillow, cached) as a draggable scrubber | C5 `album_colors`, C9 `ColorRibbon` |
| §8 older years sepia | C7 `sepiaClass` + tokens, C9 |
| §8 media viewer with zoom, ←/→, jump | C9 `albumViewer` → `MediaViewerModal` |
| §10 cork board (notes, prints, voice cards, washi), left list with counts | C6 `favorites_board`, C10 `CorkBoard` |
| §10 film strip, ←/→ for more, jump to chat | C10 `FilmStrip` (via `/day?member=`) |
| §1 principles (one number, no zero, truthful, per group, layout, design system, logs, i18n, executors) | Global Constraints; enforced by C7 tokens / i18n test, C14 checks |
| §15 card unlock reuse | `cards.evaluate` / `earned_keys` / `Card.date` (C2) |

**Placeholders:** none. Every task names its files, interfaces, tests, commands and commit message. The wave-4 hooks are deliberate and named. They are: `covers.load_cover_overrides` returning `{}`, `hub.same_time` / `hub.capsule` returning `null`, `HubSlots`, `DayView.headerSlot` and the `hubCards` registry.

**Name consistency:** the same names are used everywhere:
- the service modules `people`, `view_cache`, `cards`, `binder`, `memoir`, `nickname_moments`, `timeline`, `on_this_day`, `day_view`, `album`, `album_colors`, `covers`, `favorites_board`, `hub`;
- the view codes `hub`, `on_this_day`, `day`, `album`, `favorites`, `memoir`, `binder`, `names`, `timeline`;
- the routes `onThisDay`, `album`, `memoir`, `favorites`;
- the client-log events `memories_load`, `memories_jump`, `memories_toggle`;
- the backend breadcrumbs `memories_select`, `memories_skip`, `memories_view_cache`.
