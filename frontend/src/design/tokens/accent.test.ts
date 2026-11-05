import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../contrast';
import { aurora, brandInk } from './brand';
import { brandAccent, groupAccent, mixHex } from './accent';
import { GROUP_IDS, groupRoles, groupTokens } from './index';

describe('brand tokens', () => {
    it('ink 600 carries white text at ≥ 4.5:1', () => {
        expect(contrastRatio(brandInk[600], '#ffffff')).toBeGreaterThanOrEqual(4.5);
    });
    it('aurora is the spec gradient', () => {
        expect(aurora.gradient).toBe('linear-gradient(120deg, #cfe6ff 0%, #e3dcff 38%, #ffdcea 72%, #fff0dc 100%)');
        expect(aurora.orbs).toEqual(['#bfdcff', '#ffd0e4', '#e2d6ff']);
    });
});

describe('mixHex', () => {
    it('mixes in sRGB', () => {
        expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
        expect(mixHex('#7cc7e8', '#ffffff', 0)).toBe('#7cc7e8');
    });
});

describe('brandAccent', () => {
    const a = brandAccent();
    it('maps the ink scale to roles', () => {
        expect([a.accent, a.strong, a.subtle, a.border, a.logo]).toEqual([
            brandInk[600], brandInk[700], brandInk[50], brandInk[200], brandInk[400],
        ]);
        expect(a.gradient).toBe(`linear-gradient(135deg, ${brandInk[400]} 0%, ${brandInk[600]} 100%)`);
        expect(a.tonalText).toBe(brandInk[800]);
    });
    it('uses the aurora for the expressive header with dark text and no bar', () => {
        expect(a.header).toBe(aurora.gradient);
        expect(a.headerText).toBe('#1f2937');
        expect(a.headerBar).toBe('none');
        expect(a.soft).toBe(aurora.gradient);
    });
});

describe('groupAccent', () => {
    it.each(['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel'] as const)('%s follows the group roles', (id) => {
        const r = groupRoles(id);
        const a = groupAccent(id);
        expect([a.accent, a.strong, a.subtle, a.border, a.logo, a.glow]).toEqual([
            r.action, r.strong, r.subtle, r.subtleBorder, r.logo, r.glow,
        ]);
        expect(a.gradient).toBe(`linear-gradient(135deg, ${r.logo} 0%, ${r.action} 100%)`);
        expect(a.tonal).toBe(`linear-gradient(135deg, ${r.subtleBorder} 0%, ${mixHex(r.logo, '#ffffff', 0.35)} 100%)`);
        expect(a.tonalText).toBe(groupTokens[id].scale[800]);
        expect([a.orb1, a.orb2, a.orb3]).toEqual([r.ambient.orb1, r.ambient.orb2, r.ambient.orb3]);
    });
    it('gradient groups get the title gradient with white text and no bar', () => {
        const g = groupTokens.hinatazaka.official.title.gradient;
        const a = groupAccent('hinatazaka');
        expect(a.header).toBe(`linear-gradient(to right, ${g.from}, ${g.via}, ${g.to})`);
        expect(a.headerText).toBe('#FFFFFF');
        expect(a.headerBar).toBe('none');
    });
    it('Sakurazaka (light header) gets a white header, title text and the bar', () => {
        const o = groupTokens.sakurazaka.official;
        const a = groupAccent('sakurazaka');
        expect(a.header).toBe('#FFFFFF');
        expect(a.headerText).toBe(o.title.text);
        expect(a.headerBar).toBe(o.title.bar);
    });
    it('the retired default group resolves to the brand', () => {
        expect(groupAccent('default')).toEqual(brandAccent());
    });
    it('covers every group id', () => {
        for (const id of GROUP_IDS) expect(groupAccent(id).accent).toMatch(/^#/);
    });
});
