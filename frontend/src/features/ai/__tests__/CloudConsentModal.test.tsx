// frontend/src/features/ai/__tests__/CloudConsentModal.test.tsx
//
// Direct unit tests for `CloudConsentModal`'s accept-button double-submit
// guard (P-5 review, minors). `AiFeature` (see `AiFeature.test.tsx`) closes
// this modal synchronously on the FIRST click of Accept -- `pendingQuestion`
// is nulled before the `POST /api/ai/consent` fetch even starts -- so a real
// second click on the SAME rendered button is never reachable through that
// integration path. Testing the component directly (with an `onAccept` that
// deliberately does NOT flip `isOpen`, mirroring a slow/async caller) is what
// actually exercises the guard.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CloudConsentModal } from '../components/CloudConsentModal';

describe('CloudConsentModal', () => {
    it('guards the accept button against a double submit: a second click before onAccept-driven unmount is a no-op', () => {
        const onAccept = vi.fn();
        const onDecline = vi.fn();

        render(
            <CloudConsentModal isOpen provider="Google" onAccept={onAccept} onDecline={onDecline} />
        );

        const acceptButton = screen.getByRole('button', { name: 'I understand, continue' });

        // Two clicks in immediate succession (no caller-driven unmount
        // between them, since this `onAccept` mock doesn't touch `isOpen`).
        fireEvent.click(acceptButton);
        fireEvent.click(acceptButton);

        expect(onAccept).toHaveBeenCalledTimes(1);
        expect(acceptButton).toBeDisabled();
    });

    it('resets the guard when the modal re-opens for a new pending question', () => {
        const onAccept = vi.fn();
        const onDecline = vi.fn();

        const { rerender } = render(
            <CloudConsentModal isOpen provider="Google" onAccept={onAccept} onDecline={onDecline} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));
        expect(onAccept).toHaveBeenCalledTimes(1);

        // Caller closes, then reopens for a fresh question.
        rerender(
            <CloudConsentModal isOpen={false} provider="Google" onAccept={onAccept} onDecline={onDecline} />
        );
        rerender(
            <CloudConsentModal isOpen provider="Google" onAccept={onAccept} onDecline={onDecline} />
        );

        const acceptButton = screen.getByRole('button', { name: 'I understand, continue' });
        expect(acceptButton).not.toBeDisabled();

        fireEvent.click(acceptButton);
        expect(onAccept).toHaveBeenCalledTimes(2);
    });

    it('declining is unaffected by the accept guard', () => {
        const onAccept = vi.fn();
        const onDecline = vi.fn();

        render(
            <CloudConsentModal isOpen provider="Google" onAccept={onAccept} onDecline={onDecline} />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onDecline).toHaveBeenCalledTimes(1);
        expect(onAccept).not.toHaveBeenCalled();
    });
});
