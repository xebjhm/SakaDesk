/**
 * Global application state store using Zustand with persistence.
 *
 * Manages:
 * - Selected services (user's subscribed idol groups)
 * - Active service and feature navigation
 * - Member favorites per service
 * - Blog selection mode preferences
 * - Conversation selection memory
 *
 * All state is persisted to the backend app-state store (via the `persisted`
 * layer) under the pref key 'sakadesk-app-state', so it survives a dev-server
 * port shift. Hydration is explicit (skipHydration: true) — see App.tsx's
 * startup effect, which calls useAppStore.persist.rehydrate() after the
 * backend prefs cache has been hydrated + migrated.
 *
 * @example
 * ```tsx
 * function ServiceSwitcher() {
 *   const { activeService, setActiveService, selectedServices } = useAppStore();
 *
 *   return (
 *     <div>
 *       {selectedServices.map(service => (
 *         <button
 *           key={service}
 *           onClick={() => setActiveService(service)}
 *           className={service === activeService ? 'active' : ''}
 *         >
 *           {service}
 *         </button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 *
 * @module appStore
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SERVICE_ORDER } from '../data/services';
import { persisted } from '../core/persistence/persisted';
import type { RecentPost } from '../types';
import type { ChatTurn } from '../features/ai/types';

/** Available feature tabs within a service. */
export type FeatureId = 'messages' | 'blogs' | 'news' | 'fanclub' | 'ai';

/** Tabs of the Settings modal (`shell/components/SettingsModal.tsx`). */
export type SettingsTabId = 'general' | 'sync' | 'ai' | 'updates';

/** Blog filtering mode: show all members or only favorites. */
export type BlogSelectionMode = 'all' | 'favorite';

/**
 * Global application state interface.
 *
 * Organized into logical groups:
 * - Service selection and navigation
 * - Feature management
 * - User preferences (favorites, modes)
 * - UI state persistence (conversations)
 */
interface AppState {
    // ─── Service Selection ───────────────────────────────────────────────────

    /** List of service IDs the user has subscribed to (e.g., 'hinatazaka46'). */
    selectedServices: string[];
    /** Add a service to the user's subscription list. */
    addSelectedService: (serviceId: string) => void;
    /** Remove a service and switch active if needed. */
    removeSelectedService: (serviceId: string) => void;
    /** Replace the entire subscription list. */
    setSelectedServices: (services: string[]) => void;

    // ─── Active Navigation ───────────────────────────────────────────────────

    /** Currently active service ID being viewed. */
    activeService: string | null;
    /** Switch to viewing a different service. */
    setActiveService: (service: string) => void;

    // ─── Feature Selection ───────────────────────────────────────────────────

    /** Active feature tab per service (e.g., messages, blogs). */
    activeFeatures: Record<string, FeatureId>;
    /** Set active feature for a service. */
    setActiveFeature: (service: string, feature: FeatureId) => void;
    /** Get active feature for a service (defaults to 'messages'). */
    getActiveFeature: (service: string) => FeatureId;

    // ─── Blog View State ─────────────────────────────────────────────────────

    /** Counter that increments to trigger blog view reset. */
    blogViewResetCounter: number;
    /** Trigger a blog view reset (e.g., when clicking blog icon). */
    triggerBlogViewReset: () => void;

    // ─── Service Order ─────────────────────────────────────────────────────

    /** Global service display order (all service IDs). Reorderable via ServiceRail drag. */
    serviceOrder: string[];
    /** Replace the service display order. */
    setServiceOrder: (order: string[]) => void;
    /** Get the service display order (appends any missing services from defaults). */
    getServiceOrder: () => string[];

    // ─── Feature Order ───────────────────────────────────────────────────────

    /** Custom feature tab order per service (for drag reordering). */
    featureOrders: Record<string, FeatureId[]>;
    /** Set custom feature order for a service. */
    setFeatureOrder: (service: string, order: FeatureId[]) => void;
    /** Get feature order for a service (defaults to standard order). */
    getFeatureOrder: (service: string) => FeatureId[];

    // ─── Member Favorites ────────────────────────────────────────────────────

    /** Favorite member IDs per service. */
    favorites: Record<string, string[]>;
    /** Toggle a member's favorite status. */
    toggleFavorite: (serviceId: string, memberId: string) => void;
    /** Get all favorite member IDs for a service. */
    getFavorites: (serviceId: string) => string[];
    /** Check if a member is favorited. */
    isFavorite: (serviceId: string, memberId: string) => boolean;

