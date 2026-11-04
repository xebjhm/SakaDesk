import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { MessageContextMenu } from './MessageContextMenu';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('MessageContextMenu', () => {
    it('toggles the favourite and closes', () => {
        const onToggleFavorite = vi.fn();
        const onClose = vi.fn();
        render(<MessageContextMenu x={10} y={10} isFavorite={false} onToggleFavorite={onToggleFavorite} onClose={onClose} />);
        fireEvent.click(screen.getByText('Add to favorites'));
        expect(onToggleFavorite).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalled();
    });

    it('offers removal for a favourite', () => {
        render(<MessageContextMenu x={10} y={10} isFavorite onToggleFavorite={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Remove from favorites')).toBeInTheDocument();
    });

    it('closes on Escape and on an outside mouse-down', () => {
        const onClose = vi.fn();
        render(<MessageContextMenu x={10} y={10} isFavorite={false} onToggleFavorite={vi.fn()} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.mouseDown(document.body);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('is a point menu; a favourite shows the strong filled star', () => {
        render(<MessageContextMenu x={10} y={10} isFavorite onToggleFavorite={vi.fn()} onClose={vi.fn()} />);
        const item = screen.getByRole('menuitem', { name: 'Remove from favorites' });
        expect(item.querySelector('svg')).toHaveClass('fill-current');
        expect(screen.getByRole('menu').parentElement).toBe(document.body);
    });

    it('has its own name, not the generic "More options"', () => {
        render(<MessageContextMenu x={10} y={10} isFavorite={false} onToggleFavorite={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByRole('menu', { name: i18n.t('messageList.messageActions') })).toBeInTheDocument();
        expect(i18n.t('messageList.messageActions')).toBe('Message actions');
    });
});
