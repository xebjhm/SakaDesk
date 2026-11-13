import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyGroupTokens } from './applyTokens';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf-8');

describe('legacy colour layer and colour scheme (UI health C-T2, C-F3)', () => {
    it('declares the light colour scheme', () => {
        expect(read('../../index.html')).toContain('<meta name="color-scheme" content="light" />');
        expect(read('../index.css')).toMatch(/:root\s*\{[^}]*color-scheme: light/);
    });

    it('has no --color-* variables or legacy theme utilities left', () => {
        expect(read('../index.css')).not.toContain('--color-');
        const config = read('../../tailwind.config.js');
        expect(config).not.toMatch(/var\(--color-|'theme-|'surface-base'|'feedback-|'brand-purple|'brand-blue'/);
    });

    it('no longer writes --color-* on a group switch', () => {
        applyGroupTokens('hinatazaka');
        expect(document.documentElement.style.getPropertyValue('--color-primary')).toBe('');
    });

    it('body text uses the primary text token', () => {
        expect(read('../index.css')).toMatch(/@apply antialiased text-primary;/);
    });
});
