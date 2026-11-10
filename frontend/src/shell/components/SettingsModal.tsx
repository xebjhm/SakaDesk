import React, { useState, useEffect, useId } from 'react';
import { Loader2, RefreshCw, SlidersHorizontal, Sparkles, Download } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import { Modal, Button, Switch, Input, Select } from '../../design/primitives';
import { logDialogLoad, type DialogLoadSurface, type DialogLoadReason } from '../../design/dialog/dialogLog';
import { cn } from '../../utils/classnames';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingRow } from './SettingRow';
import type { AppSettings } from '../../features/messages/MessagesFeature';
import { clearTranslationCache } from '../../hooks/useMessageTranslation';
import { apiKeyStatus } from './apiKeyStatus';
import { persisted } from '../../core/persistence/persisted';
import { useGroupMarker } from '../../design/useGroupMarker';
import { getServiceDisplayName } from '../../data/services';
import { pollJson, SIDEBAR_POLL_TIMEOUT_MS } from '../../utils/pollJson';
import { useUpgradeStore } from '../../core/upgrade/upgradeStore';
import { UpdateActions } from '../../core/upgrade/UpdateActions';
import { isJstSlot, jstSlotToLocal } from '../../features/memories/shared/jst';

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

/** A settings row that saves app settings (the failure shows on that row). */
type SaveRow = 'outputDir' | 'incomingCall' | 'callPopup' | 'closeToTray' | 'autostart' | 'notifications'
    | 'notificationsHideContent' | MemoriesNotifyRow | 'syncMode' | 'blogFullBackup' | 'syncReadToPhone' | 'autoDownload' | 'reset';

/** The Memories notification kinds with a switch each: the i18n key under `settings.memoriesNotify`, the settings key, its default. */
const MEMORIES_NOTIFY_KINDS = [
    { id: 'onThisDay', key: 'memories_notify_on_this_day', fallback: true },
    { id: 'birthday', key: 'memories_notify_birthday', fallback: true },
    { id: 'anniversary', key: 'memories_notify_anniversary', fallback: true },
    { id: 'recap', key: 'memories_notify_recap', fallback: true },
    { id: 'cards', key: 'memories_notify_cards', fallback: false },
] as const;

/** A Memories notification row (its own save-failure slot): the time or one kind. */
type MemoriesNotifyRow = `memoriesNotify.${'time' | (typeof MEMORIES_NOTIFY_KINDS)[number]['id']}`;

/** The kinds that fire at the configurable JST time (cards are event-driven). */
const MEMORIES_TIMED_KINDS = MEMORIES_NOTIFY_KINDS.filter(({ id }) => id !== 'cards');

/** The default JST time of the daily Memories notifications. */
const MEMORIES_NOTIFY_TIME_DEFAULT = '12:00';

/** The hourly JST times the Memories time select offers (`00:00`–`23:00`). */
const MEMORIES_NOTIFY_HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

/** The time options: every hour, plus a well-formed saved value that is not on the hour, in time order. */
function memoriesTimeOptions(value: string): string[] {
    if (MEMORIES_NOTIFY_HOURS.includes(value) || !isJstSlot(value)) return MEMORIES_NOTIFY_HOURS;
    return [...MEMORIES_NOTIFY_HOURS, value].sort();
}

/** The in-app confirm on screen: reset, delete backup (two steps), deep re-sync. */
type ConfirmKind = 'reset' | 'clean' | 'clean2' | 'deep' | null;

const SETTINGS_TABS: { id: SettingsTab; labelKey: string; Icon: typeof SlidersHorizontal }[] = [
    { id: 'general', labelKey: 'settings.tabGeneral', Icon: SlidersHorizontal },
    { id: 'sync', labelKey: 'settings.tabSync', Icon: RefreshCw },
    { id: 'ai', labelKey: 'settings.tabAi', Icon: Sparkles },
    { id: 'updates', labelKey: 'settings.tabUpdates', Icon: Download },
];

/** A sync-mode radio row (the radio, its title and hint). */
const RADIO_ROW = 'flex cursor-pointer items-center gap-3 rounded-card p-2 transition-colors duration-fast ease-standard hover:bg-sunken';
/** A field label above an Input or Select. */
const FIELD_LABEL = 'text-small font-semibold text-secondary';
/** Text-only danger action (Delete backup, Clear API key). */
const DANGER_GHOST = 'text-status-danger hover:text-status-danger';

/** Outcome of a per-service batch: `ok`, `error` when every request failed, else `partial` with the failure count. */
function batchOutcome(failed: number, total: number): ['ok'] | ['error'] | ['partial', number] {
    if (failed === 0) return ['ok'];
    return failed >= total ? ['error'] : ['partial', failed];
}

function logBatch(surface: DialogLoadSurface, failed: number, total: number): void {
    const [outcome, count] = batchOutcome(failed, total);
    logDialogLoad(surface, outcome, count);
}

