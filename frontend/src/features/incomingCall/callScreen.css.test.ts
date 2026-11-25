import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(resolve(__dirname, 'callScreen.css'), 'utf-8');
const rule = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
};

describe('callScreen.css edges', () => {
    it('clips the card to its rounded shape so masked backdrop bands cannot leak past the corners', () => {
        const r = rule('.sd-call-screen');
        expect(r).toContain('clip-path: inset(0 round var(--sd-rad');
        expect(r).toContain('overflow: hidden');
    });

    it('gives the blur bands matching corner radii', () => {
        expect(rule('.sd-call-band--top')).toContain('border-radius: var(--sd-rad, 24px) var(--sd-rad, 24px) 0 0');
        expect(rule('.sd-call-band--bottom')).toContain('border-radius: 0 0 var(--sd-rad, 24px) var(--sd-rad, 24px)');
    });

    it('draws no second 1px edge ring on the card itself', () => {
        expect(rule('.sd-call-screen')).not.toContain('0 0 0 1px');
    });

    it('puts the popup glow on the window edge (0.4.2 B4): inset 0, the 16px card radius, no ring line', () => {
        const r = rule('.sd-call-halo--inset');
        // The popup window is transparent and the card draws its own 16px corners; the glow
        // follows the card edge, so the popup is only the call card.
        expect(r).toMatch(/inset:\s*0;/);
        expect(r).toMatch(/border-radius:\s*16px/);
        expect(css).not.toMatch(/\.sd-call-halo--inset\[[^{]*\{[^}]*inset 0 0 0 \d/);
    });

    it('stops every breathing halo under reduced motion with a selector that out-ranks the phase rules (D-L4)', () => {
        const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(start).toBeGreaterThanOrEqual(0);
        const block = css.slice(start);
        // `.sd-call-halo[data-phase="ringing"]` is (0,2,0); a bare `.sd-call-halo` (0,1,0) loses to it.
        const stops = (selector: string) => new RegExp(`(^|[\\s,])${selector.replace(/[.[\]]/g, '\\$&')}\\s*[,{][^}]*animation:\\s*none`, 'm').test(block);
        expect(stops('.sd-call-halo[data-phase]')).toBe(true);
        expect(stops('.sd-call-halo--inset[data-phase]')).toBe(true);
    });
});
