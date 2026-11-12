/**
 * Cross-layer contract: real backend payloads against the TS types in `api.ts`.
 *
 * `__fixtures__/contract/recap_payloads.json` is written by the backend test
 * `test_contract_fixture_for_the_frontend` (`backend/tests/test_memories_recap.py`) from real
 * `build_member_recap` / `build_members_overview` / `recap_years` output, so a payload change
 * on either side fails here or there.
 *
 * Each shape below is typed `satisfies Shape<T>`, so `tsc` fails when a TS type gains or loses
 * a field the validator does not list; at run time every object must carry exactly the listed
 * keys (optional ones may be absent) with the listed types and nullness.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../../../i18n';
import fixture from './__fixtures__/contract/recap_payloads.json';
import type {
    RecapClip, RecapMemberBlock, RecapMessage, RecapOverview, RecapOverviewMember, RecapPayload, RecapPoster,
    RecapSlideKey, RecapStub, RecapTranscriptSegment, RecapYears, S01FirstData, S02NameData, S03ClockData,
    S04GreetingsData, S05PhotosData, S06VoiceData, S07LetterData, S08EchoData, S09SpecialData, S10YouData,
    S11DaisukiData, S12SentenceData, S13OyasumiData,
} from './api';
import { buildShareModel, defaultShareOptions, MAX_SENTENCES, splitSentences } from './share/shareModel';

type Check = (value: unknown, path: string, errors: string[]) => void;
/** One check per key of `T`, optional keys included (they may be absent from the JSON). */
type Shape<T> = { [K in keyof Required<T>]: Check };

const fail = (errors: string[], path: string, what: string, value: unknown) =>
    errors.push(`${path}: expected ${what}, got ${JSON.stringify(value)}`);

const str: Check = (v, p, e) => { if (typeof v !== 'string') fail(e, p, 'string', v); };
const int: Check = (v, p, e) => { if (!Number.isInteger(v)) fail(e, p, 'integer', v); };
const num: Check = (v, p, e) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(e, p, 'number', v); };
const bool: Check = (v, p, e) => { if (typeof v !== 'boolean') fail(e, p, 'boolean', v); };
const utc: Check = (v, p, e) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)) fail(e, p, 'UTC ISO timestamp', v);
};
const day: Check = (v, p, e) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(e, p, 'YYYY-MM-DD', v); };
const oneOf = (...allowed: readonly unknown[]): Check => (v, p, e) => {
    if (!allowed.includes(v)) fail(e, p, `one of ${JSON.stringify(allowed)}`, v);
};
const nullable = (check: Check): Check => (v, p, e) => { if (v !== null) check(v, p, e); };
const arrayOf = (check: Check): Check => (v, p, e) => {
    if (!Array.isArray(v)) return fail(e, p, 'array', v);
    v.forEach((item, i) => check(item, `${p}[${i}]`, e));
};
function obj<T>(shape: Shape<T>, optional: readonly (keyof T)[] = []): Check {
    return (v, p, e) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(e, p, 'object', v);
        const record = v as Record<string, unknown>;
        for (const key of Object.keys(record)) {
            if (!(key in shape)) e.push(`${p}.${key}: not in the TS type`);
        }
        for (const [key, check] of Object.entries(shape) as [string, Check][]) {
            if (!(key in record)) {
                if (!optional.includes(key as keyof T)) e.push(`${p}.${key}: missing`);
                continue;
            }
            check(record[key], `${p}.${key}`, e);
        }
    };
}

const MESSAGE_TYPES = ['text', 'picture', 'video', 'voice'] as const;
const messageShape = {
    id: int, ts: utc, type: oneOf(...MESSAGE_TYPES), text: nullable(str), media_url: nullable(str),
    caption: nullable(str), avatar_url: nullable(str), member_path: nullable(str),
} satisfies Shape<RecapMessage>;
const message = obj<RecapMessage>(messageShape);

const member = obj<RecapMemberBlock>({
    id: str, name: str, avatar_url: nullable(str), graduated: bool, subscription_start: nullable(day),
    years_together: nullable(int),
} satisfies Shape<RecapMemberBlock>);

