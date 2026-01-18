import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { useAppStore } from '../../store/appStore';

export interface ServiceSettings {
    sync_enabled: boolean;
    adaptive_sync_enabled: boolean;
    last_sync: string | null;
    blogs_full_backup: boolean;
}

export interface UseSettingsReturn {
    appSettings: AppSettings | null;
    setAppSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
    serviceSettings: ServiceSettings | null;
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    settingsError: string | null;
    showSettingsModal: boolean;
    setShowSettingsModal: (show: boolean) => void;
    showSetupWizard: boolean;
    setShowSetupWizard: (show: boolean) => void;
    setupBlogFullBackup: boolean;
    setSetupBlogFullBackup: (enabled: boolean) => void;
    saveSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
    saveServiceSettings: (service: string, updates: Partial<ServiceSettings>) => Promise<void>;
    handleSelectFolder: () => Promise<void>;
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
                        setAppSettings(prev => prev ? { ...prev, user_nickname: profileData.nickname } : prev);
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
