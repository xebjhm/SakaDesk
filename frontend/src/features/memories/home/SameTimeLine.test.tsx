import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../api', async (importOriginal) => {
    const real = await importOriginal<typeof import('../api')>();
    return { ...real, fetchSameTime: vi.fn() };
});
import { fetchSameTime } from '../api';
import { memoryMessage, MEMBER_PATH } from '../__fixtures__/memories';
import { NicknameProvider } from '../shared/useNickname';
import type { SameTimeMoment } from '../types';
import { SameTimeLine } from './SameTimeLine';

const moment = (over: Partial<SameTimeMoment> = {}): SameTimeMoment => ({
    clock: '21:03',
    year: 2024,
    date: '2024-06-02',
    member_path: MEMBER_PATH,
    name: '金村 美玖',
    message: memoryMessage({ id: 5, ts: '2024-06-02T12:02:00Z', text: '%%%、いま帰ってきたよ' }),
    ...over,
});

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (next: DocumentVisibilityState) => {
    visibility = next;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

beforeAll(async () => { await i18n.changeLanguage('ja'); });
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    // 12:03:30 UTC = 21:03:30 JST, 2026.
    vi.setSystemTime(new Date('2026-06-02T12:03:30Z'));
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.mocked(fetchSameTime).mockReset().mockResolvedValue(moment({ clock: '21:04', message: memoryMessage({ id: 6, text: 'つぎの言葉' }) }));
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function renderLine(initial: SameTimeMoment | null = moment()) {
    const go = vi.fn();
    const view = render(
        <NicknameProvider nickname="みーぱん"><SameTimeLine service="hinatazaka46" initial={initial} go={go} /></NicknameProvider>,
    );
    return { go, ...view };
}

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('SameTimeLine', () => {
    it('shows the JST clock, the past-year copy and her words', () => {
        renderLine();
        const line = screen.getByTestId('memories-same-time');
        expect(line).toHaveTextContent('いま 21:03');
        expect(line).toHaveTextContent('2024年のこの時刻、金村 美玖は');
        expect(screen.getByTestId('memory-text')).toHaveTextContent('みーぱん、いま帰ってきたよ');
        expect(fetchSameTime).not.toHaveBeenCalled();
    });

    it('uses the this-year copy with the date for a moment of this JST year', () => {
        renderLine(moment({ year: 2026, date: '2026-03-01' }));
        expect(screen.getByTestId('memories-same-time')).toHaveTextContent('3月1日のこの時刻、金村 美玖は');
    });

    it('refetches at the next JST minute boundary, once per minute', async () => {
        renderLine();
        await act(async () => { vi.advanceTimersByTime(29_000); });
        expect(fetchSameTime).not.toHaveBeenCalled();
        await act(async () => { vi.advanceTimersByTime(1_500); });
        expect(fetchSameTime).toHaveBeenCalledTimes(1);
        await flush();
        expect(screen.getByTestId('memories-same-time')).toHaveTextContent('いま 21:04');
        expect(screen.getByTestId('memory-text')).toHaveTextContent('つぎの言葉');
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(fetchSameTime).toHaveBeenCalledTimes(2);
    });

    it('pauses while the window is hidden and catches up when it is shown', async () => {
        renderLine();
        setVisibility('hidden');
        await act(async () => { vi.advanceTimersByTime(180_000); });
        expect(fetchSameTime).not.toHaveBeenCalled();
        setVisibility('visible');
        expect(fetchSameTime).toHaveBeenCalledTimes(1);
        await act(async () => { vi.advanceTimersByTime(60_000); });
        expect(fetchSameTime).toHaveBeenCalledTimes(2);
    });

    it('does not refetch on show within the same minute', () => {
        renderLine();
        setVisibility('hidden');
        setVisibility('visible');
        expect(fetchSameTime).not.toHaveBeenCalled();
    });

    it('hides on null and comes back when a later minute has a moment', async () => {
        vi.mocked(fetchSameTime).mockResolvedValueOnce(null);
        const { container } = renderLine(null);
        expect(container).toBeEmptyDOMElement();
        await act(async () => { vi.advanceTimersByTime(30_500); });
        await flush();
        expect(container).toBeEmptyDOMElement();
        await act(async () => { vi.advanceTimersByTime(60_000); });
        await flush();
        expect(screen.getByTestId('memories-same-time')).toBeInTheDocument();
    });

    it('aborts the request in flight and stops on unmount', async () => {
        let signal: AbortSignal | undefined;
        vi.mocked(fetchSameTime).mockImplementation((_s, sig) => { signal = sig; return new Promise(() => {}); });
        const { unmount } = renderLine();
        await act(async () => { vi.advanceTimersByTime(30_500); });
        expect(signal?.aborted).toBe(false);
        unmount();
        expect(signal?.aborted).toBe(true);
        vi.advanceTimersByTime(600_000);
        expect(fetchSameTime).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('tags her name as Japanese inside the label', () => {
        renderLine();
        const name = screen.getByText('金村 美玖');
        expect(name).toHaveAttribute('lang', 'ja');
        expect(name.parentElement).toHaveTextContent('2024年のこの時刻、金村 美玖は');
    });

    it('hides instead of keeping an older minute\'s moment under a newer clock when a refetch fails', async () => {
        vi.mocked(fetchSameTime).mockRejectedValueOnce(new Error('down'));
        const { container } = renderLine();
        await act(async () => { vi.advanceTimersByTime(30_500); });
        await flush();
        expect(container).toBeEmptyDOMElement();
    });

    it('refetches on show when hiding aborted the minute\'s request, even within that minute', async () => {
        let first = true;
        vi.mocked(fetchSameTime).mockImplementation((_s, signal) => {
            if (first) {
                first = false;
                return new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
            }
            return Promise.resolve(moment({ clock: '21:04', message: memoryMessage({ id: 6, text: 'つぎの言葉' }) }));
        });
        renderLine();
        await act(async () => { vi.advanceTimersByTime(30_500); });
        expect(fetchSameTime).toHaveBeenCalledTimes(1);
        setVisibility('hidden');
        setVisibility('visible');
        expect(fetchSameTime).toHaveBeenCalledTimes(2);
        await flush();
        const line = screen.getByTestId('memories-same-time');
        expect(line).toHaveTextContent('いま 21:04');
        expect(line).toHaveTextContent('つぎの言葉');
    });

    it('keeps the clock with the moment it shows until the next one lands', async () => {
        vi.mocked(fetchSameTime).mockImplementation(() => new Promise(() => {}));
        renderLine();
        await act(async () => { vi.advanceTimersByTime(30_500); });
        expect(screen.getByTestId('memories-same-time')).toHaveTextContent('いま 21:03');
    });

    it('opens that day on click', () => {
        const { go } = renderLine();
        fireEvent.click(screen.getByTestId('memories-same-time'));
        expect(go).toHaveBeenCalledWith({ page: 'day', date: '2024-06-02' });
    });
});