const stub = obj<RecapStub>({
    kind: oneOf('birthday', 'christmas', 'newyear', 'anniversary'), message: nullable(message),
    seconds_after_midnight: nullable(int), sealed: bool,
} satisfies Shape<RecapStub>);

const sentence = obj<S12SentenceData>({
    sentence: str, message_id: int, member_path: nullable(str), ts: utc, photo_url: nullable(str),
} satisfies Shape<S12SentenceData>);

const segment = obj<RecapTranscriptSegment>({ start: num, end: num, text: str } satisfies Shape<RecapTranscriptSegment>);
const clip = obj<RecapClip>({
    message, start: num, end: num, transcript_segments: nullable(arrayOf(segment)),
} satisfies Shape<RecapClip>);

type S10Open = Extract<S10YouData, { invite: false }>;
type FirstFavorite = NonNullable<S10Open['first_favorite']>;
const s10Open = obj<S10Open>({
    invite: oneOf(false), favorites_count: nullable(int),
    first_favorite: nullable(obj<FirstFavorite>({ ...messageShape, favorited_at: nullable(utc) } satisfies Shape<FirstFavorite>)),
    letters_count: nullable(int),
    letters: arrayOf(obj<S10Open['letters'][number]>({ date: day, first_line: str })),
} satisfies Shape<S10Open>);
const s10Invite = obj<Extract<S10YouData, { invite: true }>>({ invite: oneOf(true) });

const SLIDE_DATA: Record<RecapSlideKey, Check> = {
    s01_first: obj<S01FirstData>({
        message: nullable(message), joined_this_year: bool, new_year_midnight: bool,
    } satisfies Shape<S01FirstData>),
    s02_name: obj<S02NameData>({
        mode: oneOf('nickname', 'daisuki'), count: int, first: nullable(message), last: nullable(message),
        fragments: arrayOf(str), single: bool,
    } satisfies Shape<S02NameData>),
    s03_clock: obj<S03ClockData>({
        stars: arrayOf(obj<S03ClockData['stars'][number]>({ h: int, m: int, type: oneOf(...MESSAGE_TYPES) })),
        peak_hour: int, representative: nullable(message),
        band: oneOf('night', 'noon', 'morning'),
    } satisfies Shape<S03ClockData>, ['band']),
    s04_greetings: obj<S04GreetingsData>({
        first_ohayo: nullable(message), latest_oyasumi: nullable(message), oyasumi_count: nullable(int),
        distinct_days: nullable(int), variant: oneOf('oyasumi', 'arigato', 'otsukare'),
    } satisfies Shape<S04GreetingsData>),
    s05_photos: obj<S05PhotosData>({
        burst: arrayOf(message), burst_caption: nullable(str), wall: arrayOf(nullable(str)), mostly_bursts: bool,
        best_photo: nullable(message),
    } satisfies Shape<S05PhotosData>, ['wall', 'best_photo']),
    s06_voice: obj<S06VoiceData>({ clips: arrayOf(clip), voice_count: nullable(int) } satisfies Shape<S06VoiceData>),
    s07_letter: obj<S07LetterData>({
        message: nullable(message), char_count: int, photo_url: nullable(str),
    } satisfies Shape<S07LetterData>),
    s08_echo: obj<S08EchoData>({
        then: nullable(message), now: nullable(message), shared_keyword: nullable(str), years_apart: nullable(int),
        mode: oneOf('echo', 'first_week'),
    } satisfies Shape<S08EchoData>),
    s09_special: obj<S09SpecialData>({ stubs: arrayOf(stub) } satisfies Shape<S09SpecialData>),
    s10_you: (v, p, e) => ((v as { invite?: unknown } | null)?.invite === true ? s10Invite : s10Open)(v, p, e),
    s11_daisuki: obj<S11DaisukiData>({
        petals: arrayOf(obj<S11DaisukiData['petals'][number]>({ text: str, date: day })),
        final: nullable(message), variant: nullable(oneOf('joy')),
    } satisfies Shape<S11DaisukiData>),
    s12_sentence: sentence,
    s13_oyasumi: obj<S13OyasumiData>({ message: nullable(message), final: bool, graduated: bool } satisfies Shape<S13OyasumiData>),
};
const SLIDE_KEYS = Object.keys(SLIDE_DATA) as RecapSlideKey[];

