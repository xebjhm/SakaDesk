import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Z_INDEX } from '../../constants/zIndex';
import { dialogZIndex, isTopDialog, popDialog, pushDialog, type DialogEntry } from './dialogStack';
import { logDialog, type CloseReason, type DialogLogId } from './dialogLog';

export type { CloseReason } from './dialogLog';

const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
 * stack entry + scroll lock, z-index by depth, initial focus and restore, Tab trap and
 * Escape for the top-most dialog only, and the `dialog` breadcrumb.
 */
export function useDialog({ isOpen, onClose, dismissible, frameRef, initialFocusRef, logId }: UseDialogOptions) {
    const [zIndex, setZIndex] = useState<number>(Z_INDEX.DIALOG);
    const entryRef = useRef<DialogEntry | null>(null);
    const reasonRef = useRef<CloseReason | null>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const requestClose = useCallback((reason: CloseReason) => {
        reasonRef.current = reason;
        onCloseRef.current();
    }, []);

    // Stack entry, z-index, focus in / restore, breadcrumbs.
    useLayoutEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const entry = pushDialog({ node: () => frameRef.current, dismissible });
        entryRef.current = entry;
        reasonRef.current = null;
        setZIndex(dialogZIndex(entry));
        if (logId) logDialog(logId, 'open');
        (initialFocusRef?.current ?? frameRef.current)?.focus({ preventScroll: true });
        return () => {
            popDialog(entry);
            entryRef.current = null;
            if (logId) logDialog(logId, 'close', reasonRef.current ?? 'app');
            if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one entry per open; dismissible/logId are read at open time
    }, [isOpen]);

    // Escape and Tab for the top-most dialog (bubble phase: handlers inside the dialog run first).
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            const entry = entryRef.current;
            if (!entry || !isTopDialog(entry)) return;
            if (e.key === 'Escape') {
                if (!dismissible || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
                if (document.fullscreenElement) return; // the browser leaves fullscreen
                e.preventDefault(); // claim it: the incoming-call overlay must not also decline
                requestClose('escape');
                return;
            }
            if (e.key !== 'Tab' || e.defaultPrevented) return;
            const frame = frameRef.current;
            if (!frame) return;
            const active = document.activeElement;
            if (active instanceof Element && active.closest('[role="menu"]')) return; // the menu handles Tab
            const items = Array.from(frame.querySelectorAll<HTMLElement>(TABBABLE));
            if (items.length === 0) {
                e.preventDefault();
                frame.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const inside = active instanceof Node && frame.contains(active);
            if (!inside || active === frame) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            } else if (e.shiftKey && active === first) {
                e.preventDefault();
                last.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, dismissible, frameRef, requestClose]);

    return { zIndex, requestClose };
}
