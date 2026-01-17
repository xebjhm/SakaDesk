import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Palette, Image } from 'lucide-react';
import { cn } from '../lib/utils';
import { BaseModal } from './common';
import type { BaseModalProps } from '../types/modal';
import type { BackgroundSettings } from '../types';
import { DEFAULT_BACKGROUND, loadBackgroundSettings, saveBackgroundSettings } from '../utils';
import { UI_CONSTANTS } from '../config/uiConstants';

interface BackgroundModalProps extends BaseModalProps {
    conversationPath: string;
    onSettingsChange: (settings: BackgroundSettings) => void;
}

export const BackgroundModal: React.FC<BackgroundModalProps> = ({
    isOpen,
    onClose,
    conversationPath,
    onSettingsChange,
}) => {
    const [settings, setSettings] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);
    const [preview, setPreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load settings from localStorage on open
    useEffect(() => {
        if (isOpen && conversationPath) {
            const loaded = loadBackgroundSettings(conversationPath);
            setSettings(loaded);
            setPreview(loaded.imageData || null);
        }
    }, [isOpen, conversationPath]);

    const persistSettings = (newSettings: BackgroundSettings) => {
        setSettings(newSettings);
        saveBackgroundSettings(conversationPath, newSettings);
        onSettingsChange(newSettings);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Check file size
        if (file.size > UI_CONSTANTS.limits.maxImageSizeBytes) {
            alert('Image too large. Please choose an image under 2MB.');
            return;
        }

        // Check file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result as string;
            setPreview(base64);
            persistSettings({
                ...settings,
                type: 'image',
                imageData: base64,
            });
        };
        reader.readAsDataURL(file);
    };

    const handleColorSelect = (color: string) => {
        persistSettings({
            ...settings,
            type: 'color',
            color,
            imageData: undefined,
        });
        setPreview(null);
    };

    const handleOpacityChange = (opacity: number) => {
        persistSettings({
            ...settings,
            opacity,
        });
    };

    const handleReset = () => {
        setSettings(DEFAULT_BACKGROUND);
        setPreview(null);
        localStorage.removeItem(`bg_settings_${conversationPath}`);
        onSettingsChange(DEFAULT_BACKGROUND);
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Background"
            icon={Palette}
            maxWidth="max-w-md"
            footer={
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 text-gray-600 hover:text-red-600 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                        <Trash2 className="w-4 h-4" />
                        Reset to Default
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        Done
                    </button>
                </div>
            }
        >
            {/* Content */}
            <div className="p-6 space-y-6">
                {/* Preview */}
                <div className="relative">
                    <div
                        className="w-full h-32 rounded-lg border border-gray-200 overflow-hidden flex items-center justify-center"
                        style={{
                            backgroundColor: settings.type === 'color' ? settings.color : DEFAULT_BACKGROUND.color,
                            backgroundImage: preview ? `url(${preview})` : 'none',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            opacity: settings.opacity / 100,
                        }}
                    >
                        {!preview && settings.type === 'default' && (
                            <span className="text-gray-400 text-sm">Preview</span>
                        )}
                    </div>
                </div>

                {/* Upload Image */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Image className="w-4 h-4 inline mr-2" />
                        Custom Image
                    </label>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                    >
                        <Upload className="w-5 h-5" />
                        <span>Upload Image</span>
                    </button>
                    <p className="text-xs text-gray-400 mt-1">Max 2MB. JPG, PNG, GIF supported.</p>
                </div>

                {/* Color Presets */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Palette className="w-4 h-4 inline mr-2" />
                        Solid Color
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {UI_CONSTANTS.backgroundPresets.map((color) => (
                            <button
                                key={color}
                                onClick={() => handleColorSelect(color)}
                                className={cn(
                                    "w-10 h-10 rounded-lg border-2 transition-all",
                                    settings.type === 'color' && settings.color === color
                                        ? "border-blue-500 ring-2 ring-blue-200"
                                        : "border-gray-200 hover:border-gray-400"
                                )}
                                style={{ backgroundColor: color }}
                                title={color}
                            />
                        ))}
                    </div>
                </div>

                {/* Opacity Slider */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Opacity: {settings.opacity}%
                    </label>
                    <input
                        type="range"
                        min="20"
                        max="100"
                        value={settings.opacity}
                        onChange={(e) => handleOpacityChange(Number(e.target.value))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                        <span>20%</span>
                        <span>100%</span>
                    </div>
                </div>
            </div>
        </BaseModal>
    );
};
