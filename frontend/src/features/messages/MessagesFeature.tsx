// frontend/src/features/messages/MessagesFeature.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Message, MemberInfo, BackgroundSettings } from '../../types';
import { MemberList } from './components/MemberList';
import { MessageList } from './components/MessageList';
import { ConversationMenu } from './components/ConversationMenu';
import { MemberProfilePopup } from './components/MemberProfilePopup';
import { Menu, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import type { GroupedVirtuosoHandle } from 'react-virtuoso';
import { CalendarModal } from '../../core/modals/CalendarModal';
import { useAppStore } from '../../store/appStore';
import { formatName, DEFAULT_BACKGROUND, loadBackgroundSettings } from '../../utils';
import { cn } from '../../utils/classnames';
import { ContentSheet } from '../../core/layout/ContentSheet';
import { getSyncDetail } from '../../utils/syncFormatters';
import { useMessagesTheme } from './hooks/useMessagesTheme';
import { useTranslation, Trans } from '../../i18n';
import { Avatar, Button, IconButton, Modal } from '../../design/primitives';
import { groupRoles } from '../../design/tokens';
import { FadeOnChange } from '../../core/layout/FadeOnChange';
import { ChatHeaderPill } from './components/ChatHeaderPill';
import { getServiceDisplayName } from '../../data/services';
import { parseReadStatePath } from './readStatePath';
import { loadReadState, saveReadState, applyReveal, mergeReadState, readStateEquals } from './readStateStore';
import type { ReadState } from './readStateStore';
import { useReadStateSubscription } from './hooks/useReadStateSubscription';
import { useUiStateReporter } from './hooks/useUiStateReporter';
import { MediaViewerModal } from '../../core/media/PhotoDetailModal';
import type { MediaViewerItem } from '../../core/media/PhotoDetailModal';
import { memberImageUrl } from './profileImages';
import { useIncomingCall } from '../incomingCall/useIncomingCall';
import { CallOverlay } from '../incomingCall/CallOverlay';
import { isCallPopupActive } from '../callPopup/callPopupApi';
import { useTimelineKeyNav } from './hooks/useTimelineKeyNav';
import { useTimelineJump } from './hooks/useTimelineJump';
import { useLandingHighlight } from './hooks/useLandingHighlight';
import { buildTimeline } from './timeline/buildTimeline';
import { firstUnreadIndex } from './timeline/jumpTarget';
import { applyNickname } from './utils/nickname';
import { useRoomExtras } from './hooks/useRoomExtras';
import { useLetterBreadcrumbs } from './hooks/useLetterBreadcrumbs';
import { LetterRow } from './components/LetterRow';
import { letterAvatars, type Letter } from './letters';

// Types specific to messages feature
// member_id / member_name now live on Message; kept as an alias for call sites.
export type GroupMessage = Message;

export interface GroupMessagesResponse {
    group_dir: string;
    total_messages: number;
    max_message_id: number;
    members: MemberInfo[];
    messages: GroupMessage[];
}

export type { ReadState } from './readStateStore';

export interface SyncProgress {
    state: 'idle' | 'running' | 'complete' | 'error';
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
    detail_code?: string | null;
    result?: {
        members: number; checked: number; missing: number;
        repaired: number; failed: number; still_missing: number;
        unresolved?: number;
        unresolved_items?: { member: string; timestamp: string | null; media_type: string }[];
    } | null;
}

export interface AppSettings {
    output_dir: string;
    auto_sync_enabled: boolean;
    sync_interval_minutes: number;
    adaptive_sync_enabled?: boolean;
    is_configured: boolean;
    user_nicknames?: Record<string, string>;  // Per-service nicknames
    notifications_enabled?: boolean;
    notifications_hide_content?: boolean;  // toasts show a generic body instead of the message preview (default off)
    blogs_full_backup?: boolean;  // Global blog full backup — applies to all services
    auto_download_updates?: boolean;
    sync_read_to_phone?: boolean;  // opt-in: opening a chat here clears its unread on the official app
    incoming_call_enabled?: boolean;  // ring when opening a 1:1 chat whose newest voice is unheard (default on)
    call_popup_enabled?: boolean;  // ring in the bottom-right popup when the app is in the background (default on)
    close_to_tray?: boolean;  // the window's close button hides it to the tray instead of quitting (default on)
    autostart?: boolean;  // start at Windows sign-in, hidden in the tray (default off)
    translation_provider?: string | null;
    translation_model?: string | null;
    translation_api_key?: string | null;
    translation_target_language?: string | null;
}

const MAX_CACHED_CHATS = 20;


interface MessageCacheEntry {
    messages: GroupMessage[];
    membersMap: Record<string, MemberInfo>;
    totalMessages: number;
    maxMessageId: number;
    service: string;
}

interface MessagesFeatureProps {
    appSettings: AppSettings | null;
    syncProgress: SyncProgress;
    syncVersion: number; // Increments when sync completes - triggers refresh
    onSyncNow?: () => void; // Manual sync trigger
}

export const MessagesFeature: React.FC<MessagesFeatureProps> = ({
    appSettings,
    syncProgress,
    syncVersion,
    onSyncNow,
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
    const [messagesForDir, setMessagesForDir] = useState<string | null>(null); // Which dir current messages belong to (state, for render gating)

    // In-memory message cache: revisited chats render instantly from cache while a background refresh runs.
    // LRU eviction keeps at most MAX_CACHED_CHATS entries to bound memory (~300KB × N).
    const messagesCacheRef = useRef<Map<string, MessageCacheEntry>>(new Map());

    // Monotonic fetch counter: each fetchMessages call increments this. When the response
    // arrives, it checks if it's still the latest — stale responses are discarded silently.
    const fetchIdRef = useRef(0);

    const setCacheEntry = useCallback((key: string, entry: MessageCacheEntry) => {
        const cache = messagesCacheRef.current;
        cache.delete(key); // Move to end (Map preserves insertion order)
        cache.set(key, entry);
        if (cache.size > MAX_CACHED_CHATS) {
            cache.delete(cache.keys().next().value!); // Evict oldest
        }
    }, []);

    // Message count tracking
    const [totalMessages, setTotalMessages] = useState(0);

    // Unread state
    const [readState, setReadState] = useState<ReadState>({ lastReadId: 0, readCount: 0, revealedIds: [] });
    // Bumped after each successful fetch; the incoming-call hook evaluates on it
    // (never on the cached render, which may be stale).
    const [freshFetch, setFreshFetch] = useState<{ seq: number; dir: string } | null>(null);
    const [readStateVersion, setReadStateVersion] = useState(0); // Increments on read state change to trigger sidebar refresh
    const [showRevealConfirm, setShowRevealConfirm] = useState(false);
    const [maxMessageId, setMaxMessageId] = useState(0); // Highest message ID (for reveal all)

    // Background customization state
    const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);

    // Member profile popup state
    const [showMemberProfile, setShowMemberProfile] = useState(false);

    // Media viewer modal state
    const [mediaViewerIndex, setMediaViewerIndex] = useState<number | null>(null);
    // Date-search calendar: opened from the ⋯ menu and from the sticky date pills.
    const [calendarOpen, setCalendarOpen] = useState(false);
    const openCalendar = useCallback(() => setCalendarOpen(true), []);

    // Compute unread count from messages and readState (single source of truth)
    const displayUnreadCount = useMemo(() => {
        return messages.filter(m => m.id > readState.lastReadId && !readState.revealedIds.includes(m.id)).length;
    }, [messages, readState.lastReadId, readState.revealedIds]);

    // Scroll ref
    const virtuosoRef = useRef<GroupedVirtuosoHandle>(null);
    // Rows the user sees, as MessageList reports them (none hidden behind the sticky date header).
    const visibleRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
    // Virtuoso's scroll element, which the timeline jump glides.
    const chatScrollerRef = useRef<HTMLElement | null>(null);
    const setChatScroller = useCallback((el: HTMLElement | Window | null) => {
        chatScrollerRef.current = el instanceof HTMLElement ? el : null;
    }, []);

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
                console.debug('[MessagesFeature] nav from search (same-service)', { service: activeService, path: saved.path, isGroupChat: saved.isGroupChat });
                setSelectedGroupDir(saved.path);
                setSelectedName(saved.name);
                setIsGroupChat(saved.isGroupChat);
                setBackgroundSettings(loadBackgroundSettings(saved.path));
            } else {
                console.warn('[MessagesFeature] nav from search: no saved conversation for', activeService);
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
        setMessagesForDir(null);

        // Restore previous selection for the new service (if any)
        if (activeService) {
            const savedConversation = getSelectedConversation(activeService);
            if (savedConversation) {
                console.debug('[MessagesFeature] service switch → restoring', { service: activeService, path: savedConversation.path, isGroupChat: savedConversation.isGroupChat });
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
        const thisId = ++fetchIdRef.current;
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
                if (thisId !== fetchIdRef.current) return; // stale — a newer fetch superseded this one
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
                if (thisId !== fetchIdRef.current) return; // stale
                const map: Record<string, MemberInfo> = {};
                for (const m of data.members) map[m.id] = m;
                const msgs = data.messages || [];
                setMembersMap(map);
                setMessages(msgs);
                setTotalMessages(data.total_messages || 0);
                setMaxMessageId(data.max_message_id || 0);
                setMessagesService(activeService);
                setMessagesForDir(path);
                messagesPathRef.current = path;
                setCacheEntry(path, { messages: msgs, membersMap: map, totalMessages: data.total_messages || 0, maxMessageId: data.max_message_id || 0, service: activeService! });
                setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
            } else {
                const res = await fetch(`/api/content/messages_by_path?path=${encodeURIComponent(path)}&${params}`);
                if (thisId !== fetchIdRef.current) return; // stale
                if (!res.ok) throw new Error("Failed to load");
                data = await res.json();
                if (thisId !== fetchIdRef.current) return; // stale
                const memberInfo = data.member as MemberInfo;
                const mMap = memberInfo ? { [memberInfo.id]: memberInfo } : {};
                setMembersMap(mMap);
                const msgs = data.messages || [];
                setMessages(msgs);
                setTotalMessages(data.total_count || 0);
                setMaxMessageId(data.max_message_id || 0);
                setMessagesService(activeService);
                setMessagesForDir(path);
                messagesPathRef.current = path;
                setCacheEntry(path, { messages: msgs, membersMap: mMap, totalMessages: data.total_count || 0, maxMessageId: data.max_message_id || 0, service: activeService! });
                setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
            }
        } catch (err: unknown) {
            if (thisId !== fetchIdRef.current) return; // stale
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            console.error('[MessagesFeature] fetchMessages failed', { path, groupChat, activeService, error: errorMessage });
            setError(errorMessage);
            setMessages([]);
            setMessagesForDir(null);
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

            // Use cached messages for instant render; fetchMessages refreshes in the background.
            // Without cache, the messagesForDir guard causes a brief blank while fetching.
            const cached = messagesCacheRef.current.get(selectedGroupDir);
            if (cached) {
                setMessages(cached.messages);
                setMembersMap(cached.membersMap);
                setTotalMessages(cached.totalMessages);
                setMaxMessageId(cached.maxMessageId);
                setMessagesService(cached.service);
                setMessagesForDir(selectedGroupDir);
            }

            fetchMessages(selectedGroupDir, isGroupChat, storedReadState.lastReadId);
            setIsSidebarOpen(false);
        }
    }, [selectedGroupDir, isGroupChat]);

    // Opt-in "sync read to phone": opening a room clears its unread on the official
    // mobile app, mirroring tapping into the room there. Gated on the setting here so
    // the off-by-default majority skips the round-trip entirely; the backend re-checks
    // the setting authoritatively. Fire-and-forget — never blocks opening the room.
    //
    // Fire only when the user genuinely opens a room, or when settings finish loading
    // with the flag already on while a room is open (cold start) — but NOT when the
    // user flips the setting on while sitting in a room (that would clear a room they
    // didn't just open). We compare the previous (room, flag) to tell a real
    // room-open / initial settings load apart from a pure toggle. undefined flag means
    // settings haven't loaded yet; false means explicitly off.
    const syncReadPrevRef = useRef<{ dir: string | undefined; on: boolean | undefined }>({
        dir: undefined,
        on: undefined,
    });
    useEffect(() => {
        const on = appSettings?.sync_read_to_phone;
        const prev = syncReadPrevRef.current;
        syncReadPrevRef.current = { dir: selectedGroupDir, on };
        if (!selectedGroupDir || !on) return;
        const roomOpened = selectedGroupDir !== prev.dir;
        const settingsJustLoaded = prev.on === undefined; // null → loaded transition
        if (!roomOpened && !settingsJustLoaded) return; // pure setting toggle → ignore
        const parsedOpen = parseReadStatePath(selectedGroupDir);
        if (!parsedOpen) return;
        // Fire-and-forget — never blocks opening the room. A failed clear (e.g.
        // expired session) is a no-op; the service rail's disconnect badge already
        // surfaces the actionable "session expired — re-login" case.
        fetch('/api/chat/mark-room-read-remote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service: parsedOpen.service, group_id: parsedOpen.groupId }),
        }).catch(() => {});
    }, [selectedGroupDir, appSettings?.sync_read_to_phone]);

    // Unread navigation state logic
    const isUnread = useCallback((msgId: number) => {
        return msgId > readState.lastReadId && !readState.revealedIds.includes(msgId);
    }, [readState.lastReadId, readState.revealedIds]);

    // One timeline for the list, the jumps, the restore and the unread arrows.
    const userNickname = messagesService ? appSettings?.user_nicknames?.[messagesService] : undefined;
    const displayMessages = useMemo(() => applyNickname(messages, userNickname), [messages, userNickname]);
    // Sent letters (local archive), the account profile and the member streak, asked only for a
    // room whose path is in the active service's folder (never the stale pair of a group switch).
    // Group chats have no letters and no streak. The streak (one official request per room per
    // local day) is shared by the header and the profile popup.
    const roomExtras = useRoomExtras(activeService, selectedGroupDir, isGroupChat, syncVersion);
    const { streak, retryStreak } = roomExtras;
    const timeline = useMemo(() => buildTimeline(displayMessages, roomExtras.letters), [displayMessages, roomExtras.letters]);
    const letterAvatar = useMemo(
        () => letterAvatars(roomExtras.letters, roomExtras.profile?.avatars ?? []),
        [roomExtras.letters, roomExtras.profile],
    );
    // Breadcrumbs, once per room visit: how each letter's avatar was chosen, and dropped letters.
    useLetterBreadcrumbs(roomExtras.lettersRoomKey, letterAvatar, roomExtras.profile !== null, timeline.droppedLetters);
    const letterUserName = roomExtras.profile?.name || userNickname || t('letters.you');
    const [letterViewer, setLetterViewer] = useState<Letter | null>(null);
    const renderLetter = useCallback((letter: Letter) => (
        <LetterRow
            letter={letter}
            avatarUrl={letterAvatar.byId.get(letter.id) ?? null}
            userName={letterUserName}
            onOpenImage={setLetterViewer}
        />
    ), [letterAvatar, letterUserName]);

    const { highlightedRowKey, flash: flashLanded } = useLandingHighlight(selectedGroupDir);
    // The old room's visible range says nothing about the new one: unknown until MessageList reports it.
    useEffect(() => {
        visibleRangeRef.current = null;
    }, [selectedGroupDir]);

    const jumpTo = useTimelineJump({
        virtuosoRef, timeline, isUnread, onLanded: flashLanded, resetKey: selectedGroupDir,
        getScroller: () => chatScrollerRef.current,
        visibleRange: () => visibleRangeRef.current,
    });

    const updateUnreadNavState = useCallback((range?: { startIndex: number; endIndex: number }) => {
        const currentRange = range || visibleRangeRef.current || { startIndex: 0, endIndex: 0 };
        if (range) visibleRangeRef.current = range;

        const firstUnread = firstUnreadIndex(timeline, isUnread);
        let above = false;
        let below = false;

        if (firstUnread !== -1) {
            if (firstUnread < currentRange.startIndex) above = true;
            else if (firstUnread > currentRange.endIndex) below = true;
        }
        setHasUnreadAbove(above);
        setHasUnreadBelow(below);
    }, [timeline, isUnread]);

    useEffect(() => {
        updateUnreadNavState();
    }, [updateUnreadNavState]);

    // === READ STATE ===
    // Persist + bump the version so the sidebar re-reads its unread dots.
    const saveAndBump = useCallback((path: string, s: ReadState) => {
        saveReadState(path, s);
        setReadStateVersion(v => v + 1);
    }, []);

    const revealMessage = useCallback((msgId: number) => {
        setReadState(prev => {
            const next = applyReveal(prev, msgId, messages.map(m => m.id));
            if (next !== prev && selectedGroupDir) saveAndBump(selectedGroupDir, next);
            return next;
        });
    }, [selectedGroupDir, messages, saveAndBump]);

    // A heard change made through the main-window bridge (popup answered a voice).
    // Merge, never replace: an in-chat reveal still queued in setReadState would
    // otherwise be overwritten (and its later save would clobber the bridge write).
    // When the merge holds more than the stored row, write it back.
    const mergeLoadedReadState = useCallback((loaded: ReadState) => {
        setReadState(prev => {
            const merged = mergeReadState(prev, loaded);
            if (selectedGroupDir && !readStateEquals(merged, loaded)) saveAndBump(selectedGroupDir, merged);
            return merged;
        });
    }, [selectedGroupDir, saveAndBump]);
    useReadStateSubscription(selectedGroupDir, mergeLoadedReadState, () => setReadStateVersion(v => v + 1));

    const revealAllMessages = useCallback(() => {
        if (maxMessageId === 0) return;
        const next: ReadState = { lastReadId: maxMessageId, readCount: totalMessages, revealedIds: [] };
        if (selectedGroupDir) saveAndBump(selectedGroupDir, next);
        setReadState(next);
    }, [selectedGroupDir, maxMessageId, totalMessages, saveAndBump]);

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

    // The 1:1 room's member: header avatar, the ⋯ menu and the profile popup.
    const headerMember = Object.values(membersMap)[0];
    const headerAvatar = memberImageUrl(headerMember, 'thumbnail') || headerMember?.portrait || undefined;
    const isLightHeader = theme.messages.headerStyle === 'light';

    const getSenderInfo = useCallback((msg: GroupMessage) => {
        const memberInfo = (isGroupChat && msg.member_id) ? membersMap[msg.member_id] : Object.values(membersMap)[0];
        return {
            name: formatName(msg.member_name || memberInfo?.name || selectedName || 'Unknown'),
            avatar: memberImageUrl(memberInfo, 'thumbnail') || memberInfo?.portrait || memberImageUrl(memberInfo, 'phone_image')
        };
    }, [isGroupChat, membersMap, selectedName]);

    /**
     * Resolve the member directory path for a message (used by transcription API).
     * For individual chats, selectedGroupDir is the member directory path.
     * For group chats, each message sender has their own path via membersMap.
     */
    const getMemberPath = useCallback((msg: GroupMessage): string | undefined => {
        if (isGroupChat && msg.member_id) {
            return membersMap[msg.member_id]?.path ?? undefined;
        }
        return selectedGroupDir;
    }, [isGroupChat, membersMap, selectedGroupDir]);

    const scrollToFirstUnread = useCallback(() => { void jumpTo({ kind: 'firstUnread' }); }, [jumpTo]);

    const scrollToMessage = useCallback((id: number) => {
        void jumpTo({ kind: 'message', id, align: 'center' });
    }, [jumpTo]);

    const jumpToTargetMessage = useCallback((id: number) => {
        void jumpTo({ kind: 'message', id, align: 'start' });
    }, [jumpTo]);

    const jumpToLetter = useCallback((id: number) => {
        void jumpTo({ kind: 'letter', id });
    }, [jumpTo]);

    // The backend's popup owns a voice while the window is visible but unfocused: ask it, keep no copy.
    const isCallElsewhere = useCallback((messageId: number) => {
        const ctx = selectedGroupDir ? parseReadStatePath(selectedGroupDir) : null;
        return ctx ? isCallPopupActive(ctx, messageId) : Promise.resolve(false);
    }, [selectedGroupDir]);

    const callMember = isGroupChat ? undefined : Object.values(membersMap)[0];
    const incomingCall = useIncomingCall({
        service: messagesService,
        chatDir: selectedGroupDir,
        isGroupChat,
        messages,
        member: callMember,
        name: formatName(callMember?.name || selectedName || ''),
        // undefined until settings load → no ring; a loaded value without the field defaults on
        enabled: appSettings ? (appSettings.incoming_call_enabled ?? true) : undefined,
        isUnread,
        freshFetch,
        revealMessage,
        scrollToMessage,
        logContext: selectedGroupDir ? parseReadStatePath(selectedGroupDir) : null,
        isCallElsewhere,
    });
    useUiStateReporter(selectedGroupDir);
    const callActive = incomingCall.phase !== 'idle';

    // Keyboard navigation through the shared timeline jump (inert while a call covers the timeline)
    const handleKeyDown = useTimelineKeyNav(jumpTo, callActive);

    // Scroll to first message of a given date (for calendar navigation).
    // SD-FE-CORE-02: the calendar buckets days by LOCAL date (backend
    // `_local_date`), and bubbles render local time — so match by the message's
    // LOCAL date, not its raw UTC `timestamp` prefix, or a jump near midnight
    // lands on the wrong day (or fails to find any message) for non-UTC users.
    const scrollToDate = useCallback((dateStr: string) => {
        void jumpTo({ kind: 'date', date: dateStr });
    }, [jumpTo]);

    // Build media items list for the viewer (all photos/videos/voices sorted by timestamp)
    const mediaItems = useMemo((): MediaViewerItem[] => {
        if (!messagesService) return [];
        return messages
            .filter(m => m.media_file && (m.type === 'picture' || m.type === 'video' || m.type === 'voice'))
            .map(m => {
                const sender = getSenderInfo(m);
                return {
                    src: `/api/content/media/${encodeURIComponent(messagesService)}/${m.media_file!.split('/').map(encodeURIComponent).join('/')}`,
                    type: m.type as 'picture' | 'video' | 'voice',
                    timestamp: m.timestamp,
                    avatarUrl: sender.avatar,
                    memberName: sender.name,
                    isMuted: m.is_muted,
                    messageId: m.id,
                    service: messagesService,
                    memberPath: getMemberPath(m),
                };
            });
    }, [messages, messagesService, getSenderInfo, getMemberPath]);

    const handleMediaClick = useCallback((mediaUrl: string, _type: string, _timestamp?: string) => {
        const idx = mediaItems.findIndex(item => item.src === mediaUrl);
        if (idx !== -1) setMediaViewerIndex(idx);
    }, [mediaItems]);

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
            // SD-CONTRACT-01: the backend returns HTTP 200 with a
            // {success: false, error} body when the upstream official-API call
            // fails (expired session, 5xx). Checking only res.ok would leave the
            // optimistic star lit for a favorite that was never saved (it then
            // silently vanishes on the next reload/sync). Parse the body and
            // treat success === false as a failure too.
            if (!res.ok) {
                throw new Error(`Failed to update favorite (HTTP ${res.status})`);
            }
            const body = await res.json().catch(() => null) as { success?: boolean; error?: string } | null;
            if (body && body.success === false) {
                throw new Error(body.error || 'Server reported favorite update failed');
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
            {/* Member sidebar on the canvas (level 0), next to the feature rail. Below md it slides in over the chat. */}
            <div className={cn(
                'fixed inset-y-0 left-0 z-30 transform transition-transform duration-base ease-standard',
                'max-md:bg-group-canvas md:relative md:translate-x-0',
                isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}>
                <MemberList
                    onSelectGroup={handleSelectGroup}
                    selectedGroupDir={selectedGroupDir}
                    activeService={activeService || undefined}
                    isSyncing={syncProgress.state === 'running'}
                    readStateVersion={readStateVersion}
                    onSyncNow={onSyncNow}
                />
            </div>

            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-20 bg-scrim md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Main Chat Area */}
            <ContentSheet className="relative">
                {/* Header: the official title layer (gradient, or Sakurazaka's white header + thin bar) */}
                <header
                    className={cn(
                        'z-20 flex h-16 shrink-0 items-center gap-3 px-4',
                        isLightHeader ? 'bg-sheet text-group-title' : 'bg-group-title text-inverse',
                    )}
                >
                    <IconButton
                        className="text-current md:hidden"
                        aria-label={t('messageList.openConversations')}
                        icon={<Menu />}
                        onClick={() => setIsSidebarOpen(true)}
                    />
                    {selectedGroupDir && !isGroupChat && (
                        <Avatar src={headerAvatar} name={selectedName || ''} size="md" className="ring-2 ring-surface" />
                    )}
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-title font-semibold">{selectedName || t('messageList.selectConversation')}</h2>
                        {isGroupChat ? (
                            <p className="text-caption">{t('messageList.groupChat')}</p>
                        ) : streak.status === 'ready' && streak.days > 0 ? (
                            <p className="text-caption">
                                <Trans
                                    i18nKey="memberProfile.subscribedDays"
                                    values={{ days: streak.days }}
                                    components={{ num: <span className="font-semibold" /> }}
                                />
                            </p>
                        ) : null}
                    </div>
                    {displayUnreadCount > 0 && (
                        <ChatHeaderPill light={isLightHeader} className="font-semibold">
                            {t('messageList.unread', { count: displayUnreadCount })}
                        </ChatHeaderPill>
                    )}
                    {syncProgress.state === 'running' && (
                        <ChatHeaderPill light={isLightHeader}>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>{getSyncDetail(syncProgress, t, t('sync.syncing'))}</span>
                        </ChatHeaderPill>
                    )}
                    {selectedGroupDir && (
                        <ConversationMenu
                            conversationPath={selectedGroupDir}
                            isGroupChat={isGroupChat}
                            messages={messages}
                            memberName={selectedName || ''}
                            memberAvatar={headerAvatar}
                            letters={roomExtras.letters}
                            lettersStatus={roomExtras.lettersStatus}
                            onJumpToLetter={jumpToLetter}
                            activeService={activeService || undefined}
                            onOpenCalendar={openCalendar}
                            onBackgroundChange={setBackgroundSettings}
                        />
                    )}
                </header>

                {isLightHeader && <div className="h-1 shrink-0 bg-group-title-bar" />}

                <FadeOnChange changeKey={selectedGroupDir} className="flex min-h-0 flex-1 flex-col">
                {/* Virtualized Timeline */}
                <div
                    className="flex-1 overflow-hidden relative isolate"
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                >
                    {/* Background layer — kept separate so the opacity slider fades only the
                        background image/color, not the message bubbles. CSS opacity applies to
                        an element AND its whole subtree, so putting it on the shared container
                        would fade the messages too. `isolate` scopes the -z-10 layer to this box. */}
                    <div
                        className="absolute inset-0 -z-10 pointer-events-none"
                        style={{
                            backgroundColor: backgroundSettings.type === 'color' ? backgroundSettings.color : DEFAULT_BACKGROUND.color,
                            backgroundImage: backgroundSettings.type === 'image' && backgroundSettings.imageData
                                ? `url(${backgroundSettings.imageData})`
                                : 'none',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            opacity: backgroundSettings.opacity / 100,
                        }}
                    />
                    {!selectedGroupDir && (
                        <div className="absolute inset-0 flex items-center justify-center text-muted">
                            <div className="text-center">
                                <p className="mb-2 text-title">{t('messageList.welcomeTitle')}</p>
                                <p className="text-small">{t('messageList.welcomeSubtitle')}</p>
                            </div>
                        </div>
                    )}

                    {loading && messages.length === 0 && (
                        <div className="p-10 text-center text-secondary">{t('messageList.loadingMessages')}</div>
                    )}
                    {error && (
                        <div className="p-10 text-center text-feedback-error">
                            <p className="font-semibold">{t('common.error')}</p>
                            <p>{error}</p>
                        </div>
                    )}

                    {selectedGroupDir && messages.length > 0 && messagesService && messagesForDir === selectedGroupDir && roomExtras.lettersReady && (
                        <MessageList
                            memberId={selectedGroupDir}
                            timeline={timeline}
                            getSenderInfo={getSenderInfo}
                            isUnread={isUnread}
                            onReveal={revealMessage}
                            onLongPress={() => setShowRevealConfirm(true)}
                            onRangeChanged={updateUnreadNavState}
                            virtuosoRef={virtuosoRef}
                            scrollerRef={setChatScroller}
                            userNickname={userNickname}
                            onToggleFavorite={handleToggleFavorite}
                            onAvatarClick={() => setShowMemberProfile(true)}
                            onMediaClick={handleMediaClick}
                            service={messagesService}
                            targetMessageId={targetMessageId}
                            onTargetMessageConsumed={() => setTargetMessageId(null)}
                            onJumpToMessage={jumpToTargetMessage}
                            highlightedRowKey={highlightedRowKey}
                            getMemberPath={getMemberPath}
                            onOpenCalendar={openCalendar}
                            renderLetter={renderLetter}
                        />
                    )}
                    <CallOverlay
                        call={incomingCall}
                        // The accent is the group action colour (step 600); light-style services (櫻坂) get a white answer button.
                        accentColor={groupRoles(theme.id).action}
                        answerStyle={theme.messages.headerStyle === 'light' ? 'light' : 'solid'}
                        groupLabel={messagesService ? getServiceDisplayName(messagesService) : ''}
                    />
                </div>
                </FadeOnChange>

                {/* Navigation Buttons */}
                {/* Up arrow: bottom-right, when the oldest unread is ABOVE the view */}
                {selectedGroupDir && hasUnreadAbove && !callActive && (
                    <IconButton
                        variant="accent"
                        className="absolute bottom-4 right-4 z-20"
                        aria-label={t('messageList.jumpToOldestUnread')}
                        title={t('messageList.jumpToOldestUnread')}
                        icon={<ChevronUp className="h-5 w-5" />}
                        onClick={scrollToFirstUnread}
                    />
                )}
                {/* Down arrow: top-right below the header, when the oldest unread is BELOW the view */}
                {selectedGroupDir && hasUnreadBelow && !callActive && (
                    <IconButton
                        variant="accent"
                        className="absolute right-4 top-20 z-20"
                        aria-label={t('messageList.jumpToOldestUnread')}
                        title={t('messageList.jumpToOldestUnread')}
                        icon={<ChevronDown className="h-5 w-5" />}
                        onClick={scrollToFirstUnread}
                    />
                )}

                {/* Reveal All Confirmation Modal */}
                <Modal
                    isOpen={showRevealConfirm}
                    onClose={() => setShowRevealConfirm(false)}
                    title={t('messageList.revealAllTitle')}
                    logId="reveal_all"
                    className="max-w-sm"
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setShowRevealConfirm(false)}>{t('common.cancel')}</Button>
                            <Button
                                variant="primary"
                                onClick={() => {
                                    revealAllMessages();
                                    setShowRevealConfirm(false);
                                }}
                            >
                                {t('messageList.confirm')}
                            </Button>
                        </>
                    }
                >
                    <p className="text-body text-secondary">{t('messageList.revealAllDescription', { count: displayUnreadCount })}</p>
                </Modal>
            </ContentSheet>

            {selectedGroupDir && (
                <CalendarModal
                    isOpen={calendarOpen}
                    onClose={() => setCalendarOpen(false)}
                    conversationPath={selectedGroupDir}
                    onSelectDate={(date) => {
                        setCalendarOpen(false);
                        scrollToDate(date);
                    }}
                />
            )}

            {/* Member Profile Popup */}
            <MemberProfilePopup
                isOpen={showMemberProfile}
                onClose={() => setShowMemberProfile(false)}
                memberName={selectedName || ''}
                memberAvatar={headerAvatar}
                streak={streak}
                onRetryStreak={retryStreak}
                activeService={activeService || undefined}
                memberPath={isGroupChat ? undefined : selectedGroupDir}
            />

            {/* Media Viewer Modal */}
            {mediaViewerIndex !== null && mediaItems.length > 0 && (
                <MediaViewerModal
                    mediaItems={mediaItems}
                    currentIndex={mediaViewerIndex}
                    onClose={() => setMediaViewerIndex(null)}
                    onNavigate={setMediaViewerIndex}
                />
            )}
            {/* Letter image viewer */}
            {letterViewer?.image_url && (
                <MediaViewerModal
                    mediaItems={[{ src: letterViewer.image_url, type: 'picture', timestamp: letterViewer.created_at }]}
                    currentIndex={0}
                    onClose={() => setLetterViewer(null)}
                    onNavigate={() => {}}
                />
            )}
        </div>
    );
};
