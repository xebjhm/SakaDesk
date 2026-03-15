import React from 'react';
import { RefreshCw } from 'lucide-react';

interface ModalLoadingStateProps {
    /** Optional message to display below the spinner */
    message?: string;
}

/**
 * Standardized loading state for modals.
 * Displays a centered spinning indicator with optional message.
 */
export const ModalLoadingState: React.FC<ModalLoadingStateProps> = ({ message }) => (
    <div className="flex flex-col items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        {message && (
            <p className="mt-3 text-sm text-gray-500">{message}</p>
        )}
    </div>
);

interface ModalErrorStateProps {
    /** Error message to display */
    error: string;
    /** Callback fired when retry button is clicked */
    onRetry?: () => void;
    /** Custom retry button text. Defaults to 'Retry' */
    retryText?: string;
}

/**
 * Standardized error state for modals.
 * Displays an error message with optional retry button.
 */
export const ModalErrorState: React.FC<ModalErrorStateProps> = ({
    error,
    onRetry,
    retryText = 'Retry',
}) => (
    <div className="bg-red-50 text-red-700 p-4 rounded-lg text-center">
        <p className="text-sm">{error}</p>
        {onRetry && (
            <button
                onClick={onRetry}
                className="mt-2 text-sm text-red-600 hover:text-red-800 hover:underline font-medium"
            >
                {retryText}
            </button>
        )}
    </div>
);

interface ModalEmptyStateProps {
    /** Icon component to display */
    icon: React.ElementType;
    /** Primary message */
    message: string;
    /** Optional secondary message/hint */
    hint?: string;
}

/**
 * Standardized empty state for modals.
 * Displays when there's no content to show.
 */
export const ModalEmptyState: React.FC<ModalEmptyStateProps> = ({
    icon: Icon,
    message,
    hint,
}) => (
    <div className="text-center py-12 text-gray-500">
        <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
            <Icon className="w-8 h-8 text-gray-300" />
        </div>
        <p>{message}</p>
        {hint && (
            <p className="text-sm text-gray-400 mt-1">{hint}</p>
        )}
    </div>
);
