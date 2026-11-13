import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../../design/primitives';
import { useTranslation } from '../../i18n';

export interface StepButtonsProps {
    hasOlder: boolean;
    hasNewer: boolean;
    onOlder: () => void;
    onNewer: () => void;
}

/**
 * Older / newer overlay buttons on a dark viewer (UI health A-K5; DESIGN_SYSTEM "Left is older,
 * right is newer"). At an end the button keeps its colour at 40 %, stays focusable and says why it
 * does nothing (`disabledReason`, DESIGN_SYSTEM §9).
 */
export const StepButtons: React.FC<StepButtonsProps> = ({ hasOlder, hasNewer, onOlder, onNewer }) => {
    const { t } = useTranslation();
    return (
        <>
            <IconButton
                variant="overlay"
                className="absolute left-4 top-1/2 z-10 -translate-y-1/2"
                aria-label={t('media.older')}
                disabledReason={hasOlder ? undefined : t('media.noOlder')}
                icon={<ChevronLeft />}
                onClick={onOlder}
            />
            <IconButton
                variant="overlay"
                className="absolute right-4 top-1/2 z-10 -translate-y-1/2"
                aria-label={t('media.newer')}
                disabledReason={hasNewer ? undefined : t('media.noNewer')}
                icon={<ChevronRight />}
                onClick={onNewer}
            />
        </>
    );
};
