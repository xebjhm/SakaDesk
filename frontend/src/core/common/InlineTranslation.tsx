import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface InlineTranslationProps {
    translation: string;
    variant: 'message' | 'blog';
    defaultExpanded?: boolean;
}

/**
 * Collapsible inline translation display.
 *
 * Uses different styles per variant:
 * - 'message': Style G — small muted gray, minimal. Light touch inside bubble.
 * - 'blog': Style F2 — italic + subtle left line. Scannable at scale.
 */
export const InlineTranslation: React.FC<InlineTranslationProps> = ({
    translation,
    variant,
    defaultExpanded = true,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);

    if (!translation) return null;

    const Chevron = expanded ? ChevronDown : ChevronRight;

    if (variant === 'message') {
        // Style G: small muted gray, minimal
        return (
            <div className="mt-2 pt-1.5" style={{ borderTop: '1px dashed #e2e8f0' }}>
                <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className="flex items-center gap-0.5 text-xs py-0.5 text-slate-400"
                    type="button"
                >
                    <Chevron className="w-3 h-3" />
                    {t('translation.translate')}
                </button>
                {expanded && (
                    <div
                        className="text-[13px] leading-relaxed whitespace-pre-wrap mt-0.5"
                        style={{ color: '#6b7280' }}
                    >
                        {translation}
                    </div>
                )}
            </div>
        );
    }

    // Style F2: italic + subtle left line
    return (
        <div className="mt-1 mb-3">
            <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="flex items-center gap-0.5 text-xs py-0.5 text-slate-400"
                type="button"
            >
                <Chevron className="w-3 h-3" />
                {t('translation.translate')}
            </button>
            {expanded && (
                <div
                    className="text-[14px] leading-relaxed whitespace-pre-wrap mt-0.5"
                    style={{
                        color: '#555',
                        fontStyle: 'italic',
                        paddingLeft: 12,
                        borderLeft: '1.5px solid #d1d5db',
                    }}
                >
                    {translation}
                </div>
            )}
        </div>
    );
};
