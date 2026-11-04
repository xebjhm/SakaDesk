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
