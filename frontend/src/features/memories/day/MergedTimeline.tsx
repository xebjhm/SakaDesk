import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { maskedNickname } from '../shared/nicknameMask';
import { MessageBubble } from '../../messages/components/MessageBubble';
import { replaceNickname } from '../../messages/utils/nickname';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { MediaViewerModal, type MediaViewerItem } from '../../../core/media/PhotoDetailModal';
import { getServiceDisplayName, getServicePrimaryColor } from '../../../data/services';
import { groupMarkerStyle } from '../../search/groupMarker';
import { MemoryText } from '../shared/MemoryText';
import { useNickname } from '../shared/useNickname';
import { toChatMessage } from '../shared/toMessage';
import { jumpToChat } from '../shared/jumpToChat';
import { isViewableMedia, viewerSrc } from '../shared/mediaSrc';
import { contextCaption, shownTexts } from '../shared/captions';
import { JST_TIME_ZONE } from '../shared/jst';
import { useBubbleVoices } from '../shared/useBubbleVoices';
import type { DayPerson } from './people';
import type { DayMessage } from '../types';

interface MergedTimelineProps {
    /** The day's messages in time order (already filtered). */
    messages: DayMessage[];
    /** Everyone of the day, by `person_key` (`people.ts`). */
    people: Map<string, DayPerson>;
    /** The active service: messages of any other one carry a group label. */
    service: string;
    /**
     * The element that scrolls the list (the day view's body). Given, a long day (more than
     * `WINDOW_FROM` messages) is windowed with `react-virtuoso` inside it; without it every
     * message is rendered (card detail's single-member day: lazy thumbnails keep
     * even a busy one cheap, at the cost of DOM only).
     */
    scrollParent?: HTMLElement | null;
    /**
     * One message to bring forward (a card's message, a 24h slot): its row is tinted
     * (`bg-accent-subtle`, `data-focused`) and centred in the nearest ancestor marked
     * `data-focus-scroller` (that element's `scrollTop` only; nothing above it moves). Only for an
     * unwindowed list (no `scrollParent`), where every row is in the DOM.
     */
    focus?: { room: string; id: number } | null;
}

/** Same sender within this long continues a run (the chat's rule). */
const RUN_GAP_MS = 5 * 60 * 1000;
const AVATAR_PX = 40;
/** Above this many messages the list is windowed (a cross-group concert day runs to hundreds). */
export const WINDOW_FROM = 60;
/**
 * Read-only bubbles draw pictures from the thumbnail route at this width (a bubble is at most
 * about 320 CSS px wide, so 640 covers 2x), lazily; the viewer keeps the full file.
 */
const BUBBLE_THUMB = 640;

const msgKey = (m: DayMessage) => `${m.service}|${m.room}|${m.id}`;

/** Space for the bubble's avatar column, so lines under a bubble align with it. */
const Indented: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex gap-3">
        <span aria-hidden="true" className="w-10 shrink-0" />
        <div className="min-w-0">{children}</div>
    </div>
);

/**
 * 那一天 A: every message of the day in time order as the chat's `MessageBubble` in `readOnly`
 * mode (no context menu, long-press or favourite actions; translate and the transcript work
 * through `memberPath`; pictures from 640-px thumbnails, loaded lazily), times on the JST clock, her words through the nickname (or the mask), a
 * picture's paired words under it with `MemoryText` (unless their own message is in the list, so
 * they show once). Pictures and videos open the media viewer
 * over the day's media, whose source link opens her chat at that message. Bubble voices join the
 * Memories voice coordinator (`useBubbleVoices`), so only one voice plays.
 */
