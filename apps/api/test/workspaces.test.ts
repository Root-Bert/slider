import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createdWorkspaceInviteSchema,
  deckSchema,
  joinPreviewSchema,
  workspaceMemberSchema,
  workspaceSchema,
  type MeResponse,
  type WorkspaceRole,
} from '@slider/shared';
import { decks, workspaceInvites, workspaceMembers } from '../src/db/schema';
import { FailingMailer, RecordingMailer } from '../src/mail/mailer';
import { INVITE_MAILS_PER_HOUR } from '../src/routes/workspaces';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type TestContext,
} from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

/** A signed-in person with `role` in the dev owner's workspace. */
async function member(name: string, role: WorkspaceRole) {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}

const upload = (cookie: string | undefined, workspaceId?: string) => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Neu.pptx'));
  if (workspaceId) form.append('workspaceId', workspaceId);
  return ctx.request('/api/decks/upload', { method: 'POST', body: form, cookie });
};

const invite = async (body: { email?: string; role?: string }, cookie?: string) => {
  const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
    method: 'POST',
    json: body,
    cookie,
  });
  expect(res.status).toBe(201);
  const created = createdWorkspaceInviteSchema.parse(await res.json());
  return { ...created, token: new URL(created.url).pathname.split('/').pop() ?? '' };
};

describe('workspaces', () => {
  it('the dev owner has "Meine Organisation"; others found their own', async () => {
    const me = (await (await ctx.request('/api/me')).json()) as MeResponse;
    expect(me.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, name: 'Meine Organisation', role: 'admin' }),
    ]);
    // One self-founded organisation per account (BER-130).
    expect(me.limits).toEqual({ canCreateWorkspace: false });

    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    const res = await ctx.request('/api/workspaces', {
      method: 'POST',
      json: { name: 'Q4 Team' },
      cookie: anna.cookie,
    });
    expect(res.status).toBe(201);
    const created = workspaceSchema.parse(await res.json());
    expect(created).toMatchObject({
      name: 'Q4 Team',
      slug: 'q4-team',
      role: 'admin',
      memberCount: 1,
      plan: 'free',
      usage: { members: 1, seatsUsed: 1, maxMembers: 5, decks: 0, maxDecks: 3 },
    });
    const ben = await signedInUser(ctx, { name: 'Ben', email: 'ben@firma.de' });
    const again = workspaceSchema.parse(
      await (
        await ctx.request('/api/workspaces', {
          method: 'POST',
          json: { name: 'Q4 Team' },
          cookie: ben.cookie,
        })
      ).json(),
    );
    expect(again.slug).toBe('q4-team-2');
    expect(
      workspaceSchema
        .array()
        .parse(await (await ctx.request('/api/workspaces', { cookie: anna.cookie })).json()),
    ).toHaveLength(1);
  });

  it('renames and deletes (admins, with decks and files) and hides from outsiders', async () => {
    const admin = await member('Ada', 'admin');
    const reviewer = await member('Rita', 'reviewer');
    const outsider = await signedInUser(ctx, { name: 'Otto', email: 'otto@example.com' });
    const path = `/api/workspaces/${ctx.workspaceId}`;

    expect((await ctx.request(path, { cookie: outsider.cookie })).status).toBe(404);
    expect(
      (await ctx.request(path, { method: 'PATCH', json: { name: 'X' }, cookie: reviewer.cookie }))
        .status,
    ).toBe(403);
    const renamed = await ctx.request(path, {
      method: 'PATCH',
      json: { name: 'Marketing' },
      cookie: admin.cookie,
    });
    expect(workspaceSchema.parse(await renamed.json())).toMatchObject({
      name: 'Marketing',
      role: 'admin',
      memberCount: 3,
    });

    const { deckId, imageKeys } = await createReadyDeck(ctx);
    expect((await ctx.request(path, { method: 'DELETE', cookie: reviewer.cookie })).status).toBe(
      403,
    );
    // Any admin may delete it, not only its creator.
    expect((await ctx.request(path, { method: 'DELETE', cookie: admin.cookie })).status).toBe(204);
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId))).toEqual([]);
    expect(await ctx.deps.storage.get(imageKeys[0] ?? '')).toBeNull();
    expect((await ctx.request(path)).status).toBe(404);
  });

  it('admins upload, replace and remove the logo; others may not', async () => {
    const admin = await member('Ada', 'admin');
    const memberUser = await member('Mia', 'member');
    const path = `/api/workspaces/${ctx.workspaceId}/logo`;
    const put = (bytes: number[], cookie?: string) => {
      const form = new FormData();
      form.append('file', new File([new Uint8Array(bytes)], 'logo.png'));
      return ctx.request(path, { method: 'PUT', body: form, cookie });
    };
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const keyOf = (url: string | null) => url?.replace(/^\/files\/|\?.*$/g, '') ?? '';

    expect((await put(png, memberUser.cookie)).status).toBe(403);
    expect((await put([0x3c, 0x73, 0x76, 0x67], admin.cookie)).status).toBe(400);

    const first = workspaceSchema.parse(await (await put(png, admin.cookie)).json());
    expect(first.logoUrl).toMatch(/^\/files\/workspaces\/.+\/logo-.+\.png\?exp=\d+&sig=/);
    expect(await ctx.deps.storage.get(keyOf(first.logoUrl))).not.toBeNull();

    const second = workspaceSchema.parse(await (await put(png, admin.cookie)).json());
    expect(second.logoUrl).not.toBe(first.logoUrl);
    expect(await ctx.deps.storage.get(keyOf(first.logoUrl))).toBeNull();

    expect((await ctx.request(path, { method: 'DELETE', cookie: memberUser.cookie })).status).toBe(
      403,
    );
    const removed = await ctx.request(path, { method: 'DELETE', cookie: admin.cookie });
    expect(workspaceSchema.parse(await removed.json()).logoUrl).toBeNull();
    expect(await ctx.deps.storage.get(keyOf(second.logoUrl))).toBeNull();
  });
});

