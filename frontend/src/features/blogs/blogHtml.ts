// frontend/src/features/blogs/blogHtml.ts
/**
 * Blog post HTML → a sanitized DOM fragment with search highlights.
 *
 * Remote member-authored HTML is sanitized by DOMPurify straight into a DocumentFragment
 * (RETURN_DOM_FRAGMENT), and search terms are marked by splitting its text nodes, so the post
 * is never edited or re-parsed as an HTML string. (A regex over DOMPurify's serialized output
 * once treated attribute text as text: on a runtime that leaves '<' and '>' raw in attribute
 * values, a highlight inside an alt closed the attribute and the rest became live markup;
 * security audit 2026-11-13.) The fragment belongs to DOMPurify's inert document, so nothing
 * in it loads until BlogBody inserts a copy.
 */
import DOMPurify from 'dompurify';

/** Elements a post keeps. */
export const BLOG_ALLOWED_TAGS: string[] = [
    'p', 'br', 'strong', 'em', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
];
/** Attributes a post keeps. */
export const BLOG_ALLOWED_ATTR: string[] = ['href', 'src', 'alt', 'class', 'target', 'rel'];

export const EXACT_MARK_CLASS = 'search-snippet search-highlight';
export const READING_MARK_CLASS = 'search-snippet search-highlight reading';

/** The one local URL a post may keep: an image cached by a blog backup (`GET /api/blogs/image`). */
const LOCAL_IMAGE_PREFIX = '/api/blogs/image?';

/**
 * Makes the post's relative URLs absolute on the official blog host (`baseUrl`). Only cached
 * blog images stay local: any other root-relative URL, `/api/...` included, points at the blog
 * host, so a post can never make the app request its own API. Without a base URL the HTML is
 * returned unchanged.
 */
export function normalizeBlogUrls(html: string, baseUrl: string): string {
    if (!baseUrl) return html;
    return html.replace(
        /(src|href)=(["'])([^"']+)\2/g,
        (match: string, attr: string, quote: string, url: string) => {
            if (url.startsWith('//')) return `${attr}=${quote}https:${url}${quote}`;
            if (url.startsWith(LOCAL_IMAGE_PREFIX)) return match;
            if (url.startsWith('/')) return `${attr}=${quote}${baseUrl}${url}${quote}`;
            if (!url.startsWith('http')) return `${attr}=${quote}${baseUrl}/${url}${quote}`;
            return match;
        },
    );
}

export interface HighlightTerms {
    exact: string[];
    reading: string[];
}

/**
 * The terms to mark: the query and the snippet's marks. A term the snippet drew as a reading
 * match gets the reading mark, every other term the exact mark.
 */
export function splitHighlightTerms(
    searchQuery?: string, matchedTerms?: string[], readingTerms?: string[],
): HighlightTerms {
    const all = new Set<string>();
    if (searchQuery) all.add(searchQuery);
    matchedTerms?.forEach((t) => all.add(t));
    const reading = new Set(readingTerms ?? []);
    const terms = [...all].filter(Boolean);
    return { exact: terms.filter((t) => !reading.has(t)), reading: terms.filter((t) => reading.has(t)) };
}

/** A stable string for the terms: a memo key, since the term arrays may be new on every render. */
export function highlightKey(searchQuery?: string, matchedTerms?: string[], readingTerms?: string[]): string {
    return JSON.stringify(splitHighlightTerms(searchQuery, matchedTerms, readingTerms));
}

/** The terms of a {@link highlightKey}. */
export function parseHighlightKey(key: string): HighlightTerms {
    return JSON.parse(key) as HighlightTerms;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wraps every case-insensitive match of `terms` in the text nodes under `root` in
 * `<mark class={className}>` (longest term first). Attribute values are never touched.
 */
export function highlightTextNodes(root: Node, terms: string[], className: string): void {
    const escaped = terms.filter(Boolean).map(escapeRegex).sort((a, b) => b.length - a.length);
    if (escaped.length === 0) return;
    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    const doc = root.ownerDocument ?? (root as Document);
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    for (const text of texts) {
        const parts = text.data.split(pattern);
        if (parts.length === 1) continue;
        const replacement = doc.createDocumentFragment();
        parts.forEach((part, i) => {
            if (!part) return;
            if (i % 2 === 1) {
                const mark = doc.createElement('mark');
                mark.className = className;
                mark.textContent = part;
                replacement.append(mark);
            } else {
                replacement.append(doc.createTextNode(part));
            }
        });
        text.replaceWith(replacement);
    }
}

/** The sanitized post with the terms marked (reading marks first; exact marks win where both apply). */
export function buildBlogFragment(html: string, terms: HighlightTerms): DocumentFragment {
    const fragment = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: BLOG_ALLOWED_TAGS,
        ALLOWED_ATTR: BLOG_ALLOWED_ATTR,
        RETURN_DOM_FRAGMENT: true,
    });
    highlightTextNodes(fragment, terms.reading, READING_MARK_CLASS);
    highlightTextNodes(fragment, terms.exact, EXACT_MARK_CLASS);
    return fragment;
}
