import React, { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './radioAudio';

interface WaveformProps {
    /** The radio graph's analyser, or null without Web Audio. */
    analyser: AnalyserNode | null;
    /** Sound is playing (bars move only then). */
    active: boolean;
}

const BARS = 32;
/** The still bar row: a fixed, gentle contour (heights in %), never data. */
const STATIC_HEIGHTS = Array.from({ length: BARS }, (_, i) => Math.round(25 + Math.abs(Math.sin(i / 2.1) * Math.cos(i / 5)) * 60));
/** The lowest a live bar goes (%), so silence still reads as a waveform. */
const LIVE_FLOOR = 8;

/**
 * The now-playing waveform: live bars from the radio graph's `AnalyserNode` while playing, drawn by
 * writing each bar's height in a `requestAnimationFrame` loop (no re-render per frame). Without an
 * analyser (no `AudioContext`), while paused, or under `prefers-reduced-motion` it is a static bar
 * row. Bars are `bg-current` in the station's `text-memories-night-ink`, so their colour comes
 * from the token's CSS variable. Decorative (`aria-hidden`).
 */
export const Waveform: React.FC<WaveformProps> = ({ analyser, active }) => {
    const bars = useRef<Array<HTMLSpanElement | null>>([]);
    const live = Boolean(analyser) && active && !prefersReducedMotion();

    useEffect(() => {
        if (!live || !analyser) return;
        const nodes = bars.current;
        const data = new Uint8Array(analyser.frequencyBinCount);
        let frame = 0;
        const draw = () => {
            analyser.getByteFrequencyData(data);
            for (let i = 0; i < BARS; i++) {
                const el = nodes[i];
                if (!el) continue;
                const v = data[Math.min(data.length - 1, Math.floor((i / BARS) * data.length))] ?? 0;
                el.style.height = `${Math.max(LIVE_FLOOR, Math.round((v / 255) * 100))}%`;
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(frame);
            // Back to the still contour (React does not rewrite an unchanged style prop).
            nodes.forEach((el, i) => { if (el) el.style.height = `${STATIC_HEIGHTS[i]}%`; });
        };
    }, [live, analyser]);

    return (
        <div
            data-testid="waveform"
            data-mode={live ? 'live' : 'static'}
            aria-hidden="true"
            className="flex h-8 items-center gap-0.5"
        >
            {STATIC_HEIGHTS.map((h, i) => (
                <span
                    key={i}
                    ref={(el) => { bars.current[i] = el; }}
                    className="block w-1 rounded-full bg-current opacity-80"
                    style={{ height: `${h}%` }}
                />
            ))}
        </div>
    );
};
