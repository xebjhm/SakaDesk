import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Heart, Image as ImageIcon, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, Card, EmptyState, IconButton } from '../../../design/primitives';
import { logRecapLoad, logRecapOpening, logRecapPoster, type RecapLoadOutcome } from '../memoriesLog';
import type { PollResult } from '../../../utils/pollJson';
import { fetchMemberRecap, fetchRecapMembers, type RecapOverview, type RecapOverviewMember, type RecapPayload } from './api';
import { offeredRecapYears, recapAvailability } from './availability';
import { Opening } from './Opening';
import { PosterView, type PosterSurface } from './PosterView';
import { safeMemberId } from './posterCopy';
import { RecapPlayer } from './RecapPlayer';
import { SLIDE_REGISTRY } from './slideRegistry';

export { RECAP_MIN_YEAR } from './availability';

interface RecapEntryProps {
    service: string;
    year: number;
    /** Open this member's recap straight away (a chat-style member path). */
    memberPath?: string;
    /** The fan's nickname for this service (`%%%`); a gentle word stands in when unset. */
    nickname?: string;
    /**
     * The years the chooser offers, ascending (`offeredRecapYears`). When unset, every year up
     * to the newest open one (JST unlocks) is offered.
     */
    years?: readonly number[];
    onBack: () => void;
}

type Load<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error' };

/** A member recap load, tagged with the member path it was requested for. */
type MemberLoad = { path: string | null; load: Load<RecapPayload> };

/** Outcome code of a finished request, or null when it was superseded (no breadcrumb). */
function outcomeOf<T>(res: PollResult<T>): Exclude<RecapLoadOutcome, 'ok' | 'empty'> | 'ok' | null {
    switch (res.status) {
        case 'ok': return 'ok';
        case 'timeout': return 'timeout';
        case 'rejected': return 'rejected';
        case 'failed': return 'failed';
        default: return null;
    }
}

const playable = (recap: RecapPayload) => recap.slides.filter((s) => SLIDE_REGISTRY[s.key]).length;

const Status: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div role="status" className="flex flex-1 items-center justify-center text-muted">
            <Loader2 aria-hidden="true" className="h-6 w-6 animate-spin motion-reduce:animate-none" />
            <span className="sr-only">{t('common.loading')}</span>
        </div>
    );
};

const Failed: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-small text-secondary">{t('recap.entry.loadFailed')}</p>
            <Button variant="secondary" onClick={onRetry}>{t('common.retry')}</Button>
        </div>
    );
};

/** Nothing (or too little) to look back on: a gentle card, never a "0". */
const NotYet: React.FC<{ action?: React.ReactNode }> = ({ action }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-1 items-center justify-center">
            <EmptyState
                icon={<Sparkles />}
                title={t('recap.entry.emptyTitle')}
                description={t('recap.entry.emptyBody')}
                action={action}
            />
        </div>
    );
};

interface MemberRowProps {
    member: RecapOverviewMember;
    onOpen: () => void;
    /** Set once this member's recap (with a poster) has loaded: opens the poster straight away. */
    onPoster?: () => void;
}

const MemberRow: React.FC<MemberRowProps> = ({ member, onOpen, onPoster }) => {
    const { t } = useTranslation();
    return (
        <li>
            <Card className="flex items-center gap-1 p-0 pr-2">
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-card px-4 py-3 text-left transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span lang="ja" className="min-w-0 flex-1 truncate font-display text-title text-primary">{member.name}</span>
                    {member.oshi && (
                        <Heart role="img" aria-label={t('recap.entry.oshi')} className="h-4 w-4 fill-semantic-oshi text-semantic-oshi-solid" />
                    )}
                    {member.title_key && (
                        <span className="rounded-full bg-expressive-soft px-3 py-1 text-caption text-secondary">{t(member.title_key)}</span>
                    )}
                </button>
                {onPoster && (
                    <IconButton size="sm" variant="ghost" aria-label={t('recap.poster.open')} icon={<ImageIcon />} onClick={onPoster} />
                )}
            </Card>
        </li>
    );
};

/** A member without a recap this year: a quiet, forward-looking card (never a count). */
const QuietMember: React.FC<{ member: RecapOverviewMember }> = ({ member }) => {
    const { t } = useTranslation();
    return (
        <li data-testid="recap-quiet-member">
            <Card className="flex items-center gap-3 px-4 py-3">
                <span lang="ja" className="min-w-0 flex-1 truncate text-body text-secondary">{member.name}</span>
                <span className="text-caption text-muted">{t('recap.entry.emptyTitle')}</span>
            </Card>
        </li>
    );
};

