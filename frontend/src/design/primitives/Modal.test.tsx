import React, { StrictMode, useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import { Modal } from './Modal';
import { BrandScope } from '../brandScope';
import { brandAccent } from '../tokens';
import { Button } from './Button';
import { openDialogCount, resetDialogStack } from '../dialog/dialogStack';
import { Z_INDEX } from '../../constants/zIndex';
import { ignoresPostKeys } from '../../features/blogs/components/arrowKeys';

beforeEach(() => resetDialogStack());
afterEach(() => vi.mocked(clientLog).mockClear());

const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

describe('Modal', () => {
    it('renders nothing when closed', () => {
        render(<Modal isOpen={false} onClose={vi.fn()} title="t">body</Modal>);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is a named modal dialog on a level-1 sheet with a scrim', () => {
        render(<Modal isOpen onClose={vi.fn()} title="設定 ⚙️" closeLabel="閉じる" footer={<Button>OK</Button>}>本文</Modal>);
        const dialog = screen.getByRole('dialog', { name: '設定 ⚙️' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveClass('bg-sheet', 'rounded-xl', 'shadow-sheet', 'animate-reveal');
        expect(screen.getByTestId('modal-backdrop')).toHaveClass('bg-scrim');
        expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    });

    it('the expressive close button focuses in the header focus colour, not the accent', () => {
        render(<Modal isOpen onClose={vi.fn()} title="t" closeLabel="閉じる">x</Modal>);
        const close = screen.getByRole('button', { name: '閉じる' });
        // Header text on a gradient header, the strong title tone on a light one (accent.ts headerFocus).
        expect(close).toHaveClass('focus-visible:ring-expressive-header-focus', 'focus-visible:ring-offset-0');
        expect(close.className).not.toContain('focus-visible:ring-accent');
        expect(close.className).not.toMatch(/focus-visible:ring-expressive-header(\s|$)/);
    });

    it('plain and console headers do not take the expressive header focus ring', () => {
        const { unmount } = render(<Modal isOpen onClose={vi.fn()} title="t" closeLabel="閉じる" header="plain">x</Modal>);
        expect(screen.getByRole('button', { name: '閉じる' }).className).not.toContain('ring-expressive-header');
        unmount();
        render(<Modal isOpen onClose={vi.fn()} title="t" closeLabel="閉じる" header="console">x</Modal>);
        expect(screen.getByRole('button', { name: '閉じる' }).className).not.toContain('ring-expressive-header');
    });

    it('takes its name from aria-label or labelledBy in a bare layout', () => {
        render(
            <>
                <Modal isOpen onClose={vi.fn()} aria-label="検索" layout="bare"><input /></Modal>
            </>,
        );
        expect(screen.getByRole('dialog', { name: '検索' })).toBeInTheDocument();
    });

    it('moves focus in, traps Tab and restores focus on close', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button onClick={() => setOpen(true)}>開く</button>
                    <Modal isOpen={open} onClose={() => setOpen(false)} title="t" closeLabel="閉じる">
                        <button>一</button>
                        <button>二</button>
                    </Modal>
                </>
            );
        };
        render(<Harness />);
        const opener = screen.getByRole('button', { name: '開く' });
        await userEvent.click(opener);
        expect(screen.getByRole('dialog')).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus();
        await userEvent.tab();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(opener).toHaveFocus();
    });

    it('focuses initialFocusRef when given', () => {
        const Harness = () => {
            const ref = useRef<HTMLInputElement>(null);
            return <Modal isOpen onClose={vi.fn()} aria-label="s" layout="bare" initialFocusRef={ref}><input ref={ref} aria-label="q" /></Modal>;
        };
        render(<Harness />);
        expect(screen.getByRole('textbox', { name: 'q' })).toHaveFocus();
    });

    it('Escape closes only the top-most dialog and claims the key', () => {
        const outer = vi.fn();
        const inner = vi.fn();
        render(
            <>
                <Modal isOpen onClose={outer} title="外">a</Modal>
                <Modal isOpen onClose={inner} title="内">b</Modal>
            </>,
        );
        const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        act(() => { document.body.dispatchEvent(e); });
        expect(inner).toHaveBeenCalledTimes(1);
        expect(outer).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(true);
    });

    it('stacks z-index by depth', () => {
        render(
            <>
                <Modal isOpen onClose={vi.fn()} title="外">a</Modal>
                <Modal isOpen onClose={vi.fn()} title="内">b</Modal>
            </>,
        );
        const [first, second] = screen.getAllByTestId('modal-backdrop');
        expect(first.style.zIndex).toBe(String(Z_INDEX.DIALOG));
        expect(second.style.zIndex).toBe(String(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP));
    });

    it('ignores Escape that is already handled, typed in an IME, or exits fullscreen', () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="t">x</Modal>);
        // A handler inside the dialog (search, a menu, the viewer) already claimed the key.
        const claim = (e: KeyboardEvent) => e.preventDefault();
        document.body.addEventListener('keydown', claim);
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
        document.body.removeEventListener('keydown', claim);
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })); });
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.body });
        esc();
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on a backdrop click but not on a click inside', async () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="t">inside</Modal>);
        await userEvent.click(screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();
        await userEvent.click(screen.getByTestId('modal-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a non-dismissible dialog ignores Escape and the backdrop and has no close button', async () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="規約" closeLabel="閉じる" dismissible={false}>x</Modal>);
        esc();
        await userEvent.click(screen.getByTestId('modal-backdrop'));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: '閉じる' })).toBeNull();
    });

    it('the viewer tone is dark and has no sheet frame', () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="viewer" tone="viewer" layout="bare">x</Modal>);
        expect(screen.getByTestId('modal-backdrop')).toHaveClass('bg-viewer-scrim');
        expect(screen.getByRole('dialog')).not.toHaveClass('bg-sheet');
    });

    it('top placement aligns the dialog near the top', () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="s" placement="top" layout="bare">x</Modal>);
        expect(screen.getByTestId('modal-backdrop')).toHaveClass('items-start');
    });

    it('logs open and close with the reason when it has a logId', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(true);
            return <Modal isOpen={open} onClose={() => setOpen(false)} title="t" closeLabel="閉じる" logId="about">x</Modal>;
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'about', phase: 'open' });
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'about', phase: 'close', reason: 'button' });
    });

    it('logs a close the app made itself as reason app', () => {
        const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="t" logId="search">x</Modal>);
        rerender(<Modal isOpen={false} onClose={vi.fn()} title="t" logId="search">x</Modal>);
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'search', phase: 'close', reason: 'app' });
    });

    it('unlocks body scroll when the last dialog closes', () => {
        const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="t">x</Modal>);
        expect(document.body.style.overflow).toBe('hidden');
        rerender(<Modal isOpen={false} onClose={vi.fn()} title="t">x</Modal>);
        expect(document.body.style.overflow).not.toBe('hidden');
    });
});

