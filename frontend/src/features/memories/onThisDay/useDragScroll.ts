import { useCallback, useMemo, useRef, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';

/** A pointer that moved further than this is a drag, and the click it ends is swallowed. */
export const DRAG_THRESHOLD_PX = 4;
/** One wheel line (`deltaMode` 1) in pixels. */
const WHEEL_LINE_PX = 16;

/**
 * Horizontal drag-to-scroll for a strip: a primary-button pointer drag scrolls it (a click is
 * suppressed after a drag of more than {@link DRAG_THRESHOLD_PX}), and the vertical wheel scrolls
 * it sideways. Spread `handlers` on the element that carries `ref`.
 */
export function useDragScroll<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
    const swallowClick = useRef(false);

    const end = useCallback(() => {
        if (drag.current?.moved) swallowClick.current = true;
        drag.current = null;
    }, []);

    const handlers = useMemo(() => ({
        onPointerDown: (e: PointerEvent<T>) => {
            if (e.button !== 0 || !ref.current) return;
            drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
            swallowClick.current = false;
        },
        onPointerMove: (e: PointerEvent<T>) => {
            const el = ref.current;
            const d = drag.current;
            if (!el || !d) return;
            const dx = e.clientX - d.x;
            if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
                d.moved = true;
                el.setPointerCapture?.(e.pointerId);
            }
            if (d.moved) el.scrollLeft = d.left - dx;
        },
        onPointerUp: end,
        onPointerCancel: end,
        onClickCapture: (e: MouseEvent<T>) => {
            if (!swallowClick.current) return;
            swallowClick.current = false;
            e.preventDefault();
            e.stopPropagation();
        },
        onWheel: (e: WheelEvent<T>) => {
            const el = ref.current;
            if (!el || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
            // deltaMode: 0 pixels, 1 lines (Firefox), 2 pages.
            const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? el.clientWidth : 1;
            el.scrollLeft += e.deltaY * unit;
        },
    }), [end]);

    return { ref, handlers };
}
