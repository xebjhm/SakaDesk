import * as api from './appStateApi';

let prefs: Record<string, unknown> = {};
const pending: Record<string, unknown> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  flushTimer = null;
  const patch = { ...pending };
  for (const k of Object.keys(pending)) delete pending[k];
  api.patchPrefs(patch).catch(() => {/* logged; retried on next set */});
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
    if (!flushTimer) flushTimer = setTimeout(flush, 300);
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
