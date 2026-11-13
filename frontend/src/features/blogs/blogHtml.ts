// frontend/src/features/blogs/blogHtml.ts
/**
 * Blog post HTML → a sanitized DOM fragment with search highlights.
 *
 * Remote member-authored HTML is sanitized by DOMPurify straight into a DocumentFragment
 * (RETURN_DOM_FRAGMENT). Its URLs are then resolved on that DOM and search terms are marked by
 * splitting its text nodes, so the post is never serialized, edited or re-parsed as an HTML
 * string. (A regex over DOMPurify's serialized output
 * once treated attribute text as text: on a runtime that leaves '<' and '>' raw in attribute
 * values, a highlight inside an alt closed the attribute and the rest became live markup;
 * security audit 2026-11-13.) The fragment belongs to DOMPurify's inert document, so nothing
 * in it loads until BlogBody inserts a copy.
 */
import DOMPurify from 'dompurify';
import { isLoopbackHost } from '../../utils/loopbackHost';

/** Elements a post keeps. */
export const BLOG_ALLOWED_TAGS: string[] = [
    'p', 'br', 'strong', 'em', 'a', 'img', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li',
];
/** Attributes a post keeps. */
export const BLOG_ALLOWED_ATTR: string[] = ['href', 'src', 'alt', 'class', 'target', 'rel'];

export const EXACT_MARK_CLASS = 'search-snippet search-highlight';
export const READING_MARK_CLASS = 'search-snippet search-highlight reading';

/** The one local endpoint a post may reach: an image cached by a blog backup (`GET /api/blogs/image`). */
const LOCAL_IMAGE_PATH = '/api/blogs/image';

/** A base no real URL can resolve against: relative values that land on it had no base to use. */
const NO_BASE = 'https://no-base.invalid/';

/**
 * The URL a post's `src`/`href` may keep, or null to drop it. Values resolve against the post's
 * blog base URL (an unresolvable relative value when there is none). Kept: the cached-image
 * endpoint as a relative app URL and `data:` images (both img src only), and absolute http(s)
 * URLs off the app origin and off loopback. A value that lands on the cached-image endpoint
 * anywhere but an img src is dropped.
 */
function resolvePostUrl(
    raw: string, base: string, appOrigin: string, isImgSrc: boolean,
): string | null {
    try {
        const local = new URL(raw, appOrigin);
        if (local.origin === appOrigin && local.pathname === LOCAL_IMAGE_PATH) {
            // An anchor that wrapped a cached image is left without an href: resolved on the
            // blog base it would only be a 404 on the official site.
            return isImgSrc ? `${LOCAL_IMAGE_PATH}${local.search}` : null;
        }
        if (isImgSrc && /^data:image\//i.test(raw.trim())) return raw;
        // 'http:/x' and 'http:x' carry a scheme but no authority: browsers resolve them against the
        // current document (the app), so they are dropped rather than guessed at.
        if (/^\s*https?:(?![/\\]{2})/i.test(raw)) return null;
        const url = new URL(raw, base || NO_BASE);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        if (!base && url.origin === new URL(NO_BASE).origin) return null;
        if (isLoopbackHost(url.hostname) || url.origin === appOrigin) return null;
        return url.href;
    } catch {
        return null;
    }
}

/**
 * Rewrites (or removes) every `src`/`href` of the sanitized `root` with {@link resolvePostUrl},
 * so no post URL points at the app origin (other than the cached-image endpoint) or at a loopback
 * address or `localhost` name. Names that reach loopback only through DNS are left to the
 * backend's Host allowlist.
 */
export function resolveBlogUrls(root: ParentNode, baseUrl: string, appOrigin: string): void {
    const base = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/` : '';
    for (const el of Array.from(root.querySelectorAll('[src],[href]'))) {
        for (const attr of ['src', 'href']) {
            const raw = el.getAttribute(attr);
            if (raw === null) continue;
            const resolved = resolvePostUrl(raw, base, appOrigin, attr === 'src' && el.localName === 'img');
            if (resolved === null) el.removeAttribute(attr);
            else el.setAttribute(attr, resolved);
        }
    }
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

/**
 * The sanitized post with its URLs resolved against `baseUrl` (see {@link resolveBlogUrls}) and
 * the terms marked (reading marks first; exact marks win where both apply).
 */
export function buildBlogFragment(
    html: string, terms: HighlightTerms, baseUrl = '', appOrigin: string = window.location.origin,
): DocumentFragment {
    const fragment = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: BLOG_ALLOWED_TAGS,
        ALLOWED_ATTR: BLOG_ALLOWED_ATTR,
        RETURN_DOM_FRAGMENT: true,
    });
    resolveBlogUrls(fragment, baseUrl, appOrigin);
    highlightTextNodes(fragment, terms.reading, READING_MARK_CLASS);
    highlightTextNodes(fragment, terms.exact, EXACT_MARK_CLASS);
    return fragment;
}
