import * as api from './appStateApi';
import { clientLog, type ClientLogFields } from '../../utils/clientLog';
import { breadcrumbCode } from '../../utils/breadcrumbCode';

/** Breadcrumb fields for a failed app-state call: the error class, plus the HTTP status when the backend answered. */
function failureFields(err: unknown): ClientLogFields {
  return err instanceof api.AppStateHttpError
    ? { error_type: breadcrumbCode(err), error_code: err.status }
    : { error_type: breadcrumbCode(err) };
}

let prefs: Record<string, unknown> = {};
const pending: Record<string, unknown> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// SD-FE-STATE-04: exponential backoff between failed flushes so a transient
// backend hiccup (SQLite lock) doesn't drop write-once keys (tos_accepted_at,
// language, dismissed_update). Reset to base on any success.
const FLUSH_BASE_DELAY = 300;
const FLUSH_MAX_DELAY = 30_000;
let flushBackoff = FLUSH_BASE_DELAY;

function armFlush(delay: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, delay);
}

function flush(): void {
  flushTimer = null;
  const keys = Object.keys(pending);
  if (keys.length === 0) return;
  const patch: Record<string, unknown> = {};
  for (const k of keys) {
    patch[k] = pending[k];
    delete pending[k];
  }
  api.patchPrefs(patch)
    .then(() => {
      // Success — reset backoff. Any writes queued meanwhile flush on their
      // own debounce (setPref re-arms at the base delay).
      flushBackoff = FLUSH_BASE_DELAY;
    })
    .catch((err) => {
      // SD-FE-STATE-04: re-queue the failed keys instead of dropping them, but
      // never clobber a NEWER value that arrived while this PATCH was in flight
      // (such a key is already back in `pending`). Then retry with backoff.
      for (const k of keys) {
        if (!(k in pending)) pending[k] = patch[k];
      }
      console.warn('[persisted] prefs PATCH failed; re-queued for retry', err);
      flushBackoff = Math.min(flushBackoff * 2, FLUSH_MAX_DELAY);
      armFlush(flushBackoff);
    });
}

// Eager-loaded cache of ALL per-conversation app-state rows (read_state/
// scroll/background). This set is small (a few hundred tiny rows total), so
// unlike the translation cache (which stays lazy/async — it's large), it is
// hydrated in full at startup to give synchronous getConv/setConv reads,
// matching the prefs cache pattern above.
let convCache: Record<string, Record<string, unknown>> = {};
// True only after the latest hydration GET succeeded. Until then (still loading,
// or the GET failed and the cache fell back to {}) getConv cannot tell a missing
// row from an unread one, so callers that write a row derived from its current
// value (the popup's heard bridge) must wait for this flag.
let convReady = false;

/**
 * Wait before each retry of a failed conversation-cache load: one retry after
 * each delay, so 1 + length attempts in all. A transient backend hiccup (SQLite
 * lock, slow first start) must not leave the cache unready for the session,
 * which would stop read progress from being saved (see saveReadState).
 */
export const CONV_HYDRATE_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Background retry schedule after the foreground load gave up: the wait before
 * retry i is CONV_BACKGROUND_RETRY_DELAYS_MS[i], and every retry past the end of
 * the list waits CONV_BACKGROUND_RETRY_MAX_MS. Retries continue until one succeeds.
 */
export const CONV_BACKGROUND_RETRY_DELAYS_MS: readonly number[] = [5000, 15000, 30000];
export const CONV_BACKGROUND_RETRY_MAX_MS = 60000;

const readyListeners = new Set<() => void>();
let backgroundRetrying = false;
// Every conversation-cache load attempt this session, foreground and background.
let totalAttempts = 0;

/** Store a loaded cache and, on the not-ready to ready transition, run each listener once. */
function markReady(cache: Record<string, Record<string, unknown>>): void {
  const wasReady = convReady;
  convCache = cache;
  convReady = true;
  if (!wasReady) readyListeners.forEach((fn) => { try { fn(); } catch { /* listener errors never break hydration */ } });
}

/** Keep loading the cache with backoff until it is ready; one loop at a time. */
async function backgroundRetry(): Promise<void> {
  if (backgroundRetrying) return;
  backgroundRetrying = true;
  try {
    for (let i = 0; !convReady; i++) {
      await wait(CONV_BACKGROUND_RETRY_DELAYS_MS[i] ?? CONV_BACKGROUND_RETRY_MAX_MS);
      if (convReady) break; // a foreground load (e.g. migration) succeeded meanwhile
      totalAttempts += 1;
      try {
        markReady(await api.getAllConversations());
        clientLog('conv_hydrate_recovered', { count: totalAttempts });
      } catch (err) {
        clientLog('conv_hydrate_retry', { index: totalAttempts, phase: 'background', ...failureFields(err) });
      }
    }
  } finally {
    backgroundRetrying = false;
  }
}

/**
 * Load every conversation row into the cache, retrying with backoff
 * (CONV_HYDRATE_RETRY_DELAYS_MS). Each retry logs `conv_hydrate_retry` and a
 * final failure `conv_hydrate_failed` (error class and HTTP status only). On
 * final failure the cache is empty and not ready, and a background loop keeps
 * retrying (CONV_BACKGROUND_RETRY_DELAYS_MS, then every
 * CONV_BACKGROUND_RETRY_MAX_MS), logging `conv_hydrate_retry` with
 * `phase: 'background'` per failure and `conv_hydrate_recovered` on success.
 * When the cache goes from not ready to ready, the listeners registered with
 * onConversationsReady run once. Never rejects.
 */
