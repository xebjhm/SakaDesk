import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaGalleryModal } from './MediaGalleryModal';
import { FeatureActiveContext } from '../../design/featureActive';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import { useAppStore } from '../../store/appStore';
import type { Message } from '../../types';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('react-virtuoso', async () => (await import('../../__tests__/virtuosoMock')).virtuosoMock);
const copyImage = vi.fn().mockResolvedValue(undefined);
vi.mock('../../utils/clipboard', () => ({
    copyImageToClipboard: (src: string) => copyImage(src),
    copyVideoToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const idle = { state: 'idle', services: {} };
const running = { state: 'running', paused_reason: null, thumbs_full: false, services: { hinatazaka46: { done: 1, total: 9 } } };
let fetchMock: ReturnType<typeof vi.fn>;
const statusCalls = () => fetchMock.mock.calls.filter(([url]) => url === '/api/media/status').length;

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    resetDialogStack();
    copyImage.mockClear();
    Element.prototype.scrollIntoView = vi.fn();
    fetchMock = vi.fn(async () => new Response(JSON.stringify(idle)));
    vi.stubGlobal('fetch', fetchMock);
    useAppStore.setState({ goldenFingerActive: true });
});
afterEach(() => {
    vi.unstubAllGlobals();
    useAppStore.setState({ goldenFingerActive: false });
});

const pic = (id: number) =>
    ({ id, content: null, timestamp: `2026-10-0${id}T04:00:00Z`, type: 'picture', is_favorite: false, media_file: `messages/a/picture/${id}.jpg` }) as unknown as Message;
const messages = [pic(1), pic(2), pic(3)];
const tree = (active: boolean) => (
    <FeatureActiveContext.Provider value={active}>
        <MediaGalleryModal isOpen onClose={vi.fn()} messages={messages} memberName="n" serviceId="hinatazaka46" />
    </FeatureActiveContext.Provider>
);
const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    act(() => { target.dispatchEvent(e); });
    return e;
};

describe('MediaGalleryModal while its feature is hidden (Plan F, Decision 7)', () => {
    it('does not capture the arrow keys, and steps again once shown', async () => {
        const { rerender } = render(tree(true));
        await userEvent.click(screen.getAllByRole('button', { name: /^Open photo from / })[1]);
        const viewer = await screen.findByRole('dialog', { name: 'Media viewer' });
        const shown = () => viewer.querySelector('img')?.getAttribute('src') ?? '';
        expect(shown()).toMatch(/\/2\.jpg/);

        rerender(tree(false));
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
            expect(press({ key }).defaultPrevented).toBe(false);
        }

        rerender(tree(true));
        const back = await screen.findByRole('dialog', { name: 'Media viewer' });
        expect(press({ key: 'ArrowLeft' }).defaultPrevented).toBe(true);
        expect(back.querySelector('img')?.getAttribute('src')).toMatch(/\/1\.jpg/);
    });

    it('does not copy the hidden picture on Ctrl+C, and copies again once shown', async () => {
        const { rerender } = render(tree(true));
        await userEvent.click(screen.getAllByRole('button', { name: /^Open photo from / })[1]);
        await screen.findByRole('dialog', { name: 'Media viewer' });

        rerender(tree(false));
        expect(press({ key: 'c', ctrlKey: true }, window).defaultPrevented).toBe(false);
        expect(copyImage).not.toHaveBeenCalled();

        rerender(tree(true));
        expect(press({ key: 'c', ctrlKey: true }, window).defaultPrevented).toBe(true);
        expect(copyImage).toHaveBeenCalledTimes(1);
    });

    it('stops the thumbnail status poll while hidden and reads afresh when shown', async () => {
        fetchMock.mockImplementation(async () => new Response(JSON.stringify(running)));
        vi.useFakeTimers();
        try {
            const { rerender } = render(tree(true));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(statusCalls()).toBe(1);

            rerender(tree(false));
            await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
            expect(statusCalls()).toBe(1);

            rerender(tree(true));
            await act(async () => { await vi.advanceTimersByTimeAsync(0); });
            expect(statusCalls()).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
