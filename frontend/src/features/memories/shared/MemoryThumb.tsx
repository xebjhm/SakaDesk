import React, { useState } from 'react';
import { Film } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import { MediaTile, type MediaTileState } from '../../../core/media/grid';
import { THUMB_PREGEN_WIDTH } from '../../messages/mediaUrl';
import type { MemoryMessage } from '../types';

interface MemoryThumbProps {
    message: Pick<MemoryMessage, 'type' | 'media_url'>;
    /** Size, radius and filters (e.g. `sepiaClass`); applied to the tile (or the original image). */
    className?: string;
    /**
     * The still's drawn longest side in CSS px: the still is then the shared `MediaTile`, loaded
     * from the thumbnail route at the matching width (`thumbWidthFor`). Without it a picture is
     * its original file, loaded directly (callers that need the original).
     */
    px?: number;
    /**
     * Called when a picture cannot load at all (with `px`: the thumbnail and the full file both
     * failed), so the caller can hide its frame. It receives `retry`, which starts loading again.
     */
    onFail?: (retry: () => void) => void;
    /** The tile's state (`loading | ready | failed | film`) whenever it changes (with `px`). */
    onStateChange?: (state: MediaTileState) => void;
    /** A picture's loading hint (default `lazy`); the recap poster passes `eager` (it is exported as an image). */
    loading?: 'lazy' | 'eager';
    /**
     * Allow the 640 px thumbnail (`thumbWidthFor` `large`): ★ items, album covers and exports.
     * Others are capped at the pre-generated 480.
     */
    large?: boolean;
}

/** A video's drawn size when the caller gives none (its poster comes from the pre-generated width). */
const VIDEO_FALLBACK_PX = THUMB_PREGEN_WIDTH;

const FilmTile: React.FC<{ className?: string }> = ({ className }) => (
    <span aria-hidden="true" data-testid="memory-thumb-video-tile" className={cn('flex items-center justify-center bg-sunken text-muted', className)}>
        <Film className="h-5 w-5" />
    </span>
);

/**
 * The original file as a plain `<img>`: no thumbnail, no scheduler, no meta (callers that need
 * the full picture and pass no `px`).
 */
const OriginalPicture: React.FC<{
    url: string; className?: string; onFail?: (retry: () => void) => void; loading?: 'lazy' | 'eager';
}> = ({ url, className, onFail, loading = 'lazy' }) => {
    const [attempt, setAttempt] = useState(0);
    return (
        <img
            key={attempt}
            src={url}
            alt=""
            draggable={false}
            loading={loading}
            decoding="async"
            onError={() => onFail?.(() => setAttempt((n) => n + 1))}
            className={cn('object-cover', className)}
        />
    );
};

/**
 * A small still of a picture or video message on the media pipeline's shared tile (`MediaTile`):
 * the placeholder (mean colour and blur, pulsing; a spinner under reduced motion), then the
 * thumbnail at `px` fading in through the priority scheduler, with the fallbacks `?v` → plain
 * thumbnail → full file → `onFail(retry)` and a quiet failed state. `loading="eager"` renders a
 * synchronous `<img>` with the same fallbacks (the recap poster export). A video shows its poster
 * thumbnail (captured in the browser while visible if none exists) or the film tile; it never
 * mounts a `<video>`. Without `px` a picture is its original file (no thumbnail is tried first).
 * A video without a URL is a neutral film tile; anything else renders nothing. Decorative:
 * callers label the surrounding control.
 */
export const MemoryThumb: React.FC<MemoryThumbProps> = ({ message, className, px, onFail, onStateChange, loading, large = false }) => {
    if (message.type === 'picture' && message.media_url) {
        if (px === undefined) return <OriginalPicture url={message.media_url} className={className} onFail={onFail} loading={loading} />;
        return (
            <MediaTile
                url={message.media_url}
                kind="picture"
                cssPx={px}
                large={large}
                eager={loading === 'eager'}
                className={className}
                onFail={onFail}
                onStateChange={onStateChange}
                testId="memory-thumb"
            />
        );
    }
    if (message.type !== 'video') return null;
    if (!message.media_url) return <FilmTile className={className} />;
    return (
        <MediaTile
            url={message.media_url}
            kind="video"
            cssPx={px ?? VIDEO_FALLBACK_PX}
            large={large}
            className={className}
            onStateChange={onStateChange}
            testId="memory-thumb"
        />
    );
};
