import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blogFeed, groupAccent } from './tokens';
import { accentTokenVars, staticTokenVars } from './cssVars';

// The blog feed's original look (e4e4118), restored with tokens.
describe('blog feed tile tokens (e4e4118)', () => {
    it('keeps the e4e4118 caption sizes, shadows, glass and motion', () => {
        expect(blogFeed.type).toEqual({
            tileDate: '0.5rem', tileDateLg: '0.6rem', tileTitle: '0.75rem', tileTitleLg: '0.9rem',
            tileName: '0.6rem', tileNameLg: '0.7rem',
        });
        expect(blogFeed.shadow.tile).toBe('0 6px 24px -6px rgba(0, 0, 0, 0.12)');
        expect(blogFeed.shadow.caption).toBe('0 6px 20px -6px rgba(0, 0, 0, 0.1)');
        expect(blogFeed.glass).toBe('rgba(255, 255, 255, 0.92)');
        expect(blogFeed.glassBorder).toBe('rgba(255, 255, 255, 0.6)');
        expect(blogFeed.motion.duration).toEqual({ lift: 500, zoom: 700, lens: 300 });
    });

    it('keeps the e4e4118 All / Favorite segmented control values', () => {
        expect(blogFeed.segment).toEqual({ track: 'rgba(0, 0, 0, 0.05)', shadow: '0 1px 3px rgba(0, 0, 0, 0.1)', size: '0.75rem' });
        const v = staticTokenVars();
        expect(v['--ds-blog-segment-track']).toBe(blogFeed.segment.track);
        expect(v['--ds-blog-shadow-segment']).toBe(blogFeed.segment.shadow);
        expect(v['--ds-blog-font-segment']).toBe('0.75rem');
    });

    it('writes the static variables', () => {
        const v = staticTokenVars();
        expect(v['--ds-blog-font-tile-title-lg']).toBe('0.9rem');
        expect(v['--ds-blog-shadow-tile']).toBe(blogFeed.shadow.tile);
        expect(v['--ds-blog-vignette']).toBe('rgba(0, 0, 0, 0.05)');
        expect(v['--ds-duration-lift']).toBe('500ms');
        expect(v['--ds-duration-zoom']).toBe('700ms');
        expect(v['--ds-ease-spring']).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
    });

    it('restores the timeline rail lens and the current-post beacon', () => {
        const v = staticTokenVars();
        expect(v['--ds-duration-lens']).toBe('300ms');
        expect(v['--ds-rail-lens-y']).toBe('50%');
        const a = groupAccent('hinatazaka');
        expect(accentTokenVars(a)['--ds-shadow-accent-beacon']).toBe(
            `0 0 12px color-mix(in srgb, ${a.strong} 38%, transparent), 0 0 4px color-mix(in srgb, ${a.strong} 25%, transparent)`,
        );
    });

    it('glows the tile and caption on hover in the context logo colour', () => {
        const a = groupAccent('hinatazaka');
        const v = accentTokenVars(a);
        expect(v['--ds-shadow-accent-tile']).toBe(
            `0 16px 40px -10px color-mix(in srgb, ${a.logo} 21%, transparent), 0 8px 24px -8px rgba(0, 0, 0, 0.18)`,
        );
        expect(v['--ds-shadow-accent-caption']).toBe(
            `0 10px 28px -6px color-mix(in srgb, ${a.logo} 25%, transparent), 0 6px 16px -4px rgba(0, 0, 0, 0.1)`,
        );
    });
});

describe('blog feed tile gradients (tailwind.config.js)', () => {
    const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

    it('mixes the aura and the placeholder from the accent roles (e4e4118 logo / action alphas)', () => {
        expect(config).toContain("'accent-aura': 'radial-gradient(ellipse at center, color-mix(in srgb, var(--ds-accent-logo) 19%, transparent) 0%, color-mix(in srgb, var(--ds-accent) 8%, transparent) 50%, transparent 70%)'");
        expect(config).toContain("'accent-tile': 'linear-gradient(145deg, color-mix(in srgb, var(--ds-accent-logo) 9%, transparent) 0%, color-mix(in srgb, var(--ds-accent) 7%, transparent) 100%)'");
        expect(config).toContain("'accent-lens': 'radial-gradient(ellipse 100% 30% at 50% var(--ds-rail-lens-y), color-mix(in srgb, var(--ds-accent-strong) 8%, transparent) 0%, transparent 70%)'");
        expect(config).toContain("'tile-vignette': 'linear-gradient(to top, var(--ds-blog-vignette) 0%, transparent 20%)'");
    });
});
