import React, { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useCollapseOnOutOfView } from '../../features/messages/hooks/useMessageVisibility';

interface InlineTranslationProps {
    translation: string;
    variant: 'message' | 'blog';
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
 * Uses different styles per variant:
 * - 'message': Style G — small muted gray, minimal. Light touch inside bubble.
 * - 'blog': Style F2 — italic + subtle left line. Scannable at scale.
 */
export const InlineTranslation: React.FC<InlineTranslationProps> = ({
    translation,
    variant,
    defaultExpanded = false,
    onRerun,
    messageId,
}) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(defaultExpanded);

    // Auto-collapse when message leaves the virtualized visible range.
    const collapse = useCallback(() => setExpanded(false), []);
    useCollapseOnOutOfView(messageId, expanded, collapse);

    if (!translation) return null;

    const Chevron = expanded ? ChevronDown : ChevronRight;

    const rerunButton = onRerun && (
        <button
            onClick={(e) => { e.stopPropagation(); onRerun(); }}
            className="p-0.5 rounded hover:opacity-70 transition-opacity text-slate-300"
            type="button"
            title={t('common.refresh')}
        >
            <RefreshCw className="w-3 h-3" />
        </button>
    );

    if (variant === 'message') {
        // Style G: small muted gray, minimal
        return (
            <div className="mt-2 pt-1.5" style={{ borderTop: '1px dashed #e2e8f0' }}>
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        className="flex items-center gap-0.5 text-xs py-0.5 text-slate-400"
                        type="button"
                    >
                        <Chevron className="w-3 h-3" />
                        {t('translation.translate')}
                    </button>
                    {rerunButton}
                </div>
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
            <div className="flex items-center gap-0.5">
                <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className="flex items-center gap-0.5 text-xs py-0.5 text-slate-400"
                    type="button"
                >
                    <Chevron className="w-3 h-3" />
                    {t('translation.translate')}
                </button>
                {rerunButton}
            </div>
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
