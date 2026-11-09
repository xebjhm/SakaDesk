import i18n from '../i18n';
import { persisted } from '../core/persistence/persisted';

/**
 * The single ordered startup language decision, shared by App and the call
 * popup (i18n/index.ts no longer applies /api/settings itself, avoiding a
 * startup race between the two): 1) the persisted user choice, 2) the
 * installer/settings.json language, 3) the browser-detected default already
 * applied by i18n/index.ts's synchronous init (no action needed).
 * Call after persisted.hydratePrefs() (and, in App, the migration).
 */
export async function applyStartupLanguage(): Promise<void> {
    const lang = persisted.getPref<string | null>('language', null);
    if (lang) {
        await i18n.changeLanguage(lang);
        return;
    }
    try {
        const s = await (await fetch('/api/settings')).json();
        if (s?.language) await i18n.changeLanguage(s.language);
    } catch { /* keep browser-detected default */ }
}
