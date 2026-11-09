import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from '../../../design/tokens/motion';
import type { RowKey } from '../timeline/buildTimeline';

/**
 * The landed-row highlight: `flash(rowKey)` sets `highlightedRowKey` on the next animation
 * frame and clears it after `motion.duration.landing`. Clearing first and re-setting on the
 * next frame restarts the CSS animation when the same row lands twice in a row. A change of
 * `resetKey` (the selected room) or an unmount cancels the pending frame and timer; a
 * `resetKey` change also clears the highlight. Rows are keyed `msg-<id>` / `letter-<id>`.
 */
export function useLandingHighlight(resetKey: unknown) {
    const [highlightedRowKey, setHighlightedRowKey] = useState<RowKey | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const frameRef = useRef<number | null>(null);
    const cancel = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        timerRef.current = null;
        frameRef.current = null;
    }, []);
    const flash = useCallback((rowKey: RowKey) => {
        cancel();
        setHighlightedRowKey(null);
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            setHighlightedRowKey(rowKey);
            timerRef.current = setTimeout(() => setHighlightedRowKey(null), motion.duration.landing);
        });
    }, [cancel]);
    useEffect(() => cancel, [cancel]);
    useEffect(() => {
        cancel();
        setHighlightedRowKey(null);
    }, [resetKey, cancel]);
    return { highlightedRowKey, flash };
}
