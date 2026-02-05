import React, { useEffect, useState, useMemo } from 'react';
import { cn } from '../../../utils/classnames';
import { Users, RefreshCw } from 'lucide-react';
import type { MemberInfo } from '../../../types';
import { formatName, getShortName } from '../../../utils';
import { getGroupChatIds } from '../../../config/groupConfig';
import { UI_CONSTANTS } from '../../../config/uiConstants';
import { useMessagesTheme } from '../hooks/useMessagesTheme';
import { useTranslation } from '../../../i18n';

interface GroupInfo {
    id: string;
    name: string;
    service?: string;
    dir_name: string;
    group_path: string;  // Full path to group directory
    member_count: number;
    is_group_chat: boolean;
    is_active?: boolean;
    thumbnail?: string; // Group thumbnail
    last_message_id?: number;
    total_messages?: number;
    members: MemberInfo[];
}

interface SidebarProps {
    onSelectGroup: (groupDir: string, isGroupChat: boolean, displayName: string) => void;
    selectedGroupDir?: string;
    activeService?: string; // Filter groups by service
    isSyncing?: boolean;
    readStateVersion?: number; // Increments when read state changes, triggers sidebar refresh
}

export const MemberList: React.FC<SidebarProps> = ({ onSelectGroup, selectedGroupDir, activeService, isSyncing, readStateVersion }) => {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<GroupInfo[]>([]);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);

    // Get theme colors for current service
    const theme = useMessagesTheme();
    const sidebarGradient = useMemo(() => theme.messages.sidebarGradient, [theme.messages.sidebarGradient]);

    const loadGroups = () => {
        const url = activeService
            ? `/api/content/groups?service=${encodeURIComponent(activeService)}`
            : '/api/content/groups';
        fetch(url)
            .then(res => res.json())
            .then(data => {
                setGroups(data);
                checkUnread(data);
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    };

    const checkUnread = async (groupList: GroupInfo[]) => {
        // Build a map of path -> full read state from localStorage
        // Read state includes both lastReadId AND revealedIds for accurate counting
        const readStates: Record<string, { lastReadId: number; revealedIds: number[] }> = {};

        groupList.forEach(g => {
            try {
                const info = getGroupDisplayInfo(g);
                const key = `read_state_${info.path}`;
                const saved = localStorage.getItem(key);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    readStates[info.path] = {
                        lastReadId: parsed.lastReadId || 0,
                        revealedIds: parsed.revealedIds || []
                    };
                } else {
                    readStates[info.path] = { lastReadId: 0, revealedIds: [] };
                }
            } catch { }
        });

        // Fetch accurate unread counts from backend (single source of truth)
        // Backend calculates: unread = messages where (id > lastReadId AND id NOT IN revealedIds)
        try {
            const url = activeService
                ? `/api/content/unread_counts?service=${encodeURIComponent(activeService)}`
                : '/api/content/unread_counts';
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(readStates)
            });

            if (!res.ok) throw new Error('Failed to fetch unread counts');

            const backendCounts: Record<string, number> = await res.json();

            // Map path-based counts back to group IDs for the UI
            const counts: Record<string, number> = {};
            groupList.forEach(g => {
                const info = getGroupDisplayInfo(g);
                const unread = backendCounts[info.path] || 0;
                if (unread > 0) {
                    counts[g.id] = unread;
                }
            });

            setUnreadCounts(counts);
        } catch (err) {
            console.error('Failed to fetch unread counts:', err);
            // Fallback: don't show any unread counts rather than showing wrong ones
            setUnreadCounts({});
        }
    };

    useEffect(() => {
        loadGroups();
        const interval = setInterval(loadGroups, UI_CONSTANTS.polling.sidebarMs);
        return () => clearInterval(interval);
    }, [activeService]);

    useEffect(() => {
        if (isSyncing === false) {
            loadGroups();
        }
    }, [isSyncing]);

    useEffect(() => {
        if (groups.length > 0) checkUnread(groups);
    }, [selectedGroupDir, readStateVersion]);

    // Get group chat IDs for the current service
    const groupChatIds = getGroupChatIds(activeService ?? null);

    const isGroupChatCheck = (group: GroupInfo) => {
        if (groupChatIds.includes(group.id)) return true;
        return group.is_group_chat || group.member_count > 1;
    };

    const getGroupDisplayInfo = (group: GroupInfo) => {
        const groupChat = isGroupChatCheck(group);

        if (groupChat) {
            return {
                displayName: formatName(group.name),
                shortName: getShortName(group.name),
                path: group.group_path,  // Use full group path from API
                isGroupChat: true,
                avatar: group.thumbnail || null, // Use group thumbnail from metadata
                isActive: group.is_active ?? true
            };
        } else {
            const member = group.members[0];
            return {
                displayName: formatName(member?.name || group.name),
                shortName: getShortName(member?.name || group.name),
                path: member?.path || group.group_path,  // Use member's full path from API
                isGroupChat: false,
                // Priority: Group Thumbnail (from messages.json member meta) > Thumbnail > Portrait > Phone
                avatar: member?.group_thumbnail || member?.thumbnail || member?.portrait || member?.phone_image || null,
                isActive: group.is_active ?? true
            };
        }
    };

    const sortGroups = (groups: GroupInfo[]) => {
        return [...groups].sort((a, b) => {
            const aIsGroupChat = isGroupChatCheck(a);
            const bIsGroupChat = isGroupChatCheck(b);
            if (aIsGroupChat !== bIsGroupChat) {
                return aIsGroupChat ? 1 : -1;
            }
            return parseInt(a.id) - parseInt(b.id);
        });
    };

    // Filter groups by activeService if provided
    const filteredGroups = activeService
        ? groups.filter(g => !g.service || g.service === activeService)
        : groups;

    const onlineGroups = sortGroups(filteredGroups.filter(g => g.is_active !== false));
    const offlineGroups = sortGroups(filteredGroups.filter(g => g.is_active === false));

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
                            isSelected ? "ring-2 ring-offset-2" : "ring-1 ring-gray-100/50",
                            // Offline: Lower saturation and contrast
                        )}
                            style={{
                                ...(isSelected ? { '--tw-ring-color': theme.modals.accentColor } as React.CSSProperties : {}),
                                ...(!info.isActive ? { filter: 'saturate(0.5) contrast(0.8)' } : {}),
                            }}
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

                        {/* Unread Indicator (Large Circle with Count) */}
                        {showUnread && (
                            <div
                                className="absolute top-0 right-1 min-w-[20px] h-[20px] border border-white rounded-full z-10 shadow-sm flex items-center justify-center px-1"
                                style={{ backgroundColor: theme.unreadBadge }}
                            >
                                <span className="text-[10px] font-bold text-white">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            </div>
                        )}

                        {/* Removed Group Member Count Badge */}

                        <span
                            className={cn(
                                "text-[11px] text-center leading-tight max-w-[70px] line-clamp-2 transition-colors",
                                isSelected ? "font-medium" : "text-gray-600 group-hover:text-gray-800"
                            )}
                            style={isSelected ? { color: theme.modals.accentColor } : undefined}
                        >
                            {info.displayName}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    return (
        <div
            className="w-80 h-full flex flex-col"
            style={{
                background: `linear-gradient(to bottom, ${sidebarGradient[0]}, ${sidebarGradient[1]}, ${sidebarGradient[2]})`,
            }}
        >
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-center relative">
                <h1 className="text-base font-bold text-gray-700">{t('memberList.title')}</h1>
                <div className="absolute right-4 flex gap-2 items-center">
                    {isSyncing && (
                        <RefreshCw className="w-4 h-4 animate-spin" style={{ color: theme.primaryColor }} />
                    )}
                </div>
            </div>

            {/* Group Grid */}
            <div className="flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin scrollbar-thumb-gray-300">
                {loading ? (
                    <div className="p-6 text-center text-gray-500 text-sm flex flex-col items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" style={{ color: theme.primaryColor }} />
                        <span>{t('memberList.loadingConversations')}</span>
                    </div>
                ) : groups.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 text-sm">
                        {t('memberList.noConversations')}
                    </div>
                ) : null}

                {/* Online Section */}
                {onlineGroups.length > 0 && (
                    <>
                        <div
                            className="px-2 py-2 sticky top-0 z-10"
                            style={{ background: `linear-gradient(to bottom, ${sidebarGradient[0]}, transparent)` }}
                        >
                            <h2 className="text-sm text-gray-600 text-center font-medium opacity-80">{t('memberList.online')}</h2>
                        </div>
                        {renderGroupGrid(onlineGroups)}
                    </>
                )}

                {/* Offline Section */}
                {offlineGroups.length > 0 && (
                    <>
                        <div
                            className="px-2 py-2 mt-4 sticky top-0 z-10"
                            style={{ background: `linear-gradient(to bottom, ${sidebarGradient[1]}, transparent)` }}
                        >
                            <h2 className="text-sm text-gray-500 text-center font-medium opacity-80">{t('memberList.offline')}</h2>
                        </div>
                        {renderGroupGrid(offlineGroups)}
                    </>
                )}
            </div>

            {/* Footer */}
            <div className="p-3 bg-white/40 backdrop-blur-sm shrink-0 border-t border-white/20">
                <div className="text-xs text-center text-gray-500">
                    {isSyncing ? (
                        <span className="flex items-center justify-center gap-1 font-medium" style={{ color: theme.primaryColor }}>
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            {t('sync.syncing')}
                        </span>
                    ) : (
                        <span>{t('sync.autoSyncActive')}</span>
                    )}
                </div>
            </div>
        </div>
    );
};