describe('Modal: the dialog layer in depth', () => {
    /** A dialog whose content opens a second dialog (settings → confirm, gallery → calendar). */
    const Nested = ({ onOuterClose = vi.fn(), logged = false }: { onOuterClose?: () => void; logged?: boolean }) => {
        const [outer, setOuter] = useState(false);
        const [inner, setInner] = useState(false);
        return (
            <>
                <button onClick={() => setOuter(true)}>開く</button>
                <Modal
                    isOpen={outer}
                    onClose={() => { onOuterClose(); setOuter(false); }}
                    title="外"
                    closeLabel="外を閉じる"
                    logId={logged ? 'settings' : undefined}
                >
                    <button onClick={() => setInner(true)}>確認を開く</button>
                    <Modal
                        isOpen={inner}
                        onClose={() => setInner(false)}
                        title="内"
                        closeLabel="内を閉じる"
                        logId={logged ? 'confirm' : undefined}
                    >
                        <button>はい</button>
                    </Modal>
                </Modal>
            </>
        );
    };

    it('nested: Escape closes the inner dialog, focus returns to its opener, the next Escape closes the outer', async () => {
        const onOuterClose = vi.fn();
        render(<Nested onOuterClose={onOuterClose} />);
        const opener = screen.getByRole('button', { name: '開く' });
        await userEvent.click(opener);
        const innerOpener = screen.getByRole('button', { name: '確認を開く' });
        await userEvent.click(innerOpener);
        expect(screen.getByRole('dialog', { name: '内' })).toHaveFocus();
        expect(openDialogCount()).toBe(2);
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: '内' })).toBeNull();
        expect(screen.getByRole('dialog', { name: '外' })).toBeInTheDocument();
        expect(onOuterClose).not.toHaveBeenCalled();
        expect(innerOpener).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        expect(onOuterClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(opener).toHaveFocus();
        expect(openDialogCount()).toBe(0);
    });

    it('nested: the inner dialog sits one step above the outer and Tab stays inside the inner', async () => {
        render(<Nested />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.click(screen.getByRole('button', { name: '確認を開く' }));
        const [outerBackdrop, innerBackdrop] = screen.getAllByTestId('modal-backdrop');
        expect(outerBackdrop.style.zIndex).toBe(String(Z_INDEX.DIALOG));
        expect(innerBackdrop.style.zIndex).toBe(String(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP));
        const inner = screen.getByRole('dialog', { name: '内' });
        for (let i = 0; i < 4; i += 1) {
            await userEvent.tab();
            expect(inner.contains(document.activeElement)).toBe(true);
        }
    });

    it('nested: a backdrop click on the inner dialog closes only the inner one', async () => {
        const onOuterClose = vi.fn();
        render(<Nested onOuterClose={onOuterClose} />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.click(screen.getByRole('button', { name: '確認を開く' }));
        await userEvent.click(screen.getAllByTestId('modal-backdrop')[1]);
        expect(screen.queryByRole('dialog', { name: '内' })).toBeNull();
        expect(onOuterClose).not.toHaveBeenCalled();
    });

    it('nested: closing the outer dialog with the inner one open closes both and unlocks scroll', async () => {
        document.body.style.overflow = 'auto';
        const Harness = () => {
            const [open, setOpen] = useState(true);
            return (
                <>
                    <button onClick={() => setOpen(false)}>全部閉じる</button>
                    <Modal isOpen={open} onClose={vi.fn()} title="外" logId="media_gallery">
                        <Modal isOpen onClose={vi.fn()} title="内" logId="calendar">x</Modal>
                    </Modal>
                </>
            );
        };
        render(<Harness />);
        expect(openDialogCount()).toBe(2);
        act(() => { screen.getByRole('button', { name: '全部閉じる', hidden: true }).click(); });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(openDialogCount()).toBe(0);
        expect(document.body.style.overflow).toBe('auto');
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'calendar', phase: 'close', reason: 'app' });
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'media_gallery', phase: 'close', reason: 'app' });
    });

    it('nested breadcrumbs: escape on the inner, button on the outer', async () => {
        render(<Nested logged />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.click(screen.getByRole('button', { name: '確認を開く' }));
        await userEvent.keyboard('{Escape}');
        await userEvent.click(screen.getByRole('button', { name: '外を閉じる' }));
        expect(vi.mocked(clientLog).mock.calls).toEqual([
            ['dialog', { surface: 'settings', phase: 'open' }],
            ['dialog', { surface: 'confirm', phase: 'open' }],
            ['dialog', { surface: 'confirm', phase: 'close', reason: 'escape' }],
            ['dialog', { surface: 'settings', phase: 'close', reason: 'button' }],
        ]);
    });

    it('sibling stacking: closing the lower dialog first leaves the upper one top-most', () => {
        const lower = vi.fn();
        const upper = vi.fn();
        const { rerender } = render(
            <>
                <Modal isOpen onClose={lower} title="下">a</Modal>
                <Modal isOpen onClose={upper} title="上">b</Modal>
            </>,
        );
        rerender(
            <>
                <Modal isOpen={false} onClose={lower} title="下">a</Modal>
                <Modal isOpen onClose={upper} title="上">b</Modal>
            </>,
        );
        expect(document.body.style.overflow).toBe('hidden');
        esc();
        expect(upper).toHaveBeenCalledTimes(1);
        expect(lower).not.toHaveBeenCalled();
    });

    it('does not restore focus to an opener that unmounted while the dialog was open', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(false);
            return (
                <>
                    {!open && <button onClick={() => setOpen(true)}>開く</button>}
                    <button>他</button>
                    <Modal isOpen={open} onClose={() => setOpen(false)} title="t" closeLabel="閉じる">x</Modal>
                </>
            );
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        expect(screen.queryByRole('button', { name: '開く' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(document.body);
    });

    it('works under StrictMode: one stack entry, scroll locked once, focus in and restored', async () => {
        document.body.style.overflow = 'auto';
        const Harness = () => {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button onClick={() => setOpen(true)}>開く</button>
                    <Modal isOpen={open} onClose={() => setOpen(false)} title="t" closeLabel="閉じる">x</Modal>
                </>
            );
        };
        render(<StrictMode><Harness /></StrictMode>);
        const opener = screen.getByRole('button', { name: '開く' });
        await userEvent.click(opener);
        expect(openDialogCount()).toBe(1);
        expect(document.body.style.overflow).toBe('hidden');
        expect(screen.getByRole('dialog')).toHaveFocus();
        expect(screen.getByTestId('modal-backdrop').style.zIndex).toBe(String(Z_INDEX.DIALOG));
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(openDialogCount()).toBe(0);
        expect(document.body.style.overflow).toBe('auto');
        expect(opener).toHaveFocus();
    });

    it('StrictMode nested: Escape closes only the inner dialog', async () => {
        const onOuterClose = vi.fn();
        render(<StrictMode><Nested onOuterClose={onOuterClose} /></StrictMode>);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.click(screen.getByRole('button', { name: '確認を開く' }));
        expect(openDialogCount()).toBe(2);
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: '内' })).toBeNull();
        expect(onOuterClose).not.toHaveBeenCalled();
        expect(openDialogCount()).toBe(1);
    });

    it('restores the body overflow value it found', () => {
        document.body.style.overflow = 'scroll';
        const { rerender } = render(<Modal isOpen onClose={vi.fn()} title="t">x</Modal>);
        rerender(<Modal isOpen={false} onClose={vi.fn()} title="t">x</Modal>);
        expect(document.body.style.overflow).toBe('scroll');
    });

    it('a dialog that unmounts while open pops its entry and logs reason app', () => {
        const { unmount } = render(<Modal isOpen onClose={vi.fn()} title="t" logId="favorites">x</Modal>);
        expect(openDialogCount()).toBe(1);
        unmount();
        expect(openDialogCount()).toBe(0);
        expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'favorites', phase: 'close', reason: 'app' });
    });

    it('logs nothing without a logId', async () => {
        const onClose = vi.fn();
        const { rerender } = render(<Modal isOpen onClose={onClose} title="t">x</Modal>);
        esc();
        rerender(<Modal isOpen={false} onClose={onClose} title="t">x</Modal>);
        expect(clientLog).not.toHaveBeenCalled();
    });

    it('logs a backdrop close with reason backdrop', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(true);
            return <Modal isOpen={open} onClose={() => setOpen(false)} title="t" logId="calendar">x</Modal>;
        };
        render(<Harness />);
        await userEvent.click(screen.getByTestId('modal-backdrop'));
        expect(clientLog).toHaveBeenLastCalledWith('dialog', { surface: 'calendar', phase: 'close', reason: 'backdrop' });
    });

    it('a non-dismissible dialog still traps Tab', async () => {
        render(<Modal isOpen onClose={vi.fn()} title="規約" dismissible={false}><button>同意</button></Modal>);
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '同意' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '同意' })).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('button', { name: '同意' })).toHaveFocus();
    });

    it('Tab with nothing tabbable keeps focus on the frame', async () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="空" layout="bare">x</Modal>);
        const dialog = screen.getByRole('dialog', { name: '空' });
        await userEvent.tab();
        expect(dialog).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(dialog).toHaveFocus();
    });

    it('Tab from outside the frame moves focus to the first (Shift+Tab: the last) element', async () => {
        render(
            <>
                <button>外のボタン</button>
                <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare"><button>一</button><button>二</button></Modal>
            </>,
        );
        act(() => screen.getByRole('button', { name: '外のボタン', hidden: true }).focus());
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '一' })).toHaveFocus();
        act(() => screen.getByRole('button', { name: '外のボタン', hidden: true }).focus());
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
    });

    it('skips disabled controls and tabindex=-1 elements in the trap', async () => {
        render(
            <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare">
                <button>一</button>
                <button>二</button>
                <button disabled>無効</button>
                <div tabIndex={-1}>枠</div>
            </Modal>,
        );
        await userEvent.tab();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '一' })).toHaveFocus();
    });

    it('leaves Tab to an open menu that holds the focus', () => {
        render(
            <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare">
                <button>一</button>
                <div role="menu"><button role="menuitem">項目</button></div>
            </Modal>,
        );
        const item = screen.getByRole('menuitem', { name: '項目' });
        act(() => item.focus());
        const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        act(() => { item.dispatchEvent(e); });
        expect(e.defaultPrevented).toBe(false);
    });

    it('passes its own keys to onKeyDown and still closes on Escape', () => {
        const onKeyDown = vi.fn();
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} aria-label="viewer" tone="viewer" layout="bare" onKeyDown={onKeyDown}>x</Modal>);
        const dialog = screen.getByRole('dialog', { name: 'viewer' });
        fireEvent.keyDown(dialog, { key: 'ArrowRight' });
        expect(onKeyDown).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('an onKeyDown that claims Escape keeps the dialog open', () => {
        const onClose = vi.fn();
        render(
            <Modal isOpen onClose={onClose} aria-label="d" layout="bare" onKeyDown={(e) => { if (e.key === 'Escape') e.preventDefault(); }}>x</Modal>,
        );
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores Escape with key code 229 (IME)', () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="t">x</Modal>);
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', keyCode: 229 });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('the viewer tone closes on a click on its empty stage, not on its content', async () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} aria-label="viewer" tone="viewer" layout="bare"><img alt="写真" /></Modal>);
        await userEvent.click(screen.getByRole('img', { name: '写真' }));
        expect(onClose).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('dialog', { name: 'viewer' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a non-dismissible viewer ignores a click on its stage', async () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} aria-label="viewer" tone="viewer" layout="bare" dismissible={false}>x</Modal>);
        await userEvent.click(screen.getByRole('dialog', { name: 'viewer' }));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('takes its name from labelledBy in a bare layout', () => {
        render(<Modal isOpen onClose={vi.fn()} labelledBy="h" layout="bare"><h2 id="h">ログイン</h2></Modal>);
        expect(screen.getByRole('dialog', { name: 'ログイン' })).toBeInTheDocument();
    });

    it('a title wins over aria-label in the standard layout', () => {
        render(<Modal isOpen onClose={vi.fn()} title="見出し" aria-label="ラベル">x</Modal>);
        expect(screen.getByRole('dialog', { name: '見出し' })).toBeInTheDocument();
    });

    it('renders headerExtra and the body class', () => {
        render(<Modal isOpen onClose={vi.fn()} title="t" headerExtra={<span>12 件</span>} bodyClassName="p-0">本文</Modal>);
        expect(screen.getByText('12 件')).toBeInTheDocument();
        expect(screen.getByText('本文')).toHaveClass('p-0');
    });

    it('top placement pads 15vh from the top above the stacked z-index', () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="s" placement="top" layout="bare">x</Modal>);
        const backdrop = screen.getByTestId('modal-backdrop');
        expect(backdrop.style.paddingTop).toBe('15vh');
        expect(backdrop.style.zIndex).toBe(String(Z_INDEX.DIALOG));
    });

    it('marks the page so blog ← / → stay with the dialog', () => {
        const key = () => new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
        const { rerender } = render(<Modal isOpen={false} onClose={vi.fn()} title="t">x</Modal>);
        expect(ignoresPostKeys(key())).toBe(false);
        rerender(<Modal isOpen onClose={vi.fn()} title="t">x</Modal>);
        expect(ignoresPostKeys(key())).toBe(true);
    });

    describe('a parent and its child opening in the same render (restored or deep-linked state)', () => {
        const SameRender = ({ onParentClose, onChildClose, depth = 2 }: { onParentClose: () => void; onChildClose: () => void; depth?: 2 | 3 }) => {
            const [open, setOpen] = useState(false);
            const [child, setChild] = useState(true);
            const [grandchild, setGrandchild] = useState(depth === 3);
            return (
                <>
                    <button onClick={() => setOpen(true)}>開く</button>
                    <Modal isOpen={open} onClose={() => { onParentClose(); setOpen(false); }} title="親" closeLabel="親を閉じる" logId="media_gallery">
                        <Modal isOpen={child} onClose={() => { onChildClose(); setChild(false); }} title="子" closeLabel="子を閉じる" logId="calendar">
                            <button>日</button>
                            <Modal isOpen={grandchild} onClose={() => setGrandchild(false)} title="孫" logId="confirm">
                                <button>はい</button>
                            </Modal>
                        </Modal>
                    </Modal>
                </>
            );
        };

        const run = async (wrap: (n: React.ReactNode) => React.ReactNode) => {
            const onParentClose = vi.fn();
            const onChildClose = vi.fn();
            render(<>{wrap(<SameRender onParentClose={onParentClose} onChildClose={onChildClose} />)}</>);
            const opener = screen.getByRole('button', { name: '開く' });
            await userEvent.click(opener);
            expect(openDialogCount()).toBe(2);
            const parent = screen.getByRole('dialog', { name: '親' });
            const child = screen.getByRole('dialog', { name: '子' });
            const z = (d: HTMLElement) => Number(d.parentElement!.style.zIndex);
            expect(z(parent)).toBe(Z_INDEX.DIALOG);
            expect(z(child)).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP);
            expect(child).toHaveFocus();
            // Tab stays in the child (the top-most)
            await userEvent.tab();
            expect(child.contains(document.activeElement)).toBe(true);
            await userEvent.keyboard('{Escape}');
            expect(onChildClose).toHaveBeenCalledTimes(1);
            expect(onParentClose).not.toHaveBeenCalled();
            expect(screen.queryByRole('dialog', { name: '子' })).toBeNull();
            // the child had no opener of its own: focus goes to the parent
            expect(parent).toHaveFocus();
            expect(z(parent)).toBe(Z_INDEX.DIALOG);
            await userEvent.keyboard('{Escape}');
            expect(onParentClose).toHaveBeenCalledTimes(1);
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(opener).toHaveFocus();
            expect(openDialogCount()).toBe(0);
            expect(document.body.style.overflow).not.toBe('hidden');
        };

        it('the child is top-most with the higher z-index; Escape closes the child, then the parent', async () => {
            await run((n) => n);
        });

        it('the same under StrictMode', async () => {
            await run((n) => <StrictMode>{n}</StrictMode>);
        });

        it('logs both opens and the child close before the parent close', async () => {
            await run((n) => n);
            const calls = vi.mocked(clientLog).mock.calls.filter(([, f]) => (f as { phase: string }).phase === 'close');
            expect(calls).toEqual([
                ['dialog', { surface: 'calendar', phase: 'close', reason: 'escape' }],
                ['dialog', { surface: 'media_gallery', phase: 'close', reason: 'escape' }],
            ]);
            expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'media_gallery', phase: 'open' });
            expect(clientLog).toHaveBeenCalledWith('dialog', { surface: 'calendar', phase: 'open' });
        });

        it('three levels: depth order, Escape peels them one by one and focus walks back out', async () => {
            const wraps: Array<(n: React.ReactNode) => React.ReactNode> = [(n) => n, (n) => <StrictMode>{n}</StrictMode>];
            for (const wrap of wraps) {
                resetDialogStack();
                const { unmount } = render(<>{wrap(<SameRender onParentClose={vi.fn()} onChildClose={vi.fn()} depth={3} />)}</>);
                const opener = screen.getByRole('button', { name: '開く' });
                await userEvent.click(opener);
                const [p, c, g] = ['親', '子', '孫'].map((name) => screen.getByRole('dialog', { name }));
                expect([p, c, g].map((d) => Number(d.parentElement!.style.zIndex))).toEqual([
                    Z_INDEX.DIALOG, Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP, Z_INDEX.DIALOG + 2 * Z_INDEX.DIALOG_STEP,
                ]);
                expect(g).toHaveFocus();
                await userEvent.keyboard('{Escape}');
                expect(screen.queryByRole('dialog', { name: '孫' })).toBeNull();
                expect(c).toHaveFocus();
                await userEvent.keyboard('{Escape}');
                expect(p).toHaveFocus();
                await userEvent.keyboard('{Escape}');
                expect(opener).toHaveFocus();
                expect(openDialogCount()).toBe(0);
                unmount();
            }
        });

        it('a dialog opened later still goes on top of a same-render pair', async () => {
            const Harness = () => {
                const [late, setLate] = useState(false);
                return (
                    <>
                        <Modal isOpen onClose={vi.fn()} title="親">
                            <Modal isOpen onClose={vi.fn()} title="子"><button onClick={() => setLate(true)}>後で開く</button></Modal>
                        </Modal>
                        <Modal isOpen={late} onClose={vi.fn()} title="後">x</Modal>
                    </>
                );
            };
            render(<Harness />);
            await userEvent.click(screen.getByRole('button', { name: '後で開く' }));
            expect(Number(screen.getByRole('dialog', { name: '後' }).parentElement!.style.zIndex)).toBe(Z_INDEX.DIALOG + 2 * Z_INDEX.DIALOG_STEP);
        });
    });

    it('z-index follows the stack: after the lower dialog closes, a new one opens above the remaining one', () => {
        const Harness = ({ lower, third }: { lower: boolean; third: boolean }) => (
            <>
                <Modal isOpen={lower} onClose={vi.fn()} title="下">a</Modal>
                <Modal isOpen onClose={vi.fn()} title="中">b</Modal>
                <Modal isOpen={third} onClose={vi.fn()} title="上">c</Modal>
            </>
        );
        const { rerender } = render(<Harness lower third={false} />);
        const zOf = (name: string) => Number(screen.getByRole('dialog', { name }).parentElement!.style.zIndex);
        expect(zOf('中')).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP);
        rerender(<Harness lower={false} third={false} />);
        expect(zOf('中')).toBe(Z_INDEX.DIALOG);
        rerender(<Harness lower={false} third />);
        expect(zOf('上')).toBe(Z_INDEX.DIALOG + Z_INDEX.DIALOG_STEP);
    });
});

