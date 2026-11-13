// frontend/src/features/messages/MessagesFeature.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useMilestone } from './milestones';
import { MilestoneFooter } from './components/MilestoneFooter';
import type { Message, MemberInfo, BackgroundSettings } from '../../types';
import { MemberList } from './components/MemberList';
import { MessageList } from './components/MessageList';
import { ConversationMenu } from './components/ConversationMenu';
import { MemberProfilePopup } from './components/MemberProfilePopup';
import { Menu, MessageCircle, ChevronUp, ChevronDown, CloudOff } from 'lucide-react';
import type { GroupedVirtuosoHandle } from 'react-virtuoso';
import { CalendarModal } from '../../core/modals/CalendarModal';
import { useAppStore } from '../../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { formatName, DEFAULT_BACKGROUND, loadBackgroundSettings } from '../../utils';
import { cn } from '../../utils/classnames';
import { ContentSheet } from '../../core/layout/ContentSheet';
import { selectIsSyncing, useSyncProgressStore } from '../../shell/syncProgressStore';
import { useTranslation, Trans } from '../../i18n';
import { useFeatureActive } from '../../design/featureActive';
import { useInert } from '../../hooks/useInert';
import { tabbables } from '../../design/dialog/tabbables';
import { logDialog } from '../../design/dialog/dialogLog';
import { openDialogCount } from '../../design/dialog/dialogStack';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Avatar, EmptyState, IconButton, StatusBlock } from '../../design/primitives';
import { logWait, settleDelay, useDelayedLoading } from '../../design/loading';
import { groupTokens } from '../../design/tokens';
import { serviceGroupId } from '../../config/serviceGroup';
import { FadeOnChange } from '../../core/layout/FadeOnChange';
import { ChatHeaderPill } from './components/ChatHeaderPill';
import { SyncStatusPill } from './components/SyncStatusPill';
import { getServiceDisplayName } from '../../data/services';
import { parseReadStatePath } from './readStatePath';
import { persisted } from '../../core/persistence/persisted';
import { loadReadState, saveReadState, applyReveal, mergeReadState, readStateEquals } from './readStateStore';
import type { ReadState } from './readStateStore';
import { useReadStateSubscription } from './hooks/useReadStateSubscription';
import { useUiStateReporter } from './hooks/useUiStateReporter';
import { MediaViewerModal } from '../../core/media/PhotoDetailModal';
import { LetterViewerModal } from '../../core/modals/LetterViewerModal';
import { ConfirmDialog } from '../../shell/components/ConfirmDialog';
import type { MediaViewerItem } from '../../core/media/PhotoDetailModal';
import { memberImageUrl } from './profileImages';
import { resizedAvatarUrl } from './mediaUrl';
import { useAvatarWidth } from './hooks/useAvatarWidth';
import { useIncomingCall } from '../incomingCall/useIncomingCall';
import { CallOverlay } from '../incomingCall/CallOverlay';
import { isCallPopupActive } from '../callPopup/callPopupApi';
import { useTimelineKeyNav } from './hooks/useTimelineKeyNav';
import { useTimelineJump } from './hooks/useTimelineJump';
import { useTimelineLetterViewer } from './hooks/useTimelineLetterViewer';
import { useLandingHighlight } from './hooks/useLandingHighlight';
import { buildTimeline } from './timeline/buildTimeline';
import { firstUnreadIndex } from './timeline/jumpTarget';
import { applyNickname } from './utils/nickname';
import { useRoomExtras } from './hooks/useRoomExtras';
import { useLetterBreadcrumbs } from './hooks/useLetterBreadcrumbs';
import { LetterRow } from './components/LetterRow';
import { letterAvatars, type Letter } from './letters';
import { setFavorite } from '../../utils/favoriteApi';
import { clientLog } from '../../utils/clientLog';
import { EMPTY_FAVORITES, applyFavoriteOverrides, pruneFavoriteOverrides, setFavoriteIn, withFavorite } from './favoriteOverrides';
import { storeRoom } from './roomCache';
import { ChatSkeleton } from './components/ChatSkeleton';
import { CHAT_LOAD_TIMEOUT_MS, deriveChatLoad, type ChatLoadFailure } from './chatLoadState';

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
    /** `queued`: waiting in the backend sync queue (one sync runs at a time). */
    state: 'idle' | 'queued' | 'running' | 'complete' | 'error';
    /** 1-based place in the backend sync queue while `queued`. */
    queue_position?: number | null;
    /** Seconds since the run's first phase (does not reset per phase). */
    run_elapsed_seconds?: number;
    /** Why `eta_seconds` is null while running: unknown cost per unit, or not enough evidence yet. */
    eta_reason?: 'not_estimable' | 'warming_up' | null;
    /** Items processed but failed in the current phase (media downloads). */
    failed?: number;
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
        /** Missing items Verify skipped because their saved location is outside the group's folder. */
        rejected?: number;
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
    memories_notify_on_this_day?: boolean;  // Memories: the daily On This Day toast (default on)
    memories_notify_birthday?: boolean;  // Memories: birthdays plus the 7-day and 1-day reminders (default on)
    memories_notify_anniversary?: boolean;  // Memories: membership anniversaries and milestones (default on)
    memories_notify_recap?: boolean;  // Memories: recap open / Christmas / ready (default on)
    memories_notify_cards?: boolean;  // Memories: foil card unlocks (default off)
    memories_notify_time?: string;  // Memories: the JST daily time, `HH:MM` (default '12:00')
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


interface MessageCacheEntry {
    messages: GroupMessage[];
    membersMap: Record<string, MemberInfo>;
    totalMessages: number;
    maxMessageId: number;
    service: string;
    /** The response's ETag: the next fetch of this room asks with `If-None-Match`. */
    etag: string | null;
}

