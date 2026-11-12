import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Blog screen files restyled in D2b (later tasks append). The blog dialogs are D2c.
 * The guard counts literals; this catches what it does not: named palette classes,
 * colours set through inline styles, and the legacy blog theme.
 */
const FILES = [
    'BlogsFeature.tsx',
    'blogLog.ts',
    'components/RecentPostsFeed.tsx',
    'components/BlogCard.tsx',
    '../../core/common/DynamicBackground.tsx',
    'components/BlogReader.tsx',
    'components/blogProse.ts',
    'memberWash.ts',
    'hooks/useInlineBlogTranslations.ts',
    'components/TimelineRail.tsx',
    'components/BlogNavFooter.tsx',
];

const PALETTE = /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|from|via|to|fill|stroke|decoration|outline|divide)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g;
const COLOUR_STYLE = /\b(?:color|background|backgroundColor|borderColor|boxShadow)\s*:/g;

describe.each(FILES)('%s', (file) => {
    const source = readFileSync(path.resolve(__dirname, file), 'utf-8');

    it('uses no named palette classes', () => {
        expect(source.match(PALETTE) ?? []).toEqual([]);
    });

    it('sets no colour through inline styles', () => {
        expect(source.match(COLOUR_STYLE) ?? []).toEqual([]);
    });

    it('does not read the legacy blog theme', () => {
        expect(source).not.toMatch(/useBlogTheme|serviceThemes/);
    });
});
