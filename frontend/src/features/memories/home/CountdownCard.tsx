import React from 'react';
import { Cake, CalendarHeart } from 'lucide-react';
import { Card } from '../../../design/primitives';
import { cn } from '../../../utils/classnames';
import { useTranslation } from '../../../i18n';
import type { MemoriesRoute } from '../MemoriesFeature';
import type { HubCountdown } from '../types';

interface CountdownCardProps {
    countdown: HubCountdown | null;
    go: (next: MemoriesRoute) => void;
    className?: string;
}

/**
 * The hub's 誕生日・記念日 card: the next birthday or membership anniversary of a current
 * member, one number per line (spec 1.1). Before the day it counts the days only; on the day
 * it says "today" (never "0"), and only the anniversary's own line names its year, with her
 * name under it. The anniversary is the fan's own subscription date: the copy never implies
 * she knows it. Clicking opens her memoir. Renders nothing for `null`.
 */
export const CountdownCard: React.FC<CountdownCardProps> = ({ countdown, go, className }) => {
    const { t } = useTranslation();
    if (!countdown) return null;
    const { kind, name, days_left: daysLeft } = countdown;
    const today = daysLeft <= 0;
    let line: string;
    if (kind === 'birthday') {
        line = today ? t('memories.home.birthdayToday', { name }) : t('memories.home.birthdayIn', { name, count: daysLeft });
    } else {
        line = today ? t('memories.home.anniversaryToday', { years: countdown.years }) : t('memories.home.anniversaryIn', { name, count: daysLeft });
    }
    const Icon = kind === 'birthday' ? Cake : CalendarHeart;
    return (
        <Card className={cn('h-full p-0', className)}>
            <button
                type="button"
                data-testid="memories-hub-countdown"
                onClick={() => go({ page: 'memoir', memberPath: countdown.member_path })}
                className="flex h-full w-full items-center gap-4 rounded-card px-5 py-5 text-left text-primary transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <span aria-hidden="true" className="flex shrink-0 rounded-full bg-expressive-soft p-3 text-muted">
                    <Icon className="h-6 w-6" />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-display text-title tabular-nums">{line}</span>
                    {kind === 'anniversary' && today && <span lang="ja" className="truncate text-small text-secondary">{name}</span>}
                </span>
            </button>
        </Card>
    );
};
