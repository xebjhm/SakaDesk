import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Same pattern as core/dialogs.style.test.ts (VoicePlayer is not listed there: its accent mixes are inline by design).
const PALETTE = /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|from|via|to|fill|stroke|decoration|outline|divide|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g;
const source = readFileSync(path.resolve(__dirname, 'VoicePlayer.tsx'), 'utf-8');

describe('VoicePlayer neutrals (R-d)', () => {
    it('uses no named palette classes', () => {
        expect(source.match(PALETTE) ?? []).toEqual([]);
    });

    it('keeps only the skip button’s 9 px digit as an arbitrary text size', () => {
        expect(source.match(/text-\[\d+px\]/g)).toEqual(['text-[9px]']);
    });

    it('draws its gallery card on the sheet surface with a token shadow (pending decision D13)', () => {
        expect(source).toContain('bg-sheet rounded-lg p-3 outline-none focus:ring-2 shadow-card');
        expect(source).not.toMatch(/backdrop-blur-xl|\bshadow-(?:md|lg|xl)\b/);
    });
});
