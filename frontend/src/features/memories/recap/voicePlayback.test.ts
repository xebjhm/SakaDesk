import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClipSequencer, CROSSFADE_MS, type SequencerClip, type SequencerEvents } from './voicePlayback';
import { fakeAudioFactory } from './__fixtures__/fakeAudio';

const clips = (n: number): SequencerClip[] =>
    Array.from({ length: n }, (_, i) => ({
        url: `/api/media/v${i}.m4a`,
        start: 0,
        end: 6,
        segments: i === 0 ? [{ start: 0, end: 2, text: '%%%、おはよう' }, { start: 2, end: 6, text: 'またね' }] : null,
    }));

function events() {
    return {
        onClip: vi.fn<SequencerEvents['onClip']>(),
        onSubtitle: vi.fn<SequencerEvents['onSubtitle']>(),
        onClipError: vi.fn<SequencerEvents['onClipError']>(),
        onEnd: vi.fn<SequencerEvents['onEnd']>(),
    };
}

const flush = () => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ClipSequencer', () => {
    it('plays the first clip from its start at full volume', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(3), ev, f.create).start();
        expect(f.made).toHaveLength(2);
        const [a] = f.made;
        expect(a.src).toBe('/api/media/v0.m4a');
        expect(a.currentTime).toBe(0);
        expect(a.volume).toBe(1);
        expect(a.paused).toBe(false);
        expect(ev.onClip).toHaveBeenCalledWith(0);
    });

    it('starts at a clip\'s own start offset', () => {
        const f = fakeAudioFactory();
        new ClipSequencer([{ url: '/a', start: 3, end: 9, segments: null }], events(), f.create).start();
        expect(f.made[0].currentTime).toBe(3);
    });

    it('crossfades into the next clip on the other element over 300 ms', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(3), ev, f.create).start();
        const [a, b] = f.made;
        a.tick(5);
        expect(b.paused).toBe(true);
        a.tick(6 - CROSSFADE_MS / 1000);
        expect(CROSSFADE_MS).toBe(300);
        expect(b.src).toBe('/api/media/v1.m4a');
        expect(b.paused).toBe(false);
        expect(b.volume).toBe(0);
        expect(ev.onClip).toHaveBeenLastCalledWith(1);
        vi.advanceTimersByTime(150);
        expect(b.volume).toBeGreaterThan(0.3);
        expect(b.volume).toBeLessThan(0.7);
        expect(a.volume).toBeGreaterThan(0.3);
        expect(a.volume).toBeLessThan(0.7);
        vi.advanceTimersByTime(200);
        expect(b.volume).toBe(1);
        expect(a.volume).toBe(0);
        expect(a.paused).toBe(true);
    });

    it('hands over once even when more time updates follow', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(3), ev, f.create).start();
        const [a] = f.made;
        a.tick(5.8);
        a.tick(5.9);
        a.fire('ended');
        expect(ev.onClip).toHaveBeenCalledTimes(2);
    });

    it('a clip that ends early hands over on `ended`', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(2), ev, f.create).start();
        f.made[0].tick(2);
        f.made[0].fire('ended');
        expect(ev.onClip).toHaveBeenLastCalledWith(1);
        expect(f.made[1].src).toBe('/api/media/v1.m4a');
    });

    it('plays all three in sequence, alternating elements, then fades out and ends', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(3), ev, f.create).start();
        const [a, b] = f.made;
        a.tick(5.8);
        vi.advanceTimersByTime(CROSSFADE_MS);
        b.tick(5.8);
        expect(a.src).toBe('/api/media/v2.m4a');
        vi.advanceTimersByTime(CROSSFADE_MS);
        expect(ev.onEnd).not.toHaveBeenCalled();
        a.tick(5.8);
        expect(ev.onEnd).not.toHaveBeenCalled();
        vi.advanceTimersByTime(CROSSFADE_MS);
        expect(a.paused).toBe(true);
        expect(ev.onEnd).toHaveBeenCalledTimes(1);
        expect(ev.onClip.mock.calls.map(([i]) => i)).toEqual([0, 1, 2]);
    });

    it('shows the subtitle of the playhead and clears it between segments and clips', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(2), ev, f.create).start();
        const [a] = f.made;
        a.tick(1);
        expect(ev.onSubtitle).toHaveBeenLastCalledWith('%%%、おはよう');
        a.tick(1.5);
        expect(ev.onSubtitle).toHaveBeenCalledTimes(1);
        a.tick(3);
        expect(ev.onSubtitle).toHaveBeenLastCalledWith('またね');
        a.tick(5.8);
        expect(ev.onSubtitle).toHaveBeenLastCalledWith(null);
    });

    it('skips a clip whose media fails and reports it', () => {
        const f = fakeAudioFactory();
        const ev = events();
        new ClipSequencer(clips(2), ev, f.create).start();
        f.made[0].fire('error');
        expect(ev.onClipError).toHaveBeenCalledWith(0, 'media_error');
        expect(f.made[0].paused).toBe(true);
        expect(ev.onClip).toHaveBeenLastCalledWith(1);
    });

    it('skips a clip whose play() is rejected', async () => {
        const f = fakeAudioFactory();
        const ev = events();
        const seq = new ClipSequencer(clips(1), ev, () => {
            const el = f.create();
            (el as unknown as { rejectPlay: Error }).rejectPlay = new Error('NotSupportedError');
            return el;
        });
        seq.start();
        await flush();
        expect(ev.onClipError).toHaveBeenCalledWith(0, 'play_rejected');
        vi.advanceTimersByTime(CROSSFADE_MS);
        expect(ev.onEnd).toHaveBeenCalledTimes(1);
    });

    it('stop() silences both elements and nothing fires afterwards', () => {
        const f = fakeAudioFactory();
        const ev = events();
        const seq = new ClipSequencer(clips(3), ev, f.create);
        seq.start();
        const [a, b] = f.made;
        a.tick(5.8);
        seq.stop();
        expect(a.paused).toBe(true);
        expect(b.paused).toBe(true);
        vi.advanceTimersByTime(5000);
        b.tick(5.8);
        b.fire('ended');
        expect(ev.onEnd).not.toHaveBeenCalled();
        expect(ev.onClip).toHaveBeenCalledTimes(2);
    });
});
