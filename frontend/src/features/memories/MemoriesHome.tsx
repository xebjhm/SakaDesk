import React from 'react';
import { Skeleton } from '../../design/primitives';
import { cn } from '../../utils/classnames';
import { useTranslation } from '../../i18n';
import type { MemoriesRoute } from './MemoriesFeature';
import { fetchHub } from './api';
import { CountdownCard } from './home/CountdownCard';
import { HubEntryCard } from './home/HubEntryCard';
import { HubGatheringLine } from './home/HubGatheringLine';
import { HubSlots } from './home/HubSlots';
import { HUB_CARDS, hubCardCounts, hubCardLine } from './home/hubCards';
import { OnThisDayCard } from './home/OnThisDayCard';
import { RecapHubCard, type RecapCardState } from './home/RecapHubCard';
import { MemoriesStatus } from './shared/memoriesStatus';
import { useMemoriesQuery } from './shared/useMemoriesQuery';

export type { RecapCardState } from './home/RecapHubCard';

interface MemoriesHomeProps {
    service: string;
    recap: RecapCardState;
    onOpenRecap: (year: number) => void;
    onRetry: () => void;
    go: (next: MemoriesRoute) => void;
}

/**
 * The Memories hub board (spec 4), a fixed viewport: the title, then one board that scrolls
 * inside the pane when it is short (the large On This Day card with the wave-4 slots around
 * it, then the grid of entry cards), so every card stays reachable at the smallest window. The entry cards are usable while `/hub` loads or after it fails
 * (they only lack their counts); the moment's place shows the staged Memories load state (`MemoriesStatus`: its place reserved
 * from mount, a skeleton shaped like the On This Day card from the reveal delay, the Memories slow line at 3 s, then the first-run
 * explanation `memories.home.firstVerySlow` with an indeterminate bar at 10 s, no Cancel since the
 * cards stay usable), or its error / timeout with Retry. While the board on screen is `refreshing`
 * and still re-polled, one "still gathering" line sits under the title (`HubGatheringLine`, its
 * empty status region always mounted). A
 * zero count shows no number (the gacha card says 「また明日」 instead; a `null` `gacha_left`
 * shows no line); a `null` moment or countdown leaves its card out. The recap
 * card keeps its own shelf states (`RecapHubCard`).
 */
export const MemoriesHome: React.FC<MemoriesHomeProps> = ({ service, recap, onOpenRecap, onRetry, go }) => {
    const { t } = useTranslation();
    const hub = useMemoriesQuery('hub', (signal) => fetchHub(service, signal), [service], {
        count: (d) => (d.on_this_day ? 1 : 0),
        // A sync or its post-sync refresh is still running (first run: no birthdays yet, so no
        // countdown): ask again until the board is final.
        refreshWhile: (d) => d.refreshing === true,
    });
    const data = hub.data;
    const counts = hubCardCounts(data);

    let moment: React.ReactNode = null;
    if (hub.status !== 'ready') {
        // First load (up to 20 s on a first run): a card-shaped skeleton, the Memories slow line,
        // then why it takes long. No Cancel at 10 s (D-L1): the entry cards below already open.
        moment = (
            <MemoriesStatus
                query={hub}
                view="hub"
                skeleton={(
                    <div data-testid="memories-hub-moment-skeleton" className="w-full">
                        <Skeleton shape="block" className="h-36 w-full" />
                    </div>
                )}
                slowHint={t('memories.common.slow')}
                verySlowHint={t('memories.home.firstVerySlow')}
            />
        );
    } else if (data?.on_this_day) {
        moment = <OnThisDayCard moment={data.on_this_day} go={go} />;
    }

    return (
        <div data-testid="memories-home" data-service={service} className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6 pt-4">
            <h1 className="shrink-0 font-display text-heading text-primary">{t('memories.home.title')}</h1>
            <HubGatheringLine key={service} refreshing={hub.status === 'ready' && data?.refreshing === true} polling={hub.polling} capped={hub.pollCapped} />
            {/* The one scroll container: in a short pane the moment and every card scroll together. */}
            <div data-testid="memories-hub-board" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-1">
                {/* The wave-4 slots are mounted with or without a moment (the capsule stands alone). */}
                <HubSlots service={service} go={go} sameTime={data?.same_time ?? null} capsule={data?.capsule ?? null}>
                    {/* While loading, the moment's place is reserved from mount (`min-h-48`: the
                        pane's padding plus the `h-36` skeleton, about the On This Day card), so the
                        entry cards never move at the reveal. */}
                    {moment && (
                        <div data-testid="memories-hub-moment" className={cn('flex flex-col gap-3', hub.status === 'loading' && 'min-h-48')}>
                            {moment}
                        </div>
                    )}
                </HubSlots>
                <div className="grid auto-rows-min grid-cols-2 gap-3 md:grid-cols-3">
                    {HUB_CARDS.map((card) => (
                        card.action === 'recap' ? (
                            <RecapHubCard key={card.id} recap={recap} onOpenRecap={onOpenRecap} onRetry={onRetry} />
                        ) : (
                            <HubEntryCard key={card.id} card={card} line={hubCardLine(card, counts)} onOpen={() => go(card.route)} />
                        )
                    ))}
                    <CountdownCard countdown={data?.countdown ?? null} go={go} className="col-span-2" />
                </div>
            </div>
        </div>
    );
};
