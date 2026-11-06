import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../../store/appStore';
import { Atmosphere, Modal } from '../../design/primitives';
import { cn } from '../../utils/classnames';
import { useArchiveStats } from './archiveStats';

declare const __APP_VERSION__: string;

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
    const { t, i18n } = useTranslation();

    // Hidden dev mode (5-click easter egg on version)
    const [versionClickCount, setVersionClickCount] = useState(0);
    const versionClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const goldenFingerActive = useAppStore(s => s.goldenFingerActive);
    const setGoldenFingerActive = useAppStore(s => s.setGoldenFingerActive);

    const appVersion = __APP_VERSION__;

    // "Your archive" (spec §9): loaded each time About opens; hidden if it fails.
    const archive = useArchiveStats(isOpen);
    const statsId = useId();
    const totals = archive.status === 'ready' ? archive.stats : null;
    const statValue = (n: number | undefined) => (totals && n !== undefined ? n.toLocaleString(i18n.language) : '—');
    const statItems = [
        { key: 'messages', label: t('about.statMessages'), value: statValue(totals?.messages) },
        { key: 'photos', label: t('about.statPhotos'), value: statValue(totals?.photos) },
        { key: 'days', label: t('about.statDays'), value: statValue(totals?.days) },
    ];

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

    return (
        <Modal scope="brand" isOpen={isOpen} onClose={onClose} title={t('about.title')} closeLabel={t('common.close')} logId="about" className="max-w-sm"
            footer={
                <a href="https://github.com/xebjhm/SakaDesk" target="_blank" rel="noopener noreferrer"
                    className="w-full rounded-pill py-2 text-center text-small text-secondary transition-colors duration-fast ease-standard hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                    github.com/xebjhm/SakaDesk
                </a>
            }
        >
            <div className="flex flex-col items-center text-center">
                {/* Hero (spec §9, decision D8): the brand orbs behind the logo and the display
                    wordmark, bled to the dialog edges under the aurora header. */}
                <Atmosphere className="-mx-6 -mt-4 self-stretch">
                    <div data-testid="about-hero" className="flex flex-col items-center px-6 pb-6 pt-8">
                        <div className="mb-4 h-20 w-20 overflow-hidden rounded-xl shadow-card">
                            <img src="/logo-192.png" alt="SakaDesk" className="h-full w-full select-none" />
                        </div>
                        <h3 className="font-display text-display font-bold text-primary">SakaDesk</h3>
                        {/* Plain text that is secretly clickable (5 clicks: diagnostics). */}
                        <p onClick={handleVersionClick} className="cursor-text select-none text-small text-muted">
                            {appVersion ? t('about.version', { version: appVersion }) : ' '}
                        </p>
                    </div>
                </Atmosphere>

                {archive.status !== 'error' && (
                    <section data-testid="about-stats" aria-labelledby={statsId} className="mb-6 w-full">
                        <h4 id={statsId} className="mb-2 text-caption font-semibold text-muted">{t('about.archiveTitle')}</h4>
                        <dl className="grid grid-cols-3 gap-2">
                            {statItems.map((item) => (
                                <div key={item.key} className="flex flex-col items-center gap-1 rounded-lg bg-elevated px-2 py-3">
                                    <dt className="order-2 text-caption text-muted">{item.label}</dt>
                                    <dd className="order-1 font-display text-heading font-semibold tabular-nums text-primary">{item.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                )}

                <div className="mb-6 flex flex-col gap-1">
                    <p className="text-small text-muted">{t('about.identity')}</p>
                    <p className="text-small text-secondary">{t('about.features')}</p>
                </div>
                <div className="flex items-center gap-1 text-caption text-muted">
                    <span>{t('about.madeWith')}</span>
                    <button type="button" onClick={handleHeartClick} aria-label={t('about.madeWithLove')} className="relative cursor-default focus:outline-none">
                        <Heart className={cn('h-3 w-3 fill-current text-heart transition-transform active:scale-125', goldenFingerActive && 'animate-heartbeat motion-reduce:animate-none')} />
                        {floatingHearts.map((heart) => (
                            <Heart
                                key={heart.id}
                                aria-hidden="true"
                                className="pointer-events-none absolute bottom-full h-3 w-3 fill-current text-heart animate-heart-float motion-reduce:hidden"
                                style={{ left: `calc(50% + ${heart.x}px)` }}
                            />
                        ))}
                    </button>
                    <span>{t('about.by')} xebjhm</span>
                </div>
                {toastMessage && (
                    <div role="status" className="mt-3 rounded-pill bg-toast px-3 py-1 text-caption text-viewer animate-reveal motion-reduce:animate-none">
                        {toastMessage}
                    </div>
                )}
            </div>
        </Modal>
    );
}
