// frontend/src/features/blogs/hooks/useBlogTheme.ts
// Centralized hook for blog feature theme access
import { useMemo } from 'react';
import { useAppStore } from '../../../store/appStore';
import { getServiceTheme } from '../../../config/serviceThemes';
import type { ServiceTheme } from '../../../config/serviceThemes';

export interface BlogTheme extends ServiceTheme {
    // Convenience aliases for common blog colors
    memberNameColor: string;
    linkColor: string;
    linkUnderlineColor: string;
    headerTitleColor: string;
    timelineIndicator: string;
}

/**
 * Hook to get the current blog theme based on active service.
 * Provides the full ServiceTheme plus convenience aliases for blog-specific colors.
 */
export function useBlogTheme(): BlogTheme {
    const activeService = useAppStore((state) => state.activeService);

    return useMemo(() => {
        const theme = getServiceTheme(activeService);
        return {
            ...theme,
            // Convenience aliases for cleaner component code
            memberNameColor: theme.blog.memberNameColor,
            linkColor: theme.blog.linkColor,
            linkUnderlineColor: theme.blog.linkUnderlineColor,
            headerTitleColor: theme.blog.headerTitleColor,
            timelineIndicator: theme.blog.timelineIndicator,
        };
    }, [activeService]);
}
