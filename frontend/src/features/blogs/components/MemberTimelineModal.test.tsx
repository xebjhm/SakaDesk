import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '../../../i18n';
import { MemberTimelineModal } from './MemberTimelineModal';
import type { BlogMeta } from '../../../types';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const now = new Date();
const blog = (id: string, monthsAgo: number, title: string): BlogMeta => ({
    id, title, member_id: '9901', member_name: '春野 ひなた', thumbnail: null, cached: false,
    published_at: new Date(now.getFullYear(), now.getMonth() - monthsAgo, 5, 9).toISOString(),
} as unknown as BlogMeta);
const blogs = [blog('1', 0, '今日の日記 🌸'), blog('2', 6, '昔の日記')];

function renderModal() {
    const props = {
        isOpen: true, onClose: vi.fn(), member: { id: '9901', name: '春野 ひなた' }, blogs,
        loading: false, error: null, onSelectBlog: vi.fn(), onRetry: vi.fn(), onOpenPhotoGallery: vi.fn(),
    };
    render(<MemberTimelineModal {...(props as React.ComponentProps<typeof MemberTimelineModal>)} />);
    return props;
}

describe('MemberTimelineModal', () => {
    it('shows recent months open and older ones closed; a month header toggles', () => {
        renderModal();
        expect(screen.getByText('今日の日記 🌸')).toBeInTheDocument();
        expect(screen.queryByText('昔の日記')).toBeNull();
        const headers = screen.getAllByRole('button').filter((b) => b.textContent?.includes('1 post'));
        fireEvent.click(headers[headers.length - 1]);
        expect(screen.getByText('昔の日記')).toBeInTheDocument();
    });

    it('selects a post and opens the album', () => {
        const p = renderModal();
        fireEvent.click(screen.getByText('今日の日記 🌸'));
        expect(p.onSelectBlog).toHaveBeenCalledWith(blogs[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Photo Album' }));
        expect(p.onOpenPhotoGallery).toHaveBeenCalled();
    });

    it('closes on Escape', () => {
        const p = renderModal();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(p.onClose).toHaveBeenCalled();
    });
});
