const BASE = '/api/app-state';

/** A non-2xx answer from the app-state API. The message carries the status only, never the request path. */
export class AppStateHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`app-state request failed: ${status}`);
    this.name = 'AppStateHttpError';
    this.status = status;
  }
}

/** Parse a JSON answer; rejects with {@link AppStateHttpError} on non-2xx so an error body is never taken for data. */
async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new AppStateHttpError(r.status);
  return r.json() as Promise<T>;
}
export const getPrefs = () => fetch(`${BASE}/prefs`).then(j<Record<string, unknown>>);
export const patchPrefs = (p: Record<string, unknown>) =>
  fetch(`${BASE}/prefs`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(() => undefined);
// SD-FE-STATE-03: a fire-and-forget PATCH that survives page teardown (pywebview
// tears down the JS context on close, so the normal debounced flush would never
// reach the backend). Uses fetch({keepalive:true}) against the SAME PATCH
// endpoint so no new backend route is required; the browser keeps the request
// alive past unload. Returns true if the write was handed off, false otherwise.
export const patchPrefsBeacon = (p: Record<string, unknown>): boolean => {
  try {
    fetch(`${BASE}/prefs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};
export const getConversation = (path: string) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`).then(j<Record<string, unknown>>);
export const getAllConversations = () =>
  fetch(`${BASE}/conversation-all`).then(j<Record<string, Record<string, unknown>>>);
// Rejects with AppStateHttpError on non-2xx, so a refused write reaches the caller's catch.
export const patchConversation = (path: string, p: Record<string, unknown>) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then((r) => {
    if (!r.ok) throw new AppStateHttpError(r.status);
  });
// SD-FE-STATE-03: keepalive counterpart so the final scroll/conversation write
// survives page teardown on close (the plain patchConversation above is
// abandoned when pywebview tears down the JS context). Returns true if handed off.
export const patchConversationBeacon = (path: string, p: Record<string, unknown>): boolean => {
  try {
    fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
      keepalive: true,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};
/** Mirrors `MAX_TRANSLATION_KEYS` in `backend/api/app_state.py`. */
export const TRANSLATION_LOOKUP_MAX_KEYS = 100;
// Rejects on a non-2xx answer (e.g. 422) so a refused lookup is not mistaken for
// "nothing cached". Lookups above the backend's key limit are split into several requests.
export const getTranslations = async (keys: string[]): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += TRANSLATION_LOOKUP_MAX_KEYS) {
    const chunk = keys.slice(i, i + TRANSLATION_LOOKUP_MAX_KEYS);
    const r = await fetch(`${BASE}/translations?keys=${chunk.map(encodeURIComponent).join(',')}`);
    if (!r.ok) throw new Error(`get translations failed: ${r.status}`);
    Object.assign(out, await r.json() as Record<string, string>);
  }
  return out;
};
export const patchTranslations = (items: Record<string, string>) =>
  fetch(`${BASE}/translations`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) }).then(() => undefined);
// Rejects when the backend refuses (non-2xx) or is unreachable, so callers can report it.
export const clearTranslations = () =>
  fetch(`${BASE}/translations/clear`, { method: 'POST' }).then((r) => {
    if (!r.ok) throw new Error(`clear translations failed: ${r.status}`);
  });
export const getMigrated = () => fetch(`${BASE}/migrate`).then(j<{ migrated: boolean }>);
export const postMigrate = (dump: unknown) =>
  fetch(`${BASE}/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dump) }).then(() => undefined);
