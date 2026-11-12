import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aurora, color, memories } from './tokens';
import { staticTokenVars } from './cssVars';

// The Memories keepsake surfaces (DESIGN_SYSTEM.md "Memories keepsake surfaces").
describe('memories keepsake tokens', () => {
    it('ages a photo in three sepia steps', () => {
        const steps = [memories.sepia[1], memories.sepia[2], memories.sepia[3]].map(Number);
        expect(steps.every((s) => s > 0 && s <= 1)).toBe(true);
        expect(steps[0]).toBeLessThan(steps[1]);
        expect(steps[1]).toBeLessThan(steps[2]);
    });

    it('makes the strongest step full sepia (the recap S08 older card)', () => {
        expect(memories.sepia[3]).toBe('1');
    });

    it('builds the foil from the aurora stops', () => {
        for (const stop of aurora.stops) expect(memories.foil).toContain(stop);
        expect(memories.foil.startsWith('linear-gradient(')).toBe(true);
    });

    it('rules a postcard back every 20 px in the paper line colour', () => {
        expect(memories.ruled).toContain(memories.paperLine);
        expect(memories.ruled).toContain('20px');
        expect(staticTokenVars()['--ds-mem-ruled']).toBe(memories.ruled);
    });

    it('dashes the silhouette in the neutral border-strong value', () => {
        expect(memories.silhouette).toBe(color.border.strong);
    });

    it('writes the static variables', () => {
        const v = staticTokenVars();
        expect(v['--ds-mem-sepia-1']).toBe(memories.sepia[1]);
        expect(v['--ds-mem-sepia-2']).toBe(memories.sepia[2]);
        expect(v['--ds-mem-sepia-3']).toBe(memories.sepia[3]);
        expect(v['--ds-mem-paper']).toBe(memories.paper);
        expect(v['--ds-mem-paper-line']).toBe(memories.paperLine);
        expect(v['--ds-mem-cork']).toBe(memories.cork);
        expect(v['--ds-mem-washi']).toBe(memories.washi);
        expect(v['--ds-mem-foil']).toBe(memories.foil);
        expect(v['--ds-mem-shadow-polaroid']).toBe(memories.shadow.polaroid);
        expect(v['--ds-mem-silhouette']).toBe(memories.silhouette);
    });
});

describe('memories keepsake utilities (tailwind.config.js)', () => {
    const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');
    const section = (name: string) => {
        const start = config.indexOf(`${name}: {`);
        expect(start, name).toBeGreaterThan(-1);
        return config.slice(start, config.indexOf('}', start));
    };

    it.each([
        ['backgroundColor', 'memories-paper', '--ds-mem-paper'],
        ['backgroundColor', 'memories-washi', '--ds-mem-washi'],
        ['backgroundImage', 'memories-cork', '--ds-mem-cork'],
        ['backgroundImage', 'memories-foil', '--ds-mem-foil'],
        ['backgroundImage', 'memories-ruled', '--ds-mem-ruled'],
        ['boxShadow', 'memories-polaroid', '--ds-mem-shadow-polaroid'],
        ['borderColor', 'memories-silhouette', '--ds-mem-silhouette'],
        ['borderColor', 'memories-paper', '--ds-mem-paper-line'],
        ['sepia', 'memories-1', '--ds-mem-sepia-1'],
        ['sepia', 'memories-2', '--ds-mem-sepia-2'],
        ['sepia', 'memories-3', '--ds-mem-sepia-3'],
    ])('%s has %s', (name, key, variable) => {
        expect(section(name)).toContain(`'${key}': 'var(${variable})'`);
    });
});
