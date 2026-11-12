import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { LazyVoice } from './LazyVoice';
import { fadeOutMemoriesVoices, stopMemoriesVoices, useVoicePlayback } from './voicePlayback';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { stopMemoriesVoices(); });

const Two: React.FC<{ showB?: boolean }> = ({ showB = true }) => (
    <>
        <div data-testid="a"><LazyVoice playKey="t|r|1" src="/a.m4a" durationS={75} ts="2024-01-01T00:00:00Z" /></div>
        {showB && <div data-testid="b"><LazyVoice playKey="t|r|2" src="/b.m4a" durationS={0} ts="2024-01-01T00:00:00Z" /></div>}
    </>
);

describe('LazyVoice', () => {
    it('mounts no audio until played, and shows a duration only when known', () => {
        render(<Two />);
        expect(document.querySelector('audio')).toBeNull();
        expect(screen.getByTestId('a')).toHaveTextContent('01:15');
        expect(screen.getByTestId('b').textContent).toBe('');
    });

    it('plays one voice at a time: starting B unmounts A', async () => {
        render(<Two />);
        await userEvent.click(within(screen.getByTestId('a')).getByRole('button', { name: 'Play voice' }));
        expect(screen.getByTestId('a').querySelector('audio')).not.toBeNull();
        await userEvent.click(within(screen.getByTestId('b')).getByRole('button', { name: 'Play voice' }));
        expect(screen.getByTestId('b').querySelector('audio')).not.toBeNull();
        expect(screen.getByTestId('a').querySelector('audio')).toBeNull();
    });

    it('stops on unmount and on stopMemoriesVoices', async () => {
        const { rerender } = render(<Two />);
        await userEvent.click(within(screen.getByTestId('b')).getByRole('button', { name: 'Play voice' }));
        rerender(<Two showB={false} />);
        expect(useVoicePlayback.getState().playing).toBeNull();
        rerender(<Two />);
        expect(document.querySelector('audio')).toBeNull();

        await userEvent.click(within(screen.getByTestId('a')).getByRole('button', { name: 'Play voice' }));
        expect(document.querySelector('audio')).not.toBeNull();
        act(() => stopMemoriesVoices());
        expect(screen.getAllByRole('button', { name: 'Play voice' })).toHaveLength(2);
        expect(document.querySelector('audio')).toBeNull();
    });

    it('stops when another Memories player (the radio) takes the voice', async () => {
        render(<Two />);
        await userEvent.click(within(screen.getByTestId('a')).getByRole('button', { name: 'Play voice' }));
        expect(useVoicePlayback.getState().handle).not.toBeNull();
        const radio = { stop: vi.fn(), fadeOut: vi.fn(() => Promise.resolve()) };
        act(() => useVoicePlayback.getState().play('radio|program', radio));
        expect(document.querySelector('audio')).toBeNull();
        expect(useVoicePlayback.getState().playing).toBe('radio|program');
    });

    it('registers a handle whose fade is an immediate stop', async () => {
        render(<Two />);
        await userEvent.click(within(screen.getByTestId('a')).getByRole('button', { name: 'Play voice' }));
        await act(() => fadeOutMemoriesVoices(3000));
        expect(useVoicePlayback.getState().playing).toBeNull();
        expect(document.querySelector('audio')).toBeNull();
    });
});