/** The group a per-group row acts on (spec section 4 marker): a dot in the group colour and its name (data). */
const GroupChip: React.FC<{ serviceId: string }> = ({ serviceId }) => (
    <span data-testid="settings-group-chip" lang="ja" className="inline-flex items-center gap-1 rounded-pill bg-accent-subtle px-2 py-0.5 text-caption font-semibold text-accent-strong">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-pill bg-accent" />
        {getServiceDisplayName(serviceId)}
    </span>
);

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
    const selectedServices = useAppStore(s => s.selectedServices);
    const setTranscriptionEnabled = useAppStore(s => s.setTranscriptionEnabled);
    const setTranslationEnabled = useAppStore(s => s.setTranslationEnabled);
    const setTranslationTargetLanguage = useAppStore(s => s.setTranslationTargetLanguage);
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');
    const [confirm, setConfirm] = useState<ConfirmKind>(null);
    const [blogCacheSize, setBlogCacheSize] = useState<string | null>(null);
    const [blogSizeLoading, setBlogSizeLoading] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [blogBackupRunning, setBlogBackupRunning] = useState(false);
    const [blogBackupStats, setBlogBackupStats] = useState<{cached: number, total: number} | null>(null);
    // Optimistic toggle: local override while the API call is in flight
    const [blogTogglePending, setBlogTogglePending] = useState<boolean | null>(null);
    const blogBackupEnabled = blogTogglePending ?? appSettings.blogs_full_backup;
    // A loaded settings object without the field means the default: on.
    const incomingCallEnabled = appSettings.incoming_call_enabled ?? true;
    const callPopupEnabled = appSettings.call_popup_enabled ?? true;
    const closeToTray = appSettings.close_to_tray ?? true;
    const autostart = appSettings.autostart ?? false;
    const notificationsEnabled = appSettings.notifications_enabled ?? true;
    const notificationsHideContent = appSettings.notifications_hide_content ?? false;
    const syncReadToPhone = appSettings.sync_read_to_phone ?? false;
    // The time drives every timed kind: it is idle only when all of them are off.
    const memoriesTimeIdle = MEMORIES_TIMED_KINDS.every(({ key, fallback }) => !(appSettings[key] ?? fallback));
    // A malformed saved time (never written by the backend) shows as the default.
    const savedMemoriesTime = appSettings.memories_notify_time ?? MEMORIES_NOTIFY_TIME_DEFAULT;
    const memoriesTime = isJstSlot(savedMemoriesTime) ? savedMemoriesTime : MEMORIES_NOTIFY_TIME_DEFAULT;
    const memoriesTimeLocal = jstSlotToLocal(memoriesTime);
    // Clear pending state once appSettings catches up
    React.useEffect(() => {
        if (blogTogglePending !== null && appSettings.blogs_full_backup === blogTogglePending) {
            setBlogTogglePending(null);
        }
    }, [appSettings.blogs_full_backup, blogTogglePending]);

    // The row whose last save failed: it shows the failure inline (the App toast says it too).
    const [failedRow, setFailedRow] = useState<SaveRow | null>(null);
    // Mirrors failedRow so a successful save on another row does not schedule a render.
    const failedRowRef = React.useRef<SaveRow | null>(null);
    const save = async (row: SaveRow, updates: Partial<AppSettings>): Promise<boolean> => {
        const ok = await onSaveSettings(updates);
        logDialogLoad('settings_app_save', ok ? 'ok' : 'error');
        const next = ok ? (failedRowRef.current === row ? null : failedRowRef.current) : row;
        if (next !== failedRowRef.current) {
            failedRowRef.current = next;
            setFailedRow(next);
        }
        return ok;
    };
    const rowError = (row: SaveRow): string | undefined => (failedRow === row ? t('settings.saveFailed') : undefined);

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
            let failed = 0;
            for (const service of selectedServices) {
                const res = await fetch(`/api/blogs/cache-size?service=${encodeURIComponent(service)}`);
                if (res.ok) {
                    const data = await res.json();
                    totalBytes += data.size_bytes || 0;
                } else {
                    failed += 1;
                }
            }
            setBlogCacheSize(totalBytes > 0 ? formatBytes(totalBytes) : null);
            logBatch('settings_blog_cache', failed, selectedServices.length);
        } catch {
            setBlogCacheSize(null);
            logDialogLoad('settings_blog_cache', 'error');
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
        let pollTimer: ReturnType<typeof setTimeout> | undefined;
        // Aborts a stats read still pending when the dialog closes.
        const statsAbort = new AbortController();
        // One `ok` breadcrumb per open, not one per 5 s poll while a backup runs.
        let logged = false;
        // The stats breadcrumb repeats only when its outcome changes between polls.
        let lastStats = '';
        const check = () => {
            fetch('/api/blogs/backup/status')
                .then(res => {
                    if (!res.ok) throw new Error('backup status refused');
                    return res.json();
                })
                .then(data => {
                    if (cancelled) return;
                    if (!logged) {
                        logged = true;
                        logDialogLoad('settings_blog_backup', 'ok');
                    }
                    const running = Object.keys(data.running ?? {}).length > 0;
                    setBlogBackupRunning(running);
                    if (running) pollTimer = setTimeout(check, 5000);
                    // Fetch aggregate cache stats for all services. A read still
                    // pending from the previous 5 s poll is skipped, not repeated:
                    // stats on a large archive can take longer than the interval.
                    if (running || appSettings.blogs_full_backup) {
                        Promise.all(
                            selectedServices.map(s =>
                                pollJson<{ cached_blogs?: number; available_blogs?: number }>(
                                    `blog_stats_${s}`,
                                    `/api/blogs/cache-stats?service=${encodeURIComponent(s)}`,
                                    { timeoutMs: SIDEBAR_POLL_TIMEOUT_MS, signal: statsAbort.signal },
                                )
                            )
                        ).then(polls => {
                            if (cancelled) return;
                            // The pending read from the earlier poll updates the stats when it lands.
                            if (polls.some(p => p.status === 'skipped' || p.status === 'aborted')) return;
                            const results = polls.map(p => (p.status === 'ok' ? p.data : null));
                            const failed = results.filter(r => r === null).length;
                            const outcome = batchOutcome(failed, results.length);
                            if (results.length > 0 && outcome.join() !== lastStats) {
                                lastStats = outcome.join();
                                logBatch('settings_blog_stats', failed, results.length);
                            }
                            let cached = 0, total = 0;
                            for (const r of results) {
                                if (r) { cached += r.cached_blogs || 0; total += r.available_blogs || 0; }
                            }
                            setBlogBackupStats(total > 0 ? { cached, total } : null);
                        });
                    }
                })
                .catch(() => {
                    if (!cancelled) logDialogLoad('settings_blog_backup', 'error');
                });
        };
        check();
        // Stop the poll when the dialog closes: no status request after it is gone.
        return () => { cancelled = true; clearTimeout(pollTimer); statsAbort.abort(); };
    }, [appSettings.blogs_full_backup, selectedServices]);

    // Runs after both in-app confirmations (see the ConfirmDialog below).
    const handleCleanBlogCache = async () => {
        setIsClearing(true);
        try {
            let failed = 0;
            for (const service of selectedServices) {
                const res = await fetch(`/api/blogs/cache?service=${encodeURIComponent(service)}`, { method: 'DELETE' });
                if (!res.ok) failed += 1;
            }
            logBatch('settings_blog_clean', failed, selectedServices.length);
            await loadBlogCacheSize();
        } catch {
            logDialogLoad('settings_blog_clean', 'error');
        } finally {
            setIsClearing(false);
        }
    };

    const handleLanguageChange = (lang: SupportedLanguage) => {
        i18n.changeLanguage(lang);
        persisted.setPref('language', lang);
    };

    // Restore behavioural preferences to defaults. Non-destructive: keeps the
    // data folder, the saved API key, and the chosen language. Runs after the in-app confirm.
    const handleResetDefaults = async () => {
        await save('reset', {
            auto_sync_enabled: true,
            adaptive_sync_enabled: true,
            sync_interval_minutes: 15,
            blogs_full_backup: false,
            auto_download_updates: false,
            incoming_call_enabled: true,
            call_popup_enabled: true,
            close_to_tray: true,
            autostart: false,
            notifications_enabled: true,
            notifications_hide_content: false,
            ...Object.fromEntries(MEMORIES_NOTIFY_KINDS.map(({ key, fallback }) => [key, fallback])),
            memories_notify_time: MEMORIES_NOTIFY_TIME_DEFAULT,
        });
        setTranscriptionEnabled(true);
        setTranslationEnabled(false);
        setTranslationTargetLanguage(null);
    };

    const syncModeLabelId = useId();
    const groupMarker = useGroupMarker(activeService, 'settings_row');
    const syncMode = !appSettings.auto_sync_enabled ? 'off' : appSettings.adaptive_sync_enabled ? 'smart' : 'fixed';

    return (
        <Modal
            isOpen
            scope="brand"
            onClose={onClose}
            title={t('settings.title')}
            closeLabel={t('common.close')}
            logId="settings"
            className="h-[600px] max-h-[90vh] max-w-3xl"
            bodyClassName="flex min-h-0 gap-0 px-0 pb-4"
            footer={<Button variant="ghost" size="sm" onClick={() => setConfirm('reset')}>{t('settings.resetDefaults')}</Button>}
        >
            <nav aria-label={t('settings.sections')} className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto p-3">
                {SETTINGS_TABS.map(({ id, labelKey, Icon }) => (
                    <button
                        key={id}
                        type="button"
                        aria-current={activeTab === id ? 'true' : undefined}
                        onClick={() => setActiveTab(id)}
                        className={cn(
                            'flex w-full items-center gap-2 rounded-pill px-3 py-2 text-left text-small transition-colors duration-fast ease-standard',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            activeTab === id ? 'bg-accent-subtle font-semibold text-accent-strong' : 'text-secondary hover:bg-sunken hover:text-primary',
                        )}
                    >
                        <Icon className="h-4 w-4 shrink-0" />
                        {t(labelKey)}
                    </button>
                ))}
            </nav>
            <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-2">
                {activeTab === 'general' && (<>
                    <SettingRow label={t('settings.language')} description={t('settings.languageDesc')}>
                        <Select
                            aria-label={t('settings.language')}
                            value={i18n.language}
                            onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                        >
                            {Object.entries(SUPPORTED_LANGUAGES).map(([code, { nativeName }]) => (
                                <option key={code} value={code}>
                                    {nativeName}
                                </option>
                            ))}
                        </Select>
                    </SettingRow>

                    <SettingRow label={t('settings.outputFolder')} error={rowError('outputDir')}>
                        <div className="flex gap-2">
                            <Input
                                aria-label={t('settings.outputFolder')}
                                value={outputDirInput}
                                onChange={(e) => setOutputDirInput(e.target.value)}
                                className="flex-1"
                            />
                            <Button variant="primary" onClick={() => save('outputDir', { output_dir: outputDirInput })}>
                                {t('common.save')}
                            </Button>
                        </div>
                    </SettingRow>

                    <SettingRow
                        label={t('settings.incomingCall')}
                        error={rowError('incomingCall')}
                        description={t('settings.incomingCallDesc')}
                        control={<Switch checked={incomingCallEnabled} onCheckedChange={(v) => save('incomingCall', { incoming_call_enabled: v })} aria-label={t('settings.incomingCall')} />}
                    />

                    <SettingRow
                        label={t('settings.callPopup')}
                        error={rowError('callPopup')}
                        description={t('settings.callPopupDesc')}
                        control={<Switch checked={callPopupEnabled} onCheckedChange={(v) => save('callPopup', { call_popup_enabled: v })} aria-label={t('settings.callPopup')} />}
                    />

                    <SettingRow
                        label={t('settings.closeToTray')}
                        error={rowError('closeToTray')}
                        description={t('settings.closeToTrayDesc')}
                        control={<Switch checked={closeToTray} onCheckedChange={(v) => save('closeToTray', { close_to_tray: v })} aria-label={t('settings.closeToTray')} />}
                    />

                    <SettingRow
                        label={t('settings.autostart')}
                        error={rowError('autostart')}
                        description={t('settings.autostartDesc')}
                        control={<Switch checked={autostart} onCheckedChange={(v) => save('autostart', { autostart: v })} aria-label={t('settings.autostart')} />}
                    />

                    <SettingRow
                        label={t('settings.notifications')}
                        error={rowError('notifications')}
                        description={t('settings.notificationsDesc')}
                        control={<Switch checked={notificationsEnabled} onCheckedChange={(v) => save('notifications', { notifications_enabled: v })} aria-label={t('settings.notifications')} />}
                    />

                    <SettingRow
                        label={t('settings.notificationsHideContent')}
                        error={rowError('notificationsHideContent')}
                        description={t('settings.notificationsHideContentDesc')}
                        control={
                            <Switch
                                checked={notificationsHideContent}
                                onCheckedChange={(v) => save('notificationsHideContent', { notifications_hide_content: v })}
                                disabled={!notificationsEnabled}
                                aria-disabled={!notificationsEnabled}
                                aria-label={t('settings.notificationsHideContent')}
                            />
                        }
                    />

                    <section className="flex flex-col gap-1">
                        <h3 className={FIELD_LABEL}>{t('settings.memoriesNotify.title')}</h3>
                        <p className="max-w-md text-small text-muted">{t('settings.memoriesNotify.desc')}</p>
                    </section>

                    <SettingRow
                        label={t('settings.memoriesNotify.time')}
                        error={rowError('memoriesNotify.time')}
                        description={
                            <>
                                <span className="block">{t('settings.memoriesNotify.timeDesc')}</span>
                                {memoriesTimeLocal && <span className="block">{t('settings.memoriesNotify.timeHint', { local: memoriesTimeLocal })}</span>}
                            </>
                        }
                        control={
                            <Select
                                aria-label={t('settings.memoriesNotify.time')}
                                value={memoriesTime}
                                onChange={(e) => save('memoriesNotify.time', { memories_notify_time: e.target.value })}
                                disabled={!notificationsEnabled || memoriesTimeIdle}
                                className="w-auto"
                            >
                                {memoriesTimeOptions(memoriesTime).map((hhmm) => (
                                    <option key={hhmm} value={hhmm}>{hhmm}</option>
                                ))}
                            </Select>
                        }
                    />

                    {MEMORIES_NOTIFY_KINDS.map(({ id, key, fallback }) => (
                        <SettingRow
                            key={id}
                            label={t(`settings.memoriesNotify.${id}`)}
                            error={rowError(`memoriesNotify.${id}`)}
                            description={t(`settings.memoriesNotify.${id}Desc`)}
                            control={
                                <Switch
                                    checked={appSettings[key] ?? fallback}
                                    onCheckedChange={(v) => save(`memoriesNotify.${id}`, { [key]: v })}
                                    disabled={!notificationsEnabled}
                                    aria-label={t(`settings.memoriesNotify.${id}`)}
                                />
                            }
                        />
                    ))}
                </>)}

                {activeTab === 'sync' && (<>
                    <SettingRow
                        label={t('settings.syncMode')}
                        error={rowError('syncMode')}
                        labelId={syncModeLabelId}
                        description={
                            syncMode === 'off'
                                ? t('settings.syncCurrentOff')
                                : syncMode === 'smart'
                                    ? t('settings.syncCurrentSmart')
                                    : t('settings.syncCurrentFixed', { minutes: appSettings.sync_interval_minutes })
                        }
                    >
                        <div role="radiogroup" aria-labelledby={syncModeLabelId} className="flex flex-col gap-1">
                            <label className={RADIO_ROW}>
                                <input
                                    type="radio"
                                    name="syncMode"
                                    checked={syncMode === 'off'}
                                    onChange={() => save('syncMode', { auto_sync_enabled: false, adaptive_sync_enabled: false })}
                                    className="h-4 w-4 accent-accent"
                                />
                                <div>
                                    <span className="text-body text-primary">{t('settings.syncOff')}</span>
                                    <p className="text-small text-muted">{t('settings.syncOffDesc')}</p>
                                </div>
                            </label>

                            <label className={RADIO_ROW}>
                                <input
                                    type="radio"
                                    name="syncMode"
                                    checked={syncMode === 'fixed'}
                                    onChange={() => save('syncMode', { auto_sync_enabled: true, adaptive_sync_enabled: false })}
                                    className="h-4 w-4 accent-accent"
                                />
                                <div>
                                    <span className="text-body text-primary">{t('settings.syncFixed')}</span>
                                    <p className="text-small text-muted">{t('settings.syncFixedDesc')}</p>
                                </div>
                            </label>
                            {syncMode === 'fixed' && (
                                <div className="ml-8 flex items-center gap-2">
                                    <span className="text-small text-secondary">{t('settings.syncEvery')}</span>
                                    <Select
                                        aria-label={t('settings.syncEvery')}
                                        value={appSettings.sync_interval_minutes}
                                        onChange={(e) => save('syncMode', { sync_interval_minutes: parseInt(e.target.value) })}
                                        className="w-auto"
                                    >
                                        <option value={1}>{t('time.minute', { count: 1 })}</option>
                                        <option value={5}>{t('time.minute', { count: 5 })}</option>
                                        <option value={10}>{t('time.minute', { count: 10 })}</option>
                                        <option value={30}>{t('time.minute', { count: 30 })}</option>
                                        <option value={60}>{t('time.hour', { count: 1 })}</option>
                                    </Select>
                                </div>
                            )}

                            <label className={RADIO_ROW}>
                                <input
                                    type="radio"
                                    name="syncMode"
                                    checked={syncMode === 'smart'}
                                    onChange={() => save('syncMode', { auto_sync_enabled: true, adaptive_sync_enabled: true })}
                                    className="h-4 w-4 accent-accent"
                                />
                                <div>
                                    <span className="text-body text-primary">{t('settings.syncSmart')}</span>
                                    <p className="text-small text-muted">{t('settings.smartTimingDesc')}</p>
                                </div>
                            </label>
                        </div>
                    </SettingRow>

                    <SettingRow
                        label={<>
                            {t('settings.blogFullBackup')}
                            {blogBackupRunning && (
                                <span className="flex items-center gap-1 text-caption font-normal text-secondary">
                                    <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                                    {blogBackupStats
                                        ? t('settings.blogBackupProgress', { cached: blogBackupStats.cached, total: blogBackupStats.total })
                                        : t('settings.blogBackupWorking')}
                                </span>
                            )}
                        </>}
                        error={rowError('blogFullBackup')}
                        description={blogBackupEnabled ? t('settings.blogFullBackupOnDesc') : t('settings.blogFullBackupOffDesc')}
                        control={
                            <Switch
                                checked={!!blogBackupEnabled}
                                onCheckedChange={(v) => { setBlogTogglePending(v); save('blogFullBackup', { blogs_full_backup: v }); }}
                                aria-label={t('settings.blogFullBackup')}
                            />
                        }
                    >
                        {blogBackupEnabled && (
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-1 text-small text-muted">
                                    {blogSizeLoading
                                        ? <><Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />{t('settings.blogBackupCalculating')}</>
                                        : blogCacheSize ? t('settings.blogCacheSize', { size: blogCacheSize }) : ''}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={DANGER_GHOST}
                                    onClick={() => setConfirm('clean')}
                                    disabled={isClearing}
                                >
                                    {isClearing ? t('common.loading') : t('settings.cleanBlogCache')}
                                </Button>
                            </div>
                        )}
                    </SettingRow>

                    <div data-testid="settings-group-rows" style={groupMarker} className="flex flex-col gap-6">
                        <SettingRow
                            label={<>{t('settings.verifyFixMedia')}<GroupChip serviceId={activeService} /></>}
                            description={t('settings.verifyFixMediaDesc')}
                            control={
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        // Close settings so the verify progress/result
                                        // (shown in the sync modal) is in focus.
                                        onVerifyAndFix(activeService);
                                        onClose();
                                    }}
                                >
                                    {t('settings.verifyFixButton')}
                                </Button>
                            }
                        />

                        {/* Deep re-verify: full re-sync (re-paginates every member from
                            scratch, skipping already-downloaded assets). Catches gaps the
                            media-only check can't (e.g. entirely-missing messages). */}
                        <SettingRow
                            label={<>{t('settings.deepResync')}<GroupChip serviceId={activeService} /></>}
                            description={t('settings.deepResyncDesc')}
                            control={
                                <Button variant="ghost" size="sm" className="text-semantic-warning hover:bg-semantic-warning-subtle" onClick={() => setConfirm('deep')}>
                                    {t('settings.deepResyncButton')}
                                </Button>
                            }
                        />
                    </div>

                    <SettingRow
                        label={t('settings.syncReadToPhone')}
                        error={rowError('syncReadToPhone')}
                        description={t('settings.syncReadToPhoneDesc')}
                        control={<Switch checked={syncReadToPhone} onCheckedChange={(v) => save('syncReadToPhone', { sync_read_to_phone: v })} aria-label={t('settings.syncReadToPhone')} />}
                    />
                </>)}

                {activeTab === 'ai' && <AiTab />}

                {activeTab === 'updates' && (
                    <UpdatesSection
                        autoDownload={appSettings.auto_download_updates ?? false}
                        onToggleAutoDownload={(val) => save('autoDownload', { auto_download_updates: val })}
                        saveError={rowError('autoDownload')}
                    />
                )}
            </div>
            <ConfirmDialog
                // The second delete step is a fresh dialog: focus starts on Cancel again.
                key={confirm === 'clean2' ? 'clean2' : 'confirm'}
                open={confirm !== null}
                title={confirm === 'reset' ? t('settings.resetDefaults') : confirm === 'deep' ? t('settings.deepResync') : t('settings.cleanBlogCache')}
                message={
                    confirm === 'reset' ? t('settings.resetConfirm')
                    : confirm === 'deep' ? t('settings.deepResyncConfirm')
                    : confirm === 'clean2' ? t('settings.cleanBlogCacheConfirm2')
                    : t('settings.cleanBlogCacheConfirm')
                }
                confirmLabel={confirm === 'deep' ? t('settings.deepResyncButton') : t('common.confirm')}
                variant={confirm === 'clean' || confirm === 'clean2' ? 'danger' : 'warning'}
                onCancel={() => setConfirm(null)}
                onConfirm={() => {
                    const kind = confirm;
                    if (kind === 'clean') { setConfirm('clean2'); return; } // second confirmation, as before
                    setConfirm(null);
                    if (kind === 'clean2') void handleCleanBlogCache();
                    if (kind === 'reset') void handleResetDefaults();
                    if (kind === 'deep') { onDeepResync(activeService); onClose(); }
                }}
            />
        </Modal>
    );
};


