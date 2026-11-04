import { describe, it, expect } from 'vitest';
import legacy from '../__fixtures__/legacy-theme-values.json';
import {
    GROUP_IDS, groupTokens, color, radius, shadow, typeScale, motion, easingCss, SPACE_UNIT_PX,
} from './index';

describe('group tokens', () => {
    it('defines exactly the five groups', () => {
        expect([...GROUP_IDS].sort()).toEqual(Object.keys(legacy.groups).sort());
        expect(Object.keys(groupTokens).sort()).toEqual([...GROUP_IDS].sort());
    });

    it.each(GROUP_IDS)('%s equals the frozen pre-D1 values', (id) => {
        const t = groupTokens[id];
        const want = legacy.groups[id];
        expect(t.accent).toBe(want.accent);
        expect([...t.canvas]).toEqual(want.canvas);
        expect(t.title.gradient).toEqual(want.titleGradient);
        expect(t.title.bar).toBe(want.titleBar);
        expect(t.title.text).toBe(want.titleText);
        expect(t.ring).toBe(want.ring);
        expect(t.glow).toBe(want.glow);
        expect(t.bubbleBorder).toBe(want.bubbleBorder);
        expect(t.badge).toBe(want.badge);
    });

    it('keeps the Hinatazaka badge unchanged', () => {
        expect(groupTokens.hinatazaka.badge).toBe('#7cc7e8');
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

    it('match the pre-D1 border values', () => {
        expect(color.border.subtle).toBe(legacy.border.light);
        expect(color.border.strong).toBe(legacy.border.base);
    });

    it('use role names, never hue names (dark-mode ready)', () => {
        const names = Object.values(color).flatMap((group) => Object.keys(group));
        for (const n of names) expect(n).not.toMatch(/white|black|gray|grey|blue|pink|purple|green/i);
    });
});

describe('scales', () => {
    it('radius has the four agreed steps', () => {
        expect(radius).toEqual({ none: '0px', card: '14px', sheet: '20px', pill: '9999px' });
    });

    it('shadow has four layers', () => {
        expect(Object.keys(shadow)).toEqual(['none', 'pill', 'card', 'sheet']);
        expect(shadow.none).toBe('none');
    });

    it('type has the five agreed sizes', () => {
        expect(Object.fromEntries(Object.entries(typeScale).map(([k, v]) => [k, v.size]))).toEqual({
            caption: '11px', small: '13px', body: '14px', title: '16px', heading: '20px',
        });
    });

    it('motion stays within 150-200 ms', () => {
        expect(motion.duration).toEqual({ fast: 150, base: 200 });
        expect(easingCss(motion.easing.standard)).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });

    it('spacing unit is 4 px', () => {
        expect(SPACE_UNIT_PX).toBe(4);
    });
});
