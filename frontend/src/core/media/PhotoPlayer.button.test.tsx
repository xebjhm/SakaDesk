import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoPlayer } from './PhotoPlayer';

describe('PhotoPlayer bubble that opens the viewer (UI health A-K3)', () => {
    it('is a named button that Enter opens', async () => {
        const onClick = vi.fn();
        render(<PhotoPlayer variant="bubble" src="/p.jpg" alt="Attachment" actionLabel="Open photo" onClick={onClick} />);
        const button = screen.getByRole('button', { name: 'Open photo' });
        button.focus();
        await userEvent.keyboard('{Enter}');
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(button).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-inset', 'focus-visible:ring-accent');
    });

    it('stays a plain image without a click handler', () => {
        render(<PhotoPlayer variant="bubble" src="/p.jpg" alt="Attachment" />);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByRole('img', { name: 'Attachment' })).toBeInTheDocument();
    });
});
