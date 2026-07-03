// frontend/src/features/ai/components/CloudConsentModal.tsx
import React from 'react';
import { Cloud } from 'lucide-react';
import { useTranslation } from '../../../i18n';
import { useModalClose } from '../../../core/common/useModalClose';

export interface CloudConsentModalProps {
    isOpen: boolean;
    /** The provider name to name explicitly in the privacy copy (e.g. "Google") --
     * derived from the configured cloud `base_url` by the caller. */
    provider: string;
    /** Persists consent (`POST /api/ai/consent`) and sends the question that
     * triggered this modal. */
    onAccept: () => void;
    /** Leaves consent unset and the triggering question UNSENT. */
    onDecline: () => void;
}

/**
 * `CloudConsentModal` — one-time cloud-privacy disclosure shown before the
 * FIRST cloud ask (Product-wave Task 5, item 5): "your question and
 * excerpts of your synced content are sent to <provider>". Declining closes
 * the modal without sending anything; the backend enforces the same gate
 * independently (`cloud_consent_required` SSE error), so a stale/raced
 * frontend state can never actually leak a question.
 */
export const CloudConsentModal: React.FC<CloudConsentModalProps> = ({
    isOpen,
    provider,
    onAccept,
    onDecline,
}) => {
    const { t } = useTranslation();
    const handleBackdropClick = useModalClose(isOpen, onDecline);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={handleBackdropClick}
        >
            <div
                className="bg-white rounded-xl max-w-md w-full shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="bg-gray-900 px-6 py-4 flex items-center gap-3">
                    <Cloud className="w-5 h-5 text-blue-400" />
                    <h3 className="text-lg font-bold text-white">{t('ai.cloudConsent.title')}</h3>
                </div>

                <div className="p-6 space-y-5">
                    <p className="text-sm text-gray-600 leading-relaxed">
                        {t('ai.cloudConsent.body', { provider })}
                    </p>

                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onDecline}
                            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            {t('ai.cloudConsent.decline')}
                        </button>
                        <button
                            type="button"
                            onClick={onAccept}
                            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                        >
                            {t('ai.cloudConsent.accept')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
