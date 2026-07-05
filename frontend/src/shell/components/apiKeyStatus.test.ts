import { describe, it, expect } from 'vitest';
import { apiKeyStatus } from './apiKeyStatus';

describe('apiKeyStatus', () => {
    it('is "none" when no provider is configured', () => {
        expect(apiKeyStatus({ provider: null, hasApiKey: false, hasInput: false })).toBe('none');
    });

    it('is "saved" when a provider is set and a key is stored', () => {
        expect(apiKeyStatus({ provider: 'gemini', hasApiKey: true, hasInput: false })).toBe('saved');
    });

    it('is "missing" when a provider is set but no key is stored (the desync case)', () => {
        expect(apiKeyStatus({ provider: 'gemini', hasApiKey: false, hasInput: false })).toBe('missing');
    });

    it('is "editing" while the user is typing a new key (defer both saved and missing hints)', () => {
        expect(apiKeyStatus({ provider: 'gemini', hasApiKey: false, hasInput: true })).toBe('editing');
        expect(apiKeyStatus({ provider: 'gemini', hasApiKey: true, hasInput: true })).toBe('editing');
    });
});
