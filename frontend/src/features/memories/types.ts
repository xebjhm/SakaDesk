/**
 * Payload types of the Memories core and fun-wave endpoints (`/api/memories/{service}/...`).
 *
 * They follow what `backend/services/memories/` really returns (the services named on each
 * type), which is a superset of the plan's shared contract: message objects carry
 * `caption_id`, the hub moment carries `rule` / `years_ago` / `date`, album months carry
 * `cover_color`. Every field the backend can send as `None` is nullable here.
 */

export type MemoryMessageType = 'text' | 'picture' | 'video' | 'voice';

/** One transcript segment of a voice or video; `start` / `end` are seconds into the media. */
export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

/**
 * The shared message object (`people.message_ref` + `people.attach_texts`). `text` is her raw
 * words with the `%%%` / `％％％` nickname placeholder kept; render it with `MemoryText`.
 */
export interface MemoryMessage {
    /** Per-room message id (ids repeat across rooms: pair it with `room` / `member_path`). */
    id: number;
    /** Service-relative POSIX room dir, e.g. `messages/34 金村 美玖/58 金村 美玖`. */
    room: string;
    /** The chat's path for `openChat`: `<service display name>/<room>`. */
    member_path: string;
    service: string;
    /** UTC ISO timestamp (`...Z`). */
    ts: string;
    type: MemoryMessageType;
    text: string | null;
    /** The paired text of a picture / video when it is another message (`caption_id`). */
    caption: string | null;
    caption_id: number | null;
    media_url: string | null;
    /** Service-relative media path with `/` separators (`buildMediaUrl`, `MessageBubble`). */
    media_file: string | null;
    duration_s: number | null;
    favorited: boolean;
    /** Her avatar at that moment, or null when unknown. */
    avatar_url: string | null;
}

/**
 * A message object that also names its sender (album month items, favorites): her display
 * `name` and `person_key` (`people.service_person_key`, unique across services; never log it).
 */
export interface NamedMemoryMessage extends MemoryMessage {
    name: string;
    person_key: string;
}

/** A left-list person row shared by the album and the favorites board. */
export interface MemoriesCountedMember {
    member_path: string;
    member_id: string | null;
    name: string;
    avatar_url: string | null;
    /** Never 0: people without items are left out. */
    count: number;
    /** Her oshi heart in the list (album; optional for payloads that do not send it). */
    oshi?: boolean;
}

// --- hub (hub.build_hub) ---------------------------------------------------------------

/** Which copy is true for the hub moment: today in a past year, near this date, or her first message. */
export type HubMomentRule = 'today' | 'week' | 'first';

export interface HubMoment {
    rule: HubMomentRule;
    /** The past year the moment belongs to (for `first`, the message's JST year). */
    year: number;
    /** This year minus `year`; 0 only for `first`. */
    years_ago: number;
    /** The message's real JST date `YYYY-MM-DD`. */
    date: string;
    member_path: string;
    name: string;
    message: MemoryMessage;
    /** Her best photo of the same JST day, or null. */
    photo: MemoryMessage | null;
}

export interface HubCounts {
    album: number;
    members: number;
    favorites: number;
    /** Voice messages (promo included, like the album count). */
    voices: number;
    /** JST dates with at least one message. */
    days: number;
}

export interface HubCountdown {
    kind: 'birthday' | 'anniversary';
    member_path: string;
    name: string;
    /** JST date `YYYY-MM-DD`. */
    date: string;
    /** 0 = today: show the "today" copy, never "0". */
    days_left: number;
    /** The anniversary number (>= 1); null for a birthday. */
    years: number | null;
}

export interface HubPayload {
    on_this_day: HubMoment | null;
    counts: HubCounts;
    countdown: HubCountdown | null;
    /** 同じ時刻 (`same_time.same_time`), or null when nothing matches this JST minute. Never cached. */
    same_time: SameTimeMoment | null;
    /** The first note resurfacing today (`capsule.resurfacing`, limit 1), or null (none due, or the store failed). */
    capsule: CapsuleResurfaceItem | null;
    /**
     * Gacha pulls left today (JST day), or null when the fan's store failed (show no count). 0 means
     * today's pulls are used: the card says 「また明日」, never the number.
     */
    gacha_left: number | null;
}

