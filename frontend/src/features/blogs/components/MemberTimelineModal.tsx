// frontend/src/features/blogs/components/MemberTimelineModal.tsx
import React, { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Image, Image as ImageIcon, Newspaper } from 'lucide-react';
import type { BlogMember, BlogMeta } from '../../../types';
import { getMemberNameKanji } from '../../../data/memberData';
import { cn, formatMonthYear, formatShortDate } from '../../../utils/classnames';
import { Modal, Card, Button } from '../../../design/primitives';
import { DialogStatus } from '../../../core/common/DialogStatus';
import { useTranslation } from '../../../i18n';
import { clientLog } from '../../../utils/clientLog';

interface MemberTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    member: BlogMember;
    blogs: BlogMeta[];
    loading: boolean;
    error: string | null;
    onSelectBlog: (blog: BlogMeta) => void;
    onRetry: () => void;
    onOpenPhotoGallery?: () => void;
}

interface MonthGroup {
    year: number;
    month: number;
    blogs: BlogMeta[];
}

export const MemberTimelineModal: React.FC<MemberTimelineModalProps> = ({
    isOpen,
    onClose,
    member,
    blogs,
    loading,
    error,
    onSelectBlog,
    onRetry,
    onOpenPhotoGallery,
}) => {
    const { t } = useTranslation();
    // Get kanji-only name using centralized helper
    const memberNameJp = getMemberNameKanji(member.name);

    // Group blogs by year-month
    const monthGroups = useMemo(() => {
        const groups = new Map<string, MonthGroup>();

        for (const blog of blogs) {
            const date = new Date(blog.published_at);
            const year = date.getFullYear();
            const month = date.getMonth() + 1;
            const key = `${year}-${month}`;

            if (!groups.has(key)) {
                groups.set(key, { year, month, blogs: [] });
            }
            groups.get(key)!.blogs.push(blog);
        }

        // Sort by date descending (newest first)
        return Array.from(groups.values()).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });
    }, [blogs]);

    // Determine which months to expand by default (last 3 months)
    const expandedMonths = useMemo(() => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const expandedSet = new Set<string>();

        // Calculate last 3 months
        for (let i = 0; i < 3; i++) {
            let year = currentYear;
            let month = currentMonth - i;
            if (month <= 0) {
                month += 12;
                year -= 1;
            }
            expandedSet.add(`${year}-${month}`);
        }

        return expandedSet;
    }, []);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={<span lang="ja">{memberNameJp}</span>}
            closeLabel={t('common.close')}
            header="plain"
            titleClassName="text-accent-strong"
            logId="member_timeline"
            className="max-h-[85vh] max-w-3xl"
            bodyClassName="px-4 pb-4"
            headerExtra={
                <>
                    {onOpenPhotoGallery && (
                        <Button variant="ghost" size="sm" className="rounded-pill bg-accent-wash text-accent-strong hover:bg-accent-subtle hover:text-accent-strong" onClick={onOpenPhotoGallery} title={t('blogGallery.button')}>
                            <Image className="h-4 w-4" />
                            {t('blogGallery.button')}
                        </Button>
                    )}
                    {blogs.length > 0 && <span className="text-small text-muted">{t('blogs.post', { count: blogs.length })}</span>}
                </>
            }
        >
            {loading && <DialogStatus kind="loading" title={t('blogs.loadingTimeline')} />}
            {error && !loading && <DialogStatus kind="error" icon={<AlertTriangle />} title={error} onRetry={onRetry} retryLabel={t('blogs.retry')} retryVariant="primary" />}
            {!loading && !error && monthGroups.length > 0 && (
                <div className="flex flex-col gap-3">
                    {monthGroups.map((group, index) => (
                        <TimelineMonthSection
                            key={`${group.year}-${group.month}`}
                            year={group.year}
                            month={group.month}
                            blogs={group.blogs}
                            defaultExpanded={expandedMonths.has(`${group.year}-${group.month}`)}
                            onSelectBlog={onSelectBlog}
                            animationDelay={index * 50}
                        />
                    ))}
                </div>
            )}
            {!loading && !error && blogs.length === 0 && <DialogStatus kind="empty" icon={<Newspaper />} title={t('blogs.noBlogPostsFound')} />}
        </Modal>
    );
};

