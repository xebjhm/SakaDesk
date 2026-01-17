// frontend/src/features/blogs/components/MemberSelectGrid.tsx
import React, { useState, useMemo } from 'react';
import type { BlogMember } from '../../../types';
import { MEMBER_COLORS, GENERATION_LABELS, getPenlightGlow } from '../../../data/memberColors';

interface MemberSelectGridProps {
    members: BlogMember[];
    loading: boolean;
    error: string | null;
    onBack: () => void;
    onSelectMember: (member: BlogMember) => void;
    onRetry: () => void;
    // New props for favorites (optional until integration complete)
    serviceId?: string;
    favorites?: string[];
    onToggleFavorite?: (memberId: string) => void;
}

type SelectionMode = 'everyone' | 'following';

type Generation = 'all' | '2nd' | '3rd' | '4th' | '5th';

export const MemberSelectGrid: React.FC<MemberSelectGridProps> = ({
    members,
    loading,
    error,
    onBack,
    onSelectMember,
    onRetry,
    serviceId: _serviceId,
    favorites = [],
    onToggleFavorite,
}) => {
    // Suppress unused variable warning - serviceId will be used in future tasks
    void _serviceId;
    const [activeGen, setActiveGen] = useState<Generation>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [hoveredMember, setHoveredMember] = useState<string | null>(null);
    const [selectionMode, setSelectionMode] = useState<SelectionMode>('everyone');

    // Enrich members with generation and color data
    const enrichedMembers = useMemo(() => {
        return members.map(member => {
            const colorData = MEMBER_COLORS.find(
                m => m.nameJp === member.name || m.nameEn === member.name || m.id === member.id
            );
            return {
                ...member,
                generation: colorData?.generation ?? '4th' as const,
                nameJp: colorData?.nameJp ?? member.name,
                nameEn: colorData?.nameEn ?? member.name,
                penlightHex: colorData?.penlightHex ?? ['#7cc7e8', '#7cc7e8'] as [string, string],
            };
        });
    }, [members]);

    // Filter members by generation and search
    const filteredMembers = useMemo(() => {
        return enrichedMembers.filter(member => {
            const matchesGen = activeGen === 'all' || member.generation === activeGen;
            const matchesSearch = searchQuery === '' ||
                member.nameJp.toLowerCase().includes(searchQuery.toLowerCase()) ||
                member.nameEn.toLowerCase().includes(searchQuery.toLowerCase());
            return matchesGen && matchesSearch;
        });
    }, [enrichedMembers, activeGen, searchQuery]);

    // Generation tabs
    const generations: Generation[] = ['all', '2nd', '3rd', '4th', '5th'];

    return (
        <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-slate-50 via-white to-pink-50/20">
            {/* Animated Background Elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full opacity-30 blur-3xl"
                    style={{
                        background: 'radial-gradient(circle, #ff9ccb 0%, transparent 70%)',
                        animation: 'float 15s ease-in-out infinite',
                    }}
                />
                <div
                    className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full opacity-25 blur-3xl"
                    style={{
                        background: 'radial-gradient(circle, #7cc7e8 0%, transparent 70%)',
                        animation: 'float 12s ease-in-out infinite reverse',
                    }}
                />
            </div>

            {/* Header */}
            <div
                className="relative px-6 py-5 shrink-0"
                style={{
                    background: 'rgba(255, 255, 255, 0.8)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    borderBottom: '1px solid rgba(0, 0, 0, 0.05)',
                }}
            >
                <div className="flex items-center gap-4 mb-5">
                    {/* Back Button */}
                    <button
                        onClick={onBack}
                        className="p-2 rounded-xl hover:bg-gray-100/80 transition-all duration-200 group"
                    >
                        <svg
                            className="w-5 h-5 text-gray-500 group-hover:text-gray-700 transition-colors"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>

                    {/* Title */}
                    <div className="flex-1">
                        <h2
                            className="text-2xl font-bold tracking-tight"
                            style={{
                                background: 'linear-gradient(135deg, #333333 0%, #1a1a2e 100%)',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                backgroundClip: 'text',
                            }}
                        >
                            Select Member
                        </h2>
                        <p className="text-xs text-gray-400 tracking-wider mt-0.5">
                            {filteredMembers.length} members
                        </p>
                    </div>

                    {/* Mode Toggle */}
                    <div className="flex items-center gap-1 bg-gray-100/80 rounded-full p-1">
                        <button
                            onClick={() => setSelectionMode('everyone')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                                selectionMode === 'everyone'
                                    ? 'bg-white text-gray-800 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Everyone
                        </button>
                        <button
                            onClick={() => setSelectionMode('following')}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                                selectionMode === 'following'
                                    ? 'bg-white text-gray-800 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700'
                            }`}
                        >
                            Following
                        </button>
                    </div>

                    {/* Search Input */}
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-48 px-4 py-2 pl-10 rounded-full text-sm transition-all duration-300 focus:w-64 focus:outline-none"
                            style={{
                                background: 'rgba(255, 255, 255, 0.8)',
                                border: '1px solid rgba(124, 199, 232, 0.3)',
                                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.05)',
                            }}
                        />
                        <svg
                            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                </div>

                {/* Generation Tabs */}
                <div className="flex gap-2">
                    {generations.map((gen) => {
                        const isActive = activeGen === gen;
                        const label = gen === 'all' ? 'All' : GENERATION_LABELS[gen] ?? gen;
                        return (
                            <button
                                key={gen}
                                onClick={() => setActiveGen(gen)}
                                className={`
                                    relative px-4 py-2 rounded-full text-sm font-medium
                                    transition-all duration-300 overflow-hidden
                                `}
                                style={{
                                    background: isActive
                                        ? 'linear-gradient(135deg, #7cc7e8 0%, #5dc2b5 100%)'
                                        : 'rgba(255, 255, 255, 0.6)',
                                    color: isActive ? 'white' : '#666',
                                    boxShadow: isActive
                                        ? '0 4px 15px rgba(124, 199, 232, 0.4)'
                                        : '0 2px 8px rgba(0, 0, 0, 0.05)',
                                    border: isActive ? 'none' : '1px solid rgba(0, 0, 0, 0.08)',
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content */}
            <div className="relative flex-1 overflow-y-auto p-6">
                {/* Loading */}
                {loading && (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <div className="relative">
                            <div
                                className="w-12 h-12 rounded-full animate-spin"
                                style={{
                                    background: 'conic-gradient(from 0deg, transparent, #ff9ccb)',
                                }}
                            />
                            <div className="absolute inset-1 rounded-full bg-white" />
                        </div>
                        <span className="text-sm text-gray-400 tracking-wide">Loading members...</span>
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <div
                            className="p-4 rounded-2xl"
                            style={{
                                background: 'rgba(255, 99, 99, 0.1)',
                                border: '1px solid rgba(255, 99, 99, 0.2)',
                            }}
                        >
                            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <p className="text-gray-600">{error}</p>
                        <button
                            onClick={onRetry}
                            className="px-6 py-2.5 rounded-full text-white font-medium transition-all duration-300 hover:scale-105"
                            style={{
                                background: 'linear-gradient(135deg, #7cc7e8 0%, #5dc2b5 100%)',
                                boxShadow: '0 4px 15px rgba(124, 199, 232, 0.4)',
                            }}
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Member Grid - Polaroid Style Cards */}
                {!loading && !error && filteredMembers.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-5">
                        {filteredMembers.map((member, index) => {
                            const isHovered = hoveredMember === member.id;
                            const colors = member.penlightHex;
                            const isFavorited = favorites.includes(member.id);

                            return (
                                <button
                                    key={member.id}
                                    onClick={() => onSelectMember(member)}
                                    onMouseEnter={() => setHoveredMember(member.id)}
                                    onMouseLeave={() => setHoveredMember(null)}
                                    className="group flex flex-col items-center animate-fade-in-up"
                                    style={{
                                        animationDelay: `${index * 30}ms`,
                                    }}
                                >
                                    {/* Polaroid Card */}
                                    <div
                                        className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden transition-all duration-500"
                                        style={{
                                            background: 'white',
                                            boxShadow: isHovered
                                                ? `${getPenlightGlow(colors, 0.6)}, 0 20px 40px -10px rgba(0, 0, 0, 0.2)`
                                                : '0 8px 30px -10px rgba(0, 0, 0, 0.15)',
                                            transform: isHovered ? 'translateY(-8px) scale(1.02)' : 'translateY(0) scale(1)',
                                        }}
                                    >
                                        {/* Avatar/Photo Area */}
                                        <div
                                            className="absolute inset-2 inset-b-16 rounded-xl overflow-hidden transition-all duration-500"
                                            style={{
                                                background: `linear-gradient(135deg, ${colors[0]}30, ${colors[1]}30)`,
                                            }}
                                        >
                                            {/* Initials as placeholder */}
                                            <div className="w-full h-full flex items-center justify-center">
                                                <span
                                                    className="text-3xl font-bold transition-all duration-300"
                                                    style={{
                                                        color: isHovered ? colors[0] : '#999',
                                                        textShadow: isHovered ? `0 0 20px ${colors[0]}60` : 'none',
                                                    }}
                                                >
                                                    {member.nameJp.substring(0, 2)}
                                                </span>
                                            </div>

                                            {/* Gradient border on hover */}
                                            <div
                                                className="absolute inset-0 rounded-xl pointer-events-none transition-opacity duration-300"
                                                style={{
                                                    background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
                                                    opacity: isHovered ? 0.2 : 0,
                                                }}
                                            />
                                        </div>

                                        {/* Name Area - Bottom of Polaroid */}
                                        <div className="absolute bottom-0 left-0 right-0 p-3 text-center">
                                            {/* Japanese Name */}
                                            <p
                                                className="text-sm font-bold transition-colors duration-300 leading-tight"
                                                style={{
                                                    color: isHovered ? colors[0] : '#333',
                                                }}
                                            >
                                                {member.nameJp}
                                            </p>
                                            {/* English Name */}
                                            <p className="text-[10px] text-gray-400 mt-0.5 tracking-wide uppercase">
                                                {member.nameEn}
                                            </p>
                                        </div>

                                        {/* Generation Badge - Only in Everyone mode */}
                                        {selectionMode === 'everyone' && (
                                            <div
                                                className="absolute top-3 right-3 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase transition-all duration-300"
                                                style={{
                                                    background: isHovered
                                                        ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`
                                                        : 'rgba(0, 0, 0, 0.05)',
                                                    color: isHovered ? 'white' : '#999',
                                                }}
                                            >
                                                {member.generation}
                                            </div>
                                        )}

                                        {/* Favorite Heart - Only visible in Following mode */}
                                        {selectionMode === 'following' && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onToggleFavorite?.(member.id);
                                                }}
                                                aria-label={isFavorited
                                                    ? `Remove ${member.nameEn} from favorites`
                                                    : `Add ${member.nameEn} to favorites`}
                                                aria-pressed={isFavorited}
                                                className="absolute top-3 right-3 p-1 rounded-full transition-all duration-200 hover:scale-110 z-10"
                                                style={{
                                                    background: isFavorited
                                                        ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`
                                                        : 'rgba(255, 255, 255, 0.9)',
                                                    boxShadow: isFavorited
                                                        ? `0 2px 8px ${colors[0]}40`
                                                        : '0 2px 6px rgba(0, 0, 0, 0.1)',
                                                }}
                                            >
                                                <svg
                                                    className="w-4 h-4"
                                                    fill={isFavorited ? 'white' : 'none'}
                                                    stroke={isFavorited ? 'white' : colors[0]}
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
                                        )}

                                        {/* Penlight Color Indicators */}
                                        <div className="absolute top-3 left-3 flex gap-1">
                                            <div
                                                className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                                                style={{
                                                    background: colors[0],
                                                    boxShadow: isHovered ? `0 0 8px ${colors[0]}` : 'none',
                                                }}
                                            />
                                            <div
                                                className="w-2.5 h-2.5 rounded-full transition-all duration-300"
                                                style={{
                                                    background: colors[1],
                                                    boxShadow: isHovered ? `0 0 8px ${colors[1]}` : 'none',
                                                    border: colors[1] === '#ffffff' ? '1px solid #ddd' : 'none',
                                                }}
                                            />
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Empty State */}
                {!loading && !error && filteredMembers.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-64 gap-4">
                        <div
                            className="p-6 rounded-3xl"
                            style={{
                                background: 'linear-gradient(135deg, rgba(124, 199, 232, 0.1) 0%, rgba(255, 156, 203, 0.1) 100%)',
                                border: '1px solid rgba(124, 199, 232, 0.2)',
                            }}
                        >
                            <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </div>
                        <p className="text-gray-500">
                            {searchQuery ? 'No members match your search' : 'No members found'}
                        </p>
                    </div>
                )}
            </div>

            {/* CSS Animations */}
            <style>{`
                @keyframes float {
                    0%, 100% { transform: translate(0, 0); }
                    50% { transform: translate(-20px, 20px); }
                }
                @keyframes fade-in-up {
                    from {
                        opacity: 0;
                        transform: translateY(15px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                .animate-fade-in-up {
                    animation: fade-in-up 0.4s ease-out forwards;
                    opacity: 0;
                }
            `}</style>
        </div>
    );
};
