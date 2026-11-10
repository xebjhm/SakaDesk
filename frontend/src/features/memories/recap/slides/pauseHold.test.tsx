/**
 * The player's pause holds every animation on the R4/R5 slides (S01–S06, S12, S13): the reveals and
 * their stagger delays, the S03 star fall, the S05 photo fan and the S13 light. One case per slide.
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../../../../i18n';
import { clockData, greetingsData, payload, photosData, s01, s02, s12, s13, voiceData } from '../__fixtures__/payload';
import type { SlideProps } from './common';
import { S01First } from './S01First';
import { S02Name } from './S02Name';
import { S03Clock } from './S03Clock';
import { S04Greetings } from './S04Greetings';
import { S05Photos } from './S05Photos';
import { S06Voice } from './S06Voice';
import { S12Sentence } from './S12Sentence';
import { S13Oyasumi } from './S13Oyasumi';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySlide = React.ComponentType<SlideProps<any>>;

const CASES: [string, AnySlide, unknown, string[]][] = [
    ['S01First', S01First, s01.data, []],
    ['S02Name', S02Name, s02.data, []],
    ['S03Clock', S03Clock, clockData(), ['[data-testid="s03-star"]']],
    ['S04Greetings', S04Greetings, greetingsData(), ['[data-testid="s04-card"]']],
    ['S05Photos', S05Photos, photosData(), ['[data-testid="s05-burst-item"]']],
    ['S06Voice', S06Voice, voiceData(), []],
    ['S12Sentence', S12Sentence, s12.data, []],
    ['S13Oyasumi', S13Oyasumi, s13(true, false).data, ['[data-testid="s13-light"]']],
];

function renderSlide(Slide: AnySlide, data: unknown, paused: boolean, reducedMotion = false) {
    return render(
        <Slide data={data} fallback={null} recap={payload()} nickname="ゆき" reducedMotion={reducedMotion} paused={paused} onMediaEnd={() => {}} />,
    );
}

/** Every element running a CSS animation (`animate-*`), SVG elements included. */
function animated(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('[class*="animate-"]'));
}

describe('R4/R5 slides hold their animations while the player is paused', () => {
    it.each(CASES)('%s: every animation is paused while paused and runs otherwise', (_name, Slide, data, required) => {
        const paused = renderSlide(Slide, data, true);
        const held = animated(paused.container);
        expect(held.length).toBeGreaterThan(0);
        for (const el of held) expect(el.style.animationPlayState, el.outerHTML.slice(0, 80)).toBe('paused');
        // The slide-specific motion (stars, fan, cards, light) is among the held elements.
        for (const sel of required) {
            const els = Array.from(paused.container.querySelectorAll<HTMLElement>(sel));
            expect(els.length, sel).toBeGreaterThan(0);
            for (const el of els) expect(el.style.animationPlayState, sel).toBe('paused');
        }
        paused.unmount();

        const running = renderSlide(Slide, data, false);
        for (const el of animated(running.container)) expect(el.style.animationPlayState).toBe('running');
        running.unmount();
    });

    it.each(CASES)('%s: reduced motion has no animation to hold', (_name, Slide, data) => {
        const { container } = renderSlide(Slide, data, true, true);
        expect(animated(container)).toEqual([]);
    });
});