// --- On This Day (on_this_day.on_this_day) ------------------------------------------------

export interface OnThisDayEmptyYear {
    year: number;
    has_messages: false;
}

/** An On This Day preview: the shared message object plus her display name (`MemberSummary.name`). */
export interface OnThisDayPreview extends MemoryMessage {
    name: string;
}

export interface OnThisDayYear {
    year: number;
    has_messages: true;
    message_count: number;
    member_count: number;
    /** Up to three message objects, one per person, oshi first, each with her display name. */
    preview: OnThisDayPreview[];
    /** `message_count - preview.length`, or null when that is 0. */
    more: number | null;
    /** Text-free best photo of that date-year, or null. */
    thumb: MemoryMessage | null;
}

export interface OnThisDayPayload {
    /** `MM-DD`. */
    month_day: string;
    /** Oldest first. */
    years: Array<OnThisDayYear | OnThisDayEmptyYear>;
}

// --- day view (day_view.day_view) ---------------------------------------------------------

export interface DayMember {
    member_path: string;
    member_id: string | null;
    name: string;
    /** Her avatar at her first message of the day. */
    avatar_url: string | null;
    service: string;
    oshi: boolean;
    /** The person across her rooms, unique across services (`day_view.day_person_key`); never log it. */
    person_key: string;
}

/** A day-view message: the shared object plus its sender's {@link DayMember.person_key}. */
export interface DayMessage extends MemoryMessage {
    person_key: string;
}

export interface DayPayload {
    /** `YYYY-MM-DD`. */
    date: string;
    members: DayMember[];
    /** Sorted by time; promo included. */
    messages: DayMessage[];
    /** Other services that had messages that day (only with `others`). */
    other_services: string[];
}

export interface DayQuery {
    /** `YYYY-MM-DD`. */
    date: string;
    member?: string;
    others?: boolean;
}

// --- album (album.py, album_colors.py) ----------------------------------------------------

export const ALBUM_KINDS = ['all', 'picture', 'video', 'favorite'] as const;
export type AlbumKind = (typeof ALBUM_KINDS)[number];
export type AlbumCoverRule = 'override' | 'favorite' | 'score' | 'burst' | 'first';

export interface AlbumMembersPayload {
    /** The 全員 count. */
    total: number;
    members: MemoriesCountedMember[];
}

export interface AlbumMonthSummary {
    /** `YYYY-MM`. */
    month: string;
    count: number;
    cover: MemoryMessage;
    cover_rule: AlbumCoverRule;
    /** The cover picture's probe colour `#rrggbb` (runtime data); null for a video or unreadable picture. */
    cover_color: string | null;
    has_favorites: boolean;
}

export interface AlbumMonthsPayload {
    /** Newest first. */
    months: AlbumMonthSummary[];
}

export interface AlbumBurst {
    burst_id: number;
    room: string;
    ids: number[];
}

export interface AlbumMonthPayload {
    month: string;
    /** Time order, each naming her. */
    items: NamedMemoryMessage[];
    /** Bursts with at least three items in the filtered set. */
    bursts: AlbumBurst[];
}

export interface AlbumQuery {
    member?: string;
    kind: AlbumKind;
}

export interface AlbumColorsPayload {
    /** `YYYY-MM` -> `#rrggbb` (runtime data, applied through `style`) or null. */
    colors: Record<string, string | null>;
}

// --- favorites (favorites_board.favorites_board) ------------------------------------------

export interface FavoriteItem extends NamedMemoryMessage {
    /** When the fan starred it in this app (UTC ISO), or null when unknown. */
    favorited_at: string | null;
}

export interface FavoritesPayload {
    /** ★ count over everyone. */
    total: number;
    /** Always over everyone, whatever `member` is. */
    members: MemoriesCountedMember[];
    items: FavoriteItem[];
}

// --- memoir (memoir.py) ---------------------------------------------------------------------

export interface BinderProgress {
    earned: number;
    total: number;
}

export interface MemoirMember {
    /** The chat path of her newest room. */
    member_path: string;
    /** The chat paths of all her rooms, oldest first (match a route path of any of her rooms). */
    member_paths: string[];
    member_id: string | null;
    name: string;
    avatar_url: string | null;
    oshi: boolean;
    graduated: boolean;
    progress: BinderProgress;
}

