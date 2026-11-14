import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '../../i18n';
import { color } from '../../design/tokens/color';
import { groupAccent } from '../../design/tokens/accent';
import { contrastRatio } from '../../design/contrast';
import { TranscriptPanel } from './TranscriptPanel';

const segments = [
    { start: 0, end: 2, text: 'おはよう', confidence: 0.9 },
    { start: 2, end: 4, text: 'ございます', confidence: 0.9 },
];
const GROUPS = ['hinatazaka', 'sakurazaka', 'nogizaka', 'yodel'] as const;

/** Resolve the token text-colour class on an element to its hex for a group. */
function textHex(el: Element, group: (typeof GROUPS)[number]): string {
    const cls = Array.from(el.classList);
    if (cls.includes('text-accent-tonal')) return groupAccent(group).tonalText;
    if (cls.includes('text-primary')) return color.text.primary;
    if (cls.includes('text-secondary')) return color.text.secondary;
    if (cls.includes('text-muted')) return color.text.muted;
    throw new Error(`no token text colour on: ${cls.join(' ')}`);
}

/** The 8 % accent tint the active line draws over a surface. */
function tinted(bg: string, accent: string): string {
    const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [a, b] = [p(bg), p(accent)];
    return `#${a.map((v, i) => Math.round(v * 0.92 + b[i] * 0.08).toString(16).padStart(2, '0')).join('')}`;
}

describe('TranscriptPanel text contrast on light surfaces (>= 4.5:1)', () => {
    beforeAll(async () => {
        await i18n.changeLanguage('en');
        Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    });
    afterAll(() => {
        delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
    });

    it.each(GROUPS)('every text role clears 4.5:1 on white, sunken, elevated and the %s tint', (group) => {
        const a = groupAccent(group);
        const surfaces = [color.surface.card, color.surface.sunken, color.surface.elevated, a.subtle];
        // Active line at t=0 (accent timestamp, primary text); idle line at 2.5s beats a different row.
        const { container } = render(<TranscriptPanel segments={segments} currentTime={0} onSeek={vi.fn()} onRerun={vi.fn()} defaultExpanded variant="dark" />);
        const active = screen.getByRole('button', { name: /おはよう/ });
        const idle = screen.getByRole('button', { name: /ございます/ });
        const roles: Array<[string, Element, boolean]> = [
            ['toggle', screen.getByRole('button', { name: /Voice Content/ }), false],
            ['rerun icon', screen.getByRole('button', { name: /re-?transcribe|rerun/i }), false],
            ['active timestamp', active.children[0], true],
            ['active text', active.children[1], true],
            ['idle timestamp', idle.children[0], false],
            ['idle text', idle.children[1], false],
            ['hint', container.querySelector('.text-right') as Element, false],
        ];
        for (const [name, el, onTint] of roles) {
            const fg = textHex(el, group);
            for (const bg of surfaces) {
                const ratio = contrastRatio(fg, onTint ? tinted(bg, a.accent) : bg) as number;
                expect(ratio, `${name} ${fg} on ${bg} (${group})`).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('noSpeech note is on a token that clears 4.5:1 on the lightest tints', () => {
        render(<TranscriptPanel segments={[]} noSpeech onRerun={vi.fn()} variant="dark" />);
        const note = screen.getByText('Voice Content').parentElement as Element;
        for (const group of GROUPS) {
            for (const bg of [color.surface.card, color.surface.sunken, groupAccent(group).subtle]) {
                expect(contrastRatio(textHex(note, group), bg) as number).toBeGreaterThanOrEqual(4.5);
            }
        }
    });
});
