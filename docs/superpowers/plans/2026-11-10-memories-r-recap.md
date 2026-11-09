# Memories R — Year Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the year recap 「同じ坂道を歩いた一年」. It is made of 13 story slides (A), a poster (B), a share export (GIF, an optional MP4, and a share PNG), a multi-member opening and year-end unlocks. It also adds the Memories feature entry and shell that the later waves build on.

**Architecture:**
- **Backend:** `backend/services/memories/recap.py` turns the M1 memory index plus the raw messages into a JSON payload per (service, member, year). The payload is cached in the memory-index SQLite and served by `backend/api/memories.py`. A small Pillow GIF assembler takes PNG frames from the frontend.
- **Frontend:** a new `memories` feature (`frontend/src/features/memories/`) with a router (home / recap / later pages). A `RecapPlayer` renders slides from the payload on a 9:16 stage inside the content pane. `PosterView` renders the poster. A canvas `ShareRenderer` draws the share frames.

**Tech Stack:** FastAPI, Pillow (already a dependency), SQLite; React 18 + TS, framer-motion if present (check `package.json`; otherwise use CSS transitions), Canvas 2D, MediaRecorder; vitest; pytest + time-machine.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-11-10-memories-design.md` §9 (year recap), §1 (principles) and §3.3 (selection). The spec is the source of truth for slide content, fallbacks, copy intent and share rules.
- **Content limits:** at most one number per slide. Never show "0" or describe an absence; thin data switches to the fallback or skips the slide. Never imply that she replied to the fan or knew the fan's dates.
- **Per group:** the recap is scoped to the active service. The multi-member opening covers that service's members only.
- **Design system:** use `frontend/src/design/` tokens and primitives only. No hex/rgb literals in TS/CSS; the canvas reads CSS variables. Group colour is for identity only. 推 pink, the favourite star, danger and warning are semantic. Use serif display (`Noto Serif JP`) for headings. The app's own narration uses the sans UI font at a smaller size, so it is never mistaken for her words. Read `docs/design/DESIGN_SYSTEM.md` before writing any UI task.
- **i18n:** all user-facing strings are keys in the five locales (en, ja, zh-TW, zh-CN, yue). Japanese is the reference copy. `frontend/src/i18n/locales/*.json` and backend `backend/i18n/<lang>/*.json` are the only places strings live.
- **Logs:** ids, codes, counts and scores only. Every selection or fallback writes a breadcrumb: `recap.select` with `slide`, `rule`, `score`, `fallback`, `message_id`.
- **Engineering:** use `uv run` and never pip; commit with `uv run git commit` (Conventional Commits ≤ 72 chars plus a Co-Authored-By trailer); file I/O is `utf-8`; CPU work runs in `asyncio.to_thread`; no `print()`; use `time-machine` for date-dependent tests.
- **Branch:** `feat/memories` in SakaDesk.

## Shared payload contract (all tasks)

`GET /api/memories/{service}/recap/{year}/members` returns:

```json
{"year": 2026, "phase": "partial|final", "christmas_open": false,
 "members": [{"member_path": "日向坂46/messages/34 金村 美玖/58 金村 美玖", "member_id": "58",
   "name": "金村 美玖", "tier": "full|standard|short|none", "oshi": true,
   "title_key": "recap.titles.morning|nickname|longest|voice|night|photos|steady|first"}],
 "opening": {"star_order": ["58", "..."], "first_message": {"member_id": "58", "ts": "..."} | null,
   "oyasumi_total": 812}}
```

`GET /api/memories/{service}/recap/{year}?member=<member_path>` returns:

```json
{"year": 2026, "phase": "partial|final", "tier": "full", "member": {"id": "58", "name": "...",
  "avatar_url": "...", "graduated": false, "subscription_start": "2024-07-24" | null,
  "years_together": 3},
 "slides": [ {"key": "s01_first", "fallback": null, "data": {...}}, ... ],
 "poster": {...}}
```

Slide keys, in order: `s01_first`, `s02_name`, `s03_clock`, `s04_greetings`, `s05_photos`, `s06_voice`, `s07_letter`, `s08_echo`, `s09_special`, `s10_you`, `s11_daisuki`, `s12_sentence`, `s13_oyasumi`. A slide whose data is too thin is omitted from `slides` (the tier rules are in the spec §9.1). A message object in any slide is `{"id", "ts", "type", "text" (raw, %%% kept), "media_url"|null, "caption"|null, "avatar_url"|null}`. The frontend replaces `%%%` with the nickname in the private view (reuse `applyNickname` from `frontend/src/features/messages/utils/nickname.ts`).

---

### Task R1: Memories feature entry and shell

**Files:**
- Modify: `frontend/src/store/appStore.ts` (`FeatureId` adds `'memories'`), `frontend/src/config/features.ts` (definition: icon `Sparkles` or `Archive` from lucide-react, `labelKey: 'features.memories'`, `accessLevel: 'free'`; add it to every service in `SERVICE_FEATURES`), `frontend/src/core/layout/ContentArea.tsx` (render `<ContentSheet><MemoriesFeature service={service} /></ContentSheet>`)
- Create: `frontend/src/features/memories/index.ts`, `MemoriesFeature.tsx` (internal router state: `{ page: 'home' } | { page: 'recap', year, memberPath? }`, plus later pages added by other waves), `MemoriesHome.tsx` (a temporary hub with one entry card, "年度回顧"; the core wave replaces it), `memoriesLog.ts` (clientLog breadcrumbs `memories_open`, `memories_page`)
- Locales: `features.memories` ("回憶" / "思い出" / "Memories" / "回忆" / "回憶"), `memories.home.recapCard`
- Test: `frontend/src/features/memories/MemoriesFeature.test.tsx`, plus the existing `FeatureRail.test.tsx` and `ContentArea.test.tsx` updated for the new feature

- [ ] **Step 1:** Write failing tests:
  - the feature rail shows a "Memories" item for every service;
  - choosing it renders `MemoriesHome`;
  - clicking the recap card switches the router to the recap page (render a placeholder `RecapEntry`, implemented in R3);
  - the router state resets to home when the service changes.
- [ ] **Step 2:** Run `cd frontend && npx vitest run src/features/memories src/core/layout`. Expect FAIL.
- [ ] **Step 3:** Implement. Follow `BlogsFeature`'s structure and the design system (an EmptyState-like card on the brand surface). Add the clientLog union entries and the backend allowlist entries (`backend/api/client_log.py`).
- [ ] **Step 4:** Run the same tests plus `npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): add the Memories feature and its shell`.

### Task R2: Recap selection backend (payload builder)

**Files:**
- Create: `backend/services/memories/recap.py`, `backend/tests/test_memories_recap.py`
- Uses: `memories.index.get_member_index`, `memories.selection.*`, `memories.oshi.oshi_names`, the `app_state.favorited_at` chunked query, and `letters.json` (via the existing reader in `backend/api/chat_features.py` `letters_local`, refactored into a reusable function if needed)

**Interfaces:**
- `async build_member_recap(service: str, service_data_dir: Path, member_dir: Path, year: int, *, now: datetime) -> dict` returns the per-member payload above.
- `async build_members_overview(service: str, service_data_dir: Path, year: int, *, now: datetime) -> dict` returns the members payload above.
- `phase`: `final` when `now ≥ Jan 1 00:00 JST of year+1`, else `partial`. `christmas_open`: `now ≥ Dec 25 00:00 JST of year`, or the phase is final.
- `W(Y)` = max(Jan 1 JST, subscription start) → min(now, Dec 31 23:59:59 JST). Only non-promo messages count toward the tier: full ≥ 150, standard 30–149, short 10–29, none < 10.

Slide rules. Implement them exactly as in spec §9.2 and the proposal details below. Every selection logs `recap.select`.

| key | data | rule | fallback / skip |
|---|---|---|---|
| s01_first | `message`, `joined_this_year: bool`, `new_year_midnight: bool` | First non-promo message in W(Y). Prefer one between 01-01 00:00 and 00:30 JST. | Joined during Y: `joined_this_year=true` (copy uses the start date). |
| s02_name | `count`, `first`, `last`, `fragments[≤24]` (sentence windows around `%%%`, split at `。！？\n`), `mode: "nickname"|"daisuki"` | Messages with `%%%` in W(Y). The first and last must not fall on the same day; if they do, take the last from another month. | No `%%%`: mode `daisuki`, using the 大好き phrases. Count 1: `single=true`. Both modes < 1: skip. |
| s03_clock | `stars: [{h, m, type}]` (≤ 600, sampled), `peak_hour`, `representative`, `longest_streak` (shown only if ≥ 7) | Peak hour = argmax of the JST hour histogram (ties go to the later hour). Representative = the highest-importance text in that hour. | < 30 messages: no streak. Flat histogram (max/mean < 1.3): `band = night|noon|morning`. |
| s04_greetings | `first_ohayo`, `latest_oyasumi`, `oyasumi_count`, `distinct_days` | greeting_class `ohayo` / `oyasumi`. | No ohayo: the first message between 05 and 10h. oyasumi < 3: arigato / otsukare variant (`variant`). Both missing: skip. |
| s05_photos | `wall: [media_url ≤120]`, `burst: [message...]` (the year's best burst), `burst_caption`, `mostly_bursts: bool` (≥ 60% of photos are in bursts) | Burst score = size + 5·any_fav + 3·has_caption + 2·special. Promo excluded. | No burst ≥ 3: `best_photo` (top photo_score) instead. < 5 photos: no wall. 0 photos: skip. |
| s06_voice | `clips: [{message, start: 0, end: 6, transcript_segments|null}]` (first of year, longest mid-year (Jun–Aug, else the overall longest), latest), `voice_count` | Voices ≥ 4 s. With transcripts, attach the segments within the clip. | < 3 voices: one clip of the latest voice, 0–12 s. No voice but video: video audio. Neither: skip. |
| s07_letter | `message` (full text), `char_count`, `photo_url|null` (a photo within ±5 min) | The highest importance among non-promo texts, preferring the longest when within 10% of the top score. | < 60 chars: skip. |
| s08_echo | `then`, `now`, `shared_keyword|null`, `years_apart`, `mode: "echo"|"first_week"` | The spec's echo scoring (proposal §5.5): keyword list `桜|お花見|花火|夏|浴衣|海|紅葉|雪|クリスマス|サンタ|誕生日|年末|大晦日|あけおめ|バレンタイン|チョコ|ライブ|ツアー|卒業|梅雨|お月見|ハロウィン` +4 each, same hour ±1 +2, both with photos +1, same month-day +1, +(year gap − 1), favourite +2. Threshold 4 for showing the keyword. | No earlier year: `first_week` (the first non-promo in the subscription's first week vs the latest-week message). Neither: skip. |
| s09_special | `stubs: [{kind: "birthday"|"christmas"|"newyear"|"anniversary", message, seconds_after_midnight|null, sealed: bool}]` | Birthday: the day's messages, preferring 00:00–00:10. Christmas: 12/24 18:00–12/25 23:59, preferring クリスマス\|メリクリ\|🎄. New year: 01/01 00:00–00:10. Anniversary: the subscription anniversary date. | Christmas sealed when `christmas_open=false`. No stubs: skip. |
| s10_you | `favorites_count`, `first_favorite|null` (message metadata only, NOT her text), `letters_count`, `letters: [{date, first_line}]` | The fan's favourites in Y (`favorited_at` when known, else the message date) and letters in Y. | Neither: `invite=true`. |
| s11_daisuki | `petals: [{text, date} ≤15]` (sentence windows), `final: message` (preferring `%%%` plus 大好き\|ありがとう) | Regex `大好き\|だいすき\|愛してる\|ありがとう\|感謝`. | Fewer than 3: expand to `嬉しい\|楽しい\|幸せ\|またね\|これからもよろしく`, `variant="joy"`. Still none: skip. |
| s12_sentence | `sentence`, `message_id`, `ts`, `photo_url|null` | The top importance sentence (8–60 chars). If the fan has ★ in W(Y), choose among ★ first. It is reserved first, and other slides avoid this message. | Nothing: skip. |
| s13_oyasumi | `message`, `final: bool`, `graduated: bool` | Final phase: the last oyasumi in Y. Partial phase: the latest oyasumi. Graduated in Y: her last message. | No oyasumi: the last non-promo text. |

`poster`:
- `best_photo` (top photo_score, with caption);
- `sentence` (s12);
- `numbers` (≤ 3, chosen by priority nickname → oyasumi → photos → voice → daisuki, each with a key and a count; sparse values are skipped);
- `stubs` (from s09);
- `start_mid_recent` (three photos);
- `favorites_count`, `letters_count`;
- `avatar_changed` (bool, plus old/new urls if the avatar changed in Y);
- `years_together`.

Role titles for the overview: greedy assignment so that each member gets a distinct title, from the metric where that member ranks highest among those still unassigned. Metrics:
- `morning` (ohayo count)
- `nickname` (%%% count)
- `longest` (longest message)
- `voice` (voice count)
- `night` (messages 21–24h)
- `photos` (photos)
- `steady` (longest streak)
- `first` (earliest subscription)

Only titles are returned, never ranks or values.

Caching: a table `recap_cache(service, member_dir, year, data_hash, payload)` in the memory-index DB, keyed on the member index `data_hash` plus `phase` plus `christmas_open` plus the date of `now` (partial recaps can change daily).

- [ ] **Step 1:** Write failing tests with synthetic members, using `time-machine` at 2026-12-10 (partial, Christmas sealed) and 2027-01-02 (final). Cover:
  - tiers;
  - s01 joined_this_year;
  - s02 nickname first/last on different days, the daisuki fallback, and single;
  - s05 burst vs best_photo;
  - s08 echo keyword vs first_week;
  - s09 sealed Christmas;
  - s12 prefers ★;
  - s13 graduated;
  - message uniqueness across slides;
  - role titles distinct;
  - no message text in the logs;
  - the phase flags.
- [ ] **Step 2:** Run `uv run pytest backend/tests/test_memories_recap.py -q`. Expect FAIL.
- [ ] **Step 3:** Implement `recap.py`. Make one pass over the member's messages within W(Y) and reuse the index (captions, bursts, importance, photo_scores). Keep each slide's selection in its own small function: `_s01_first(ctx)`, `_s02_name(ctx)`, and so on. `ctx` is a frozen dataclass with the messages, the index and the dates.
- [ ] **Step 4:** Run the tests and `uv run mypy backend/services/memories`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): build the year recap payload`.

### Task R3: Recap API

**Files:**
- Create: `backend/api/memories.py` (router prefix `/api/memories`), registered in `backend/main.py`
- Test: `backend/tests/test_memories_api.py`

**Interfaces:**
- `GET /api/memories/{service}/recap/{year}/members` calls `build_members_overview`.
- `GET /api/memories/{service}/recap/{year}?member=<member_path>` calls `build_member_recap`.
- `member_path` is the same display-name path the chat uses (`<display>/messages/<group>/<member>`). Validate it with `archive_urls.resolve_within` (path traversal → 400). An unknown service → 400. Year out of range (< 2020, or > current year + 1) → 400.
- Media URLs come from `archive_urls.media_url`. Avatar URLs follow the same route as the chat header uses (check the `account` and profile-image helpers).

- [ ] **Step 1:** Write failing API tests using `TestClient`:
  - the happy path with a fixture output dir;
  - a traversal path gives 400;
  - an unknown member gives 404;
  - the response contains no absolute paths.
- [ ] **Step 2–4:** Implement; run `uv run pytest backend/tests/test_memories_api.py -q`; expect PASS.
- [ ] **Step 5:** Commit `feat(memories): serve the year recap over the API`.

### Task R4: Recap player and the first slides

**Files:**
- Create in `frontend/src/features/memories/recap/`:
  - `api.ts` (fetch with `pollJson`-style timeout; types for the payload contract);
  - `RecapEntry.tsx` (year chooser, plus the member list from `/members` with title chips; the opening runs first when there is more than one member);
  - `RecapPlayer.tsx`: a 9:16 stage centred in the pane with an aurora backdrop; IG-style progress segments; click right/left or ←/→ to step; Space to pause; auto-advance 7 s; the voice slide does not auto-advance until its playback ends; Esc closes; `prefers-reduced-motion` gives static transitions;
  - `slides/S01First.tsx`, `slides/S02Name.tsx`, `slides/S12Sentence.tsx`, `slides/S13Oyasumi.tsx`;
  - `recapCopy.ts` (maps slide data to i18n keys and params);
  - tests per file.
- Locales: `recap.*` keys for the entry, the player and these 4 slides, in the 5 languages. The Japanese reference copy:
  - s01: 「2026年、ふたりの物語はこの一通から始まりました。」, sub 「あなたと彼女の、{n}年目。」, joined 「あなたと彼女の2026年は、{date}から。」
  - s02: 「季節が巡っても、彼女が名前を呼ぶ声だけは変わらない温度でした。」 / 「今年、{n}回 名前を呼んでくれた。」 / single 「今年、一度だけ。でも、確かに呼んでくれた。」 / daisuki 「“大好き”を、{n}回。」
  - s12: 「2026年、彼女のひとこと」
  - s13: 「2026年、最後のおやすみ。」 / partial 「いちばん新しい、おやすみ」 + 「12月31日のおやすみで、完成します。」 / narration 「来年も、よろしくね。」 / graduated 「最後のメッセージ」 + 「ずっと、ここに。」

- [ ] **Step 1:** Write failing tests:
  - the player renders slide 1 from a fixture payload;
  - ←/→ step and Space pauses;
  - auto-advance (fake timers);
  - `%%%` is replaced by the nickname;
  - S12 renders vertical text (`writing-mode: vertical-rl`);
  - S13 partial vs final vs graduated copy;
  - reduced motion;
  - the narration line uses the narration class, not the quote class.
- [ ] **Step 2–4:** Implement and run `npx vitest run src/features/memories && npx tsc --noEmit -p .`. Expect PASS.
- [ ] **Step 5:** Commit `feat(memories): play the year recap with its first slides`.

### Task R5: Slides 3–6 (daily rhythm and voice)

**Files:** `slides/S03Clock.tsx` (24-hour star clock drawn as SVG, no axis numbers, with 4 faint cardinal dots; stars fall in over 2 s; the peak hour glows), `slides/S04Greetings.tsx`, `slides/S05Photos.tsx` (the wall plus the burst fanned out with compressed real timing), `slides/S06Voice.tsx` (▶ press to play; plays the three clips in sequence with a 300 ms crossfade using two `<audio>` elements and volume ramps, via the existing media URL; subtitles when `transcript_segments` are present; signals the player when done), plus tests and locales.

- [ ] Steps as in R4. The voice test uses a fake audio element.
- [ ] Commit `feat(memories): add the rhythm, photo and voice recap slides`.

### Task R6: Slides 7–11 (heart)

**Files:** `slides/S07Letter.tsx` (letter paper and spotlight, scrolling, "{n} 文字の想い"), `slides/S08Echo.tsx` (two cards, older one sepia, shared keyword highlighted, `first_week` mode), `slides/S09Special.tsx` (ticket stubs with monospace seconds; sealed stub shows 「12月25日に、ここが開きます。」), `slides/S10You.tsx` (bookmarks plus envelopes; never shows her messages; invite state), `slides/S11Daisuki.tsx` (falling petals, then the final message; static under reduced motion), plus tests and locales.

- [ ] Steps as in R4. Required tests: S10 renders no message text from the payload; S09 sealed state.
- [ ] Commit `feat(memories): add the heart-of-the-year recap slides`.

### Task R7: Poster (private) and save PNG

**Files:** `recap/PosterView.tsx` (layout per spec §9.4: year, member, "with <nickname>", the polaroid best photo with a handwritten-style caption font from the existing font stack, the vertical sentence, a small star dial reused from S03, ≤ 3 relationship-phrased numbers, stubs, start/mid/recent, footer signature "Dedicated to … · Subscribed since …"); `recap/posterImage.ts` (renders the poster DOM to a canvas through the ShareRenderer primitives from R8, or through an offscreen SVG→canvas path; saves through the existing desktop save-file bridge if one exists, otherwise an `<a download>` blob); tests and locales.

- [ ] Steps as in R4. Required tests: at most 3 numbers; the avatar-change row only when `avatar_changed`; years_together only when ≥ 2.
- [ ] Commit `feat(memories): add the year poster`.

### Task R8: Share export (GIF, MP4, share PNG)

**Files:**
- Frontend `recap/share/ShareRenderer.ts`: a deterministic Canvas 2D frame renderer. Given the payload, the options and a frame index, it returns an ImageBitmap. The scenes follow spec §9.5:
  - 0–1.5 s: year and member;
  - 1.5–3.5 s: star clock and peak hour;
  - 3.5–6 s: frosted collage and the photo count;
  - 6–8 s: a whitelisted greeting and its count;
  - 8–10 s: stub dates and times only;
  - 10–12 s: share poster.
  - The GIF uses 8 s (it drops 8–10 s) at 540×960 and 15 fps.
  - Frosted collage: thumbnails ≤ 18% of the stage width, rotation −8…8°, 30–50% overlap, 6 px blur (scaled), 8% white haze. "Colour record" alternative: monthly dominant-colour rings.
- Frontend `recap/share/ShareDialog.tsx`, a `Modal`. It has:
  - a style choice (collage / colour record);
  - up to two of her sentences, prefilled from s12 and s02.last, each removable or swappable from a list of candidates;
  - toggles for the nickname (masked 『＊＊＊』 when off), own avatar (pick a local image) and years-together, all default OFF;
  - a "SakaDesk" footer toggle, default ON;
  - export buttons GIF / MP4 / PNG;
  - a progress indicator.
- MP4/WebM: `canvas.captureStream(30)` with `MediaRecorder` (`video/webm;codecs=vp9` falling back to vp8). It is hidden when unsupported.
- GIF: the frontend posts PNG frames (base64, batched) to the backend.
- Backend `POST /api/memories/share/gif` with body `{frames: [b64 png...], fps, width, height}`. It assembles the GIF with Pillow (`save_all=True, optimize=True, loop=0`, an adaptive palette) and returns `image/gif` bytes. Caps: frames ≤ 160, a 50 MB body limit, and each frame's dimensions must match.
- Save: through the desktop save bridge if one exists, else a download.
- Tests:
  - frontend: renderer determinism (same input gives the same pixel hash in a jsdom canvas mock, or a stubbed draw-call log); the dialog defaults (identity toggles off, two sentences prefilled, nickname masked); no voice or music in the export.
  - backend: GIF assembly for 3 frames with the right size and loop, and the cap errors.
- [ ] Steps as in R4, plus `uv run pytest backend/tests/test_memories_api.py -q`.
- [ ] Commit `feat(memories): export the recap as a shareable GIF or video`.

### Task R9: Multi-member opening, unlocks, polish, verification

**Files:**
- `recap/Opening.tsx`: two slides.
  - 「わたしの2026」: equal-size stars in `star_order`.
  - Role titles: one chip per member with `title_key`. No numbers and no ranks.
- `RecapEntry` runs the opening first when there are ≥ 2 members with tier ≠ none, then shows the member list. Members with tier `none` show a 「来年のあなたへ」 card.
- Unlocks:
  - The recap entry is visible from Dec 1 of the year.
  - From 1/1 the previous year's recap is shown first.
  - The hub card shows "2026年の、ここまで" during the partial phase.
- Locales for everything above. `recap.titles.*`:
  - morning 「最常對你說早安的晨光」
  - nickname 「叫你名字最多次的羈絆」
  - longest 「寫下最長真心話的筆跡」
  - voice 「把聲音留給你最多的人」
  - night 「陪你度過最多夜晚的溫柔」
  - photos 「讓你看最多風景的人」
  - steady 「每天都在的陪伴」
  - first 「最早相遇的那個人」
  - Japanese equivalents, e.g. 「いちばん“おはよう”をくれた朝の光」.
- Full verification: backend, frontend and type checks (the same commands as M1 Task 8). Then a real-data QA pass on the Windows build is recorded in the ledger for the end-of-release acceptance.
- [ ] Steps as in R4.
- [ ] Commit `feat(memories): add the multi-member opening and year-end unlocks`.
