import React, { useSyncExternalStore } from 'react';
import { useLoadingStages } from '../../../design/loading';
import { ProgressBar, Spinner } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import type { BandWaits } from './bandWaits';

/** The `ui_wait` surface of the album's month grids. */
const SURFACE = 'memories_album_month';

/**
 * One page-level wait line above the month bands, instead of slow copy in every band (F28). While
 * any band waits for its grid (`waits`), the stage clock runs (`useLoadingStages`, logging
 * `ui_wait` `memories_album_month` `slow` / `very_slow` once per wait): nothing before `slow` (the
 * bands show their own tile skeletons), `memories.album.waitSlow` from 3 s, then
 * `memories.album.waitVerySlow` with a thin indeterminate `ProgressBar` from 10 s. The
 * `role="status"` region is always mounted (empty when quiet), so its line is announced; it empties
 * when the last band settles. The glyph is decorative beside the visible line and stands still
 * under reduced motion.
 */
export const AlbumWaitLine: React.FC<{ waits: BandWaits }> = ({ waits }) => {
    const { t } = useTranslation();
    const waiting = useSyncExternalStore(waits.subscribe, waits.any);
    const { stage } = useLoadingStages(waiting, { surface: SURFACE });
    const verySlow = stage === 'verySlow';
    const line = verySlow ? t('memories.album.waitVerySlow') : stage === 'slow' ? t('memories.album.waitSlow') : null;
    return (
        <div
            role="status"
            data-testid="album-wait-line"
            className={cn('shrink-0', line && 'flex min-h-5 flex-row flex-wrap items-center gap-2 px-4 pb-2 text-small text-secondary')}
        >
            {line && (
                <>
                    <Spinner size="sm" tone="muted" decorative />
                    <span>{line}</span>
                    {verySlow && <ProgressBar label={t('loading.label')} size="thin" labelClassName="hidden" className="w-24" />}
                </>
            )}
        </div>
    );
};
