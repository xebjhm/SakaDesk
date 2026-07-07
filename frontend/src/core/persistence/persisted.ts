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
  };
  for (const [lsKey, prefKey] of Object.entries(scalarMap)) {
    const v = localStorage.getItem(lsKey);
    if (v !== null) migratedPrefs[prefKey] = v;
  }

  const conversations: Record<string, { value: string }> = {};
  const translations: Record<string, string> = {};
  const CONV_PREFIXES = ['read_state_', 'sakadesk_scroll_', 'bg_settings_'];
  const TRANS_PREFIX = 'translation:message:';
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === null) continue;
    const v = localStorage.getItem(k);
    if (v === null) continue;
    if (CONV_PREFIXES.some((p) => k.startsWith(p))) {
      conversations[k] = { value: v }; // key = full original localStorage key; raw string preserved
    } else if (k.startsWith(TRANS_PREFIX)) {
      translations[k.slice(TRANS_PREFIX.length)] = v; // cache key = "<message_id>:<lang>"
    }
  }

  try {
    await api.postMigrate({ prefs: migratedPrefs, conversations, translations });
    await persisted.hydratePrefs();
  } catch {
    /* leave unmigrated; a later launch retries */
  }
}
