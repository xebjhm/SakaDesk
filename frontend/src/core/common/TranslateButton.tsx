import React from 'react';
import { Loader2, Globe } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranslateButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    /** Error message to display when state is 'error' */
    error?: string | null;
    accentColor?: string;
}

/**
 * Translation trigger button with loading/idle/error states.
 * Hidden when state is 'done' (inline translation takes over).
 */
export const TranslateButton: React.FC<TranslateButtonProps> = ({
    state,
    onClick,
    error,
    accentColor = '#6da0d4',
}) => {
    const { t } = useTranslation();

    if (state === 'done') return null;

    const isLoading = state === 'loading';
    const isError = state === 'error';

    return (
        <div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isLoading) onClick();
                }}
                disabled={isLoading}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors hover:opacity-80 disabled:cursor-wait"
                style={{
                    borderColor: isError ? '#fca5a540' : `${accentColor}40`,
                    color: isError ? '#ef4444' : accentColor,
                    background: isError ? '#fef2f208' : `${accentColor}08`,
                }}
            >
                {isLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                    <Globe className="w-3 h-3" />
                )}
                <span>
                    {isLoading ? t('translation.translating') : isError ? t('translation.error.failed') : t('translation.translate')}
                </span>
            </button>
            {isError && error && (
                <p className="text-[10px] mt-0.5 max-w-[250px] text-slate-400">
                    {error}
                </p>
            )}
        </div>
    );
};
