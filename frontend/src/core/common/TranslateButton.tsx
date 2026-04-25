import React from 'react';
import { Loader2, Globe } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranslateButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    /** Error message to display when state is 'error' */
    error?: string | null;
    accentColor?: string;
    /** 'light' for dark backgrounds, 'dark' for light backgrounds (default) */
    variant?: 'light' | 'dark';
    /**
     * When state === 'done', render this label as a confirmation pill
     * instead of hiding the component. Used e.g. by blog which wants a
     * persistent "✓ translated" badge next to the post header.
     */
    doneLabel?: string;
}

/**
 * Translation trigger button with loading/idle/error states.
 * Hidden when state is 'done' unless a `doneLabel` is supplied.
 */
export const TranslateButton: React.FC<TranslateButtonProps> = ({
    state,
    onClick,
    error,
    accentColor = '#6da0d4',
    variant = 'dark',
    doneLabel,
}) => {
    const { t } = useTranslation();
    const isLight = variant === 'light';

    if (state === 'done') {
        if (!doneLabel) return null;
        return (
            <span
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border"
                style={{
                    borderColor: isLight ? 'rgba(255,255,255,0.15)' : `${accentColor}40`,
                    color: isLight ? 'rgba(255,255,255,0.6)' : '#6b7280',
                    background: isLight ? 'rgba(255,255,255,0.06)' : `${accentColor}08`,
                }}
            >
                {doneLabel}
            </span>
        );
    }

    const isLoading = state === 'loading';
    const isError = state === 'error';
    const palette = buttonPalette(isError, isLight, accentColor);
    const label = isLoading
        ? t('translation.translating')
        : isError
            ? t('translation.error.failed')
            : t('translation.translate');

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
                    borderColor: palette.border,
                    color: palette.text,
                    background: palette.background,
                }}
            >
                {isLoading
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Globe className="w-3 h-3" />
                }
                <span>{label}</span>
            </button>
            {isError && error && (
                <p
                    className="text-[10px] mt-0.5 max-w-[250px]"
                    style={{ color: isLight ? '#fca5a5' : '#94a3b8' }}
                >
                    {error}
                </p>
            )}
        </div>
    );
};

function buttonPalette(isError: boolean, isLight: boolean, accentColor: string) {
    if (isError) {
        return isLight
            ? { border: 'rgba(239,68,68,0.3)', text: '#fca5a5', background: 'rgba(239,68,68,0.08)' }
            : { border: '#fca5a540',            text: '#ef4444', background: '#fef2f208' };
    }
    return isLight
        ? { border: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)' }
        : { border: `${accentColor}40`,        text: accentColor,            background: `${accentColor}08` };
}
