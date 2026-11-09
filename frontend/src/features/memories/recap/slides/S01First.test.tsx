import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S01First } from './S01First';
import { message, payload } from '../__fixtures__/payload';
import type { S01FirstData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS01 = (data: S01FirstData, recap = payload()) =>
    render(<S01First data={data} fallback={null} recap={recap} nickname="ゆき" reducedMotion={false} onMediaEnd={() => {}} />);

describe('S01First', () => {
    it('shows her first message with the nickname, the seconds clock and the year line', () => {
        renderS01({ message: message(1, '%%%、あけましておめでとう'), joined_this_year: false, new_year_midnight: true });
        expect(screen.getByText('ゆき、あけましておめでとう')).toHaveAttribute('data-voice', 'quote');
        expect(screen.getByText('0:00:07')).toBeInTheDocument();
        expect(screen.getByText('2026年、ふたりの物語はこの一通から始まりました。')).toBeInTheDocument();
        expect(screen.getByText('あなたと彼女の、3年目。')).toHaveAttribute('data-voice', 'narration');
    });

    it('starts from the subscription day for a fan who joined this year', () => {
        const recap = payload({ member: { ...payload().member, subscription_start: '2026-10-14', years_together: 1 } });
        renderS01({ message: message(1, 'はじめまして'), joined_this_year: true, new_year_midnight: false }, recap);
        expect(screen.getByText('あなたと彼女の2026年は、10月14日から。')).toBeInTheDocument();
        expect(screen.queryByText(/年目/)).toBeNull();
    });

    it('shows a picture message without text and never prints null', () => {
        renderS01({
            message: message(1, null, { type: 'picture', media_url: '/api/media/x.jpg' }),
            joined_this_year: false, new_year_midnight: false,
        });
        expect(screen.getByTestId('message-media')).toHaveAttribute('src', '/api/media/x.jpg');
        expect(document.body.textContent).not.toMatch(/null|undefined/);
    });
});
