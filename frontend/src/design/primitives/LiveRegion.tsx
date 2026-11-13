import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/classnames';

/**
 * An always-mounted, visually hidden polite status (UI health A-D2): a region that mounts together
 * with its text is often not announced, so this one stays in the document and only its text
 * changes (the CallOverlay pattern). Pass '' when there is nothing to say.
 *
 * It is portaled to <body>: while a dialog is open `#root` and the dialogs below the top one are
 * inert, and inert content is not announced, so a region inside `#root` would stay silent. In
 * <body> it announces whether it is used from the app or from inside a dialog (the photo viewer).
 */
export const LiveRegion: React.FC<{ message: string; className?: string }> = ({ message, className }) =>
    createPortal(
        <div role="status" aria-live="polite" className={cn('sr-only', className)}>{message}</div>,
        document.body,
    );
