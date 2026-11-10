import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aurora, color, groupTokens, memories } from './tokens';
import { staticTokenVars } from './cssVars';

// The Memories fun-wave surfaces (DESIGN_SYSTEM.md "Memories keepsake surfaces"): gacha rarity,
// the radio night and its on-air lamp, the 24h sky and the capsule note. All semantic.

const HEX = /#[0-9a-f]{6}\b/gi;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Plain RGB distance: a value this far apart reads as a different colour, not a shade of it. */
const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const hexesOf = (value: unknown): string[] => (JSON.stringify(value).match(HEX) ?? []).map((h) => h.toLowerCase());

/** The fun values with a colour of their own (`rarity.n` is the neutral `border-strong` on purpose). */
const FUN_VALUES = [
    memories.rarity.r, memories.rarity.sr, memories.night, memories.nightInk,
    memories.onAir, memories.sky, memories.note,
];

describe('memories fun tokens', () => {
    it('keeps the n rarity in the neutral border-strong family', () => {
        expect(memories.rarity.n).toBe(color.border.strong);
    });

    it('keeps the r rarity a rose apart from every oshi pink and from danger', () => {
        const { oshi, danger } = color.semantic;
        for (const pink of [oshi.solid, oshi.text, oshi.border, oshi.subtle, danger.solid, danger.text]) {
            expect(distance(memories.rarity.r, pink), pink).toBeGreaterThanOrEqual(45);
        }
    });

    it('builds the sr rarity from a gold and the foil stops, apart from the favourite star', () => {
        expect(memories.rarity.sr.startsWith('linear-gradient(')).toBe(true);
        expect(aurora.stops.some((stop) => memories.rarity.sr.includes(stop))).toBe(true);
        for (const hex of hexesOf(memories.rarity.sr)) expect(distance(hex, color.semantic.star), hex).toBeGreaterThanOrEqual(45);
    });

    it('builds the radio night as a deep gradient with an aurora stop, inked in an aurora stop', () => {
        expect(memories.night.startsWith('linear-gradient(')).toBe(true);
        expect(aurora.stops.some((stop) => memories.night.includes(stop))).toBe(true);
        const [first] = hexesOf(memories.night);
        expect(rgb(first).every((v) => v < 64), 'the night starts deep').toBe(true);
        expect(aurora.stops).toContain(memories.nightInk);
    });

    it('lights the on-air lamp warm red, apart from danger', () => {
        const [r, g, b] = rgb(memories.onAir);
        expect(r).toBeGreaterThan(g + 80);
        expect(r).toBeGreaterThan(b + 80);
        for (const danger of [color.semantic.danger.solid, color.semantic.danger.text]) {
            expect(distance(memories.onAir, danger), danger).toBeGreaterThanOrEqual(45);
        }
    });

    it('runs the 24h sky through four vertical stops (dawn, day, dusk, night)', () => {
        expect(memories.sky.startsWith('linear-gradient(180deg')).toBe(true);
        expect(hexesOf(memories.sky)).toHaveLength(4);
    });

    it('colours the capsule note a warm paper yellow, apart from the favourite star and the letter paper', () => {
        const [r, g, b] = rgb(memories.note);
        expect(r).toBeGreaterThan(b);
        expect(g).toBeGreaterThan(b);
        expect(distance(memories.note, color.semantic.star)).toBeGreaterThanOrEqual(45);
        expect(distance(memories.note, memories.paper)).toBeGreaterThanOrEqual(30);
    });

    it('never reuses a group colour (semantic, never the accent)', () => {
        const groupHexes = new Set(hexesOf(groupTokens));
        for (const hex of FUN_VALUES.flatMap(hexesOf)) expect(groupHexes.has(hex), hex).toBe(false);
    });

    it('writes the static variables', () => {
        const v = staticTokenVars();
        expect(v['--ds-mem-rarity-n']).toBe(memories.rarity.n);
        expect(v['--ds-mem-rarity-r']).toBe(memories.rarity.r);
        expect(v['--ds-mem-rarity-sr']).toBe(memories.rarity.sr);
        expect(v['--ds-mem-night']).toBe(memories.night);
        expect(v['--ds-mem-night-ink']).toBe(memories.nightInk);
        expect(v['--ds-mem-onair']).toBe(memories.onAir);
        expect(v['--ds-mem-sky']).toBe(memories.sky);
        expect(v['--ds-mem-note']).toBe(memories.note);
    });
});

describe('memories fun utilities (tailwind.config.js)', () => {
    const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');
    const section = (name: string) => {
        const start = config.indexOf(`${name}: {`);
        expect(start, name).toBeGreaterThan(-1);
        return config.slice(start, config.indexOf('}', start));
    };

    it.each([
        ['backgroundColor', 'memories-rarity-n', '--ds-mem-rarity-n'],
        ['backgroundColor', 'memories-rarity-r', '--ds-mem-rarity-r'],
        ['backgroundImage', 'memories-rarity-sr', '--ds-mem-rarity-sr'],
        ['backgroundImage', 'memories-night', '--ds-mem-night'],
        ['textColor', 'memories-night-ink', '--ds-mem-night-ink'],
        ['backgroundColor', 'memories-onair', '--ds-mem-onair'],
        ['textColor', 'memories-onair', '--ds-mem-onair'],
        ['backgroundImage', 'memories-sky', '--ds-mem-sky'],
        ['backgroundColor', 'memories-note', '--ds-mem-note'],
    ])('%s has %s', (name, key, variable) => {
        expect(section(name)).toContain(`'${key}': 'var(${variable})'`);
    });

    it('documents every fun utility as semantic in DESIGN_SYSTEM.md', () => {
        const doc = readFileSync(resolve(__dirname, '../../../docs/design/DESIGN_SYSTEM.md'), 'utf-8');
        for (const utility of [
            'bg-memories-rarity-n', 'bg-memories-rarity-r', 'bg-memories-rarity-sr', 'bg-memories-night',
            'text-memories-night-ink', 'bg-memories-onair', 'bg-memories-sky', 'bg-memories-note',
        ]) expect(doc, utility).toContain(`\`${utility}\``);
        expect(doc).toMatch(/on-air[^\n]*indicator, not an error/i);
    });
});
