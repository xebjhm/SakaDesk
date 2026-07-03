// frontend/src/features/ai/__tests__/KbBackendSelector.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KbBackendSelector } from '../components/KbBackendSelector';

interface FetchCall {
    url: string;
    method: string;
    body?: unknown;
}

const CLOUD_CONFIG = {
    backend: 'cloud',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
};

const HARDWARE_SUGGESTION = {
    hardware: { ram_gb: 32, gpu: 'RTX 3090', vram_gb: 24, platform: 'Linux' },
    suggestion: {
        recommended: 'local',
        local_model: 'qwen3:32b',
        tier: 'T2',
        reason: 'GPU reports >=24GB VRAM.',
    },
};

const CLOUD_MODELS = {
    backend: 'cloud',
    models: [
        { id: 'gemini-2.5-flash', tier: 'recommended', noteKey: null },
        { id: 'gemini-2.5-flash-lite', tier: 'degraded', noteKey: 'flashLiteWeakToolCalling' },
    ],
};

const LOCAL_MODELS = {
    backend: 'local',
    models: [
        { id: 'qwen3:30b', tier: 'recommended', noteKey: null, installed: true },
        { id: 'qwen2.5:14b', tier: 'degraded', noteKey: 'skippedToolCallOnJapanese', installed: false },
    ],
    ollamaReachable: true,
};

/** Build a mock fetch that routes by URL/method (mirrors `useSettings.test.ts`'s idiom). */
function buildFetch(
    overrides: {
        config?: Record<string, unknown>;
        enabled?: boolean;
        enabledPutOk?: boolean;
        localModels?: Record<string, unknown>;
        configTest?: Record<string, unknown>;
        configPutStatus?: number;
        configPutBody?: Record<string, unknown>;
    } = {}
) {
    const calls: FetchCall[] = [];
    const config = overrides.config ?? CLOUD_CONFIG;
    const enabled = overrides.enabled ?? false;
    const localModels = overrides.localModels ?? LOCAL_MODELS;
    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

        if (url === '/api/ai/config' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(config) });
        }
        if (url === '/api/ai/config' && method === 'PUT') {
            const status = overrides.configPutStatus ?? 200;
            const body = overrides.configPutBody ?? { ok: true, tier: 'recommended', noteKey: null };
            return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
        }
        if (url === '/api/ai/config/test' && method === 'POST') {
            const body = overrides.configTest ?? { ok: true, verdict: 'ok', latencyMs: 120 };
            return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
        }
        if (url === '/api/ai/enabled' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled }) });
        }
        if (url === '/api/ai/enabled' && method === 'PUT') {
            const ok = overrides.enabledPutOk ?? true;
            return Promise.resolve({ ok, json: () => Promise.resolve(ok ? { ok: true } : {}) });
        }
        if (url === '/api/ai/hardware-suggestion' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(HARDWARE_SUGGESTION) });
        }
        if (url.startsWith('/api/ai/models?backend=cloud')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(CLOUD_MODELS) });
        }
        if (url.startsWith('/api/ai/models?backend=local')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(localModels) });
        }
        if (url === '/api/ai/usage') {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ model: 'x', requestsToday: 0, dailyLimit: null, estQuestionsLeft: null }),
            });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };
    return { calls, impl };
}

