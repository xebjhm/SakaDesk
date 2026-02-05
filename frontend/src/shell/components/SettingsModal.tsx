import React from 'react';
import { useTranslation, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import type { ServiceSettings } from '../hooks/useSettings';

interface SettingsModalProps {
    appSettings: AppSettings;
    serviceSettings: ServiceSettings | null;
    activeService: string | null;
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    onSaveSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
    onSaveServiceSettings: (service: string, updates: Partial<ServiceSettings>) => Promise<void>;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
    appSettings,
    serviceSettings,
    activeService,
    outputDirInput,
    setOutputDirInput,
    onSaveSettings,
    onSaveServiceSettings,
    onClose,
}) => {
    const { t, i18n } = useTranslation();

    const handleLanguageChange = (lang: SupportedLanguage) => {
        i18n.changeLanguage(lang);
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

                    {/* Auto-Sync */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-medium text-gray-700">{t('settings.autoSync')}</label>
                            <button
                                onClick={() => onSaveSettings({ auto_sync_enabled: !appSettings.auto_sync_enabled })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.auto_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.auto_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                    }`} />
                            </button>
                        </div>
                        {appSettings.auto_sync_enabled && (
                            <div className="flex items-center gap-3">
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
                    </div>

                    {/* Adaptive Sync */}
                    {appSettings.auto_sync_enabled && (
                        <div>
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-700">{t('settings.smartTiming')}</label>
                                <button
                                    onClick={() => onSaveSettings({ adaptive_sync_enabled: !appSettings.adaptive_sync_enabled })}
                                    className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.adaptive_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                        }`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.adaptive_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                        }`} />
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{t('settings.smartTimingDesc')}</p>
                        </div>
                    )}

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

                    {/* Per-Service Settings Section */}
                    {activeService && serviceSettings && (
                        <>
                            <div className="border-t border-gray-200 pt-4 mt-4">
                                <h4 className="text-sm font-semibold text-gray-800 mb-3">
                                    {activeService.replace('46', ' 46')} {t('settings.title')}
                                </h4>
                            </div>

                            {/* Blog Sync Mode */}
                            <div>
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-700">{t('settings.blogFullBackup')}</label>
                                    <button
                                        onClick={() => onSaveServiceSettings(activeService, { blogs_full_backup: !serviceSettings.blogs_full_backup })}
                                        className={`relative w-12 h-6 rounded-full transition-colors ${serviceSettings.blogs_full_backup ? 'bg-blue-500' : 'bg-gray-300'
                                            }`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${serviceSettings.blogs_full_backup ? 'translate-x-7' : 'translate-x-1'
                                            }`} />
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    {serviceSettings.blogs_full_backup
                                        ? t('settings.blogFullBackupOnDesc')
                                        : t('settings.blogFullBackupOffDesc')}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
