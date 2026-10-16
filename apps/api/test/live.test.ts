import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LiveEvent } from '@slider/shared';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type DeckFixture,
  type TestContext,
} from './helpers';

/**
 * An open `/live` stream: reads SSE events as they come, and always gets closed (abort + cancel)
 * so no test leaves a stream hanging.
 */
interface LiveStream {
  response: Response;
  next(): Promise<LiveEvent>;
  close(): Promise<void>;
}

async function openLive(ctx: TestContext, url: string, cookie?: string): Promise<LiveStream> {
  const controller = new AbortController();
  const response = await ctx.request(url, { signal: controller.signal, cookie });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pending: LiveEvent[] = [];

  const next = async (): Promise<LiveEvent> => {
    for (;;) {
      const queued = pending.shift();
      if (queued) return queued;
      if (!reader) throw new Error('No stream body');
      const { done, value } = await reader.read();
      if (done) throw new Error('Stream ended');
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = block.split('\n');
        if (!lines.includes('event: live')) continue; // `: ping` comments and the like
        const data = lines.find((line) => line.startsWith('data: '));
        if (data) pending.push(JSON.parse(data.slice('data: '.length)) as LiveEvent);
      }
    }
  };

  return {
    response,
    next,
    close: async () => {
      controller.abort();
      await reader?.cancel().catch(() => {});
    },
  };
}

const nextOfType = async <T extends LiveEvent['type']>(stream: LiveStream, type: T) => {
  for (;;) {
    const event = await stream.next();
    if (event.type === type) return event as Extract<LiveEvent, { type: T }>;
  }
};

describe('live routes', () => {
  let ctx: TestContext;
  let deck: DeckFixture;
  const streams: LiveStream[] = [];
  const open = async (url: string, cookie?: string) => {
    const stream = await openLive(ctx, url, cookie);
    streams.push(stream);
    return stream;
  };

  beforeEach(async () => {
    ctx = await createTestContext();
    deck = await createReadyDeck(ctx);
  });
  afterEach(async () => {
    await Promise.all(streams.splice(0).map((stream) => stream.close()));
    await ctx.cleanup();
  });

  it('streams server-sent events, starting with hello', async () => {
    const stream = await open(`/api/decks/${deck.deckId}/live`);
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
    const hello = await stream.next();
    expect(hello).toMatchObject({ type: 'hello', peers: [] });
    expect(hello.type === 'hello' && hello.connectionId).toEqual(expect.any(String));
  });

  it('answers 404 for decks the viewer is not a member of, without opening a stream', async () => {
    const { cookie } = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@example.com' });
    const res = await ctx.request(`/api/decks/${deck.deckId}/live`, { cookie });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const missing = await ctx.request(`/api/decks/${crypto.randomUUID()}/live`);
    expect(missing.status).toBe(404);
  });

  it('fans presence out to the others, and a goodbye drops the peer', async () => {
    const first = await open(`/api/decks/${deck.deckId}/live`);
    const firstHello = await nextOfType(first, 'hello');
    const second = await open(`/api/decks/${deck.deckId}/live`);
    const secondHello = await nextOfType(second, 'hello');
    expect(secondHello.peers.map((peer) => peer.connectionId)).toEqual([firstHello.connectionId]);
    expect((await nextOfType(first, 'peer')).peer.connectionId).toBe(secondHello.connectionId);

    const slideId = deck.slideIds[0] ?? '';
    const moved = await ctx.request(`/api/live/${secondHello.connectionId}`, {
      method: 'POST',
      json: {
        activeSlideId: slideId,
        cursor: { slideId, point: { x: 0.25, y: 0.75 } },
        focusedThreadId: null,
      },
    });
    expect(moved.status).toBe(204);
    const peer = await nextOfType(first, 'peer');
    expect(peer.peer).toMatchObject({
      connectionId: secondHello.connectionId,
      activeSlideId: slideId,
      cursor: { slideId, point: { x: 0.25, y: 0.75 } },
    });

    const bye = await ctx.request(`/api/live/${secondHello.connectionId}/leave`, {
      method: 'POST',
    });
    expect(bye.status).toBe(204);
    expect(await nextOfType(first, 'leave')).toEqual({
      type: 'leave',
      connectionId: secondHello.connectionId,
    });
  });

  it('a closed stream leaves the deck', async () => {
    const watcher = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(watcher, 'hello');
    const leaving = await open(`/api/decks/${deck.deckId}/live`);
    const hello = await nextOfType(leaving, 'hello');
    await leaving.close();
    expect(await nextOfType(watcher, 'leave')).toEqual({
      type: 'leave',
      connectionId: hello.connectionId,
    });
    const res = await ctx.request(`/api/live/${hello.connectionId}`, {
      method: 'POST',
      json: { activeSlideId: null, cursor: null, focusedThreadId: null },
    });
    expect(res.status).toBe(404);
  });

  it('nudges open viewers when comments change', async () => {
    const stream = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(stream, 'hello');
    const created = await ctx.request(`/api/decks/${deck.deckId}/comments`, {
      method: 'POST',
      json: pinComment(deck.slideIds[0] ?? ''),
    });
    expect(created.status).toBe(201);
    expect(await nextOfType(stream, 'comments')).toEqual({ type: 'comments' });
  });

  it('a reconnect of the same tab replaces its old connection', async () => {
    const watcher = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(watcher, 'hello');
    const tab = crypto.randomUUID();
    const old = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
    const oldHello = await nextOfType(old, 'hello');
    const again = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
    const againHello = await nextOfType(again, 'hello');
    expect(againHello.peers.map((p) => p.connectionId)).not.toContain(oldHello.connectionId);
    expect(await nextOfType(watcher, 'leave')).toEqual({
      type: 'leave',
      connectionId: oldHello.connectionId,
    });
  });

  it('ignores tab ids that are too short or not plain', async () => {
    for (const tab of ['short', 'a%20b%20c%20d%20e']) {
      const first = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
      const firstHello = await nextOfType(first, 'hello');
      const second = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
      const secondHello = await nextOfType(second, 'hello');
      // Without a usable tab id the first connection stays.
      expect(secondHello.peers.map((p) => p.connectionId)).toContain(firstHello.connectionId);
      await first.close();
      await second.close();
      await ctx.request(`/api/live/${firstHello.connectionId}/leave`, { method: 'POST' });
      await ctx.request(`/api/live/${secondHello.connectionId}/leave`, { method: 'POST' });
    }
  });

  it('presence for an unknown connection is a 404 with a German message; leave is always 204', async () => {
    const res = await ctx.request('/api/live/unknown', {
      method: 'POST',
      json: { activeSlideId: null, cursor: null, focusedThreadId: null },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'Diese Live-Verbindung gibt es nicht mehr.' },
    });
    expect((await ctx.request('/api/live/unknown/leave', { method: 'POST' })).status).toBe(204);
  });

  it('rejects malformed presence', async () => {
    const stream = await open(`/api/decks/${deck.deckId}/live`);
    const hello = await nextOfType(stream, 'hello');
    const bad = await ctx.request(`/api/live/${hello.connectionId}`, {
      method: 'POST',
      json: { activeSlideId: 42 },
    });
    expect(bad.status).toBe(400);
    const notJson = await ctx.request(`/api/live/${hello.connectionId}`, {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(notJson.status).toBe(400);
  });
});
