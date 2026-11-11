import React, { useEffect, useRef } from 'react';
import { logWait } from '../../../design/loading';
import { StatusBlock } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';

interface HubGatheringLineProps {
    /** The board on screen says a sync or its post-sync refresh is still running (`refreshing`). */
    refreshing: boolean;
    /** The hub query is still re-polling quietly (`polling`). */
    polling: boolean;
    /** The polling ended at its cap with the board still `refreshing` (`pollCapped`). */
    capped: boolean;
}

/** The `ui_wait` surface of the hub's quiet re-polling. */
const SURFACE = 'memories_hub';

/**
 * The hub's "still gathering" line (F27). An empty `role="status"` region (polite) is always
 * mounted under the title, so the line is announced when it is inserted; while the board on screen
 * is `refreshing` and its quiet re-polling runs, the region holds one inline `StatusBlock`
 * (`memories.home.gathering`). The board is already on screen, so its stage is `shown` at once (no
 * reveal delay). The line goes when `refreshing` clears or the polling stops; when the polling
 * ended at its cap (`capped`) it is dropped quietly and `ui_wait` `memories_hub` `timeout` is logged
 * once, with the time the line was shown (a failed quiet reload ends it too, and is logged by its
 * own `memories_load` `error`). It never blocks the board. Mount it per service (`key`), so each
 * board logs at most once.
 */
export const HubGatheringLine: React.FC<HubGatheringLineProps> = ({ refreshing, polling, capped }) => {
    const { t } = useTranslation();
    const shown = refreshing && polling;
    const shownAt = useRef<number | null>(null);
    const logged = useRef(false);

    useEffect(() => {
        if (shown) {
            if (shownAt.current === null) shownAt.current = Date.now();
            return;
        }
        // Gave up at the cap while the board still says it is refreshing: the line drops quietly.
        if (capped && shownAt.current !== null && !logged.current) {
            logged.current = true;
            logWait(SURFACE, 'timeout', Date.now() - shownAt.current);
        }
        shownAt.current = null;
    }, [shown, capped]);

    return (
        <div role="status" data-testid="memories-hub-gathering" className="shrink-0">
            {shown && <StatusBlock kind="loading" variant="inline" surface={SURFACE} stage="shown" label={t('memories.home.gathering')} />}
        </div>
    );
};
