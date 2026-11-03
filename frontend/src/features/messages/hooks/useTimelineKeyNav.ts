import { useCallback } from 'react';
import type React from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

const SCROLL_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown']);

/**
 * Keyboard handler for the message timeline: Home/End jump to the first/last
 * message. While an incoming call covers the timeline (`callActive`) the list is
 * hidden, so Home/End/PageUp/PageDown are swallowed and nothing scrolls.
 */
export function useTimelineKeyNav(
    virtuosoRef: React.RefObject<VirtuosoHandle | null>,
    messageCount: number,
    callActive: boolean,
) {
    return useCallback((e: React.KeyboardEvent) => {
        if (callActive) {
            if (SCROLL_KEYS.has(e.key)) e.preventDefault();
            return;
        }
        if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto' });
        } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            virtuosoRef.current?.scrollToIndex({ index: messageCount - 1, behavior: 'auto' });
        }
    }, [virtuosoRef, messageCount, callActive]);
}
