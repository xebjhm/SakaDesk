import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
import { clientLog } from '../../../utils/clientLog';
import { stopMemoriesVoices } from '../shared/voicePlayback';
import userEvent from '@testing-library/user-event';
import i18n from '../../../i18n';
import { NicknameProvider } from '../shared/useNickname';
import { CorkBoard } from './CorkBoard';
import { BOARD_CHUNK, ESTIMATED_ITEM_PX, TILTS, tiltClass } from './board';
import { favorite, NOTE, PRINT, VOICE } from './__fixtures__';
import type { FavoriteItem } from '../types';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => { vi.unstubAllGlobals(); act(() => stopMemoriesVoices()); vi.mocked(clientLog).mockClear(); });

function renderBoard(items: FavoriteItem[] = [NOTE, PRINT, VOICE], onOpen = vi.fn()) {
    const utils = render(
        <NicknameProvider nickname="みーぱん">
            <CorkBoard items={items} onOpen={onOpen} />
        </NicknameProvider>,
    );
    return { ...utils, onOpen };
}

/** A controllable IntersectionObserver: `fire(i)` reports chunk `i` near the scroller. */
function stubObserver() {
    const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = [];
    class FakeObserver {
        els = new Set<Element>();
        constructor(public cb: IntersectionObserverCallback) { observers.push(this); }
        observe(el: Element) { this.els.add(el); }
        unobserve(el: Element) { this.els.delete(el); }
        disconnect() { this.els.clear(); }
        takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    return (chunk: number, hit = true) => act(() => {
        for (const o of observers) {
            const el = [...o.els].find((e) => e.getAttribute('data-chunk') === String(chunk));
            if (el) o.cb([{ target: el, isIntersecting: hit } as unknown as IntersectionObserverEntry], o as unknown as IntersectionObserver);
        }
    });
}

describe('CorkBoard', () => {
    it('pins a paper note, a print with its caption and a voice card on the cork', () => {
        renderBoard();
        expect(screen.getByTestId('cork-board')).toHaveClass('bg-memories-cork');

        const note = screen.getByTestId('cork-note-11');
        expect(note).toHaveClass('bg-memories-paper');
        expect(within(note).getByTestId('memory-text')).toHaveTextContent('みーぱんの声');
        expect(within(note).getByTestId('memory-text')).toHaveClass('line-clamp-6');

        const print = screen.getByTestId('cork-print-12');
        expect(within(print).getByTestId('memory-thumb')).toBeInTheDocument();
        expect(within(print).getByText('今日の空')).toBeInTheDocument();

        const voice = screen.getByTestId('cork-voice-13');
        expect(within(voice).getByText('01:15')).toBeInTheDocument();

        // Every item is held by washi tape and names her and the JST date.
        for (const id of [11, 12, 13]) {
            const item = screen.getByTestId(`cork-item-${id}`);
            expect(within(item).getByTestId('cork-washi')).toHaveClass('bg-memories-washi');
            expect(within(item).getAllByText('金村 美玖').length).toBeGreaterThan(0);
        }
        // 2023-12-31T15:30Z is already Jan 1 in Tokyo.
        expect(within(screen.getByTestId('cork-item-13')).getByText(/2024/)).toBeInTheDocument();
    });

    it('mounts the voice player only when it is played', async () => {
        renderBoard();
        const voice = screen.getByTestId('cork-voice-13');
        expect(voice.querySelector('audio')).toBeNull();
        await userEvent.click(within(voice).getByRole('button', { name: /Play/ }));
        expect(voice.querySelector('audio')).not.toBeNull();
    });

    it('tilts each item by a stable, id-derived class', () => {
        expect(tiltClass(11)).toBe(tiltClass(11));
        expect(TILTS).toContain(tiltClass(987654321));
        const spread = new Set(Array.from({ length: 20 }, (_, i) => tiltClass(i)));
        expect(spread.size).toBeGreaterThan(1);

        const { rerender } = renderBoard();
        const before = screen.getByTestId('cork-item-12').className;
        expect(before).toContain(tiltClass(12));
        expect(before).toContain('motion-reduce:rotate-0');
        rerender(
            <NicknameProvider nickname="みーぱん">
                <CorkBoard items={[VOICE, PRINT]} onOpen={vi.fn()} />
            </NicknameProvider>,
        );
        expect(screen.getByTestId('cork-item-12').className).toBe(before);
    });

    it('opens an item: a note, a print, or a voice card through its heading', async () => {
        const { onOpen } = renderBoard();
        await userEvent.click(screen.getByTestId('cork-note-11'));
        expect(onOpen).toHaveBeenLastCalledWith(NOTE);
        await userEvent.click(screen.getByTestId('cork-print-12'));
        expect(onOpen).toHaveBeenLastCalledWith(PRINT);
        await userEvent.click(within(screen.getByTestId('cork-voice-13')).getByTestId('cork-open-13'));
        expect(onOpen).toHaveBeenLastCalledWith(VOICE);
    });

    it('windows a long board: only chunks near the scroller mount their items', () => {
        const fire = stubObserver();
        const items = Array.from({ length: BOARD_CHUNK * 3 }, (_, i) => favorite(1000 + i, { text: `メッセージ${i}` }));
        renderBoard(items);
        // The first chunk is live from the start; the others wait for the observer.
        expect(screen.getAllByTestId(/^cork-item-/)).toHaveLength(BOARD_CHUNK);
        expect(screen.getAllByTestId('cork-chunk-placeholder')).toHaveLength(2);
        fire(1);
        expect(screen.getAllByTestId(/^cork-item-/)).toHaveLength(BOARD_CHUNK * 2);
        fire(0, false);
        expect(screen.getAllByTestId(/^cork-item-/)).toHaveLength(BOARD_CHUNK);
        expect(screen.queryByTestId('cork-item-1000')).toBeNull();
    });

    it("names each item by the payload's name, not the room folder", () => {
        renderBoard([favorite(31, { text: '新しい名前で', name: '金村 美玖（改名）' })]);
        expect(within(screen.getByTestId('cork-item-31')).getByText('金村 美玖（改名）')).toBeInTheDocument();
    });

    it('plays one voice at a time across the board', async () => {
        const other = favorite(14, { ...VOICE, id: 14, media_url: '/api/content/media/hinatazaka46/x/voice/14.m4a' });
        renderBoard([VOICE, other]);
        await userEvent.click(within(screen.getByTestId('cork-voice-13')).getByRole('button', { name: /Play/ }));
        await userEvent.click(within(screen.getByTestId('cork-voice-14')).getByRole('button', { name: /Play/ }));
        expect(screen.getByTestId('cork-voice-14').querySelector('audio')).not.toBeNull();
        expect(screen.getByTestId('cork-voice-13').querySelector('audio')).toBeNull();
    });

    it('leaves a text favourite without text off the board, with a breadcrumb', () => {
        renderBoard([NOTE, favorite(40, { text: null })]);
        expect(screen.queryByTestId('cork-item-40')).toBeNull();
        expect(screen.getByTestId('cork-item-11')).toBeInTheDocument();
        expect(vi.mocked(clientLog)).toHaveBeenCalledWith('memories_skip', { target: 'favorites', reason: 'empty_note', count: 1 });
    });

    it('sizes an unmeasured placeholder from its item count', () => {
        stubObserver();
        const items = Array.from({ length: BOARD_CHUNK + 3 }, (_, i) => favorite(2000 + i, { text: `メッセージ${i}` }));
        renderBoard(items);
        const placeholder = screen.getByTestId('cork-chunk-placeholder').parentElement as HTMLElement;
        // jsdom has no matchMedia: one column.
        expect(placeholder.style.minHeight).toBe(`${3 * ESTIMATED_ITEM_PX}px`);
    });
});
