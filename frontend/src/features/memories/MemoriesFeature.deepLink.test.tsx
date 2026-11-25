import React, { StrictMode, useLayoutEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useAppStore } from '../../store/appStore';
import type { MemoriesRoute } from './MemoriesFeature';

vi.mock('../../utils/clientLog', () => ({ clientLog: vi.fn() }));
// Every page stub records each commit (a layout effect runs before paint), so a test can see
// whether a frame of the old page or of home was committed before the linked page.
const { commits } = vi.hoisted(() => ({ commits: [] as string[] }));
function Committed({ id, children }: { id: string; children?: React.ReactNode }) {
    useLayoutEffect(() => { commits.push(id); });
    return <div data-testid={id}>{children}</div>;
}
import { clientLog } from '../../utils/clientLog';
// The pages are stubs: this file tests the router's deep-link handling, not the pages.
vi.mock('./recap/api', () => ({ fetchRecapYears: vi.fn(() => new Promise(() => {})) }));
vi.mock('./useMemoriesUiReporter', () => ({ useMemoriesUiReporter: vi.fn() }));
vi.mock('./MemoriesHome', () => ({ MemoriesHome: () => <Committed id="memories-home" /> }));
vi.mock('./recap/RecapEntry', () => ({
    RecapEntry: ({ year }: { year: number }) => <Committed id="recap-entry"><span data-testid="recap-year">{year}</span></Committed>,
}));
vi.mock('./album/AlbumPage', () => ({ AlbumPage: () => <Committed id="memories-page-album" /> }));
vi.mock('./onThisDay/OnThisDayPage', () => ({
    OnThisDayPage: ({ route }: { route: MemoriesRoute }) => <div data-testid="memories-page-onThisDay" data-route={JSON.stringify(route)} />,
}));
vi.mock('./memoir/MemoirPage', () => ({
    MemoirPage: ({ route }: { route: MemoriesRoute }) => <div data-testid="memories-page-memoir" data-route={JSON.stringify(route)} />,
}));
import { useMemoriesUiReporter } from './useMemoriesUiReporter';
import { MemoriesFeature } from './MemoriesFeature';

const PATH = '日向坂46/messages/34 金村 美玖/58 金村 美玖';

function link(service: string, route: MemoriesRoute) {
    act(() => { useAppStore.getState().openMemoriesAt(service, route); });
}

describe('MemoriesFeature deep link', () => {
    beforeEach(() => {
        commits.length = 0;
        vi.mocked(clientLog).mockClear();
        useAppStore.setState({
            selectedServices: ['hinatazaka46', 'sakurazaka46'],
            activeService: 'hinatazaka46',
            activeFeatures: {},
            memoriesDeepLink: null,
        });
    });

    it('runs the Memories UI reporter', () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        expect(useMemoriesUiReporter).toHaveBeenCalled();
    });

    it('opens the stored link on mount and clears it', () => {
        const route: MemoriesRoute = { page: 'memoir', memberPath: PATH, tab: 'binder', cardKey: 'anniv.y1' };
        link('hinatazaka46', route);
        render(<MemoriesFeature service="hinatazaka46" />);
        expect(JSON.parse(screen.getByTestId('memories-page-memoir').dataset.route!)).toEqual(route);
        expect(useAppStore.getState().memoriesDeepLink).toBeNull();
        expect(clientLog).toHaveBeenCalledWith('memories_page', { target: 'memoir' });
    });

    it('moves an open Memories to the linked page and logs the page change', () => {
        render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'album' }} />);
        expect(screen.getByTestId('memories-page-album')).toBeInTheDocument();
        vi.mocked(clientLog).mockClear();
        link('hinatazaka46', { page: 'recap', year: 2026 });
        expect(screen.getByTestId('recap-year')).toHaveTextContent('2026');
        expect(clientLog).toHaveBeenCalledWith('memories_page', { target: 'recap' });
        expect(useAppStore.getState().memoriesDeepLink).toBeNull();
    });

    it('applies a second click to the same route again', () => {
        render(<MemoriesFeature service="hinatazaka46" />);
        link('hinatazaka46', { page: 'onThisDay', monthDay: '11-11', year: 2023 });
        expect(screen.getByTestId('memories-page-onThisDay')).toBeInTheDocument();
        link('hinatazaka46', { page: 'onThisDay', monthDay: '11-11', year: 2023 });
        const pages = vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_page');
        expect(pages).toEqual([
            ['memories_page', { target: 'on_this_day' }],
            ['memories_page', { target: 'on_this_day' }],
        ]);
        expect(useAppStore.getState().memoriesDeepLink).toBeNull();
    });

    it('ignores a link for another service until the service changes, then applies it', () => {
        const { rerender } = render(<MemoriesFeature service="hinatazaka46" />);
        link('sakurazaka46', { page: 'onThisDay', monthDay: '11-11', year: 2023 });
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
        expect(useAppStore.getState().memoriesDeepLink).not.toBeNull();
        rerender(<MemoriesFeature service="sakurazaka46" />);
        expect(JSON.parse(screen.getByTestId('memories-page-onThisDay').dataset.route!))
            .toEqual({ page: 'onThisDay', monthDay: '11-11', year: 2023 });
        expect(useAppStore.getState().memoriesDeepLink).toBeNull();
    });

    it('never re-applies a cleared link after a remount', () => {
        link('hinatazaka46', { page: 'recap', year: 2026 });
        const { unmount } = render(<MemoriesFeature service="hinatazaka46" />);
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        unmount();
        render(<MemoriesFeature service="hinatazaka46" />);
        expect(screen.getByTestId('memories-home')).toBeInTheDocument();
        expect(screen.queryByTestId('recap-entry')).toBeNull();
    });

    it('commits the linked page first when Memories is already open (no frame of the old page)', () => {
        render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'album' }} />);
        commits.length = 0;
        link('hinatazaka46', { page: 'recap', year: 2026 });
        expect(commits[0]).toBe('recap-entry');
        expect(commits).not.toContain('memories-page-album');
    });

    it('commits the linked page first when the link switches service (no frame of home)', () => {
        const { rerender } = render(<MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'album' }} />);
        link('sakurazaka46', { page: 'recap', year: 2026 });
        commits.length = 0;
        rerender(<MemoriesFeature service="sakurazaka46" />);
        expect(commits[0]).toBe('recap-entry');
        expect(commits).not.toContain('memories-home');
        expect(commits).not.toContain('memories-page-album');
    });

    it('logs the linked page once under StrictMode', () => {
        link('hinatazaka46', { page: 'recap', year: 2026 });
        render(<StrictMode><MemoriesFeature service="hinatazaka46" /></StrictMode>);
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        expect(vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_page'))
            .toEqual([['memories_page', { target: 'recap' }]]);
        expect(useAppStore.getState().memoriesDeepLink).toBeNull();
    });

    it('logs only the linked page when mounted with both an initial route and a link', () => {
        link('hinatazaka46', { page: 'recap', year: 2026 });
        render(<StrictMode><MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'album' }} /></StrictMode>);
        expect(screen.getByTestId('recap-entry')).toBeInTheDocument();
        expect(vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_page'))
            .toEqual([['memories_page', { target: 'recap' }]]);
    });

    it('logs an initial route once under StrictMode', () => {
        render(<StrictMode><MemoriesFeature service="hinatazaka46" initialRoute={{ page: 'album' }} /></StrictMode>);
        expect(vi.mocked(clientLog).mock.calls.filter((c) => c[0] === 'memories_page'))
            .toEqual([['memories_page', { target: 'album' }]]);
    });
});