    // ─── Blog Selection Mode ─────────────────────────────────────────────────

    /** Blog filtering mode per service ('all' or 'favorite'). */
    blogSelectionModes: Record<string, BlogSelectionMode>;
    /** Set blog selection mode for a service. */
    setBlogSelectionMode: (serviceId: string, mode: BlogSelectionMode) => void;
    /** Get blog selection mode (defaults to 'all'). */
    getBlogSelectionMode: (serviceId: string) => BlogSelectionMode;

    // ─── Blog Recent Posts Cache ──────────────────────────────────────────
    /** Cached recent posts per service for instant display. */
    blogRecentPostsCache: Record<string, RecentPost[]>;
    /** Update cached recent posts for a service. */
    setBlogRecentPosts: (serviceId: string, posts: RecentPost[]) => void;
    /** Get cached recent posts for a service. */
    getBlogRecentPosts: (serviceId: string) => RecentPost[];

    // ─── Conversation Memory ─────────────────────────────────────────────────

    /** Last selected conversation per service (restored on return). */
    selectedConversations: Record<string, { path: string; name: string; isGroupChat: boolean } | null>;
    /** Remember the selected conversation for a service. */
    setSelectedConversation: (serviceId: string, conversation: { path: string; name: string; isGroupChat: boolean } | null) => void;
    /** Get the last selected conversation for a service. */
    getSelectedConversation: (serviceId: string) => { path: string; name: string; isGroupChat: boolean } | null;

    // ─── Search Navigation ────────────────────────────────────────────────────

    /** Counter bumped to trigger conversation navigation from search (non-persisted). */
    conversationNavCounter: number;
    /** Trigger programmatic navigation to a conversation (e.g., from search results). */
    triggerConversationNavigation: () => void;

    /** Target message ID to scroll to after navigation (non-persisted). */
    targetMessageId: number | null;
    /** Set the target message to scroll to. */
    setTargetMessageId: (id: number | null) => void;

    // ─── Blog Search Navigation ──────────────────────────────────────────────

    /** Target blog to open from search results (non-persisted). */
    targetBlog: { blogId: string; service: string; memberId: number; searchQuery: string; matchedTerms?: string[]; readingTerms?: string[] } | null;
    /** Set the target blog to open from search navigation. */
    setTargetBlog: (target: { blogId: string; service: string; memberId: number; searchQuery: string; matchedTerms?: string[]; readingTerms?: string[] } | null) => void;

    // ─── Fresh Service Prompt ────────────────────────────────────────────────

    /** Service ID that was just added (non-persisted), triggers login prompt. */
    freshlyAddedService: string | null;
    /** Set the freshly added service (triggers login prompt in App.tsx). */
    setFreshlyAddedService: (service: string | null) => void;

    // ─── Initial Sync Tracking ─────────────────────────────────────────────

    /** Services currently undergoing their first sync after being added (non-persisted). */
    initialSyncServices: Record<string, true>;
    /** Mark a service as undergoing initial sync. */
    addInitialSyncService: (serviceId: string) => void;
    /** Remove a service from initial sync tracking. */
    removeInitialSyncService: (serviceId: string) => void;

    // ─── Golden Finger (Hidden Feature) ────────────────────────────────────
    /** Secret download mode activated via easter egg. */
    goldenFingerActive: boolean;
    /** Toggle golden finger mode. */
    setGoldenFingerActive: (active: boolean) => void;

    // ─── Translation ──────────────────────────────────────────────────────
    /** Target language for translations (defaults to UI language). */
    translationTargetLanguage: string | null;
    /** Set target language for translations. */
    setTranslationTargetLanguage: (lang: string | null) => void;
    /** Global translation toggle for messages. */
    translationGlobalMessages: boolean;
    /** Global translation toggle for blogs. */
    translationGlobalBlogs: boolean;
    /** Set global translation toggle for messages. */
    setTranslationGlobalMessages: (enabled: boolean) => void;
    /** Set global translation toggle for blogs. */
    setTranslationGlobalBlogs: (enabled: boolean) => void;

    // ─── Feature Toggles ──────────────────────────────────────────────────
    /** Top-level toggle: enable/disable the translation feature. */
    translationEnabled: boolean;
    /** Set the top-level translation feature toggle. */
    setTranslationEnabled: (enabled: boolean) => void;
    /** Top-level toggle: enable/disable the transcription feature. */
    transcriptionEnabled: boolean;
    /** Set the top-level transcription feature toggle. */
    setTranscriptionEnabled: (enabled: boolean) => void;

