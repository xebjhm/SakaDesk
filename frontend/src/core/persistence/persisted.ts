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
};
