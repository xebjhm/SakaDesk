import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { logWait, useLoadingStages, type WaitPhase } from '../../../design/loading';
import { ProgressBar, Spinner } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import type { BandWaits } from './bandWaits';

/** The `ui_wait` surface of the album's month grids. */
const SURFACE = 'memories_album_month';

/**
 * One page-level wait line above the month bands, instead of slow copy in every band (F28). Its
 * clock (`useLoadingStages`) runs from the start of the oldest band still waiting for its grid
 * (`waits.oldest()`), so neighbours handing over to each other during a brisk scroll never add up
 * to a slow wait. Nothing before `slow` (the bands show their own tile skeletons);
 * `memories.album.waitSlow` from 3 s, then `memories.album.waitVerySlow` with a thin indeterminate
 * `ProgressBar` from 10 s. `ui_wait` `memories_album_month` `slow` / `very_slow` is logged once
 * each per wait (until no band waits). The line floats as a small pill over the top of the bands
 * (it never pushes the album down); its `role="status"` region is always mounted (empty when
 * quiet), so its text is announced. The glyph is decorative beside the visible line and stands
 * still under reduced motion.
 */
export const AlbumWaitLine: React.FC<{ waits: BandWaits }> = ({ waits }) => {
    const { t } = useTranslation();
    const oldest = useSyncExternalStore(waits.subscribe, waits.oldest);
    const waiting = oldest !== null;
    const { stage, waitMs } = useLoadingStages(waiting, { startedAt: oldest ?? undefined });
    const logged = useRef(new Set<WaitPhase>());
    useEffect(() => {
        if (!waiting) {
            logged.current.clear();
            return;
        }
        const phases: WaitPhase[] = stage === 'verySlow' ? ['slow', 'very_slow'] : stage === 'slow' ? ['slow'] : [];
        for (const phase of phases) {
            if (logged.current.has(phase)) continue;
            logged.current.add(phase);
            logWait(SURFACE, phase, waitMs);
        }
    }, [waiting, stage, waitMs]);
    const verySlow = stage === 'verySlow';
    const line = verySlow ? t('memories.album.waitVerySlow') : stage === 'slow' ? t('memories.album.waitSlow') : null;
    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4 pt-1">
            <div role="status" data-testid="album-wait-line">
                {line && (
                    <div className="flex flex-row flex-wrap items-center gap-2 rounded-pill bg-sheet px-3 py-1 text-small text-secondary shadow-pill">
                        <Spinner size="sm" tone="muted" decorative />
                        <span>{line}</span>
                        {verySlow && <ProgressBar label={t('loading.label')} size="thin" labelClassName="hidden" className="w-24" />}
                    </div>
                )}
            </div>
        </div>
    );
};
