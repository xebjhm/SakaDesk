import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Message, MemberInfo } from './types'
import { Sidebar } from './components/Sidebar'
import { ChatList } from './components/ChatList'
import { LoginPage } from './pages/LoginPage'
import { Menu, Loader2, ChevronUp, ChevronDown, Download, FolderOpen } from 'lucide-react'
import { DiagnosticsModal } from './components/DiagnosticsModal'
import { ReportIssueModal } from './components/ReportIssueModal'
import { AboutModal } from './components/AboutModal'
import { ErrorBoundary } from './components/ErrorBoundary'
import { UpdateBanner } from './components/UpdateBanner'
import { ChatHeaderMenu } from './components/ChatHeaderMenu'
import { VirtuosoHandle } from 'react-virtuoso'

interface GroupMessage extends Message {
    member_id?: string;
    member_name?: string;
}

interface GroupMessagesResponse {
    group_dir: string;
    total_messages: number;
    max_message_id: number;
    members: MemberInfo[];
    messages: GroupMessage[];
}

interface ReadState {
    lastReadId: number;
    readCount: number;
    revealedIds: number[];
}

interface SyncProgress {
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

interface AppSettings {
    output_dir: string;
    auto_sync_enabled: boolean;
    sync_interval_minutes: number;
    adaptive_sync_enabled?: boolean;
    is_configured: boolean;
    user_nickname?: string;
    notifications_enabled?: boolean;
}

const formatTime = (seconds: number | undefined): string => {
    if (!seconds || seconds <= 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m >= 60) {
        const h = Math.floor(m / 60);
        return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const formatSpeed = (speed: number | null | undefined, unit: string): string => {
    if (!speed || speed <= 0) return '';
    return `${speed.toFixed(2)} ${unit}/s`;
};

function App() {
    // Auth state
    const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
    const [authError, setAuthError] = useState<string | null>(null);

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
    const [backgroundSettings, setBackgroundSettings] = useState<{
        type: 'default' | 'color' | 'image';
        imageData?: string;
        color: string;
        opacity: number;
    }>({ type: 'default', color: '#E2E6EB', opacity: 100 });

    // Compute unread count from messages and readState (single source of truth)
    // This ensures header and sidebar use the same logic
    const displayUnreadCount = useMemo(() => {
        return messages.filter(m => m.id > readState.lastReadId && !readState.revealedIds.includes(m.id)).length;
    }, [messages, readState.lastReadId, readState.revealedIds]);

    // Scroll ref
    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Sync state
    const [syncProgress, setSyncProgress] = useState<SyncProgress>({ state: 'idle' });
    const [showSyncModal, setShowSyncModal] = useState(false);
    const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isPollingRef = useRef(false);
    const visibleRangeRef = useRef<{ startIndex: number; endIndex: number }>({ startIndex: 0, endIndex: 0 });

    // Nav button state
    const [hasUnreadAbove, setHasUnreadAbove] = useState(false);
    const [hasUnreadBelow, setHasUnreadBelow] = useState(false);

    // Sync Progress Ref for fresh access in closures (Fixes Jumping Bug)
    const syncProgressRef = useRef(syncProgress);
    useEffect(() => { syncProgressRef.current = syncProgress; }, [syncProgress]);

    // Settings state
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showSetupWizard, setShowSetupWizard] = useState(false);
    const [outputDirInput, setOutputDirInput] = useState('');
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    // Bug report state
    const [showReportModal, setShowReportModal] = useState(false);
    const [crashError, setCrashError] = useState<string | undefined>();

    // About modal state
    const [showAboutModal, setShowAboutModal] = useState(false);

    // === AUTH ===
    useEffect(() => {
        checkAuth();
    }, []);

    const checkAuth = async () => {
        try {
            const res = await fetch('/api/auth/status');
            const data = await res.json();
            setIsAuthenticated(data.is_authenticated);
            if (data.token_expired) {
                setAuthError("Session expired. Please login again.");
            }
        } catch (e) {
            setIsAuthenticated(false);
        }
    };

    // === STARTUP SYNC ===
    const hasStartedSyncRef = useRef(false);

    useEffect(() => {
        if (isAuthenticated && appSettings && !hasStartedSyncRef.current) {
            hasStartedSyncRef.current = true; // Only start once per session

            // Check if this is a fresh install (show modal only for fresh)
            fetch('/api/settings/fresh')
                .then(res => res.json())
                .then(data => {
                    if (data.is_fresh) {
                        // Fresh install: show modal
                        startSync(true);
                    } else {
                        // Incremental: background sync
                        startSync(false);
                    }
                })
                .catch(() => startSync(false));

            // Periodic sync based on settings
            if (appSettings.auto_sync_enabled) {
                const intervalMs = appSettings.sync_interval_minutes * 60 * 1000;
                syncIntervalRef.current = setInterval(() => {
                    startSync(false);
                }, intervalMs);
            }

            return () => {
                if (syncIntervalRef.current) {
                    clearInterval(syncIntervalRef.current);
                }
            };
        }
    }, [isAuthenticated, appSettings]);

    // Load settings on auth
    useEffect(() => {
        if (isAuthenticated) {
            fetch('/api/settings')
                .then(res => res.json())
                .then(data => {
                    setAppSettings(data);
                    setOutputDirInput(data.output_dir);
                    if (!data.is_configured) {
                        setShowSetupWizard(true);
                    }
                    // If no cached nickname, fetch from profile API
                    if (!data.user_nickname) {
                        fetch('/api/profile')
                            .then(res => res.json())
                            .then(profileData => {
                                if (profileData.nickname) {
                                    // Update local state with the fetched nickname
                                    setAppSettings(prev => prev ? { ...prev, user_nickname: profileData.nickname } : prev);
                                }
                            })
                            .catch(console.error);
                    }
                })
                .catch(console.error);
        }
    }, [isAuthenticated]);

    // Refresh user profile (nickname) from server - called after sync completes
    const refreshUserProfile = async () => {
        try {
            const res = await fetch('/api/profile/refresh', { method: 'POST' });
            const data = await res.json();
            if (data.nickname) {
                setAppSettings(prev => prev ? { ...prev, user_nickname: data.nickname } : prev);
            }
        } catch (e) {
            console.error('Failed to refresh profile:', e);
        }
    };

    const startSync = async (blocking: boolean) => {
        if (blocking) setShowSyncModal(true);

        // Fix Jumping Bug: Don't reset state if already running
        // Use Ref for fresh state
        if (syncProgressRef.current.state !== 'running') {
            setSyncProgress({ state: 'running', phase: 'starting', phase_name: 'Starting', detail: 'Initializing...' });
        }

        try {
            await fetch('/api/sync/start', { method: 'POST' });
            // If 400, it's already running.
            pollSyncProgress(blocking);
        } catch (e) {
            // Only set error if we weren't already running
            if (syncProgressRef.current.state !== 'running') {
                setSyncProgress({ state: 'error', detail: 'Failed to start sync' });
            }
        }
    };

    const pollSyncProgress = async (blocking: boolean) => {
        // Fix duplicate loops
        if (isPollingRef.current) return;
        isPollingRef.current = true;

        const check = async () => {
            try {
                const res = await fetch('/api/sync/progress');
                const data = await res.json();

                if (data.state === 'idle') {
                    setSyncProgress({ state: 'idle' });
                    isPollingRef.current = false; // Stop polling
                    if (blocking) setShowSyncModal(false);
                    // Refresh current chat if open
                    if (selectedGroupDir) {
                        fetchMessages(selectedGroupDir, isGroupChat);
                    }
                    // Refresh user profile (nickname may have changed)
                    refreshUserProfile();
                } else if (data.state === 'complete') {
                    // Show completion state, keep modal open briefly
                    setSyncProgress({
                        state: 'idle',  // Use idle for UI but handle specially
                        phase: 'complete',
                        phase_name: 'Complete',
                        phase_number: 4,
                        completed: data.total || data.completed,
                        total: data.total,
                        elapsed_seconds: data.elapsed_seconds,
                        eta_seconds: 0,
                        speed: data.speed,
                        speed_unit: data.speed_unit,
                        detail: 'Sync complete!',
                        detail_extra: ''
                    });
                    isPollingRef.current = false; // Stop polling
                    // Refresh current chat
                    if (selectedGroupDir) {
                        fetchMessages(selectedGroupDir, isGroupChat);
                    }
                    // Refresh user profile (nickname may have changed)
                    refreshUserProfile();
                    // Auto-close after 2 seconds
                    if (blocking) {
                        setTimeout(() => setShowSyncModal(false), 2000);
                    }
                } else if (data.state === 'running') {
                    setSyncProgress({
                        state: 'running',
                        phase: data.phase,
                        phase_name: data.phase_name,
                        phase_number: data.phase_number,
                        completed: data.completed,
                        total: data.total,
                        elapsed_seconds: data.elapsed_seconds,
                        eta_seconds: data.eta_seconds,
                        speed: data.speed,
                        speed_unit: data.speed_unit,
                        detail: data.detail,
                        detail_extra: data.detail_extra
                    });
                    setTimeout(check, 1000);
                } else if (data.state === 'error') {
                    // Check for session expired error - redirect to login
                    if (data.detail === 'SESSION_EXPIRED') {
                        setIsAuthenticated(false);
                        setAuthError("Session expired. Please login again.");
                        hasStartedSyncRef.current = false;  // Allow sync after re-login
                    } else {
                        setSyncProgress({ state: 'error', detail: data.detail || 'Sync error' });
                    }
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                } else {
                    setSyncProgress({ state: 'error', detail: data.detail || 'Unknown error' });
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                }
            } catch {
                if (syncProgressRef.current.state === 'running') {
                    // Retry on connection error if we thought we were running
                    setTimeout(check, 1000);
                } else {
                    setSyncProgress({ state: 'error', detail: 'Lost connection' });
                    isPollingRef.current = false;
                    if (blocking) setShowSyncModal(false);
                }
            }
        };
        check();
    };

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
        } catch (err: any) {
            setError(err.message);
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
    }, [messages, readState]);

