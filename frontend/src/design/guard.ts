/**
 * Ratchet against hard-coded style values outside the design tokens.
 *
 * Counted per file: hex colours, rgb()/hsl() literals, Tailwind arbitrary
 * values for radius, shadow, text and spacing, the D1 group role utilities
 * superseded by `*-accent-*`, and Tailwind's rounded-2xl / rounded-3xl
 * (outside the six radius steps). Width/height/position arbitrary
 * values are allowed (fixed layout sizes are legitimate). Comments are
 * stripped first. guard.test.ts compares the counts with guard-baseline.json:
 * new files must be clean, and existing counts may only go down.
 *
 * A second ratchet (`countLoadingViolations`, `isLoadingScanned`) counts
 * hand-built loading indicators outside `design/primitives/`: raw
 * `animate-spin` and `common.loading` used as text. It is compared
 * with loading-guard-baseline.json under the same rules.
 *
 * A third ratchet (`countDriftViolations`, `isDriftScanned`, UI health #14) counts what the
 * first one missed: named palette classes, `z-40`/`z-50`/`z-[...]`, Tailwind's default font sizes,
 * arbitrary values for leading/tracking/duration/delay/ease and colour-like utilities, and
 * hex/`rgb()`/`hsl()` literals in CSS files and `tailwind.config.js`. It is compared with
 * drift-guard-baseline.json under the same rules.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PATTERNS: readonly RegExp[] = [
    /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
    /\b(?:rgba?|hsla?)\(/g,
    /(?<![\w-])-?(?:rounded(?:-[a-z]{1,2})?|shadow|text|[pm][trblxyse]?|gap(?:-[xy])?|space-[xy])-\[/g,
    /(?<![\w-])(?:bg-group-(?:accent|badge|subtle)|text-group-strong|border-group-subtle|ring-group(?![\w-])|accent-group|shadow-group-glow)(?![\w-])/g,
    // Tailwind's 2xl (16 px) and 3xl (24 px) sit outside the six radius steps (2xl reads larger than token xl).
    /(?<![\w-])rounded(?:-[trblxyse]{1,2})?-(?:2xl|3xl)(?![\w-])/g,
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

function countPatterns(source: string, patterns: readonly RegExp[]): number {
    const code = stripComments(source);
    return patterns.reduce((sum, pattern) => sum + (code.match(pattern)?.length ?? 0), 0);
}

export function countViolations(source: string): number {
    return countPatterns(source, PATTERNS);
}

/**
 * Hand-built loading indicators: a raw spin (any variant prefix counts once) and any use of the
 * `common.loading` text (a child, a prop such as `sub=`, a ternary, a variable), except as the
 * accessible name of a primitive (`aria-label={t('common.loading')}`, `label={t('common.loading')}`).
 */
