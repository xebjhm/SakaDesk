import { useLayoutEffect, useState, type RefObject } from 'react';

export interface AnchorRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** The viewport rectangle of `ref` while `enabled`, kept current on resize (where a lifted call is drawn). */
export function useAnchorRect(ref: RefObject<HTMLElement>, enabled: boolean): AnchorRect | null {
    const [rect, setRect] = useState<AnchorRect | null>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!enabled || !el) return;
        const measure = () => {
            const r = el.getBoundingClientRect();
            setRect((prev) => (
                prev && prev.left === r.left && prev.top === r.top && prev.width === r.width && prev.height === r.height
                    ? prev
                    : { left: r.left, top: r.top, width: r.width, height: r.height }
            ));
        };
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(el);
        window.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [ref, enabled]);
    return rect;
}
