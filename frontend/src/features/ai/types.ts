// frontend/src/features/ai/types.ts
// Chat-turn shape shared between the `aiThreads` slice (`store/appStore.ts`)
// and the chat UI (`components/ChatWindow.tsx`). Lives in its own module --
// rather than only in `ChatWindow.tsx`, where it originally lived -- so the
// global app store can reference it without depending on a feature UI
// component file.

import type { AskAnswer } from './api';

/**
 * One turn in a service's chat thread.
 *
 * Product-wave Task 6: this now lives in the global `appStore`
 * (`aiThreadsByService`), not local `AiFeature` component state -- so a tab
 * switch (including clicking a citation chip, which changes
 * `activeFeature`/unmounts `AiFeature`) no longer destroys the conversation,
 * and an answer that resolves while `AiFeature` happens to be unmounted
 * still lands in the thread. Still client-side only -- no server-side
 * conversation persistence, per Plan B spec §7.5 -- and does NOT survive an
 * app restart (the store's `persist` middleware deliberately excludes these
 * fields from `partialize`; only in-session remounts are covered).
 *
 * `createdAt` (epoch ms, `Date.now()`) is set once when a turn is first
 * created and never touched again (including when a `streaming` turn is
 * later replaced with its `answered`/`error`/etc. terminal state) -- it's
 * the "when was this question asked" timestamp, not "when did this turn's
 * state last change".
 *
 * An error turn's `code` is `AskError.code` (see `./api.ts`) -- the stable
 * taxonomy `errorMessageKey` (`./aiErrorCode.ts`, shared with
 * `SetupChecklist.tsx`'s rebuild errors) maps to a localized `ai.error.<code>`
 * message. `message` is kept only as the non-localized fallback for
 * `console.error`/debugging, never rendered directly (see `ChatTurnRow`).
 * `requestsToday`/`dailyLimit`/`estQuestionsLeft` (Product-wave Task 5, item
 * 3) are only ever present alongside `code === 'quota_exhausted'` -- the
 * usage-meter numbers the backend enriches that specific SSE error with.
 */
export type ChatTurn =
    | { id: string; role: 'user'; text: string; createdAt: number }
    | { id: string; role: 'assistant'; state: 'streaming'; progressLabel: string; createdAt: number }
    | { id: string; role: 'assistant'; state: 'answered'; answer: AskAnswer; createdAt: number }
    | { id: string; role: 'assistant'; state: 'noEvidence'; createdAt: number }
    // Stop button (Product-wave Task 6, item 2): the user aborted the
    // in-flight fetch. Deliberately distinct from `state: 'error'` -- it's
    // an intentional user action, not a failure, so `ChatWindow` renders it
    // with neutral (non-red) styling and no "open settings" hint.
    | { id: string; role: 'assistant'; state: 'stopped'; createdAt: number }
    | {
          id: string;
          role: 'assistant';
          state: 'error';
          code: string;
          message: string;
          retryAfterS?: number;
          backend?: string;
          model?: string;
          requestsToday?: number;
          dailyLimit?: number;
          estQuestionsLeft?: number;
          createdAt: number;
      };
