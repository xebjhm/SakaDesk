import React from 'react';
import type { HubPayload } from '../types';

interface HubSlotsProps {
    /** 同じ時刻 (spec 14.3), drawn above the wrapped card; always null in the core wave. */
    sameTime: HubPayload['same_time'];
    /** 時光膠囊 (spec 14.4), drawn below the wrapped card; always null in the core wave. */
    capsule: HubPayload['capsule'];
    /** The On This Day card the two slots sit around. */
    children?: React.ReactNode;
}

/**
 * The wave-4 hooks around the On This Day card. Both payload slots are always `null` in the
 * core wave, so this renders only `children`; wave 4 widens the types and adds the 同じ時刻 line
 * above and the capsule note below.
 */
export const HubSlots: React.FC<HubSlotsProps> = ({ children }) => <>{children}</>;
