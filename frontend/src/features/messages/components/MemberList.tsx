import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../../utils/classnames';
import { Users, RefreshCw } from 'lucide-react';
import type { MemberInfo } from '../../../types';
import { formatName, getShortName } from '../../../utils';
import { UI_CONSTANTS } from '../../../config/uiConstants';
import { Avatar, Badge, IconButton } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { computeUnreadByPath } from '../utils/unreadCap';
import { persisted } from '../../../core/persistence/persisted';
import { useVisiblePolling } from '../../../hooks/useVisiblePolling';
import { fetchProfileImages, memberImageUrl, PROFILE_IMAGE_KINDS, type ProfileImagesByKind } from '../profileImages';
import { Portal } from '../../../core/common/Portal';
import { MemberContextMenu } from './MemberContextMenu';
import { ProfileImageViewer } from './ProfileImageViewer';

interface GroupInfo {
    id: string;
    name: string;
    service?: string;
    dir_name: string;
    group_path: string;  // Full path to group directory
    member_count: number;
    is_group_chat: boolean;
    is_active?: boolean;
    is_graduated?: boolean;
    server_unread_count?: number | null; // Server's last-synced unread (phone -> Windows); null = unknown
    thumbnail?: string; // Group thumbnail
    thumbnail_local?: string | null; // Archived local copy of the group thumbnail, if any
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
    onSyncNow?: () => void; // Manual sync trigger
}

function formatRelativeTime(isoTime: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
    const diff = Date.now() - new Date(isoTime).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('time.justNow');
    if (minutes < 60) return t('time.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('time.hoursAgo', { count: hours });
    const days = Math.floor(hours / 24);
    return t('time.daysAgo', { count: days });
}

/** Sticky section heading (online / offline / graduated), styled as a small pill. */
const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="sticky top-0 z-20 flex justify-center py-2">
        <h2 className="rounded-pill bg-pill px-3 py-1 text-caption font-semibold text-secondary shadow-pill">{children}</h2>
    </div>
);

