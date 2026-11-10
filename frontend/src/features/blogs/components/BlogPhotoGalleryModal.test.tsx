import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
        // The loading label shows after StatusBlock's 200 ms reveal.
        await waitFor(() => expect(dialog).toHaveTextContent(i18n.t('blogGallery.loading')));
        expect(screen.queryByText(i18n.t('blogGallery.count', { count: 0 }))).toBeNull();
        release();
        await waitFor(() => expect(screen.getByText(i18n.t('blogGallery.count', { count: 2 }))).toBeInTheDocument());
    });

    it('draws the viewer controls as circles on the dark chrome', async () => {
        render(<BlogPhotoGalleryModal isOpen onClose={vi.fn()} blogs={[BLOG]} serviceId="hinatazaka46" backupEnabled onJumpToBlog={vi.fn()} />);
        release();
        await waitFor(() => expect(screen.getByText(i18n.t('blogGallery.count', { count: 2 }))).toBeInTheDocument());
        const thumb = document.querySelector('img')!.closest('button')!;
        fireEvent.click(thumb);
        const viewer = await screen.findByRole('dialog', { name: i18n.t('common.mediaViewer') });
        const close = Array.from(viewer.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === i18n.t('common.close'))!;
        expect(close).toHaveAttribute('data-shape', 'circle');
        for (const name of [/next/i, /previous/i]) {
            const control = screen.queryByRole('button', { name });
            if (control) expect(control).toHaveAttribute('data-shape', 'circle');
        }
    });

    it('has no top padding on the scroller, so photos do not show above the sticky month header', async () => {
        render(<BlogPhotoGalleryModal isOpen onClose={vi.fn()} blogs={[BLOG]} serviceId="hinatazaka46" backupEnabled onJumpToBlog={vi.fn()} />);
        release();
        await waitFor(() => expect(screen.getByText(i18n.t('blogGallery.count', { count: 2 }))).toBeInTheDocument());
        expect(screen.getByTestId('modal-body')).toHaveClass('pt-0');
        const header = screen.getByTestId('modal-body').querySelector('.sticky')!;
        expect(header).toHaveClass('top-0');
    });

    it('left is older and right is newer in the viewer, although the grid is newest first', async () => {
        const OLDER: BlogMeta = { ...BLOG, id: 'b0', published_at: '2026-10-01T10:00:00Z' };
        vi.mocked(getBlogContent).mockImplementation(async (_s, id) => {
            await Promise.resolve();
            return { images: [{ local_url: id === 'b0' ? '/old.jpg' : '/new.jpg' }] } as unknown as Awaited<ReturnType<typeof getBlogContent>>;
        });
        render(<BlogPhotoGalleryModal isOpen onClose={vi.fn()} blogs={[BLOG, OLDER]} serviceId="hinatazaka46" backupEnabled onJumpToBlog={vi.fn()} />);
        release();
        await waitFor(() => expect(screen.getByText(i18n.t('blogGallery.count', { count: 2 }))).toBeInTheDocument());
        const thumbs = Array.from(document.querySelectorAll('img')).map((i) => i.closest('button')!);
        fireEvent.click(thumbs[0]);
        const viewer = await screen.findByRole('dialog', { name: i18n.t('common.mediaViewer') });
        const shown = () => viewer.querySelector('img')?.getAttribute('src');
        expect(shown()).toBe('/new.jpg');
        expect(screen.getByText('2 / 2')).toBeInTheDocument();
        fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
        expect(shown()).toBe('/old.jpg');
        expect(screen.getByText('1 / 2')).toBeInTheDocument();
        fireEvent.keyDown(viewer, { key: 'ArrowRight' });
        expect(shown()).toBe('/new.jpg');
    });
});
