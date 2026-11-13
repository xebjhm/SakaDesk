import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// `useAppStore()` without a selector re-renders on every change anywhere in the store
// (UI health P-A4). Components select fields (or `useShallow`) instead.
const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return sources(full);
        return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
    });
}

describe('useAppStore subscriptions', () => {
    it('no source file subscribes to the whole store', () => {
        const offenders = sources(SRC)
            .filter((file) => readFileSync(file, 'utf-8')
                .split('\n')
                .some((line) => /useAppStore\(\)/.test(line) && !/^\s*(\/\/|\*)/.test(line)))
            .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
        expect(offenders).toEqual([]);
    });
});
