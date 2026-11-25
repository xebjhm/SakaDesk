import type { MutableRefObject } from 'react';
import { clientLog } from '../../utils/clientLog';

const OWN_KEYS = 'input[type="range"], [role="slider"], [role="tablist"], [role="menu"]';

/**
 * True when a key typed in `target` belongs to the control it is in (a range such as a video seek or
 * volume, a tab list or a menu), so the media viewers must not claim the arrow keys. Logs the
 * decision once per viewer: the first time it returns true, `logged.current` is set and a
 * `media_playback` breadcrumb is written.
 */
export function leavesKeysToControl(target: EventTarget | null, logged: MutableRefObject<boolean>): boolean {
    if (!(target instanceof Element) || !target.closest(OWN_KEYS)) return false;
    if (!logged.current) {
        logged.current = true;
        clientLog('media_playback', { surface: 'viewer', phase: 'keys', outcome: 'left_to_control' });
    }
    return true;
}
