import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { useAppStore } from '../../../store/appStore';
import { MemberSelectModal } from './MemberSelectModal';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => useAppStore.setState({ favorites: {} }));

const members = [
    { id: '9901', name: '春野 ひなた', thumbnail: null },
    { id: '9902', name: '秋山 さくら', thumbnail: null },
];

function renderModal(over: Partial<React.ComponentProps<typeof MemberSelectModal>> = {}) {
    const props = {
        isOpen: true, onClose: vi.fn(), members, loading: false, error: null,
        onSelectMember: vi.fn(), onRetry: vi.fn(), serviceId: 'hinatazaka46', ...over,
    };
    render(<MemberSelectModal {...(props as React.ComponentProps<typeof MemberSelectModal>)} />);
    return props;
}

describe('MemberSelectModal', () => {
    it('selects a member by click', () => {
        const p = renderModal();
        fireEvent.click(screen.getByText(/春野/));
        expect(p.onSelectMember).toHaveBeenCalledWith(expect.objectContaining({ id: '9901' }));
    });

    it('toggles a favourite without selecting the member', () => {
        const p = renderModal();
        const heart = screen.getAllByRole('button', { pressed: false })[0];
        fireEvent.click(heart);
        expect(useAppStore.getState().favorites['hinatazaka46']).toContain('9901');
        expect(p.onSelectMember).not.toHaveBeenCalled();
    });

    it('closes on Escape', () => {
        const p = renderModal();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(p.onClose).toHaveBeenCalled();
    });

    it('shows the retry on an error', () => {
        const p = renderModal({ error: 'x' });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(p.onRetry).toHaveBeenCalled();
    });

    it('is a titled dialog; members are buttons; the heart is named', () => {
        renderModal();
        expect(screen.getByRole('dialog', { name: 'Select Member' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^春野 ひなた$/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add 春野 ひなた to favorites' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('names the heart with the formatted (spaced) name', async () => {
        renderModal({ members: [{ id: '9903', name: '春野日向', thumbnail: null }] });
        expect(screen.getByRole('button', { name: /^春野 日向$/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add 春野 日向 to favorites' })).toBeInTheDocument();
    });
});
