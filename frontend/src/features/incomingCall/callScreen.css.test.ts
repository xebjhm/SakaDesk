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

    it('keeps the popup halo off the window edge: inset 8px and no ring line', () => {
        const r = rule('.sd-call-halo--inset');
        expect(r).toMatch(/inset:\s*8px/);
        expect(css).not.toMatch(/\.sd-call-halo--inset\[[^{]*\{[^}]*inset 0 0 0 \d/);
    });
});