/**
 * The year recap entry: a year chooser over the offered years and the members who
 * have a recap that year (with their role-title chips), then the members without
 * one as quiet 来年のあなたへ cards. When two or more members have a recap, the
 * multi-member opening plays first (once per year in this visit; not when a
 * member was opened straight away). Choosing a member plays her recap, and the
 * year poster follows its last slide (with replay and close). A member whose
 * recap has loaded in this visit also gets a poster button in the list.
 */
export const RecapEntry: React.FC<RecapEntryProps> = ({ service, year: initialYear, memberPath, nickname, years, onBack }) => {
    const { t } = useTranslation();
    const yearList = useMemo(() => {
        const list = new Set(years ?? offeredRecapYears(recapAvailability(), null));
        list.add(initialYear);
        return [...list].sort((a, b) => a - b);
    }, [years, initialYear]);
    const [year, setYear] = useState(initialYear);
    const olderYear = [...yearList].reverse().find((y) => y < year);
    const newerYear = yearList.find((y) => y > year);
    // Years whose opening has played (or was skipped by opening a member straight away) in this visit.
    const [openingSeen, setOpeningSeen] = useState<ReadonlySet<number>>(() => new Set(memberPath ? [initialYear] : []));
    const [attempt, setAttempt] = useState(0);
    const [overview, setOverview] = useState<Load<RecapOverview>>({ status: 'loading' });
    const [selected, setSelected] = useState<string | null>(memberPath ?? null);
    const [memberAttempt, setMemberAttempt] = useState(0);
    // Tagged with its member path: a payload is shown only for the member it was loaded for, so
    // opening member B never mounts the player (or logs breadcrumbs) with member A's recap.
    const [memberLoad, setMemberLoad] = useState<MemberLoad>({ path: null, load: { status: 'loading' } });
    const recap: Load<RecapPayload> = memberLoad.path === selected ? memberLoad.load : { status: 'loading' };
    // What the selected member shows: the story, or the poster after it (`run` remounts the player on replay).
    // `surface` tells the poster's breadcrumb whether it opened after the story or from the list.
    const [view, setView] = useState<{ kind: 'player' | 'poster'; run: number; surface: PosterSurface }>({ kind: 'player', run: 0, surface: 'end' });
    // `year:path` of each recap (with a poster) loaded in this visit, so the list can open its poster.
    const [withPoster, setWithPoster] = useState<ReadonlySet<string>>(() => new Set());
    const resolvedNickname = nickname?.trim() || t('recap.youFallback');

    useEffect(() => {
        const controller = new AbortController();
        setOverview({ status: 'loading' });
        void fetchRecapMembers(service, year, controller.signal).then((res) => {
            const outcome = outcomeOf(res);
            if (outcome === null) return;
            if (res.status === 'ok') {
                const count = res.data.members.filter((m) => m.tier !== 'none').length;
                logRecapLoad('members', count ? 'ok' : 'empty', { count });
                if (count === 1) logRecapOpening('skip', { reason: 'single_member', count });
                setOverview({ status: 'ok', data: res.data });
            } else {
                logRecapLoad('members', outcome, res.status === 'rejected' ? { error_code: res.httpStatus } : {});
                setOverview({ status: 'error' });
            }
        });
        return () => controller.abort();
    }, [service, year, attempt]);

    useEffect(() => {
        if (!selected) return;
        const controller = new AbortController();
        setMemberLoad({ path: selected, load: { status: 'loading' } });
        void fetchMemberRecap(service, year, selected, controller.signal).then((res) => {
            const outcome = outcomeOf(res);
            if (outcome === null) return;
            if (res.status === 'ok') {
                const count = res.data.tier === 'none' ? 0 : playable(res.data);
                const memberId = safeMemberId(res.data.member.id);
                logRecapLoad('member', count ? 'ok' : 'empty', {
                    count, member_id: memberId, ...(nickname?.trim() ? {} : { fallback: 'no_nickname' }),
                });
                setMemberLoad({ path: selected, load: { status: 'ok', data: res.data } });
                if (res.data.poster && res.data.tier !== 'none') {
                    const tag = `${year}:${selected}`;
                    setWithPoster((prev) => (prev.has(tag) ? prev : new Set(prev).add(tag)));
                }
            } else {
                logRecapLoad('member', outcome, res.status === 'rejected' ? { error_code: res.httpStatus } : {});
                setMemberLoad({ path: selected, load: { status: 'error' } });
            }
        });
        return () => controller.abort();
    // The nickname only labels the breadcrumb; it never refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, year, selected, memberAttempt]);

    // Closing drops the payload, so reopening (even the same member) loads and opens it afresh.
    const openMember = (path: string | null, kind: 'player' | 'poster' = 'player') => {
        setMemberLoad({ path: null, load: { status: 'loading' } });
        setView((v) => ({ kind, run: v.run + 1, surface: kind === 'poster' ? 'list' : 'end' }));
        setSelected(path);
    };
    const backToList = () => openMember(null);

    if (selected) {
        if (recap.status === 'loading') return <div data-testid="recap-entry" className="flex flex-1"><Status /></div>;
        if (recap.status === 'error') {
            return <div data-testid="recap-entry" className="flex flex-1"><Failed onRetry={() => setMemberAttempt((n) => n + 1)} /></div>;
        }
        const data = recap.data;
        if (view.kind === 'poster' && data.poster && data.tier !== 'none') {
            return (
                <PosterView
                    recap={data}
                    nickname={resolvedNickname}
                    surface={view.surface}
                    onReplay={() => setView((v) => ({ kind: 'player', run: v.run + 1, surface: 'end' }))}
                    onClose={backToList}
                />
            );
        }
        if (data.tier === 'none' || playable(data) === 0) {
            return (
                <div data-testid="recap-entry" className="flex flex-1">
                    <NotYet action={<Button variant="secondary" onClick={backToList}>{t('recap.entry.back')}</Button>} />
                </div>
            );
        }
        const memberId = safeMemberId(data.member.id);
        const onEnd = () => {
            if (data.poster) setView((v) => ({ kind: 'poster', run: v.run, surface: 'end' }));
            else logRecapPoster('skip', { reason: 'no_poster', member_id: memberId });
        };
        return (
            <RecapPlayer key={`${selected}:${view.run}`} recap={data} nickname={resolvedNickname} onClose={backToList} onEnd={onEnd} />
        );
    }

    const members = overview.status === 'ok' ? overview.data.members.filter((m) => m.tier !== 'none') : [];
    const quiet = overview.status === 'ok' && members.length > 0 ? overview.data.members.filter((m) => m.tier === 'none') : [];
    if (overview.status === 'ok' && overview.data.year === year && members.length >= 2 && !openingSeen.has(year)) {
        const seenYear = year;
        return (
            <Opening
                key={seenYear}
                overview={overview.data}
                onDone={() => setOpeningSeen((prev) => new Set(prev).add(seenYear))}
            />
        );
    }
    return (
        <div data-testid="recap-entry" className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    {t('recap.entry.back')}
                </Button>
            </div>
            <header className="flex flex-col items-center gap-3 text-center">
                <h2 className="font-display text-heading text-primary">{t('recap.entry.heading')}</h2>
                <div className="flex items-center gap-2">
                    <span className={olderYear !== undefined ? undefined : 'invisible'}>
                        <IconButton size="sm" aria-label={t('recap.entry.olderYear')} icon={<ChevronLeft />} onClick={() => { if (olderYear !== undefined) setYear(olderYear); }} />
                    </span>
                    <span className="min-w-20 text-title tabular-nums text-primary">{t('recap.entry.year', { year })}</span>
                    <span className={newerYear !== undefined ? undefined : 'invisible'}>
                        <IconButton size="sm" aria-label={t('recap.entry.newerYear')} icon={<ChevronRight />} onClick={() => { if (newerYear !== undefined) setYear(newerYear); }} />
                    </span>
                </div>
                {overview.status === 'ok' && overview.data.phase === 'partial' && members.length > 0 && (
                    <p className="text-small text-secondary">{t('recap.entry.partial', { year })}</p>
                )}
            </header>
            {overview.status === 'loading' && <Status />}
            {overview.status === 'error' && <Failed onRetry={() => setAttempt((n) => n + 1)} />}
            {overview.status === 'ok' && members.length === 0 && <NotYet />}
            {members.length > 0 && (
                <section className="mx-auto flex w-full max-w-md flex-col gap-3">
                    <p className="text-center text-small text-secondary">{t('recap.entry.choose')}</p>
                    <ul className="flex flex-col gap-3">
                        {members.map((m) => (
                            <MemberRow
                                key={m.member_path}
                                member={m}
                                onOpen={() => openMember(m.member_path)}
                                onPoster={withPoster.has(`${year}:${m.member_path}`) ? () => openMember(m.member_path, 'poster') : undefined}
                            />
                        ))}
                    </ul>
                    {quiet.length > 0 && (
                        <ul className="flex flex-col gap-2">
                            {quiet.map((m) => <QuietMember key={m.member_path} member={m} />)}
                        </ul>
                    )}
                </section>
            )}
        </div>
    );
};
