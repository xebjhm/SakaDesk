import type React from 'react';
import type { RecapSlideKey } from './api';
import type { SlideProps } from './slides/common';
import { S01First } from './slides/S01First';
import { S02Name } from './slides/S02Name';
import { S12Sentence } from './slides/S12Sentence';
import { S13Oyasumi } from './slides/S13Oyasumi';

export interface SlideEntry {
    // Each entry renders its own slide key's data; the registry is keyed by slide key.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: React.ComponentType<SlideProps<any>>;
    /** No auto-advance: the slide calls `onMediaEnd` when its playback ends (the voice slide). */
    waitsForMedia?: boolean;
}

export type SlideRegistry = Partial<Record<RecapSlideKey, SlideEntry>>;

/** The slides built so far; later tasks add theirs. A slide with no entry is skipped. */
export const SLIDE_REGISTRY: SlideRegistry = {
    s01_first: { component: S01First },
    s02_name: { component: S02Name },
    s12_sentence: { component: S12Sentence },
    s13_oyasumi: { component: S13Oyasumi },
};
