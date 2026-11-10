/**
 * The share export's content model (spec §9.5): pure functions from the recap payload and the
 * fan's choices to the resolved strings and scenes that `ShareRenderer` draws.
 *
 * This is the only Memories output meant to leave the machine, so the model carries the
 * obfuscation rules:
 * - **Identity is opt-in.** The nickname, the fan's own avatar and "N年目" are off by default.
 *   With the nickname off every `%%%` in her words becomes {@link NICKNAME_MASK} and no "with …"
 *   line is drawn. The anniversary stub names the fan's subscription day, so it is dropped unless
 *   "N年目" is on.
 * - **Her words: at most two sentences**, prefilled from s12 and s02's latest nickname sentence,
 *   swappable from {@link sentenceCandidates}. Every candidate is exactly one sentence
 *   ({@link splitSentences}), so two picks can never carry a third sentence.
 * - **Photos never appear raw.** The model holds no photo at all; `sharePhotos.ts` frosts them
 *   before the renderer sees them.
 * - **One number per scene.** Times and dates on the stubs are metadata.
 */
import { replaceNickname } from '../../../messages/utils/nickname';
import type { RecapPayload, RecapSlide, S02NameData, S03ClockData, S04GreetingsData, S07LetterData, S09SpecialData, S11DaisukiData, S12SentenceData } from '../api';
import { posterYears } from '../posterCopy';
import { formatMessageDate, formatSecondsOfDay, s04Copy, s09StubCopy, type CopyLine } from '../recapCopy';

/** What stands in for the fan's nickname when the nickname toggle is off. */
export const NICKNAME_MASK = '『＊＊＊』';
/** The export carries at most this many of her sentences (user decision, spec §9.5). */
export const MAX_SENTENCES = 2;
/** A candidate taken from a long letter keeps at most this many characters (its first sentence). */
export const LETTER_EXCERPT_CHARS = 60;

export type ShareStyle = 'collage' | 'colour';

export interface ShareOptions {
    style: ShareStyle;
    /** Ids of the chosen {@link SentenceCandidate}s, in display order (at most {@link MAX_SENTENCES}). */
    sentences: string[];
    nickname: boolean;
    avatar: boolean;
    years: boolean;
    footer: boolean;
}

export type SentenceSource = 's12' | 's02_last' | 's02_first' | 's02_fragment' | 's11_petal' | 's07';

/** One of her sentences the fan may put on the export. `raw` keeps the `%%%` placeholder. */
export interface SentenceCandidate {
    id: string;
    source: SentenceSource;
    raw: string;
}

/** A slide's data (callers cast it to the slide's data type), or null when the slide is absent. */
function slideData(recap: RecapPayload, key: RecapSlide['key']): unknown {
    return recap.slides.find((s) => s.key === key)?.data ?? null;
}

/**
 * One sentence: a run of text up to its end mark. Mirrors the backend's `_SENTENCE_RE`
 * (`[。！？!?\n]+`, `backend/services/memories/recap.py`): the same boundaries, so a backend
 * sentence (s12, the s02 fragments, the s11 petals) is one sentence here too. The end marks stay
 * on the sentence for display; a newline is a boundary but is not kept.
 */
const SENTENCE = /[^。！？!?\n]+[。！？!?]*/g;

/** Her text split into sentences (trimmed, empty ones dropped), with the backend's boundaries. */
export function splitSentences(text: string): string[] {
    return (text.match(SENTENCE) ?? []).map((s) => s.trim()).filter((s) => s.replace(/[。！？!?]/g, '').trim().length > 0);
}

/** The first sentence of `text` that matches `pattern`, else its first sentence (null when empty). */
function sentenceOf(text: string | null | undefined, pattern?: RegExp): string | null {
    const sentences = splitSentences(text ?? '');
    return sentences.find((s) => pattern?.test(s)) ?? sentences[0] ?? null;
}

/** The sentence s02 is about: the one with the nickname (`%%%` / `％％％`), or 大好き in daisuki mode. */
const S02_PATTERN: Record<S02NameData['mode'], RegExp> = {
    nickname: /%%%|％％％/,
    daisuki: /大好き|だいすき/,
};

function excerpt(sentence: string | null): string | null {
    if (sentence === null) return null;
    const chars = Array.from(sentence);
    return chars.length > LETTER_EXCERPT_CHARS ? `${chars.slice(0, LETTER_EXCERPT_CHARS).join('')}…` : sentence;
}

/**
 * Her sentences the export may carry, in rule order: the one sentence (s12), the latest and the
 * first nickname sentence (s02: the sentence of the message that holds the nickname, or 大好き in
 * daisuki mode), the s02 fragments, the 大好き / ありがとう petals (s11) and the first sentence of
 * her longest letter (s07). Each candidate is one sentence; duplicates (the same text) are kept once.
 */
