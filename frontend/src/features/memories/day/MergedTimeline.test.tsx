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
