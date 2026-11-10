/**
 * Payload types of the Memories core endpoints (`GET /api/memories/{service}/...`).
 *
 * They follow what `backend/services/memories/` really returns (the services named on each
 * type), which is a superset of the plan's shared contract: message objects carry
 * `caption_id`, the hub moment carries `rule` / `years_ago` / `date`, album months carry
 * `cover_color`. Every field the backend can send as `None` is nullable here.
 */

export type MemoryMessageType = 'text' | 'picture' | 'video' | 'voice';

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
    /** Wave-4 hooks, always null in this wave. */
    same_time: null;
    capsule: null;
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
    member_path: string;
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
