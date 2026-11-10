import { describe, it, expect } from 'vitest';
import en from '../../../i18n/locales/en.json';
import { CalendarDays, Gift, ImageIcon, Radio } from 'lucide-react';
import { HUB_CARDS, hubCardCount, hubCardCounts, hubCardLine, type HubCardCounts, type HubCardDef } from './hubCards';
import { hubPayload } from './__fixtures__';

const lookup = (dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);

const byId = Object.fromEntries(HUB_CARDS.map((c) => [c.id, c]));
const COUNTS: HubCardCounts = { album: 0, members: 3, favorites: 1, voices: 0, days: 0, gacha_left: null };

describe('hub card registry', () => {
    it('registers album, memoir, favorites, the year recap, then radio, gacha and calendar in order', () => {
        expect(HUB_CARDS.map((c) => c.id)).toEqual(['album', 'memoir', 'favorites', 'recap', 'radio', 'gacha', 'calendar']);
    });

    it('routes the page cards and leaves the recap to its action', () => {
        expect(byId.album).toMatchObject({ route: { page: 'album' }, countKey: 'album' });
        expect(byId.memoir).toMatchObject({ route: { page: 'memoir' }, countKey: 'members' });
        expect(byId.favorites).toMatchObject({ route: { page: 'favorites' }, countKey: 'favorites' });
        expect(byId.recap).toMatchObject({ action: 'recap' });
        expect(byId.recap.countKey).toBeUndefined();
    });

    it('routes the fun-wave cards with their icons and counts', () => {
        expect(byId.radio).toMatchObject({
            icon: Radio, titleKey: 'memories.home.radio', route: { page: 'radio' },
            countKey: 'voices', countLabelKey: 'memories.home.countVoices',
        });
        expect(byId.gacha).toMatchObject({
            icon: Gift, titleKey: 'memories.home.gacha', route: { page: 'gacha' },
            countKey: 'gacha_left', countLabelKey: 'memories.home.countGacha', zeroLabelKey: 'memories.home.gachaTomorrow',
        });
        expect(byId.calendar).toMatchObject({
            icon: CalendarDays, titleKey: 'memories.home.calendar', route: { page: 'calendar' },
            countKey: 'days', countLabelKey: 'memories.home.countDays',
        });
    });

    it('names only translated keys', () => {
        for (const card of HUB_CARDS) {
            expect(typeof lookup(card.titleKey), card.titleKey).toBe('string');
            if (card.countLabelKey) expect(typeof lookup(card.countLabelKey), card.countLabelKey).toBe('string');
            if (card.zeroLabelKey) expect(typeof lookup(card.zeroLabelKey), card.zeroLabelKey).toBe('string');
        }
    });

    it('gives a count only when it is above zero', () => {
        const { album } = byId;
        expect(hubCardCount(album, COUNTS)).toBeNull();
        expect(hubCardCount(album, { ...COUNTS, album: 12 })).toBe(12);
        expect(hubCardCount(album, null)).toBeNull();
        expect(hubCardCount(byId.recap, COUNTS)).toBeNull();
        expect(hubCardCount(byId.radio, { ...COUNTS, voices: 40 })).toBe(40);
        expect(hubCardCount(byId.calendar, { ...COUNTS, days: 400 })).toBe(400);
        expect(hubCardCount(byId.gacha, { ...COUNTS, gacha_left: 2 })).toBe(2);
        expect(hubCardCount(byId.gacha, { ...COUNTS, gacha_left: null })).toBeNull();
    });

    it('merges the top-level gacha_left into the hub counts', () => {
        const payload = hubPayload({ gacha_left: 1 });
        expect(hubCardCounts(payload)).toEqual({ ...payload.counts, gacha_left: 1 });
        expect(hubCardCounts(hubPayload({ gacha_left: null }))?.gacha_left).toBeNull();
        expect(hubCardCounts(null)).toBeNull();
    });

    it('draws the line: the count, the zero line (gacha) or nothing, never a 0', () => {
        expect(hubCardLine(byId.radio, { ...COUNTS, voices: 5 })).toEqual({ key: 'memories.home.countVoices', count: 5 });
        expect(hubCardLine(byId.radio, COUNTS)).toBeNull();
        expect(hubCardLine(byId.calendar, COUNTS)).toBeNull();
        expect(hubCardLine(byId.gacha, { ...COUNTS, gacha_left: 3 })).toEqual({ key: 'memories.home.countGacha', count: 3 });
        // All of today's pulls used: 「また明日」, never 0 and never a hidden card.
        expect(hubCardLine(byId.gacha, { ...COUNTS, gacha_left: 0 })).toEqual({ key: 'memories.home.gachaTomorrow' });
        // The store failed: no count at all.
        expect(hubCardLine(byId.gacha, { ...COUNTS, gacha_left: null })).toBeNull();
        expect(hubCardLine(byId.gacha, null)).toBeNull();
        expect(hubCardLine(byId.recap, COUNTS)).toBeNull();
    });

    it('ties a count key to its label key in the type', () => {
        // @ts-expect-error a count without its label line would silently show nothing
        const missingLabel: HubCardDef = { id: 'x', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, countKey: 'album' };
        // @ts-expect-error a label line without a count has nothing to show
        const missingCount: HubCardDef = { id: 'y', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, countLabelKey: 'memories.home.countAlbum' };
        // @ts-expect-error a zero line needs a count to be zero
        const zeroOnly: HubCardDef = { id: 'z', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, zeroLabelKey: 'memories.home.gachaTomorrow' };
        expect([missingLabel, missingCount, zeroOnly]).toHaveLength(3);
    });
});
