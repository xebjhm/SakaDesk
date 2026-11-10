import React from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '../../design/primitives';
import { useTranslation } from '../../i18n';

/** What the recap card opens: a year (partial while that year is still running), or nothing yet. */
export type RecapCardState = { year: number; partial: boolean } | null;

interface MemoriesHomeProps {
    recap: RecapCardState;
    onOpenRecap: (year: number) => void;
}

const CardFace: React.FC<{ sub: string }> = ({ sub }) => {
    const { t } = useTranslation();
    return (
        <>
            <span aria-hidden="true" className="flex rounded-full bg-expressive-soft p-4 text-muted [&_svg]:h-8 [&_svg]:w-8">
                <Sparkles />
            </span>
            <span className="font-display text-title">{t('memories.home.recapCard')}</span>
            <span className="text-small text-secondary">{sub}</span>
        </>
    );
};

/**
 * Temporary hub with one entry card; the core wave replaces it. The card names the
 * year it opens ("{year}年の、ここまで" while that year is still running); before
 * Dec 1 with no past year on the shelf it is a quiet card saying when it opens.
 */
export const MemoriesHome: React.FC<MemoriesHomeProps> = ({ recap, onOpenRecap }) => {
    const { t } = useTranslation();
    return (
        <div data-testid="memories-home" className="flex flex-1 items-center justify-center p-6">
            <Card className="p-0">
                {recap ? (
                    <button
                        type="button"
                        onClick={() => onOpenRecap(recap.year)}
                        className="flex min-w-48 flex-col items-center gap-3 rounded-card px-8 py-6 text-primary transition-shadow hover:shadow-accent-glow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        <CardFace sub={recap.partial ? t('recap.entry.partial', { year: recap.year }) : t('recap.entry.year', { year: recap.year })} />
                    </button>
                ) : (
                    <div data-testid="memories-recap-closed" className="flex min-w-48 flex-col items-center gap-3 px-8 py-6 text-primary">
                        <CardFace sub={t('memories.home.opensOn')} />
                    </div>
                )}
            </Card>
        </div>
    );
};