function UpdatesSection({ autoDownload, onToggleAutoDownload, saveError }: {
    autoDownload: boolean;
    onToggleAutoDownload: (val: boolean) => void;
    /** Inline failure of the last auto-download save. */
    saveError?: string;
}) {
    const { t } = useTranslation();
    const [checking, setChecking] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const checkVersion = useUpgradeStore((st) => st.checkVersion);

    const handleCheckNow = async () => {
        setChecking(true);
        setResult(null);
        // A manual check is always live (force) and goes through the shared upgrade
        // store, so the rail icon and the actions below update too.
        const data = await checkVersion(true);
        if (data) {
            logDialogLoad('settings_update_check', 'ok');
            // When an update exists, UpdateActions below says so with its button.
            setResult(data.update_available ? null : t('settings.upToDate'));
        } else {
            logDialogLoad('settings_update_check', 'error');
            setResult(t('settings.updateCheckFailed'));
        }
        setChecking(false);
    };

    return (
        <SettingRow
            label={t('settings.autoDownloadUpdates')}
            description={t('settings.autoDownloadUpdatesDesc')}
            control={<Switch checked={autoDownload} onCheckedChange={onToggleAutoDownload} aria-label={t('settings.autoDownloadUpdates')} />}
            error={saveError}
        >
            <div className="mt-2 flex items-center gap-3">
                <Button variant="secondary" size="sm" onClick={handleCheckNow} disabled={checking}>
                    {checking
                        ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                        : <RefreshCw className="h-4 w-4" />
                    }
                    {t('settings.checkForUpdates')}
                </Button>
                {/* Mounted empty so the result is announced when it arrives. */}
                <span role="status" className="text-small text-secondary">{result}</span>
            </div>
            <UpdateActions />
        </SettingRow>
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
    const [confirmClear, setConfirmClear] = useState(false);
    const fieldId = useId();

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
            .then(res => {
                if (!res.ok) throw new Error('config refused');
                return res.json();
            })
            .then(data => {
                logDialogLoad('settings_ai_config', 'ok');
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
            .catch(() => logDialogLoad('settings_ai_config', 'error'))
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
            .then(res => {
                if (!res.ok) throw new Error('models refused');
                return res.json();
            })
            .then(data => {
                logDialogLoad('settings_ai_models', 'ok');
                // Transform backend format {gemini: [{id, label}]} to {gemini: [{value, label}]}
                const opts: Record<string, { value: string; label: string }[]> = {};
                for (const [prov, models] of Object.entries(data)) {
                    opts[prov] = (models as { id: string; label: string }[]).map(m => ({ value: m.id, label: m.label }));
                }
                setModelOptions(opts);
            })
            .catch(() => logDialogLoad('settings_ai_models', 'error'));
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
                logDialogLoad('settings_ai_test', 'ok');
                setTestResult(t('translation.settings.testSuccess'));
            } else {
                // Map the backend's reason code to a localized message instead of
                // showing its English `detail`; the breadcrumb carries only the code.
                const byCode: Record<string, { key: string; reason: DialogLoadReason }> = {
                    auth: { key: 'translation.settings.testErrorAuth', reason: 'auth' },
                    unreachable: { key: 'translation.settings.testErrorUnreachable', reason: 'unreachable' },
                    no_key: { key: 'translation.settings.testErrorNoKey', reason: 'no_key' },
                };
                const known = typeof data.code === 'string' && Object.prototype.hasOwnProperty.call(byCode, data.code) ? byCode[data.code] : null;
                const { key, reason } = known ?? { key: 'translation.settings.testFailed', reason: 'failed' as const };
                logDialogLoad('settings_ai_test', 'error', undefined, reason);
                setTestResult(t(key));
            }
        } catch {
            logDialogLoad('settings_ai_test', 'error', undefined, 'unreachable');
            setTestResult(t('translation.settings.testErrorUnreachable'));
        } finally {
            setTesting(false);
        }
    };

    const handleClearCache = async () => {
        try {
            await clearTranslationCache();
        } catch {
            logDialogLoad('settings_ai_cache_clear', 'error');
            setTestResult(t('translation.settings.cacheClearFailed'));
            return;
        }
        logDialogLoad('settings_ai_cache_clear', 'ok');
        setTestResult(t('translation.settings.cacheClearedMsg'));
    };

    // Runs after the in-app confirm (the ConfirmDialog at the end of this tab).
    const handleClearApiKey = async () => {
        try {
            const res = await fetch('/api/translation/clear-api-key', { method: 'POST' });
            if (!res.ok) throw new Error('clear refused');
        } catch {
            // The key is still stored: keep showing it as saved and say the clear failed.
            logDialogLoad('settings_ai_key_clear', 'error');
            setTestResult(t('translation.settings.clearApiKeyFailed'));
            return;
        }
        logDialogLoad('settings_ai_key_clear', 'ok');
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
        }
        if (updates.target_language !== undefined) {
            setTargetLang(updates.target_language);
            setTranslationTargetLanguage(updates.target_language);
        }

        // Keep the session cache in step so a reopen reflects the change instantly.
        aiConfigCache = {
            provider: newProvider,
            model: newModel,
            hasApiKey,  // a new key counts as stored only once the save succeeds (below)
            apiKeyMasked: aiConfigCache?.apiKeyMasked ?? null,  // refreshed by the next fetch
            targetLang: newTargetLang,
        };

        // Persist to backend (API key stored in keyring, not settings.json)
        // Only send api_key if user typed a new one
        const apiKeyToSend = updates.api_key !== undefined ? updates.api_key : undefined;
        const failedMsg = t('translation.settings.saveFailed');
        fetch('/api/translation/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: newProvider,
                model: newModel,
                api_key: apiKeyToSend ?? null,
                target_language: newTargetLang,
            }),
        })
            .then(res => {
                if (!res.ok) throw new Error('configure refused');
                logDialogLoad('settings_ai_save', 'ok');
                if (apiKeyToSend) {
                    setHasApiKey(true);
                    if (aiConfigCache) aiConfigCache.hasApiKey = true;
                }
                // A later save that works replaces an earlier failure message.
                setTestResult(prev => (prev === failedMsg ? null : prev));
            })
            .catch(() => {
                logDialogLoad('settings_ai_save', 'error');
                setTestResult(failedMsg);
            });
    };

    const handleProviderChange = (value: string | null) => {
        const newModels = MODELS[value ?? ''] ?? [];
        const newModel = newModels[0]?.value ?? null;
        saveConfig({ provider: value, model: newModel });
    };

    const showProvider = transcriptionEnabled || translationEnabled;

    return (
        <>
            <SettingRow
                label={t('settings.transcriptionDevice')}
                control={<Switch checked={transcriptionEnabled} onCheckedChange={setTranscriptionEnabled} aria-label={t('settings.transcriptionDevice')} />}
            />

            <SettingRow
                label={t('translation.settings.title')}
                control={<Switch checked={translationEnabled} onCheckedChange={setTranslationEnabled} aria-label={t('translation.settings.title')} />}
            >
                {translationEnabled && (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <label htmlFor={`${fieldId}-target`} className={FIELD_LABEL}>{t('translation.settings.targetLanguage')}</label>
                            <Select
                                id={`${fieldId}-target`}
                                value={targetLang ?? ''}
                                onChange={(e) => saveConfig({ target_language: e.target.value || null })}
                                className="w-auto"
                            >
                                <option value="">—</option>
                                {TARGET_LANGUAGES.map(l => (
                                    <option key={l.value} value={l.value}>{l.label}</option>
                                ))}
                            </Select>
                        </div>
                        <Button variant="secondary" size="sm" className="self-start" onClick={handleClearCache}>
                            {t('translation.settings.clearCache')}
                        </Button>
                    </div>
                )}
            </SettingRow>

            {/* Shared AI provider — used by both Transcription and Translation */}
            {showProvider && (
                <SettingRow label={t('settings.aiProvider')}>
                    <div className="flex flex-col gap-3">
                        {configLoading && (
                            <div className="flex items-center gap-2 text-caption text-muted">
                                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                                {t('common.loading')}
                            </div>
                        )}
                        <div className="flex flex-col gap-1">
                            <label htmlFor={`${fieldId}-provider`} className={FIELD_LABEL}>{t('translation.settings.provider')}</label>
                            <Select
                                id={`${fieldId}-provider`}
                                value={provider ?? ''}
                                onChange={(e) => handleProviderChange(e.target.value || null)}
                            >
                                <option value="">—</option>
                                {PROVIDERS.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </Select>
                            {provider === 'gemini' && (
                                <div className="mt-2 flex flex-col gap-1 text-caption text-muted">
                                    <p>{t('translation.dataPolicy.geminiFree')}</p>
                                    <p>{t('translation.dataPolicy.geminiPaid')}</p>
                                </div>
                            )}
                        </div>

                        {provider && MODELS[provider] && (
                            <div className="flex flex-col gap-1">
                                <label htmlFor={`${fieldId}-model`} className={FIELD_LABEL}>{t('translation.settings.model')}</label>
                                <Select
                                    id={`${fieldId}-model`}
                                    value={model ?? ''}
                                    onChange={(e) => saveConfig({ model: e.target.value || null })}
                                >
                                    {MODELS[provider].map(m => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                    ))}
                                </Select>
                            </div>
                        )}

                        {provider && (
                            <div className="flex flex-col gap-1">
                                <label htmlFor={`${fieldId}-key`} className={FIELD_LABEL}>{t('translation.settings.apiKey')}</label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        id={`${fieldId}-key`}
                                        type="password"
                                        value={apiKeyInput}
                                        onChange={(e) => setApiKeyInput(e.target.value)}
                                        onBlur={() => { if (apiKeyInput) saveConfig({ api_key: apiKeyInput }); }}
                                        className="flex-1"
                                        placeholder={hasApiKey && apiKeyMasked ? apiKeyMasked : 'sk-... / AIza...'}
                                    />
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleTestConnection}
                                        disabled={testing || (!apiKeyInput && !hasApiKey)}
                                    >
                                        {testing && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                                        {t('translation.settings.testConnection')}
                                    </Button>
                                </div>
                                {apiKeyStatus({ provider, hasApiKey, hasInput: !!apiKeyInput }) === 'saved' && (
                                    <div className="mt-1 flex items-center justify-between gap-4">
                                        <p className="text-caption text-status-success">{t('translation.settings.savedSecurely')}</p>
                                        <Button variant="ghost" size="sm" className={DANGER_GHOST} onClick={() => setConfirmClear(true)}>
                                            {t('translation.settings.clearApiKey')}
                                        </Button>
                                    </div>
                                )}
                                {apiKeyStatus({ provider, hasApiKey, hasInput: !!apiKeyInput }) === 'missing' && !configLoading && (
                                    <p className="mt-1 text-caption text-status-warning">{t('translation.settings.keyMissing')}</p>
                                )}
                            </div>
                        )}
                        {/* Test, cache and save results; mounted empty so each one is announced. */}
                        <p role="status" className="text-small text-secondary">{testResult}</p>
                    </div>
                </SettingRow>
            )}

            <ConfirmDialog
                open={confirmClear}
                title={t('translation.settings.clearApiKey')}
                message={t('translation.settings.clearApiKeyConfirm')}
                confirmLabel={t('common.confirm')}
                variant="danger"
                onCancel={() => setConfirmClear(false)}
                onConfirm={() => {
                    setConfirmClear(false);
                    void handleClearApiKey();
                }}
            />
        </>
    );
}
