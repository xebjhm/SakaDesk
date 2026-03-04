import { useState, useRef } from 'react';
import { X, Heart } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenDiagnostics: () => void;
}

export function AboutModal({ isOpen, onClose, onOpenDiagnostics }: AboutModalProps) {
    const { t } = useTranslation();

    // Hidden dev mode (5-click easter egg on version)
    const [versionClickCount, setVersionClickCount] = useState(0);
    const versionClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const setGoldenFingerActive = useAppStore(s => s.setGoldenFingerActive);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleLogoPointerDown = () => {
        longPressTimer.current = setTimeout(() => {
            setGoldenFingerActive(!goldenFingerActive);
            longPressTimer.current = null;
        }, 3000);
    };

    const handleLogoPointerUp = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    const handleVersionClick = () => {
        // Clear previous timeout
        if (versionClickTimeout.current) {
            clearTimeout(versionClickTimeout.current);
        }

        const newCount = versionClickCount + 1;
        setVersionClickCount(newCount);

        if (newCount >= 5) {
            // Easter egg triggered!
            setVersionClickCount(0);
            onClose();
            onOpenDiagnostics();
        } else {
            // Reset after 2 seconds of no clicks
            versionClickTimeout.current = setTimeout(() => {
                setVersionClickCount(0);
            }, 2000);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100">
                    <h3 className="text-lg font-bold text-gray-800">{t('about.title')}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 flex flex-col items-center text-center">
                    {/* Logo placeholder */}
                    <div
                        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 shadow-lg select-none"
                        onPointerDown={handleLogoPointerDown}
                        onPointerUp={handleLogoPointerUp}
                        onPointerLeave={handleLogoPointerUp}
                        style={goldenFingerActive ? {
                            background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FF8C00 100%)',
                            boxShadow: '0 0 20px rgba(255, 215, 0, 0.4)',
                        } : {
                            background: 'linear-gradient(to bottom right, #60A5FA, #A855F7)',
                        }}
                    >
                        <span className="text-3xl text-white font-bold">H</span>
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
                    <p className="text-sm text-gray-600 mb-6">
                        {t('about.description')}
                    </p>

                    {/* Made with love */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span>{t('about.madeWith')}</span>
                        <Heart className="w-3 h-3 text-red-400 fill-red-400" />
                        <span>{t('about.by')} xtorker</span>
                    </div>
                </div>

                {/* Footer - future sponsor button area */}
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
        </div>
    );
}
