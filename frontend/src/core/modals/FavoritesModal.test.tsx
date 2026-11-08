import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import i18n from '../../i18n';
import { FavoritesModal } from './FavoritesModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
let ioCallback: IntersectionObserverCallback | null = null;
const observe = vi.fn();
const disconnect = vi.fn();
beforeEach(() => {
    resetDialogStack();
    ioCallback = null;
    observe.mockClear();
    disconnect.mockClear();
    vi.stubGlobal('IntersectionObserver', class {
        constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
        observe = observe; unobserve = vi.fn(); disconnect = disconnect;
    });
});
afterEach(() => { vi.unstubAllGlobals(); });
const scrollIntoView = () => act(() => {
    ioCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
});

const video = { id: 5, content: null, timestamp: '2026-11-03T04:00:00Z', type: 'video', is_favorite: true, media_file: 'messages/a/video/5.mp4' } as unknown as Message;

const renderModal = () => {
    render(<FavoritesModal isOpen onClose={vi.fn()} messages={[video]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
};
const getVideo = () => screen.getByTestId('modal-body').querySelector('video') as HTMLVideoElement;

describe('FavoritesModal video cards', () => {
    it('mounts no <video> until the card scrolls into view', () => {
        renderModal();
        expect(observe).toHaveBeenCalled();
        expect(screen.getByTestId('modal-body').querySelector('video')).toBeNull();
        expect(screen.getByTestId('video-skeleton')).toBeInTheDocument();
        scrollIntoView();
        expect(getVideo()).toHaveAttribute('src', expect.stringContaining('5.mp4'));
        expect(disconnect).toHaveBeenCalled();
    });

    it('shows a shimmer sweep and a centred Film icon, static under reduced motion', () => {
        renderModal();
        const skeleton = screen.getByTestId('video-skeleton');
        expect(skeleton).toHaveClass('bg-sunken', 'flex', 'items-center', 'justify-center', 'overflow-hidden');
        expect(skeleton).not.toHaveClass('animate-pulse');
        expect(screen.getByTestId('video-shimmer')).toHaveClass('animate-shimmer-sweep', 'motion-reduce:hidden');
        expect(skeleton.querySelector('svg')).toHaveClass('text-secondary');
    });

    it('keeps the loading video laid out but invisible', () => {
        renderModal();
        scrollIntoView();
        expect(getVideo()).toHaveClass('opacity-0');
        expect(getVideo()).not.toHaveClass('hidden');
    });

    it('swaps the skeleton for the video once loaded', () => {
        renderModal();
        scrollIntoView();
        fireEvent.loadedData(getVideo());
        expect(screen.queryByTestId('video-skeleton')).toBeNull();
        expect(getVideo()).not.toHaveClass('opacity-0');
    });

    it('swaps the skeleton once metadata loads, when the engine stops there', () => {
        renderModal();
        scrollIntoView();
        fireEvent.loadedMetadata(getVideo());
        expect(screen.queryByTestId('video-skeleton')).toBeNull();
        expect(getVideo()).not.toHaveClass('opacity-0');
    });

    it('stops the shimmer and logs a breadcrumb when the video fails to load', () => {
        vi.mocked(clientLog).mockClear();
        renderModal();
        scrollIntoView();
        fireEvent.error(getVideo());
        expect(screen.queryByTestId('video-skeleton')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('favorite_video_error', { phase: 'load' });
    });
});
