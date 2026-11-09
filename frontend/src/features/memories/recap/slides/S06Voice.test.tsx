import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { clip, payload, voiceData } from '../__fixtures__/payload';
import { fakeAudioFactory } from '../__fixtures__/fakeAudio';
import type { S06VoiceData } from '../api';
import { SLIDE_REGISTRY } from '../slideRegistry';

const audio = vi.hoisted(() => ({ factory: null as null | { create: () => HTMLAudioElement } }));
vi.mock('../voicePlayback', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../voicePlayback')>();
    return { ...mod, createAudioElement: () => audio.factory!.create() };
});
vi.mock('../../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../../utils/clientLog';
import { S06Voice } from './S06Voice';
import { CROSSFADE_MS } from '../voicePlayback';

let f: ReturnType<typeof fakeAudioFactory>;

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    f = fakeAudioFactory();
    audio.factory = f;
    vi.mocked(clientLog).mockClear();
    vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); });

const renderS06 = (data: S06VoiceData, fallback: string | null = null, onMediaEnd = vi.fn()) => {
    const view = (paused: boolean) => (
        <S06Voice data={data} fallback={fallback} recap={payload()} nickname="ゆき" reducedMotion={false} paused={paused} onMediaEnd={onMediaEnd} />
    );
    const r = render(view(false));
    return { onMediaEnd, ...r, setPaused: (paused: boolean) => r.rerender(view(paused)) };
};

const press = () => fireEvent.click(screen.getByRole('button', { name: '声を聴く' }));

describe('S06Voice', () => {
    it('waits for the fan: nothing plays until ▶ is pressed', () => {
        renderS06(voiceData());
        expect(SLIDE_REGISTRY.s06_voice?.waitsForMedia).toBe(true);
        expect(screen.getByText('今年、届いた声。')).toBeInTheDocument();
        expect(screen.getByText('今年、24回 声が届いた。')).toBeInTheDocument();
        expect(screen.getByText('▶を押すと、声が流れます。')).toBeInTheDocument();
        expect(f.made.every((a) => a.playCalls === 0)).toBe(true);
    });

    it('▶ plays the first clip from its server URL and shows its subtitle with the nickname', () => {
        renderS06(voiceData());
        press();
        const [a] = f.made;
        expect(a.src).toBe('/api/media/v20.m4a');
        expect(a.paused).toBe(false);
        expect(screen.queryByRole('button', { name: '声を聴く' })).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('再生中');
        act(() => { a.tick(1); });
        expect(screen.getByText('ゆき、聞こえる？')).toHaveAttribute('data-voice', 'quote');
    });

    it('plays the three clips in sequence with crossfades, then tells the player', () => {
        const { onMediaEnd } = renderS06(voiceData());
        press();
        const [a, b] = f.made;
        act(() => { a.tick(5.8); });
        expect(b.src).toBe('/api/media/v21.m4a');
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        act(() => { b.tick(5.8); });
        expect(a.src).toBe('/api/media/v22.m4a');
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        expect(onMediaEnd).not.toHaveBeenCalled();
        act(() => { a.tick(5.8); });
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        expect(onMediaEnd).toHaveBeenCalledTimes(1);
    });

    it('a single clip plays its opening up to the end the backend sent', () => {
        const { onMediaEnd } = renderS06(voiceData({ clips: [clip(40, { start: 0, end: 12 })], voice_count: 1 }), 'single');
        press();
        const [a] = f.made;
        expect(a.currentTime).toBe(0);
        act(() => { a.tick(6); });
        expect(onMediaEnd).not.toHaveBeenCalled();
        act(() => { a.fire('ended'); });
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        expect(onMediaEnd).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/回/)).toBeNull();
    });

    it('video audio says where the voice came from and shows no count', () => {
        const video = clip(50, { message: { ...clip(50).message, type: 'video', media_url: '/api/media/m50.mp4' } });
        renderS06({ clips: [video], voice_count: null }, 'video');
        expect(screen.getByText('動画から届いた声。')).toBeInTheDocument();
        press();
        expect(f.made[0].src).toBe('/api/media/m50.mp4');
    });

    it('stops playback when the slide goes away', () => {
        const { unmount, onMediaEnd } = renderS06(voiceData());
        press();
        act(() => { f.made[0].tick(5.8); });
        unmount();
        expect(f.made.every((a) => a.paused)).toBe(true);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(onMediaEnd).not.toHaveBeenCalled();
    });

    it('the player\'s pause holds the voice and its resume plays on', () => {
        const { setPaused } = renderS06(voiceData());
        press();
        const [a] = f.made;
        act(() => { a.tick(2); });
        setPaused(true);
        expect(a.paused).toBe(true);
        setPaused(false);
        expect(a.paused).toBe(false);
    });

    it('the player\'s pause holds both voices of a crossfade and the end', () => {
        const { setPaused, onMediaEnd } = renderS06(voiceData({ clips: [clip(20), clip(21)], voice_count: 2 }));
        press();
        const [a, b] = f.made;
        act(() => { a.tick(5.8); });
        act(() => { vi.advanceTimersByTime(100); });
        setPaused(true);
        expect(a.paused).toBe(true);
        expect(b.paused).toBe(true);
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(onMediaEnd).not.toHaveBeenCalled();
        setPaused(false);
        expect(a.paused).toBe(false);
        expect(b.paused).toBe(false);
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        act(() => { b.tick(5.8); });
        act(() => { vi.advanceTimersByTime(CROSSFADE_MS); });
        expect(onMediaEnd).toHaveBeenCalledTimes(1);
    });

    it('▶ is disabled while the player is paused', () => {
        const { setPaused } = renderS06(voiceData());
        setPaused(true);
        const button = screen.getByRole('button', { name: '声を聴く' });
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(f.made.every((a) => a.playCalls === 0)).toBe(true);
    });

    it('no playable clip: skips on to the next slide and logs it', () => {
        const { onMediaEnd } = renderS06({ clips: [clip(60, { message: { ...clip(60).message, media_url: null } })], voice_count: 3 });
        expect(onMediaEnd).toHaveBeenCalledTimes(1);
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('recap_play', expect.objectContaining({ phase: 'skip', key: 's06_voice', reason: 'no_media' }));
    });

    it('logs the voice decisions with ids and codes only', () => {
        renderS06(voiceData());
        press();
        act(() => { f.made[0].fire('error'); });
        const calls = vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_play');
        expect(calls).toContainEqual(['recap_play', expect.objectContaining({ phase: 'voice_start', key: 's06_voice', count: 3 })]);
        expect(calls).toContainEqual(['recap_play', expect.objectContaining({ phase: 'voice_error', index: 0, reason: 'media_error' })]);
        for (const [, fields] of calls) {
            for (const v of Object.values(fields ?? {})) {
                if (typeof v === 'string') expect(v).toMatch(/^[a-z0-9_]{1,40}$/);
            }
        }
    });

    it('the play button stays clickable above the stage\'s step zones', () => {
        renderS06(voiceData());
        expect(screen.getByRole('button', { name: '声を聴く' }).className).toMatch(/pointer-events-auto/);
    });

    it('never prints null, undefined or NaN', () => {
        renderS06(voiceData({ voice_count: null }));
        expect(document.body.textContent).not.toMatch(/null|undefined|NaN/);
    });
});
