import React from 'react';
import { cn } from '../../../utils/classnames';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';

interface PolaroidCoverProps {
    cover: MemoryMessage;
    /** The month label, shown when there are no words to caption the cover with. */
    label: string;
    /** `sepiaClass` of the month's year, applied to the photo only. */
    sepia: string;
}

/**
 * A month's polaroid cover (spec 8): warm paper frame with the polaroid shadow, the cover photo
 * (aged with `sepia`) and one caption line with her nearby words (`caption`, else her own
 * `text`) in the display serif through `MemoryText`; without words, the month label.
 */
export const PolaroidCover: React.FC<PolaroidCoverProps> = ({ cover, label, sepia }) => {
    const words = cover.caption ?? cover.text;
    return (
        <figure
            data-testid="album-polaroid"
            className="w-40 shrink-0 -rotate-1 border border-memories-paper bg-memories-paper p-2 pb-3 shadow-memories-polaroid motion-reduce:rotate-0"
        >
            <div className="aspect-square w-full overflow-hidden bg-sunken">
                <MemoryThumb message={cover} className={cn('h-full w-full', sepia)} />
            </div>
            <figcaption className="mt-2 font-display text-small text-primary">
                {words
                    ? <MemoryText as="span" text={words} className="block truncate whitespace-nowrap" />
                    : <span className="block truncate">{label}</span>}
            </figcaption>
        </figure>
    );
};
