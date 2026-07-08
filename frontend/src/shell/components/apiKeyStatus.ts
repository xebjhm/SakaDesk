/**
 * Decide what the Settings -> AI panel should say about the stored API key.
 *
 * The key lives in the OS keyring while the provider/model live in settings.json,
 * so the two can desync: the provider stays "configured" after the key is removed
 * (uninstall cleanup, another instance, a manual clear). When that happens the
 * panel must not stay silent (or, worse, keep showing "saved securely") — it must
 * tell the user the key is missing so they re-enter it.
 */
export type ApiKeyStatus = 'none' | 'saved' | 'missing' | 'editing';

export function apiKeyStatus(params: {
    provider: string | null;
    hasApiKey: boolean;
    hasInput: boolean;
}): ApiKeyStatus {
    if (!params.provider) return 'none';
    // While the user is typing a replacement, don't assert either state.
    if (params.hasInput) return 'editing';
    return params.hasApiKey ? 'saved' : 'missing';
}
