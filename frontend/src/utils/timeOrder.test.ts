import { describe, it, expect } from 'vitest';
import { timeNeighbours } from './timeOrder';

describe('timeNeighbours', () => {
    it('oldest-first: older is index-1, newer is index+1, oldest = 1', () => {
        expect(timeNeighbours(1, 3, 'oldest_first')).toEqual({ older: 0, newer: 2, ordinal: 2 });
        expect(timeNeighbours(0, 3, 'oldest_first')).toEqual({ older: null, newer: 1, ordinal: 1 });
        expect(timeNeighbours(2, 3, 'oldest_first')).toEqual({ older: 1, newer: null, ordinal: 3 });
    });
    it('newest-first: older is index+1, newer is index-1, oldest = 1', () => {
        expect(timeNeighbours(1, 3, 'newest_first')).toEqual({ older: 2, newer: 0, ordinal: 2 });
        expect(timeNeighbours(0, 3, 'newest_first')).toEqual({ older: 1, newer: null, ordinal: 3 });
        expect(timeNeighbours(2, 3, 'newest_first')).toEqual({ older: null, newer: 1, ordinal: 1 });
    });
});
