import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
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
// The real client, wrapped so a test can make one poll come back `skipped`.
vi.mock('./api', async (importOriginal) => {
    const real = await importOriginal<typeof import('./api')>();
    return { ...real, fetchRecapMembers: vi.fn(real.fetchRecapMembers), fetchMemberRecap: vi.fn(real.fetchMemberRecap) };
});
import { fetchMemberRecap, fetchRecapMembers } from './api';

const loadLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_load');
const playLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_play');
const opens = () => playLogs().filter(([, f]) => (f as { phase?: string }).phase === 'open');

const PATH_B = '日向坂46/messages/40 正源司 陽子/70 正源司 陽子';

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
beforeEach(() => {
    vi.mocked(clientLog).mockClear();
    // 2026 is the current (open, partial) year; only `Date` is faked so msw and user-event keep their timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-10T12:00:00+09:00'));
});
afterEach(() => { vi.useRealTimers(); });

describe('RecapEntry', () => {
    it('lists members with a recap and their title chips', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
        const row = await screen.findByRole('button', { name: /金村 美玖/ });
        expect(row).toHaveTextContent('いちばん名前を呼んでくれた絆');
        // A member without a recap is a quiet 来年のあなたへ card, not a recap to open.
        expect(screen.queryByRole('button', { name: /小坂 菜緒/ })).toBeNull();
        expect(screen.getByTestId('recap-quiet-member')).toHaveTextContent('小坂 菜緒');
        expect(screen.getByTestId('recap-quiet-member')).toHaveTextContent('来年のあなたへ');
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

    it('reopening the same member logs open exactly once per opening', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} nickname="ゆき" onBack={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
        await screen.findByTestId('recap-stage');
        expect(opens()).toHaveLength(1);
        await userEvent.keyboard('{Escape}');
        await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
        await screen.findByTestId('recap-stage');
        expect(opens()).toHaveLength(2);
    });

    it('never mounts the player for member B with member A\'s recap', async () => {
        let releaseB: () => void = () => {};
        const bReady = new Promise<void>((resolve) => { releaseB = resolve; });
        server.use(
            http.get('/api/memories/:service/recap/:year/members', () => HttpResponse.json(overview({
                members: [
                    { member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', tier: 'full', oshi: true, title_key: null },
                    { member_path: PATH_B, member_id: '70', name: '正源司 陽子', tier: 'full', oshi: false, title_key: null },
                ],
            }))),
            http.get('/api/memories/:service/recap/:year', async ({ request }) => {
                const member = new URL(request.url).searchParams.get('member');
                if (member === PATH_B) {
                    await bReady;
                    return HttpResponse.json(payload({ member: { ...payload().member, id: '70', name: '正源司 陽子' } }));
                }
                return HttpResponse.json(payload());
            }),
        );
        render(<RecapEntry service="hinatazaka46" year={2026} nickname="ゆき" onBack={() => {}} />);
        // Two members with a recap: the opening plays first; Esc goes on to the list.
        expect(await screen.findByTestId('recap-stage')).toHaveAttribute('data-slide', 'o1_stars');
        await userEvent.keyboard('{Escape}');
        await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
        await screen.findByTestId('recap-stage');
        await userEvent.keyboard('{Escape}');
        vi.mocked(clientLog).mockClear();
        await userEvent.click(await screen.findByRole('button', { name: /正源司 陽子/ }));
        expect(screen.queryByTestId('recap-stage')).toBeNull();
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(playLogs().filter(([, f]) => (f as { member_id?: string }).member_id === '58')).toEqual([]);
        releaseB();
        expect(await screen.findByTestId('recap-stage')).toBeInTheDocument();
        expect(opens()).toEqual([['recap_play', expect.objectContaining({ phase: 'open', member_id: '70' })]]);
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

    it('a past year\'s quiet cards never speak of "next year"', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2024} years={[2024, 2026]} onBack={() => {}} />);
        const quiet = await screen.findByTestId('recap-quiet-member');
        expect(quiet).toHaveTextContent('これからのあなたへ');
        expect(quiet).not.toHaveTextContent('来年');
    });

    it('a past year with nobody to look back on uses the any-year wording', async () => {
        serve({ overview: (year) => overview({ year, members: [] }) });
        render(<RecapEntry service="hinatazaka46" year={2024} years={[2024]} onBack={() => {}} />);
        expect(await screen.findByText('これからのあなたへ')).toBeInTheDocument();
        expect(screen.queryByText('来年のあなたへ')).toBeNull();
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

    it('shows the retry state and logs it when the overview poll is skipped', async () => {
        serve();
        vi.mocked(fetchRecapMembers).mockResolvedValueOnce({ status: 'skipped' });
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: '再試行' }));
        expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
        expect(loadLogs()).toContainEqual(['recap_load', { target: 'members', outcome: 'skipped' }]);
    });

    it('shows the retry state and logs it when the member poll is skipped', async () => {
        serve();
        vi.mocked(fetchMemberRecap).mockResolvedValueOnce({ status: 'skipped' });
        render(<RecapEntry service="hinatazaka46" year={2026} memberPath={MEMBER_PATH} onBack={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: '再試行' }));
        expect(await screen.findByTestId('recap-stage')).toBeInTheDocument();
        expect(loadLogs()).toContainEqual(['recap_load', { target: 'member', outcome: 'skipped' }]);
    });

    it('goes back to the hub', async () => {
        serve();
        const onBack = vi.fn();
        render(<RecapEntry service="hinatazaka46" year={2026} onBack={onBack} />);
        await userEvent.click(screen.getByRole('button', { name: '戻る' }));
        expect(onBack).toHaveBeenCalled();
    });

    it('shows the poster after the last slide, replays from the start and closes to the list', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} nickname="ゆき" onBack={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
        await screen.findByTestId('recap-stage');
        for (let i = 0; i < 4; i += 1) await userEvent.keyboard('{ArrowRight}');
        expect(await screen.findByTestId('recap-poster')).toBeInTheDocument();
        expect(screen.queryByTestId('recap-stage')).toBeNull();
        expect(vi.mocked(clientLog).mock.calls).toContainEqual(['recap_poster', expect.objectContaining({ phase: 'open', surface: 'end' })]);
        await userEvent.click(screen.getByRole('button', { name: 'もう一度見る' }));
        expect(await screen.findByTestId('recap-stage')).toHaveAttribute('data-slide', 's01_first');
        expect(opens()).toHaveLength(2);
        for (let i = 0; i < 4; i += 1) await userEvent.keyboard('{ArrowRight}');
        await screen.findByTestId('recap-poster');
        await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
    });

    it('offers the poster from the list once the member\'s recap has loaded', async () => {
        serve();
        render(<RecapEntry service="hinatazaka46" year={2026} nickname="ゆき" onBack={() => {}} />);
        await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
        expect(screen.queryByRole('button', { name: 'ポスターを見る' })).toBeNull();
        await screen.findByTestId('recap-stage');
        await userEvent.keyboard('{Escape}');
        await userEvent.click(await screen.findByRole('button', { name: 'ポスターを見る' }));
        expect(await screen.findByTestId('recap-poster')).toBeInTheDocument();
        expect(screen.queryByTestId('recap-stage')).toBeNull();
        expect(vi.mocked(clientLog).mock.calls).toContainEqual(['recap_poster', expect.objectContaining({ phase: 'open', surface: 'list' })]);
    });

    it('stays on the last slide and logs a skip when the recap has no poster', async () => {
        serve({ recap: payload({ poster: null }) });
        render(<RecapEntry service="hinatazaka46" year={2026} memberPath={MEMBER_PATH} onBack={() => {}} />);
        await screen.findByTestId('recap-stage');
        for (let i = 0; i < 4; i += 1) await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByTestId('recap-stage')).toBeInTheDocument();
        expect(screen.queryByTestId('recap-poster')).toBeNull();
        expect(vi.mocked(clientLog).mock.calls).toContainEqual(['recap_poster', expect.objectContaining({ phase: 'skip', reason: 'no_poster' })]);
    });

    describe('multi-member opening', () => {
        const TWO = () => overview({
            members: [
                { member_path: MEMBER_PATH, member_id: '58', name: '金村 美玖', tier: 'full', oshi: true, title_key: 'recap.titles.first' },
                { member_path: PATH_B, member_id: '70', name: '正源司 陽子', tier: 'short', oshi: false, title_key: 'recap.titles.morning' },
                { member_path: '日向坂46/messages/12 小坂 菜緒/12 小坂 菜緒', member_id: '12', name: '小坂 菜緒', tier: 'none', oshi: false, title_key: null },
            ],
            opening: { star_order: ['58', '70', '12'], first_message: null, oyasumi_total: 120 },
        });
        const openingLogs = () => vi.mocked(clientLog).mock.calls.filter(([e]) => e === 'recap_opening');

        it('plays the opening first, then shows the list, and does not replay it on returning', async () => {
            serve({ overview: (year) => ({ ...TWO(), year }) });
            render(<RecapEntry service="hinatazaka46" year={2026} nickname="ゆき" onBack={() => {}} />);
            expect(await screen.findByTestId('recap-stage')).toHaveAttribute('data-slide', 'o1_stars');
            expect(screen.getAllByTestId('opening-star')).toHaveLength(3);
            await userEvent.keyboard('{ArrowRight}');
            expect(screen.getByTestId('recap-stage')).toHaveAttribute('data-slide', 'o2_titles');
            await userEvent.keyboard('{ArrowRight}');
            await userEvent.click(await screen.findByRole('button', { name: /金村 美玖/ }));
            expect(await screen.findByTestId('recap-stage')).toHaveAttribute('data-slide', 's01_first');
            await userEvent.keyboard('{Escape}');
            expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
            expect(screen.queryByTestId('opening-star')).toBeNull();
            expect(openingLogs().map(([, f]) => (f as { phase: string }).phase)).toEqual(['show', 'end']);
        });

        it('skips the opening for a single member with a recap', async () => {
            serve();
            render(<RecapEntry service="hinatazaka46" year={2026} onBack={() => {}} />);
            expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
            expect(screen.queryByTestId('opening-star')).toBeNull();
            expect(openingLogs()).toEqual([['recap_opening', { phase: 'skip', reason: 'single_member', count: 1 }]]);
        });

        it('logs the single-member skip once per year, not on every visit to it', async () => {
            const seen = serve();
            render(<RecapEntry service="hinatazaka46" year={2026} years={[2025, 2026]} onBack={() => {}} />);
            await screen.findByRole('button', { name: /金村 美玖/ });
            await userEvent.click(screen.getByRole('button', { name: '前の年' }));
            await waitFor(() => expect(seen.members).toContain(2025));
            await screen.findByRole('button', { name: /金村 美玖/ });
            await userEvent.click(screen.getByRole('button', { name: '次の年' }));
            await waitFor(() => expect(seen.members.filter((y) => y === 2026)).toHaveLength(2));
            await screen.findByRole('button', { name: /金村 美玖/ });
            expect(openingLogs()).toEqual([
                ['recap_opening', { phase: 'skip', reason: 'single_member', count: 1 }],
                ['recap_opening', { phase: 'skip', reason: 'single_member', count: 1 }],
            ]);
        });

        it('skips the opening when a member is opened straight away', async () => {
            serve({ overview: (year) => ({ ...TWO(), year }) });
            render(<RecapEntry service="hinatazaka46" year={2026} memberPath={MEMBER_PATH} onBack={() => {}} />);
            expect(await screen.findByTestId('recap-stage')).toHaveAttribute('data-slide', 's01_first');
            await userEvent.keyboard('{Escape}');
            expect(await screen.findByRole('button', { name: /金村 美玖/ })).toBeInTheDocument();
            expect(screen.queryByTestId('opening-star')).toBeNull();
        });
    });

    it('steps only between the offered years', async () => {
        const seen = serve();
        render(<RecapEntry service="hinatazaka46" year={2026} years={[2023, 2026]} onBack={() => {}} />);
        await screen.findByRole('button', { name: /金村 美玖/ });
        expect(screen.getByRole('button', { name: '次の年' }).parentElement).toHaveClass('invisible');
        await userEvent.click(screen.getByRole('button', { name: '前の年' }));
        await waitFor(() => expect(seen.members).toContain(2023));
        expect(seen.members).not.toContain(2025);
        expect(screen.getByText('2023年')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '前の年' }).parentElement).toHaveClass('invisible');
    });
});
