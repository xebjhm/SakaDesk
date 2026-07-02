// frontend/src/features/ai/components/CitationChip.tsx
import React from 'react';
import { BookOpen, MessageSquare } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { navigateToSource } from '../../../utils/navigateToSource';
import { formatDateTime } from '../../../utils/classnames';
import { formatName } from '../../../utils/nameFormatters';
import type { AskCitation } from '../api';

interface CitationChipProps {
    citation: AskCitation;
}

/**
 * Small inline pill rendered after a cited sentence in the AI chat answer.
 * Clicking it deep-links the app to the exact blog post or message the
 * citation quotes, via the same shared `navigateToSource` util search
 * results use (Task 7) — same styling family as `SearchFilterBar`'s chips.
 */
export const CitationChip: React.FC<CitationChipProps> = ({ citation }) => {
    const { t } = useTranslation();
    const Icon = citation.ref.type === 'blog' ? BookOpen : MessageSquare;
    const memberName = formatName(citation.member);
    const timestamp = formatDateTime(citation.timestamp);

    return (
        <button
            type="button"
            onClick={() => navigateToSource(citation.ref)}
            title={citation.snippet}
            aria-label={`${t('ai.sourceLabel')}: ${memberName} · ${timestamp}`}
            className="inline-flex items-center gap-1 mx-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-white border border-gray-200 text-gray-600 align-middle hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
        >
            <Icon className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[8rem]">{memberName}</span>
            <span className="text-gray-400">{timestamp}</span>
        </button>
    );
};
