import { describe, it, expect } from 'vitest';
import { hourBands, type LaneItem } from './laneLayout';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
const opts = { start: 0, hourCount: 3, pxPerHour: 72, cardHeight: 40, gap: 4 };
const at = (key: string, ms: number): LaneItem => ({ key, ts: ms });

describe('hourBands', () => {
    it('places each card at its minute when the hour is quiet', () => {
        const out = hourBands([[at('a', 0), at('b', H + 20 * M)]], opts);
        expect(out.edges).toEqual([0, 72, 144, 216]);
        expect(out.lanes[0]).toEqual([{ key: 'a', top: 0 }, { key: 'b', top: 72 + 24 }]);
    });

    it('grows a busy hour so every card stays inside its own hour on the ruler (D14)', () => {
        // Four cards at 08:16..08:20 in one lane: they used to drift past the next hour line.
        const busy = [16, 17, 18, 20].map((m, i) => at(`c${i}`, m * M));
        const later = at('next', H + 5 * M);
        const out = hourBands([busy.concat(later), [at('other', 10 * M)]], opts);
        expect(out.edges[1]).toBe(4 * 44); // the busiest lane's four cards
        for (const p of out.lanes[0].slice(0, 4)) {
            expect(p.top).toBeGreaterThanOrEqual(out.edges[0]);
            expect(p.top + 44).toBeLessThanOrEqual(out.edges[1]);
        }
        const tops = out.lanes[0].map((p) => p.top);
        for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] + 44);
        // The next hour's card sits in the next band, at its minute.
        expect(out.lanes[0][4].top).toBe(out.edges[1] + 6);
        // The other lane keeps its card at its minute in the grown band's scale.
        expect(out.lanes[1][0].top).toBe(12);
    });

    it('keeps late-minute stacks inside the hour', () => {
        const out = hourBands([[at('a', 55 * M), at('b', 56 * M), at('c', 59 * M)]], opts);
        expect(out.lanes[0][2].top + 44).toBeLessThanOrEqual(out.edges[1]);
    });

    it('keeps the input order and handles no items', () => {
        const out = hourBands([[at('x', 5 * M), at('y', 5 * M)], []], opts);
        expect(out.lanes[0].map((p) => p.key)).toEqual(['x', 'y']);
        expect(out.lanes[1]).toEqual([]);
    });
});
