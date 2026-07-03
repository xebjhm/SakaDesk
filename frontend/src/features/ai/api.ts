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

/**
 * One prior chat turn, in the exact shape `backend/api/ai.py`'s
 * `AskRequest.history` (`HistoryMessage`) expects -- which is itself
 * `pysaka.knowledge.KnowledgeAgent.ask`'s `history: list[dict] | None` shape,
 * spliced verbatim between the system prompt and the new question. No
 * `citationIds`/refs -- see `deriveHistory` in `../AiFeature.tsx` for how
 * these are built from the rendered thread.
 */
export interface AskHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskOptions {
  groupIds?: number[];
  /**
   * pysaka canonical member id, shaped `"<service>:<blogId>"` (e.g.
   * `"hinatazaka46:12"`) -- NOT a bare numeric id. The backend
   * (`backend/api/ai.py`'s `AskRequest.member_id`) compares this verbatim
   * against `doc.author_id`, which is always this canonical form; a bare
   * number/numeric string never matches anything and is rejected with a 422.
   * Build one with `canonicalMemberId()` rather than concatenating by hand.
   */
  memberId?: string;
  conversationId?: string;
  /** Prior turns for a multi-turn follow-up (Product-wave Task 6, item 3).
   * Server-capped at 12 messages (`backend/api/ai.py`'s
   * `_MAX_HISTORY_MESSAGES`) -- an oversized list is REJECTED (422), not
   * truncated, so keep this at the ~6-exchange window `deriveHistory`
   * already enforces. */
  history?: AskHistoryMessage[];
  /** Aborts the underlying `fetch` (Stop button, Product-wave Task 6, item
   * 2) -- rejects the returned promise with `AskError('aborted', ...)`
   * instead of `'network'`, so callers can render a distinct non-error
   * "stopped" state. */
  signal?: AbortSignal;
}

/** Builds the canonical member id `askKnowledge`'s `AskOptions.memberId`
 * expects: `"<service>:<blogId>"` (pysaka's `CanonicalId`, e.g.
 * `"hinatazaka46:12"`). `blogId` may be a number (as stored on e.g. a blog
 * list item) or an already-stringified id; either way it's coerced to a
 * plain decimal string with no extra formatting. */
export function canonicalMemberId(service: string, blogId: number | string): string {
  return `${service}:${blogId}`;
}

/** Known cloud LLM API hostnames -> a human-readable provider name, for the
 * cloud-consent modal's privacy copy (Product-wave Task 5, item 5: "name
 * the provider dynamically"). Falls back to the bare hostname for anything
 * not in this map (e.g. a self-hosted OpenAI-compatible cloud proxy), and
 * to a generic phrase if `base_url` isn't even a parseable URL.
 */
const KNOWN_CLOUD_PROVIDER_HOSTS: Record<string, string> = {
  'generativelanguage.googleapis.com': 'Google',
  'api.openai.com': 'OpenAI',
};

export function providerNameFromBaseUrl(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname;
    return KNOWN_CLOUD_PROVIDER_HOSTS[hostname] ?? hostname;
  } catch {
    return 'the AI provider';
  }
}

/** Extra fields an `AskError` may carry alongside its stable `code`. */
export interface AskErrorParams {
  retryAfterS?: number;
  backend?: string;
  model?: string;
  /** Only ever present alongside `code === 'quota_exhausted'` (Product-wave
   * Task 5, item 3) -- the usage-meter numbers the backend enriches that
   * specific SSE error with. */
  requestsToday?: number;
  dailyLimit?: number;
  estQuestionsLeft?: number;
}

