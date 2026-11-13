/**
 * Settings hook for managing app and per-service settings.
 *
 * Handles:
 * - Loading/saving app settings (output directory, etc.)
 * - Loading/saving per-service settings (sync options, blog backup)
 * - Setup wizard flow for first-time configuration
 * - The native folder picker, the only way to choose the output folder
 *   (security audit 2026-11-13: the backend refuses a folder it did not pick)
 *
 * @example
 * ```tsx
 * function SettingsPanel() {
 *   const { outputDirInput, handleSelectFolder, saveSettings } = useSettings(isAuthenticated);
 *
 *   return (
 *     <div>
 *       <p>Output: {outputDirInput}</p>
 *       <button onClick={handleSelectFolder}>Browse</button>
 *       <button onClick={() => saveSettings({ output_dir: outputDirInput })}>Save</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @module useSettings
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';
import { SERVICE_FEATURES } from '../../config/features';
import { forgetListSnapshots } from '../../features/messages/listSnapshotStore';
import { pickOutputFolder, saveErrorKey } from '../outputFolder';
import { clientLog } from '../../utils/clientLog';

/** Per-service settings for sync and blog backup. */
export interface ServiceSettings {
    sync_enabled: boolean;
    adaptive_sync_enabled: boolean;
    last_sync: string | null;
    blogs_full_backup: boolean;
}

/** Return type for the useSettings hook. */
export interface UseSettingsReturn {
    /** Current app settings (output dir, etc.) */
    appSettings: AppSettings | null;
    /** Update app settings state */
    setAppSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
    /** All service-specific settings keyed by service ID */
    allServiceSettings: Record<string, ServiceSettings>;
    /** List of connected service IDs */
    connectedServices: string[];
    /** The folder the read-only output folder field shows: the saved one, or the one just picked with Browse (the field returns to the saved one when Settings opens or closes) */
    outputDirInput: string;
    /** i18n key of the last failed save's message (translated at display time), or null */
    settingsErrorKey: string | null;
    /** i18n key of the newest output-folder problem (`settings.outputDirError.*`: a failed pick or a refused save), shown by the field, or null */
    folderErrorKey: string | null;
    /** Dismiss the save error */
    clearSettingsError: () => void;
    /** Whether settings modal is visible */
    showSettingsModal: boolean;
    /** Toggle settings modal */
    setShowSettingsModal: (show: boolean) => void;
    /** Whether setup wizard is visible */
    showSetupWizard: boolean;
    /** Toggle setup wizard */
    setShowSetupWizard: (show: boolean) => void;
    /** Blog backup preference for setup wizard */
    setupBlogFullBackup: boolean;
    /** Update blog backup preference */
    setSetupBlogFullBackup: (enabled: boolean) => void;
    /** Save app settings to backend */
    saveSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
    /** Save per-service settings to backend */
    saveServiceSettings: (service: string, updates: Partial<ServiceSettings>) => Promise<void>;
    /** Open the native folder picker; a chosen folder fills the field, a failure sets `folderErrorKey`. A result that arrives after the Settings dialog opened or closed, or after the folder was saved, is dropped. */
    handleSelectFolder: () => Promise<void>;
    /** Open settings modal */
    openSettingsModal: () => void;
}

