import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../i18n';
import { FavoritesModal } from './FavoritesModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';
import type { Message } from '../../types';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { resetDialogStack(); });

const video = { id: 5, content: null, timestamp: '2026-11-03T04:00:00Z', type: 'video', is_favorite: true, media_file: 'messages/a/video/5.mp4' } as unknown as Message;

const renderModal = () => {
    render(<FavoritesModal isOpen onClose={vi.fn()} messages={[video]} memberName="春野 ひなた" serviceId="hinatazaka46" />);
    return screen.getByTestId('modal-body').querySelector('video') as HTMLVideoElement;
};

describe('FavoritesModal video cards', () => {
    it('shows the skeleton while the video loads, keeping it laid out but invisible', () => {
        const el = renderModal();
        expect(screen.getByTestId('video-skeleton')).toHaveClass('animate-pulse', 'bg-sunken', 'motion-reduce:animate-none');
        expect(el).toHaveClass('opacity-0');
        expect(el).not.toHaveClass('hidden');
    });

    it('swaps the skeleton for the video once loaded', () => {
        const el = renderModal();
        fireEvent.loadedData(el);
        expect(screen.queryByTestId('video-skeleton')).toBeNull();
        expect(el).not.toHaveClass('opacity-0');
    });

    it('swaps the skeleton once metadata loads, when the engine stops there', () => {
        const el = renderModal();
        fireEvent.loadedMetadata(el);
        expect(screen.queryByTestId('video-skeleton')).toBeNull();
        expect(el).not.toHaveClass('opacity-0');
    });

    it('stops pulsing and logs a breadcrumb when the video fails to load', () => {
        vi.mocked(clientLog).mockClear();
        const el = renderModal();
        fireEvent.error(el);
        expect(screen.queryByTestId('video-skeleton')).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('favorite_video_error', { phase: 'load' });
    });
});
