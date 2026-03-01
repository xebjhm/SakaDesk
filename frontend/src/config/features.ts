// frontend/src/config/features.ts
import { MessageSquare, BookOpen, Newspaper, Star, Bot, LucideIcon } from 'lucide-react';
import type { FeatureId } from '../store/appStore';

export type FeatureAccessLevel = 'free' | 'paid';

export interface FeatureDefinition {
    id: FeatureId;
    icon: LucideIcon;
    label: string;
    labelJa: string;
    accessLevel: FeatureAccessLevel;
}

export const FEATURE_DEFINITIONS: Record<FeatureId, FeatureDefinition> = {
    messages: {
        id: 'messages',
        icon: MessageSquare,
        label: 'Messages',
        labelJa: 'メッセージ',
        accessLevel: 'paid',
    },
    blogs: {
        id: 'blogs',
        icon: BookOpen,
        label: 'Blogs',
        labelJa: 'ブログ',
        accessLevel: 'free',
    },
    news: {
        id: 'news',
        icon: Newspaper,
        label: 'News',
        labelJa: 'ニュース',
        accessLevel: 'free',
    },
    fanclub: {
        id: 'fanclub',
        icon: Star,
        label: 'Fan Club',
        labelJa: 'ファンクラブ',
        accessLevel: 'paid',
    },
    ai: {
        id: 'ai',
        icon: Bot,
        label: 'AI Agent',
        labelJa: 'AIエージェント',
        accessLevel: 'free',
    },
};

// Which features are available per service
// For now, only messages is available. Others will be enabled as implemented.
export const SERVICE_FEATURES: Record<string, FeatureId[]> = {
    'hinatazaka46': ['messages', 'blogs'],
    'sakurazaka46': ['messages', 'blogs'],
    'nogizaka46': ['messages', 'blogs'],
    'yodel': ['messages'],
    // Default for any service
    default: ['messages', 'blogs'],
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
