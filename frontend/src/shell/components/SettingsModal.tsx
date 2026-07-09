import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw, SlidersHorizontal, Sparkles, Download } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import { useModalClose } from '../../core/common/useModalClose';
import { ConfirmDialog } from './ConfirmDialog';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { clearTranslationCache } from '../../hooks/useMessageTranslation';
import { KnowledgeBaseStatus, KbBackendSelector } from '../../features/ai/components';
import { apiKeyStatus } from './apiKeyStatus';
import { persisted } from '../../core/persistence/persisted';

interface SettingsModalProps {
    appSettings: AppSettings;
    outputDirInput: string;
    setOutputDirInput: (dir: string) => void;
    onSaveSettings: (updates: Partial<AppSettings>) => Promise<boolean>;
    onClose: () => void;
    activeService: string;
    onVerifyAndFix: (service: string) => void;
    onDeepResync: (service: string) => void;
}

type SettingsTab = 'general' | 'sync' | 'ai' | 'updates';

const SETTINGS_TABS: { id: SettingsTab; labelKey: string; Icon: typeof SlidersHorizontal }[] = [
    { id: 'general', labelKey: 'settings.tabGeneral', Icon: SlidersHorizontal },
    { id: 'sync', labelKey: 'settings.tabSync', Icon: RefreshCw },
    { id: 'ai', labelKey: 'settings.tabAi', Icon: Sparkles },
    { id: 'updates', labelKey: 'settings.tabUpdates', Icon: Download },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
    appSettings,
    outputDirInput,
    setOutputDirInput,
    onSaveSettings,
    onClose,
    activeService,
    onVerifyAndFix,
    onDeepResync,
}) => {
    const { t, i18n } = useTranslation();
    const handleBackdropClick = useModalClose(true, onClose);
    const selectedServices = useAppStore(s => s.selectedServices);
    const setTranscriptionEnabled = useAppStore(s => s.setTranscriptionEnabled);
    const setTranslationEnabled = useAppStore(s => s.setTranslationEnabled);
    const setTranslationTargetLanguage = useAppStore(s => s.setTranslationTargetLanguage);
    // Store-driven `openSettings(tab)` requests (see appStore): seed the
    // initial tab from a pending request, follow requests that land while
    // already open, and consume the request once applied.
    const settingsRequest = useAppStore(s => s.settingsRequest);
    const clearSettingsRequest = useAppStore(s => s.clearSettingsRequest);
    const [activeTab, setActiveTab] = useState<SettingsTab>(() => settingsRequest?.tab ?? 'general');
    useEffect(() => {
        if (!settingsRequest) return;
        setActiveTab(settingsRequest.tab);
        clearSettingsRequest();
    }, [settingsRequest, clearSettingsRequest]);
    const [showDeepConfirm, setShowDeepConfirm] = useState(false);
    const [blogCacheSize, setBlogCacheSize] = useState<string | null>(null);
    const [blogSizeLoading, setBlogSizeLoading] = useState(false);
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
        setBlogSizeLoading(true);
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
        } finally {
            setBlogSizeLoading(false);
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
        persisted.setPref('language', lang);
    };

    // Restore behavioural preferences to defaults. Non-destructive: keeps the
    // data folder, the saved API key, and the chosen language.
    const handleResetDefaults = async () => {
        if (!window.confirm(t('settings.resetConfirm'))) return;
        await onSaveSettings({
            auto_sync_enabled: true,
            adaptive_sync_enabled: true,
            sync_interval_minutes: 15,
            blogs_full_backup: false,
            auto_download_updates: false,
        });
        setTranscriptionEnabled(true);
        setTranslationEnabled(false);
        setTranslationTargetLanguage(null);
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
            <div className="bg-white rounded-2xl max-w-3xl w-full shadow-xl overflow-hidden h-[600px] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="bg-gray-100 px-6 py-4 flex items-center justify-between border-b flex-shrink-0">
                    <h3 className="text-lg font-bold text-gray-800">{t('settings.title')}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        X
                    </button>
                </div>
                <div className="flex flex-1 min-h-0">
                    {/* Category nav */}
                    <nav className="w-44 flex-shrink-0 border-r bg-gray-50 p-2 space-y-0.5 overflow-y-auto">
                        {SETTINGS_TABS.map(({ id, labelKey, Icon }) => (
                            <button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                                    activeTab === id
                                        ? 'bg-white shadow-sm text-gray-800 font-medium'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                <Icon className="w-4 h-4 shrink-0" />
                                {t(labelKey)}
                            </button>
                        ))}
                    </nav>
                    {/* Active category content */}
                    <div className="flex-1 min-w-0 p-6 space-y-6 overflow-y-auto">
                    {activeTab === 'general' && (<>
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
                    </>)}

                    {activeTab === 'sync' && (<>
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
                                            ? t('settings.blogBackupProgress', { cached: blogBackupStats.cached, total: blogBackupStats.total })
                                            : t('settings.blogBackupWorking')}
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
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                    {blogSizeLoading
                                        ? <><Loader2 className="w-3 h-3 animate-spin" />{t('settings.blogBackupCalculating')}</>
                                        : blogCacheSize ? t('settings.blogCacheSize', { size: blogCacheSize }) : ''}
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

                    {/* Data completeness: verify & fix media */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">
                                {t('settings.verifyFixMedia')}
                            </label>
                            <button
                                onClick={() => {
                                    // Close settings so the verify progress/result
                                    // (shown in the sync modal) is in focus.
                                    onVerifyAndFix(activeService);
                                    onClose();
                                }}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800"
                            >
                                {t('settings.verifyFixButton')}
                            </button>
                        </div>
                        <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">
                            {t('settings.verifyFixMediaDesc')}
                        </p>
                    </div>

                    {/* Deep re-verify: full re-sync (re-paginates every member from
                        scratch, skipping already-downloaded assets). Catches gaps the
                        media-only check can't (e.g. entirely-missing messages). */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">
                                {t('settings.deepResync')}
                            </label>
                            <button
                                onClick={() => setShowDeepConfirm(true)}
                                className="text-xs font-medium text-amber-600 hover:text-amber-800"
                            >
                                {t('settings.deepResyncButton')}
                            </button>
                        </div>
                        <p className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">
                            {t('settings.deepResyncDesc')}
                        </p>
                    </div>

                    <ConfirmDialog
                        open={showDeepConfirm}
                        title={t('settings.deepResync')}
                        message={t('settings.deepResyncConfirm')}
                        confirmLabel={t('settings.deepResyncButton')}
                        variant="warning"
                        onConfirm={() => {
                            setShowDeepConfirm(false);
                            onDeepResync(activeService);
                            onClose();
                        }}
                        onCancel={() => setShowDeepConfirm(false)}
                    />

                    {/* Sync read status to phone (opt-in) */}
                    <div>
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-gray-700">
                                {t('settings.syncReadToPhone')}
                            </label>
                            <button
                                onClick={() => onSaveSettings({ sync_read_to_phone: !(appSettings.sync_read_to_phone ?? false) })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${
                                    appSettings.sync_read_to_phone ? 'bg-blue-400' : 'bg-gray-300'
                                }`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                                    appSettings.sync_read_to_phone ? 'translate-x-7' : 'translate-x-1'
                                }`} />
                            </button>
                        </div>
                        <p className="mt-2 max-w-md text-xs leading-relaxed text-gray-500">
                            {t('settings.syncReadToPhoneDesc')}
                        </p>
                    </div>
                    </>)}

                    {activeTab === 'ai' && <AiTab />}

                    {activeTab === 'updates' && (
                        <UpdatesSection
                            autoDownload={appSettings.auto_download_updates ?? false}
                            onToggleAutoDownload={(val) => onSaveSettings({ auto_download_updates: val })}
                        />
                    )}
                    </div>
                </div>
                <div className="flex-shrink-0 border-t bg-gray-50 px-6 py-3 flex justify-end">
                    <button
                        onClick={handleResetDefaults}
                        className="text-xs font-medium text-gray-500 hover:text-red-600"
                    >
                        {t('settings.resetDefaults')}
                    </button>
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
            // force=true bypasses the 1h cache so a manual check is always live
            // (automatic startup/hourly checks stay cached to respect rate limits).
            const res = await fetch('/api/version?force=true');
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

// Session cache of the AI config so reopening the panel shows the saved values
// instantly instead of flashing blank while /api/translation/config (which reads
// the OS keyring) round-trips. Revalidated in the background on every mount.
interface AiConfigCache {
    provider: string | null;
    model: string | null;
    hasApiKey: boolean;
    apiKeyMasked: string | null;
    targetLang: string | null;
}
let aiConfigCache: AiConfigCache | null = null;

function AiTab() {
    const { t } = useTranslation();
    const transcriptionEnabled = useAppStore(s => s.transcriptionEnabled);
    const setTranscriptionEnabled = useAppStore(s => s.setTranscriptionEnabled);
    const translationEnabled = useAppStore(s => s.translationEnabled);
    const setTranslationEnabled = useAppStore(s => s.setTranslationEnabled);
    const setTranslationTargetLanguage = useAppStore(s => s.setTranslationTargetLanguage);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);

    // Own state loaded from /api/translation/config (not from appSettings).
    // Seed from the session cache so a reopen renders instantly, then revalidate.
    const [provider, setProvider] = useState<string | null>(() => aiConfigCache?.provider ?? null);
    const [model, setModel] = useState<string | null>(() => aiConfigCache?.model ?? null);
    const [apiKeyInput, setApiKeyInput] = useState('');  // Raw input (empty = unchanged)
    const [hasApiKey, setHasApiKey] = useState(() => aiConfigCache?.hasApiKey ?? false);  // key stored in keyring
    const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(() => aiConfigCache?.apiKeyMasked ?? null);  // "AIza...xQ"
    // Seed from the session cache, else the persisted store value (both on disk),
    // so the target language shows immediately instead of waiting on /config.
    const [targetLang, setTargetLang] = useState<string | null>(
        () => aiConfigCache?.targetLang ?? useAppStore.getState().translationTargetLanguage ?? null
    );
    // Only "loading" when there is nothing cached to show yet (first open / after
    // a restart). Reopens seed from aiConfigCache and render instantly.
    const [configLoading, setConfigLoading] = useState(() => aiConfigCache === null);

    useEffect(() => {
        fetch('/api/translation/config')
            .then(res => res.json())
            .then(data => {
                setProvider(data.provider ?? null);
                setModel(data.model ?? null);
                setHasApiKey(data.has_api_key ?? false);
                setApiKeyMasked(data.api_key_masked ?? null);
                setTargetLang(data.target_language ?? null);
                aiConfigCache = {
                    provider: data.provider ?? null,
                    model: data.model ?? null,
                    hasApiKey: data.has_api_key ?? false,
                    apiKeyMasked: data.api_key_masked ?? null,
                    targetLang: data.target_language ?? null,
                };
                if (data.target_language) {
                    setTranslationTargetLanguage(data.target_language);
                }
            })
            .catch(() => {})
            .finally(() => setConfigLoading(false));
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

    // Source content is Japanese, so Japanese is not offered as a target.
    const TARGET_LANGUAGES = [
        { value: 'en', label: 'English' },
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
            if (data.ok) {
                setTestResult(t('translation.settings.testSuccess'));
            } else {
                // Map the backend's reason code to a localized message instead of
                // showing its English `detail`.
                const byCode: Record<string, string> = {
                    auth: 'translation.settings.testErrorAuth',
                    unreachable: 'translation.settings.testErrorUnreachable',
                    no_key: 'translation.settings.testErrorNoKey',
                };
                const key = (data.code && byCode[data.code]) || 'translation.settings.testFailed';
                setTestResult(t(key));
            }
        } catch {
            setTestResult(t('translation.settings.testErrorUnreachable'));
        } finally {
            setTesting(false);
        }
    };

    const handleClearCache = async () => {
        await clearTranslationCache();
        setTestResult(t('translation.settings.cacheClearedMsg'));
    };

    const handleClearApiKey = async () => {
        if (!window.confirm(t('translation.settings.clearApiKeyConfirm'))) return;
        await fetch('/api/translation/clear-api-key', { method: 'POST' });
        setApiKeyInput('');
        setHasApiKey(false);
        setApiKeyMasked(null);
        setTestResult(null);
        if (aiConfigCache) { aiConfigCache.hasApiKey = false; aiConfigCache.apiKeyMasked = null; }
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

        // Keep the session cache in step so a reopen reflects the change instantly.
        aiConfigCache = {
            provider: newProvider,
            model: newModel,
            hasApiKey: updates.api_key ? true : hasApiKey,
            apiKeyMasked: aiConfigCache?.apiKeyMasked ?? null,  // refreshed by the next fetch
            targetLang: newTargetLang,
        };

        // Persist to backend (API key stored in keyring, not settings.json).
        // PATCH semantics: send ONLY the fields the user changed in THIS call.
        // The backend keys off which fields are present (`model_fields_set`),
        // and an explicit `provider: null` means "clear provider + delete the
        // stored API key" — so echoing unchanged local state here (which can be
        // stale or not yet fetched) could silently wipe the keyring credential
        // (review finding M14). The api_key field is additionally gated on a
        // non-empty value: an empty input means "unchanged", never "delete".
        const payload: Record<string, string | null> = {};
        if (updates.provider !== undefined) payload.provider = updates.provider;
        if (updates.model !== undefined) payload.model = updates.model;
        if (updates.api_key) payload.api_key = updates.api_key;
        if (updates.target_language !== undefined) payload.target_language = updates.target_language;
        if (Object.keys(payload).length === 0) return;
        fetch('/api/translation/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    };

    const handleProviderChange = (value: string | null) => {
        const newModels = MODELS[value ?? ''] ?? [];
        const newModel = newModels[0]?.value ?? null;
        saveConfig({ provider: value, model: newModel });
    };

    return (
        <>
            {/* Transcription */}
            <section>
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-800">
                        {t('settings.sectionTranscription')}
                    </h4>
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
            </section>

            {/* Translation */}
            <section className="pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                        {t('settings.sectionTranslation')}
                    </h4>
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
                {translationEnabled && (
                    <div className="space-y-3">
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
                )}
            </section>

            {/* Shared AI provider & key — always visible: the KB chatbot's Cloud
                mode reuses this same keyring credential, so it must stay
                reachable even with transcription and translation both off. */}
            <section className="pt-4 border-t border-gray-100 space-y-3">
                <div>
                    <h4 className="text-sm font-semibold text-gray-800">{t('settings.sectionProvider')}</h4>
                    <p className="text-xs text-gray-500 mt-0.5">{t('settings.aiKeyShared')}</p>
                </div>
                {configLoading && (
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t('common.loading')}
                    </div>
                )}
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
                    {provider === 'gemini' && (
                        <div className="text-xs text-gray-400 mt-1.5 space-y-0.5">
                            <p>{t('translation.dataPolicy.geminiFree')}</p>
                            <p>{t('translation.dataPolicy.geminiPaid')}</p>
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
                        {apiKeyStatus({ provider, hasApiKey, hasInput: !!apiKeyInput }) === 'saved' && (
                            <div className="flex items-center justify-between mt-0.5">
                                <p className="text-xs text-green-600">{t('translation.settings.savedSecurely')}</p>
                                <button
                                    onClick={handleClearApiKey}
                                    className="text-xs font-medium text-red-500 hover:text-red-700"
                                >
                                    {t('translation.settings.clearApiKey')}
                                </button>
                            </div>
                        )}
                        {apiKeyStatus({ provider, hasApiKey, hasInput: !!apiKeyInput }) === 'missing' && !configLoading && (
                            <p className="text-xs text-amber-600 mt-0.5">{t('translation.settings.keyMissing')}</p>
                        )}
                        {testResult && (
                            <p className="text-xs mt-1 text-gray-500">{testResult}</p>
                        )}
                    </div>
                )}
            </section>

            {/* AI assistant (KB chatbot) — the backend selector carries the
                master Enable switch, so it comes first; index status/rebuild
                below it. The first-run SetupChecklist is chat-only (it also
                lives in ChatWindow) — mounting it here duplicated the doc
                count and Build button with different disable rules (M6/M7). */}
            <section className="pt-4 border-t border-gray-100 space-y-3">
                <h4 className="text-sm font-semibold text-gray-800">{t('settings.sectionAssistant')}</h4>
                <KbBackendSelector />
                <KnowledgeBaseStatus />
            </section>
        </>
    );
}
