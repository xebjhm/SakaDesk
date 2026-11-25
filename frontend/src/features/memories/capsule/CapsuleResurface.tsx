import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import type { MemoriesRoute } from '../MemoriesFeature';
import { logMemoriesCapsule } from '../memoriesLog';
import { jstDateFormat } from '../shared/jst';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import { sepiaClass } from '../shared/sepia';
import type { CapsuleResurfaceItem } from '../types';
import { CapsuleNoteCard } from './CapsuleNoteCard';

interface CapsuleResurfaceProps {
    item: CapsuleResurfaceItem;
    go: (next: MemoriesRoute) => void;
    className?: string;
}

const THUMB_PX = 64;
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/**
 * A resurfaced 時光膠囊 note (spec 14.4) beside her message of the anchor day: the note card,
 * 「{{count}}年前のあなたが書いたメモ」 (this JST year minus the year written, from the backend)
 * and her words (`MemoryText`, with a thumb when it is a photo) under her name and the message's
 * real JST date and time. Her message opens On This Day for the anchor date (that year's detail)
 * and logs `memories_capsule` `resurface_open`. Without words of hers that day the note stands
 * alone, beside her name when the backend names the person (a card anchor).
 */
export const CapsuleResurface: React.FC<CapsuleResurfaceProps> = ({ item, go, className }) => {
    const { t, i18n } = useTranslation();
    const format = useMemo(() => jstDateFormat(i18n.language, { time: true }), [i18n.language]);
    const { note, message } = item;
    const [thumbFailed, setThumbFailed] = useState<number | null>(null);
    const words = message ? (message.text ?? message.caption) : null;
    const still = message && (message.type === 'picture' || message.type === 'video') && message.media_url && thumbFailed !== message.id
        ? message
        : null;
    const anchorDate = note.anchor.date;

    const openDay = () => {
        logMemoriesCapsule('resurface_open', { kind: note.anchor.kind });
        go({ page: 'onThisDay', monthDay: anchorDate.slice(5), year: Number(anchorDate.slice(0, 4)) });
    };

    return (
        <section data-testid="capsule-resurface" className={cn('flex flex-col gap-3', className)}>
            <p className="font-display text-title text-primary">{t('memories.capsule.yearsAgo', { count: item.years_ago })}</p>
            <div className="flex flex-wrap items-start gap-4">
                <CapsuleNoteCard note={note} className="w-56 shrink-0" />
                {/* Without a message, a card note still says whose card it was. */}
                {!message && item.name && <span lang="ja" className="self-center text-small text-secondary">{item.name}</span>}
                {message && (
                    <button
                        type="button"
                        data-testid="capsule-resurface-message"
                        onClick={openDay}
                        className={cn(
                            'flex min-w-0 flex-1 basis-56 items-start gap-3 rounded-md border border-memories-paper bg-memories-paper p-3 text-left shadow-memories-polaroid',
                            FOCUS,
                        )}
                    >
                        {still && (
                            <MemoryThumb
                                message={still}
                                px={THUMB_PX}
                                onFail={() => setThumbFailed(still.id)}
                                className={cn('h-16 w-16 shrink-0 rounded-xs', sepiaClass(Number(anchorDate.slice(0, 4))))}
                            />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="flex items-baseline justify-between gap-2 text-caption text-muted">
                                {item.name && <span lang="ja" className="min-w-0 truncate text-secondary">{item.name}</span>}
                                <span className="shrink-0 tabular-nums">{format.format(new Date(message.ts))}</span>
                            </span>
                            {words && <MemoryText as="span" text={words} className="line-clamp-4 text-body text-primary" />}
                        </span>
                    </button>
                )}
            </div>
        </section>
    );
};
