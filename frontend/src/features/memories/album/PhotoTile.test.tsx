import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { memoryMessage } from '../__fixtures__/memories';
import { PhotoTile } from './PhotoTile';
import { photo } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const renderTile = (props: Partial<React.ComponentProps<typeof PhotoTile>> = {}) => render(
    <PhotoTile item={photo(1, '2026-10')} sepia="" label="おはよう" onOpen={vi.fn()} {...props} />,
);

describe('PhotoTile context menu', () => {
    it('opens 「この月の表紙にする」 at the pointer and hands the item over', async () => {
        const onSetCover = vi.fn();
        const item = photo(1, '2026-10');
        renderTile({ item, onSetCover });
        fireEvent.contextMenu(screen.getByTestId('album-tile-1'), { clientX: 10, clientY: 20 });
        const menu = screen.getByRole('menu', { name: 'おはよう' });
        expect(menu).toHaveFocus();
        await userEvent.click(screen.getByRole('menuitem', { name: 'Make this the month cover' }));
        expect(onSetCover).toHaveBeenCalledWith(item);
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('offers it on a video tile too', () => {
        renderTile({ item: photo(6, '2026-10', { type: 'video' }), onSetCover: vi.fn() });
        fireEvent.contextMenu(screen.getByTestId('album-tile-6'));
        expect(screen.getByRole('menuitem', { name: 'Make this the month cover' })).toBeInTheDocument();
    });

    it('keeps the browser menu when there is nothing to offer', () => {
        renderTile({ item: memoryMessage({ id: 9, type: 'text' }), onSetCover: vi.fn() });
        const event = fireEvent.contextMenu(screen.getByTestId('album-tile-9'));
        expect(event).toBe(true); // not prevented
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('without onSetCover never opens a menu', () => {
        renderTile();
        fireEvent.contextMenu(screen.getByTestId('album-tile-1'));
        expect(screen.queryByRole('menu')).toBeNull();
    });
});
