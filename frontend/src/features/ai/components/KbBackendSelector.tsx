// frontend/src/features/ai/components/KbBackendSelector.tsx
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../../../i18n';

type KbBackend = 'cloud' | 'local';

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

/**
 * `KbBackendSelector` — Settings > AI > Knowledge base backend switch.
 *
 * Loads the current `{backend, base_url, model}` from `GET /api/ai/config`
 * (Plan B Task 5, `backend/api/ai.py`) into local draft state, lets the user
 * flip Cloud <-> Local, edit `model` (and `base_url`, Local only), and PUTs
 * the draft back on Save. Default view is Cloud -- works out of the box for
 * everyone; Local is opt-in and needs a reachable OpenAI-compatible endpoint
 * (e.g. a local Ollama server).
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

    // Draft state, PUT to the backend on Save. Starts as Cloud (the default,
    // pre-fetch view) so there's no flash of a Local-only field before the
    // GET /api/ai/config response arrives.
    const [backend, setBackend] = useState<KbBackend>('cloud');
    const [baseUrl, setBaseUrl] = useState('');
    const [model, setModel] = useState('');

    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const [detecting, setDetecting] = useState(false);
    const [hwResult, setHwResult] = useState<HardwareSuggestionResponse | null>(null);

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

    const handleSave = () => {
        setSaving(true);
        setSaved(false);
        fetch('/api/ai/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backend, base_url: baseUrl, model }),
        })
            .then((res) => {
                if (res.ok) setSaved(true);
            })
            .catch((err: unknown) => {
                console.error('[KbBackendSelector] Failed to save AI config:', err);
            })
            .finally(() => setSaving(false));
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

    return (
        <div className="pt-4 border-t border-gray-100 space-y-3">
            <label className="block text-sm font-medium text-gray-700">{t('settings.kbBackend')}</label>

            {/* Cloud / Local toggle */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setBackend('cloud')}
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
                    onClick={() => setBackend('local')}
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

            {/* Model */}
            <div>
                <label className="block text-xs text-gray-500 mb-1">{t('settings.kbModel')}</label>
                <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    aria-label={t('settings.kbModel')}
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
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

            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-400 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50"
                >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {t('common.save')}
                </button>
                {saved && <span className="text-xs text-green-600">{t('common.done')}</span>}
            </div>

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
