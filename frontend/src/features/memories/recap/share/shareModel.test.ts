import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../../../../i18n';
import {
    buildShareModel, buildTimeline, defaultShareOptions, displaySentence, GIF_MS, MAX_SENTENCES, NICKNAME_MASK, sceneAt,
    sentenceCandidates, shareSeed, splitSentences, timelineMs, VIDEO_MS, type SceneKind,
} from './shareModel';
import {
    clockData, daisukiData, greetingsData, letterData, message, payload, s02, s12, specialData,
} from '../__fixtures__/payload';
import type { RecapPayload, RecapSlide } from '../api';

const t = (key: string, params?: Record<string, string | number>) => i18n.t(key, params);

const full = (over: Partial<RecapPayload> = {}): RecapPayload => payload({
    slides: [
        { ...s02, data: { ...(s02.data as object), last: message(8, '%%%、また明日ね') } } as RecapSlide,
        { key: 's03_clock', fallback: null, data: clockData() },
        { key: 's04_greetings', fallback: null, data: greetingsData() },
        { key: 's07_letter', fallback: null, data: letterData() },
        { key: 's09_special', fallback: null, data: specialData() },
        { key: 's11_daisuki', fallback: null, data: daisukiData() },
        s12,
    ],
    ...over,
});

beforeAll(async () => { await i18n.changeLanguage('ja'); });

describe('sentence candidates', () => {
    it('lists her sentences in rule order without duplicates', () => {
        const c = sentenceCandidates(full());
        expect(c.map((x) => x.source)).toEqual([
            's12', 's02_last', 's02_first', 's02_fragment', 's11_petal', 's11_petal', 's11_petal', 's07',
        ]);
        expect(c[0].raw).toBe('一緒に歩いてくれて、ありがとう。');
        // The letter gives only its first line.
        expect(c[c.length - 1].raw).toBe('%%%へ');
    });

    it('prefills s12 and s02.last', () => {
        const ids = defaultShareOptions(full()).sentences;
        expect(ids).toEqual(['s12:0', 's02_last:0']);
    });

    it('falls back to the next candidates when s02.last is missing', () => {
        expect(defaultShareOptions(payload()).sentences).toEqual(['s12:0', 's02_first:0']);
    });
});

describe('one sentence per candidate (spec §9.5: at most two of her sentences)', () => {
    it('splits at the backend\'s boundaries (。！？!? and newlines), keeping the end marks', () => {
        expect(splitSentences('おはよう。元気？うん！good!ok?\n次の行')).toEqual(['おはよう。', '元気？', 'うん！', 'good!', 'ok?', '次の行']);
        expect(splitSentences('すごい！！本当？')).toEqual(['すごい！！', '本当？']);
        expect(splitSentences('  。\n\n')).toEqual([]);
        expect(splitSentences('%%%、また明日ね')).toEqual(['%%%、また明日ね']);
    });

    const multi = (): RecapPayload => payload({
        slides: [
            {
                ...s02,
                data: {
                    ...(s02.data as object),
                    first: message(2, 'はじめまして。%%%、よろしくね！これからもよろしく'),
                    last: message(8, '今日も楽しかった。%%%、また明日ね！おやすみ🌙\n明日も早いよ'),
                },
            } as RecapSlide,
            { key: 's07_letter', fallback: null, data: letterData({ message: message(30, 'いつもありがとう。今年も一緒に歩こうね\n二行目です') }) },
            { key: 's11_daisuki', fallback: null, data: daisukiData() },
            s12,
        ],
    });

    it('takes the nickname sentence of s02 and the first sentence of the letter', () => {
        const c = sentenceCandidates(multi());
        const by = (source: string) => c.find((x) => x.source === source)?.raw;
        expect(by('s02_last')).toBe('%%%、また明日ね！');
        expect(by('s02_first')).toBe('%%%、よろしくね！');
        expect(by('s07')).toBe('いつもありがとう。');
        for (const x of c) expect(splitSentences(x.raw)).toEqual([x.raw]);
    });

    it('takes the 大好き sentence in daisuki mode', () => {
        const recap = payload({
            slides: [{
                ...s02,
                data: { ...(s02.data as object), mode: 'daisuki', first: message(2, '今日はライブ。みんな大好きだよ！また来てね'), last: null, fragments: [] },
            } as RecapSlide],
        });
        expect(sentenceCandidates(recap).find((x) => x.source === 's02_first')?.raw).toBe('みんな大好きだよ！');
    });

    it('never puts more than two sentences on the export, with the default picks or any picks', () => {
        const recap = multi();
        const count = (sentences: string[]) => sentences.reduce((n, x) => n + splitSentences(x).length, 0);
        const byDefault = buildShareModel(recap, defaultShareOptions(recap), 'ゆき', t, 'ja');
        expect(byDefault.poster.sentences).toEqual(['一緒に歩いてくれて、ありがとう。', `${NICKNAME_MASK}、また明日ね！`]);
        expect(count(byDefault.poster.sentences)).toBeLessThanOrEqual(MAX_SENTENCES);
        const everything = sentenceCandidates(recap).map((c) => c.id);
        for (let i = 0; i < everything.length; i += 1) {
            const picks = [everything[i], everything[(i + 1) % everything.length]];
            const m = buildShareModel(recap, { ...defaultShareOptions(recap), sentences: picks, nickname: true }, 'ゆき', t, 'ja');
            expect(count(m.poster.sentences)).toBe(2);
        }
        const all = buildShareModel(recap, { ...defaultShareOptions(recap), sentences: everything }, 'ゆき', t, 'ja');
        expect(count(all.poster.sentences)).toBe(MAX_SENTENCES);
    });
});

