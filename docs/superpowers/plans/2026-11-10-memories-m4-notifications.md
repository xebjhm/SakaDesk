# Memories M4 — Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship wave 5, "M4 notifications", of the Memories feature (spec §15). This wave also builds the §9.3 notification for the first launch after Jan 1, which says that the full recap is ready; the recap wave did not build it. The notifications are:
- **Daily On This Day:** one per day at most, at a configurable time (12:00 JST by default), and only when a past year has messages on that date.
- **Birthday:** at 00:00 on the day, plus reminders 7 days and 1 day before.
- **Subscription anniversary and milestones:** 1年, 2年, … and 100日, 500日, 1000日. A member whose subscription has ended is skipped.
- **Year recap:** when it opens on 12/1, when the Christmas stub opens on 12/25, and at the first launch after 1/1, when it is complete.
- **Card unlock:** off by default. When it is on, only foil cards notify.

Each notification is sent at most once. The sent state is kept in app_state SQLite. Nothing is sent while the user is in Memories. Delivery works whether the window is open or the app is in the tray, and a click deep-links into Memories. Settings gains a 回憶 category with one toggle per kind.

**Architecture:**
- **Backend:** three new modules in `backend/services/memories/`.
  - `notify_rules.py` is pure: JST windows, occasions and catch-up rules. It does no I/O and takes no clock.
  - `notify_content.py` turns occasions into toast plans. It reuses `hub` (the On This Day pick), `binder` / `cards` (`earned_keys`), `recap.recap_years`, `people` and the nickname / preview helpers.
  - `notify_scheduler.py` is an asyncio task started by the FastAPI lifespan. Each tick it computes the due occasions, claims each one in the ledger before sending it, and delivers it through `notification_service`. It stops before the write barrier.
- **Delivery reuses the C1 stack:**
  - `notification_service.WindowsToastNotifier` gains `show_memory`, and `send_memory` runs it through the same `_run_guarded` worker / queue / timeout path.
  - `desktop_bridge` gains `open_memories`.
  - `desktop.py` gains `make_open_memories_handler`, which calls `window.__sakadeskOpenMemories(payload)`. It is modelled on `make_open_login_handler`.
- **"In Memories" state:** a separate flag in `ui_state`, posted by a new `POST /api/ui-state/memories`. It never overwrites the chat `UiState` that the message toasts read.
- **Storage:**
  - two new app_state tables, `memories_notify_log` and `memories_card_baseline`, created as app_state migration step 2 (fun wave F1 added the versioned `_MIGRATIONS` / `_REQUIRED_SCHEMA` mechanism; append to both);
  - six new keys in `settings.json`, with their defaults in `settings_store._SETTINGS_DEFAULTS`, served by `/api/settings`.
- **Frontend:**
  - `shell/openMemories.ts` holds the bridge entry;
  - an `appStore` deep-link slot is consumed by `MemoriesFeature`. The router gains a memoir `cardKey`, and the binder opens that card's detail;
  - a `useMemoriesUiReporter` hook;
  - a 回憶 section in the Settings General tab, in all five locales.

