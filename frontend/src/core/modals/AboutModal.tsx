import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Heart } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { useModalClose } from '../common/useModalClose';

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenDiagnostics: () => void;
}

/** A single floating heart that animates upward and fades out. */
interface FloatingHeart {
    id: number;
    x: number; // horizontal offset in px from the heart icon center
}

export function AboutModal({ isOpen, onClose, onOpenDiagnostics }: AboutModalProps) {
    const { t } = useTranslation();
    const handleBackdropClick = useModalClose(isOpen, onClose);

    // Hidden dev mode (5-click easter egg on version)
    const [versionClickCount, setVersionClickCount] = useState(0);
    const versionClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const setGoldenFingerActive = useAppStore(s => s.setGoldenFingerActive);

    // Golden finger: 5 heart clicks in 2 seconds
    const heartClickCount = useRef(0);
    const heartClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [floatingHearts, setFloatingHearts] = useState<FloatingHeart[]>([]);
    const heartIdCounter = useRef(0);
    const [toastMessage, setToastMessage] = useState<string | null>(null);
    const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const heartAnimTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    // Cleanup all timers on unmount
    useEffect(() => {
        return () => {
            if (heartClickTimeout.current) clearTimeout(heartClickTimeout.current);
            if (toastTimeout.current) clearTimeout(toastTimeout.current);
            if (versionClickTimeout.current) clearTimeout(versionClickTimeout.current);
            heartAnimTimeouts.current.forEach(clearTimeout);
        };
    }, []);


    const showToast = useCallback((message: string) => {
        if (toastTimeout.current) clearTimeout(toastTimeout.current);
        setToastMessage(message);
        toastTimeout.current = setTimeout(() => setToastMessage(null), 2000);
    }, []);

    const handleHeartClick = useCallback(() => {
        // Spawn a floating heart with random horizontal offset
        const id = ++heartIdCounter.current;
        const x = (Math.random() - 0.5) * 40; // -20px to +20px
        setFloatingHearts(prev => [...prev, { id, x }]);
        // Remove after animation completes (800ms)
        const animTimer = setTimeout(() => {
            setFloatingHearts(prev => prev.filter(h => h.id !== id));
            heartAnimTimeouts.current.delete(animTimer);
        }, 800);
        heartAnimTimeouts.current.add(animTimer);

        // Track clicks for easter egg
        heartClickCount.current += 1;

        if (heartClickTimeout.current) {
            clearTimeout(heartClickTimeout.current);
        }

        if (heartClickCount.current >= 5) {
            heartClickCount.current = 0;
            const newState = !goldenFingerActive;
            setGoldenFingerActive(newState);
            showToast(newState
                ? t('about.goldenFingerEnabled')
                : t('about.goldenFingerDisabled')
            );
        } else {
            // Reset after 2 seconds of no clicks
            heartClickTimeout.current = setTimeout(() => {
                heartClickCount.current = 0;
            }, 2000);
        }
    }, [goldenFingerActive, setGoldenFingerActive, showToast, t]);

    const handleVersionClick = () => {
        if (versionClickTimeout.current) {
            clearTimeout(versionClickTimeout.current);
        }

        const newCount = versionClickCount + 1;
        setVersionClickCount(newCount);

        if (newCount >= 5) {
            setVersionClickCount(0);
            onClose();
            onOpenDiagnostics();
        } else {
            versionClickTimeout.current = setTimeout(() => {
                setVersionClickCount(0);
            }, 2000);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={handleBackdropClick}>
            <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800">{t('about.title')}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 flex flex-col items-center text-center">
                    {/* Logo — wrapper handles rounding/shadow/overflow to avoid subpixel gap */}
                    <div className="w-20 h-20 rounded-2xl shadow-lg mb-4 overflow-hidden">
                        <img
                            src="/logo-192.png"
                            alt="HakoDesk"
                            className="w-full h-full select-none"
                        />
                    </div>

                    {/* App name */}
                    <h1 className="text-xl font-bold text-gray-800 mb-1">HakoDesk</h1>

                    {/* Version - plain text, secretly clickable */}
                    <p
                        onClick={handleVersionClick}
                        className="text-sm text-gray-400 mb-6 cursor-text select-none"
                    >
                        {t('about.version', { version: '0.1.0' })}
                    </p>

                    {/* Description */}
                    <div className="mb-6 space-y-1">
                        <p className="text-sm text-gray-400">
                            {t('about.identity')}
                        </p>
                        <p className="text-sm text-gray-600">
                            {t('about.features')}
                        </p>
                    </div>

                    {/* Made with love — heart is the golden finger trigger */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span>{t('about.madeWith')}</span>
                        <button
                            onClick={handleHeartClick}
                            className="relative focus:outline-none cursor-default"
                            aria-label="heart"
                        >
                            <Heart
                                className="w-3 h-3 text-red-400 fill-red-400 transition-transform active:scale-125"
                                style={goldenFingerActive ? { animation: 'heartbeat 1.2s ease-in-out infinite' } : undefined}
                            />
                            {/* Floating hearts animation */}
                            {floatingHearts.map(heart => (
                                <Heart
                                    key={heart.id}
                                    className="absolute w-3 h-3 text-red-400 fill-red-400 pointer-events-none"
                                    style={{
                                        left: `calc(50% + ${heart.x}px)`,
                                        bottom: '100%',
                                        transform: 'translateX(-50%)',
                                        animation: 'heartFloat 0.8s ease-out forwards',
                                    }}
                                />
                            ))}
                        </button>
                        <span>{t('about.by')} xtorker</span>
                    </div>

                    {/* Toast message */}
                    {toastMessage && (
                        <div className="mt-3 px-3 py-1.5 bg-gray-800 text-white text-xs rounded-full animate-fade-in">
                            {toastMessage}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                    <a
                        href="https://github.com/xtorker/HakoDesk"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
                    >
                        github.com/xtorker/HakoDesk
                    </a>
                </div>
            </div>

            {/* Keyframe for floating hearts */}
            <style>{`
                @keyframes heartFloat {
                    0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
                    100% { opacity: 0; transform: translateX(-50%) translateY(-30px) scale(1.3); }
                }
                @keyframes heartbeat {
                    0%, 100% { transform: scale(1); }
                    15% { transform: scale(1.3); }
                    30% { transform: scale(1); }
                    45% { transform: scale(1.2); }
                    60% { transform: scale(1); }
                }
                .animate-fade-in {
                    animation: fadeIn 0.2s ease-out;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