describe('defaults', () => {
    it('turns every identity toggle off and the footer on', () => {
        const o = defaultShareOptions(full());
        expect(o).toMatchObject({ style: 'collage', nickname: false, avatar: false, years: false, footer: true });
    });

    it('masks the nickname unless the fan opted in', () => {
        expect(displaySentence('%%%、また明日ね', null)).toBe(`${NICKNAME_MASK}、また明日ね`);
        expect(displaySentence('％％％、おやすみ', 'ゆき')).toBe('ゆき、おやすみ');
    });
});

describe('buildShareModel', () => {
    it('masks the nickname and leaves out the "with" line, years and the anniversary by default', () => {
        const recap = full();
        const m = buildShareModel(recap, defaultShareOptions(recap), 'ゆき', t, 'ja');
        expect(m.poster.sentences).toEqual(['一緒に歩いてくれて、ありがとう。', `${NICKNAME_MASK}、また明日ね`]);
        expect(m.poster.withLine).toBeNull();
        expect(m.poster.years).toBeNull();
        expect(m.poster.avatar).toBe(false);
        expect(m.poster.footer).toBe('SakaDesk');
        expect(JSON.stringify(m)).not.toContain('ゆき');
        expect(m.stubs?.items.map((s) => s.label)).toEqual(['彼女の誕生日', '新しい年の、はじまり']);
    });

    it('shows identity only when opted in', () => {
        const recap = full();
        const m = buildShareModel(recap, { ...defaultShareOptions(recap), nickname: true, years: true, avatar: true }, 'ゆき', t, 'ja');
        expect(m.poster.sentences[1]).toBe('ゆき、また明日ね');
        expect(m.poster.withLine).toBe('with ゆき');
        expect(m.poster.years).toBe('メッセージを受け取って、3年目。');
        expect(m.poster.avatar).toBe(true);
        expect(m.stubs?.items).toHaveLength(3);
    });

    it('carries one number per scene and stub times, never stub words', () => {
        const recap = full();
        const m = buildShareModel(recap, defaultShareOptions(recap), 'ゆき', t, 'ja');
        expect(m.clock?.value).toBe('22時台');
        expect(m.greeting).toEqual({ word: 'おやすみ', line: '180回の「おやすみ」で、一日を締めくくった。' });
        expect(m.photos.line).toBe('96枚の景色');
        expect(m.stubs?.items[0].value).toBe('0:00:07');
        expect(JSON.stringify(m.stubs)).not.toContain('ありがとう');
    });

    it('shows the greeting count only from 2, like s04', () => {
        const withCount = (count: number | null) => {
            const recap = full();
            recap.slides = recap.slides.map((s) => (s.key === 's04_greetings' ? { ...s, data: greetingsData({ oyasumi_count: count }) } : s)) as RecapSlide[];
            return buildShareModel(recap, defaultShareOptions(recap), 'ゆき', t, 'ja').greeting;
        };
        expect(withCount(1)).toBeNull();
        expect(withCount(null)).toBeNull();
        expect(withCount(2)).toEqual({ word: 'おやすみ', line: '2回の「おやすみ」で、一日を締めくくった。' });
    });

    it('drops the footer and the clock number when asked or flat', () => {
        const recap = full();
        recap.slides = recap.slides.map((s) => (s.key === 's03_clock' ? { ...s, data: clockData({ band: 'night' }) } : s)) as RecapSlide[];
        const m = buildShareModel(recap, { ...defaultShareOptions(recap), footer: false }, 'ゆき', t, 'ja');
        expect(m.poster.footer).toBeNull();
        expect(m.clock?.value).toBeNull();
        expect(m.clock?.glow).toBe(false);
    });

    it('uses a stable seed', () => {
        expect(shareSeed('58', 2026)).toBe(shareSeed('58', 2026));
        expect(shareSeed('58', 2026)).not.toBe(shareSeed('12', 2026));
    });
});

describe('timeline', () => {
    const all = new Set<SceneKind>(['clock', 'photos', 'greeting', 'stubs']);

    it('follows the spec scenes for the video', () => {
        const s = buildTimeline(all, 'video');
        expect(s.map((x) => [x.kind, x.startMs, x.endMs])).toEqual([
            ['title', 0, 1500], ['clock', 1500, 3500], ['photos', 3500, 6000],
            ['greeting', 6000, 8000], ['stubs', 8000, 10000], ['poster', 10000, 12000],
        ]);
        expect(timelineMs(s)).toBe(VIDEO_MS);
    });

    it('drops the stubs from the GIF and fits 8 s', () => {
        const s = buildTimeline(all, 'gif');
        expect(s.map((x) => x.kind)).toEqual(['title', 'clock', 'photos', 'greeting', 'poster']);
        expect(timelineMs(s)).toBe(GIF_MS);
    });

    it('gives a missing scene\'s time to the poster', () => {
        const s = buildTimeline(new Set<SceneKind>(['clock']), 'video');
        expect(s.map((x) => x.kind)).toEqual(['title', 'clock', 'poster']);
        expect(timelineMs(s)).toBe(VIDEO_MS);
        expect(sceneAt(s, 99999).kind).toBe('poster');
    });
});
