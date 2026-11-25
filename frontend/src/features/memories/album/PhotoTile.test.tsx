import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness, type MediaTileHarness } from '../../../__tests__/mediaTileHarness';
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
        expect(within(menu).getByRole('menuitem', { name: 'Make this the month cover' })).toHaveFocus();
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

describe('PhotoTile still', () => {
    let h: MediaTileHarness;
    beforeEach(() => { h = installMediaTileHarness(); });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('sizes the thumbnail from the measured tile: a pinned ★ asks for 640, an ordinary tile stays ≤ 480', async () => {
        renderTile({ item: photo(2, '2026-10', { favorited: true }), pinned: true, tilePx: 260 });
        renderTile({ item: photo(1, '2026-10'), tilePx: 260 });
        await waitFor(() => expect(h.requested()).toHaveLength(2));
        // pinned: two tiles and the gap (528 px) → the large 640; ordinary: 260 px → 320
        expect(h.requested()).toContain('/api/content/media/hinatazaka46/messages/34 金村 美玖/58 金村 美玖/picture/2.jpg'.replace('/media/', '/thumb/') + '?w=640');
        expect(h.requested().find((s) => s.includes('/1.jpg'))).toMatch(/\?w=320$/);
    });

    it('a failed still retries on click and says so; a loaded one opens', async () => {
        const onOpen = vi.fn();
        renderTile({ onOpen });
        const tile = screen.getByTestId('album-tile-1');
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        await h.fail();
        await waitFor(() => expect(h.requested()).toHaveLength(2));
        await h.fail();
        await waitFor(() => expect(within(tile).getByTestId('memory-thumb')).toHaveAttribute('data-state', 'failed'));
        expect(tile).toHaveAccessibleName('Retry loading: おはよう');
        await userEvent.click(tile);
        expect(onOpen).not.toHaveBeenCalled();
        await waitFor(() => expect(h.requested()).toHaveLength(3));
        await h.load();
        await waitFor(() => expect(within(tile).getByTestId('memory-thumb')).toHaveAttribute('data-state', 'ready'));
        expect(tile).toHaveAccessibleName('おはよう');
        await userEvent.click(tile);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});
