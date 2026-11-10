import { useCallback, useState } from 'react';
import type React from 'react';

export interface ContextMenuTrigger {
    /** Where the open menu sits (a viewport point), or null when it is closed. */
    point: { x: number; y: number } | null;
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    close: () => void;
}

/**
 * A context-menu trigger for one element: a right-click opens the menu at the pointer, the
 * context-menu key or Shift+F10 at the element's centre. Both claim the event (no browser menu).
 * While `enabled` is false nothing is claimed, so the browser keeps its own menu.
 */
export function useContextMenu(enabled: boolean): ContextMenuTrigger {
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
    const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (!enabled) return;
        e.preventDefault();
        setPoint({ x: e.clientX, y: e.clientY });
    }, [enabled]);
    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
        if (!enabled || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }, [enabled]);
    const close = useCallback(() => setPoint(null), []);
    return { point, onContextMenu, onKeyDown, close };
}
