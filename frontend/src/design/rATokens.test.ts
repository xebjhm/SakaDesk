import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars, groupTokenVars } from './cssVars';
import { groupTokens } from './tokens';
import { cn } from '../utils/classnames';
import { ACCENT, ACCENT_LOGO, withAlpha } from './colorMix';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('R-a tokens', () => {
    it('writes the chat-header pill overlays (the pre-D2 white glass and dark shade)', () => {
        const v = staticTokenVars();
        expect(v['--ds-overlay-glass']).toBe('rgba(255, 255, 255, 0.2)');
        expect(v['--ds-overlay-shade']).toBe('rgba(0, 0, 0, 0.2)');
    });

    it.each(['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel'] as const)('%s writes its official shelter colours', (id) => {
        const v = groupTokenVars(id);
        const s = groupTokens[id].official.shelter;
        expect([
            v['--ds-group-shelter-picture'], v['--ds-group-shelter-video'],
            v['--ds-group-shelter-voice'], v['--ds-group-shelter-text'],
        ]).toEqual([s.picture, s.video, s.voice, s.text]);
    });

    it.each([
        "'header-glass': 'var(--ds-overlay-glass)'",
        "'header-shade': 'var(--ds-overlay-shade)'",
        "'group-title-tint': 'color-mix(in srgb, var(--ds-group-title-text) 12.5%, transparent)'",
        "'group-title-wash': 'color-mix(in srgb, var(--ds-group-title-text) 8%, transparent)'",
        "'group-shelter-picture': 'var(--ds-group-shelter-picture)'",
        "'group-shelter-text': 'var(--ds-group-shelter-text)'",
        "'accent-border': 'var(--ds-accent-border)'",
    ])('tailwind.config.js defines %s', (entry) => {
        expect(config).toContain(entry);
    });

    it('class merging keeps the new colours apart from sizes and widths', () => {
        expect(cn('text-caption', 'text-group-shelter-voice')).toBe('text-caption text-group-shelter-voice');
        expect(cn('bg-header-glass', 'bg-group-title-tint')).toBe('bg-group-title-tint');
        expect(cn('border-2', 'border-group-shelter-picture')).toBe('border-2 border-group-shelter-picture');
        expect(cn('ring-2', 'ring-accent-border')).toBe('ring-2 ring-accent-border');
    });

    it('withAlpha mixes any colour with transparency for inline styles', () => {
        expect(withAlpha(ACCENT, 25)).toBe('color-mix(in srgb, var(--ds-accent) 25%, transparent)');
        expect(withAlpha('#389dd1', 50)).toBe('color-mix(in srgb, #389dd1 50%, transparent)');
        expect(ACCENT_LOGO).toBe('var(--ds-accent-logo)');
    });
});
