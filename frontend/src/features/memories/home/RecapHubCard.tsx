import React from 'react';
import { Sparkles } from 'lucide-react';
import { Button, Card, Spinner } from '../../../design/primitives';
import { useTranslation } from '../../../i18n';
import { HUB_CARD_BUTTON, HUB_CARD_STILL, HubCardFace } from './HubEntryCard';

/**
 * The recap card: the shelf is still loading (nothing clickable), failed (retry),
 * has nothing open yet (closed), or opens a year (partial while that year is still running).
 */
export type RecapCardState =
    | { kind: 'loading' }
    | { kind: 'failed' }
    | { kind: 'closed' }
    | { kind: 'open'; year: number; partial: boolean };

interface RecapHubCardProps {
    recap: RecapCardState;
    onOpenRecap: (year: number) => void;
    onRetry: () => void;
}

const CardFace: React.FC<{ sub: React.ReactNode }> = ({ sub }) => {
    const { t } = useTranslation();
    return <HubCardFace icon={Sparkles} title={t('memories.home.recapCard')} sub={sub} />;
};

/**
 * The hub's year-recap card (R1/R9). The card names the
 * year it opens ("{year}年の、ここまで" while that year is still running). While the
 * shelf of yearbooks loads it is a neutral, non-interactive card with a labelled `Spinner`; if the shelf fails
 * it offers a retry; before Dec 1 with no past year on the shelf it is a quiet card
 * saying when it opens.
 */
export const RecapHubCard: React.FC<RecapHubCardProps> = ({ recap, onOpenRecap, onRetry }) => {
    const { t } = useTranslation();
    const quiet = HUB_CARD_STILL;
    let body: React.ReactNode;
    if (recap.kind === 'open') {
        body = (
            <button
                type="button"
                onClick={() => onOpenRecap(recap.year)}
                className={HUB_CARD_BUTTON}
            >
                <CardFace sub={recap.partial ? t('recap.entry.partial', { year: recap.year }) : t('recap.entry.year', { year: recap.year })} />
            </button>
        );
    } else if (recap.kind === 'loading') {
        body = (
            // The Spinner is the status (named by its visible label, static under reduced motion).
            <div data-testid="memories-recap-loading" aria-busy="true" className={quiet}>
                <CardFace sub={<Spinner size="sm" tone="muted" label={t('common.loading')} labelVisibility="always" />} />
            </div>
        );
    } else if (recap.kind === 'failed') {
        body = (
            <div data-testid="memories-recap-failed" role="alert" className={quiet}>
                <CardFace
                    sub={(
                        <span className="flex flex-col items-center gap-2">
                            <span>{t('recap.entry.loadFailed')}</span>
                            <Button variant="secondary" size="sm" onClick={onRetry}>{t('common.retry')}</Button>
                        </span>
                    )}
                />
            </div>
        );
    } else {
        body = (
            <div data-testid="memories-recap-closed" className={quiet}>
                <CardFace sub={t('memories.home.opensOn')} />
            </div>
        );
    }
    return <Card className="h-full p-0">{body}</Card>;
};
