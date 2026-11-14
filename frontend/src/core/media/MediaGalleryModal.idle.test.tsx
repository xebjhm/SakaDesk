import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import * as timeOrder from '../../utils/timeOrder';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
vi.mock('../../utils/timeOrder', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/timeOrder')>();
    return { ...actual, sortNewestFirst: vi.fn(actual.sortNewestFirst) };
});

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    vi.mocked(timeOrder.sortNewestFirst).mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
});
afterEach(() => vi.unstubAllGlobals());

const pic = (id: number, extra: Partial<Message> = {}) =>
    ({ id, content: null, timestamp: `2026-10-0${id}T04:00:00Z`, type: 'picture', is_favorite: false, media_file: `messages/a/picture/${id}.jpg`, ...extra }) as unknown as Message;
const props = { onClose: vi.fn(), memberName: 'n', serviceId: 'hinatazaka46' };
const sortedSizes = () => vi.mocked(timeOrder.sortNewestFirst).mock.calls.map(([items]) => items.length);
const tiles = () => screen.queryAllByRole('button', { name: /^Open photo from / });

describe('MediaGalleryModal while closed (UI health P-B3)', () => {
    it('derives nothing while closed, and shows the current messages once open', () => {
        const { rerender } = render(<MediaGalleryModal {...props} isOpen={false} messages={[pic(1)]} />);
        rerender(<MediaGalleryModal {...props} isOpen={false} messages={[pic(1), pic(2), pic(3)]} />);
        // A star toggled while closed arrives as a new message object.
        rerender(<MediaGalleryModal {...props} isOpen={false} messages={[pic(1), pic(2, { is_favorite: true }), pic(3)]} />);
        expect(sortedSizes().every((n) => n === 0)).toBe(true);
        expect(tiles()).toHaveLength(0);
        rerender(<MediaGalleryModal {...props} isOpen messages={[pic(1), pic(2, { is_favorite: true }), pic(3)]} />);
        expect(sortedSizes().some((n) => n === 3)).toBe(true);
        expect(tiles()).toHaveLength(3);
    });

    it('keeps the viewer navigable when the gallery closes under an open viewer', async () => {
        const messages = [pic(1), pic(2), pic(3)];
        const { rerender } = render(<MediaGalleryModal {...props} isOpen messages={messages} />);
        await userEvent.click(tiles()[1]);
        const viewer = await screen.findByRole('dialog', { name: 'Media viewer' });
        const shown = () => viewer.querySelector('img')?.getAttribute('src') ?? '';
        expect(shown()).toMatch(/\/2\.jpg/);
        rerender(<MediaGalleryModal {...props} isOpen={false} messages={messages} />);
        await userEvent.keyboard('{ArrowLeft}');
        expect(shown()).toMatch(/\/1\.jpg/);
        await userEvent.keyboard('{ArrowRight}{ArrowRight}');
        expect(shown()).toMatch(/\/3\.jpg/);
    });
});