    // ─── AI Chat Threads (Product-wave Task 6) ─────────────────────────────
    // Lifted out of `AiFeature`'s local component state: a tab switch (or a
    // citation chip's `navigateToSource`, which changes `activeFeature` and
    // unmounts `AiFeature`) used to silently drop the whole conversation --
    // living here instead means the thread (and an ask still in flight)
    // survives a remount. Client-side only, same as before (no server-side
    // conversation persistence, Plan B spec §7.5) -- and deliberately NOT
    // included in `partialize` below, so it does NOT survive an app restart,
    // only in-session remounts.

    /** Per-service chat thread. */
    aiThreadsByService: Record<string, ChatTurn[]>;
    /** Append one or more turns to a service's thread. */
    appendAiTurns: (service: string, turns: ChatTurn[]) => void;
    /** Replace a single turn by id within a service's thread (no-op if the id
     * isn't found -- e.g. a stale closure from an already-cleared thread). */
    replaceAiTurn: (service: string, id: string, updater: (turn: ChatTurn) => ChatTurn) => void;
    /** Empty a service's thread ("clear thread" button) -- other services'
     * threads are untouched. */
    clearAiThread: (service: string) => void;
    /** Get a service's thread (defaults to empty). */
    getAiThread: (service: string) => ChatTurn[];

    /** Whether an ask is currently in flight for a service -- drives the
     * composer's Send/Stop swap and stays true across an `AiFeature` remount
     * (the fetch itself is independent of any component's lifetime). */
    aiIsAsking: Record<string, boolean>;
    setAiIsAsking: (service: string, asking: boolean) => void;

    /** The `AbortController` for a service's in-flight ask, if any -- lets a
     * freshly (re)mounted `ChatWindow`'s Stop button cancel an ask that a
     * PREVIOUS `AiFeature` instance started. Not persisted (not JSON-
     * serializable, and not meaningful across a restart anyway). */
    aiAbortControllers: Record<string, AbortController>;
    setAiAbortController: (service: string, controller: AbortController | null) => void;

    // ─── Settings Modal Requests ───────────────────────────────────────────
    // Lets any feature deep in the tree (e.g. `ChatWindow`'s "Open AI
    // settings" error action) request the Settings modal without prop-
    // drilling through `shell/App.tsx`'s `useSettings` local state. The
    // shell (App.tsx + SettingsModal) subscribes: it opens the modal on the
    // requested tab, then calls `clearSettingsRequest()`. Non-persisted.

    /** Pending "open Settings on this tab" request, or null. */
    settingsRequest: { tab: SettingsTabId } | null;
    /** Request the Settings modal be opened on `tab`. Side-effect-free
     * beyond setting `settingsRequest` -- the shell reacts to it. */
    openSettings: (tab: SettingsTabId) => void;
    /** Consume the pending request (called by the shell once handled). */
    clearSettingsRequest: () => void;
}

/** Default feature tab order when no custom order is set. */
const DEFAULT_FEATURE_ORDER: FeatureId[] = ['messages', 'blogs', 'news', 'fanclub', 'ai'];

// Backs the persist middleware with the backend-synced `persisted` prefs
// cache instead of localStorage, so the bundle survives a port shift (the
// backend db is keyed by machine, not by origin/port). `getPref`/`setPref`
// are synchronous reads/writes against a cache hydrated at startup — see
// core/persistence/persisted.ts. The whole serialized bundle is stored
// under one pref key (this store's persist `name`).
// Flipped true once the store has EXPLICITLY hydrated from the backend prefs
// cache (App.tsx calls useAppStore.persist.rehydrate() after the cache loads;
// set via onRehydrateStorage below). Until then, persist writes are suppressed.
let hasHydratedFromBackend = false;

const backendStateStorage = {
    getItem: (name: string): string | null => persisted.getPref<string | null>(name, null),
    setItem: (name: string, value: string): void => {
        // Gate: do not persist before hydration. zustand's persist writes on EVERY
        // set(), including pre-hydration writes such as an auth-driven
        // setActiveService() that fires before the rehydrate chain finishes.
        // Persisting then would overwrite the stored bundle with partialized
        // defaults, and the debounced flush would PATCH those defaults into
        // app_state.db — silently resetting the user's services/favorites/etc.
        // (SD-FE-STATE-01, code review 2026-07-07).
        if (!hasHydratedFromBackend) return;
        persisted.setPref(name, value);
    },
    removeItem: (name: string): void => { persisted.setPref(name, null); },
};

