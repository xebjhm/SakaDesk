import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Star } from 'lucide-react';
import { DialogStatus } from './DialogStatus';

describe('DialogStatus', () => {
    it('loading is a status with a spinner', () => {
        render(<DialogStatus kind="loading" title="読み込み中…" />);
        expect(screen.getByRole('status')).toHaveTextContent('読み込み中…');
    });

    it('empty shows the icon tile, title and hint', () => {
        render(<DialogStatus kind="empty" icon={<Star />} title="お気に入りなし" hint="長押しで追加 ⭐" />);
        expect(screen.getByRole('status')).toHaveTextContent('長押しで追加 ⭐');
    });

    it('error is an alert in the danger colour with a retry', async () => {
        const onRetry = vi.fn();
        render(<DialogStatus kind="error" title="失敗しました" onRetry={onRetry} retryLabel="再試行" />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('失敗しました')).toHaveClass('text-status-danger');
        await userEvent.click(screen.getByRole('button', { name: '再試行' }));
        expect(onRetry).toHaveBeenCalled();
    });
});
