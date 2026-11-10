import React, { useEffect, useMemo } from 'react';
import { useTranslation } from '../../../i18n';
import { logMemoriesSkip } from '../memoriesLog';
import type { BinderCard, BinderPayload, BinderShelfKey } from '../types';
import { cardCopy } from './cardCopy';
import { CardTile } from './CardTile';
import { SHELVES } from './binderModel';

// Literal keys, so the i18n scanner and readers see every one of them.
const SHELF_COPY: Record<BinderShelfKey, { title: string; subtitle: string }> = {
    first: { title: 'memories.shelves.first.title', subtitle: 'memories.shelves.first.subtitle' },
    anniversary: { title: 'memories.shelves.anniversary.title', subtitle: 'memories.shelves.anniversary.subtitle' },
    numbers: { title: 'memories.shelves.numbers.title', subtitle: 'memories.shelves.numbers.subtitle' },
    special: { title: 'memories.shelves.special.title', subtitle: 'memories.shelves.special.subtitle' },
    records: { title: 'memories.shelves.records.title', subtitle: 'memories.shelves.records.subtitle' },
    moments: { title: 'memories.shelves.moments.title', subtitle: 'memories.shelves.moments.subtitle' },
    you: { title: 'memories.shelves.you.title', subtitle: 'memories.shelves.you.subtitle' },
    change: { title: 'memories.shelves.change.title', subtitle: 'memories.shelves.change.subtitle' },
    graduation: { title: 'memories.shelves.graduation.title', subtitle: 'memories.shelves.graduation.subtitle' },
};

interface BinderProps {
    binder: BinderPayload;
    onOpen: (card: BinderCard) => void;
}

/**
 * The 卡冊 binder (spec 5.3): one shelf per payload shelf in {@link SHELVES} order, each with its
 * serif Japanese title (`lang="ja"`, Japanese in every language) and a subtitle, then a wrapping
 * row of {@link CardTile}s. Cards whose key this build has no copy for are left out and counted
 * in one `memories_skip` `unknown_card` per binder.
 */
export const Binder: React.FC<BinderProps> = ({ binder, onOpen }) => {
    const { t } = useTranslation();
    const { shelves, unknown } = useMemo(() => {
        let skipped = 0;
        const out = SHELVES.flatMap((key) => {
            const shelf = binder.shelves.find((s) => s.key === key);
            if (!shelf) return [];
            const cards = shelf.cards.filter((c) => {
                const known = cardCopy(c.key) !== null;
                if (!known) skipped += 1;
                return known;
            });
            return cards.length ? [{ key, cards }] : [];
        });
        return { shelves: out, unknown: skipped };
    }, [binder]);

    useEffect(() => {
        if (unknown) logMemoriesSkip('binder', 'unknown_card', { count: unknown });
    }, [binder, unknown]);

    return (
        <div data-testid="binder" className="flex flex-col gap-8 p-4">
            {shelves.map((shelf) => (
                <section key={shelf.key} data-testid="binder-shelf" data-shelf={shelf.key} aria-labelledby={`binder-shelf-${shelf.key}`}>
                    <div className="mb-3 flex items-baseline gap-3">
                        <h2 id={`binder-shelf-${shelf.key}`} lang="ja" className="font-display text-title text-primary">
                            {t(SHELF_COPY[shelf.key].title)}
                        </h2>
                        <p data-testid="binder-shelf-subtitle" className="text-small text-muted">{t(SHELF_COPY[shelf.key].subtitle)}</p>
                    </div>
                    <div className="flex flex-wrap gap-4">
                        {shelf.cards.map((card) => <CardTile key={card.key} card={card} onOpen={onOpen} />)}
                    </div>
                </section>
            ))}
        </div>
    );
};
