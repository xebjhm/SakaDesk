import React from 'react';
import { Play, Star } from 'lucide-react';
import { cn } from '../../../utils/classnames';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';

interface PhotoTileProps {
    item: MemoryMessage;
    /** `sepiaClass` of the month's year, applied to the still only. */
    sepia: string;
    /** The tile's accessible name (her words, else the date). */
    label: string;
    onOpen: (item: MemoryMessage) => void;
}

/**
 * One album tile, a square still that opens the media viewer. Hover or focus shows her words
 * from within ±3 minutes (the backend's `caption`, else her own `text`) in a frosted caption.
 * A ★ (favourited) tile spans 2×2, wears a washi-tape strip and the yellow favourite star.
 * Memoised: a month's grid re-renders only when its own data changes.
 */
export const PhotoTile = React.memo<PhotoTileProps>(({ item, sepia, label, onOpen }) => {
    const words = item.caption ?? item.text;
    const star = item.favorited;
    return (
        <button
            type="button"
            data-testid={`album-tile-${item.id}`}
            aria-label={label}
            onClick={() => onOpen(item)}
            className={cn(
                'group relative block aspect-square w-full rounded-sm bg-sunken',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                star && 'col-span-2 row-span-2',
            )}
        >
            <span className="block h-full w-full overflow-hidden rounded-sm">
                <MemoryThumb message={item} className={cn('h-full w-full', sepia)} />
            </span>
            {item.type === 'video' && (
                <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />
            )}
            {star && (
                <>
                    <span
                        data-testid="album-washi"
                        aria-hidden="true"
                        className="absolute -top-2 left-1/2 h-4 w-16 -translate-x-1/2 -rotate-3 bg-memories-washi motion-reduce:rotate-0"
                    />
                    <Star aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 fill-current text-semantic-star drop-shadow-sm" />
                </>
            )}
            {words && (
                <span
                    data-testid="album-hover-caption"
                    aria-hidden="true"
                    className={cn(
                        'pointer-events-none absolute inset-x-1 bottom-1 rounded-md border border-frost bg-frost p-2 text-left',
                        'text-small text-primary backdrop-blur-frost',
                        'opacity-0 transition-opacity duration-fast ease-standard motion-reduce:transition-none',
                        'group-hover:opacity-100 group-focus-visible:opacity-100',
                    )}
                >
                    <MemoryText as="span" text={words} className="line-clamp-3" />
                </span>
            )}
        </button>
    );
});
PhotoTile.displayName = 'PhotoTile';
