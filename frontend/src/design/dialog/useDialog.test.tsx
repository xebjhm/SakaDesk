import { useLayoutEffect, useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { useDialog } from './useDialog';
import { openDialogCount, resetDialogStack } from './dialogStack';
import { Modal } from '../primitives/Modal';
import { Z_INDEX } from '../../constants/zIndex';

beforeEach(() => resetDialogStack());

/** A dialog built on the hook directly, mounted the whole time and opened by its isOpen flag. */
const HookDialog = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
    const frameRef = useRef<HTMLDivElement>(null);
    const { zIndex } = useDialog({ isOpen, onClose, dismissible: true, frameRef });
    return isOpen ? <div ref={frameRef} role="dialog" aria-label="hook" tabIndex={-1} style={{ zIndex }} /> : null;
};

describe('useDialog', () => {
    it('a dialog mounted early but opened later takes a fresh order and goes on top', async () => {
        const Harness = () => {
            const [hookOpen, setHookOpen] = useState(false);
            return (
                <>
                    <HookDialog isOpen={hookOpen} onClose={() => setHookOpen(false)} />
                    <Modal isOpen onClose={vi.fn()} title="先"><button onClick={() => setHookOpen(true)}>開く</button></Modal>
                </>
            );
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        const hook = screen.getByRole('dialog', { name: 'hook' });
        expect(hook.style.zIndex).toBe(String(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP));
        expect(hook).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'hook' })).toBeNull();
        expect(screen.getByRole('dialog', { name: '先' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '開く' })).toHaveFocus();
        // reopened: on top again
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        expect(screen.getByRole('dialog', { name: 'hook' }).style.zIndex).toBe(String(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP));
        expect(openDialogCount()).toBe(2);
    });

    it('closed: no stack entry and the base z-index', () => {
        const Probe = () => {
            const frameRef = useRef<HTMLDivElement>(null);
            const { zIndex } = useDialog({ isOpen: false, onClose: vi.fn(), dismissible: true, frameRef });
            return <span>{zIndex}</span>;
        };
        render(<Probe />);
        expect(openDialogCount()).toBe(0);
        expect(screen.getByText(String(Z_INDEX.DIALOG))).toBeInTheDocument();
    });

    it('listens for Escape as soon as it is on the stack (layout phase, before passive effects)', () => {
        const onClose = vi.fn();
        // A later sibling's layout effect runs after the dialog's push and focus but before any
        // passive effect: an Escape here must already reach the top-most dialog.
        const EarlyEscape = () => {
            useLayoutEffect(() => {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            }, []);
            return null;
        };
        render(<><HookDialog isOpen onClose={onClose} /><EarlyEscape /></>);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