const slide: Check = (v, p, e) => {
    const s = v as { key?: unknown; fallback?: unknown; data?: unknown } | null;
    if (typeof s !== 'object' || s === null) return fail(e, p, 'slide', v);
    const extra = Object.keys(s).filter((k) => !['key', 'fallback', 'data'].includes(k));
    if (extra.length) e.push(`${p}: unknown slide keys ${extra.join(',')}`);
    oneOf(...SLIDE_KEYS)(s.key, `${p}.key`, e);
    nullable(str)(s.fallback, `${p}.fallback`, e);
    const data = SLIDE_DATA[s.key as RecapSlideKey];
    if (data) data(s.data, `${p}.data(${String(s.key)})`, e);
};

const poster = obj<RecapPoster>({
    best_photo: nullable(message), sentence: nullable(sentence),
    numbers: arrayOf(obj<RecapPoster['numbers'][number]>({
        key: oneOf('nickname', 'oyasumi', 'photos', 'voice', 'daisuki'), count: int,
    })),
    stubs: arrayOf(stub), start_mid_recent: arrayOf(message), favorites_count: nullable(int),
    letters_count: nullable(int), avatar_changed: bool, avatar_old_url: nullable(str), avatar_new_url: nullable(str),
    years_together: nullable(int),
} satisfies Shape<RecapPoster>);

const payload = obj<RecapPayload>({
    year: int, phase: oneOf('partial', 'final'), tier: oneOf('full', 'standard', 'short', 'none'), member,
    slides: arrayOf(slide), poster: nullable(poster),
} satisfies Shape<RecapPayload>);

const TITLE_KEYS = ['morning', 'nickname', 'longest', 'voice', 'night', 'photos', 'first'].map((k) => `recap.titles.${k}`);
const overview = obj<RecapOverview>({
    year: int, phase: oneOf('partial', 'final'), christmas_open: bool,
    members: arrayOf(obj<RecapOverviewMember>({
        member_path: str, member_id: str, name: str, tier: oneOf('full', 'standard', 'short', 'none'), oshi: bool,
        title_key: nullable(oneOf(...TITLE_KEYS)),
    } satisfies Shape<RecapOverviewMember>)),
    opening: obj<RecapOverview['opening']>({
        star_order: arrayOf(str),
        first_message: nullable(obj<NonNullable<RecapOverview['opening']['first_message']>>({ member_id: str, ts: utc })),
        oyasumi_total: nullable(int),
    }),
} satisfies Shape<RecapOverview>);

const years = obj<RecapYears>({ years: arrayOf(int) } satisfies Shape<RecapYears>);

const validate = (check: Check, value: unknown, path: string): string[] => {
    const errors: string[] = [];
    check(value, path, errors);
    return errors;
};

const recaps = Object.entries(fixture.member_recaps as Record<string, unknown>);

beforeAll(async () => { await i18n.changeLanguage('ja'); });

describe('backend recap payloads match the frontend types', () => {
    it('holds a spread of real payloads (every slide key, fallbacks, tier none)', () => {
        const seen = new Set(recaps.flatMap(([, p]) => (p as RecapPayload).slides.map((s) => s.key)));
        expect([...seen].sort()).toEqual([...SLIDE_KEYS].sort());
        expect(recaps.map(([, p]) => (p as RecapPayload).tier)).toContain('none');
    });

    it.each(recaps)('member recap %s', (name, value) => {
        expect(validate(payload, value, name)).toEqual([]);
    });

    it('members overview', () => {
        expect(validate(overview, fixture.overview, 'overview')).toEqual([]);
    });

    it('years shelf', () => {
        expect(validate(years, fixture.years, 'years')).toEqual([]);
    });

    it('the share export built from each real payload carries at most two of her sentences', () => {
        const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);
        for (const [name, value] of recaps) {
            const recap = value as RecapPayload;
            if (recap.tier === 'none') continue;
            const model = buildShareModel(recap, defaultShareOptions(recap), 'ゆき', t, 'ja');
            const count = model.poster.sentences.reduce((n, s) => n + splitSentences(s).length, 0);
            expect(count, name).toBeLessThanOrEqual(MAX_SENTENCES);
        }
    });
});
