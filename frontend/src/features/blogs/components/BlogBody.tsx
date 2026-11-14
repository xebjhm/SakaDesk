// frontend/src/features/blogs/components/BlogBody.tsx
// The blog post body: React owns the element, the sanitized fragment (blogHtml.ts) its children.

import React, { useLayoutEffect } from 'react';
import { BLOG_PROSE } from './blogProse';

export interface BlogBodyProps {
    /** Sanitized post with its search marks; null leaves the body empty. */
    fragment: DocumentFragment | null;
    /** The body element, shared with the reader's translation, photo and link handlers. */
    containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Inserts a copy of `fragment` (inserting a fragment empties it, and StrictMode re-runs
 * effects). It is replaced only when the fragment changes, so DOM the reader adds afterwards
 * (inline translations) stays until the post or the search terms change.
 */
export const BlogBody: React.FC<BlogBodyProps> = ({ fragment, containerRef }) => {
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        if (fragment) el.replaceChildren(fragment.cloneNode(true));
        else el.replaceChildren();
    }, [fragment, containerRef]);
    return <div ref={containerRef} lang="ja" className={BLOG_PROSE} />;
};
