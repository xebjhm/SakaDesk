// frontend/src/features/messages/hooks/useMessagesTheme.ts
// Centralized hook for messages feature theme access
import { useMemo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { getThemeForService } from '../../../config/groupThemes';
import type { GroupTheme } from '../../../config/groupThemes';

export interface ShelterColors {
    picture: string;
    video: string;
    voice: string;
    text: string;
}

export type ShelterStyle = 'classic' | 'light';

export type HeaderStyle = 'gradient' | 'light';

export interface MessagesTheme extends GroupTheme {
    // Convenience aliases for common message colors
    headerTextColor: string;
    headerBarGradient: string;
    bubbleBorder: string;
    voicePlayerAccent: string;
    scrollButtonColor: string;
    unreadShadow: string;
    unreadBadge: string;
    favoriteColor: string;
    linkColor: string;
    shelterColors: ShelterColors;
    shelterStyle: ShelterStyle;
    headerStyle: HeaderStyle;
}

/**
 * Hook to get the current messages theme based on active service.
 * Provides the full GroupTheme plus convenience aliases for message-specific colors.
 */
export function useMessagesTheme(): MessagesTheme {
    const activeService = useAppStore((state) => state.activeService);

    return useMemo(() => {
        const theme = getThemeForService(activeService);
        return {
            ...theme,
            // Convenience aliases for cleaner component code
            headerTextColor: theme.messages.headerTextColor,
            headerBarGradient: theme.messages.headerBarGradient,
            bubbleBorder: theme.messages.bubbleBorder,
            voicePlayerAccent: theme.messages.voicePlayerAccent,
            scrollButtonColor: theme.messages.scrollButtonColor,
            unreadShadow: theme.messages.unreadShadow,
            unreadBadge: theme.messages.unreadBadge,
            favoriteColor: theme.modals.accentColor,
            linkColor: theme.modals.accentColor,
            shelterColors: theme.messages.shelterColors,
            shelterStyle: theme.messages.shelterStyle,
            headerStyle: theme.messages.headerStyle,
        };
    }, [activeService]);
}
