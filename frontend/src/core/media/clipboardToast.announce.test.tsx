import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MediaViewerModal } from './PhotoDetailModal';
import { LiveRegionHost } from '../../design/primitives';
import { resetDialogStack } from '../../design/dialog/dialogStack';

vi.mock('./useClipboardShortcut', () => ({ useClipboardShortcut: () => ({ toastMessage: 'コピーしました 📋' }) }));

describe('clipboard toast in the photo viewer', () => {
    afterEach(() => resetDialogStack());

    it('is hidden from assistive tech; the announcer inside the dialog carries the text', () => {
        vi.useFakeTimers();
        try {
            render(
                <>
                    <LiveRegionHost />
                    <MediaViewerModal
                        mediaItems={[{ src: '/a.jpg', type: 'picture', timestamp: '2026-11-01T10:00:00Z' }]}
                        currentIndex={0}
                        onClose={() => {}}
                        onNavigate={() => {}}
                    />
                </>,
            );
            act(() => { vi.advanceTimersByTime(100); });
            const visible = screen.getAllByText('コピーしました 📋').find((el) => el.getAttribute('role') !== 'status');
            expect(visible).toHaveAttribute('aria-hidden', 'true');
            const announcer = screen.getByRole('status');
            expect(announcer).toHaveTextContent('コピーしました 📋');
            expect(announcer.closest('[aria-modal="true"]')).toBe(screen.getByRole('dialog'));
        } finally {
            vi.useRealTimers();
        }
    });
});