export const MergedTimeline: React.FC<MergedTimelineProps> = ({ messages, people, service, scrollParent, focus }) => {
    const { t } = useTranslation();
    const ownNickname = useNickname();
    const nickname = ownNickname ?? maskedNickname(t);
    const avatarWidth = useAvatarWidth(AVATAR_PX);
    const [viewerIndex, setViewerIndex] = useState<number | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    useBubbleVoices(rootRef, 'day');

    const nameOf = (m: DayMessage) => people.get(m.person_key)?.name ?? '';
    const media = useMemo(() => messages.filter(isViewableMedia), [messages]);
    const shown = useMemo(() => shownTexts(messages), [messages]);
    const mediaIndexOf = useMemo(() => new Map(media.map((m, i) => [m, i])), [media]);
    const mediaItems: MediaViewerItem[] = media.map((m) => ({
        src: viewerSrc(m),
        type: m.type as 'picture' | 'video',
        timestamp: m.ts,
        memberName: nameOf(m),
        sourceLabel: t('memories.common.jumpToChat'),
        onSourceJump: () => {
            setViewerIndex(null);
            jumpToChat(m, nameOf(m), 'day');
        },
        messageId: m.id,
        service: m.service,
    }));

    const renderRow = (i: number, m: DayMessage) => {
        const prev = messages[i - 1];
        const runStart = !prev
            || prev.person_key !== m.person_key
            || Date.parse(m.ts) - Date.parse(prev.ts) > RUN_GAP_MS;
        const person = people.get(m.person_key);
        const chat = toChatMessage(m);
        chat.content = m.text ? replaceNickname(m.text, nickname) : null;
        const mediaIndex = mediaIndexOf.get(m) ?? -1;
        const caption = contextCaption(m, shown);
        const focused = Boolean(focus && focus.room === m.room && focus.id === m.id);
        return (
            <div
                data-testid="day-merged-row"
                data-focused={focused ? 'true' : undefined}
                className={cn(focused && 'rounded-md bg-accent-subtle')}
            >
                <MessageBubble
                    message={chat}
                    member_name={person?.name ?? ''}
                    member_avatar={resizedAvatarUrl(m.avatar_url ?? person?.avatarUrl, avatarWidth)}
                    service={m.service}
                    memberPath={m.member_path}
                    userNickname={ownNickname}
                    timeZone={JST_TIME_ZONE}
                    readOnly
                    mediaLoading="lazy"
                    mediaThumbWidth={BUBBLE_THUMB}
                    runStart={runStart}
                    onMediaClick={mediaIndex >= 0 ? () => setViewerIndex(mediaIndex) : undefined}
                />
                {caption && (
                    <Indented>
                        <MemoryText text={caption} className="pt-1 text-body text-primary" />
                    </Indented>
                )}
                {m.service !== service && (
                    <Indented>
                        <span
                            data-testid="day-service-label"
                            className="mt-1 inline-flex items-center gap-1 rounded-pill bg-sunken px-2 text-caption text-secondary"
                        >
                            <span
                                aria-hidden="true"
                                className="h-2 w-2 shrink-0 rounded-pill bg-group-marker"
                                style={groupMarkerStyle(getServicePrimaryColor(m.service))}
                            />
                            <span lang="ja">{getServiceDisplayName(m.service)}</span>
                        </span>
                    </Indented>
                )}
            </div>
        );
    };
    const windowed = Boolean(scrollParent) && messages.length > WINDOW_FROM;
    const focusRoom = focus?.room;
    const focusId = focus?.id;
    useEffect(() => {
        if (focusId === undefined) return;
        const root = rootRef.current;
        const row = root?.querySelector<HTMLElement>('[data-focused="true"]');
        // Only the column's own scroller (`data-focus-scroller`) moves: scrollIntoView would also
        // scroll the dialog body and push the card face out of view. No scroller, no scroll.
        const scroller = root?.closest<HTMLElement>('[data-focus-scroller]');
        if (!row || !scroller) return;
        const r = row.getBoundingClientRect();
        const s = scroller.getBoundingClientRect();
        scroller.scrollTop += r.top - s.top - (scroller.clientHeight - r.height) / 2;
    }, [focusRoom, focusId, messages]);

    return (
        <div ref={rootRef} data-testid="day-merged" className="flex flex-col pb-4">
            {windowed && scrollParent ? (
                <Virtuoso
                    customScrollParent={scrollParent}
                    data={messages}
                    computeItemKey={(_i, m) => msgKey(m)}
                    itemContent={renderRow}
                />
            ) : (
                messages.map((m, i) => <React.Fragment key={msgKey(m)}>{renderRow(i, m)}</React.Fragment>)
            )}
            {viewerIndex !== null && mediaItems[viewerIndex] && (
                <MediaViewerModal
                    mediaItems={mediaItems}
                    currentIndex={viewerIndex}
                    onClose={() => setViewerIndex(null)}
                    onNavigate={setViewerIndex}
                />
            )}
        </div>
    );
};
