import React, { useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n';
import { Modal } from '../../../design/primitives';
import { LetterViewerModal } from '../../../core/modals/LetterViewerModal';
import { fetchLocalLetters } from '../../messages/letters';
import { openChat } from '../../../shell/openChat';
import { MemoriesStatus } from '../shared/memoriesStatus';
import { useMemoriesQuery } from '../shared/useMemoriesQuery';

interface SentLetterProps {
    service: string;
    /** Her display name: the chat the viewer's date link opens. */
    name: string;
    /** The card's letter: where to read it (`letters_local` path) and which one. */
    letter: { member_path: string; id: number };
    onClose: () => void;
}

/**
 * The fan's own letter from a あなた card: reads the room's archived letters (`fetchLocalLetters`,
 * `memories_load` target `letters`) and opens the shared `LetterViewerModal` at the card's letter
 * (← / → step through the other letters to her, oldest = 1; surface `memories`). While the
 * letters load, or when the read fails, a small dialog shows `MemoriesStatus` (the loading-UX
 * contract: delayed reveal, slow / timeout copy, retry). The viewer's date link opens her chat.
 * Only the fan's letter is shown, never her words (spec 1.5).
 */
export const SentLetter: React.FC<SentLetterProps> = ({ service, name, letter, onClose }) => {
    const { t } = useTranslation();
    const query = useMemoriesQuery(
        'letters',
        (signal) => fetchLocalLetters(service, letter.member_path, signal),
        [service, letter.member_path],
    );
    const [openId, setOpenId] = useState<number>(letter.id);
    const letters = useMemo(
        () => [...(query.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
        [query.data],
    );
    if (query.status !== 'ready') {
        return (
            <Modal isOpen onClose={onClose} title={t('memories.cards.letterFirst')} header="plain" closeLabel={t('common.close')} className="max-w-md">
                <MemoriesStatus query={query} view="letters" />
            </Modal>
        );
    }
    return (
        <LetterViewerModal
            letters={letters}
            letterId={openId}
            order="oldest_first"
            source="memories"
            onNavigate={setOpenId}
            onClose={onClose}
            onJump={() => {
                openChat({ service, path: letter.member_path, name, is_group_chat: false });
                onClose();
            }}
        />
    );
};
