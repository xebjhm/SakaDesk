// frontend/src/features/ai/__tests__/api.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { askKnowledge } from '../api';

/** Builds a `ReadableStream<Uint8Array>` that yields `chunks` one per read
 * (i.e. one `reader.read()` resolves per array entry), then closes. Lets
 * tests control exactly how SSE bytes are fragmented across reads. */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetchStream(chunks: string[], init?: { ok?: boolean; status?: number }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    body: streamFromChunks(chunks),
  } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const MESSAGE_ANSWER = {
  sentences: [{ text: '焼肉を食べた。', citationIds: ['c1'] }],
  citations: [
    {
      docId: 'msg:hinatazaka46:42',
      ref: {
        type: 'message',
        service: 'hinatazaka46',
        groupId: 1,
        groupName: 'group-name',
        memberId: 2,
        memberName: 'member-name',
        messageId: 42,
        isGroupChat: true,
      },
      snippet: '焼肉を食べた。',
      member: 'member-name',
      timestamp: '2026-06-30T12:00:00+00:00',
    },
  ],
  noEvidence: false,
};

describe('askKnowledge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams progress then resolves the answer with a message citation ref', async () => {
    mockFetchStream([sse('progress', { stage: 'thinking' }) + sse('answer', MESSAGE_ANSWER)]);

    const onProgress = vi.fn();
    const answer = await askKnowledge('hinatazaka46', '何を食べた?', 'Asia/Tokyo', onProgress);

    expect(onProgress).toHaveBeenCalledWith('thinking');
    expect(answer.noEvidence).toBe(false);
    expect(answer.sentences[0].citationIds).toEqual(['c1']);
    expect(answer.citations[0].ref.type).toBe('message');
    if (answer.citations[0].ref.type === 'message') {
      expect(answer.citations[0].ref.messageId).toBe(42);
      expect(answer.citations[0].ref.groupId).toBe(1);
    }
  });

  it('resolves a blog citation ref', async () => {
    const blogAnswer = {
      sentences: [{ text: 'blog sentence', citationIds: ['c1'] }],
      citations: [
        {
          docId: 'blog:hinatazaka46:1',
          ref: { type: 'blog', service: 'hinatazaka46', blogId: '1', memberId: 9 },
          snippet: 'blog snippet',
          member: 'member-name',
          timestamp: '2026-06-30T12:00:00+00:00',
        },
      ],
      noEvidence: false,
    };
    mockFetchStream([sse('answer', blogAnswer)]);

    const answer = await askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', vi.fn());

    expect(answer.citations[0].ref.type).toBe('blog');
    if (answer.citations[0].ref.type === 'blog') {
      expect(answer.citations[0].ref.blogId).toBe('1');
      expect(answer.citations[0].ref.memberId).toBe(9);
    }
  });

  it('resolves noEvidence with empty sentences/citations when the server omits them', async () => {
    mockFetchStream([sse('answer', { noEvidence: true })]);

    const answer = await askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', vi.fn());

    expect(answer.noEvidence).toBe(true);
    expect(answer.sentences).toEqual([]);
    expect(answer.citations).toEqual([]);
  });

  it('rejects on an event: error stream', async () => {
    mockFetchStream([sse('error', { message: 'The request failed unexpectedly.' })]);

    await expect(askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', vi.fn())).rejects.toThrow(
      'The request failed unexpectedly.'
    );
  });

  it('rejects on a non-ok HTTP response', async () => {
    mockFetchStream([], { ok: false, status: 500 });

    await expect(askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', vi.fn())).rejects.toThrow(/500/);
  });

  it('buffers a partial chunk: the answer JSON split across two stream reads', async () => {
    const full = sse('progress', { stage: 'thinking' }) + sse('answer', MESSAGE_ANSWER);
    const splitPoint = Math.floor(full.length / 2);
    const chunks = [full.slice(0, splitPoint), full.slice(splitPoint)];

    mockFetchStream(chunks);
    const onProgress = vi.fn();
    const answer = await askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', onProgress);

    expect(onProgress).toHaveBeenCalledWith('thinking');
    expect(answer.citations[0].ref.type).toBe('message');
    expect(answer.noEvidence).toBe(false);
  });

  it('rejects if the stream ends without a terminal event', async () => {
    mockFetchStream([sse('progress', { stage: 'thinking' })]);

    await expect(askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', vi.fn())).rejects.toThrow(
      /terminal event/
    );
  });

  it('rejects on a fetch network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(askKnowledge('hinatazaka46', 'q', 'Asia/Tokyo', vi.fn())).rejects.toThrow(
      'network down'
    );
  });

  it('posts JSON with snake_case opts fields matching the backend AskRequest', async () => {
    const fetchMock = mockFetchStream([sse('answer', MESSAGE_ANSWER)]);

    await askKnowledge('hinatazaka46', 'question text', 'Asia/Tokyo', vi.fn(), {
      groupIds: [1, 2],
      memberId: 9,
      conversationId: 'conv-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ai/ask',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const call = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({
      question: 'question text',
      service: 'hinatazaka46',
      tz: 'Asia/Tokyo',
      group_ids: [1, 2],
      member_id: 9,
      conversation_id: 'conv-1',
    });
  });
});
