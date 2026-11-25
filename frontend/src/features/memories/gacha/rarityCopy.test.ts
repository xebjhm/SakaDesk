import { describe, it, expect } from 'vitest';
import en from '../../../i18n/locales/en.json';
import ja from '../../../i18n/locales/ja.json';
import { GACHA_RARITIES, GACHA_REASONS } from '../types';
import { RARITY_FILL, rarityKey, reasonKey } from './rarityCopy';

const lookup = (data: unknown, dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], data);

describe('rarityCopy', () => {
    it.each(GACHA_REASONS)('the %s reason has copy in every reference locale', (reason) => {
        const key = reasonKey(reason);
        expect(key).toMatch(/^memories\.gacha\.reason\./);
        expect(typeof lookup(ja, key)).toBe('string');
        expect(typeof lookup(en, key)).toBe('string');
    });

    it('maps the reasons to distinct keys', () => {
        expect(new Set(GACHA_REASONS.map(reasonKey)).size).toBe(GACHA_REASONS.length);
    });

    it.each(GACHA_RARITIES)('the %s rarity has a label and a literal fill class', (rarity) => {
        expect(typeof lookup(ja, rarityKey(rarity))).toBe('string');
        expect(RARITY_FILL[rarity]).toBe(`bg-memories-rarity-${rarity}`);
    });

    it('uses the Japanese reference copy for the fan-anniversary reason', () => {
        expect(lookup(ja, reasonKey('sub_anniversary'))).toBe('あなたの記念日に届いたメッセージ');
        expect(lookup(ja, reasonKey('last_message'))).toBe('最後のメッセージ');
    });
});
