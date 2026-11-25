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

// The bare call, with a type argument or whitespace, or an identity selector (`(s) => s`, `s => s`):
// every form that subscribes to the whole store.
const WHOLE_STORE = /useAppStore\s*(?:<[^>]*>)?\s*\(\s*(?:(?:\(\s*(\w+)\s*\)|(\w+))\s*=>\s*(?:\1|\2)\s*)?\)/;

const withoutCommentLines = (text: string) => text.split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');

describe('useAppStore subscriptions', () => {
    it('the whole-store pattern catches every form and spares real selectors', () => {
        for (const bad of ['useAppStore()', 'useAppStore<AppState>()', 'useAppStore( )', 'useAppStore ( )',
            'useAppStore((s) => s)', 'useAppStore(s => s)', 'useAppStore( ( state ) =>  state )']) {
            expect(WHOLE_STORE.test(bad), bad).toBe(true);
        }
        for (const good of ['useAppStore((s) => s.activeService)', 'useAppStore(s => s.x)', 'useAppStore(useShallow((s) => ({ a: s.a })))',
            'useAppStore.getState()', 'useAppStore.setState({})', 'useAppStore((a) => b)']) {
            expect(WHOLE_STORE.test(good), good).toBe(false);
        }
    });

    it('no source file subscribes to the whole store', () => {
        const offenders = sources(SRC)
            .filter((file) => WHOLE_STORE.test(withoutCommentLines(readFileSync(file, 'utf-8'))))
            .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
        expect(offenders).toEqual([]);
    });
});
