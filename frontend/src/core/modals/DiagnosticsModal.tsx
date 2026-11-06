import { useState, useEffect, useMemo } from 'react';
import { Copy, RefreshCw, CheckCircle2, AlertCircle, Database, HardDrive, Clock, AlertTriangle, Unplug, ChevronRight, Terminal } from 'lucide-react';
import { useAuth } from '../../shell/hooks/useAuth';
import { getServiceById, sortByServiceOrder } from '../../data/services';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { Modal, Button, Card, Pill } from '../../design/primitives';
import { logDialogLoad } from '../../design/dialog/dialogLog';
import { cn } from '../../utils/classnames';
import { DialogStatus } from '../common/DialogStatus';

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
    disk_usage_mb: number;
    file_count: number;
    disk_usage_detailed?: DiskUsageDetailed;
    services: ServiceSyncInfo[];
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
    logs: LogsSummary;
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

    const fetchDiagnostics = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/diagnostics');
            if (!res.ok) throw new Error('Failed to fetch diagnostics');
            const json = await res.json();
            setData(json);
            logDialogLoad('diagnostics', 'ok');
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
        <Modal scope="brand" isOpen={isOpen} onClose={onClose} title="Developer Diagnostics" icon={<Terminal />} closeLabel={t('common.close')} logId="diagnostics" className="max-w-3xl"
            headerExtra={<span className="rounded-pill bg-sheet px-2 py-1 text-caption text-secondary">Hidden Panel</span>}
            bodyClassName="flex flex-col gap-4"
            footer={
                <>
                    <Button variant="ghost" className="mr-auto" onClick={fetchDiagnostics}>
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} />
                        Refresh
                    </Button>
                    <Button variant="primary" onClick={handleCopy} disabled={!data}>
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
                                        {/* Total */}
                                        <div className="flex justify-between font-medium">
                                            <span className="text-secondary">Total</span>
                                            <span className="font-mono text-primary">
                                                {data.sync_state.disk_usage_detailed
                                                    ? formatBytes(data.sync_state.disk_usage_detailed.total_bytes)
                                                    : data.sync_state.disk_usage_mb >= 1024
                                                        ? `${(data.sync_state.disk_usage_mb / 1024).toFixed(2)} GB`
                                                        : `${data.sync_state.disk_usage_mb.toFixed(2)} MB`}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-caption">
                                            <span className="text-muted">Files</span>
                                            <span className="font-mono text-muted">{data.sync_state.file_count.toLocaleString()}</span>
                                        </div>
                                        {/* Per-service expandable */}
                                        {data.sync_state.disk_usage_detailed?.services?.map((svc) => (
                                            <DiskUsageServiceRow key={svc.name} service={svc} />
                                        ))}
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
                                <div className="h-48 overflow-y-auto whitespace-pre-wrap rounded-card bg-sunken p-4 font-mono text-caption text-secondary">
                                    {getLogsForTab().length > 0 ? (
                                        getLogsForTab().map((line, i) => (
                                            <div
                                                key={i}
                                                className={cn(
                                                    line.includes(' - ERROR - ') && 'text-status-danger',
                                                    line.includes(' - WARNING - ') && !line.includes(' - ERROR - ') && 'text-status-warning',
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
