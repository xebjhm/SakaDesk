import * as api from './appStateApi';

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

async function hydrateConversations(): Promise<void> {
  try { convCache = await api.getAllConversations(); } catch { convCache = {}; }
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
  getConv<T = Record<string, unknown>>(key: string, fallback: T): T {
    return (key in convCache ? (convCache[key] as unknown as T) : fallback);
  },
  setConv(key: string, patch: Record<string, unknown>): void {
    convCache[key] = { ...(convCache[key] || {}), ...patch };
    api.patchConversation(key, patch).catch(() => {/* logged; cache already updated */});
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
