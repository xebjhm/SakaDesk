import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Dialog, viewer and menu files restyled in D2c (later tasks append). The guard counts
 * literals; this catches what it does not: named palette classes, colours through inline
 * styles, the legacy theme, native confirm/alert, and z-index classes.
 */
const FILES = [
    'modals/CalendarModal.tsx',
    'modals/BackgroundModal.tsx',
    'modals/FavoritesModal.tsx',
    'modals/SentLettersModal.tsx',
    'modals/AboutModal.tsx',
    'modals/ReportIssueModal.tsx',
    'modals/DiagnosticsModal.tsx',
    'layout/AddServiceModal.tsx',
    'layout/FeatureRail.tsx',
    '../shell/components/ConfirmDialog.tsx',
    'media/PhotoDetailModal.tsx',
    'media/MediaGalleryModal.tsx',
    'media/LazyVideo.tsx',
    'media/PhotoPlayer.tsx',
    '../features/messages/components/ProfileImageViewer.tsx',
    '../features/blogs/components/MemberSelectModal.tsx',
    '../features/blogs/components/MemberTimelineModal.tsx',
    '../features/blogs/components/BlogPhotoGalleryModal.tsx',
    '../features/messages/components/ConversationMenu.tsx',
    '../features/messages/components/MessageContextMenu.tsx',
    '../features/messages/components/MemberContextMenu.tsx',
    '../features/messages/components/MemberProfilePopup.tsx',
    '../features/messages/components/ProfileImagePills.tsx',
    'common/SettingsMenu.tsx',
    '../features/search/SearchModal.tsx',
    '../features/search/components/SearchInput.tsx',
    '../features/search/components/SearchFilterBar.tsx',
    '../features/search/components/SearchResultItem.tsx',
    '../features/search/components/SearchResultList.tsx',
    '../shell/components/SettingsModal.tsx',
    '../shell/components/SettingRow.tsx',
    'layout/ServiceRail.tsx',
    'layout/UpgradeIcon.tsx',
    'common/DialogStatus.tsx',
    // D2d
    'common/SyncProgressPanel.tsx',
    '../shell/components/SyncModal.tsx',
    'layout/InlineSyncView.tsx',
    '../shell/components/TosDialog.tsx',
    '../shell/components/SetupWizard.tsx',
    '../shell/components/LoginModal.tsx',
    '../pages/LandingPage.tsx',
    '../shell/App.tsx',
    '../features/incomingCall/CallOverlay.tsx',
    '../features/messages/components/MemberList.tsx',
];

const PALETTE = /(?<![\w-])(?:bg|text|border(?:-[trblxy])?|ring|from|via|to|fill|stroke|decoration|outline|divide|placeholder)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(?:\/\d{1,3})?(?![\w-])/g;
const COLOUR_STYLE = /\b(?:color|background|backgroundColor|borderColor|boxShadow)\s*:/g;
/** Files whose inline colour is user or member data (decision 26: the background presets and preview). */
/** SearchFilterBar: `color` is the group logo colour carried by a filter chip (data, drawn through groupMarkerStyle). */
const DATA_COLOUR = new Set(['modals/BackgroundModal.tsx', '../features/search/components/SearchFilterBar.tsx']);

describe.each(FILES)('%s', (file) => {
    const source = readFileSync(path.resolve(__dirname, file), 'utf-8');

    it('uses no named palette classes', () => {
        expect(source.match(PALETTE) ?? []).toEqual([]);
    });

    it('sets no colour through inline styles', () => {
        if (DATA_COLOUR.has(file)) return;
        expect(source.match(COLOUR_STYLE) ?? []).toEqual([]);
    });

    it('does not read the legacy theme', () => {
        expect(source).not.toMatch(/getServiceTheme|useBlogTheme|serviceThemes|useMessagesTheme/);
    });

    it('uses no native confirm/alert, z-index classes or old modal shells', () => {
        // z-10 / z-20 stay allowed for stacking inside a frame (sticky headers, viewer chrome).
        expect(source).not.toMatch(/window\.confirm|\balert\(|z-\[|\bz-(?:40|50)\b|BaseModal(?!Props)|(?<!Photo)DetailModal|useModalClose|ModalStates|Modal(?:Loading|Error|Empty)State/);
    });
});
