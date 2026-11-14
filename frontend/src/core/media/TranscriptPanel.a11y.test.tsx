import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { TranscriptPanel } from './TranscriptPanel';

const segments = [
    { start: 0, end: 2, text: 'おはよう', confidence: 0.9 },
    { start: 2, end: 4, text: 'ございます🌸', confidence: 0.9 },
];

describe('TranscriptPanel readable and operable (UI health #12)', () => {
    beforeAll(async () => {
        await i18n.changeLanguage('en');
        // jsdom has no Element.scrollTo; the panel centres the active line with it.
        Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    });
    afterAll(() => { delete (Element.prototype as { scrollTo?: unknown }).scrollTo; });

    it('makes each line a button that seeks, marking the current one', async () => {
        const onSeek = vi.fn();
        render(<TranscriptPanel segments={segments} currentTime={2.5} onSeek={onSeek} defaultExpanded variant="dark" />);
        const current = screen.getByRole('button', { name: /ございます/ });
        expect(current).toHaveAttribute('aria-current', 'true');
        await userEvent.click(screen.getByRole('button', { name: /おはよう/ }));
        expect(onSeek).toHaveBeenCalledWith(0);
    });

    it('draws its text with token colours, none inline', () => {
        const { container } = render(<TranscriptPanel segments={segments} currentTime={0} onSeek={vi.fn()} defaultExpanded variant="light" />);
        const inlineColours = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter((el) => /color:/.test(el.getAttribute('style') ?? ''));
        expect(inlineColours).toEqual([]);
        expect(screen.getByRole('button', { name: /おはよう/ }).querySelector('[lang="ja"]')).toHaveClass('text-viewer');
    });

    it('says whether the panel is open, with a neutral toggle on light surfaces', () => {
        render(<TranscriptPanel segments={segments} currentTime={0} onSeek={vi.fn()} variant="dark" />);
        const toggle = screen.getByRole('button', { name: /Voice Content/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        // DESIGN_SYSTEM: disclosure controls are neutral; the accent is only the active line's.
        expect(toggle).toHaveClass('text-secondary', 'hover:text-primary', 'text-caption');
        expect(toggle).not.toHaveAttribute('style');
    });

    it('keeps the accent on the active line only, and the lines on the type scale', () => {
        const { container } = render(<TranscriptPanel segments={segments} currentTime={2.5} onSeek={vi.fn()} defaultExpanded variant="dark" />);
        expect(screen.getByRole('button', { name: /ございます/ })).toHaveAttribute('style');
        expect(screen.getByRole('button', { name: /おはよう/ })).not.toHaveAttribute('style');
        expect(container.querySelector('.text-xs')).toBeNull();
    });

    it('marks a low-confidence line with a dotted underline that shows on both surfaces', () => {
        const low = [{ start: 0, end: 2, text: 'たぶん', confidence: 0.2 }];
        const { unmount } = render(<TranscriptPanel segments={low} currentTime={0} onSeek={vi.fn()} defaultExpanded variant="light" />);
        expect(screen.getByText('たぶん')).toHaveClass('decoration-dotted', 'underline-offset-2', 'decoration-viewer');
        unmount();
        render(<TranscriptPanel segments={low} currentTime={0} onSeek={vi.fn()} defaultExpanded variant="dark" />);
        expect(screen.getByText('たぶん').getAttribute('style')).toContain('--ds-semantic-warning-text');
    });
});
