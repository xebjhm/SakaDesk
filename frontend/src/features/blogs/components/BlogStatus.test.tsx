import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlogStatus } from './BlogStatus';

describe('BlogStatus', () => {
    it('announces loading as a status with a spinner and no button', () => {
        const { container } = render(<BlogStatus kind="loading" title="Loading posts..." />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading posts...');
        expect(container.querySelector('.animate-spin')).not.toBeNull();
        expect(container.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none');
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows an error as an alert with its icon and a working retry', () => {
        const onRetry = vi.fn();
        render(
            <BlogStatus kind="error" title="Blog posts could not be loaded" icon={<svg data-testid="icon" />}
                onRetry={onRetry} retryLabel="Retry" />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Blog posts could not be loaded');
        expect(screen.getByTestId('icon')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('fills the area for the first sync and shows the hint', () => {
        render(<BlogStatus kind="loading" fill title="Syncing blogs..." hint="This may take a moment" />);
        const status = screen.getByRole('status');
        expect(status).toHaveClass('h-full', 'min-h-96');
        expect(status).toHaveTextContent('This may take a moment');
    });

    it('tints the loading spinner with the accent, the error tile with danger and the empty tile softly', () => {
        const { container, rerender } = render(<BlogStatus kind="loading" title="Loading" />);
        expect(container.querySelector('.animate-spin')).toHaveClass('text-accent');
        rerender(<BlogStatus kind="error" title="Failed" icon={<svg data-testid="i" />} />);
        expect(screen.getByTestId('i').parentElement).toHaveClass('bg-semantic-danger-icon', 'text-semantic-danger');
        rerender(<BlogStatus kind="empty" title="None" icon={<svg data-testid="i" />} />);
        expect(screen.getByTestId('empty-state-circle')).toHaveClass('bg-expressive-soft', 'text-muted');
        expect(screen.getByRole('heading', { name: 'None' })).toHaveClass('font-display');
    });

    it('draws the retry as the gradient primary button', () => {
        render(<BlogStatus kind="error" title="Failed" onRetry={() => {}} retryLabel="Retry" />);
        expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('bg-accent-gradient');
    });

    it('keeps the empty block height and fills the area for the first sync (R-d)', () => {
        const { rerender } = render(<BlogStatus kind="empty" title="記事がありません 📰" icon={<svg data-testid="i" />} />);
        expect(screen.getByRole('status')).toHaveClass('h-72');
        rerender(<BlogStatus kind="empty" fill title="記事がありません 📰" icon={<svg data-testid="i" />} />);
        expect(screen.getByRole('status')).toHaveClass('h-full', 'min-h-96');
    });
});
