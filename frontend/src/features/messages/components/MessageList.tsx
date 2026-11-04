import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type GroupedVirtuosoProps, type ListRange, type TopItemListProps } from 'react-virtuoso';
import type { Message } from '../../../types';
import { useChatScroll } from '../hooks/useChatScroll';
import { useMessagesTheme } from '../hooks/useMessagesTheme';
import { MessageBubble } from './MessageBubble';
import { notifyVisibleMessages } from '../hooks/useMessageVisibility';
import { cn } from '../../../utils/classnames';
import { useTranslation } from '../../../i18n';
import { DatePill } from '../../../design/primitives';
import { fromLocalDateStr } from '../../../utils/dateFormatters';
import { rowKeyOf, type RowKey, type Timeline, type TimelineItem } from '../timeline/buildTimeline';
import { topVisibleRowIndex } from '../timeline/landing';
import type { Letter } from '../letters';

/**
 * Avatar click handler for a message. Member 0 is the room itself (messages
 * the API returns without an author), which has no profile card to open.
 * The group endpoint serialises member_id as a string (from the folder name),
 * so both 0 and "0" are treated as the room.
 */
export const avatarClickFor = (msg: Message, onAvatarClick?: () => void) =>
    String(msg.member_id) === '0' ? undefined : onAvatarClick;

interface ChatListProps {
    /** Unique identifier for the current room/member */
    memberId: string;
    /** The room's timeline (nickname already applied, letters merged): the only index source */
    timeline: Timeline;
    /** Function to get sender info for a message */
    getSenderInfo: (msg: Message) => { name: string; avatar?: string };
    /** Function to check if a message is unread */
    isUnread: (msgId: number) => boolean;
    /** Callback when a message is revealed */
    onReveal: (msgId: number) => void;
    /** Callback for long-press on unread message */
    onLongPress: () => void;
    /** Callback when the rendered item range changes (for unread navigation) */
    onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
    /** Ref to expose the list handle for external scroll control */
    virtuosoRef?: React.RefObject<GroupedVirtuosoHandle>;
    /** Receives Virtuoso's scroll element (the timeline jump glides it) */
    scrollerRef?: (el: HTMLElement | Window | null) => void;
    /** User's nickname (for translations of %%% messages) */
    userNickname?: string;
    /** Callback to toggle favorite status of a message */
    onToggleFavorite?: (messageId: number, currentState: boolean) => void;
    /** Callback when avatar is clicked (for member profile popup) */
    onAvatarClick?: () => void;
    /** Active service ID for media URL construction */
    service?: string;
    /** Target message ID to jump to (from search navigation) */
    targetMessageId?: number | null;
    /** Callback to clear targetMessageId after it's consumed */
    onTargetMessageConsumed?: () => void;
    /** Jump to a message through the shared timeline jump (same-room and fresh-mount targets) */
    onJumpToMessage?: (id: number) => void;
    /** Row to flash after a jump landed on it */
    highlightedRowKey?: RowKey | null;
    /** Callback when a media item is clicked (for media viewer modal) */
    onMediaClick?: (mediaUrl: string, type: string, timestamp?: string) => void;
    /** Function to resolve the member directory path for a message (for transcription) */
    getMemberPath?: (msg: Message) => string | undefined;
    /** Renders the content of a sent-letter row */
    renderLetter?: (letter: Letter) => React.ReactNode;
    /** Opens the date-search calendar (clicking a date pill) */
    onOpenCalendar?: () => void;
}

/** Sticky day header of the timeline: a DatePill that opens the calendar. */
const TimelineDateHeader: React.FC<{ date: string; onOpenCalendar?: () => void }> = ({ date, onOpenCalendar }) => {
    const { t } = useTranslation();
    const day = fromLocalDateStr(date);
    // A message without a valid timestamp lands in an undated group: keep a 1 px header.
    if (!day) return <div className="h-px" />;
    return <DatePill date={day} onClick={onOpenCalendar} actionLabel={t('messageList.openCalendar')} />;
};

/**
 * The sticky band GroupedVirtuoso keeps the current day's header in: full width over the rows,
 * transparent around the pill. Click-through, so rows behind it (media, the reveal shelter, the
 * favourite star) stay clickable; the pill sets pointer-events back to auto.
 */
const StickyHeaderBand: React.FC<TopItemListProps> = ({ style, children }) => (
    <div style={style} className="pointer-events-none">{children}</div>
);

const LIST_COMPONENTS: GroupedVirtuosoProps<unknown, unknown>['components'] = { TopItemList: StickyHeaderBand };

const DEFAULT_ITEM_HEIGHT = 80;

