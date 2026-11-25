// Runs in jsdom like guard.test.ts (node:fs works there too).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return sources(full);
        return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
    });
}

/** True when a source line keeps whitespace (class or inline style) without a way to break a long run. */
export function keepsWhitespaceWithoutBreak(line: string): boolean {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false; // comments describe, they do not style
    const classPre = /whitespace-pre(-wrap|-line)?(?![\w-])/.test(line);
    const stylePre = /whiteSpace\s*:\s*['"`](pre-wrap|pre-line|pre)['"`]/.test(line);
    // Bare `pre` never wraps, so break-words/overflow-wrap do nothing: it needs a scroller (or pre-wrap).
    const barePre = /whitespace-pre(?![\w-])/.test(line);
    if (barePre) return !/overflow-(x-)?(auto|scroll)(?![\w-])/.test(line);
    if (classPre && !/break-(words|all)/.test(line)) return true;
    if (/whiteSpace\s*:\s*['"`]pre['"`]/.test(line)) return !/overflowX\s*:\s*['"`](auto|scroll)['"`]/.test(line);
    return stylePre && !/overflowWrap|wordBreak/.test(line);
}

describe('pre-wrapped text can break long runs (UI health #4)', () => {
    it('every whitespace-pre / pre-wrap / pre-line class list or style also has a way to break long runs', () => {
        const offenders: string[] = [];
        for (const file of sources(SRC)) {
            readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
                if (keepsWhitespaceWithoutBreak(line)) {
                    offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${i + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});

describe('the pre-wrap scan itself', () => {
    it.each([
        ['<p className="whitespace-pre text-body">', true],
        ['<p className="whitespace-pre-wrap text-body">', true],
        ['<p className="whitespace-pre-line text-body">', true],
        ["<p style={{ whiteSpace: 'pre-wrap' }}>", true],
        ["<p style={{ whiteSpace: 'pre' }}>", true],
        ["<p style={{ whiteSpace: 'pre', overflowWrap: 'anywhere' }}>", true],
        ["<p style={{ whiteSpace: 'pre', overflowX: 'auto' }}>", false],
        ["<p style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>", false],
        ['<p className="whitespace-pre-wrap break-words">', false],
        ['<p className="whitespace-pre break-all">', true],
        ['<p className="whitespace-pre break-words">', true],
        ['<p className="whitespace-pre overflow-x-auto">', false],
        ['<p className="whitespace-pre overflow-auto">', false],
        ['<p className="whitespace-pre overflow-x-hidden">', true],
        ['<p className="whitespace-pre-wrapper">', false],
        ['<p className="whitespace-nowrap">', false],
        ['// whitespace-pre-wrap is described here', false],
    ])('%s -> offender: %s', (line, offends) => {
        expect(keepsWhitespaceWithoutBreak(line)).toBe(offends);
    });
});
