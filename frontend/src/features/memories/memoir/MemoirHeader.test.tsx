import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { MemoirHeader } from './MemoirHeader';
import { voiceChip } from './binderModel';
import { headerPayload } from './__fixtures__';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('ja'); });

describe('MemoirHeader', () => {
    it('shows her avatar, serif name and each chip as its own moment', async () => {
        const onNames = vi.fn();
        const { container } = render(<MemoirHeader header={headerPayload()} onNames={onNames} />);
        const name = screen.getByRole('heading', { name: '金村 美玖' });
        expect(name).toHaveClass('font-display');
        expect(name).toHaveAttribute('lang', 'ja');
        // her current avatar, decorative next to her visible name
        expect(container.querySelector('img')).toHaveAttribute('src', expect.stringContaining('icon.jpg'));
        const chips = screen.getAllByTestId('memoir-chip');
        expect(chips.map((c) => c.textContent)).toEqual(['メンバーシップ 842 日', '名前を呼んでくれた 57 回', '声 3時間25分']);
        await userEvent.click(screen.getByRole('button', { name: '名前を呼んでくれた 57 回' }));
        expect(onNames).toHaveBeenCalled();
    });

    it('hides every chip whose value is null', () => {
        render(<MemoirHeader header={headerPayload({ subscription_days: null, nickname_count: null, voice_seconds: null })} onNames={vi.fn()} />);
        expect(screen.queryAllByTestId('memoir-chip')).toHaveLength(0);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows minutes only under an hour and hours only on the hour', () => {
        expect(voiceChip(25 * 60 + 40)).toEqual({ key: 'memories.memoir.chipVoiceMinutes', params: { m: 25 } });
        expect(voiceChip(2 * 3600 + 10)).toEqual({ key: 'memories.memoir.chipVoiceHours', params: { h: 2 } });
        expect(voiceChip(3600 + 60)).toEqual({ key: 'memories.memoir.chipVoice', params: { h: 1, m: 1 } });
        // never "0分": under a minute the chip hides
        expect(voiceChip(42)).toBeNull();
        expect(voiceChip(null)).toBeNull();
    });
});