export function sentenceCandidates(recap: RecapPayload): SentenceCandidate[] {
    const out: SentenceCandidate[] = [];
    const seen = new Set<string>();
    const add = (source: SentenceSource, raw: string | null | undefined, index = 0) => {
        // Already one sentence for every source; the split is the guarantee, not a reshaping.
        const text = sentenceOf(raw);
        if (!text || seen.has(text)) return;
        seen.add(text);
        out.push({ id: `${source}:${index}`, source, raw: text });
    };
    const s12 = slideData(recap, 's12_sentence') as S12SentenceData | null;
    add('s12', s12?.sentence ?? recap.poster?.sentence?.sentence);
    const s02 = slideData(recap, 's02_name') as S02NameData | null;
    const s02Pattern = s02 ? S02_PATTERN[s02.mode] : undefined;
    add('s02_last', sentenceOf(s02?.last?.text, s02Pattern));
    add('s02_first', sentenceOf(s02?.first?.text, s02Pattern));
    s02?.fragments.forEach((f, i) => add('s02_fragment', f, i));
    const s11 = slideData(recap, 's11_daisuki') as S11DaisukiData | null;
    s11?.petals.forEach((p, i) => add('s11_petal', p.text, i));
    const s07 = slideData(recap, 's07_letter') as S07LetterData | null;
    add('s07', excerpt(sentenceOf(s07?.message?.text)));
    return out;
}

/** The prefilled pair: s12 and s02's latest sentence when present, then the next candidates in order. */
export function defaultSentenceIds(candidates: SentenceCandidate[]): string[] {
    const preferred = candidates.filter((c) => c.source === 's12' || c.source === 's02_last');
    const rest = candidates.filter((c) => !preferred.includes(c));
    return [...preferred, ...rest].slice(0, MAX_SENTENCES).map((c) => c.id);
}

/** The export's defaults: collage, the prefilled sentences, every identity toggle off, the footer on. */
export function defaultShareOptions(recap: RecapPayload): ShareOptions {
    return {
        style: 'collage',
        sentences: defaultSentenceIds(sentenceCandidates(recap)),
        nickname: false,
        avatar: false,
        years: false,
        footer: true,
    };
}

/** Her text as the export shows it: the nickname when the fan opted in, else {@link NICKNAME_MASK}. */
export function displaySentence(raw: string, nickname: string | null): string {
    return replaceNickname(raw, nickname ?? NICKNAME_MASK);
}

/** Whether the "N年目" toggle can be offered (the poster's rule: from the second year). */
export function yearsAvailable(recap: RecapPayload): boolean {
    return posterYears(recap.member.years_together) !== null;
}

// ---------------------------------------------------------------------------------------------
// Scenes

export type SceneKind = 'title' | 'clock' | 'photos' | 'greeting' | 'stubs' | 'poster';
export type ShareFormat = 'gif' | 'video';

export interface Scene {
    kind: SceneKind;
    startMs: number;
    endMs: number;
}

/** Nominal scene lengths of the video (spec §9.5: 0–1.5, 1.5–3.5, 3.5–6, 6–8, 8–10, 10–12 s). */
export const SCENE_MS: Record<SceneKind, number> = {
    title: 1500, clock: 2000, photos: 2500, greeting: 2000, stubs: 2000, poster: 2000,
};
const ORDER: SceneKind[] = ['title', 'clock', 'photos', 'greeting', 'stubs', 'poster'];
/** The video's length. */
export const VIDEO_MS = 12000;
/** The GIF's length: the video without its stub scene (10 s nominal), played at 0.8× time. */
export const GIF_MS = 8000;
const GIF_NOMINAL_MS = VIDEO_MS - SCENE_MS.stubs;

/**
 * The scenes of one export. The GIF drops the stub scene and compresses the remaining 10 s into
 * 8 s. A scene without data is left out and its time goes to the poster, so the length stays
 * fixed. The title and the poster are always present.
 */
export function buildTimeline(available: ReadonlySet<SceneKind>, format: ShareFormat): Scene[] {
    const nominalTotal = format === 'gif' ? GIF_NOMINAL_MS : VIDEO_MS;
    const factor = (format === 'gif' ? GIF_MS : VIDEO_MS) / nominalTotal;
    const kinds = ORDER.filter((k) => k === 'title' || k === 'poster' || (available.has(k) && !(format === 'gif' && k === 'stubs')));
    const used = kinds.reduce((n, k) => n + SCENE_MS[k], 0);
    const scenes: Scene[] = [];
    let at = 0;
    for (const kind of kinds) {
        const nominal = SCENE_MS[kind] + (kind === 'poster' ? nominalTotal - used : 0);
        const length = Math.round(nominal * factor);
        scenes.push({ kind, startMs: at, endMs: at + length });
        at += length;
    }
    return scenes;
}

/** Total length of a timeline. */
export function timelineMs(scenes: Scene[]): number {
    return scenes.length ? scenes[scenes.length - 1].endMs : 0;
}

