import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import yue from './locales/yue.json';
import { NICKNAME_MASK } from '../features/memories/shared/nicknameMask';

const locales = { en, ja, 'zh-CN': zhCN, 'zh-TW': zhTW, yue } as const;

/** Every Memories core-wave string (C7; every later core task appends its keys). */
export const MEMORIES_CORE_KEYS: string[] = [
    'memories.common.back', 'memories.common.retry', 'memories.common.loadError', 'memories.common.jumpToChat',
    'memories.common.all', 'memories.common.nicknameMasked',
    'memories.onThisDay.title', 'memories.album.title', 'memories.memoir.title', 'memories.favorites.title',
];

/** Core keys with an English plural (`<key>_other` in en.json only, the repo's pattern). */
export const MEMORIES_CORE_EN_PLURALS: string[] = [];

/** Recursive dotted lookup (any depth). */
const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('memories core strings', () => {
    it.each(Object.entries(locales))('%s has every core key as a non-empty string', (_code, data) => {
        for (const dotted of MEMORIES_CORE_KEYS) {
            const value = lookup(data, dotted);
            expect(typeof value, dotted).toBe('string');
            expect(String(value).trim(), dotted).not.toBe('');
        }
    });

    it('English has the plural form of every counted core key', () => {
        for (const dotted of MEMORIES_CORE_EN_PLURALS) expect(lookup(en, `${dotted}_other`), dotted).toBeTruthy();
    });

    it('lists every key once', () => {
        expect(new Set(MEMORIES_CORE_KEYS).size).toBe(MEMORIES_CORE_KEYS.length);
    });

    it.each(Object.entries(locales))('%s masks the nickname exactly as the share export does', (_code, data) => {
        expect(`『${String(lookup(data, 'memories.common.nicknameMasked'))}』`).toBe(NICKNAME_MASK);
    });

    it('uses the Japanese reference copy', () => {
        expect(lookup(ja, 'memories.common.back')).toBe('戻る');
        expect(lookup(ja, 'memories.common.retry')).toBe('もう一度');
        expect(lookup(ja, 'memories.common.loadError')).toBe('読み込めませんでした');
        expect(lookup(ja, 'memories.common.jumpToChat')).toBe('トークで見る');
        expect(lookup(ja, 'memories.common.all')).toBe('全員');
        expect(lookup(ja, 'memories.common.nicknameMasked')).toBe('＊＊＊');
    });
});
