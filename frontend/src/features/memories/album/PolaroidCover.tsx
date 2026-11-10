import React from 'react';
import { cn } from '../../../utils/classnames';
import { MemoryText } from '../shared/MemoryText';
import { MemoryThumb } from '../shared/MemoryThumb';
import type { MemoryMessage } from '../types';

/** The cover photo's drawn size (`w-40` minus the frame). */
const COVER_PX = 144;

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
 * `text`) in the display serif through `MemoryText`; without words, the month label as the
 * band's heading (`h2`; the band shows no heading of its own then).
 */
export const PolaroidCover: React.FC<PolaroidCoverProps> = ({ cover, label, sepia }) => {
    const words = cover.caption ?? cover.text;
    return (
        <figure
            data-testid="album-polaroid"
            className="w-40 shrink-0 -rotate-1 border border-memories-paper bg-memories-paper p-2 pb-3 shadow-memories-polaroid motion-reduce:rotate-0"
        >
            <div className="aspect-square w-full overflow-hidden bg-sunken">
                <MemoryThumb message={cover} px={COVER_PX} className={cn('h-full w-full', sepia)} />
            </div>
            <figcaption className="mt-2 font-display text-small text-primary">
                {words
                    ? <MemoryText as="span" text={words} className="block truncate whitespace-nowrap" />
                    : <h2 className="block truncate">{label}</h2>}
            </figcaption>
        </figure>
    );
};
