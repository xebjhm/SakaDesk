import type React from 'react';
import type { RecapOverview, RecapSlide } from './api';
import type { SlideProps } from './slides/common';
import { S01First } from './slides/S01First';
import { S02Name } from './slides/S02Name';
import { S03Clock } from './slides/S03Clock';
import { S04Greetings } from './slides/S04Greetings';
import { S05Photos } from './slides/S05Photos';
import { S06Voice } from './slides/S06Voice';
import { S07Letter } from './slides/S07Letter';
import { S08Echo } from './slides/S08Echo';
import { S09Special } from './slides/S09Special';
import { S10You } from './slides/S10You';
import { S11Daisuki } from './slides/S11Daisuki';
import { S12Sentence } from './slides/S12Sentence';
import { S13Oyasumi } from './slides/S13Oyasumi';

export interface SlideEntry {
    // Each entry renders its own slide key's data; the registry is keyed by slide key.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    component: React.ComponentType<SlideProps<any>>;
    /** No auto-advance: the slide calls `onMediaEnd` when its playback ends (the voice slide). */
    waitsForMedia?: boolean;
}

/** The multi-member opening's slides (`Opening.tsx`): each renders the members overview. */
export type OpeningSlideKey = 'o1_stars' | 'o2_titles';

export interface OpeningSlide {
    key: OpeningSlideKey;
    fallback: null;
    data: RecapOverview;
}

/** Anything the story player can play: a member's recap slide or an opening slide. */
export type PlayerSlide = RecapSlide | OpeningSlide;

export type SlideRegistry = Partial<Record<PlayerSlide['key'], SlideEntry>>;

/** Every recap slide. A slide with no entry is skipped (and logged) by the player. */
export const SLIDE_REGISTRY: SlideRegistry = {
    s01_first: { component: S01First },
    s02_name: { component: S02Name },
    s03_clock: { component: S03Clock },
    s04_greetings: { component: S04Greetings },
    s05_photos: { component: S05Photos },
    s06_voice: { component: S06Voice, waitsForMedia: true },
    s07_letter: { component: S07Letter },
    s08_echo: { component: S08Echo },
    s09_special: { component: S09Special },
    s10_you: { component: S10You },
    s11_daisuki: { component: S11Daisuki },
    s12_sentence: { component: S12Sentence },
    s13_oyasumi: { component: S13Oyasumi },
};
