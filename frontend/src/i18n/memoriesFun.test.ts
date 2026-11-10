import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every Memories fun-wave string (F7; every later fun task appends its keys). */
export const MEMORIES_FUN_KEYS: string[] = [
    // F7: the hub cards, the gacha card's spent line and the memoir's 24h tab
    'memories.home.radio', 'memories.home.gacha', 'memories.home.calendar',
    'memories.home.countVoices', 'memories.home.countGacha', 'memories.home.countDays', 'memories.home.gachaTomorrow',
    'memories.memoir.tabDay24',
];

/** Fun keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
export const MEMORIES_FUN_EN_PLURALS: string[] = [
    'memories.home.countVoices', 'memories.home.countDays',
];

/** Recursive dotted lookup (any depth). */
const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('memories fun strings', () => {
    it.each(Object.entries(locales))('%s has every fun key as a non-empty string', (_code, data) => {
        for (const dotted of MEMORIES_FUN_KEYS) {
            const value = lookup(data, dotted);
            expect(typeof value, dotted).toBe('string');
            expect(String(value).trim(), dotted).not.toBe('');
        }
    });

    it('English has the plural form of every counted fun key', () => {
        for (const dotted of MEMORIES_FUN_EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });

    it('lists every key once', () => {
        expect(new Set(MEMORIES_FUN_KEYS).size).toBe(MEMORIES_FUN_KEYS.length);
    });

    it.each(Object.entries(locales))('%s never prints a number in the gacha spent line', (_code, data) => {
        expect(String(lookup(data, 'memories.home.gachaTomorrow'))).not.toMatch(/\d|\{\{/);
    });

    it('uses the Japanese reference copy', () => {
        const expected: Record<string, string> = {
            'memories.home.radio': 'ボイスラジオ',
            'memories.home.gacha': '思い出ガチャ',
            'memories.home.calendar': 'カレンダー',
            'memories.home.countVoices': '{{count, number}} 件のボイス',
            'memories.home.countGacha': '今日はあと {{count, number}} 回',
            'memories.home.countDays': '{{count, number}} 日分',
            'memories.home.gachaTomorrow': 'また明日',
            'memories.memoir.tabDay24': '彼女の24時間',
        };
        for (const [key, text] of Object.entries(expected)) expect(lookup(ja, key), key).toBe(text);
    });
});
