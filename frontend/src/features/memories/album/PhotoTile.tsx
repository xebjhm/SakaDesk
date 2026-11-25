import React, { useRef } from 'react';
import { ImageIcon, Play, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Menu, MenuItem } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { useTileRetry } from '../../../core/media/grid';
import { MEDIA_GRID_GAP_REM, MEDIA_TILE_MIN_REM } from '../../../core/media/tileGrid';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';
import { useContextMenu } from './useContextMenu';

/**
 * A tile's drawn edge in CSS px before the grid has measured itself: the minimum tile of
 * `tileGrid.ts` (the grid passes its measured `tilePx` once known). A pinned ★ tile spans two.
 */
export const TILE_PX = MEDIA_TILE_MIN_REM * 16;
/** The grid gap in CSS px (`tileGrid.ts`): a pinned ★ tile spans two tiles and the gap between. */
const GAP_PX = MEDIA_GRID_GAP_REM * 16;

interface PhotoTileProps {
    item: MemoryMessage;
    /** `sepiaClass` of the month's year, applied to the still only. */
    sepia: string;
    /** Pin a ★ tile larger with tape (off under the ★ filter, where every tile is one). */
    pinned?: boolean;
    /** The tile's accessible name (her words, else the date). */
    label: string;
    onOpen: (item: MemoryMessage) => void;
    /** Offers 「この月の表紙にする」 in the tile's context menu (pictures and videos only). */
    onSetCover?: (item: MemoryMessage) => void;
    /** One grid tile's drawn edge in CSS px (the grid's measured `tilePx`; picks the thumbnail width). */
    tilePx?: number;
}

/**
 * One album tile, a square still that opens the media viewer. Hover or focus shows her words
 * from within ±3 minutes (the backend's `caption`, else her own `text`) in a frosted caption.
 * A ★ (favourited) tile wears the yellow favourite star; when `pinned` it also spans 2×2 and
 * wears a washi-tape strip.
 * With `onSetCover`, a picture or video tile's context menu (right-click, the context-menu key or
 * Shift+F10) offers 「この月の表紙にする」; other tiles keep the browser's menu.
 * The still is the shared media tile (placeholder, then the thumbnail sized from `tilePx`; a ★
 * asks for up to the 640 px variant). A click on a still that failed to load retries it instead
 * of opening the viewer, and the tile's name says so (`useTileRetry`).
 * Memoised: a month's grid re-renders only when its own data changes.
 */
export const PhotoTile = React.memo<PhotoTileProps>(({ item, sepia, pinned = false, label, onOpen, onSetCover, tilePx = TILE_PX }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLButtonElement>(null);
    const coverable = onSetCover !== undefined && (item.type === 'picture' || item.type === 'video');
    const menu = useContextMenu(coverable);
    const words = item.caption ?? item.text;
    const star = item.favorited;
    const large = star && pinned;
    const still = useTileRetry();
    return (
        <>
            <button
                ref={ref}
                type="button"
                data-testid={`album-tile-${item.id}`}
                aria-label={still.failed ? t('memories.album.retryTile', { label }) : label}
                aria-haspopup={coverable ? 'menu' : undefined}
                onClick={() => still.click(() => onOpen(item))}
                onContextMenu={menu.onContextMenu}
                onKeyDown={menu.onKeyDown}
                className={cn(
                    'group relative block aspect-square w-full rounded-sm bg-sunken',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    large && 'col-span-2 row-span-2',
                )}
            >
                <span className="block h-full w-full overflow-hidden rounded-sm">
                    <MemoryThumb
                        message={item}
                        px={large ? tilePx * 2 + GAP_PX : tilePx}
                        large={star}
                        onFail={still.onFail}
                        onStateChange={still.onStateChange}
                        className={cn('h-full w-full', sepia)}
                    />
                </span>
                {item.type === 'video' && (
                    <Play aria-hidden="true" className="absolute left-2 top-2 h-4 w-4 fill-current text-inverse drop-shadow-sm" />
                )}
                {large && (
                    <span
                        data-testid="album-washi"
                        aria-hidden="true"
                        className="absolute -top-2 left-1/2 h-4 w-16 -translate-x-1/2 -rotate-3 bg-memories-washi motion-reduce:rotate-0"
                    />
                )}
                {star && (
                    <Star data-testid="album-star" aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 fill-current text-semantic-star drop-shadow-sm" />
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
            {menu.point && onSetCover && (
                <Menu aria-label={label} onClose={menu.close} point={menu.point} returnFocusRef={ref}>
                    <MenuItem icon={<ImageIcon />} onClick={() => { menu.close(); onSetCover(item); }}>
                        {t('memories.album.setCover')}
                    </MenuItem>
                </Menu>
            )}
        </>
    );
});
PhotoTile.displayName = 'PhotoTile';
