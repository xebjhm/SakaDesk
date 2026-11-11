import { useEffect, useMemo, useRef } from 'react';
import { clientLog } from '../../../utils/clientLog';
import type { MediaGridTileReporter } from './gridContext';

/** The `media_grid` breadcrumb's grid code. */
export type MediaGridCode = 'messages' | 'blogs' | 'album';

/**
 * The reporter a media grid provides to its tiles (`MediaGridContext`): it counts the visible
 * tiles and logs the first-paint breadcrumb `media_grid` (`grid`, `first_tile_ms` from mount,
 * `visible`, `count`) once per mount, when the first visible tile's image is ready. `root` is the
 * scroll parent the tiles measure their visibility against (`null`: the viewport). Codes and
 * counts only.
 */
export function useMediaGridReporter(grid: MediaGridCode, root: Element | null, count: number): MediaGridTileReporter {
    const mountedAt = useRef(performance.now());
    const visibleCount = useRef(0);
    const logged = useRef(false);
    const countRef = useRef(count);
    countRef.current = count;

    useEffect(() => {
        mountedAt.current = performance.now();
    }, []);

    return useMemo<MediaGridTileReporter>(() => ({
        root,
        tileVisible(delta) {
            visibleCount.current = Math.max(0, visibleCount.current + delta);
        },
        tileReady() {
            if (logged.current) return;
            logged.current = true;
            clientLog('media_grid', {
                grid,
                first_tile_ms: Math.max(0, Math.round(performance.now() - mountedAt.current)),
                visible: visibleCount.current,
                count: countRef.current,
            });
        },
    }), [grid, root]);
}
