import React, { useLayoutEffect, useRef } from 'react';
import { useInert } from '../../hooks/useInert';
import { FeatureActiveContext } from '../../design/featureActive';
import { clientLog } from '../../utils/clientLog';

const HIDDEN: React.CSSProperties = { contentVisibility: 'hidden' };

/**
 * Keeps a feature mounted while another one shows (UI health #11). Hidden, it fills the same box
 * (`absolute inset-0`, so its scrollers keep their size and position) with `content-visibility:
 * hidden` (layout state kept, skipped from rendering, focus, find-in-page and the accessibility
 * tree) and `inert`. Children read `useFeatureActive()` to pause their own work. A voice or video
 * still playing inside it is paused on hiding (the unmount stopped it, and no control in view could).
 */
export const KeepMounted: React.FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => {
    const ref = useRef<HTMLDivElement>(null);
    useInert(ref, !active);
    useLayoutEffect(() => {
        if (active) return;
        const playing = Array.from(ref.current?.querySelectorAll<HTMLMediaElement>('audio, video') ?? []).filter((el) => !el.paused);
        if (playing.length === 0) return;
        for (const el of playing) el.pause();
        clientLog('media_playback', { outcome: 'paused', reason: 'feature_hidden', count: playing.length });
    }, [active]);
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
