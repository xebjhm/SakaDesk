import { useSyncExternalStore } from 'react';
import { openDialogCount, subscribeDialogStack } from './dialogStack';

const anyOpen = () => openDialogCount() > 0;

/** Whether any dialog is open, read from the dialog stack itself (not a copy). */
export function useAnyDialogOpen(): boolean {
    return useSyncExternalStore(subscribeDialogStack, anyOpen, () => false);
}
