// frontend/src/features/ai/api.ts
// SSE client for the KB-chatbot `/api/ai/ask` two-pass endpoint (Plan B Task 5,
// `backend/api/ai.py`'s `_ask_event_stream`): pass 1 streams periodic
// `event: progress` heartbeats while the (server-side, already-grounded) ask
// resolves; pass 2 is a single terminal `event: answer` or `event: error`.

import type { CitationReference } from '../../utils/navigateToSource';

export interface AskCitation {
  docId: string;
  ref: CitationReference;
  snippet: string;
  member: string;
  timestamp: string;
}

export interface AskAnswer {
  sentences: { text: string; citationIds: string[] }[];
  citations: AskCitation[];
  noEvidence: boolean;
}

export interface AskOptions {
  groupIds?: number[];
  memberId?: number;
  conversationId?: string;
}

/** Raw `event: answer` payload as serialized by `_serialize_answer` — when
 * `noEvidence` is true the backend omits `sentences`/`citations` entirely. */
interface RawAskAnswer {
  sentences?: { text: string; citationIds: string[] }[];
  citations?: AskCitation[];
  noEvidence: boolean;
}

interface RawSseEvent {
  event: string;
  data: string;
}

/** Splits a raw SSE event block (everything between two `\n\n` boundaries)
 * into its `event:`/`data:` fields. Multiple `data:` lines (per the SSE spec)
 * are joined with `\n`, though the server only ever emits one. Lines with an
 * unrecognized field name are ignored. Returns `null` for a block with no
 * `event:` line (e.g. a stray blank chunk). */
function parseSseEventBlock(block: string): RawSseEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  if (!event) {
    return null;
  }
  return { event, data: dataLines.join('\n') };
}

/** Normalizes a raw `event: progress` payload (currently `{stage: string}`
 * per `_ask_event_stream`) into the label string handed to `onProgress`. */
function extractProgressLabel(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.stage === 'string') return obj.stage;
    if (typeof obj.label === 'string') return obj.label;
  }
  return '';
}

function normalizeAnswer(raw: RawAskAnswer): AskAnswer {
  return {
    sentences: raw.sentences ?? [],
    citations: raw.citations ?? [],
    noEvidence: raw.noEvidence,
  };
}

/**
 * Calls `/api/ai/ask` and consumes its two-pass SSE stream.
 *
 * `onProgress` is invoked once per `event: progress` heartbeat with a
 * human-ish stage label. The returned promise resolves with the single
 * terminal `event: answer` payload, or rejects on `event: error`, a non-ok
 * HTTP response, a stream that ends without a terminal event, or a network
 * failure.
 */
export function askKnowledge(
  service: string,
  question: string,
  tz: string,
  onProgress: (label: string) => void,
  opts?: AskOptions
): Promise<AskAnswer> {
  return new Promise<AskAnswer>((resolve, reject) => {
    void (async () => {
      let response: Response;
      try {
        response = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            service,
            tz,
            group_ids: opts?.groupIds,
            member_id: opts?.memberId,
            conversation_id: opts?.conversationId,
          }),
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      if (!response.ok) {
        reject(new Error(`Failed to ask knowledge base: ${response.status}`));
        return;
      }
      if (!response.body) {
        reject(new Error('AI ask response has no readable body'));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      /** Handles one parsed SSE event. Returns true once the stream has
       * reached its terminal event (resolved or rejected) so the read loop
       * can stop. */
      const handleEvent = (evt: RawSseEvent): boolean => {
        switch (evt.event) {
          case 'progress': {
            onProgress(extractProgressLabel(JSON.parse(evt.data)));
            return false;
          }
          case 'answer': {
            resolve(normalizeAnswer(JSON.parse(evt.data) as RawAskAnswer));
            return true;
          }
          case 'error': {
            const payload = JSON.parse(evt.data) as { message?: string };
            reject(new Error(payload.message ?? 'AI ask failed'));
            return true;
          }
          default:
            return false;
        }
      };

      try {
        let settled = false;
        while (!settled) {
          const { done, value } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: true });
          }

          let boundary = buffer.indexOf('\n\n');
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const evt = parseSseEventBlock(block);
            if (evt && handleEvent(evt)) {
              settled = true;
              break;
            }
            boundary = buffer.indexOf('\n\n');
          }

          if (done) {
            // Flush a final event that wasn't terminated by a trailing
            // `\n\n` (defensive — the server always sends one, but a
            // truncated/proxied stream shouldn't silently hang forever).
            if (!settled && buffer.trim()) {
              const evt = parseSseEventBlock(buffer);
              buffer = '';
              if (evt && handleEvent(evt)) {
                settled = true;
              }
            }
            break;
          }
        }

        if (!settled) {
          reject(new Error('AI ask stream ended without a terminal event'));
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        reader.releaseLock();
      }
    })();
  });
}
