// frontend/src/features/ai/__tests__/SetupChecklist.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupChecklist } from '../components/SetupChecklist';

// Selector-aware mock — matches `KnowledgeBaseStatus`'s
// `useAppStore((state) => state.activeService)` idiom.
vi.mock('../../../store/appStore', () => ({
    useAppStore: (selector: (state: { activeService: string | null }) => unknown) =>
        selector({ activeService: 'hinatazaka46' }),
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
};

const NO_LLM_READINESS = {
    enabled: true,
    embeddingModel: { ok: true, model: 'granite-embedding-278m-multilingual' },
    llm: { ok: false, backend: 'cloud', model: null, reason: 'not_configured' },
    index: { documentCount: 0 },
};

/** Mock fetch routing by URL/method, with mutable readiness/download/rebuild
 * responses a test can flip mid-flow (mirrors `KnowledgeBaseStatus.test.tsx`'s
 * idiom). `rebuildResponse` defaults to a 200 `{ok: true}` -- override via
 * `setRebuildResponse` to simulate a non-2xx `POST /api/ai/index/rebuild`
 * (P-4 review, Finding 1). */
function buildFetch(initialReadiness: object = READY_READINESS) {
    const calls: FetchCall[] = [];
    let readiness = initialReadiness;
    let downloadStatus: object = { state: 'idle', model: null, bytesDone: 0, bytesTotal: 0, reason: null };
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
        setRebuildResponse: (next: { ok: boolean; status?: number; body: object }) => {
            rebuildResponse = next;
        },
    };
}

describe('SetupChecklist', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows a loading state before the first readiness fetch resolves', () => {
        // A fetch that never resolves -- keeps the component in its initial
        // loading state for the whole (synchronous) test, with no pending
        // state update left dangling after the assertion.
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));

        render(<SetupChecklist />);

        expect(screen.getByText('Checking setup…')).toBeInTheDocument();
    });

    it('renders all rows ok and calls onReady when embedding model + llm + enabled all pass', async () => {
        const { impl } = buildFetch(READY_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));
        const onReady = vi.fn();

        render(<SetupChecklist onReady={onReady} />);

        expect(await screen.findByText('Embedding model')).toBeInTheDocument();
        expect(screen.getByText('AI backend')).toBeInTheDocument();
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

    it('renders the "configure a backend" hint when the LLM is not ready', async () => {
        const { impl } = buildFetch(NO_LLM_READINESS);
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        expect(await screen.findByText('Configure a backend below to enable the chatbot.')).toBeInTheDocument();
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

    it('renders the GPU-detected-but-runtime-missing hint when the readiness probe reports it', async () => {
        const { impl } = buildFetch({
            ...READY_READINESS,
            embeddingModel: { ...READY_READINESS.embeddingModel, gpuRuntimeMissing: true },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<SetupChecklist />);

        expect(
            await screen.findByText("GPU detected, but the GPU runtime isn't installed — running on CPU.")
        ).toBeInTheDocument();
    });
});
