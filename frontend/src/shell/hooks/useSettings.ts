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

import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';

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
    /** Current service-specific settings */
    serviceSettings: ServiceSettings | null;
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

export function useSettings(isAuthenticated: boolean | null): UseSettingsReturn {
    const { activeService } = useAppStore();

    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [serviceSettings, setServiceSettings] = useState<ServiceSettings | null>(null);
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
                setServiceSettings(data);
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
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            setSettingsError("Failed to save settings");
            return false;
        }
    }, []);

    const saveServiceSettings = useCallback(async (service: string, updates: Partial<ServiceSettings>) => {
        if (!serviceSettings) return;
        const merged = { ...serviceSettings, ...updates };
        try {
            const res = await fetch(`/api/settings/service/${encodeURIComponent(service)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(merged)
            });
            if (res.ok) {
                const data = await res.json();
                setServiceSettings(data);
            }
        } catch (e) {
            console.error('Failed to save service settings:', e);
        }
    }, [serviceSettings]);

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
        if (activeService) {
            loadServiceSettings(activeService);
        }
        setShowSettingsModal(true);
    }, [activeService, loadServiceSettings]);

    // Load settings on auth
    useEffect(() => {
        if (isAuthenticated) {
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
        }
    }, [isAuthenticated]);

    // Fetch nickname when activeService changes (per-service nicknames)
    useEffect(() => {
        if (isAuthenticated && activeService) {
            fetch(`/api/profile?service=${encodeURIComponent(activeService)}`)
                .then(res => res.json())
                .then(profileData => {
                    if (profileData.nickname) {
                        setAppSettings(prev => {
                            if (!prev) return prev;
                            const newNicknames = { ...(prev.user_nicknames || {}), [activeService]: profileData.nickname };
                            return {
                                ...prev,
                                user_nickname: profileData.nickname,  // Legacy: keep for compatibility
                                user_nicknames: newNicknames,
                            };
                        });
                    }
                })
                .catch(console.error);
        }
    }, [isAuthenticated, activeService]);

    return {
        appSettings,
        setAppSettings,
        serviceSettings,
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
