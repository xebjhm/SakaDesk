import React from 'react';
import { Spinner } from '../../design/primitives';
import { useTranslation } from '../../i18n';

interface TranscribeButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    /** Error message to display when state is 'error' */
    error?: string | null;
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
    variant = 'dark',
}) => {
    const { t } = useTranslation();

    if (state === 'done') return null;

    const isLight = variant === 'light';

    if (state === 'loading') {
        return (
            <div
                className={`flex items-center gap-2 text-xs py-1 ${isLight ? '' : 'text-secondary'}`}
                style={isLight ? { color: 'rgba(255,255,255,0.6)' } : undefined}
            >
                <Spinner size="sm" tone="current" decorative />
                {t('transcription.transcribing')}
            </div>
        );
    }

    const neutral = state !== 'error' && !isLight;

    return (
        <div>
            <button
                onClick={onClick}
                className={`text-xs py-1 px-2 rounded-sm border transition-colors flex items-center gap-1 ${
                    neutral ? 'border-subtle text-secondary hover:text-primary' : ''
                }`}
                style={neutral ? undefined : {
                    color: state === 'error'
                        ? (isLight ? '#fca5a5' : '#ef4444')
                        : 'rgba(255,255,255,0.7)',
                    borderColor: state === 'error'
                        ? (isLight ? 'rgba(239,68,68,0.3)' : '#fca5a540')
                        : 'rgba(255,255,255,0.15)',
                    background: state === 'error'
                        ? (isLight ? 'rgba(239,68,68,0.08)' : '#fef2f208')
                        : 'rgba(255,255,255,0.06)',
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
