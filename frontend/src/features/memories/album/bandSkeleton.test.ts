import { describe, it, expect } from 'vitest';
import { BAND_SKELETON_MAX, bandSkeletonCells, bandSkeletonHeight, bandSkeletonRows } from './bandSkeleton';

describe('band skeleton sizing', () => {
    it('reserves one cell per item, ceil(count / cols) rows', () => {
        expect(bandSkeletonRows(40, 6, false)).toBe(7);
        expect(bandSkeletonRows(13, 2, false)).toBe(7);
        expect(bandSkeletonRows(3, 6, false)).toBe(1);
        expect(bandSkeletonRows(0, 6, false)).toBe(1);
    });

    it('adds one pinned 2 x 2 favourite (3 cells) when likely and a row holds two tiles', () => {
        expect(bandSkeletonCells(40, 6, true)).toBe(43);
        expect(bandSkeletonRows(40, 6, true)).toBe(8);
        expect(bandSkeletonCells(5, 1, true)).toBe(5);
    });

    it('measures rows of square tracks plus the gaps, and nothing while the width is unknown', () => {
        expect(bandSkeletonHeight(7, 6, 904, 8)).toBe(7 * 144 + 6 * 8);
        expect(bandSkeletonHeight(2, 2, 296, 8)).toBe(2 * 144 + 8);
        expect(bandSkeletonHeight(7, 6, 0, 8)).toBe(0);
    });

    it('pulses at most 12 tiles', () => {
        expect(BAND_SKELETON_MAX).toBe(12);
    });
});
