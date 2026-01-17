import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Portal } from '../../../core/common/Portal';
import { Z_CLASS } from '../../../constants/zIndex';
import type { BaseModalProps } from '../../../types/modal';

interface StreakData {
    days: number;
    is_active: boolean;
    start_date?: string;
}

interface MemberProfilePopupProps extends BaseModalProps {
    memberName: string;
    memberAvatar?: string;
    groupId?: string;
    activeService?: string; // Service ID for API calls
}

/**
 * Member profile popup showing avatar, name, and subscription streak.
 * Mimics the official app design with large centered avatar.
 */
export const MemberProfilePopup: React.FC<MemberProfilePopupProps> = ({
    isOpen,
    onClose,
    memberName,
    memberAvatar,
    groupId,
    activeService,
}) => {
    const [streak, setStreak] = useState<StreakData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStreak = useCallback(async () => {
        if (!groupId) return;

        setLoading(true);
        setError(null);

        try {
            const url = activeService
                ? `/api/chat/streak/${groupId}?service=${encodeURIComponent(activeService)}`
                : `/api/chat/streak/${groupId}`;
            const res = await fetch(url);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to fetch streak');
            }
            const data = await res.json();
            setStreak(data);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to load streak';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [groupId, activeService]);

    useEffect(() => {
        if (isOpen && groupId) {
            fetchStreak();
        }
    }, [isOpen, groupId, fetchStreak]);

    // Reset when closed
    useEffect(() => {
        if (!isOpen) {
            setStreak(null);
            setError(null);
        }
    }, [isOpen]);

    // Handle ESC key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // Handle backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <Portal>
            <div
                className={`fixed inset-0 bg-black/40 flex items-center justify-center p-4 ${Z_CLASS.MODAL}`}
                onClick={handleBackdropClick}
                role="dialog"
                aria-modal="true"
                aria-labelledby="profile-title"
            >
                <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden relative">
                    {/* Close button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-10"
                        aria-label="Close"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    {/* Header with gradient - taller to accommodate large avatar */}
                    <div className="bg-gradient-to-r from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] h-32" />

                    {/* Large Avatar - overlapping header and content */}
                    <div className="flex justify-center -mt-24">
                        <div className="w-48 h-48 rounded-full bg-white shadow-xl overflow-hidden border-4 border-white">
                            {memberAvatar ? (
                                <img
                                    src={memberAvatar}
                                    alt={memberName}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-400 text-4xl font-medium bg-gray-100">
                                    {memberName.substring(0, 2)}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="px-6 pt-4 pb-8 text-center">
                        {/* Name */}
                        <h3 id="profile-title" className="text-xl font-bold text-gray-900 mb-6">
                            {memberName}
                        </h3>

                        {/* Streak Display */}
                        {loading ? (
                            <div className="flex items-center justify-center py-4">
                                <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                            </div>
                        ) : error ? (
                            <div className="text-center text-red-600 py-2">
                                <p className="text-sm">{error}</p>
                                <button
                                    onClick={fetchStreak}
                                    className="text-xs text-red-500 hover:underline mt-1"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : streak && streak.days > 0 ? (
                            <p className="text-lg text-gray-700">
                                Subscribed for <span className="font-bold text-2xl text-gray-900">{streak.days}</span> days!
                            </p>
                        ) : (
                            <p className="text-lg text-gray-500">
                                Start your subscription!
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </Portal>
    );
};
