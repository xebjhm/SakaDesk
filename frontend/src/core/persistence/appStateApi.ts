const BASE = '/api/app-state';
async function j<T>(r: Response): Promise<T> { return r.json() as Promise<T>; }
export const getPrefs = () => fetch(`${BASE}/prefs`).then(j<Record<string, unknown>>);
export const patchPrefs = (p: Record<string, unknown>) =>
  fetch(`${BASE}/prefs`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(() => undefined);
export const getConversation = (path: string) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`).then(j<Record<string, unknown>>);
export const getAllConversations = () =>
  fetch(`${BASE}/conversation-all`).then(j<Record<string, Record<string, unknown>>>);
export const patchConversation = (path: string, p: Record<string, unknown>) =>
  fetch(`${BASE}/conversation?path=${encodeURIComponent(path)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then(() => undefined);
export const getTranslations = (keys: string[]) =>
  fetch(`${BASE}/translations?keys=${keys.map(encodeURIComponent).join(',')}`).then(j<Record<string, string>>);
export const patchTranslations = (items: Record<string, string>) =>
  fetch(`${BASE}/translations`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) }).then(() => undefined);
export const clearTranslations = () =>
  fetch(`${BASE}/translations/clear`, { method: 'POST' }).then(() => undefined);
export const getMigrated = () => fetch(`${BASE}/migrate`).then(j<{ migrated: boolean }>);
export const postMigrate = (dump: unknown) =>
  fetch(`${BASE}/migrate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dump) }).then(() => undefined);
