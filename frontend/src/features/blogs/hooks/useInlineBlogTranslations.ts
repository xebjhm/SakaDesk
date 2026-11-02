import { useEffect, type RefObject } from 'react';

/**
 * Inject blog translations into the rendered post DOM — immersive style.
 * Walks the <p> child nodes, finds the same <br>-run boundaries used during
 * extraction, and inserts translation text + <br> after each segment. Uses only
 * inline elements and <br> to avoid breaking the <p> flow. Injected nodes are
 * removed when `enabled` turns false (collapsed) or the translations change.
 *
 * @param containerRef Element holding the sanitized post HTML.
 * @param translations One translation per text segment, in order.
 * @param enabled Whether translations are currently shown (expanded).
 */
export function useInlineBlogTranslations(
    containerRef: RefObject<HTMLElement | null>,
    translations: string[],
    enabled: boolean,
): void {
    useEffect(() => {
        const container = containerRef.current;
        if (!container || translations.length === 0 || !enabled) return;

        // Remove previous injections
        container.querySelectorAll('.blog-translation-inline').forEach(el => el.remove());

        const root = container.querySelector('p') ?? container;
        const nodes = Array.from(root.childNodes);

        let segmentIndex = 0;
        let brCount = 0;
        let hasText = false;

        let lastContentNode: ChildNode | null = null;

        const injectTranslation = (afterNode: ChildNode, text: string) => {
            // Insert: <br><span class="blog-translation-inline" style="D">text</span>
            const br = document.createElement('br');
            br.className = 'blog-translation-inline';
            const span = document.createElement('span');
            span.className = 'blog-translation-inline';
            span.style.cssText = `
                color: #555;
                font-style: italic;
                font-size: 14px;
                line-height: 1.65;
                padding-left: 12px;
                border-left: 1.5px solid #d1d5db;
                display: inline-block;
            `;
            span.textContent = text;
            const ref = afterNode.nextSibling;
            root.insertBefore(br, ref);
            root.insertBefore(span, ref);
        };

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            if (node.nodeName === 'BR') {
                brCount++;
                if (brCount >= 2 && hasText && lastContentNode) {
                    // End of a segment — inject translation right after the
                    // last text node (before the <br> spacing run)
                    const translation = translations[segmentIndex];
                    if (translation) {
                        injectTranslation(lastContentNode, translation);
                    }
                    segmentIndex++;
                    hasText = false;
                    lastContentNode = null;
                }
            } else {
                brCount = 0;
                const text = node.textContent?.trim();
                if (text) {
                    hasText = true;
                    lastContentNode = node;
                }
            }
        }

        // Flush final segment
        if (hasText && lastContentNode && segmentIndex < translations.length) {
            const translation = translations[segmentIndex];
            if (translation) {
                injectTranslation(lastContentNode, translation);
            }
        }

        return () => {
            container.querySelectorAll('.blog-translation-inline').forEach(el => el.remove());
        };
    }, [containerRef, translations, enabled]);
}
