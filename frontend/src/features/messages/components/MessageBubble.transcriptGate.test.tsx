import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__tests__/mocks/server';
import i18n from '../../../i18n';
import { useAppStore } from '../../../store/appStore';
import type { Message } from '../../../types';
import { MessageBubble } from './MessageBubble';

const voice: Message = {
    id: 5, timestamp: '2024-01-15T09:00:00Z', type: 'voice', content: null, is_favorite: false,
    media_file: 'messages/1 R/1 R/voice/5.m4a',
} as Message;
let lookups = 0;

describe('MessageBubble transcript lookups (UI health P-C3)', () => {
    beforeAll(async () => { await i18n.changeLanguage('en'); });
    beforeEach(() => {
        lookups = 0;
        server.use(
            http.get('/api/app-state/translations', () => HttpResponse.json({})),
            http.get('/api/transcription/:service/:id', () => {
                lookups += 1;
                return new HttpResponse(null, { status: 404 });
            }),
        );
    });

    const bubble = (isUnread: boolean) => (
        <MessageBubble message={voice} member_name="n" service="hinatazaka46" memberPath="hinatazaka46/messages/1 R/1 R" isUnread={isUnread} />
    );

    it('asks nothing while transcription is off', async () => {
        useAppStore.setState({ transcriptionEnabled: false });
        render(bubble(false));
        await new Promise((r) => setTimeout(r, 30));
        expect(lookups).toBe(0);
    });

    it('asks nothing for an unread (sheltered) bubble', async () => {
        useAppStore.setState({ transcriptionEnabled: true });
        render(bubble(true));
        await new Promise((r) => setTimeout(r, 30));
        expect(lookups).toBe(0);
    });

    it('asks once for a revealed bubble with transcription on', async () => {
        useAppStore.setState({ transcriptionEnabled: true });
        render(bubble(false));
        await new Promise((r) => setTimeout(r, 30));
        expect(lookups).toBe(1);
    });
});
