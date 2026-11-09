import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Heart, Loader2, Sparkles } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, Card, EmptyState, IconButton } from '../../../design/primitives';
import { logRecapLoad, type RecapLoadOutcome } from '../memoriesLog';
import type { PollResult } from '../../../utils/pollJson';
import { fetchMemberRecap, fetchRecapMembers, type RecapOverview, type RecapOverviewMember, type RecapPayload } from './api';
import { RecapPlayer } from './RecapPlayer';
import { SLIDE_REGISTRY } from './slideRegistry';

/** The first year the recap API accepts (`MIN_YEAR` in `backend/api/memories.py`). */
export const RECAP_MIN_YEAR = 2020;

interface RecapEntryProps {
    service: string;
    year: number;
    /** Open this member's recap straight away (a chat-style member path). */
    memberPath?: string;
    /** The fan's nickname for this service (`%%%`); a gentle word stands in when unset. */
    nickname?: string;
    onBack: () => void;
}

type Load<T> = { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error' };

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
const NotYet: React.FC<{ year: number; action?: React.ReactNode }> = ({ year, action }) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-1 items-center justify-center">
            <EmptyState
                icon={<Sparkles />}
                title={t('recap.entry.emptyTitle')}
                description={t('recap.entry.emptyBody', { year })}
                action={action}
            />
        </div>
    );
};

const MemberRow: React.FC<{ member: RecapOverviewMember; onOpen: () => void }> = ({ member, onOpen }) => {
    const { t } = useTranslation();
    return (
        <li>
            <Card className="p-0">
                <button
                    type="button"
                    onClick={onOpen}
                    className="flex w-full items-center gap-3 rounded-card px-4 py-3 text-left transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span lang="ja" className="min-w-0 flex-1 truncate font-display text-title text-primary">{member.name}</span>
                    {member.oshi && (
                        <Heart role="img" aria-label={t('recap.entry.oshi')} className="h-4 w-4 fill-semantic-oshi text-semantic-oshi-solid" />
                    )}
                    {member.title_key && (
                        <span className="rounded-full bg-expressive-soft px-3 py-1 text-caption text-secondary">{t(member.title_key)}</span>
                    )}
                </button>
            </Card>
        </li>
    );
};

/**
 * The year recap entry: a year chooser and the members who have a recap that
 * year (with their role-title chips); choosing one plays her recap. The
 * multi-member opening is added by a later task.
 */
export const RecapEntry: React.FC<RecapEntryProps> = ({ service, year: initialYear, memberPath, nickname, onBack }) => {
    const { t } = useTranslation();
    const maxYear = Math.max(initialYear, new Date().getFullYear());
    const [year, setYear] = useState(initialYear);
    const [attempt, setAttempt] = useState(0);
    const [overview, setOverview] = useState<Load<RecapOverview>>({ status: 'loading' });
    const [selected, setSelected] = useState<string | null>(memberPath ?? null);
    const [memberAttempt, setMemberAttempt] = useState(0);
    const [recap, setRecap] = useState<Load<RecapPayload>>({ status: 'loading' });
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
        setRecap({ status: 'loading' });
        void fetchMemberRecap(service, year, selected, controller.signal).then((res) => {
            const outcome = outcomeOf(res);
            if (outcome === null) return;
            if (res.status === 'ok') {
                const count = res.data.tier === 'none' ? 0 : playable(res.data);
                const memberId = /^[a-z0-9_]{1,40}$/.test(res.data.member.id) ? res.data.member.id : undefined;
                logRecapLoad('member', count ? 'ok' : 'empty', {
                    count, member_id: memberId, ...(nickname?.trim() ? {} : { fallback: 'no_nickname' }),
                });
                setRecap({ status: 'ok', data: res.data });
            } else {
                logRecapLoad('member', outcome, res.status === 'rejected' ? { error_code: res.httpStatus } : {});
                setRecap({ status: 'error' });
            }
        });
        return () => controller.abort();
    // The nickname only labels the breadcrumb; it never refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [service, year, selected, memberAttempt]);

    const backToList = () => setSelected(null);

    if (selected) {
        if (recap.status === 'loading') return <div data-testid="recap-entry" className="flex flex-1"><Status /></div>;
        if (recap.status === 'error') {
            return <div data-testid="recap-entry" className="flex flex-1"><Failed onRetry={() => setMemberAttempt((n) => n + 1)} /></div>;
        }
        const data = recap.data;
        if (data.tier === 'none' || playable(data) === 0) {
            return (
                <div data-testid="recap-entry" className="flex flex-1">
                    <NotYet year={data.year} action={<Button variant="secondary" onClick={backToList}>{t('recap.entry.back')}</Button>} />
                </div>
            );
        }
        return <RecapPlayer key={selected} recap={data} nickname={resolvedNickname} onClose={backToList} />;
    }

    const members = overview.status === 'ok' ? overview.data.members.filter((m) => m.tier !== 'none') : [];
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
                    <span className={year > RECAP_MIN_YEAR ? undefined : 'invisible'}>
                        <IconButton size="sm" aria-label={t('recap.entry.olderYear')} icon={<ChevronLeft />} onClick={() => setYear((y) => Math.max(RECAP_MIN_YEAR, y - 1))} />
                    </span>
                    <span className="min-w-20 text-title tabular-nums text-primary">{t('recap.entry.year', { year })}</span>
                    <span className={year < maxYear ? undefined : 'invisible'}>
                        <IconButton size="sm" aria-label={t('recap.entry.newerYear')} icon={<ChevronRight />} onClick={() => setYear((y) => Math.min(maxYear, y + 1))} />
                    </span>
                </div>
                {overview.status === 'ok' && overview.data.phase === 'partial' && members.length > 0 && (
                    <p className="text-small text-secondary">{t('recap.entry.partial', { year })}</p>
                )}
            </header>
            {overview.status === 'loading' && <Status />}
            {overview.status === 'error' && <Failed onRetry={() => setAttempt((n) => n + 1)} />}
            {overview.status === 'ok' && members.length === 0 && <NotYet year={year} />}
            {members.length > 0 && (
                <section className="mx-auto flex w-full max-w-md flex-col gap-3">
                    <p className="text-center text-small text-secondary">{t('recap.entry.choose')}</p>
                    <ul className="flex flex-col gap-3">
                        {members.map((m) => (
                            <MemberRow key={m.member_path} member={m} onOpen={() => setSelected(m.member_path)} />
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
};
