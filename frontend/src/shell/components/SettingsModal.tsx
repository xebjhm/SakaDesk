import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTranslation, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import type { AppSettings } from '../../features/messages/MessagesFeature';

interface SettingsModalProps {
    appSettings: AppSettings;
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    onSaveSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    appSettings,
    outputDirInput,
    setOutputDirInput,
    onSaveSettings,
    onClose,
}) => {
    const { t, i18n } = useTranslation();
    const selectedServices = useAppStore(s => s.selectedServices);
    const [blogCacheSize, setBlogCacheSize] = useState<string | null>(null);
    const [isClearing, setIsClearing] = useState(false);

    const formatBytes = (bytes: number): string => {
        if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
        return `${bytes} B`;
    };

    const loadBlogCacheSize = async () => {
        try {
            let totalBytes = 0;
            for (const service of selectedServices) {
                const res = await fetch(`/api/blogs/cache-size?service=${encodeURIComponent(service)}`);
                if (res.ok) {
                    const data = await res.json();
                    totalBytes += data.size_bytes || 0;
                }
            }
            setBlogCacheSize(totalBytes > 0 ? formatBytes(totalBytes) : null);
        } catch {
            setBlogCacheSize(null);
        }
    };

    useEffect(() => {
        if (appSettings.blogs_full_backup && selectedServices.length > 0) {
            loadBlogCacheSize();
        }
    }, [appSettings.blogs_full_backup, selectedServices]);

    const handleCleanBlogCache = async () => {
        if (!window.confirm(t('settings.cleanBlogCacheConfirm'))) return;
        if (!window.confirm(t('settings.cleanBlogCacheConfirm2'))) return;

        setIsClearing(true);
        try {
            for (const service of selectedServices) {
                await fetch(`/api/blogs/cache?service=${encodeURIComponent(service)}`, { method: 'DELETE' });
            }
            await loadBlogCacheSize();
        } catch (err) {
            console.error('Failed to clean blog cache:', err);
        } finally {
            setIsClearing(false);
        }
    };

    const handleLanguageChange = (lang: SupportedLanguage) => {
        i18n.changeLanguage(lang);
        localStorage.setItem('hakodesk-language', lang);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
                <div className="bg-gray-100 px-6 py-4 flex items-center justify-between border-b flex-shrink-0">
                    <h3 className="text-lg font-bold text-gray-800">{t('settings.title')}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        X
                    </button>
                </div>
                <div className="p-6 space-y-6 overflow-y-auto">
                    {/* Language Selector */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.language')}
                        </label>
                        <select
                            value={i18n.language}
                            onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {Object.entries(SUPPORTED_LANGUAGES).map(([code, { nativeName }]) => (
                                <option key={code} value={code}>
                                    {nativeName}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">{t('settings.languageDesc')}</p>
                    </div>

                    {/* Output Folder */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.outputFolder')}
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={outputDirInput}
                                onChange={(e) => setOutputDirInput(e.target.value)}
                                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                                onClick={() => onSaveSettings({ output_dir: outputDirInput })}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                            >
                                {t('common.save')}
                            </button>
                        </div>
                    </div>

                    {/* Sync Mode */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            {t('settings.syncMode')}
                        </label>
                        {/* Current state summary */}
                        <p className="text-xs text-gray-500 mb-2">
                            {!appSettings.auto_sync_enabled
                                ? t('settings.syncCurrentOff')
                                : appSettings.adaptive_sync_enabled
                                    ? t('settings.syncCurrentSmart')
                                    : t('settings.syncCurrentFixed', { minutes: appSettings.sync_interval_minutes })}
                        </p>
                        <div className="space-y-1">
                            {/* Off */}
                            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                                <input
                                    type="radio"
                                    name="syncMode"
                                    checked={!appSettings.auto_sync_enabled}
                                    onChange={() => onSaveSettings({ auto_sync_enabled: false, adaptive_sync_enabled: false })}
                                    className="w-4 h-4 text-blue-500"
                                />
                                <div>
                                    <span className="text-sm text-gray-700">{t('settings.syncOff')}</span>
                                    <p className="text-xs text-gray-400">{t('settings.syncOffDesc')}</p>
                                </div>
                            </label>

                            {/* Fixed interval */}
                            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                                <input
                                    type="radio"
                                    name="syncMode"
                                    checked={appSettings.auto_sync_enabled && !appSettings.adaptive_sync_enabled}
                                    onChange={() => onSaveSettings({ auto_sync_enabled: true, adaptive_sync_enabled: false })}
                                    className="w-4 h-4 text-blue-500"
                                />
                                <div>
                                    <span className="text-sm text-gray-700">{t('settings.syncFixed')}</span>
                                    <p className="text-xs text-gray-400">{t('settings.syncFixedDesc')}</p>
                                </div>
                            </label>
                            {appSettings.auto_sync_enabled && !appSettings.adaptive_sync_enabled && (
                                <div className="ml-9 flex items-center gap-2">
                                    <span className="text-sm text-gray-600">{t('settings.syncEvery')}</span>
                                    <select
                                        value={appSettings.sync_interval_minutes}
                                        onChange={(e) => onSaveSettings({ sync_interval_minutes: parseInt(e.target.value) })}
                                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value={1}>{t('time.minute', { count: 1 })}</option>
                                        <option value={5}>{t('time.minute', { count: 5 })}</option>
                                        <option value={10}>{t('time.minute', { count: 10 })}</option>
                                        <option value={30}>{t('time.minute', { count: 30 })}</option>
                                        <option value={60}>{t('time.hour', { count: 1 })}</option>
                                    </select>
                                </div>
                            )}

                            {/* Smart timing */}
                            <label className="flex items-center gap-3 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                                <input
                                    type="radio"
                                    name="syncMode"
                                    checked={appSettings.auto_sync_enabled && !!appSettings.adaptive_sync_enabled}
                                    onChange={() => onSaveSettings({ auto_sync_enabled: true, adaptive_sync_enabled: true })}
                                    className="w-4 h-4 text-blue-500"
                                />
                                <div>
                                    <span className="text-sm text-gray-700">{t('settings.syncSmart')}</span>
                                    <p className="text-xs text-gray-400">{t('settings.smartTimingDesc')}</p>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Blog Full Backup (Global) */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">{t('settings.blogFullBackup')}</label>
                            <button
                                onClick={() => onSaveSettings({ blogs_full_backup: !appSettings.blogs_full_backup })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${
                                    appSettings.blogs_full_backup ? 'bg-blue-500' : 'bg-gray-300'
                                }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                    appSettings.blogs_full_backup ? 'translate-x-7' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {appSettings.blogs_full_backup
                                ? t('settings.blogFullBackupOnDesc')
                                : t('settings.blogFullBackupOffDesc')}
                        </p>
                        {appSettings.blogs_full_backup && (
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                                <div className="text-xs text-gray-500">
                                    {blogCacheSize ? t('settings.blogCacheSize', { size: blogCacheSize }) : ''}
                                </div>
                                <button
                                    onClick={handleCleanBlogCache}
                                    disabled={isClearing}
                                    className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                                >
                                    {isClearing ? t('common.loading') : t('settings.cleanBlogCache')}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Desktop Notifications */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">{t('settings.desktopNotifications')}</label>
                            <button
                                onClick={() => onSaveSettings({ notifications_enabled: !appSettings.notifications_enabled })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.notifications_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.notifications_enabled ? 'translate-x-7' : 'translate-x-1'
                                    }`} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{t('settings.desktopNotificationsDesc')}</p>
                    </div>

                </div>
            </div>
        </div>
    );
};
