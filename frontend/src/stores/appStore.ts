// frontend/src/stores/appStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FeatureId = 'messages' | 'blogs' | 'news' | 'fanclub' | 'ai';

interface AppState {
    // Service selection
    activeService: string | null;
    setActiveService: (service: string) => void;

    // Feature selection (per service)
    activeFeatures: Record<string, FeatureId>;
    setActiveFeature: (service: string, feature: FeatureId) => void;
    getActiveFeature: (service: string) => FeatureId;

    // Feature order preference (per service) - for drag reordering
    featureOrders: Record<string, FeatureId[]>;
    setFeatureOrder: (service: string, order: FeatureId[]) => void;
    getFeatureOrder: (service: string) => FeatureId[];

    // Member favorites (per service)
    favorites: Record<string, string[]>;
    toggleFavorite: (serviceId: string, memberId: string) => void;
    getFavorites: (serviceId: string) => string[];
    isFavorite: (serviceId: string, memberId: string) => boolean;
}

const DEFAULT_FEATURE_ORDER: FeatureId[] = ['messages', 'blogs', 'news', 'fanclub', 'ai'];

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            activeService: null,
            setActiveService: (service) => set({ activeService: service }),

            activeFeatures: {},
            setActiveFeature: (service, feature) =>
                set((state) => ({
                    activeFeatures: { ...state.activeFeatures, [service]: feature },
                })),
            getActiveFeature: (service) => get().activeFeatures[service] || 'messages',

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
        }),
        {
            name: 'hakodesk-app-state',
            partialize: (state) => ({
                activeService: state.activeService,
                activeFeatures: state.activeFeatures,
                featureOrders: state.featureOrders,
                favorites: state.favorites,
            }),
        }
    )
);
