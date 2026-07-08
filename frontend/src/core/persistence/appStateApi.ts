const BASE = '/api/app-state';
async function j<T>(r: Response): Promise<T> { return r.json() as Promise<T>; }
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
export const patchConversation = (path: string, p: Record<string, unknown>) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(() => undefined);
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
export const getTranslations = (keys: string[]) =>
  fetch(`${BASE}/translations?keys=${keys.map(encodeURIComponent).join(',')}`).then(j<Record<string, string>>);
export const patchTranslations = (items: Record<string, string>) =>
  fetch(`${BASE}/translations`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) }).then(() => undefined);
export const clearTranslations = () =>
  fetch(`${BASE}/translations/clear`, { method: 'POST' }).then(() => undefined);
export const getMigrated = () => fetch(`${BASE}/migrate`).then(j<{ migrated: boolean }>);
export const postMigrate = (dump: unknown) =>
  fetch(`${BASE}/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dump) }).then(() => undefined);