**Tech Stack:** FastAPI, SQLite (stdlib), structlog, `windows-toasts` (already a Windows dependency); pytest + time-machine (already in the dev group); React 18 + TS, zustand (`appStore`); vitest + Testing Library.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-11-10-memories-design.md`. It is the source of truth: §15 (the table), §9.3 (year-end unlocks and the Jan-1 notification) and §1 (principles, binding).
- **Prerequisites:** these waves are merged on `feat/memories`: M1 (index, birthdays, subscription starts, oshi), recap (R1–R9 plus fixes, closed at `132124f`) and core (C1–C14 plus fixes, closed at `97d6f17`).
  - Re-read `hub.py`, `binder.py`, `cards.py`, `recap.py` and `people.py` before Task 3. If the fun wave (F) is merged first and changed a signature named here, adapt the call site and keep one copy of each helper.
- **Controller rulings (binding, from `.superpowers/sdd/progress.md`):**
  - **JST everywhere.**
    - Every date and every time-of-day in this wave is Asia/Tokyo (`selection.JST`), whatever the machine's zone.
    - The configurable time is a JST wall-clock time. Settings labels it as JST and shows the local equivalent as a hint (Task 7).
    - JST has no DST, so a JST slot is a fixed UTC instant.
  - **Copy is literally true.**
    - Nothing may imply that she knows about the fan, addresses the fan or replies to the fan.
    - Subscription dates and milestones are the fan's own ("メンバーシップ N 年目"), never "she remembered".
    - "Today" copy is shown only on the JST day it is true (see the missed-notification decision).
    - Her words are quoted, never paraphrased.
  - **At most one number per notification**, counting title and body together: years ago, days left, the milestone or the recap year. Never a count of messages and never "0".
  - **Log codes are ids, codes and counts only, in snake_case.**
    - Never log titles, bodies, names, nicknames, member paths, file paths, quoted text or card keys with dots.
    - People are logged as `member_id`. A card is logged as `card` = the key with `.` and `@` replaced by `_`, e.g. `special_birthday_2026`.
  - **Shared client-log fixture:** every new frontend code value is appended to `backend/tests/fixtures/memories_log_codes.json`. `memoriesLog.test.ts` and `test_client_log_api.py::test_every_memories_code_the_frontend_emits_is_allowlisted` keep it in sync.
- **Reuse, never duplicate:**
  - message toasts: `notification_service._run_guarded`, the toast worker, `get_notifier`, the `notify_sent` / `notify_failed` / `notify_skip` events;
  - `notification_planner.find_avatar`, plus a new `clip_text` that both `preview_text` and Memories use;
  - `nickname.apply_nickname` / `nickname_for`;
  - `i18n.get_strings` / `resolve_ui_language`;
  - `background_tasks` patterns, `shutdown_state.is_shutting_down`, `auto_sync_scheduler.scheduler_allowed_in_env`;
  - `desktop_bridge`'s handler pattern;
  - the hub's On This Day pick, `cards.earned_keys`, `recap.recap_years` and the hub's subscription-lapsed check (`sync_metadata` `is_active`).
- **Delivery rules shared with message toasts:**
  - The global `notifications_enabled` switch gates every Memories toast.
  - `notifications_hide_content` drops her quoted words and the photo, and keeps the member name (the message toasts also keep the name in the title).
  - Windows Focus Assist is respected by Windows itself; there are no in-app quiet hours (C1 decision).
- **Toast text:**
  - `%%%` / `％％％` is replaced with the fan's nickname for that service (`nickname_for`). Without a nickname it becomes the mask `『＊＊＊』` (the Memories rule in `shared/nicknameMask.ts`, not the chat's leave-as-is rule).
  - Then the text is whitespace-collapsed and clipped to `QUOTE_MAX_CHARS = 60` characters plus `…`.
- **i18n:**
  - Backend toast strings go in the new `backend/i18n/<lang>/memories_notify.json` for `en`, `ja`, `zh-TW`, `zh-CN` and `yue` (exact copy in Task 3).
  - Frontend strings go under `settings.memoriesNotify.*` in `frontend/src/i18n/locales/*.json` (exact copy in Task 7).
  - Japanese is the reference wording.
- **Engineering:**
  - Use `uv run` and never pip. Commit with `uv run git commit`: Conventional Commits, subject ≤ 72 chars, plus the `Co-Authored-By` trailer.
  - File I/O is `utf-8`. Use `pathlib` only. No `print()`. Logging uses `structlog.get_logger(__name__)`.
  - SQLite and file reads run in `asyncio.to_thread`. Card evaluation and the On This Day pick already run in workers (`binder._evaluate`, `hub`).
  - `time-machine` is used for every date or time edge.
- **Branch:** `feat/memories` in SakaDesk. Other agents may be committing: stage only the files a task names.

## Decisions taken by this plan (spec ambiguities)

1. **Missed notifications: catch up on the same JST day, never on a later day.**
   - Every date-bound notification has a window that runs from its fire time to the end of that JST day.
   - If the app was not running, or the PC was asleep, at the fire time, the notification fires at the next tick inside the window. That can be at launch, after `STARTUP_DELAY_S = 60` s.
   - After the day ends it is dropped. No skip is logged per missed occasion: the next day's rules simply no longer produce it.
   - Why: "3年前の今日" and "あと7日" are only true on that day, and a stale catch-up the next day would be both false and noisy.
   - The one exception is set by the spec: the Jan-1 "recap ready" notification. Its window is Jan 1 00:00 to Jan 31 23:59:59 JST, so the *first launch* after Jan 1 sends it. After January the recap shelf shows it anyway.
2. **Fire times (JST):**
   - Birthday day-of: 00:00 (spec).
   - Every other date kind uses the one configurable daily time `memories_notify_time` (default `12:00`): On This Day, the 7-day and 1-day reminders, anniversaries and milestones, recap open (12/1) and the Christmas stub (12/25).
   - Recap ready: from Jan 1 00:00.
   - Card unlocks fire when a sync's data shows a newly earned foil card.
3. **"One per day" for On This Day is across all services.**
   - Each service with data proposes its best moment with the hub's `today` rule: oshi first, then importance. The proposals are ranked oshi first, then score, then `get_all_services()` order, and one toast is sent per JST day.
   - With no past message on today's month-day in any service, nothing is sent (no week/first fallback), and the day is recorded as `empty`.
4. **Anniversaries are coalesced.**
   - A fan often subscribed to several members on the same day. All members reaching the same milestone on the same day in one service share one toast, which names them oshi first, joined by `・` and clipped. The milestone is the one number.
   - Different milestones on the same day send one toast each.
   - Members whose subscription lapsed (`hub` lapsed-groups rule) and graduated members are skipped.
5. **Birthdays skip graduated members**, like the hub countdown. A Feb 29 birthday falls on Feb 28 in non-leap years (`cards.parse_birthday` plus the hub's `_on_year` rule). Reminders count back from that date.
6. **Recap notifications are per service** and only when that year has a recap (`recap.recap_years` contains it; otherwise `reason=no_recap`).
7. **Card unlock:**
   - It is foil only: `first.nickname`, `count.messages.10000`, `special.birthday` (and its `@year` keys), `moment.synchro` and `moment.midnight`.
   - `grad.last` (a graduated member's last message) is foil too, but it is **excluded**. A celebratory "new card" toast for a goodbye would be jarring, and the user can still find the card in the binder. This is flagged for the user below.
   - The keys are diffed, never the dates.
   - **Baseline seeding:** the first check of a person seeds silently, and so does the first check after the toggle is turned on, so the fan's history never floods in.
   - A transient empty evaluation never shrinks the baseline (the baseline is the union of the old and new keys).
   - Several new foil cards for one person in one check share one toast.
8. **Suppressed while in Memories** means the Memories feature is mounted **and** the window is focused and visible. The occasion is then recorded as `suppressed` and is not re-sent later: the fan is already looking at Memories.
9. **Turning a toggle on later the same day** delivers that day's occasion if its window is still open. Disabled kinds leave no ledger row, so this works. When the global switch is off, nothing is recorded either.
10. **At-most-once delivery:** an occasion is claimed (`INSERT OR IGNORE`, outcome `pending`) before the toast is shown, then marked `sent` or `failed`. A failed or interrupted show is never retried. A duplicate toast is worse than a missed one.

## Shared contracts (all tasks)

**Occasion and ledger key.** Kind codes are `on_this_day`, `birthday`, `birthday_soon`, `anniversary`, `recap` and `card`.

| kind | `service` | `subject` | `occasion` | window (JST) |
|---|---|---|---|---|
| `on_this_day` | `*` | `""` | `YYYY-MM-DD` | that day, from the slot time to 24:00 |
| `birthday` | service | `member_id` | `YYYY-MM-DD` | that day, 00:00–24:00 |
| `birthday_soon` | service | `member_id` | `YYYY-MM-DD:7` or `:1` (birthday date : days left) | the notify day, slot to 24:00 |
| `anniversary` | service | `member_id` | `y<N>` / `d<N>` plus `@YYYY-MM-DD` | that day, slot to 24:00 |
| `recap` | service | `open` / `christmas` / `ready` | `YYYY` (the recap year) | 12-01 slot–24:00 / 12-25 slot–24:00 / Jan 1 00:00 – Jan 31 24:00 |
| `card` | service | `member_id` | card key, e.g. `special.birthday@2026` | none (event-driven) |

**Tables** (app_state SQLite, added as migration step 2 in `_MIGRATIONS` with `CREATE TABLE IF NOT EXISTS`, names added to `_REQUIRED_SCHEMA`; existing rows are untouched):

```sql
CREATE TABLE IF NOT EXISTS memories_notify_log (
    kind TEXT NOT NULL, service TEXT NOT NULL, subject TEXT NOT NULL, occasion TEXT NOT NULL,
    outcome TEXT NOT NULL,          -- pending | sent | failed | suppressed | empty
    at TEXT NOT NULL,               -- UTC ISO of the last outcome write
    PRIMARY KEY (kind, service, subject, occasion)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS memories_card_baseline (
    service TEXT NOT NULL, member_id TEXT NOT NULL,
    keys TEXT NOT NULL,             -- JSON array of earned_keys, sorted
    data_hash TEXT NOT NULL,        -- binder.binder_hash at the last check
    at TEXT NOT NULL,
    PRIMARY KEY (service, member_id)
) WITHOUT ROWID;
```

**Settings keys** (`settings.json`, `_SETTINGS_DEFAULTS`, `SettingsResponse` / `SettingsUpdate`):

| key | type | default | meaning |
|---|---|---|---|
| `memories_notify_on_this_day` | bool | `true` | daily On This Day |
| `memories_notify_birthday` | bool | `true` | birthday plus the 7-day and 1-day reminders |
| `memories_notify_anniversary` | bool | `true` | subscription anniversaries and milestones |
| `memories_notify_recap` | bool | `true` | recap open / Christmas / ready |
| `memories_notify_cards` | bool | `false` | foil card unlocks |
| `memories_notify_time` | str `HH:MM` | `"12:00"` | JST daily time; `SettingsUpdate` validates `^([01]\d|2[0-3]):[0-5]\d$` (else 422) |

**Toast plan** (`notification_planner.py`, beside `ToastPlan`):

```python
@dataclass(frozen=True)
class MemoryToastPlan:
    kind: str                     # a kind code above
    service: str                  # the service the click opens (never "*")
    subject: str                  # ledger subject
    occasion: str                 # ledger occasion
    title: str
    body: str
    avatar: Path | None           # AppLogo image (find_avatar of her newest room)
    hero: Path | None             # Hero image (On This Day photo), None when hidden
    route: Mapping[str, str | int]  # the Memories route, camelCase keys (frontend contract)
    member_id: str | None         # for logs
```

**Deep-link payload**: `window.__sakadeskOpenMemories({"service": ..., "route": {...}})`. It returns `true` when it navigated. Routes:

| kind | route |
|---|---|
| `on_this_day` | `{"page": "onThisDay", "monthDay": "MM-DD", "year": <moment year>}` (the detail A of that year) |
| `birthday`, `birthday_soon` | `{"page": "memoir", "memberPath": <chat path>, "tab": "binder"}` |
| `anniversary` | `{"page": "memoir", "memberPath": ..., "tab": "binder", "cardKey": "anniv.y1"}` (`anniv.d100` / `d500` / `d1000` / `y<N>`; the first named member's) |
| `recap` | `{"page": "recap", "year": <year>}` |
| `card` | `{"page": "memoir", "memberPath": ..., "tab": "binder", "cardKey": <base key, e.g. "special.birthday">}` |

**Backend breadcrumbs** (snake_case codes):
- `memories_notify_tick` (`due`, `sent`, `suppressed`, `next_in_s`);
- `memories_notify_skip` (`kind`, `service`, `reason`, plus `member_id` / `count` where relevant). The reasons are `notifications_off`, `kind_off`, `already_done`, `in_memories`, `empty`, `no_recap`, `graduated`, `subscription_ended`, `bad_birthday`, `seeded`, `no_facts`, `shutting_down`, `unavailable`;
- `memories_notify_failed` (`stage`, `error_type`);
- `memories_card_check` (`service`, `persons`, `evaluated`, `seeded`, `new_foil`);
- the delivery events from `notification_service` with `kind=memories` and `memory_kind=<kind>`: `notify_sent`, `notify_failed`, `notify_skip`, `notify_clicked`;
- `notify_open_memories` / `notify_open_memories_failed` from `desktop.py` (`service`, `target` = page code, `delivered` or `reason`).

**Frontend client-log event** `notify_open_memories` (`service`, `target` = `on_this_day|memoir|recap`, `delivered`, `reason` = `unknown_service|malformed|onboarding`). `memories_skip` gains the reason `card_missing` (`target=binder`).

---

### Task 1: Storage — notify ledger, card baseline and settings keys

**Files:**
- Modify:
  - `backend/services/app_state.py`: the two tables as migration step 2, the functions below and their `a*` wrappers.
  - `backend/services/settings_store.py`: six defaults.
  - `backend/api/settings.py`: response and update fields, the time validation, a wake hook (a no-op until Task 5) and the card-baseline reset.
- Create: `backend/tests/test_memories_notify_store.py`
- Modify: the settings API tests that pin the response shape (`backend/tests/test_settings*.py`; find them with `timeout 60 grep -rln "notifications_hide_content" backend/tests`).

**Interfaces (`app_state.py`):**
- `claim_memory_notification(kind, service, subject, occasion, outcome="pending", *, at=None) -> bool`: `INSERT OR IGNORE`. Returns True when this call inserted the row, i.e. the occasion was not yet taken.
- `finish_memory_notification(kind, service, subject, occasion, outcome: str, *, at=None) -> None`: updates `outcome` and `at`.
- `memory_notifications_done(keys: list[tuple[str, str, str, str]]) -> set[tuple[str, str, str, str]]`: the keys that already have a row (any outcome). Chunked by `_IN_CHUNK`, like `favorited_at`. It uses one `OR`-joined query per chunk or a temporary `VALUES` CTE; the test pins 1,200 keys.
- `prune_memory_notifications(before: datetime) -> int`: deletes rows with `at < before`. The scheduler calls it at start with `now - 400 days`.
- `get_card_baseline(service, member_id) -> tuple[frozenset[str], str] | None`, `put_card_baseline(service, member_id, keys: Iterable[str], data_hash: str) -> None` (sorted JSON) and `clear_card_baselines() -> int`.
- `a*` wrappers (`aclaim_memory_notification`, …) via `asyncio.to_thread`, in the "SD-BE-SVC-10" block.
- Every function opens with `with closing(_connect()) as c, c:`.

**`settings.py`:**
- Add the six fields to `SettingsResponse` (with the defaults in the table) and to `SettingsUpdate`. `memories_notify_time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")`.
- Apply them in `_apply`.
- When any `memories_notify_*` value changed, call `memories_notify_settings_changed()`.
  - In this task it is a module-level function in `backend/services/memories/notify_scheduler.py` that only logs `memories_notify_wake_requested woken=False`.
  - Task 5 fills in the scheduler.
  - Create the module now with that function and a docstring that says Task 5 completes it.
- When `memories_notify_cards` changed from false to true, `await app_state.aclear_card_baselines()` and log `memories_notify_cards_enabled` with `cleared=<count>`.

- [ ] **Step 1:** Write failing tests in `test_memories_notify_store.py` (each test sets `app_state.set_db_path(tmp_path / "app_state.db")` and calls `init_db()`):
  - **Migration:** create a DB with only the old four tables and a `favorite_log` row. Run `init_db()`. The two new tables exist and the `favorite_log` row is intact. A second `init_db()` is a no-op.
  - **Claim:** the first claim returns True; a second claim of the same key returns False and keeps the first row's outcome; `finish` updates the outcome; `done` returns only the claimed keys (1,200 mixed keys, half claimed).
  - **Prune:** removes old rows only.
  - **Baseline:** round trip; `put` sorts the keys; `clear` returns the count.
  - **Non-ASCII:** a subject of `"58"` with an occasion of `special.birthday@2026` round-trips. No names are stored anywhere (assert the table columns).
  - **Settings API** (the `client` fixture):
    - `GET /api/settings` has the six defaults;
    - `POST` with `memories_notify_time="07:30"` persists it;
    - `"24:00"`, `"7:30"` and `"12:00:00"` give 422;
    - false → true on `memories_notify_cards` clears the baselines (seed one first);
    - true → true does not clear them;
    - a changed key calls `memories_notify_settings_changed` (monkeypatch a spy).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_notify_store.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_memories_notify_store.py backend/tests/test_memories_favorite_log.py -q`, the settings tests you touched, and `uv run mypy backend/services/app_state.py backend/api/settings.py`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): store Memories notification state and settings`.

### Task 2: Pure schedule rules (`notify_rules.py`)

**Files:**
- Create: `backend/services/memories/notify_rules.py` (pure: no I/O, no logging, no clock; every function takes `now` or `today`), `backend/tests/test_memories_notify_rules.py`

**Interfaces:**

```python
KINDS = ("on_this_day", "birthday", "birthday_soon", "anniversary", "recap", "card")
SETTING_FOR_KIND = {"on_this_day": "memories_notify_on_this_day", "birthday": "memories_notify_birthday",
                    "birthday_soon": "memories_notify_birthday", "anniversary": "memories_notify_anniversary",
                    "recap": "memories_notify_recap", "card": "memories_notify_cards"}
DEFAULT_SLOT = time(12, 0)
REMINDER_DAYS = (7, 1)
DAY_MILESTONES = (100, 500, 1000)
RECAP_READY_LAST = (1, 31)          # Jan 31 is the last day of the "first launch after 1/1" window
FOIL_NOTIFY_EXCLUDED = frozenset({"grad.last"})

@dataclass(frozen=True)
class Window:
    start: datetime   # aware UTC
    end: datetime     # aware UTC, exclusive

@dataclass(frozen=True)
class Occasion:
    kind: str
    service: str      # "*" for on_this_day
    subject: str
    occasion: str
    window: Window
    day: date         # the JST date the copy is about (birthday date, anniversary date, …)
    number: int | None  # the one number (years ago is filled in later by content; days left; N; year)

def parse_slot(raw: object) -> time                       # "HH:MM" → time; anything else → DEFAULT_SLOT
def jst_today(now: datetime) -> date                      # selection.jst(now).date(); naive raises ValueError
def at_jst(day: date, t: time) -> datetime                # aware UTC instant of day t JST
def day_window(day: date, t: time) -> Window              # [at_jst(day, t), at_jst(day + 1, 00:00))
def is_open(w: Window, now: datetime) -> bool             # start <= now < end
def next_wake(now: datetime, slot: time, max_sleep_s: float) -> float
    # seconds until the earliest of: today's slot (if still ahead), tomorrow 00:00 JST, now + max_sleep_s; never < 1
def birthday_date(raw: str | None, year: int) -> date | None
    # cards.parse_birthday; Feb 29 → Feb 28 in a non-leap year (same rule as hub._on_year)
def birthday_occasions(service: str, member_id: str, raw: str | None, today: date, slot: time) -> list[Occasion]
    # day-of (birthday, 00:00 window) when today is her birthday; birthday_soon when today + 7 / + 1 is it
    # (also across New Year: Dec 25 → Jan 1); number = days left for birthday_soon, None for day-of
def anniversary_occasions(service: str, member_id: str, start: date | None, today: date, slot: time) -> list[Occasion]
    # y<N> when today == cards.anniversary_date(start, N), N >= 1;
    # d<N> when today == cards.subscription_day_date(start, N), N in DAY_MILESTONES; number = N
def recap_occasions(service: str, today: date, slot: time) -> list[Occasion]
    # Dec 1 → ("open", year); Dec 25 → ("christmas", year); Jan 1..Jan 31 → ("ready", year - 1)
def on_this_day_occasion(today: date, slot: time) -> Occasion   # service "*", subject "", occasion today.isoformat()
def notifiable_foil(cards: Iterable[cards.Card]) -> frozenset[str]
    # base keys of foil cards, minus FOIL_NOTIFY_EXCLUDED
def new_foil_keys(previous: frozenset[str], current: frozenset[str], foil: frozenset[str]) -> dict[str, str]
    # {base key: occasion key}; occasion = the newest "@year" key when one is new, else the base key
def base_key(key: str) -> str                             # "special.birthday@2026" → "special.birthday"
def log_card_code(key: str) -> str                        # "special.birthday@2026" → "special_birthday_2026"
```

- Windows end at the next JST midnight. The `ready` window is `[at_jst(Jan 1, 00:00), at_jst(Feb 1, 00:00))`.
- `anniversary_occasions` uses only `cards.anniversary_date` / `cards.subscription_day_date`, so these dates match the binder and the hub countdown.

- [ ] **Step 1:** Write failing tests. Every case that depends on the clock uses `time_machine.travel(..., tick=False)` and passes `datetime.now(timezone.utc)` into the functions, so the tests exercise the real clock path.
  - **Midnight JST:**
    - At 2026-03-15 23:59:59 JST, the 03-15 window is open. At 2026-03-16 00:00:00 JST it is closed and the 03-16 birthday window is open.
    - At 2026-03-15 15:00 UTC (= 03-16 00:00 JST), `jst_today` is 03-16.
  - **JST vs a local-zone user:**
    - Travel with `tzinfo=ZoneInfo("America/New_York")` on 2026-11-01, the US DST end. The 12:00 JST slot on 11-01 and 11-02 is always 03:00 UTC.
    - `next_wake` from 2026-11-01 01:30 New York (a repeated hour) returns the same seconds whether it is the first or the second 01:30.
    - Repeat with `ZoneInfo("Europe/London")` on 2026-03-29.
  - **Leap day:**
    - A 02-29 birthday gives a day-of on 2027-02-28 and on 2028-02-29.
    - The reminders fall on 2027-02-21 (7 days) and 2027-02-27 (1 day), and on 2028-02-22 and 2028-02-28.
    - A start of 2024-02-29 gives `y1` on 2025-02-28 and `y4` on 2028-02-29. `d100` = 2024-06-07 (day 1 = start).
  - **Year boundary:** a 01-03 birthday gives a 7-day reminder on 12-27 of the year before. The recap `ready` occasion is year − 1 throughout January and absent on Feb 1. `open` occurs only on 12-01 and `christmas` only on 12-25.
  - **Slot parsing:** `"07:30"` → 07:30; `"25:00"`, `None`, `730` and `"12:00:00"` → 12:00.
  - **`next_wake`:**
    - at 11:59:00 JST with slot 12:00 → 60 s;
    - at 12:00:30 → the minimum of (to 00:00 JST) and `max_sleep_s`;
    - never below 1.
  - **Card diff:**
    - previous `{first.message}`, current adds `moment.midnight` and `count.messages.100` → only `moment.midnight` (foil);
    - `special.birthday` plus `special.birthday@2026` both new → one entry `{special.birthday: special.birthday@2026}`;
    - only `special.birthday@2027` new → `{special.birthday: special.birthday@2027}`;
    - `grad.last` new → nothing.
  - **`log_card_code`** matches `^[a-z0-9_]{1,40}$` for every key in `cards.SHELVES`' catalogue examples.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_notify_rules.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same tests and `uv run mypy backend/services/memories/notify_rules.py`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add JST rules for Memories notifications`.

### Task 3: Toast content — On This Day, birthdays, anniversaries, recap, cards

**Files:**
- Create:
  - `backend/services/memories/notify_content.py`
  - `backend/i18n/{en,ja,zh-TW,zh-CN,yue}/memories_notify.json`
  - `backend/tests/test_memories_notify_content.py`
- Modify:
  - `backend/services/memories/hub.py`: expose the `today`-only pick and the lapsed check. `build_hub` behaviour and payload stay unchanged.
  - `backend/services/notification_planner.py`: `clip_text`, used by `preview_text`, plus `MemoryToastPlan`.
  - `backend/services/nickname.py`: `apply_nickname_or_mask`.
  - `backend/tests/test_memories_hub.py`: the renamed helpers.
  - `backend/tests/test_notification_planner.py`: a `clip_text` test; `preview_text` output is unchanged.

**Interfaces:**

`notification_planner.py`:
- `clip_text(text: str, limit: int = PREVIEW_MAX_CHARS) -> str`: whitespace-collapse, then cut to `limit` plus `…`. `preview_text` calls it, and its output is byte-identical to before (the existing tests prove it).
- `MemoryToastPlan` (see Shared contracts).

`nickname.py`:
- `apply_nickname_or_mask(text: str, nickname: str | None, mask: str) -> str`: every placeholder becomes `nickname`, or `mask` when the nickname is empty. The docstring says that the chat keeps the placeholder while Memories masks it.

`hub.py`:
- Rename `_lapsed_groups` → `lapsed_groups` and `_subscribed` → `still_subscribed` (public; update `_countdown` and the tests).
- Add `async def today_moment(service, sdir, summaries, oshi, today) -> dict | None`. It is the `today` rule only: `people.service_facts_on(..., month_day=...)` → `_pick_today` in a worker → the same message / photo assembly as `_on_this_day`.
  - Refactor `_on_this_day` so that both share one `_assemble(service, sdir, rule, pick, oshi, today)` helper.
  - Returns the `_on_this_day` object, or `None` when today has nothing. It logs `memories_skip view=hub_otd reason=no_today` as before.
  - `build_hub` keeps the week/first fallbacks.

`notify_content.py`:
- `QUOTE_MAX_CHARS = 60`.
- `@dataclass(frozen=True) class Context`: `settings: Mapping[str, Any]`, `strings: Strings` (the `memories_notify` section), `now: datetime`, `hide_content: bool`.
- `async def load_context(settings, now) -> Context`: `resolve_ui_language` in a thread, then `get_strings("memories_notify", lang)`.
- `def quote(ctx, text: str | None, service: str) -> str | None`: `apply_nickname_or_mask(text, nickname_for(ctx.settings, service), ctx.strings["nickname_masked"])` → `clip_text(..., QUOTE_MAX_CHARS)`. Empty → `None`.
- `def plural(ctx, key: str, n: int) -> str`: `ctx.strings[f"{key}_one"]` when `n == 1`, else `ctx.strings[f"{key}_other"]`, formatted with `n=n`.
- `async def on_this_day_plan(ctx, services: Sequence[str], occasion: Occasion) -> MemoryToastPlan | None`:
  - For each service with a data dir (`people.service_data_dir`, skipping `ValueError`), call `today_moment`. Rank the moments (oshi first via `people.oshi_rooms`, then `hub._score` of the message, then service order) and keep one.
  - **Title:** `plural("otd_title", years_ago)`.
  - **Body:** `otd_body` with `name` and `quote` (her text, or the photo's caption) when there is a quote; `otd_body_photo` when the moment is a photo without words; `otd_body_hidden` when `hide_content`.
  - **Hero:** `sdir / photo.media_file` (or `message.media_file` for a picture-only moment) when the file exists and not `hide_content`. Check existence in a worker.
  - **Avatar:** `find_avatar(sdir / room)`.
  - **Route:** `onThisDay` with `monthDay` = today's `MM-DD` and `year` = the moment's year.
  - `None` when no service has a moment.
- `async def birthday_plans(ctx, service, sdir, summaries, occasions) -> list[MemoryToastPlan]`: one per occasion. Title `birthday_title` (day-of) or `plural("birthday_soon_title", days)`; body `birthday_body`. The route opens the memoir binder of the person's newest room path (`people.chat_path(sdir, summary.member_dirs[-1])`).
- `async def anniversary_plans(ctx, service, sdir, ordered, occasions) -> list[tuple[MemoryToastPlan, list[Occasion]]]`:
  - Group the occasions by milestone. Each tuple is one plan per milestone, whose `subject` / `occasion` are the first member's, together with the occasions it covers. The scheduler records a ledger row for every covered member.
  - **Title:** `plural("anniv_years_title", N)` or `plural("anniv_days_title", N)`.
  - **Body:** `anniv_body` with `names` = the names in `ordered` order (oshi first) joined by `ctx.strings["name_join"]` and `clip_text(..., 40)`.
  - **Route:** `cardKey` `anniv.y<N>` / `anniv.d<N>` of the first member.
- `async def recap_plan(ctx, service, sdir, occasion) -> MemoryToastPlan | None`:
  - `None` (the scheduler logs `reason=no_recap`) when `occasion.number` is not in `await recap.recap_years(sdir, now=ctx.now)`.
  - Titles `recap_open_title` / `recap_christmas_title` / `recap_ready_title` with `year`; bodies `recap_open_body` / `recap_christmas_body` / `recap_ready_body`. Each pair holds exactly one number.
  - **Route:** `recap` with `year`.
- `async def card_plans(ctx, service, sdir, summaries, oshi) -> tuple[list[tuple[MemoryToastPlan, list[str]]], dict[str, int]]`:
  - For each person, compare `binder.binder_hash` with the stored baseline hash. When they are equal, skip.
  - Otherwise `binder.evaluate_person` → `cards.earned_keys`.
    - If `first.message` is not earned → skip with `no_facts`, baseline untouched.
    - No baseline → seed (`seeded`).
    - Else `notify_rules.new_foil_keys(prev, now, notifiable_foil(cards))`.
  - Write the baseline as `prev | now` with the new hash.
  - One plan per person with new foil keys: title `card_title`, body `card_body` with `name`, route `cardKey` = the first new base key in `cards.SHELVES` / catalogue order. The covered occasion keys are returned with the plan.
  - The counts dict holds `persons`, `evaluated`, `seeded` and `new_foil` for `memories_card_check`.
- Every builder skips persons with `graduated` for birthday and anniversary (`reason=graduated`), and anniversary persons failing `hub.still_subscribed(summary, hub.lapsed_groups(sdir))` (`reason=subscription_ended`). It logs `memories_notify_skip` with `member_id`.

**Backend strings — `memories_notify.json`** (keys identical in every locale; `{name}`, `{names}`, `{quote}`, `{n}`, `{year}` are the only placeholders; the test pins them):

| key | ja (reference) | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `otd_title_one` | `{n}年前の今日` | `{n} year ago today` | `{n}年前的今天` | `{n}年前的今天` | `{n}年前嘅今日` |
| `otd_title_other` | `{n}年前の今日` | `{n} years ago today` | `{n}年前的今天` | `{n}年前的今天` | `{n}年前嘅今日` |
| `otd_body` | `{name}「{quote}」` | `{name}: "{quote}"` | `{name}「{quote}」` | `{name}“{quote}”` | `{name}「{quote}」` |
| `otd_body_photo` | `{name}の写真が届いた日` | `The day a photo from {name} arrived` | `收到{name}照片的那一天` | `收到{name}照片的那一天` | `收到{name}相嘅嗰日` |
| `otd_body_hidden` | `{name}のメッセージを振り返る` | `Look back at {name}'s messages` | `回顧{name}的訊息` | `回顾{name}的消息` | `回顧{name}嘅訊息` |
| `birthday_title` | `今日は{name}の誕生日` | `Today is {name}'s birthday` | `今天是{name}的生日` | `今天是{name}的生日` | `今日係{name}嘅生日` |
| `birthday_soon_title_one` | `{name}の誕生日まで、あと{n}日` | `{n} day until {name}'s birthday` | `距離{name}的生日，還有{n}天` | `距离{name}的生日，还有{n}天` | `距離{name}嘅生日，仲有{n}日` |
| `birthday_soon_title_other` | `{name}の誕生日まで、あと{n}日` | `{n} days until {name}'s birthday` | `距離{name}的生日，還有{n}天` | `距离{name}的生日，还有{n}天` | `距離{name}嘅生日，仲有{n}日` |
| `birthday_body` | `思い出で、{name}のこれまでを振り返る` | `Look back on {name} in Memories` | `在回憶裡回顧{name}的點點滴滴` | `在回忆里回顾{name}的点点滴滴` | `喺回憶入面回顧{name}嘅點點滴滴` |
| `anniv_years_title_one` | `今日はメンバーシップ{n}年目の記念日` | `Today is your {n}-year membership anniversary` | `今天是會員第{n}年的紀念日` | `今天是会员第{n}年的纪念日` | `今日係會員第{n}年嘅紀念日` |
| `anniv_years_title_other` | `今日はメンバーシップ{n}年目の記念日` | `Today is your {n}-year membership anniversary` | `今天是會員第{n}年的紀念日` | `今天是会员第{n}年的纪念日` | `今日係會員第{n}年嘅紀念日` |
| `anniv_days_title_one` | `今日はメンバーシップ{n}日目` | `Today is day {n} of your membership` | `今天是會員第{n}天` | `今天是会员第{n}天` | `今日係會員第{n}日` |
| `anniv_days_title_other` | `今日はメンバーシップ{n}日目` | `Today is day {n} of your membership` | `今天是會員第{n}天` | `今天是会员第{n}天` | `今日係會員第{n}日` |
| `anniv_body` | `{names}とのメンバーシップ` | `Your membership with {names}` | `與{names}的會員資格` | `与{names}的会员资格` | `同{names}嘅會員資格` |
| `name_join` | `・` | `, ` | `、` | `、` | `、` |
| `recap_open_title` | `{year}年の、ここまで` | `{year} so far` | `{year}年，到目前為止` | `{year}年，到目前为止` | `{year}年，到而家為止` |
| `recap_open_body` | `思い出で、今年をふりかえる` | `Look back on this year in Memories` | `在回憶裡回顧今年` | `在回忆里回顾今年` | `喺回憶入面回顧今年` |
| `recap_christmas_title` | `クリスマスのページが開きました` | `The Christmas page is open` | `聖誕節的那一頁打開了` | `圣诞节的那一页打开了` | `聖誕節嗰頁打開咗` |
| `recap_christmas_body` | `思い出で、今年をふりかえる` | `Look back on this year in Memories` | `在回憶裡回顧今年` | `在回忆里回顾今年` | `喺回憶入面回顧今年` |
| `recap_ready_title` | `{year}年の思い出が、そろいました` | `Your {year} in Memories is complete` | `{year}年的回憶，完整了` | `{year}年的回忆，完整了` | `{year}年嘅回憶，齊晒喇` |
| `recap_ready_body` | `最後のページまで、ひらけます` | `Every page is open now, to the last one` | `每一頁都打開了，直到最後一頁` | `每一页都打开了，直到最后一页` | `每一頁都打開咗，直到最後一頁` |
| `card_title` | `生写真帳に、きらめくカード` | `A foil card joined your binder` | `相冊裡多了一張閃亮的卡` | `相册里多了一张闪亮的卡` | `相冊入面多咗張閃卡` |
| `card_body` | `{name}の生写真帳` | `{name}'s binder` | `{name}的相冊` | `{name}的相册` | `{name}嘅相冊` |
| `nickname_masked` | `『＊＊＊』` | `『＊＊＊』` | `『＊＊＊』` | `『＊＊＊』` | `『＊＊＊』` |

(The `*_one` / `*_other` pairs exist because `get_strings` has no plural support. Only English differs.)

- [ ] **Step 1:** Write failing tests. Use `backend/tests/memories_archive.py` (`write_room`, `msg`, `write_side_inputs`) for synthetic archives, `time_machine` for `now`, and stub `oshi.oshi_names` with monkeypatch.
  - **On This Day:**
    - the oshi's 2023 moment wins over a higher-importance non-oshi 2024 moment, and the title is `3年前の今日` in ja for a 2026 travel date;
    - with two services, the oshi in service B beats the non-oshi in service A;
    - a day that has only near dates (±3) gives `None` (no week fallback);
    - a photo-only day gives `otd_body_photo` plus the hero path;
    - `hide_content` gives `otd_body_hidden`, `hero=None`, and an avatar still set;
    - `%%%` with nickname `"みく推し"` in settings is replaced, and without a nickname it becomes `『＊＊＊』`;
    - a 200-character quote is clipped to 60 plus `…`;
    - emoji and CJK survive;
    - 02-29 travelled in 2028 uses only leap years.
  - **Birthday:**
    - day-of and 7 / 1 reminders produce the right titles (en plural: `1 day until`, `7 days until`);
    - a graduated person is skipped with `reason=graduated`;
    - the route is the memoir binder of her newest room.
  - **Anniversary:**
    - three members with the same start produce one `y1` plan whose names are oshi first, plus the covered occasions for all three;
    - a lapsed member (`server_groups` `is_active: false`) is skipped with `reason=subscription_ended`;
    - `d100` → `Today is day 100 of your membership`, and the route `cardKey` is `anniv.d100`.
  - **Recap:** `open` is planned only when the year is in `recap_years` (stub it); otherwise `None`. `ready` on 2027-01-05 is for 2026.
  - **Cards:**
    - the first check seeds (`seeded=1`, no plans);
    - a second check with a new midnight message after 00:00 JST → one plan, `cardKey=moment.midnight`;
    - an unchanged `binder_hash` → `evaluated=0`;
    - an index returning no facts → `no_facts`, baseline unchanged;
    - `special.birthday@2027` newly earned → one plan whose occasion is the `@2027` key.
  - **One number:**
    - for every plan built in these tests, `len(re.findall(r"\d+", title + body))` is ≤ 1, after removing digits that come from the quote or the names. Build the fixtures with digit-free names and quotes, so the assertion is on the raw strings;
    - every locale's file has the same keys as `en`;
    - placeholders per key match `en`;
    - no value is empty.
  - **Logs:** `structlog.testing.capture_logs` across all the tests. No event contains a name, a nickname, a quote, a path or a raw card key. Assert that no value contains `/`, `%`, `「` or any member name used in the fixture.
  - **`clip_text`:** existing `preview_text` tests stay green; `clip_text("a  b\nc", 3)` == `"a b…"`.
  - **Hub:** `test_memories_hub.py` stays green after the rename and the `_assemble` refactor (payload snapshot unchanged).
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_notify_content.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement. CPU work stays in workers: the hub pick and card evaluation already are; the file-exists checks and `lapsed_groups` run through `asyncio.to_thread`.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_memories_notify_content.py backend/tests/test_memories_hub.py backend/tests/test_notification_planner.py backend/tests/test_backend_i18n.py -q` and `uv run mypy backend/services/memories backend/services/notification_planner.py backend/services/nickname.py`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): build the text of Memories notifications`.

### Task 4: Delivery — Memories toast, click bridge and the "in Memories" flag

**Files:**
- Modify:
  - `backend/services/notification_service.py`: `Notifier.show_memory`, `NullNotifier.show_memory`, `WindowsToastNotifier.show_memory` / `_on_memory_click` / `_on_memory_failed`, and `send_memory`.
  - `backend/services/desktop_bridge.py`: `set_open_memories_handler`, `open_memories`.
  - `desktop.py`: `make_open_memories_handler`, registered next to `make_open_login_handler`.
  - `backend/services/ui_state.py`: the Memories view flag.
  - `backend/api/ui_state.py`: `POST /api/ui-state/memories`.
  - `backend/tests/test_notification_service.py`: `FakeNotifier.show_memory`, plus new tests.
  - `backend/tests/test_desktop_bridge.py`.
  - `tests/test_desktop_open_chat.py`: the handler tests.
- Create: `backend/tests/test_memories_notify_delivery.py` (the UI-state API and the flag)

**Interfaces:**

`notification_service.py`:
- `WindowsToastNotifier.show_memory(plan: MemoryToastPlan) -> bool`. It raises on failure, like `show_login`.
  - `wt.Toast(text_fields=[plan.title, plan.body])`.
  - `toast.tag = f"mem-{plan.kind}-{plan.subject or 'all'}"[:64]` and `toast.group = "memories"`, so a newer toast of the same kind and subject replaces the older one in the Action Center.
  - Avatar as `ToastImagePosition.AppLogo`, hero as `ToastImagePosition.Hero`. Each image is added in its own try block that logs `notify_failed stage=avatar|hero kind=memories` and never costs the toast, the same as `_add_avatar`.
  - `on_activated` → `_on_memory_click(plan)`. It logs `notify_clicked kind=memories memory_kind=<kind> service=<service>` and calls `desktop_bridge.open_memories(plan.service, dict(plan.route))`. It never raises.
  - No `launch_action` (see the module docstring).
- `async def send_memory(plan: MemoryToastPlan) -> bool`. The pattern is `send_login_alert`: resolve the notifier in a thread; when it is unavailable, log `notify_skip reason=unavailable kind=memories memory_kind=…` and return False; otherwise `_run_guarded(lambda: notifier.show_memory(plan), {"kind": "memories", "memory_kind": plan.kind, "service": plan.service}, skip_extra={}, sent_extra={})`. Title and body are never logged. The caller applies the settings.

`desktop_bridge.py`:
- `set_open_memories_handler(handler: Callable[[str, dict], None] | None)`.
- `open_memories(service: str, route: dict) -> None`. It never raises. It logs `memories_open_unhandled reason=no_handler` once (re-armed by `set_…`, like `open_login`) and `memories_open_failed error_type=…`.

`desktop.py`:
- `make_open_memories_handler(window, focus_fn)` is modelled on `make_open_login_handler`.
  - `window.show()`, `focus_fn(_native_hwnd(window))`.
  - Then `window.evaluate_js("window.__sakadeskOpenMemories ? window.__sakadeskOpenMemories(" + json.dumps({"service": service, "route": route}, ensure_ascii=False) + ") === true : false")`.
  - It logs `notify_open_memories` (`service`, `target` = the snake_case page code from `{"onThisDay": "on_this_day", "memoir": "memoir", "recap": "recap"}`, else `unknown`, and `delivered=True`), or `notify_open_memories_failed` (`reason=not_ready` or `error_type`). It never raises and never logs the route.
- Register it with `desktop_bridge.set_open_memories_handler(make_open_memories_handler(window, _focus_window))` right after the login handler.

`ui_state.py`:
- `@dataclass(frozen=True) class MemoriesView: open: bool; focused: bool`. Default `MemoriesView(False, False)`, under the same `_lock`.
- `set_memories_view(view)`, `get_memories_view()`.
- `memories_in_view() -> bool` (`open and focused`).
- Docstring: nothing is persisted, and the flag is kept apart from the chat `UiState`, so neither report overwrites the other.

`api/ui_state.py`:
- `class MemoriesStateRequest(BaseModel): open: StrictBool; focused: StrictBool`.
- `@router.post("/memories", status_code=204)` stores the view and logs `ui_state_memories` at debug with `open` and `focused`.

- [ ] **Step 1:** Write failing tests.
  - **`send_memory`** with `FakeNotifier`:
    - the plan is shown on the toast worker;
    - the log is `notify_sent kind=memories memory_kind=on_this_day` with no title or body;
    - an unavailable notifier gives `notify_skip reason=unavailable`;
    - a stuck worker gives `reason=busy`, the existing guard.
  - **`WindowsToastNotifier.show_memory`**, with a fake `windows_toasts` module injected into `sys.modules` (the pattern the file already uses for `show_login`; reuse its fixture):
    - text fields, tag ≤ 64 characters, group `memories`;
    - AppLogo and Hero images added;
    - an avatar that raises still shows the toast and logs `stage=avatar`;
    - the click calls `desktop_bridge.open_memories` with the service and route;
    - a click whose handler raises never raises.
  - **`desktop_bridge.open_memories`:** with no handler it logs `memories_open_unhandled` exactly once across two calls, and once more after `set_open_memories_handler(None)`; a raising handler is logged with `error_type` only.
  - **`make_open_memories_handler`** (in `tests/test_desktop_open_chat.py`):
    - the script is exactly the expected string for a `onThisDay` route;
    - a member path with quotes and `</script>` is JSON-escaped (no injection, like `test_open_login` with `'x");alert(1);("'`);
    - `delivered` is logged when JS returns `True`, and `reason=not_ready` when it returns `False`;
    - the route and member path never appear in the logs.
  - **UI state:**
    - `POST /api/ui-state/memories {"open": true, "focused": true}` → 204 and `memories_in_view()` is True;
    - a chat `POST /api/ui-state` afterwards leaves the Memories flag untouched, and the reverse also holds;
    - `{"open": "yes"}` → 422.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_notification_service.py backend/tests/test_desktop_bridge.py backend/tests/test_memories_notify_delivery.py tests/test_desktop_open_chat.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same tests and `uv run mypy backend/services/notification_service.py backend/services/desktop_bridge.py backend/services/ui_state.py`. Expect PASS.
- [ ] **Step 5:** Commit `feat(notify): deliver Memories toasts and open Memories on click`.

### Task 5: The scheduler (`notify_scheduler.py`), lifespan wiring and the sync hook

**Files:**
- Modify:
  - `backend/services/memories/notify_scheduler.py`, created as a stub in Task 1.
  - `backend/main.py`: start the scheduler after the auto-sync scheduler; stop it right after `auto_sync_scheduler.stop()` and before `quiesce_writers()`.
  - `backend/services/sync_service.py`: `_schedule_memories_refresh` calls `request_card_check(self._service)`.
  - `backend/tests/test_sync_notify.py` (or the sync test that covers `_schedule_memories_refresh`): assert the call.
- Create: `backend/tests/test_memories_notify_scheduler.py`

**Interfaces:**

```python
STARTUP_DELAY_S = 60.0
MAX_SLEEP_S = 900.0          # re-evaluate at least every 15 min (sleep/resume, clock changes)
CARD_CHECK_DELAY_S = 120.0   # after a sync, let the memory index build first
STOP_TIMEOUT_S = 5.0
PRUNE_AFTER = timedelta(days=400)

class MemoriesNotifyScheduler:
    def __init__(self, services: Iterable[str], *,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                 sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
                 load_settings: Callable[[], Awaitable[Mapping[str, Any]]] = settings_store.load_config,
                 send: Callable[[MemoryToastPlan], Awaitable[bool]] = notification_service.send_memory,
                 in_memories: Callable[[], bool] = ui_state.memories_in_view) -> None
    def start(self) -> None            # one task, name "memories_notify"; idempotent; sets the module's _active
    async def stop(self) -> None       # sets _stopping, wakes, waits STOP_TIMEOUT_S for the loop to exit at a
                                       # check point, then cancels and gathers; idempotent; clears _active
    def wake(self) -> None             # end the current wait early (settings changed)
    def request_card_check(self, service: str) -> None  # mark pending; the check runs CARD_CHECK_DELAY_S later
    async def tick(self) -> TickResult # one evaluation (public for tests)

def memories_notify_settings_changed() -> bool   # wakes _active; logs memories_notify_wake_requested woken
def request_card_check(service: str) -> None      # forwards to _active; a no-op (debug log) without one; never raises
```

**`tick()` order** (each step logs its skips; the loop wraps `tick` like `AutoSyncScheduler._run`: `CancelledError` re-raised, any other exception logged as `memories_notify_failed stage=tick` and the loop continues):
1. `now = clock()`, `settings = await load_settings()`, `slot = parse_slot(settings["memories_notify_time"])`, `today = jst_today(now)`.
2. If `is_shutting_down()` or `_stopping`: return (`reason=shutting_down`).
3. Build the candidate occasions:
   - `on_this_day_occasion`;
   - for each service with a data dir: `mi.list_members` → per summary `birthday_occasions` and `anniversary_occasions` (with `binder.subscription_start(summary)`), then `recap_occasions`.
   - Keep only `is_open(window, now)`. Card checks come from the pending set, not from occasions.
4. If `not settings["notifications_enabled"]`: log `memories_notify_skip reason=notifications_off count=<open occasions>` and return. Nothing is recorded (decision 9).
5. Drop the kinds whose toggle (`SETTING_FOR_KIND`) is off (`reason=kind_off`, `count`). Nothing is recorded.
6. Drop the occasions already in the ledger (`aget memory_notifications_done`, `reason=already_done`, `count`, debug level).
7. Build the plans with `notify_content` (On This Day, birthdays, anniversaries, recap). When a builder returns nothing for an occasion, claim it with outcome `empty` (On This Day; `reason=empty`) or `no_recap` (recap). Other kinds simply skip.
8. Card checks run only when `memories_notify_cards` is on: for each service whose pending mark is older than `CARD_CHECK_DELAY_S`, and for every service on the first tick after start, call `card_plans`. Then clear the mark and log `memories_card_check`.
9. Deliver in this order: recap, birthday, anniversary, birthday_soon, on_this_day, card. For each plan:
   - check `is_shutting_down()` / `_stopping` again (stop between units, never mid-write);
   - claim every covered occasion (`aclaim_memory_notification`). Only the first claim's result decides: when it is False, another path already took it (`already_done`);
   - if `in_memories()`: finish the claimed occasions as `suppressed` (`reason=in_memories`), no toast;
   - else `ok = await send(plan)`; finish as `sent` or `failed`. Failed ones are never retried (decision 10).
10. Log `memories_notify_tick` (`due`, `sent`, `suppressed`, `next_in_s`).

**The loop:**
- `await sleep(STARTUP_DELAY_S)` (or a wake);
- `aprune_memory_notifications(now - PRUNE_AFTER)` once;
- then repeat: `tick`, then wait `next_wake(now, slot, MAX_SLEEP_S)` or for the wake event, or until a pending card check is due (the earliest pending mark plus `CARD_CHECK_DELAY_S`).
- The wait uses the same sleeper / waker pattern as `AutoSyncScheduler._wait`.

**Lifespan (`main.py`):**
- Right after the auto-sync block: `memories_notifier = MemoriesNotifyScheduler(get_all_services()) if scheduler_allowed_in_env() else None`. Call `.start()` when it is set, else log `memories_notify_skipped reason=env`.
- In shutdown, right after `auto_sync_scheduler.stop()`: `if memories_notifier is not None: await memories_notifier.stop()`.
- A comment states why it comes before the write barrier: it writes `app_state.db` under the data lock.

**Sync hook:** in `_schedule_memories_refresh`, after the two tracked tasks, call `request_card_check(self._service)` inside the existing try block.

- [ ] **Step 1:** Write failing tests. Drive `tick()` directly with an injected `clock` (from `time_machine` with `tick=False`), a recording `send`, a fake `load_settings` and a synthetic archive in a tmp output dir, monkeypatching `path_resolver` as `test_memories_hub.py` does. For the loop tests, use a fake `sleep` that records durations and advances `time_machine` (`traveller.shift`).
  - **12:00 JST fire:**
    - at 11:59:59 JST nothing is sent;
    - at 12:00:00 one On This Day is sent;
    - at 12:15 nothing more is sent (ledger);
    - `next_in_s` at 11:59:00 is 60.
  - **Midnight JST:**
    - a birthday is sent at 00:00:00 JST of her day, and a tick at 23:59:59 the day before sends nothing;
    - the 1-day reminder sent at 12:00 the day before is a different occasion and goes out too.
  - **Local zone:** the same 12:00 JST fire with the machine travelled in `ZoneInfo("America/New_York")` across the DST end: the send happens at 03:00 UTC.
  - **Leap day:** a 02-29 birthday travelled to 2027-02-28 00:00 JST is sent; on 2027-03-01 nothing is sent.
  - **Restart within the same day:**
    - tick at 12:00 (sent);
    - build a **new** scheduler instance on the same DB and tick at 15:00: nothing is sent and the log has `already_done`.
  - **Missed day:**
    - first tick at 2026-11-11 09:00 JST: the 11-10 On This Day is not sent;
    - first tick at 2026-11-10 18:00: it is sent once (same-day catch-up).
  - **Recap:**
    - first tick on 2027-01-09 sends `ready` for 2026 once; a tick on 2027-02-01 sends nothing;
    - Dec 1 at 12:00 sends `open` only when the year has a recap.
  - **Duplicate prevention:**
    - two concurrent `tick()` calls (`asyncio.gather`) at 12:00 send exactly one toast;
    - a `send` that returns False is recorded `failed` and not retried at 12:15;
    - a `send` that raises `CancelledError` mid-show leaves `pending`, and the next tick does not resend.
  - **Settings:**
    - `notifications_enabled=false` at 12:00 sends nothing and records nothing; flipping it on at 13:00 sends the On This Day;
    - `memories_notify_on_this_day=false` behaves the same way;
    - `memories_notify_time="18:00"` moves the fire;
    - `memories_notify_cards=false` (the default) never evaluates cards.
  - **In Memories:** `in_memories=lambda: True` at 12:00 → no send, outcome `suppressed`, and nothing at 12:15 after it turns False.
  - **Cards:**
    - `request_card_check("hinatazaka46")`, then a tick before `CARD_CHECK_DELAY_S` does nothing, and a tick after it evaluates;
    - the first check seeds, and a new midnight message then sends one card toast.
  - **Shutdown:**
    - `stop()` while `send` is awaiting a slow fake returns within `STOP_TIMEOUT_S + 1` s, and no claim is written after `begin_shutdown()`;
    - `stop()` twice is a no-op;
    - `shutdown_state.reset_for_tests()` in the teardown.
  - **Lifespan:** under pytest (`SAKADESK_DISABLE_AUTO_SYNC` set) `TestClient(app)` logs `memories_notify_skipped reason=env` and starts no task.
  - **Logs:** `capture_logs` over the whole module. Every event's values are ints, bools or `^[a-z0-9_:.\-]{0,64}$` codes (ISO dates allowed); no fixture name, nickname, quote or path appears.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_notify_scheduler.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `uv run pytest backend/tests/test_memories_notify_scheduler.py backend/tests/test_memories_notify_store.py backend/tests/test_sync_notify.py backend/tests/test_lifespan*.py -q` (use whichever lifespan tests exist; find them with `timeout 60 grep -rln "quiesce_writers" backend/tests tests`) and `uv run mypy backend/services/memories backend/main.py`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): schedule Memories notifications in the background`.

### Task 6: Frontend — deep link into Memories, card focus and the Memories UI reporter

**Files:**
- Create:
  - `frontend/src/shell/openMemories.ts`, `frontend/src/shell/openMemories.test.ts`
  - `frontend/src/shell/App.openMemories.test.tsx`
  - `frontend/src/features/memories/useMemoriesUiReporter.ts`, `frontend/src/features/memories/useMemoriesUiReporter.test.ts`
  - `frontend/src/features/memories/MemoriesFeature.deepLink.test.tsx`
- Modify:
  - `frontend/src/store/appStore.ts`: the deep-link slot.
  - `frontend/src/shell/App.tsx`: install `window.__sakadeskOpenMemories`.
  - `frontend/src/features/memories/MemoriesFeature.tsx`: consume the deep link, run the reporter, add `cardKey` to the memoir route.
  - `frontend/src/features/memories/memoir/MemoirPage.tsx` (`BinderPane` opens `cardKey`) and `MemoirPage.test.tsx`.
  - `frontend/src/features/memories/memoriesLog.ts`: `MEMORIES_SKIP_REASONS` gains `card_missing`.
  - `frontend/src/utils/clientLog.ts` and `backend/api/client_log.py`: the event `notify_open_memories`.
  - `backend/tests/fixtures/memories_log_codes.json`, `frontend/src/features/memories/memoriesLog.test.ts`, `backend/tests/test_client_log_api.py`.

**Interfaces:**

`appStore.ts`:
- `memoriesDeepLink: { service: string; route: MemoriesRoute; nonce: number } | null`.
- `openMemoriesAt(service, route)`: increments the nonce, stores the link, `setActiveFeature(service, 'memories')`, then `setActiveService(service)` when the service differs.
- `clearMemoriesDeepLink(nonce)`: clears only when the nonce matches.
- Not persisted. Import the `MemoriesRoute` type from `features/memories/MemoriesFeature` as a type-only import.

`openMemories.ts`:
- Declares `window.__sakadeskOpenMemories?: (payload: unknown) => boolean` in the `declare global` style of `openChat.ts`.
- `parseMemoriesLink(payload: unknown): { service: string; route: MemoriesRoute } | null` is a strict whitelist:
  - `onThisDay` with `monthDay` matching `^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$` and an optional integer `year` between 2000 and 2100;
  - `memoir` with a non-empty `memberPath` string, `tab` `'binder'` and an optional `cardKey` matching `^[a-z0-9_.]{1,40}$`;
  - `recap` with an integer `year`;
  - anything else → `null`.
- `openMemoriesFromToast(payload): boolean`:
  - malformed → `clientLog('notify_open_memories', { delivered: false, reason: 'malformed' })`, return false;
  - a service not in `useAppStore.getState().selectedServices` → `reason: 'unknown_service'`;
  - onboarding → `reason: 'onboarding'`, using the same `openLoginStateRef` check as `__sakadeskOpenLogin`; pass a `isOnboarding()` callback in from App;
  - else `openMemoriesAt`, log `{ delivered: true, service, target: <page code> }` and return true.
  - Page codes come from `MEMORIES_PAGE_CODES`.

`App.tsx`:
- `window.__sakadeskOpenMemories = (p) => openMemoriesFromToast(p, () => openLoginStateRef.current.onboarding)`, in the same effect style as `__sakadeskOpenLogin`, deleted on unmount.

`MemoriesFeature.tsx`:
- Read `const deepLink = useAppStore((s) => s.memoriesDeepLink)`.
- The `useState` initializer prefers `deepLink.route` when `deepLink?.service === service`, else `initialRoute ?? HOME`.
- An effect on `[deepLink?.nonce, service]`: when `deepLink` matches the service, `setState({ service, route: deepLink.route })`, `logMemoriesPage(deepLink.route.page)` and `clearMemoriesDeepLink(deepLink.nonce)`.
  - This also covers a click while Memories is already open on another page, and a click that switched service (the render-time re-tag sets home, then the effect applies the link).
- The memoir route gains `cardKey?: string`.
- `useMemoriesUiReporter()` is called once at the top.

`MemoirPage.tsx`:
- `BinderPane` receives `cardKey?: string`.
- When the binder is ready and `cardKey` is set, it opens the `CardDetail` of the card whose `key === cardKey` and `date` is set, once per `(memberPath, cardKey)` (a ref guard).
- When no such card exists, it calls `logMemoriesSkip('binder', 'card_missing')` and shows the binder.
- `pickMember` / `pickTab` drop `cardKey`.

`useMemoriesUiReporter.ts`:
- The same mechanics as `useUiStateReporter`: a 300 ms debounce, then `focus` / `blur` / `visibilitychange`.
- `POST /api/ui-state/memories {open: true, focused}` while mounted, and an immediate `{open: false, focused}` on unmount.
- Failures are only `console.debug`.

`client_log.py`:
- Add `"notify_open_memories"` to `ClientEvent`. The existing `ALLOWED_FIELDS` already include `delivered`, `reason`, `service` and `target`.
- Fixture keys: `"notify_open_memories.target": ["on_this_day", "memoir", "recap"]`, `"notify_open_memories.reason": ["malformed", "unknown_service", "onboarding"]`, and `"memories_skip.reason"` gains `"card_missing"`.
- `memoriesLog.ts` exports `NOTIFY_OPEN_MEMORIES_REASONS` as an `as const` array, so `memoriesLog.test.ts` can build the fixture values from TS constants.

- [ ] **Step 1:** Write failing tests.
  - **`openMemories.test.ts`:**
    - every valid route shape parses;
    - each of these is rejected: `monthDay: '13-01'`, `year: '2026'`, `cardKey: 'a/b'`, an unknown page, extra `page: 'album'`, a missing `memberPath`, `null`, a string;
    - logs for each outcome, `service` code only, and never `memberPath`.
  - **`App.openMemories.test.tsx`:**
    - installed on mount, removed on unmount;
    - an unknown service → false;
    - onboarding → false;
    - a valid link switches `activeService`, sets the feature to `memories` and stores the link.
  - **`MemoriesFeature.deepLink.test.tsx`:**
    - mount with a stored link → opens that page and clears the link;
    - already on `album`, a new link to `recap` 2026 → the recap page, logged as a page change;
    - a link for another service is ignored until the service prop changes, then applied;
    - a cleared link never re-applies after remount.
  - **`MemoirPage.test.tsx`:**
    - `cardKey: 'anniv.y1'` opens that card's detail after load, once;
    - an unknown `cardKey` logs `memories_skip` `{target: 'binder', reason: 'card_missing'}` (via the existing `vi.mock('../../utils/clientLog')` pattern) and shows the binder.
  - **`useMemoriesUiReporter.test.ts`:** fake timers, `fetch` spy; a debounced `open: true` with focus; blur → `focused: false`; unmount → immediate `open: false`.
  - **`memoriesLog.test.ts`** / **`test_client_log_api.py`:** the fixture matches the TS constants, and every value posts with 204 (the existing tests pick up the new keys).
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/shell/openMemories.test.ts src/shell/App.openMemories.test.tsx src/features/memories` and `uv run pytest backend/tests/test_client_log_api.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same commands and `cd frontend && npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): open Memories from a notification click`.

### Task 7: Settings — the 回憶 notification category (five locales)

**Files:**
- Modify:
  - `frontend/src/shell/components/SettingsModal.tsx`: a 回憶 block in the General tab, under "hide content".
  - `frontend/src/features/messages/MessagesFeature.tsx`: the `AppSettings` fields.
  - `frontend/src/features/memories/shared/jst.ts`: `jstSlotToLocal`.
  - `frontend/src/i18n/locales/{en,ja,zh-TW,zh-CN,yue}.json`: `settings.memoriesNotify.*`.
- Create: `frontend/src/shell/components/SettingsModal.memoriesNotify.test.tsx`, `frontend/src/i18n/memoriesNotify.test.ts`, `frontend/src/features/memories/shared/jst.slot.test.ts`

**Interfaces:**
- `AppSettings` gains `memories_notify_on_this_day?`, `memories_notify_birthday?`, `memories_notify_anniversary?`, `memories_notify_recap?`, `memories_notify_cards?` (booleans) and `memories_notify_time?: string`.
- `SettingsModal`:
  - A heading row (`FIELD_LABEL` style, `t('settings.memoriesNotify.title')`) with `t('settings.memoriesNotify.desc')` under it.
  - Then five `SettingRow`s with a `Switch` each: `onThisDay` (with the time `Select` directly under it), `birthday`, `anniversary`, `recap`, `cards`.
  - Defaults when a field is missing: true, true, true, true, false and `'12:00'`.
  - Every control is `disabled` / `aria-disabled` while `notificationsEnabled` is false, like "hide content". The time `Select` is also disabled while the On This Day switch is off.
  - The time `Select` offers `00:00`–`23:00` hourly; when the saved value is not on the hour, it is added as an extra option. The options read `HH:MM`.
  - The row description is `t('settings.memoriesNotify.timeHint', { local })`, where `local = jstSlotToLocal(value)`. The hint is left out when the machine is in Asia/Tokyo.
  - `SaveRow` gains `'memoriesNotify'`; every row saves through `save('memoriesNotify', { … })`.
  - `handleResetDefaults` resets the six keys to their defaults.
- `jstSlotToLocal(hhmm: string, opts?: { now?: Date; timeZone?: string }): string | null`: the local `HH:MM` (24 h) of today's JST slot in `timeZone` (default: the resolved local zone). Returns `null` when the zone is `Asia/Tokyo` or the value is malformed. It uses `Intl.DateTimeFormat`, so DST is handled per date.

**Frontend copy — `settings.memoriesNotify`:**

| key | ja (reference) | en | zh-TW | zh-CN | yue |
|---|---|---|---|---|---|
| `title` | `思い出の通知` | `Memories notifications` | `回憶通知` | `回忆通知` | `回憶通知` |
| `desc` | `思い出を開いている間は通知しません` | `Not shown while you are in Memories` | `正在看回憶時不會通知` | `正在看回忆时不会通知` | `睇緊回憶嗰陣唔會通知` |
| `onThisDay` | `毎日の「あの日」` | `On This Day, daily` | `每日的「那一天」` | `每日的“那一天”` | `每日嘅「嗰一日」` |
| `onThisDayDesc` | `過去の同じ日にメッセージがある日だけ、1日1回` | `Once a day, only when past years have messages on that date` | `只在往年同一天有訊息時，每天一次` | `只在往年同一天有消息时，每天一次` | `淨係往年同一日有訊息先通知，每日一次` |
| `time` | `通知の時刻` | `Time` | `通知時間` | `通知时间` | `通知時間` |
| `timeHint` | `日本時間。お住まいの地域では {{local}}` | `Japan time ({{local}} where you are)` | `日本時間（你所在地區為 {{local}}）` | `日本时间（你所在地区为 {{local}}）` | `日本時間（你嗰邊係 {{local}}）` |
| `birthday` | `誕生日` | `Birthdays` | `生日` | `生日` | `生日` |
| `birthdayDesc` | `当日の0時と、7日前・前日のお知らせ` | `At midnight on the day, plus 7 days and 1 day before` | `當天0點，以及7天前和前一天提醒` | `当天0点，以及7天前和前一天提醒` | `當日0點，同埋7日前同前一日提醒` |
| `anniversary` | `メンバーシップ記念日` | `Membership anniversaries` | `會員紀念日` | `会员纪念日` | `會員紀念日` |
| `anniversaryDesc` | `1年ごとの記念日と、100日・500日・1000日` | `Each year, plus day 100, 500 and 1000` | `每週年，以及第100、500、1000天` | `每周年，以及第100、500、1000天` | `每週年，同埋第100、500、1000日` |
| `recap` | `1年のふりかえり` | `Year recap` | `年度回顧` | `年度回顾` | `年度回顧` |
| `recapDesc` | `12月1日の公開、クリスマス、1月の完成` | `When it opens on Dec 1, at Christmas, and when it is complete in January` | `12月1日開放、聖誕節，以及1月完整時` | `12月1日开放、圣诞节，以及1月完整时` | `12月1日開放、聖誕節，同埋1月齊晒嗰陣` |
| `cards` | `きらめくカード` | `Foil cards` | `閃亮卡片` | `闪亮卡片` | `閃卡` |
| `cardsDesc` | `生写真帳に特別なカードが加わったとき` | `When a special card joins a binder` | `相冊多了特別的卡時` | `相册多了特别的卡时` | `相冊多咗張特別卡嗰陣` |

(Settings descriptions may hold several numbers: they describe the rule, not a moment. The one-number rule applies to the notifications.)

- [ ] **Step 1:** Write failing tests.
  - **`memoriesNotify.test.ts`:** the exact strings above in all five locales (the `traySettings.test.ts` pattern), and `{{local}}` present in every `timeHint`.
  - **`SettingsModal.memoriesNotify.test.tsx`:**
    - defaults render: four switches on, cards off, `12:00` selected;
    - toggling each switch calls `onSaveSettings` with exactly its key;
    - picking `07:00` saves `memories_notify_time: '07:00'`;
    - every control is disabled when `notifications_enabled` is false;
    - the time is disabled when On This Day is off;
    - a saved `'07:30'` appears as an option;
    - reset defaults includes the six keys;
    - a failed save shows the row error (`settings.saveFailed`).
  - **`jst.slot.test.ts`:**
    - `jstSlotToLocal('12:00', { now: new Date('2026-07-01T00:00:00Z'), timeZone: 'America/New_York' })` → `'23:00'` (the day before, shown as the time only);
    - in `'Europe/London'` on 2026-01-15 → `'03:00'` and on 2026-07-15 → `'04:00'`;
    - `'Asia/Tokyo'` → `null`;
    - `'25:00'` → `null`.
  - **Design guard:** `src/design/guard.test.ts` passes (no new literals).
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/i18n/memoriesNotify.test.ts src/shell/components src/features/memories/shared`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same tests, `npx vitest run src/design/guard.test.ts` and `npx tsc --noEmit`. Expect PASS.
- [ ] **Step 5:** Commit `feat(settings): add the Memories notification category`.

### Task 8: Whole-wave verification

**Files:**
- Modify: `CHANGELOG.md` `[Unreleased]` → `Added`. Add one entry beside the existing Memories entries, following `docs/DOC_FORMATS.md` (bold lead-in, at most 3 sentences, no code identifiers): "**Memories can now remind you.** You get a daily On This Day, birthdays, membership anniversaries, the year recap and, if you turn it on, new foil cards. Each kind has its own switch in Settings, and nothing is shown while you are in Memories."
- No new code. Fix whatever the checks below find, inside the task that owns the file.

- [ ] **Step 1: Full backend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
uv run pytest backend/tests tests -q
uv run mypy backend/services/memories backend/services/notification_service.py backend/services/desktop_bridge.py backend/services/ui_state.py backend/services/app_state.py backend/api/settings.py backend/api/ui_state.py backend/main.py
uv run ruff check backend desktop.py tests && uv run ruff format --check backend desktop.py tests
```

  The pre-existing headless keyring error in pysaka is not in this repo. Any SakaDesk failure must be fixed.
- [ ] **Step 2: Full frontend:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk/frontend
npx tsc --noEmit
npx vitest run
```

  The run includes `src/design/guard.test.ts`, `src/i18n/memoriesNotify.test.ts`, `src/i18n/memoriesCore.test.ts` and `memoriesLog.test.ts` (the shared fixture).
- [ ] **Step 3: Log hygiene:**

```bash
cd /home/xtorker/repos/Project-Saka/SakaDesk
timeout 60 grep -rnE "logger\.(info|warning|debug|error)\([^)]*(title|body|text|name|names|nickname|quote|path|member_path|media_file|route)=" backend/services/memories/notify_*.py backend/services/notification_service.py backend/services/desktop_bridge.py desktop.py
timeout 60 grep -rnE "clientLog\('notify_open_memories'[^)]*(memberPath|cardKey|name)" frontend/src
```

  Expect no hits. Every field must be an id, a code, a count or a bool.
- [ ] **Step 4: Windows smoke** (the user authorised Windows-side testing; reuse the Windows login and never log in from WSL):
  - Build and launch the dev exe with `-WorkingDirectory`. Closing the installed SakaDesk first is allowed.
  - In Settings → General → 思い出の通知, set the time to the next full hour. Wait, or temporarily set the time two minutes ahead with a hand-edited `settings.json` while the app is closed.
  - Check that one On This Day toast appears with her words and photo, and that clicking it opens On This Day at that year.
  - Open Memories, set the time to the next slot again, and confirm that no toast appears and that `debug.log` has `memories_notify_skip reason=in_memories`.
  - Close to the tray and confirm that a toast still arrives and that its click restores the window on Memories.
  - Record the result in the ledger.
- [ ] **Step 5: Spec walk-through:** tick every row of spec §15 and the §9.3 Jan-1 line against the self-review table below, and record the ten decisions and any open user question in `.superpowers/sdd/progress.md`.
- [ ] **Step 6:** Commit `docs(changelog): note Memories notifications`.

---

## Self-review

**Spec coverage:**

| Spec | Where |
|---|---|
| §15 new 回憶 category, a toggle per kind | Task 1 (keys), Task 7 (UI, five locales) |
| §15 same delivery as message toasts, app running or in tray | Task 4 (`send_memory` through `_run_guarded`, `show_memory`); Task 5 (backend task runs while the window is hidden); Task 8 smoke |
| §15 never duplicated | Task 1 ledger + Task 5 claim-before-send; restart and concurrent tests |
| §15 suppressed while in Memories | Task 4 (`memories_in_view`, `/api/ui-state/memories`), Task 6 (reporter), Task 5 (`suppressed`) |
| §15 Daily On This Day at 12:00, configurable, skipped without past messages, one per day, oshi first, best photo, → On This Day | Task 2 (window, slot), Task 3 (`today_moment`, cross-service rank, hero), Task 5, Task 6 route, Task 7 time |
| §15 Birthday 00:00 plus 7 days / 1 day before, → member memoir | Task 2 (`birthday_occasions`, leap day), Task 3, Task 6 route |
| §15 Subscription anniversary / milestones 1年, 2年…, 100日, 500日, 1000日, → the binder card; skip ended subscriptions | Task 2 (`anniversary_occasions` via `cards.anniversary_date` / `subscription_day_date`), Task 3 (`hub.still_subscribed`, coalescing, `cardKey`), Task 6 (card focus) |
| §15 Year recap 12/1 opens, 12/25 Christmas stub, → year recap | Task 2 (`recap_occasions`), Task 3 (`recap_plan`, `recap_years` guard) |
| §9.3 first launch after Jan 1 00:00 JST: full recap ready | Task 2 (`ready` window Jan 1–31), Task 3, Task 5 tests |
| §15 Card unlock off by default, foil only, → the card | Task 1 default false, Task 2 (`notifiable_foil`, `new_foil_keys`), Task 3 (`card_plans`, baseline), Task 6 (`cardKey`) |
| §1.1 at most one number | Global Constraints; Task 3 one-number test over every plan |
| §1.5 truthful, `%%%` | Decisions; Task 3 copy table, `apply_nickname_or_mask`, quotes only |
| §1.7 logs ids/codes only, breadcrumbs on every skip; i18n five locales; CPU off loop | Shared contracts; capture_logs tests in Tasks 3–5; Task 8 grep; Tasks 3 and 7 locale tests |
| JST everywhere (ruling) | Task 2 (local-zone DST tests), Task 5 (local-zone fire test), Task 7 (JST label + local hint) |
| Shared client-log fixture (ruling) | Task 6 |

**Placeholders:** none. Every task names its files, interfaces, tests, commands and commit message. Two items are looked up by command because their file names were not pinned while this plan was written: the settings tests and the lifespan tests. Each has the exact `grep` that finds them.

**Name consistency:** the same names are used everywhere:
- modules `notify_rules`, `notify_content`, `notify_scheduler`;
- kinds `on_this_day`, `birthday`, `birthday_soon`, `anniversary`, `recap`, `card`;
- tables `memories_notify_log`, `memories_card_baseline`;
- settings `memories_notify_on_this_day|birthday|anniversary|recap|cards|time`;
- `MemoryToastPlan`, `send_memory`, `show_memory`, `open_memories`, `make_open_memories_handler`, `__sakadeskOpenMemories`, `openMemoriesFromToast`, `openMemoriesAt`, `memoriesDeepLink`, `useMemoriesUiReporter`, `memories_in_view`;
- the route field `cardKey`;
- events `memories_notify_tick|skip|failed`, `memories_card_check`, `notify_open_memories`.

**Needs the user's decision** (the plan's defaults are applied until the user answers):
1. Whether the graduated member's last-message foil card (`grad.last`) should notify. Default: no.
2. The fire time of the anniversary, reminder and recap notifications. Default: the same configurable daily time as On This Day; only the birthday day-of is fixed at 00:00, per the spec.
