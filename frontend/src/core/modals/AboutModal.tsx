import { useState, useRef } from 'react';
import { X, Heart } from 'lucide-react';

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
    onOpenDiagnostics: () => void;
}

export function AboutModal({ isOpen, onClose, onOpenDiagnostics }: AboutModalProps) {
    // Hidden dev mode (5-click easter egg on version)
    const [versionClickCount, setVersionClickCount] = useState(0);
    const versionClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
                    <h3 className="text-lg font-bold text-gray-800">About</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 flex flex-col items-center text-center">
                    {/* Logo placeholder */}
                    <div className="w-20 h-20 bg-gradient-to-br from-blue-400 to-purple-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                        <span className="text-3xl text-white font-bold">H</span>
                    </div>

                    {/* App name */}
                    <h1 className="text-xl font-bold text-gray-800 mb-1">HakoDesk</h1>

                    {/* Version - plain text, secretly clickable */}
                    <p
                        onClick={handleVersionClick}
                        className="text-sm text-gray-400 mb-6 cursor-text select-none"
                    >
                        Version 0.1.0
                    </p>

                    {/* Description */}
                    <p className="text-sm text-gray-600 mb-6">
                        A desktop companion for viewing your Message archives.
                    </p>

                    {/* Made with love */}
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span>Made with</span>
                        <Heart className="w-3 h-3 text-red-400 fill-red-400" />
                        <span>by xtorker</span>
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
