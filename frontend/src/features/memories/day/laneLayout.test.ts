import { describe, it, expect } from 'vitest';
import { laneLayout } from './laneLayout';

const opts = { pxPerMinute: 2, cardHeight: 40, gap: 4 };

describe('laneLayout', () => {
    it('places each card at its time when there is room', () => {
        expect(laneLayout([{ key: 'a', minutes: 0 }, { key: 'b', minutes: 60 }], opts)).toEqual([
            { key: 'a', top: 0 },
            { key: 'b', top: 120 },
        ]);
    });

    it('pushes a card down so no two cards in a lane overlap', () => {
        const out = laneLayout([{ key: 'a', minutes: 10 }, { key: 'b', minutes: 15 }, { key: 'c', minutes: 18 }], opts);
        for (let i = 1; i < out.length; i++) expect(out[i].top).toBeGreaterThanOrEqual(out[i - 1].top + opts.cardHeight + opts.gap);
        expect(out[0].top).toBe(20);
    });

    it('keeps the input order', () => {
        const out = laneLayout([{ key: 'x', minutes: 5 }, { key: 'y', minutes: 5 }, { key: 'z', minutes: 300 }], opts);
        expect(out.map((o) => o.key)).toEqual(['x', 'y', 'z']);
    });

    it('stacks messages of the same minute', () => {
        const out = laneLayout([{ key: 'a', minutes: 30 }, { key: 'b', minutes: 30 }, { key: 'c', minutes: 30 }], opts);
        expect(out.map((o) => o.top)).toEqual([60, 104, 148]);
    });

    it('returns nothing for no items', () => {
        expect(laneLayout([], opts)).toEqual([]);
    });
});
