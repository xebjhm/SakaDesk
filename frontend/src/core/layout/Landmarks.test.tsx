import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { Badge } from '../../design/primitives';
import { Layout } from './Layout';

vi.mock('./ContentArea', () => ({ ContentArea: () => <div>content</div> }));
vi.mock('./FeatureRail', () => ({ FeatureRail: () => null }));
vi.mock('./ServiceRail', () => ({ ServiceRail: () => <nav aria-label="Groups" /> }));

describe('landmarks and names (UI health A-S5, A-S2)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });

    it('puts the content area in the one main landmark', () => {
        useAppStore.setState({ activeService: 'hinatazaka46', selectedServices: ['hinatazaka46'] });
        render(<Layout messagesContent={null} onAddService={vi.fn()} onOpenSettings={vi.fn()} onReportIssue={vi.fn()} onOpenAbout={vi.fn()} onOpenSearch={vi.fn()} />);
        expect(screen.getByRole('main')).toHaveAttribute('id', 'sd-main');
        expect(screen.getByRole('main')).toHaveTextContent('content');
    });

    it('exposes a badge count as text, not as a label on a span', () => {
        const { container } = render(<Badge count={3} />);
        expect(container.querySelector('[aria-label]')).toBeNull();
        expect(container).toHaveTextContent('3 unread');
    });
});
