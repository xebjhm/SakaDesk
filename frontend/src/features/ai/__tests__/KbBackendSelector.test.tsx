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

/** Build a mock fetch that routes by URL/method (mirrors `useSettings.test.ts`'s idiom). */
function buildFetch(overrides: { config?: Record<string, unknown> } = {}) {
    const calls: FetchCall[] = [];
    const config = overrides.config ?? CLOUD_CONFIG;
    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

        if (url === '/api/ai/config' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(config) });
        }
        if (url === '/api/ai/config' && method === 'PUT') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
        }
        if (url === '/api/ai/hardware-suggestion' && method === 'GET') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(HARDWARE_SUGGESTION) });
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

        await screen.findByRole('textbox', { name: 'Model' });
        expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('gemini-2.5-flash');
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
        await screen.findByRole('textbox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Local' }));
        await userEvent.clear(screen.getByRole('textbox', { name: 'Model' }));
        await userEvent.type(screen.getByRole('textbox', { name: 'Model' }), 'qwen2.5:14b');
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

    it('Detect hardware shows the recommendation, and using it sets backend=local + the suggested model', async () => {
        const { calls, impl } = buildFetch();
        vi.stubGlobal('fetch', vi.fn(impl));

        render(<KbBackendSelector />);
        await screen.findByRole('textbox', { name: 'Model' });

        await userEvent.click(screen.getByRole('button', { name: 'Detect hardware' }));

        await waitFor(() => {
            expect(calls.some((c) => c.url === '/api/ai/hardware-suggestion')).toBe(true);
        });

        const suggestionButton = await screen.findByRole('button', { name: /RTX 3090.*24.*qwen3:32b/ });
        expect(suggestionButton).toBeInTheDocument();
        expect(screen.getByText('GPU reports >=24GB VRAM.')).toBeInTheDocument();

        await userEvent.click(suggestionButton);

        expect(screen.getByRole('button', { name: 'Local' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('qwen3:32b');
    });
});
