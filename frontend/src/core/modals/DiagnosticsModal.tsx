import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Copy, RefreshCw, CheckCircle2, AlertCircle, Database, HardDrive, Clock, AlertTriangle, Unplug, ChevronRight, Terminal } from 'lucide-react';
import { useAuth } from '../../shell/hooks/useAuth';
import { getServiceById, sortByServiceOrder } from '../../data/services';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { Modal, Button, Card, Pill } from '../../design/primitives';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import { cn } from '../../utils/classnames';
import { DialogStatus } from '../common/DialogStatus';
import { clientLog } from '../../utils/clientLog';

/** How often the panel polls `/api/diagnostics/disk-usage` while it is `pending`. */
export const DISK_USAGE_POLL_MS = 2000;

/**
 * Returns the hashed filename of the currently-loaded frontend bundle
 * (e.g., "index-DRnvKcfw.js"), or "dev" when running the Vite dev server.
 * Useful for confirming which build is actually executing after upgrades —
 * compare against the file on disk in _internal/frontend/dist/assets/.
 */
function getFrontendBundle(): string {
    const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'));
    const bundleSrc = scripts
        .map(s => s.src)
        .find(src => /\/assets\/index-[A-Za-z0-9_-]+\.js(\?|$)/.test(src));
    if (!bundleSrc) return 'dev';
    const filename = bundleSrc.split('/').pop() ?? '';
    return filename.split('?')[0] || 'unknown';
}

interface SystemInfo {
    os: string;
    os_release: string;
    python_version: string;
    app_version: string;
    pysaka_version: string;
    app_data_dir: string;
    settings_path: string;
    logs_dir: string;
    is_windows: boolean;
}

interface AuthStatus {
    has_token: boolean;
    token_expires_in?: string;
    token_expiry_seconds?: number;
    groups_configured: string[];
}

interface ServiceSyncInfo {
    service_id: string;
    display_name: string;
    last_sync?: string;
    last_error?: string;
    message_count: number;
    member_count: number;
}

interface DiskUsageCategory {
    name: string;
    bytes: number;
}

interface DiskUsageService {
    name: string;
    total_bytes: number;
    categories: DiskUsageCategory[];
}

interface DiskUsageDetailed {
    total_bytes: number;
    services: DiskUsageService[];
}

interface SyncState {
    last_error?: string;
    /** Mirrors of `disk_usage` (0 / absent until it is `ready`), kept for the copied JSON. */
    disk_usage_mb: number;
    file_count: number;
    disk_usage_detailed?: DiskUsageDetailed | null;
    services: ServiceSyncInfo[];
}

/**
 * Output-folder disk usage, computed by the backend off the request path. The
 * walk can take minutes on a large archive, so it starts `pending` and the
 * panel polls until it is `ready` or `failed`.
 */
interface DiskUsage {
    state: 'pending' | 'ready' | 'failed';
    size_mb: number;
    file_count: number;
    detailed?: DiskUsageDetailed | null;
    computed_at?: string | null;
    duration_ms?: number | null;
}

interface LogsSummary {
    recent: string[];
    errors: string[];
    warnings: string[];
}

interface DiagnosticsData {
    system: SystemInfo;
    auth_status: AuthStatus;
    config_state: Record<string, any>;
    sync_state: SyncState;
    disk_usage: DiskUsage;
    logs: LogsSummary;
}

/** Apply a polled disk-usage result, keeping the backend's `sync_state` mirrors in step. */
function withDiskUsage(data: DiagnosticsData, usage: DiskUsage): DiagnosticsData {
    const ready = usage.state === 'ready';
    return {
        ...data,
        disk_usage: usage,
        sync_state: {
            ...data.sync_state,
            disk_usage_mb: ready ? usage.size_mb : 0,
            file_count: ready ? usage.file_count : 0,
            disk_usage_detailed: ready ? usage.detailed ?? null : null,
        },
    };
}

interface DiagnosticsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type LogTab = 'recent' | 'errors' | 'warnings';

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
}

