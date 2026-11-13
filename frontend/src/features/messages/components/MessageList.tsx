import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle, type GroupedVirtuosoProps, type ListRange, type TopItemListProps } from 'react-virtuoso';
import type { Message } from '../../../types';
import { useChatScroll } from '../hooks/useChatScroll';
import { KeepListPainted } from './listSnapshot';
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
    /** Shown after the newest message (the milestone card, spec §9). */
    footer?: React.ReactNode;
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
    /** The rows the user sees (none hidden behind the sticky date header), one frame after each range change */
    onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
    /** Ref to expose the list handle for external scroll control */
    virtuosoRef?: React.RefObject<GroupedVirtuosoHandle>;
    /** Receives Virtuoso's scroll element (the timeline jump glides it) */
    scrollerRef?: (el: HTMLElement | Window | null) => void;
    /** User's nickname (for translations of %%% messages) */
    userNickname?: string;
    /** Callback to toggle favorite status of a message */
    onToggleFavorite?: (messageId: number, currentState: boolean) => void;
    /** ★ changes of the open room not yet in `timeline` (MessagesFeature's favoriteOverrides). */
    favoriteOverrides?: ReadonlyMap<number, boolean>;
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
 * Rows are `isolate`d (renderItem), so a row's own z-index (the unread shelter) stays inside the row
 * and can never paint over this band.
 */
const StickyHeaderBand: React.FC<TopItemListProps> = ({ style, children }) => (
    <div style={style} className="pointer-events-none">{children}</div>
);

/** What the list shows after the newest message (a milestone card); read by Virtuoso's Footer slot. */
const TimelineFooterContext = React.createContext<React.ReactNode>(null);

const TimelineFooter: React.FC = () => {
    const node = React.useContext(TimelineFooterContext);
    return node ? <>{node}</> : null;
};

const LIST_COMPONENTS: GroupedVirtuosoProps<unknown, unknown>['components'] = { TopItemList: StickyHeaderBand, Footer: TimelineFooter };

const DEFAULT_ITEM_HEIGHT = 80;

const MessageListComponent: React.FC<ChatListProps> = ({
    footer,
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
    favoriteOverrides,
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

    // What the user sees: Virtuoso's range minus rows hidden behind the sticky date header. Like
    // the scroll save, it is resolved one frame after rangeChanged (so the DOM matches the range),
    // once per frame, and only for the room that reported it.
    const latest = useRef({ memberId, timeline, onRangeChanged, topVisibleIndex });
    latest.current = { memberId, timeline, onRangeChanged, topVisibleIndex };
    const pendingRangeRef = useRef<{ range: ListRange; memberId: string } | null>(null);
    const frameRef = useRef<number | null>(null);
    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    /** Unread navigation and the panel auto-collapse registry (message rows only; letters have no panels). */
    const resolveVisibleRange = useCallback(() => {
        frameRef.current = null;
        const pending = pendingRangeRef.current;
        pendingRangeRef.current = null;
        const { memberId: room, timeline: current, onRangeChanged: report, topVisibleIndex: topOf } = latest.current;
        if (!pending || pending.memberId !== room) return;
        const visible = { startIndex: topOf(pending.range), endIndex: pending.range.endIndex };
        report?.(visible);
        const visibleIds = new Set<number>();
        for (let i = visible.startIndex; i <= visible.endIndex && i < current.items.length; i++) {
            const item = current.items[i];
            if (item.kind === 'message') visibleIds.add(item.message.id);
        }
        notifyVisibleMessages(visibleIds);
    }, []);

    // Range change: restore position (resolved inside useChatScroll), then what the user sees.
    const onRangeChange = useCallback((range: ListRange) => {
        handleRangeChanged(range);
        pendingRangeRef.current = { range, memberId: latest.current.memberId };
        if (frameRef.current === null) frameRef.current = requestAnimationFrame(resolveVisibleRange);
    }, [handleRangeChanged, resolveVisibleRange]);

    // One stable reveal callback per message id, calling the latest `onReveal`: an inline
    // `() => onReveal(msg.id)` was a new prop on every render and re-rendered every bubble.
    const onRevealRef = useRef(onReveal);
    useEffect(() => { onRevealRef.current = onReveal; }, [onReveal]);
    const revealCallbacks = useRef(new Map<number, () => void>());
    // The list is not remounted on a room switch: drop the old room's callbacks (cleared during
    // render so the new room's bubbles get callbacks that stay in the map).
    const revealRoomRef = useRef(memberId);
    if (revealRoomRef.current !== memberId) {
        revealRoomRef.current = memberId;
        revealCallbacks.current.clear();
    }
    const revealFor = (id: number) => {
        let fn = revealCallbacks.current.get(id);
        if (!fn) {
            fn = () => onRevealRef.current(id);
            revealCallbacks.current.set(id, fn);
        }
        return fn;
    };

    const renderItem = (item: TimelineItem) => {
        const rowKey = rowKeyOf(item);
        const rowClass = cn('isolate rounded-card px-4 pb-1', highlightedRowKey === rowKey && 'animate-landing');
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
                    onReveal={revealFor(msg.id)}
                    onLongPress={onLongPress}
                    onToggleFavorite={onToggleFavorite}
                    isFavorite={favoriteOverrides?.get(msg.id) ?? msg.is_favorite}
                    onAvatarClick={avatarClickFor(msg, onAvatarClick)}
                    onMediaClick={onMediaClick}
                    service={service}
                    memberPath={getMemberPath?.(msg)}
                    userNickname={userNickname}
                    runStart={item.runStart}
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
        <TimelineFooterContext.Provider value={footer ?? null}>
            {/* A revisited room shows its last painted list while Virtuoso positions the new one. */}
            <KeepListPainted roomKey={virtuosoKey} restore={targetMessageId == null}>
            <GroupedVirtuoso
                key={virtuosoKey}
                ref={virtuosoRef}
                scrollerRef={setScroller}
                className="sd-sheet-scroll"
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
            </KeepListPainted>
        </TimelineFooterContext.Provider>
    );
};

/** Memoised: MessagesFeature re-renders for state the list does not show (dialogs, the header). */
export const MessageList = React.memo(MessageListComponent);
