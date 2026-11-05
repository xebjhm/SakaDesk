import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The pre-token media parts mix their accent in inline styles. A hex suffix (`${accent}40`)
// breaks with a CSS variable, so the accent must go through withAlpha() and default to the context.
const FILES = ['VoicePlayer.tsx', 'TranscriptPanel.tsx', 'TranscribeButton.tsx', '../common/TranslateButton.tsx'];

describe.each(FILES)('%s', (file) => {
    const source = readFileSync(path.resolve(__dirname, file), 'utf-8');
    it('defaults its accent to the context (var(--ds-accent))', () => {
        expect(source).toMatch(/accentColor = ACCENT\b|DEFAULT_ACCENT_COLOR = ACCENT\b/);
        expect(source).not.toMatch(/FALLBACK_ACTION_COLOR/);
    });
    it('never appends a hex alpha to the accent', () => {
        expect(source).not.toMatch(/\$\{accentColor\}[0-9a-fA-F]{2}/);
    });
});

describe('transcript segments', () => {
    it('are marked as Japanese content', () => {
        const source = readFileSync(path.resolve(__dirname, 'TranscriptPanel.tsx'), 'utf-8');
        expect(source).toMatch(/<span\s+lang="ja"/);
    });
});
