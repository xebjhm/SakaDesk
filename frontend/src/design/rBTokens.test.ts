import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars } from './cssVars';
import { cn } from '../utils/classnames';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('R-b tokens', () => {
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
