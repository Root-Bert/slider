import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LiveEvent } from '@slider/shared';
import { workspaceMembers } from '../src/db/schema';
import { LiveHub } from '../src/realtime/live-hub';
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
    expect(secondHello.peers).toHaveLength(1);
    // Peers know each other by a public id, never by the other's secret key from `hello`.
    const firstPublic = secondHello.peers[0]?.connectionId ?? '';
    const secondPublic = (await nextOfType(first, 'peer')).peer.connectionId;
    expect(firstPublic).not.toBe(firstHello.connectionId);
    expect(secondPublic).not.toBe(secondHello.connectionId);

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
      connectionId: secondPublic,
      activeSlideId: slideId,
      cursor: { slideId, point: { x: 0.25, y: 0.75 } },
    });

    const bye = await ctx.request(`/api/live/${secondHello.connectionId}/leave`, {
      method: 'POST',
    });
    expect(bye.status).toBe(204);
    expect(await nextOfType(first, 'leave')).toEqual({
      type: 'leave',
      connectionId: secondPublic,
    });
  });

  it('a closed stream leaves the deck', async () => {
    const watcher = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(watcher, 'hello');
    const leaving = await open(`/api/decks/${deck.deckId}/live`);
    const hello = await nextOfType(leaving, 'hello');
    const leavingPublic = (await nextOfType(watcher, 'peer')).peer.connectionId;
    await leaving.close();
    expect(await nextOfType(watcher, 'leave')).toEqual({
      type: 'leave',
      connectionId: leavingPublic,
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
    await nextOfType(old, 'hello');
    const oldPublic = (await nextOfType(watcher, 'peer')).peer.connectionId;
    const again = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
    const againHello = await nextOfType(again, 'hello');
    expect(againHello.peers.map((p) => p.connectionId)).not.toContain(oldPublic);
    expect(await nextOfType(watcher, 'leave')).toEqual({
      type: 'leave',
      connectionId: oldPublic,
    });
  });

  it('ignores tab ids that are too short or not plain', async () => {
    for (const tab of ['short', 'a%20b%20c%20d%20e']) {
      const first = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
      const firstHello = await nextOfType(first, 'hello');
      const second = await open(`/api/decks/${deck.deckId}/live?tab=${tab}`);
      const secondHello = await nextOfType(second, 'hello');
      // Without a usable tab id the first connection stays.
      expect(secondHello.peers).toHaveLength(1);
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

  it("a peer's public id neither moves nor ends their connection", async () => {
    const anna = await open(`/api/decks/${deck.deckId}/live`);
    const annaHello = await nextOfType(anna, 'hello');
    const ben = await open(`/api/decks/${deck.deckId}/live`);
    const benHello = await nextOfType(ben, 'hello');
    const annaPublic = benHello.peers[0]?.connectionId ?? '';
    const spoof = await ctx.request(`/api/live/${annaPublic}`, {
      method: 'POST',
      json: { activeSlideId: deck.slideIds[0] ?? null, cursor: null, focusedThreadId: null },
    });
    expect(spoof.status).toBe(404);
    await ctx.request(`/api/live/${annaPublic}/leave`, { method: 'POST' });
    // Anna's own key still works: her connection is still there.
    const own = await ctx.request(`/api/live/${annaHello.connectionId}`, {
      method: 'POST',
      json: { activeSlideId: null, cursor: null, focusedThreadId: null },
    });
    expect(own.status).toBe(204);
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

describe('live streams end', () => {
  let ctx: TestContext;
  let deck: DeckFixture;
  let hub: LiveHub;
  const streams: LiveStream[] = [];
  const open = async (url: string, cookie?: string) => {
    const stream = await openLive(ctx, url, cookie);
    streams.push(stream);
    return stream;
  };
  const ended = (stream: LiveStream) =>
    expect(nextOfType(stream, 'comments')).rejects.toThrow('Stream ended');

  beforeEach(async () => {
    hub = new LiveHub(Date.now, { heartbeatMs: 20, accessCheckMs: 50 });
    ctx = await createTestContext({ live: hub });
    deck = await createReadyDeck(ctx);
  });
  afterEach(async () => {
    await Promise.all(streams.splice(0).map((stream) => stream.close()));
    await ctx.cleanup();
  });

  it('on shutdown: closeAll ends every stream, so the server can close', async () => {
    const first = await open(`/api/decks/${deck.deckId}/live`);
    const second = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(first, 'hello');
    await nextOfType(second, 'hello');
    hub.closeAll();
    await ended(first);
    await ended(second);
    expect(hub.peers(deck.deckId)).toEqual([]);
  });

  it('when the viewer is removed from the workspace', async () => {
    const mia = await signedInUser(ctx, { name: 'Mia', email: 'mia@firma.de' });
    await ctx.deps.db
      .insert(workspaceMembers)
      .values({ workspaceId: ctx.workspaceId, userId: mia.user.id, role: 'reviewer' });
    const owner = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(owner, 'hello');
    const stream = await open(`/api/decks/${deck.deckId}/live`, mia.cookie);
    await nextOfType(stream, 'hello');
    const miaPublic = (await nextOfType(owner, 'peer')).peer.connectionId;
    await ctx.deps.db.delete(workspaceMembers).where(eq(workspaceMembers.userId, mia.user.id));

    await ended(stream);
    expect(await nextOfType(owner, 'leave')).toEqual({
      type: 'leave',
      connectionId: miaPublic,
    });
    const again = await ctx.request(`/api/decks/${deck.deckId}/live`, { cookie: mia.cookie });
    expect(again.status).toBe(404);
  });

  it('when the deck is deleted', async () => {
    const stream = await open(`/api/decks/${deck.deckId}/live`);
    await nextOfType(stream, 'hello');
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { method: 'DELETE' })).status).toBe(204);
    await ended(stream);
  });
});
