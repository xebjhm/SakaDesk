# Memories (回憶) — design

Date: 2026-11-10. Status: designed with the user in the 2026-11-10 brainstorm (visual companion screens under `.superpowers/brainstorm/`); awaiting the user's spec review.
Release: **every part ships together, before the end of 2026**, together with the unreleased 0.4.2 work already on `dev`.
Repos: SakaDesk (backend + frontend), pysaka (member birthdays).

## 1. Goal and principles

Memories is a new feature (a "回憶" entry on the feature rail) for looking back at the fan's history with each member. It is **not** a statistics dashboard: the user rejected anything that reads as cold numbers. Every screen pairs a fact with something she really said or sent.

Principles (binding for every section):

1. **Warmth over metrics.** At most one number per moment, always followed by her real words, photo or voice. Never show "0" or emphasise absence; thin data switches to a different presentation, not an empty one.
2. **Per group.** Memories follow the active service, like chat and blogs. The only cross-group surface is the optional "包含其他團體" toggle in the 那一天 day view and the multi-member opening of the year recap.
3. **The app's layout.** List on the left, content pane on the right; no long scrolling web pages. Paged or fixed-viewport compositions inside the pane.
4. **Local only.** Nothing is uploaded. The single exception is the year recap's **share export**, which the user creates deliberately and which applies the obfuscation rules in §9.5.
5. **Truthful.** Messages are broadcast to all subscribers, so nothing may imply that she replied to the fan or knew about the fan (letters, subscription dates). `%%%` is the fan's nickname control code; her way of addressing the fan never changes and is not presented as changing.
6. **Design system.** All UI uses `frontend/src/design/` tokens and primitives (see `docs/design/DESIGN_SYSTEM.md`): group colour only for identity / current state / one primary action; semantic colours (推 pink, the yellow favourite star, danger, warning) never follow the group accent. Memories screens are expressive "brand moment" surfaces (serif display headings, aurora/glass, the archive feel), but stay within the token set. Canvas renderers read tokens from CSS variables.
7. **Engineering rules.** Logs carry ids, codes, counts and scores only — never message text, nicknames, names or paths — and every decision / skip / fallback path leaves a structured breadcrumb. All user-facing strings are i18n keys in en, ja, zh-TW, zh-CN and yue (Japanese copy below is the reference wording). CPU-heavy work (scans, image analysis) runs off the event loop and is cached.

## 2. Information architecture

```
Feature rail: 回憶
└─ Home (hub board)                              §4
   ├─ On This Day                                §6  → 那一天 day view §7
   ├─ Album                                      §8
   ├─ Member memoir (member list + pane)         §5
   │   ├─ tab 卡冊 (photocard binder)            §5.3
   │   ├─ tab 時光軸 (timeline)                  §5.4
   │   └─ 被叫名字的瞬間 (from the header chip)   §5.2
   ├─ Favorites overview                         §10
   ├─ Year recap                                 §9
   ├─ Voice radio                                §11
   ├─ Gacha                                      §12
   └─ Calendar album                             §13 → 那一天 day view §7
Cross-cutting: warm presentations §14, notifications §15, data layer §3
```

## 3. Data layer (built first, wave M1)

### 3.1 Sources

