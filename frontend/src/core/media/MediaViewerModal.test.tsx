import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { MediaViewerModal, type MediaViewerItem } from './PhotoDetailModal';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => resetDialogStack());

const items: MediaViewerItem[] = [
    { src: '/a.jpg', type: 'picture', timestamp: '2026-11-01T00:00:00Z', sourceLabel: '春の日記 🌸', onSourceJump: vi.fn() },
    { src: '/b.jpg', type: 'picture', timestamp: '2026-11-02T00:00:00Z' },
];

describe('MediaViewerModal', () => {
    it('is a dark named dialog with overlay controls', () => {
        render(<MediaViewerModal mediaItems={items} currentIndex={0} onClose={vi.fn()} onNavigate={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: 'Media viewer' })).toBeInTheDocument();
        expect(screen.getByTestId('modal-backdrop')).toHaveClass('bg-viewer-scrim');
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('bg-viewer-control');
        expect(screen.getByText('1 / 2')).toHaveClass('text-viewer-muted');
        expect(screen.getByRole('button', { name: '春の日記 🌸' })).toHaveClass('decoration-viewer');
    });

    it('← / → navigate, Escape closes through the dialog layer', async () => {
        const onNavigate = vi.fn();
        const onClose = vi.fn();
        render(<MediaViewerModal mediaItems={items} currentIndex={0} onClose={onClose} onNavigate={onNavigate} />);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
        expect(onNavigate).toHaveBeenCalledWith(1);
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the source link jumps', async () => {
        render(<MediaViewerModal mediaItems={items} currentIndex={0} onClose={vi.fn()} onNavigate={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: '春の日記 🌸' }));
        expect(items[0].onSourceJump).toHaveBeenCalled();
    });
});
