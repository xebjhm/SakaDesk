// frontend/src/features/messages/MessagesFeature.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Message, MemberInfo, BackgroundSettings } from '../../types';
import { MemberList } from './components/MemberList';
import { MessageList } from './components/MessageList';
import { ConversationMenu } from './components/ConversationMenu';
import { MemberProfilePopup } from './components/MemberProfilePopup';
import { Menu, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { VirtuosoHandle } from 'react-virtuoso';
import { useAppStore } from '../../store/appStore';
import { formatName, DEFAULT_BACKGROUND, loadBackgroundSettings } from '../../utils';
import { cn } from '../../utils/classnames';
import { useMessagesTheme } from './hooks/useMessagesTheme';
import { useTranslation } from '../../i18n';

// Types specific to messages feature
export interface GroupMessage extends Message {
    member_id?: string;
    member_name?: string;
}

export interface GroupMessagesResponse {
    group_dir: string;
    total_messages: number;
    max_message_id: number;
    members: MemberInfo[];
    messages: GroupMessage[];
}

export interface ReadState {
    lastReadId: number;
    readCount: number;
    revealedIds: number[];
}

export interface SyncProgress {
    state: 'idle' | 'running' | 'error';
    phase?: string;
    phase_name?: string;
    phase_number?: number;
    completed?: number;
    total?: number;
    elapsed_seconds?: number;
    eta_seconds?: number | null;
    speed?: number | null;
    speed_unit?: string;
    detail?: string;
    detail_extra?: string;
}

export interface AppSettings {
    output_dir: string;
    auto_sync_enabled: boolean;
    sync_interval_minutes: number;
    adaptive_sync_enabled?: boolean;
    is_configured: boolean;
    user_nickname?: string;  // Legacy: single nickname (kept for compatibility)
    user_nicknames?: Record<string, string>;  // Per-service nicknames
    notifications_enabled?: boolean;
}

interface MessagesFeatureProps {
    appSettings: AppSettings | null;
    syncProgress: SyncProgress;
    syncVersion: number; // Increments when sync completes - triggers refresh
}

export const MessagesFeature: React.FC<MessagesFeatureProps> = ({
    appSettings,
    syncProgress,
    syncVersion,
}) => {
    const { t } = useTranslation();

    // Get active service and conversation persistence from Zustand store
    const { activeService, setSelectedConversation, getSelectedConversation } = useAppStore();

    // Get theme for current service
    const theme = useMessagesTheme();

    // Chat state
    const [selectedGroupDir, setSelectedGroupDir] = useState<string | undefined>();
    const [selectedName, setSelectedName] = useState<string | undefined>();
    const [isGroupChat, setIsGroupChat] = useState(false);
    const [messages, setMessages] = useState<GroupMessage[]>([]);
    const [membersMap, setMembersMap] = useState<Record<string, MemberInfo>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const messagesPathRef = useRef<string | null>(null); // Track which chat messages belong to

    // Message count tracking
    const [totalMessages, setTotalMessages] = useState(0);

    // Unread state
    const [readState, setReadState] = useState<ReadState>({ lastReadId: 0, readCount: 0, revealedIds: [] });
    const [readStateVersion, setReadStateVersion] = useState(0); // Increments on read state change to trigger sidebar refresh
    const [showRevealConfirm, setShowRevealConfirm] = useState(false);
    const [maxMessageId, setMaxMessageId] = useState(0); // Highest message ID (for reveal all)

    // Background customization state
    const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);

    // Member profile popup state
    const [showMemberProfile, setShowMemberProfile] = useState(false);

    // Compute unread count from messages and readState (single source of truth)
    const displayUnreadCount = useMemo(() => {
        return messages.filter(m => m.id > readState.lastReadId && !readState.revealedIds.includes(m.id)).length;
    }, [messages, readState.lastReadId, readState.revealedIds]);

    // Scroll ref
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const visibleRangeRef = useRef<{ startIndex: number; endIndex: number }>({ startIndex: 0, endIndex: 0 });

    // Nav button state
    const [hasUnreadAbove, setHasUnreadAbove] = useState(false);
    const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

    // Track which service the current messages belong to
    const [messagesService, setMessagesService] = useState<string | null>(null);

    // Track the previous service to save selection before switching
    const previousServiceRef = useRef<string | null>(null);

    // Navigate to conversation from search results (same-service case)
    const conversationNavCounter = useAppStore(s => s.conversationNavCounter);

    useEffect(() => {
        if (conversationNavCounter > 0 && activeService) {
            const saved = getSelectedConversation(activeService);
            if (saved) {
                setSelectedGroupDir(saved.path);
                setSelectedName(saved.name);
                setIsGroupChat(saved.isGroupChat);
                setBackgroundSettings(loadBackgroundSettings(saved.path));
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on counter bump
    }, [conversationNavCounter]);

    // Target message for search navigation — passed to MessageList to override
    // Virtuoso's initialTopMostItemIndex on mount (no post-mount scroll races).
    const targetMessageId = useAppStore(s => s.targetMessageId);
    const setTargetMessageId = useAppStore(s => s.setTargetMessageId);

    // Save current selection and restore previous selection when service changes
    useEffect(() => {
        // Save current conversation for the previous service before switching
        if (previousServiceRef.current && selectedGroupDir && selectedName) {
            setSelectedConversation(previousServiceRef.current, {
                path: selectedGroupDir,
                name: selectedName,
                isGroupChat,
            });
        }

        // Clear current state
        setMessages([]);
        setMembersMap({});
        setError(null);
        setMessagesService(null);

        // Restore previous selection for the new service (if any)
        if (activeService) {
            const savedConversation = getSelectedConversation(activeService);
            if (savedConversation) {
                setSelectedGroupDir(savedConversation.path);
                setSelectedName(savedConversation.name);
                setIsGroupChat(savedConversation.isGroupChat);
                setBackgroundSettings(loadBackgroundSettings(savedConversation.path));
            } else {
                setSelectedGroupDir(undefined);
                setSelectedName(undefined);
                setIsGroupChat(false);
            }
        } else {
            setSelectedGroupDir(undefined);
            setSelectedName(undefined);
            setIsGroupChat(false);
        }

        // Update ref for next switch
        previousServiceRef.current = activeService;
    }, [activeService, getSelectedConversation, setSelectedConversation]);
    // Note: selectedGroupDir, selectedName, isGroupChat intentionally excluded to avoid infinite loops

    // Refresh messages when sync completes
    // DESIGN: Only depends on syncVersion - other dependencies intentionally excluded.
    // This effect uses the closure values at the time syncVersion changes, not the latest values.
    // Adding selectedGroupDir/isGroupChat/readState to deps would cause infinite loops
    // because fetchMessages updates state that these values depend on.
    useEffect(() => {
        if (syncVersion > 0 && selectedGroupDir) {
            fetchMessages(selectedGroupDir, isGroupChat, readState.lastReadId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    }, [syncVersion]);

    // === FETCH MESSAGES (Load All) ===
    const fetchMessages = async (path: string, groupChat: boolean, lastReadId: number = 0) => {
        setLoading(true);
        setError(null);
        try {
            let data;
            // limit=0 means load all messages
            const params = new URLSearchParams({
                limit: '0',
                last_read_id: String(lastReadId),
            });
            // Add service parameter if available
            if (activeService) {
                params.set('service', activeService);
            }

            if (groupChat) {
                const res = await fetch(`/api/content/group_messages/${encodeURIComponent(path)}?${params}`);
                if (!res.ok) {
                    const text = await res.text();
                    try {
                        const errJson = JSON.parse(text);
                        throw new Error(errJson.detail || "Failed to load");
                    } catch {
                        throw new Error(`Failed to load messages. Server returned ${res.status}`);
                    }
                }
                data = await res.json() as GroupMessagesResponse;
                const map: Record<string, MemberInfo> = {};
                for (const m of data.members) map[m.id] = m;
                setMembersMap(map);
                setMessages(data.messages || []);
                setTotalMessages(data.total_messages || 0);
                setMaxMessageId(data.max_message_id || 0);
                setMessagesService(activeService);
                messagesPathRef.current = path;
            } else {
                const res = await fetch(`/api/content/messages_by_path?path=${encodeURIComponent(path)}&${params}`);
                if (!res.ok) throw new Error("Failed to load");
                data = await res.json();
                const memberInfo = data.member as MemberInfo;
                if (memberInfo) setMembersMap({ [memberInfo.id]: memberInfo });
                setMessages(data.messages || []);
                setTotalMessages(data.total_count || 0);
                setMaxMessageId(data.max_message_id || 0);
                setMessagesService(activeService);
                messagesPathRef.current = path;
            }
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            setError(errorMessage);
            setMessages([]);
            setMembersMap({});
        } finally {
            setLoading(false);
        }
    };

    // === CHAT SELECTION ===
    useEffect(() => {
        if (selectedGroupDir) {
            // Load read state first to get lastReadId for API
            const storedReadState = loadReadState(selectedGroupDir);
            setReadState(storedReadState);

            setMessages([]);

            fetchMessages(selectedGroupDir, isGroupChat, storedReadState.lastReadId);
            setIsSidebarOpen(false);
        }
    }, [selectedGroupDir, isGroupChat]);

    // Unread navigation state logic
    const isUnread = useCallback((msgId: number) => {
        return msgId > readState.lastReadId && !readState.revealedIds.includes(msgId);
    }, [readState.lastReadId, readState.revealedIds]);

    const updateUnreadNavState = useCallback((range?: { startIndex: number; endIndex: number }) => {
        const currentRange = range || visibleRangeRef.current;
        if (range) visibleRangeRef.current = range;

        const firstUnreadIndex = messages.findIndex(m => isUnread(m.id));
        let above = false;
        let below = false;

        if (firstUnreadIndex !== -1) {
            if (firstUnreadIndex < currentRange.startIndex) above = true;
            else if (firstUnreadIndex > currentRange.endIndex) below = true;
        }
        setHasUnreadAbove(above);
        setHasUnreadBelow(below);
    }, [messages, isUnread]);

    useEffect(() => {
        updateUnreadNavState();
    }, [updateUnreadNavState]);

    // Keyboard navigation using Virtuoso
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto' });
        } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'auto' });
        }
    }, [messages.length]);

    // === READ STATE ===
    const loadReadState = (path: string): ReadState => {
        try {
            const saved = localStorage.getItem(`read_state_${path}`);
            return saved ? JSON.parse(saved) : { lastReadId: 0, readCount: 0, revealedIds: [] };
        } catch {
            return { lastReadId: 0, readCount: 0, revealedIds: [] };
        }
    };

    const saveReadState = (path: string, state: ReadState) => {
        try {
            localStorage.setItem(`read_state_${path}`, JSON.stringify(state));
            // Increment version to trigger sidebar refresh
            setReadStateVersion(v => v + 1);
        } catch {
            // Ignore localStorage errors
        }
    };

    const revealMessage = useCallback((msgId: number) => {
        setReadState(prev => {
            if (prev.revealedIds.includes(msgId)) return prev;

            // Add the new revealed ID
            const newRevealedIds = [...prev.revealedIds, msgId];

            // Consolidate: If all messages from lastReadId+1 up to some point are now revealed,
            // advance lastReadId and remove those IDs from revealedIds.
            const unreadMsgIds = messages
                .map(m => m.id)
                .filter(id => id > prev.lastReadId)
                .sort((a, b) => a - b);

            let newLastReadId = prev.lastReadId;

            for (const id of unreadMsgIds) {
                if (newRevealedIds.includes(id)) {
                    const allPreviousRead = unreadMsgIds
                        .filter(uid => uid <= id && uid > newLastReadId)
                        .every(uid => newRevealedIds.includes(uid));

                    if (allPreviousRead) {
                        newLastReadId = id;
                    }
                }
            }

            // Remove IDs that are now covered by newLastReadId
            const consolidatedRevealedIds = newRevealedIds.filter(id => id > newLastReadId);

            const next: ReadState = {
                lastReadId: newLastReadId,
                revealedIds: consolidatedRevealedIds,
                readCount: (prev.readCount || 0) + 1
            };

            if (selectedGroupDir) saveReadState(selectedGroupDir, next);
            return next;
        });
    }, [selectedGroupDir, messages]);

    const revealAllMessages = useCallback(() => {
        if (maxMessageId === 0) return;
        const next: ReadState = { lastReadId: maxMessageId, readCount: totalMessages, revealedIds: [] };
        if (selectedGroupDir) saveReadState(selectedGroupDir, next);
        setReadState(next);
    }, [selectedGroupDir, maxMessageId, totalMessages]);

    // === HELPERS ===

    const handleSelectGroup = (groupDir: string, groupChat: boolean, displayName: string) => {
        if (selectedGroupDir !== groupDir) {
            setSelectedGroupDir(groupDir);
            setIsGroupChat(groupChat);
            setSelectedName(displayName);

            // Load background settings for new conversation
            setBackgroundSettings(loadBackgroundSettings(groupDir));

            // Save selection for this service
            if (activeService) {
                setSelectedConversation(activeService, {
                    path: groupDir,
                    name: displayName,
                    isGroupChat: groupChat,
                });
            }
        }
    };

    const getSenderInfo = useCallback((msg: GroupMessage) => {
        const memberInfo = (isGroupChat && msg.member_id) ? membersMap[msg.member_id] : Object.values(membersMap)[0];
        return {
            name: formatName(msg.member_name || memberInfo?.name || selectedName || 'Unknown'),
            avatar: memberInfo?.thumbnail || memberInfo?.portrait || memberInfo?.phone_image
        };
    }, [isGroupChat, membersMap, selectedName]);

    const scrollToFirstUnread = useCallback(() => {
        const index = messages.findIndex(m => m.id > readState.lastReadId && !readState.revealedIds.includes(m.id));
        if (index !== -1) {
            virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
        }
    }, [messages, readState]);

    // Scroll to first message of a given date (for calendar navigation)
    const scrollToDate = useCallback((dateStr: string) => {
        const index = messages.findIndex(m => m.timestamp.startsWith(dateStr));
        if (index !== -1) {
            virtuosoRef.current?.scrollToIndex({ index, align: 'start', behavior: 'smooth' });
        }
    }, [messages]);

    // Toggle favorite status (optimistic update + API call)
    const handleToggleFavorite = useCallback(async (messageId: number, currentState: boolean) => {
        if (!activeService) {
            console.error('No active service for favorite toggle');
            return;
        }

        // Optimistically update UI
        setMessages(msgs => msgs.map(m =>
            m.id === messageId ? { ...m, is_favorite: !currentState } : m
        ));

        try {
            const method = currentState ? 'DELETE' : 'POST';
            const url = `/api/favorites/${messageId}?service=${encodeURIComponent(activeService)}`;
            const res = await fetch(url, { method });
            if (!res.ok) {
                throw new Error('Failed to update favorite');
            }
        } catch (err) {
            // Revert on failure
            setMessages(msgs => msgs.map(m =>
                m.id === messageId ? { ...m, is_favorite: currentState } : m
            ));
            console.error('Failed to toggle favorite:', err);
        }
    }, [activeService]);

    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-30 w-80 transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0 bg-white
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <MemberList
                    onSelectGroup={handleSelectGroup}
                    selectedGroupDir={selectedGroupDir}
                    activeService={activeService || undefined}
                    isSyncing={syncProgress.state === 'running'}
                    readStateVersion={readStateVersion}
                />
            </div>

            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-20 bg-black/50 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full relative min-w-0">
                {/* Header */}
                <header
                    className={cn(
                        "h-16 flex items-center px-4 z-20 shrink-0",
                        theme.messages.headerStyle !== 'light' && "shadow-sm"
                    )}
                    style={{
                        background: theme.messages.headerStyle === 'light'
                            ? '#FFFFFF'
                            : `linear-gradient(to right, ${theme.messages.headerGradient.from}, ${theme.messages.headerGradient.via}, ${theme.messages.headerGradient.to})`,
                    }}
                >
                    <button
                        className="md:hidden mr-3"
                        style={{ color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white' }}
                        onClick={() => setIsSidebarOpen(true)}
                    >
                        <Menu />
                    </button>
                    <div className="flex-1" style={{ color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white' }}>
                        <h2 className="text-lg font-bold">{selectedName || t('messageList.selectConversation')}</h2>
                        {isGroupChat && <span className="text-xs opacity-80">{t('messageList.groupChat')}</span>}
                    </div>
                    {displayUnreadCount > 0 && (
                        <span
                            className="text-xs px-2 py-1 rounded-full"
                            style={{
                                backgroundColor: theme.messages.headerStyle === 'light' ? `${theme.messages.headerTextColor}20` : 'rgba(255,255,255,0.2)',
                                color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'white',
                            }}
                        >
                            {t('messageList.unread', { count: displayUnreadCount })}
                        </span>
                    )}
                    {syncProgress.state === 'running' && (
                        <div
                            className="flex items-center ml-4 text-xs px-3 py-1 rounded-full"
                            style={{
                                backgroundColor: theme.messages.headerStyle === 'light' ? `${theme.messages.headerTextColor}15` : 'rgba(0,0,0,0.2)',
                                color: theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : 'rgba(255,255,255,0.9)',
                            }}
                        >
                            <Loader2 className="w-3 h-3 animate-spin mr-2" />
                            <span>{syncProgress.detail || t('sync.syncing')}</span>
                        </div>
                    )}
                    {selectedGroupDir && (
                        <ConversationMenu
                            conversationPath={selectedGroupDir}
                            isGroupChat={isGroupChat}
                            messages={messages}
                            memberName={selectedName || ''}
                            memberAvatar={Object.values(membersMap)[0]?.thumbnail || Object.values(membersMap)[0]?.portrait}
                            groupId={selectedGroupDir.split('/')[2]?.split(' ')[0]}
                            activeService={activeService || undefined}
                            onSelectDate={scrollToDate}
                            onBackgroundChange={setBackgroundSettings}
                            iconColor={theme.messages.headerStyle === 'light' ? theme.messages.headerTextColor : undefined}
                        />
                    )}
                </header>

                {/* Gradient Bar below header (only for light style) */}
                {theme.messages.headerStyle === 'light' && (
                    <div
                        className="h-1 shrink-0"
                        style={{ background: theme.messages.headerBarGradient }}
                    />
                )}

                {/* Virtualized Timeline */}
                <div
                    className="flex-1 overflow-hidden relative"
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    style={{
                        backgroundColor: backgroundSettings.type === 'color' ? backgroundSettings.color : DEFAULT_BACKGROUND.color,
                        backgroundImage: backgroundSettings.type === 'image' && backgroundSettings.imageData
                            ? `url(${backgroundSettings.imageData})`
                            : 'none',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        opacity: backgroundSettings.opacity / 100,
                    }}
                >
                    {!selectedGroupDir && (
                        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
                            <div className="text-center">
                                <p className="text-lg mb-2">{t('messageList.welcomeTitle')}</p>
                                <p className="text-sm">{t('messageList.welcomeSubtitle')}</p>
                            </div>
                        </div>
                    )}

                    {loading && messages.length === 0 && (
                        <div className="p-10 text-center text-gray-500">{t('messageList.loadingMessages')}</div>
                    )}
                    {error && (
                        <div className="p-10 text-center text-red-500">Error: {error}</div>
                    )}

                    {selectedGroupDir && messages.length > 0 && messagesService && (
                        <MessageList
                            memberId={selectedGroupDir}
                            messages={messages}
                            getSenderInfo={getSenderInfo}
                            isUnread={isUnread}
                            onReveal={revealMessage}
                            onLongPress={() => setShowRevealConfirm(true)}
                            onRangeChanged={updateUnreadNavState}
                            virtuosoRef={virtuosoRef}
                            userNickname={
                                // Use per-service nickname for the service of the messages being displayed
                                messagesService && appSettings?.user_nicknames?.[messagesService]
                                    ? appSettings.user_nicknames[messagesService]
                                    : appSettings?.user_nickname
                            }
                            onToggleFavorite={handleToggleFavorite}
                            onAvatarClick={() => setShowMemberProfile(true)}
                            service={messagesService}
                            targetMessageId={targetMessageId}
                            onTargetMessageConsumed={() => setTargetMessageId(null)}
                        />
                    )}
                </div>

                {/* Navigation Buttons */}
                {/* Up arrow: bottom-right, shows when oldest unread is ABOVE center */}
                {selectedGroupDir && hasUnreadAbove && (
                    <div className="absolute right-4 bottom-4 z-20">
                        <button
                            onClick={scrollToFirstUnread}
                            className="w-10 h-10 rounded-full shadow-lg flex items-center justify-center text-white transition-all"
                            style={{ backgroundColor: theme.modals.accentColor }}
                            title={t('messageList.jumpToOldestUnread')}
                        >
                            <ChevronUp className="w-5 h-5" />
                        </button>
                    </div>
                )}
                {/* Down arrow: top-right (below header), shows when oldest unread is BELOW center */}
                {selectedGroupDir && hasUnreadBelow && (
                    <div className="absolute right-4 top-20 z-20">
                        <button
                            onClick={scrollToFirstUnread}
                            className="w-10 h-10 rounded-full shadow-lg flex items-center justify-center text-white transition-all"
                            style={{ backgroundColor: theme.modals.accentColor }}
                            title={t('messageList.jumpToOldestUnread')}
                        >
                            <ChevronDown className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {/* Reveal All Confirmation Modal */}
                {showRevealConfirm && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl">
                            <h3 className="text-lg font-bold text-gray-900 mb-2">{t('messageList.revealAllTitle')}</h3>
                            <p className="text-gray-600 mb-6">
                                {t('messageList.revealAllDescription', { count: displayUnreadCount })}
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setShowRevealConfirm(false)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    onClick={() => {
                                        revealAllMessages();
                                        setShowRevealConfirm(false);
                                    }}
                                    className="px-4 py-2 text-white rounded-lg font-medium"
                                    style={{ backgroundColor: theme.modals.accentColor }}
                                >
                                    {t('messageList.confirm')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Member Profile Popup */}
            <MemberProfilePopup
                isOpen={showMemberProfile}
                onClose={() => setShowMemberProfile(false)}
                memberName={selectedName || ''}
                memberAvatar={Object.values(membersMap)[0]?.thumbnail || Object.values(membersMap)[0]?.portrait}
                groupId={selectedGroupDir?.split('/')[2]?.split(' ')[0]}
                activeService={activeService || undefined}
            />
        </div>
    );
};
