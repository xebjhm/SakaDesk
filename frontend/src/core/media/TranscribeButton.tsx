import React from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranscribeButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    /** Error message to display when state is 'error' */
    error?: string | null;
    /** Accent color for button border/text (service theme) */
    accentColor?: string;
    /** 'light' for dark backgrounds (media viewer), 'dark' for light backgrounds (chat bubble) */
    variant?: 'light' | 'dark';
}

/**
 * Transcription trigger button with loading/idle/error states.
 * Hidden when state is 'done' (transcript panel takes over).
 */
export const TranscribeButton: React.FC<TranscribeButtonProps> = ({
    state,
    onClick,
    error,
    accentColor = '#6da0d4',
    variant = 'dark',
}) => {
    const { t } = useTranslation();

    if (state === 'done') return null;

    const isLight = variant === 'light';

    if (state === 'loading') {
        return (
            <div className="flex items-center gap-2 text-xs py-1" style={{ color: isLight ? 'rgba(255,255,255,0.6)' : accentColor }}>
                <Loader2 className="w-3 h-3 animate-spin" />
                {t('transcription.transcribing')}
            </div>
        );
    }

    return (
        <div>
            <button
                onClick={onClick}
                className="text-xs py-1 px-2 rounded-md border transition-colors flex items-center gap-1"
                style={{
                    color: state === 'error'
                        ? (isLight ? '#fca5a5' : '#ef4444')
                        : (isLight ? 'rgba(255,255,255,0.7)' : accentColor),
                    borderColor: state === 'error'
                        ? (isLight ? 'rgba(239,68,68,0.3)' : '#fca5a540')
                        : (isLight ? 'rgba(255,255,255,0.15)' : `${accentColor}40`),
                    background: state === 'error'
                        ? (isLight ? 'rgba(239,68,68,0.08)' : '#fef2f208')
                        : (isLight ? 'rgba(255,255,255,0.06)' : `${accentColor}08`),
                }}
                type="button"
            >
                {state === 'error' ? t('transcription.failed') : t('transcription.transcribe')}
            </button>
            {state === 'error' && error && (
                <p className="text-[10px] mt-0.5 max-w-[250px]" style={{
                    color: isLight ? '#fca5a5' : '#94a3b8',
                }}>
                    {error}
                </p>
            )}
        </div>
    );
};