    useEffect(() => {
        updateUnreadNavState();
    }, [updateUnreadNavState]);

    // Keyboard navigation using Virtuoso
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Home') {
            e.preventDefault();
            e.stopPropagation();
            // All messages are already loaded, scroll to top
            virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto' });
        } else if (e.key === 'End') {
            e.preventDefault();
            e.stopPropagation();
            virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'auto' });
        }
    }, [messages.length, totalMessages, selectedGroupDir, isGroupChat, readState.lastReadId]);

    // === READ STATE ===
    const loadReadState = (path: string): ReadState => {
        try {
            const saved = localStorage.getItem(`read_state_${path}`);
            return saved ? JSON.parse(saved) : { lastReadId: 0, readCount: 0, revealedIds: [] };
        } catch { }
        return { lastReadId: 0, readCount: 0, revealedIds: [] };
    };

    const saveReadState = (path: string, state: ReadState) => {
        try {
            localStorage.setItem(`read_state_${path}`, JSON.stringify(state));
            // Increment version to trigger sidebar refresh
            setReadStateVersion(v => v + 1);
        } catch { }
    };

    const isUnread = (msgId: number) => msgId > readState.lastReadId && !readState.revealedIds.includes(msgId);

    const revealMessage = useCallback((msgId: number) => {
        setReadState(prev => {
            if (prev.revealedIds.includes(msgId)) return prev;

            // Add the new revealed ID
            const newRevealedIds = [...prev.revealedIds, msgId];

            // Consolidate: If all messages from lastReadId+1 up to some point are now revealed,
            // advance lastReadId and remove those IDs from revealedIds.
            // This keeps revealedIds small and lastReadId accurate.

            // Get all message IDs above lastReadId, sorted
            const unreadMsgIds = messages
                .map(m => m.id)
                .filter(id => id > prev.lastReadId)
                .sort((a, b) => a - b);

            // Find where the contiguous "all read" sequence ends
            let newLastReadId = prev.lastReadId;

            for (const id of unreadMsgIds) {
                if (newRevealedIds.includes(id)) {
                    // Check if all previous IDs are also read
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
        // Use maxMessageId to mark ALL messages as read
        if (maxMessageId === 0) return;
        const next: ReadState = { lastReadId: maxMessageId, readCount: totalMessages, revealedIds: [] };
        if (selectedGroupDir) saveReadState(selectedGroupDir, next);
        setReadState(next);
    }, [selectedGroupDir, maxMessageId, totalMessages]);

    // === HELPERS ===
    const formatName = (name: string) => name.replace(/_/g, ' ');

    const handleSelectGroup = (groupDir: string, groupChat: boolean, displayName: string) => {
        if (selectedGroupDir !== groupDir) {
            // Scroll position is automatically saved via rangeChanged (debounced)
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

    const getSenderInfo = (msg: GroupMessage) => {
        const memberInfo = (isGroupChat && msg.member_id) ? membersMap[msg.member_id] : Object.values(membersMap)[0];
        return {
            name: formatName(msg.member_name || memberInfo?.name || selectedName || 'Unknown'),
            avatar: memberInfo?.thumbnail || memberInfo?.portrait || memberInfo?.phone_image
        };
    };

    const scrollToFirstUnread = useCallback(() => {
        // All messages are loaded - scroll to first unread directly
        const index = messages.findIndex(m => m.id > readState.lastReadId && !readState.revealedIds.includes(m.id));
        if (index !== -1) {
            virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
        }
    }, [messages, readState]);

    // Scroll to first message of a given date (for calendar navigation)
    const scrollToDate = useCallback((dateStr: string) => {
        // Find first message on the given date
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

    const saveSettings = async (updates: Partial<AppSettings>): Promise<boolean> => {
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) throw new Error("Failed to save");
            const data = await res.json();
            setAppSettings(data);
            setOutputDirInput(data.output_dir);
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            setError("Failed to save settings");
            return false;
        }
    };



    const handleSelectFolder = async () => {
        try {
            const res = await fetch('/api/settings/select-folder', { method: 'POST' });
            const data = await res.json();
            if (data.path) {
                setOutputDirInput(data.path);
            } else if (data.error) {
                console.warn("Folder picker unavailable:", data.error);
                // In production, we could show a toast here.
            }
        } catch (e) {
            console.error(e);
        }
    };


    // === RENDER ===
    if (isAuthenticated === null) {
        return <div className="h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-blue-500" /></div>;
    }
    if (isAuthenticated === false) {
        return <LoginPage onLoginSuccess={() => setIsAuthenticated(true)} initialError={authError || undefined} />;
    }

    // Dynamic Unit Label
    const getUnitLabel = () => {
        if (syncProgress.phase_number === 2) return 'members';
        if (syncProgress.phase_number === 3) return 'files';
        return 'items';
    };

    return (
        <div className="flex flex-col h-screen bg-[#F0F2F5] font-sans overflow-hidden">
            {/* Update Banner */}
            <UpdateBanner />

            <div className="flex flex-1 overflow-hidden">
            {/* Sync Modal - CLI Style */}
            {showSyncModal && (
                <div className="fixed inset-0 bg-gradient-to-br from-slate-900/90 to-slate-800/90 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
                        {/* Header - Chat Room Style */}
                        <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                                    <Download className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">
                                        Phase {syncProgress.phase_number || 1}: {syncProgress.phase_name || 'Starting'}
                                    </h3>
                                    <p className="text-sm text-white/80">
                                        {syncProgress.total ? `${syncProgress.total.toLocaleString()} ${getUnitLabel()}` : 'Please wait...'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-5">
                            {/* Progress Bar */}
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-gray-600 font-medium">
                                        {syncProgress.completed?.toLocaleString() || 0} / {syncProgress.total?.toLocaleString() || 0}
                                    </span>
                                    <span className="text-gray-900 font-semibold">
                                        {syncProgress.total && syncProgress.total > 0
                                            ? `${Math.round(((syncProgress.completed || 0) / syncProgress.total) * 100)}%`
                                            : '0%'
                                        }
                                    </span>
                                </div>
                                <div className="h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner">
                                    <div
                                        className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-indigo-500 transition-all duration-300 ease-out rounded-full relative"
                                        style={{
                                            width: syncProgress.total && syncProgress.total > 0
                                                ? `${((syncProgress.completed || 0) / syncProgress.total) * 100}%`
                                                : '0%'
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20" />
                                    </div>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <div className="text-xs text-gray-500 mb-1">Elapsed</div>
                                    <div className="text-lg font-mono font-semibold text-gray-900">
                                        {formatTime(syncProgress.elapsed_seconds)}
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <div className="text-xs text-gray-500 mb-1">ETA</div>
                                    <div className="text-lg font-mono font-semibold text-gray-900">
                                        {syncProgress.eta_seconds ? formatTime(syncProgress.eta_seconds) : '--:--'}
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <div className="text-xs text-gray-500 mb-1">Speed</div>
                                    <div className="text-lg font-mono font-semibold text-gray-900">
                                        {formatSpeed(syncProgress.speed, syncProgress.speed_unit || 'it')}
                                    </div>
                                </div>
                            </div>

                            {/* Current Item Detail or Warning */}
                            <div className={`rounded-xl px-4 py-3 flex items-center ${syncProgress.phase_number === 3 ? 'bg-amber-50 border border-amber-100 justify-center' : 'bg-blue-50'
                                }`}>
                                {syncProgress.phase_number === 3 ? (
                                    <div className="flex items-center gap-2 text-amber-700">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm font-medium">
                                            Downloading media... Please do not close the app.
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                                        <span className="text-sm text-gray-700 font-medium truncate">
                                            {/* Old Style Alignment: Combined Detail */}
                                            {syncProgress.detail || "Processing..."}
                                            {syncProgress.detail_extra && ` ${syncProgress.detail_extra}`}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Phase Dots */}
                            <div className="flex justify-center gap-3 pt-2">
                                {[
                                    { phase: 'scanning', label: 'Scan' },
                                    { phase: 'syncing', label: 'Sync' },
                                    { phase: 'downloading', label: 'Download' }
                                ].map((p) => {
                                    const currentPhaseIndex = ['scanning', 'discovering', 'syncing', 'downloading'].indexOf(syncProgress.phase || '');
                                    const thisPhaseIndex = ['scanning', 'discovering', 'syncing', 'downloading'].indexOf(p.phase);
                                    const isActive = syncProgress.phase === p.phase || (p.phase === 'scanning' && syncProgress.phase === 'discovering');
                                    const isComplete = currentPhaseIndex > thisPhaseIndex;

                                    return (
                                        <div key={p.phase} className="flex flex-col items-center gap-1">
                                            <div
                                                className={`w-3 h-3 rounded-full transition-all ${isActive ? 'bg-blue-500 ring-4 ring-blue-100' :
                                                    isComplete ? 'bg-green-500' :
                                                        'bg-gray-200'
                                                    }`}
                                            />
                                            <span className={`text-xs ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
                                                {p.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Setup Wizard (First Time) */}
            {showSetupWizard && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
                        {/* Changed Header to match Sync Modal (Blue/Purple Gradient) - requested by user */}
                        <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-5">
                            <div className="flex items-center gap-3">
                                <FolderOpen className="w-8 h-8 text-white" />
                                <div>
                                    <h3 className="text-xl font-bold text-white">Welcome to HakoDesk</h3>
                                    <p className="text-sm text-white/80">Let's set up your data folder</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Output Folder Path
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={outputDirInput}
                                        onChange={(e) => setOutputDirInput(e.target.value)}
                                        placeholder="C:\Users\YourName\HakoDesk-data"
                                        className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    <button
                                        onClick={handleSelectFolder}
                                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors border border-gray-200"
                                    >
                                        Browse
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">
                                    Enter the full path where messages will be stored. You can copy this from Windows Explorer.
                                </p>
                            </div>
                            <button
                                onClick={async () => {
                                    if (outputDirInput.trim()) {
                                        const success = await saveSettings({ output_dir: outputDirInput.trim() });
                                        if (success) {
                                            setShowSetupWizard(false);
                                            // Start initial sync immediately
                                            startSync(true);
                                        }
                                    }
                                }}
                                disabled={!outputDirInput.trim()}
                                className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Start Using HakoDesk
                            </button>
                        </div>
                    </div>
                </div>
            )
            }

            <DiagnosticsModal
                isOpen={showDiagnostics}
                onClose={() => setShowDiagnostics(false)}
            />

            <AboutModal
                isOpen={showAboutModal}
                onClose={() => setShowAboutModal(false)}
                onOpenDiagnostics={() => setShowDiagnostics(true)}
            />

            <ReportIssueModal
                isOpen={showReportModal}
                onClose={() => {
                    setShowReportModal(false);
                    setCrashError(undefined);
                }}
                currentMemberPath={selectedGroupDir}
                currentScreen={selectedName || 'Home'}
                crashError={crashError}
            />

            {/* ERROR TOAST */}
            {
                error && (
                    <div className="fixed bottom-4 right-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50">
                        <div className="bg-red-100 p-2 rounded-full">
                            <Loader2 className="w-4 h-4 text-red-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">Error</p>
                            <p className="text-xs opacity-90">{error}</p>
                        </div>
                        <button
                            onClick={() => setShowDiagnostics(true)}
                            className="ml-2 bg-white/50 hover:bg-white text-red-700 p-1.5 rounded-lg transition-colors text-xs font-medium"
                        >
                            Debug
                        </button>
                    </div>
                )
            }

            {/* Settings Modal */}
            {
                showSettingsModal && appSettings && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden">
                            <div className="bg-gray-100 px-6 py-4 flex items-center justify-between border-b">
                                <h3 className="text-lg font-bold text-gray-800">Settings</h3>
                                <button
                                    onClick={() => setShowSettingsModal(false)}
                                    className="text-gray-500 hover:text-gray-700"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="p-6 space-y-6">
                                {/* Output Folder */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Output Folder
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={outputDirInput}
                                            onChange={(e) => setOutputDirInput(e.target.value)}
                                            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            onClick={() => saveSettings({ output_dir: outputDirInput })}
                                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                                        >
                                            Save
                                        </button>
                                    </div>
                                </div>

                                {/* Auto-Sync */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="text-sm font-medium text-gray-700">Auto-Sync</label>
                                        <button
                                            onClick={() => saveSettings({ auto_sync_enabled: !appSettings.auto_sync_enabled })}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.auto_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.auto_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                                }`} />
                                        </button>
                                    </div>
                                    {appSettings.auto_sync_enabled && (
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm text-gray-600">Sync every</span>
                                            <select
                                                value={appSettings.sync_interval_minutes}
                                                onChange={(e) => saveSettings({ sync_interval_minutes: parseInt(e.target.value) })}
                                                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value={1}>1 minute</option>
                                                <option value={5}>5 minutes</option>
                                                <option value={10}>10 minutes</option>
                                                <option value={30}>30 minutes</option>
                                                <option value={60}>1 hour</option>
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Adaptive Sync */}
                                {appSettings.auto_sync_enabled && (
                                    <div>
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-medium text-gray-700">Smart Timing</label>
                                            <button
                                                onClick={() => saveSettings({ adaptive_sync_enabled: !appSettings.adaptive_sync_enabled })}
                                                className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.adaptive_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                                    }`}
                                            >
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.adaptive_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                                    }`} />
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Randomize intervals based on posting patterns</p>
                                    </div>
                                )}

                                {/* Desktop Notifications */}
                                <div>
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-700">Desktop Notifications</label>
                                        <button
                                            onClick={() => saveSettings({ notifications_enabled: !appSettings.notifications_enabled })}
                                            className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.notifications_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                                }`}
                                        >
                                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.notifications_enabled ? 'translate-x-7' : 'translate-x-1'
                                                }`} />
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">Show notification when new messages arrive</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-30 w-80 transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0 bg-white
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <Sidebar
                    onSelectGroup={handleSelectGroup}
                    selectedGroupDir={selectedGroupDir}
                    isSyncing={syncProgress.state === 'running'}
                    onOpenSettings={() => setShowSettingsModal(true)}
                    onReportIssue={() => setShowReportModal(true)}
                    onOpenAbout={() => setShowAboutModal(true)}
                    readStateVersion={readStateVersion}
                />
            </div>

            {isSidebarOpen && (<div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setIsSidebarOpen(false)} />)}

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col h-full relative w-full">
                {/* Header */}
                <header className="h-16 bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] flex items-center px-4 shadow-sm z-10 shrink-0">
                    <button className="md:hidden mr-3 text-white" onClick={() => setIsSidebarOpen(true)}> <Menu /> </button>
                    <div className="text-white flex-1">
                        <h2 className="text-lg font-bold">{selectedName || "Select a Conversation"}</h2>
                        {isGroupChat && <span className="text-xs opacity-80">Group Chat</span>}
                    </div>
                    {displayUnreadCount > 0 && <span className="bg-white/20 text-white text-xs px-2 py-1 rounded-full">{displayUnreadCount} unread</span>}
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
                                <p className="text-lg mb-2">👋 Welcome to HakoDesk</p>
                                <p className="text-sm">Select a conversation from the sidebar to start.</p>
                            </div>
                        </div>
                    )}

                    {loading && messages.length === 0 && <div className="p-10 text-center text-gray-500">Loading messages...</div>}
                    {error && <div className="p-10 text-center text-red-500">Error: {error}</div>}

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
            </div>
        </div>
    )
}

function AppWithErrorBoundary() {
    const [crashError, setCrashError] = useState<string | undefined>();
    const [showReportAfterCrash, setShowReportAfterCrash] = useState(false);

    const handleReportIssue = (error: string) => {
        setCrashError(error);
        setShowReportAfterCrash(true);
    };

    return (
        <>
            <ErrorBoundary onReportIssue={handleReportIssue}>
                <App />
            </ErrorBoundary>
            {showReportAfterCrash && (
                <ReportIssueModal
                    isOpen={showReportAfterCrash}
                    onClose={() => {
                        setShowReportAfterCrash(false);
                        setCrashError(undefined);
                    }}
                    crashError={crashError}
                />
            )}
        </>
    );
}

export default AppWithErrorBoundary