describe('deck rights by role', () => {
  it('reviewers view and comment but cannot create or manage', async () => {
    const reviewer = await member('Rita', 'reviewer');
    const { deckId, slideIds } = await createReadyDeck(ctx);
    const deck = deckSchema.parse(
      await (await ctx.request(`/api/decks/${deckId}`, { cookie: reviewer.cookie })).json(),
    );
    expect(deck).toMatchObject({
      workspaceId: ctx.workspaceId,
      permissions: { canManage: false, canComment: true },
    });
    const comment = await ctx.request(`/api/decks/${deckId}/comments`, {
      method: 'POST',
      json: pinComment(slideIds[0] ?? ''),
      cookie: reviewer.cookie,
    });
    expect(comment.status).toBe(201);
    expect(
      (
        await ctx.request(`/api/decks/${deckId}`, {
          method: 'PATCH',
          json: { title: 'X' },
          cookie: reviewer.cookie,
        })
      ).status,
    ).toBe(403);
    expect((await upload(reviewer.cookie, ctx.workspaceId)).status).toBe(403);
  });

  it('members create decks and manage their own, not other people’s', async () => {
    const memberA = await member('Mia', 'member');
    const { deckId: ownersDeck } = await createReadyDeck(ctx);
    const res = await upload(memberA.cookie, ctx.workspaceId);
    expect(res.status).toBe(201);
    const own = deckSchema.parse(await res.json());
    expect(own).toMatchObject({
      workspaceId: ctx.workspaceId,
      permissions: { canManage: true, canComment: true },
    });
    await ctx.deps.queue.idle();

    const rename = (id: string) =>
      ctx.request(`/api/decks/${id}`, {
        method: 'PATCH',
        json: { title: 'Neu' },
        cookie: memberA.cookie,
      });
    expect((await rename(own.id)).status).toBe(200);
    expect((await rename(ownersDeck)).status).toBe(403);

    const list = deckSchema
      .array()
      .parse(
        await (
          await ctx.request(`/api/decks?workspaceId=${ctx.workspaceId}`, { cookie: memberA.cookie })
        ).json(),
      );
    expect(Object.fromEntries(list.map((d) => [d.id, d.permissions.canManage]))).toEqual({
      [own.id]: true,
      [ownersDeck]: false,
    });
  });

  it('admins manage every deck and every comment', async () => {
    const admin = await member('Ada', 'admin');
    const memberA = await member('Mia', 'member');
    const { deckId, slideIds } = await createReadyDeck(ctx);
    const comment = await json(
      await ctx.request(`/api/decks/${deckId}/comments`, {
        method: 'POST',
        json: pinComment(slideIds[0] ?? ''),
        cookie: memberA.cookie,
      }),
    );
    expect(
      (
        await ctx.request(`/api/decks/${deckId}`, {
          method: 'PATCH',
          json: { archived: true },
          cookie: admin.cookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await ctx.request(`/api/comments/${String(comment.id)}`, {
          method: 'DELETE',
          cookie: admin.cookie,
        })
      ).status,
    ).toBe(204);
  });

  it('non-members get 404 for decks and deck lists', async () => {
    const outsider = await signedInUser(ctx, { name: 'Otto', email: 'otto@example.com' });
    const { deckId } = await createReadyDeck(ctx);
    expect((await ctx.request(`/api/decks/${deckId}`, { cookie: outsider.cookie })).status).toBe(
      404,
    );
    expect(
      (await ctx.request(`/api/decks?workspaceId=${ctx.workspaceId}`, { cookie: outsider.cookie }))
        .status,
    ).toBe(404);
    expect(await (await ctx.request('/api/decks', { cookie: outsider.cookie })).json()).toEqual([]);
    expect((await upload(outsider.cookie, ctx.workspaceId)).status).toBe(404);
  });

  it('every managing deck route: 403 for reviewers and other people’s members, 404 for outsiders', async () => {
    const reviewer = await member('Rita', 'reviewer');
    const memberA = await member('Mia', 'member');
    const outsider = await signedInUser(ctx, { name: 'Otto', email: 'otto@example.com' });
    const { deckId } = await createReadyDeck(ctx);
    const newVersion = () => {
      const form = new FormData();
      form.append('file', new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Neu.pptx'));
      return form;
    };
    const routes: [string, string, () => RequestInit & { json?: unknown }][] = [
      ['DELETE', `/api/decks/${deckId}`, () => ({})],
      ['POST', `/api/decks/${deckId}/revisions`, () => ({ body: newVersion() })],
      ['POST', `/api/decks/${deckId}/rerender`, () => ({})],
      ['PATCH', `/api/decks/${deckId}`, () => ({ json: { title: 'X' } })],
    ];
    for (const [method, url, init] of routes) {
      const as = async (cookie: string) =>
        (await ctx.request(url, { method, cookie, ...init() })).status;
      expect(await as(reviewer.cookie), `${method} ${url} as reviewer`).toBe(403);
      expect(await as(memberA.cookie), `${method} ${url} as member`).toBe(403);
      expect(await as(outsider.cookie), `${method} ${url} as outsider`).toBe(404);
    }
    // Nothing happened to the deck.
    const deck = deckSchema.parse(await (await ctx.request(`/api/decks/${deckId}`)).json());
    expect(deck).toMatchObject({ id: deckId, revisionNumber: 1 });
  });

  it('every read route of a deck is a 404 for outsiders', async () => {
    const outsider = await signedInUser(ctx, { name: 'Otto', email: 'otto@example.com' });
    const { deckId, revisionId, slideIds } = await createReadyDeck(ctx);
    for (const url of [
      `/api/decks/${deckId}/status`,
      `/api/decks/${deckId}/revisions`,
      `/api/decks/${deckId}/revisions/${revisionId}/diff`,
      `/api/decks/${deckId}/deleted-slides`,
      `/api/decks/${deckId}/slides/${slideIds[0] ?? ''}/versions`,
      `/api/decks/${deckId}/media-usage`,
      `/api/decks/${deckId}/people`,
      `/api/decks/${deckId}/slides`,
    ]) {
      expect((await ctx.request(url, { cookie: outsider.cookie })).status, url).toBe(404);
      expect((await ctx.request(url)).status, `${url} as owner`).not.toBe(404);
    }
  });

  it('folders: reviewers may not rename or delete them, outsiders do not see them', async () => {
    const reviewer = await member('Rita', 'reviewer');
    const memberA = await member('Mia', 'member');
    const outsider = await signedInUser(ctx, { name: 'Otto', email: 'otto@example.com' });
    const created = await ctx.request(`/api/workspaces/${ctx.workspaceId}/folders`, {
      method: 'POST',
      json: { name: 'Vertrieb' },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const rename = (cookie: string) =>
      ctx.request(`/api/folders/${id}`, { method: 'PATCH', json: { name: 'X' }, cookie });
    const remove = (cookie: string) =>
      ctx.request(`/api/folders/${id}`, { method: 'DELETE', cookie });
    expect((await rename(reviewer.cookie)).status).toBe(403);
    expect((await remove(reviewer.cookie)).status).toBe(403);
    expect((await rename(outsider.cookie)).status).toBe(404);
    expect((await remove(outsider.cookie)).status).toBe(404);
    expect((await rename(memberA.cookie)).status).toBe(200);
    expect((await remove(memberA.cookie)).status).toBe(204);
  });

  it('uploads without workspaceId go to the first workspace (old clients)', async () => {
    const res = await upload(undefined);
    expect(res.status).toBe(201);
    expect(deckSchema.parse(await res.json()).workspaceId).toBe(ctx.workspaceId);
  });
});

describe('members', () => {
  it('lists members with the creator; admins change every role', async () => {
    const admin = await member('Ada', 'admin');
    const memberA = await member('Mia', 'member');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const setRole = (userId: string, role: WorkspaceRole, cookie?: string) =>
      ctx.request(`${base}/${userId}`, { method: 'PATCH', json: { role }, cookie });

    const list = workspaceMemberSchema
      .array()
      .parse(await (await ctx.request(base, { cookie: memberA.cookie })).json());
    expect(list.map((m) => [m.name, m.role, m.isCreator])).toEqual([
      ['Robert Hofmann', 'admin', true],
      ['Ada', 'admin', false],
      ['Mia', 'member', false],
    ]);

    expect((await setRole(memberA.user.id, 'reviewer', memberA.cookie)).status).toBe(403);
    expect((await setRole(memberA.user.id, 'admin', admin.cookie)).status).toBe(200);
    // Admins may demote other admins, the creator too.
    expect((await setRole(ctx.ownerId, 'member', admin.cookie)).status).toBe(200);
    expect((await setRole(memberA.user.id, 'member', admin.cookie)).status).toBe(200);
    // The last admin cannot step down …
    const last = await setRole(admin.user.id, 'member', admin.cookie);
    expect(last.status).toBe(400);
    expect(await json(last)).toMatchObject({ error: { code: 'bad_request' } });
    // … until there is another one.
    expect((await setRole(memberA.user.id, 'admin', admin.cookie)).status).toBe(200);
    expect((await setRole(admin.user.id, 'member', admin.cookie)).status).toBe(200);
  });

  it('admins remove members; everyone may leave except the last admin', async () => {
    const reviewer = await member('Rita', 'reviewer');
    const memberA = await member('Mia', 'member');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const remove = (userId: string, cookie?: string) =>
      ctx.request(`${base}/${userId}`, { method: 'DELETE', cookie });

    expect((await remove(reviewer.user.id, memberA.cookie)).status).toBe(403);
    expect((await remove(reviewer.user.id)).status).toBe(204);
    expect((await remove(memberA.user.id, memberA.cookie)).status).toBe(204);
    expect((await remove(ctx.ownerId)).status).toBe(400);
    expect(
      (await ctx.request(`/api/workspaces/${ctx.workspaceId}`, { cookie: memberA.cookie })).status,
    ).toBe(404);
  });

  it('the last admin leaves by handing the organisation to a successor', async () => {
    const memberA = await member('Mia', 'member');
    const reviewer = await member('Rita', 'reviewer');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const leave = (successor: string, cookie?: string, who = ctx.ownerId) =>
      ctx.request(`${base}/${who}?successor=${successor}`, { method: 'DELETE', cookie });

    expect((await leave('nobody')).status).toBe(404);
    expect((await leave(ctx.ownerId)).status).toBe(400);
    // Only admins appoint admins, and only for themselves.
    expect((await leave(reviewer.user.id, memberA.cookie, memberA.user.id)).status).toBe(403);
    expect((await leave(memberA.user.id, undefined, reviewer.user.id)).status).toBe(400);

    expect((await leave(memberA.user.id)).status).toBe(204);
    const rows = await ctx.deps.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, ctx.workspaceId));
    expect(rows.map((row) => [row.userId, row.role]).sort()).toEqual(
      [
        [memberA.user.id, 'admin'],
        [reviewer.user.id, 'reviewer'],
      ].sort(),
    );
  });

  const admins = async () =>
    (
      await ctx.deps.db
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    ).filter((row) => row.role === 'admin');

  it('two admins demoting each other at once leave one admin', async () => {
    const other = await member('Olga', 'admin');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const results = await Promise.all([
      ctx.request(`${base}/${other.user.id}`, { method: 'PATCH', json: { role: 'member' } }),
      ctx.request(`${base}/${ctx.ownerId}`, {
        method: 'PATCH',
        json: { role: 'member' },
        cookie: other.cookie,
      }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 403]); // the loser is no admin any more
    expect(await admins()).toHaveLength(1);
  });

  it('two admins leaving at once leave one admin', async () => {
    const other = await member('Olga', 'admin');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const results = await Promise.all([
      ctx.request(`${base}/${ctx.ownerId}`, { method: 'DELETE' }),
      ctx.request(`${base}/${other.user.id}`, { method: 'DELETE', cookie: other.cookie }),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([204, 400]);
    expect(await admins()).toHaveLength(1);
  });
});

describe('invitations', () => {
  it('e-mail invites: an address-bound link, preview, address must match, single use', async () => {
    const created = await invite({ email: 'Lena@Firma.de', role: 'reviewer' });
    expect(created.invite).toMatchObject({
      email: 'lena@firma.de',
      role: 'reviewer',
      state: 'valid',
    });
    expect(created.url).toMatch(/^http:\/\/localhost:5173\/join\/[\w-]{43}$/);
    // Only the hash is stored.
    const [row] = await ctx.deps.db.select().from(workspaceInvites);
    expect(row?.tokenHash).not.toBe(created.token);
    expect(new Date(row!.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * DAY_MS);

    const preview = joinPreviewSchema.parse(
      await (await ctx.request(`/api/join/${created.token}`)).json(),
    );
    expect(preview).toEqual({
      workspaceName: 'Meine Organisation',
      workspaceLogoUrl: null,
      inviterName: 'Robert Hofmann',
      role: 'reviewer',
      email: 'l…a@firma.de',
      state: 'valid',
      deck: null,
    });

    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    const wrong = await ctx.request(`/api/join/${created.token}`, {
      method: 'POST',
      cookie: max.cookie,
    });
    expect(wrong.status).toBe(403);
    expect(await json(wrong)).toMatchObject({
      error: { message: expect.stringContaining('Diese Einladung gilt für l…a@firma.de') },
    });

    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const join = await ctx.request(`/api/join/${created.token}`, {
      method: 'POST',
      cookie: lena.cookie,
    });
    expect(join.status).toBe(200);
    expect(await json(join)).toMatchObject({
      workspace: { id: ctx.workspaceId, role: 'reviewer' },
    });
    // Idempotent for Lena, used for everyone else.
    expect(
      (await ctx.request(`/api/join/${created.token}`, { method: 'POST', cookie: lena.cookie }))
        .status,
    ).toBe(200);
    expect(
      (await (await ctx.request(`/api/join/${created.token}`)).json()) as { state: string },
    ).toMatchObject({ state: 'used' });
  });

  it('two accepts at once (two tabs, a retry) both succeed and join once', async () => {
    const created = await invite({ role: 'member' });
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@extern.de' });
    const accept = () =>
      ctx.request(`/api/join/${created.token}`, { method: 'POST', cookie: anna.cookie });
    const results = await Promise.all([accept(), accept()]);
    expect(results.map((res) => res.status)).toEqual([200, 200]);
    const memberships = await ctx.deps.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, anna.user.id));
    expect(memberships).toHaveLength(1);
    const listed = await json(await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`));
    expect(listed).toEqual([expect.objectContaining({ id: created.invite.id, useCount: 1 })]);
  });

  it('link invites are multi-use until revoked', async () => {
    const created = await invite({ role: 'member' });
    expect(created.invite.email).toBeNull();
    for (const name of ['Anna', 'Ben']) {
      const person = await signedInUser(ctx, { name, email: `${name}@extern.de` });
      const res = await ctx.request(`/api/join/${created.token}`, {
        method: 'POST',
        cookie: person.cookie,
      });
      expect(res.status).toBe(200);
    }
    const listed = await json(await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`));
    expect(listed).toEqual([expect.objectContaining({ id: created.invite.id, useCount: 2 })]);

    expect(
      (await ctx.request(`/api/workspace-invites/${created.invite.id}`, { method: 'DELETE' }))
        .status,
    ).toBe(204);
    // Revoked invites drop out of the list.
    expect(await json(await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`))).toEqual([]);
    const late = await signedInUser(ctx, { name: 'Cleo', email: 'cleo@extern.de' });
    const res = await ctx.request(`/api/join/${created.token}`, {
      method: 'POST',
      cookie: late.cookie,
    });
    expect(res.status).toBe(410);
    expect(await json(res)).toMatchObject({ error: { code: 'link_revoked' } });
  });

  it('link invites expire after 7 days', async () => {
    const created = await invite({});
    ctx.clock.advance(8 * DAY_MS);
    const person = await signedInUser(ctx, { name: 'Anna', email: 'anna@extern.de' });
    const res = await ctx.request(`/api/join/${created.token}`, {
      method: 'POST',
      cookie: person.cookie,
    });
    expect(res.status).toBe(410);
    expect(await json(res)).toMatchObject({ error: { code: 'link_expired' } });
    expect(await json(await ctx.request(`/api/join/${created.token}`))).toMatchObject({
      state: 'expired',
    });
  });

  it('joining again never downgrades a role', async () => {
    const admin = await member('Ada', 'admin');
    const created = await invite({ role: 'reviewer' });
    const res = await ctx.request(`/api/join/${created.token}`, {
      method: 'POST',
      cookie: admin.cookie,
    });
    expect(await json(res)).toMatchObject({ workspace: { role: 'admin' } });
  });

  it('only admins invite; reviewers and outsiders cannot, guests need a login', async () => {
    const reviewer = await member('Rita', 'reviewer');
    const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
      method: 'POST',
      json: { role: 'member' },
      cookie: reviewer.cookie,
    });
    expect(res.status).toBe(403);
    expect(
      (await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, { cookie: reviewer.cookie }))
        .status,
    ).toBe(403);
    expect((await ctx.request('/api/join/unknown-token-unknown-token')).status).toBe(404);
  });

  it("removing or demoting an admin revokes their invites, so they can't rejoin", async () => {
    const bob = await member('Bob', 'admin');
    const carl = await member('Carl', 'admin');
    const bobLink = await invite({ role: 'admin' }, bob.cookie);
    const bobMail = await invite({ email: 'bob.privat@extern.de', role: 'admin' }, bob.cookie);
    const carlLink = await invite({ role: 'member' }, carl.cookie);
    const mine = await invite({ role: 'member' });

    expect(
      (
        await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${bob.user.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${carl.user.id}`, {
          method: 'PATCH',
          json: { role: 'member' },
        })
      ).status,
    ).toBe(200);

    const join = (token: string, cookie: string) =>
      ctx.request(`/api/join/${token}`, { method: 'POST', cookie });
    const back = await join(bobLink.token, bob.cookie);
    expect(back.status).toBe(410);
    expect(await json(back)).toMatchObject({ error: { code: 'link_revoked' } });
    const privat = await signedInUser(ctx, { name: 'Bob privat', email: 'bob.privat@extern.de' });
    expect((await join(bobMail.token, privat.cookie)).status).toBe(410);
    expect((await join(carlLink.token, privat.cookie)).status).toBe(410);
    // Invites of the remaining admin keep working.
    expect((await join(mine.token, privat.cookie)).status).toBe(200);

    const listed = (await json(
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`),
    )) as unknown as { id: string }[];
    expect(listed.map((row) => row.id)).toEqual([mine.invite.id]);
  });

  it('an invite whose creator is no admin any more is refused, even if never revoked', async () => {
    const bob = await member('Bob', 'admin');
    const link = await invite({ role: 'admin' }, bob.cookie);
    // As if he had been demoted before invites were revoked on demotion.
    await ctx.deps.db
      .update(workspaceMembers)
      .set({ role: 'reviewer' })
      .where(eq(workspaceMembers.userId, bob.user.id));
    expect(await json(await ctx.request(`/api/join/${link.token}`))).toMatchObject({
      state: 'revoked',
    });
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@extern.de' });
    const res = await ctx.request(`/api/join/${link.token}`, {
      method: 'POST',
      cookie: anna.cookie,
    });
    expect(res.status).toBe(410);
    expect(await json(res)).toMatchObject({ error: { code: 'link_revoked' } });
    // Bob himself stays a reviewer: his old link grants nothing.
    const own = await ctx.request(`/api/join/${link.token}`, {
      method: 'POST',
      cookie: bob.cookie,
    });
    expect(await json(own)).toMatchObject({ workspace: { role: 'reviewer' } });
  });

  it('pending e-mail invites show up in /me and can be accepted there', async () => {
    const created = await invite({ email: 'lena@firma.de', role: 'member' });
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const me = (await (await ctx.request('/api/me', { cookie: lena.cookie })).json()) as MeResponse;
    expect(me.pendingInvites).toEqual([
      expect.objectContaining({
        id: created.invite.id,
        workspaceName: 'Meine Organisation',
        inviterName: 'Robert Hofmann',
        role: 'member',
      }),
    ]);
    const max = await signedInUser(ctx, { name: 'Max', email: 'max@firma.de' });
    const accept = (cookie: string) =>
      ctx.request(`/api/workspace-invites/${created.invite.id}/accept`, { method: 'POST', cookie });
    expect((await accept(max.cookie)).status).toBe(404);
    expect((await accept(lena.cookie)).status).toBe(200);
    const after = (await (
      await ctx.request('/api/me', { cookie: lena.cookie })
    ).json()) as MeResponse;
    expect(after.pendingInvites).toEqual([]);
    expect(after.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, role: 'member' }),
    ]);
  });
});

describe('invitation mails', () => {
  it('without SMTP nothing is sent and the link is shown to copy', async () => {
    const created = await invite({ email: 'lena@firma.de' });
    expect(created.emailSent).toBe(false);
  });

  it("mails e-mail invites with the link, without the inviter's address", async () => {
    const mailer = new RecordingMailer();
    await ctx.cleanup();
    ctx = await createTestContext({ mailer });
    const created = await invite({ email: 'Lena@Firma.de', role: 'reviewer' });
    expect(created.emailSent).toBe(true);
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail).toMatchObject({
      to: 'lena@firma.de',
      subject: 'Robert Hofmann lädt dich zu „Meine Organisation“ ein',
    });
    expect(mail?.text).toContain(created.url);
    expect(mail?.html).toContain(`href="${created.url}"`);
    expect(JSON.stringify(mail)).not.toContain('robert@q4-team.de');
    // The logo travels inline with the mail.
    expect(mail?.html).toContain('src="cid:slider-logo"');
    expect(mail?.attachments).toEqual([
      expect.objectContaining({ cid: 'slider-logo', contentType: 'image/png' }),
    ]);

    // Links are passed on by hand, never mailed.
    expect((await invite({})).emailSent).toBe(false);
    expect(mailer.sent).toHaveLength(1);
  });

  it('caps invite mails per account and hour, even to the same address; links stay open', async () => {
    const mailer = new RecordingMailer();
    await ctx.cleanup();
    ctx = await createTestContext({ mailer, config: { limited: true } });
    for (let i = 0; i < INVITE_MAILS_PER_HOUR.limited; i++) {
      await invite({ email: 'lena@firma.de' });
    }
    const send = () =>
      ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
        method: 'POST',
        json: { email: 'lena@firma.de' },
      });
    const refused = await send();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mailer.sent).toHaveLength(INVITE_MAILS_PER_HOUR.limited);
    expect(await ctx.deps.db.select().from(workspaceInvites)).toHaveLength(
      INVITE_MAILS_PER_HOUR.limited,
    );

    expect((await invite({})).emailSent).toBe(false);
    ctx.clock.advance(60 * 60 * 1000);
    expect((await send()).status).toBe(201);
  });

  it('keeps the invite when the mail server refuses, so the link can be sent by hand', async () => {
    await ctx.cleanup();
    ctx = await createTestContext({ mailer: new FailingMailer() });
    const created = await invite({ email: 'lena@firma.de' });
    expect(created.emailSent).toBe(false);
    expect(created.invite.state).toBe('valid');
    expect(await ctx.deps.db.select().from(workspaceInvites)).toHaveLength(1);
  });
});

describe('no deck sharing', () => {
  it('has no share endpoint: people join only through the organisation’s invites', async () => {
    const { deckId } = await createReadyDeck(ctx);
    const res = await ctx.request(`/api/decks/${deckId}/share`, { method: 'POST', json: {} });
    expect(res.status).toBe(404);
    expect((await ctx.request(`/api/decks/${deckId}/share`)).status).toBe(404);
  });

  it('only admins revoke invites', async () => {
    const mia = await member('Mia', 'member');
    const created = await invite({});
    const revoke = (cookie?: string) =>
      ctx.request(`/api/workspace-invites/${created.invite.id}`, { method: 'DELETE', cookie });
    expect((await revoke(mia.cookie)).status).toBe(403);
    expect((await revoke()).status).toBe(204);
  });
});
