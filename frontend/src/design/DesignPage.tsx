/**
 * Dev-only living style page (`?view=design`). Shows every token and every
 * primitive state for the selected group. Never shipped: main.tsx loads it
 * only behind `import.meta.env.DEV`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, MessageCircle, Newspaper, Search, Settings, X } from 'lucide-react';
import { SUPPORTED_LANGUAGES, useTranslation, type SupportedLanguage } from '../i18n';
import { serviceThemes } from '../config/serviceThemes';
import { cn } from '../utils/classnames';
import { BrandScope } from './brandScope';
import { applyGroupTokens } from './applyTokens';
import { groupTokenVars } from './cssVars';
import { contrastRatio } from './contrast';
import { GROUP_IDS, SCALE_STEPS, brandInk, color, groupRoles, groupTokens, radius, shadow, typeScale, type GroupId, type RadiusStep, type ShadowStep, type TypeStep } from './tokens';
import {
    Atmosphere, Avatar, Badge, Button, Canvas, Card, CelebrationToast, EmptyState, MilestoneCard, DatePill, IconButton, Input, Menu, MenuItem, MenuSeparator, Modal, Pill, RailItem, Select, Sheet, Switch,
} from './primitives';

// Full class names so Tailwind's scanner generates them.
const RADIUS_CLASS: Record<RadiusStep, string> = {
    none: 'rounded-none', xs: 'rounded-xs', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg', xl: 'rounded-xl', full: 'rounded-full',
    tail: 'rounded-tail', card: 'rounded-card', sheet: 'rounded-sheet', pill: 'rounded-pill',
};
const SHADOW_CLASS: Record<ShadowStep, string> = {
    none: 'shadow-none', pill: 'shadow-pill', card: 'shadow-card', sheet: 'shadow-sheet',
};
const TYPE_CLASS: Record<TypeStep, string> = {
    caption: 'text-caption', small: 'text-small', body: 'text-body', title: 'text-title', heading: 'text-heading', display: 'font-display text-display', reading: 'text-reading',
};

const SEMANTIC_BANNER = {
    success: 'flex items-center gap-3 rounded-md border border-semantic-success bg-semantic-success-subtle px-4 py-2',
    warning: 'flex items-center gap-3 rounded-md border border-semantic-warning bg-semantic-warning-subtle px-4 py-2',
    danger: 'flex items-center gap-3 rounded-md border border-semantic-danger bg-semantic-danger-subtle px-4 py-2',
    info: 'flex items-center gap-3 rounded-md border border-semantic-info bg-semantic-info-subtle px-4 py-2',
} as const;
const SEMANTIC_ICON = {
    success: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-success bg-semantic-success-icon text-caption font-bold text-semantic-success',
    warning: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-warning bg-semantic-warning-icon text-caption font-bold text-semantic-warning',
    danger: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-danger bg-semantic-danger-icon text-caption font-bold text-semantic-danger',
    info: 'flex h-6 w-6 items-center justify-center rounded-full border border-semantic-info bg-semantic-info-icon text-caption font-bold text-semantic-info',
} as const;
const SEMANTIC_TEXT = {
    success: 'text-small font-semibold text-semantic-success',
    warning: 'text-small font-semibold text-semantic-warning',
    danger: 'text-small font-semibold text-semantic-danger',
    info: 'text-small font-semibold text-semantic-info',
} as const;
const CONTEXTS = ['brand', ...GROUP_IDS] as const;

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <section className="flex flex-col gap-4">
        <h2 className="text-heading font-semibold text-primary">{title}</h2>
        {children}
    </section>
);

const Swatch: React.FC<{ name: string; value: string }> = ({ name, value }) => {
    const { t } = useTranslation();
    const ratio = contrastRatio(value, color.text.inverse);
    return (
        <Card className="flex w-44 flex-col overflow-hidden">
            <div className="h-14" style={{ background: value }} />
            <div className="flex flex-col gap-1 p-3">
                <span className="text-small font-semibold text-primary">{name}</span>
                <span className="break-all text-caption text-muted">{value}</span>
                <span className="text-caption text-secondary">
                    {ratio === null ? t('designPage.contrastNA') : t('designPage.contrast', { ratio: ratio.toFixed(1) })}
                </span>
            </div>
        </Card>
    );
};

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}

export const DesignPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const [context, setContext] = useState<'brand' | GroupId>('hinatazaka');
    const group: GroupId = context === 'brand' ? 'hinatazaka' : context;
    const [replay, setReplay] = useState(0);
    const [filter, setFilter] = useState<'all' | 'unread'>('all');
    const [rail, setRail] = useState<'talk' | 'blog' | 'news'>('talk');
    const [moved, setMoved] = useState(false);
    const [landingKey, setLandingKey] = useState(0);
    const [modalOpen, setModalOpen] = useState(false);
    const [switchOn, setSwitchOn] = useState(true);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuTrigger = useRef<HTMLButtonElement>(null);

    useEffect(() => applyGroupTokens(group), [group]);

    // `?view=design&lang=zh-TW` opens the page in a given UI language.
    useEffect(() => {
        const lang = new URLSearchParams(window.location.search).get('lang');
        if (lang && lang in SUPPORTED_LANGUAGES) void i18n.changeLanguage(lang);
    }, [i18n]);

    const r = groupRoles(group);
    const neutral: Array<[string, string]> = Object.entries(color).filter(([role]) => role !== 'semantic').flatMap(([role, values]) =>
        Object.entries(values as Record<string, string | Record<string, string>>).flatMap(([name, value]): Array<[string, string]> =>
            typeof value === 'string'
                ? [[`${role}.${name}`, value]]
                : Object.entries(value).map(([step, v]): [string, string] => [`${role}.${name}.${step}`, v]),
        ),
    );
    const groupSwatches = [
        ['logo', r.logo], ['action (600)', r.action], ['strong (700)', r.strong], ['subtle (50)', r.subtle],
        ['subtleBorder (200)', r.subtleBorder], ['highlight (100)', r.highlight], ['linkUnderline (300)', r.linkUnderline],
        ['bubbleBorder', r.bubbleBorder], ['glow', r.glow],
        ['title.gradient', `linear-gradient(to right, ${groupTokenVars(group)['--ds-group-title-from']}, ${groupTokenVars(group)['--ds-group-title-via']}, ${groupTokenVars(group)['--ds-group-title-to']})`],
        ['title.text', groupTokenVars(group)['--ds-group-title-text']],
        ['title.bar', groupTokenVars(group)['--ds-group-title-bar']],
        ['canvas', groupTokenVars(group)['--ds-group-canvas']],
        ['ambient.orb1', groupTokenVars(group)['--ds-group-ambient-1']],
        ['ambient.orb2', groupTokenVars(group)['--ds-group-ambient-2']],
        ['ambient.orb3', groupTokenVars(group)['--ds-group-ambient-3']],
    ] as const;

    const body = (
        <>
                <Section title={t('designPage.colors')}>
                    <h3 className="text-title text-secondary">{t('designPage.neutral')}</h3>
                    <div className="flex flex-wrap gap-3">
                        {neutral.map(([name, value]) => <Swatch key={name} name={name} value={value} />)}
                    </div>
                    <h3 className="text-title text-secondary">{t('designPage.groupColors')}</h3>
                    <div className="flex flex-wrap gap-3">
                        {groupSwatches.map(([name, value]) => <Swatch key={name} name={name} value={value} />)}
                    </div>
                    <h3 className="text-title text-secondary">{t('designPage.scale')}</h3>
                    <div className="flex flex-wrap gap-2">
                        {SCALE_STEPS.map((step) => {
                            const value = groupTokens[group].scale[step];
                            const isLogo = value.toLowerCase() === groupTokens[group].logo.toLowerCase();
                            return (
                                <Card key={step} className={cn('flex w-20 flex-col overflow-hidden', isLogo && 'ring-2 ring-accent')}>
                                    <div className="h-10" style={{ background: value }} />
                                    <div className="flex flex-col p-2">
                                        <span className="text-caption font-semibold text-primary">{step}</span>
                                        <span className="text-caption text-muted">{value}</span>
                                        {isLogo && <span className="text-caption text-secondary">{t('designPage.logoStep')}</span>}
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                    <h3 className="text-title text-secondary">{t('designPage.roles')}</h3>
                    <Card className="p-4">
                        <div className="grid grid-cols-3 gap-2 text-small">
                            <span className="font-semibold text-secondary">{t('designPage.roleName')}</span>
                            <span className="font-semibold text-secondary">{t('designPage.roleStep')}</span>
                            <span />
                            {([
                                ['action', 600, r.action], ['strong', 700, r.strong], ['subtle', 50, r.subtle],
                                ['subtleBorder', 200, r.subtleBorder], ['highlight', 100, r.highlight], ['linkUnderline', 300, r.linkUnderline], ['ring', 600, r.ring],
                            ] as const).map(([role, step, value]) => (
                                <React.Fragment key={role}>
                                    <span className="text-primary">{role}</span>
                                    <span className="text-muted">{step}</span>
                                    <span className="h-5 w-12 rounded-pill" style={{ background: value }} />
                                </React.Fragment>
                            ))}
                        </div>
                    </Card>
                    <h3 className="text-title text-secondary">{t('designPage.railLogo')}</h3>
                    <div className="flex items-center gap-4 p-2">
                        <div className="flex h-11 w-11 items-center justify-center rounded-pill bg-card ring-2 ring-group-logo ring-offset-2 shadow-accent-halo">
                            <span className="text-small font-semibold text-accent-strong">{(serviceThemes[group].name || group).slice(0, 1)}</span>
                        </div>
                        <span className="text-small text-muted">ring-group-logo</span>
                    </div>
                </Section>

                <Section title={t('designPage.brand')}>
                    <div className="flex flex-wrap gap-3">
                        {SCALE_STEPS.map((step) => <Swatch key={step} name={`ink ${step}`} value={brandInk[step]} />)}
                    </div>
                    <div className="h-24 rounded-xl bg-aurora" />
                </Section>

                <Section title={t('designPage.semantic')}>
                    {(['success', 'warning', 'danger', 'info'] as const).map((k) => (
                        <div key={k} className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-3">
                                {(['subtle', 'icon', 'border', 'solid', 'text'] as const).map((step) => (
                                    <Swatch key={step} name={`${k} ${step}`} value={color.semantic[k][step]} />
                                ))}
                            </div>
                            <div className={SEMANTIC_BANNER[k]}>
                                <span className={SEMANTIC_ICON[k]}>!</span>
                                <span className={SEMANTIC_TEXT[k]}>{k}</span>
                            </div>
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-3">
                        {(['subtle', 'border', 'solid', 'text'] as const).map((step) => (
                            <Swatch key={step} name={`oshi ${step}`} value={color.semantic.oshi[step]} />
                        ))}
                        <Swatch name="star" value={color.semantic.star} />
                        <Swatch name="console" value={color.console.bg} />
                        <Swatch name="console prompt" value={color.console.prompt} />
                    </div>
                </Section>

                <Section title={t('designPage.buttons')}>
                    <div className="flex flex-wrap items-center gap-3">
                        {(['primary', 'tonal', 'secondary', 'ghost', 'warning', 'danger'] as const).map((v) => <Button key={v} variant={v}>{v}</Button>)}
                        <Button variant="primary" loading>loading</Button>
                        <Button variant="primary" disabledReason={t('designPage.sampleDisabledReason')}>disabled</Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <IconButton variant="accent" aria-label={t('designPage.accent')} icon={<ChevronDown />} />
                        <span className="inline-flex items-center gap-2 rounded-card bg-viewer-stage p-2">
                            <Button variant="overlay" size="sm">{t('designPage.overlay')}</Button>
                            <IconButton variant="overlay" size="sm" aria-label={t('designPage.close')} icon={<X />} />
                        </span>
                        <Button size="sm">{t('designPage.secondary')}</Button>
                        <IconButton aria-label={t('designPage.close')} icon={<X />} />
                        <IconButton aria-label={t('designPage.close')} icon={<Settings />} variant="secondary" size="sm" />
                        <IconButton aria-label={t('designPage.accent')} icon={<Settings />} variant="soft" shape="circle" />
                        <IconButton aria-label={t('designPage.accent')} icon={<Settings />} variant="soft" />
                    </div>
                </Section>

                <Section title={t('designPage.tiers')}>
                    <div className="grid grid-cols-3 gap-4">
                        <Card className="p-4"><p className="text-caption text-muted">{t('designPage.tierQuiet')}</p>
                            <div className="mt-2 rounded-sm bg-accent-subtle px-3 py-2 text-small font-semibold text-accent-strong">Selected</div>
                            <div className="px-3 py-2 text-small text-secondary">Item</div></Card>
                        <Card className="p-4 shadow-accent-glow"><p className="text-caption text-muted">{t('designPage.tierInteractive')}</p>
                            <div className="mt-3 flex gap-2"><Button variant="primary" size="sm">primary</Button><Button variant="tonal" size="sm">tonal</Button></div></Card>
                        <Atmosphere className="h-40 rounded-lg bg-sheet">
                            <div className="m-6 rounded-lg bg-sheet p-4 shadow-card"><p className="text-caption text-muted">{t('designPage.tierAtmosphere')}</p></div>
                        </Atmosphere>
                    </div>
                </Section>

                <Section title={t('designPage.moments')}>
                    <div className="grid grid-cols-3 items-start gap-4">
                        <Card><EmptyState icon={<BookOpen />} title={t('designPage.sampleEmptyTitle')} description={t('designPage.sampleEmptyBody')} /></Card>
                        <CelebrationToast key={`t${replay}`} title={t('designPage.sampleToastTitle')} description={t('designPage.sampleToastBody')} />
                        <MilestoneCard key={`m${replay}`} value="365" label={t('designPage.sampleMilestone')} />
                    </div>
                    <div><Button size="sm" onClick={() => setReplay((n) => n + 1)}>{t('designPage.replay')}</Button></div>
                </Section>

                <Section title={t('designPage.radius')}>
                    <div className="flex flex-wrap gap-4">
                        {(Object.keys(radius) as RadiusStep[]).map((step) => (
                            <div key={step} className="flex flex-col items-center gap-2">
                                <div className={cn('h-16 w-24 bg-sunken', RADIUS_CLASS[step])} />
                                <span className="text-caption text-muted">{step} · {radius[step]}</span>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.shadow')}>
                    <div className="flex flex-wrap gap-6 bg-elevated p-6 rounded-card">
                        {(Object.keys(shadow) as ShadowStep[]).map((step) => (
                            <div key={step} className={cn('flex h-16 w-28 items-center justify-center bg-card rounded-card text-caption text-muted', SHADOW_CLASS[step])}>
                                {step}
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.type')}>
                    <div className="flex flex-col gap-2">
                        {(Object.keys(typeScale) as TypeStep[]).map((step) => (
                            <div key={step} className="flex items-baseline gap-4">
                                <span className="w-32 text-caption text-muted">{step} · {typeScale[step].size}/{typeScale[step].leading}</span>
                                <span className={cn('text-primary', TYPE_CLASS[step])}>{t('designPage.sample')}</span>
                            </div>
                        ))}
                    </div>
                    {(['ja', 'zh-TW', 'yue', 'zh-CN', 'en'] as const).map((lng) => (
                        <p key={lng} lang={lng} className="font-display text-display text-primary">{lng} · {t('designPage.displaySample', { lng })}</p>
                    ))}
                </Section>

                <Section title={t('designPage.motion')}>
                    <div className="flex items-center gap-4">
                        <Button size="sm" onClick={() => setMoved((m) => !m)}>{t('designPage.animate')}</Button>
                        {(['duration-fast', 'duration-base'] as const).map((d) => (
                            <div key={d} className="flex w-48 flex-col gap-1">
                                <span className="text-caption text-muted">{d}</span>
                                <div className="h-8 bg-sunken rounded-pill">
                                    <div className={cn('h-8 w-8 bg-accent rounded-pill transition-transform ease-standard', d, moved && 'translate-x-40')} />
                                </div>
                            </div>
                        ))}
                    </div>
                </Section>

                <Section title={t('designPage.landing')}>
                    <div className="flex items-center gap-4">
                        <Button size="sm" onClick={() => setLandingKey((k) => k + 1)}>{t('designPage.replay')}</Button>
                        <div key={landingKey} data-testid="landing-sample" className="px-4 py-1 rounded-card animate-landing text-body text-primary">
                            {t('designPage.sample')}
                        </div>
                    </div>
                </Section>

                <Section title={t('designPage.primitives')}>
                    <h3 className="text-title text-secondary">{t('designPage.surfaces')}</h3>
                    <Canvas className="p-4 rounded-card">
                        <Sheet className="p-4">
                            <Card className="p-4 text-body text-primary">{t('designPage.levelsSample')}</Card>
                        </Sheet>
                    </Canvas>

                    <h3 className="text-title text-secondary">{t('designPage.pills')}</h3>
                    <div className="flex gap-2">
                        <Pill selected={filter === 'all'} onClick={() => setFilter('all')}>{t('designPage.filterAll')}</Pill>
                        <Pill selected={filter === 'unread'} onClick={() => setFilter('unread')}>{t('designPage.filterUnread')}</Pill>
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.badges')}</h3>
                    <div className="flex items-center gap-3">
                        {[0, 1, 99, 100].map((n) => <Badge key={n} count={n} />)}
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.avatars')}</h3>
                    <div className="flex items-center gap-4">
                        <Avatar src="/logo-192.png" name="SakaDesk" size="sm" />
                        <Avatar src="/logo-192.png" name="SakaDesk" size="md" />
                        <Avatar src="/logo-192.png" name="SakaDesk" size="lg" selected />
                        <Avatar name="日向坂" size="xl" />
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.datePills')}</h3>
                    <div className="flex flex-wrap gap-2">
                        {[0, 1, 10, 400].map((n) => <DatePill key={n} date={daysAgo(n)} />)}
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.forms')}</h3>
                    <div className="flex max-w-md flex-col gap-3">
                        <Switch checked={switchOn} onCheckedChange={setSwitchOn} aria-label={t('designPage.switchSample')} />
                        <Input aria-label={t('designPage.inputSample')} placeholder={t('designPage.inputSample')} />
                        <Select aria-label={t('designPage.selectSample')}><option>{t('designPage.selectSample')}</option></Select>
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.menu')}</h3>
                    <div className="relative h-40">
                        <Button ref={menuTrigger} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                            {t('designPage.menuOpen')}
                        </Button>
                        {menuOpen && (
                            <Menu
                                aria-label={t('designPage.menu')}
                                onClose={() => setMenuOpen(false)}
                                returnFocusRef={menuTrigger}
                                ignoreRefs={[menuTrigger]}
                                className="absolute left-0 top-12 w-48"
                            >
                                <MenuItem icon={<Settings />}>{t('designPage.menuItem')}</MenuItem>
                                <MenuItem radio selected>{t('designPage.menuSelected')}</MenuItem>
                                <MenuSeparator />
                                <MenuItem destructive>{t('designPage.danger')}</MenuItem>
                            </Menu>
                        )}
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.rail')}</h3>
                    <div className="flex w-24 flex-col gap-1 bg-group-canvas p-2 rounded-card">
                        <RailItem icon={<MessageCircle />} label={t('features.messages')} selected={rail === 'talk'} onClick={() => setRail('talk')} />
                        <RailItem icon={<BookOpen />} label={t('features.blogs')} selected={rail === 'blog'} onClick={() => setRail('blog')} />
                        <RailItem icon={<Newspaper />} label={t('features.news')} selected={rail === 'news'} onClick={() => setRail('news')} />
                        <RailItem icon={<Search />} label={t('designPage.search')} />
                    </div>

                    <h3 className="text-title text-secondary">{t('designPage.modal')}</h3>
                    <div>
                        <Button onClick={() => setModalOpen(true)}>{t('designPage.openModal')}</Button>
                    </div>
                    <Modal
                        scope={context === 'brand' ? 'brand' : 'inherit'}
                        isOpen={modalOpen}
                        onClose={() => setModalOpen(false)}
                        title={t('designPage.modalTitle')}
                        footer={<Button variant="primary" onClick={() => setModalOpen(false)}>{t('designPage.close')}</Button>}
                    >
                        {t('designPage.modalBody')}
                    </Modal>
                </Section>

                <Section title={t('designPage.rules')}>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {(['1', '2', '3'] as const).map((n) => (
                            <React.Fragment key={n}>
                                <Card className="flex flex-col gap-1 p-4">
                                    <span className="text-caption font-semibold text-secondary">{t('designPage.do')}</span>
                                    <span className="text-body text-primary">{t(`designPage.do${n}`)}</span>
                                </Card>
                                <Card className="flex flex-col gap-1 p-4">
                                    <span className="text-caption font-semibold text-muted">{t('designPage.dont')}</span>
                                    <span className="text-body text-primary">{t(`designPage.dont${n}`)}</span>
                                </Card>
                            </React.Fragment>
                        ))}
                    </div>
                </Section>
        </>
    );

    return (
        <Canvas data-testid="design-page" className="min-h-screen p-6">
            <Sheet className="mx-auto flex max-w-5xl flex-col gap-10 p-8">
                <header className="flex flex-col gap-3">
                    <h1 className="text-heading font-semibold text-primary">{t('designPage.title')}</h1>
                    <p className="text-body text-secondary">{t('designPage.subtitle')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-small text-muted">{t('designPage.context')}</span>
                        {CONTEXTS.map((option) => (
                            <Pill key={option} selected={context === option} onClick={() => setContext(option)}>
                                {option === 'brand' ? t('designPage.contextBrand') : serviceThemes[option].name || option}
                            </Pill>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-small text-muted">{t('settings.language')}</span>
                        {(Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[]).map((code) => (
                            <Pill key={code} selected={i18n.language === code} onClick={() => void i18n.changeLanguage(code)}>
                                {SUPPORTED_LANGUAGES[code].nativeName}
                            </Pill>
                        ))}
                    </div>
                </header>

                {context === 'brand' ? <BrandScope className="contents">{body}</BrandScope> : body}
            </Sheet>
        </Canvas>
    );
};