function DiskUsageServiceRow({ service }: { service: DiskUsageService }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div>
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center justify-between rounded-pill px-2 py-1 hover:bg-sunken"
            >
                <span className="text-secondary flex items-center gap-1">
                    <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    {service.name}
                </span>
                <span className="font-mono text-secondary">{formatBytes(service.total_bytes)}</span>
            </button>
            {expanded && (
                <div className="ml-5 flex flex-col gap-1">
                    {service.categories.map(cat => (
                        <div key={cat.name} className="flex justify-between py-1">
                            <span className="text-muted">{cat.name}</span>
                            <span className="font-mono text-secondary">{formatBytes(cat.bytes)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function DiagnosticsModal({ isOpen, onClose }: DiagnosticsModalProps) {
    const { t } = useTranslation();
    const [data, setData] = useState<DiagnosticsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [logTab, setLogTab] = useState<LogTab>('recent');
    // A disk-usage poll request itself failed (backend unreachable); Refresh clears it.
    const [diskPollFailed, setDiskPollFailed] = useState(false);
    const frontendBundle = useMemo(() => getFrontendBundle(), []);

    // Get live auth status from context
    const { connectedServices, disconnectedServices, isServiceConnected, isServiceDisconnected, getServiceExpiresAt, getScheduledRefreshServices } = useAuth();

    // Helper to format remaining time
    const formatRemainingTime = (expiresAtMs: number | null): string => {
        if (!expiresAtMs) return 'unknown';
        const remainingMs = expiresAtMs - Date.now();
        if (remainingMs <= 0) return 'expired';
        const minutes = Math.floor(remainingMs / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        return `${minutes}m`;
    };

    // Helper to format scheduled refresh time
    const formatScheduledRefresh = (expiresAtMs: number | null): string => {
        if (!expiresAtMs) return 'not scheduled';
        // Refresh is scheduled 10 minutes before expiry
        const refreshAt = expiresAtMs - (10 * 60 * 1000);
        const now = Date.now();
        if (refreshAt <= now) return 'imminent';
        const msUntilRefresh = refreshAt - now;
        const minutes = Math.floor(msUntilRefresh / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `in ${hours}h ${minutes % 60}m`;
        }
        return `in ${minutes}m`;
    };

    /**
     * Load the summary. It answers at once; disk usage may still be `pending`
     * (then the poll effect below takes over). `refreshDiskUsage` (the Refresh
     * button) asks the backend to recompute its cached disk usage.
     */
    const fetchDiagnostics = async (refreshDiskUsage = false) => {
        setLoading(true);
        setError(null);
        setDiskPollFailed(false);
        try {
            const res = await fetch(refreshDiskUsage ? '/api/diagnostics?refresh_disk_usage=true' : '/api/diagnostics');
            if (!res.ok) throw new Error('Failed to fetch diagnostics');
            const json: DiagnosticsData = await res.json();
            setData(json);
            logDialogLoad('diagnostics', 'ok');
            clientLog('diagnostics_disk_usage', { outcome: json.disk_usage.state, phase: refreshDiskUsage ? 'refresh' : 'load' });
        } catch (err: any) {
            logDialogLoad('diagnostics', 'error');
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchDiagnostics();
        }
    }, [isOpen]);

    // While disk usage is `pending`, poll the background result until it is
    // `ready` / `failed`. Stops when the panel closes or unmounts while still
    // pending (logged as abandoned) — not when a Refresh response settled it.
    const diskState = data?.disk_usage.state;
    // The latest state, read by the poll cleanup to tell "settled elsewhere" from
    // "abandoned". Layout effects run before passive cleanups, so it is current.
    const diskStateRef = useRef(diskState);
    useLayoutEffect(() => {
        diskStateRef.current = diskState;
    });
    useEffect(() => {
        if (!isOpen || diskState !== 'pending' || diskPollFailed) return;
        let settled = false;
        let polls = 0;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            polls += 1;
            try {
                const res = await fetch('/api/diagnostics/disk-usage');
                if (!res.ok) throw new Error('Failed to fetch disk usage');
                const usage: DiskUsage = await res.json();
                if (settled) return;
                if (usage.state === 'pending') {
                    timer = setTimeout(poll, DISK_USAGE_POLL_MS);
                    return;
                }
                settled = true;
                clientLog('diagnostics_disk_usage', { outcome: usage.state, phase: 'poll', count: polls });
                setData(prev => (prev ? withDiskUsage(prev, usage) : prev));
            } catch {
                if (settled) return;
                settled = true;
                clientLog('diagnostics_disk_usage', { outcome: 'error', phase: 'poll', count: polls });
                setDiskPollFailed(true);
            }
        };
        timer = setTimeout(poll, DISK_USAGE_POLL_MS);
        return () => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;
            // Became ready / failed through the Refresh response (already logged there).
            if (diskStateRef.current !== 'pending') return;
            clientLog('diagnostics_disk_usage', { outcome: 'abandoned', phase: 'poll', count: polls });
        };
    }, [isOpen, diskState, diskPollFailed]);

    const handleCopy = () => {
        if (!data) return;
        const text = JSON.stringify({ ...data, frontend_bundle: frontendBundle }, null, 2);
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const getLogsForTab = (): string[] => {
        if (!data) return [];
        switch (logTab) {
            case 'errors': return data.logs.errors;
            case 'warnings': return data.logs.warnings;
            default: return data.logs.recent;
        }
    };

    return (
        <Modal scope="brand" isOpen={isOpen} onClose={onClose} title="Developer Diagnostics" header="console" icon={<Terminal className="text-console-prompt" />} closeLabel={t('common.close')} logId="diagnostics" className="max-w-3xl"
            headerExtra={<span className="rounded-pill bg-console-badge px-2 py-1 font-mono text-caption uppercase tracking-wide text-console-badge">Hidden Panel</span>}
            bodyClassName="flex flex-col gap-4"
            footerDivider
            footer={
                <>
                    <Button variant="ghost" className="mr-auto" onClick={() => fetchDiagnostics(true)}>
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} />
                        Refresh
                    </Button>
                    <Button
                        variant="secondary"
                        className="border-transparent bg-console text-console hover:bg-console hover:opacity-90 disabled:hover:bg-console disabled:hover:opacity-100 aria-disabled:hover:bg-console"
                        onClick={handleCopy}
                        disabled={!data}
                    >
                        {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        {copied ? 'Copied!' : 'Copy JSON'}
                    </Button>
                </>
            }
        >
                    {loading && <DialogStatus kind="loading" />}

                    {error && <DialogStatus kind="error" title={error} />}

                    {data && !loading && (
                        <>
                            {/* System & Auth Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* System Info */}
                                <Card className="p-4">
                                    <h4 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted">SYSTEM</h4>
                                    <div className="flex flex-col gap-2 text-small">
                                        <div className="flex justify-between">
                                            <span className="text-muted">OS</span>
                                            <span className="font-mono text-primary">{data.system.os} {data.system.os_release}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted">Python</span>
                                            <span className="font-mono text-primary">{data.system.python_version}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted">SakaDesk</span>
                                            <span className="font-mono text-primary">v{data.system.app_version}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted">pysaka</span>
                                            <span className="font-mono text-primary">
                                                {data.system.pysaka_version === 'unknown' ? 'unknown' : `v${data.system.pysaka_version}`}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span className="text-muted shrink-0">Frontend</span>
                                            <span className="font-mono text-primary text-caption truncate" title={frontendBundle}>
                                                {frontendBundle}
                                            </span>
                                        </div>
                                    </div>
                                </Card>

                                {/* Per-Service Auth Status (Live from Context) */}
                                <Card className="p-4">
                                    <h4 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted">SERVICE AUTHENTICATION</h4>
                                    <div className="flex flex-col gap-1 text-small">
                                        {data.auth_status.groups_configured.length === 0 && connectedServices.length === 0 ? (
                                            <div className="text-muted text-caption">No services configured</div>
                                        ) : (
                                            // Show all known services from backend + live status from context, sorted by global order
                                            sortByServiceOrder(
                                                [...new Set([...data.auth_status.groups_configured, ...connectedServices, ...disconnectedServices])],
                                                useAppStore.getState().getServiceOrder(),
                                                (id) => id,
                                            ).map(serviceId => {
                                                const service = getServiceById(serviceId);
                                                const displayName = service?.displayName ?? serviceId;
                                                const connected = isServiceConnected(serviceId);
                                                const disconnected = isServiceDisconnected(serviceId);
                                                const expiresAt = getServiceExpiresAt(serviceId);
                                                const scheduledServices = getScheduledRefreshServices();
                                                const hasScheduledRefresh = scheduledServices.includes(serviceId);

                                                return (
                                                    <div key={serviceId} className="py-2">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-secondary font-medium">{displayName}</span>
                                                            <div className="flex items-center gap-2">
                                                                {connected ? (
                                                                    <span className="flex items-center gap-1 text-status-success text-caption">
                                                                        <CheckCircle2 className="h-4 w-4" />
                                                                        Connected
                                                                    </span>
                                                                ) : disconnected ? (
                                                                    <span className="flex items-center gap-1 text-status-warning text-caption">
                                                                        <Unplug className="h-4 w-4" />
                                                                        Disconnected
                                                                    </span>
                                                                ) : (
                                                                    <span className="flex items-center gap-1 text-muted text-caption">
                                                                        <AlertCircle className="h-4 w-4" />
                                                                        Not logged in
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {connected && (
                                                            <div className="mt-1 flex items-center gap-4 text-caption text-muted">
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="h-3 w-3" />
                                                                    Expires: {formatRemainingTime(expiresAt)}
                                                                </span>
                                                                <span className="flex items-center gap-1">
                                                                    <RefreshCw className="h-3 w-3" />
                                                                    Refresh: {hasScheduledRefresh ? formatScheduledRefresh(expiresAt) : 'not scheduled'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </Card>
                            </div>

                            {/* Config & Sync Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* Config State */}
                                <Card className="p-4">
                                    <h4 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted">CONFIGURATION</h4>
                                    <div className="flex flex-col gap-2 text-small">
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted">Configured</span>
                                            {data.config_state.is_configured ?
                                                <CheckCircle2 className="h-4 w-4 text-status-success" /> :
                                                <AlertCircle className="h-4 w-4 text-status-warning" />
                                            }
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted">Output Dir</span>
                                            {data.config_state.output_dir_configured ?
                                                <CheckCircle2 className="h-4 w-4 text-status-success" /> :
                                                <AlertCircle className="h-4 w-4 text-status-warning" />
                                            }
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-muted">Auto-Sync</span>
                                            {!data.config_state.auto_sync ? (
                                                <span className="text-muted">Off</span>
                                            ) : data.config_state.adaptive_sync ? (
                                                <span className="text-status-success font-mono">Smart</span>
                                            ) : (
                                                <span className="text-status-success font-mono">{data.config_state.sync_interval}m</span>
                                            )}
                                        </div>
                                    </div>
                                </Card>

                                {/* Disk Usage - Expandable */}
                                <Card className="p-4">
                                    <h4 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted flex items-center gap-2">
                                        <Database className="h-3 w-3" /> DISK USAGE
                                    </h4>
                                    <div className="flex flex-col gap-1 text-small">
                                        {data.disk_usage.state === 'pending' && !diskPollFailed ? (
                                            <div role="status" data-testid="disk-usage-pending" className="flex items-center gap-2 text-muted">
                                                <RefreshCw className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                                                {t('diagnostics.diskUsageCalculating')}
                                            </div>
                                        ) : data.disk_usage.state !== 'ready' || diskPollFailed ? (
                                            <div role="status" data-testid="disk-usage-failed" className="flex items-center gap-2 text-status-warning">
                                                <AlertCircle className="h-3 w-3" />
                                                {t('diagnostics.diskUsageFailed')}
                                            </div>
                                        ) : (
                                            <>
                                                {/* Total */}
                                                <div className="flex justify-between font-medium">
                                                    <span className="text-secondary">Total</span>
                                                    <span className="font-mono text-primary">
                                                        {data.disk_usage.detailed
                                                            ? formatBytes(data.disk_usage.detailed.total_bytes)
                                                            : data.disk_usage.size_mb >= 1024
                                                                ? `${(data.disk_usage.size_mb / 1024).toFixed(2)} GB`
                                                                : `${data.disk_usage.size_mb.toFixed(2)} MB`}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-caption">
                                                    <span className="text-muted">Files</span>
                                                    <span className="font-mono text-muted">{data.disk_usage.file_count.toLocaleString()}</span>
                                                </div>
                                                {/* Per-service expandable */}
                                                {data.disk_usage.detailed?.services?.map((svc) => (
                                                    <DiskUsageServiceRow key={svc.name} service={svc} />
                                                ))}
                                            </>
                                        )}
                                    </div>
                                </Card>
                            </div>

                            {/* Per-Service Sync Status */}
                            {data.sync_state.services && data.sync_state.services.length > 0 && (
                                <Card className="p-4">
                                    <h4 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted flex items-center gap-2">
                                        <Clock className="h-3 w-3" /> SYNC STATUS BY SERVICE
                                    </h4>
                                    <div className="flex flex-col gap-3">
                                        {data.sync_state.services.map((service) => (
                                            <div key={service.service_id} className="rounded-card bg-sunken p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-medium text-primary">{service.display_name}</span>
                                                    {service.last_error ? (
                                                        <span className="flex items-center gap-1 text-status-danger text-caption">
                                                            <AlertCircle className="h-4 w-4" />
                                                            Error
                                                        </span>
                                                    ) : service.last_sync ? (
                                                        <span className="flex items-center gap-1 text-status-success text-caption">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                            OK
                                                        </span>
                                                    ) : (
                                                        <span className="text-muted text-caption">Never synced</span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-caption">
                                                    <div>
                                                        <span className="text-muted">Last sync:</span>
                                                        <span className="ml-1 font-mono text-secondary">
                                                            {service.last_sync || 'Never'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className="text-muted">Members:</span>
                                                        <span className="ml-1 font-mono text-secondary">
                                                            {service.member_count}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className="text-muted">Messages:</span>
                                                        <span className="ml-1 font-mono text-secondary">
                                                            {service.message_count.toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>
                                                {service.last_error && (
                                                    <div className="mt-2 rounded-card bg-sunken p-2 font-mono text-caption text-status-danger">
                                                        {service.last_error}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            )}

                            {/* Paths */}
                            <Card className="p-4">
                                <h4 className="mb-3 text-caption font-semibold uppercase tracking-wider text-muted flex items-center gap-2">
                                    <HardDrive className="h-3 w-3" /> PATHS
                                </h4>
                                <div className="flex flex-col gap-2 text-caption font-mono text-secondary">
                                    <div>
                                        <span className="text-muted">App Data: </span>
                                        <span className="break-all">{data.system.app_data_dir}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted">Settings: </span>
                                        <span className="break-all">{data.system.settings_path}</span>
                                    </div>
                                    <div>
                                        <span className="text-muted">Logs: </span>
                                        <span className="break-all">{data.system.logs_dir}</span>
                                    </div>
                                </div>
                            </Card>

                            {/* Logs with Tabs */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h4 className="text-caption font-semibold uppercase tracking-wider text-muted">Logs</h4>
                                    <div className="flex gap-1 ml-auto">
                                        <Pill selected={logTab === 'recent'} onClick={() => setLogTab('recent')}>Recent ({data.logs.recent.length})</Pill>
                                        <Pill selected={logTab === 'errors'} onClick={() => setLogTab('errors')}>
                                            <AlertCircle className="h-3 w-3 text-status-danger" />
                                            Errors ({data.logs.errors.length})
                                        </Pill>
                                        <Pill selected={logTab === 'warnings'} onClick={() => setLogTab('warnings')}>
                                            <AlertTriangle className="h-3 w-3 text-status-warning" />
                                            Warnings ({data.logs.warnings.length})
                                        </Pill>
                                    </div>
                                </div>
                                <div className="h-48 overflow-y-auto whitespace-pre-wrap rounded-card bg-console p-4 font-mono text-caption text-console-muted">
                                    {getLogsForTab().length > 0 ? (
                                        getLogsForTab().map((line, i) => (
                                            <div
                                                key={i}
                                                className={cn(
                                                    line.includes(' - ERROR - ') && 'text-console-error',
                                                    line.includes(' - WARNING - ') && !line.includes(' - ERROR - ') && 'text-console-warning',
                                                )}
                                            >
                                                {line}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-muted">{`No ${logTab} logs found.`}</span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
        </Modal>
    );
}