/** The scene shown at `tMs` (the last one past the end). */
export function sceneAt(scenes: Scene[], tMs: number): Scene {
    return scenes.find((s) => tMs >= s.startMs && tMs < s.endMs) ?? scenes[scenes.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Resolved content

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface ShareClock {
    stars: S03ClockData['stars'];
    peakHour: number;
    glow: boolean;
    label: string;
    /** The scene's one number ("21時台"), or null on a flat day. */
    value: string | null;
}

export interface ShareStub {
    label: string;
    /** A clock with seconds ("0:00:07") or a date; never her words. */
    value: string;
}

/** Everything the renderer draws, with every string already translated. */
export interface ShareModel {
    year: number;
    /** Seed of the collage layout (same recap → same picture). */
    seed: number;
    style: ShareStyle;
    title: { year: string; member: string; tagline: string };
    clock: ShareClock | null;
    photos: { label: string; line: string | null };
    greeting: { word: string; line: string } | null;
    stubs: { label: string; items: ShareStub[] } | null;
    poster: {
        sentences: string[];
        withLine: string | null;
        years: string | null;
        footer: string | null;
        avatar: boolean;
    };
}

/** A stable 32-bit seed from the member id and year. */
export function shareSeed(memberId: string, year: number): number {
    let h = 2166136261 ^ year;
    for (const ch of `${memberId}:${year}`) {
        h ^= ch.codePointAt(0) as number;
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function tr(t: Translate, line: CopyLine): string {
    return t(line.key, line.params);
}

/**
 * Resolves the model. `nickname` is the fan's resolved nickname; it reaches the export only when
 * `options.nickname` is on.
 */
export function buildShareModel(
    recap: RecapPayload, options: ShareOptions, nickname: string, t: Translate, lang: string,
): ShareModel {
    const shownNickname = options.nickname && nickname ? nickname : null;
    const candidates = sentenceCandidates(recap);
    const sentences = options.sentences
        .map((id) => candidates.find((c) => c.id === id))
        .filter((c): c is SentenceCandidate => c !== undefined)
        .slice(0, MAX_SENTENCES)
        .map((c) => displaySentence(c.raw, shownNickname));

    const clockData = slideData(recap, 's03_clock') as S03ClockData | null;
    const flat = clockData?.band !== undefined;
    const clock: ShareClock | null = clockData && clockData.stars.length > 0
        ? {
            stars: clockData.stars,
            peakHour: clockData.peak_hour,
            glow: !flat,
            label: t(flat ? 'recap.share.clockFlat' : 'recap.share.clockLabel'),
            value: flat ? null : t('recap.share.clockHour', { hour: clockData.peak_hour }),
        }
        : null;

    const photoCount = recap.poster?.numbers.find((n) => n.key === 'photos')?.count;
    const photos = {
        label: t('recap.share.photosLabel'),
        // A plain count: the poster's "showed you" phrasing would read as addressed to the fan.
        line: photoCount && photoCount > 0 ? t('recap.share.photosCount', { count: photoCount }) : null,
    };

    // The greeting scene is its count, so it follows s04's count rule (shown from 2, never "1回").
    const s04 = recap.slides.find((s) => s.key === 's04_greetings');
    const g = (s04?.data ?? null) as S04GreetingsData | null;
    const greetingCount = g ? s04Copy(g, s04?.fallback ?? null).count : null;
    const greeting = g && greetingCount
        ? { word: t(`recap.share.greeting.${g.variant}`), line: tr(t, greetingCount) }
        : null;

    const special = slideData(recap, 's09_special') as S09SpecialData | null;
    const stubItems: ShareStub[] = [];
    for (const stub of special?.stubs ?? recap.poster?.stubs ?? []) {
        // The anniversary is the fan's subscription day: identity, so only with "N年目" on.
        if (stub.sealed || !stub.message || (stub.kind === 'anniversary' && !options.years)) continue;
        const value = stub.seconds_after_midnight !== null
            ? formatSecondsOfDay(stub.seconds_after_midnight)
            : formatMessageDate(stub.message.ts, lang);
        if (value) stubItems.push({ label: tr(t, s09StubCopy(stub).label), value });
    }

    const years = options.years ? posterYears(recap.member.years_together) : null;
    return {
        year: recap.year,
        seed: shareSeed(recap.member.id, recap.year),
        style: options.style,
        title: { year: String(recap.year), member: recap.member.name, tagline: t('recap.share.tagline') },
        clock,
        photos,
        greeting,
        stubs: stubItems.length ? { label: t('recap.share.stubsLabel'), items: stubItems } : null,
        poster: {
            sentences,
            withLine: shownNickname ? t('recap.poster.with', { nickname: shownNickname }) : null,
            years: years ? tr(t, years) : null,
            footer: options.footer ? t('recap.share.footer') : null,
            avatar: options.avatar,
        },
    };
}
