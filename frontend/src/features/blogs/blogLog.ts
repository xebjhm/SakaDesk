import { clientLog } from '../../utils/clientLog';

/** Which blog load ran (docs/superpowers/specs/2026-11-05-d2b-blogs-design.md, Error handling). */
export type BlogLoadTarget = 'recent' | 'sync' | 'content' | 'search_open' | 'members' | 'member_posts' | 'nav_list';
export type BlogLoadOutcome = 'ok' | 'error' | 'cache_hit' | 'cancelled' | 'in_flight';

/** One `blog_load` breadcrumb. Never pass titles, names, ids, URLs or error text. */
export function logBlogLoad(target: BlogLoadTarget, outcome: BlogLoadOutcome, count?: number): void {
    clientLog('blog_load', count === undefined ? { target, outcome } : { target, outcome, count });
}
