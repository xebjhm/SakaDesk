
import { useState, useEffect } from 'react';
import { X, Copy, RefreshCw, Terminal, CheckCircle2, AlertCircle } from 'lucide-react';

interface SystemInfo {
    os: string;
    os_release: string;
    python_version: string;
    app_data_dir: string;
    settings_path: string;
    is_windows: boolean;
}

interface DiagnosticsData {
    system: SystemInfo;
    config_state: Record<string, any>;
    logs: string[];
}

interface DiagnosticsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DiagnosticsModal({ isOpen, onClose }: DiagnosticsModalProps) {
    const [data, setData] = useState<DiagnosticsData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="bg-gray-900 px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <Terminal className="w-5 h-5 text-green-400" />
                        <h3 className="text-lg font-bold text-white">System Diagnostics</h3>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
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
                            {/* System Info Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">OS Environment</h4>
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-gray-900">{data.system.os} {data.system.os_release}</p>
                                        <p className="text-xs text-gray-500">Python {data.system.python_version}</p>
                                        <p className="text-xs text-gray-500 font-mono mt-1 break-all">{data.system.app_data_dir}</p>
                                    </div>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Configuration</h4>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">Configured</span>
                                            {data.config_state.is_configured ?
                                                <CheckCircle2 className="w-4 h-4 text-green-500" /> :
                                                <AlertCircle className="w-4 h-4 text-amber-500" />
                                            }
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600">Output Dir</span>
                                            <span className="text-xs font-mono bg-gray-200 px-2 py-0.5 rounded">
                                                {data.config_state.output_dir_configured ? 'Set' : 'Missing'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Logs Preview */}
                            <div>
                                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recent Logs (Last 50 lines)</h4>
                                <div className="bg-slate-900 rounded-lg p-4 font-mono text-xs text-slate-300 h-64 overflow-y-auto whitespace-pre-wrap">
                                    {data.logs.length > 0 ? data.logs.join('\n') : <span className="text-slate-500">No logs found.</span>}
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
                        {copied ? 'Copied to Clipboard' : 'Copy Report'}
                    </button>
                </div>
            </div>
        </div>
    );
}
