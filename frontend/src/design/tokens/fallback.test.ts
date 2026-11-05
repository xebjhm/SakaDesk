import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FALLBACK_ACTION_COLOR, groupRoles } from './index';

const SRC = path.resolve(__dirname, '../..');
const FILES = [
    'core/media/VoicePlayer.tsx',
    'core/media/TranscribeButton.tsx',
    'core/media/TranscriptPanel.tsx',
    'core/common/TranslateButton.tsx',
];

describe('media accent fallback', () => {
    it('is the neutral default action colour (6-digit hex, safe for alpha suffixes)', () => {
        expect(FALLBACK_ACTION_COLOR).toBe(groupRoles('default').action);
        expect(FALLBACK_ACTION_COLOR).toMatch(/^#[0-9a-f]{6}$/);
    });

    it.each(FILES)('%s no longer hard-codes the old Hinatazaka accent', (rel) => {
        const source = readFileSync(path.join(SRC, rel), 'utf-8');
        expect(source.toLowerCase()).not.toContain('#6da0d4');
        expect(source).toContain('FALLBACK_ACTION_COLOR');
    });
});
