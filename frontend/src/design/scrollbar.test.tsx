import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { staticTokenVars } from './cssVars';
import { Modal } from './primitives/Modal';
import { MessageList } from '../features/messages/components/MessageList';
import { buildTimeline } from '../features/messages/timeline/buildTimeline';

vi.mock('../features/messages/hooks/useChatScroll', () => ({
    useChatScroll: () => ({ initialTopMostItemIndex: 0, handleRangeChanged: vi.fn() }),
}));
vi.mock('../features/messages/components/MessageBubble', () => ({ MessageBubble: () => <span /> }));

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');

describe('styled scrollbars (R-h task 8)', () => {
    it('registers the thumb tokens as CSS variables', () => {
        const v = staticTokenVars();
        expect(v['--ds-scrollbar-thumb']).toMatch(/^rgba\(/);
        expect(v['--ds-scrollbar-thumb-hover']).toMatch(/^rgba\(/);
        expect(v['--ds-scrollbar-thumb-on-dark']).toMatch(/^rgba\(255, 255, 255/);
        expect(v['--ds-scrollbar-thumb-on-dark-hover']).toMatch(/^rgba\(255, 255, 255/);
    });

    it('keeps a constant 10px scrollbar box and thickens only the drawn thumb on hover', () => {
        expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*10px[^}]*height:\s*10px/);
        // No hover rule on the scrollbar box itself: its size must never change (Virtuoso re-measure).
        expect(css).not.toMatch(/::-webkit-scrollbar:hover/);
        expect(css).toMatch(/::-webkit-scrollbar-track[^{]*\{[^}]*background:\s*transparent/);
        expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--ds-scrollbar-thumb[^}]*border-radius:\s*9999px[^}]*border:\s*2px solid transparent[^}]*background-clip:\s*padding-box/);
        expect(css).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*--ds-scrollbar-thumb-hover[^}]*border-width:\s*1px/);
    });

    it('gives dark surfaces a light thumb and leaves scrollbar-gutter alone', () => {
        expect(css).toMatch(/\[data-surface="dark"\] ::-webkit-scrollbar-thumb[^{]*\{[^}]*--ds-scrollbar-thumb-on-dark\b/);
        expect(css).toContain('.sd-call-overlay ::-webkit-scrollbar-thumb');
        expect(css).not.toContain('scrollbar-gutter');
    });

    it('insets only the bottom of the track by the sheet corner radius', () => {
        // The thumb must not run into the 24px bottom corner (it was clipped into a wedge).
        const rule = css.match(/\.sd-sheet-scroll::-webkit-scrollbar-track\s*\{([^}]*)\}/)?.[1] ?? '';
        expect(rule).toMatch(/margin-bottom:\s*var\(--ds-radius-xl,\s*24px\)/);
        expect(rule).not.toMatch(/margin-top/);
        expect(staticTokenVars()['--ds-radius-xl']).toBe('24px');
        expect(css).not.toMatch(/(^|\n)\s*::-webkit-scrollbar-track[^{]*\{[^}]*margin/);
    });

    it('applies the class to a Modal body only when it reaches the rounded bottom corner', () => {
        const { unmount } = render(<Modal isOpen onClose={vi.fn()} aria-label="s" title="t">x</Modal>);
        expect(screen.getByTestId('modal-body')).toHaveClass('sd-sheet-scroll');
        unmount();
        const footed = render(<Modal isOpen onClose={vi.fn()} aria-label="s" title="t" footer={<button>ok</button>}>x</Modal>);
        expect(screen.getByTestId('modal-body')).not.toHaveClass('sd-sheet-scroll');
        footed.unmount();
        render(<Modal isOpen onClose={vi.fn()} aria-label="s" title="t" tone="viewer">x</Modal>);
        expect(screen.getByTestId('modal-body')).not.toHaveClass('sd-sheet-scroll');
    });

    it('puts the class on the chat timeline scroller', () => {
        const timeline = buildTimeline([{ id: 1, timestamp: '2025-01-01T03:00:00Z', type: 'text', is_favorite: false, content: 'm1' }], []);
        const { container } = render(
            <MessageList memberId="room" timeline={timeline} getSenderInfo={() => ({ name: 'n' })} isUnread={() => false}
                onReveal={vi.fn()} onLongPress={vi.fn()} />,
        );
        expect(container.querySelector('[data-virtuoso-scroller]')).toHaveClass('sd-sheet-scroll');
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
