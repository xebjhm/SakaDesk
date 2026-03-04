import React from 'react';
import { X, Download } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

interface PhotoDetailModalProps {
    src: string;
    alt?: string;
    onClose: () => void;
}

export const PhotoDetailModal: React.FC<PhotoDetailModalProps> = ({ src, alt, onClose }) => {
    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = src;
        link.download = src.split('/').pop() || 'photo.jpg';
        link.click();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
            <button className="absolute top-4 right-4 text-white/70 hover:text-white z-10" onClick={onClose}>
                <X className="w-6 h-6" />
            </button>
            <img
                src={src}
                alt={alt || 'Photo'}
                className="max-w-[90vw] max-h-[90vh] object-contain"
                onClick={(e) => e.stopPropagation()}
            />
            {goldenFingerActive && (
                <button
                    onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                    className="absolute bottom-6 right-6 px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm flex items-center gap-2 backdrop-blur-sm transition-colors"
                >
                    <Download className="w-4 h-4" />
                    Download
                </button>
            )}
        </div>
    );
};
