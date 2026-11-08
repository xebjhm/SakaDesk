import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { color } from './tokens';
import { staticTokenVars } from './cssVars';
import { contrastRatio } from './contrast';
import { cn } from '../utils/classnames';
import { Z_INDEX } from '../constants/zIndex';

const config = readFileSync(resolve(__dirname, '../../tailwind.config.js'), 'utf-8');

describe('D2c tokens', () => {
    it('write the status, viewer, decor and toast variables', () => {
        const v = staticTokenVars();
        expect(v['--ds-semantic-danger-solid']).toBe('#b44543');
        expect(v['--ds-semantic-success-text']).toBe('#216a49');
        expect(v['--ds-semantic-warning-text']).toBe('#824c13');
        expect(v['--ds-viewer-scrim']).toBe('rgba(0, 0, 0, 0.9)');
        expect(v['--ds-viewer-stage']).toBe('#000000');
        expect(v['--ds-viewer-control']).toBe('rgba(255, 255, 255, 0.2)');
        expect(v['--ds-viewer-control-hover']).toBe('rgba(255, 255, 255, 0.3)');
        expect(v['--ds-viewer-text']).toBe('#FFFFFF');
        expect(v['--ds-viewer-text-muted']).toBe('rgba(255, 255, 255, 0.7)');
        expect(v['--ds-viewer-underline']).toBe('rgba(255, 255, 255, 0.3)');
        expect(v['--ds-console-bg']).toBe('#111827');
        expect(v['--ds-console-text']).toBe('#FFFFFF');
        expect(v['--ds-console-prompt']).toBe('#4ADE80');
        expect(v['--ds-console-badge']).toBe('rgba(251, 191, 36, 0.15)');
        expect(v['--ds-console-badge-text']).toBe('#FBBF24');
        expect(v['--ds-decor-sunday']).toBe('#EF4444');
        expect(v['--ds-decor-heart']).toBe('#F87171');
        expect(v['--ds-overlay-toast']).toBe('rgba(0, 0, 0, 0.8)');
        expect(v['--ds-group-marker']).toBe('transparent');
    });

    it('keep status text readable on white (≥ 4.5:1)', () => {
        for (const c of [color.semantic.danger.text, color.semantic.success.text, color.semantic.warning.text]) {
            expect(contrastRatio(c, color.surface.sheet)!).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('expose the utilities in tailwind.config.js', () => {
        for (const needle of [
            "toast: 'var(--ds-overlay-toast)'",
            "'status-danger': 'var(--ds-semantic-danger-solid)'",
            "'status-attention': 'var(--ds-semantic-warning-solid)'",
            "'viewer-scrim': 'var(--ds-viewer-scrim)'",
            "'viewer-muted': 'var(--ds-viewer-text-muted)'",
            "console: 'var(--ds-console-bg)'",
            "'console-muted': 'var(--ds-console-text-muted)'",
            "'console-badge': 'var(--ds-console-badge-text)'",
            "sunday: 'var(--ds-decor-sunday)'",
            "heart: 'var(--ds-decor-heart)'",
            "surface: 'var(--ds-surface-sheet)'",
            "'control-off': 'var(--ds-border-strong)'",
            "group: 'var(--ds-group-accent)'",
            "'group-marker': 'var(--ds-group-marker)'",
        ]) {
            expect(config).toContain(needle);
        }
    });

    it('teach tailwind-merge the new text colours and animations', () => {
        expect(cn('text-small', 'text-status-danger')).toBe('text-small text-status-danger');
        expect(cn('text-muted', 'text-viewer-muted')).toBe('text-viewer-muted');
        expect(cn('text-caption', 'text-heart')).toBe('text-caption text-heart');
        expect(cn('animate-reveal', 'animate-heartbeat')).toBe('animate-heartbeat');
    });

    it('layer dialogs above dropdowns and popovers above dialogs', () => {
        expect(Z_INDEX.DROPDOWN).toBeLessThan(Z_INDEX.DIALOG);
        expect(Z_INDEX.DIALOG + 20 * Z_INDEX.DIALOG_STEP).toBeLessThan(Z_INDEX.POPOVER);
        expect(Z_INDEX.POPOVER).toBeLessThan(Z_INDEX.TOAST);
    });
});