// Timeline Month Section Component
interface TimelineMonthSectionProps {
    year: number;
    month: number;
    blogs: BlogMeta[];
    defaultExpanded: boolean;
    onSelectBlog: (blog: BlogMeta) => void;
    animationDelay: number;
}

const TimelineMonthSection: React.FC<TimelineMonthSectionProps> = ({
    year,
    month,
    blogs,
    defaultExpanded,
    onSelectBlog,
    animationDelay,
}) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const { t } = useTranslation();

    // Format month header
    const monthLabel = formatMonthYear(month, year);
    const postCount = blogs.length;

    return (
        <Card className="overflow-hidden animate-reveal motion-reduce:animate-none" style={{ animationDelay: `${animationDelay}ms` }}>
            <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center justify-between px-4 py-3 transition-colors duration-fast ease-standard hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
            >
                <span className="flex items-center gap-3">
                    <span data-testid="month-disc" className={cn('flex h-6 w-6 items-center justify-center rounded-pill transition-colors duration-base ease-standard', expanded ? 'bg-accent-logo text-inverse' : 'bg-sunken text-secondary')}>
                        <ChevronRight className={cn('h-3 w-3 transition-transform duration-base ease-standard motion-reduce:transition-none', expanded && 'rotate-90')} />
                    </span>
                    <span className={cn('text-body font-semibold', expanded ? 'text-accent-strong' : 'text-secondary')}>{monthLabel}</span>
                </span>
                <span className={cn('rounded-pill px-3 py-1 text-small transition-colors duration-base ease-standard', expanded ? 'bg-accent-subtle text-accent-strong' : 'bg-sunken text-secondary')}>{t('blogs.post', { count: postCount })}</span>
            </button>
            {expanded && (
                <div className="flex flex-col gap-1 px-2 pb-2">
                    {blogs.map((blog) => (
                        <TimelineBlogItem key={blog.id} blog={blog} onClick={() => onSelectBlog(blog)} />
                    ))}
                </div>
            )}
        </Card>
    );
};

// Timeline Blog Item Component
interface TimelineBlogItemProps {
    blog: BlogMeta;
    onClick: () => void;
}

const TimelineBlogItem: React.FC<TimelineBlogItemProps> = ({ blog, onClick }) => {
    const [imageError, setImageError] = useState(false);
    const { t } = useTranslation();
    const date = new Date(blog.published_at);
    const dayLabel = formatShortDate(date);

    // Check if published within 24 hours
    const isRecent = useMemo(() => {
        const now = new Date();
        const publishedAt = new Date(blog.published_at);
        const hoursDiff = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
        return hoursDiff <= 24;
    }, [blog.published_at]);

    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex w-full items-start gap-4 rounded-card p-3 text-left transition-colors duration-fast ease-standard hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <span className="block h-[75px] w-[100px] shrink-0 overflow-hidden rounded-card bg-sunken shadow-card transition-shadow duration-base ease-standard group-hover:shadow-accent-glow">
                {blog.thumbnail && !imageError ? (
                    <img
                        src={blog.thumbnail}
                        alt=""
                        loading="lazy"
                        onError={() => {
                            setImageError(true);
                            clientLog('blog_fallback', { target: 'timeline_thumb', reason: 'image_error' });
                        }}
                        className="h-full w-full object-cover transition-transform duration-base ease-standard group-hover:scale-105 motion-reduce:transform-none"
                    />
                ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted"><ImageIcon className="h-6 w-6" /></span>
                )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                <span lang="ja" className="line-clamp-2 font-reading text-body font-semibold text-primary group-hover:text-accent-strong">{blog.title}</span>
                <span className="text-small text-muted">{dayLabel}</span>
            </span>
            <span className="mt-2 flex shrink-0 items-center gap-2">
                {isRecent && <span className="h-2 w-2 rounded-pill bg-accent" title={t('blogs.publishedRecently')} />}
                <ChevronRight className="h-4 w-4 text-accent-strong opacity-0 transition-opacity duration-fast ease-standard group-hover:opacity-100" />
            </span>
        </button>
    );
};
