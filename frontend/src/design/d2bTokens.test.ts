import { describe, it, expect } from 'vitest';
import { GROUP_IDS, ambientLayout, color, fontFamily, groupRoles, memberWash, typeScale } from './tokens';
import { groupTokenVars, staticTokenVars } from './cssVars';
import { cn } from '../utils/classnames';

describe('D2b tokens', () => {
    it('add a reading text step and the search-mark colours', () => {
        expect(typeScale.reading).toEqual({ size: '16px', leading: '28px' });
        expect(color.mark).toEqual({ exact: '#FEF08A', reading: '#DBEAFE', underline: '#60A5FA' });
        const vars = staticTokenVars();
        expect(vars['--ds-font-reading-size']).toBe('16px');
        expect(vars['--ds-font-reading-leading']).toBe('28px');
        expect(vars['--ds-mark-exact']).toBe('#FEF08A');
        expect(vars['--ds-mark-reading']).toBe('#DBEAFE');
        expect(vars['--ds-mark-underline']).toBe('#60A5FA');
    });

    it('add the serif reading family', () => {
        expect(fontFamily.reading).toBe('"Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN", serif');
        expect(staticTokenVars()['--ds-font-family-reading']).toBe(fontFamily.reading);
    });

    it('teach tailwind-merge the new utilities', () => {
        expect(cn('text-reading', 'text-primary')).toBe('text-reading text-primary');
        expect(cn('text-body', 'text-reading')).toBe('text-reading');
        expect(cn('font-reading', 'font-semibold')).toBe('font-reading font-semibold');
        expect(cn('animate-landing', 'animate-reveal')).toBe('animate-reveal');
        expect(cn('bg-group-ambient-1', 'bg-sheet')).toBe('bg-group-ambient-1 bg-sheet');
    });

    it.each(GROUP_IDS)('%s writes its ambient orbs from the ambient role and the orb layout', (id) => {
        const vars = groupTokenVars(id);
        const r = groupRoles(id);
        expect(vars['--ds-group-ambient-1']).toBe(r.ambient.orb1);
        expect(vars['--ds-group-ambient-2']).toBe(r.ambient.orb2);
        expect(vars['--ds-group-ambient-3']).toBe(r.ambient.orb3);
        expect(vars['--ds-group-ambient-1-size']).toBe(ambientLayout[id].orb1.size);
        expect(vars['--ds-group-ambient-2-size']).toBe(ambientLayout[id].orb2.size);
        expect(vars['--ds-group-ambient-3-opacity']).toBe(String(ambientLayout[id].orb3.opacity));
    });

    it('keeps the pre-D2b orb layout', () => {
        expect(ambientLayout.hinatazaka.orb1).toEqual({ position: 'top: -20%; left: -10%;', size: '70vw', opacity: 0.4 });
        expect(ambientLayout.sakurazaka.orb3).toEqual({ position: 'bottom: -20%; right: 20%;', size: '45vw', opacity: 0.35 });
    });

    it('orb 1 is back at its pre-D2 strength now that the feed header is frosted glass again (D1)', () => {
        expect([
            ambientLayout.hinatazaka.orb1.opacity, ambientLayout.sakurazaka.orb1.opacity,
            ambientLayout.nogizaka.orb1.opacity, ambientLayout.yodel.orb1.opacity, ambientLayout.default.orb1.opacity,
        ]).toEqual([0.4, 0.5, 0.5, 0.45, 0.4]);
    });

    it('default the member wash to transparent at the alpha token', () => {
        const vars = staticTokenVars();
        expect(memberWash.alpha).toBe('10%');
        expect(vars['--ds-member-wash-alpha']).toBe('10%');
        expect(vars['--ds-member-wash-1']).toBe('transparent');
        expect(vars['--ds-member-wash-2']).toBe('transparent');
    });
});
