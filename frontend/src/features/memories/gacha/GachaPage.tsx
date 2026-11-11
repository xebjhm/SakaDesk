import React, { useEffect, useRef, useState } from 'react';
import { Gift } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { Button, EmptyState } from '../../../design/primitives';
import { setFavorite } from '../../../utils/favoriteApi';
import type { MemoriesRoute } from '../MemoriesFeature';
import { fetchGacha, MemoriesFetchError, MemoriesTimeoutError, postGachaPull } from '../api';
import { FilmStrip } from '../favorites/FilmStrip';
import { logMemoriesGacha, logMemoriesLoad } from '../memoriesLog';
import { formatJstDate } from '../shared/jst';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { PageHeader } from '../shared/PageHeader';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';
import { useReducedMotion } from '../shared/useReducedMotion';
import { stopMemoriesVoices } from '../shared/voicePlayback';
import type { GachaPull, GachaStatePayload, GachaRarity } from '../types';
import { CapsuleMachine } from './CapsuleMachine';
import { GachaCard } from './GachaCard';
import { pullKey } from './keys';
import { PullHistory } from './PullHistory';

interface GachaPageProps {
    service: string;
    go: (next: MemoriesRoute) => void;
}

/** This visit's pulls on top of a loaded state (`base`); a refetch replaces both. */
interface Session {
    base: GachaStatePayload;
    /** Newest first. */
    pulls: GachaPull[];
    left: number;
}

const messageKey = (p: GachaPull) => `${p.message.room}|${p.message.id}`;

/**
 * 思い出ガチャ (spec 12): the capsule machine on the left, the revealed card on the right (stacked
 * under `md`), the pull history along the bottom. It opens on today's newest pull, if any.
 *
 * - **Pull:** one request at a time (a ref guard, so double clicks make one request; the server
 *   is safe too). A pull logs `pull` (its index) and `reveal` (rarity, reason, index, id), drops
 *   its capsule and opens its card. A 409 means today's pulls are used (also after a racing
 *   click): 「また明日」, logged `refused` `no_pulls_left`. An empty pool logs `empty_pool`. Any
 *   other failure (a timeout included) may still have been committed, so the state is read again
 *   in place, never the write retried (`request_failed`): the machine, card and history stay on
 *   screen (the knob waits), and a re-read that fails shows an inline notice with a retry.
 * - `open` is logged once per visit, never per re-read.
 * - **★:** optimistic through the chat's `setFavorite`, reverted when it was not saved (logged
 *   with `reason` `request_failed`); one request per message at a time. The page keeps the result,
 *   so reopening a card from the history shows it.
 * - **Context:** the film strip of her JST day at the message (`from` `gacha`); opening it or
 *   leaving the page stops the card's voice.
 * - Nothing to draw (`available: false`): the gentle empty copy. Pulls left 0 never shows a 0.
 */
