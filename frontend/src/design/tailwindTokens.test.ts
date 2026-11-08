import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROUP_IDS } from './tokens';
import { staticTokenVars, groupTokenVars } from './cssVars';

// __dirname, not import.meta.url: under vitest's jsdom environment import.meta.url is not a file: URL.
const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('tailwind.config.js token utilities', () => {
    it('only references --ds- variables that applyTokens writes', () => {
        const written = new Set([...Object.keys(staticTokenVars()), ...Object.keys(groupTokenVars(GROUP_IDS[0]))]);
        const referenced = [...config.matchAll(/var\((--ds-[a-z0-9-]+)\)/g)].map((m) => m[1]);
        expect(referenced.length).toBeGreaterThan(30);
        expect(referenced.filter((name) => !written.has(name))).toEqual([]);
    });
});

describe('accent and expressive utilities', () => {
    const expected: Array<[section: string, key: string, variable: string]> = [
        ['backgroundColor', 'accent', '--ds-accent'],
        ['backgroundColor', "'accent-subtle'", '--ds-accent-subtle'],
        ['backgroundImage', "'accent-gradient'", '--ds-accent-gradient'],
        ['backgroundImage', "'accent-wash'", '--ds-accent-wash'],
        ['backgroundImage', "'accent-tonal'", '--ds-accent-tonal'],
        ['backgroundImage', "'expressive-soft'", '--ds-expressive-soft'],
        ['backgroundImage', "'expressive-header'", '--ds-expressive-header'],
        ['backgroundImage', "'expressive-header-bar'", '--ds-expressive-header-bar'],
        ['backgroundImage', "'expressive-progress'", '--ds-expressive-progress'],
        ['ringColor', "'accent-logo'", '--ds-accent-logo'],
        ['ringColor', "'accent-subtle'", '--ds-accent-subtle'],
        ['backgroundImage', "'expressive-orb-1'", '--ds-expressive-orb-1'],
        ['backgroundImage', "'expressive-orb-2'", '--ds-expressive-orb-2'],
        ['backgroundImage', "'expressive-orb-3'", '--ds-expressive-orb-3'],
        ['backgroundImage', 'aurora', '--ds-aurora'],
        ['textColor', 'accent', '--ds-accent'],
        ['textColor', "'accent-strong'", '--ds-accent-strong'],
        ['textColor', "'accent-tonal'", '--ds-accent-tonal-text'],
        ['textColor', "'expressive-header'", '--ds-expressive-header-text'],
        ['borderColor', "'accent-border'", '--ds-accent-border'],
        ['borderColor', "'accent-wash'", '--ds-accent-wash-border'],
        ['textColor', "'semantic-oshi-solid'", '--ds-semantic-oshi-solid'],
        ['borderColor', 'accent', '--ds-accent'],
        ['backgroundColor', "'semantic-oshi-subtle'", '--ds-semantic-oshi-subtle'],
        ['backgroundColor', "'semantic-oshi-solid'", '--ds-semantic-oshi-solid'],
        ['textColor', "'semantic-oshi'", '--ds-semantic-oshi-text'],
        ['borderColor', "'semantic-oshi'", '--ds-semantic-oshi-border'],
        ['ringColor', "'semantic-oshi'", '--ds-semantic-oshi-border'],
        ['fill', "'semantic-oshi'", '--ds-semantic-oshi-solid'],
        ['textColor', "'semantic-star'", '--ds-semantic-star'],
        ['ringColor', 'accent', '--ds-accent'],
        ['backgroundColor', "'semantic-success-subtle'", '--ds-semantic-success-subtle'],
        ['backgroundColor', "'semantic-success-icon'", '--ds-semantic-success-icon'],
        ['textColor', "'semantic-success'", '--ds-semantic-success-text'],
        ['borderColor', "'semantic-success'", '--ds-semantic-success-border'],
        ['backgroundColor', "'semantic-warning-subtle'", '--ds-semantic-warning-subtle'],
        ['backgroundColor', "'semantic-warning-icon'", '--ds-semantic-warning-icon'],
        ['textColor', "'semantic-warning'", '--ds-semantic-warning-text'],
        ['borderColor', "'semantic-warning'", '--ds-semantic-warning-border'],
        ['backgroundColor', "'semantic-danger-subtle'", '--ds-semantic-danger-subtle'],
        ['backgroundColor', "'semantic-danger-icon'", '--ds-semantic-danger-icon'],
        ['textColor', "'semantic-danger'", '--ds-semantic-danger-text'],
        ['borderColor', "'semantic-danger'", '--ds-semantic-danger-border'],
        ['backgroundColor', "'semantic-info-subtle'", '--ds-semantic-info-subtle'],
        ['backgroundColor', "'semantic-info-icon'", '--ds-semantic-info-icon'],
        ['textColor', "'semantic-info'", '--ds-semantic-info-text'],
        ['borderColor', "'semantic-info'", '--ds-semantic-info-border'],
        ['backgroundColor', "'status-danger'", '--ds-semantic-danger-solid'],
        ['backgroundColor', "'status-success'", '--ds-semantic-success-solid'],
        ['backgroundColor', "'status-attention'", '--ds-semantic-warning-solid'],
        ['textColor', "'status-danger'", '--ds-semantic-danger-text'],
        ['textColor', "'status-success'", '--ds-semantic-success-text'],
        ['textColor', "'status-warning'", '--ds-semantic-warning-text'],
        ['boxShadow', "'accent-glow'", '--ds-shadow-accent-glow'],
        ['boxShadow', "'accent-halo'", '--ds-shadow-accent-halo'],
        ['boxShadow', "'accent-glow-hover'", '--ds-shadow-accent-glow-hover'],
        ['boxShadow', "'accent-unread'", '--ds-shadow-accent-unread'],
        ['accentColor', 'accent', '--ds-accent'],
        ['borderRadius', 'none', '--ds-radius-none'],
        ['borderRadius', 'xs', '--ds-radius-xs'],
        ['borderRadius', 'sm', '--ds-radius-sm'],
        ['borderRadius', 'md', '--ds-radius-md'],
        ['borderRadius', 'lg', '--ds-radius-lg'],
        ['borderRadius', 'xl', '--ds-radius-xl'],
        ['borderRadius', 'full', '--ds-radius-full'],
        ['borderRadius', 'tail', '--ds-radius-tail'],
        ['borderRadius', 'card', '--ds-radius-card'],
        ['borderRadius', 'sheet', '--ds-radius-sheet'],
        ['borderRadius', 'pill', '--ds-radius-pill'],
        ['fontFamily', 'sans', '--ds-font-family-sans'],
        ['fontFamily', 'display', '--ds-font-family-serif'],
        // Blog feed tile (e4e4118 look).
        ['fontSize', "'tile-date'", '--ds-blog-font-tile-date'],
        ['fontSize', "'tile-date-lg'", '--ds-blog-font-tile-date-lg'],
        ['fontSize', "'tile-title'", '--ds-blog-font-tile-title'],
        ['fontSize', "'tile-title-lg'", '--ds-blog-font-tile-title-lg'],
        ['fontSize', "'tile-name'", '--ds-blog-font-tile-name'],
        ['fontSize', "'tile-name-lg'", '--ds-blog-font-tile-name-lg'],
        ['boxShadow', 'tile', '--ds-blog-shadow-tile'],
        ['boxShadow', "'tile-hover'", '--ds-shadow-accent-tile'],
        ['boxShadow', 'caption', '--ds-blog-shadow-caption'],
        ['boxShadow', "'caption-hover'", '--ds-shadow-accent-caption'],
        ['backgroundColor', "'tile-glass'", '--ds-blog-glass'],
        ['borderColor', "'tile-glass'", '--ds-blog-glass-border'],
        ['transitionDuration', 'lift', '--ds-duration-lift'],
        ['transitionDuration', 'zoom', '--ds-duration-zoom'],
        ['transitionTimingFunction', 'spring', '--ds-ease-spring'],
        ['backgroundColor', "'segment-track'", '--ds-blog-segment-track'],
        ['boxShadow', 'segment', '--ds-blog-shadow-segment'],
        ['fontSize', 'segment', '--ds-blog-font-segment'],
        ['backgroundColor', "'accent-strong'", '--ds-accent-strong'],
        ['borderColor', "'accent-strong'", '--ds-accent-strong'],
        ['boxShadow', "'accent-beacon'", '--ds-shadow-accent-beacon'],
        ['transitionDuration', 'lens', '--ds-duration-lens'],
    ];
    const sectionBody = (name: string) => {
        const start = config.indexOf(`${name}: {`);
        return config.slice(start, config.indexOf('\n            },', start));
    };

    it.each(expected)('%s.%s maps to var(%s)', (section, key, variable) => {
        expect(sectionBody(section)).toContain(`${key}: 'var(${variable})'`);
    });

    it('fontSize.display uses the display size and leading variables', () => {
        const body = sectionBody('fontSize');
        expect(body).toContain('var(--ds-font-display-size)');
        expect(body).toContain('var(--ds-font-display-leading)');
    });

    it('every accent variable is written by the token maps', () => {
        const written = new Set([...Object.keys(staticTokenVars()), ...Object.keys(groupTokenVars(GROUP_IDS[0]))]);
        expect(expected.filter(([, , v]) => !written.has(v))).toEqual([]);
    });

    it('defines the 0.97 press scale', () => {
        expect(config).toMatch(/scale: \{\s*97: '0\.97',/);
    });

    it('defines the mask-fade-y utility as an alpha-only vertical fade', () => {
        expect(config).toContain("'.mask-fade-y': { maskImage: fadeY, WebkitMaskImage: fadeY }");
        expect(config).toContain("const fadeY = 'linear-gradient(to bottom, transparent 0%, black 20%, black 65%, transparent 100%)';");
    });
});