async function hydrateConversations(): Promise<void> {
  const attempts = CONV_HYDRATE_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 1; ; attempt++) {
    totalAttempts += 1;
    try {
      markReady(await api.getAllConversations());
      return;
    } catch (err) {
      if (attempt >= attempts) {
        convCache = {};
        convReady = false;
        clientLog('conv_hydrate_failed', { count: attempts, ...failureFields(err) });
        void backgroundRetry();
        return;
      }
      clientLog('conv_hydrate_retry', { index: attempt, ...failureFields(err) });
      await wait(CONV_HYDRATE_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
}

export const persisted = {
  async hydratePrefs(): Promise<void> {
    try { prefs = await api.getPrefs(); } catch { prefs = {}; }
  },
  getPref<T>(key: string, fallback: T): T {
    return (key in prefs ? (prefs[key] as T) : fallback);
  },
  setPref(key: string, value: unknown): void {
    prefs[key] = value; pending[key] = value;
    armFlush(FLUSH_BASE_DELAY);
  },
  // SD-FE-STATE-03: synchronously hand off any pending prefs writes so the
  // "change something → close the window" pattern doesn't lose the final
  // debounced write. Called from a pagehide/visibilitychange handler; uses a
  // keepalive request that survives the JS context teardown on close.
  flushNow(): void {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const keys = Object.keys(pending);
    if (keys.length === 0) return;
    const patch: Record<string, unknown> = {};
    for (const k of keys) {
      patch[k] = pending[k];
      delete pending[k];
    }
    // If the keepalive handoff fails synchronously, restore the keys so a
    // write-once value (tos_accepted_at, language) isn't silently lost — unless a
    // newer value already arrived. (Review follow-up to SD-FE-STATE-03/04.)
    if (!api.patchPrefsBeacon(patch)) {
      for (const k of keys) {
        if (!(k in pending)) pending[k] = patch[k];
      }
    }
  },
  getConversation: api.getConversation,
  setConversation: api.patchConversation,
  hydrateConversations,
  /**
   * Run `listener` each time the conversation cache goes from not ready to ready
   * (a listener added while already ready is not called). Returns an unsubscribe function.
   */
  onConversationsReady(listener: () => void): () => void {
    readyListeners.add(listener);
    return () => { readyListeners.delete(listener); };
  },
  /** True once the conversation cache loaded successfully (see convReady). */
  conversationsReady(): boolean {
    return convReady;
  },
  getConv<T = Record<string, unknown>>(key: string, fallback: T): T {
    return (key in convCache ? (convCache[key] as unknown as T) : fallback);
  },
  setConv(key: string, patch: Record<string, unknown>): void {
    convCache[key] = { ...(convCache[key] || {}), ...patch };
    // The cache is already updated; a refused write is logged (no key: it holds a path).
    api.patchConversation(key, patch).catch((err) => clientLog('conv_write_failed', failureFields(err)));
  },
  // SD-FE-STATE-03: keepalive conversation write for the close-flush path (scroll
  // position, read state). The plain setConv above uses a non-keepalive PATCH
  // that is abandoned when pywebview tears down the JS context on close.
  setConvBeacon(key: string, patch: Record<string, unknown>): void {
    convCache[key] = { ...(convCache[key] || {}), ...patch };
    api.patchConversationBeacon(key, patch);
  },
  getTranslations: api.getTranslations,
  putTranslations: api.patchTranslations,
  migrateOnce,
};

// One-time migration of pre-existing browser localStorage state into the
// backend app-state store, so upgrading users keep ToS/read-state/scroll/
// background/translation-cache on first run of a build that switched to
// backend-persisted app state. Safe to call on every startup: it checks
// the backend "migrated" flag first and is a no-op once that flag is set.
//
// NOTE: read_state_/bg_settings_ keys carry a conversation PATH, but
// sakadesk_scroll_ carries a numeric MEMBER ID — these cannot be merged
// into a single unified row. Instead each per-conversation localStorage
// key is mirrored verbatim into `conversations`: the row key is the full
// original localStorage key, and the value is `{ value: <raw string> }`.
export async function migrateOnce(): Promise<void> {
  let already = true;
  try {
    already = (await api.getMigrated()).migrated;
  } catch {
    return; // backend not reachable yet — skip; retry next launch (flag stays false)
  }
  if (already) return;

  const migratedPrefs: Record<string, unknown> = {};
  const scalarMap: Record<string, string> = {
    tos_accepted_at: 'tos_accepted_at',
    'sakadesk-language': 'language',
    sakadesk_dismissed_update: 'dismissed_update',
    'sakadesk-app-state': 'sakadesk-app-state',
  };
  for (const [lsKey, prefKey] of Object.entries(scalarMap)) {
    const v = localStorage.getItem(lsKey);
    if (v !== null) migratedPrefs[prefKey] = v;
  }

  const conversations: Record<string, { value: string }> = {};
  const translations: Record<string, string> = {};
  const CONV_PREFIXES = ['read_state_', 'sakadesk_scroll_', 'bg_settings_'];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === null) continue;
    const v = localStorage.getItem(k);
    if (v === null) continue;
    if (CONV_PREFIXES.some((p) => k.startsWith(p))) {
      conversations[k] = { value: v }; // key = full original localStorage key; raw string preserved
    } else if (k.startsWith('translation:')) {
      translations[k] = v; // full key preserved (all translation types, not just 'message')
    }
  }

  try {
    await api.postMigrate({ prefs: migratedPrefs, conversations, translations });
    await persisted.hydratePrefs();
    await persisted.hydrateConversations(); // migration wrote conversation rows; refresh the cache
  } catch {
    /* leave unmigrated; a later launch retries */
  }
}
