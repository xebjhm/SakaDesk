import { useEffect, useCallback } from 'react';

/**
 * Hook that provides Escape-to-close and backdrop-click-to-close for any modal.
 * Skips Escape when a fullscreen element is active (browser handles fullscreen exit).
 *
 * Usage:
 * ```tsx
 * const handleBackdropClick = useModalClose(isOpen, onClose);
 * return (
 *     <div className="fixed inset-0 ..." onClick={handleBackdropClick}>
 *         <div onClick={e => e.stopPropagation()}>...content...</div>
 *     </div>
 * );
 * ```
 */
export function useModalClose(isOpen: boolean, onClose: () => void) {
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !document.fullscreenElement) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    return handleBackdropClick;
}
