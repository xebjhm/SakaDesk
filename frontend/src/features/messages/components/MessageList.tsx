import React, { useRef, useCallback, useMemo } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import type { Message } from '../../../types';
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
    /** User's nickname for %%% placeholder replacement */
    userNickname?: string;
    /** Callback to toggle favorite status of a message */
    onToggleFavorite?: (messageId: number, currentState: boolean) => void;
    /** Callback when avatar is clicked (for member profile popup) */
    onAvatarClick?: () => void;
}

const DEFAULT_ITEM_HEIGHT = 80;

export const MessageList: React.FC<ChatListProps> = ({
    memberId,
    messages,
    getSenderInfo,
    isUnread,
    onReveal,
    onLongPress,
    onRangeChanged,
    virtuosoRef: externalRef,
    userNickname,
    onToggleFavorite,
    onAvatarClick,
}) => {
    const virtuosoKey = `virtuoso-${memberId}`;
    const internalRef = useRef<VirtuosoHandle>(null);
    const virtuosoRef = externalRef || internalRef;

    // Pre-process messages: replace %%% with nickname at data level
    // This ensures Virtuoso sees different data when nickname changes
    const processedMessages = useMemo(() => {
        if (!userNickname) return messages;
        // Match both ASCII %%% (U+0025) and fullwidth ％％％ (U+FF05)
        const placeholderRegex = /%%%|％％％/g;
        return messages.map(msg => {
            if (msg.content && placeholderRegex.test(msg.content)) {
                // Reset lastIndex since we're reusing the regex
                placeholderRegex.lastIndex = 0;
                return {
                    ...msg,
                    content: msg.content.replace(placeholderRegex, userNickname)
                };
            }
            return msg;
        });
    }, [messages, userNickname]);

    const {
        initialTopMostItemIndex,
        handleRangeChanged,
    } = useChatScroll(memberId, processedMessages);

    // Combined range change handler
    const onRangeChange = useCallback((range: { startIndex: number; endIndex: number }) => {
        handleRangeChanged(range);
        onRangeChanged?.(range);
    }, [handleRangeChanged, onRangeChanged]);

    if (!processedMessages || processedMessages.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>No messages</p>
            </div>
        );
    }

    return (
        <Virtuoso
            key={virtuosoKey}
            ref={virtuosoRef}
            style={{ height: '100%' }}
            data={processedMessages}
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
                            onToggleFavorite={onToggleFavorite}
                            onAvatarClick={onAvatarClick}
                        />
                    </div>
                );
            }}
        />
    );
};
