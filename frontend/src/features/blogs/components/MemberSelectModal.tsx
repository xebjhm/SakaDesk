// frontend/src/features/blogs/components/MemberSelectModal.tsx
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Heart, Users } from 'lucide-react';
import type { BlogMemberWithThumbnail } from '../../../types';
import { getMembers, toGroupId } from '../../../data/memberData';
import { getMemberThumbnailUrl } from '../api';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { useAppStore } from '../../../store/appStore';
import { useTranslation } from '../../../i18n';
import { Modal } from '../../../design/primitives';
import { DialogStatus } from '../../../core/common/DialogStatus';
import { cn } from '../../../utils/classnames';
import { clientLog } from '../../../utils/clientLog';
import { isMascot, MASCOT_THUMBNAIL_URL } from '../mascot';

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
    status: 'active' | 'graduated' | 'unknown';
}

// Stable empty array to avoid creating new reference on each render
const EMPTY_FAVORITES: string[] = [];

/**
 * Member avatar circle: a neutral pulsing placeholder while the thumbnail
 * loads; a missing or failed thumbnail shows the name's first character.
 */
export const MemberThumb: React.FC<{ url: string | null; initial: string }> = ({ url, initial }) => (
    // Keyed on url so loaded/failed state never leaks to a different thumbnail.
    <MemberThumbInner key={url ?? ''} url={url} initial={initial} />
);

const MemberThumbInner: React.FC<{ url: string | null; initial: string }> = ({ url, initial }) => {
    const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
    if (!url || state === 'failed') {
        return (
            <span aria-hidden="true" lang="ja" className="flex h-full w-full items-center justify-center text-title font-semibold text-accent-strong">
                {initial}
            </span>
        );
    }
    // The image stays laid out (opacity-0) while loading: a display:none lazy
    // image never intersects the viewport, so it would never load.
    return (
        <span className="relative block h-full w-full">
            {state === 'loading' && (
                <span data-testid="thumb-skeleton" aria-hidden="true" className="absolute inset-0 animate-pulse bg-sunken motion-reduce:animate-none" />
            )}
            <img
                src={url}
                alt=""
                loading="lazy"
                onLoad={() => setState('loaded')}
                onError={() => {
                    setState('failed');
                    clientLog('avatar_fallback', { surface: 'member_select' });
                }}
                className={cn('h-full w-full scale-[1.15] object-cover object-top', state === 'loading' && 'opacity-0')}
            />
        </span>
    );
};

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
    // Drawn at 80 CSS px, scaled 1.15x by MemberThumb.
    const thumbWidth = useAvatarWidth(92);

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
                generation: isMascot(member) ? 'mascot' as GenerationKey : genKey,
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

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('blogs.selectMember')}
            closeLabel={t('common.close')}
            logId="member_select"
            className="max-h-[85vh] w-auto max-w-full"
        >
            <div className="mx-auto max-w-full" style={{ width: modalWidth - 48 }}>
            {loading && <DialogStatus kind="loading" title={t('blogs.loadingMembers')} />}
            {error && !loading && (
                <DialogStatus kind="error" icon={<AlertTriangle />} title={error} onRetry={onRetry} retryLabel={t('blogs.retry')} retryVariant="primary" />
            )}
            {!loading && !error && filteredMembers.length === 0 && (
                <DialogStatus kind="empty" icon={<Users />} title={t('blogs.noMembersFound')} />
            )}
            {!loading && !error && filteredMembers.length > 0 && (
                <div className="flex flex-col gap-6">
                    {generationOrder.map((gen) => {
                        const genMembers = membersByGeneration[gen];
                        if (genMembers.length === 0) return null;
                        return (
                            <section key={gen} className="flex flex-col gap-3">
                                <h3 className="text-caption font-semibold uppercase tracking-wider text-muted">{extendedLabels[gen]}</h3>
                                <div
                                    className="grid justify-center gap-6"
                                    style={{ gridTemplateColumns: `repeat(${getGridCols(genMembers.length)}, minmax(0, 100px))` }}
                                >
                                    {genMembers.map((member) => {
                                        const isFavorited = favorites.includes(member.id);
                                        const thumbnailUrl = isMascot(member)
                                            ? MASCOT_THUMBNAIL_URL
                                            : member.thumbnail ? getMemberThumbnailUrl(serviceId, member.id, thumbWidth) : null;
                                        return (
                                            <div key={member.id} className="relative flex flex-col items-center">
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectMember(member)}
                                                    className="group flex flex-col items-center gap-3 rounded-card p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                                >
                                                    <span className="block h-20 w-20 overflow-hidden rounded-pill bg-accent-subtle transition duration-base ease-standard group-hover:scale-105 group-hover:shadow-accent-glow motion-reduce:transform-none">
                                                        <MemberThumb url={thumbnailUrl} initial={Array.from(member.nameJp)[0] ?? ''} />
                                                    </span>
                                                    <span lang="ja" className="text-center text-small tracking-wide text-secondary transition-colors duration-fast ease-standard group-hover:text-accent-strong">
                                                        {formatName(member.nameJp)}
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleFavorite(serviceId, member.id)}
                                                    aria-label={isFavorited
                                                        ? t('blogs.removeFavorite', { name: formatName(member.nameJp) })
                                                        : t('blogs.addFavorite', { name: formatName(member.nameJp) })}
                                                    aria-pressed={isFavorited}
                                                    className={cn('absolute right-3 top-16 flex rounded-pill p-1 shadow-pill transition-transform duration-fast ease-standard hover:scale-110 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', isFavorited ? 'bg-semantic-oshi-solid' : 'bg-pill')}
                                                >
                                                    <Heart className={cn('h-4 w-4', isFavorited ? 'fill-current text-inverse' : 'text-semantic-oshi-solid')} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}
            </div>
        </Modal>
    );
};