| Data | Where it comes from | Notes |
|---|---|---|
| Messages (id, ts to the second, type, text, media) | `messages.json` per member | JST for all hour/date logic. |
| Voice transcripts | `transcriptions.json` sidecars | Optional (user-enabled Gemini). Every feature must work without them. |
| Member avatar history | `profile_images` index (pysaka 0.4.5) | Changes are rare. |
| **Member birthday** | **NEW — pysaka** scrapes the official member profile (per group's official site) and stores `birthday` (month-day, optional year) in the member record / a `members_profile.json` | Required for birthday cards, the recap's special days and M4 reminders. Missing birthday → those features skip silently. |
| **Subscription start** | **NEW — archived** from `Client.get_subscription_streak()` (`current_start_at_date`) on each sync, per member, storing the **earliest** start ever seen | The API only reports the current streak; a lapse resets it, so keep the earliest. Used for anniversaries, "first week", `W(Y)`. |
| Graduation | group `state == 'closed'` (pysaka `get_groups` keeps closed groups) | Prefer missing a graduation over a false one. |
| Favourites (★) | `is_favorite` in messages / favourites API | **NEW:** record `favorited_at` from now on (backend stores it beside `is_favorite`). For 2026 the message time stands in. |
| 推 (oshi) | existing frontend `favorites: Record<service, string[]>` (the blogs "我的推") | **NEW:** mirrored to backend settings so the recap and notifications can use it. |
| Fan nickname / avatar | `account/profile.json` (pysaka 0.4.5) + per-service `user_nicknames` | Nickname replaces `%%%` in private views only. |
| Letters the fan sent | `letters.json` (pysaka 0.4.5) | Only shown as the fan's own items; never paired with her messages. |

### 3.2 Memory index service (backend)

A new backend service builds and caches per-member derived data so pages do not rescan `messages.json`:

- per message: JST date/hour, type, `is_promo`, `has_nickname`, greeting class (おはよう / おやすみ / 大好き / ありがとう), char length, burst id, caption pairing, importance score, photo score;
- per member: hour histogram, first/last message, firsts per type, counts per year, burst list, avatar changes, special-day messages;
- incremental: recomputed for members whose `messages.json` changed (mtime/size or data hash); stored in a local SQLite cache in the app data dir; scans run in an executor with progress breadcrumbs.

### 3.3 Selection rules (LLM-free, shared)

These rules are shared by the recap, album covers, 彼女の24時間, the gacha, On This Day, calendar cells and the card catalogue. Keyword lists live in one lexicon module with unit tests (synthetic examples; non-ASCII, emoji).

**Noise / promo filter** — a message is promo when any of:
- it contains a URL (`https?://`, `www.`);
- it contains announcement words (2+ hits, or 1 hit and > 80 chars): `詳細はコチラ|詳しくは|チェックしてね|ぜひ(見|聴|観)て|お知らせ|告知|解禁|発売|予約|リリース|配信(中|開始)|放送|出演|オンエア|公演|チケット|抽選|応募|特典|ブログ更新|出演情報|CD|Blu-ray|DVD|写真集|グッズ|コラボ|キャンペーン`;
- it contains 3+ time patterns (`\d{1,2}:\d{2}〜?`, schedules), or `【…】` headings with a date.
A photo is promo when its paired text (±3 min) is promo. Promo items still count in totals but are never picked as "her words".

**Subscription welcome** — when a fan subscribes, each room sends an automatic greeting (「ご登録ありがとうございます」, often with `%%%`). A text message is a welcome when it sits at an opening (the room's first message, or the first message on the subscription start day, plus anything within 30 min of it) AND contains 登録/追加 followed by ありがとう within one sentence. Its automatic follow-up line(s) are flagged too: the room's next text message, server id = previous flagged id + 1, within 30 min of the welcome. The index flags it (`is_welcome`) and keeps its date as the fan's real first day, which every anniversary and special date uses; it counts in message totals but never as "her words": no importance, no nickname count, never a card face, recap pick, gacha pull, On This Day / 24h / 同じ時刻 / timeline pick or 被叫名字 entry. `first message` is her first self-written message.

**Q&A posts** — a text with ≥3 question lines (`Q…`, `Q.`, `Ｑ`, or a numbered line ending in `?`), or ≥2 `✉` question lines with ≥2 `➡` answer lines, is flagged `is_qa`. It is never "her longest words": the longest-message card, recap S07, the recap `longest` title and the timeline's top slot skip it; everything else (counts, importance) keeps it.

**Importance score** (for "the one sentence", "the longest heartfelt message", gacha weighting):
`score = chars + 300·favourited + 80·has_nickname + 100·emotion_word + 150·special_date`
- emotion words: `ありがとう|感謝|大好き|本当に|嬉しい|悔しい|涙|目標|夢|卒業|ライブ|ミーグリ|誕生日`;
- special date: her birthday or the day after, 12/31, the fan's subscription anniversary;
- penalties: pure greeting (`おはよう|おやすみ|こんばんは` + ending only) −200; a sentence repeated ≥ 3 times in her year −300.
- If the fan has ★ messages in the window, "the one sentence" is chosen from ★ messages first.

**Photo score** (album covers, calendar cells, recap best photo):
`score = 500·favourited + 150·has_caption + 80·caption_has(%%%|おはよ|おやすみ|好き) + 100·last_in_burst + 80·(20–24h or holiday)`; promo photos excluded. A user override (right-click "設為這個月的封面") always wins for album covers.

**Caption pairing:** the nearest non-promo text from the same member within ±3 min; for a burst, the window is the whole burst ±3 min.

**Bursts:** same member, consecutive photos/videos ≤ 10 min apart, ≥ 3 items. (≈27% of photos in the user's archive.)

**Greeting slots** (彼女の24時間): おはよう 5–10h, お昼/ランチ 11–14h, お疲れ 17–20h, おやすみ 21–24h.

### 3.4 Verified data facts (user's archive, ≈50k messages, 63 members; JST)

- Text peaks at 20–21h (≈12% each); 1–5h ≈ 0; 0:00–0:05 messages exist (58, 9 members; birthdays / New Year).
- Voice (716 clips, 31 members): **53% at 21–24h** (21h 16%, 22h 19%, 23h 18%), 16% at 5–10h with a 7h spike (6%).
- おやすみ 3,680, 大好き 1,558, おはよう 1,170 messages; 31 of 43 active members use `%%%` (max 1,147).
- ≈50% of photos have text within ±3 min; ≈27% of photos are in bursts.
- Daily streak median 4 days, max 374.
- Long gaps are mostly the fan's own unsubscribed periods — never dramatise them.

## 4. Home (hub board)

- Top: a large **On This Day** card (year label, member, her line, a photo) → On This Day.
- Above it, quietly: the **同じ時刻** line (§14.3).
- Entry cards with counts: Album, Member memoir, Favorites, Year recap, Voice radio, Gacha, Calendar album; the 生日・紀念日 card shows the next birthday / anniversary countdown.
- When the fan's 時光膠囊 note from one year ago exists for today, it surfaces here (§14.4).

## 5. Member memoir

Left: the member list (oshi first; shows binder progress like "18 / 30 張"). Right: a header with her current avatar, name and chips — **訂閱 N 天**, **她叫了你 N 次** (click → §5.2), **語音 Xh Ym** — and two tabs: **卡冊** and **時光軸**.

### 5.1 Common header
Subscription days use the archived earliest start (§3.1). Chips hide when their data is missing.

### 5.2 被叫名字的瞬間
Every sentence containing `%%%` (one sentence each, split at `。！？\n`), rendered with the nickname underlined, newest first, filterable by year; each row shows date and her avatar at the time; click → the day's full context (film-strip view, §10). Members who never use `%%%` hide the chip.

### 5.3 卡冊 (photocard binder)
Shelves of cards. Earned cards face up (photo or her words, Japanese original, with the date); unearned cards are dashed silhouettes with the condition and a progress bar. **Foil** = special. Clicking a card opens a large view with that day's messages and a jump to the chat.

**特別な日 as postmarked postcards (r4 A3).** Every earned 特別な日 card is a postcard she sent, postmarked with its year. Several years make a stack (the newest on top, at most three drawn, a caption with the count and the years) that fans out on hover or focus; under reduced motion it stays still. Opening it shows the postcard backs, one per year, newest first: her words on ruled lines, a stamp, a postmark with the JST date and time, and that day's best photo when the face is not itself one (`CardYear.photo`, 加入紀念日 `refs.photo`). The backs are one Tab stop; ↑ / ↓ (← / →, Home / End) move between years, and the picked year drives the day column and the jump. Themes: 元旦 is a 年賀状 (謹賀新年 in the calendar's holiday red), her birthday a birthday card (the foil band), 加入紀念日 and the subscription anniversary anniversary cards (a group-pastel band); Valentine's and Christmas plain cards with their own stamp. The 推 pink appears only as the ♥ beside her name for the fan's 推し.

| Shelf | Cards (rule) |
|---|---|
| 初めて | first message; first photo; first video; first voice; **first nickname** (foil); |
| 記念日 | subscription **100日, 1年, 500日, 2年, 1000日, 3年, 4年, 5年, then yearly** — card face = her message that day (nearest one if none that day) |
| 数字 | 100 / 1,000 / 5,000 / 10,000 (foil) messages; 100 / 1,000 photos; 1 h total voice; 100 nicknames |
| 特別な日 (yearly stacks) | 元旦 (her message on 1/1 JST, the first one before 00:30 preferred; a year with no 1/1 message has no entry); バレンタイン; クリスマス; **her birthday** (foil); 加入紀念日 (the fan's first day = the date of the room's subscription welcome, else the stored subscription start; single card: her own words that day, or the label alone); your subscription anniversary day |
| 記録 (updates over time) | longest message; busiest day; most-nickname day; longest voice; **earliest おはよう vs latest おやすみ** (pair card) (the daily streak cards were removed by the user) |
| 瞬間 | **日付が変わった瞬間** (foil; a message at 00:00–00:05); **シンクロ** (rare; two messages at the same HH:MM:SS on different days); おやすみ first / 100th; 大好き first / 100th |
| あなた | first letter you sent; 10 / 50 letters (the fan's own items only) |
| 変化 | **avatar change** cards: new avatar + her message that day; detail shows "this avatar was with you N days, M messages", the last message with the old avatar and the first with the new |
| 卒業 | **最後の一通** (memorial foil) — a graduated member's last message |

Removed by the user: season cards, late-night (1–5h) card, calling-style change, letter-reply cards, card back "one year later".

### 5.4 時光軸 (timeline)
A bottom rail of monthly message-volume bars with a lens (same interaction as the blogs TimelineRail: drag, wheel, ←/→ = older/newer). Above it, the selected month: her avatar at the time, that month's photos (one large hero, the best photo score, beside two rows of small tiles; stacked when narrow), representative messages (highest importance, a late message, a nickname message), and that month's milestones (from the card catalogue). The month header's 初見と今 pill (§14.2) swaps the month for her first-and-recent rows.

## 6. On This Day

- **Overview (B):** one column per year for the selected date, side by side; older years slightly sepia. With many years the strip **scrolls horizontally by mouse drag** (and wheel / arrows). Date navigation ‹ › and a date picker (any date).
- **Detail (A):** clicking a column opens the 那一天 view (§7) for that year's date, with a year list on the left; the years are compared through the day view's 歷年同一天 mode (§7).
- Years without messages appear dimmed ("這天沒有訊息") in the list, not as empty columns.

## 7. 那一天 day view

Shared by On This Day and the calendar.
- **Default A — merged timeline:** every member's messages of that day in chronological order, chat-bubble style with member names and times; member filter chips; **"包含其他團體"** toggle mixes in other subscribed groups' messages of the same date.
- **Switchable B — swimlanes:** one column per member, time running down with an hour ruler; cards positioned by time; click a card to expand. Shows "everyone at the same moment" (e.g. after a concert).
- **Switchable C — 歷年同一天 (r4 B1):** the same calendar day in every year that has messages on it (one person on a member's page, else everyone in the active group; the welcome left out), one column per year, oldest on the left, each message placed by its JST time of day on one thin hour axis so mornings sit beside mornings. Matching kinds in neighbouring years (おはよう only 04:00–11:59, photo, video, voice, おやすみ; Q&A posts are never greetings; the same rule as 初見と今; within 90 minutes) are joined by faint dotted guide lines; an hour that is quiet in one year while another year has messages shows a faint dashed gap. Older years' photos are aged with sepia. Fixed-width year columns scroll sideways when there are many years (usable at the 960×640 minimum window). The heading is the month-day alone; the member chips narrow every year; there is no cross-group switch. Labels: 依時間 / 依成員 / 歷年同一天 (zh-TW), 時系列 / メンバー別 / 歴年の同じ日 (ja).

## 8. Album

Left: **全員** + per-member counts. Right: a month-sectioned grid with filters (全部 / 照片 / 影片 / ★).
- **Polaroid month cover** with a handwritten-style caption (her nearby text); the month band tint comes from the cover photo. Cover choice: user override → ★ photo (oshi first) → photo score (§3.3) → first photo of the month's largest burst; promo/screenshot-like images last.
- **Burst stacks** ("5 張"), opening into the sequence with her words.
- **Hover caption:** her text within ±3 min.
- **Favourited photos pinned larger with washi tape.**
- **Monthly colour ribbon** on the right (dominant colour of each month's photos; Pillow, cached) used as a draggable scrubber.
- Older years slightly sepia (shared with 初見と今 and 歷年同一天).
- Clicking opens the existing media viewer (zoom, ←/→, jump to chat).

## 9. Year recap 「同じ坂道を歩いた一年」 (priority within the release)

Two parts plus a share export: **A** story slides played inside the content pane (9:16 stage centred, aurora background, IG-style progress bar, click / ←→ / space), **B** a final poster. Copy is poetic Japanese with translations; the app's own narration uses a distinct, smaller sans font so it never reads as her words.

### 9.1 Window and tiers
`Y` = calendar year (JST). `W(Y)` = max(Jan 1, subscription start) → now; nothing outside `W(Y)` is counted. Tiers by her non-promo messages in `W(Y)`: full ≥ 150 (all slides), standard 30–149, short 10–29 (≥ 5 slides), none < 10 (no recap; a gentle "来年のあなたへ" card on the member page).

### 9.2 Slides (four acts)
**序曲・重逢の鐘聲**
1. **今年最初の一通** — a lock-screen notification with a seconds timestamp that expands into her first message of the year (0:00–0:30 New Year message preferred; faint white-gold particles). Joined later in the year → "あなたと彼女の2026年は、10月14日から。"
2. **名前を、呼ばれた** — the nickname appears large, letter by letter; fragments of her nickname sentences drift in; it settles on the **first and the most recent** nickname sentence of the year. Members without `%%%` → the same layout with 大好き; one occurrence → "今年、一度だけ。でも、確かに呼んでくれた。"

**日常・朝夕與光影**
3. **彼女の夜は、あなたの夜** — a 24-hour star clock (each message a star, no axis numbers); the peak hour glows with a representative message (no streak line: removed by the user).
4. **おはようと、おやすみ** — her first おはよう and latest おやすみ of the year, the おやすみ count; fallbacks to ありがとう / お疲れ or skip.
5. **見せたかった景色** — this year's photos as a soft background wall, then the year's biggest burst fanned out at compressed real timing, with its caption; a line for members who mostly send bursts ("彼女は、いつもまとめて見せてくれる人。").
6. **声** — the openings (~6 s each) of three voices (first of the year, longest mid-year, latest), crossfaded; plays only when the fan presses ▶; transcript subtitles when available; video audio or skip as fallbacks.

**凝視・真心話**
7. **いちばん長い手紙** — her longest heartfelt (non-promo, highest importance) message on letter paper under a spotlight, scrolling, with "1,240 文字の想い".
8. **去年の、同じ日** — the same date in an earlier year vs this year, the shared keyword lighting up; for fans who joined this year: first subscription week vs this week (初見 vs 今).
9. **特別な日** — ticket stubs: her birthday (0:00 messages first, shown with seconds), Christmas, New Year 0:00, and the fan's subscription anniversary day (copy must not imply she knew).
10. **あなたも、ここにいた** — the fan's own ★ (bookmarks into a book) and letters (envelopes on a line); **none of her messages on this slide**; gentle invitation if empty.

**終章・名為最喜歡的餘韻**
11. **大好き と ありがとう** — petals of her 大好き / ありがとう phrases fall and settle on one full message (prefer one with both `%%%` and the keyword).
12. **今年の、ひとこと** — "the one sentence" (§3.3) in vertical serif type on black, her photo of that day faintly behind.
13. **今年最後の、おやすみ** — the star clock folds back into one small light above her last おやすみ of the year; narration "来年も、よろしくね。" → transition to the poster. **Graduated in Y:** her last message, "最後のメッセージ", "ずっと、ここに。", no particles, fully quiet.

Each message is the hero of at most one slide (slide 12's sentence is reserved first). Every selection writes a breadcrumb (`recap.select`, slide, rule, score, fallback, message_id).

### 9.3 Year-end unlocks
Open from **Dec 1** as "2026年の、ここまで"; the Christmas stub stays sealed ("12月25日に、ここが開きます。") until 12/25; the last-おやすみ slide finalises after 12/31; on the first launch after **Jan 1 00:00 JST** a notification says the full recap is ready. Past recaps stay available as a shelf of yearbooks.

### 9.4 Poster (B)
Layout (private version): year + member + "with <nickname>"; a large polaroid best photo with its handwritten caption; the one sentence in vertical type; a small star dial; up to **three** relationship-phrased numbers ("180 回の『おやすみ』で一日を締めくくった", priority: nickname → おやすみ → photos → voice → 大好き; sparse ones are swapped for full ones, never total message count); special-day stubs (if any); start / mid / recent photos; the fan's ★ and letters as a footer signature; "Dedicated to <nickname> · Subscribed since …". The avatar change appears only in a year it actually happened. Private PNG can be saved locally.

### 9.5 Share export
- Outputs: **GIF** (≈8 s loop, Pillow-assembled from canvas frames) and an optional **MP4/WebM** (≈12 s, `canvas.captureStream` + `MediaRecorder`); a share-version poster PNG. No music, no voice.
- Images: **frosted collage** (small, rotated, overlapping, blurred thumbnails; each ≤ 18% of stage width) — not mosaic — and/or the **colour record** (monthly dominant-colour rings of the year's photos). No raw member photos or avatars.
- Text: numbers, times ("00:00:07", "21時台"), whitelisted greetings, and **up to two of her sentences** (user decision). Defaults chosen by rule; the user can swap or remove them before exporting.
- Identity: the fan's nickname, own avatar (user-chosen image) and "N年目" are **opt-in, off by default**; nickname masked as 『＊＊＊』 when off. A "SakaDesk" footer toggle (default on).
- Export writes only to a folder the user picks.

### 9.6 Multi-member fans
A two-slide opening "わたしの2026": every subscribed member is an **equal-size star** (ordered oshi → ★ count → subscription age; never by message volume), then per-member **role titles** ("最常對你說早安的晨光", "叫你名字最多次的羈絆", "寫下最長真心話的筆跡", …) — one distinct title per member, no ranks shown. Then each member's own recap (members below the short tier are skipped). Single-member fans skip the opening.

## 10. Favorites overview

A **cork board**: text favourites as notes, photo favourites as pinned prints, voice favourites as mini player cards, each held with washi tape; left list = 全部收藏 + per-member counts. Opening one shows the **film strip**: the favourite in the centre, the previous / next messages of the same day either side (←/→ for more), jump to the chat.

## 11. Voice radio

- **A — 深夜ラジオ station:** ON AIR lamp, a station title ("美玖の深夜放送局"), program cards, now-playing with her avatar at the time and a waveform, lyrics-style transcript when available, controls, and a **sleep timer** that fades out and stops.
- Programs (verified, §3.4): **おやすみ放送 (21–24h)**, **おはよう放送 (5–10h)**, **おつかれチャージ (other hours)**, **あの頃から順番に** (chronological; the year is chosen via B), **★ favourited voices**, and **精選・おやすみだけ** (keyword clips from transcripts, crossfaded — only when transcripts exist).
- **B — cassettes:** one tape per year (label colour from that year's photos) to pick the year for the chronological program.
- Left list: 全員 + members with voice counts / total length.

## 12. Gacha (回憶扭蛋)

A capsule machine: drag or click the knob, a capsule rolls out (colour = rarity), it opens into a card (her message / photo / voice with date, context link, ★ button). **3 pulls per day.** Pull history below. Rarity: normal = ordinary message/photo; **R** = nickname, favourited, voice; **SR** (gold, foil) = 日付が変わった瞬間, her birthday, the fan's subscription anniversary day, a graduated member's last message. Promo is never drawn. Weighted by rarity and importance.

## 13. Calendar album

The existing Japanese calendar (Sunday first, Sun/祝日 red, Sat blue, holiday names, title → year/month picker). Each day cell shows the day's best photo (§3.3) and dots for how many members posted; empty days grey; an optional member filter. Clicking a day opens 那一天 (§7).

## 14. Warm presentations

1. **彼女の24時間** — a day stitched from different years: 5–7 slots in her active hours (from her histogram), each filled with a message sent at that time (±30 min) in some year, scored by slot greeting, photo, nickname, ★, promo down-ranked, years varied; a sky gradient from morning to night; 🎲 rebuilds. Lives on the member page (and as recap material).
2. **初見と今** (r4 B2) — in the memoir timeline, one row per kind (おはよう, photo, voice, おやすみ): her first one on the left, a recent one on the right (the best of the 30 days ending on her newest of that kind), and the time between them in the middle (「1 年 8 天」). A row appears only when both sides exist and are on different days; the welcome, promo and (for the greetings) Q&A posts never stand in. Each side opens her day at that message. Comparing a date across years is the day view's 歷年同一天 mode (§7); the recap keeps its own 去年の、同じ日 slide (S08).
3. **同じ時刻** — a home line: "現在 21:03，2024 年的這個時刻她說了……", refreshed each minute from messages within ±2 min of the current time-of-day (oshi first).
4. **時光膠囊** — the fan writes sticky notes on any card or day (local only); one year later the note resurfaces with her message of that day on Home and in On This Day.
5. **被叫名字的瞬間** — §5.2.

## 15. Notifications (M4)

A new "回憶" notification category in Settings with a toggle per kind; same delivery as message toasts (app running or in the tray); never duplicated; suppressed while the user is in Memories.

| Kind | When | Content / click |
|---|---|---|
| Daily On This Day | **12:00** (configurable; avoids the 20–23h message peak); skipped when no past messages that date; one per day (oshi first) | "3 年前的今天，美玖說了……" + best photo → On This Day |
| Birthday | 00:00 on the day; reminders 7 days and 1 day before | "今天是美玖的生日" / "再 7 天" → member memoir |
| Subscription anniversary / milestones | on the day (1年, 2年…; 100日, 500日, 1000日) | → the binder card |
| Year recap | 12/1 opens; 12/25 Christmas stub; first launch after 1/1 completes | → year recap |
| Card unlock | **off by default**; when on, foil cards only | → the card |

## 16. Delivery plan

Waves (each: plan → subagent-driven implementation → reviews → merge to a `feat/memories` integration branch; one acceptance at the end; release together):

1. **M1 data layer:** pysaka member birthdays (+ release), subscription-start archiving, `favorited_at`, oshi mirroring, the memory index service, the selection module + lexicon, cache.
2. **Year recap** (A slides, B poster, share export) — highest time pressure (opens Dec 1).
3. **Core:** hub, member memoir (binder + timeline + 被叫名字), On This Day + 那一天, album, favorites.
4. **Fun:** voice radio, gacha, calendar, 24h / あの日と今日 / 同じ時刻 / 時光膠囊.
5. **M4 notifications.**

**Fallback priority** (only if the schedule slips by mid-December; the user decides): MP4 export → photo image analysis (keep metadata rules) → voice silence detection (play from 0 s) → 精選 voice clips → シンクロ card → swimlane view.

## 17. Verification

- Unit tests for the lexicon, promo filter, scores, bursts, caption pairing, tiers and every fallback with synthetic data (late subscriber, no `%%%`, no voice, graduated member, multi-member), non-ASCII and emoji; `time-machine` for Dec / Jan unlock states; snapshot payloads for recap selections.
- Frontend tests per screen (vitest), design-system guard, i18n coverage in five locales.
- Real-data QA on the Windows build (read-only copy of the archive) with CDP captures of each screen, the share GIF reviewed for obfuscation, and a performance check of the first index build on ≈50k messages.

## 18. Open points

- pysaka birthday source per group (official member profile pages) — confirm the fields per site during M1.
- Whether the 2027 recap adds "most re-read" (would require opt-in view tracking from now on; not part of this release).
