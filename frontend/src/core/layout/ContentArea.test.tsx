import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore, type FeatureId } from '../../store/appStore';
import { ContentArea } from './ContentArea';

vi.mock('../../features/blogs', () => ({ BlogsFeature: () => <div>blogs</div> }));
vi.mock('../../features/memories', () => ({
    MemoriesFeature: ({ nickname }: { nickname?: string }) => <div data-nickname={nickname ?? ''}>memories</div>,
}));
vi.mock('./InlineSyncView', () => ({ InlineSyncView: () => <div>syncing</div> }));

beforeAll(async () => { await i18n.changeLanguage('en'); });
const show = (feature: FeatureId) => {
    useAppStore.setState({ activeFeatures: { hinatazaka46: feature } });
    return render(<ContentArea service="hinatazaka46" messagesContent={<div data-testid="messages" />} />);
};

describe('ContentArea', () => {
    it('puts messages straight on the canvas: MessagesFeature lays out its own sheet', () => {
        show('messages');
        expect(screen.getByTestId('messages').closest('.bg-sheet')).toBeNull();
    });

    it('puts blogs on the content sheet', () => {
        show('blogs');
        expect(screen.getByText('blogs').closest('.bg-sheet')).toHaveClass('rounded-sheet', 'shadow-sheet');
    });

    it('puts memories on the content sheet', () => {
        show('memories');
        expect(screen.getByText('memories').closest('.bg-sheet')).toHaveClass('rounded-sheet', 'shadow-sheet');
    });

    it('hands the service nickname to memories', () => {
        useAppStore.setState({ activeFeatures: { hinatazaka46: 'memories' } });
        render(<ContentArea service="hinatazaka46" messagesContent={<div />} userNickname="ゆき" />);
        expect(screen.getByText('memories')).toHaveAttribute('data-nickname', 'ゆき');
    });

    it('shows a translated placeholder for features that are not built yet', () => {
        show('news');
        expect(screen.getByText('News')).toBeInTheDocument();
        expect(screen.getByText('Coming soon')).toBeInTheDocument();
    });
});