export const GachaPage: React.FC<GachaPageProps> = ({ service, go }) => {
    const { t } = useTranslation();
    const reducedMotion = useReducedMotion();
    const state = useMemoriesQuery('gacha', (signal) => fetchGacha(service, signal), [service], {
        count: (d) => d.history.length,
    });
    // A silent re-read (after a failed pull) replaces the loaded state without a loading screen.
    const [refreshed, setRefreshed] = useState<{ from: GachaStatePayload; data: GachaStatePayload } | null>(null);
    const data = state.data && refreshed?.from === state.data ? refreshed.data : state.data;
    const [stale, setStale] = useState(false);

    const [session, setSession] = useState<Session | null>(null);
    const live = session && data && session.base === data ? session : null;
    const left = live ? live.left : (data?.pulls_left ?? 0);
    const fresh = live?.pulls ?? [];
    const freshKeys = new Set(fresh.map(pullKey));
    const history = [...fresh, ...(data?.history ?? []).filter((p) => !freshKeys.has(pullKey(p)))];

    const [selected, setSelected] = useState<string | null>(null);
    const [dropped, setDropped] = useState<{ key: string; rarity: GachaRarity } | null>(null);
    const [busy, setBusy] = useState(false);
    const inFlight = useRef(false);
    const [favs, setFavs] = useState<Record<string, boolean>>({});
    const favPending = useRef(new Set<string>());
    const [strip, setStrip] = useState<{ memberPath: string; date: string; focusId: number } | null>(null);

    // One signal for the page's writes: leaving the page aborts them and silences the card.
    const lifetime = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        lifetime.current = controller;
        return () => {
            controller.abort();
            stopMemoriesVoices();
        };
    }, []);

    // One `open` per page visit (the first state that loads), never per re-read.
    const opened = useRef(false);
    useEffect(() => {
        if (!data || opened.current) return;
        opened.current = true;
        logMemoriesGacha('open', { count: data.pulls_left });
        if (!data.available) logMemoriesGacha('refused', { reason: 'empty_pool' });
    }, [data]);

    /** Read the state again in place (logged `memories_load` like the first read); a failure marks the view stale. */
    const reread = async (signal: AbortSignal) => {
        const from = state.data;
        if (!from) return;
        try {
            const next = await fetchGacha(service, signal);
            if (signal.aborted) return;
            logMemoriesLoad('gacha', 'ok', { count: next.history.length });
            setRefreshed({ from, data: next });
            setStale(false);
        } catch (err) {
            if (signal.aborted) return;
            if (err instanceof MemoriesTimeoutError) logMemoriesLoad('gacha', 'timeout');
            else logMemoriesLoad('gacha', 'error', err instanceof MemoriesFetchError ? { error_code: err.httpStatus } : {});
            setStale(true);
        }
    };

    /** Run `work` as the page's one request in flight (the knob waits for it). */
    const exclusive = async (work: (signal: AbortSignal) => Promise<void>) => {
        const signal = lifetime.current?.signal;
        if (inFlight.current || !signal || signal.aborted) return;
        inFlight.current = true;
        setBusy(true);
        try {
            await work(signal);
        } finally {
            if (!signal.aborted) {
                inFlight.current = false;
                setBusy(false);
            }
        }
    };

    const todayNewest = fresh[0] ?? data?.today[data.today.length - 1] ?? null;
    const openKey = selected ?? (todayNewest ? pullKey(todayNewest) : null);
    const open = openKey ? history.find((p) => pullKey(p) === openKey) ?? null : null;

    const pull = () => exclusive(async (signal) => {
        if (!data || left <= 0) return;
        const base = data;
        const keep = (x: Session | null) => (x && x.base === base ? x.pulls : []);
        logMemoriesGacha('pull', { index: base.max_pulls - left });
        try {
            const res = await postGachaPull(service, signal);
            if (signal.aborted) return;
            if (res.status === 'no_pulls_left') {
                logMemoriesGacha('refused', { reason: 'no_pulls_left' });
                setSession((x) => ({ base, pulls: keep(x), left: 0 }));
            } else if (!res.data.pull) {
                logMemoriesGacha('refused', { reason: 'empty_pool' });
                setSession((x) => ({ base, pulls: keep(x), left: res.data.pulls_left }));
            } else {
                const p = res.data.pull;
                logMemoriesGacha('reveal', { kind: p.rarity, reason: p.reason, index: p.pull_index, message_id: p.message.id });
                setSession((x) => ({ base, pulls: [p, ...keep(x)], left: res.data.pulls_left }));
                setSelected(pullKey(p));
                setDropped({ key: pullKey(p), rarity: p.rarity });
            }
        } catch {
            if (signal.aborted) return;
            // A timed-out write may already be committed: read the state again in place, never re-pull.
            logMemoriesGacha('refused', { reason: 'request_failed' });
            await reread(signal);
        }
    });

    const isFavorite = (p: GachaPull) => favs[messageKey(p)] ?? p.message.favorited;

    const toggleFavorite = async (p: GachaPull) => {
        const key = messageKey(p);
        const signal = lifetime.current?.signal;
        if (!signal || favPending.current.has(key)) return;
        const was = isFavorite(p);
        const next = !was;
        const outcome = next ? 'on' : 'off';
        favPending.current.add(key);
        setFavs((f) => ({ ...f, [key]: next }));
        let saved: boolean;
        try {
            saved = await setFavorite(service, p.message.id, next, signal);
        } catch {
            return; // aborted: the page is gone
        } finally {
            favPending.current.delete(key);
        }
        if (saved) {
            logMemoriesGacha('favorite', { outcome, message_id: p.message.id });
        } else {
            setFavs((f) => ({ ...f, [key]: was }));
            logMemoriesGacha('favorite', { outcome, reason: 'request_failed', message_id: p.message.id });
        }
    };

    const openContext = (p: GachaPull) => {
        if (!p.message.ts) return;
        stopMemoriesVoices();
        logMemoriesGacha('context', { message_id: p.message.id });
        setStrip({ memberPath: p.message.member_path, date: formatJstDate(p.message.ts), focusId: p.message.id });
    };

    let body: React.ReactNode;
    if (state.status !== 'ready' || !data) {
        body = <MemoriesStatus query={state} view="gacha" />;
    } else if (!data.available) {
        body = (
            <div className="flex flex-1 items-center justify-center">
                <EmptyState icon={<Gift />} title={t('memories.gacha.title')} description={t('memories.gacha.empty')} />
            </div>
        );
    } else {
        body = (
            <>
                {stale && (
                    <div role="status" className="mx-4 mt-2 flex shrink-0 items-center gap-3 rounded-md bg-sunken px-3 py-2 text-small text-secondary">
                        <span className="min-w-0 flex-1">{t('memories.gacha.refreshFailed')}</span>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void exclusive(reread); }}>
                            {t('memories.common.retry')}
                        </Button>
                    </div>
                )}
                <div className="flex min-h-0 flex-1 flex-col items-center gap-8 overflow-y-auto p-6 md:flex-row md:justify-center md:gap-12">
                    <CapsuleMachine pullsLeft={left} busy={busy} onPull={() => { void pull(); }} dropped={dropped} reducedMotion={reducedMotion} />
                    <div className="flex w-full max-w-sm shrink-0 justify-center">
                        {open ? (
                            <GachaCard
                                key={pullKey(open)}
                                pull={open}
                                favorited={isFavorite(open)}
                                onToggleFavorite={() => { void toggleFavorite(open); }}
                                onContext={() => openContext(open)}
                                reducedMotion={reducedMotion}
                            />
                        ) : (
                            <div
                                data-testid="gacha-empty-card"
                                className="flex h-64 w-full items-center justify-center rounded-lg border-2 border-dashed border-strong p-6 text-center text-body text-secondary"
                            >
                                {/* How to pull (with no pulls left, the machine already says 「また明日」). */}
                                {left > 0 && t('memories.gacha.hint')}
                            </div>
                        )}
                    </div>
                </div>
                {history.length > 0 && (
                    <section className="shrink-0 border-t border-subtle">
                        <h2 className="px-4 pt-2 text-caption text-muted">{t('memories.gacha.history')}</h2>
                        <PullHistory pulls={history} selectedKey={open ? pullKey(open) : null} onSelect={(p) => setSelected(pullKey(p))} />
                    </section>
                )}
            </>
        );
    }

    return (
        <div data-testid="memories-page-gacha" data-service={service} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <PageHeader title={t('memories.gacha.title')} onBack={() => go({ page: 'home' })} />
            <div className="flex min-h-0 flex-1 flex-col">{body}</div>
            {strip && (
                <FilmStrip
                    service={service}
                    memberPath={strip.memberPath}
                    date={strip.date}
                    focusId={strip.focusId}
                    from="gacha"
                    onClose={() => setStrip(null)}
                />
            )}
        </div>
    );
};
