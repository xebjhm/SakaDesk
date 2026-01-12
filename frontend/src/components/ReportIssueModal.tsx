import { useState } from 'react';
import { X, Bug, RefreshCw, ExternalLink, Database, Play, LogIn, HelpCircle } from 'lucide-react';

type BugCategory = 'sync_data' | 'playback' | 'login' | 'other';

interface ReportIssueModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentMemberPath?: string;
    currentMessageId?: number;
    currentScreen?: string;
    crashError?: string;
}

const CATEGORIES: { id: BugCategory; label: string; help: string; icon: typeof Bug }[] = [
    { id: 'sync_data', label: 'Sync / Data', help: 'Missing or wrong messages', icon: Database },
    { id: 'playback', label: 'Playback', help: 'Audio/video won\'t play', icon: Play },
    { id: 'login', label: 'Login', help: 'Can\'t sign in or expired', icon: LogIn },
    { id: 'other', label: 'Other', help: 'Something else broke', icon: HelpCircle },
];

export function ReportIssueModal({
    isOpen,
    onClose,
    currentMemberPath,
    currentMessageId,
    currentScreen,
    crashError,
}: ReportIssueModalProps) {
    const [category, setCategory] = useState<BugCategory | null>(crashError ? 'other' : null);
    const [whatDoing, setWhatDoing] = useState('');
    const [whatWrong, setWhatWrong] = useState(crashError || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!category) return;

        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams({
                what_doing: whatDoing,
                what_wrong: whatWrong,
            });

            const res = await fetch(`/api/report?${params}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category,
                    member_path: currentMemberPath,
                    message_id: currentMessageId,
                    current_screen: currentScreen,
                    error_message: crashError,
                }),
            });

            if (!res.ok) throw new Error('Failed to generate report');

            const data = await res.json();

            // Open GitHub in new tab
            window.open(data.github_url, '_blank');
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setCategory(null);
        setWhatDoing('');
        setWhatWrong(crashError || '');
        setError(null);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-lg w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gray-900 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Bug className="w-5 h-5 text-amber-400" />
                        <h3 className="text-lg font-bold text-white">Report an Issue</h3>
                    </div>
                    <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-5">
                    {/* Category Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-3">
                            What type of issue?
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            {CATEGORIES.map((cat) => {
                                const Icon = cat.icon;
                                const isSelected = category === cat.id;
                                return (
                                    <button
                                        key={cat.id}
                                        onClick={() => setCategory(cat.id)}
                                        className={`p-4 rounded-lg border-2 text-left transition-all ${
                                            isSelected
                                                ? 'border-blue-500 bg-blue-50'
                                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-600' : 'text-gray-500'}`} />
                                            <span className={`font-medium ${isSelected ? 'text-blue-700' : 'text-gray-900'}`}>
                                                {cat.label}
                                            </span>
                                        </div>
                                        <p className="text-xs text-gray-500">{cat.help}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Description Fields */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                What were you doing?
                            </label>
                            <input
                                type="text"
                                value={whatDoing}
                                onChange={(e) => setWhatDoing(e.target.value)}
                                placeholder="e.g., Playing a voice message"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                What went wrong?
                            </label>
                            <input
                                type="text"
                                value={whatWrong}
                                onChange={(e) => setWhatWrong(e.target.value)}
                                placeholder="e.g., Audio stops after 5 seconds"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                        </div>
                    </div>

                    {/* Context Info */}
                    {(currentMemberPath || crashError) && (
                        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
                            <p className="font-medium text-gray-700 mb-1">Auto-detected context:</p>
                            {currentMemberPath && <p>Member: {currentMemberPath}</p>}
                            {crashError && <p className="text-red-600">Error: {crashError.slice(0, 100)}...</p>}
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                    <button
                        onClick={handleClose}
                        className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!category || loading}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                            !category || loading
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20'
                        }`}
                    >
                        {loading ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Generating...
                            </>
                        ) : (
                            <>
                                <ExternalLink className="w-4 h-4" />
                                Create GitHub Issue
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
