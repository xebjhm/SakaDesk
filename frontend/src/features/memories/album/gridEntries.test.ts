import { describe, it, expect } from 'vitest';
import { gridEntries } from './gridEntries';
import { monthPayload, photo } from './__fixtures__';

describe('gridEntries', () => {
    it('collapses a burst of three into one entry at its first item', () => {
        const entries = gridEntries(monthPayload('2024-09'));
        expect(entries.map((e) => (e.kind === 'tile' ? e.item.id : `b:${e.items.map((m) => m.id).join(',')}`)))
            .toEqual([1, 2, 'b:3,4,5', 6]);
    });

    it('keeps a burst with fewer than three present items as single tiles', () => {
        const data = monthPayload('2024-09', {
            items: [photo(3, '2024-09'), photo(4, '2024-09')],
            bursts: [{ burst_id: 7, room: photo(3, '2024-09').room, ids: [3, 4, 5] }],
        });
        expect(gridEntries(data).every((e) => e.kind === 'tile')).toBe(true);
    });
});
