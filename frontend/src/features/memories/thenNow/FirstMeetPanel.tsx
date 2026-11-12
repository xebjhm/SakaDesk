import React, { useState } from 'react';
import { ArrowRight, Mic, Play } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Avatar } from '../../../design/primitives';
import { cn, formatDuration } from '../../../utils/classnames';
import { resizedAvatarUrl } from '../../messages/mediaUrl';
import { useAvatarWidth } from '../../messages/hooks/useAvatarWidth';
import { fetchFirstMeet } from '../api';
import { MemberDayDialog } from '../day/MemberDay';
import { formatCardDate } from '../memoir/binderModel';
import { formatJstClock, formatJstDate } from '../shared/jst';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { sepiaClass } from '../shared/sepia';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import type { FirstMeetKind, FirstMeetPayload, MemoryMessage } from '../types';
import { formatElapsed, spanLine, voiceDelta } from './firstMeet';

const AVATAR_PX = 24;
const PHOTO_PX = 96;

// Literal keys, so the i18n scanner sees every one of them.
const ROW_LABEL: Record<FirstMeetKind, string> = {
    ohayo: 'memories.thenNow.rowOhayo',
    photo: 'memories.thenNow.rowPhoto',
    voice: 'memories.thenNow.rowVoice',
    oyasumi: 'memories.thenNow.rowOyasumi',
};

const wordsOf = (m: MemoryMessage) => (m.type === 'text' ? m.text : (m.caption ?? m.text));

