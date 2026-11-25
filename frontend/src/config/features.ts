// frontend/src/config/features.ts
import { MessageSquare, BookOpen, Newspaper, Star, Bot, Sparkles, LucideIcon } from 'lucide-react';
import type { FeatureId } from '../store/appStore';

export type FeatureAccessLevel = 'free' | 'paid';

export interface FeatureDefinition {
    id: FeatureId;
    icon: LucideIcon;
    /** i18n key of the feature's name (`features.<id>`). */
    labelKey: string;
    accessLevel: FeatureAccessLevel;
}

export const FEATURE_DEFINITIONS: Record<FeatureId, FeatureDefinition> = {
    messages: {
        id: 'messages',
        icon: MessageSquare,
        labelKey: 'features.messages',
        accessLevel: 'paid',
    },
    blogs: {
        id: 'blogs',
        icon: BookOpen,
        labelKey: 'features.blogs',
        accessLevel: 'free',
    },
    news: {
        id: 'news',
        icon: Newspaper,
        labelKey: 'features.news',
        accessLevel: 'free',
    },
    fanclub: {
        id: 'fanclub',
        icon: Star,
        labelKey: 'features.fanclub',
        accessLevel: 'paid',
    },
    memories: {
        id: 'memories',
        icon: Sparkles,
        labelKey: 'features.memories',
        accessLevel: 'free',
    },
    ai: {
        id: 'ai',
        icon: Bot,
        labelKey: 'features.ai',
        accessLevel: 'free',
    },
};

// Which features are available per service
// For now, only messages is available. Others will be enabled as implemented.
export const SERVICE_FEATURES: Record<string, FeatureId[]> = {
    'hinatazaka46': ['messages', 'blogs', 'memories'],
    'sakurazaka46': ['messages', 'blogs', 'memories'],
    'nogizaka46': ['messages', 'blogs', 'memories'],
    'yodel': ['messages', 'memories'],
    // Default for any service
    default: ['messages', 'blogs', 'memories'],
};

export function getAvailableFeatures(service: string): FeatureDefinition[] {
    const featureIds = SERVICE_FEATURES[service] || SERVICE_FEATURES.default;
    return featureIds.map(id => FEATURE_DEFINITIONS[id]);
}

export function isFeatureFree(featureId: FeatureId): boolean {
    return FEATURE_DEFINITIONS[featureId]?.accessLevel === 'free';
}

export function isFeaturePaid(featureId: FeatureId): boolean {
    return FEATURE_DEFINITIONS[featureId]?.accessLevel === 'paid';
}
