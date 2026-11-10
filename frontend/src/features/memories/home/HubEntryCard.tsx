import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import type { HubCardDef } from './hubCards';

/** The clickable face of a hub card: neutral, the accent only as the hover glow and focus ring. */
export const HUB_CARD_BUTTON =
    'flex h-full w-full flex-col items-center justify-center gap-2 rounded-card px-4 py-5 text-primary transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** A hub card's still face (also used by the non-clickable recap states). */
export const HUB_CARD_STILL = 'flex h-full w-full flex-col items-center justify-center gap-2 px-4 py-5 text-primary';

interface HubCardFaceProps {
    icon: LucideIcon;
    title: React.ReactNode;
    /** The line under the title (a count, a state); nothing when null. */
    sub?: React.ReactNode;
}

/** Icon disc, serif title and one quiet line: every hub entry card looks like this. */
export const HubCardFace: React.FC<HubCardFaceProps> = ({ icon: Icon, title, sub }) => (
    <>
        <span aria-hidden="true" className="flex rounded-full bg-expressive-soft p-3 text-muted">
            <Icon className="h-6 w-6" />
        </span>
        <span className="font-display text-title">{title}</span>
        {sub !== null && sub !== undefined && <span className="text-small tabular-nums text-secondary">{sub}</span>}
    </>
);

interface HubEntryCardProps {
    card: HubCardDef;
    /** The number to show (already checked above zero), or null for none. */
    count: number | null;
    onOpen: () => void;
}

/** One routed entry card of the hub (album, memoir, favorites; wave 4 adds more). */
export const HubEntryCard: React.FC<HubEntryCardProps> = ({ card, count, onOpen }) => {
    const { t } = useTranslation();
    const sub = count !== null && card.countKey ? t(card.countLabelKey, { count }) : null;
    return (
        <Card className="h-full p-0">
            <button type="button" data-testid={`memories-hub-card-${card.id}`} onClick={onOpen} className={HUB_CARD_BUTTON}>
                <HubCardFace icon={card.icon} title={t(card.titleKey)} sub={sub} />
            </button>
        </Card>
    );
};