/** One side of a row: a paper card with the JST date and time, the photo, voice or words; a click opens her day at it. */
const Side: React.FC<{ message: MemoryMessage; which: 'then' | 'now'; onOpen: () => void }> = ({ message: m, which, onOpen }) => {
    const { t, i18n } = useTranslation();
    const date = formatCardDate(formatJstDate(m.ts), i18n.language);
    const words = wordsOf(m);
    const year = Number(formatJstDate(m.ts).slice(0, 4));
    return (
        <button
            type="button"
            data-testid="first-meet-side"
            data-side={which}
            aria-label={t('memories.thenNow.openSide', { date })}
            onClick={onOpen}
            className={cn(
                'flex min-h-20 min-w-0 flex-1 items-start gap-3 rounded-md border border-memories-paper bg-memories-paper p-3 text-left shadow-memories-polaroid',
                'transition-transform duration-fast ease-standard hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
        >
            {(m.type === 'picture' || m.type === 'video') && m.media_url && (
                <span className="relative block h-16 w-20 shrink-0 overflow-hidden rounded-sm bg-sunken">
                    <MemoryThumb message={m} px={PHOTO_PX} className={cn('h-full w-full', which === 'then' && sepiaClass(year))} />
                    {m.type === 'video' && <Play aria-hidden="true" className="absolute left-1 top-1 h-3.5 w-3.5 fill-current text-inverse drop-shadow-sm" />}
                </span>
            )}
            <span className="flex min-w-0 flex-col gap-1">
                <span className="text-caption tabular-nums text-muted">{date} {formatJstClock(m.ts)}</span>
                {m.type === 'voice' && (
                    <span className="flex items-center gap-1 text-small text-secondary">
                        <Mic aria-hidden="true" className="h-3.5 w-3.5" />
                        {m.duration_s ? formatDuration(m.duration_s) : t('memories.favorites.voice')}
                    </span>
                )}
                {words && <MemoryText as="span" text={words} className="line-clamp-3 text-small text-primary" />}
            </span>
        </button>
    );
};

const Head: React.FC<{ label: string; caption: string; avatarUrl: string | null; name: string }> = ({ label, caption, avatarUrl, name }) => {
    const width = useAvatarWidth(AVATAR_PX);
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <Avatar src={resizedAvatarUrl(avatarUrl, width)} name={name} size="sm" decorative />
            <span className="font-display text-title text-primary">{label}</span>
            <span className="text-caption text-muted">{caption}</span>
        </span>
    );
};

const Rows: React.FC<{ data: FirstMeetPayload; name: string; onOpen: (m: MemoryMessage) => void }> = ({ data, name, onOpen }) => {
    const { t } = useTranslation();
    const span = spanLine(t, data.rows);
    return (
        <div className="flex flex-col">
            {span && <p data-testid="first-meet-span" className="pb-3 text-small text-secondary">{span}</p>}
            <div className="flex items-end gap-3 pb-2">
                <span className="w-20 shrink-0" />
                <Head label={t('memories.thenNow.then')} caption={t('memories.thenNow.thenCaption')} avatarUrl={data.avatar_then} name={name} />
                <span className="w-24 shrink-0" />
                <Head label={t('memories.thenNow.now')} caption={t('memories.thenNow.nowCaption')} avatarUrl={data.avatar_now} name={name} />
            </div>
            {data.rows.map((row) => (
                <section
                    key={row.kind}
                    data-testid="first-meet-row"
                    data-kind={row.kind}
                    aria-labelledby={`first-meet-${row.kind}`}
                    className="flex items-center gap-3 border-t border-subtle py-3"
                >
                    <h4 id={`first-meet-${row.kind}`} className="w-20 shrink-0 text-small font-semibold text-primary">
                        {t(ROW_LABEL[row.kind])}
                    </h4>
                    <Side message={row.then} which="then" onOpen={() => onOpen(row.then)} />
                    <div data-testid="first-meet-gap" className="flex w-24 shrink-0 flex-col items-center gap-1 text-center text-muted">
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                        <span className="font-display text-small tabular-nums text-secondary">{formatElapsed(t, row.elapsed)}</span>
                        {voiceDelta(t, row) && <span data-testid="first-meet-voice-delta" className="text-caption tabular-nums">{voiceDelta(t, row)}</span>}
                    </div>
                    <Side message={row.now} which="now" onOpen={() => onOpen(row.now)} />
                </section>
            ))}
        </div>
    );
};

interface FirstMeetPanelProps {
    service: string;
    /** Her chat path (any of her rooms). */
    memberPath: string;
    /** Her display name (the day dialog's title and the chat jump). */
    name: string;
}

/**
 * 初見と今 (B2) in the memoir timeline: one row per kind (おはよう, photo, voice, おやすみ) with her
 * first one on the left, a recent one on the right and the time between them in the middle
 * (「1 年 8 天」; the voice row adds how much longer or shorter she spoke, 「長了 33 秒」), under a
 * subtitle with the whole span (「從最初到現在・相隔約 1 年」). A row exists only when both sides do (the backend leaves the others out). Each
 * side is a paper card (the older photo aged with `sepiaClass`); a click opens her day at that
 * message (`MemberDayDialog`, jump logged from `timeline`), and closing it leaves the panel as it
 * was. Loading, slow, error and timeout go through `MemoriesStatus` (`then_now`); without a row a
 * gentle line, never a number.
 */
export const FirstMeetPanel: React.FC<FirstMeetPanelProps> = ({ service, memberPath, name }) => {
    const { t } = useTranslation();
    const query = useMemoriesQuery<FirstMeetPayload | null>(
        'then_now',
        (signal) => fetchFirstMeet(service, memberPath, signal),
        [service, memberPath],
        { count: (d) => d?.rows.length ?? 0 },
    );
    const [open, setOpen] = useState<MemoryMessage | null>(null);
    let body: React.ReactNode;
    if (query.status !== 'ready') body = <MemoriesStatus query={query} view="then_now" />;
    else if (!query.data) body = <p className="p-6 text-center text-small text-secondary">{t('memories.thenNow.none')}</p>;
    else body = <Rows data={query.data} name={name} onOpen={setOpen} />;
    return (
        <section data-testid="first-meet-panel" aria-label={t('memories.thenNow.title')} className="flex min-w-0 flex-col">
            {body}
            {open && (
                <MemberDayDialog
                    service={service}
                    memberPath={open.member_path}
                    name={name}
                    message={open}
                    from="timeline"
                    onClose={() => setOpen(null)}
                />
            )}
        </section>
    );
};
