import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from '../../../design/tokens/motion';

/**
 * The landed-row highlight: `flash(id)` sets `highlightedMessageId` on the next animation
 * frame and clears it after `motion.duration.landing`. Clearing first and re-setting on the
 * next frame restarts the CSS animation when the same row lands twice in a row. A change of
 * `resetKey` (the selected room) or an unmount cancels the pending frame and timer; a
 * `resetKey` change also clears the highlight.
 */
export function useLandingHighlight(resetKey: unknown) {
    const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const frameRef = useRef<number | null>(null);
    const cancel = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        timerRef.current = null;
        frameRef.current = null;
    }, []);
    const flash = useCallback((id: number) => {
        cancel();
        setHighlightedMessageId(null);
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            setHighlightedMessageId(id);
            timerRef.current = setTimeout(() => setHighlightedMessageId(null), motion.duration.landing);
        });
    }, [cancel]);
    useEffect(() => cancel, [cancel]);
    useEffect(() => {
        cancel();
        setHighlightedMessageId(null);
    }, [resetKey, cancel]);
    return { highlightedMessageId, flash };
}
