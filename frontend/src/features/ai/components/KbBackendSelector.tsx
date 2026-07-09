// frontend/src/features/ai/components/KbBackendSelector.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { errorMessageKey } from '../aiErrorCode';
import { UsageMeter } from './UsageMeter';

type KbBackend = 'cloud' | 'local';
type ModelTier = 'recommended' | 'degraded' | 'blocked' | 'unknown';

interface KbConfig {
    backend: KbBackend;
    base_url: string;
    model: string;
}

interface HardwareInfo {
    ram_gb: number | null;
    gpu: string | null;
    vram_gb: number | null;
    platform: string;
}

interface HardwareSuggestion {
    recommended: 'local' | 'cloud';
    local_model: string | null;
    tier: string;
    reason: string;
}

interface HardwareSuggestionResponse {
    hardware: HardwareInfo;
    suggestion: HardwareSuggestion;
}

/** `GET /api/ai/models`'s per-model entry (`backend/services/llm_models.py`'s
 * `ModelLookup`, camelCased). `installed` is only present for `backend=local`
 * (merged with a live `backend.services.ollama.probe()` result). */
interface ModelOption {
    id: string;
    tier: ModelTier;
    noteKey: string | null;
    installed?: boolean;
}

interface ModelsResponse {
    backend: KbBackend;
    models: ModelOption[];
    ollamaReachable?: boolean;
}

/** `POST /api/ai/config/test`'s response shape. */
interface ConfigTestResponse {
    ok: boolean;
    verdict: string;
    latencyMs: number;
}

/** Sentinel `<select>` value for the "Custom…" escape hatch -- never a real
 * model id (curated ids never start with `__`), so it can't collide. */
const CUSTOM_MODEL_VALUE = '__custom__';

const TIER_BADGE_CLASSES: Record<ModelTier, string> = {
    recommended: 'bg-green-50 text-green-700',
    degraded: 'bg-amber-50 text-amber-700',
    blocked: 'bg-red-50 text-red-700',
    unknown: 'bg-gray-100 text-gray-500',
};

/** `POST /api/ai/config/test`'s `verdict` -> a localized message. `"ok"`/
 * `"no_tool_call"` have their own copy; anything else is an `LLMBackendError.
 * kind` (`auth`/`quota_exhausted`/`unreachable`/...) and reuses the SAME
 * `ai.error.<code>` strings `ChatWindow`'s ErrorTurn shows, via the shared
 * `errorMessageKey` mapping -- one translated message per failure kind,
 * not two. */
function testVerdictKey(verdict: string): string {
    if (verdict === 'ok') return 'settings.kbTestVerdictOk';
    if (verdict === 'no_tool_call') return 'settings.kbTestVerdictNoToolCall';
    return errorMessageKey(verdict);
}

/**
 * `KbBackendSelector` — Settings > AI > Enable switch + knowledge base backend
 * switch.
 *
 * The Enable switch at the top toggles `settings.knowledge_base.enabled` via
 * `GET`/`PUT /api/ai/enabled` (Task 3 item 1) -- the single flag every index
 * hook and `/ask`/`/index/rebuild` gate on. Flipping it false->true also
 * schedules a background initial build for every already-synced service, so
 * `KnowledgeBaseStatus` above will start showing real progress shortly after.
 *
 * Below that: loads the current `{backend, base_url, model}` from
 * `GET /api/ai/config` into local draft state, lets the user flip Cloud <->
 * Local, pick a `model` (Product-wave Task 5, item 1: a curated `<select>` +
 * "Custom…" escape hatch, populated from `GET /api/ai/models` -- for Local
 * that's merged with a LIVE probe of whatever's actually installed, item 4),
 * edit `base_url` (Local only), Test the draft round-trip (item 2), and Save.
 *
 * "Detect hardware" is a convenience helper, not tied to the draft: it GETs
 * `/api/ai/hardware-suggestion` and renders the recommendation. When the
 * recommendation is "local", the rendered suggestion doubles as a one-click
 * "use this" control -- clicking it only fills the draft (backend=local,
 * model=suggestion.local_model); Save still persists it, same as any other
 * field here.
 */
