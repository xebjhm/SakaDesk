import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars, accentTokenVars } from './cssVars';
import { brandAccent } from './tokens';
import { cn } from '../utils/classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('R-b tokens', () => {
    it('writes the frost hairline overlay and the accent wash vars', () => {
        expect(staticTokenVars()['--ds-overlay-frost-border']).toBe('rgba(255, 255, 255, 0.4)');
        const a = brandAccent();
        const v = accentTokenVars(a);
        expect(v['--ds-accent-wash']).toBe(
            `linear-gradient(135deg, color-mix(in srgb, ${a.logo} 8%, transparent), color-mix(in srgb, ${a.accent} 6%, transparent))`,
        );
        expect(v['--ds-accent-wash-border']).toBe(`color-mix(in srgb, ${a.logo} 19%, transparent)`);
    });

    it('registers the wash, frost hairline, oshi-solid text, backdrop blur and saturate utilities', () => {
        expect(config).toContain("'accent-wash': 'var(--ds-accent-wash)'");
        expect(config).toContain("'accent-wash': 'var(--ds-accent-wash-border)'");
        expect(config).toContain("'frost': 'var(--ds-overlay-frost-border)'");
        expect(config).toContain("'semantic-oshi-solid': 'var(--ds-semantic-oshi-solid)'");
        expect(config).toContain("backdropBlur: { frost: '20px' }");
        expect(config).toContain("backdropSaturate: { 180: '1.8' }");
        expect(cn('bg-accent-subtle', 'bg-accent-wash')).toBe('bg-accent-subtle bg-accent-wash');
        expect(cn('border-accent-border', 'border-accent-wash')).toBe('border-accent-wash');
        expect(cn('text-semantic-oshi', 'text-semantic-oshi-solid')).toBe('text-semantic-oshi-solid');
    });

    it('writes the frosted feed header overlay (the pre-D2 white at 72 %)', () => {
        expect(staticTokenVars()['--ds-overlay-frost']).toBe('rgba(255, 255, 255, 0.72)');
    });

    it('registers bg-frost as a colour', () => {
        expect(config).toContain("'frost': 'var(--ds-overlay-frost)'");
        expect(cn('bg-sheet', 'bg-frost')).toBe('bg-frost');
    });

    it('writes the oshi set (harmonized hot pink) and the star yellow as global semantic vars', () => {
        const vars = staticTokenVars();
        expect(vars['--ds-semantic-oshi-subtle']).toBe('#fff0f8');
        expect(vars['--ds-semantic-oshi-border']).toBe('#ffcbe1');
        expect(vars['--ds-semantic-oshi-solid']).toBe('#de5f99');
        expect(vars['--ds-semantic-oshi-text']).toBe('#aa376f');
        expect(vars['--ds-semantic-star']).toBe('#facc15');
    });

    it('lets oshi utilities override their accent counterparts in cn()', () => {
        expect(cn('bg-accent-subtle', 'bg-semantic-oshi-subtle')).toBe('bg-semantic-oshi-subtle');
        expect(cn('text-accent-strong', 'text-semantic-oshi')).toBe('text-semantic-oshi');
        expect(cn('ring-accent-border', 'ring-semantic-oshi')).toBe('ring-semantic-oshi');
        expect(cn('text-accent', 'text-semantic-star')).toBe('text-semantic-star');
    });
});
