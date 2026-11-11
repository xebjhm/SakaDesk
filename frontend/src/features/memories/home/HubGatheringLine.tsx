import React, { useEffect, useRef } from 'react';
import { logWait } from '../../../design/loading';
import { StatusBlock } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';

interface HubGatheringLineProps {
    /** The board on screen says a sync or its post-sync refresh is still running (`refreshing`). */
    refreshing: boolean;
    /** The hub query is still re-polling quietly (`polling`; false once the cap is reached). */
    polling: boolean;
}

/** The `ui_wait` surface of the hub's quiet re-polling. */
const SURFACE = 'memories_hub';

/**
 * The hub's "still gathering" line (F27): one inline `StatusBlock` row
 * (`memories.home.gathering`, `role="status"`, polite) while the board on screen is `refreshing`
 * and its quiet re-polling runs. The board is already on screen, so the stage is `shown` at once
 * (no reveal delay). It goes when `refreshing` clears; when the polling stops while the board still
 * says `refreshing` (the reload cap, or a failed quiet reload) it is dropped quietly and
 * `ui_wait` `memories_hub` `timeout` is logged once, with the time the line was shown. It never
 * blocks the board. Mount it per service (`key`), so each board logs at most once.
 */
export const HubGatheringLine: React.FC<HubGatheringLineProps> = ({ refreshing, polling }) => {
    const { t } = useTranslation();
    const shown = refreshing && polling;
    const shownAt = useRef<number | null>(null);
    const logged = useRef(false);

    useEffect(() => {
        if (shown) {
            if (shownAt.current === null) shownAt.current = Date.now();
            return;
        }
        // Gave up while the board still says it is refreshing: the line drops quietly.
        if (refreshing && shownAt.current !== null && !logged.current) {
            logged.current = true;
            logWait(SURFACE, 'timeout', Date.now() - shownAt.current);
        }
        shownAt.current = null;
    }, [shown, refreshing]);

    if (!shown) return null;
    return (
        <div data-testid="memories-hub-gathering" className="shrink-0">
            <StatusBlock kind="loading" variant="inline" surface={SURFACE} stage="shown" label={t('memories.home.gathering')} />
        </div>
    );
};
