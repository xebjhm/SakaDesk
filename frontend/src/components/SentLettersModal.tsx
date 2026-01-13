import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Mail, ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { BaseModal, DetailModal, SafeImage, ModalLoadingState, ModalErrorState, ModalEmptyState } from './common';
import type { BaseModalProps } from '../types/modal';

interface Letter {
    id: number;
    content: string;
    created_at: string;
    updated_at: string;
    image?: string;
    thumbnail?: string;
}

interface SentLettersModalProps extends BaseModalProps {
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
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);

    const fetchLetters = useCallback(async () => {
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
            // Sort letters by created_at in reverse order (newest first)
            const sortedLetters = (data.letters || []).sort((a: Letter, b: Letter) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            setLetters(sortedLetters);
        } catch (err: any) {
            setError(err.message || 'Failed to load letters');
        } finally {
            setLoading(false);
        }
    }, [groupId]);

    useEffect(() => {
        if (isOpen && groupId) {
            fetchLetters();
        }
    }, [isOpen, groupId, fetchLetters]);

    // Reset selection when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedLetter(null);
            setZoomedImage(null);
        }
    }, [isOpen]);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return `${date.getFullYear()}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}`;
    };

    // Full-screen image zoom view
    const renderZoomedImage = () => {
        if (!zoomedImage) return null;

        return (
            <DetailModal
                isOpen={!!zoomedImage}
                onClose={() => setZoomedImage(null)}
                footer="Tap anywhere to close"
            >
                <img
                    src={zoomedImage}
                    alt="Letter full view"
                    className="max-w-full max-h-[85vh] object-contain"
                />
            </DetailModal>
        );
    };

    // Detail view for selected letter
    const renderDetailView = () => {
        if (!selectedLetter) return null;

        return (
            <DetailModal
                isOpen={!!selectedLetter}
                onClose={() => setSelectedLetter(null)}
                title={`To. ${memberName}`}
                subtitle={formatDate(selectedLetter.created_at)}
                backButton={
                    <button
                        onClick={() => setSelectedLetter(null)}
                        className="text-white/80 hover:text-white transition-colors"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                }
                onCloseAll={onClose}
            >
                {/* Letter image if available - clickable for zoom */}
                {selectedLetter.image && (
                    <button
                        onClick={() => setZoomedImage(selectedLetter.image!)}
                        className="mb-4 rounded-lg overflow-hidden block w-full cursor-zoom-in hover:opacity-90 transition-opacity"
                    >
                        <SafeImage
                            src={selectedLetter.image}
                            alt="Letter attachment"
                            className="w-full h-auto max-h-[400px] object-contain"
                        />
                    </button>
                )}

                {/* Letter text */}
                <div className="bg-[#f8f5f0] rounded-lg p-6 min-h-[200px]">
                    <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                        {selectedLetter.content || (
                            <span className="text-gray-400 italic">No text content</span>
                        )}
                    </p>
                </div>
            </DetailModal>
        );
    };

    // Render content based on state
    const renderContent = () => {
        if (loading) {
            return <ModalLoadingState />;
        }

        if (error) {
            return <ModalErrorState error={error} onRetry={fetchLetters} />;
        }

        if (letters.length === 0) {
            return <ModalEmptyState icon={Mail} message="No letters sent yet" />;
        }

        return (
            <div className="grid grid-cols-2 gap-4">
                {letters.map((letter) => (
                    <button
                        key={letter.id}
                        onClick={() => setSelectedLetter(letter)}
                        className="bg-[#f8f5f0] rounded-lg p-3 text-left hover:shadow-md transition-all border border-transparent hover:border-blue-200 group"
                    >
                        {/* Thumbnail or preview text - taller aspect ratio to show full letter */}
                        <div className="aspect-[3/4] mb-3 rounded overflow-hidden bg-white flex items-center justify-center">
                            {letter.thumbnail || letter.image ? (
                                <SafeImage
                                    src={letter.thumbnail || letter.image || ''}
                                    alt="Letter preview"
                                    className="w-full h-full object-contain"
                                    fallbackText={letter.content}
                                />
                            ) : (
                                <div className="p-2 text-xs text-gray-600 line-clamp-6">
                                    {letter.content || 'No content'}
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
        );
    };

    return (
        <>
            <BaseModal
                isOpen={isOpen}
                onClose={onClose}
                title="Sent Letters"
                icon={Mail}
                footer={
                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-100">
                        <button
                            onClick={fetchLetters}
                            disabled={loading}
                            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                            Refresh
                        </button>
                    </div>
                }
            >
                <div className="p-6">
                    {renderContent()}
                </div>
            </BaseModal>

            {renderDetailView()}
            {renderZoomedImage()}
        </>
    );
};
