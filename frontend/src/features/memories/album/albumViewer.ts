import type { TFunction } from 'i18next';
import type { MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { jumpToChat } from '../shared/jumpToChat';
import { memoryMediaSrc } from '../shared/mediaSrc';
import type { MemoriesView } from '../memoriesLog';
import type { MemoryMessage } from '../types';

/** Message ids repeat across rooms: an album item is keyed by room and id. */
export const albumItemKey = (m: Pick<MemoryMessage, 'room' | 'id'>) => `${m.room}|${m.id}`;

/** A picture or video the media viewer can show (it has a URL or a service-relative file). */
export const isViewable = (m: MemoryMessage) =>
    (m.type === 'picture' || m.type === 'video') && Boolean(m.media_url || m.media_file);

/** Only called for viewable items, which have a URL or a file. */
const mediaSrc = (m: MemoryMessage) => memoryMediaSrc(m) ?? '';

interface AlbumViewerOptions {
    /** Her display name for the chat she is opened in. */
    nameOf: (m: MemoryMessage) => string;
    /** The source link's label (`memories.common.jumpToChat`). */
    sourceLabel: string;
    /** Runs before the jump (closes the viewer). */
    onBeforeJump?: () => void;
    /** The view the jump is logged for (`memories_jump` `target`); default `album`. */
    from?: MemoriesView;
}

/**
 * The media viewer's items for a month (or one burst): the viewable pictures and videos sorted
 * oldest first (the viewer's `oldest_first` order, so ← is older), each with a source link that
 * opens her chat at that message (`jumpToChat(…, from)`, `album` by default). `viewable[i]` is `items[i]`.
 */
export function albumViewerItems(
    messages: MemoryMessage[],
    { nameOf, sourceLabel, onBeforeJump, from = 'album' }: AlbumViewerOptions,
): { viewable: MemoryMessage[]; items: MediaViewerItem[] } {
    const viewable = messages
        .filter(isViewable)
        .map((m, i) => ({ m, i, t: Date.parse(m.ts) }))
        .sort((a, b) => a.t - b.t || a.i - b.i)
        .map(({ m }) => m);
    const items = viewable.map((m): MediaViewerItem => ({
        src: mediaSrc(m),
        type: m.type as 'picture' | 'video',
        timestamp: m.ts,
        memberName: nameOf(m),
        sourceLabel,
        onSourceJump: () => {
            onBeforeJump?.();
            jumpToChat(m, nameOf(m), from);
        },
        messageId: m.id,
        service: m.service,
    }));
    return { viewable, items };
}

/** The viewer index of `m` (matched by room and id), or -1. */
export function viewerIndexOf(viewable: MemoryMessage[], m: MemoryMessage): number {
    const key = albumItemKey(m);
    return viewable.findIndex((v) => albumItemKey(v) === key);
}

/** `YYYY-MM` as numbers. */
export function monthParts(month: string): { year: number; month: number } {
    const [y, m] = month.split('-').map(Number);
    return { year: y, month: m };
}

/**
 * A month in the UI language through `key` (`memories.album.monthLabel` / `.ribbonLabel`):
 * Japanese and Chinese use the numbers, English the month name (`monthName`, from `Intl`).
 */
export function formatMonth(t: TFunction, key: string, month: string, language: string): string {
    const parts = monthParts(month);
    const monthName = new Intl.DateTimeFormat(language, { month: 'long', timeZone: 'UTC' })
        .format(new Date(Date.UTC(parts.year, parts.month - 1, 1)));
    return t(key, { year: parts.year, month: parts.month, monthName });
}
