import { useState, useEffect } from 'react';
import { X, Copy, RefreshCw, Terminal, CheckCircle2, AlertCircle, Database, HardDrive, Clock, AlertTriangle, Unplug } from 'lucide-react';
import { useAuth } from '../../shell/hooks/useAuth';
import { getServiceById } from '../../data/services';

interface SystemInfo {
    os: string;
    os_release: string;
    python_version: string;
    app_version: string;
    pyhako_version: string;
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

interface SyncState {
    last_sync?: string;
    last_error?: string;
    disk_usage_mb: number;
    file_count: number;
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

export function DiagnosticsModal({ isOpen, onClose }: DiagnosticsModalProps) {
    const [data, setData] = useState<DiagnosticsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [logTab, setLogTab] = useState<LogTab>('recent');

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
        } catch (err: any) {
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
        const text = JSON.stringify(data, null, 2);
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-gray-900 px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <Terminal className="w-5 h-5 text-green-400" />
                        <h3 className="text-lg font-bold text-white">Developer Diagnostics</h3>
                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">Hidden Panel</span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-5">
                    {loading && (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-3">
                            <AlertCircle className="w-5 h-5" />
                            {error}
                        </div>
                    )}

                    {data && !loading && (
                        <>
                            {/* System & Auth Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* System Info */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">SYSTEM</h4>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">OS</span>
                                            <span className="font-mono text-gray-900">{data.system.os} {data.system.os_release}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Python</span>
                                            <span className="font-mono text-gray-900">{data.system.python_version}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">HakoDesk</span>
                                            <span className="font-mono text-gray-900">v{data.system.app_version}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">PyHako</span>
                                            <span className="font-mono text-gray-900">
                                                {data.system.pyhako_version === 'unknown' ? 'unknown' : `v${data.system.pyhako_version}`}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Per-Service Auth Status (Live from Context) */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">SERVICE AUTHENTICATION</h4>
                                    <div className="space-y-3 text-sm">
                                        {data.auth_status.groups_configured.length === 0 && connectedServices.length === 0 ? (
                                            <div className="text-gray-400 text-xs">No services configured</div>
                                        ) : (
                                            // Show all known services from backend + live status from context
                                            [...new Set([...data.auth_status.groups_configured, ...connectedServices, ...disconnectedServices])].map(serviceId => {
                                                const service = getServiceById(serviceId);
                                                const displayName = service?.displayName ?? serviceId;
                                                const connected = isServiceConnected(serviceId);
                                                const disconnected = isServiceDisconnected(serviceId);
                                                const expiresAt = getServiceExpiresAt(serviceId);
                                                const scheduledServices = getScheduledRefreshServices();
                                                const hasScheduledRefresh = scheduledServices.includes(serviceId);

                                                return (
                                                    <div key={serviceId} className="py-2 border-b border-gray-100 last:border-0">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-gray-700 font-medium">{displayName}</span>
                                                            <div className="flex items-center gap-2">
                                                                {connected ? (
                                                                    <span className="flex items-center gap-1 text-green-600 text-xs">
                                                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                                                        Connected
                                                                    </span>
                                                                ) : disconnected ? (
                                                                    <span className="flex items-center gap-1 text-orange-500 text-xs">
                                                                        <Unplug className="w-3.5 h-3.5" />
                                                                        Disconnected
                                                                    </span>
                                                                ) : (
                                                                    <span className="flex items-center gap-1 text-gray-400 text-xs">
                                                                        <AlertCircle className="w-3.5 h-3.5" />
                                                                        Not logged in
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {connected && (
                                                            <div className="mt-1 flex items-center gap-4 text-xs text-gray-500">
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" />
                                                                    Expires: {formatRemainingTime(expiresAt)}
                                                                </span>
                                                                <span className="flex items-center gap-1">
                                                                    <RefreshCw className="w-3 h-3" />
                                                                    Refresh: {hasScheduledRefresh ? formatScheduledRefresh(expiresAt) : 'not scheduled'}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Config & Sync Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* Config State */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">CONFIGURATION</h4>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-500">Configured</span>
                                            {data.config_state.is_configured ?
                                                <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                                                <AlertCircle className="w-4 h-4 text-amber-500" />
                                            }
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-500">Output Dir</span>
                                            {data.config_state.output_dir_configured ?
                                                <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                                                <AlertCircle className="w-4 h-4 text-amber-500" />
                                            }
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-500">Auto-Sync</span>
                                            {data.config_state.sync_interval && data.config_state.sync_interval > 0 ?
                                                <span className="text-green-600 font-mono">{data.config_state.sync_interval}m</span> :
                                                <span className="text-gray-400">Off</span>
                                            }
                                        </div>
                                    </div>
                                </div>

                                {/* Disk Usage */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Database className="w-3 h-3" /> DISK USAGE
                                    </h4>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Size</span>
                                            <span className="font-mono text-gray-900">
                                                {data.sync_state.disk_usage_mb >= 1024
                                                    ? `${(data.sync_state.disk_usage_mb / 1024).toFixed(2)} GB`
                                                    : `${data.sync_state.disk_usage_mb.toFixed(2)} MB`}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Files</span>
                                            <span className="font-mono text-gray-900">{data.sync_state.file_count.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Per-Service Sync Status */}
                            {data.sync_state.services && data.sync_state.services.length > 0 && (
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Clock className="w-3 h-3" /> SYNC STATUS BY SERVICE
                                    </h4>
                                    <div className="space-y-3">
                                        {data.sync_state.services.map((service) => (
                                            <div key={service.service_id} className="bg-white p-3 rounded-lg border border-gray-100">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="font-medium text-gray-800">{service.display_name}</span>
                                                    {service.last_error ? (
                                                        <span className="flex items-center gap-1 text-red-500 text-xs">
                                                            <AlertCircle className="w-3.5 h-3.5" />
                                                            Error
                                                        </span>
                                                    ) : service.last_sync ? (
                                                        <span className="flex items-center gap-1 text-green-600 text-xs">
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            OK
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">Never synced</span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-3 gap-2 text-xs">
                                                    <div>
                                                        <span className="text-gray-400">Last sync:</span>
                                                        <span className="ml-1 font-mono text-gray-600">
                                                            {service.last_sync || 'Never'}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-400">Members:</span>
                                                        <span className="ml-1 font-mono text-gray-600">
                                                            {service.member_count}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-400">Messages:</span>
                                                        <span className="ml-1 font-mono text-gray-600">
                                                            {service.message_count.toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>
                                                {service.last_error && (
                                                    <div className="mt-2 text-xs text-red-600 font-mono bg-red-50 p-2 rounded">
                                                        {service.last_error}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Paths */}
                            <div className="bg-gray-50 p-4 rounded-lg">
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <HardDrive className="w-3 h-3" /> PATHS
                                </h4>
                                <div className="space-y-2 text-xs font-mono text-gray-600">
                                    <div>
                                        <span className="text-gray-400">App Data: </span>
                                        <span className="break-all">{data.system.app_data_dir}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Settings: </span>
                                        <span className="break-all">{data.system.settings_path}</span>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Logs: </span>
                                        <span className="break-all">{data.system.logs_dir}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Logs with Tabs */}
                            <div>
                                <div className="flex items-center gap-2 mb-2">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Logs</h4>
                                    <div className="flex gap-1 ml-auto">
                                        <button
                                            onClick={() => setLogTab('recent')}
                                            className={`px-2 py-1 text-xs rounded transition-colors ${
                                                logTab === 'recent' ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                            }`}
                                        >
                                            Recent ({data.logs.recent.length})
                                        </button>
                                        <button
                                            onClick={() => setLogTab('errors')}
                                            className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                                                logTab === 'errors' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                            }`}
                                        >
                                            <AlertCircle className="w-3 h-3" />
                                            Errors ({data.logs.errors.length})
                                        </button>
                                        <button
                                            onClick={() => setLogTab('warnings')}
                                            className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
                                                logTab === 'warnings' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                                            }`}
                                        >
                                            <AlertTriangle className="w-3 h-3" />
                                            Warnings ({data.logs.warnings.length})
                                        </button>
                                    </div>
                                </div>
                                <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 h-48 overflow-y-auto whitespace-pre-wrap">
                                    {getLogsForTab().length > 0 ? (
                                        getLogsForTab().map((line, i) => (
                                            <div
                                                key={i}
                                                className={`${
                                                    line.includes(' - ERROR - ') ? 'text-red-400' :
                                                    line.includes(' - WARNING - ') ? 'text-amber-400' :
                                                    'text-slate-300'
                                                }`}
                                            >
                                                {line}
                                            </div>
                                        ))
                                    ) : (
                                        <span className="text-slate-500">{`No ${logTab} logs found.`}</span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex justify-between shrink-0">
                    <button
                        onClick={fetchDiagnostics}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>

                    <button
                        onClick={handleCopy}
                        disabled={!data}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${copied
                                ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20'
                            }`}
                    >
                        {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'Copied!' : 'Copy JSON'}
                    </button>
                </div>
            </div>
        </div>
    );
}
