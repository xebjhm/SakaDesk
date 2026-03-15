import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Portal } from '../../../core/common/Portal';
import { Z_CLASS } from '../../../constants/zIndex';
import type { BaseModalProps } from '../../../types/modal';
import { getServiceTheme } from '../../../config/serviceThemes';

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

    // Get theme for the active service
    const theme = useMemo(() => getServiceTheme(activeService ?? null), [activeService]);

    // Use the same header style as the chat room
    // 'gradient' = filled gradient background (Hinatazaka, Nogizaka)
    // 'light' = white/light background (Sakurazaka)
    const isLightHeader = theme.messages.headerStyle === 'light';
    const gradientStyle = useMemo(() => {
        const { from, via, to } = theme.messages.headerGradient;
        return `linear-gradient(to right, ${from}, ${via}, ${to})`;
    }, [theme]);

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
                    {/* Close button - dark for light header, white for gradient header */}
                    <button
                        onClick={onClose}
                        className={`absolute top-4 right-4 transition-colors z-10 ${
                            isLightHeader
                                ? 'text-gray-400 hover:text-gray-600'
                                : 'text-white/80 hover:text-white'
                        }`}
                        aria-label="Close"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    {/* Header - gradient or light style based on theme */}
                    <div
                        className="h-32"
                        style={{
                            background: isLightHeader ? theme.surface.background : gradientStyle,
                        }}
                    />
                    {/* Bottom gradient bar for light header style */}
                    {isLightHeader && (
                        <div
                            className="h-1 -mt-1"
                            style={{ background: theme.messages.headerBarGradient }}
                        />
                    )}

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
