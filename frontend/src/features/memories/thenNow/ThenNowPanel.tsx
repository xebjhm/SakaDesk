import React, { useState } from 'react';
import { useTranslation } from '../../../i18n';
import { Pill } from '../../../design/primitives';
import { fetchThenNowDay, fetchThenNowFirstWeek } from '../api';
import { logMemoriesToggle } from '../memoriesLog';
import { LoadState } from '../shared/LoadState';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { ThenNowDayPayload, ThenNowFirstWeekPayload, ThenNowRowKind, ThenNowSide } from '../types';
import { ThenNowPair, type ThenNowSideView } from './ThenNowPair';

type Mode = 'day' | 'first_week';

const ROW_LABEL: Record<ThenNowRowKind, string> = {
    photo: 'memories.thenNow.rowPhoto',
    ohayo: 'memories.thenNow.rowOhayo',
    voice: 'memories.thenNow.rowVoice',
};

const yearOf = (day: string) => Number(day.slice(0, 4));

const daySide = (s: ThenNowSide): ThenNowSideView => ({ year: s.year, name: s.name, avatarUrl: s.avatar_url, items: s.items });

interface ThenNowPanelProps {
    service: string;
    /** JST `YYYY-MM-DD` of the day mode; without it the day mode is not asked for. */
    date?: string;
    /** One person (her chat path): narrows the day mode and enables 初見と今. */
    member?: string;
    /** Host controls at the panel's top right (On This Day puts its ⇆ toggle back here). */
    headerSlot?: React.ReactNode;
}

const FirstWeek: React.FC<{ data: ThenNowFirstWeekPayload }> = ({ data }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-4">
            {data.rows.map((row) => (
                <section key={row.kind} data-testid="then-now-row" className="flex flex-col gap-2">
                    <h4 className="font-display text-small text-secondary">{t(ROW_LABEL[row.kind])}</h4>
                    <ThenNowPair
                        variant="pane"
                        then={{
                            year: yearOf(data.then_range[0]), range: data.then_range, label: t('memories.thenNow.firstWeek'),
                            avatarUrl: data.avatar_then, items: [row.then],
                        }}
                        now={{
                            year: yearOf(data.now_range[0]), range: data.now_range, label: t('memories.thenNow.latestWeek'),
                            avatarUrl: data.avatar_now, items: [row.now],
                        }}
                    />
                </section>
            ))}
        </div>
    );
};

/**
 * あの日と今日 in a pane (spec 14.2): loads the day pair (`fetchThenNowDay`, when there is a
 * `date`) and 初見と今 (`fetchThenNowFirstWeek`, when there is a `member`), each real load logged
 * as `memories_load` `then_now` (a mode it cannot ask for is skipped, never logged). A mode pill (「あの日と今日」 / 「初見と今」) is shown only when its
 * payload is non-null; the day mode is preferred. 初見と今 draws its rows (photo / おはよう / voice)
 * as stacked `ThenNowPair`s under their row labels. Without either pair a gentle line (no number)
 * says so. Switching logs `memories_toggle` `then_now_mode` (`on` = first week).
 */
export const ThenNowPanel: React.FC<ThenNowPanelProps> = ({ service, date, member, headerSlot }) => {
    const { t } = useTranslation();
    const day = useMemoriesQuery<ThenNowDayPayload | null>(
        'then_now',
        (signal) => (date ? fetchThenNowDay(service, { date, member }, signal) : Promise.resolve(null)),
        [service, date, member],
        { count: (d) => (d ? 2 : 0), enabled: date !== undefined },
    );
    const week = useMemoriesQuery<ThenNowFirstWeekPayload | null>(
        'then_now',
        (signal) => (member ? fetchThenNowFirstWeek(service, member, signal) : Promise.resolve(null)),
        [service, member],
        { count: (d) => d?.rows.length ?? 0, enabled: member !== undefined },
    );
    const [picked, setPicked] = useState<Mode | null>(null);

    const loading = day.status === 'loading' || week.status === 'loading';
    const failed = day.status === 'error' || week.status === 'error';
    const available: Mode[] = [];
    if (day.data) available.push('day');
    if (week.data) available.push('first_week');
    const mode: Mode | undefined = picked && available.includes(picked) ? picked : available[0];

    const pick = (next: Mode) => {
        if (next === mode) return;
        setPicked(next);
        logMemoriesToggle('then_now_mode', next === 'first_week');
    };
    const retry = () => {
        if (day.status === 'error') day.retry();
        if (week.status === 'error') week.retry();
    };

    let body: React.ReactNode;
    if (failed) body = <LoadState status="error" onRetry={retry} />;
    else if (loading) body = <LoadState status="loading" onRetry={retry} />;
    else if (mode === 'day' && day.data) {
        body = (
            <ThenNowPair variant="pane" then={daySide(day.data.then)} now={daySide(day.data.now)} sharedKeyword={day.data.shared_keyword} />
        );
    } else if (mode === 'first_week' && week.data) body = <FirstWeek data={week.data} />;
    else body = <p className="p-6 text-center text-small text-secondary">{t('memories.thenNow.none')}</p>;

    return (
        <section data-testid="then-now-panel" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {(headerSlot || (!loading && !failed && available.length > 0)) && (
                <header className="flex flex-wrap items-center gap-2 px-4 pt-3">
                    {!loading && !failed && available.map((m) => (
                        <Pill key={m} selected={m === mode} onClick={() => pick(m)}>
                            {t(m === 'day' ? 'memories.thenNow.modeDay' : 'memories.thenNow.modeFirstWeek')}
                        </Pill>
                    ))}
                    {headerSlot && <div className="ml-auto flex items-center gap-2">{headerSlot}</div>}
                </header>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">{body}</div>
        </section>
    );
};