describe('KbBackendSelector', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('loads the cloud config by default and reveals Base URL only after switching to Local', async () => {
        const { impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);

        const select = await screen.findByRole('combobox', { name: 'Model' });
        await waitFor(() => expect(select).toHaveValue('gemini-2.5-flash'));
        // `settings.kbBackend` / `settings.kbBackendCloud` / `settings.kbBackendLocal` resolve
        // to real en.json strings.
        expect(screen.getByText('Backend')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cloud' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('textbox', { name: 'Base URL' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Local' }));

        expect(screen.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('textbox', { name: 'Base URL' })).toBeInTheDocument();
    });

    it('Save PUTs /api/ai/config with the edited backend/base_url/model', async () => {
        const { calls, impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        const select = await screen.findByRole('combobox', { name: 'Model' });
        await waitFor(() => expect(select).toHaveValue('gemini-2.5-flash'));

        await userEvent.click(screen.getByRole('button', { name: 'Local' }));
        await waitFor(() =>
            expect(screen.getByRole('option', { name: /qwen3:30b/ })).toBeInTheDocument()
        );
        await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Model' }), 'qwen2.5:14b');
        await userEvent.clear(screen.getByRole('textbox', { name: 'Base URL' }));
        await userEvent.type(screen.getByRole('textbox', { name: 'Base URL' }), 'http://localhost:11434/v1');

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/config' && c.method === 'PUT')).toBe(true);
        });
        const putCall = calls.find((c) => c.url === '/api/ai/config' && c.method === 'PUT')!;
        expect(putCall.body).toEqual({
            backend: 'local',
            base_url: 'http://localhost:11434/v1',
            model: 'qwen2.5:14b',
        });
    });

    it('shows the Custom… escape hatch for a model not in the curated/live list', async () => {
        const { impl } = buildFetch({
            config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'my-custom-model' },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);

        const customInput = await screen.findByPlaceholderText('Enter a model id');
        expect(customInput).toHaveValue('my-custom-model');
        expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('__custom__');
    });

    it('renders a tier badge and note for a degraded curated model', async () => {
        const { impl } = buildFetch({
            config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'qwen2.5:14b' },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);

        await screen.findByText('Use with caution');
        expect(
            screen.getByText(/May skip tool calls on some questions/)
        ).toBeInTheDocument();
        // Not installed -- the "ollama pull" hint renders.
        expect(screen.getByText(/ollama pull qwen2.5:14b/)).toBeInTheDocument();
    });

    it('shows the Ollama-unreachable banner when the local probe fails', async () => {
        const { impl } = buildFetch({
            config: { backend: 'local', base_url: 'http://localhost:11434/v1', model: 'qwen3:30b' },
            localModels: { backend: 'local', models: [], ollamaReachable: false },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);

        await screen.findByText("Can't reach a local server at this address.");
    });

    it('the Test button POSTs the draft config and renders the verdict', async () => {
        const { calls, impl } = buildFetch({ configTest: { ok: true, verdict: 'ok', latencyMs: 87 } });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('combobox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Test' }));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/config/test' && c.method === 'POST')).toBe(true);
        });
        const testCall = calls.find((c) => c.url === '/api/ai/config/test')!;
        expect(testCall.body).toEqual({
            backend: 'cloud',
            base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: 'gemini-2.5-flash',
        });
        await screen.findByText(/Connected — tool calls work\./);
    });

    it('the Test button renders a no_tool_call verdict distinctly', async () => {
        const { impl } = buildFetch({
            configTest: { ok: false, verdict: 'no_tool_call', latencyMs: 50 },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('combobox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Test' }));

        await screen.findByText(/without using the tool/);
    });

    it('the Test button reuses the shared ai.error.* copy for an error-kind verdict', async () => {
        const { impl } = buildFetch({
            configTest: { ok: false, verdict: 'auth', latencyMs: 10 },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('combobox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Test' }));

        await screen.findByText(/The AI provider rejected the API key/);
    });

    it('Save shows a warning when the PUT response reports a degraded tier', async () => {
        const { impl } = buildFetch({
            configPutBody: { ok: true, tier: 'degraded', noteKey: 'flashLiteWeakToolCalling' },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('combobox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByText(/May skip tool calls on answerable questions/);
    });

    it('Save shows the model_blocked error when the backend rejects the draft', async () => {
        const { impl } = buildFetch({
            configPutStatus: 400,
            configPutBody: { detail: { code: 'model_blocked', message: 'blocked', noteKey: 'x' } },
        });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('combobox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Save' }));

        await screen.findByText(/blocked for the knowledge chatbot/);
    });

    it('Detect hardware shows the recommendation, and using it sets backend=local + the suggested model', async () => {
        const { calls, impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('combobox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Detect hardware' }));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/hardware-suggestion')).toBe(true);
        });

        const suggestionButton = await screen.findByRole('button', { name: /RTX 3090.*24.*qwen3:32b/ });
        expect(suggestionButton).toBeInTheDocument();
        expect(screen.getByText('GPU reports >=24GB VRAM.')).toBeInTheDocument();

        await userEvent.click(suggestionButton);

        expect(screen.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('loads the Enable switch state from GET /api/ai/enabled', async () => {
        const { impl } = buildFetch({ enabled: true });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);

        const toggle = await screen.findByRole('switch', { name: 'Enable knowledge base chatbot' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('clicking the Enable switch PUTs /api/ai/enabled with the flipped value', async () => {
        const { calls, impl } = buildFetch({ enabled: false });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        const toggle = await screen.findByRole('switch', { name: 'Enable knowledge base chatbot' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');

        await userEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-checked', 'true');
        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/enabled' && c.method === 'PUT')).toBe(true);
        });
        const putCall = calls.find((c) => c.url === '/api/ai/enabled' && c.method === 'PUT')!;
        expect(putCall.body).toEqual({ enabled: true });
    });

    it('rolls back the optimistic toggle if the PUT fails', async () => {
        const { impl } = buildFetch({ enabled: false, enabledPutOk: false });
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        const toggle = await screen.findByRole('switch', { name: 'Enable knowledge base chatbot' });

        await userEvent.click(toggle);

        await waitFor(() => {
            expect(toggle).toHaveAttribute('aria-checked', 'false');
        });
    });
});
