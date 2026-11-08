import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars } from './cssVars';
import { Modal } from './primitives/Modal';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');

describe('styled scrollbars (R-h task 8)', () => {
    it('registers the thumb tokens as CSS variables', () => {
        const v = staticTokenVars();
        expect(v['--ds-scrollbar-thumb']).toMatch(/^rgba\(/);
        expect(v['--ds-scrollbar-thumb-hover']).toMatch(/^rgba\(/);
        expect(v['--ds-scrollbar-thumb-on-dark']).toMatch(/^rgba\(255, 255, 255/);
        expect(v['--ds-scrollbar-thumb-on-dark-hover']).toMatch(/^rgba\(255, 255, 255/);
    });

    it('styles a 6px rounded thumb on a transparent track, growing to 10px on hover', () => {
        expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
        expect(css).toMatch(/::-webkit-scrollbar:hover\s*\{[^}]*width:\s*10px/);
        expect(css).toMatch(/::-webkit-scrollbar-track[^{]*\{[^}]*background:\s*transparent/);
        expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--ds-scrollbar-thumb[^}]*border-radius:\s*9999px/);
        expect(css).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*--ds-scrollbar-thumb-hover/);
    });

    it('gives dark surfaces a light thumb and leaves scrollbar-gutter alone', () => {
        expect(css).toMatch(/\[data-surface="dark"\] ::-webkit-scrollbar-thumb[^{]*\{[^}]*--ds-scrollbar-thumb-on-dark\b/);
        expect(css).toContain('.sd-call-overlay ::-webkit-scrollbar-thumb');
        expect(css).not.toContain('scrollbar-gutter');
    });

    it('keeps the Firefox fallback away from Chromium', () => {
        expect(css).toMatch(/@supports not selector\(::-webkit-scrollbar\)\s*\{[^@]*scrollbar-width:\s*thin[^@]*scrollbar-color:/);
    });

    it('marks the viewer modal as a dark surface and the sheet modal not', () => {
        const { unmount } = render(<Modal isOpen onClose={vi.fn()} tone="viewer" aria-label="v" layout="bare">x</Modal>);
        expect(screen.getByTestId('modal-backdrop')).toHaveAttribute('data-surface', 'dark');
        unmount();
        render(<Modal isOpen onClose={vi.fn()} aria-label="s" layout="bare">x</Modal>);
        expect(screen.getByTestId('modal-backdrop')).not.toHaveAttribute('data-surface');
    });
});
