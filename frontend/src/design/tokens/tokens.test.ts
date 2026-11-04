import { describe, it, expect } from 'vitest';
import legacy from '../__fixtures__/legacy-theme-values.json';
import { contrastRatio } from '../contrast';
import {
    GROUP_IDS, SCALE_STEPS, groupTokens, groupRoles, color, radius, shadow, typeScale, motion, easingCss, bezierEasing, SPACE_UNIT_PX,
} from './index';

const SHELTERS = {
    hinatazaka: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
    sakurazaka: { picture: '#ec9595', video: '#edc094', voice: '#d695ec', text: '#eb95ae' },
    nogizaka: { picture: '#c4a8d8', video: '#9B59B6', voice: '#b8a8d8', text: '#d8c8e8' },
    yodel: { picture: '#8ab89a', video: '#6a9a7a', voice: '#7aaa8a', text: '#5a8a6a' },
    default: { picture: '#a8d0e8', video: '#c4a8d8', voice: '#b8a8d8', text: '#8bb8d6' },
} as const;

const ROLES = {
    hinatazaka: ['#7cc7e8', '#389dd1', '#0d7aab', '#eff9fd', '#bbe4f7', '#7cc7e8', '#7cc7e8', 'rgba(124, 199, 232, 0.35)'],
    sakurazaka: ['#f19db5', '#c84575', '#a72f5d', '#fff3f6', '#fecdda', '#feacc3', '#f19db5', 'rgba(241, 157, 181, 0.35)'],
    nogizaka: ['#7f1083', '#b24ab5', '#943397', '#fef3fe', '#f9cbf8', '#f1abf1', '#b24ab5', 'rgba(127, 16, 131, 0.28)'],
    yodel: ['#5a8a6a', '#5a8a6a', '#416f51', '#f3f8f4', '#cde3d3', '#afd1b9', '#5a8a6a', 'rgba(90, 138, 106, 0.3)'],
    default: ['#6b7280', '#4b5563', '#374151', '#f9fafb', '#e5e7eb', '#d1d5db', '#E5E7EB', 'rgba(107, 114, 128, 0.25)'],
} as const;

describe('group tokens — official layer (verbatim)', () => {
    it('defines exactly the five groups', () => {
        expect([...GROUP_IDS].sort()).toEqual(Object.keys(legacy.groups).sort());
        expect(Object.keys(groupTokens).sort()).toEqual([...GROUP_IDS].sort());
    });

    it.each(GROUP_IDS)('%s title and canvas equal the official values', (id) => {
        const o = groupTokens[id].official;
        const want = legacy.groups[id];
        expect(o.title.gradient).toEqual(want.titleGradient);
        expect(o.title.bar).toBe(want.titleBar);
        expect(o.title.text).toBe(want.titleText);
        expect([...o.canvas]).toEqual(want.canvas);
    });

    it.each(GROUP_IDS)('%s shelters and styles equal the official values', (id) => {
        const o = groupTokens[id].official;
        expect(o.shelter).toEqual(SHELTERS[id]);
        expect(o.shelterStyle).toBe(id === 'sakurazaka' ? 'light' : 'classic');
        expect(o.headerStyle).toBe(id === 'sakurazaka' ? 'light' : 'gradient');
    });
});

