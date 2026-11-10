import React from 'react';
import { StatusBlock } from '../../design/primitives';

export interface DialogStatusProps {
    kind: 'loading' | 'empty';
    title?: string;        // translated
    hint?: string;         // translated
    icon?: React.ReactNode;
    className?: string;
}

/**
 * @deprecated Use `StatusBlock` (`design/primitives`) directly; removed in L7 once the two
 * gallery modals (`MediaGalleryModal`, `BlogPhotoGalleryModal`) are rebuilt on it.
 *
 * Thin adapter: `loading` shows `title` as the wait's label (after the reveal delay), `empty` is the
 * `EmptyState` brand moment. The error kind is gone; callers use `StatusBlock kind="error"`.
 */
export const DialogStatus: React.FC<DialogStatusProps> = ({ kind, title, hint, icon, className }) =>
    kind === 'empty' ? (
        <StatusBlock kind="empty" variant="dialog" surface="dialog" title={title ?? ''} hint={hint} icon={icon} className={className} />
    ) : (
        <StatusBlock kind="loading" variant="dialog" surface="dialog" label={title} labelVisibility={title ? 'always' : 'auto'} className={className} />
    );
