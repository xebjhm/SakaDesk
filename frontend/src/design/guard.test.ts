// Runs in the default jsdom environment on purpose: src/__tests__/setup.ts touches
// `window`, so switching to the node environment would crash; node:fs works in jsdom too.
// (Do not write the environment pragma in this comment: vitest would parse it.)
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    DRIFT_LABELS, LOADING_LABELS, compareToBaseline, countDriftViolations, countLoadingViolations, countViolations,
    isDriftScanned, isLoadingScanned, isScanned, scanTree,
} from './guard';

const SRC = path.resolve(__dirname, '..');
const BASELINE = path.resolve(__dirname, 'guard-baseline.json');
const LOADING_BASELINE = path.resolve(__dirname, 'loading-guard-baseline.json');

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
        ['className="rounded-2xl rounded-t-3xl hover:rounded-bl-2xl"', 3],
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
        'className="rounded-xl rounded-lg rounded-b-md rounded-tl-xs rounded-full"',
    ])('ignores %s', (source) => {
        expect(countViolations(source)).toBe(0);
    });
});

describe('superseded group role utilities', () => {
    it('counts superseded group role utilities but not the official layer', () => {
        expect(countViolations('className="bg-group-accent text-group-strong ring-group"')).toBe(3);
        expect(countViolations('className="bg-group-title text-group-title bg-group-canvas ring-group-logo"')).toBe(0);
        expect(countViolations('className="bg-accent text-accent-strong ring-accent"')).toBe(0);
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

describe('countLoadingViolations', () => {
    it.each([
        ['<Loader2 className="h-4 w-4 animate-spin" />', 1],
        ['className="animate-spin motion-reduce:animate-none"', 1],
        ['className="motion-safe:animate-spin"', 1],
        ["const spin = cn('animate-spin', a); const b = 'animate-spin';", 2],
        ["<p className=\"text-muted\">{t('common.loading')}</p>", 1],
        ['<div role="status">\n    {t("common.loading")}\n</div>', 1],
        ["<span>{t( 'common.loading' )}</span>", 1],
        ["<CardFace sub={t('common.loading')} />", 1],
        ["{isClearing ? t('common.loading') : t('settings.cleanBlogCache')}", 1],
        ["const label = t('common.loading');", 1],
    ])('counts %s as %i', (source, count) => {
        expect(countLoadingViolations(source)).toBe(count);
    });

    it.each([
        "<Spinner aria-label={t('common.loading')} />",
        "<Spinner label={t('common.loading')} />",
        "<ProgressBar label={ t('common.loading') } />",
        'className="animate-spinner animate-pulse spin-animate-spin-x"',
        '// animate-spin\n/* {t(\'common.loading\')} */ const x = 1;',
        "{/* <Loader2 className=\"animate-spin\" /> */}",
        "<p>{t('loading.label')}</p>",
        "const label = '読み込み中…🌸';",
    ])('ignores %s', (source) => {
        expect(countLoadingViolations(source)).toBe(0);
    });
});

describe('isLoadingScanned', () => {
    it.each([
        ['features/messages/components/MessageList.tsx', true],
        ['core/common/InlineTranslation.tsx', true],
        ['design/DesignPage.tsx', true],
        ['design/primitives/Spinner.tsx', false],
        ['design/primitives/Button.tsx', false],
        ['design/guard.ts', false],
        ['design/tokens/motion.ts', false],
        ['shell/App.test.tsx', false],
        ['vite-env.d.ts', false],
    ])('%s -> %s', (rel, want) => {
        expect(isLoadingScanned(rel)).toBe(want);
    });
});

describe('compareToBaseline with loading labels', () => {
    it('names loading indicators and the loading baseline', () => {
        expect(compareToBaseline({ 'new.tsx': 1 }, {}, () => true, LOADING_LABELS)).toEqual([
            'new.tsx: 1 hand-built loading indicator(s) in a new file — use Spinner / StatusBlock (docs/design/DESIGN_SYSTEM.md, "Loading and waiting")',
        ]);
        expect(compareToBaseline({ 'a.tsx': 1 }, { 'a.tsx': 2 }, () => true, LOADING_LABELS)).toEqual([
            'a.tsx: improved to 1 (baseline 2) — lower it in src/design/loading-guard-baseline.json',
        ]);
    });
});

describe('loading ratchet repository', () => {
    it('matches src/design/loading-guard-baseline.json', () => {
        const current = scanTree(SRC, countLoadingViolations, isLoadingScanned);
        if (process.env.UPDATE_LOADING_BASELINE) {
            writeFileSync(LOADING_BASELINE, JSON.stringify(current, null, 2) + '\n', 'utf-8');
            return;
        }
        const baseline = JSON.parse(readFileSync(LOADING_BASELINE, 'utf-8')) as Record<string, number>;
        expect(compareToBaseline(current, baseline, (rel) => existsSync(path.join(SRC, rel)), LOADING_LABELS)).toEqual([]);
    });

    it('has no design-system file in the loading baseline', () => {
        const baseline = JSON.parse(readFileSync(LOADING_BASELINE, 'utf-8')) as Record<string, number>;
        expect(Object.keys(baseline).filter((rel) => rel.startsWith('design/'))).toEqual([]);
    });

    it('ends the loading-UX wave empty: no hand-built loading indicator is left anywhere (L7)', () => {
        expect(JSON.parse(readFileSync(LOADING_BASELINE, 'utf-8'))).toEqual({});
        expect(scanTree(SRC, countLoadingViolations, isLoadingScanned)).toEqual({});
    });
});

const DRIFT_BASELINE = path.resolve(__dirname, 'drift-guard-baseline.json');
const TAILWIND_CONFIG = path.resolve(SRC, '../tailwind.config.js');

describe('countDriftViolations (UI health #14)', () => {
    it.each([
        ['className="bg-gray-100 text-white hover:bg-black/40 border-red-500"', 4],
        ['className="z-40 z-50 z-[60] -z-[1]"', 4],
        ['className="text-xs text-sm text-2xl"', 3],
        ['className="leading-[1.3] tracking-[2px] duration-[350ms] delay-[50ms] ease-[cubic-bezier(0,0,1,1)] bg-[url(x)] blur-[100px]"', 7],
    ])('counts %s as %i', (source, count) => {
        expect(countDriftViolations(source, 'a.tsx')).toBe(count);
    });

    it.each([
        'className="bg-sheet text-primary text-small z-10 z-20 shadow-card"',
        'className="w-[320px] max-w-[min(80%,42rem)] aspect-[3/4] min-w-[95px]"',
        'className="text-accent-strong text-semantic-star text-viewer-muted"',
        '// bg-gray-100 in a comment',
    ])('ignores %s', (source) => {
        expect(countDriftViolations(source, 'a.tsx')).toBe(0);
    });

    it('counts colour literals in CSS', () => {
        expect(countDriftViolations('a { color: #fff; background: rgba(0,0,0,.5) } /* #000 */', 'x.css')).toBe(2);
    });

    it('does not count CSS keywords, system colours or transparent', () => {
        const css = '@media (forced-colors: active) { a { color: CanvasText; outline: 2px solid Highlight; background: Canvas } b { color: currentColor; background: transparent } }';
        expect(countDriftViolations(css, 'index.css')).toBe(0);
    });

    it('does not count inherit, but still counts a literal beside it', () => {
        expect(countDriftViolations('a { color: inherit; background: inherit; border-color: inherit }', 'index.css')).toBe(0);
        expect(countDriftViolations('a { color: inherit; background: #fff }', 'index.css')).toBe(1);
    });

    it('scans source and CSS files, not tests or token files', () => {
        expect(isDriftScanned('features/incomingCall/callScreen.css')).toBe(true);
        expect(isDriftScanned('core/media/VideoPlayer.tsx')).toBe(true);
        expect(isDriftScanned('core/media/VideoPlayer.test.tsx')).toBe(false);
        expect(isDriftScanned('design/tokens/color.ts')).toBe(false);
    });
});

describe('drift ratchet repository', () => {
    const current = () => {
        const found = scanTree(SRC, countDriftViolations, isDriftScanned);
        const configCount = countDriftViolations(readFileSync(TAILWIND_CONFIG, 'utf-8'), 'tailwind.config.js');
        return configCount > 0 ? { ...found, '../tailwind.config.js': configCount } : found;
    };

    it('matches src/design/drift-guard-baseline.json', () => {
        if (process.env.UPDATE_DRIFT_BASELINE) {
            writeFileSync(DRIFT_BASELINE, JSON.stringify(current(), null, 2) + '\n', 'utf-8');
            return;
        }
        const baseline = JSON.parse(readFileSync(DRIFT_BASELINE, 'utf-8')) as Record<string, number>;
        expect(compareToBaseline(current(), baseline, (rel) => existsSync(path.join(SRC, rel)), DRIFT_LABELS)).toEqual([]);
    });

    it('has no design-system file in the drift baseline', () => {
        const baseline = JSON.parse(readFileSync(DRIFT_BASELINE, 'utf-8')) as Record<string, number>;
        expect(Object.keys(baseline).filter((rel) => rel.startsWith('design/'))).toEqual([]);
    });

    it('accepts no drift in a file the UI-health plans F, G and H created', () => {
        // The baseline may hold only debt that existed before the UI-health wave (since d74c6725):
        // drift in a file created by it must be fixed with tokens, not baselined. This is the
        // non-test source files `git diff --name-only --diff-filter=A d74c6725 HEAD -- frontend/src`
        // lists at the time the baseline was written, relative to src.
        const createdInWave = [
            'core/layout/KeepMounted.tsx', 'core/layout/MemoriesChunkBoundary.tsx', 'core/media/StepButtons.tsx',
            'core/media/keyGuard.ts', 'design/dialog/useAnyDialogOpen.ts', 'design/featureActive.ts',
            'design/primitives/LiveRegion.tsx', 'design/primitives/announcer.ts',
            'features/blogs/components/stagger.ts', 'features/messages/components/SyncStatusPill.tsx',
            'features/messages/favoriteOverrides.ts', 'features/messages/roomCache.ts', 'hooks/useInert.ts',
            'hooks/useMediaQuery.ts', 'shell/components/SettingsErrorToast.tsx', 'shell/components/SkipLink.tsx',
            'shell/syncProgressStore.ts', 'utils/intlCache.ts', 'utils/shallowEqualRecord.ts',
        ];
        const baseline = JSON.parse(readFileSync(DRIFT_BASELINE, 'utf-8')) as Record<string, number>;
        expect(createdInWave.filter((rel) => rel in baseline)).toEqual([]);
    });
});
