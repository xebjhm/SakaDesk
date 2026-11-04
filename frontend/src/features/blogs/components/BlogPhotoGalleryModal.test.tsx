import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import i18n from '../../../i18n';
import { BlogPhotoGalleryModal } from './BlogPhotoGalleryModal';
import type { BlogMeta } from '../../../types';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', () => ({ getBlogContent: vi.fn() }));
import { getBlogContent } from '../api';

beforeAll(async () => { await i18n.changeLanguage('en'); });

const BLOG: BlogMeta = { id: 'b1', title: 'ブログ 🌸', published_at: '2026-11-03T10:00:00Z', url: 'u', thumbnail: null, cached: true };

describe('BlogPhotoGalleryModal', () => {
    let release!: () => void;
    beforeEach(() => {
        const gate = new Promise<void>((r) => { release = r; });
        vi.mocked(getBlogContent).mockImplementation(async () => {
            await gate;
            return { images: [{ local_url: '/a.jpg' }, { local_url: '/b.jpg' }] } as unknown as Awaited<ReturnType<typeof getBlogContent>>;
        });
    });

    it('hides the photo count while loading, then shows it', async () => {
        render(<BlogPhotoGalleryModal isOpen onClose={vi.fn()} blogs={[BLOG]} serviceId="hinatazaka46" backupEnabled onJumpToBlog={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: i18n.t('blogGallery.title') });
        expect(dialog).toHaveTextContent(i18n.t('blogGallery.loading'));
        expect(screen.queryByText(i18n.t('blogGallery.count', { count: 0 }))).toBeNull();
        release();
        await waitFor(() => expect(screen.getByText(i18n.t('blogGallery.count', { count: 2 }))).toBeInTheDocument());
    });
});
