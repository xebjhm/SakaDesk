import React, { useMemo, useRef, useState } from 'react';
import { ImageIcon, Layers, MessageCircle, Star } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, Menu, MenuItem, Modal } from '../../../design/primitives';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import { cn } from '../../../utils/classnames';
import { MediaGridContext, useTileRetry } from '../../../core/media/grid';
import { logMemoriesToggle } from '../memoriesLog';
import { jumpToChat } from '../shared/jumpToChat';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';
import { albumItemKey, albumViewerItems } from './albumViewer';
import { TILE_PX } from './PhotoTile';
import { useContextMenu } from './useContextMenu';

/** A sequence frame's drawn size (`w-40`). */
const FRAME_PX = 160;

interface BurstStackProps {
    /** The burst's items in time order (three or more). */
    items: MemoryMessage[];
    /** The sequence dialog's title (the month label). */
    title: string;
    nameOf: (m: MemoryMessage) => string;
    /** `sepiaClass` of the month's year, applied to the stills only. */
    sepia: string;
    /** Offers 「この月の表紙にする」 in each sequence frame's context menu. */
    onSetCover?: (item: MemoryMessage) => void;
    /** One grid tile's drawn edge in CSS px (the grid's measured `tilePx`; picks the thumbnail width). */
    tilePx?: number;
}

interface FrameButtonProps {
    item: MemoryMessage;
    label: string;
    sepia: string;
    disabled: boolean;
    onOpen: () => void;
    onSetCover?: (item: MemoryMessage) => void;
}

/**
 * One sequence frame: opens the viewer (a frame whose still failed retries it instead); its
 * context menu can make it the month cover.
 */
const FrameButton: React.FC<FrameButtonProps> = ({ item, label, sepia, disabled, onOpen, onSetCover }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLButtonElement>(null);
    const coverable = onSetCover !== undefined && (item.type === 'picture' || item.type === 'video');
    const menu = useContextMenu(coverable);
    const still = useTileRetry();
    return (
        <>
            <button
                ref={ref}
                type="button"
                disabled={disabled}
                aria-label={still.failed ? t('memories.album.retryTile', { label }) : label}
                aria-haspopup={coverable ? 'menu' : undefined}
                onClick={() => still.click(onOpen)}
                onContextMenu={menu.onContextMenu}
                onKeyDown={menu.onKeyDown}
                className="block w-40 shrink-0 overflow-hidden rounded-sm bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <MemoryThumb
                    message={item}
                    px={FRAME_PX}
                    large={item.favorited}
                    onFail={still.onFail}
                    onStateChange={still.onStateChange}
                    className={cn('aspect-square h-full w-full', sepia)}
                />
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
};

/**
 * A burst (spec 8): one stacked still with 「{{count}} 枚」. Clicking opens the sequence, a dialog
 * with the burst's frames in order and her words beside each (`caption`, else `text`), each with
 * a jump to her chat; a frame opens the media viewer over the burst. A ★ photo in the burst
 * shows the yellow star on the stack and beside its frame. Opening and every close (including
 * a jump) log `memories_toggle` `album_burst`. With `onSetCover` each frame's context menu offers
 * 「この月の表紙にする」 (a burst frame can be the cover too). The stack always opens the sequence
 * (named 「{{count}} 枚の写真を開く」), even when its still failed to load (the tile shows the quiet
 * failed state): the other frames may be fine. A frame whose still failed retries it on click
 * instead of opening the viewer (`useTileRetry`), and its name says so. The dialog and the viewer
 * reset the media grid context (portalled: their tiles observe against the viewport).
 */
export const BurstStack: React.FC<BurstStackProps> = ({ items, title, nameOf, sepia, onSetCover, tilePx = TILE_PX }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const count = t('memories.album.burst', { count: items.length });
    const viewer = useMemo(
        () => albumViewerItems(items, {
            nameOf,
            sourceLabel: t('memories.common.jumpToChat'),
            onBeforeJump: () => { setViewerIndex(null); setOpen(false); logMemoriesToggle('album_burst', false); },
        }),
        // `open`: the sequence reads the names current when it opens (`nameOf` is stable).
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [items, nameOf, t, open],
    );

    const toggle = (next: boolean) => {
        setOpen(next);
        logMemoriesToggle('album_burst', next);
    };
    const first = items[0];
    const hasStar = items.some((m) => m.favorited);

    return (
        <>
            <button
                type="button"
                aria-label={t('memories.album.openBurst', { count: items.length })}
                onClick={() => toggle(true)}
                className={cn(
                    'group relative block aspect-square w-full rounded-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                )}
            >
                {/* Two paper edges behind the still read as a stack. */}
                <span aria-hidden="true" className="absolute inset-0 translate-x-1 translate-y-1 rotate-2 rounded-sm bg-memories-paper shadow-memories-polaroid motion-reduce:rotate-0" />
                <span aria-hidden="true" className="absolute inset-0 -rotate-1 rounded-sm bg-memories-paper shadow-memories-polaroid motion-reduce:rotate-0" />
                <span className="relative block h-full w-full overflow-hidden rounded-sm bg-sunken">
                    {first && (
                        <MemoryThumb
                            message={first}
                            px={tilePx}
                            large={first.favorited}
                            className={cn('h-full w-full', sepia)}
                        />
                    )}
                </span>
                {hasStar && (
                    <Star data-testid="burst-star" aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 fill-current text-semantic-star drop-shadow-sm" />
                )}
                {/* Contained in the tile: never wider than it, the label truncates first. */}
                <span
                    data-testid="burst-badge"
                    className="absolute bottom-1 right-1 inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1 overflow-hidden rounded-pill bg-frost px-2 text-caption text-primary backdrop-blur-frost"
                >
                    <Layers aria-hidden="true" className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{count}</span>
                </span>
            </button>
            {/*
              * The dialog and the viewer are portalled out of the album's scroll container: their
              * tiles observe against the viewport and are not counted by the album's breadcrumb.
              */}
            <MediaGridContext.Provider value={null}>
                <Modal isOpen={open} onClose={() => toggle(false)} title={title} header="plain" className="max-w-2xl">
                    <ol className="flex flex-col gap-4">
                        {items.map((m) => {
                            const words = m.caption ?? m.text;
                            const index = viewer.viewable.indexOf(m);
                            return (
                                <li key={albumItemKey(m)} data-testid="burst-frame" className="flex items-start gap-4">
                                    <FrameButton
                                        item={m}
                                        label={words ?? title}
                                        sepia={sepia}
                                        disabled={index < 0}
                                        onOpen={() => setViewerIndex(index)}
                                        onSetCover={onSetCover}
                                    />
                                    {m.favorited && (
                                        <Star data-testid="burst-frame-star" aria-hidden="true" className="h-4 w-4 shrink-0 fill-current text-semantic-star drop-shadow-sm" />
                                    )}
                                    <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                                        {words && <MemoryText text={words} className="text-body text-primary" />}
                                        <Button variant="ghost" size="sm" onClick={() => { toggle(false); jumpToChat(m, nameOf(m), 'album'); }}>
                                            <MessageCircle aria-hidden="true" className="h-4 w-4" />
                                            {t('memories.common.jumpToChat')}
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                </Modal>
                {viewerIndex !== null && viewer.items[viewerIndex] && (
                    <MediaViewerModal
                        mediaItems={viewer.items}
                        currentIndex={viewerIndex}
                        onClose={() => setViewerIndex(null)}
                        onNavigate={setViewerIndex}
                    />
                )}
            </MediaGridContext.Provider>
        </>
    );
};
