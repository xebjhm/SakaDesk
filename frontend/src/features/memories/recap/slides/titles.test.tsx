import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../../../../i18n';
import { SLIDE_REGISTRY } from '../slideRegistry';
import { clockData, greetingsData, payload, photosData, s01, s02, s12, s13, voiceData } from '../__fixtures__/payload';
import type { RecapSlide } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const SLIDES: RecapSlide[] = [
    s01,
    s02,
    { key: 's03_clock', fallback: null, data: clockData() },
    { key: 's04_greetings', fallback: null, data: greetingsData() },
    { key: 's05_photos', fallback: null, data: photosData() },
    { key: 's06_voice', fallback: null, data: voiceData() },
    s12,
    s13(true, false),
];

describe('recap slide type voices', () => {
    it.each(SLIDES.map((s) => [s.key, s] as const))('%s: the title is serif display, narration stays the smaller sans', (_key, slide) => {
        const Slide = SLIDE_REGISTRY[slide.key]!.component;
        const { container } = render(
            <Slide data={slide.data} fallback={slide.fallback} recap={payload()} nickname="ゆき" reducedMotion paused={false} onMediaEnd={() => {}} />,
        );
        const titles = container.querySelectorAll('[data-voice="title"]');
        expect(titles).toHaveLength(1);
        const title = titles[0];
        expect(title.className).toMatch(/\bfont-display\b/);
        expect(title.className).not.toMatch(/\bfont-sans\b/);
        expect(title.className).toMatch(/\btext-heading\b/);
        // App copy in the UI language, never marked as her (Japanese) words.
        expect(title.hasAttribute('lang')).toBe(false);
        for (const n of Array.from(container.querySelectorAll('[data-voice="narration"]'))) {
            expect(n.className).toMatch(/\bfont-sans\b/);
            expect(n.className).not.toMatch(/\bfont-display\b/);
            expect(n.className).toMatch(/\btext-small\b/);
        }
        for (const q of Array.from(container.querySelectorAll('[data-voice="quote"]'))) {
            expect(q.className).toMatch(/\bfont-display\b/);
            expect(q).toHaveAttribute('lang', 'ja');
        }
    });
});
