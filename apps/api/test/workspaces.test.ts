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
import { RecordingMailer } from '../src/mail/mailer';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type TestContext,
} from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

let ctx: TestContext;
let mailer: RecordingMailer;
beforeEach(async () => {
  mailer = new RecordingMailer();
  ctx = await createTestContext({ mailer });
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
  it('the dev owner has "Mein Workspace"; anyone signed in can create more', async () => {
    const me = (await (await ctx.request('/api/me')).json()) as MeResponse;
    expect(me.workspaces).toEqual([
      expect.objectContaining({ id: ctx.workspaceId, name: 'Mein Workspace', role: 'owner' }),
    ]);

    const res = await ctx.request('/api/workspaces', { method: 'POST', json: { name: 'Q4 Team' } });
    expect(res.status).toBe(201);
    const created = workspaceSchema.parse(await res.json());
    expect(created).toMatchObject({
      name: 'Q4 Team',
      slug: 'q4-team',
      role: 'owner',
      memberCount: 1,
    });
    const again = workspaceSchema.parse(
      await (
        await ctx.request('/api/workspaces', { method: 'POST', json: { name: 'Q4 Team' } })
      ).json(),
    );
    expect(again.slug).toBe('q4-team-2');
    expect(
      workspaceSchema.array().parse(await (await ctx.request('/api/workspaces')).json()),
    ).toHaveLength(3);
  });

  it('renames (admin+), deletes (owner only, with decks and files) and hides from outsiders', async () => {
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
    expect((await ctx.request(path, { method: 'DELETE', cookie: admin.cookie })).status).toBe(403);
    expect((await ctx.request(path, { method: 'DELETE' })).status).toBe(204);
    expect(await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId))).toEqual([]);
    expect(await ctx.deps.storage.get(imageKeys[0] ?? '')).toBeNull();
    expect((await ctx.request(path)).status).toBe(404);
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
    expect(
      (await ctx.request(`/api/decks/${deckId}/review-links`, { cookie: reviewer.cookie })).status,
    ).toBe(403);
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
    expect(
      (
        await ctx.request(`/api/decks/${ownersDeck}/review-links`, {
          method: 'POST',
          json: {},
          cookie: memberA.cookie,
        })
      ).status,
    ).toBe(403);

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

  it('uploads without workspaceId go to the first workspace (old clients)', async () => {
    const res = await upload(undefined);
    expect(res.status).toBe(201);
    expect(deckSchema.parse(await res.json()).workspaceId).toBe(ctx.workspaceId);
  });
});

describe('members', () => {
  it('lists members; admins change roles below owner; only owners appoint owners', async () => {
    const admin = await member('Ada', 'admin');
    const memberA = await member('Mia', 'member');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const setRole = (userId: string, role: WorkspaceRole, cookie?: string) =>
      ctx.request(`${base}/${userId}`, { method: 'PATCH', json: { role }, cookie });

    const list = workspaceMemberSchema
      .array()
      .parse(await (await ctx.request(base, { cookie: memberA.cookie })).json());
    expect(list.map((m) => [m.name, m.role])).toEqual([
      ['Robert Hofmann', 'owner'],
      ['Ada', 'admin'],
      ['Mia', 'member'],
    ]);

    expect((await setRole(memberA.user.id, 'reviewer', memberA.cookie)).status).toBe(403);
    expect((await setRole(memberA.user.id, 'admin', admin.cookie)).status).toBe(200);
    expect((await setRole(memberA.user.id, 'owner', admin.cookie)).status).toBe(403);
    expect((await setRole(ctx.ownerId, 'member', admin.cookie)).status).toBe(403);
    // The last owner cannot step down …
    const last = await setRole(ctx.ownerId, 'admin');
    expect(last.status).toBe(400);
    expect(await json(last)).toMatchObject({ error: { code: 'bad_request' } });
    // … until there is another one.
    expect((await setRole(admin.user.id, 'owner')).status).toBe(200);
    expect((await setRole(ctx.ownerId, 'admin')).status).toBe(200);
  });

  it('admins remove members; everyone may leave except the last owner', async () => {
    const admin = await member('Ada', 'admin');
    const reviewer = await member('Rita', 'reviewer');
    const memberA = await member('Mia', 'member');
    const base = `/api/workspaces/${ctx.workspaceId}/members`;
    const remove = (userId: string, cookie?: string) =>
      ctx.request(`${base}/${userId}`, { method: 'DELETE', cookie });

    expect((await remove(reviewer.user.id, memberA.cookie)).status).toBe(403);
    expect((await remove(reviewer.user.id, admin.cookie)).status).toBe(204);
    expect((await remove(ctx.ownerId, admin.cookie)).status).toBe(403);
    expect((await remove(memberA.user.id, memberA.cookie)).status).toBe(204);
    expect((await remove(ctx.ownerId)).status).toBe(400);
    expect(
      (await ctx.request(`/api/workspaces/${ctx.workspaceId}`, { cookie: memberA.cookie })).status,
    ).toBe(404);
  });
});

describe('invitations', () => {
  it('e-mail invites: mail with the link, preview, address must match, single use', async () => {
    const created = await invite({ email: 'Lena@Firma.de', role: 'reviewer' });
    expect(created.emailSent).toBe(true);
    expect(created.invite).toMatchObject({
      email: 'lena@firma.de',
      role: 'reviewer',
      state: 'valid',
    });
    expect(created.url).toMatch(/^http:\/\/localhost:5173\/join\/[\w-]{43}$/);
    expect(mailer.sent[0]).toMatchObject({ to: 'lena@firma.de' });
    expect(mailer.sent[0]?.text).toContain(created.url);
    // Only the hash is stored.
    const [row] = await ctx.deps.db.select().from(workspaceInvites);
    expect(row?.tokenHash).not.toBe(created.token);
    expect(new Date(row!.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * DAY_MS);

    const preview = joinPreviewSchema.parse(
      await (await ctx.request(`/api/join/${created.token}`)).json(),
    );
    expect(preview).toEqual({
      workspaceName: 'Mein Workspace',
      inviterName: 'Robert Hofmann',
      role: 'reviewer',
      email: 'l…a@firma.de',
      state: 'valid',
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

  it('link invites are multi-use until revoked', async () => {
    const created = await invite({ role: 'member' });
    expect(created.emailSent).toBe(false);
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
    const late = await signedInUser(ctx, { name: 'Cleo', email: 'cleo@extern.de' });
    const res = await ctx.request(`/api/join/${created.token}`, {
      method: 'POST',
      cookie: late.cookie,
    });
    expect(res.status).toBe(410);
    expect(await json(res)).toMatchObject({ error: { code: 'link_revoked' } });
  });

  it('link invites expire after 30 days', async () => {
    const created = await invite({});
    ctx.clock.advance(31 * DAY_MS);
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

  it('pending e-mail invites show up in /me and can be accepted there', async () => {
    const created = await invite({ email: 'lena@firma.de', role: 'member' });
    const lena = await signedInUser(ctx, { name: 'Lena', email: 'lena@firma.de' });
    const me = (await (await ctx.request('/api/me', { cookie: lena.cookie })).json()) as MeResponse;
    expect(me.pendingInvites).toEqual([
      expect.objectContaining({
        id: created.invite.id,
        workspaceName: 'Mein Workspace',
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
