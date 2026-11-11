import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { color } from './tokens';
import { staticTokenVars } from './cssVars';

/** The sRGB channels of `#rrggbb`. */
function hex(value: string): [number, number, number] {
    const v = value.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

/** `rgba(r, g, b, a)` drawn over an opaque base. */
function over(rgba: string, base: [number, number, number]): [number, number, number] {
    const [r, g, b, a] = rgba.replace(/[^\d.,]/g, '').split(',').map(Number);
    return [r, g, b].map((c, i) => c * a + base[i] * (1 - a)) as [number, number, number];
}

/** Rec. 601 luma, the 0–255 "luminance" the acceptance probe sampled. */
const luma = ([r, g, b]: [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

/** A cover tint (`MonthSection` `tintOf`: 18 % of the colour) over the sheet. */
const tint = (cover: string): [number, number, number] => {
    const sheet = hex(color.surface.sheet);
    return hex(cover).map((c, i) => c * 0.18 + sheet[i] * 0.82) as [number, number, number];
};

describe('the default Skeleton tone (D-L1)', () => {
    it('is the ink veil token, exposed as bg-skeleton-veil', () => {
        expect(staticTokenVars()['--ds-overlay-skeleton']).toBe(color.overlay.skeleton);
        const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');
        expect(config).toContain("'skeleton-veil': 'var(--ds-overlay-skeleton)'");
    });

    it.each([
        ['sheet', hex(color.surface.sheet)],
        ['sunken band', hex(color.surface.sunken)],
        ['pale cover tint', tint('#E8EEF2')],
        ['warm cover tint', tint('#C9A27E')],
        ['dark cover tint', tint('#30343A')],
    ] as const)('stands out from the %s by at least 20 luma levels', (_name, base) => {
        // The acceptance run measured 242 vs 242–244 for opaque `bg-sunken` tiles on a tinted band.
        expect(luma(base) - luma(over(color.overlay.skeleton, base))).toBeGreaterThanOrEqual(20);
    });
});
