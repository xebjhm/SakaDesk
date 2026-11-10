import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchRadioMembers: vi.fn(), fetchRadioProgram: vi.fn(), fetchRadioCassettes: vi.fn() };
});
vi.mock('../shared/voicePlayback', async (importOriginal) => {
    const real = await importOriginal<typeof import('../shared/voicePlayback')>();
    return { ...real, stopMemoriesVoices: vi.fn(real.stopMemoriesVoices) };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchRadioMembers, fetchRadioProgram } from '../api';
import { stopMemoriesVoices } from '../shared/voicePlayback';
import type { MemoriesRoute } from '../MemoriesFeature';
import { RadioPage } from './RadioPage';
import { MEMBER_PATH, NAO_PATH, radioMembersPayload, radioProgramPayload } from './__fixtures__';

type RadioRoute = Extract<MemoriesRoute, { page: 'radio' }>;

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(stopMemoriesVoices).mockClear();
    vi.mocked(fetchRadioMembers).mockReset().mockResolvedValue(radioMembersPayload());
    vi.mocked(fetchRadioProgram).mockReset().mockResolvedValue(radioProgramPayload());
});

function renderPage(route: RadioRoute = { page: 'radio' }) {
    const go = vi.fn();
    const utils = render(<RadioPage service="hinatazaka46" route={route} go={go} />);
    return { go, ...utils, rerender: (r: RadioRoute) => utils.rerender(<RadioPage service="hinatazaka46" route={r} go={go} />) };
}

describe('RadioPage', () => {
    it('lists 全員 and each member with her total length only (no voice count)', async () => {
        renderPage();
        const miku = await screen.findByRole('button', { name: /金村 美玖/ });
        expect(screen.getByRole('heading', { name: 'ボイスラジオ' })).toBeInTheDocument();
        expect(miku).toHaveTextContent('3時間12分');
        expect(miku.textContent).not.toMatch(/214/);
        expect(screen.getByRole('button', { name: /小坂 菜緒/ })).toHaveTextContent('42分');
        const all = screen.getByRole('button', { name: /全員/ });
        expect(all).toHaveTextContent('4時間');
        expect(all).toHaveAttribute('aria-current', 'true');
        expect(screen.getAllByTestId('member-pane-oshi')).toHaveLength(1);
        expect(await screen.findByRole('heading', { name: '深夜放送局' })).toBeInTheDocument();
    });

    it('switching member stops playback, logs and moves the route; the station is named for her', async () => {
        const { go, rerender } = renderPage();
        await userEvent.click(await screen.findByRole('button', { name: /小坂 菜緒/ }));
        expect(go).toHaveBeenCalledWith({ page: 'radio', memberPath: NAO_PATH });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'member_filter', outcome: 'on' });
        vi.mocked(stopMemoriesVoices).mockClear();
        rerender({ page: 'radio', memberPath: MEMBER_PATH });
        expect(stopMemoriesVoices).toHaveBeenCalled();
        expect(await screen.findByRole('heading', { name: '金村 美玖の深夜放送局' })).toBeInTheDocument();
        await waitFor(() => expect(vi.mocked(fetchRadioProgram).mock.lastCall?.[1]).toMatchObject({ member: MEMBER_PATH }));
    });

    it('leaving the page stops playback', async () => {
        const { unmount } = renderPage();
        await screen.findByRole('button', { name: /金村 美玖/ });
        vi.mocked(stopMemoriesVoices).mockClear();
        unmount();
        expect(stopMemoriesVoices).toHaveBeenCalled();
    });

    it('shows the empty copy when nobody has a voice (no 0)', async () => {
        vi.mocked(fetchRadioMembers).mockResolvedValue({ total_seconds: null, members: [] });
        vi.mocked(fetchRadioProgram).mockResolvedValue(radioProgramPayload({ programs: [], years: [], tracks: [] }));
        const { container } = renderPage();
        expect(await screen.findByText('ここで流せる声は、まだありません。')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/0/);
    });

    it('keeps an armed sleep timer across a member switch', async () => {
        const { rerender } = renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'おやすみタイマー' }));
        await userEvent.click(screen.getByRole('menuitemradio', { name: '30 分後に止める' }));
        expect(screen.getByRole('button', { name: 'あと 30 分' })).toBeInTheDocument();
        vi.mocked(clientLog).mockClear();
        rerender({ page: 'radio', memberPath: MEMBER_PATH });
        expect(await screen.findByRole('button', { name: 'あと 30 分' })).toBeInTheDocument();
        expect(vi.mocked(clientLog)).not.toHaveBeenCalledWith('memories_toggle', { target: 'sleep_timer', outcome: 'off' });
    });
});
