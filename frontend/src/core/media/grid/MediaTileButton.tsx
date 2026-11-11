import React, { useCallback, useRef, useState } from 'react';
import { MediaTile, type MediaTileState } from './MediaTile';

export interface MediaTileButtonProps {
    /** The media-route URL of the item (thumbnails and meta come from it). */
    url: string;
    kind: 'picture' | 'video';
    /** The tile's drawn edge in CSS px (`VirtualMediaGrid`'s `tilePx`). */
    cssPx: number;
    /** ★ items: allow the 640 px thumbnail (others stop at 480). */
    large?: boolean;
    /** Translated accessible name of the open action, e.g. "Open photo from <date>". */
    label: string;
    /** Translated accessible name while the picture failed (a click retries), e.g. "Retry loading photo from <date>". */
    retryLabel: string;
    /** Open the item in the viewer. */
    onOpen: () => void;
    /** Overlays drawn over the tile (a video's mute and duration badges). */
    children?: React.ReactNode;
}

/**
 * One gallery tile: a square button around the shared `MediaTile`. A click opens the viewer;
 * on a tile whose picture failed it calls the tile's `onFail(retry)` handle instead, and the
 * button's accessible name then says so (`retryLabel`). The state comes from the tile's
 * `onStateChange`, so an automatic retry on scroll-back restores the open action at once.
 */
export const MediaTileButton: React.FC<MediaTileButtonProps> = ({ url, kind, cssPx, large = false, label, retryLabel, onOpen, children }) => {
    const retryRef = useRef<(() => void) | null>(null);
    const [failed, setFailed] = useState(false);
    const onFail = useCallback((retry: () => void) => { retryRef.current = retry; }, []);
    const onStateChange = useCallback((state: MediaTileState) => setFailed(state === 'failed'), []);
    const onClick = () => {
        if (failed && retryRef.current) {
            retryRef.current();
            return;
        }
        onOpen();
    };
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={failed ? retryLabel : label}
            className="relative block aspect-square w-full overflow-hidden bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
            <MediaTile url={url} kind={kind} cssPx={cssPx} large={large} onFail={onFail} onStateChange={onStateChange} className="h-full w-full" />
            {children}
        </button>
    );
};
