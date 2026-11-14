import { useLayoutEffect, type RefObject } from 'react';

/**
 * Sets or removes `inert` on the element (no focus, no clicks, out of the accessibility tree).
 * Set directly because React 18 does not pass `inert` through as a boolean prop (same pattern as
 * BusyContent and listSnapshot).
 */
export function useInert(ref: RefObject<HTMLElement | null>, on: boolean): void {
    useLayoutEffect(() => {
        ref.current?.toggleAttribute('inert', on);
    }, [ref, on]);
}
