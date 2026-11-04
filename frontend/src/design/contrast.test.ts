import { describe, it, expect } from 'vitest';
import { contrastRatio, parseHex } from './contrast';

describe('contrast', () => {
    it('parses 3- and 6-digit hex', () => {
        expect(parseHex('#fff')).toEqual([255, 255, 255]);
        expect(parseHex('#7cc7e8')).toEqual([124, 199, 232]);
        expect(parseHex('rgba(0,0,0,1)')).toBeNull();
        expect(parseHex('linear-gradient(red, blue)')).toBeNull();
    });

    it('computes WCAG ratios', () => {
        expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
        expect(contrastRatio('#7cc7e8', '#FFFFFF')).toBeCloseTo(1.88, 2);
        expect(contrastRatio('#2b8cc4', '#FFFFFF')).toBeCloseTo(3.72, 2);
    });

    it('returns null for non-hex values', () => {
        expect(contrastRatio('rgba(124, 199, 232, 0.35)', '#FFFFFF')).toBeNull();
    });
});
