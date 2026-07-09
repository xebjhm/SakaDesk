// frontend/src/shell/components/SettingsModal.test.tsx
//
// Settings > AI tab regression tests for the 2026-07 expert-review findings:
//
// - M3 (critical): the shared provider/API-key block must render even when
//   transcription AND translation are both off — KB Cloud mode reuses the same
//   keyring credential, so hiding the only key input made the key impossible
//   to enter.
// - M14 (major, data loss): the configure POST must carry ONLY the fields the
//   user actually changed. The backend treats an explicit `provider: null` as
//   "clear provider + delete the keyring key" (PATCH semantics via
//   `model_fields_set`, see backend/api/translation.py), so full-payload sends
//   from stale/unfetched state could silently delete the stored key.
// - M6/M7: Settings must not mount SetupChecklist (chat-only), and the KB
//   backend selector (with the master Enable switch) renders before the index
//   status block.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';
import type { AppSettings } from '../../features/messages/MessagesFeature';

// Selector-aware store mock. AiTab also calls `useAppStore.getState()` while
// seeding its target-language state, so the mock carries a `getState` static.
const storeState = vi.hoisted(() => ({
    selectedServices: [] as string[],
    transcriptionEnabled: false,
    translationEnabled: false,
    translationTargetLanguage: null as string | null,
    setTranscriptionEnabled: (): void => undefined,
    setTranslationEnabled: (): void => undefined,
    setTranslationTargetLanguage: (): void => undefined,
}));

vi.mock('../../store/appStore', () => ({
    useAppStore: Object.assign(
        (selector: (s: typeof storeState) => unknown) => selector(storeState),
        { getState: () => storeState }
    ),
}));

// The KB components own their fetch traffic and have their own test suites —
// stub them so this file exercises SettingsModal itself. SetupChecklist stays
// in the mock so the "Settings must NOT mount it" assertion is meaningful.
vi.mock('../../features/ai/components', () => ({
    KnowledgeBaseStatus: () => <div data-testid="kb-status" />,
    KbBackendSelector: () => <div data-testid="kb-backend-selector" />,
    SetupChecklist: () => <div data-testid="setup-checklist" />,
}));

interface FetchCall {
    url: string;
    method: string;
    body?: unknown;
}

interface AiConfigResponse {
    provider: string | null;
    model: string | null;
    has_api_key: boolean;
    api_key_masked: string | null;
    target_language: string | null;
}

/** Route /api/translation/* like the real backend; everything else 200 `{}`.
 * `config: 'hang'` keeps GET /api/translation/config pending forever to
 * reproduce the M14 save-before-config-loads race. */
function stubFetch(config: AiConfigResponse | 'hang') {
    const calls: FetchCall[] = [];
    const impl = (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });

        if (url === '/api/translation/config' && method === 'GET') {
            if (config === 'hang') return new Promise(() => undefined);
            return Promise.resolve({ ok: true, json: () => Promise.resolve(config) });
        }
        if (url === '/api/translation/models' && method === 'GET') {
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        gemini: [
                            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
                            { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
                        ],
                    }),
            });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    };
    vi.stubGlobal('fetch', vi.fn(impl));
    return { calls };
}

function configurePosts(calls: FetchCall[]): unknown[] {
    return calls
        .filter((c) => c.url === '/api/translation/configure' && c.method === 'POST')
        .map((c) => c.body);
}

const APP_SETTINGS: AppSettings = {
    output_dir: 'C:/data',
    auto_sync_enabled: true,
    sync_interval_minutes: 15,
    adaptive_sync_enabled: false,
    is_configured: true,
    blogs_full_backup: false,
};

async function renderAiTab() {
    render(
        <SettingsModal
            appSettings={APP_SETTINGS}
            outputDirInput="C:/data"
            setOutputDirInput={() => undefined}
            onSaveSettings={() => Promise.resolve(true)}
            onClose={() => undefined}
            activeService="hinatazaka46"
            onVerifyAndFix={() => undefined}
            onDeepResync={() => undefined}
        />
    );
    await userEvent.click(screen.getByRole('button', { name: 'AI' }));
}

