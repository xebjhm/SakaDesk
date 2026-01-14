// frontend/src/components/features/MessagesFeature.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Message, MemberInfo } from '../../types';
import { Sidebar } from '../Sidebar';
import { ChatList } from '../ChatList';
import { ChatHeaderMenu, BackgroundSettings } from '../ChatHeaderMenu';
import { MemberProfilePopup } from '../MemberProfilePopup';
import { Menu, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { VirtuosoHandle } from 'react-virtuoso';
import { useAppStore } from '../../stores/appStore';

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
    user_nickname?: string;
    notifications_enabled?: boolean;
}

interface MessagesFeatureProps {
    appSettings: AppSettings | null;
    syncProgress: SyncProgress;
    syncVersion: number; // Increments when sync completes - triggers refresh
    onOpenSettings: () => void;
    onReportIssue: () => void;
    onOpenAbout: () => void;
}

export const MessagesFeature: React.FC<MessagesFeatureProps> = ({
    appSettings,
    syncProgress,
    syncVersion,
    onOpenSettings,
    onReportIssue,
    onOpenAbout,
}) => {
    // Get active service from Zustand store
    const { activeService } = useAppStore();

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
    const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>({
        type: 'default',
        color: '#E2E6EB',
        opacity: 100
    });

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

    // Reset selection when service changes
    useEffect(() => {
        setSelectedGroupDir(undefined);
        setSelectedName(undefined);
        setMessages([]);
        setMembersMap({});
        setError(null);
    }, [activeService]);

    // Refresh messages when sync completes
    // Only depends on syncVersion - we capture the current values at time of sync completion
    // This intentionally uses stale closure values to avoid infinite loops
    useEffect(() => {
        if (syncVersion > 0 && selectedGroupDir) {
            // Use the current state values at the time syncVersion changes
            fetchMessages(selectedGroupDir, isGroupChat, readState.lastReadId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const formatName = (name: string) => name.replace(/_/g, ' ');

    const handleSelectGroup = (groupDir: string, groupChat: boolean, displayName: string) => {
        if (selectedGroupDir !== groupDir) {
            setSelectedGroupDir(groupDir);
            setIsGroupChat(groupChat);
            setSelectedName(displayName);

            // Load background settings for new conversation
            const key = `bg_settings_${groupDir}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                try {
                    setBackgroundSettings(JSON.parse(saved));
                } catch {
                    setBackgroundSettings({ type: 'default', color: '#E2E6EB', opacity: 100 });
                }
            } else {
                setBackgroundSettings({ type: 'default', color: '#E2E6EB', opacity: 100 });
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
        // Optimistically update UI
        setMessages(msgs => msgs.map(m =>
            m.id === messageId ? { ...m, is_favorite: !currentState } : m
        ));

        try {
            const method = currentState ? 'DELETE' : 'POST';
            const res = await fetch(`/api/favorites/${messageId}`, { method });
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
    }, []);

    return (
        <div className="flex h-full overflow-hidden">
            {/* Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-30 w-80 transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0 bg-white
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <Sidebar
                    onSelectGroup={handleSelectGroup}
                    selectedGroupDir={selectedGroupDir}
                    activeService={activeService || undefined}
                    isSyncing={syncProgress.state === 'running'}
                    onOpenSettings={onOpenSettings}
                    onReportIssue={onReportIssue}
                    onOpenAbout={onOpenAbout}
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
            <div className="flex-1 flex flex-col h-full relative w-full">
                {/* Header */}
                <header className="h-16 bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] flex items-center px-4 shadow-sm z-10 shrink-0">
                    <button
                        className="md:hidden mr-3 text-white"
                        onClick={() => setIsSidebarOpen(true)}
                    >
                        <Menu />
                    </button>
                    <div className="text-white flex-1">
                        <h2 className="text-lg font-bold">{selectedName || "Select a Conversation"}</h2>
                        {isGroupChat && <span className="text-xs opacity-80">Group Chat</span>}
                    </div>
                    {displayUnreadCount > 0 && (
                        <span className="bg-white/20 text-white text-xs px-2 py-1 rounded-full">
                            {displayUnreadCount} unread
                        </span>
                    )}
                    {syncProgress.state === 'running' && (
                        <div className="flex items-center ml-4 text-xs text-white/90 bg-black/20 px-3 py-1 rounded-full">
                            <Loader2 className="w-3 h-3 animate-spin mr-2" />
                            <span>{syncProgress.detail || "Syncing..."}</span>
                        </div>
                    )}
                    {selectedGroupDir && (
                        <ChatHeaderMenu
                            conversationPath={selectedGroupDir}
                            isGroupChat={isGroupChat}
                            messages={messages}
                            memberName={selectedName || ''}
                            memberAvatar={Object.values(membersMap)[0]?.thumbnail || Object.values(membersMap)[0]?.portrait}
                            groupId={selectedGroupDir.split('/')[2]?.split(' ')[0]}
                            onSelectDate={scrollToDate}
                            onBackgroundChange={setBackgroundSettings}
                        />
                    )}
                </header>

                {/* Virtualized Timeline */}
                <div
                    className="flex-1 overflow-hidden relative"
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    style={{
                        backgroundColor: backgroundSettings.type === 'color' ? backgroundSettings.color : '#E2E6EB',
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
                                <p className="text-lg mb-2">Welcome to HakoDesk</p>
                                <p className="text-sm">Select a conversation from the sidebar to start.</p>
                            </div>
                        </div>
                    )}

                    {loading && messages.length === 0 && (
                        <div className="p-10 text-center text-gray-500">Loading messages...</div>
                    )}
                    {error && (
                        <div className="p-10 text-center text-red-500">Error: {error}</div>
                    )}

                    {selectedGroupDir && messages.length > 0 && (
                        <ChatList
                            memberId={selectedGroupDir}
                            messages={messages}
                            getSenderInfo={getSenderInfo}
                            isUnread={isUnread}
                            onReveal={revealMessage}
                            onLongPress={() => setShowRevealConfirm(true)}
                            onRangeChanged={updateUnreadNavState}
                            virtuosoRef={virtuosoRef}
                            userNickname={appSettings?.user_nickname}
                            onToggleFavorite={handleToggleFavorite}
                            onAvatarClick={() => setShowMemberProfile(true)}
                        />
                    )}
                </div>

                {/* Navigation Buttons */}
                {/* Up arrow: bottom-right, shows when oldest unread is ABOVE center */}
                {selectedGroupDir && hasUnreadAbove && (
                    <div className="absolute right-4 bottom-4 z-20">
                        <button
                            onClick={scrollToFirstUnread}
                            className="w-10 h-10 rounded-full bg-blue-500 shadow-lg flex items-center justify-center text-white hover:bg-blue-600 transition-all"
                            title="Jump to oldest unread"
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
                            className="w-10 h-10 rounded-full bg-blue-500 shadow-lg flex items-center justify-center text-white hover:bg-blue-600 transition-all"
                            title="Jump to oldest unread"
                        >
                            <ChevronDown className="w-5 h-5" />
                        </button>
                    </div>
                )}

                {/* Reveal All Confirmation Modal */}
                {showRevealConfirm && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl">
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Reveal All Messages?</h3>
                            <p className="text-gray-600 mb-6">
                                This will mark all {displayUnreadCount} unread messages as revealed.
                            </p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setShowRevealConfirm(false)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={() => {
                                        revealAllMessages();
                                        setShowRevealConfirm(false);
                                    }}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
                                >
                                    Confirm
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
            />
        </div>
    );
};
