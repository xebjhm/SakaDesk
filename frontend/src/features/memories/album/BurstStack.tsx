import React, { useMemo, useState } from 'react';
import { Layers, MessageCircle } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, Modal } from '../../../design/primitives';
import { MediaViewerModal } from '../../../core/media/PhotoDetailModal';
import { cn } from '../../../utils/classnames';
import { logMemoriesToggle } from '../memoriesLog';
import { jumpToChat } from '../shared/jumpToChat';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';
import { albumItemKey, albumViewerItems } from './albumViewer';

interface BurstStackProps {
    /** The burst's items in time order (three or more). */
    items: MemoryMessage[];
    /** The sequence dialog's title (the month label). */
    title: string;
    nameOf: (m: MemoryMessage) => string;
    /** `sepiaClass` of the month's year, applied to the stills only. */
    sepia: string;
}

/**
 * A burst (spec 8): one stacked still with 「{{count}} 枚」. Clicking opens the sequence, a dialog
 * with the burst's frames in order and her words beside each (`caption`, else `text`), each with
 * a jump to her chat; a frame opens the media viewer over the burst. Opening and closing log
 * `memories_toggle` `album_burst`.
 */
export const BurstStack: React.FC<BurstStackProps> = ({ items, title, nameOf, sepia }) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const count = t('memories.album.burst', { count: items.length });
    const viewer = useMemo(
        () => albumViewerItems(items, {
            nameOf,
            sourceLabel: t('memories.common.jumpToChat'),
            onBeforeJump: () => { setViewerIndex(null); setOpen(false); },
        }),
        [items, nameOf, t],
    );

    const toggle = (next: boolean) => {
        setOpen(next);
        logMemoriesToggle('album_burst', next);
    };
    const first = items[0];

    return (
        <>
            <button
                type="button"
                aria-label={count}
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
                    {first && <MemoryThumb message={first} className={cn('h-full w-full', sepia)} />}
                </span>
                <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-pill bg-frost px-2 text-caption text-primary backdrop-blur-frost">
                    <Layers aria-hidden="true" className="h-3 w-3" />
                    {count}
                </span>
            </button>
            <Modal isOpen={open} onClose={() => toggle(false)} title={title} header="plain" className="max-w-2xl">
                <ol className="flex flex-col gap-4">
                    {items.map((m) => {
                        const words = m.caption ?? m.text;
                        const index = viewer.viewable.indexOf(m);
                        return (
                            <li key={albumItemKey(m)} data-testid="burst-frame" className="flex items-start gap-4">
                                <button
                                    type="button"
                                    disabled={index < 0}
                                    aria-label={words ?? title}
                                    onClick={() => setViewerIndex(index)}
                                    className="block w-40 shrink-0 overflow-hidden rounded-sm bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    <MemoryThumb message={m} className={cn('aspect-square h-full w-full', sepia)} />
                                </button>
                                <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                                    {words && <MemoryText text={words} className="text-body text-primary" />}
                                    <Button variant="ghost" size="sm" onClick={() => { setOpen(false); jumpToChat(m, nameOf(m), 'album'); }}>
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
        </>
    );
};
