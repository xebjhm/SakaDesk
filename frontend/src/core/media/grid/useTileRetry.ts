import { useCallback, useRef, useState } from 'react';
import type { MediaTileState } from './MediaTile';

export interface TileRetry {
    /** The tile's picture failed: its button's click retries (name it by that action). */
    failed: boolean;
    /** Pass to `MediaTile`'s `onFail`: keeps the tile's retry handle. */
    onFail: (retry: () => void) => void;
    /** Pass to `MediaTile`'s `onStateChange`: follows the state, so an automatic retry restores the open action. */
    onStateChange: (state: MediaTileState) => void;
    /** A click handler: retries a failed tile, else runs `open`. */
    click: (open: () => void) => void;
}

/**
 * The one rule for a media tile inside the caller's own button (galleries, the Memories album):
 * a click on a tile whose picture failed retries it instead of opening the viewer, and `failed`
 * tells the button to say so in its accessible name.
 */
export function useTileRetry(): TileRetry {
    const retryRef = useRef<(() => void) | null>(null);
    const [failed, setFailed] = useState(false);
    const onFail = useCallback((retry: () => void) => { retryRef.current = retry; }, []);
    const onStateChange = useCallback((state: MediaTileState) => setFailed(state === 'failed'), []);
    const click = useCallback((open: () => void) => {
        if (failed && retryRef.current) {
            retryRef.current();
            return;
        }
        open();
    }, [failed]);
    return { failed, onFail, onStateChange, click };
}