export function useSettings(_isAuthenticated: boolean | null): UseSettingsReturn {
    const { selectedServices } = useAppStore();

    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [allServiceSettings, setAllServiceSettings] = useState<Record<string, ServiceSettings>>({});
    const allServiceSettingsRef = useRef(allServiceSettings);
    allServiceSettingsRef.current = allServiceSettings;
    const [outputDirInput, setOutputDirInput] = useState('');
    const [settingsErrorKey, setSettingsErrorKey] = useState<string | null>(null);
    const [folderErrorKey, setFolderErrorKey] = useState<string | null>(null);
    // Bumped whenever a picker result in flight stops mattering (Settings opened or closed,
    // the folder is being saved): handleSelectFolder drops a result from an older epoch.
    const pickEpochRef = useRef(0);
    const appSettingsRef = useRef(appSettings);
    appSettingsRef.current = appSettings;
    const clearSettingsError = useCallback(() => setSettingsErrorKey(null), []);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showSetupWizard, setShowSetupWizard] = useState(false);
    const [setupBlogFullBackup, setSetupBlogFullBackup] = useState(false);

    const loadServiceSettings = useCallback(async (service: string) => {
        try {
            const res = await fetch(`/api/settings/service/${encodeURIComponent(service)}`);
            if (res.ok) {
                const data = await res.json();
                setAllServiceSettings(prev => ({ ...prev, [service]: data }));
            }
        } catch (e) {
            console.error('Failed to load service settings:', e);
        }
    }, []);

    const saveSettings = useCallback(async (updates: Partial<AppSettings>): Promise<boolean> => {
        // A new save replaces the last error: a success leaves none.
        setSettingsErrorKey(null);
        const savesFolder = 'output_dir' in updates;
        if (savesFolder) {
            // The newest word on the folder wins: no older picker error, no pick still open.
            pickEpochRef.current += 1;
            setFolderErrorKey(null);
        }
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) {
                // A refused output folder names its reason; anything else is the generic message.
                const key = await saveErrorKey(res);
                setSettingsErrorKey(key);
                // The reason also shows by the field (the toast sits outside the dialog).
                if (savesFolder && key.startsWith('settings.outputDirError.')) setFolderErrorKey(key);
                return false;
            }
            const data = await res.json();
            // Another archive: the chat's list snapshots show rooms of the old one (W3).
            if ('output_dir' in updates) forgetListSnapshots();
            setAppSettings(data);
            // Only a folder save rewrites the field: a picked but unsaved folder survives other saves.
            if (savesFolder) setOutputDirInput(data.output_dir);

            // Blog backup toggle: start/stop backup on setting change.
            // During first-launch setup, App.tsx defers saving blogs_full_backup
            // until after sync completes, so this fires at the right time.
            if ('blogs_full_backup' in updates && data.is_configured) {
                const { selectedServices: services } = useAppStore.getState();
                // Filter to services that actually support blogs (excludes yodel)
                const blogServices = services.filter(s => SERVICE_FEATURES[s]?.includes('blogs'));
                if (updates.blogs_full_backup && blogServices.length > 0) {
                    const params = blogServices.map(s => `services=${encodeURIComponent(s)}`).join('&');
                    fetch(`/api/blogs/backup/start?${params}`, { method: 'POST' }).catch(console.error);
                } else if (!updates.blogs_full_backup) {
                    fetch('/api/blogs/backup/stop', { method: 'POST' }).catch(console.error);
                }
            }

            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            setSettingsErrorKey('settings.saveFailed');
            return false;
        }
    }, []);

    const saveServiceSettings = useCallback(async (service: string, updates: Partial<ServiceSettings>) => {
        const current = allServiceSettingsRef.current[service];
        if (!current) return;
        const merged = { ...current, ...updates };
        try {
            const res = await fetch(`/api/settings/service/${encodeURIComponent(service)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(merged)
            });
            if (res.ok) {
                const data = await res.json();
                setAllServiceSettings(prev => ({ ...prev, [service]: data }));
            }
        } catch (e) {
            console.error('Failed to save service settings:', e);
        }
    }, []);

    const handleSelectFolder = useCallback(async () => {
        const epoch = pickEpochRef.current;
        const { path, errorKey } = await pickOutputFolder();
        if (epoch !== pickEpochRef.current) {
            clientLog('output_folder_pick_ignored', { reason: 'superseded' });
            return;
        }
        setFolderErrorKey(errorKey);
        if (path) setOutputDirInput(path);
    }, []);

    // Settings opens or closes: a picked but unsaved folder must not linger (its grant
    // expires anyway), so the field shows the saved folder again and a pick in flight is dropped.
    useEffect(() => {
        pickEpochRef.current += 1;
        setOutputDirInput(appSettingsRef.current?.output_dir ?? '');
        setFolderErrorKey(null);
    }, [showSettingsModal]);

    const openSettingsModal = useCallback(() => {
        setShowSettingsModal(true);
        selectedServices.forEach(service => loadServiceSettings(service));
    }, [selectedServices, loadServiceSettings]);

    // Load app-level settings on mount (not auth-gated — output dir, is_configured are app-level)
    useEffect(() => {
        fetch('/api/settings')
            .then(res => res.json())
            .then(data => {
                setAppSettings(data);
                setOutputDirInput(data.output_dir);
                if (!data.is_configured) {
                    setShowSetupWizard(true);
                }
            })
            .catch(console.error);
    }, []);

    // Load settings for all connected services
    useEffect(() => {
        selectedServices.forEach(service => {
            if (!allServiceSettings[service]) {
                loadServiceSettings(service);
            }
        });
    }, [selectedServices, loadServiceSettings]);

    // Nicknames are cached by the backend during sync (sync_service.py) and
    // returned in the GET /api/settings response on mount. No separate profile
    // fetch is needed here — the nickname is available before messages render.

    return {
        appSettings,
        setAppSettings,
        allServiceSettings,
        connectedServices: selectedServices,
        outputDirInput,
        settingsErrorKey,
        clearSettingsError,
        folderErrorKey,
        showSettingsModal,
        setShowSettingsModal,
        showSetupWizard,
        setShowSetupWizard,
        setupBlogFullBackup,
        setSetupBlogFullBackup,
        saveSettings,
        saveServiceSettings,
        handleSelectFolder,
        openSettingsModal,
    };
}
