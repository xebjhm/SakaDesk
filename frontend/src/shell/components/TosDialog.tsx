import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { Button, Modal } from '../../design/primitives';
import { useGroupMarker } from '../../design/useGroupMarker';
import { persisted } from '../../core/persistence/persisted';

interface TosDialogProps {
    onAccept: () => void;
}

const OFFICIAL_TOS = [
    { service: 'nogizaka46', href: 'https://contact.nogizaka46.com/s/n46app/page/app_terms', labelKey: 'tos.nogizakaTos' },
    { service: 'sakurazaka46', href: 'https://sakurazaka46.com/s/s46app/page/app_terms', labelKey: 'tos.sakurazakaTos' },
    { service: 'hinatazaka46', href: 'https://www.hinatazaka46.com/s/h46app/page/app_terms', labelKey: 'tos.hinatazakaTos' },
    { service: 'yodel', href: 'https://yodel-app.com/s/yodel/rule', labelKey: 'tos.yodelTos' },
] as const;

/**
 * One official-terms link in its own group's link colour: a group marker (spec §9; e4e4118 had
 * purple / pink / blue / indigo text with a hover underline; decision D3).
 */
const TosLink: React.FC<{ service: string; href: string; label: string }> = ({ service, href, label }) => {
    const marker = useGroupMarker(service, 'tos_link');
    return (
        <li style={marker}>
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md text-small text-accent-strong underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <ExternalLink aria-hidden="true" className="h-3 w-3" />
                {label}
            </a>
        </li>
    );
};

/**
 * Terms of Service acknowledgment dialog shown on first launch: a brand dialog (spec §4, §9).
 * Blocks app usage until the user accepts the terms. Standard layout: the body scrolls and
 * Accept stays in the footer, so a short window never hides it (spec D2d decision 4).
 */
export const TosDialog: React.FC<TosDialogProps> = ({ onAccept }) => {
    const { t } = useTranslation();
    const [acknowledged, setAcknowledged] = useState(false);

    const handleAccept = () => {
        if (acknowledged) {
            // Store acceptance timestamp in the persisted app-state store
            persisted.setPref('tos_accepted_at', new Date().toISOString());
            onAccept();
        }
    };

    return (
        <Modal
            isOpen
            onClose={() => {}}
            scope="brand"
            title={t('tos.title')}
            icon={<FileText />}
            dismissible={false}
            logId="tos"
            className="max-w-lg"
            bodyClassName="flex flex-col gap-4"
            footer={
                <Button
                    variant="primary"
                    className="w-full"
                    onClick={handleAccept}
                    disabledReason={acknowledged ? undefined : t('tos.acceptRequired')}
                >
                    {t('tos.acceptAndContinue')}
                </Button>
            }
        >
            <p className="text-small text-muted">{t('tos.subtitle')}</p>

            {/* e4e4118: an amber 50 fill, amber 200 border, amber 800 heading and amber 700 text, no icon → the semantic warning colours (spec §9). */}
            <section data-testid="tos-disclaimer" className="flex gap-3 rounded-lg border border-semantic-warning bg-semantic-warning-subtle p-4">
                <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0 text-semantic-warning" />
                <div className="flex flex-col gap-1">
                    <h3 className="text-body font-semibold text-semantic-warning">{t('tos.disclaimer')}</h3>
                    <p className="text-small text-semantic-warning">{t('tos.disclaimerText')}</p>
                </div>
            </section>

            {/* Official ToS excerpts (collapsible). The articles quote the official Japanese terms verbatim. */}
            <details className="rounded-lg bg-elevated p-4">
                <summary className="cursor-pointer select-none text-small font-semibold text-secondary">
                    {t('tos.officialExcerpts')}
                </summary>
                <div className="mt-3 flex flex-col gap-3 text-caption text-secondary">
                    <div>
                        <p className="font-semibold">{t('tos.articleIpTitle')}</p>
                        <p lang="ja">当社が別に定める場合を除き、お客様が本コンテンツを複製、翻案、頒布、公衆送信等することは禁止します。</p>
                    </div>
                    <div>
                        <p className="font-semibold">{t('tos.articleProhibitedTitle')}</p>
                        <div lang="ja">
                            <p>(11) 当社または第三者の情報、データおよびソフトウェアを修正、改変、改ざん、リバースエンジニアリング、逆コンパイル、逆アッセンブルまたは消去等する行為</p>
                            <p>(16) 当社が指定するアクセス方法以外の手段で本サービスにアクセスし、またはアクセスを試みる行為</p>
                            <p>(17) 自動化された手段（クローラおよび類似の技術を含む）を用いて本サービスにアクセスし、またはアクセスを試みる行為</p>
                        </div>
                    </div>
                </div>
            </details>

            {/* e4e4118: a gray 50 box → the near-white elevated surface (also keeps Hinatazaka 700 links at 4.6:1). */}
            <section className="flex flex-col gap-3 rounded-lg bg-elevated p-4">
                <p className="text-small text-secondary">{t('tos.reviewOfficialTos')}</p>
                <ul className="flex flex-wrap gap-x-4 gap-y-2">
                    {OFFICIAL_TOS.map((link) => (
                        <TosLink key={link.href} service={link.service} href={link.href} label={t(link.labelKey)} />
                    ))}
                </ul>
            </section>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg p-3 transition-colors duration-fast ease-standard hover:bg-sunken">
                <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
                />
                <span className="text-body text-primary">{t('tos.acceptCheckbox')}</span>
            </label>
        </Modal>
    );
};
