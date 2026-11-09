import React from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '../../design/primitives';
import { useTranslation } from '../../i18n';

interface MemoriesHomeProps {
    onOpenRecap: () => void;
}

/** Temporary hub with one entry card; the core wave replaces it. */
export const MemoriesHome: React.FC<MemoriesHomeProps> = ({ onOpenRecap }) => {
    const { t } = useTranslation();
    return (
        <div data-testid="memories-home" className="flex flex-1 items-center justify-center p-6">
            <Card className="p-0">
                <button
                    type="button"
                    onClick={onOpenRecap}
                    className="flex min-w-48 flex-col items-center gap-3 rounded-card px-8 py-6 text-primary transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    <span aria-hidden="true" className="flex rounded-full bg-expressive-soft p-4 text-muted [&_svg]:h-8 [&_svg]:w-8">
                        <Sparkles />
                    </span>
                    <span className="font-display text-title">{t('memories.home.recapCard')}</span>
                </button>
            </Card>
        </div>
    );
};
