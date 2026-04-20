import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import { useModalClose } from '../../core/common/useModalClose';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { clearTranslationCache } from '../../hooks/useMessageTranslation';

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
    const handleBackdropClick = useModalClose(true, onClose);
    const selectedServices = useAppStore(s => s.selectedServices);
    const [blogCacheSize, setBlogCacheSize] = useState<string | null>(null);
    const [isClearing, setIsClearing] = useState(false);
    const [blogBackupRunning, setBlogBackupRunning] = useState(false);
    const [blogBackupStats, setBlogBackupStats] = useState<{cached: number, total: number} | null>(null);
    // Optimistic toggle: local override while the API call is in flight
    const [blogTogglePending, setBlogTogglePending] = useState<boolean | null>(null);
    const blogBackupEnabled = blogTogglePending ?? appSettings.blogs_full_backup;
    // Clear pending state once appSettings catches up
    React.useEffect(() => {
        if (blogTogglePending !== null && appSettings.blogs_full_backup === blogTogglePending) {
            setBlogTogglePending(null);
        }
    }, [appSettings.blogs_full_backup, blogTogglePending]);

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

    // Poll blog backup status when backup is enabled
    useEffect(() => {
        if (!appSettings.blogs_full_backup) {
            setBlogBackupRunning(false);
            return;
        }
        let cancelled = false;
        const check = () => {
            fetch('/api/blogs/backup/status')
                .then(res => res.json())
                .then(data => {
                    if (cancelled) return;
                    const running = Object.keys(data.running ?? {}).length > 0;
                    setBlogBackupRunning(running);
                    if (running) setTimeout(check, 5000);
                    // Fetch aggregate cache stats for all services
                    if (running || appSettings.blogs_full_backup) {
                        Promise.all(
                            selectedServices.map(s =>
                                fetch(`/api/blogs/cache-stats?service=${encodeURIComponent(s)}`)
                                    .then(r => r.ok ? r.json() : null)
                                    .catch(() => null)
                            )
                        ).then(results => {
                            if (cancelled) return;
                            let cached = 0, total = 0;
                            for (const r of results) {
                                if (r) { cached += r.cached_blogs || 0; total += r.available_blogs || 0; }
                            }
                            setBlogBackupStats(total > 0 ? { cached, total } : null);
                        });
                    }
                })
                .catch(() => {});
        };
        check();
        return () => { cancelled = true; };
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
        localStorage.setItem('sakadesk-language', lang);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
            <div className="bg-white rounded-2xl max-w-md w-full shadow-xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
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
                                className="px-4 py-2 bg-blue-400 text-white rounded-lg text-sm hover:bg-blue-500"
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
                            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                {t('settings.blogFullBackup')}
                                {blogBackupRunning && (
                                    <span className="text-xs text-blue-500 flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        {blogBackupStats
                                            ? `${blogBackupStats.cached}/${blogBackupStats.total}`
                                            : ''
                                        }
                                    </span>
                                )}
                            </label>
                            <button
                                onClick={() => {
                                    const next = !blogBackupEnabled;
                                    setBlogTogglePending(next);
                                    onSaveSettings({ blogs_full_backup: next });
                                }}
                                className={`relative w-12 h-6 rounded-full transition-colors ${
                                    blogBackupEnabled ? 'bg-blue-400' : 'bg-gray-300'
                                }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                    blogBackupEnabled ? 'translate-x-7' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            {blogBackupEnabled
                                ? t('settings.blogFullBackupOnDesc')
                                : t('settings.blogFullBackupOffDesc')}
                        </p>
                        {blogBackupEnabled && (
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

                    {/* Transcription */}
                    <TranscriptionSection />

                    {/* Translation */}
                    <TranslationSection />

                    {/* Updates */}
                    <UpdatesSection
                        autoDownload={appSettings.auto_download_updates ?? false}
                        onToggleAutoDownload={(val) => onSaveSettings({ auto_download_updates: val })}
                    />

                </div>
            </div>
        </div>
    );
};


function UpdatesSection({ autoDownload, onToggleAutoDownload }: {
    autoDownload: boolean;
    onToggleAutoDownload: (val: boolean) => void;
}) {
    const { t } = useTranslation();
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const handleCheckNow = async () => {
        setChecking(true);
        setResult(null);
        try {
            const res = await fetch('/api/version');
            if (res.ok) {
                const data = await res.json();
                if (data.update_available) {
                    setResult(t('settings.updateFound', { version: data.latest_version }));
                } else {
                    setResult(t('settings.upToDate'));
                }
            } else {
                setResult(t('settings.updateCheckFailed'));
            }
        } catch (err) {
            console.error('[Settings] Update check failed:', err);
            setResult(t('settings.updateCheckFailed'));
        } finally {
            setChecking(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                    {t('settings.autoDownloadUpdates')}
                </label>
                <button
                    onClick={() => onToggleAutoDownload(!autoDownload)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                        autoDownload ? 'bg-blue-400' : 'bg-gray-300'
                    }`}
                >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        autoDownload ? 'translate-x-7' : 'translate-x-1'
                    }`} />
                </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
                {t('settings.autoDownloadUpdatesDesc')}
            </p>
            <div className="mt-3 flex items-center gap-3">
                <button
                    onClick={handleCheckNow}
                    disabled={checking}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                >
                    {checking
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />
                    }
                    {t('settings.checkForUpdates')}
                </button>
                {result && (
                    <span className="text-xs text-gray-500">{result}</span>
                )}
            </div>
        </div>
    );
}


function TranslationSection() {
    const { t } = useTranslation();
    const translationEnabled = useAppStore(s => s.translationEnabled);
    const setTranslationEnabled = useAppStore(s => s.setTranslationEnabled);

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    {t('translation.settings.title')}
                    <span className="ml-1 text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                        {t('translation.settings.experimental')}
                    </span>
                </label>
                <button
                    onClick={() => setTranslationEnabled(!translationEnabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                        translationEnabled ? 'bg-blue-400' : 'bg-gray-300'
                    }`}
                >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        translationEnabled ? 'translate-x-7' : 'translate-x-1'
                    }`} />
                </button>
            </div>
            {translationEnabled && <TranslationSettingsSection />}
        </div>
    );
}


function TranscriptionSection() {
    const { t } = useTranslation();
    const transcriptionEnabled = useAppStore(s => s.transcriptionEnabled);
    const setTranscriptionEnabled = useAppStore(s => s.setTranscriptionEnabled);

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                    {t('settings.transcriptionDevice')}
                </label>
                <button
                    onClick={() => setTranscriptionEnabled(!transcriptionEnabled)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                        transcriptionEnabled ? 'bg-blue-400' : 'bg-gray-300'
                    }`}
                >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        transcriptionEnabled ? 'translate-x-7' : 'translate-x-1'
                    }`} />
                </button>
            </div>
        </div>
    );
}


function TranslationSettingsSection() {
    const { t } = useTranslation();
    const setTranslationTargetLanguage = useAppStore(s => s.setTranslationTargetLanguage);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);

    // Own state loaded from /api/translation/config (not from appSettings)
    const [provider, setProvider] = useState<string | null>(null);
    const [model, setModel] = useState<string | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState('');  // Raw input (empty = unchanged)
    const [hasApiKey, setHasApiKey] = useState(false);    // Whether a key is stored in keyring
    const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);  // e.g. "AIza...xQ"
    const [targetLang, setTargetLang] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/translation/config')
            .then(res => res.json())
            .then(data => {
                setProvider(data.provider ?? null);
                setModel(data.model ?? null);
                setHasApiKey(data.has_api_key ?? false);
                setApiKeyMasked(data.api_key_masked ?? null);
                setTargetLang(data.target_language ?? null);
                if (data.target_language) {
                    setTranslationTargetLanguage(data.target_language);
                }
            })
            .catch(() => {});
    }, [setTranslationTargetLanguage]);

    // Providers available in the UI. Backend supports OpenAI too (OpenAIProvider)
    // but it's hidden for now — add back when needed.
    const PROVIDERS = [
        { value: 'gemini', label: 'Google Gemini' },
    ];

    const [modelOptions, setModelOptions] = useState<Record<string, { value: string; label: string }[]>>({});

    useEffect(() => {
        fetch('/api/translation/models')
            .then(res => res.json())
            .then(data => {
                // Transform backend format {gemini: [{id, label}]} to {gemini: [{value, label}]}
                const opts: Record<string, { value: string; label: string }[]> = {};
                for (const [prov, models] of Object.entries(data)) {
                    opts[prov] = (models as { id: string; label: string }[]).map(m => ({ value: m.id, label: m.label }));
                }
                setModelOptions(opts);
            })
            .catch(() => {});
    }, []);

    const MODELS = modelOptions;

    const TARGET_LANGUAGES = [
        { value: 'en', label: 'English' },
        { value: 'ja', label: '日本語' },
        { value: 'zh-TW', label: '繁體中文' },
        { value: 'zh-CN', label: '简体中文' },
        { value: 'yue', label: '廣東話' },
    ];

    const handleTestConnection = async () => {
        if (!provider || !model || (!apiKeyInput && !hasApiKey)) return;
        setTesting(true);
        setTestResult(null);
        try {
            const res = await fetch('/api/translation/test-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, model, api_key: apiKeyInput || undefined }),
            });
            const data = await res.json();
            setTestResult(data.ok
                ? t('translation.settings.testSuccess')
                : t('translation.settings.testFailed') + (data.detail ? `: ${data.detail}` : '')
            );
        } catch {
            setTestResult(t('translation.settings.testFailed'));
        } finally {
            setTesting(false);
        }
    };

    const handleClearCache = () => {
        clearTranslationCache();
        setTestResult(t('translation.settings.cacheClearedMsg'));
    };

    const saveConfig = (updates: { provider?: string | null; model?: string | null; api_key?: string | null; target_language?: string | null }) => {
        const newProvider = updates.provider !== undefined ? updates.provider : provider;
        const newModel = updates.model !== undefined ? updates.model : model;
        const newTargetLang = updates.target_language !== undefined ? updates.target_language : targetLang;

        // Update local state
        if (updates.provider !== undefined) setProvider(updates.provider);
        if (updates.model !== undefined) setModel(updates.model);
        if (updates.api_key !== undefined) {
            setApiKeyInput(updates.api_key ?? '');
            if (updates.api_key) setHasApiKey(true);
        }
        if (updates.target_language !== undefined) {
            setTargetLang(updates.target_language);
            setTranslationTargetLanguage(updates.target_language);
        }

        // Persist to backend (API key stored in keyring, not settings.json)
        // Only send api_key if user typed a new one
        const apiKeyToSend = updates.api_key !== undefined ? updates.api_key : undefined;
        fetch('/api/translation/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: newProvider,
                model: newModel,
                api_key: apiKeyToSend ?? null,
                target_language: newTargetLang,
            }),
        });
    };

    const handleProviderChange = (value: string | null) => {
        const newModels = MODELS[value ?? ''] ?? [];
        const newModel = newModels[0]?.value ?? null;
        saveConfig({ provider: value, model: newModel });
    };

    return (
        <div>
            <div className="space-y-3">
                {/* Provider */}
                <div>
                    <label className="block text-xs text-gray-500 mb-1">{t('translation.settings.provider')}</label>
                    <select
                        value={provider ?? ''}
                        onChange={(e) => handleProviderChange(e.target.value || null)}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">—</option>
                        {PROVIDERS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
                    {provider && (
                        <div className="text-xs text-gray-400 mt-1.5 space-y-0.5">
                            {provider === 'gemini' && (
                                <>
                                    <p>Free tier: Flash Lite 500 RPD / Flash 20 RPD. Data may be used by Google to improve products.</p>
                                    <p>Paid tier: 100 translations ≈ US$0.01. Data not used for training.</p>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Model */}
                {provider && MODELS[provider] && (
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">{t('translation.settings.model')}</label>
                        <select
                            value={model ?? ''}
                            onChange={(e) => saveConfig({ model: e.target.value || null })}
                            className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            {MODELS[provider].map(m => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* API Key */}
                {provider && (
                    <div>
                        <label className="block text-xs text-gray-500 mb-1">{t('translation.settings.apiKey')}</label>
                        <div className="flex gap-2">
                            <input
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                onBlur={() => { if (apiKeyInput) saveConfig({ api_key: apiKeyInput }); }}
                                className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={hasApiKey && apiKeyMasked ? apiKeyMasked : 'sk-... / AIza...'}
                            />
                            <button
                                onClick={handleTestConnection}
                                disabled={testing || (!apiKeyInput && !hasApiKey)}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {testing && <Loader2 className="w-3 h-3 animate-spin" />}
                                {t('translation.settings.testConnection')}
                            </button>
                        </div>
                        {hasApiKey && !apiKeyInput && (
                            <p className="text-xs mt-0.5 text-green-600">Saved securely in credential manager</p>
                        )}
                        {testResult && (
                            <p className="text-xs mt-1 text-gray-500">{testResult}</p>
                        )}
                    </div>
                )}

                {/* Target Language */}
                <div>
                    <label className="block text-xs text-gray-500 mb-1">{t('translation.settings.targetLanguage')}</label>
                    <select
                        value={targetLang ?? ''}
                        onChange={(e) => saveConfig({ target_language: e.target.value || null })}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">—</option>
                        {TARGET_LANGUAGES.map(l => (
                            <option key={l.value} value={l.value}>{l.label}</option>
                        ))}
                    </select>
                </div>

                {/* Clear Cache */}
                <button
                    onClick={handleClearCache}
                    className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                    {t('translation.settings.clearCache')}
                </button>
            </div>
        </div>
    );
}
