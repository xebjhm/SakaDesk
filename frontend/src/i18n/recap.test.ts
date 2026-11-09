import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every recap string (R4; later recap tasks append). */
const RECAP_KEYS: readonly string[] = [
    'recap.entry.heading', 'recap.entry.year', 'recap.entry.olderYear', 'recap.entry.newerYear', 'recap.entry.back',
    'recap.entry.choose', 'recap.entry.partial', 'recap.entry.loadFailed', 'recap.entry.oshi',
    'recap.entry.emptyTitle', 'recap.entry.emptyBody',
    'recap.titles.morning', 'recap.titles.nickname', 'recap.titles.longest', 'recap.titles.voice',
    'recap.titles.night', 'recap.titles.photos', 'recap.titles.steady', 'recap.titles.first',
    'recap.player.label', 'recap.player.prev', 'recap.player.next', 'recap.player.pause', 'recap.player.play',
    'recap.player.progress', 'recap.youFallback',
    'recap.s01.title', 'recap.s01.sub', 'recap.s01.joined', 'recap.s01.notification',
    'recap.s02.title', 'recap.s02.count', 'recap.s02.single', 'recap.s02.daisuki', 'recap.s02.daisukiWord', 'recap.s02.daisukiTitle',
    'recap.s12.title',
    'recap.s13.title', 'recap.s13.partialTitle', 'recap.s13.partialNote', 'recap.s13.narration',
    'recap.s13.graduatedTitle', 'recap.s13.graduatedLine', 'recap.s13.lastTextTitle', 'recap.s13.lastTextPartialTitle', 'recap.s13.lastTextPartialNote',
];

/** Recap keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
const EN_PLURALS: readonly string[] = ['recap.s02.count', 'recap.s02.daisuki'];

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('recap strings', () => {
    it.each(Object.entries(locales))('%s has every recap key', (_code, data) => {
        for (const dotted of RECAP_KEYS) expect(lookup(data, dotted), dotted).toBeTruthy();
    });

    it('English has the plural form of every counted recap key', () => {
        for (const dotted of EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });

    it('year copy takes the year as a parameter, never a hard-coded year', () => {
        for (const data of Object.values(locales)) {
            expect(JSON.stringify(lookup(data, 'recap'))).not.toMatch(/20\d\d/);
        }
    });
});
