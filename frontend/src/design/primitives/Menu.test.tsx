import { useRef, useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu';
import { clampToViewport } from './menuPosition';
import { Z_INDEX } from '../../constants/zIndex';
import { Modal } from './Modal';
import { resetDialogStack } from '../dialog/dialogStack';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';

const realSize = { w: window.innerWidth, h: window.innerHeight };
afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: realSize.w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: realSize.h });
});

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
        expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveFocus();
        expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-inset', 'focus-visible:ring-accent');
        expect(menu).toHaveClass('bg-card', 'rounded-card', 'shadow-card');
        expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('menuitemradio', { name: '1x' })).toHaveClass('text-accent-strong');
        expect(screen.getByRole('menuitem', { name: '削除 🗑️' })).toHaveClass('text-status-danger');
        expect(screen.getByRole('separator')).not.toHaveClass('border-t');
    });

    it('skips items with a disabled reason when it opens, unless all have one', () => {
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem disabledReason="理由">一</MenuItem>
                <MenuItem>二</MenuItem>
            </Menu>,
        );
        expect(screen.getByRole('menuitem', { name: '二' })).toHaveFocus();
    });

    it('opens on the first item when every item has a disabled reason', () => {
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem disabledReason="理由">一</MenuItem>
                <MenuItem disabledReason="理由">二</MenuItem>
            </Menu>,
        );
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
    });

    it('never opens on a destructive item, even when it comes first', async () => {
        const onRemove = vi.fn();
        const { unmount } = render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem destructive onClick={onRemove}>削除</MenuItem>
                <MenuItem>二</MenuItem>
            </Menu>,
        );
        expect(screen.getByRole('menuitem', { name: '削除' })).toHaveAttribute('data-destructive');
        expect(screen.getByRole('menuitem', { name: '二' })).toHaveFocus();
        unmount();
        // Only destructive items (ServiceRail with one group): the menu itself takes focus, so Enter does nothing.
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem destructive onClick={onRemove}>削除</MenuItem>
            </Menu>,
        );
        expect(screen.getByRole('menu')).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        expect(onRemove).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('menu_open_focus', { target: 'menu', outcome: 'container' });
    });

    it('Enter and Space on an item with a disabledReason do not call its onClick', async () => {
        const onClick = vi.fn();
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem disabledReason="使えません" onClick={onClick}>一</MenuItem>
            </Menu>,
        );
        await userEvent.keyboard('{ArrowDown}');
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');
        expect(onClick).not.toHaveBeenCalled();
    });

    it('arrow keys, Home and End move between enabled items', async () => {
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem>一</MenuItem>
                <MenuItem disabled>二</MenuItem>
                <MenuItem>三</MenuItem>
            </Menu>,
        );
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
        const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        act(() => { screen.getByRole('menu').dispatchEvent(tab); });
        expect(tab.defaultPrevented).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('a mouse-down inside the menu does not close it', () => {
        const onClose = vi.fn();
        render(<Menu aria-label="m" onClose={onClose}><MenuItem>一</MenuItem></Menu>);
        fireEvent.mouseDown(screen.getByRole('menuitem', { name: '一' }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores an Escape that was already claimed, or typed in an IME', () => {
        const onClose = vi.fn();
        render(<Menu aria-label="m" onClose={onClose}><MenuItem>一</MenuItem></Menu>);
        const claimed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        claimed.preventDefault();
        act(() => { document.body.dispatchEvent(claimed); });
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true })); });
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, keyCode: 229 })); });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('with two menus open one Escape closes only the top-most', () => {
        const outer = vi.fn();
        const inner = vi.fn();
        render(
            <>
                <Menu aria-label="a" onClose={outer}><MenuItem>一</MenuItem></Menu>
                <Menu aria-label="b" onClose={inner}><MenuItem>二</MenuItem></Menu>
            </>,
        );
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
    });

    it('with stacked menus a second Escape closes the outer one once the inner has gone', () => {
        const outer = vi.fn();
        const Harness = () => {
            const [innerOpen, setInnerOpen] = useState(true);
            return (
                <>
                    <Menu aria-label="a" onClose={outer}><MenuItem>一</MenuItem></Menu>
                    {innerOpen && <Menu aria-label="b" onClose={() => setInnerOpen(false)}><MenuItem>二</MenuItem></Menu>}
                </>
            );
        };
        render(<Harness />);
        const escape = () => act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
        escape();
        expect(screen.queryByRole('menu', { name: 'b' })).toBeNull();
        expect(outer).not.toHaveBeenCalled();
        escape();
        expect(outer).toHaveBeenCalledTimes(1);
    });

    it('re-clamps a point menu to its measured size', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });
        const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 100 } as DOMRect);
        render(<Menu aria-label="m" onClose={vi.fn()} point={{ x: 290, y: 190 }} estimatedSize={{ width: 200, height: 48 }}><MenuItem>一</MenuItem></Menu>);
        spy.mockRestore();
        const menu = screen.getByRole('menu');
        expect(menu.style.left).toBe('192px');
        expect(menu.style.top).toBe('92px');
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
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
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
        expect(screen.getByRole('menuitem', { name: '二' })).toHaveFocus();
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
        expect(screen.getByRole('menuitem', { name: '一' })).toHaveFocus();
        expect(screen.getByRole('dialog')).not.toHaveFocus();
    });
});

