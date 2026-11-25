import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Modal } from './Modal';
import { LiveRegion, LiveRegionHost } from './LiveRegion';
import { announce } from './announcer';
import { resetDialogStack } from '../dialog/dialogStack';

const LATER = 100;
const settle = () => act(() => { vi.advanceTimersByTime(LATER); });

describe('LiveRegion host', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        resetDialogStack();
    });

    it('is one always-mounted polite status in <body> while no dialog is open', () => {
        render(<LiveRegionHost />);
        const region = screen.getByRole('status');
        expect(region).toHaveAttribute('aria-live', 'polite');
        expect(region).toHaveClass('sr-only');
        expect(region.parentElement).toBe(document.body);
        expect(region).toBeEmptyDOMElement();
        act(() => announce('コピーしました 📋'));
        settle();
        expect(screen.getByRole('status')).toBe(region);
        expect(region).toHaveTextContent('コピーしました 📋');
    });

    it('lives inside the top dialog (an aria-modal element, never inert) while one is open', () => {
        const root = document.createElement('div');
        root.id = 'root';
        document.body.appendChild(root);
        try {
            const { rerender } = render(
                <>
                    <LiveRegionHost />
                    <Modal isOpen onClose={() => {}} aria-label="viewer" layout="bare">
                        <p>one</p>
                    </Modal>
                </>,
                { container: root },
            );
            expect(root).toHaveAttribute('inert');
            const region = screen.getByRole('status');
            expect(screen.getAllByRole('status')).toHaveLength(1);
            expect(region.closest('[aria-modal="true"]')).toBe(screen.getByRole('dialog'));
            expect(region.closest('[inert]')).toBeNull();

            // A second dialog opens: the region moves into it, the first one goes inert.
            rerender(
                <>
                    <LiveRegionHost />
                    <Modal isOpen onClose={() => {}} aria-label="viewer" layout="bare"><p>one</p></Modal>
                    <Modal isOpen onClose={() => {}} aria-label="detail" layout="bare"><p>two</p></Modal>
                </>,
            );
            const dialogs = screen.getAllByRole('dialog');
            const moved = screen.getByRole('status');
            expect(moved.closest('[aria-modal="true"]')).toBe(dialogs[dialogs.length - 1]);
            expect(moved.closest('[inert]')).toBeNull();

            // Back to none: the region returns to <body>.
            rerender(<LiveRegionHost />);
            expect(screen.getByRole('status').parentElement).toBe(document.body);
        } finally {
            root.remove();
        }
    });

    it('announces the same message twice, and a client announces through it', () => {
        const { rerender } = render(<><LiveRegionHost /><LiveRegion message="" /></>);
        const region = screen.getByRole('status');
        act(() => announce('コピーしました'));
        settle();
        expect(region).toHaveTextContent('コピーしました');
        act(() => announce('コピーしました'));
        // Cleared first, so a screen reader sees a change, then set again.
        expect(region).toBeEmptyDOMElement();
        settle();
        expect(region).toHaveTextContent('コピーしました');

        rerender(<><LiveRegionHost /><LiveRegion message="Call ended 📞" /></>);
        settle();
        expect(region).toHaveTextContent('Call ended 📞');
    });

    it('keeps a fresh message through a move and does not replay a stale one', () => {
        const { rerender } = render(<LiveRegionHost />);
        act(() => announce('fresh'));
        settle();
        rerender(
            <>
                <LiveRegionHost />
                <Modal isOpen onClose={() => {}} aria-label="d" layout="bare"><p>x</p></Modal>
            </>,
        );
        settle();
        expect(screen.getByRole('status')).toHaveTextContent('fresh');
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
        rerender(<LiveRegionHost />);
        settle();
        expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('cancels its set and clear timers when it unmounts mid-window', () => {
        const { unmount } = render(<LiveRegionHost />);
        act(() => announce('mid-window'));
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('removes its region on unmount', () => {
        const { unmount } = render(<LiveRegionHost />);
        unmount();
        expect(screen.queryByRole('status')).toBeNull();
    });
});
