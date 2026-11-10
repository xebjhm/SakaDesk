import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Star } from 'lucide-react';
import { DialogStatus } from './DialogStatus';

describe('DialogStatus (deprecated adapter over StatusBlock)', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('loading renders through StatusBlock: nothing at 199 ms, the titled spinner at 200 ms', () => {
        vi.useFakeTimers();
        const { container } = render(<DialogStatus kind="loading" title="読み込み中…" />);
        act(() => { vi.advanceTimersByTime(199); });
        expect(container.querySelector('svg.animate-spin')).toBeNull();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.getByRole('status')).toHaveTextContent('読み込み中…');
        expect(container.querySelector('svg.animate-spin')).toHaveClass('motion-reduce:animate-none', 'text-accent');
    });

    it('loading with no title uses the default label and ignores the icon', () => {
        vi.useFakeTimers();
        render(<DialogStatus kind="loading" icon={<Star />} />);
        act(() => { vi.advanceTimersByTime(200); });
        expect(screen.getByRole('status')).toHaveTextContent('Loading');
        expect(document.querySelector('svg.lucide-star')).toBeNull();
    });

    it('empty shows the icon tile, title and hint, with no alert or button', () => {
        render(<DialogStatus kind="empty" icon={<Star />} title="お気に入りなし" hint="長押しで追加 ⭐" />);
        expect(screen.getByRole('status')).toHaveTextContent('長押しで追加 ⭐');
        expect(screen.getByRole('status').querySelector('svg.lucide-star')).not.toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('draws an empty dialog as the brand-moment pattern and keeps className', () => {
        render(<DialogStatus kind="empty" icon={<Star />} title="お気に入りなし" hint="長押しで追加 ⭐" className="py-8" />);
        const status = screen.getByRole('status');
        expect(status).toHaveClass('py-8');
        expect(screen.getByRole('heading', { name: 'お気に入りなし' })).toHaveClass('font-display');
        expect(status).toContainElement(screen.getByTestId('empty-state-circle'));
        expect(screen.getByText('長押しで追加 ⭐')).toHaveClass('text-secondary');
    });
});
