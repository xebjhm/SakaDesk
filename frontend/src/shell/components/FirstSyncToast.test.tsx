import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';
import i18n from '../../i18n';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { FirstSyncToast, FIRST_SYNC_TOAST_MS } from './FirstSyncToast';

beforeAll(async () => { await i18n.changeLanguage('en'); });

describe('FirstSyncToast (decision D11)', () => {
    it('is a brand tier-B toast on the toast layer that never takes the pointer, with the saved count', async () => {
        server.use(http.get('/api/archive/stats', () => HttpResponse.json({ messages: 12846, photos: 10, first_message_at: null })));
        render(<FirstSyncToast onDone={vi.fn()} />);
        const layer = screen.getByTestId('first-sync-toast');
        expect(layer).toHaveClass('pointer-events-none', 'fixed', 'bottom-4', 'right-4');
        expect(layer.querySelector('[data-scope="brand"]')).not.toBeNull();
        const toast = screen.getByRole('status');
        expect(toast).toHaveTextContent('Your archive is ready');
        expect(await screen.findByText('12,846 messages saved')).toBeInTheDocument();
        expect(toast.querySelectorAll('[data-sparkle]')).toHaveLength(10);
    });

    it('leaves out the count when it is unknown and goes away by itself', () => {
        vi.useFakeTimers();
        const onDone = vi.fn();
        const { unmount } = render(<FirstSyncToast onDone={onDone} />);
        expect(screen.queryByText(/messages saved/)).toBeNull();
        vi.advanceTimersByTime(FIRST_SYNC_TOAST_MS);
        expect(onDone).toHaveBeenCalledOnce();
        unmount();
        vi.useRealTimers();
    });
});
