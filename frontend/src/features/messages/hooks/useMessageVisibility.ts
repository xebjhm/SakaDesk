/**
 * Shared visibility registry for message panels inside the virtualized message
 * list. Panels (transcription/translation) register a collapse callback keyed
 * by messageId; MessageList's rangeChanged handler notifies callbacks whose
 * message is no longer in the visible range.
 *
 * This replaces IntersectionObserver-based detection, which does not reliably
 * fire on container scrolls inside react-virtuoso.
 */

import { useEffect } from 'react';

type CollapseFn = () => void;

const registry = new Map<number, Set<CollapseFn>>();

function register(messageId: number, fn: CollapseFn): () => void {
    let set = registry.get(messageId);
    if (!set) {
        set = new Set();
        registry.set(messageId, set);
    }
    set.add(fn);
    return () => {
        const current = registry.get(messageId);
        if (!current) return;
        current.delete(fn);
        if (current.size === 0) registry.delete(messageId);
    };
}

/**
 * Called by MessageList after each rangeChanged event. Collapses panels for
 * any registered messageId that is not in the visible set.
 */
export function notifyVisibleMessages(visibleIds: ReadonlySet<number>): void {
    for (const [id, callbacks] of registry) {
        if (!visibleIds.has(id)) {
            for (const cb of callbacks) cb();
        }
    }
}

/**
 * Subscribe a panel to out-of-view notifications. Active only while
 * `enabled` is true (typically while the panel is expanded) and a messageId
 * is available. Unsubscribes automatically on unmount or when enabled flips.
 */
export function useCollapseOnOutOfView(
    messageId: number | undefined,
    enabled: boolean,
    onCollapse: CollapseFn,
): void {
    useEffect(() => {
        if (!enabled || messageId === undefined) return;
        return register(messageId, onCollapse);
    }, [enabled, messageId, onCollapse]);
}
