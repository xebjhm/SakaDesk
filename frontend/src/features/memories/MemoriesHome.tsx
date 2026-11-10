import React from 'react';
import { useTranslation } from '../../i18n';
import type { MemoriesRoute } from './MemoriesFeature';
import { fetchHub } from './api';
import { CountdownCard } from './home/CountdownCard';
import { HubEntryCard } from './home/HubEntryCard';
import { HubSlots } from './home/HubSlots';
import { HUB_CARDS, hubCardCount } from './home/hubCards';
import { OnThisDayCard } from './home/OnThisDayCard';
import { RecapHubCard, type RecapCardState } from './home/RecapHubCard';
import { LoadState } from './shared/LoadState';
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
 * The Memories hub board (spec 4), a fixed viewport: the title, the large On This Day card
 * (with the wave-4 slots around it), then a grid of entry cards that scrolls inside itself
 * when the pane is short. The entry cards are usable while `/hub` loads or after it fails
 * (they only lack their counts); the moment's place shows the loading line or the retry. A
 * zero count shows no number; a `null` moment or countdown leaves its card out. The recap
 * card keeps its own shelf states (`RecapHubCard`).
 */
export const MemoriesHome: React.FC<MemoriesHomeProps> = ({ service, recap, onOpenRecap, onRetry, go }) => {
    const { t } = useTranslation();
    const hub = useMemoriesQuery('hub', (signal) => fetchHub(service, signal), [service], {
        count: (d) => (d.on_this_day ? 1 : 0),
    });
    const data = hub.data;

    let moment: React.ReactNode = null;
    if (hub.status !== 'ready') {
        moment = <LoadState status={hub.status} onRetry={hub.retry} />;
    } else if (data?.on_this_day) {
        moment = (
            <HubSlots sameTime={data.same_time} capsule={data.capsule}>
                <OnThisDayCard moment={data.on_this_day} go={go} />
            </HubSlots>
        );
    }

    return (
        <div data-testid="memories-home" data-service={service} className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 pb-6 pt-4">
            <h1 className="shrink-0 font-display text-heading text-primary">{t('memories.home.title')}</h1>
            {moment && <div data-testid="memories-hub-moment" className="flex shrink-0 flex-col gap-3">{moment}</div>}
            <div className="grid min-h-0 flex-1 auto-rows-min content-start grid-cols-2 gap-3 overflow-y-auto p-1 md:grid-cols-3">
                {HUB_CARDS.map((card) => (
                    card.action === 'recap' ? (
                        <RecapHubCard key={card.id} recap={recap} onOpenRecap={onOpenRecap} onRetry={onRetry} />
                    ) : (
                        <HubEntryCard key={card.id} card={card} count={hubCardCount(card, data?.counts ?? null)} onOpen={() => go(card.route)} />
                    )
                ))}
                <CountdownCard countdown={data?.countdown ?? null} go={go} className="col-span-2" />
            </div>
        </div>
    );
};
