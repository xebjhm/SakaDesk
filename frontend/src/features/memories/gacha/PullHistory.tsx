import React, { useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { JST_TIME_ZONE } from '../shared/jst';
import type { GachaPull } from '../types';
import { Capsule } from './CapsuleMachine';
import { pullKey } from './keys';
import { rarityKey } from './rarityCopy';

interface PullHistoryProps {
    /** Newest first, as the server sends them. */
    pulls: GachaPull[];
    /** The open card's `pullKey`, or null. */
    selectedKey: string | null;
    onSelect: (pull: GachaPull) => void;
}

/**
 * The pull history (spec 12): one row of small capsules in their rarity colour, each with its JST
 * pull date, newest first; clicking one reopens its card. The row scrolls inside itself. Nothing
 * is drawn before the first pull.
 */
export const PullHistory: React.FC<PullHistoryProps> = ({ pulls, selectedKey, onSelect }) => {
    const { t, i18n } = useTranslation();
    const day = useMemo(
        () => new Intl.DateTimeFormat(i18n.language, { timeZone: JST_TIME_ZONE, month: 'numeric', day: 'numeric' }),
        [i18n.language],
    );
    if (!pulls.length) return null;
    return (
        <ul aria-label={t('memories.gacha.history')} className="flex gap-2 overflow-x-auto px-4 py-2">
            {pulls.map((p) => {
                const key = pullKey(p);
                const date = day.format(new Date(`${p.jst_date}T00:00:00+09:00`));
                const current = key === selectedKey;
                return (
                    <li key={key} className="shrink-0">
                        <button
                            type="button"
                            aria-label={`${date} ${t(rarityKey(p.rarity))}`}
                            aria-current={current ? 'true' : undefined}
                            onClick={() => onSelect(p)}
                            className={cn(
                                'flex w-14 flex-col items-center gap-1 rounded-md p-1 text-caption tabular-nums text-secondary',
                                'transition-colors duration-fast ease-standard hover:bg-sunken motion-reduce:transition-none',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                                current && 'bg-sunken text-primary',
                            )}
                        >
                            <Capsule rarity={p.rarity} className="h-7 w-7" />
                            <span aria-hidden="true">{date}</span>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
};
