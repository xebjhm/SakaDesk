import React from 'react';
import type { MemoriesRoute } from '../MemoriesFeature';
import { CapsuleResurface } from '../capsule/CapsuleResurface';
import type { HubPayload } from '../types';
import { SameTimeLine } from './SameTimeLine';

interface HubSlotsProps {
    service: string;
    /** 同じ時刻 (spec 14.3), drawn above the wrapped card; null hides it (until a later minute has one). */
    sameTime: HubPayload['same_time'];
    /** 時光膠囊 (spec 14.4), drawn below the wrapped card; null hides it. */
    capsule: HubPayload['capsule'];
    go: (next: MemoriesRoute) => void;
    /** The On This Day card the two slots sit around. */
    children?: React.ReactNode;
}

/**
 * The wave-4 slots around the hub's On This Day card: the 同じ時刻 line above (it refreshes
 * itself each JST minute and renders nothing without a moment) and the resurfaced capsule note
 * below (only when the hub has one).
 */
export const HubSlots: React.FC<HubSlotsProps> = ({ service, sameTime, capsule, go, children }) => (
    <>
        <SameTimeLine service={service} initial={sameTime} go={go} />
        {children}
        {capsule && <CapsuleResurface item={capsule} go={go} />}
    </>
);