describe('group tokens — system layer', () => {
    it.each(GROUP_IDS)('%s has a 10-step scale that darkens and contains the logo colour', (id) => {
        const { scale, logo } = groupTokens[id];
        expect(Object.keys(scale).map(Number)).toEqual([...SCALE_STEPS]);
        const white = color.text.inverse;
        const ratios = SCALE_STEPS.map((s) => contrastRatio(scale[s], white) as number);
        for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
        expect(Object.values(scale).map((v) => v.toLowerCase())).toContain(logo.toLowerCase());
    });

    it.each(GROUP_IDS)('%s roles match the spec table', (id) => {
        const r = groupRoles(id);
        expect([r.logo, r.action, r.strong, r.subtle, r.subtleBorder, r.linkUnderline, r.bubbleBorder, r.glow]).toEqual([...ROLES[id]]);
        expect(r.ring).toBe(r.action);
        expect(r.highlight).toBe(groupTokens[id].scale[100]);
    });

    it.each(GROUP_IDS)('%s meets the contrast floors', (id) => {
        const r = groupRoles(id);
        const white = color.text.inverse;
        expect(contrastRatio(r.action, white)).toBeGreaterThanOrEqual(3.0);
        expect(contrastRatio(r.strong, white)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the user-chosen Hinatazaka 600', () => {
        expect(groupTokens.hinatazaka.scale[600]).toBe('#389dd1');
    });

    it('derives shadow, button gradient and ambient orbs from the scale', () => {
        const h = groupRoles('hinatazaka');
        expect(h.unreadShadow).toBe('0 0 12px rgba(124, 199, 232, 0.4)');
        expect(h.buttonGradient).toBe('linear-gradient(135deg, #7cc7e8 0%, #389dd1 100%)');
        expect(h.ambient.orb1).toBe('radial-gradient(circle, #bbe4f7 0%, #dbf1fb 30%, transparent 70%)');
        expect(h.ambient.orb2).toBe('radial-gradient(circle, #fce4fc 0%, #eff9fd 40%, transparent 70%)');
        expect(h.ambient.orb3).toBe('radial-gradient(circle, #dbf1fb 0%, transparent 70%)');
        expect(groupRoles('yodel').ambient.orb2).toBe('radial-gradient(circle, #e5f0e8 0%, #f3f8f4 40%, transparent 70%)');
    });
});

describe('neutral colour tokens', () => {
    const vars = legacy.cssVars.hinatazaka as Record<string, string>;

    it('match the pre-D1 surface, text and feedback values', () => {
        expect(color.surface.sheet).toBe(vars['--color-surface-base']);
        expect(color.surface.elevated).toBe(vars['--color-surface-elevated']);
        expect(color.surface.sunken).toBe(vars['--color-surface-sunken']);
        expect(color.text.primary).toBe(vars['--color-text-primary']);
        expect(color.text.secondary).toBe(vars['--color-text-secondary']);
        expect(color.text.muted).toBe(vars['--color-text-muted']);
        expect(color.text.inverse).toBe(vars['--color-text-inverse']);
        expect(color.feedback.success).toBe(vars['--color-success']);
        expect(color.feedback.warning).toBe(vars['--color-warning']);
        expect(color.feedback.error).toBe(vars['--color-error']);
    });

    it('use role names, never hue names (dark-mode ready)', () => {
        const names = Object.values(color).flatMap((group) => Object.keys(group));
        for (const n of names) expect(n).not.toMatch(/white|black|gray|grey|blue|pink|purple|green/i);
    });
});

describe('scales', () => {
    it('radius, shadow, type, motion and spacing are unchanged', () => {
        expect(radius).toEqual({ none: '0px', card: '14px', sheet: '20px', pill: '9999px' });
        expect(Object.keys(shadow)).toEqual(['none', 'pill', 'card', 'sheet']);
        expect(Object.keys(typeScale)).toEqual(['caption', 'small', 'body', 'title', 'heading']);
        expect(motion.duration).toEqual({ fast: 150, base: 200, glide: 400, landing: 1400 });
        expect(easingCss(motion.easing.standard)).toBe('cubic-bezier(0.2, 0, 0, 1)');
        expect(SPACE_UNIT_PX).toBe(4);
    });
});

describe('bezierEasing', () => {
    const f = bezierEasing(motion.easing.standard);
    it('maps endpoints and is monotonic', () => {
        expect(f(0)).toBe(0);
        expect(f(1)).toBe(1);
        let prev = 0;
        for (let x = 0.05; x <= 1.0001; x += 0.05) {
            const y = f(Math.min(x, 1));
            expect(y).toBeGreaterThanOrEqual(prev);
            prev = y;
        }
    });
    it('decelerates', () => {
        expect(f(0.5)).toBeGreaterThan(0.5);
    });
    it('the linear curve is the identity', () => {
        const lin = bezierEasing([0, 0, 1, 1]);
        for (const x of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) expect(lin(x)).toBeCloseTo(x, 6);
    });
    it('matches an independent evaluation of the standard curve', () => {
        // Independent method: bisect the parametric form with the expanded polynomial.
        const [x1, y1, x2, y2] = motion.easing.standard;
        const poly = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
        const expected = (x: number) => {
            let lo = 0;
            let hi = 1;
            while (hi - lo > 1e-12) {
                const mid = (lo + hi) / 2;
                if (poly(x1, x2, mid) < x) lo = mid;
                else hi = mid;
            }
            return poly(y1, y2, lo);
        };
        expect(Math.abs(f(0.5) - expected(0.5))).toBeLessThan(1e-3);
        // Hand-checked: x(t) = 0.5 at t of about 0.78, where y(t) is about 0.878.
        expect(f(0.5)).toBeCloseTo(0.878, 3);
    });
    it('rejects x control points outside [0, 1]', () => {
        expect(() => bezierEasing([-0.1, 0, 0.5, 1])).toThrow(RangeError);
        expect(() => bezierEasing([0.2, 0, 1.2, 1])).toThrow(RangeError);
        expect(() => bezierEasing([0.2, -2, 0.5, 3])).not.toThrow();
    });
});
