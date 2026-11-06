import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Star } from 'lucide-react';
import { DialogStatus } from './DialogStatus';

describe('DialogStatus', () => {
    it('loading is a status with a spinner', () => {
        render(<DialogStatus kind="loading" title="読み込み中…" />);
        expect(screen.getByRole('status')).toHaveTextContent('読み込み中…');
        expect(screen.getByRole('status').querySelector('svg.animate-spin')).not.toBeNull();
    });

    it('empty shows the icon tile, title and hint', () => {
        render(<DialogStatus kind="empty" icon={<Star />} title="お気に入りなし" hint="長押しで追加 ⭐" />);
        expect(screen.getByRole('status')).toHaveTextContent('長押しで追加 ⭐');
        expect(screen.getByRole('status').querySelector('svg.lucide-star')).not.toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows no retry button without a retry label, and no icon while loading', () => {
        render(<DialogStatus kind="error" title="e" onRetry={vi.fn()} />);
        expect(screen.queryByRole('button')).toBeNull();
        render(<DialogStatus kind="loading" icon={<Star />} />);
        expect(document.querySelector('svg.lucide-star')).toBeNull();
    });

    it('error is an alert in the danger colour with a retry', async () => {
        const onRetry = vi.fn();
        render(<DialogStatus kind="error" title="失敗しました" onRetry={onRetry} retryLabel="再試行" />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('失敗しました')).toHaveClass('text-status-danger');
        await userEvent.click(screen.getByRole('button', { name: '再試行' }));
        expect(onRetry).toHaveBeenCalled();
    });

    it('tints the spinner and tiles, and the retry is secondary unless retryVariant is primary', () => {
        const { container, rerender } = render(<DialogStatus kind="loading" />);
        expect(container.querySelector('.animate-spin')).toHaveClass('text-accent');
        rerender(<DialogStatus kind="error" icon={<Star />} onRetry={vi.fn()} retryLabel="Retry" />);
        expect(container.querySelector('span[aria-hidden]')).toHaveClass('bg-semantic-danger-icon', 'text-semantic-danger');
        expect(screen.getByRole('button', { name: 'Retry' })).not.toHaveClass('bg-accent-gradient');
        rerender(<DialogStatus kind="empty" icon={<Star />} onRetry={vi.fn()} retryLabel="Retry" retryVariant="primary" />);
        expect(container.querySelector('span[aria-hidden]')).toHaveClass('bg-expressive-soft', 'text-accent-strong');
        expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('bg-accent-gradient');
    });
});