/** Drawn size of the chat avatars (message runs, letters, header: Avatar `md`), in CSS px. */
const CHAT_AVATAR_CSS_PX = 40;

interface MessagesFeatureProps {
    appSettings: AppSettings | null;
    syncVersion: number; // Increments when sync completes - triggers refresh
    onSyncNow?: () => void; // Manual sync trigger
}

export const MessagesFeature: React.FC<MessagesFeatureProps> = ({
    appSettings,
    syncVersion,
    onSyncNow,
}) => {
    const { t } = useTranslation();
    // False while Messages is kept mounted behind another feature (ContentArea, Decision 7 of plan F).
    const featureActive = useFeatureActive();
    // A boolean slice: progress ticks re-render only SyncStatusPill, not this component.
    const isSyncing = useSyncProgressStore(selectIsSyncing);

    // Get active service and conversation persistence from Zustand store
    const { activeService, setSelectedConversation, getSelectedConversation } = useAppStore(useShallow((s) => ({
        activeService: s.activeService,
        setSelectedConversation: s.setSelectedConversation,
        getSelectedConversation: s.getSelectedConversation,
    })));

    // Chat state
    const [selectedGroupDir, setSelectedGroupDir] = useState<string | undefined>();
    const [selectedName, setSelectedName] = useState<string | undefined>();
    const [isGroupChat, setIsGroupChat] = useState(false);
    const [messages, setMessages] = useState<GroupMessage[]>([]);
    const [membersMap, setMembersMap] = useState<Record<string, MemberInfo>>({});
    // The last load failure and the room it belongs to (another room's failure never shows).
    const [loadFailure, setLoadFailure] = useState<{ dir: string; kind: ChatLoadFailure } | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    // Below md (a narrow window or a zoomed page) the member list slides over the chat: closed, it is
    // off-screen and must not take focus; open, the chat behind its scrim must not (UI health A-D6).
    const narrow = useMediaQuery('(width < 768px)');
    const sidebarRef = useRef<HTMLDivElement>(null);
    const chatRef = useRef<HTMLDivElement>(null);
    useInert(sidebarRef, narrow && !isSidebarOpen);
    useInert(chatRef, narrow && isSidebarOpen);
    const sidebarToggleRef = useRef<HTMLButtonElement>(null);
    const sidebarOverlay = narrow && isSidebarOpen;
    // The overlay is a keyboard trap-free popover: focus moves in on open and back to its toggle on
    // close (the chat behind it is inert, so the toggle cannot keep focus). Layout effect: it runs
    // after the inert flags above are applied.
    const sidebarWasOverlayRef = useRef(false);
    useLayoutEffect(() => {
        const was = sidebarWasOverlayRef.current;
        sidebarWasOverlayRef.current = sidebarOverlay;
        if (sidebarOverlay && !was) {
            const first = sidebarRef.current ? tabbables(sidebarRef.current)[0] : undefined;
            (first ?? sidebarRef.current)?.focus({ preventScroll: true });
        } else if (!sidebarOverlay && was) {
            const active = document.activeElement;
            if (!active || active === document.body || sidebarRef.current?.contains(active)) {
                sidebarToggleRef.current?.focus({ preventScroll: true });
            }
        }
    }, [sidebarOverlay]);
    // Escape closes the overlay (not while a dialog is open, nor in an IME, nor when already handled).
    useEffect(() => {
        if (!sidebarOverlay) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
            if (openDialogCount() > 0) return;
            e.preventDefault();
            logDialog('sidebar', 'close', 'escape');
            setIsSidebarOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [sidebarOverlay]);
    const [messagesForDir, setMessagesForDir] = useState<string | null>(null); // Which dir current messages belong to (state, for render gating)
    // Mirror of messagesForDir for fetchMessages: is the room already on screen when its fetch starts?
    const shownDirRef = useRef<string | null>(null);
    const showDir = useCallback((dir: string | null) => {
        shownDirRef.current = dir;
        setMessagesForDir(dir);
    }, []);

    // In-memory message cache: revisited chats render instantly from cache while a background refresh
    // runs (conditional, see fetchMessages). Bounded by roomCache.ts: 20 rooms and 60 000 messages in
    // all, least recently used first.
    const messagesCacheRef = useRef<Map<string, MessageCacheEntry>>(new Map());

    // Monotonic fetch counter: each fetchMessages call increments this. When the response
    // arrives, it checks if it's still the latest — stale responses are discarded silently.
    const fetchIdRef = useRef(0);
    // The running fetch's controller: aborted when a newer fetch supersedes it, on its deadline and on unmount.
    const fetchAbortRef = useRef<AbortController | null>(null);
    // The room wait in progress (cleared when a fetch settles): a refetch of the same room (a sync
    // mid-load) keeps its start, so the min-visible hold and the 60 s deadline do not start over.
    const roomWaitRef = useRef<{ path: string; startedAt: number } | null>(null);
    useEffect(() => () => {
        fetchIdRef.current += 1; // the aborted fetch is stale: no failure state, no log
        fetchAbortRef.current?.abort();
    }, []);

    const setCacheEntry = useCallback((key: string, entry: MessageCacheEntry) => {
        storeRoom(messagesCacheRef.current, key, entry);
    }, []);

    // A saved ★ in the cached copy, so a later visit renders it (Map.set keeps the LRU position).
    const patchCachedFavorite = useCallback((room: string, id: number, starred: boolean) => {
        const cache = messagesCacheRef.current;
        const entry = cache.get(room);
        if (entry) cache.set(room, { ...entry, messages: setFavoriteIn(entry.messages, id, starred) });
    }, []);

    // Message count tracking
    const [totalMessages, setTotalMessages] = useState(0);

    // Unread state
    const [readState, setReadState] = useState<ReadState>({ lastReadId: 0, readCount: 0, revealedIds: [] });
    // ★ changes of the open room since its last fresh load (favoriteOverrides.ts): the primary store
    // for an unsaved ★; the bubble and the dialogs read it, never a copy.
    const [favoriteOverrides, setFavoriteOverrides] = useState<ReadonlyMap<number, boolean>>(EMPTY_FAVORITES);
    // The room the overrides belong to, read after an await (a failed save must not touch another room).
    const overridesRoomRef = useRef<string | undefined>(undefined);
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
    // Revealed ids as a Set: unread checks run per message and per bubble.
    const revealedSet = useMemo(() => new Set(readState.revealedIds), [readState.revealedIds]);
    const displayUnreadCount = useMemo(
        () => messages.filter(m => m.id > readState.lastReadId && !revealedSet.has(m.id)).length,
        [messages, readState.lastReadId, revealedSet],
    );

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
                console.debug('[MessagesFeature] nav from search (same-service)', { service: activeService, isGroupChat: saved.isGroupChat });
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

    // Restores the saved room of `service`, or clears the selection. Used by the group-switch effect
    // and by the hidden → shown edge (a group switch made from Blogs or Memories restores on show).
    const restoreSavedConversation = useCallback((service: string | null) => {
        const saved = service ? getSelectedConversation(service) : null;
        if (saved) {
            console.debug('[MessagesFeature] service switch → restoring', { service, isGroupChat: saved.isGroupChat });
            setSelectedGroupDir(saved.path);
            setSelectedName(saved.name);
            setIsGroupChat(saved.isGroupChat);
            setBackgroundSettings(loadBackgroundSettings(saved.path));
        } else {
            setSelectedGroupDir(undefined);
            setSelectedName(undefined);
            setIsGroupChat(false);
        }
    }, [getSelectedConversation]);
    // Set by a group switch made while hidden: the show edge restores the new group's room.
    const restoreOnShowRef = useRef(false);
    // openChat (a toast, a search result, a Memories jump) shows Messages and selects another room in
    // the same step: the saved conversation of the service is then not the room on screen, and the
    // show edge leaves the room as last shown alone (that room's own render loads and opens it).
    // Invariant: the saved conversation equals the room on screen unless a navigation is pending (every
    // writer of `selectedGroupDir` goes through the store).
    const opensAnotherRoom = useCallback(() => {
        const saved = activeService ? getSelectedConversation(activeService) : null;
        return saved?.path !== selectedGroupDir;
    }, [activeService, getSelectedConversation, selectedGroupDir]);

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
        setLoadFailure(null);
        setMessagesService(null);
        showDir(null);

        if (featureActive) {
            restoreSavedConversation(activeService);
        } else {
            // Hidden: no room is opened behind another feature (no fetch, no read sync, no extras).
            setSelectedGroupDir(undefined);
            setSelectedName(undefined);
            setIsGroupChat(false);
            restoreOnShowRef.current = true;
            clientLog('chat_load', { outcome: 'deferred', reason: 'hidden_restore' });
        }

        // Update ref for next switch
        previousServiceRef.current = activeService;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- featureActive is read, not a trigger: the show edge below handles it
    }, [activeService, getSelectedConversation, setSelectedConversation, showDir, restoreSavedConversation]);
    // Note: selectedGroupDir, selectedName, isGroupChat intentionally excluded to avoid infinite loops

    // Refresh messages when sync completes
    // DESIGN: Only depends on syncVersion - other dependencies intentionally excluded.
    // This effect uses the closure values at the time syncVersion changes, not the latest values.
    // Adding selectedGroupDir/isGroupChat/readState to deps would cause infinite loops
    // because fetchMessages updates state that these values depend on.
    useEffect(() => {
        if (syncVersion > 0 && selectedGroupDir) {
            // Hidden: the show effect below refreshes the room when Messages comes back.
            if (!featureActive) {
                clientLog('chat_load', { outcome: 'deferred', reason: 'hidden' });
                return;
            }
            fetchMessages(selectedGroupDir, isGroupChat);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
    }, [syncVersion]);

    // Shown again after another feature: restore the room of a group switch made while hidden (the
    // selection effect then loads it), else one background refresh (a 304 when nothing changed),
    // unless openChat is opening another room in this same step. It also lets the incoming call
    // evaluate, as the remount did before Messages was kept mounted.
    const wasActiveRef = useRef(featureActive);
    useEffect(() => {
        const was = wasActiveRef.current;
        wasActiveRef.current = featureActive;
        if (was || !featureActive) return;
        if (restoreOnShowRef.current) {
            restoreOnShowRef.current = false;
            restoreSavedConversation(activeService);
        } else if (selectedGroupDir && opensAnotherRoom()) {
            clientLog('chat_load', { outcome: 'skipped', reason: 'shown_with_other_room' });
        } else if (selectedGroupDir) {
            fetchMessages(selectedGroupDir, isGroupChat);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the hidden → shown edge only
    }, [featureActive]);

    // === FETCH MESSAGES (Load All) ===
    // limit=0 loads the whole room in one request. One AbortController per fetch: a newer fetch
    // aborts it (its result would be discarded anyway), and so does CHAT_LOAD_TIMEOUT_MS. A room
    // that never loaded then shows the timeout or failure state with Retry; a room already on
    // screen (a background refresh) is kept as it is, and the failure only leaves a breadcrumb.
    // While the room is not on screen yet (the skeleton may show), the result is held through
    // `settleDelay`, so a shown skeleton stays at least minVisible.
    // A cached room is asked with its ETag (`If-None-Match`). The author-set header also makes the
    // webview skip its HTTP cache, so an unchanged room answers 304 here and nothing is parsed or
    // set again (UI health #1); without it the browser revalidated on its own and handed us the
    // whole cached body. No `last_read_id`: unread is counted here, and the read position must not
    // change the room's ETag.
    const fetchMessages = async (path: string, groupChat: boolean) => {
        const thisId = ++fetchIdRef.current;
        fetchAbortRef.current?.abort();
        const controller = new AbortController();
        fetchAbortRef.current = controller;
        const holdForSkeleton = shownDirRef.current !== path;
        const carried = holdForSkeleton && roomWaitRef.current?.path === path ? roomWaitRef.current.startedAt : null;
        const startedAt = carried ?? Date.now();
        roomWaitRef.current = { path, startedAt };
        let timedOut = false;
        const deadline = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, Math.max(0, CHAT_LOAD_TIMEOUT_MS - (Date.now() - startedAt)));
        const isCurrent = () => thisId === fetchIdRef.current;
        /** Wait out the skeleton's min-visible time (cut short by an abort); false when a newer fetch took over. */
        const settle = async () => {
            const hold = holdForSkeleton ? settleDelay(Date.now() - startedAt) : 0;
            if (hold > 0 && !controller.signal.aborted) {
                await new Promise<void>((resolve) => {
                    const timer = setTimeout(resolve, hold);
                    controller.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve();
                    }, { once: true });
                });
            }
            return isCurrent();
        };
        setLoadFailure(null);
        let httpStatus: number | undefined;
        const knownEtag = messagesCacheRef.current.get(path)?.etag ?? null;
        try {
            const params = new URLSearchParams({ limit: '0' });
            // Add service parameter if available
            if (activeService) {
                params.set('service', activeService);
            }
            const url = groupChat
                ? `/api/content/group_messages/${encodeURIComponent(path)}?${params}`
                : `/api/content/messages_by_path?path=${encodeURIComponent(path)}&${params}`;
            const res = await fetch(url, {
                signal: controller.signal,
                headers: knownEtag ? { 'If-None-Match': knownEtag } : undefined,
            });
            if (!isCurrent()) return; // stale — a newer fetch superseded this one
            if (res.status === 304) {
                const cached = messagesCacheRef.current.get(path);
                if (!cached) {
                    // Evicted while the request ran: nothing to keep. Treated as a failed load.
                    httpStatus = 304;
                    throw new Error('room not modified but no longer cached');
                }
                if (!(await settle())) return; // stale
                if (shownDirRef.current !== path) {
                    setMembersMap(cached.membersMap);
                    setMessages(cached.messages);
                    setTotalMessages(cached.totalMessages);
                    setMaxMessageId(cached.maxMessageId);
                    setMessagesService(cached.service);
                    showDir(path);
                }
                setCacheEntry(path, cached); // most recently used
                // The room is confirmed current: the incoming-call hook evaluates on it, as on a 200.
                setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
                clientLog('chat_load', { outcome: 'not_modified' });
                return;
            }
            if (!res.ok) {
                httpStatus = res.status;
                throw new Error('room list request failed');
            }
            const etag = res.headers.get('ETag');
            let entry: MessageCacheEntry;
            if (groupChat) {
                const data = await res.json() as GroupMessagesResponse;
                const map: Record<string, MemberInfo> = {};
                for (const m of data.members) map[m.id] = m;
                entry = { messages: data.messages || [], membersMap: map, totalMessages: data.total_messages || 0, maxMessageId: data.max_message_id || 0, service: activeService!, etag };
            } else {
                const data = await res.json();
                const memberInfo = data.member as MemberInfo;
                entry = {
                    messages: data.messages || [],
                    membersMap: memberInfo ? { [memberInfo.id]: memberInfo } : {},
                    totalMessages: data.total_count || 0,
                    maxMessageId: data.max_message_id || 0,
                    service: activeService!,
                    etag,
                };
            }
            if (!(await settle())) return; // stale
            setMembersMap(entry.membersMap);
            setMessages(entry.messages);
            setFavoriteOverrides(prev => pruneFavoriteOverrides(prev, entry.messages));
            setTotalMessages(entry.totalMessages);
            setMaxMessageId(entry.maxMessageId);
            setMessagesService(activeService);
            showDir(path);
            setCacheEntry(path, entry);
            setFreshFetch(prev => ({ seq: (prev?.seq ?? 0) + 1, dir: path }));
        } catch {
            if (!isCurrent()) return; // superseded (and aborted): never a failure
            const kind: ChatLoadFailure = timedOut ? 'timeout' : 'error';
            const background = !holdForSkeleton;
            if (timedOut) logWait('chat_room', 'timeout', Date.now() - startedAt);
            // Codes only: never the path or the error text (the user sees translated copy).
            if (import.meta.env.DEV) console.warn('[MessagesFeature] fetchMessages failed', { groupChat, httpStatus, kind, background });
            // Production breadcrumb for both paths (the timeout also posts ui_wait): codes and the HTTP status only.
            clientLog('chat_load', {
                outcome: background ? 'kept_room' : 'error_state',
                reason: kind,
                ...(httpStatus === undefined ? {} : { error_code: httpStatus }),
            });
            // A background refresh never clears the room the user is reading (nor its scroll position);
            // the next sync or room visit refreshes it again.
            if (background) return;
            if (!(await settle())) return;
            setLoadFailure({ dir: path, kind });
            setMessages([]);
            showDir(null);
            setMembersMap({});
        } finally {
            clearTimeout(deadline);
            if (isCurrent()) roomWaitRef.current = null;
        }
    };

    // Retry after a failed room load (the timeline's failure state and the media gallery).
    const retryMessages = () => {
        if (selectedGroupDir) fetchMessages(selectedGroupDir, isGroupChat);
    };

    // === CHAT SELECTION ===
    // Applied while rendering (the "state from the previous render" pattern), never in an effect:
    // the first render of a newly selected room already has its read state and, when cached, its
    // messages with `messagesForDir === selectedGroupDir`, so a cached room never commits a frame
    // without its list (I1). Without cache, the messagesForDir guard hides the previous room and
    // the chat skeleton (StatusBlock) covers the wait: the timeline is never blank.
    const [appliedDir, setAppliedDir] = useState<string | undefined>(selectedGroupDir);
    if (appliedDir !== selectedGroupDir) {
        setAppliedDir(selectedGroupDir);
        setFavoriteOverrides(EMPTY_FAVORITES);
        if (selectedGroupDir) {
            setReadState(loadReadState(selectedGroupDir));
            const cached = messagesCacheRef.current.get(selectedGroupDir);
            if (cached) {
                setMessages(cached.messages);
                setMembersMap(cached.membersMap);
                setTotalMessages(cached.totalMessages);
                setMaxMessageId(cached.maxMessageId);
                setMessagesService(cached.service);
                setMessagesForDir(selectedGroupDir);
            }
        }
    }

    useLayoutEffect(() => {
        overridesRoomRef.current = selectedGroupDir;
    }, [selectedGroupDir]);

    useEffect(() => {
        if (selectedGroupDir) {
            // The ref mirror for fetchMessages (the state was set while rendering, above): a cached
            // room is on screen, so its fetch is a background refresh.
            if (messagesCacheRef.current.has(selectedGroupDir)) showDir(selectedGroupDir);
            if (featureActive) {
                fetchMessages(selectedGroupDir, isGroupChat);
            } else {
                // Hidden (a selection made by a search or a restore behind another feature): the
                // show effect refreshes it.
                clientLog('chat_load', { outcome: 'deferred', reason: 'hidden_select' });
            }
            setIsSidebarOpen(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchMessages is a per-render closure; featureActive is handled by the show effect
    }, [selectedGroupDir, isGroupChat, showDir]);

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
    const syncReadPrevRef = useRef<{ dir: string | undefined; on: boolean | undefined; active: boolean }>({
        dir: undefined,
        on: undefined,
        active: featureActive,
    });
    useEffect(() => {
        const on = appSettings?.sync_read_to_phone;
        const prev = syncReadPrevRef.current;
        if (!featureActive) {
            // Hidden: nothing is opened behind another feature. The room as last shown is kept, so
            // the show edge decides.
            if (selectedGroupDir && on && (selectedGroupDir !== prev.dir || prev.on === undefined)) {
                clientLog('chat_load', { outcome: 'deferred', reason: 'hidden_read_sync' });
            }
            syncReadPrevRef.current = { ...prev, active: false };
            return;
        }
        syncReadPrevRef.current = { dir: selectedGroupDir, on, active: true };
        if (!selectedGroupDir || !on) return;
        // Shown together with another room (openChat): the room as last shown is not opened (the show
        // effect logs it); the next render, with that room, counts as opening it.
        if (!prev.active && opensAnotherRoom()) return;
        // Shown again after another feature counts as opening the room.
        const roomOpened = selectedGroupDir !== prev.dir || !prev.active;
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
    }, [selectedGroupDir, appSettings?.sync_read_to_phone, featureActive, opensAnotherRoom]);

    // Unread navigation state logic
    const isUnread = useCallback((msgId: number) => {
        return msgId > readState.lastReadId && !revealedSet.has(msgId);
    }, [readState.lastReadId, revealedSet]);

    // One timeline for the list, the jumps, the restore and the unread arrows.
    const userNickname = messagesService ? appSettings?.user_nicknames?.[messagesService] : undefined;
    const displayMessages = useMemo(() => applyNickname(messages, userNickname), [messages, userNickname]);
    // Sent letters (local archive), the account profile and the member streak, asked only for a
    // room whose path is in the active service's folder (never the stale pair of a group switch).
    // Group chats have no letters and no streak. The streak (one official request per room per
    // local day) is shared by the header and the profile popup.
    // While hidden the extras keep the arguments of the room as last shown, so a finished sync or a
    // group switch made from another feature asks nothing (no letters, profile or once-a-day streak
    // request) and the shown room keeps its letters (no skeleton, no lost scroll position).
    const liveExtrasArgs = useMemo(
        () => ({ service: activeService, dir: selectedGroupDir, isGroupChat, syncVersion }),
        [activeService, selectedGroupDir, isGroupChat, syncVersion],
    );
    const [extrasArgs, setExtrasArgs] = useState(liveExtrasArgs);
    // Updated while rendering (the "adjust state on a prop change" pattern), so the render that shows
    // Messages again already asks for the current room.
    if (featureActive && extrasArgs !== liveExtrasArgs) setExtrasArgs(liveExtrasArgs);
    const roomExtras = useRoomExtras(extrasArgs.service, extrasArgs.dir, extrasArgs.isGroupChat, extrasArgs.syncVersion);
    const { streak, retryStreak } = roomExtras;
    // The one loading derivation: the timeline (skeleton, failure) and the gallery's list state.
    const chatLoad = deriveChatLoad({
        selectedGroupDir,
        messagesForDir,
        messageCount: messages.length,
        lettersReady: roomExtras.lettersReady,
        failure: loadFailure && loadFailure.dir === selectedGroupDir ? loadFailure.kind : null,
    });
    // Display only (the derivation above stays the one rule): once the skeleton has shown, keep it
    // minVisible even when the letters, not the fetch, end the wait. Scoped to the room the hold
    // revealed for (recorded when the hold turns on), so a hold that started for room X never covers
    // room Y: a cached room opened during it renders at once (I1).
    const waitHeld = useDelayedLoading(chatLoad.chatWaiting);
    const [waitDir, setWaitDir] = useState<string | undefined>();
    const [heldBefore, setHeldBefore] = useState(false);
    if (waitHeld !== heldBefore) {
        setHeldBefore(waitHeld);
        setWaitDir(waitHeld ? selectedGroupDir : undefined);
    }
    const showWait = !chatLoad.failure && (chatLoad.chatWaiting || (waitHeld && waitDir === selectedGroupDir));
    // The room's message list is on screen (not its wait, skeleton or an empty room).
    const listShown = Boolean(
        selectedGroupDir && messages.length > 0 && messagesService && messagesForDir === selectedGroupDir
        && roomExtras.lettersReady && !showWait,
    );
    // Milestone cards (spec §9, decision D10): member chats only; counts only once loaded for this room.
    // None while hidden: the room's open ends, as the unmount did; the show edge opens it again.
    const milestone = useMilestone({
        roomKey: featureActive && selectedGroupDir && messagesService && !isGroupChat ? `${messagesService}|${selectedGroupDir}` : null,
        totalMessages: selectedGroupDir && messagesForDir === selectedGroupDir ? totalMessages : null,
        streakDays: streak.status === 'ready' ? streak.days : null,
    });
    // What the ConversationMenu dialogs list (favourites, media): the stars as the user sees them.
    const menuMessages = useMemo(() => applyFavoriteOverrides(displayMessages, favoriteOverrides), [displayMessages, favoriteOverrides]);
    const timeline = useMemo(() => buildTimeline(displayMessages, roomExtras.letters), [displayMessages, roomExtras.letters]);
    const letterAvatar = useMemo(
        () => letterAvatars(roomExtras.letters, roomExtras.profile?.avatars ?? []),
        [roomExtras.letters, roomExtras.profile],
    );
    // Breadcrumbs, once per room visit: how each letter's avatar was chosen, and dropped letters.
    useLetterBreadcrumbs(roomExtras.lettersRoomKey, letterAvatar, roomExtras.profile !== null, timeline.droppedLetters);
    const letterUserName = roomExtras.profile?.name || userNickname || t('letters.you');

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

    // The conversation cache recovered after a failed startup load. A chat opened
    // meanwhile holds a state derived from the empty fallback; merge the now-loaded
    // row into it (monotonic, never backwards) so its next reveal cannot write the
    // fallback-derived state over stored progress. Then re-read unread counts.
    // Order matters: readStateStore (imported above) registered its flush listener at
    // import time, before this effect subscribes, so deferred saves are written first.
    const recoveryRef = useRef({ selectedGroupDir, mergeLoadedReadState });
    useLayoutEffect(() => {
        recoveryRef.current = { selectedGroupDir, mergeLoadedReadState };
    });
    useEffect(() => persisted.onConversationsReady(() => {
        const cur = recoveryRef.current;
        if (cur.selectedGroupDir) cur.mergeLoadedReadState(loadReadState(cur.selectedGroupDir));
        setReadStateVersion((v) => v + 1);
    }), []);

    const revealAllMessages = useCallback(() => {
        if (maxMessageId === 0) return;
        const next: ReadState = { lastReadId: maxMessageId, readCount: totalMessages, revealedIds: [] };
        if (selectedGroupDir) saveAndBump(selectedGroupDir, next);
        setReadState(next);
    }, [selectedGroupDir, maxMessageId, totalMessages, saveAndBump]);

    // === HELPERS ===

    const handleSelectGroup = useCallback((groupDir: string, groupChat: boolean, displayName: string) => {
        // Choosing a conversation, the current one too, closes the narrow overlay.
        setIsSidebarOpen(false);
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
    }, [selectedGroupDir, activeService, setSelectedConversation]);

    // Chat avatars (message runs, letters, header; the viewer's voice player reuses the sender's)
    // are drawn at 36-40 CSS px: request the resized variant matched to the screen. The profile
    // card (192 CSS px) keeps the full-size image.
    const chatAvatarPx = useAvatarWidth(CHAT_AVATAR_CSS_PX);

    // The 1:1 room's member: header avatar, the ⋯ menu and the profile popup.
    const headerMember = Object.values(membersMap)[0];
    const headerAvatar = memberImageUrl(headerMember, 'thumbnail') || headerMember?.portrait || undefined;
    const headerAvatarSmall = resizedAvatarUrl(headerAvatar, chatAvatarPx);
    const isLightHeader = groupTokens[serviceGroupId(activeService)].official.headerStyle === 'light';

    const getSenderInfo = useCallback((msg: GroupMessage) => {
        const memberInfo = (isGroupChat && msg.member_id) ? membersMap[msg.member_id] : Object.values(membersMap)[0];
        return {
            name: formatName(msg.member_name || memberInfo?.name || selectedName || 'Unknown'),
            avatar: resizedAvatarUrl(
                memberImageUrl(memberInfo, 'thumbnail') || memberInfo?.portrait || memberImageUrl(memberInfo, 'phone_image'),
                chatAvatarPx,
            ),
        };
    }, [isGroupChat, membersMap, selectedName, chatAvatarPx]);

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

    // Stable props for the memoised list and sidebar.
    const openRevealConfirm = useCallback(() => setShowRevealConfirm(true), []);
    const openMemberProfile = useCallback(() => setShowMemberProfile(true), []);
    const clearTargetMessage = useCallback(() => setTargetMessageId(null), [setTargetMessageId]);
    const milestoneFooter = useMemo(() => (milestone ? <MilestoneFooter milestone={milestone} /> : undefined), [milestone]);

    // The letter viewer opened from a timeline letter (walks the timeline's letters chronologically);
    // cleared on a room switch. Its jump, like the Sent letters dialog's, focuses the timeline after.
    const timelineRef = useRef<HTMLDivElement>(null);
    const letterViewer = useTimelineLetterViewer(selectedGroupDir, jumpToLetter, timelineRef);
    const openLetterViewer = letterViewer.open;
    const renderLetter = useCallback((letter: Letter) => (
        <LetterRow
            letter={letter}
            avatarUrl={resizedAvatarUrl(letterAvatar.byId.get(letter.id), chatAvatarPx) ?? null}
            userName={letterUserName}
            onOpenImage={openLetterViewer}
        />
    ), [letterAvatar, letterUserName, openLetterViewer, chatAvatarPx]);

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
        // Hidden: off (a ringing call ends, as when the feature unmounted); undefined until settings
        // load → no ring; a loaded value without the field defaults on.
        enabled: !featureActive ? false : appSettings ? (appSettings.incoming_call_enabled ?? true) : undefined,
        isUnread,
        freshFetch,
        revealMessage,
        scrollToMessage,
        logContext: selectedGroupDir ? parseReadStatePath(selectedGroupDir) : null,
        isCallElsewhere,
    });
    // Hidden: no chat is reported as viewed, so its notifications come through.
    useUiStateReporter(featureActive ? selectedGroupDir : undefined);
    const callActive = incomingCall.phase !== 'idle';
    // The list under an in-frame call is covered by it: no focus and no virtual cursor there.
    const listWrapRef = useRef<HTMLDivElement>(null);
    useInert(listWrapRef, callActive);
    // The unread arrows float over the list only: never over the room's wait, skeleton or failure
    // (N4: at 960×640 the down arrow sat over the loading skeleton), nor over a call.
    const unreadArrows = listShown && !chatLoad.failure && !callActive;

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

    // Toggle favorite status: optimistic in `favoriteOverrides` (no timeline rebuild), then the API.
    const handleToggleFavorite = useCallback(async (messageId: number, currentState: boolean) => {
        if (!activeService) {
            // Defensive: the list only renders with a service, so no UI path reaches this (untestable).
            // Breadcrumb: ids and a code only.
            clientLog('chat_load', { outcome: 'favorite_no_service', message_id: messageId });
            return;
        }
        const room = overridesRoomRef.current;
        setFavoriteOverrides(prev => withFavorite(prev, messageId, !currentState));

        // setFavorite resolves false on an HTTP error, a network failure or a
        // 200 with {success: false} (SD-CONTRACT-01), so a favourite that was
        // never saved never keeps its optimistic star.
        const saved = await setFavorite(activeService, messageId, !currentState);
        if (!saved) {
            // Revert on failure (unless the user already left that room: its overrides are gone).
            if (overridesRoomRef.current === room) {
                setFavoriteOverrides(prev => withFavorite(prev, messageId, currentState));
            }
            // Breadcrumb: ids and a code only.
            clientLog('chat_load', { outcome: 'favorite_save_failed', message_id: messageId });
            console.error('Failed to toggle favorite');
            return;
        }
        if (room) patchCachedFavorite(room, messageId, !currentState);
    }, [activeService, patchCachedFavorite]);

    return (
        <div className="flex h-full w-full overflow-hidden">
            {/* Member sidebar on the canvas (level 0), next to the feature rail. Below md it slides in over the chat. */}
            <div ref={sidebarRef} tabIndex={sidebarOverlay ? -1 : undefined} className={cn(
                // Focusable only as the narrow overlay, where focus lands here when nothing in it is
                // tabbable: the keyboard ring, none for the mouse.
                'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                'fixed inset-y-0 left-0 z-30 transform transition-transform duration-base ease-standard',
                'max-md:bg-group-canvas md:relative md:translate-x-0',
                isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}>
                <MemberList
                    onSelectGroup={handleSelectGroup}
                    selectedGroupDir={selectedGroupDir}
                    activeService={activeService || undefined}
                    isSyncing={isSyncing}
                    readStateVersion={readStateVersion}
                    onSyncNow={onSyncNow}
                    paused={!featureActive}
                />
            </div>

            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-20 bg-scrim md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Main Chat Area */}
            <div ref={chatRef} className="contents">
            <ContentSheet className="relative">
                {/* Header: the official title layer (gradient, or Sakurazaka's white header + thin bar) */}
                <header
                    className={cn(
                        'z-20 flex h-16 shrink-0 items-center gap-3 px-4',
                        isLightHeader ? 'bg-sheet text-group-title' : 'bg-group-title text-inverse',
                    )}
                >
                    <IconButton
                        ref={sidebarToggleRef}
                        className="text-current md:hidden"
                        aria-label={t('messageList.openConversations')}
                        icon={<Menu />}
                        onClick={() => setIsSidebarOpen(true)}
                    />
                    {selectedGroupDir && !isGroupChat && (
                        <Avatar src={headerAvatarSmall} name={selectedName || ''} size="md" className="ring-2 ring-surface" />
                    )}
                    <div className="min-w-0 flex-1">
                        <h2 lang={selectedName ? 'ja' : undefined} className="truncate text-title font-semibold">{selectedName || t('messageList.selectConversation')}</h2>
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
                    <SyncStatusPill light={isLightHeader} />
                    {selectedGroupDir && (
                        <ConversationMenu
                            conversationPath={selectedGroupDir}
                            isGroupChat={isGroupChat}
                            messages={menuMessages}
                            messagesStatus={chatLoad.listStatus}
                            onRetryMessages={retryMessages}
                            memberName={selectedName || ''}
                            memberAvatar={headerAvatar}
                            letters={roomExtras.letters}
                            lettersStatus={roomExtras.lettersStatus}
                            onJumpToLetter={letterViewer.jump}
                            activeService={activeService || undefined}
                            onOpenCalendar={openCalendar}
                            onBackgroundChange={setBackgroundSettings}
                            light={isLightHeader}
                            unreadCount={displayUnreadCount}
                            onRevealAll={openRevealConfirm}
                        />
                    )}
                </header>

                {isLightHeader && <div className="h-1 shrink-0 bg-group-title-bar" />}

                <FadeOnChange changeKey={selectedGroupDir} className="flex min-h-0 flex-1 flex-col">
                {/* Virtualized Timeline */}
                <div
                    ref={timelineRef}
                    data-testid="chat-timeline"
                    className="flex-1 overflow-hidden relative isolate"
                    role="region"
                    aria-label={t('messageList.timeline')}
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
                        <div className="absolute inset-0 flex items-center justify-center">
                            <EmptyState icon={<MessageCircle />} title={t('messageList.welcomeTitle')} description={t('messageList.welcomeSubtitle')} />
                        </div>
                    )}

                    {showWait && (
                        // Keyed by room: a new room starts its own wait (reveal, slow, very slow).
                        // `min-h-0` bounds the flex-1 box by the pane (else min-height: auto keeps the
                        // skeleton's full height), so in a short window the skeleton shrinks and the
                        // slow line, the explanation and the bar stay above the fold (D-L2).
                        <div key={selectedGroupDir} className="absolute inset-0 flex flex-col">
                            <StatusBlock
                                kind="loading"
                                variant="pane"
                                surface="chat_room"
                                className="min-h-0 items-stretch justify-start px-0 pt-0"
                                skeleton={<ChatSkeleton />}
                                label={t('messageList.loadingMessages')}
                                slowHint={t('messageList.loadingSlow')}
                                verySlowHint={t('messageList.loadingVerySlow')}
                            />
                        </div>
                    )}
                    {chatLoad.empty && !showWait && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <EmptyState icon={<MessageCircle />} title={t('messageList.emptyRoom')} />
                        </div>
                    )}
                    {chatLoad.failure && (
                        <div className="absolute inset-0 flex flex-col">
                            {chatLoad.failure === 'timeout' ? (
                                <StatusBlock
                                    kind="timeout"
                                    variant="pane"
                                    surface="chat_room"
                                    title={t('messageList.loadTimeout')}
                                    hint={t('messageList.loadTimeoutHint')}
                                    onRetry={retryMessages}
                                />
                            ) : (
                                <StatusBlock
                                    kind="error"
                                    variant="pane"
                                    surface="chat_room"
                                    icon={<CloudOff />}
                                    title={t('messageList.loadFailed')}
                                    hint={t('messageList.loadFailedHint')}
                                    onRetry={retryMessages}
                                />
                            )}
                        </div>
                    )}

                    <div ref={listWrapRef} className="contents">
                    {listShown && selectedGroupDir && messagesService && (
                        <MessageList
                            memberId={selectedGroupDir}
                            timeline={timeline}
                            getSenderInfo={getSenderInfo}
                            isUnread={isUnread}
                            onReveal={revealMessage}
                            onLongPress={openRevealConfirm}
                            onRangeChanged={updateUnreadNavState}
                            virtuosoRef={virtuosoRef}
                            scrollerRef={setChatScroller}
                            userNickname={userNickname}
                            onToggleFavorite={handleToggleFavorite}
                            favoriteOverrides={favoriteOverrides}
                            onAvatarClick={openMemberProfile}
                            onMediaClick={handleMediaClick}
                            service={messagesService}
                            targetMessageId={targetMessageId}
                            onTargetMessageConsumed={clearTargetMessage}
                            onJumpToMessage={jumpToTargetMessage}
                            highlightedRowKey={highlightedRowKey}
                            getMemberPath={getMemberPath}
                            onOpenCalendar={openCalendar}
                            renderLetter={renderLetter}
                            footer={milestoneFooter}
                        />
                    )}
                    </div>
                    <CallOverlay
                        call={incomingCall}
                        // The accent follows the chat's group context (--ds-accent); light-style services (櫻坂) get a white answer button.
                        answerStyle={isLightHeader ? 'light' : 'solid'}
                        groupLabel={messagesService ? getServiceDisplayName(messagesService) : ''}
                    />
                </div>
                </FadeOnChange>

                {/* Navigation Buttons */}
                {/* Up arrow: bottom-right, when the oldest unread is ABOVE the view */}
                {unreadArrows && hasUnreadAbove && (
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
                {unreadArrows && hasUnreadBelow && (
                    <IconButton
                        variant="accent"
                        className="absolute right-4 top-20 z-20"
                        aria-label={t('messageList.jumpToOldestUnread')}
                        title={t('messageList.jumpToOldestUnread')}
                        icon={<ChevronDown className="h-5 w-5" />}
                        onClick={scrollToFirstUnread}
                    />
                )}

                {/* Reveal all: an in-app confirm, focus starts on Cancel like every other confirm. */}
                <ConfirmDialog
                    open={showRevealConfirm}
                    title={t('messageList.revealAllTitle')}
                    message={t('messageList.revealAllDescription', { count: displayUnreadCount })}
                    confirmLabel={t('messageList.confirm')}
                    variant="default"
                    logId="reveal_all"
                    onCancel={() => setShowRevealConfirm(false)}
                    onConfirm={() => {
                        revealAllMessages();
                        setShowRevealConfirm(false);
                    }}
                />
            </ContentSheet>
            </div>

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
            {/* Letter viewer (image and full text), opened from a letter in the timeline */}
            <LetterViewerModal
                letters={timeline.letters}
                letterId={letterViewer.letterId}
                order="oldest_first"
                source="timeline"
                onNavigate={letterViewer.navigate}
                onClose={letterViewer.close}
                onJump={letterViewer.jump}
            />
        </div>
    );
};