describe('Modal: focus restore and trap (fix wave 2)', () => {
    const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

    /** Outer opened by a button, inner opened by a button inside the outer; the app can close the outer. */
    const OuterInner = () => {
        const [outer, setOuter] = useState(false);
        const [inner, setInner] = useState(false);
        return (
            <>
                <button onClick={() => setOuter(true)}>外を開く</button>
                <button data-testid="app-close" tabIndex={-1} onClick={() => setOuter(false)} />
                <Modal isOpen={outer} onClose={() => setOuter(false)} title="外">
                    <button onClick={() => setInner(true)}>内を開く</button>
                    <Modal isOpen={inner} onClose={() => setInner(false)} title="内" closeLabel="内を閉じる"><button>はい</button></Modal>
                </Modal>
            </>
        );
    };

    const openBoth = async () => {
        await userEvent.click(screen.getByRole('button', { name: '外を開く' }));
        await userEvent.click(screen.getByRole('button', { name: '内を開く' }));
        expect(screen.getByRole('dialog', { name: '内' })).toHaveFocus();
    };

    it('the app closing the outer with the inner open returns focus to the outer opener', async () => {
        render(<OuterInner />);
        await openBoth();
        act(() => { (screen.getByTestId('app-close') as HTMLButtonElement).click(); });
        await flush();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('button', { name: '外を開く' })).toHaveFocus();
        expect(openDialogCount()).toBe(0);
    });

    it('the same under StrictMode', async () => {
        render(<StrictMode><OuterInner /></StrictMode>);
        await openBoth();
        act(() => { (screen.getByTestId('app-close') as HTMLButtonElement).click(); });
        await flush();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('button', { name: '外を開く' })).toHaveFocus();
    });

    it('closing the inner alone returns focus to the inner opener', async () => {
        render(<OuterInner />);
        await openBoth();
        await userEvent.click(screen.getByRole('button', { name: '内を閉じる' }));
        await flush();
        expect(screen.getByRole('button', { name: '内を開く' })).toHaveFocus();
    });

    it('closing the inner alone under StrictMode returns focus to the inner opener', async () => {
        render(<StrictMode><OuterInner /></StrictMode>);
        await openBoth();
        await userEvent.keyboard('{Escape}');
        await flush();
        expect(screen.getByRole('button', { name: '内を開く' })).toHaveFocus();
    });

    it('a dialog that replaces another keeps the focus, and returns it to the first opener', async () => {
        const Harness = () => {
            const [which, setWhich] = useState<'none' | 'a' | 'b'>('none');
            return (
                <>
                    <button onClick={() => setWhich('a')}>開く</button>
                    <Modal isOpen={which === 'a'} onClose={() => setWhich('none')} title="A"><button onClick={() => setWhich('b')}>次へ</button></Modal>
                    <Modal isOpen={which === 'b'} onClose={() => setWhich('none')} title="B" closeLabel="B を閉じる">x</Modal>
                </>
            );
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.click(screen.getByRole('button', { name: '次へ' }));
        await flush();
        expect(screen.getByRole('dialog', { name: 'B' })).toHaveFocus();
        await userEvent.click(screen.getByRole('button', { name: 'B を閉じる' }));
        await flush();
        expect(screen.getByRole('button', { name: '開く' })).toHaveFocus();
    });

    it('does not take back focus the app moved itself while closing', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(true);
            const input = useRef<HTMLInputElement>(null);
            return (
                <>
                    <input ref={input} aria-label="chat" />
                    <Modal isOpen={open} onClose={() => { setOpen(false); }} title="t" closeLabel="閉じる">x</Modal>
                    {!open && <FocusOnMount target={input} />}
                </>
            );
        };
        const FocusOnMount = ({ target }: { target: React.RefObject<HTMLInputElement> }) => {
            React.useEffect(() => { target.current?.focus(); }, [target]);
            return null;
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        await flush();
        expect(screen.getByRole('textbox', { name: 'chat' })).toHaveFocus();
    });

    it('a same-render child returns focus to the parent initialFocusRef', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(false);
            const [child, setChild] = useState(true);
            const first = useRef<HTMLInputElement>(null);
            return (
                <>
                    <button onClick={() => setOpen(true)}>開く</button>
                    <Modal isOpen={open} onClose={() => setOpen(false)} aria-label="親" layout="bare" initialFocusRef={first}>
                        <input ref={first} aria-label="検索" />
                        <Modal isOpen={child} onClose={() => setChild(false)} title="子">x</Modal>
                    </Modal>
                </>
            );
        };
        render(<Harness />);
        await userEvent.click(screen.getByRole('button', { name: '開く' }));
        await userEvent.keyboard('{Escape}');
        await flush();
        expect(screen.getByRole('textbox', { name: '検索' })).toHaveFocus();
    });

    it('Tab skips a tabIndex=-1 last button and wraps', async () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare"><button>一</button><button>二</button><button tabIndex={-1}>枠外</button></Modal>);
        await userEvent.tab();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '一' })).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
    });

    it('Tab treats a radio group at the edge as one stop', async () => {
        render(
            <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare">
                <button>一</button>
                <input type="radio" name="speed" aria-label="1x" />
                <input type="radio" name="speed" aria-label="2x" defaultChecked />
                <input type="radio" name="speed" aria-label="3x" />
            </Modal>,
        );
        await userEvent.tab();
        await userEvent.tab();
        expect(screen.getByRole('radio', { name: '2x' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '一' })).toHaveFocus();
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('radio', { name: '2x' })).toHaveFocus();
    });

    it('Tab skips a hidden file input at the edge', async () => {
        render(
            <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare">
                <button>一</button><button>二</button><input type="file" aria-label="file" style={{ display: 'none' }} />
            </Modal>,
        );
        act(() => screen.getByRole('button', { name: '二' }).focus());
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '一' })).toHaveFocus();
    });

    it('Tab from an element inside the frame that is not tabbable moves to the next tabbable one', async () => {
        render(
            <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare">
                <button>一</button><div tabIndex={-1} data-testid="mid">中</div><button>二</button>
            </Modal>,
        );
        act(() => screen.getByTestId('mid').focus());
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '二' })).toHaveFocus();
        act(() => screen.getByTestId('mid').focus());
        await userEvent.tab({ shift: true });
        expect(screen.getByRole('button', { name: '一' })).toHaveFocus();
    });

    it('pulls focus that leaks outside the top-most dialog back to its frame', () => {
        render(
            <>
                <button>外</button>
                <Modal isOpen onClose={vi.fn()} title="t"><button>中</button></Modal>
            </>,
        );
        const dialog = screen.getByRole('dialog');
        act(() => screen.getByRole('button', { name: '外', hidden: true }).focus());
        expect(dialog).toHaveFocus();
    });

    it('a lower dialog does not pull focus back while a dialog above it holds it', async () => {
        render(<OuterInner />);
        await openBoth();
        act(() => screen.getByRole('button', { name: 'はい' }).focus());
        expect(screen.getByRole('button', { name: 'はい' })).toHaveFocus();
        act(() => screen.getByRole('button', { name: '内を開く', hidden: true }).focus());
        expect(screen.getByRole('dialog', { name: '内' })).toHaveFocus();
    });

    it('lets focus go to a portaled menu and to a dialog outside the layer (legacy modals, the call overlay)', () => {
        render(
            <>
                <div role="menu"><button role="menuitem">項目</button></div>
                <div role="dialog" aria-modal="true" aria-label="legacy"><input aria-label="legacy input" /></div>
                <Modal isOpen onClose={vi.fn()} title="t">x</Modal>
            </>,
        );
        const item = screen.getByRole('menuitem', { name: '項目', hidden: true });
        act(() => item.focus());
        expect(item).toHaveFocus();
        const legacy = screen.getByRole('textbox', { name: 'legacy input', hidden: true });
        act(() => legacy.focus());
        expect(legacy).toHaveFocus();
    });

    it('stops guarding focus once closed', () => {
        const { rerender } = render(<><button>外</button><Modal isOpen onClose={vi.fn()} title="t">x</Modal></>);
        rerender(<><button>外</button><Modal isOpen={false} onClose={vi.fn()} title="t">x</Modal></>);
        act(() => screen.getByRole('button', { name: '外' }).focus());
        expect(screen.getByRole('button', { name: '外' })).toHaveFocus();
    });

    it('a drag that starts inside the dialog and ends on the backdrop does not close it', () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} title="t">inside</Modal>);
        const backdrop = screen.getByTestId('modal-backdrop');
        fireEvent.mouseDown(screen.getByText('inside'));
        fireEvent.mouseUp(backdrop);
        fireEvent.click(backdrop);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(backdrop);
        fireEvent.mouseUp(backdrop);
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a drag that starts on the viewer media and ends on the stage does not close it', () => {
        const onClose = vi.fn();
        render(<Modal isOpen onClose={onClose} aria-label="viewer" tone="viewer" layout="bare"><img alt="写真" /></Modal>);
        const stage = screen.getByRole('dialog', { name: 'viewer' });
        fireEvent.mouseDown(screen.getByRole('img', { name: '写真' }));
        fireEvent.click(stage);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.mouseDown(stage);
        fireEvent.click(stage);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('warns in development when a dialog has no accessible name, or a title or toolbar in a bare layout', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(<Modal isOpen onClose={vi.fn()} layout="bare">x</Modal>);
        render(<Modal isOpen onClose={vi.fn()} layout="bare" title="見出し" aria-label="名前">x</Modal>);
        render(<Modal isOpen onClose={vi.fn()} title="ok" toolbar={<span>tabs</span>}>x</Modal>);
        render(<Modal isOpen onClose={vi.fn()} layout="bare" aria-label="名前" toolbar={<span>タブ</span>}>x</Modal>);
        expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
            expect.stringContaining('no accessible name'),
            expect.stringContaining('title is ignored'),
            expect.stringContaining('toolbar is ignored'),
        ]);
        // The bare layout really does not draw it.
        expect(screen.queryByText('タブ')).toBeNull();
        warn.mockRestore();
    });

    it('the first Tab goes to the first element in DOM order (input before button)', async () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare"><input aria-label="名前" /><button>送信</button></Modal>);
        await userEvent.tab();
        expect(screen.getByRole('textbox', { name: '名前' })).toHaveFocus();
    });

    it('the first Tab goes to the first element in DOM order (radio group before button)', async () => {
        render(
            <Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare">
                <input type="radio" name="kind" aria-label="写真" /><input type="radio" name="kind" aria-label="動画" /><button>次へ</button>
            </Modal>,
        );
        await userEvent.tab();
        expect(screen.getByRole('radio', { name: '写真' })).toHaveFocus();
    });

    it('leaves Tab with Ctrl, Alt or Meta alone', () => {
        render(<Modal isOpen onClose={vi.fn()} aria-label="d" layout="bare"><button>一</button><button>二</button></Modal>);
        const last = screen.getByRole('button', { name: '二' });
        act(() => last.focus());
        for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
            const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, [mod]: true });
            act(() => { last.dispatchEvent(e); });
            expect(e.defaultPrevented).toBe(false);
            expect(last).toHaveFocus();
        }
    });

    it('a lower dialog closing leaves focus in a portaled menu of the top-most dialog', async () => {
        const Harness = ({ lower }: { lower: boolean }) => (
            <>
                <Modal isOpen={lower} onClose={vi.fn()} title="下"><button>下のボタン</button></Modal>
                <Modal isOpen onClose={vi.fn()} title="上">x</Modal>
                <div role="menu"><button role="menuitem">速度</button></div>
            </>
        );
        const { rerender } = render(<Harness lower />);
        const item = screen.getByRole('menuitem', { name: '速度', hidden: true });
        act(() => item.focus());
        expect(item).toHaveFocus();
        rerender(<Harness lower={false} />);
        await flush();
        expect(item).toHaveFocus();
    });
});

