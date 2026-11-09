/**
 * Year recap API client and payload types.
 *
 * The types follow what `backend/services/memories/recap.py` really returns
 * (`_compose`, `_slide`, `ctx.message` and each `_sNN_*`), which is a superset of
 * the plan's shared contract: message objects carry `member_path` (message ids
 * repeat across rooms), and several slides add fields such as `variant` or
 * `band`. Every positional field may be `null`; renderers leave it out.
 */
import { pollJson, type PollResult } from '../../../utils/pollJson';

/** A recap build reads every fact of the person on a cache miss; give it time. */
export const RECAP_TIMEOUT_MS = 30000;

export type RecapPhase = 'partial' | 'final';
export type RecapTier = 'full' | 'standard' | 'short' | 'none';
export type RecapMessageType = 'text' | 'picture' | 'video' | 'voice';

/** `ctx.message(...)`: one of her messages. `text` is raw (the `%%%` placeholder kept). */
export interface RecapMessage {
    id: number;
    /** UTC ISO timestamp (`...Z`). */
    ts: string;
    type: RecapMessageType;
    text: string | null;
    media_url: string | null;
    caption: string | null;
    avatar_url: string | null;
    /** The room's display-name path (ids are per room). */
    member_path: string | null;
}

export interface RecapMemberBlock {
    id: string;
    name: string;
    avatar_url: string | null;
    graduated: boolean;
    /** JST date `YYYY-MM-DD`, or null when unknown. */
    subscription_start: string | null;
    years_together: number | null;
}

export interface S01FirstData {
    message: RecapMessage | null;
    joined_this_year: boolean;
    new_year_midnight: boolean;
}

export interface S02NameData {
    mode: 'nickname' | 'daisuki';
    count: number;
    first: RecapMessage | null;
    last: RecapMessage | null;
    /** Sentence fragments (raw, `%%%` kept). */
    fragments: string[];
    single: boolean;
}

export interface S03ClockData {
    stars: { h: number; m: number; type: RecapMessageType }[];
    peak_hour: number;
    representative: RecapMessage | null;
    longest_streak: number | null;
    band?: 'night' | 'noon' | 'morning';
}

export interface S04GreetingsData {
    first_ohayo: RecapMessage | null;
    latest_oyasumi: RecapMessage | null;
    oyasumi_count: number | null;
    distinct_days: number | null;
    variant: 'oyasumi' | 'arigato' | 'otsukare';
}

export interface S05PhotosData {
    burst: RecapMessage[];
    burst_caption: string | null;
    wall?: (string | null)[];
    mostly_bursts: boolean;
    best_photo?: RecapMessage | null;
}

export interface RecapClip {
    message: RecapMessage | null;
    start: number;
    end: number;
    transcript_segments: { start: number; end: number; text: string }[] | null;
}

export interface S06VoiceData {
    clips: RecapClip[];
    voice_count: number | null;
}

export interface S07LetterData {
    message: RecapMessage | null;
    char_count: number;
    photo_url: string | null;
}

export interface S08EchoData {
    then: RecapMessage | null;
    now: RecapMessage | null;
    shared_keyword: string | null;
    years_apart: number | null;
    mode: 'echo' | 'first_week';
}

export interface RecapStub {
    kind: 'birthday' | 'christmas' | 'newyear' | 'anniversary';
    message: RecapMessage | null;
    seconds_after_midnight: number | null;
    sealed: boolean;
}

export interface S09SpecialData {
    stubs: RecapStub[];
}

export type S10YouData =
    | { invite: true }
    | {
        invite: false;
        favorites_count: number | null;
        first_favorite: (RecapMessage & { favorited_at: string | null }) | null;
        letters_count: number | null;
        letters: { date: string; first_line: string }[];
    };

export interface S11DaisukiData {
    petals: { text: string; date: string }[];
    final: RecapMessage | null;
    variant: 'joy' | null;
}

export interface S12SentenceData {
    /** Raw sentence (`%%%` kept). */
    sentence: string;
    message_id: number;
    member_path: string | null;
    ts: string;
    photo_url: string | null;
}

export interface S13OyasumiData {
    message: RecapMessage | null;
    final: boolean;
    graduated: boolean;
}

interface SlideOf<K extends string, D> {
    key: K;
    fallback: string | null;
    data: D;
}

export type RecapSlide =
    | SlideOf<'s01_first', S01FirstData>
    | SlideOf<'s02_name', S02NameData>
    | SlideOf<'s03_clock', S03ClockData>
    | SlideOf<'s04_greetings', S04GreetingsData>
    | SlideOf<'s05_photos', S05PhotosData>
    | SlideOf<'s06_voice', S06VoiceData>
    | SlideOf<'s07_letter', S07LetterData>
    | SlideOf<'s08_echo', S08EchoData>
    | SlideOf<'s09_special', S09SpecialData>
    | SlideOf<'s10_you', S10YouData>
    | SlideOf<'s11_daisuki', S11DaisukiData>
    | SlideOf<'s12_sentence', S12SentenceData>
    | SlideOf<'s13_oyasumi', S13OyasumiData>;

export type RecapSlideKey = RecapSlide['key'];

/** The poster block; rendered by a later task, kept loose here. */
export type RecapPoster = Record<string, unknown>;

/** `GET /api/memories/{service}/recap/{year}?member=...`. Tier `none`: no slides, no poster. */
export interface RecapPayload {
    year: number;
    phase: RecapPhase;
    tier: RecapTier;
    member: RecapMemberBlock;
    slides: RecapSlide[];
    poster: RecapPoster | null;
}

export type RecapTitleKey =
    | 'recap.titles.morning' | 'recap.titles.nickname' | 'recap.titles.longest' | 'recap.titles.voice'
    | 'recap.titles.night' | 'recap.titles.photos' | 'recap.titles.steady' | 'recap.titles.first';

export interface RecapOverviewMember {
    member_path: string;
    member_id: string;
    name: string;
    tier: RecapTier;
    oshi: boolean;
    title_key: RecapTitleKey | null;
}

/** `GET /api/memories/{service}/recap/{year}/members`. */
export interface RecapOverview {
    year: number;
    phase: RecapPhase;
    christmas_open: boolean;
    members: RecapOverviewMember[];
    opening: {
        star_order: string[];
        first_message: { member_id: string; ts: string } | null;
        oyasumi_total: number | null;
    };
}

const base = (service: string, year: number) =>
    `/api/memories/${encodeURIComponent(service)}/recap/${year}`;

/** The members overview of one service and year (latest call wins). */
export function fetchRecapMembers(service: string, year: number, signal?: AbortSignal): Promise<PollResult<RecapOverview>> {
    return pollJson<RecapOverview>('recap_members', `${base(service, year)}/members`, {
        timeoutMs: RECAP_TIMEOUT_MS, signal, replace: true,
    });
}

/** One member's recap (latest call wins). */
export function fetchMemberRecap(
    service: string, year: number, memberPath: string, signal?: AbortSignal,
): Promise<PollResult<RecapPayload>> {
    const url = `${base(service, year)}?member=${encodeURIComponent(memberPath)}`;
    return pollJson<RecapPayload>('recap_member', url, { timeoutMs: RECAP_TIMEOUT_MS, signal, replace: true });
}
