import React, { useState, useCallback, useEffect } from 'react';
import { ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useCollapseOnOutOfView } from '../../features/messages/hooks/useMessageVisibility';
import { isCjkLanguage, loadLanguageFaces } from '../../design/fonts';
import { cn } from '../../utils/classnames';

interface InlineTranslationProps {
    translation: string;
    variant: 'message' | 'blog';
    /** The translation's language (the target language setting): its glyphs, and upright when CJK. */
    lang?: string;
    defaultExpanded?: boolean;
    /** Called when user clicks the rerun button to re-translate */
    onRerun?: () => void;
    /**
     * Message ID for auto-collapse when scrolled out of the visible range.
     * Omit for non-virtualized usages (modals, blog reader).
     */
    messageId?: number;
}

/**
 * Collapsible inline translation display.
 *
 * - 'message': small muted text under a dashed hairline, a light touch inside the bubble.
 * - 'blog': a left line like the injected blog translation lines, italic only for non-CJK text.
 *
 * Colours are tokens (UI health #12: the toggle was 2.6:1, the re-run icon 1.5:1); the text carries
 * its own `lang` (UI health #10) and that language's faces load when it opens.
 */
export const InlineTranslation: React.FC<InlineTranslationProps> = ({
    translation,
    variant,
    lang,
    defaultExpanded = false,
    onRerun,
    messageId,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Auto-collapse when message leaves the virtualized visible range.
    const collapse = useCallback(() => setExpanded(false), []);
    useCollapseOnOutOfView(messageId, expanded, collapse);

    useEffect(() => {
        if (expanded && lang) loadLanguageFaces(lang);
    }, [expanded, lang]);

    if (!translation) return null;

    const Chevron = expanded ? ChevronDown : ChevronRight;
    const upright = isCjkLanguage(lang);

    const header = (
        <div className="flex items-center gap-0.5">
            <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                aria-expanded={expanded}
                className="flex items-center gap-0.5 rounded-xs py-0.5 text-caption text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                type="button"
            >
                <Chevron aria-hidden="true" className="h-3 w-3" />
                {t('translation.translate')}
            </button>
            {onRerun && (
                <button
                    onClick={(e) => { e.stopPropagation(); onRerun(); }}
                    className="rounded-xs p-0.5 text-muted transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    type="button"
                    title={t('translation.rerun')}
                    aria-label={t('translation.rerun')}
                >
                    <RefreshCw aria-hidden="true" className="h-3 w-3" />
                </button>
            )}
        </div>
    );

    if (variant === 'message') {
        return (
            <div className="mt-2 border-t border-dashed border-subtle pt-1.5">
                {header}
                {expanded && (
                    <div lang={lang} className="mt-0.5 whitespace-pre-wrap break-words text-small leading-relaxed text-muted">
                        {translation}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="mb-3 mt-1">
            {header}
            {expanded && (
                <div
                    lang={lang}
                    className={cn('mt-0.5 whitespace-pre-wrap break-words border-l-2 border-strong pl-3 text-body leading-relaxed text-secondary', !upright && 'italic')}
                >
                    {translation}
                </div>
            )}
        </div>
    );
};
