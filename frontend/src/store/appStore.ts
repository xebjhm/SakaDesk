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
 * All state is persisted to localStorage under 'hakodesk-app-state'.
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
import { persist } from 'zustand/middleware';
import { DEFAULT_SERVICE_ORDER } from '../data/services';

/** Available feature tabs within a service. */
export type FeatureId = 'messages' | 'blogs' | 'news' | 'fanclub' | 'ai';

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
}

/** Default feature tab order when no custom order is set. */
const DEFAULT_FEATURE_ORDER: FeatureId[] = ['messages', 'blogs', 'news', 'fanclub', 'ai'];

/**
 * Zustand store hook for global application state.
 *
 * State is automatically persisted to localStorage and restored on app load.
 * Use selectors for optimal re-render performance.
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
        }),
        {
            name: 'hakodesk-app-state',
            version: 3,
            partialize: (state) => ({
                selectedServices: state.selectedServices,
                activeService: state.activeService,
                activeFeatures: state.activeFeatures,
                serviceOrder: state.serviceOrder,
                featureOrders: state.featureOrders,
                favorites: state.favorites,
                blogSelectionModes: state.blogSelectionModes,
                selectedConversations: state.selectedConversations,
                goldenFingerActive: state.goldenFingerActive,
            }),
        }
    )
);
