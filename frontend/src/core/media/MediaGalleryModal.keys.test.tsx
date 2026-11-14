import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { clientLog } from '../../utils/clientLog';
import { MediaGalleryModal } from './MediaGalleryModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.mocked(clientLog).mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

const photo = (id: number, timestamp: string) => ({
    id, content: null, timestamp, type: 'picture', is_favorite: false, media_file: `messages/a/picture/${id}.jpg`,
}) as unknown as Message;
const newest = photo(2, '2026-11-03T04:00:00Z');
const oldest = photo(1, '2026-10-01T04:00:00Z');

/** Which picture the detail viewer shows, read from its stage image. */
const shown = () => screen.getByTestId('viewer-stage').querySelector('img')?.getAttribute('src') ?? '';

async function openNewest() {
    render(<MediaGalleryModal isOpen onClose={vi.fn()} messages={[newest, oldest]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
    const tiles = screen.getAllByRole('button', { name: /^Open photo from/ });
    await userEvent.click(tiles[0]);
}

describe('MediaGalleryModal detail viewer: steps and keys', () => {
    it('the Older / Newer buttons step through the tab and say why at an end', async () => {
        await openNewest();
        expect(shown()).toContain('/2.jpg');
        expect(screen.getByRole('button', { name: 'Newer' })).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Older' }));
        expect(shown()).toContain('/1.jpg');
        expect(screen.getByRole('button', { name: 'Older' })).toHaveAttribute('aria-disabled', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'Newer' }));
        expect(shown()).toContain('/2.jpg');
    });

    it('left and right arrows step; the same key inside a menu is left to it, and logged once', async () => {
        await openNewest();
        const menu = document.body.appendChild(document.createElement('div'));
        menu.setAttribute('role', 'menu');
        const item = menu.appendChild(document.createElement('button'));
        item.setAttribute('role', 'menuitem');
        fireEvent.keyDown(item, { key: 'ArrowLeft' });
        fireEvent.keyDown(item, { key: 'ArrowLeft' });
        expect(shown()).toContain('/2.jpg');
        const logged = vi.mocked(clientLog).mock.calls.filter((c) => c[1]?.outcome === 'left_to_control');
        expect(logged).toEqual([['media_playback', { surface: 'viewer', phase: 'keys', outcome: 'left_to_control' }]]);
        fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
        expect(shown()).toContain('/1.jpg');
        fireEvent.keyDown(document.body, { key: 'ArrowRight' });
        expect(shown()).toContain('/2.jpg');
        menu.remove();
    });
});
