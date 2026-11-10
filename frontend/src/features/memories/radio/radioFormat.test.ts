import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../../../i18n';
import { RADIO_PROGRAMS } from '../types';
import { formatVoiceLength, programCopy } from './radioFormat';

const t = i18n.t.bind(i18n);

describe('radioFormat', () => {
    beforeAll(async () => { await i18n.changeLanguage('ja'); });

    it('formats a total length as hours and minutes, never a 0', () => {
        expect(formatVoiceLength(t, 3 * 3600 + 12 * 60)).toBe('3時間12分');
        expect(formatVoiceLength(t, 42 * 60 + 10)).toBe('42分');
        expect(formatVoiceLength(t, 2 * 3600 + 10)).toBe('2時間');
        expect(formatVoiceLength(t, 40)).toBe('1分未満');
        expect(formatVoiceLength(t, 0)).toBeNull();
        expect(formatVoiceLength(t, null)).toBeNull();
    });

    it('has a title and a subtitle for every program', () => {
        for (const code of RADIO_PROGRAMS) {
            const copy = programCopy(code);
            expect(i18n.exists(copy.title), code).toBe(true);
            expect(i18n.exists(copy.subtitle), code).toBe(true);
        }
        expect(t(programCopy('oyasumi_clips').title)).toBe('精選・おやすみだけ');
    });
});