export interface MemoirMembersPayload {
    members: MemoirMember[];
}

/** A chip is null when its value would be 0 or is unknown: hide it. */
export interface MemoirChips {
    subscription_days: number | null;
    nickname_count: number | null;
    voice_seconds: number | null;
}

export interface MemoirHeaderPayload {
    member_path: string;
    name: string;
    avatar_url: string | null;
    graduated: boolean;
    chips: MemoirChips;
}

// --- binder (binder.binder_payload, cards.py) ---------------------------------------------

export type BinderShelfKey =
    | 'first' | 'anniversary' | 'numbers' | 'special' | 'records'
    | 'moments' | 'you' | 'change' | 'graduation';

export interface BinderCardYear {
    year: number;
    /** JST date `YYYY-MM-DD`. */
    date: string;
    face: MemoryMessage | null;
}

export interface BinderCard {
    /** Catalogue key, e.g. `anniv.y1`, `record.longest`. */
    key: string;
    earned: boolean;
    foil: boolean;
    rare: boolean;
    /** Unlock date (JST `YYYY-MM-DD`), or null. */
    date: string | null;
    face: MemoryMessage | null;
    /** Named extra messages (`pair`, `old_last`, `new_first`); missing ones are left out. */
    refs: Partial<Record<string, MemoryMessage>>;
    /** Null for an earned card and instead of a current value of 0. */
    progress: { current: number; target: number } | null;
    /** A yearly stack, oldest first; empty for other cards. */
    years: BinderCardYear[];
    /** Card-specific numbers / codes (`chars`, `count`, `seconds`, `days`, `messages`, `old_url`, `new_url`). */
    detail: Record<string, number | string>;
    /** The fan's own letter date (あなた shelf only); never paired with her messages. */
    letter: { date: string } | null;
}

export interface BinderShelf {
    key: BinderShelfKey;
    cards: BinderCard[];
}

export interface BinderPayload {
    progress: BinderProgress;
    shelves: BinderShelf[];
}

// --- names (nickname_moments.nickname_moments) --------------------------------------------

export interface NameMoment {
    message: MemoryMessage;
    /** The raw sentence holding the nickname code (original characters kept). */
    sentence: string;
}

export interface NameMomentsPayload {
    /** Every year with items (before the `year` filter), newest first. */
    years: number[];
    /** Newest first. */
    items: NameMoment[];
}

// --- timeline (timeline.py) ----------------------------------------------------------------

export interface TimelineMonthCount {
    /** `YYYY-MM`. */
    month: string;
    /** May be 0: draw an empty bar, never the number. */
    count: number;
}

export interface TimelineMonthsPayload {
    /** Continuous, oldest first. */
    months: TimelineMonthCount[];
}

export interface TimelineMilestone {
    key: string;
    date: string;
    foil: boolean;
}

export interface TimelineMonthPayload {
    month: string;
    count: number;
    avatar_url: string | null;
    /** Up to twelve photos, time order. */
    photos: MemoryMessage[];
    messages: {
        top: MemoryMessage | null;
        late: MemoryMessage | null;
        nickname: MemoryMessage | null;
    };
    milestones: TimelineMilestone[];
}

// --- fun wave: voice radio (radio.py) -------------------------------------------------------

/** `radio.PROGRAMS`, in its order (also the `memories_radio` `kind` codes). */
export const RADIO_PROGRAMS = ['oyasumi', 'ohayo', 'otsukare', 'chrono', 'favorites', 'oyasumi_clips'] as const;
export type RadioProgram = (typeof RADIO_PROGRAMS)[number];

export interface RadioMember {
    member_path: string;
    member_id: string | null;
    name: string;
    avatar_url: string | null;
    oshi: boolean;
    /** At least 1: people without voices are left out. */
    voices: number;
    /** Total known length; null when no voice has a known length. */
    seconds: number | null;
}

export interface RadioMembersPayload {
    /** Null when no voice has a known length. */
    total_seconds: number | null;
    /** Oshi first, then by `seconds` descending. */
    members: RadioMember[];
}

