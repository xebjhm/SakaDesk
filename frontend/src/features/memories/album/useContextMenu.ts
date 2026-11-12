import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface ContextMenuTrigger {
    /** Where the open menu sits (a viewport point), or null when it is closed. */
    point: { x: number; y: number } | null;
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    /** Open the menu at the element's centre (a menu button's click). */
    openAt: (el: HTMLElement) => void;
    close: () => void;
}

const centreOf = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

/**
 * A context-menu trigger for one element: a right-click opens the menu at the pointer, the
 * context-menu key or Shift+F10 at the element's centre. Every one is claimed (`preventDefault`),
 * so the WebView's native menu never opens beside ours. A keyboard open is followed by a native
 * `contextmenu` event (on the element, or on the menu once it has focus): while the menu is open,
 * any `contextmenu` is swallowed and never moves it. While `enabled` is false nothing is claimed,
 * so the browser keeps its own menu.
 */
export function useContextMenu(enabled: boolean): ContextMenuTrigger {
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
    const open = useRef(false);
    open.current = point !== null;

    useEffect(() => {
        if (point === null) return undefined;
        const swallow = (e: MouseEvent) => e.preventDefault();
        document.addEventListener('contextmenu', swallow, true);
        return () => document.removeEventListener('contextmenu', swallow, true);
    }, [point]);

    const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (!enabled) return;
        e.preventDefault();
        if (open.current) return;
        setPoint({ x: e.clientX, y: e.clientY });
    }, [enabled]);
    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
        if (!enabled || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
        e.preventDefault();
        setPoint(centreOf(e.currentTarget));
    }, [enabled]);
    const openAt = useCallback((el: HTMLElement) => {
        if (enabled) setPoint(centreOf(el));
    }, [enabled]);
    const close = useCallback(() => setPoint(null), []);
    return { point, onContextMenu, onKeyDown, openAt, close };
}
