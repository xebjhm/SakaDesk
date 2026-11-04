import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { SearchFilterBar } from './SearchFilterBar';
import type { FilterChip } from '../types';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => { vi.mocked(clientLog).mockClear(); });

const CHIP: FilterChip = { type: 'member', id: 'hinatazaka46:58', label: '金村 美玖', color: '#7cc7e8' };

function renderBar(onFiltersChange = vi.fn()) {
    render(
        <SearchFilterBar
            selectedFilters={[CHIP]} onFiltersChange={onFiltersChange}
            exactOnly={false} onExactOnlyChange={vi.fn()} includeUnread={false} onIncludeUnreadChange={vi.fn()}
            dateRange="all" onDateRangeChange={vi.fn()} contentType="all" onContentTypeChange={vi.fn()}
        />,
    );
    return onFiltersChange;
}

describe('SearchFilterBar', () => {
    it('names each chip remove button after its filter', async () => {
        server.use(http.get('/api/search/members', () => HttpResponse.json({ members: [], services: [] })));
        const onFiltersChange = renderBar();
        fireEvent.click(screen.getByRole('button', { name: i18n.t('search.removeFilter', { name: '金村 美玖' }) }));
        expect(onFiltersChange).toHaveBeenCalledWith([]);
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'search_members', outcome: 'ok' }));
    });

    it('logs a failed member list load as an error', async () => {
        server.use(http.get('/api/search/members', () => HttpResponse.error()));
        renderBar();
        await waitFor(() => expect(clientLog).toHaveBeenCalledWith('dialog_load', { surface: 'search_members', outcome: 'error' }));
    });
});
