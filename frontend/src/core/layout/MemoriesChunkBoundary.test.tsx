import { describe, it, expect, vi, afterEach } from 'vitest';
import { Component, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clientLog } from '../../utils/clientLog';
import { MemoriesChunkBoundary, MemoriesChunkError } from './MemoriesChunkBoundary';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

class Outer extends Component<{ children: ReactNode }, { crashed: boolean }> {
    state = { crashed: false };
    static getDerivedStateFromError() { return { crashed: true }; }
    render() { return this.state.crashed ? <p>crash screen</p> : this.props.children; }
}

describe('MemoriesChunkBoundary (plan F Task 9)', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.mocked(clientLog).mockClear(); });

    it('shows an error with Retry when the chunk fails, and renders Memories after Retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = true;
        const Child = () => {
            if (fail) throw new MemoriesChunkError(new TypeError('Failed to fetch dynamically imported module'));
            return <p>思い出</p>;
        };
        const onRetry = vi.fn(() => { fail = false; });
        render(
            <Outer>
                <MemoriesChunkBoundary title="思い出を開けませんでした" retryLabel="再試行" onRetry={onRetry}>
                    <Child />
                </MemoriesChunkBoundary>
            </Outer>,
        );
        expect(screen.getByText('思い出を開けませんでした')).toBeInTheDocument();
        expect(screen.queryByText('crash screen')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: '再試行' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(screen.getByText('思い出')).toBeInTheDocument();
        // The boundary logs only the user's action; the failure itself is logged where the import rejects.
        expect(vi.mocked(clientLog).mock.calls).toEqual([['app_load_failed', { target: 'memories_chunk', outcome: 'retry' }]]);
    });

    it('reloads the page when the chunk fails again after a Retry', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(clientLog).mockClear();
        const Child = () => { throw new MemoriesChunkError(new TypeError('still failing')); };
        const onRetry = vi.fn();
        const onReload = vi.fn();
        render(
            <Outer>
                <MemoriesChunkBoundary title="t" retryLabel="Retry" onRetry={onRetry} onReload={onReload}>
                    <Child />
                </MemoriesChunkBoundary>
            </Outer>,
        );
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onReload).not.toHaveBeenCalled();
        // Failed again: the same button now reloads instead of retrying the cached import.
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onReload).toHaveBeenCalledTimes(1);
        expect(vi.mocked(clientLog).mock.calls.map(([, f]) => f?.outcome)).toEqual(['retry', 'reload']);
    });

    it('leaves any other error to the root boundary', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const Child = () => { throw new Error('render bug'); };
        render(
            <Outer>
                <MemoriesChunkBoundary title="t" retryLabel="r" onRetry={vi.fn()}>
                    <Child />
                </MemoriesChunkBoundary>
            </Outer>,
        );
        expect(screen.getByText('crash screen')).toBeInTheDocument();
    });
});
