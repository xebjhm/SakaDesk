import React, { useRef, useState } from 'react';
import { Film } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import { useDevicePixelRatio } from '../../../hooks/useDevicePixelRatio';
import { thumbnailUrl, thumbWidthFor } from '../../messages/mediaUrl';
import type { MemoryMessage } from '../types';
import { useInView } from './useInView';

interface MemoryThumbProps {
    message: Pick<MemoryMessage, 'type' | 'media_url'>;
    /** Size, radius and filters (e.g. `sepiaClass`); applied to the image, the video or the tile. */
    className?: string;
    /**
     * The still's drawn longest side in CSS px: a picture is then loaded from the thumbnail route
     * at the matching width (`thumbWidthFor`), falling back to the full file if that fails.
     * Without it the full file is used.
     */
    px?: number;
    /** Called when a picture cannot load at all (the full file failed too), so the caller can hide its frame. */
    onFail?: () => void;
}

const FilmTile: React.FC<{ className?: string }> = ({ className }) => (
    <span aria-hidden="true" data-testid="memory-thumb-video-tile" className={cn('flex items-center justify-center bg-sunken text-muted', className)}>
        <Film className="h-5 w-5" />
    </span>
);

const PictureThumb: React.FC<{ url: string; px?: number; className?: string; onFail?: () => void }> = ({ url, px, className, onFail }) => {
    const dpr = useDevicePixelRatio();
    // The URL that failed: a thumbnail error switches this picture to its full file.
    const [failed, setFailed] = useState<string | null>(null);
    const thumb = px !== undefined ? thumbnailUrl(url, thumbWidthFor(px, dpr)) : undefined;
    const src = thumb && failed !== thumb ? thumb : url;
    return (
        <img
            src={src}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={() => { if (src !== url) setFailed(src); else onFail?.(); }}
            className={cn('object-cover', className)}
        />
    );
};

/** A video still mounted only while near the viewport (a live player costs memory); else the film tile. */
const VideoThumb: React.FC<{ url: string; className?: string }> = ({ url, className }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref);
    return (
        <span ref={ref} className={cn('block overflow-hidden', className)}>
            {inView ? (
                <video
                    data-testid="memory-thumb-video"
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                    className="pointer-events-none h-full w-full object-cover"
                />
            ) : (
                <FilmTile className="h-full w-full" />
            )}
        </span>
    );
};

/**
 * A small still of a picture or video message: a picture as a lazy, async-decoded `<img>` (from
 * the thumbnail route when `px` is given, the full file on error); a video as a muted,
 * metadata-only `<video>` showing its first frame (the recap's approach, `S05Photos`), mounted
 * only while near the viewport (a film tile otherwise), never a video in an `<img>`. A video
 * without a URL is a neutral film tile; anything else renders nothing. Decorative: callers label
 * the surrounding control.
 */
export const MemoryThumb: React.FC<MemoryThumbProps> = ({ message, className, px, onFail }) => {
    if (message.type === 'picture' && message.media_url) {
        return <PictureThumb url={message.media_url} px={px} className={className} onFail={onFail} />;
    }
    if (message.type !== 'video') return null;
    if (!message.media_url) return <FilmTile className={className} />;
    return <VideoThumb url={message.media_url} className={className} />;
};
