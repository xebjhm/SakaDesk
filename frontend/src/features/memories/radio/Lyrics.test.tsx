import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../hooks/useTranscription', async (importOriginal) => {
    const real = await importOriginal<typeof import('../../../hooks/useTranscription')>();
    return { ...real, fetchCachedTranscription: vi.fn() };
});
import { clientLog } from '../../../utils/clientLog';
import { fetchCachedTranscription, type Transcription } from '../../../hooks/useTranscription';
import { NicknameProvider } from '../shared/useNickname';
import { Lyrics } from './Lyrics';
import { MEMBER_PATH, radioTrack } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    vi.mocked(fetchCachedTranscription).mockReset();
});

const transcription = (segments: Array<[number, number, string]>): Transcription => ({
    message_id: 1, media_type: 'voice', language: 'ja', model: 'm', created_at: '', duration_seconds: 42, full_text: '',
    segments: segments.map(([start, end, text]) => ({ start, end, text, confidence: 1 })),
});

const ui = (track: ReturnType<typeof radioTrack>, time: number) => (
    <NicknameProvider nickname="みーぱん">
        <Lyrics service="hinatazaka46" track={track} currentTime={time} />
    </NicknameProvider>
);

describe('Lyrics', () => {
    it('loads the track transcript on demand and highlights the segment under the playhead', async () => {
        vi.mocked(fetchCachedTranscription).mockResolvedValue(transcription([
            [0, 2, '今日もお疲れさま'], [2, 5, '%%%、ちゃんと休んでね'], [5, 9, 'おやすみ🌙'],
        ]));
        const track = radioTrack(7, { has_transcript: true });
        const { rerender } = render(ui(track, 3));
        const lines = await screen.findAllByTestId('lyrics-line');
        expect(fetchCachedTranscription).toHaveBeenCalledWith('hinatazaka46', 7, MEMBER_PATH, expect.any(AbortSignal));
        expect(lines).toHaveLength(3);
        expect(lines[1]).toHaveTextContent('みーぱん、ちゃんと休んでね');
        expect(lines[1]).toHaveAttribute('aria-current', 'true');
        expect(lines[1].querySelector('[lang="ja"]')).not.toBeNull();
        expect(lines[0]).not.toHaveAttribute('aria-current');
        rerender(ui(track, 6));
        expect(screen.getAllByTestId('lyrics-line')[2]).toHaveAttribute('aria-current', 'true');
    });

    it('uses a clip track\'s own segments without a request', () => {
        const track = radioTrack(8, { start: 10, end: 14, has_transcript: true, segments: [{ start: 11, end: 13, text: 'おやすみ' }] });
        render(ui(track, 12));
        expect(screen.getByTestId('lyrics-line')).toHaveAttribute('aria-current', 'true');
        expect(fetchCachedTranscription).not.toHaveBeenCalled();
    });

    it('hides on a 404 and logs transcript_missing', async () => {
        vi.mocked(fetchCachedTranscription).mockResolvedValue(null);
        render(ui(radioTrack(7, { has_transcript: true }), 1));
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith(
            'memories_skip', { target: 'radio', reason: 'transcript_missing', message_id: 7 },
        ));
        expect(screen.queryByTestId('lyrics')).toBeNull();
    });

    it('hides on a failure and logs transcript_missing', async () => {
        vi.mocked(fetchCachedTranscription).mockRejectedValue(new Error('x'));
        render(ui(radioTrack(7, { has_transcript: true }), 1));
        await waitFor(() => expect(vi.mocked(clientLog)).toHaveBeenCalledWith(
            'memories_skip', { target: 'radio', reason: 'transcript_missing', message_id: 7 },
        ));
        expect(screen.queryByTestId('lyrics')).toBeNull();
    });

    it('draws nothing for a voice without a transcript', () => {
        render(ui(radioTrack(7), 1));
        expect(screen.queryByTestId('lyrics')).toBeNull();
        expect(fetchCachedTranscription).not.toHaveBeenCalled();
    });

    it('aborts the previous track\'s request and never shows its lines under the next track', async () => {
        const signals: AbortSignal[] = [];
        let resolveFirst: (t: Transcription) => void = () => {};
        vi.mocked(fetchCachedTranscription)
            .mockImplementationOnce((_s, _id, _m, signal) => {
                signals.push(signal as AbortSignal);
                return new Promise((resolve) => { resolveFirst = resolve; });
            })
            .mockImplementationOnce((_s, _id, _m, signal) => {
                signals.push(signal as AbortSignal);
                return Promise.resolve(transcription([[0, 5, 'つぎの声']]));
            });
        const { rerender } = render(ui(radioTrack(7, { has_transcript: true }), 1));
        rerender(ui(radioTrack(8, { has_transcript: true }), 1));
        expect(signals[0].aborted).toBe(true);
        expect(await screen.findByText('つぎの声')).toBeInTheDocument();
        resolveFirst(transcription([[0, 5, 'まえの声']]));
        await Promise.resolve();
        expect(screen.queryByText('まえの声')).toBeNull();
        expect(signals[1].aborted).toBe(false);
    });
});