export const MessageList: React.FC<ChatListProps> = ({
    memberId,
    timeline,
    getSenderInfo,
    isUnread,
    onReveal,
    onLongPress,
    onRangeChanged,
    virtuosoRef: externalRef,
    scrollerRef,
    userNickname,
    onToggleFavorite,
    onAvatarClick,
    service,
    targetMessageId,
    onTargetMessageConsumed,
    onJumpToMessage,
    highlightedRowKey,
    onMediaClick,
    getMemberPath,
    renderLetter,
    onOpenCalendar,
}) => {
    const { t } = useTranslation();
    const virtuosoKey = `virtuoso-${memberId}`;
    const internalRef = useRef<GroupedVirtuosoHandle>(null);
    const virtuosoRef = externalRef || internalRef;
    const scrollerElRef = useRef<HTMLElement | null>(null);
    const setScroller = useCallback((el: HTMLElement | Window | null) => {
        scrollerElRef.current = el instanceof HTMLElement ? el : null;
        scrollerRef?.(el);
    }, [scrollerRef]);

    // Get theme colors for message bubbles
    const theme = useMessagesTheme();
    const bubbleTheme = useMemo(() => ({
        bubbleBorder: theme.bubbleBorder,
        voicePlayerAccent: theme.voicePlayerAccent,
        favoriteColor: theme.favoriteColor,
        linkColor: theme.linkColor,
        shelterColors: theme.shelterColors,
        shelterStyle: theme.shelterStyle,
    }), [theme.bubbleBorder, theme.voicePlayerAccent, theme.favoriteColor, theme.linkColor, theme.shelterColors, theme.shelterStyle]);

    // The first row the user can see; rows hidden behind a sticky date header do not count.
    const topVisibleIndex = useCallback((range: ListRange) =>
        topVisibleRowIndex(scrollerElRef.current, range, (i) => timeline.rowKeyAt(i)), [timeline]);

    const {
        initialTopMostItemIndex: savedScrollIndex,
        handleRangeChanged,
    } = useChatScroll(memberId, timeline, topVisibleIndex);

    // Search navigation: the target's index seeds initialTopMostItemIndex on a fresh mount.
    const targetIndex = useMemo(() => {
        if (targetMessageId == null) return undefined;
        const idx = timeline.indexOfMessage(targetMessageId);
        return idx !== -1 ? idx : undefined;
    }, [targetMessageId, timeline]);

    // Fresh mounts already start at the target (initialTopMostItemIndex) and same-room
    // targets arrive on a mounted list; both call onJumpToMessage, the shared jump that
    // scrolls, verifies the landing and highlights it.
    useEffect(() => {
        if (targetIndex == null || targetMessageId == null) return;
        onJumpToMessage?.(targetMessageId);
        onTargetMessageConsumed?.();
    }, [targetIndex, targetMessageId, onJumpToMessage, onTargetMessageConsumed]);

    const initialTopMostItemIndex = targetIndex ?? savedScrollIndex;

    // Range change: restore position, unread navigation and the panel auto-collapse registry
    // (message rows only; letters have no panels).
    const onRangeChange = useCallback((range: ListRange) => {
        handleRangeChanged(range);
        onRangeChanged?.(range);
        const visibleIds = new Set<number>();
        for (let i = range.startIndex; i <= range.endIndex && i < timeline.items.length; i++) {
            const item = timeline.items[i];
            if (item.kind === 'message') visibleIds.add(item.message.id);
        }
        notifyVisibleMessages(visibleIds);
    }, [handleRangeChanged, onRangeChanged, timeline]);

    const renderItem = (item: TimelineItem) => {
        const rowKey = rowKeyOf(item);
        const rowClass = cn('px-4 py-1 rounded-card', highlightedRowKey === rowKey && 'animate-landing');
        if (item.kind === 'letter') {
            return <div className={rowClass} id={rowKey}>{renderLetter?.(item.letter)}</div>;
        }
        const msg = item.message;
        const senderInfo = getSenderInfo(msg);
        return (
            <div className={rowClass} id={rowKey}>
                <MessageBubble
                    message={msg}
                    member_name={senderInfo.name}
                    member_avatar={senderInfo.avatar}
                    isUnread={isUnread(msg.id)}
                    onReveal={() => onReveal(msg.id)}
                    onLongPress={onLongPress}
                    onToggleFavorite={onToggleFavorite}
                    onAvatarClick={avatarClickFor(msg, onAvatarClick)}
                    onMediaClick={onMediaClick}
                    theme={bubbleTheme}
                    service={service}
                    memberPath={getMemberPath?.(msg)}
                    userNickname={userNickname}
                />
            </div>
        );
    };

    if (timeline.items.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-muted">
                <p>{t('messageList.noMessages')}</p>
            </div>
        );
    }

    // One group per local day; GroupedVirtuoso keeps the current day's header stuck on top and
    // lets the next one push it away. Indices passed around are item indices (probe fact 3).
    return (
        <GroupedVirtuoso
            key={virtuosoKey}
            ref={virtuosoRef}
            scrollerRef={setScroller}
            style={{ height: '100%' }}
            groupCounts={timeline.groupCounts}
            components={LIST_COMPONENTS}
            groupContent={(groupIndex) => (
                <TimelineDateHeader date={timeline.groupDates[groupIndex]} onOpenCalendar={onOpenCalendar} />
            )}
            initialTopMostItemIndex={initialTopMostItemIndex}
            defaultItemHeight={DEFAULT_ITEM_HEIGHT}
            followOutput={(isAtBottom: boolean) => isAtBottom ? 'smooth' : false}
            rangeChanged={onRangeChange}
            itemContent={(index) => renderItem(timeline.items[index])}
        />
    );
};
