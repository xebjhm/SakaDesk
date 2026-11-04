import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { Modal } from '../primitives/Modal';

/** Dispatch a key on `target`; true when something claimed it. */
function press(target: HTMLElement, key: string): boolean {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(ev); });
    return ev.defaultPrevented;
}

describe('useDialog and a dialog outside the layer (the lifted call)', () => {
    it('leaves Escape and Tab pressed inside it to that dialog', () => {
        const onClose = vi.fn();
        render(
            <>
                <Modal isOpen onClose={onClose} title="設定" closeLabel="Close"><button>inside</button></Modal>
                <div role="dialog" aria-label="call" tabIndex={-1}><button>Decline</button></div>
            </>,
        );
        const decline = screen.getByRole('button', { name: 'Decline' });
        act(() => decline.focus());
        expect(decline).toHaveFocus();
        expect(press(decline, 'Escape')).toBe(false);
        expect(onClose).not.toHaveBeenCalled();
        expect(press(decline, 'Tab')).toBe(false);
        expect(decline).toHaveFocus();
    });

    it('still closes on Escape pressed elsewhere', () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="設定" closeLabel="Close">x</Modal>);
        expect(press(document.body, 'Escape')).toBe(true);
        expect(onClose).toHaveBeenCalledOnce();
    });
});
