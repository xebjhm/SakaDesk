/**
 * Memories type roles shared by the year recap and the あの日と今日 slide pair. Her words are serif
 * display (`QUOTE_CLASS`, marked `lang="ja"` by the caller); the app's narration is the smaller
 * sans UI face (`Narration`), so it is never mistaken for her words. `data-voice` names the role
 * for tests and the share canvas.
 */
import React from 'react';
import { cn } from '../../../utils/classnames';

/** Her words: serif display. */
export const QUOTE_CLASS = 'font-display text-heading font-medium';
/** App narration: smaller sans, so it never reads as her words. */
export const NARRATION_CLASS = 'font-sans text-small';

interface NarrationProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export const Narration: React.FC<NarrationProps> = ({ children, className, style }) => (
    <p data-voice="narration" className={cn(NARRATION_CLASS, 'text-secondary', className)} style={style}>
        {children}
    </p>
);
