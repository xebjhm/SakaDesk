// Runs in the default jsdom environment on purpose: src/__tests__/setup.ts touches
// `window`, so switching to the node environment would crash; node:fs works in jsdom too.
// (Do not write the environment pragma in this comment: vitest would parse it.)
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compareToBaseline, countViolations, isScanned, scanTree } from './guard';

const SRC = path.resolve(__dirname, '..');
const BASELINE = path.resolve(__dirname, 'guard-baseline.json');

describe('countViolations', () => {
    it.each([
        ["const c = '#7cc7e8';", 1],
        ["const c = '#FFF'; const d = '#ffffffcc';", 2],
        ["style={{ color: 'rgba(0, 0, 0, .5)', background: 'hsl(10 20% 30%)' }}", 2],
        ['className="rounded-[10px] shadow-[0_0_4px] text-[13px] p-[3px] -mt-[2px] gap-x-[5px] space-y-[7px]"', 7],
        ['className="hover:rounded-tl-[6px] md:px-[10px]"', 2],
        ['<input accept="image/*" style={{ color: "#fff" }} />\n{/* note */}', 1],
        ["const s = '// not a comment #abc';", 1],
        ["const t = `a /* b */ #123456`;", 1],
        ["x = 'a' // #fff\n", 0],
    ])('counts %s as %i', (source, count) => {
        expect(countViolations(source)).toBe(count);
    });

    it.each([
        'className="rounded-card shadow-sheet text-body text-primary p-4 gap-3"',
        'className="w-[320px] h-[568px] top-[12px] max-w-[9rem]"',
        '// see #123 and #abc\n/* #fff rgba( */ const x = 1;',
        '{/* rounded-[4px] */}',
        "const url = 'https://example.com/a';",
        "const label = '日向坂 🌸';",
    ])('ignores %s', (source) => {
        expect(countViolations(source)).toBe(0);
    });
});

describe('isScanned', () => {
    it.each([
        ['features/messages/components/MessageBubble.tsx', true],
        ['shell/App.tsx', true],
        ['design/primitives/Card.tsx', true],
        ['design/DesignPage.tsx', true],
        ['design/tokens/groups.ts', false],
        ['design/guard.ts', false],
        ['config/serviceThemes.ts', false],
        ['config/colors/palette.ts', false],
        ['shell/App.test.tsx', false],
        ['__tests__/mocks/handlers.ts', false],
        ['vite-env.d.ts', false],
        ['i18n/locales/en.json', false],
    ])('%s -> %s', (rel, want) => {
        expect(isScanned(rel)).toBe(want);
    });
});

describe('compareToBaseline', () => {
    const exists = () => true;

    it('passes when counts match', () => {
        expect(compareToBaseline({ 'a.tsx': 2 }, { 'a.tsx': 2 }, exists)).toEqual([]);
    });
    it('fails on a file that is not in the baseline', () => {
        expect(compareToBaseline({ 'new.tsx': 1 }, {}, exists)).toEqual([
            'new.tsx: 1 hard-coded style value(s) in a new file — use design tokens (docs/design/DESIGN_SYSTEM.md)',
        ]);
    });
    it('fails when a count goes up', () => {
        expect(compareToBaseline({ 'a.tsx': 3 }, { 'a.tsx': 2 }, exists)).toEqual([
            'a.tsx: 3 hard-coded style value(s), baseline allows 2 — use design tokens (docs/design/DESIGN_SYSTEM.md)',
        ]);
    });
    it('fails until a lower count is written back', () => {
        expect(compareToBaseline({ 'a.tsx': 1 }, { 'a.tsx': 2 }, exists)).toEqual([
            'a.tsx: improved to 1 (baseline 2) — lower it in src/design/guard-baseline.json',
        ]);
        expect(compareToBaseline({}, { 'a.tsx': 2 }, exists)).toEqual([
            'a.tsx: improved to 0 (baseline 2) — remove it from src/design/guard-baseline.json',
        ]);
    });
    it('fails on an entry whose file is gone', () => {
        expect(compareToBaseline({}, { 'gone.tsx': 2 }, () => false)).toEqual([
            'gone.tsx: listed in src/design/guard-baseline.json but the file no longer exists — remove the entry',
        ]);
    });
});

describe('repository', () => {
    it('matches src/design/guard-baseline.json', () => {
        const current = scanTree(SRC);
        if (process.env.UPDATE_GUARD_BASELINE) {
            writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n', 'utf-8');
            return;
        }
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Record<string, number>;
        expect(compareToBaseline(current, baseline, (rel) => existsSync(path.join(SRC, rel)))).toEqual([]);
    });

    it('has no design-system file in the baseline', () => {
        const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8')) as Record<string, number>;
        expect(Object.keys(baseline).filter((rel) => rel.startsWith('design/'))).toEqual([]);
    });
});
