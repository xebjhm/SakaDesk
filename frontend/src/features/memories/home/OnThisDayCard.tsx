import React, { useState } from 'react';
import { CalendarHeart, ChevronRight } from 'lucide-react';
import { Atmosphere } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import type { MemoriesRoute } from '../MemoriesFeature';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { sepiaClass } from '../shared/sepia';
import type { HubMoment, MemoryMessage } from '../types';

interface OnThisDayCardProps {
    moment: HubMoment;
    go: (next: MemoriesRoute) => void;
}

/** The label that is true for the moment's rule: never "today" for `week` / `first`, never "0 years". */
function momentLabel(moment: HubMoment, t: (key: string, opts?: Record<string, unknown>) => string): string {
    if (moment.rule === 'today') return t('memories.home.yearsAgo', { count: moment.years_ago });
    if (moment.rule === 'week') return t('memories.home.thisWeek', { count: moment.years_ago });
    return t('memories.home.firstMessage');
}

/** Where the card leads: today's On This Day, the moment's own month-day, or her memoir for `first`. */
function momentRoute(moment: HubMoment): MemoriesRoute {
    if (moment.rule === 'first') return { page: 'memoir', memberPath: moment.member_path };
    if (moment.rule === 'week') return { page: 'onThisDay', monthDay: moment.date.slice(5) };
    return { page: 'onThisDay' };
}

const isStill = (m: MemoryMessage) => (m.type === 'picture' || m.type === 'video') && Boolean(m.media_url);

/**
 * The hub's large On This Day card (spec 4): the rule's label, her name, her words (three
 * lines) and a photo of that day on paper, over the brand-moment orbs. A photo-only moment
 * shows the photo as its message; a photo that cannot load at all hides its frame. A `today` moment opens today's On This Day, a `week` moment
 * the day it belongs to (today's month-day would be empty), a `first` moment her memoir.
 */
export const OnThisDayCard: React.FC<OnThisDayCardProps> = ({ moment, go }) => {
    const { t } = useTranslation();
    const words = moment.message.text ?? moment.message.caption;
    const photo = moment.photo && isStill(moment.photo) ? moment.photo : isStill(moment.message) ? moment.message : null;
    const year = Number(moment.date.slice(0, 4));
    // The still that could not load at all (keyed, so a new moment gets its own try).
    const [failedId, setFailedId] = useState<number | null>(null);
    const shownPhoto = photo && failedId !== photo.id ? photo : null;
    return (
        <Atmosphere fade className="rounded-xl p-2">
            <button
                type="button"
                data-testid="memories-hub-otd"
                onClick={() => go(momentRoute(moment))}
                className="flex w-full items-center gap-5 rounded-card bg-frost px-6 py-5 text-left text-primary shadow-card backdrop-blur-frost transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                    <span className="flex items-center gap-2 text-small text-secondary">
                        <CalendarHeart aria-hidden="true" className="h-4 w-4" />
                        <span lang="ja" className="truncate">{moment.name}</span>
                    </span>
                    <span className="font-display text-heading">{momentLabel(moment, t)}</span>
                    {words && <MemoryText as="span" text={words} className="line-clamp-3 text-body" />}
                    <span className="flex items-center gap-1 text-small text-secondary">
                        {t('memories.home.open')}
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </span>
                </span>
                {shownPhoto && (
                    <span data-testid="memories-hub-otd-photo" className="shrink-0 rounded-sm bg-memories-paper p-2 shadow-memories-polaroid">
                        <MemoryThumb message={shownPhoto} px={128} onFail={() => setFailedId(shownPhoto.id)} className={cn('block h-32 w-32 rounded-xs', sepiaClass(year))} />
                    </span>
                )}
            </button>
        </Atmosphere>
    );
};
