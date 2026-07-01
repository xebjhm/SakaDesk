import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from '../../i18n';
import { copyImageToClipboard, copyVideoToClipboard } from '../../utils/clipboard';

/**
 * Hook that registers a window-level Ctrl+C listener to copy the current
 * media item to the clipboard. Returns toast state for the consuming component.
 *
 * Uses window.addEventListener so the shortcut works regardless of which
 * child element has focus (e.g., VideoPlayer controls, VoicePlayer buttons).
 *
 * Only active when goldenFingerActive is true and a media item is provided.
 */
export function useClipboardShortcut(
    mediaSrc: string | undefined,
    mediaType: 'picture' | 'video' | 'voice' | undefined,
) {
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const { t } = useTranslation();

    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToastMessage(message);
        toastTimeout.current = setTimeout(() => setToastMessage(null), 2000);
    }, []);

    // Cleanup toast timer on unmount
    useEffect(() => {
        return () => {
            if (toastTimeout.current) clearTimeout(toastTimeout.current);
        };
    }, []);

    // Window-level Ctrl+C listener
    useEffect(() => {
        if (!goldenFingerActive || !mediaSrc || !mediaType) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'c') {
                if (mediaType === 'picture') {
                    e.preventDefault();
                    copyImageToClipboard(mediaSrc)
                        .then(() => showToast(t('about.goldenFingerCopied')))
                        .catch(() => showToast(t('about.goldenFingerCopyFailed')));
                } else if (mediaType === 'video') {
                    e.preventDefault();
                    copyVideoToClipboard(mediaSrc)
                        .then(() => showToast(t('about.goldenFingerCopied')))
                        .catch(() => showToast(t('about.goldenFingerCopyFailed')));
                }
                // TODO: add voice clipboard support
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [goldenFingerActive, mediaSrc, mediaType, showToast, t]);

    return { toastMessage };
}
