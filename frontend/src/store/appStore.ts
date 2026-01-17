// frontend/src/stores/appStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FeatureId = 'messages' | 'blogs' | 'news' | 'fanclub' | 'ai';
export type BlogSelectionMode = 'all' | 'favorite';

interface AppState {
    // Selected services (user's interest, persisted locally)
    selectedServices: string[];
    addSelectedService: (serviceId: string) => void;
    removeSelectedService: (serviceId: string) => void;
    setSelectedServices: (services: string[]) => void;

    // Active service (currently viewing)
    activeService: string | null;
    setActiveService: (service: string) => void;

    // Feature selection (per service)
    activeFeatures: Record<string, FeatureId>;
    setActiveFeature: (service: string, feature: FeatureId) => void;
    getActiveFeature: (service: string) => FeatureId;

    // Blog view reset trigger (increments when blog icon clicked to reset view)
    blogViewResetCounter: number;
    triggerBlogViewReset: () => void;

    // Feature order preference (per service) - for drag reordering
    featureOrders: Record<string, FeatureId[]>;
    setFeatureOrder: (service: string, order: FeatureId[]) => void;
    getFeatureOrder: (service: string) => FeatureId[];

    // Member favorites (per service)
    favorites: Record<string, string[]>;
    toggleFavorite: (serviceId: string, memberId: string) => void;
    getFavorites: (serviceId: string) => string[];
    isFavorite: (serviceId: string, memberId: string) => boolean;

    // Blog selection mode (per service) - All or Favorite
    blogSelectionModes: Record<string, BlogSelectionMode>;
    setBlogSelectionMode: (serviceId: string, mode: BlogSelectionMode) => void;
    getBlogSelectionMode: (serviceId: string) => BlogSelectionMode;
}

const DEFAULT_FEATURE_ORDER: FeatureId[] = ['messages', 'blogs', 'news', 'fanclub', 'ai'];

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
        }),
        {
            name: 'hakodesk-app-state',
            version: 2,
            migrate: (persistedState: unknown, version: number) => {
                const state = persistedState as Partial<AppState>;
                if (version < 2) {
                    // v1 → v2: Add selectedServices (empty, will be populated by App.tsx migration)
                    return { ...state, selectedServices: [] };
                }
                return state;
            },
            partialize: (state) => ({
                selectedServices: state.selectedServices,
                activeService: state.activeService,
                activeFeatures: state.activeFeatures,
                featureOrders: state.featureOrders,
                favorites: state.favorites,
                blogSelectionModes: state.blogSelectionModes,
            }),
        }
    )
);