describe('SettingsModal AI tab', () => {
    beforeEach(() => {
        storeState.transcriptionEnabled = false;
        storeState.translationEnabled = false;
        storeState.translationTargetLanguage = null;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('provider & API key block is always reachable (M3)', () => {
        it('shows the provider select, API key input, and Test button with transcription AND translation both off', async () => {
            stubFetch({
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                has_api_key: false,
                api_key_masked: null,
                target_language: null,
            });

            await renderAiTab();

            await waitFor(() => expect(screen.getByDisplayValue('Google Gemini')).toBeInTheDocument());
            expect(await screen.findByPlaceholderText('sk-... / AIza...')).toBeInTheDocument();
            expect(screen.getByText('Test Connection')).toBeInTheDocument();
        });

        it('explains that the key is shared by transcription, translation, and the assistant', async () => {
            stubFetch({
                provider: null,
                model: null,
                has_api_key: false,
                api_key_masked: null,
                target_language: null,
            });

            await renderAiTab();

            expect(
                await screen.findByText('Used by transcription, translation, and the AI assistant in Cloud mode.')
            ).toBeInTheDocument();
        });

        it('still shows the amber key-missing hint when a provider is configured but the keyring is empty', async () => {
            stubFetch({
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                has_api_key: false,
                api_key_masked: null,
                target_language: null,
            });

            await renderAiTab();

            expect(await screen.findByText(/No API key stored/)).toBeInTheDocument();
        });
    });

    describe('configure POST sends only user-changed fields (M14)', () => {
        it('saving only the target language sends {target_language} alone', async () => {
            storeState.translationEnabled = true;
            const { calls } = stubFetch({
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                has_api_key: true,
                api_key_masked: 'AIza...xQ',
                target_language: 'en',
            });

            await renderAiTab();
            // Wait for the config fetch to land (target select shows English).
            await waitFor(() => expect(screen.getByDisplayValue('English')).toBeInTheDocument());

            await userEvent.selectOptions(screen.getByDisplayValue('English'), 'zh-TW');

            await waitFor(() => expect(configurePosts(calls)).toHaveLength(1));
            expect(configurePosts(calls)[0]).toEqual({ target_language: 'zh-TW' });
        });

        it('changing the provider sends {provider, model} and nothing else', async () => {
            const { calls } = stubFetch({
                provider: null,
                model: null,
                has_api_key: false,
                api_key_masked: null,
                target_language: null,
            });

            await renderAiTab();
            await waitFor(() => expect(screen.getByDisplayValue('—')).toBeInTheDocument());

            await userEvent.selectOptions(screen.getByDisplayValue('—'), 'gemini');

            await waitFor(() => expect(configurePosts(calls)).toHaveLength(1));
            expect(configurePosts(calls)[0]).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash' });
        });

        it('entering a new API key sends {api_key} alone on blur', async () => {
            const { calls } = stubFetch({
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                has_api_key: false,
                api_key_masked: null,
                target_language: null,
            });

            await renderAiTab();
            const keyInput = await screen.findByPlaceholderText('sk-... / AIza...');

            await userEvent.type(keyInput, 'AIza-new-key');
            await userEvent.tab();

            await waitFor(() => expect(configurePosts(calls)).toHaveLength(1));
            expect(configurePosts(calls)[0]).toEqual({ api_key: 'AIza-new-key' });
        });

        it('never sends provider (so the backend never clears the key) when saving before the config fetch resolves', async () => {
            storeState.translationEnabled = true;
            const { calls } = stubFetch('hang');

            await renderAiTab();

            // Target-language select is the first combobox on the tab; change it
            // while GET /api/translation/config is still pending.
            const targetSelect = screen.getAllByRole('combobox')[0];
            await userEvent.selectOptions(targetSelect, 'yue');

            await waitFor(() => expect(configurePosts(calls)).toHaveLength(1));
            expect(configurePosts(calls)[0]).toEqual({ target_language: 'yue' });
        });
    });
});
