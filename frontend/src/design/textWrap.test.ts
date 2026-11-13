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

describe('pre-wrapped text can break long runs (UI health #4)', () => {
    it('every whitespace-pre-wrap / pre-line class list also has break-words or break-all', () => {
        const offenders: string[] = [];
        for (const file of sources(SRC)) {
            readFileSync(file, 'utf-8').split('\n').forEach((line, i) => {
                if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments describe, they do not style
                if (/whitespace-pre-(wrap|line)/.test(line) && !/break-(words|all)/.test(line)) {
                    offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${i + 1}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