/**
 * Typed rejection for a failed `askKnowledge` call. `code` is the stable
 * taxonomy the UI keys off (`ai.error.<code>` i18n lookup, see
 * `ChatWindow.tsx`'s `ErrorTurn`) -- mirrors `backend/api/ai.py`'s SSE
 * `event: error` `{code, message, retryAfterS?, backend, model}` contract for
 * a structured server error, plus two client-only codes for failures that
 * never reach that contract: `'network'` (the fetch itself failed, or the
 * server responded but not with the SSE stream at all) and `'unknown'` (a
 * malformed/truncated stream with no terminal event). `.message` is always
 * still set (subclassing `Error`) so a caller that only reads `.message`
 * (old code, `console.error`, etc.) keeps working.
 */
export class AskError extends Error {
  readonly code: string;
  readonly retryAfterS?: number;
  readonly backend?: string;
  readonly model?: string;
  readonly requestsToday?: number;
  readonly dailyLimit?: number;
  readonly estQuestionsLeft?: number;

  constructor(code: string, message: string, params?: AskErrorParams) {
    super(message);
    this.name = 'AskError';
    this.code = code;
    this.retryAfterS = params?.retryAfterS;
    this.backend = params?.backend;
    this.model = params?.model;
    this.requestsToday = params?.requestsToday;
    this.dailyLimit = params?.dailyLimit;
    this.estQuestionsLeft = params?.estQuestionsLeft;
  }
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

/** True for the `DOMException`/`Error` `fetch`/`ReadableStream` throws when an
 * in-flight request is aborted via `AbortController.abort()` -- duck-typed
 * purely on `.name` (NOT `instanceof DOMException`/`instanceof Error`): a
 * browser's real `DOMException` extends `Error`, but jsdom's (the test
 * environment) does not, and some environments/polyfills throw a plain
 * `Error` with the same `name` instead. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Calls `/api/ai/ask` and consumes its two-pass SSE stream.
 *
 * `onProgress` is invoked once per `event: progress` heartbeat with a
 * human-ish stage label. The returned promise resolves with the single
 * terminal `event: answer` payload, or rejects on `event: error`, a non-ok
 * HTTP response, a stream that ends without a terminal event, a network
 * failure, or `opts.signal` firing (Stop button, Product-wave Task 6, item 2
 * -- rejects with `AskError('aborted', ...)`, distinct from `'network'`, so
 * callers can render a non-error "stopped" state instead of a real failure).
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
          signal: opts?.signal,
          body: JSON.stringify({
            question,
            service,
            tz,
            group_ids: opts?.groupIds,
            member_id: opts?.memberId,
            conversation_id: opts?.conversationId,
            history: opts?.history,
          }),
        });
      } catch (err) {
        if (isAbortError(err)) {
          reject(new AskError('aborted', 'The request was stopped.'));
        } else {
          reject(new AskError('network', err instanceof Error ? err.message : String(err)));
        }
        return;
      }

      if (!response.ok) {
        reject(new AskError('network', `Failed to ask knowledge base: ${response.status}`));
        return;
      }
      if (!response.body) {
        reject(new AskError('network', 'AI ask response has no readable body'));
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
            const payload = JSON.parse(evt.data) as {
              code?: string;
              message?: string;
              retryAfterS?: number;
              backend?: string | null;
              model?: string | null;
              requestsToday?: number;
              dailyLimit?: number;
              estQuestionsLeft?: number;
            };
            reject(
              new AskError(payload.code ?? 'unknown', payload.message ?? 'AI ask failed', {
                retryAfterS: payload.retryAfterS,
                backend: payload.backend ?? undefined,
                model: payload.model ?? undefined,
                requestsToday: payload.requestsToday,
                dailyLimit: payload.dailyLimit,
                estQuestionsLeft: payload.estQuestionsLeft,
              })
            );
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
          reject(new AskError('unknown', 'AI ask stream ended without a terminal event'));
        }
      } catch (err) {
        if (isAbortError(err)) {
          reject(new AskError('aborted', 'The request was stopped.'));
        } else {
          reject(new AskError('network', err instanceof Error ? err.message : String(err)));
        }
      } finally {
        reader.releaseLock();
      }
    })();
  });
}
