import React from 'react';
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
    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden">
                <div className="bg-gray-100 px-6 py-4 flex items-center justify-between border-b">
                    <h3 className="text-lg font-bold text-gray-800">Settings</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        X
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    {/* Output Folder */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Output Folder
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
                                Save
                            </button>
                        </div>
                    </div>

                    {/* Auto-Sync */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-medium text-gray-700">Auto-Sync</label>
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
                                <span className="text-sm text-gray-600">Sync every</span>
                                <select
                                    value={appSettings.sync_interval_minutes}
                                    onChange={(e) => onSaveSettings({ sync_interval_minutes: parseInt(e.target.value) })}
                                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value={1}>1 minute</option>
                                    <option value={5}>5 minutes</option>
                                    <option value={10}>10 minutes</option>
                                    <option value={30}>30 minutes</option>
                                    <option value={60}>1 hour</option>
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Adaptive Sync */}
                    {appSettings.auto_sync_enabled && (
                        <div>
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-gray-700">Smart Timing</label>
                                <button
                                    onClick={() => onSaveSettings({ adaptive_sync_enabled: !appSettings.adaptive_sync_enabled })}
                                    className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.adaptive_sync_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                        }`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.adaptive_sync_enabled ? 'translate-x-7' : 'translate-x-1'
                                        }`} />
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Randomize intervals based on posting patterns</p>
                        </div>
                    )}

                    {/* Desktop Notifications */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">Desktop Notifications</label>
                            <button
                                onClick={() => onSaveSettings({ notifications_enabled: !appSettings.notifications_enabled })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${appSettings.notifications_enabled ? 'bg-blue-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${appSettings.notifications_enabled ? 'translate-x-7' : 'translate-x-1'
                                    }`} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Show notification when new messages arrive</p>
                    </div>

                    {/* Per-Service Settings Section */}
                    {activeService && serviceSettings && (
                        <>
                            <div className="border-t border-gray-200 pt-4 mt-4">
                                <h4 className="text-sm font-semibold text-gray-800 mb-3">
                                    {activeService.replace('46', ' 46')} Settings
                                </h4>
                            </div>

                            {/* Blog Sync Mode */}
                            <div>
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-700">Blog Full Backup</label>
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
                                        ? 'Download all blog content and images for offline reading'
                                        : 'Fetch blog content on-demand (saves disk space)'}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
