// frontend/src/features/ai/__tests__/SetupChecklist.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupChecklist } from '../components/SetupChecklist';

// Selector-aware mock — matches `SetupChecklist`'s
// `useAppStore((state) => state.activeService)` idiom. `openSettings` is the
// cross-wave contract (`openSettings(tab)` lands in `appStore` this same
// wave): the "configure a backend" hint button calls it with `'ai'`.
const { mockOpenSettings } = vi.hoisted(() => ({ mockOpenSettings: vi.fn() }));
vi.mock('../../../store/appStore', () => ({
    useAppStore: (
        selector: (state: { activeService: string | null; openSettings: (tab: string) => void }) => unknown
    ) => selector({ activeService: 'hinatazaka46', openSettings: mockOpenSettings }),
}));

interface FetchCall {
    url: string;
    method: string;
    body?: unknown;
}

const READY_READINESS = {
    enabled: true,
    embeddingModel: { ok: true, model: 'granite-embedding-278m-multilingual', path: '/x' },
    llm: { ok: true, backend: 'cloud', model: 'gemini-2.5-flash' },
    index: { documentCount: 5 },
    runtime: { ok: true, state: 'bundled', host: 'cpu-x64' },
};

const MISSING_MODEL_READINESS = {
    enabled: true,
    embeddingModel: {
        ok: false,
        reason: 'embedding_model_missing',
        model: 'granite-embedding-278m-multilingual',
        expectedPath: '/models/granite-embedding-278m-multilingual',
    },
    llm: { ok: true, backend: 'cloud', model: 'gemini-2.5-flash' },
    index: { documentCount: 0 },
    runtime: { ok: true, state: 'bundled', host: 'cpu-x64' },
};

const NO_LLM_READINESS = {
    enabled: true,
    embeddingModel: { ok: true, model: 'granite-embedding-278m-multilingual' },
    llm: { ok: false, backend: 'cloud', model: null, reason: 'not_configured' },
    index: { documentCount: 0 },
    runtime: { ok: true, state: 'bundled', host: 'cpu-x64' },
};

const IDLE_INDEX_STATUS = {
    service: 'hinatazaka46',
    document_count: 5,
    by_type: { blog: 5 },
    progress: { service: null, phase: 'idle', done: 0, total: 0, started_at: null },
    last_built: null,
};

/** Mock fetch routing by URL/method, with mutable readiness/download/rebuild/
 * index-status/runtime-status responses a test can flip mid-flow (mirrors
 * `KnowledgeBaseStatus.test.tsx`'s idiom). `rebuildResponse` defaults to a 200
 * `{ok: true}` -- override via `setRebuildResponse` to simulate a non-2xx
 * `POST /api/ai/index/rebuild` (P-4 review, Finding 1). */
function buildFetch(initialReadiness: object = READY_READINESS) {
    const calls: FetchCall[] = [];
    let readiness = initialReadiness;
    let downloadStatus: object = { state: 'idle', model: null, bytesDone: 0, bytesTotal: 0, reason: null };
    let indexStatus: object = IDLE_INDEX_STATUS;
    let runtimeStatus: object = { state: 'idle', host: null, bytesDone: 0, bytesTotal: 0, reason: null };
    let rebuildResponse: { ok: boolean; status?: number; body: object } = {
        ok: true,
        body: { ok: true },
    };

    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

        if (url === '/api/ai/readiness' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(readiness) });
        }
        if (url === '/api/ai/enabled' && method === 'PUT') {
            const next = JSON.parse(init?.body as string) as { enabled: boolean };
            readiness = { ...readiness, enabled: next.enabled };
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, enabled: next.enabled }) });
        }
        if (url === '/api/ai/models/download' && method === 'POST') {
            downloadStatus = { state: 'downloading', model: 'granite-embedding-278m-multilingual', bytesDone: 0, bytesTotal: 100 * 1024 * 1024, reason: null };
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        if (url === '/api/ai/models/download' && method === 'DELETE') {
            downloadStatus = { state: 'cancelled', model: 'granite-embedding-278m-multilingual', bytesDone: 40 * 1024 * 1024, bytesTotal: 100 * 1024 * 1024, reason: null };
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, cancelled: true }) });
        }
        if (url === '/api/ai/models/download/status' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(downloadStatus) });
        }
        if (url.startsWith('/api/ai/index/status') && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(indexStatus) });
        }
        if (url === '/api/ai/runtime/status' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(runtimeStatus) });
        }
        if (url === '/api/ai/index/rebuild' && method === 'POST') {
            return Promise.resolve({
                ok: rebuildResponse.ok,
                status: rebuildResponse.status ?? (rebuildResponse.ok ? 200 : 500),
                json: () => Promise.resolve(rebuildResponse.body),
            });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };

    return {
        calls,
        impl,
        setReadiness: (next: object) => {
            readiness = next;
        },
        setDownloadStatus: (next: object) => {
            downloadStatus = next;
        },
        setIndexStatus: (next: object) => {
            indexStatus = next;
        },
        setRuntimeStatus: (next: object) => {
            runtimeStatus = next;
        },
        setRebuildResponse: (next: { ok: boolean; status?: number; body: object }) => {
            rebuildResponse = next;
        },
    };
}

