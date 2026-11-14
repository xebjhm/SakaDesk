import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeepMounted } from './KeepMounted';
import { useFeatureActive } from '../../design/featureActive';
import { clientLog } from '../../utils/clientLog';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

const Probe = () => <span data-testid="probe">{useFeatureActive() ? 'active' : 'hidden'}</span>;

describe('KeepMounted', () => {
    it('shows its child normally while active', () => {
        render(<KeepMounted active><Probe /></KeepMounted>);
        const box = screen.getByTestId('kept-feature');
        expect(box).not.toHaveAttribute('inert');
        expect(box.style.contentVisibility).toBe('');
        expect(screen.getByTestId('probe')).toHaveTextContent('active');
    });

    it('keeps the same child mounted, inert and skipped from rendering while hidden', () => {
        const { rerender } = render(<KeepMounted active><Probe /></KeepMounted>);
        const node = screen.getByTestId('probe');
        rerender(<KeepMounted active={false}><Probe /></KeepMounted>);
        const box = screen.getByTestId('kept-feature');
        expect(screen.getByTestId('probe')).toBe(node);
        expect(box).toHaveAttribute('inert');
        expect(box.style.contentVisibility).toBe('hidden');
        expect(node).toHaveTextContent('hidden');

        rerender(<KeepMounted active><Probe /></KeepMounted>);
        expect(screen.getByTestId('kept-feature')).not.toHaveAttribute('inert');
        expect(screen.getByTestId('kept-feature').style.contentVisibility).toBe('');
        expect(screen.getByTestId('probe')).toBe(node);
        expect(node).toHaveTextContent('active');
    });

    it('pauses a voice or video still playing inside it when it is hidden (as the unmount did)', () => {
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
        const media = <><audio data-testid="playing" /><video data-testid="idle" /></>;
        const { rerender } = render(<KeepMounted active>{media}</KeepMounted>);
        const playing = screen.getByTestId('playing') as HTMLAudioElement;
        Object.defineProperty(playing, 'paused', { value: false, configurable: true });
        rerender(<KeepMounted active={false}>{media}</KeepMounted>);
        expect(pause).toHaveBeenCalledTimes(1);
        expect(pause.mock.contexts[0]).toBe(playing);
        expect(clientLog).toHaveBeenCalledWith('media_playback', { outcome: 'paused', reason: 'feature_hidden', count: 1 });
        rerender(<KeepMounted active>{media}</KeepMounted>);
        expect(pause).toHaveBeenCalledTimes(1);
        pause.mockRestore();
    });
});
