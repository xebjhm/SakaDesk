import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { RecapEntry } from './RecapEntry';
import { MEMBER_PATH, overview, payload } from './__fixtures__/payload';
import type { RecapOverview, RecapPayload } from './api';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';

const loadLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_load');

function serve(opts: { overview?: (year: number) => RecapOverview | null; recap?: RecapPayload } = {}) {
    const seen = { members: [] as number[], member: [] as string[] };
    server.use(
        http.get('/api/memories/:service/recap/:year/members', ({ params }) => {
            const year = Number(params.year);
            seen.members.push(year);
            const body = opts.overview ? opts.overview(year) : overview({ year });
            return body ? HttpResponse.json(body) : HttpResponse.json({ detail: 'x' }, { status: 500 });
        }),
        http.get('/api/memories/:service/recap/:year', ({ request }) => {
            seen.member.push(new URL(request.url).searchParams.get('member') ?? '');
            return HttpResponse.json(opts.recap ?? payload());
        }),
    );
    return seen;
}

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => { vi.mocked(clientLog).mockClear(); });

describe('RecapEntry', () => {
    it('lists members with a recap and their title chips', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
        const row = await screen.findByRole('button', { name: /金村 美玖/ });
        expect(row).toHaveTextContent('名前をいちばん呼んでくれた絆');
        expect(screen.queryByText('小坂 菜緒')).toBeNull();
        expect(loadLogs()).toContainEqual(['recap_load', expect.objectContaining({ target: 'members', outcome: 'ok', count: 1 })]);
    });

    it('steps the year with the chooser', async () => {
        const seen = serve();
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
        await screen.findByRole('button', { name: /金村 美玖/ });
        await userEvent.click(screen.getByRole('button', { name: '前の年' }));
        await waitFor(() => expect(seen.members).toContain(2025));
        expect(screen.getByText('2025年')).toBeInTheDocument();
    });

    it('opens the player for a member and returns on close', async () => {
        const seen = serve();
        render(<RecapEntry service="hinatazaka46" year={2026} nickname="ゆき" onBack={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
        expect(await screen.findByTestId('recap-stage')).toBeInTheDocument();
        expect(seen.member).toEqual([MEMBER_PATH]);
        await userEvent.keyboard('{Escape}');
        expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
    });

    it('opens straight into the player for a routed member', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} memberPath={MEMBER_PATH} onBack={() => {}} />);
        expect(await screen.findByTestId('recap-stage')).toBeInTheDocument();
    });

    it('stands in a gentle word when the nickname is unset, and logs the fallback', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} memberPath={MEMBER_PATH} onBack={() => {}} />);
        expect(await screen.findByText('あなた、あけましておめでとう🌸')).toBeInTheDocument();
        expect(loadLogs()).toContainEqual(['recap_load', expect.objectContaining({ target: 'member', outcome: 'ok', count: 4, fallback: 'no_nickname' })]);
    });

    it('shows a gentle state, never a 0, for a tier-none recap', async () => {
        serve({ recap: payload({ tier: 'none', slides: [], poster: null }) });
        render(<RecapEntry service="hinatazaka46" year={2026} memberPath={MEMBER_PATH} onBack={() => {}} />);
        expect(await screen.findByText('来年のあなたへ')).toBeInTheDocument();
        expect(screen.queryByTestId('recap-stage')).toBeNull();
        expect(document.body.textContent).not.toMatch(/\b0\b/);
        expect(loadLogs()).toContainEqual(['recap_load', expect.objectContaining({ target: 'member', outcome: 'empty' })]);
    });

    it('shows a gentle state when no member has a recap this year', async () => {
        serve({ overview: (year) => overview({ year, members: [] }) });
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
        expect(await screen.findByText('来年のあなたへ')).toBeInTheDocument();
    });

    it('offers a retry when the overview fails', async () => {
        let fail = true;
        serve({ overview: (year) => (fail ? null : overview({ year })) });
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
        const retry = await screen.findByRole('button', { name: '再試行' });
        fail = false;
        await userEvent.click(retry);
        expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
    });

    it('goes back to the hub', async () => {
        serve();
        const onBack = vi.fn();
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={onBack} />);
        await userEvent.click(screen.getByRole('button', { name: '戻る' }));
        expect(onBack).toHaveBeenCalled();
    });
});
