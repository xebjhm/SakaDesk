import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../__tests__/mocks/server';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../utils/clientLog';
import { archiveDays, useArchiveStats } from './archiveStats';

afterEach(() => vi.mocked(clientLog).mockClear());

describe('archiveDays (decision D9)', () => {
    it('counts calendar days from the earliest message to today, both included', () => {
        expect(archiveDays(new Date(2026, 10, 1, 12).toISOString(), new Date(2026, 10, 6, 9))).toBe(6);
        expect(archiveDays(new Date(2026, 10, 6, 0, 30).toISOString(), new Date(2026, 10, 6, 23))).toBe(1);
    });

    it('is null (unknown, not 0) for a missing or unreadable earliest time', () => {
        expect(archiveDays(null, new Date(2026, 10, 6))).toBeNull();
        expect(archiveDays('not a date', new Date(2026, 10, 6))).toBeNull();
    });
});

describe('useArchiveStats', () => {
    it('loads the totals once the dialog opens and logs the load', async () => {
        server.use(http.get('/api/archive/stats', () => HttpResponse.json({ messages: 12846, photos: 2301, first_message_at: null })));
        const { result, rerender } = renderHook(({ open }) => useArchiveStats(open), { initialProps: { open: false } });
        expect(result.current).toEqual({ status: 'loading' });
        rerender({ open: true });
        await waitFor(() => expect(result.current).toEqual({ status: 'ready', stats: { messages: 12846, photos: 2301, days: null } }));
        expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'ok' });
    });

    it('reports and logs a failed load', async () => {
        server.use(http.get('/api/archive/stats', () => new HttpResponse(null, { status: 500 })));
        const { result } = renderHook(() => useArchiveStats(true));
        await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
        expect(clientLog).toHaveBeenCalledWith('archive_stats_load', { outcome: 'failed' });
    });
});
