import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { fakeAudioFactory } from '../recap/__fixtures__/fakeAudio';
import { fadeOutMemoriesVoices, stopMemoriesVoices, useVoicePlayback } from '../shared/voicePlayback';
import { CROSSFADE_MS } from '../shared/clipSequencer';
import { RADIO_GAP_MS, RADIO_VOICE_KEY, useRadioPlayer } from './useRadioPlayer';
import { radioTrack } from './__fixtures__';

const flush = () => act(() => Promise.resolve().then(() => Promise.resolve()));

const radioLogs = () => vi.mocked(clientLog).mock.calls.filter(([event]) => event === 'memories_radio').map(([, p]) => p);

function setup() {
    const f = fakeAudioFactory();
    const hook = renderHook(() => useRadioPlayer({ createElement: f.create }));
    return { f, hook, player: () => hook.result.current };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(clientLog).mockClear();
    useVoicePlayback.setState({ playing: null, handle: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('useRadioPlayer', () => {
    it('plays a regular program as whole voices with an 800 ms gap and registers as the radio voice', () => {
        const { f, player } = setup();
        act(() => player().play('oyasumi', [radioTrack(1), radioTrack(2)]));
        expect(player().status).toBe('playing');
        expect(player().index).toBe(0);
        expect(player().track?.message.id).toBe(1);
        expect(useVoicePlayback.getState().playing).toBe(RADIO_VOICE_KEY);
        const [a, b] = f.made;
        expect(a.src).toBe('/api/media/hinatazaka46/voice/1.m4a');
        expect(a.paused).toBe(false);
        // A whole voice plays to its own end (no cut at the known length) ...
        act(() => a.tick(42));
        expect(b.paused).toBe(true);
        act(() => a.fire('ended'));
        // ... then a silent gap, then the next voice.
        expect(RADIO_GAP_MS).toBe(800);
        act(() => { vi.advanceTimersByTime(799); });
        expect(b.paused).toBe(true);
        act(() => { vi.advanceTimersByTime(1); });
        expect(b.src).toBe('/api/media/hinatazaka46/voice/2.m4a');
        expect(b.paused).toBe(false);
        expect(player().index).toBe(1);
        expect(radioLogs()).toContainEqual({ phase: 'play', kind: 'oyasumi', count: 2, outcome: 'ok' });
        expect(radioLogs()).toContainEqual({ phase: 'track', kind: 'oyasumi', index: 1 });
    });

    it('crossfades the 精選 clips over their windows', () => {
        const { f, player } = setup();
        const clip = (id: number) => radioTrack(id, {
            start: 10, end: 14, has_transcript: true, segments: [{ start: 11, end: 13, text: 'おやすみ' }],
        });
        act(() => player().play('oyasumi_clips', [clip(1), clip(2)]));
        const [a, b] = f.made;
        expect(a.currentTime).toBe(10);
        act(() => a.tick(14 - CROSSFADE_MS / 1000));
        // No gap: the next clip starts at once, fading in.
        expect(b.paused).toBe(false);
        expect(b.currentTime).toBe(10);
        expect(b.volume).toBe(0);
    });

    it('skips a voice without media and reports a program with nothing playable as failed', () => {
        const { f, player } = setup();
        const silent = radioTrack(9, { message: { ...radioTrack(9).message, media_url: null } });
        act(() => player().play('favorites', [silent]));
        expect(f.made).toHaveLength(0);
        expect(player().status).toBe('ended');
        expect(radioLogs()).toContainEqual({ phase: 'play', kind: 'favorites', count: 0, outcome: 'failed' });
    });

    it('pauses, resumes, steps next and prev', () => {
        const { f, player } = setup();
        act(() => player().play('chrono', [radioTrack(1), radioTrack(2), radioTrack(3)]));
        const [a] = f.made;
        act(() => player().toggle());
        expect(player().status).toBe('paused');
        expect(a.paused).toBe(true);
        act(() => player().toggle());
        expect(player().status).toBe('playing');
        expect(a.paused).toBe(false);
        act(() => player().next());
        expect(player().index).toBe(1);
        act(() => player().prev());
        expect(player().index).toBe(0);
        expect(radioLogs()).toEqual(expect.arrayContaining([
            { phase: 'pause', kind: 'chrono' },
            { phase: 'resume', kind: 'chrono', outcome: 'ok' },
        ]));
    });

    it('skips on after a track error and logs it', () => {
        const { f, player } = setup();
        act(() => player().play('ohayo', [radioTrack(1), radioTrack(2)]));
        act(() => f.made[0].fire('error'));
        expect(radioLogs()).toContainEqual({ phase: 'track_error', kind: 'ohayo', index: 0, reason: 'media_error' });
        act(() => { vi.advanceTimersByTime(800); });
        expect(player().index).toBe(1);
        expect(player().status).toBe('playing');
    });

    it('ends at the end of the queue and turns the lamp off', () => {
        const { f, player } = setup();
        act(() => player().play('otsukare', [radioTrack(1)]));
        act(() => f.made[0].fire('ended'));
        act(() => { vi.advanceTimersByTime(10); });
        expect(player().status).toBe('ended');
        expect(useVoicePlayback.getState().playing).toBeNull();
        expect(radioLogs()).toContainEqual({ phase: 'end', kind: 'otsukare', reason: 'queue_end' });
    });

    it('stops when another Memories voice starts', () => {
        const { f, player } = setup();
        act(() => player().play('oyasumi', [radioTrack(1), radioTrack(2)]));
        act(() => useVoicePlayback.getState().play('x'));
        expect(player().status).toBe('idle');
        expect(f.made[0].paused).toBe(true);
        expect(radioLogs()).toContainEqual({ phase: 'end', kind: 'oyasumi', reason: 'preempted' });
    });

    it('stops (reason user) when the page silences every voice', () => {
        const { f, player } = setup();
        act(() => player().play('oyasumi', [radioTrack(1)]));
        act(() => stopMemoriesVoices());
        expect(player().status).toBe('idle');
        expect(player().track).toBeNull();
        expect(f.made[0].paused).toBe(true);
        expect(radioLogs()).toContainEqual({ phase: 'end', kind: 'oyasumi', reason: 'user' });
    });

    it('fades out for the sleep timer: the lamp goes off at once, then it stops', async () => {
        const { f, player } = setup();
        act(() => player().play('oyasumi', [radioTrack(1)]));
        let done = false;
        act(() => { void fadeOutMemoriesVoices(10_000).then(() => { done = true; }); });
        expect(player().status).toBe('fading');
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(f.made[0].volume).toBeGreaterThan(0.3);
        expect(f.made[0].volume).toBeLessThan(0.7);
        act(() => { vi.advanceTimersByTime(5_000); });
        await flush();
        expect(done).toBe(true);
        expect(f.made[0].paused).toBe(true);
        expect(player().status).toBe('idle');
        expect(radioLogs()).toContainEqual({ phase: 'end', kind: 'oyasumi', reason: 'sleep_timer' });
    });

    it('a new program replaces the old sequencer; unmount stops it', () => {
        const { f, player, hook } = setup();
        act(() => player().play('oyasumi', [radioTrack(1)]));
        act(() => player().play('ohayo', [radioTrack(5)]));
        expect(f.made).toHaveLength(4);
        expect(f.made[0].paused).toBe(true);
        expect(f.made[2].src).toBe('/api/media/hinatazaka46/voice/5.m4a');
        expect(player().program).toBe('ohayo');
        hook.unmount();
        expect(f.made[2].paused).toBe(true);
        expect(useVoicePlayback.getState().playing).toBeNull();
    });

    it('reports the playhead of the current track', () => {
        const { f, player } = setup();
        act(() => player().play('oyasumi', [radioTrack(1)]));
        act(() => f.made[0].tick(12.5));
        expect(player().currentTime).toBe(12.5);
    });

    it('clears the track and index when the queue ends', () => {
        const { f, player } = setup();
        act(() => player().play('favorites', [radioTrack(1)]));
        expect(player().track?.message.id).toBe(1);
        act(() => f.made[0].fire('ended'));
        act(() => { vi.advanceTimersByTime(10); });
        expect(player().status).toBe('ended');
        expect(player().track).toBeNull();
        expect(player().index).toBe(-1);
    });

    it('stop() clears an ended program\'s state too', () => {
        const { f, player } = setup();
        act(() => player().play('favorites', [radioTrack(1)]));
        act(() => f.made[0].fire('ended'));
        act(() => { vi.advanceTimersByTime(10); });
        act(() => player().stop());
        expect(player().status).toBe('idle');
        expect(player().tracks).toEqual([]);
    });

    it('empties and releases a finished session\'s elements', () => {
        const f = fakeAudioFactory();
        const released: unknown[] = [];
        const hook = renderHook(() => useRadioPlayer({ createElement: f.create, releaseElement: (el) => released.push(el) }));
        act(() => hook.result.current.play('oyasumi', [radioTrack(1), radioTrack(2)]));
        expect(hook.result.current.currentElement()).toBe(f.made[0]);
        act(() => hook.result.current.stop());
        expect(released).toEqual([f.made[0], f.made[1]]);
        expect(f.made[0].src).toBe('');
        expect(hook.result.current.currentElement()).toBeNull();
    });

    it('starting the radio stops another Memories voice', () => {
        const other = { stop: vi.fn(), fadeOut: vi.fn(() => Promise.resolve()) };
        useVoicePlayback.getState().play('lazy|room|1', other);
        const { player } = setup();
        act(() => player().play('oyasumi', [radioTrack(1)]));
        expect(other.stop).toHaveBeenCalledTimes(1);
        expect(useVoicePlayback.getState().playing).toBe(RADIO_VOICE_KEY);
    });

    it('steps while paused stay paused, and resume plays the new track', () => {
        const { f, player } = setup();
        act(() => player().play('chrono', [radioTrack(1), radioTrack(2), radioTrack(3)]));
        act(() => player().toggle());
        act(() => player().next());
        expect(player().status).toBe('paused');
        expect(player().index).toBe(1);
        expect(f.made[1].paused).toBe(true);
        act(() => player().toggle());
        expect(player().status).toBe('playing');
        expect(f.made[1].src).toBe('/api/media/hinatazaka46/voice/2.m4a');
        expect(f.made[1].paused).toBe(false);
    });

    it('can start a program at a given track', () => {
        const { f, player } = setup();
        act(() => player().play('chrono', [radioTrack(1), radioTrack(2), radioTrack(3)], 2));
        expect(player().index).toBe(2);
        expect(f.made[0].src).toBe('/api/media/hinatazaka46/voice/3.m4a');
    });
});
