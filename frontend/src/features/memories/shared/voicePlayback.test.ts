import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fadeOutMemoriesVoices, stopMemoriesVoices, useVoicePlayback, type PlayerHandle } from './voicePlayback';

const handle = () => ({
    stop: vi.fn<() => void>(),
    fadeOut: vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve()),
}) satisfies PlayerHandle;

beforeEach(() => { stopMemoriesVoices(); });

describe('voice coordinator', () => {
    it('playing B stops A\'s handle and stores B\'s', () => {
        const a = handle();
        const b = handle();
        useVoicePlayback.getState().play('a', a);
        useVoicePlayback.getState().play('b', b);
        expect(a.stop).toHaveBeenCalledTimes(1);
        expect(b.stop).not.toHaveBeenCalled();
        expect(useVoicePlayback.getState()).toMatchObject({ playing: 'b', handle: b });
    });

    it('playing a key without a handle still stops the previous handle', () => {
        const a = handle();
        useVoicePlayback.getState().play('a', a);
        useVoicePlayback.getState().play('b');
        expect(a.stop).toHaveBeenCalledTimes(1);
        expect(useVoicePlayback.getState()).toMatchObject({ playing: 'b', handle: null });
    });

    it('re-registering the same handle does not stop it', () => {
        const a = handle();
        useVoicePlayback.getState().play('a', a);
        useVoicePlayback.getState().play('a', a);
        expect(a.stop).not.toHaveBeenCalled();
    });

    it('stop(key) stops only the playing key; stop() stops any', () => {
        const a = handle();
        useVoicePlayback.getState().play('a', a);
        useVoicePlayback.getState().stop('other');
        expect(a.stop).not.toHaveBeenCalled();
        expect(useVoicePlayback.getState().playing).toBe('a');
        useVoicePlayback.getState().stop('a');
        expect(a.stop).toHaveBeenCalledTimes(1);
        expect(useVoicePlayback.getState()).toMatchObject({ playing: null, handle: null });
        const b = handle();
        useVoicePlayback.getState().play('b', b);
        stopMemoriesVoices();
        expect(b.stop).toHaveBeenCalledTimes(1);
    });

    it('a handle whose stop() calls back into the coordinator does not loop', () => {
        const a: PlayerHandle = { stop: vi.fn(() => useVoicePlayback.getState().stop('a')), fadeOut: () => Promise.resolve() };
        useVoicePlayback.getState().play('a', a);
        stopMemoriesVoices();
        expect(a.stop).toHaveBeenCalledTimes(1);
    });

    it('fadeOutMemoriesVoices fades a fading handle, then clears it', async () => {
        const a = handle();
        useVoicePlayback.getState().play('a', a);
        await fadeOutMemoriesVoices(2000);
        expect(a.fadeOut).toHaveBeenCalledWith(2000);
        expect(a.stop).not.toHaveBeenCalled();
        expect(useVoicePlayback.getState()).toMatchObject({ playing: null, handle: null });
    });

    it('fadeOutMemoriesVoices stops a plain player that cannot fade', async () => {
        const plain = { stop: vi.fn() } as unknown as PlayerHandle;
        useVoicePlayback.getState().play('p', plain);
        await fadeOutMemoriesVoices(2000);
        expect(plain.stop).toHaveBeenCalledTimes(1);
        expect(useVoicePlayback.getState().playing).toBeNull();
        useVoicePlayback.getState().play('k');
        await fadeOutMemoriesVoices(2000);
        expect(useVoicePlayback.getState().playing).toBeNull();
    });

    it('a voice started during the fade is not cleared by it', async () => {
        let finish: () => void = () => {};
        const a: PlayerHandle = { stop: vi.fn(), fadeOut: () => new Promise<void>((r) => { finish = r; }) };
        useVoicePlayback.getState().play('a', a);
        const fading = fadeOutMemoriesVoices(2000);
        useVoicePlayback.getState().play('b');
        finish();
        await fading;
        expect(useVoicePlayback.getState().playing).toBe('b');
    });
});
