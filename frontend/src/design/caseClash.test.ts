import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Windows and macOS file systems are case-insensitive: two modules in one folder whose names
 * differ only by case (or by a `.ts` / `.tsx` extension on the same base) resolve to the same
 * import there (`./Postcard` picking `postcard.ts`), and the Windows build breaks. Every path
 * under `src`, and every import base in one folder, must be unique ignoring case.
 */
const SRC = path.resolve(__dirname, '..');
const MODULE_EXT = /\.(tsx?|jsx?)$/;

function clashes(dir: string, out: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    const seen = new Map<string, string>();
    for (const entry of entries) {
        // a module's import key: its name without the extension, ignoring case
        const key = (entry.isFile() ? entry.name.replace(MODULE_EXT, '') : entry.name).toLowerCase();
        const other = seen.get(key);
        if (other !== undefined) out.push(`${path.relative(SRC, dir)}: ${other} / ${entry.name}`);
        else seen.set(key, entry.name);
        if (entry.isDirectory()) clashes(path.join(dir, entry.name), out);
    }
}

describe('case-insensitive file names', () => {
    it('has no two paths (or import bases) under src that differ only by case', () => {
        const out: string[] = [];
        clashes(SRC, out);
        expect(out).toEqual([]);
    });
});
