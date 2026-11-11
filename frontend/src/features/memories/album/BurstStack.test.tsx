import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { installMediaTileHarness } from '../../../__tests__/mediaTileHarness';
import { MediaGridContext, type MediaGridTileReporter } from '../../../core/media/grid';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { openChat } from '../../../shell/openChat';
import { NicknameProvider } from '../shared/useNickname';
import { BurstStack } from './BurstStack';
import { photo } from './__fixtures__';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
    vi.mocked(openChat).mockClear();
    vi.mocked(clientLog).mockClear();
});

const ITEMS = [
    photo(3, '2024-09', { caption: '連写1、%%%' }),
    photo(4, '2024-09', { text: '連写2' }),
    photo(5, '2024-09'),
];

const renderStack = () => render(
    <NicknameProvider nickname="みーぱん">
        <BurstStack items={ITEMS} title="September 2024" nameOf={() => '金村 美玖'} sepia="sepia-memories-1" />
    </NicknameProvider>,
);

describe('BurstStack', () => {
    it('shows a stacked still with the photo count', () => {
        renderStack();
        const stack = screen.getByRole('button', { name: /3 photos/ });
        // one shared media tile, aged with the month's sepia
        expect(within(stack).getAllByTestId('memory-thumb')).toHaveLength(1);
        expect(within(stack).getByTestId('memory-thumb')).toHaveClass('sepia-memories-1');
    });

    it('opens the sequence in order with each caption beside it', async () => {
        renderStack();
        await userEvent.click(screen.getByRole('button', { name: /3 photos/ }));
        const dialog = await screen.findByRole('dialog');
        const rows = within(dialog).getAllByTestId('burst-frame');
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByTestId('memory-thumb')).toBeInTheDocument();
        expect(within(rows[2]).getByTestId('memory-thumb')).toBeInTheDocument();
        expect(within(rows[0]).getByTestId('memory-text')).toHaveTextContent('連写1、みーぱん');
        expect(within(rows[1]).getByTestId('memory-text')).toHaveTextContent('連写2');
        expect(within(rows[2]).queryByTestId('memory-text')).toBeNull();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_burst', outcome: 'on' });
    });

    it('jumps to her chat from a frame', async () => {
        renderStack();
        await userEvent.click(screen.getByRole('button', { name: /3 photos/ }));
        const rows = within(await screen.findByRole('dialog')).getAllByTestId('burst-frame');
        await userEvent.click(within(rows[1]).getByRole('button', { name: 'View in chat' }));
        expect(vi.mocked(openChat)).toHaveBeenCalledWith(expect.objectContaining({ message_id: 4 }));
        // the jump closes the sequence, and the close is logged like any other
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_toggle', { target: 'album_burst', outcome: 'off' });
    });

    it('marks a favourite inside the burst with the yellow star', async () => {
        render(
            <NicknameProvider nickname="みーぱん">
                <BurstStack items={[ITEMS[0], { ...ITEMS[1], favorited: true }, ITEMS[2]]} title="September 2024" nameOf={() => '金村 美玖'} sepia="" />
            </NicknameProvider>,
        );
        const stack = screen.getByRole('button', { name: /3 photos/ });
        expect(within(stack).getByTestId('burst-star')).toHaveClass('text-semantic-star');
        await userEvent.click(stack);
        const rows = within(await screen.findByRole('dialog')).getAllByTestId('burst-frame');
        expect(within(rows[1]).getByTestId('burst-frame-star')).toHaveClass('text-semantic-star');
        expect(within(rows[0]).queryByTestId('burst-frame-star')).toBeNull();
    });

    it('names the stack by what it does: open the photos', () => {
        renderStack();
        expect(screen.getByRole('button', { name: 'Open 3 photos' })).toBeInTheDocument();
    });

    it('opens the sequence even when its still failed to load (the frames own their retry)', async () => {
        const h = installMediaTileHarness();
        renderStack();
        const stack = screen.getByRole('button', { name: 'Open 3 photos' });
        // the first frame's thumbnail and full file both fail
        await waitFor(() => expect(h.requested()).toHaveLength(1));
        await h.fail();
        await waitFor(() => expect(h.requested()).toHaveLength(2));
        await h.fail();
        await waitFor(() => expect(within(stack).getByTestId('memory-thumb')).toHaveAttribute('data-state', 'failed'));
        expect(stack).toHaveAccessibleName('Open 3 photos');
        await userEvent.click(stack);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getAllByTestId('burst-frame')).toHaveLength(3);
    });

    it('observes the dialog frames against the viewport, not the album scroller (portalled)', async () => {
        // Record the root of the observer each tile is observed with; every tile reports on screen.
        const rootOf = new Map<Element, Element | Document | null>();
        class RecordingObserver {
            constructor(private cb: IntersectionObserverCallback, private opts: IntersectionObserverInit = {}) {}
            observe(el: Element) {
                rootOf.set(el, this.opts.root ?? null);
                queueMicrotask(() => this.cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver));
            }
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
        }
        vi.stubGlobal('IntersectionObserver', RecordingObserver);
        const scroller = document.createElement('div');
        const reporter: MediaGridTileReporter = { root: scroller, tileVisible: vi.fn(), tileReady: vi.fn() };
        render(
            <MediaGridContext.Provider value={reporter}>
                <NicknameProvider nickname="みーぱん">
                    <BurstStack items={ITEMS} title="September 2024" nameOf={() => '金村 美玖'} sepia="" />
                </NicknameProvider>
            </MediaGridContext.Provider>,
        );
        const stack = screen.getByRole('button', { name: 'Open 3 photos' });
        await waitFor(() => expect(rootOf.get(within(stack).getByTestId('memory-thumb'))).toBe(scroller));
        await userEvent.click(stack);
        const frames = within(await screen.findByRole('dialog')).getAllByTestId('memory-thumb');
        expect(frames).toHaveLength(3);
        await waitFor(() => frames.forEach((f) => expect(rootOf.has(f) && rootOf.get(f)).toBeNull()));
        // only the stack's still is counted by the album's breadcrumb, never a dialog tile
        expect(vi.mocked(reporter.tileVisible).mock.calls).toEqual([[1]]);
    });
});
