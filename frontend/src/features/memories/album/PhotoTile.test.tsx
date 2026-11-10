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

    it('claims the context-menu key and Shift+F10 (no native menu next to it)', () => {
        renderTile({ onSetCover: vi.fn() });
        const tile = screen.getByTestId('album-tile-1');
        expect(fireEvent.keyDown(tile, { key: 'ContextMenu' })).toBe(false); // defaultPrevented
        expect(screen.getByRole('menu')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        expect(fireEvent.keyDown(tile, { key: 'F10', shiftKey: true })).toBe(false);
        expect(fireEvent.contextMenu(tile)).toBe(false);
        // F10 alone is not a menu key.
        expect(fireEvent.keyDown(tile, { key: 'F10' })).toBe(true);
    });

    it('swallows the native contextmenu that follows a keyboard open, without moving the menu', () => {
        renderTile({ onSetCover: vi.fn() });
        const tile = screen.getByTestId('album-tile-1');
        fireEvent.keyDown(tile, { key: 'ContextMenu' });
        const menu = screen.getByRole('menu');
        const at = menu.style.left;
        // The browser follows the key with a contextmenu event, on the tile or on the now-focused menu.
        expect(fireEvent.contextMenu(menu, { clientX: 0, clientY: 0 })).toBe(false);
        expect(fireEvent.contextMenu(tile, { clientX: 0, clientY: 0 })).toBe(false);
        expect(screen.getByRole('menu').style.left).toBe(at);
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
