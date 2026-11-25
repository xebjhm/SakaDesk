import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';
import { useInlineBlogTranslations } from './useInlineBlogTranslations';

// Two segments separated by a <br><br> run, as official blog HTML is structured.
const HTML = '<p>今日は晴れ🌸<br><br>ありがとう</p>';

function Harness({ translations, enabled, lang = 'en' }: { translations: string[]; enabled: boolean; lang?: string }) {
    const ref = useRef<HTMLDivElement>(null);
    useInlineBlogTranslations(ref, translations, enabled, lang);
    return <div ref={ref} dangerouslySetInnerHTML={{ __html: HTML }} />;
}

const injected = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('span.blog-translation-inline')).map(s => s.textContent);

describe('useInlineBlogTranslations', () => {
    it('injects one translation after each segment when enabled', () => {
        const { container } = render(<Harness translations={['Sunny today 🌸', 'Thank you']} enabled />);
        expect(injected(container)).toEqual(['Sunny today 🌸', 'Thank you']);
        // Original text is untouched.
        expect(container.textContent).toContain('今日は晴れ🌸');
    });

    it('removes the injected translations when collapsed and restores them when re-expanded', () => {
        // Same array instance across renders, as BlogReader's state provides — so
        // only the `enabled` flip can drive the effect.
        const translations = ['A', 'B'];
        const { container, rerender } = render(<Harness translations={translations} enabled />);
        expect(injected(container)).toHaveLength(2);

        rerender(<Harness translations={translations} enabled={false} />);
        expect(injected(container)).toHaveLength(0);
        expect(container.querySelectorAll('.blog-translation-inline')).toHaveLength(0);

        rerender(<Harness translations={translations} enabled />);
        expect(injected(container)).toEqual(['A', 'B']);
    });

    it('injects nothing without translations', () => {
        const { container } = render(<Harness translations={[]} enabled />);
        expect(injected(container)).toHaveLength(0);
    });

    it('styles the translation line with token classes, not an inline style', () => {
        const { container } = render(<Harness translations={['Sunny today 🌸', 'Thank you']} enabled />);
        const span = container.querySelector('span.blog-translation-inline')!;
        expect(span.getAttribute('style')).toBeNull();
        expect(span).toHaveClass('text-secondary', 'border-strong', 'italic');
    });

    it('marks each line with its language and draws CJK upright', () => {
        const { container } = render(<Harness translations={['今天天氣好🌸', '謝謝']} enabled lang="zh-TW" />);
        const spans = Array.from(container.querySelectorAll('span.blog-translation-inline'));
        expect(spans.map(s => s.getAttribute('lang'))).toEqual(['zh-TW', 'zh-TW']);
        expect(spans[0]).not.toHaveClass('italic');
    });
});
