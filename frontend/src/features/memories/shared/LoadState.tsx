import React from 'react';
import { Button } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';

interface LoadStateProps {
    status: 'loading' | 'error';
    onRetry: () => void;
}

/** A Memories view's loading line, or its gentle error with a retry (never an endless spinner). */
export const LoadState: React.FC<LoadStateProps> = ({ status, onRetry }) => {
    const { t } = useTranslation();
    if (status === 'loading') {
        return (
            <div role="status" aria-busy="true" className="flex flex-1 items-center justify-center p-6 text-small text-muted">
                {t('common.loading')}
            </div>
        );
    }
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-small text-secondary">{t('memories.common.loadError')}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>{t('memories.common.retry')}</Button>
        </div>
    );
};
