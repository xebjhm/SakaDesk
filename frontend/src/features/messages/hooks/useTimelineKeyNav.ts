import { useCallback } from 'react';
import type React from 'react';
import type { JumpTarget } from '../timeline/jumpTarget';

const SCROLL_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown']);

/**
 * Keyboard handler for the message timeline: Home/End jump to the first/last
 * message through the shared timeline jump (key auto-repeat is swallowed). While an incoming call covers the
 * timeline (`callActive`) the list is hidden, so Home/End/PageUp/PageDown are
 * swallowed and nothing scrolls.
 */
export function useTimelineKeyNav(
    jumpTo: (target: JumpTarget) => unknown,
    callActive: boolean,
) {
    return useCallback((e: React.KeyboardEvent) => {
        if (callActive) {
            if (SCROLL_KEYS.has(e.key)) e.preventDefault();
            return;
        }
        if ((e.key === 'Home' || e.key === 'End') && e.repeat) {
            // Holding the key must not queue a stream of jumps.
            e.preventDefault();
            return;
        }
        if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            void jumpTo({ kind: 'top' });
        } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            void jumpTo({ kind: 'bottom' });
        }
    }, [jumpTo, callActive]);
}
