/**
 * Opens a web link outside SakaDesk, in the user's browser.
 *
 * `window.open` raises WebView2's new-window request, which the desktop shell's navigation
 * guard (nav_guard.py) answers by handing http(s) URLs to the default browser and dropping
 * anything else; in a plain browser (the dev server) it opens a tab. Only an absolute http(s)
 * URL on another origin is opened: a relative, same-origin, `mailto:` or other link is
 * refused, so remote content can never point the app at itself (security audit 2026-11-13).
 * Logs `external_link` with `surface` and `outcome` (`opened`, or `blocked` with a `reason`:
 * `invalid`, `scheme`, `same_origin`); never the URL.
 */
import { clientLog } from './clientLog';

export type ExternalLinkSurface = 'blog_post' | 'message';
export type ExternalLinkResult = 'opened' | 'blocked';

export function openExternal(href: string | null | undefined, surface: ExternalLinkSurface): ExternalLinkResult {
    let url: URL;
    try {
        url = new URL(href ?? '');
    } catch {
        clientLog('external_link', { surface, outcome: 'blocked', reason: 'invalid' });
        return 'blocked';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        clientLog('external_link', { surface, outcome: 'blocked', reason: 'scheme' });
        return 'blocked';
    }
    if (url.origin === window.location.origin) {
        clientLog('external_link', { surface, outcome: 'blocked', reason: 'same_origin' });
        return 'blocked';
    }
    window.open(url.href, '_blank', 'noopener,noreferrer');
    clientLog('external_link', { surface, outcome: 'opened' });
    return 'opened';
}