/** An in-flight `embedding` index status (chunk counts, live doc count). */
function embeddingIndexStatus(done: number, total: number, documentCount: number) {
    return {
        service: 'hinatazaka46',
        document_count: documentCount,
        by_type: { blog: documentCount },
        progress: { service: 'hinatazaka46', phase: 'embedding', done, total, started_at: '2026-07-09T12:00:00+00:00' },
        last_built: null,
    };
}

describe('SetupChecklist', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        mockOpenSettings.mockReset();
    });

    it('shows a loading state before the first readiness fetch resolves', () => {
        // A fetch that never resolves -- keeps the component in its initial
        // loading state for the whole (synchronous) test, with no pending
        // state update left dangling after the assertion.
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

        render(<SetupChecklist />);

        expect(screen.getByText('Checking setup…')).toBeInTheDocument();
    });

    it('renders all rows ok and calls onReady when every readiness check passes', async () => {
        const { impl } = buildFetch(READY_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);

        expect(await screen.findByText('Embedding model')).toBeInTheDocument();
        expect(screen.getByText('AI backend')).toBeInTheDocument();
        expect(screen.getByText('Knowledge base chatbot')).toBeInTheDocument();
        expect(screen.getByText('5 documents indexed')).toBeInTheDocument();
        await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
        // Not ready-yet-only affordances shouldn't render once fully configured.
        expect(screen.queryByText('Download (~1.1 GB)')).toBeNull();
    });

    it('renders a Download button when the embedding model is missing, and does not call onReady', async () => {
        const { impl } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);

        expect(await screen.findByText('Download (~1.1 GB)')).toBeInTheDocument();
        expect(onReady).not.toHaveBeenCalled();
    });

    it('clicking Download POSTs /api/ai/models/download and renders live progress from the status poll', async () => {
        const { impl, calls, setDownloadStatus } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await userEvent.click(await screen.findByText('Download (~1.1 GB)'));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/models/download' && c.method === 'POST')).toBe(true);
        });

        // First poll tick renders the 0/100 progress bar.
        expect(await screen.findByText('0 MB / 100 MB')).toBeInTheDocument();

        // Advance the mocked download, then let the next poll tick pick it up.
        setDownloadStatus({ state: 'downloading', model: 'm', bytesDone: 50 * 1024 * 1024, bytesTotal: 100 * 1024 * 1024, reason: null });
        await waitFor(
            () => {
                expect(screen.getByText('50 MB / 100 MB')).toBeInTheDocument();
            },
            { timeout: 2000 }
        );
    });

    it('download reaching state=done re-polls readiness and flips the row to ok', async () => {
        const { impl, setDownloadStatus, setReadiness } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);
        await userEvent.click(await screen.findByText('Download (~1.1 GB)'));
        await screen.findByText(/MB \/ 100 MB/);

        // Download finishes -- the model is now on disk -- readiness flips too.
        setDownloadStatus({ state: 'done', model: 'm', bytesDone: 100 * 1024 * 1024, bytesTotal: 100 * 1024 * 1024, reason: null });
        setReadiness(READY_READINESS);

        await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1), { timeout: 2000 });
    });

    it('a checksum-mismatch/error download state renders the failure message', async () => {
        const { impl, setDownloadStatus } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await userEvent.click(await screen.findByText('Download (~1.1 GB)'));
        await screen.findByText(/MB \/ 100 MB/);

        setDownloadStatus({ state: 'error', model: 'm', bytesDone: 0, bytesTotal: 100 * 1024 * 1024, reason: 'checksum_mismatch' });

        expect(await screen.findByText('Download failed. Try again.')).toBeInTheDocument();
    });

    it('clicking Cancel sends DELETE /api/ai/models/download', async () => {
        const { impl, calls } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await userEvent.click(await screen.findByText('Download (~1.1 GB)'));
        await screen.findByText(/MB \/ 100 MB/);

        await userEvent.click(screen.getByText('Cancel'));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/models/download' && c.method === 'DELETE')).toBe(true);
        });
    });

    it('renders the "configure a backend" hint as a button that opens AI settings', async () => {
        const { impl } = buildFetch(NO_LLM_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        const hint = await screen.findByText('Configure a backend in AI settings to enable the chatbot.');
        expect(hint.closest('button')).not.toBeNull();

        await userEvent.click(hint);
        expect(mockOpenSettings).toHaveBeenCalledWith('ai');
    });

    it('clicking Build POSTs /api/ai/index/rebuild with the active service', async () => {
        const { impl, calls } = buildFetch(READY_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('5 documents indexed');

        await userEvent.click(screen.getByText('Build'));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/index/rebuild' && c.method === 'POST')).toBe(true);
        });
        const rebuildCall = calls.find((c) => c.url === '/api/ai/index/rebuild')!;
        expect(rebuildCall.body).toEqual({ service: 'hinatazaka46' });
    });

    it('Build is disabled while the embedding model is not configured', async () => {
        const { impl } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('0 documents indexed', { exact: false }).catch(() => undefined);

        const buildButton = await screen.findByText('Build');
        expect(buildButton.closest('button')).toBeDisabled();
    });

    // P-4 review, Finding 1: `handleBuildIndex` used to only catch NETWORK
    // failures -- a non-2xx response (e.g. a 409) resolved normally and was
    // silently dropped, leaving the user with no explanation. These assert
    // the typed, localized message now renders for each 409 the backend can
    // send, and for a genuine network failure.
    it('clicking Build renders the typed error when the rebuild 409s not_configured', async () => {
        const { impl, setRebuildResponse } = buildFetch(READY_READINESS);
        setRebuildResponse({
            ok: false,
            status: 409,
            body: {
                detail: {
                    code: 'not_configured',
                    message: 'The knowledge chatbot needs the embedding model installed before it can build an index. Download it in AI settings.',
                },
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('5 documents indexed');
        await userEvent.click(screen.getByText('Build'));

        expect(
            await screen.findByText(
                'The knowledge chatbot needs the embedding model installed before it can build an index. Download it in AI settings.'
            )
        ).toBeInTheDocument();
    });

    it('clicking Build renders the typed error when the rebuild 409s already_running', async () => {
        const { impl, setRebuildResponse } = buildFetch(READY_READINESS);
        setRebuildResponse({
            ok: false,
            status: 409,
            body: {
                detail: {
                    code: 'already_running',
                    alreadyRunning: true,
                    message: "An index rebuild is already running for this service. It'll finish shortly -- no need to try again.",
                },
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('5 documents indexed');
        await userEvent.click(screen.getByText('Build'));

        expect(
            await screen.findByText(
                "An index rebuild is already running for this service. It'll finish shortly — no need to try again."
            )
        ).toBeInTheDocument();
    });

    it('clicking Build renders a fallback error for an UNRECOGNIZED 409 code', async () => {
        const { impl, setRebuildResponse } = buildFetch(READY_READINESS);
        setRebuildResponse({
            ok: false,
            status: 500,
            body: { detail: 'some raw, untranslated backend string' },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('5 documents indexed');
        await userEvent.click(screen.getByText('Build'));

        // Never the raw backend string -- falls back to the generic `unknown`
        // i18n message instead.
        expect(await screen.findByText('Something went wrong answering that. Please try again.')).toBeInTheDocument();
        expect(screen.queryByText('some raw, untranslated backend string')).toBeNull();
    });

    it('clicking Build renders the network-error message when the fetch itself rejects', async () => {
        const calls: { url: string; method: string }[] = [];
        const impl = (input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            const method = (init?.method ?? 'GET').toUpperCase();
            calls.push({ url, method });
            if (url === '/api/ai/readiness' && method === 'GET') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(READY_READINESS) });
            }
            if (url === '/api/ai/index/rebuild' && method === 'POST') {
                return Promise.reject(new Error('network down'));
            }
            if (url.startsWith('/api/ai/index/status') && method === 'GET') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(IDLE_INDEX_STATUS) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        };
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('5 documents indexed');
        await userEvent.click(screen.getByText('Build'));

        expect(
            await screen.findByText("Couldn't reach SakaDesk's backend. Check your connection and try again.")
        ).toBeInTheDocument();
    });

    // ── Enable toggle (ROW 0, finding M2) ──────────────────────────────────

    it('renders an enable toggle that PUTs /api/ai/enabled and reflects the new state', async () => {
        const { impl, calls } = buildFetch({ ...READY_READINESS, enabled: false });
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);

        const toggle = await screen.findByRole('switch', { name: 'Knowledge base chatbot' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(onReady).not.toHaveBeenCalled();

        await userEvent.click(toggle);

        await waitFor(() => {
            const put = calls.find((c) => c.url === '/api/ai/enabled' && c.method === 'PUT');
            expect(put?.body).toEqual({ enabled: true });
        });
        // The follow-up readiness refresh flips the switch on.
        await waitFor(() => {
            expect(screen.getByRole('switch', { name: 'Knowledge base chatbot' })).toHaveAttribute('aria-checked', 'true');
        });
    });

    // ── Ready gate (findings M5/M8) ────────────────────────────────────────

    it('does NOT call onReady while the ONNX runtime is not ok', async () => {
        const { impl } = buildFetch({ ...READY_READINESS, runtime: { ok: false, state: 'missing', host: 'cpu-x64' } });
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);

        await screen.findByText('Embedding model');
        expect(onReady).not.toHaveBeenCalled();
    });

    it('does NOT call onReady with zero documents and explains there is nothing to index yet', async () => {
        const { impl } = buildFetch({ ...READY_READINESS, index: { documentCount: 0 } });
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);

        expect(
            await screen.findByText('Nothing to index yet — sync some messages or blogs first.')
        ).toBeInTheDocument();
        expect(onReady).not.toHaveBeenCalled();
    });

    // ── Runtime/GPU row honesty (owner complaint #1) ───────────────────────

    it('renders a positive GPU line (not the CPU warning) when the provider is DirectML', async () => {
        const { impl } = buildFetch({
            ...READY_READINESS,
            embeddingModel: {
                ...READY_READINESS.embeddingModel,
                provider: 'DmlExecutionProvider',
                // Even a stale/buggy hint must not override the confirmed GPU provider.
                gpuRuntimeMissing: true,
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        expect(await screen.findByText('Running on GPU (DirectML)')).toBeInTheDocument();
        expect(screen.queryByText(/runs on CPU/)).toBeNull();
    });

    it('renders a positive GPU line when the provider is CUDA', async () => {
        const { impl } = buildFetch({
            ...READY_READINESS,
            embeddingModel: { ...READY_READINESS.embeddingModel, provider: 'CUDAExecutionProvider' },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        expect(await screen.findByText('Running on GPU (CUDA)')).toBeInTheDocument();
    });

    it('renders the truthful runtime-not-installed hint when gpuRuntimeMissing and no GPU provider', async () => {
        const { impl } = buildFetch({
            ...READY_READINESS,
            embeddingModel: {
                ...READY_READINESS.embeddingModel,
                provider: 'CPUExecutionProvider',
                gpuRuntimeMissing: true,
            },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        expect(
            await screen.findByText("GPU runtime not installed yet — indexing runs on CPU until it's ready.")
        ).toBeInTheDocument();
    });

    it('shows GPU-runtime download progress while the runtime is being set up', async () => {
        const { impl, setRuntimeStatus } = buildFetch({
            ...READY_READINESS,
            runtime: { ok: false, state: 'downloading', host: 'gpu-dml' },
        });
        setRuntimeStatus({ state: 'downloading', host: 'gpu-dml', bytesDone: 50 * 1024 * 1024, bytesTotal: 100 * 1024 * 1024, reason: null });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        expect(await screen.findByText('Setting up GPU runtime… 50%')).toBeInTheDocument();
    });

    // ── Live index progress (owner complaint #2) ───────────────────────────

    it('never polls /api/ai/index/status before the embedding model is installed', async () => {
        const { impl, calls } = buildFetch(MISSING_MODEL_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);
        await screen.findByText('Download (~1.1 GB)');

        expect(calls.some((c) => c.url.startsWith('/api/ai/index/status'))).toBe(false);
    });

    it('a mounted checklist picks up an already-running build and shows live progress', async () => {
        const mock = buildFetch(READY_READINESS);
        mock.setIndexStatus(embeddingIndexStatus(5, 20, 42));
        vi.stubGlobal('fetch', vi.fn(mock.impl));

        render(<SetupChecklist />);

        // Phase label (reused settings key), live doc count, and progress bar.
        expect(await screen.findByText('Indexing 5/20…')).toBeInTheDocument();
        expect(screen.getByText('42 documents indexed so far')).toBeInTheDocument();
        expect(screen.getByTestId('index-progress-bar')).toBeInTheDocument();
        // Build is keyed to the live phase, not just the POST lifetime.
        expect(screen.getByText('Build').closest('button')).toBeDisabled();
    });

    it('clicking Build starts the index-status poll and renders live progress', async () => {
        const mock = buildFetch(READY_READINESS);
        vi.stubGlobal('fetch', vi.fn(mock.impl));

        render(<SetupChecklist />);
        await screen.findByText('5 documents indexed');

        mock.setIndexStatus(embeddingIndexStatus(2, 20, 12));
        await userEvent.click(screen.getByText('Build'));

        await waitFor(
            () => {
                expect(screen.getByText('Indexing 2/20…')).toBeInTheDocument();
            },
            { timeout: 3500 }
        );
        expect(screen.getByText('12 documents indexed so far')).toBeInTheDocument();
        expect(screen.getByText('Build').closest('button')).toBeDisabled();
    });

    it(
        'refreshes readiness once the poll confirms the build is done (two idle reads)',
        async () => {
            const mock = buildFetch(READY_READINESS);
            mock.setIndexStatus(embeddingIndexStatus(19, 20, 99));
            vi.stubGlobal('fetch', vi.fn(mock.impl));

            render(<SetupChecklist />);
            await screen.findByText('Indexing 19/20…');

            const readinessCallsDuringBuild = mock.calls.filter((c) => c.url === '/api/ai/readiness').length;
            mock.setIndexStatus(IDLE_INDEX_STATUS);
            mock.setReadiness({ ...READY_READINESS, index: { documentCount: 99 } });

            // Two consecutive idle reads (2s apart) settle the poll, which then
            // refetches readiness for the final count.
            await waitFor(
                () => {
                    expect(
                        mock.calls.filter((c) => c.url === '/api/ai/readiness').length
                    ).toBeGreaterThan(readinessCallsDuringBuild);
                },
                { timeout: 6000 }
            );
            await waitFor(() => {
                expect(screen.getByText('99 documents indexed')).toBeInTheDocument();
            });
        },
        15000
    );
});
