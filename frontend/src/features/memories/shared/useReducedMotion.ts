import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the OS asks for reduced motion right now (false without `matchMedia`). */
export function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && (window.matchMedia?.(QUERY)?.matches ?? false);
}

/** {@link prefersReducedMotion}, kept current when the setting changes. */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState(prefersReducedMotion);
    useEffect(() => {
        const mq = window.matchMedia?.(QUERY);
        if (!mq?.addEventListener) return;
        const onChange = () => setReduced(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return reduced;
}
