import React, { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar, Button, Pill } from '../../../design/primitives';
import { fetchNameMoments } from '../api';
import { FilmStrip } from '../favorites/FilmStrip';
import { logMemoriesToggle } from '../memoriesLog';
import { formatJstDate } from '../recap/availability';
import { LoadState } from '../shared/LoadState';
import { MemoryText } from '../shared/MemoryText';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { NameMoment } from '../types';
import { formatCardDate } from './binderModel';

interface NameMomentsProps {
    service: string;
    /** Her chat path (any of her rooms). */
    memberPath: string;
    /** Her display name (the avatar's alt text). */
    name: string;
    /** Back to the binder tab. */
    onBack: () => void;
}

/**
 * The 被叫名字的瞬間 tab (spec 5.2): every sentence in which she wrote the nickname code, newest
 * first, each with its JST date, her avatar at the time and the sentence (`MemoryText` with the
 * nickname underlined). Year `Pill`s (「すべて」 then newest first) refetch with `year`; the pills
 * come from the unfiltered `years` and stay while a filtered list loads. A row opens the film strip
 * of that day at the message (`FilmStrip`, logged as `names`). The list scrolls inside the pane.
 */
export const NameMoments: React.FC<NameMomentsProps> = ({ service, memberPath, name, onBack }) => {
    const { t, i18n } = useTranslation();
    const [picked, setPicked] = useState<{ path: string; year: number } | null>(null);
    const year = picked?.path === memberPath ? picked.year : undefined;
    const query = useMemoriesQuery('names', (signal) => fetchNameMoments(service, memberPath, year, signal), [service, memberPath, year], {
        count: (d) => d.items.length,
    });
    // `years` is the same for every filter: keep the person's last one for the pills.
    const [years, setYears] = useState<{ path: string; years: number[] } | null>(null);
    const loadedYears = query.data?.years;
    useEffect(() => {
        if (loadedYears) setYears({ path: memberPath, years: loadedYears });
    }, [loadedYears, memberPath]);
    const pills = years?.path === memberPath ? years.years : [];

    const [open, setOpen] = useState<NameMoment | null>(null);
    const openMoment = (moment: NameMoment) => {
        setOpen(moment);
        logMemoriesToggle('film_strip', true);
    };
    const close = () => {
        setOpen(null);
        logMemoriesToggle('film_strip', false);
    };

    let body: React.ReactNode;
    if (query.status !== 'ready' || !query.data) {
        body = <LoadState status={query.status === 'error' ? 'error' : 'loading'} onRetry={query.retry} />;
    } else {
        body = (
            <ul className="flex flex-col gap-1">
                {query.data.items.map((moment, i) => {
                    const m = moment.message;
                    return (
                        <li key={`${m.room}|${m.id}|${i}`}>
                            <button
                                type="button"
                                data-testid="name-moment"
                                onClick={() => openMoment(moment)}
                                className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                            >
                                <Avatar src={m.avatar_url ?? undefined} name={name} size="sm" className="shrink-0" />
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="text-caption tabular-nums text-muted">
                                        {formatCardDate(formatJstDate(m.ts), i18n.language)}
                                    </span>
                                    <MemoryText as="span" text={moment.sentence} underlineNickname className="text-body text-primary" />
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <section className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-col gap-2 px-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-title text-primary">{t('memories.names.title')}</h3>
                    <Button variant="ghost" size="sm" onClick={onBack}>
                        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                        {t('memories.names.back')}
                    </Button>
                </div>
                {pills.length > 0 && (
                    <div role="group" className="flex flex-wrap gap-2">
                        <Pill selected={year === undefined} onClick={() => setPicked(null)}>{t('memories.names.allYears')}</Pill>
                        {pills.map((y) => (
                            <Pill key={y} selected={year === y} onClick={() => setPicked({ path: memberPath, year: y })}>{y}</Pill>
                        ))}
                    </div>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{body}</div>
            {open && (
                <FilmStrip
                    service={service}
                    memberPath={open.message.member_path}
                    date={formatJstDate(open.message.ts)}
                    focusId={open.message.id}
                    onClose={close}
                    from="names"
                />
            )}
        </section>
    );
};
