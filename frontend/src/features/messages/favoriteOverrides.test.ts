import { describe, it, expect } from 'vitest';
import type { Message } from '../../types';
import { EMPTY_FAVORITES, applyFavoriteOverrides, pruneFavoriteOverrides, setFavoriteIn, withFavorite } from './favoriteOverrides';

const m = (id: number, is_favorite = false): Message => ({ id, timestamp: '2024-01-01T00:00:00Z', type: 'text', content: 'x', is_favorite });

describe('favoriteOverrides', () => {
    it('withFavorite returns a new map and never mutates the old one', () => {
        const a = withFavorite(EMPTY_FAVORITES, 1, true);
        expect(a.get(1)).toBe(true);
        expect(EMPTY_FAVORITES.size).toBe(0);
    });

    it('applyFavoriteOverrides keeps the array identity when there is nothing to apply', () => {
        const list = [m(1), m(2)];
        expect(applyFavoriteOverrides(list, EMPTY_FAVORITES)).toBe(list);
    });

    it('applyFavoriteOverrides replaces only the overridden messages', () => {
        const list = [m(1), m(2)];
        const out = applyFavoriteOverrides(list, withFavorite(EMPTY_FAVORITES, 2, true));
        expect(out[0]).toBe(list[0]);
        expect(out[1]).toEqual({ ...list[1], is_favorite: true });
    });

    it('pruneFavoriteOverrides drops what the server now agrees with, and missing ids', () => {
        let map = withFavorite(EMPTY_FAVORITES, 1, true);
        map = withFavorite(map, 2, true);
        map = withFavorite(map, 9, false);
        const pruned = pruneFavoriteOverrides(map, [m(1, true), m(2, false)]);
        expect([...pruned]).toEqual([[2, true]]);
    });

    it('pruneFavoriteOverrides returns the same map when nothing changes', () => {
        const map = withFavorite(EMPTY_FAVORITES, 2, true);
        expect(pruneFavoriteOverrides(map, [m(2, false)])).toBe(map);
        expect(pruneFavoriteOverrides(EMPTY_FAVORITES, [m(1)])).toBe(EMPTY_FAVORITES);
    });

    it('setFavoriteIn sets one message and keeps the rest by identity', () => {
        const list = [m(1), m(2)];
        const out = setFavoriteIn(list, 1, true);
        expect(out[0].is_favorite).toBe(true);
        expect(out[1]).toBe(list[1]);
        expect(setFavoriteIn(list, 7, true)).toBe(list);
    });
});
