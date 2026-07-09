// frontend/src/features/ai/components/SuggestedQuestions.tsx
import React from 'react';
import { useTranslation } from '../../../i18n';

/** One chip per fan-question taxonomy category that works today (temporal
 * `latest`, aggregation, events, nickname `meta`, preferences) -- the media
 * category is deliberately absent until captions/transcripts are indexed.
 * See docs/superpowers/specs/2026-07-03-fan-question-taxonomy.md. */
const CATEGORY_KEYS = ['latest', 'agg', 'event', 'meta', 'pref'] as const;

interface SuggestedQuestionsProps {
    /** Called with the (localized) template question. The caller fills the
     * composer rather than sending -- the ○○/△△ placeholders need a real
     * member name, and a template ask must never burn cloud quota. */
    onPick: (question: string) => void;
}

export const SuggestedQuestions: React.FC<SuggestedQuestionsProps> = ({ onPick }) => {
    const { t } = useTranslation();
    return (
        <div
            data-testid="ai-suggested-questions"
            className="flex flex-col items-center gap-2"
        >
            <p className="text-xs text-gray-400">{t('ai.suggested.title')}</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
                {CATEGORY_KEYS.map((key) => {
                    const question = t(`ai.suggested.${key}`);
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onPick(question)}
                            className="text-xs px-3 py-1.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                        >
                            {question}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
