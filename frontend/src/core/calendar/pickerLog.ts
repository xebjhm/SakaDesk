import { clientLog } from '../../utils/clientLog';

/**
 * The `calendar_picker` breadcrumbs the host logs itself: `open` (`count` years offered) when its
 * title opens the picker, `back` when its own back control (`button`) or an Escape outside the
 * picker (`escape`) returns to the days. The picker logs `select` and an Escape inside it.
 */
export const monthYearPickerLog = {
    open: (count: number) => clientLog('calendar_picker', { phase: 'open', count }),
    back: (reason: 'escape' | 'button') => clientLog('calendar_picker', { phase: 'back', reason }),
};
