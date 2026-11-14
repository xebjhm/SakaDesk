import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { clientLog } from '../../utils/clientLog';
import { ContentArea } from './ContentArea';

const attempts = vi.hoisted(() => ({ count: 0 }));
// The first load of the Memories chunk fails (as a missing file would); the second succeeds.
vi.mock('../../features/memories/MemoriesFeature', () => {
    attempts.count += 1;
    if (attempts.count === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return { MemoriesFeature: () => <div>memories</div> };
});
vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('ContentArea Memories chunk failure (plan F Task 9)', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(clientLog).mockClear();
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'memories' } });
    });
    afterEach(() => { consoleError.mockRestore(); vi.doUnmock('../../features/memories/MemoriesFeature'); });

    it('shows an error with Retry inside the pane, and Retry loads Memories', async () => {
        render(<ErrorBoundary><ContentArea service="hinatazaka46" messagesContent={<div />} /></ErrorBoundary>);
        expect(await screen.findByText("Couldn't open Memories")).toBeInTheDocument();
        expect(screen.queryByText('Something went wrong')).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('memories')).toBeInTheDocument();
        // One breadcrumb per failure, then the retry.
        expect(vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'app_load_failed').map(([, f]) => f))
            .toEqual([{ target: 'memories_chunk', outcome: 'failed' }, { target: 'memories_chunk', outcome: 'retry' }]);
    });

    it('stays in the pane when Retry fails again (a second Retry then reloads the page)', async () => {
        vi.resetModules();
        // A fresh registry and a fresh mock: this chunk fails on every load.
        vi.doMock('../../features/memories/MemoriesFeature', () => { throw new TypeError('Failed to fetch dynamically imported module'); });
        const { ContentArea: Fresh } = await import('./ContentArea');
        const { useAppStore: freshStore } = await import('../../store/appStore');
        const { clientLog: freshLog } = await import('../../utils/clientLog');
        await (await import('../../i18n')).default.changeLanguage('en');
        freshStore.setState({ activeFeatures: { hinatazaka46: 'memories' } });
        render(<Fresh service="hinatazaka46" messagesContent={<div />} />);
        expect(await screen.findByText("Couldn't open Memories")).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        // The re-created lazy failed too: the pane error is back, not the root crash screen.
        await vi.waitFor(() => expect(vi.mocked(freshLog).mock.calls.filter(([, f]) => f?.outcome === 'failed')).toHaveLength(2));
        expect(await screen.findByText("Couldn't open Memories")).toBeInTheDocument();
        expect(screen.queryByText('Something went wrong')).toBeNull();
    });
});
