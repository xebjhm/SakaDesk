// frontend/src/features/ai/__tests__/KnowledgeBaseStatus.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgeBaseStatus } from '../components/KnowledgeBaseStatus';

// Selector-aware mock — matches AiFeature's `useAppStore((state) => state.activeService)` idiom.
vi.mock('../../../store/appStore', () => ({
    useAppStore: (selector: (state: { activeService: string | null }) => unknown) =>
        selector({ activeService: 'hinatazaka46' }),
}));

interface FetchCall {
    url: string;
    method: string;
    body?: unknown;
}

/** Build a mock fetch that routes by URL/method (mirrors `useSettings.test.ts`'s idiom). */
function buildFetch() {
    const calls: FetchCall[] = [];
    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

        if (url.startsWith('/api/ai/index/status') && method === 'GET') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ service: 'hinatazaka46', document_count: 5, by_type: { blog: 5 } }),
            });
        }
        if (url === '/api/ai/index/rebuild' && method === 'POST') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };
    return { calls, impl };
}

describe('KnowledgeBaseStatus', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fetches index status for the active service and renders indexed/total via i18n', async () => {
        const { calls, impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);

        // `settings.knowledgeBase` / `settings.kbIndexed` keys resolve to real en.json strings
        // (not raw key names) — proves the keys exist and are wired up correctly.
        expect(screen.getByText('Knowledge base')).toBeInTheDocument();
        expect(await screen.findByText('5 documents indexed')).toBeInTheDocument();

        const statusCall = calls.find((c) => c.url.startsWith('/api/ai/index/status'));
        expect(statusCall?.url).toBe('/api/ai/index/status?service=hinatazaka46');
        expect(statusCall?.method).toBe('GET');
    });

    it('clicking Rebuild POSTs /api/ai/index/rebuild with the active service', async () => {
        const { calls, impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);
        await screen.findByText('5 documents indexed');

        // `settings.rebuildIndex` key resolves to the real en.json string.
        const rebuildButton = screen.getByRole('button', { name: 'Rebuild index' });
        await userEvent.click(rebuildButton);

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/index/rebuild')).toBe(true);
        });
        const rebuildCall = calls.find((c) => c.url === '/api/ai/index/rebuild')!;
        expect(rebuildCall.method).toBe('POST');
        expect(rebuildCall.body).toEqual({ service: 'hinatazaka46' });
    });
});
