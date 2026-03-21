/**
 * Settings hook for managing app and per-service settings.
 *
 * Handles:
 * - Loading/saving app settings (output directory, etc.)
 * - Loading/saving per-service settings (sync options, blog backup)
 * - Setup wizard flow for first-time configuration
 * - Folder selection dialog integration
 *
 * @example
 * ```tsx
 * function SettingsPanel() {
 *   const { appSettings, saveSettings, showSettingsModal } = useSettings(isAuthenticated);
 *
 *   return (
 *     <div>
 *       <p>Output: {appSettings?.output_dir}</p>
 *       <button onClick={() => saveSettings({ output_dir: '/new/path' })}>
 *         Change Output
 *       </button>
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
    /** Current value of output directory input field */
    outputDirInput: string;
    /** Update output directory input */
    setOutputDirInput: (dir: string) => void;
    /** Error message if settings operation failed */
    settingsError: string | null;
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
    /** Open native folder picker dialog */
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
    const [settingsError, setSettingsError] = useState<string | null>(null);
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
        try {
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!res.ok) throw new Error("Failed to save");
            const data = await res.json();
            setAppSettings(data);
            setOutputDirInput(data.output_dir);

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
            setSettingsError("Failed to save settings");
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
        try {
            const res = await fetch('/api/settings/select-folder', { method: 'POST' });
            const data = await res.json();
            if (data.path) {
                setOutputDirInput(data.path);
            } else if (data.error) {
                console.warn("Folder picker unavailable:", data.error);
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

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
        setOutputDirInput,
        settingsError,
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
