import React, { useRef, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../types';
import { useChatScroll } from '../hooks/useChatScroll';
import { MessageBubble } from './MessageBubble';

interface ChatListProps {
    /** Unique identifier for the current room/member */
    memberId: string;
    /** Full array of messages to display (Load All strategy) */
    messages: Message[];
    /** Function to get sender info for a message */
    getSenderInfo: (msg: Message) => { name: string; avatar?: string };
    /** Function to check if a message is unread */
    isUnread: (msgId: number) => boolean;
    /** Callback when a message is revealed */
    onReveal: (msgId: number) => void;
    /** Callback for long-press on unread message */
    onLongPress: () => void;
    /** Callback when visible range changes (for unread navigation) */
    onRangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
    /** Ref to expose Virtuoso handle for external scroll control */
    virtuosoRef?: React.RefObject<VirtuosoHandle>;
}

const DEFAULT_ITEM_HEIGHT = 80;

export const ChatList: React.FC<ChatListProps> = ({
    memberId,
    messages,
    getSenderInfo,
    isUnread,
    onReveal,
    onLongPress,
    onRangeChanged,
    virtuosoRef: externalRef,
}) => {
    const internalRef = useRef<VirtuosoHandle>(null);
    const virtuosoRef = externalRef || internalRef;

    const {
        initialTopMostItemIndex,
        handleRangeChanged,
    } = useChatScroll(memberId, messages);

    // Combined range change handler
    const onRangeChange = useCallback((range: { startIndex: number; endIndex: number }) => {
        handleRangeChanged(range);
        onRangeChanged?.(range);
    }, [handleRangeChanged, onRangeChanged]);

    if (!messages || messages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>No messages</p>
            </div>
        );
    }

    return (
        <Virtuoso
            key={`virtuoso-${memberId}`}
            ref={virtuosoRef}
            style={{ height: '100%' }}
            data={messages}
            initialTopMostItemIndex={initialTopMostItemIndex}
            defaultItemHeight={DEFAULT_ITEM_HEIGHT}
            followOutput={(isAtBottom: boolean) => isAtBottom ? 'smooth' : false}
            rangeChanged={onRangeChange}
            itemContent={(_index, msg) => {
                const senderInfo = getSenderInfo(msg);
                const isMsgUnread = isUnread(msg.id);

                return (
                    <div className="px-4 py-1" id={`msg-${msg.id}`}>
                        <MessageBubble
                            message={msg}
                            member_name={senderInfo.name}
                            member_avatar={senderInfo.avatar}
                            isUnread={isMsgUnread}
                            onReveal={() => onReveal(msg.id)}
                            onLongPress={onLongPress}
                        />
                    </div>
                );
            }}
        />
    );
};
