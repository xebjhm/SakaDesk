import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Palette, Image } from 'lucide-react';
import { cn } from '../../utils/classnames';
import { Modal, Button } from '../../design/primitives';
import type { BaseModalProps } from '../../types/modal';
import type { BackgroundSettings } from '../../types';
import { DEFAULT_BACKGROUND, loadBackgroundSettings, saveBackgroundSettings } from '../../utils';
import { UI_CONSTANTS } from '../../config/uiConstants';
import { useTranslation } from '../../i18n';
import { persisted } from '../persistence/persisted';
import { logDialogLoad } from '../../design/dialog/dialogLog';

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
    const { t } = useTranslation();

    const [settings, setSettings] = useState<BackgroundSettings>(DEFAULT_BACKGROUND);
    const [preview, setPreview] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // A rejected upload's message belongs to that visit: clear it when the dialog closes.
    useEffect(() => {
        if (!isOpen) setUploadError(null);
    }, [isOpen]);

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
        setUploadError(null);
        const file = e.target.files?.[0];
        if (!file) {
            logDialogLoad('background_upload', 'cancelled'); // the picker was dismissed
            return;
        }

        // Check file size
        if (file.size > UI_CONSTANTS.limits.maxImageSizeBytes) {
            setUploadError(t('background.imageTooLarge'));
            logDialogLoad('background_upload', 'skipped', undefined, 'too_large');
            return;
        }

        // Check file type
        if (!file.type.startsWith('image/')) {
            setUploadError(t('background.selectImageFile'));
            logDialogLoad('background_upload', 'skipped', undefined, 'not_image');
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => logDialogLoad('background_upload', 'error');
        reader.onload = () => {
            logDialogLoad('background_upload', 'ok');
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
        persisted.setConv(`bg_settings_${conversationPath}`, { value: null });
        onSettingsChange(DEFAULT_BACKGROUND);
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t('background.title')}
            closeLabel={t('common.close')}
            logId="background"
            className="max-w-md"
            bodyClassName="flex flex-col gap-6"
            footer={
                <>
                    <Button variant="ghost" className="mr-auto" onClick={handleReset}>
                        <Trash2 className="h-4 w-4" />
                        {t('background.resetToDefault')}
                    </Button>
                    <Button variant="primary" onClick={onClose}>{t('common.done')}</Button>
                </>
            }
        >
            {/* Preview: the user's chosen colour or image is data (spec decision 26). */}
            <div
                className="flex h-32 w-full items-center justify-center overflow-hidden rounded-card shadow-card"
                style={{
                    backgroundColor: settings.type === 'color' ? settings.color : DEFAULT_BACKGROUND.color,
                    backgroundImage: preview ? `url(${preview})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    opacity: settings.opacity / 100,
                }}
            >
                {!preview && settings.type === 'default' && <span className="text-small text-muted">{t('common.preview')}</span>}
            </div>

            <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-small font-semibold text-secondary">
                    <Image className="h-4 w-4" />
                    {t('background.customImage')}
                </h3>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4" />
                    {t('background.uploadImage')}
                </Button>
                <p className="text-caption text-muted">{t('background.uploadHint')}</p>
                {uploadError && <p role="alert" className="text-small text-status-danger">{uploadError}</p>}
            </section>

            <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-small font-semibold text-secondary">
                    <Palette className="h-4 w-4" />
                    {t('background.solidColor')}
                </h3>
                <div className="flex flex-wrap gap-2">
                    {UI_CONSTANTS.backgroundPresets.map((color) => {
                        const isSelected = settings.type === 'color' && settings.color === color;
                        return (
                            <button
                                key={color}
                                type="button"
                                onClick={() => handleColorSelect(color)}
                                aria-pressed={isSelected}
                                title={color}
                                className={cn(
                                    'h-10 w-10 rounded-card shadow-pill transition-shadow duration-fast ease-standard',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-group',
                                    isSelected && 'ring-2 ring-strong ring-offset-2 ring-offset-surface',
                                )}
                                style={{ backgroundColor: color }}
                            />
                        );
                    })}
                </div>
            </section>

            <section className="flex flex-col gap-2">
                <label htmlFor="bg-opacity" className="text-small font-semibold text-secondary">
                    {t('background.opacity', { value: settings.opacity })}
                </label>
                <input
                    id="bg-opacity"
                    type="range"
                    min="20"
                    max="100"
                    value={settings.opacity}
                    onChange={(e) => handleOpacityChange(Number(e.target.value))}
                    className="w-full cursor-pointer accent-group"
                />
                <div className="flex justify-between text-caption text-muted">
                    <span>20%</span>
                    <span>100%</span>
                </div>
            </section>
        </Modal>
    );
};
