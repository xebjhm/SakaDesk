import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aurora, brandInk, color, groupTokens, memories } from './tokens';
import { staticTokenVars } from './cssVars';
import { contrastRatio } from './contrast';

// The Memories fun-wave surfaces (DESIGN_SYSTEM.md "Memories keepsake surfaces"): gacha rarity,
// the radio night and its on-air lamp, the 24h sky and the capsule note. All semantic.

const HEX = /#[0-9a-f]{6}\b/gi;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Plain RGB distance: a value this far apart reads as a different colour, not a shade of it. */
const distance = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
const hexesOf = (value: unknown): string[] => (JSON.stringify(value).match(HEX) ?? []).map((h) => h.toLowerCase());
/** The hue (0-360) of a hex colour. */
const hue = (hex: string) => {
    const [r, g, b] = rgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
};
const hueGap = (a: string, b: string) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };
/** `color-mix(in srgb, a p%, b)` of two hex colours, as hex (the night gradient's last stop). */
const mix = (a: string, p: number, b: string) => `#${rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('')}`;
const contrast = (a: string, b: string) => contrastRatio(a, b) ?? 0;

/** The fun values with a colour of their own (`rarity.n` is the neutral `border-strong` on purpose). */
const FUN_VALUES = [
    memories.rarity.r, memories.rarity.sr, memories.night, memories.nightInk,
    memories.onAir, memories.sky, memories.note,
];

describe('memories fun tokens', () => {
    it('keeps the n rarity in the neutral border-strong family', () => {
        expect(memories.rarity.n).toBe(color.border.strong);
    });

    it('keeps the r rarity clearly apart from every oshi pink and from danger', () => {
        const { oshi, danger } = color.semantic;
        for (const pink of [oshi.solid, oshi.text, oshi.border, oshi.subtle, danger.solid, danger.text]) {
            expect(distance(memories.rarity.r, pink), pink).toBeGreaterThanOrEqual(60);
        }
        // A different hue family from the magenta 推 pink, not a shade of it.
        expect(hueGap(memories.rarity.r, oshi.solid)).toBeGreaterThanOrEqual(30);
        expect(hueGap(memories.rarity.r, oshi.text)).toBeGreaterThanOrEqual(30);
    });

    it('keeps the ordinary dark text readable on the rarity fills, the note and the dawn sky', () => {
        const dawn = hexesOf(memories.sky)[0];
        for (const fill of [memories.rarity.n, memories.rarity.r, memories.note, dawn]) {
            expect(contrast(color.text.primary, fill), fill).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('inks the whole radio night at 4.5:1 and lights the on-air lamp at 3:1 (non-text) on it', () => {
        const [midnight] = hexesOf(memories.night);
        const lavender = aurora.stops[1];
        const stops = [midnight, brandInk[900], mix(lavender, 0.12, brandInk[900])];
        for (const stop of stops) {
            expect(contrast(memories.nightInk, stop), stop).toBeGreaterThanOrEqual(4.5);
            expect(contrast(memories.onAir, stop), stop).toBeGreaterThanOrEqual(3);
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
        ['backgroundImage', 'memories-sky', '--ds-mem-sky'],
        ['backgroundColor', 'memories-note', '--ds-mem-note'],
    ])('%s has %s', (name, key, variable) => {
        expect(section(name)).toContain(`'${key}': 'var(${variable})'`);
    });

    it('offers the on-air lamp as a fill only, never as a text colour (it is under 4.5:1 for text)', () => {
        expect(section('textColor')).not.toContain('memories-onair');
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
