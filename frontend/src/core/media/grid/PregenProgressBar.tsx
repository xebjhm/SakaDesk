import React from 'react';
import { ProgressBar } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { cn } from '../../../utils/classnames';
import { pregenLabelKey, type PregenProgress } from './galleryStatus';

/**
 * A gallery's quiet background progress (in its footer): "Preparing thumbnails… done / total" as a
 * thin determinate bar while the pre-generation worker runs. While the worker is paused it says
 * so ("…paused · done / total") and dims, so a bar that is not moving never looks frozen.
 */
export const PregenProgressBar: React.FC<{ progress: PregenProgress; className?: string }> = ({ progress, className }) => {
    const { t } = useTranslation();
    const { done, total, paused } = progress;
    return (
        <ProgressBar
            value={done / total}
            label={t(pregenLabelKey(progress), { done, total })}
            valueText={`${done} / ${total}`}
            size="thin"
            showLabel
            labelClassName="text-caption text-muted"
            className={cn('max-w-xs', paused && 'opacity-60', className)}
        />
    );
};
