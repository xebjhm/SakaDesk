import { useState, useEffect } from 'react';
import { X, Copy, RefreshCw, Terminal, CheckCircle2, AlertCircle, Database, HardDrive, Clock, AlertTriangle } from 'lucide-react';

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

interface SyncState {
    last_sync?: string;
    last_error?: string;
    disk_usage_mb: number;
    file_count: number;
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
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">System</h4>
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

                                {/* Auth Status */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Authentication</h4>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-500">Token</span>
                                            {data.auth_status.has_token ?
                                                <span className="flex items-center gap-1 text-green-600">
                                                    <CheckCircle2 className="w-4 h-4" /> Valid
                                                </span> :
                                                <span className="flex items-center gap-1 text-red-600">
                                                    <AlertCircle className="w-4 h-4" /> Missing
                                                </span>
                                            }
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Expires</span>
                                            <span className={`font-mono ${
                                                data.auth_status.token_expiry_seconds && data.auth_status.token_expiry_seconds < 300
                                                    ? 'text-amber-600' : 'text-gray-900'
                                            }`}>
                                                {data.auth_status.token_expires_in || 'N/A'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Groups</span>
                                            <span className="font-mono text-gray-900">
                                                {data.auth_status.groups_configured.join(', ') || 'None'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Config & Sync Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                {/* Config State */}
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Configuration</h4>
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
                                        <Database className="w-3 h-3" /> Disk Usage
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

                            {/* Sync Status */}
                            {(data.sync_state.last_sync || data.sync_state.last_error) && (
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                        <Clock className="w-3 h-3" /> Last Sync
                                    </h4>
                                    <div className="space-y-2 text-sm">
                                        {data.sync_state.last_sync && (
                                            <p className="text-gray-600 font-mono text-xs">{data.sync_state.last_sync}</p>
                                        )}
                                        {data.sync_state.last_error && (
                                            <p className="text-red-600 font-mono text-xs">{data.sync_state.last_error}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Paths */}
                            <div className="bg-gray-50 p-4 rounded-lg">
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <HardDrive className="w-3 h-3" /> Paths
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
                                        <span className="text-slate-500">No {logTab} logs found.</span>
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
