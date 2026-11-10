import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchRadioProgram: vi.fn(), fetchRadioCassettes: vi.fn() };
});
vi.mock('../../../hooks/useTranscription', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../hooks/useTranscription')>();
    return { ...real, fetchCachedTranscription: vi.fn(() => Promise.resolve(null)) };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchRadioCassettes, fetchRadioProgram } from '../api';
import { useVoicePlayback } from '../shared/voicePlayback';
import type { RadioProgramQuery } from '../types';
import { Station } from './Station';
import { cassettesPayload, MEMBER_PATH, radioProgramPayload, radioTrack } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    useVoicePlayback.setState({ playing: null, handle: null });
    vi.mocked(fetchRadioProgram).mockReset().mockImplementation(async (_s: string, q: RadioProgramQuery) => (
        radioProgramPayload({ program: q.program, tracks: q.program === 'favorites' ? [radioTrack(9)] : [radioTrack(1), radioTrack(2), radioTrack(3)] })
    ));
    vi.mocked(fetchRadioCassettes).mockReset().mockResolvedValue(cassettesPayload());
});

const lamp = () => screen.getByTestId('onair');
const card = (name: RegExp) => screen.getByRole('button', { name });

describe('Station', () => {
    it('names the station for a member, or the plain station for everyone', async () => {
        const { rerender } = render(<Station service="hinatazaka46" member={MEMBER_PATH} memberName="金村 美玖" />);
        expect(await screen.findByRole('heading', { name: "金村 美玖's late-night station" })).toBeInTheDocument();
        rerender(<Station service="hinatazaka46" />);
        expect(await screen.findByRole('heading', { name: 'Late-night station' })).toBeInTheDocument();
    });

    it('draws only the payload\'s programs: no 精選 without clips', async () => {
        render(<Station service="hinatazaka46" />);
        await screen.findByRole('button', { name: /Good-night broadcast/ });
        const row = screen.getByRole('group', { name: 'Programs' });
        expect(within(row).getAllByRole('button')).toHaveLength(5);
        expect(screen.queryByRole('button', { name: /Highlights/ })).toBeNull();
    });

    it('draws 精選 when the payload has clips', async () => {
        vi.mocked(fetchRadioProgram).mockResolvedValue(radioProgramPayload({
            programs: ['oyasumi', 'oyasumi_clips'],
        }));
        render(<Station service="hinatazaka46" />);
        expect(await screen.findByRole('button', { name: /Highlights/ })).toBeInTheDocument();
    });

    it('picking a program plays it, lights the lamp and shows its one number', async () => {
        render(<Station service="hinatazaka46" member={MEMBER_PATH} memberName="金村 美玖" />);
        await screen.findByRole('button', { name: /Good-night broadcast/ });
        expect(lamp()).toHaveTextContent('OFF AIR');
        expect(lamp()).toHaveAttribute('aria-live', 'polite');
        await userEvent.click(card(/Favorite voices/));
        await waitFor(() => expect(lamp()).toHaveTextContent('ON AIR'));
        expect(screen.getByTestId('onair-dot')).toHaveClass('bg-memories-onair');
        expect(vi.mocked(fetchRadioProgram).mock.lastCall?.[1]).toEqual({ program: 'favorites', member: MEMBER_PATH, year: undefined });
        expect(card(/Favorite voices/)).toHaveAttribute('aria-pressed', 'true');
        expect(card(/Favorite voices/)).toHaveTextContent('1 voice');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'radio_program', outcome: 'on', kind: 'favorites' });
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_radio', { phase: 'play', kind: 'favorites', count: 1, outcome: 'ok' });
        expect(screen.getByTestId('now-playing')).toHaveTextContent('2024-09-22 23:41');
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    });

    it('pause / play from the controls and next / prev', async () => {
        render(<Station service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Good-night broadcast/ }));
        await screen.findByRole('button', { name: 'Pause' });
        await userEvent.click(screen.getByRole('button', { name: 'Next voice' }));
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_radio', { phase: 'track', kind: 'oyasumi', index: 1 });
        await userEvent.click(screen.getByRole('button', { name: 'Previous voice' }));
        const tracks = vi.mocked(clientLog).mock.calls
            .filter(([e, p]) => e === 'memories_radio' && (p as { phase: string }).phase === 'track')
            .map(([, p]) => (p as { index: number }).index);
        expect(tracks).toEqual([0, 1, 0]);
        await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
        expect(lamp()).toHaveTextContent('OFF AIR');
        await userEvent.click(screen.getByRole('button', { name: 'Play' }));
        expect(lamp()).toHaveTextContent('ON AIR');
    });

    it('another Memories voice stops the radio and turns the lamp off', async () => {
        render(<Station service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Good-night broadcast/ }));
        await waitFor(() => expect(lamp()).toHaveTextContent('ON AIR'));
        act(() => useVoicePlayback.getState().play('x'));
        expect(lamp()).toHaveTextContent('OFF AIR');
    });

    it('picking あの頃から順番に shows the cassette shelf, and a tape loads its year', async () => {
        render(<Station service="hinatazaka46" member={MEMBER_PATH} />);
        expect(screen.queryByTestId('cassette')).toBeNull();
        await userEvent.click(await screen.findByRole('button', { name: /From the beginning/ }));
        const tapes = await screen.findAllByTestId('cassette');
        await userEvent.click(tapes[1]);
        await waitFor(() => expect(vi.mocked(fetchRadioProgram).mock.lastCall?.[1]).toEqual({ program: 'chrono', member: MEMBER_PATH, year: 2024 }));
        await waitFor(() => expect(screen.getAllByTestId('cassette')[1]).toHaveAttribute('aria-pressed', 'true'));
    });

    it('shows the empty copy with no voices, never a 0', async () => {
        vi.mocked(fetchRadioProgram).mockResolvedValue(radioProgramPayload({ programs: [], years: [], tracks: [] }));
        const { container } = render(<Station service="hinatazaka46" />);
        expect(await screen.findByText('No voices to play here yet.')).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/\b0\b/);
    });
});
