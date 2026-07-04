import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    variant?: 'warning' | 'danger' | 'default';
    onConfirm: () => void;
    onCancel: () => void;
}

const CONFIRM_BTN: Record<NonNullable<ConfirmDialogProps['variant']>, string> = {
    warning: 'bg-amber-500 hover:bg-amber-600',
    danger: 'bg-red-500 hover:bg-red-600',
    default: 'bg-blue-400 hover:bg-blue-500',
};

/**
 * App-styled confirmation dialog (replaces the browser-native window.confirm).
 * Matches the SakaDesk modal language: gradient header + rounded card. Renders
 * above other modals (z-[60]).
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    message,
    confirmLabel,
    cancelLabel,
    variant = 'default',
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation();
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
        >
            <div
                className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="bg-gradient-to-r from-[#b4dcff] to-[#f0bede] px-6 py-4">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="w-6 h-6 text-white" />
                        <h3 className="text-lg font-bold text-white">{title}</h3>
                    </div>
                </div>
                <div className="p-6 space-y-5">
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{message}</p>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 transition-colors"
                        >
                            {cancelLabel ?? t('common.cancel')}
                        </button>
                        <button
                            onClick={onConfirm}
                            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${CONFIRM_BTN[variant]}`}
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
