/**
 * Ratchet against hard-coded style values outside the design tokens.
 *
 * Counted per file: hex colours, rgb()/hsl() literals, Tailwind arbitrary
 * values for radius, shadow, text and spacing, and the D1 group role utilities
 * superseded by `*-accent-*`. Width/height/position arbitrary
 * values are allowed (fixed layout sizes are legitimate). Comments are
 * stripped first. guard.test.ts compares the counts with guard-baseline.json:
 * new files must be clean, and existing counts may only go down.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PATTERNS: readonly RegExp[] = [
    /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
    /\b(?:rgba?|hsla?)\(/g,
    /(?<![\w-])-?(?:rounded(?:-[a-z]{1,2})?|shadow|text|[pm][trblxyse]?|gap(?:-[xy])?|space-[xy])-\[/g,
    /(?<![\w-])(?:bg-group-(?:accent|badge|subtle)|text-group-strong|border-group-subtle|ring-group(?![\w-])|accent-group|shadow-group-glow)(?![\w-])/g,
];

const EXCLUDED_PREFIXES = ['design/tokens/', 'config/colors/', '__tests__/'];
const EXCLUDED_FILES = new Set(['design/guard.ts', 'config/serviceThemes.ts']);

/**
 * Removes comments in a single pass, keeping string contents (hex colours live
 * inside strings, so they must still be counted). Rules:
 * - Tracks code, '...', "..." and `...` states; a backslash escapes the next
 *   character in all three string states. A whole template literal, including
 *   any ${...}, counts as string.
 * - Only in code state, a block comment is removed (its newlines are kept so
 *   line structure is preserved), and `//` starts a line comment that runs to
 *   the end of the line, unless the preceding character is `:` (keeps
 *   `https://...` in JSX text).
 * - Everything else is copied through unchanged.
 */
function stripComments(source: string): string {
    let out = '';
    let quote: string | null = null;
    let i = 0;
    while (i < source.length) {
        const ch = source[i];
        if (quote !== null) {
            out += ch;
            if (ch === '\\' && i + 1 < source.length) {
                out += source[i + 1];
                i += 2;
                continue;
            }
            if (ch === quote) quote = null;
            i += 1;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
            out += ch;
            i += 1;
            continue;
        }
        if (ch === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? source.length : end + 2;
            out += source.slice(i, stop).replace(/[^\n]/g, '');
            i = stop;
            continue;
        }
        if (ch === '/' && source[i + 1] === '/' && source[i - 1] !== ':') {
            const eol = source.indexOf('\n', i);
            i = eol === -1 ? source.length : eol;
            continue;
        }
        out += ch;
        i += 1;
    }
    return out;
}

export function countViolations(source: string): number {
    const code = stripComments(source);
    return PATTERNS.reduce((sum, pattern) => sum + (code.match(pattern)?.length ?? 0), 0);
}

export function isScanned(relPath: string): boolean {
    if (!/\.tsx?$/.test(relPath) || relPath.endsWith('.d.ts')) return false;
    if (/\.(test|spec)\.tsx?$/.test(relPath)) return false;
    if (EXCLUDED_FILES.has(relPath)) return false;
    return !EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

export function scanTree(srcRoot: string): Record<string, number> {
    const result: Record<string, number> = {};
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            const rel = path.relative(srcRoot, full).split(path.sep).join('/');
            if (!isScanned(rel)) continue;
            const count = countViolations(readFileSync(full, 'utf-8'));
            if (count > 0) result[rel] = count;
        }
    };
    walk(srcRoot);
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const HINT = 'use design tokens (docs/design/DESIGN_SYSTEM.md)';
const BASELINE_PATH = 'src/design/guard-baseline.json';

export function compareToBaseline(
    current: Record<string, number>,
    baseline: Record<string, number>,
    exists: (relPath: string) => boolean,
): string[] {
    const problems: string[] = [];
    for (const [file, count] of Object.entries(current)) {
        const allowed = baseline[file];
        if (allowed === undefined) {
            problems.push(`${file}: ${count} hard-coded style value(s) in a new file — ${HINT}`);
        } else if (count > allowed) {
            problems.push(`${file}: ${count} hard-coded style value(s), baseline allows ${allowed} — ${HINT}`);
        } else if (count < allowed) {
            problems.push(`${file}: improved to ${count} (baseline ${allowed}) — lower it in ${BASELINE_PATH}`);
        }
    }
    for (const [file, allowed] of Object.entries(baseline)) {
        if (file in current) continue;
        problems.push(
            exists(file)
                ? `${file}: improved to 0 (baseline ${allowed}) — remove it from ${BASELINE_PATH}`
                : `${file}: listed in ${BASELINE_PATH} but the file no longer exists — remove the entry`,
        );
    }
    return problems;
}
