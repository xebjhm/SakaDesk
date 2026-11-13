import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { resetSyncProgressStore, setServiceProgress } from '../../shell/syncProgressStore';
import { ContentArea } from './ContentArea';

vi.mock('../../features/blogs', () => ({ BlogsFeature: () => <div>blogs</div> }));
vi.mock('../../features/memories/MemoriesFeature', () => ({
    MemoriesFeature: ({ nickname }: { nickname?: string }) => <div data-nickname={nickname ?? ''}>memories</div>,
}));
vi.mock('./InlineSyncView', () => ({ InlineSyncView: () => <div>syncing</div>, LiveInlineSyncView: () => <div>syncing</div> }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
const show = (feature: FeatureId) => {
    useAppStore.setState({ activeFeatures: { hinatazaka46: feature } });
    return render(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
};

describe('ContentArea', () => {
    beforeEach(() => resetSyncProgressStore());

    // First test to open Memories: the lazy component keeps its module once loaded, so only this one sees the fallback.
    it('shows the pane loading state while Memories loads, then Memories', async () => {
        show('memories');
        expect(screen.getByRole('status')).toBeInTheDocument(); // the Suspense fallback (StatusBlock)
        expect(await screen.findByText('memories')).toBeInTheDocument();
    });

    it('puts messages straight on the canvas: MessagesFeature lays out its own sheet', () => {
        show('messages');
        expect(screen.getByTestId('messages').closest('.bg-sheet')).toBeNull();
    });

    it('puts blogs on the content sheet', () => {
        show('blogs');
        expect(screen.getByText('blogs').closest('.bg-sheet')).toHaveClass('rounded-sheet', 'shadow-sheet');
    });

    it('puts memories on the content sheet', async () => {
        show('memories');
        expect((await screen.findByText('memories')).closest('.bg-sheet')).toHaveClass('rounded-sheet', 'shadow-sheet');
    });

    it('hands the service nickname to memories', async () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'memories' } });
        render(<ContentArea service="hinatazaka46" messagesContent={<div />} userNickname="ゆき" />);
        expect(await screen.findByText('memories')).toHaveAttribute('data-nickname', 'ゆき');
    });

    it('shows the inline first-sync card only while that service syncs (store slice)', () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'blogs' } });
        render(<ContentArea service="hinatazaka46" messagesContent={<div />} isInitialSyncing />);
        expect(screen.queryByText('syncing')).toBeNull();
        act(() => setServiceProgress({ hinatazaka46: { state: 'queued', queue_position: 1 } }));
        expect(screen.getByText('syncing')).toBeInTheDocument();
        act(() => setServiceProgress({ hinatazaka46: { state: 'complete' } }));
        expect(screen.queryByText('syncing')).toBeNull();
    });

    it('shows a translated placeholder for features that are not built yet', () => {
        show('news');
        expect(screen.getByText('News')).toBeInTheDocument();
        expect(screen.getByText('Coming soon')).toBeInTheDocument();
    });

    it('keeps messages mounted (hidden) after switching to blogs, and shows the same node again', () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'messages' } });
        const { rerender } = render(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
        const node = screen.getByTestId('messages');
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'blogs' } });
        rerender(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
        expect(screen.getByText('blogs')).toBeInTheDocument();
        expect(screen.getByTestId('messages')).toBe(node);
        expect(node.closest('[data-testid="kept-feature"]')).toHaveAttribute('inert');
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'messages' } });
        rerender(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
        expect(screen.getByTestId('messages')).toBe(node);
        expect(node.closest('[data-testid="kept-feature"]')).not.toHaveAttribute('inert');
    });

    it('does not mount messages before its first visit', () => {
        show('blogs');
        expect(screen.queryByTestId('messages')).toBeNull();
    });
});