export const LOADING_PATTERNS: readonly RegExp[] = [
    /(?<![\w-])animate-spin(?![\w-])/g,
    /(?<!(?:aria-label|label)=\{\s*)\bt\(\s*['"]common\.loading['"]\s*\)/g,
];

export function countLoadingViolations(source: string): number {
    return countPatterns(source, LOADING_PATTERNS);
}

const PALETTE = '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const COLOUR_UTILITY = '(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)';

/** UI health #14: drift the style ratchet did not count. Width/height/position/aspect arbitrary values stay allowed. */
export const DRIFT_PATTERNS: readonly RegExp[] = [
    new RegExp(`(?<![\\w-])-?${COLOUR_UTILITY}-${PALETTE}-\\d{2,3}(?:\\/\\d{1,3})?(?![\\w-])`, 'g'),
    new RegExp(`(?<![\\w-])${COLOUR_UTILITY}-(?:black|white)(?:\\/\\d{1,3})?(?![\\w-])`, 'g'),
    /(?<![\w-])-?z-(?:40|50|\[)/g,
    /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g,
    /(?<![\w-])(?:leading|tracking|duration|delay|ease|bg|border(?:-[trblxy])?|ring|outline|fill|stroke|from|via|to|decoration|blur)-\[/g,
];
/** Colour literals (the first two style PATTERNS), counted in CSS files and the Tailwind config. */
const COLOUR_LITERALS: readonly RegExp[] = [PATTERNS[0], PATTERNS[1]];

export function countDriftViolations(source: string, relPath = ''): number {
    return countPatterns(source, /\.css$|tailwind\.config\.js$/.test(relPath) ? COLOUR_LITERALS : DRIFT_PATTERNS);
}

export function isScanned(relPath: string): boolean {
    if (!/\.tsx?$/.test(relPath) || relPath.endsWith('.d.ts')) return false;
    if (/\.(test|spec)\.tsx?$/.test(relPath)) return false;
    if (EXCLUDED_FILES.has(relPath)) return false;
    return !EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

/** Same files as `isScanned`, minus `design/primitives/` (the primitives own the loading animation). */
export function isLoadingScanned(relPath: string): boolean {
    return isScanned(relPath) && !relPath.startsWith('design/primitives/');
}

/** The style ratchet's files plus every CSS file under src (index.css, callScreen.css, callPopup.css). */
export function isDriftScanned(relPath: string): boolean {
    if (relPath.endsWith('.css')) return true;
    return isScanned(relPath);
}

export function scanTree(
    srcRoot: string,
    count: (source: string, relPath: string) => number = countViolations,
    scanned: (relPath: string) => boolean = isScanned,
): Record<string, number> {
    const result: Record<string, number> = {};
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            const rel = path.relative(srcRoot, full).split(path.sep).join('/');
            if (!scanned(rel)) continue;
            const n = count(readFileSync(full, 'utf-8'), rel);
            if (n > 0) result[rel] = n;
        }
    };
    walk(srcRoot);
    return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

/** How `compareToBaseline` words its problems for one ratchet. */
export interface BaselineLabels {
    /** What is counted, e.g. "hard-coded style value(s)". */
    noun: string;
    /** What to do instead. */
    hint: string;
    /** The baseline file, relative to `frontend/`. */
    path: string;
}

export const STYLE_LABELS: BaselineLabels = {
    noun: 'hard-coded style value(s)',
    hint: 'use design tokens (docs/design/DESIGN_SYSTEM.md)',
    path: 'src/design/guard-baseline.json',
};

export const LOADING_LABELS: BaselineLabels = {
    noun: 'hand-built loading indicator(s)',
    hint: 'use Spinner / StatusBlock (docs/design/DESIGN_SYSTEM.md, "Loading and waiting")',
    path: 'src/design/loading-guard-baseline.json',
};

export const DRIFT_LABELS: BaselineLabels = {
    noun: 'palette / layering / arbitrary value(s) or CSS colour literal(s)',
    hint: 'use tokens, Z_INDEX and the type scale (docs/design/DESIGN_SYSTEM.md)',
    path: 'src/design/drift-guard-baseline.json',
};

export function compareToBaseline(
    current: Record<string, number>,
    baseline: Record<string, number>,
    exists: (relPath: string) => boolean,
    labels: BaselineLabels = STYLE_LABELS,
): string[] {
    const { noun, hint, path: baselinePath } = labels;
    const problems: string[] = [];
    for (const [file, count] of Object.entries(current)) {
        const allowed = baseline[file];
        if (allowed === undefined) {
            problems.push(`${file}: ${count} ${noun} in a new file — ${hint}`);
        } else if (count > allowed) {
            problems.push(`${file}: ${count} ${noun}, baseline allows ${allowed} — ${hint}`);
        } else if (count < allowed) {
            problems.push(`${file}: improved to ${count} (baseline ${allowed}) — lower it in ${baselinePath}`);
        }
    }
    for (const [file, allowed] of Object.entries(baseline)) {
        if (file in current) continue;
        problems.push(
            exists(file)
                ? `${file}: improved to 0 (baseline ${allowed}) — remove it from ${baselinePath}`
                : `${file}: listed in ${baselinePath} but the file no longer exists — remove the entry`,
        );
    }
    return problems;
}
