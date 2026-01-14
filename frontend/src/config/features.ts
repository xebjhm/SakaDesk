// frontend/src/config/features.ts
import { MessageSquare, BookOpen, Newspaper, Star, Bot, LucideIcon } from 'lucide-react';
import { FeatureId } from '../stores/appStore';

export interface FeatureDefinition {
    id: FeatureId;
    icon: LucideIcon;
    label: string;
    labelJa: string;
}

export const FEATURE_DEFINITIONS: Record<FeatureId, FeatureDefinition> = {
    messages: {
        id: 'messages',
        icon: MessageSquare,
        label: 'Messages',
        labelJa: 'メッセージ',
    },
    blogs: {
        id: 'blogs',
        icon: BookOpen,
        label: 'Blogs',
        labelJa: 'ブログ',
    },
    news: {
        id: 'news',
        icon: Newspaper,
        label: 'News',
        labelJa: 'ニュース',
    },
    fanclub: {
        id: 'fanclub',
        icon: Star,
        label: 'Fan Club',
        labelJa: 'ファンクラブ',
    },
    ai: {
        id: 'ai',
        icon: Bot,
        label: 'AI Agent',
        labelJa: 'AIエージェント',
    },
};

// Which features are available per service
// For now, only messages is available. Others will be enabled as implemented.
export const SERVICE_FEATURES: Record<string, FeatureId[]> = {
    'Hinatazaka46': ['messages'],
    'Sakurazaka46': ['messages'],
    'Nogizaka46': ['messages'],
    // Default for any service
    default: ['messages'],
};

export function getAvailableFeatures(service: string): FeatureDefinition[] {
    const featureIds = SERVICE_FEATURES[service] || SERVICE_FEATURES.default;
    return featureIds.map(id => FEATURE_DEFINITIONS[id]);
}
