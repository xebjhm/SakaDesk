import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { Settings, Users, RefreshCw } from 'lucide-react';
import { Group } from '../types';

// Use Group interface from types
type GroupInfo = Group;

interface GroupSidebarProps {
    onSelectGroup: (groupDir: string, isGroupChat: boolean, displayName: string) => void;
    selectedGroupDir?: string;
    isSyncing?: boolean;
    onOpenSettings?: () => void;
    onOpenDiagnostics?: () => void;
    activeService?: string;
}

// Group IDs that should always be treated as group chat
const GROUP_CHAT_IDS = ['43']; // 日向坂46

export const GroupSidebar: React.FC<GroupSidebarProps> = ({ onSelectGroup, selectedGroupDir, isSyncing, onOpenSettings, onOpenDiagnostics, activeService }) => {
    const [groups, setGroups] = useState<GroupInfo[]>([]);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [showSettings, setShowSettings] = useState(false);
    const [loading, setLoading] = useState(true);

    const handleResetRead = () => {
        if (confirm('Reset all read status? This will mark all messages as unread locally.')) {
            Object.keys(localStorage).forEach(key => {
                if (key.startsWith('read_state_')) localStorage.removeItem(key);
            });
            window.location.reload();
        }
        setShowSettings(false);
    };

    const loadGroups = () => {
        fetch('/api/content/groups')
            .then(res => res.json())
            .then(data => {
                setGroups(data);
                checkUnread(data);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    const checkUnread = (groupList: GroupInfo[]) => {
        const counts: Record<string, number> = {};
        groupList.forEach(g => {
            if (!g.last_message_id) return;
            try {
                // Determine path for Key
                const info = getGroupDisplayInfo(g);
                const key = `read_state_${info.path}`;
                const saved = localStorage.getItem(key);

                if (saved) {
                    const state = JSON.parse(saved);
                    // Compare IDs to see if any unread
                    if (g.last_message_id > (state.lastReadId || 0)) {
                        // Estimate count: total - readCount
                        // If readCount is missing (legacy), simple > check
                        const readCount = state.readCount || 0;
                        const total = g.total_messages || 0;
                        const unread = Math.max(0, total - readCount);
                        // If unread is 0 but ID is newer? (Shouldn't happen if counts are accurate)
                        // Fallback to 1 if we know it's unread but calculation says 0
                        counts[g.id] = unread > 0 ? unread : 1;
                    }
                } else {
                    // New user / no state: All unread
                    counts[g.id] = g.total_messages || 1;
                }
            } catch { }
        });
        setUnreadCounts(counts);
    };

    useEffect(() => {
        loadGroups();
        const interval = setInterval(loadGroups, 2000); // Faster update for UI responsiveness
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (isSyncing === false) {
            loadGroups();
        }
    }, [isSyncing]);

    useEffect(() => {
        if (groups.length > 0) checkUnread(groups);
    }, [selectedGroupDir]);

    const formatName = (name: string) => name.replace(/_/g, ' ');

    const getShortName = (name: string) => {
        const parts = formatName(name).split(' ');
        return parts[0].substring(0, 2);
    };

    const isGroupChat = (group: GroupInfo) => {
        if (GROUP_CHAT_IDS.includes(group.id)) return true;
        return group.is_group_chat || group.member_count > 1;
    };

    const getGroupDisplayInfo = (group: GroupInfo) => {
        const groupChat = isGroupChat(group);

        if (groupChat) {
            return {
                displayName: formatName(group.name),
                shortName: getShortName(group.name),
                path: group.dir_name,
                isGroupChat: true,
                avatar: group.thumbnail || null, // Use group thumbnail from metadata
                isActive: group.is_active ?? true
            };
        } else {
            const member = group.members[0];
            return {
                displayName: formatName(member?.name || group.name),
                shortName: getShortName(member?.name || group.name),
                path: `${group.dir_name}/${member?.dir_name || ''}`,
                isGroupChat: false,
                // Priority: Group Thumbnail (from messages.json member meta) > Thumbnail > Portrait > Phone
                avatar: member?.group_thumbnail || member?.thumbnail || member?.portrait || member?.phone_image || null,
                isActive: group.is_active ?? true
            };
        }
    };

    const sortGroups = (groups: GroupInfo[]) => {
        return [...groups].sort((a, b) => {
            const aIsGroupChat = isGroupChat(a);
            const bIsGroupChat = isGroupChat(b);
            if (aIsGroupChat !== bIsGroupChat) {
                return aIsGroupChat ? 1 : -1;
            }
            return parseInt(a.id) - parseInt(b.id);
        });
    };

    // Filter groups by activeService
    // If group has no service tag (legacy data), show it regardless of activeService
    const onlineGroups = sortGroups(groups.filter(g => g.is_active !== false && (!activeService || !g.service || g.service === activeService)));
    const offlineGroups = sortGroups(groups.filter(g => g.is_active === false && (!activeService || !g.service || g.service === activeService)));

    const renderGroupGrid = (groupList: GroupInfo[]) => (
        <div className="grid grid-cols-3 gap-x-2 gap-y-4">
            {groupList.map(group => {
                const info = getGroupDisplayInfo(group);
                const isSelected = selectedGroupDir === info.path;
                const unreadCount = unreadCounts[group.id] || 0;
                const showUnread = unreadCount > 0; // Always show if unread, even if selected

                return (
                    <button
                        key={group.id}
                        onClick={() => onSelectGroup(info.path, info.isGroupChat, info.displayName)}
                        className="flex flex-col items-center py-1 relative group"
                    >
                        {/* Avatar Container */}
                        <div className={cn(
                            "w-16 h-16 rounded-full flex items-center justify-center mb-1.5 bg-white transition-all relative overflow-hidden",
                            // Selection Ring
                            isSelected ? "ring-2 ring-blue-500 ring-offset-2" : "ring-1 ring-gray-100/50 hover:ring-blue-200",
                            // Offline: Lower saturation and contrast
                        )}
                            style={!info.isActive ? { filter: 'saturate(0.5) contrast(0.8)' } : {}}
                        >
                            {info.isGroupChat && !info.avatar ? (
                                <Users className="w-6 h-6 text-gray-500" />
                            ) : info.avatar ? (
                                <img
                                    src={info.avatar}
                                    alt={info.displayName}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                    }}
                                />
                            ) : (
                                <span className="text-lg text-gray-600 font-medium">
                                    {info.shortName}
                                </span>
                            )}
                        </div>

                        {/* Unread Indicator (Large Blue Circle with Count) */}
                        {showUnread && (
                            <div className="absolute top-0 right-1 min-w-[20px] h-[20px] bg-[#7cc7e8] border border-white rounded-full z-10 shadow-sm flex items-center justify-center px-1">
                                <span className="text-[10px] font-bold text-white">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            </div>
                        )}

                        {/* Removed Group Member Count Badge */}

                        <span className={cn(
                            "text-[11px] text-center leading-tight max-w-[70px] line-clamp-2 transition-colors",
                            isSelected ? "text-blue-600 font-medium" : "text-gray-600 group-hover:text-gray-800"
                        )}>
                            {info.displayName}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="w-80 h-full flex flex-col bg-gradient-to-b from-[#c8d8ec] via-[#dde6f0] to-[#f0f4f8]">
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-center relative">
                <h1 className="text-base font-bold text-gray-700">トーク</h1>
                <div className="absolute right-4 flex gap-2 items-center">
                    {isSyncing && (
                        <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
                    )}
                    <div className="relative">
                        <Settings
                            className="w-5 h-5 text-gray-500 hover:text-gray-700 cursor-pointer"
                            onClick={() => setShowSettings(!showSettings)}
                        />
                        {showSettings && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowSettings(false)} />
                                <div className="absolute right-0 top-6 bg-white shadow-xl rounded-lg border border-gray-100 py-1 w-48 z-50">
                                    {onOpenSettings && (
                                        <button
                                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                            onClick={() => {
                                                setShowSettings(false);
                                                onOpenSettings();
                                            }}
                                        >
                                            App Settings
                                        </button>
                                    )}
                                    {onOpenDiagnostics && (
                                        <button
                                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                            onClick={() => {
                                                setShowSettings(false);
                                                onOpenDiagnostics();
                                            }}
                                        >
                                            System Diagnostics
                                        </button>
                                    )}
                                    <button
                                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                        onClick={handleResetRead}
                                    >
                                        Reset Read Status
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Group Grid */}
            <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin scrollbar-thumb-gray-300">
                {loading ? (
                    <div className="p-6 text-center text-gray-500 text-sm flex flex-col items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
                        <span>Loading conversations...</span>
                    </div>
                ) : groups.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                        No conversations found.
                    </div>
                ) : null}

                {/* Online Section */}
                {onlineGroups.length > 0 && (
                    <>
                        <div className="px-2 py-2 sticky top-0 bg-gradient-to-b from-[#c8d8ec] to-transparent z-10">
                            <h2 className="text-sm text-gray-600 text-center font-medium opacity-80">オンライン</h2>
                        </div>
                        {renderGroupGrid(onlineGroups)}
                    </>
                )}

                {/* Offline Section */}
                {offlineGroups.length > 0 && (
                    <>
                        <div className="px-2 py-2 mt-4 sticky top-0 bg-gradient-to-b from-[#dde6f0] to-transparent z-10">
                            <h2 className="text-sm text-gray-500 text-center font-medium opacity-80">オフライン</h2>
                        </div>
                        {renderGroupGrid(offlineGroups)}
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-white/40 backdrop-blur-sm shrink-0 border-t border-white/20">
                <div className="text-xs text-center text-gray-500">
                    {isSyncing ? (
                        <span className="flex items-center justify-center gap-1 text-blue-600 font-medium">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            Syncing...
                        </span>
                    ) : (
                        <span>Auto-sync active</span>
                    )}
                </div>
            </div>
        </div>
    );
};