/** One transcript segment (`transcripts.segments_for`): her words, seconds into the voice. */
export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

export interface RadioTrack {
    /** A voice message object (with her words attached). */
    message: MemoryMessage;
    /** Seconds into the voice; 0 for a whole-voice track. */
    start: number;
    /** Null when the length is unknown (play to the end). */
    end: number | null;
    has_transcript: boolean;
    /** Clip tracks (`oyasumi_clips`) only: the matching segments; null for whole voices. */
    segments: TranscriptSegment[] | null;
}

export interface RadioProgramPayload {
    program: RadioProgram;
    /** Programs with tracks in this scope, in {@link RADIO_PROGRAMS} order (精選 only with real clips). */
    programs: RadioProgram[];
    /** Each listed program's track count (`chrono`: the requested year, else the first). */
    counts: Partial<Record<RadioProgram, number>>;
    /** JST years with voices. */
    years: number[];
    tracks: RadioTrack[];
}

export interface RadioProgramQuery {
    program: RadioProgram;
    member?: string;
    /** `chrono` only (2000-2100); ignored by the other programs. */
    year?: number;
}

export interface RadioCassette {
    year: number;
    voices: number;
    seconds: number | null;
    /** The year's probe colour `#rrggbb` (runtime data, applied through `style`), or null. */
    color: string | null;
}

export interface RadioCassettesPayload {
    /** Oldest first. */
    cassettes: RadioCassette[];
}

// --- fun wave: gacha (gacha.py) -------------------------------------------------------------

export const GACHA_RARITIES = ['n', 'r', 'sr'] as const;
export type GachaRarity = (typeof GACHA_RARITIES)[number];

/** Why a pull got its rarity (`gacha.classify`): sr, then r, then n reasons. */
export const GACHA_REASONS = [
    'midnight', 'birthday', 'sub_anniversary', 'last_message', 'nickname', 'favorite', 'voice', 'photo', 'message',
] as const;
export type GachaReason = (typeof GACHA_REASONS)[number];

/**
 * A pulled message. A pull no longer in the archive keeps its row as a date-only card: `ts`,
 * `type` and `text` are null (and the media fields with them).
 */
export interface GachaMessage extends Omit<MemoryMessage, 'ts' | 'type'> {
    ts: string | null;
    type: MemoryMessageType | null;
}

export interface GachaPull {
    /** JST date `YYYY-MM-DD` of the pull. */
    jst_date: string;
    /** 0-based within the day. */
    pull_index: number;
    rarity: GachaRarity;
    reason: GachaReason;
    /** UTC ISO. */
    pulled_at: string;
    message: GachaMessage;
}

export interface GachaStatePayload {
    /** False when the pool is empty (nothing to draw). */
    available: boolean;
    /** May be 0: show 「また明日」, never the number. */
    pulls_left: number;
    max_pulls: number;
    /** Today's pulls by index. */
    today: GachaPull[];
    /** Newest first (today included), at most 60. */
    history: GachaPull[];
}

export interface GachaPullPayload {
    /** Null when the pool is empty. */
    pull: GachaPull | null;
    pulls_left: number;
}

// --- fun wave: calendar album (calendar_album.py, covers.py) --------------------------------

export interface CalendarMonthsPayload {
    /** JST `YYYY-MM` months with at least one message, oldest first. */
    months: string[];
}

export interface CalendarDay {
    /** JST `YYYY-MM-DD`. */
    date: string;
    /** People who posted that day: draw capped dots, never print the number. */
    members: number;
    /** The day's best non-promo photo (or video), text-free (`text`, `caption`, `avatar_url` null); null for none. */
    photo: MemoryMessage | null;
    photo_rule: 'favorite' | 'score' | 'burst' | 'first' | null;
}

export interface CalendarMonthPayload {
    month: string;
    /** Only days with messages, in date order (grey the rest). */
    days: CalendarDay[];
}

/** `PUT /album/cover` body: `member` = chat path of any of her rooms, null = the 全員 album. */
export interface AlbumCoverBody {
    member: string | null;
    /** `YYYY-MM` (JST). */
    month: string;
    room: string;
    id: number;
}

