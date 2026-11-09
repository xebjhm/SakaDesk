import React from 'react';
import { Sheet } from '../../design/primitives';
import { cn } from '../../utils/classnames';

/** The one content sheet (level 1) on the group canvas, 8 px from the frame. */
export const ContentSheet: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <Sheet className={cn('my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden', className)}>{children}</Sheet>
);
