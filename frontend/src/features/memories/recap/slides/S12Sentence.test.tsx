import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S12Sentence } from './S12Sentence';
import { payload } from '../__fixtures__/payload';
import type { S12SentenceData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const data: S12SentenceData = {
    sentence: '%%%と歩いた一年でした。', message_id: 3, member_path: 'x', ts: '2026-06-01T12:00:00Z', photo_url: '/api/media/p.jpg',
};
const renderS12 = (d: S12SentenceData) =>
    render(<S12Sentence data={d} fallback={null} recap={payload()} nickname="ゆき" reducedMotion={false} paused={false} onMediaEnd={() => {}} />);

describe('S12Sentence', () => {
    it('sets her sentence in vertical serif type, nickname applied', () => {
        renderS12(data);
        const sentence = screen.getByText('ゆきと歩いた一年でした。');
        expect(sentence).toHaveStyle({ writingMode: 'vertical-rl' });
        expect(sentence).toHaveAttribute('data-voice', 'quote');
        expect(sentence).toHaveAttribute('lang', 'ja');
        expect(sentence.className).toMatch(/font-display/);
        expect(screen.getByText('2026年、彼女のひとこと')).toHaveAttribute('data-voice', 'title');
    });

    it('shows that day\'s photo faintly behind, or nothing', () => {
        const { unmount } = renderS12(data);
        expect(screen.getByTestId('s12-photo')).toHaveAttribute('src', '/api/media/p.jpg');
        unmount();
        renderS12({ ...data, photo_url: null });
        expect(screen.queryByTestId('s12-photo')).toBeNull();
    });
});
