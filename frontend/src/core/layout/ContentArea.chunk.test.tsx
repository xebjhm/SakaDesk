import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
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
    it('shows an error with Retry inside the pane, and Retry loads Memories', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'memories' } });
        render(<ContentArea service="hinatazaka46" messagesContent={<div />} />);
        expect(await screen.findByText("Couldn't open Memories")).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByText('memories')).toBeInTheDocument();
    });
});
