import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { reviewLinkSchema, viewerSchema, type InviteInfo, type ReviewLink } from '@slider/shared';
import {
  cookieFrom,
  createReadyDeck,
  createTestContext,
  pinComment,
  type DeckFixture,
  type TestContext,
} from './helpers';

const DAY = 24 * 60 * 60 * 1000;

let ctx: TestContext;
let deck: DeckFixture;
beforeEach(async () => {
  ctx = await createTestContext();
  deck = await createReadyDeck(ctx, { title: 'Q4 Strategie', slideCount: 2 });
});
afterEach(() => ctx.cleanup());

async function createLink(body: object = {}): Promise<ReviewLink> {
  const res = await ctx.request(`/api/decks/${deck.deckId}/review-links`, {
    method: 'POST',
    json: body,
  });
  expect(res.status).toBe(201);
  return reviewLinkSchema.parse(await res.json());
}

async function join(token: string, name = 'Lena Wolf') {
  return ctx.request(`/api/invites/${token}/join`, {
    method: 'POST',
    json: { name, email: 'lena@example.com' },
  });
}

describe('review links', () => {
  it('creates unguessable tokens and lists them for the owner', async () => {
    const link = await createLink({ expiresInDays: 7 });
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.role).toBe('view');
    expect(link.expiresAt).not.toBeNull();

    const list = reviewLinkSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deck.deckId}/review-links`)).json());
    expect(list.map((l) => l.id)).toEqual([link.id]);
  });

  it('only creates view links (BER-130)', async () => {
    const res = await ctx.request(`/api/decks/${deck.deckId}/review-links`, {
      method: 'POST',
      json: { role: 'comment' },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { code: 'bad_request', message: expect.stringMatching(/nur zum Ansehen/) },
    });
  });

  it('runs the full guest flow: invite → join → look, not comment → revoke', async () => {
    const link = await createLink();

    const info = await ctx.request(`/api/invites/${link.token}`);
    expect(info.status).toBe(200);
    expect((await info.json()) as InviteInfo).toMatchObject({
      deckTitle: 'Q4 Strategie',
      slideCount: 2,
      ownerName: 'Robert Hofmann',
      role: 'view',
    });

    const joined = await join(link.token);
    expect(joined.status).toBe(200);
    expect(joined.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect(joined.headers.get('set-cookie')).toMatch(/SameSite=Lax/i);
    const { viewer } = z.object({ viewer: viewerSchema }).parse(await joined.json());
    expect(viewer).toMatchObject({
      kind: 'guest',
      deckId: deck.deckId,
      role: 'view',
      author: { name: 'Lena Wolf', type: 'guest' },
    });
    expect(viewer.author.color).not.toBe('red');
    const guest = cookieFrom(joined);

    const me = z
      .object({ viewer: viewerSchema })
      .parse(await (await ctx.request('/api/me', { cookie: guest })).json());
    expect(me.viewer.kind).toBe('guest');

    const comment = await ctx.request(`/api/decks/${deck.deckId}/comments`, {
      method: 'POST',
      json: pinComment(deck.slideIds[0] ?? ''),
      cookie: guest,
    });
    expect(comment.status).toBe(403);
    expect(await comment.json()).toMatchObject({ error: { code: 'forbidden' } });

    expect((await ctx.request(`/api/review-links/${link.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );

    const afterRevoke = await ctx.request(`/api/decks/${deck.deckId}`, { cookie: guest });
    expect(afterRevoke.status).toBe(403);
    expect(await afterRevoke.json()).toMatchObject({ error: { code: 'link_revoked' } });

    const inviteAfterRevoke = await ctx.request(`/api/invites/${link.token}`);
    expect(inviteAfterRevoke.status).toBe(410);
    expect(await inviteAfterRevoke.json()).toMatchObject({ error: { code: 'link_revoked' } });
    expect((await join(link.token)).status).toBe(410);
  });

  it('keeps guests inside their deck and away from owner-only routes', async () => {
    const other = await createReadyDeck(ctx, { title: 'Geheim' });
    const guest = cookieFrom(await join((await createLink()).token));

    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: guest })).status).toBe(200);
    expect((await ctx.request(`/api/decks/${deck.deckId}/slides`, { cookie: guest })).status).toBe(
      200,
    );

    const forbiddenRequests: [string, RequestInit & { json?: unknown }][] = [
      [`/api/decks/${other.deckId}`, {}],
      [`/api/decks/${other.deckId}/comments`, {}],
      ['/api/decks', {}],
      [`/api/decks/${deck.deckId}`, { method: 'PATCH', json: { title: 'Gekapert' } }],
      [`/api/decks/${deck.deckId}`, { method: 'DELETE' }],
      [`/api/decks/${deck.deckId}/review-links`, {}],
      [`/api/decks/${deck.deckId}/review-links`, { method: 'POST', json: {} }],
      ['/api/decks/link', { method: 'POST', json: { url: 'https://1drv.ms/p/s!abc' } }],
    ];
    for (const [url, init] of forbiddenRequests) {
      const res = await ctx.request(url, { ...init, cookie: guest });
      expect(res.status, `${init.method ?? 'GET'} ${url}`).toBe(403);
    }
  });

  it('clears the guest cookie on leave', async () => {
    const guest = cookieFrom(await join((await createLink()).token));
    const left = await ctx.request('/api/session/leave', { method: 'POST', cookie: guest });
    expect(left.status).toBe(204);
    expect(left.headers.get('set-cookie')).toMatch(/slider_guest=;/);
  });

  it('rejects tampered cookies', async () => {
    const guest = cookieFrom(await join((await createLink()).token));
    const tampered = guest.replace(/=([^.]+)\./, '=forged.');
    const me = z
      .object({ viewer: viewerSchema })
      .parse(await (await ctx.request('/api/me', { cookie: tampered })).json());
    expect(me.viewer.kind).toBe('owner');
  });

  it('expires links', async () => {
    const link = await createLink({ expiresInDays: 1 });
    const guest = cookieFrom(await join(link.token));
    ctx.clock.advance(2 * DAY);

    const invite = await ctx.request(`/api/invites/${link.token}`);
    expect(invite.status).toBe(410);
    expect(await invite.json()).toMatchObject({ error: { code: 'link_expired' } });
    expect((await ctx.request(`/api/decks/${deck.deckId}`, { cookie: guest })).status).toBe(403);
  });

  it('answers 404 for unknown tokens', async () => {
    const res = await ctx.request('/api/invites/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('rate-limits the invite endpoints', async () => {
    const limited = await createTestContext({ config: { inviteRateLimit: 3 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++)
        statuses.push((await limited.request('/api/invites/unknown')).status);
      expect(statuses).toEqual([404, 404, 404, 429]);
    } finally {
      await limited.cleanup();
    }
  });
});
