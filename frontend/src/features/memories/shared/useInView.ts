import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether `ref`'s element is within `rootMargin` of the viewport, tracked both ways (it turns
 * false again when the element leaves). Without `IntersectionObserver` it is always true.
 */
export function useInView(ref: RefObject<Element>, rootMargin = '200px'): boolean {
    const supported = typeof IntersectionObserver !== 'undefined';
    const [inView, setInView] = useState(!supported);
    useEffect(() => {
        const el = ref.current;
        if (!supported || !el) return undefined;
        const io = new IntersectionObserver((entries) => {
            const last = entries[entries.length - 1];
            if (last) setInView(last.isIntersecting);
        }, { rootMargin });
        io.observe(el);
        return () => io.disconnect();
    }, [ref, rootMargin, supported]);
    return inView;
}
