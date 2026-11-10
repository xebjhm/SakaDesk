import { describe, it, expect } from 'vitest';
import en from '../../../i18n/locales/en.json';
import { ImageIcon } from 'lucide-react';
import { HUB_CARDS, hubCardCount, type HubCardDef } from './hubCards';

const lookup = (dotted: string): unknown =>
    dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);

describe('hub card registry', () => {
    it('registers album, memoir, favorites and the year recap in order', () => {
        expect(HUB_CARDS.map((c) => c.id)).toEqual(['album', 'memoir', 'favorites', 'recap']);
    });

    it('routes the page cards and leaves the recap to its action', () => {
        const byId = Object.fromEntries(HUB_CARDS.map((c) => [c.id, c]));
        expect(byId.album).toMatchObject({ route: { page: 'album' }, countKey: 'album' });
        expect(byId.memoir).toMatchObject({ route: { page: 'memoir' }, countKey: 'members' });
        expect(byId.favorites).toMatchObject({ route: { page: 'favorites' }, countKey: 'favorites' });
        expect(byId.recap).toMatchObject({ action: 'recap' });
        expect(byId.recap.countKey).toBeUndefined();
    });

    it('names only translated keys', () => {
        for (const card of HUB_CARDS) {
            expect(typeof lookup(card.titleKey), card.titleKey).toBe('string');
            if (card.countLabelKey) expect(typeof lookup(card.countLabelKey), card.countLabelKey).toBe('string');
        }
    });

    it('gives a count only when it is above zero', () => {
        const [album] = HUB_CARDS;
        const counts = { album: 0, members: 3, favorites: 1 };
        expect(hubCardCount(album, counts)).toBeNull();
        expect(hubCardCount(album, { ...counts, album: 12 })).toBe(12);
        expect(hubCardCount(album, null)).toBeNull();
        expect(hubCardCount(HUB_CARDS[3], counts)).toBeNull();
    });

    it('ties a count key to its label key in the type', () => {
        // @ts-expect-error a count without its label line would silently show nothing
        const missingLabel: HubCardDef = { id: 'x', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, countKey: 'album' };
        // @ts-expect-error a label line without a count has nothing to show
        const missingCount: HubCardDef = { id: 'y', icon: ImageIcon, titleKey: 'memories.home.album', route: { page: 'album' }, countLabelKey: 'memories.home.countAlbum' };
        expect([missingLabel, missingCount]).toHaveLength(2);
    });
});