// --- fun wave: capsule (capsule.py) ---------------------------------------------------------

export const CAPSULE_ANCHOR_KINDS = ['day', 'card'] as const;
export type CapsuleAnchorKind = (typeof CAPSULE_ANCHOR_KINDS)[number];

/** The fan's own note (never hers, never logged). */
export interface CapsuleNote {
    id: number;
    anchor: {
        kind: CapsuleAnchorKind;
        /** JST `YYYY-MM-DD` the note is about. */
        date: string;
        /** The card key for a card anchor, else null. */
        card_key: string | null;
    };
    body: string;
    /** UTC ISO. */
    created_at: string;
    updated_at: string;
}

export interface CapsuleNotesPayload {
    notes: CapsuleNote[];
}

/** `GET /capsule`: a day's notes, or one person's card notes. */
export type CapsuleQuery = { date: string } | { member: string; card: string };

/** `POST /capsule` anchor: `member` is the chat path of any of her rooms. */
export type CapsuleAnchorInput =
    | { kind: 'day'; date: string }
    | { kind: 'card'; member: string; card_key: string; date: string };

export interface CapsuleCreateBody {
    anchor: CapsuleAnchorInput;
    /** 1-2000 characters after stripping (else 400 `bad_note`). */
    body: string;
}

export interface CapsuleResurfaceItem {
    note: CapsuleNote;
    /** This JST year minus the JST year written (>= 1): 「{{count}}年前のあなたが書いたメモ」. */
    years_ago: number;
    /** Her best words of the anchor day, or null (the note resurfaces alone). */
    message: MemoryMessage | null;
    /** The message's person (a card anchor's person even without a message), else null. */
    member_path: string | null;
    name: string | null;
}

export interface CapsuleResurfacePayload {
    /** Oldest written first. */
    notes: CapsuleResurfaceItem[];
}

// --- fun wave: 同じ時刻 (same_time.py) --------------------------------------------------------

export interface SameTimeMoment {
    /** Now's JST `HH:MM`. */
    clock: string;
    /** The message's real JST year and date (metadata, never "chosen for you"). */
    year: number;
    date: string;
    member_path: string;
    name: string;
    message: MemoryMessage;
}

// --- fun wave: 彼女の24時間 (day24.py) ---------------------------------------------------------

export type Day24SlotCode = 'ohayo' | 'ohiru' | 'otsukare' | 'oyasumi' | 'hour';

export interface Day24Slot {
    code: Day24SlotCode;
    message: MemoryMessage;
}

/** A full day: the seed that built it (🎲) and the distinct JST years used (may be 1). */
export interface Day24Full {
    seed: number;
    years: number;
    slots: Day24Slot[];
}

/** Too thin a day: exactly `{"slots": []}` (show the gentle thin-data card). */
export interface Day24Thin {
    slots: [];
    seed?: never;
    years?: never;
}

export type Day24Payload = Day24Full | Day24Thin;

// --- fun wave: あの日と今日 (then_now.py) ---------------------------------------------------------

export interface ThenNowSide {
    /** The side's real JST year and date. */
    year: number;
    date: string;
    member_path: string;
    name: string;
    avatar_url: string | null;
    /** Up to three: best photo / video, best words, first voice. */
    items: MemoryMessage[];
}

/** `GET /then-now/day`: null when there is no later year to pair with (hide the toggle). */
export interface ThenNowDayPayload {
    mode: 'day';
    then: ThenNowSide;
    now: ThenNowSide;
    shared_keyword: string | null;
}

export interface ThenNowDayQuery {
    /** `YYYY-MM-DD`. */
    date: string;
    member?: string;
}

export type ThenNowRowKind = 'photo' | 'ohayo' | 'voice';

export interface ThenNowRow {
    kind: ThenNowRowKind;
    then: MemoryMessage;
    now: MemoryMessage;
}

/** `GET /then-now/first-week`: null when the weeks overlap or no row has both sides. */
export interface ThenNowFirstWeekPayload {
    mode: 'first_week';
    /** JST `[first, last]` dates. */
    then_range: [string, string];
    now_range: [string, string];
    rows: ThenNowRow[];
    avatar_then: string | null;
    avatar_now: string | null;
}
