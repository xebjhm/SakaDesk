import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchRadioProgram: vi.fn(), fetchRadioCassettes: vi.fn() };
});
// Every element the station makes is a fake the test can drive (ended, error, time).
const audio = vi.hoisted(() => ({ made: [] as Array<import('../recap/__fixtures__/fakeAudio').FakeAudio> }));
vi.mock('../shared/clipSequencer', async (importOriginal) => {
    const real = await importOriginal<typeof import('../shared/clipSequencer')>();
    const { FakeAudio } = await import('../recap/__fixtures__/fakeAudio');
    return {
        ...real,
        createAudioElement: () => {
            const a = new FakeAudio();
            audio.made.push(a);
            return a as unknown as HTMLAudioElement;
        },
    };
});
vi.mock('../../../hooks/useTranscription', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../hooks/useTranscription')>();
    return { ...real, fetchCachedTranscription: vi.fn(() => Promise.resolve(null)) };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchRadioCassettes, fetchRadioProgram, MemoriesFetchError } from '../api';
import { useVoicePlayback } from '../shared/voicePlayback';
import type { RadioProgramQuery } from '../types';
import { Station } from './Station';
import { cassettesPayload, MEMBER_PATH, radioProgramPayload, radioTrack } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    useVoicePlayback.setState({ playing: null, handle: null });
    audio.made.length = 0;
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

    it('shows every listed program\'s count from the first load', async () => {
        render(<Station service="hinatazaka46" />);
        await screen.findByRole('button', { name: /Good-night broadcast/ });
        // The loaded program counts its tracks; the others come from the payload's counts.
        expect(card(/Good-night broadcast/)).toHaveTextContent('3 voices');
        expect(card(/Good-morning broadcast/)).toHaveTextContent('12 voices');
        expect(card(/From the beginning/)).toHaveTextContent('41 voices');
        expect(card(/Favorite voices/)).toHaveTextContent('1 voice');
    });

    it('a failed pick shows an inline retry, keeps the program on air pressed, and retries', async () => {
        render(<Station service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Good-night broadcast/ }));
        await waitFor(() => expect(lamp()).toHaveTextContent('ON AIR'));
        vi.mocked(fetchRadioProgram).mockRejectedValueOnce(new MemoriesFetchError(500));
        vi.mocked(clientLog).mockClear();
        await userEvent.click(card(/Good-morning broadcast/));
        const alert = await screen.findByTestId('radio-load-error');
        expect(alert).toHaveTextContent("Couldn't load this.");
        expect(card(/Good-morning broadcast/)).toHaveAttribute('aria-pressed', 'false');
        expect(card(/Good-night broadcast/)).toHaveAttribute('aria-pressed', 'true');
        expect(lamp()).toHaveTextContent('ON AIR');
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_load', { target: 'radio_program', outcome: 'error', error_code: 500 });
        await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(card(/Good-morning broadcast/)).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.queryByTestId('radio-load-error')).toBeNull();
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_radio', { phase: 'play', kind: 'ohayo', count: 3, outcome: 'ok' }));
    });

    it('a finished program leaves nothing on air', async () => {
        render(<Station service="hinatazaka46" />);
        await userEvent.click(await screen.findByRole('button', { name: /Favorite voices/ }));
        await screen.findByTestId('now-playing');
        act(() => audio.made[0].fire('ended'));
        await waitFor(() => expect(screen.queryByTestId('now-playing')).toBeNull());
        expect(lamp()).toHaveTextContent('OFF AIR');
    });

    it('a member switch never shows the previous member\'s track', async () => {
        const { rerender } = render(<Station service="hinatazaka46" member={MEMBER_PATH} memberName="金村 美玖" />);
        await userEvent.click(await screen.findByRole('button', { name: /Good-night broadcast/ }));
        await screen.findByTestId('now-playing');
        rerender(<Station service="hinatazaka46" member="other" memberName="小坂 菜緒" />);
        expect(screen.queryByTestId('now-playing')).toBeNull();
        await screen.findByRole('button', { name: /Good-night broadcast/ });
        expect(screen.queryByTestId('now-playing')).toBeNull();
        expect(audio.made[0].paused).toBe(true);
        expect(lamp()).toHaveTextContent('OFF AIR');
    });

    it('marks only her name as Japanese in the station title', async () => {
        render(<Station service="hinatazaka46" member={MEMBER_PATH} memberName="金村 美玖" />);
        const heading = await screen.findByRole('heading', { name: "金村 美玖's late-night station" });
        expect(heading).not.toHaveAttribute('lang');
        expect(heading.querySelector('[lang="ja"]')).toHaveTextContent(/^金村 美玖$/);
    });

    it('replays on fresh elements when the waveform graph gives up on a suspended context', async () => {
        const real = globalThis.AudioContext;
        const contexts: Array<EventTarget & { state: string }> = [];
        class Ctx extends EventTarget {
            state = 'running';
            destination = {};
            createAnalyser = () => ({ connect: vi.fn(), fftSize: 0, frequencyBinCount: 32, getByteFrequencyData: vi.fn() });
            createMediaElementSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
            close = () => Promise.resolve();
            resume = () => Promise.reject(new Error('blocked'));
            constructor() { super(); contexts.push(this); }
        }
        globalThis.AudioContext = Ctx as unknown as typeof AudioContext;
        try {
            render(<Station service="hinatazaka46" />);
            await userEvent.click(await screen.findByRole('button', { name: /Good-night broadcast/ }));
            await waitFor(() => expect(lamp()).toHaveTextContent('ON AIR'));
            await userEvent.click(screen.getByRole('button', { name: 'Next voice' }));
            const before = audio.made.length;
            await act(async () => {
                contexts[0].state = 'suspended';
                contexts[0].dispatchEvent(new Event('statechange'));
                await Promise.resolve();
                await Promise.resolve();
            });
            // A new sequencer on new (unrouted) elements, on the track that was on air.
            await waitFor(() => expect(audio.made.length).toBe(before + 2));
            // Track 2 (index 1) plays on the new sequencer's second element.
            expect(audio.made[before + 1].src).toBe('/api/media/hinatazaka46/voice/2.m4a');
            expect(audio.made[before + 1].paused).toBe(false);
            expect(audio.made[before - 1].src).toBe('');
            expect(screen.getByTestId('waveform')).toHaveAttribute('data-mode', 'static');
        } finally {
            globalThis.AudioContext = real;
        }
    });

    it('draws the live waveform only for a routed element', async () => {
        const real = globalThis.AudioContext;
        class Ctx extends EventTarget {
            state = 'running';
            destination = {};
            createAnalyser = () => ({ connect: vi.fn(), fftSize: 0, frequencyBinCount: 32, getByteFrequencyData: vi.fn() });
            createMediaElementSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
            close = () => Promise.resolve();
            resume = () => Promise.resolve();
        }
        globalThis.AudioContext = Ctx as unknown as typeof AudioContext;
        try {
            render(<Station service="hinatazaka46" />);
            await userEvent.click(await screen.findByRole('button', { name: /Good-night broadcast/ }));
            await waitFor(() => expect(screen.getByTestId('waveform')).toHaveAttribute('data-mode', 'live'));
        } finally {
            globalThis.AudioContext = real;
        }
    });
});