describe('Menu key propagation', () => {
    it('keeps arrow keys from bubbling to an ancestor in the component tree', () => {
        const outer = vi.fn();
        render(
            <div onKeyDown={outer}>
                <Menu aria-label="m" onClose={vi.fn()}>
                    <MenuItem>One</MenuItem>
                    <MenuItem>Two</MenuItem>
                </Menu>
            </div>,
        );
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowRight' });
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
        fireEvent.keyDown(screen.getByRole('menuitem', { name: 'One' }), { key: 'Enter' });
        expect(outer).not.toHaveBeenCalled();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' });
        expect(outer).toHaveBeenCalledTimes(1);
    });
});

describe('MenuItem v2', () => {
    it('is a small-radius row (spec §7: menu items sm)', () => {
        render(<Menu aria-label="m" onClose={vi.fn()}><MenuItem>一</MenuItem></Menu>);
        const item = screen.getByRole('menuitem', { name: '一' });
        expect(item).toHaveClass('rounded-sm');
        expect(item).not.toHaveClass('rounded-pill');
    });

    it('a disabled item keeps its colour at 40 % instead of greying out', () => {
        render(<Menu aria-label="m" onClose={vi.fn()}><MenuItem disabled>二</MenuItem></Menu>);
        const item = screen.getByRole('menuitem', { name: '二' });
        expect(item).toHaveClass('disabled:opacity-40');
        expect(item.className).not.toMatch(/disabled:text-muted/);
    });

    it('with a reason it stays focusable, explains itself and logs a blocked click', async () => {
        const onClick = vi.fn();
        render(
            <Menu aria-label="m" onClose={vi.fn()}>
                <MenuItem>一</MenuItem>
                <MenuItem disabledReason="グループには無い" logTarget="sent_letters" onClick={onClick}>二</MenuItem>
            </Menu>,
        );
        const item = screen.getByRole('menuitem', { name: '二' });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        expect(item).toHaveAttribute('title', 'グループには無い');
        expect(item).toHaveAccessibleDescription('グループには無い');
        expect(item).toHaveClass('aria-disabled:opacity-40', 'aria-disabled:cursor-not-allowed');
        await userEvent.keyboard('{End}');
        expect(item).toHaveFocus();
        await userEvent.click(item);
        expect(onClick).not.toHaveBeenCalled();
        expect(clientLog).toHaveBeenCalledWith('menu_item_blocked', { target: 'sent_letters' });
    });
});