export const MemberList: React.FC<SidebarProps> = ({ onSelectGroup, selectedGroupDir, activeService, isSyncing, readStateVersion, onSyncNow }) => {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<GroupInfo[]>([]);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    const [lastSyncMap, setLastSyncMap] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
    const [viewer, setViewer] = useState<ProfileImagesByKind | null>(null);

    // Only the latest "View images" request may open the viewer.
    const imagesRequestId = useRef(0);
    const openImages = (path: string) => {
        const requestId = ++imagesRequestId.current;
        fetchProfileImages(path)
            .then(k => {
                if (requestId !== imagesRequestId.current) return;
                if (PROFILE_IMAGE_KINDS.every(kind => !k[kind]?.length)) return;
                setViewer(k);
            })
            .catch(err => {
                if (requestId === imagesRequestId.current) console.error('Failed to load profile images:', err);
            });
    };

    const loadGroups = () => {
        const url = activeService
            ? `/api/content/groups?service=${encodeURIComponent(activeService)}`
            : '/api/content/groups';
        fetch(url)
            .then(res => res.json())
            .then(data => {
                // Support both old format (array) and new format (object with groups + last_sync)
                const groupList = Array.isArray(data) ? data : data.groups;
                setGroups(groupList);
                if (data.last_sync) setLastSyncMap(data.last_sync);
                checkUnread(groupList);
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
                const saved = persisted.getConv<{ value?: string }>(key, {}).value ?? null;
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

            // Key unread by unique conversation PATH, not by group id: talk-room
            // ids are only unique within a service, so a shared id (e.g. 79 in two
            // services) would collide and bleed one conversation's badge onto the
            // other. capUnreadToServer inside the helper still clears reads done on
            // the official mobile app (phone -> Windows).
            const counts = computeUnreadByPath(
                groupList.map(g => ({
                    path: getGroupDisplayInfo(g).path,
                    serverUnread: g.server_unread_count,
                })),
                backendCounts,
            );

            setUnreadCounts(counts);
        } catch (err) {
            console.error('Failed to fetch unread counts:', err);
            // Keep the last known counts: they were correct one poll ago, while
            // clearing them made every badge flicker off on a single hiccup.
        }
    };

    useVisiblePolling(loadGroups, UI_CONSTANTS.polling.sidebarMs, [activeService]);

    useEffect(() => {
        if (isSyncing === false) {
            loadGroups();
        }
    }, [isSyncing]);

    useEffect(() => {
        if (groups.length > 0) checkUnread(groups);
    }, [selectedGroupDir, readStateVersion]);

    // The backend is the single source of truth for group-vs-member
    // classification: `is_group_chat` already folds in the verified communal
    // channel list AND the member_count > 1 heuristic (see backend
    // content.py GROUP_CHAT_IDS). member_count > 1 is kept only as a defensive
    // fallback for older API responses that predate the is_group_chat field.
    const isGroupChatCheck = (group: GroupInfo) =>
        group.is_group_chat || group.member_count > 1;

    const getGroupDisplayInfo = (group: GroupInfo) => {
        const groupChat = isGroupChatCheck(group);

        if (groupChat) {
            return {
                displayName: formatName(group.name),
                shortName: getShortName(group.name),
                path: group.group_path,  // Use full group path from API
                isGroupChat: true,
                avatar: group.thumbnail_local || group.thumbnail || null, // Prefer archived copy, then group thumbnail from metadata
                isActive: group.is_active ?? true
            };
        } else {
            const member = group.members[0];
            return {
                displayName: formatName(member?.name || group.name),
                shortName: getShortName(member?.name || group.name),
                path: member?.path || group.group_path,  // Use member's full path from API
                isGroupChat: false,
                // Priority: Group Thumbnail (from messages.json member meta) > Thumbnail > Portrait > Phone;
                // each image prefers its archived local copy over the CDN URL
                avatar: memberImageUrl(member, 'group_thumbnail') || memberImageUrl(member, 'thumbnail') || member?.portrait || memberImageUrl(member, 'phone_image') || null,
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

    const onlineGroups = sortGroups(filteredGroups.filter(g => g.is_active !== false && !g.is_graduated));
    const offlineGroups = sortGroups(filteredGroups.filter(g => g.is_active === false && !g.is_graduated));
    const graduatedGroups = sortGroups(filteredGroups.filter(g => g.is_graduated && !g.is_group_chat));

    const renderGroupGrid = (groupList: GroupInfo[], isGraduated = false) => (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-x-2 gap-y-4">
            {groupList.map(group => {
                const info = getGroupDisplayInfo(group);
                const isSelected = selectedGroupDir === info.path;
                const unreadCount = unreadCounts[info.path] || 0;

                return (
                    <button
                        key={group.id}
                        type="button"
                        onClick={() => onSelectGroup(info.path, info.isGroupChat, info.displayName)}
                        onContextMenu={info.isGroupChat ? undefined : (e) => {
                            e.preventDefault();
                            setMenu({ x: e.clientX, y: e.clientY, path: info.path });
                        }}
                        className="group relative flex flex-col items-center gap-1 rounded-card py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group"
                        title={isGraduated ? t('memberList.graduatedTooltip') : undefined}
                    >
                        {/* Hover: the avatar lifts slightly. Graduated / inactive members keep their muted look. */}
                        <span
                            className="transition-transform duration-fast ease-standard group-hover:scale-105"
                            style={isGraduated
                                ? { filter: 'sepia(0.3) saturate(0.6) contrast(0.9)' }
                                : !info.isActive ? { filter: 'saturate(0.5) contrast(0.8)' } : undefined}
                        >
                            {info.isGroupChat && !info.avatar ? (
                                <span className={cn(
                                    'flex h-16 w-16 items-center justify-center rounded-pill bg-sunken text-secondary',
                                    'transition-shadow duration-fast ease-standard',
                                    isSelected ? 'ring-2 ring-white shadow-group-glow' : 'group-hover:shadow-card',
                                )}>
                                    <Users className="h-6 w-6" />
                                </span>
                            ) : (
                                <Avatar
                                    src={info.avatar ?? undefined}
                                    name={info.displayName}
                                    size="lg"
                                    selected={isSelected}
                                    className={cn('h-16 w-16', !isSelected && 'group-hover:shadow-card')}
                                />
                            )}
                        </span>

                        <Badge count={unreadCount} className="absolute right-1 top-0 z-10" />

                        <span className={cn(
                            'line-clamp-2 max-w-full text-center text-caption transition-colors duration-fast ease-standard',
                            isSelected ? 'font-semibold text-group-strong' : 'text-secondary group-hover:text-primary',
                        )}>
                            {info.displayName}
                        </span>
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="relative flex h-full w-80 flex-col min-[1600px]:w-[376px] min-[1920px]:w-[432px]">
            {/* Title row */}
            <div className="relative flex items-center justify-center px-4 py-3">
                <h1 className="text-title font-semibold text-primary">{t('memberList.title')}</h1>
                <div className="absolute right-4 flex items-center gap-2">
                    {isSyncing && <RefreshCw className="h-4 w-4 animate-spin text-secondary" />}
                </div>
            </div>

            {/* Group grid; bottom padding keeps the last row clear of the floating sync pill */}
            <div className="flex-1 overflow-y-auto px-2 pb-16">
                {loading ? (
                    <div className="flex flex-col items-center gap-2 p-6 text-center text-small text-secondary">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span>{t('memberList.loadingConversations')}</span>
                    </div>
                ) : groups.length === 0 ? (
                    <div className="p-6 text-center text-small text-secondary">
                        {t('memberList.noConversations')}
                    </div>
                ) : null}

                {onlineGroups.length > 0 && (
                    <>
                        <SectionHeading>{t('memberList.online')}</SectionHeading>
                        {renderGroupGrid(onlineGroups)}
                    </>
                )}

                {offlineGroups.length > 0 && (
                    <div className="mt-4">
                        <SectionHeading>{t('memberList.offline')}</SectionHeading>
                        {renderGroupGrid(offlineGroups)}
                    </div>
                )}

                {/* Graduated Section - only shown when members have local backup */}
                {graduatedGroups.length > 0 && (
                    <div className="mt-4">
                        <SectionHeading>{t('memberList.graduated')}</SectionHeading>
                        {renderGroupGrid(graduatedGroups, true)}
                    </div>
                )}
            </div>

            {/* Floating sync pill */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <div className="pointer-events-auto inline-flex items-center gap-1 rounded-pill bg-pill py-1 pl-3 pr-1 text-caption text-secondary shadow-pill">
                    {isSyncing ? (
                        <span className="flex items-center gap-1 py-1 pr-2 font-semibold">
                            <RefreshCw className="h-3 w-3 animate-spin" />
                            {t('sync.syncing')}
                        </span>
                    ) : (
                        <>
                            <span className={onSyncNow ? undefined : 'pr-2'}>
                                {activeService && lastSyncMap[activeService]
                                    ? t('sync.lastSynced', { time: formatRelativeTime(lastSyncMap[activeService], t) })
                                    : t('sync.notSynced')}
                            </span>
                            {onSyncNow && (
                                <IconButton
                                    size="sm"
                                    className="h-6 w-6"
                                    aria-label={t('sync.syncNow')}
                                    title={t('sync.syncNow')}
                                    icon={<RefreshCw className="h-3 w-3" />}
                                    onClick={onSyncNow}
                                />
                            )}
                        </>
                    )}
                </div>
            </div>

            {menu && (
                <MemberContextMenu x={menu.x} y={menu.y} onViewImages={() => openImages(menu.path)} onClose={() => setMenu(null)} />
            )}
            {viewer && (
                // Portaled: the sidebar's transformed ancestor would otherwise trap the fixed viewer.
                <Portal>
                    <ProfileImageViewer images={viewer} initialKind="thumbnail" onClose={() => setViewer(null)} />
                </Portal>
            )}
        </div>
    );
};
