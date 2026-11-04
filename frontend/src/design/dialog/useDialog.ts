import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Z_INDEX } from '../../constants/zIndex';
import {
    dialogAbove, dialogZIndex, isLayerFrame, isTopDialog, nextDialogOrder, popDialog, pushDialog, subscribeDialogStack, type DialogEntry,
} from './dialogStack';
import { logDialog, type CloseReason, type DialogLogId } from './dialogLog';
import { restoreFocusAfterClose, restoreTargetForOpening } from './focusRestore';
import { tabbables } from './tabbables';

export type { CloseReason } from './dialogLog';

const ANY_DIALOG = '[role="dialog"], [aria-modal="true"]';

export interface UseDialogOptions {
    isOpen: boolean;
    onClose: () => void;
    dismissible: boolean;
    frameRef: RefObject<HTMLElement>;
    initialFocusRef?: RefObject<HTMLElement>;
    logId?: DialogLogId;
}

/**
 * The dialog layer's behaviour (docs/superpowers/specs/2026-11-05-d2c-dialogs-design.md, "The dialog layer"):
 * stack entry + scroll lock, z-index by depth, initial focus and restore, Tab trap and focus
 * guard, Escape for the top-most dialog only, and the `dialog` breadcrumb.
 *
 * The stack position comes from an opening order taken while rendering (parents render before
 * the dialogs nested in them), so a parent and child that open in the same render stack
 * correctly even though the child's effect pushes first; the z-index follows the stack.
 *
 * Escape: the top-most dialog closes and claims the key (`preventDefault`), unless the key was
 * already handled, typed in an IME, or leaves fullscreen. A non-dismissible top-most dialog
 * (ToS, setup, sync) neither closes nor claims it, so a handler further out (the incoming-call
 * overlay) still sees the key.
 *
 * Focus: on open, `initialFocusRef` or the frame; on close, after the commit, the opener
 * (see `focusRestore.ts`). Tab cycles over the frame's tabbable elements in browser order
 * (`tabbables.ts`), and focus that lands outside the top-most frame is pulled back to it,
 * except in a menu or in a dialog outside the layer (legacy modals, the call overlay).
 */
export function useDialog({ isOpen, onClose, dismissible, frameRef, initialFocusRef, logId }: UseDialogOptions) {
    const [zIndex, setZIndex] = useState<number>(Z_INDEX.DIALOG);
    const entryRef = useRef<DialogEntry | null>(null);
    const reasonRef = useRef<CloseReason | null>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // A fresh opening order each time the dialog opens, taken during render.
    const [opening, setOpening] = useState(() => ({ isOpen, order: nextDialogOrder() }));
    if (opening.isOpen !== isOpen) setOpening({ isOpen, order: isOpen ? nextDialogOrder() : opening.order });

    const requestClose = useCallback((reason: CloseReason) => {
        reasonRef.current = reason;
        onCloseRef.current();
    }, []);

    // Stack entry, z-index, focus in / restore, breadcrumbs.
    useLayoutEffect(() => {
        if (!isOpen) return;
        const frame = frameRef.current;
        const entry = pushDialog({
            node: () => frameRef.current,
            dismissible,
            order: opening.order,
            restoreTo: restoreTargetForOpening(),
        });
        entryRef.current = entry;
        reasonRef.current = null;
        const above = dialogAbove(entry);
        if (above) {
            // A dialog nested in this one opened in the same render and is already above: it took
            // the focus and remembered this dialog's opener. It now returns focus here (to
            // initialFocusRef, as on open), and this dialog returns it to the opener.
            entry.restoreTo = above.restoreTo;
            above.restoreTo = initialFocusRef?.current ?? frame;
        } else {
            (initialFocusRef?.current ?? frame)?.focus({ preventScroll: true });
        }
        const syncZIndex = () => setZIndex(dialogZIndex(entry));
        syncZIndex();
        const unsubscribe = subscribeDialogStack(syncZIndex);
        if (logId) logDialog(logId, 'open');
        return () => {
            unsubscribe();
            popDialog(entry);
            entryRef.current = null;
            if (logId) logDialog(logId, 'close', reasonRef.current ?? 'app');
            restoreFocusAfterClose(entry, frame);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one entry per open; order/dismissible/logId are read at open time
    }, [isOpen]);

    // Escape and Tab for the top-most dialog (document, bubble phase: React handlers inside the
    // dialog run first).
    // A layout effect, like the push and focus above, so there is no moment where this dialog is
    // top-most but not yet listening.
    useLayoutEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            const entry = entryRef.current;
            if (!entry || !isTopDialog(entry)) return;
            if (e.key === 'Escape') {
                // Not dismissible: no close and no claim (see the doc comment above).
                if (!dismissible || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
                if (document.fullscreenElement) return; // the browser leaves fullscreen
                e.preventDefault(); // claim it: the incoming-call overlay must not also decline
                requestClose('escape');
                return;
            }
            if (e.key !== 'Tab' || e.defaultPrevented) return;
            if (e.ctrlKey || e.altKey || e.metaKey) return; // not focus navigation (Ctrl+Tab, Alt+Tab)
            const frame = frameRef.current;
            if (!frame) return;
            const active = document.activeElement;
            if (active instanceof Element && active.closest('[role="menu"]')) return; // the menu handles Tab
            e.preventDefault();
            const items = tabbables(frame);
            if (items.length === 0) {
                frame.focus();
                return;
            }
            const at = active instanceof HTMLElement ? items.indexOf(active) : -1;
            let next: HTMLElement;
            if (at >= 0) {
                next = items[(at + (e.shiftKey ? items.length - 1 : 1)) % items.length];
            } else if (active instanceof Node && active !== frame && frame.contains(active)) {
                // Focus on something inside that Tab does not visit: go to its DOM neighbour.
                const following = (el: HTMLElement) => (active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                next = e.shiftKey
                    ? ([...items].reverse().find((el) => !following(el)) ?? items[items.length - 1])
                    : (items.find(following) ?? items[0]);
            } else {
                next = e.shiftKey ? items[items.length - 1] : items[0];
            }
            next.focus();
        };
        // Focus that lands outside the top-most frame (a click on the page behind, a script) goes back in.
        const onFocusIn = (e: FocusEvent) => {
            const entry = entryRef.current;
            if (!entry || !isTopDialog(entry)) return;
            const frame = frameRef.current;
            const target = e.target;
            if (!frame || !(target instanceof Element) || frame.contains(target)) return;
            const host = target.closest(ANY_DIALOG);
            const inLowerDialog = host !== null && isLayerFrame(host);
            // Allowed outside the frame: a portaled menu (the player menus) and a dialog outside
            // the layer (a legacy modal until its migration, the call overlay).
            if (!inLowerDialog && (host !== null || target.closest('[role="menu"]'))) return;
            frame.focus({ preventScroll: true });
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('focusin', onFocusIn);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('focusin', onFocusIn);
        };
    }, [isOpen, dismissible, frameRef, requestClose]);

    return { zIndex, requestClose };
}
