import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Mail, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';

interface Letter {
    id: number;
    content: string;
    created_at: string;
    updated_at: string;
    image?: string;
    thumbnail?: string;
}

interface SentLettersModalProps {
    isOpen: boolean;
    onClose: () => void;
    conversationPath: string;
    memberName: string;
    groupId?: string;
}

export const SentLettersModal: React.FC<SentLettersModalProps> = ({
    isOpen,
    onClose,
    conversationPath: _conversationPath,  // Reserved for future use
    memberName,
    groupId,
}) => {
    const [letters, setLetters] = useState<Letter[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedLetter, setSelectedLetter] = useState<Letter | null>(null);

    const fetchLetters = async () => {
        if (!groupId) {
            setError('No group ID available');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/chat/letters/${groupId}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to fetch letters');
            }
            const data = await res.json();
            setLetters(data.letters || []);
        } catch (err: any) {
            setError(err.message || 'Failed to load letters');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen && groupId) {
            fetchLetters();
        }
    }, [isOpen, groupId]);

    // Reset selection when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedLetter(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
    };

    // Full letter view
    if (selectedLetter) {
        return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setSelectedLetter(null)}
                                className="text-white/80 hover:text-white transition-colors"
                            >
                                <ChevronLeft className="w-6 h-6" />
                            </button>
                            <div>
                                <h3 className="text-lg font-bold text-white">To. {memberName}</h3>
                                <p className="text-sm text-white/80">{formatDate(selectedLetter.created_at)}</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                            <X className="w-6 h-6" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 overflow-y-auto flex-1">
                        {/* Letter image if available */}
                        {selectedLetter.image && (
                            <div className="mb-4 rounded-lg overflow-hidden">
                                <img
                                    src={selectedLetter.image}
                                    alt="Letter attachment"
                                    className="w-full h-auto"
                                />
                            </div>
                        )}

                        {/* Letter text */}
                        <div className="bg-[#f8f5f0] rounded-lg p-6 min-h-[200px]">
                            <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                                {selectedLetter.content}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Grid view
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <Mail className="w-5 h-5 text-white" />
                        <h3 className="text-lg font-bold text-white">已发送信件</h3>
                        <span className="text-sm text-white/80">({letters.length})</span>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {loading && (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 text-red-700 p-4 rounded-lg text-center">
                            {error}
                            <button
                                onClick={fetchLetters}
                                className="ml-3 text-red-600 hover:text-red-800 underline"
                            >
                                Retry
                            </button>
                        </div>
                    )}

                    {!loading && !error && letters.length === 0 && (
                        <div className="text-center py-12 text-gray-500">
                            <Mail className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p>まだ手紙を送っていません</p>
                            <p className="text-sm text-gray-400 mt-1">No letters sent yet</p>
                        </div>
                    )}

                    {!loading && !error && letters.length > 0 && (
                        <div className="grid grid-cols-2 gap-4">
                            {letters.map((letter) => (
                                <button
                                    key={letter.id}
                                    onClick={() => setSelectedLetter(letter)}
                                    className="bg-[#f8f5f0] rounded-lg p-4 text-left hover:shadow-md transition-all border border-transparent hover:border-blue-200 group"
                                >
                                    {/* Thumbnail or preview text */}
                                    <div className="aspect-[4/3] mb-3 rounded overflow-hidden bg-white flex items-center justify-center">
                                        {letter.thumbnail || letter.image ? (
                                            <img
                                                src={letter.thumbnail || letter.image}
                                                alt="Letter preview"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="p-2 text-xs text-gray-600 line-clamp-4">
                                                {letter.content}
                                            </div>
                                        )}
                                    </div>

                                    {/* Meta info */}
                                    <div className="text-sm font-medium text-gray-800 group-hover:text-blue-600 transition-colors">
                                        To. {memberName}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {formatDate(letter.created_at)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 shrink-0">
                    <button
                        onClick={fetchLetters}
                        disabled={loading}
                        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                        Refresh
                    </button>
                </div>
            </div>
        </div>
    );
};
