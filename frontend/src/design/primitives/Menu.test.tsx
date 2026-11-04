import { useRef, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuItem, MenuLabel, MenuSeparator, clampToViewport } from './Menu';
import { Z_INDEX } from '../../constants/zIndex';
import { Modal } from './Modal';
import { resetDialogStack } from '../dialog/dialogStack';

describe('Menu', () => {
    it('is a labelled menu of menuitems and takes focus', () => {
        render(
            <Menu aria-label="操作" onClose={vi.fn()}>
                <MenuLabel>速度</MenuLabel>
                <MenuItem radio selected>1x</MenuItem>
                <MenuItem radio>2x</MenuItem>
                <MenuSeparator />
                <MenuItem destructive>削除 🗑️</MenuItem>
            </Menu>,
        );
        const menu = screen.getByRole('menu', { name: '操作' });
        expect(menu).toHaveFocus();
        expect(menu).toHaveClass('bg-card', 'rounded-card', 'shadow-card');
        expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveClass('text-group-strong');
        expect(screen.getByRole('menuitem', { name: '削除 🗑️' })).toHaveClass('text-status-danger');
        expect(screen.getByRole('separator')).not.toHaveClass('border-t');
    });

    it('arrow keys, Home and End move between enabled items', async () => {
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem>一</MenuItem>
                <MenuItem disabled>二</MenuItem>
                <MenuItem>三</MenuItem>
            </Menu>,
        );
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: '三' })).toHaveFocus();
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
        await userEvent.keyboard('{End}');
        expect(screen.getByRole('menuitem', { name: '三' })).toHaveFocus();
        await userEvent.keyboard('{Home}');
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
        await userEvent.keyboard('{ArrowUp}');
        expect(screen.getByRole('menuitem', { name: '三' })).toHaveFocus();
    });

    it('Escape closes, is claimed before dialogs see it, and returns focus to the trigger', () => {
        const Harness = () => {
            const [open, setOpen] = useState(true);
            const trigger = useRef<HTMLButtonElement>(null);
            return (
                <>
                    <button ref={trigger}>trigger</button>
                    {open && <Menu aria-label="m" onClose={() => setOpen(false)} returnFocusRef={trigger}><MenuItem>一</MenuItem></Menu>}
                </>
            );
        };
        render(<Harness />);
        const later = vi.fn((e: KeyboardEvent) => e.defaultPrevented);
        document.addEventListener('keydown', later);
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
        document.removeEventListener('keydown', later);
        expect(screen.queryByRole('menu')).toBeNull();
        expect(later.mock.results[0].value).toBe(true);
        expect(screen.getByRole('button', { name: 'trigger' })).toHaveFocus();
    });

    it('an outside mouse-down and Tab close it; the trigger is ignored', () => {
        const onClose = vi.fn();
        const Harness = () => {
            const trigger = useRef<HTMLButtonElement>(null);
            return (
                <>
                    <button ref={trigger}>trigger</button>
                    <Menu aria-label="m" onClose={onClose} ignoreRefs={[trigger]}><MenuItem>一</MenuItem></Menu>
                </>
            );
        };
        render(<Harness />);
        fireEvent.mouseDown(screen.getByRole('button', { name: 'trigger' }));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(document.body);
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('a point menu is portaled, fixed, clamped and above dialogs', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });
        render(<Menu aria-label="m" onClose={vi.fn()} point={{ x: 290, y: 190 }} estimatedSize={{ width: 200, height: 48 }}><MenuItem>一</MenuItem></Menu>);
        const menu = screen.getByRole('menu');
        expect(menu.parentElement).toBe(document.body);
        expect(menu.style.position).toBe('fixed');
        expect(menu.style.left).toBe('92px');
        expect(menu.style.top).toBe('144px');
        expect(menu.style.zIndex).toBe(String(Z_INDEX.POPOVER));
    });
});

describe('clampToViewport', () => {
    it('keeps the box inside the viewport with padding', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        expect(clampToViewport(10, 10, { width: 200, height: 48 })).toEqual({ left: 10, top: 10 });
        expect(clampToViewport(990, 790, { width: 200, height: 48 })).toEqual({ left: 792, top: 744 });
        expect(clampToViewport(-5, -5, { width: 200, height: 48 })).toEqual({ left: 8, top: 8 });
    });
});

describe('Menu inside a Modal', () => {
    const Harness = ({ onDialogClose }: { onDialogClose: () => void }) => {
        const [menu, setMenu] = useState(false);
        const trigger = useRef<HTMLButtonElement>(null);
        return (
            <Modal isOpen onClose={onDialogClose} title="設定" closeLabel="閉じる">
                <button ref={trigger} onClick={() => setMenu(true)}>開く</button>
                <button>他</button>
                {menu && (
                    <Menu aria-label="m" onClose={() => setMenu(false)} returnFocusRef={trigger} ignoreRefs={[trigger]}>
                        <MenuItem>一</MenuItem>
                        <MenuItem>二</MenuItem>
                    </Menu>
                )}
            </Modal>
        );
    };

    it('Escape closes only the menu, the dialog stays and focus returns to the trigger', async () => {
        resetDialogStack();
        const onDialogClose = vi.fn();
        render(<Harness onDialogClose={onDialogClose} />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        expect(screen.getByRole('menu')).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('menu')).toBeNull();
        expect(onDialogClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '開く' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(onDialogClose).toHaveBeenCalledTimes(1);
    });

    it('arrows work inside; Tab closes the menu and carries on from the trigger', async () => {
        resetDialogStack();
        render(<Harness onDialogClose={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        // Tab is consumed: the menu returns focus to the trigger, and the next Tab moves on from there.
        expect(screen.getByRole('button', { name: '開く' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '他' })).toHaveFocus();
    });

    it('focus moving into the menu is not pulled back to the dialog', async () => {
        resetDialogStack();
        render(<Harness onDialogClose={vi.fn()} />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        expect(screen.getByRole('menu')).toHaveFocus();
        expect(screen.getByRole('dialog')).not.toHaveFocus();
    });
});
