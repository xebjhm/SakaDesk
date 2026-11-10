import React from 'react';
import type { HubPayload } from '../types';

interface HubSlotsProps {
    /** 同じ時刻 (spec 14.3), drawn above the wrapped card; null hides it. */
    sameTime: HubPayload['same_time'];
    /** 時光膠囊 (spec 14.4), drawn below the wrapped card; null hides it. */
    capsule: HubPayload['capsule'];
    /** The On This Day card the two slots sit around. */
    children?: React.ReactNode;
}

/**
 * The wave-4 hooks around the On This Day card. The payload types are wide (F7); until the
 * 同じ時刻 line (above) and the capsule note (below) are drawn by their task, this renders only
 * `children`.
 */
export const HubSlots: React.FC<HubSlotsProps> = ({ children }) => <>{children}</>;
