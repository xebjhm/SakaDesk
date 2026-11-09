import { describe, it, expect } from 'vitest';
import { getRingtone, SILENT_RINGTONE } from './ringtone';

describe('ringtone', () => {
    it('getRingtone returns the silent ringtone', () => {
        expect(getRingtone()).toBe(SILENT_RINGTONE);
    });

    it('start and stop are callable no-ops', () => {
        expect(() => { SILENT_RINGTONE.start(); SILENT_RINGTONE.stop(); }).not.toThrow();
        expect(SILENT_RINGTONE.start()).toBeUndefined();
        expect(SILENT_RINGTONE.stop()).toBeUndefined();
    });
});
