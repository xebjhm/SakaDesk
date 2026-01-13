import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Calendar } from 'lucide-react';

interface StreakData {
    days: number;
    is_active: boolean;
    start_date?: string;
}

interface MemberProfilePopupProps {
    isOpen: boolean;
    onClose: () => void;
    memberName: string;
    memberAvatar?: string;
    groupId?: string;
}

export const MemberProfilePopup: React.FC<MemberProfilePopupProps> = ({
    isOpen,
    onClose,
    memberName,
    memberAvatar,
    groupId,
}) => {
    const [streak, setStreak] = useState<StreakData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchStreak = async () => {
        if (!groupId) return;

        setLoading(true);
        setError(null);

        try {
            const res = await fetch(`/api/chat/streak/${groupId}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || 'Failed to fetch streak');
            }
            const data = await res.json();
            setStreak(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load streak');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen && groupId) {
            fetchStreak();
        }
    }, [isOpen, groupId]);

    // Reset when closed
    useEffect(() => {
        if (!isOpen) {
            setStreak(null);
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const getStreakText = () => {
        if (!streak || streak.days === 0) {
            return '購読を開始しましょう';
        }
        // Format like the official app: "閲 X 天后!"
        // But with adjusted text as user requested
        return `連続 ${streak.days} 日間購読中!`;
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden">
                {/* Close button */}
                <div className="absolute top-4 right-4 z-10">
                    <button
                        onClick={onClose}
                        className="p-2 bg-black/20 hover:bg-black/40 rounded-full text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Header with gradient */}
                <div className="bg-gradient-to-b from-[#a8c4e8] via-[#a0a9d8] to-[#9181c4] pt-8 pb-12 px-6 relative">
                    {/* Avatar */}
                    <div className="flex justify-center">
                        <div className="w-24 h-24 rounded-full bg-white shadow-lg overflow-hidden border-4 border-white">
                            {memberAvatar ? (
                                <img
                                    src={memberAvatar}
                                    alt={memberName}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-500 text-2xl font-medium bg-gray-100">
                                    {memberName.substring(0, 2)}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Content */}
                <div className="px-6 pb-6 -mt-4 relative">
                    {/* Name */}
                    <div className="text-center mb-4">
                        <h3 className="text-xl font-bold text-gray-900">{memberName}</h3>
                    </div>

                    {/* Streak Card */}
                    <div className="bg-gradient-to-r from-[#FEF3C7] to-[#FDE68A] rounded-xl p-4 shadow-sm">
                        {loading ? (
                            <div className="flex items-center justify-center py-4">
                                <RefreshCw className="w-6 h-6 text-amber-600 animate-spin" />
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
                        ) : (
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
                                    <Calendar className="w-6 h-6 text-white" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-lg font-bold text-amber-800">
                                        {getStreakText()}
                                    </p>
                                    {streak && streak.days > 0 && (
                                        <p className="text-sm text-amber-600">
                                            Keep it up! 🔥
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 pb-6">
                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors"
                    >
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    );
};
