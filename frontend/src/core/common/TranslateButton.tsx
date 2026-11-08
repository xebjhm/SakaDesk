import React from 'react';
import { Loader2, Languages, Globe, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranslateButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    /** Error message to display when state is 'error' */
    error?: string | null;
    /** 'light' for dark backgrounds, 'dark' for light backgrounds (default) */
    variant?: 'light' | 'dark';
    /**
     * When state === 'done', render this label as a confirmation pill
     * instead of hiding the component. Used e.g. by blog which wants a
     * persistent "✓ translated" badge next to the post header.
     */
    doneLabel?: string;
    /**
     * When set (with `doneLabel`), the done pill becomes a show/hide toggle for
     * the translated content; `expanded` drives its chevron and aria-expanded.
     */
    onToggleExpanded?: () => void;
    expanded?: boolean;
    /**
     * Render only the "文A" language icon (chat bubbles); the label becomes the
     * accessible name and tooltip. Without it the button keeps its text label (blog reader).
     */
    iconOnly?: boolean;
}

/**
 * Translation trigger button with loading/idle/error states.
 * Hidden when state is 'done' unless a `doneLabel` is supplied.
 */
export const TranslateButton: React.FC<TranslateButtonProps> = ({
    state,
    onClick,
    error,
    variant = 'dark',
    doneLabel,
    onToggleExpanded,
    expanded = false,
    iconOnly = false,
}) => {
    const { t } = useTranslation();
    const errorId = React.useId();
    const isLight = variant === 'light';

    if (state === 'done') {
        if (!doneLabel) return null;
        // Dark variant is neutral (owner decision 2026-11-08): no group accent.
        const pillStyle = isLight
            ? { borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)' }
            : undefined;
        const pillTone = isLight ? '' : 'border-subtle text-secondary';
        if (onToggleExpanded) {
            const Chevron = expanded ? ChevronDown : ChevronRight;
            return (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
                    aria-expanded={expanded}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors hover:opacity-80 ${pillTone}`}
                    style={pillStyle}
                >
                    <Chevron className="w-3 h-3" />
                    <span>{doneLabel}</span>
                </button>
            );
        }
        return (
            <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border ${pillTone}`}
                style={pillStyle}
            >
                {doneLabel}
            </span>
        );
    }

    const isLoading = state === 'loading';
    const isError = state === 'error';
    const neutral = !isError && !isLight;
    const palette = neutral ? undefined : buttonPalette(isError, isLight);
    const label = isLoading
        ? t('translation.translating')
        : isError
            ? t('translation.error.failed')
            : t('translation.translate');

    if (iconOnly) {
        return (
            <div>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!isLoading) onClick();
                    }}
                    disabled={isLoading}
                    aria-label={label}
                    aria-describedby={isError && error ? errorId : undefined}
                    title={isError && error ? `${label}: ${error}` : label}
                    className={`flex h-6 w-6 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait ${
                        isError ? 'text-semantic-danger hover:opacity-80' : 'text-secondary hover:text-primary'
                    }`}
                >
                    {isLoading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : isError
                            ? <AlertCircle className="h-4 w-4" />
                            : <Languages className="h-4 w-4" />
                    }
                </button>
                {/* Screen-reader-only: in-flow text would widen the shrink-0 trailing column */}
                {isError && error && <span id={errorId} className="sr-only">{error}</span>}
            </div>
        );
    }

    return (
        <div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isLoading) onClick();
                }}
                disabled={isLoading}
                className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors disabled:cursor-wait ${
                    neutral ? 'border-subtle text-secondary hover:text-primary' : 'hover:opacity-80'
                }`}
                style={palette && {
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

/** Inline palette for the error state and the light variant; the dark idle/loading look is neutral classes. */
function buttonPalette(isError: boolean, isLight: boolean) {
    if (isError) {
        return isLight
            ? { border: 'rgba(239,68,68,0.3)', text: '#fca5a5', background: 'rgba(239,68,68,0.08)' }
            : { border: '#fca5a540',            text: '#ef4444', background: '#fef2f208' };
    }
    return { border: 'rgba(255,255,255,0.15)', text: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)' };
}