export const KbBackendSelector: React.FC = () => {
    const { t } = useTranslation();

    // Enable switch — independent of the draft below (its own GET/PUT
    // endpoint, see `backend/api/ai.py`'s `get_kb_enabled`/`put_kb_enabled`).
    const [enabled, setEnabled] = useState(false);
    const [enabledSaving, setEnabledSaving] = useState(false);

    // Draft state, PUT to the backend on Save. Starts as Cloud (the default,
    // pre-fetch view) so there's no flash of a Local-only field before the
    // GET /api/ai/config response arrives.
    const [backend, setBackend] = useState<KbBackend>('cloud');
    const [baseUrl, setBaseUrl] = useState('');
    const [model, setModel] = useState('');
    const [customMode, setCustomMode] = useState(false);

    const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
    const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null);

    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveWarningNoteKey, setSaveWarningNoteKey] = useState<string | null>(null);
    const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null);

    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ConfigTestResponse | null>(null);

    const [detecting, setDetecting] = useState(false);
    const [hwResult, setHwResult] = useState<HardwareSuggestionResponse | null>(null);

    useEffect(() => {
        fetch('/api/ai/enabled')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: { enabled?: boolean } | null) => {
                if (data && typeof data.enabled === 'boolean') setEnabled(data.enabled);
            })
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to fetch KB enabled state:', err);
            });
    }, []);

    useEffect(() => {
        fetch('/api/ai/config')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: Partial<KbConfig> | null) => {
                if (!data) return;
                if (data.backend === 'local' || data.backend === 'cloud') setBackend(data.backend);
                if (typeof data.base_url === 'string') setBaseUrl(data.base_url);
                if (typeof data.model === 'string') setModel(data.model);
            })
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to fetch AI config:', err);
            });
    }, []);

    // Model registry + (for Local) live Ollama probe -- Product-wave Task 5,
    // items 1 + 4. Refetches whenever the Cloud/Local toggle changes (e.g.
    // "on switching to Local", per the brief); NOT on every `baseUrl`
    // keystroke, to avoid re-probing on each character typed.
    const fetchModels = useCallback((forBackend: KbBackend, forBaseUrl: string) => {
        const params = new URLSearchParams({ backend: forBackend });
        if (forBackend === 'local' && forBaseUrl.trim()) params.set('base_url', forBaseUrl.trim());
        fetch(`/api/ai/models?${params.toString()}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data: ModelsResponse | null) => {
                if (!data || !Array.isArray(data.models)) return;
                setModelOptions(data.models);
                setOllamaReachable(typeof data.ollamaReachable === 'boolean' ? data.ollamaReachable : null);
            })
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to fetch model list:', err);
            });
    }, []);

    useEffect(() => {
        fetchModels(backend, baseUrl);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch on backend switch only, not every baseUrl keystroke
    }, [backend, fetchModels]);

    // Once the option list is known, decide whether the currently-drafted
    // `model` is one of the curated/live ids (select mode) or needs the
    // "Custom…" free-text fallback -- covers both a genuinely custom saved
    // model AND the moment right after switching backends, before the user
    // has picked anything for the new backend's list.
    useEffect(() => {
        if (modelOptions.length === 0) return;
        setCustomMode(!modelOptions.some((m) => m.id === model));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the OPTION LIST changes, not on every `model` edit (that would fight the custom text input)
    }, [modelOptions]);

    const handleToggleEnabled = () => {
        const next = !enabled;
        setEnabled(next); // optimistic — matches `syncReadToPhone`'s toggle idiom elsewhere in Settings
        setEnabledSaving(true);
        fetch('/api/ai/enabled', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
        })
            .then((res) => {
                if (!res.ok) setEnabled(!next); // roll back on failure
            })
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to save KB enabled state:', err);
                setEnabled(!next);
            })
            .finally(() => setEnabledSaving(false));
    };

    const handleBackendChange = (next: KbBackend) => {
        setBackend(next);
        setTestResult(null);
    };

    const handleModelSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        if (value === CUSTOM_MODEL_VALUE) {
            setCustomMode(true);
            return;
        }
        setCustomMode(false);
        setModel(value);
    };

    const handleSave = () => {
        setSaving(true);
        setSaved(false);
        setSaveWarningNoteKey(null);
        setSaveErrorKey(null);
        fetch('/api/ai/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backend, base_url: baseUrl, model }),
        })
            .then(async (res) => {
                const data: unknown = await res.json().catch(() => null);
                if (res.ok) {
                    setSaved(true);
                    const tier = (data as { tier?: ModelTier } | null)?.tier;
                    const noteKey = (data as { noteKey?: string | null } | null)?.noteKey;
                    if (tier && tier !== 'recommended' && noteKey) setSaveWarningNoteKey(noteKey);
                    return;
                }
                const body = data as { detail?: { code?: string } } | { code?: string } | null;
                const code =
                    body && typeof body === 'object' && 'detail' in body
                        ? body.detail?.code
                        : (body as { code?: string } | null)?.code;
                setSaveErrorKey(errorMessageKey(code ?? 'unknown'));
            })
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to save AI config:', err);
                setSaveErrorKey(errorMessageKey('network'));
            })
            .finally(() => setSaving(false));
    };

    const handleTest = () => {
        setTesting(true);
        setTestResult(null);
        fetch('/api/ai/config/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backend, base_url: baseUrl, model }),
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((data: ConfigTestResponse | null) => setTestResult(data))
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Config test failed:', err);
                setTestResult({ ok: false, verdict: 'network', latencyMs: 0 });
            })
            .finally(() => setTesting(false));
    };

    const handleCopyPullCommand = () => {
        void navigator.clipboard?.writeText(`ollama pull ${model}`).catch(() => {
            // Clipboard unavailable — the command is still visible to copy by hand.
        });
    };

    const handleDetectHardware = () => {
        setDetecting(true);
        fetch('/api/ai/hardware-suggestion')
            .then((res) => (res.ok ? res.json() : null))
            .then((data: HardwareSuggestionResponse | null) => setHwResult(data))
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to detect hardware:', err);
                setHwResult(null);
            })
            .finally(() => setDetecting(false));
    };

    const handleUseSuggestion = () => {
        if (!hwResult?.suggestion.local_model) return;
        setBackend('local');
        setModel(hwResult.suggestion.local_model);
    };

    const gpuLabel = hwResult?.hardware.gpu ?? '—';
    const vramLabel = hwResult?.hardware.vram_gb != null ? String(hwResult.hardware.vram_gb) : '—';
    const canUseSuggestion = !!(hwResult && hwResult.suggestion.recommended === 'local' && hwResult.suggestion.local_model);
    const targetLabel = hwResult
        ? canUseSuggestion
            ? `${t('settings.kbBackendLocal')} · ${hwResult.suggestion.local_model}`
            : t('settings.kbBackendCloud')
        : '';
    const suggestionText = hwResult
        ? t('settings.kbSuggestion', { gpu: gpuLabel, vram: vramLabel, target: targetLabel })
        : '';

    const selectedModelInfo = modelOptions.find((m) => m.id === model);

    return (
        // No own top divider: Settings wraps this in a titled "AI assistant"
        // section that already provides the separation.
        <div className="space-y-3">
            {/* Enable switch — top of the KB settings section (Task 3 item 1) */}
            <div>
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">{t('settings.kbEnabled')}</label>
                    <button
                        type="button"
                        onClick={handleToggleEnabled}
                        disabled={enabledSaving}
                        role="switch"
                        aria-checked={enabled}
                        aria-label={t('settings.kbEnabled')}
                        className={`relative w-12 h-6 rounded-full transition-colors disabled:opacity-50 ${
                            enabled ? 'bg-blue-400' : 'bg-gray-300'
                        }`}
                    >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            enabled ? 'translate-x-7' : 'translate-x-1'
                        }`} />
                    </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">{t('settings.kbEnabledDesc')}</p>
            </div>

            <label className="block text-sm font-medium text-gray-700">{t('settings.kbBackend')}</label>

            {/* Cloud / Local toggle */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => handleBackendChange('cloud')}
                    aria-pressed={backend === 'cloud'}
                    className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        backend === 'cloud'
                            ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                >
                    {t('settings.kbBackendCloud')}
                </button>
                <button
                    type="button"
                    onClick={() => handleBackendChange('local')}
                    aria-pressed={backend === 'local'}
                    className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        backend === 'local'
                            ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                >
                    {t('settings.kbBackendLocal')}
                </button>
            </div>

            {/* Local-only: Ollama reachability banner (Task 5, item 4) */}
            {backend === 'local' && ollamaReachable === false && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 space-y-0.5">
                    <p>{t('settings.kbOllamaUnreachable')}</p>
                    <p>{t('settings.kbOllamaInstallHint')}</p>
                </div>
            )}

            {/* Model — curated select + "Custom…" escape hatch (Task 5, item 1) */}
            <div>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="kb-model-select">
                    {t('settings.kbModel')}
                </label>
                <select
                    id="kb-model-select"
                    value={customMode ? CUSTOM_MODEL_VALUE : model}
                    onChange={handleModelSelectChange}
                    aria-label={t('settings.kbModel')}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    {modelOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                            {opt.id} — {t(`settings.kbModelTier.${opt.tier}`)}
                            {opt.installed === false ? ` (${t('settings.kbModelNotInstalled')})` : ''}
                        </option>
                    ))}
                    <option value={CUSTOM_MODEL_VALUE}>{t('settings.kbCustomModel')}</option>
                </select>

                {customMode && (
                    <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={t('settings.kbCustomModelPlaceholder')}
                        aria-label={t('settings.kbCustomModelPlaceholder')}
                        className="mt-1.5 w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                )}

                {/* Tier badge + note for the currently-selected model */}
                {selectedModelInfo && (
                    <div className="mt-1.5 flex items-start gap-1.5">
                        <span
                            className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${TIER_BADGE_CLASSES[selectedModelInfo.tier]}`}
                        >
                            {t(`settings.kbModelTier.${selectedModelInfo.tier}`)}
                        </span>
                        {selectedModelInfo.noteKey && (
                            <p className="text-xs text-gray-500">
                                {t(`settings.kbModelNote.${selectedModelInfo.noteKey}`)}
                            </p>
                        )}
                    </div>
                )}

                {/* "ollama pull <model>" copyable hint when the selected local model isn't installed yet */}
                {backend === 'local' && selectedModelInfo?.installed === false && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500">
                        <span>{t('settings.kbModelNotInstalled')}</span>
                        <code className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-700">
                            ollama pull {model}
                        </code>
                        <button
                            type="button"
                            onClick={handleCopyPullCommand}
                            aria-label={t('settings.kbCopyPullCommand')}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                        >
                            <Copy className="w-3 h-3" />
                        </button>
                    </div>
                )}
            </div>

            {/* Base URL — Local only */}
            {backend === 'local' && (
                <div>
                    <label className="block text-xs text-gray-500 mb-1">{t('settings.kbBaseUrl')}</label>
                    <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="http://localhost:11434/v1"
                        aria-label={t('settings.kbBaseUrl')}
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-400 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50"
                >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {t('common.save')}
                </button>
                <button
                    type="button"
                    onClick={handleTest}
                    disabled={testing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                >
                    {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {testing ? t('settings.kbTesting') : t('settings.kbTest')}
                </button>
                {saved && !saveWarningNoteKey && <span className="text-xs text-green-600">{t('common.done')}</span>}
            </div>

            {saveWarningNoteKey && (
                <p className="text-xs text-amber-600">{t(`settings.kbModelNote.${saveWarningNoteKey}`)}</p>
            )}
            {saveErrorKey && <p className="text-xs text-red-600">{t(saveErrorKey)}</p>}

            {testResult && (
                <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-amber-600'}`}>
                    {t(testVerdictKey(testResult.verdict))}
                    {testResult.latencyMs > 0 && ` (${t('settings.kbTestLatency', { ms: testResult.latencyMs })})`}
                </p>
            )}

            {/* Usage meter (Task 5, item 3) — same "~N questions left today" the composer shows. */}
            <UsageMeter />

            {/* Hardware suggestion helper */}
            <div className="pt-2 border-t border-gray-100">
                <button
                    type="button"
                    onClick={handleDetectHardware}
                    disabled={detecting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50"
                >
                    {detecting && <Loader2 className="w-3 h-3 animate-spin" />}
                    {t('settings.kbDetectHardware')}
                </button>
                {hwResult && (
                    <div className="mt-2 text-xs text-gray-600 space-y-1">
                        {canUseSuggestion ? (
                            <button
                                type="button"
                                onClick={handleUseSuggestion}
                                className="text-left text-blue-700 hover:text-blue-900 underline decoration-dotted"
                            >
                                {suggestionText}
                            </button>
                        ) : (
                            <p>{suggestionText}</p>
                        )}
                        <p className="text-gray-400">{hwResult.suggestion.reason}</p>
                    </div>
                )}
            </div>
        </div>
    );
};
