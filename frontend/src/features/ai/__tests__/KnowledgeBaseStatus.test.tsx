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

const IDLE_PROGRESS = { service: null, phase: 'idle', done: 0, total: 0, started_at: null };

/** Build a mock fetch that routes by URL/method (mirrors `useSettings.test.ts`'s idiom).
 * `statusOverride` lets a test control the (real, Task 3) `GET /index/status`
 * payload — `progress`/`last_built` included; `rebuildResponse` lets a test
 * control what `POST /index/rebuild` returns (e.g. a 409). */
function buildFetch(
    overrides: {
        statusOverride?: Record<string, unknown>;
        rebuildResponse?: { ok: boolean; status: number; json: unknown };
    } = {}
) {
    const calls: FetchCall[] = [];
    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

        if (url.startsWith('/api/ai/index/status') && method === 'GET') {
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve(
                        overrides.statusOverride ?? {
                            service: 'hinatazaka46',
                            document_count: 5,
                            by_type: { blog: 5 },
                            progress: IDLE_PROGRESS,
                            last_built: null,
                        }
                    ),
            });
        }
        if (url === '/api/ai/index/rebuild' && method === 'POST') {
            if (overrides.rebuildResponse) {
                const { ok, status, json } = overrides.rebuildResponse;
                return Promise.resolve({ ok, status, json: () => Promise.resolve(json) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
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

    it('renders "Last indexed" from the settings-owned last_built timestamp', async () => {
        const { impl } = buildFetch({
            statusOverride: {
                service: 'hinatazaka46',
                document_count: 5,
                by_type: { blog: 5 },
                progress: IDLE_PROGRESS,
                last_built: '2026-06-30T12:00:00+00:00',
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);

        expect(await screen.findByText(/Last indexed:/)).toBeInTheDocument();
    });

    it('renders a real progress bar (from status().progress) while this service is actively embedding, and disables Rebuild', async () => {
        const { impl } = buildFetch({
            statusOverride: {
                service: 'hinatazaka46',
                document_count: 5,
                by_type: { blog: 5 },
                progress: {
                    service: 'hinatazaka46',
                    phase: 'embedding',
                    done: 5,
                    total: 20,
                    started_at: '2026-06-30T12:00:00+00:00',
                },
                last_built: null,
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);

        // `settings.kbPhaseEmbedding` resolves to the real en.json string with
        // done/total interpolated — this is the REAL server-reported progress,
        // not the old blind 20s polling window.
        expect(await screen.findByText('Indexing 5/20…')).toBeInTheDocument();
        expect(screen.getByText('25%')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rebuild index' })).toBeDisabled();
        // The LIVE document count keeps rendering while the rebuild runs --
        // `document_count` rises during a build, so hiding it left the user
        // with no sense of movement (Setup/status wave, Task 3b).
        expect(screen.getByText('5 documents indexed')).toBeInTheDocument();
    });

    it('renders an animated indeterminate bar while discovering (total still 0)', async () => {
        const { impl } = buildFetch({
            statusOverride: {
                service: 'hinatazaka46',
                document_count: 5,
                by_type: { blog: 5 },
                progress: {
                    service: 'hinatazaka46',
                    phase: 'discovering',
                    done: 0,
                    total: 0,
                    started_at: '2026-06-30T12:00:00+00:00',
                },
                last_built: null,
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);

        // The multi-minute file scan used to sit on a dead 0%-width bar --
        // now an animated indeterminate track shows the app is alive.
        expect(await screen.findByText('Scanning files…')).toBeInTheDocument();
        expect(screen.getByTestId('kb-indeterminate')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rebuild index' })).toBeDisabled();
    });

    it(
        'renders an ETA once two embedding samples show a steady chunk rate',
        async () => {
            let done = 5;
            const impl = (input: string | URL | Request, init?: RequestInit) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
                const method = (init?.method ?? 'GET').toUpperCase();
                if (url.startsWith('/api/ai/index/status') && method === 'GET') {
                    const body = {
                        service: 'hinatazaka46',
                        document_count: 5,
                        by_type: { blog: 5 },
                        progress: {
                            service: 'hinatazaka46',
                            phase: 'embedding',
                            done,
                            total: 200,
                            started_at: '2026-06-30T12:00:00+00:00',
                        },
                        last_built: null,
                    };
                    done += 5; // steady progress between polls
                    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            };
            vi.stubGlobal('fetch', vi.fn(impl));

            render(<KnowledgeBaseStatus />);

            // First sample alone can't estimate a rate -- no ETA yet.
            expect(await screen.findByText('Indexing 5/200…')).toBeInTheDocument();
            expect(screen.queryByText(/remaining/)).toBeNull();

            // The second poll (one interval later) establishes chunks/sec.
            expect(await screen.findByText(/~\d+m? ?\d*s remaining/, undefined, { timeout: 4000 })).toBeInTheDocument();
        },
        10000
    );

    it('POST /index/rebuild 409 {alreadyRunning} renders "already indexing" once status confirms another service is running', async () => {
        let statusCallCount = 0;
        const calls: FetchCall[] = [];
        const impl = (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const method = (init?.method ?? 'GET').toUpperCase();
            calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

            if (url.startsWith('/api/ai/index/status') && method === 'GET') {
                statusCallCount += 1;
                // First fetch (on mount): idle. After the 409, a re-fetch reveals a
                // DIFFERENT service's index is holding the process-wide lock.
                const body =
                    statusCallCount === 1
                        ? {
                              service: 'hinatazaka46',
                              document_count: 5,
                              by_type: { blog: 5 },
                              progress: IDLE_PROGRESS,
                              last_built: null,
                          }
                        : {
                              service: 'hinatazaka46',
                              document_count: 5,
                              by_type: { blog: 5 },
                              progress: {
                                  service: 'sakurazaka46',
                                  phase: 'embedding',
                                  done: 1,
                                  total: 4,
                                  started_at: '2026-06-30T12:00:00+00:00',
                              },
                              last_built: null,
                          };
                return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
            }
            if (url === '/api/ai/index/rebuild' && method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 409,
                    json: () => Promise.resolve({ detail: { alreadyRunning: true } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        };
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);
        await screen.findByText('5 documents indexed');

        await userEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));

        expect(await screen.findByText('An index is already running — try again shortly.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Rebuild index' })).toBeDisabled();
    });

    it('POST /index/rebuild 409 {code: kb_disabled} renders the "enable it" hint', async () => {
        const { impl } = buildFetch({
            rebuildResponse: {
                ok: false,
                status: 409,
                json: { detail: { code: 'kb_disabled', message: 'disabled' } },
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);
        await screen.findByText('5 documents indexed');

        await userEvent.click(screen.getByRole('button', { name: 'Rebuild index' }));

        expect(
            await screen.findByText('Enable the knowledge base chatbot above, then try again.')
        ).toBeInTheDocument();
    });

    it('renders the reindex-required banner when the embedder fingerprint mismatched (Product-wave Task 4 fold-in)', async () => {
        const { impl } = buildFetch({
            statusOverride: {
                configured: true,
                service: 'hinatazaka46',
                document_count: 5,
                by_type: { blog: 5 },
                progress: IDLE_PROGRESS,
                last_built: null,
                reindex_required: true,
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);

        expect(
            await screen.findByText(
                'The embedding model changed — rebuild the index to keep search results accurate.'
            )
        ).toBeInTheDocument();
    });

    it('does not render the reindex-required banner when the flag is false', async () => {
        const { impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KnowledgeBaseStatus />);
        await screen.findByText('5 documents indexed');

        expect(
            screen.queryByText('The embedding model changed — rebuild the index to keep search results accurate.')
        ).toBeNull();
    });
});
