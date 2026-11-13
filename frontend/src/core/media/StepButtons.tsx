import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../design/primitives';
import { useTranslation } from '../../i18n';

export interface StepButtonsProps {
    hasOlder: boolean;
    hasNewer: boolean;
    onOlder: () => void;
    onNewer: () => void;
    /**
     * `time` (default): the items are a timeline, so the buttons say older / newer. `reading`: the
     * items are the images of one post, in reading order, so they say previous / next photo.
     */
    sequence?: 'time' | 'reading';
}

/**
 * Older / newer overlay buttons on a dark viewer (UI health A-K5; DESIGN_SYSTEM "Left is older,
 * right is newer"; a `reading` sequence says previous / next photo). At an end the button keeps its
 * colour at 40 %, stays focusable and says why it does nothing (`disabledReason`, DESIGN_SYSTEM §9).
 */
export const StepButtons: React.FC<StepButtonsProps> = ({ hasOlder, hasNewer, onOlder, onNewer, sequence = 'time' }) => {
    const { t } = useTranslation();
    const keys = sequence === 'reading'
        ? { back: 'media.previousPhoto', forward: 'media.nextPhoto', noBack: 'media.firstPhoto', noForward: 'media.lastPhoto' }
        : { back: 'media.older', forward: 'media.newer', noBack: 'media.noOlder', noForward: 'media.noNewer' };
    return (
        <>
            <IconButton
                variant="overlay"
                className="absolute left-4 top-1/2 z-10 -translate-y-1/2"
                aria-label={t(keys.back)}
                disabledReason={hasOlder ? undefined : t(keys.noBack)}
                icon={<ChevronLeft />}
                onClick={onOlder}
            />
            <IconButton
                variant="overlay"
                className="absolute right-4 top-1/2 z-10 -translate-y-1/2"
                aria-label={t(keys.forward)}
                disabledReason={hasNewer ? undefined : t(keys.noForward)}
                icon={<ChevronRight />}
                onClick={onNewer}
            />
        </>
    );
};
