import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROUP_IDS } from './tokens';
import { staticTokenVars, groupTokenVars } from './cssVars';

// __dirname, not import.meta.url: under vitest's jsdom environment import.meta.url is not a file: URL.
const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('tailwind.config.js token utilities', () => {
    it('only references --ds- variables that applyTokens writes', () => {
        const written = new Set([...Object.keys(staticTokenVars()), ...Object.keys(groupTokenVars(GROUP_IDS[0]))]);
        const referenced = [...config.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map((m) => m[1]);
        expect(referenced.length).toBeGreaterThan(30);
        expect(referenced.filter((name) => !written.has(name))).toEqual([]);
    });
});

describe('accent and expressive utilities', () => {
    const expected: Array<[section: string, key: string, variable: string]> = [
        ['backgroundColor', 'accent', '--ds-accent'],
        ['backgroundColor', "'accent-subtle'", '--ds-accent-subtle'],
        ['backgroundImage', "'accent-gradient'", '--ds-accent-gradient'],
        ['backgroundImage', "'accent-tonal'", '--ds-accent-tonal'],
        ['backgroundImage', "'expressive-soft'", '--ds-expressive-soft'],
        ['backgroundImage', "'expressive-header'", '--ds-expressive-header'],
        ['backgroundImage', "'expressive-header-bar'", '--ds-expressive-header-bar'],
        ['backgroundImage', "'expressive-orb-1'", '--ds-expressive-orb-1'],
        ['backgroundImage', "'expressive-orb-2'", '--ds-expressive-orb-2'],
        ['backgroundImage', "'expressive-orb-3'", '--ds-expressive-orb-3'],
        ['backgroundImage', 'aurora', '--ds-aurora'],
        ['textColor', 'accent', '--ds-accent'],
        ['textColor', "'accent-strong'", '--ds-accent-strong'],
        ['textColor', "'accent-tonal'", '--ds-accent-tonal-text'],
        ['textColor', "'expressive-header'", '--ds-expressive-header-text'],
        ['borderColor', "'accent-border'", '--ds-accent-border'],
        ['borderColor', 'accent', '--ds-accent'],
        ['ringColor', 'accent', '--ds-accent'],
        ['boxShadow', "'accent-glow'", '--ds-shadow-accent-glow'],
        ['boxShadow', "'accent-glow-hover'", '--ds-shadow-accent-glow-hover'],
        ['boxShadow', "'accent-unread'", '--ds-shadow-accent-unread'],
        ['accentColor', 'accent', '--ds-accent'],
    ];
    const sectionBody = (name: string) => {
        const start = config.indexOf(`${name}: {`);
        return config.slice(start, config.indexOf('\n            },', start));
    };

    it.each(expected)('%s.%s maps to var(%s)', (section, key, variable) => {
        expect(sectionBody(section)).toContain(`${key}: 'var(${variable})'`);
    });

    it('every accent variable is written by the token maps', () => {
        const written = new Set([...Object.keys(staticTokenVars()), ...Object.keys(groupTokenVars(GROUP_IDS[0]))]);
        expect(expected.filter(([, , v]) => !written.has(v))).toEqual([]);
    });

    it('defines the 0.97 press scale', () => {
        expect(config).toMatch(/scale: \{\s*97: '0\.97',/);
    });
});
