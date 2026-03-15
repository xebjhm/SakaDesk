// frontend/src/features/blogs/components/MemberSelectModal.tsx
import React, { useMemo, useEffect, useRef } from 'react';
import type { BlogMemberWithThumbnail } from '../../../types';
import { getMembers, getMemberPenlightHex, toGroupId } from '../../../data/memberData';
import { getMemberThumbnailUrl } from '../api';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';

interface MemberSelectModalProps {
    isOpen: boolean;
    onClose: () => void;
    members: BlogMemberWithThumbnail[];
    loading: boolean;
    error: string | null;
    onSelectMember: (member: BlogMemberWithThumbnail) => void;
    onRetry: () => void;
    serviceId: string;
}

type GenerationKey = '1st' | '2nd' | '3rd' | '4th' | '5th' | '6th' | '7th' | 'mascot';

interface EnrichedMember extends BlogMemberWithThumbnail {
    nameJp: string;
    generation: GenerationKey;
    penlightColors: [string, string] | null;
    status: 'active' | 'graduated' | 'unknown';
}

// Stable empty array to avoid creating new reference on each render
const EMPTY_FAVORITES: string[] = [];

export const MemberSelectModal: React.FC<MemberSelectModalProps> = ({
    isOpen,
    onClose,
    members,
    loading,
    error,
    onSelectMember,
    onRetry,
    serviceId,
}) => {
    // Get favorites from store - use stable empty array to prevent infinite loops
    const favorites = useAppStore((state) => state.favorites[serviceId] || EMPTY_FAVORITES);
    const toggleFavorite = useAppStore((state) => state.toggleFavorite);
    const { t } = useTranslation();

    // Use ref to track latest onClose callback without triggering effect re-runs
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onCloseRef.current();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Enrich members with generation and name data using service-specific member data
    const enrichedMembers = useMemo(() => {
        // Map serviceId to GroupId for member data lookup (single source of truth)
        const groupId = toGroupId(serviceId);
        const memberDataList = getMembers(groupId);

        // Build lookup map by blogId and name for efficient matching
        const memberDataMap = new Map<string, typeof memberDataList[0]>();
        memberDataList.forEach(m => {
            memberDataMap.set(m.blogId, m);
            memberDataMap.set(m.nameKanji, m);
            // Also try without spaces for name matching
            memberDataMap.set(m.nameKanji.replace(/\s+/g, ''), m);
        });

        return members.map(member => {
            // Find member data by ID or name
            const memberData = memberDataMap.get(member.id)
                || memberDataMap.get(member.name)
                || memberDataMap.get(member.name.replace(/\s+/g, ''));

            // Treat mascot (ポカ, id=000) specially
            const isMascot = member.id === '000' || member.name === 'ポカ';

            // Get penlight colors if member data found
            let penlightColors: [string, string] | null = null;
            if (memberData) {
                penlightColors = getMemberPenlightHex(memberData, groupId);
            }

            // Map numeric generation to string key
            const genNumber = memberData?.generation ?? 2;
            const genKey = `${genNumber}${genNumber === 1 ? 'st' : genNumber === 2 ? 'nd' : genNumber === 3 ? 'rd' : 'th'}` as GenerationKey;

            // Ensure status is a valid type
            const rawStatus = memberData?.status ?? 'unknown';
            const status: 'active' | 'graduated' | 'unknown' =
                rawStatus === 'active' || rawStatus === 'graduated' ? rawStatus : 'unknown';

            return {
                ...member,
                nameJp: memberData?.nameKanji ?? member.name,
                generation: isMascot ? 'mascot' as GenerationKey : genKey,
                penlightColors,
                status,
            };
        });
    }, [members, serviceId]);

    // Filter out graduated members
    const filteredMembers = useMemo(() => {
        return enrichedMembers.filter(member => member.status !== 'graduated');
    }, [enrichedMembers]);

    // Group members by generation
    const membersByGeneration = useMemo(() => {
        const groups: Record<GenerationKey, EnrichedMember[]> = {
            '1st': [],
            '2nd': [],
            '3rd': [],
            '4th': [],
            '5th': [],
            '6th': [],
            '7th': [],
            'mascot': [],
        };
        filteredMembers.forEach(member => {
            // Only push if generation key exists in groups
            if (member.generation in groups) {
                groups[member.generation].push(member);
            }
        });
        return groups;
    }, [filteredMembers]);

    // Generation order (mascot at the end)
    const generationOrder: GenerationKey[] = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', 'mascot'];

    // Generation labels with i18n support
    const extendedLabels: Record<GenerationKey, string> = {
        '1st': t('generations.1st'),
        '2nd': t('generations.2nd'),
        '3rd': t('generations.3rd'),
        '4th': t('generations.4th'),
        '5th': t('generations.5th'),
        '6th': t('generations.6th'),
        '7th': t('generations.7th'),
        'mascot': t('blogs.mascot'),
    };

    // Calculate max columns needed across all generations for modal sizing
    // This determines the modal width and the threshold for single-row display
    const maxCols = useMemo(() => {
        const counts = Object.values(membersByGeneration).map(m => m.length);
        // Max columns = ceil(largest_count / 2) to ensure 2 rows max
        const maxNeeded = Math.max(...counts.map(c => Math.ceil(c / 2)), 4);
        return maxNeeded;
    }, [membersByGeneration]);

    // Calculate grid columns for a generation (1-2 rows max)
    // Small groups show in single row, larger groups expand to 2 rows
    // Threshold is dynamic based on maxCols (largest gen's 2-row column count)
    const getGridCols = (memberCount: number): number => {
        if (memberCount <= maxCols) return memberCount; // Single row
        // For larger counts, use 2 rows with ceiling division
        return Math.ceil(memberCount / 2);
    };

    // Calculate modal width based on max columns
    // Each avatar: 80px (w-20) + gap: 24px (gap-6) = 104px per column
    // Plus padding: 48px (p-6 * 2)
    const modalWidth = useMemo(() => {
        const colWidth = 100; // minmax(0, 100px)
        const gap = 24; // gap-6
        const padding = 48; // p-6 * 2
        const width = maxCols * colWidth + (maxCols - 1) * gap + padding;
        return Math.min(Math.max(width, 400), 1200); // Clamp between 400-1200px
    }, [maxCols]);

    // Format name with space between family and given name (Japanese style)
    const formatName = (name: string): string => {
        // Japanese names are typically 2-4 characters for family name + given name
        // Common patterns: 2+2, 2+3, 3+2, 3+3
        if (name.length === 4) return `${name.slice(0, 2)} ${name.slice(2)}`;
        if (name.length === 5) return `${name.slice(0, 2)} ${name.slice(2)}`; // Assume 2+3
        if (name.length === 6) return `${name.slice(0, 3)} ${name.slice(3)}`; // Assume 3+3
        // For other lengths, try to split reasonably
        if (name.length >= 3) {
            const mid = Math.ceil(name.length / 2);
            return `${name.slice(0, mid)} ${name.slice(mid)}`;
        }
        return name;
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

            {/* Modal */}
            <div
                className="relative w-full max-h-[85vh] mx-4 rounded-3xl overflow-hidden flex flex-col animate-modal-in"
                style={{
                    maxWidth: `${modalWidth}px`,
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 pt-4">
                    {/* Loading */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center h-48 gap-4">
                            <div className="relative">
                                <div
                                    className="w-10 h-10 rounded-full animate-spin"
                                    style={{
                                        background: 'conic-gradient(from 0deg, transparent, #ff9ccb)',
                                    }}
                                />
                                <div className="absolute inset-1 rounded-full bg-white" />
                            </div>
                            <span className="text-sm text-gray-400 tracking-wide">{t('blogs.loadingMembers')}</span>
                        </div>
                    )}

                    {/* Error */}
                    {error && !loading && (
                        <div className="flex flex-col items-center justify-center h-48 gap-4">
                            <div
                                className="p-4 rounded-2xl"
                                style={{
                                    background: 'rgba(255, 99, 99, 0.1)',
                                    border: '1px solid rgba(255, 99, 99, 0.2)',
                                }}
                            >
                                <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-sm text-gray-600">{error}</p>
                            <button
                                onClick={onRetry}
                                className="px-4 py-2 rounded-full text-white text-sm font-medium transition-all duration-300 hover:scale-105 bg-theme-gradient"
                            >
                                {t('blogs.retry')}
                            </button>
                        </div>
                    )}

                    {/* Member Grid - Grouped by Generation */}
                    {!loading && !error && filteredMembers.length > 0 && (
                        <div className="space-y-6">
                            {generationOrder.map(gen => {
                                const genMembers = membersByGeneration[gen];
                                if (genMembers.length === 0) return null;

                                const gridCols = getGridCols(genMembers.length);

                                return (
                                    <div key={gen} className="space-y-3">
                                        {/* Generation Label */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                                {extendedLabels[gen]}
                                            </span>
                                            <div className="flex-1 h-px bg-gray-200" />
                                        </div>

                                        {/* Members Grid - Official site style */}
                                        <div
                                            className="grid gap-6 justify-center"
                                            style={{
                                                gridTemplateColumns: `repeat(${gridCols}, minmax(0, 100px))`,
                                            }}
                                        >
                                            {genMembers.map((member) => {
                                                const isFavorited = favorites.includes(member.id);
                                                // Special case for ポカ (mascot) - use CDN URL directly
                                                const isMascot = member.id === '000' || member.name === 'ポカ';
                                                const thumbnailUrl = isMascot
                                                    ? 'https://cdn.hinatazaka46.com/images/14/98b/e96b48f630edc3119806a1b40bc10/400_320_102400.jpg'
                                                    : member.thumbnail
                                                        ? getMemberThumbnailUrl(serviceId, member.id)
                                                        : null;

                                                return (
                                                    <div
                                                        key={member.id}
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => onSelectMember(member)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                onSelectMember(member);
                                                            }
                                                        }}
                                                        className="group flex flex-col items-center gap-3 cursor-pointer"
                                                    >
                                                        {/* Avatar - Official site style: clean circle, face centered */}
                                                        <div className="relative group/avatar">
                                                            <div
                                                                className="w-20 h-20 rounded-full overflow-hidden transition-transform duration-200 group-hover:scale-105 bg-gradient-to-b from-sky-50 to-sky-100"
                                                            >
                                                                {thumbnailUrl ? (
                                                                    <img
                                                                        src={thumbnailUrl}
                                                                        alt={member.nameJp}
                                                                        className="w-full h-full object-cover"
                                                                        style={{
                                                                            objectPosition: 'center 0%',
                                                                            transform: 'scale(1.15)',
                                                                        }}
                                                                        loading="lazy"
                                                                    />
                                                                ) : (
                                                                    <div className="w-full h-full flex items-center justify-center">
                                                                        <span className="text-lg font-medium text-sky-400">
                                                                            {member.nameJp.substring(0, 1)}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Favorite Heart - positioned at bottom right */}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleFavorite(serviceId, member.id);
                                                                }}
                                                                aria-label={isFavorited
                                                                    ? `${member.nameJp}をお気に入りから削除`
                                                                    : `${member.nameJp}をお気に入りに追加`}
                                                                aria-pressed={isFavorited}
                                                                className="absolute bottom-0 right-0 p-1.5 rounded-full transition-all duration-200 hover:scale-110 z-10"
                                                                style={{
                                                                    background: isFavorited
                                                                        ? '#ff69b4'
                                                                        : 'rgba(255, 255, 255, 0.95)',
                                                                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
                                                                }}
                                                            >
                                                                <svg
                                                                    className="w-3.5 h-3.5"
                                                                    fill={isFavorited ? 'white' : 'none'}
                                                                    stroke={isFavorited ? 'white' : '#ff69b4'}
                                                                    strokeWidth={2}
                                                                    viewBox="0 0 24 24"
                                                                >
                                                                    <path
                                                                        strokeLinecap="round"
                                                                        strokeLinejoin="round"
                                                                        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                                                                    />
                                                                </svg>
                                                            </button>
                                                        </div>

                                                        {/* Name - with space like official site */}
                                                        <p
                                                            className="text-sm text-center leading-tight transition-colors duration-200 text-gray-600 group-hover:text-sky-600"
                                                            style={{ letterSpacing: '0.05em' }}
                                                        >
                                                            {formatName(member.nameJp)}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Empty State */}
                    {!loading && !error && filteredMembers.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-48 gap-4">
                            <div
                                className="p-5 rounded-2xl"
                                style={{
                                    background: 'linear-gradient(135deg, rgba(124, 199, 232, 0.1) 0%, rgba(255, 156, 203, 0.1) 100%)',
                                }}
                            >
                                <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                            <p className="text-sm text-gray-500">
                                {t('blogs.noMembersFound')}
                            </p>
                        </div>
                    )}
                </div>

                {/* Close hint */}
                <div className="px-6 py-2 text-center">
                    <span className="text-xs text-gray-400">{t('blogs.tapOutsideToClose')}</span>
                </div>
            </div>

            {/* CSS Animations */}
            <style>{`
                @keyframes modal-in {
                    from {
                        opacity: 0;
                        transform: scale(0.95) translateY(10px);
                    }
                    to {
                        opacity: 1;
                        transform: scale(1) translateY(0);
                    }
                }
                .animate-modal-in {
                    animation: modal-in 0.2s ease-out forwards;
                }
            `}</style>
        </div>
    );
};
