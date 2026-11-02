import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Show/hide state for a blog post's inline translations, matching the message
 * translation panels: expands automatically when translations arrive, collapses
 * when the post content scrolls out of view or the translations are cleared
 * (switching blogs), and can be toggled manually.
 *
 * @param translationCount Number of translated segments (0 = none yet).
 * @param contentRef The post content element whose visibility drives auto-collapse.
 */
export function useBlogTranslationVisibility(
    translationCount: number,
    contentRef: RefObject<Element | null>,
): { expanded: boolean; toggle: () => void } {
    const hasTranslations = translationCount > 0;
    const [expanded, setExpanded] = useState(hasTranslations);
    const [prevHas, setPrevHas] = useState(hasTranslations);

    // Expand when translations arrive; collapse when they are cleared.
    // (State-during-render adjustment so the first paint is already correct.)
    if (prevHas !== hasTranslations) {
        setPrevHas(hasTranslations);
        setExpanded(hasTranslations);
    }

    const toggle = useCallback(() => setExpanded(e => !e), []);

    useEffect(() => {
        const el = contentRef.current;
        if (!expanded || !hasTranslations || !el || typeof IntersectionObserver === 'undefined') return;
        // Only collapse after the content has been seen, so the observer's
        // initial callback can never undo the auto-expand.
        let seen = false;
        const observer = new IntersectionObserver(entries => {
            const visible = entries.some(e => e.isIntersecting);
            if (visible) seen = true;
            else if (seen) setExpanded(false);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [expanded, hasTranslations, contentRef]);

    return { expanded, toggle };
}
