import { describe, it, expect, vi, beforeAll, beforeEach, onTestFinished } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { VirtuosoMockContext } from 'react-virtuoso';
import i18n from '../../../i18n';
import { server } from '../../../__tests__/mocks/server';

vi.mock('../../../utils/clientLog', () => ({ clientLog: vi.fn() }));
vi.mock('../../../shell/openChat', () => ({ openChat: vi.fn() }));
import { MergedTimeline, WINDOW_FROM } from './MergedTimeline';
import { dayPeople } from './people';
import { dayMessage, dayPayload, MIKU, NAO } from './__fixtures__';
import type { DayMessage } from '../types';
import { useVoicePlayback } from '../shared/voicePlayback';

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
    server.use(
        http.get('/api/app-state/translations', () => HttpResponse.json({})),
        http.patch('/api/app-state/translations', () => HttpResponse.json({})),
        http.get('/api/transcription/:service/:id', () => new HttpResponse(null, { status: 404 })),
    );
});

const peopleOf = (messages: DayMessage[]) => new Map(dayPeople([MIKU, NAO], messages).map((p) => [p.key, p]));

describe('MergedTimeline media', () => {
    it('draws pictures from lazy 640-px thumbnails and opens the viewer on the full file', async () => {
        const { messages } = dayPayload();
        render(<MergedTimeline messages={messages} people={peopleOf(messages)} service="hinatazaka46" />);
        const img = screen.getByAltText('Attachment');
        expect(img.getAttribute('src')).toMatch(/^\/api\/content\/thumb\/.*\?w=640$/);
        expect(img).toHaveAttribute('loading', 'lazy');
        await userEvent.click(img);
        const dialog = await screen.findByRole('dialog');
        const full = Array.from(dialog.querySelectorAll('img')).map((i) => i.getAttribute('src'));
        expect(full.some((src) => src?.startsWith('/api/content/media/'))).toBe(true);
        expect(full.some((src) => src?.startsWith('/api/content/thumb/'))).toBe(false);
    });
});

describe('MergedTimeline windowing', () => {
    const many = Array.from({ length: WINDOW_FROM * 3 }, (_, i) => dayMessage(i % 2 ? MIKU : NAO, {
        id: i + 1,
        ts: new Date(Date.UTC(2024, 8, 14, 0, i)).toISOString(),
        text: `メッセージ${i + 1}`,
    }));

    it('windows a long day inside the scroll parent', () => {
        // jsdom has no ResizeObserver; Virtuoso watches the custom scroll parent with one.
        vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
        onTestFinished(() => { vi.unstubAllGlobals(); });
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        render(
            <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 60 }}>
                <MergedTimeline messages={many} people={peopleOf(many)} service="hinatazaka46" scrollParent={parent} />
            </VirtuosoMockContext.Provider>,
        );
        const rows = screen.getAllByTestId('day-merged-row').length;
        expect(rows).toBeGreaterThan(0);
        expect(rows).toBeLessThan(many.length);
        parent.remove();
    });

    it('renders a short day, or one without a scroll parent, in full', () => {
        render(<MergedTimeline messages={many} people={peopleOf(many)} service="hinatazaka46" />);
        expect(screen.getAllByTestId('day-merged-row')).toHaveLength(many.length);
    });
});

describe('MergedTimeline voices', () => {
    it('plays one voice at a time with the other Memories voices', () => {
        const voice = (id: number) => dayMessage(MIKU, {
            id, ts: `2024-09-14T0${id}:00:00Z`, type: 'voice', text: null,
            media_file: `messages/x/voice/${id}.m4a`,
            media_url: `/api/content/media/hinatazaka46/messages/1/voice/${id}.m4a`,
        });
        const messages = [voice(1), voice(2)];
        const radio = { stop: vi.fn(), fadeOut: vi.fn() };
        useVoicePlayback.getState().play('radio', radio);
        const { container } = render(<MergedTimeline messages={messages} people={peopleOf(messages)} service="hinatazaka46" />);
        const [a, b] = Array.from(container.querySelectorAll('audio'));
        const pauseA = vi.fn();
        a.pause = pauseA;
        b.pause = vi.fn();
        a.dispatchEvent(new Event('play'));
        expect(radio.stop).toHaveBeenCalledTimes(1);
        b.dispatchEvent(new Event('play'));
        expect(pauseA).toHaveBeenCalledTimes(1);
        useVoicePlayback.getState().stop();
    });
});

describe('MergedTimeline focus', () => {
    it('centres the focused row inside the scroller from its own rectangle', async () => {
        const { messages } = dayPayload();
        const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) });
        const origRect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function (this: Element) {
            if ((this as HTMLElement).dataset.focusScroller !== undefined) return rect(100, 200) as DOMRect;
            if ((this as HTMLElement).dataset.focused === 'true') return rect(700, 40) as DOMRect;
            return origRect.call(this);
        };
        const origHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).dataset.focusScroller !== undefined ? 200 : 0; } });
        onTestFinished(() => {
            Element.prototype.getBoundingClientRect = origRect;
            if (origHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origHeight);
        });
        render(
            <div data-testid="outer">
                <div data-testid="column" data-focus-scroller="">
                    <MergedTimeline messages={messages} people={peopleOf(messages)} service="hinatazaka46" focus={{ room: messages[1].room, id: messages[1].id }} />
                </div>
            </div>,
        );
        // row top 700 is 600 below the scroller top; centring a 40-px row in 200 px: 600 - 80 = 520
        expect(screen.getByTestId('column').scrollTop).toBe(520);
        expect(screen.getByTestId('outer').scrollTop).toBe(0); // the ancestors never move
    });

    it('does not scroll at all without a column scroller', () => {
        const { messages } = dayPayload();
        const spy = vi.fn();
        const original = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = spy;
        onTestFinished(() => { Element.prototype.scrollIntoView = original; });
        render(<MergedTimeline messages={messages} people={peopleOf(messages)} service="hinatazaka46" focus={{ room: messages[0].room, id: messages[0].id }} />);
        expect(spy).not.toHaveBeenCalled();
    });
});
