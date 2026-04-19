import React from 'react';
import { Loader2, Globe } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface TranslateButtonProps {
    state: 'idle' | 'loading' | 'done' | 'error';
    onClick: () => void;
    accentColor?: string;
}

export const TranslateButton: React.FC<TranslateButtonProps> = ({
    state,
    onClick,
    accentColor = '#6da0d4',
}) => {
    const { t } = useTranslation();

    if (state === 'done') return null;

    const isLoading = state === 'loading';

    return (
        <button
            onClick={(e) => {
                e.stopPropagation();
                if (!isLoading) onClick();
            }}
            disabled={isLoading}
            className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-colors hover:opacity-80 disabled:cursor-wait"
            style={{
                borderColor: `${accentColor}40`,
                color: accentColor,
                background: `${accentColor}08`,
            }}
        >
            {isLoading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
                <Globe className="w-3 h-3" />
            )}
            <span>
                {isLoading ? t('translation.translating') : t('translation.translate')}
            </span>
        </button>
    );
};
