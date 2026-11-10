import React from 'react';
import { Film } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import type { MemoryMessage } from '../types';

interface MemoryThumbProps {
    message: Pick<MemoryMessage, 'type' | 'media_url'>;
    /** Size, radius and filters (e.g. `sepiaClass`); applied to the image, the video or the tile. */
    className?: string;
}

/**
 * A small still of a picture or video message: a picture as `<img>`, a video as a muted,
 * metadata-only `<video>` showing its first frame (the recap's approach, `S05Photos`), never a
 * video in an `<img>`. A video without a URL is a neutral film tile; anything else renders
 * nothing. Decorative: callers label the surrounding control.
 */
export const MemoryThumb: React.FC<MemoryThumbProps> = ({ message, className }) => {
    if (message.type === 'picture' && message.media_url) {
        return <img src={message.media_url} alt="" draggable={false} className={cn('object-cover', className)} />;
    }
    if (message.type !== 'video') return null;
    if (!message.media_url) {
        return (
            <span aria-hidden="true" data-testid="memory-thumb-video-tile" className={cn('flex items-center justify-center bg-sunken text-muted', className)}>
                <Film className="h-5 w-5" />
            </span>
        );
    }
    return (
        <video
            data-testid="memory-thumb-video"
            src={message.media_url}
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
            className={cn('pointer-events-none object-cover', className)}
        />
    );
};
