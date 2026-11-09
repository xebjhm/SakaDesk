import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../../../i18n';
import { S13Oyasumi } from './S13Oyasumi';
import { message, payload } from '../__fixtures__/payload';
import type { S13OyasumiData } from '../api';

beforeAll(async () => { await i18n.changeLanguage('ja'); });

const renderS13 = (d: Omit<S13OyasumiData, 'message'>, fallback: string | null = null) =>
    render(
        <S13Oyasumi
            data={{ ...d, message: message(4, 'おやすみ、%%%') }}
            fallback={fallback} recap={payload()} nickname="ゆき" reducedMotion={false} paused={false} onMediaEnd={() => {}}
        />,
    );

describe('S13Oyasumi', () => {
    it('final: the last oyasumi and the narration', () => {
        renderS13({ final: true, graduated: false });
        expect(screen.getByText('2026年、最後のおやすみ。')).toBeInTheDocument();
        expect(screen.getByText('おやすみ、ゆき')).toHaveAttribute('data-voice', 'quote');
        const narration = screen.getByText('来年も、よろしくね。');
        expect(narration).toHaveAttribute('data-voice', 'narration');
        expect(narration.className).not.toMatch(/font-display/);
        expect(screen.getByTestId('s13-light')).toBeInTheDocument();
    });

    it('partial: the newest oyasumi and the completion note', () => {
        renderS13({ final: false, graduated: false });
        expect(screen.getByText('いちばん新しい、おやすみ')).toBeInTheDocument();
        expect(screen.getByText('12月31日のおやすみで、完成します。')).toBeInTheDocument();
        expect(screen.queryByText('来年も、よろしくね。')).toBeNull();
    });

    it('graduated: her last message, fully quiet', () => {
        renderS13({ final: true, graduated: true });
        expect(screen.getByText('最後のメッセージ')).toBeInTheDocument();
        expect(screen.getByText('ずっと、ここに。')).toBeInTheDocument();
        expect(screen.queryByText('来年も、よろしくね。')).toBeNull();
        expect(screen.queryByTestId('s13-light')).toBeNull();
    });
});