/**
 * Zustand store hook for global application state.
 *
 * State is persisted to the backend app-state store and restored explicitly
 * via `useAppStore.persist.rehydrate()` during App.tsx's startup effect (see
 * skipHydration above). Use selectors for optimal re-render performance.
 *
 * @example
 * ```tsx
 * // Good: Select only what you need
 * const activeService = useAppStore(state => state.activeService);
 *
 * // Avoid: Selecting entire store causes re-renders on any change
 * const store = useAppStore();
 * ```
 */
export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Selected services
            selectedServices: [],
            addSelectedService: (serviceId) =>
                set((state) => ({
                    selectedServices: state.selectedServices.includes(serviceId)
                        ? state.selectedServices
                        : [...state.selectedServices, serviceId],
                })),
            removeSelectedService: (serviceId) =>
                set((state) => {
                    const newSelected = state.selectedServices.filter((id) => id !== serviceId);
                    // If removing the active service, switch to first remaining or null
                    const newActiveService =
                        state.activeService === serviceId
                            ? newSelected[0] || null
                            : state.activeService;
                    return {
                        selectedServices: newSelected,
                        activeService: newActiveService,
                    };
                }),
            setSelectedServices: (services) => set({ selectedServices: services }),

            activeService: null,
            setActiveService: (service) => set({ activeService: service }),

            activeFeatures: {},
            setActiveFeature: (service, feature) =>
                set((state) => ({
                    activeFeatures: { ...state.activeFeatures, [service]: feature },
                })),
            getActiveFeature: (service) => get().activeFeatures[service] || 'messages',

            blogViewResetCounter: 0,
            triggerBlogViewReset: () =>
                set((state) => ({ blogViewResetCounter: state.blogViewResetCounter + 1 })),

            serviceOrder: DEFAULT_SERVICE_ORDER,
            setServiceOrder: (order) => set({ serviceOrder: order }),
            getServiceOrder: () => {
                const stored = get().serviceOrder;
                // Append any services missing from the stored order
                const missing = DEFAULT_SERVICE_ORDER.filter((id) => !stored.includes(id));
                return missing.length > 0 ? [...stored, ...missing] : stored;
            },

            featureOrders: {},
            setFeatureOrder: (service, order) =>
                set((state) => ({
                    featureOrders: { ...state.featureOrders, [service]: order },
                })),
            getFeatureOrder: (service) => get().featureOrders[service] || DEFAULT_FEATURE_ORDER,

            favorites: {},
            toggleFavorite: (serviceId, memberId) =>
                set((state) => {
                    const current = state.favorites[serviceId] || [];
                    const newFavorites = current.includes(memberId)
                        ? current.filter((id) => id !== memberId)
                        : [...current, memberId];
                    return {
                        favorites: { ...state.favorites, [serviceId]: newFavorites },
                    };
                }),
            getFavorites: (serviceId) => get().favorites[serviceId] || [],
            isFavorite: (serviceId, memberId) =>
                (get().favorites[serviceId] || []).includes(memberId),

            blogSelectionModes: {},
            setBlogSelectionMode: (serviceId, mode) =>
                set((state) => ({
                    blogSelectionModes: { ...state.blogSelectionModes, [serviceId]: mode },
                })),
            getBlogSelectionMode: (serviceId) => get().blogSelectionModes[serviceId] || 'all',

            blogRecentPostsCache: {},
            setBlogRecentPosts: (serviceId, posts) =>
                set((state) => ({
                    blogRecentPostsCache: { ...state.blogRecentPostsCache, [serviceId]: posts },
                })),
            getBlogRecentPosts: (serviceId) => get().blogRecentPostsCache[serviceId] || [],

            selectedConversations: {},
            setSelectedConversation: (serviceId, conversation) =>
                set((state) => ({
                    selectedConversations: { ...state.selectedConversations, [serviceId]: conversation },
                })),
            getSelectedConversation: (serviceId) => get().selectedConversations[serviceId] || null,

            conversationNavCounter: 0,
            triggerConversationNavigation: () =>
                set((state) => ({ conversationNavCounter: state.conversationNavCounter + 1 })),

            targetMessageId: null,
            setTargetMessageId: (id) => set({ targetMessageId: id }),

            targetBlog: null,
            setTargetBlog: (target) => set({ targetBlog: target }),

            freshlyAddedService: null,
            setFreshlyAddedService: (service) => set({ freshlyAddedService: service }),

            initialSyncServices: {},
            addInitialSyncService: (serviceId) =>
                set((state) => ({
                    initialSyncServices: { ...state.initialSyncServices, [serviceId]: true },
                })),
            removeInitialSyncService: (serviceId) =>
                set((state) => {
                    const { [serviceId]: _, ...rest } = state.initialSyncServices;
                    return { initialSyncServices: rest };
                }),

            goldenFingerActive: false,
            setGoldenFingerActive: (active) => set({ goldenFingerActive: active }),

            translationTargetLanguage: null,
            setTranslationTargetLanguage: (lang) => set({ translationTargetLanguage: lang }),
            translationGlobalMessages: false,
            setTranslationGlobalMessages: (enabled) => set({ translationGlobalMessages: enabled }),
            translationGlobalBlogs: false,
            setTranslationGlobalBlogs: (enabled) => set({ translationGlobalBlogs: enabled }),

            translationEnabled: false,
            setTranslationEnabled: (enabled) => set({ translationEnabled: enabled }),
            transcriptionEnabled: true,
            setTranscriptionEnabled: (enabled) => set({ transcriptionEnabled: enabled }),

            aiThreadsByService: {},
            appendAiTurns: (service, turns) =>
                set((state) => ({
                    aiThreadsByService: {
                        ...state.aiThreadsByService,
                        [service]: [...(state.aiThreadsByService[service] ?? []), ...turns],
                    },
                })),
            replaceAiTurn: (service, id, updater) =>
                set((state) => {
                    const existing = state.aiThreadsByService[service] ?? [];
                    return {
                        aiThreadsByService: {
                            ...state.aiThreadsByService,
                            [service]: existing.map((turn) => (turn.id === id ? updater(turn) : turn)),
                        },
                    };
                }),
            clearAiThread: (service) =>
                set((state) => ({
                    aiThreadsByService: { ...state.aiThreadsByService, [service]: [] },
                })),
            getAiThread: (service) => get().aiThreadsByService[service] ?? [],

            aiIsAsking: {},
            setAiIsAsking: (service, asking) =>
                set((state) => ({ aiIsAsking: { ...state.aiIsAsking, [service]: asking } })),

            aiAbortControllers: {},
            setAiAbortController: (service, controller) =>
                set((state) => {
                    const next = { ...state.aiAbortControllers };
                    if (controller) {
                        next[service] = controller;
                    } else {
                        delete next[service];
                    }
                    return { aiAbortControllers: next };
                }),

            settingsRequest: null,
            openSettings: (tab) => set({ settingsRequest: { tab } }),
            clearSettingsRequest: () => set({ settingsRequest: null }),
        }),
        {
            name: 'sakadesk-app-state',
            version: 4,
            storage: createJSONStorage(() => backendStateStorage),
            // The backend prefs cache isn't populated until App.tsx's startup
            // effect hydrates it, so we must NOT auto-hydrate at import time
            // (that would read an empty cache and lock in defaults). App.tsx
            // calls useAppStore.persist.rehydrate() explicitly once hydration
            // + migration have completed.
            skipHydration: true,
            // Open the persistence gate only after an explicit rehydrate() has
            // populated the store from the backend — see backendStateStorage.setItem.
            onRehydrateStorage: () => () => {
                hasHydratedFromBackend = true;
            },
            partialize: (state) => ({
                selectedServices: state.selectedServices,
                activeService: state.activeService,
                activeFeatures: state.activeFeatures,
                serviceOrder: state.serviceOrder,
                featureOrders: state.featureOrders,
                favorites: state.favorites,
                blogSelectionModes: state.blogSelectionModes,
                blogRecentPostsCache: state.blogRecentPostsCache,
                selectedConversations: state.selectedConversations,
                goldenFingerActive: state.goldenFingerActive,
                translationTargetLanguage: state.translationTargetLanguage,
                translationGlobalMessages: state.translationGlobalMessages,
                translationGlobalBlogs: state.translationGlobalBlogs,
                translationEnabled: state.translationEnabled,
                transcriptionEnabled: state.transcriptionEnabled,
            }),
        }
    )
);