describe('Modal v2 header and scope', () => {
    it('standard layout draws the expressive header by default', () => {
        render(<Modal isOpen onClose={() => {}} title="Favourites" closeLabel="Close">body</Modal>);
        const header = screen.getByTestId('modal-header');
        expect(header.className).toContain('bg-expressive-header');
        expect(header.className).toContain('text-expressive-header');
        expect(screen.getByTestId('modal-header-bar').className).toContain('bg-expressive-header-bar');
    });
    it('header="console" renders a dark ink header with no expressive bar and a muted close button', () => {
        render(<Modal isOpen onClose={() => {}} title="Dev" header="console" closeLabel="Close">body</Modal>);
        const header = screen.getByTestId('modal-header');
        expect(header).toHaveClass('bg-console', 'text-console');
        expect(header.className).not.toContain('expressive');
        expect(screen.queryByTestId('modal-header-bar')).toBeNull();
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('text-console-muted', 'hover:text-console');
    });

    it('header="plain" keeps the quiet header', () => {
        render(<Modal isOpen onClose={() => {}} title="Confirm" header="plain">body</Modal>);
        expect(screen.getByTestId('modal-header').className).not.toContain('bg-expressive-header');
        expect(screen.queryByTestId('modal-header-bar')).toBeNull();
    });
    it('titleClassName styles the title', () => {
        render(<Modal isOpen onClose={() => {}} title="Member" header="plain" titleClassName="text-accent-strong">body</Modal>);
        expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-accent-strong', 'font-bold');
    });
    it('scope="brand" sets the brand accent variables on the frame', () => {
        render(<Modal isOpen onClose={() => {}} title="Settings" scope="brand">body</Modal>);
        const frame = screen.getByRole('dialog');
        expect(frame.style.getPropertyValue('--ds-accent')).toBe(brandAccent().accent);
        expect(frame.dataset.scope).toBe('brand');
    });
    it('an inherit Modal inside a BrandScope is brand', () => {
        render(<BrandScope><Modal isOpen onClose={() => {}} title="Confirm">body</Modal></BrandScope>);
        const frame = screen.getByRole('dialog');
        expect(frame.dataset.scope).toBe('brand');
        expect(frame.style.getPropertyValue('--ds-accent')).toBe(brandAccent().accent);
    });
    it('a Modal nested in a brand Modal inherits brand', () => {
        render(
            <Modal isOpen onClose={() => {}} title="Settings" scope="brand">
                <Modal isOpen onClose={() => {}} title="Confirm">inner</Modal>
            </Modal>,
        );
        const inner = screen.getByRole('dialog', { name: 'Confirm' });
        expect(inner.dataset.scope).toBe('brand');
        expect(inner.style.getPropertyValue('--ds-accent')).toBe(brandAccent().accent);
    });
    it('a Modal outside any scope has no data-scope', () => {
        render(<Modal isOpen onClose={() => {}} title="X">body</Modal>);
        expect(screen.getByRole('dialog').dataset.scope).toBeUndefined();
    });
    it('the expressive close button takes the header text colour', () => {
        render(<Modal isOpen onClose={() => {}} title="X" closeLabel="Close">body</Modal>);
        expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('text-expressive-header', 'hover:bg-header-glass');
        expect(screen.getByRole('button', { name: 'Close' }).className).not.toMatch(/(^|\s)(hover:)?(bg|text|border)-accent/);
    });
    it('frame uses the xl radius', () => {
        render(<Modal isOpen onClose={() => {}} title="X">body</Modal>);
        expect(screen.getByRole('dialog').className).toContain('rounded-xl');
    });
    it('renders the toolbar between the header and the scrolling body, outside the scroller', () => {
        render(<Modal isOpen onClose={() => {}} title="X" toolbar={<div role="tablist" aria-label="bar" />}>body</Modal>);
        const toolbar = screen.getByTestId('modal-toolbar');
        const body = screen.getByTestId('modal-body');
        expect(toolbar).toContainElement(screen.getByRole('tablist'));
        expect(body).not.toContainElement(toolbar);
        expect(toolbar).toHaveClass('shrink-0', 'bg-sheet');
        expect(body).toHaveClass('overflow-y-auto');
        expect(screen.getByTestId('modal-header').compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(toolbar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    it('Tab reaches the toolbar controls, between the header close button and the body', async () => {
        render(
            <Modal isOpen onClose={() => {}} title="X" closeLabel="閉じる" toolbar={<div role="tablist" aria-label="bar"><button role="tab">写真 📷</button><button role="tab">動画</button></div>}>
                <button>本文</button>
            </Modal>,
        );
        expect(screen.getByRole('dialog')).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('tab', { name: '写真 📷' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('tab', { name: '動画' })).toHaveFocus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: '本文' })).toHaveFocus();
    });
    it('draws no toolbar element without a toolbar', () => {
        render(<Modal isOpen onClose={() => {}} title="X">body</Modal>);
        expect(screen.queryByTestId('modal-toolbar')).toBeNull();
    });
});
