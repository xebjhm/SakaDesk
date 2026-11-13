import React, { useRef } from 'react';
import { useInert } from '../../hooks/useInert';
import { FeatureActiveContext } from '../../design/featureActive';

const HIDDEN: React.CSSProperties = { contentVisibility: 'hidden' };

/**
 * Keeps a feature mounted while another one shows (UI health #11). Hidden, it fills the same box
 * (`absolute inset-0`, so its scrollers keep their size and position) with `content-visibility:
 * hidden` (layout state kept, skipped from rendering, focus, find-in-page and the accessibility
 * tree) and `inert`. Children read `useFeatureActive()` to pause their own work.
 */
export const KeepMounted: React.FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    useInert(ref, !active);
    return (
        <div
            ref={ref}
            data-testid="kept-feature"
            data-active={active ? 'true' : 'false'}
            className={active ? 'flex h-full min-w-0 flex-1' : 'pointer-events-none absolute inset-0 flex min-w-0'}
            style={active ? undefined : HIDDEN}
        >
            <FeatureActiveContext.Provider value={active}>{children}</FeatureActiveContext.Provider>
        </div>
    );
};
