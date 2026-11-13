import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import { Z_INDEX } from '../../constants/zIndex';
import { brandScopeStyle } from '../../design/brandScope';

/**
 * The one skip link (UI health A-S5): the first Tab stop, visible only while it has keyboard focus,
 * moving focus past the group and feature rails to the content (`<main id={targetId}>`). A button,
 * not an in-page `#` link, so the URL fragment (the launch token's place) is never touched. The link
 * exists only while the target does (the landing screen with no active service has no main), so
 * it never offers a jump that does nothing.
 */
export const SkipLink: React.FC<{ targetId: string }> = ({ targetId }) => {
    const { t } = useTranslation();
    const [present, setPresent] = useState(() => document.getElementById(targetId) !== null);
    useEffect(() => {
        const sync = () => setPresent(document.getElementById(targetId) !== null);
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
    }, [targetId]);
    if (!present) return null;
    return (
        <button
            type="button"
            onClick={() => document.getElementById(targetId)?.focus()}
            style={{ ...brandScopeStyle(), zIndex: Z_INDEX.TOAST }}
            className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-2 focus-visible:top-2 focus-visible:rounded-md focus-visible:bg-sheet focus-visible:px-3 focus-visible:py-2 focus-visible:text-small focus-visible:font-semibold focus-visible:text-primary focus-visible:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            {t('a11y.skipToContent')}
        </button>
    );
};
