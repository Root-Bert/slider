import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createdWorkspaceInviteSchema, type MeResponse, type Workspace } from '@slider/shared';
import type { Config } from '../src/config';
import { emailHash } from '../src/crypto/content-crypto';
import { decks, workspaceInvites, workspaceRemovals, workspaces } from '../src/db/schema';
import { deleteAccount } from '../src/services/account-deletion';
import { signInWithIdentity } from '../src/services/accounts';
import { MICROSOFT_CONSUMER_TENANT } from '../src/services/workspaces/domains';
import {
  listWorkspaces,
  nameFromDomain,
  PERSONAL_WORKSPACE_NAME,
} from '../src/services/workspaces';
import {
  createReadyDeck,
  createTestContext,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';

/** Company organisations found and joined by e-mail domain (BER-148). */

let ctx: TestContext;
let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function open(auth: Partial<Config['auth']> = {}) {
  const context = await createTestContext({
    config: { auth: { ...testConfig().auth, signup: 'open', ...auth } },
  });
  cleanup = context.cleanup;
  return context;
}

async function signUp(email: string, inviteToken: string | null = null) {
  const result = await signInWithIdentity(ctx.deps, {
    provider: 'oidc',
    subject: email,
    email,
    emailVerified: true,
    name: null,
    inviteToken,
  });
  if (!result.ok) throw new Error(`Sign-up of ${email} failed: ${result.error}`);
  return result.user;
}

const me = async (cookie: string) =>
  (await (await ctx.request('/api/me', { cookie })).json()) as MeResponse;

const setDomain = (workspaceId: string, cookie: string, enabled: boolean) =>
  ctx.request(`/api/workspaces/${workspaceId}/domain`, {
    method: 'PUT',
    json: { enabled },
    cookie,
  });

/** Anna signs up at firma.de and makes her organisation the company's. */
async function companyOfAnna() {
  const anna = await signUp('anna@firma.de');
  const [workspace] = await listWorkspaces(ctx.deps, anna.id);
  const { cookie } = await signedInUser(ctx, { name: anna.name, email: anna.email });
  expect((await setDomain(workspace!.id, cookie, true)).status).toBe(200);
  return { anna, workspaceId: workspace!.id, cookie };
}

describe('signing up', () => {
  it('a company address gets an organisation named after the company, its audience still open', async () => {
    ctx = await open();
    const anna = await signUp('anna@firma.de');
    expect(await listWorkspaces(ctx.deps, anna.id)).toEqual([
      expect.objectContaining<Partial<Workspace>>({
        name: 'Firma',
        role: 'admin',
        joinDomain: null,
        audiencePending: true,
      }),
    ]);
  });

  it('a mail provider address gets a private organisation, nobody asks', async () => {
    ctx = await open();
    const max = await signUp('max@gmail.com');
    expect(await listWorkspaces(ctx.deps, max.id)).toEqual([
      expect.objectContaining({
        name: 'Meine Organisation',
        joinDomain: null,
        audiencePending: false,
      }),
    ]);
  });

  it('with a company organisation of the domain: none of their own, /me offers to join it', async () => {
    ctx = await open();
    const { workspaceId } = await companyOfAnna();
    const bert = await signUp('bert@firma.de');
    expect(await listWorkspaces(ctx.deps, bert.id)).toEqual([]);
    const { cookie } = await signedInUser(ctx, { name: bert.name, email: bert.email });
    expect((await me(cookie)).domainWorkspace).toEqual({
      id: workspaceId,
      name: 'Firma',
      logoUrl: null,
      domain: 'firma.de',
      memberCount: 1,
    });
  });

  it('invited people get no organisation of their own', async () => {
    ctx = await open();
    const owner = await signedInUser(ctx, { name: 'Robert Hofmann', email: 'robert@example.org' });
    const created = createdWorkspaceInviteSchema.parse(
      await (
        await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
          method: 'POST',
          json: { role: 'member' },
          cookie: owner.cookie,
        })
      ).json(),
    );
    const token = new URL(created.url).pathname.split('/').pop() ?? null;
    const extern = await signUp('extern@agentur.de', token);
    expect(await listWorkspaces(ctx.deps, extern.id)).toEqual([]);

    await ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'mail@kunde.de', role: 'reviewer' },
      cookie: owner.cookie,
    });
    const mailed = await signUp('mail@kunde.de');
    expect(await listWorkspaces(ctx.deps, mailed.id)).toEqual([]);
  });

  it('SIGNUP=company: invited people and those of an opened domain sign up, nobody else', async () => {
    ctx = await open();
    await companyOfAnna();
    ctx.deps.config.auth.signup = 'company';
    const login = (email: string) =>
      signInWithIdentity(ctx.deps, {
        provider: 'oidc',
        subject: email,
        email,
        emailVerified: true,
        name: null,
        inviteToken: null,
      });
    expect((await login('bert@firma.de')).ok).toBe(true);
    expect(await login('fremd@andere.de')).toEqual({ ok: false, error: 'signup_closed' });
  });
});

describe('PUT /workspaces/:id/domain', () => {
  it('opens to the admin’s own domain, closes again – both answer the sign-up question', async () => {
    ctx = await open();
    const anna = await signUp('anna@firma.de');
    const [workspace] = await listWorkspaces(ctx.deps, anna.id);
    const { cookie } = await signedInUser(ctx, { name: anna.name, email: anna.email });

    const opened = await setDomain(workspace!.id, cookie, true);
    expect(await opened.json()).toMatchObject({ joinDomain: 'firma.de', audiencePending: false });
    const closed = await setDomain(workspace!.id, cookie, false);
    expect(await closed.json()).toMatchObject({ joinDomain: null, audiencePending: false });
  });

  it('refuses mail provider domains, non-admins and a second organisation of a domain', async () => {
    ctx = await open();
    const { workspaceId } = await companyOfAnna();

    const max = await signUp('max@gmail.com');
    const [own] = await listWorkspaces(ctx.deps, max.id);
    const maxCookie = (await signedInUser(ctx, { name: max.name, email: max.email })).cookie;
    expect((await setDomain(own!.id, maxCookie, true)).status).toBe(400);

    // Beyond the short shared list: the maintained one of all providers counts.
    for (const email of ['max@hotmail.co.uk', 'max@yahoo.fr', 'max@ymail.com', 'max@qq.com']) {
      const user = await signUp(email);
      const [workspace] = await listWorkspaces(ctx.deps, user.id);
      expect(workspace).toMatchObject({ name: 'Meine Organisation', audiencePending: false });
      const userCookie = (await signedInUser(ctx, { name: user.name, email })).cookie;
      expect((await setDomain(workspace!.id, userCookie, true)).status).toBe(400);
    }

    const bert = await signUp('bert@firma.de');
    const bertCookie = (await signedInUser(ctx, { name: bert.name, email: bert.email })).cookie;
    await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie: bertCookie,
    });
    expect((await setDomain(workspaceId, bertCookie, false)).status).toBe(403);

    const second = await ctx.request('/api/workspaces', {
      method: 'POST',
      json: { name: 'Firma Zwei' },
      cookie: bertCookie,
    });
    const { id } = (await second.json()) as Workspace;
    const taken = await setDomain(id, bertCookie, true);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: 'domain_taken' } });
  });
});

describe('POST /workspaces/:id/domain-join', () => {
  it('people of the domain join as members; then /me offers it no more', async () => {
    ctx = await open();
    const { workspaceId } = await companyOfAnna();
    const bert = await signUp('bert@firma.de');
    const { cookie } = await signedInUser(ctx, { name: bert.name, email: bert.email });

    const res = await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      workspace: { id: workspaceId, role: 'member' },
      deckId: null,
    });
    expect((await me(cookie)).domainWorkspace).toBeNull();
  });

  it('a pending e-mail invite to it gives its stronger role and is used up', async () => {
    ctx = await open();
    const { workspaceId, cookie: annaCookie } = await companyOfAnna();
    await ctx.request(`/api/workspaces/${workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'bert@firma.de', role: 'admin' },
      cookie: annaCookie,
    });
    const bert = await signUp('bert@firma.de');
    const { cookie } = await signedInUser(ctx, { name: bert.name, email: bert.email });
    await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, { method: 'POST', cookie });
    expect((await me(cookie)).workspaces).toEqual([
      expect.objectContaining({ id: workspaceId, role: 'admin' }),
    ]);
    expect((await me(cookie)).pendingInvites).toEqual([]);
  });

  it('someone an admin removed comes back only with an invite; who left may rejoin', async () => {
    ctx = await open();
    const { workspaceId, cookie: annaCookie } = await companyOfAnna();
    const join = (cookie: string) =>
      ctx.request(`/api/workspaces/${workspaceId}/domain-join`, { method: 'POST', cookie });
    const bert = await signUp('bert@firma.de');
    const { cookie } = await signedInUser(ctx, { name: bert.name, email: bert.email });
    const carla = await signUp('carla@firma.de');
    const carlaCookie = (await signedInUser(ctx, { name: carla.name, email: carla.email })).cookie;
    expect((await join(cookie)).status).toBe(200);
    expect((await join(carlaCookie)).status).toBe(200);

    const removed = await ctx.request(`/api/workspaces/${workspaceId}/members/${bert.id}`, {
      method: 'DELETE',
      cookie: annaCookie,
    });
    expect(removed.status).toBe(204);
    expect((await me(cookie)).domainWorkspace).toBeNull();
    expect((await join(cookie)).status).toBe(403);

    // Invited again, he joins (by domain too) – and later joins by domain need no invite.
    await ctx.request(`/api/workspaces/${workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'bert@firma.de', role: 'member' },
      cookie: annaCookie,
    });
    expect((await join(cookie)).status).toBe(200);
    await ctx.request(`/api/workspaces/${workspaceId}/members/${bert.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect((await me(cookie)).domainWorkspace).toMatchObject({ id: workspaceId });
    expect((await join(cookie)).status).toBe(200);

    // Leaving on her own blocks nothing.
    await ctx.request(`/api/workspaces/${workspaceId}/members/${carla.id}`, {
      method: 'DELETE',
      cookie: carlaCookie,
    });
    expect((await join(carlaCookie)).status).toBe(200);
  });

  it('a deck share brings nobody removed back into the organisation', async () => {
    ctx = await open();
    const { anna, workspaceId, cookie: annaCookie } = await companyOfAnna();
    const join = (cookie: string) =>
      ctx.request(`/api/workspaces/${workspaceId}/domain-join`, { method: 'POST', cookie });
    const bert = await signUp('bert@firma.de');
    const { cookie } = await signedInUser(ctx, { name: bert.name, email: bert.email });
    expect((await join(cookie)).status).toBe(200);
    await ctx.request(`/api/workspaces/${workspaceId}/members/${bert.id}`, {
      method: 'DELETE',
      cookie: annaCookie,
    });
    // Shared a single deck with him (an older share, viewer): pending, it opens nothing.
    const { deckId } = await createReadyDeck(ctx);
    await ctx.deps.db.update(decks).set({ workspaceId }).where(eq(decks.id, deckId));
    const shareId = crypto.randomUUID();
    await ctx.deps.db.insert(workspaceInvites).values({
      id: shareId,
      workspaceId,
      email: 'bert@firma.de',
      role: 'viewer',
      tokenHash: crypto.randomUUID(),
      createdBy: anna.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      deckId,
    });
    expect((await join(cookie)).status).toBe(403);

    // Accepted, then left: still only an invitation to the organisation brings him back.
    const accepted = await ctx.request(`/api/workspace-invites/${shareId}/accept`, {
      method: 'POST',
      cookie,
    });
    expect(accepted.status).toBe(200);
    await ctx.request(`/api/workspaces/${workspaceId}/members/${bert.id}`, {
      method: 'DELETE',
      cookie,
    });
    expect((await me(cookie)).domainWorkspace).toBeNull();
    expect((await join(cookie)).status).toBe(403);
  });

  it('deleting the account and signing up again lifts no removal; an invite does', async () => {
    ctx = await open();
    const { workspaceId, cookie: annaCookie } = await companyOfAnna();
    const join = (cookie: string) =>
      ctx.request(`/api/workspaces/${workspaceId}/domain-join`, { method: 'POST', cookie });
    const bert = await signUp('bert@firma.de');
    expect((await join((await signedInUser(ctx, bert)).cookie)).status).toBe(200);
    await ctx.request(`/api/workspaces/${workspaceId}/members/${bert.id}`, {
      method: 'DELETE',
      cookie: annaCookie,
    });
    expect(await ctx.deps.db.select().from(workspaceRemovals)).toEqual([
      expect.objectContaining({ userId: bert.id, emailHash: emailHash('bert@firma.de') }),
    ]);
    // As a row from before the hash: the deletion adds it.
    await ctx.deps.db.update(workspaceRemovals).set({ emailHash: null });
    expect(await deleteAccount(ctx.deps, bert.id, 'automatic')).toBe(true);

    // Only a keyed hash of the address is left, no account and no plain address.
    const rows = await ctx.deps.db.select().from(workspaceRemovals);
    expect(rows).toEqual([
      expect.objectContaining({ workspaceId, userId: null, emailHash: emailHash('bert@firma.de') }),
    ]);
    expect(rows[0]!.emailHash).not.toContain('bert');
    expect(emailHash(' Bert@Firma.de ')).toBe(rows[0]!.emailHash);

    // Back with the same address: no offer, no join – but an organisation of his own.
    const again = await signUp('bert@firma.de');
    expect(again.id).not.toBe(bert.id);
    const { cookie } = await signedInUser(ctx, again);
    expect((await me(cookie)).domainWorkspace).toBeNull();
    expect((await join(cookie)).status).toBe(403);
    expect(await listWorkspaces(ctx.deps, again.id)).toEqual([
      expect.objectContaining({ name: PERSONAL_WORKSPACE_NAME, role: 'admin' }),
    ]);

    // Others of the domain still join.
    const carla = await signUp('carla@firma.de');
    const carlaCookie = (await signedInUser(ctx, carla)).cookie;
    expect((await me(carlaCookie)).domainWorkspace).toMatchObject({ id: workspaceId });
    expect((await join(carlaCookie)).status).toBe(200);

    // Invited to the organisation, he is back, and the entry is gone.
    await ctx.request(`/api/workspaces/${workspaceId}/invites`, {
      method: 'POST',
      json: { email: 'bert@firma.de', role: 'member' },
      cookie: annaCookie,
    });
    expect((await join(cookie)).status).toBe(200);
    expect(await ctx.deps.db.select().from(workspaceRemovals)).toEqual([]);
  });

  it('refuses an organisation opened to a mail provider before the list knew it', async () => {
    ctx = await open();
    const { workspaceId } = await companyOfAnna();
    await ctx.deps.db
      .update(workspaces)
      .set({ joinDomain: 'hotmail.co.uk' })
      .where(eq(workspaces.id, workspaceId));
    const stranger = await signedInUser(ctx, { name: 'Sam', email: 'sam@hotmail.co.uk' });
    expect((await me(stranger.cookie)).domainWorkspace).toBeNull();
    const res = await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie: stranger.cookie,
    });
    expect(res.status).toBe(403);
  });

  it('refuses other domains and private organisations', async () => {
    ctx = await open();
    const { workspaceId } = await companyOfAnna();
    const fremd = await signedInUser(ctx, { name: 'Fremd', email: 'fremd@andere.de' });
    const res = await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie: fremd.cookie,
    });
    expect(res.status).toBe(403);

    await ctx.deps.db
      .update(workspaces)
      .set({ joinDomain: null })
      .where(eq(workspaces.id, workspaceId));
    const bert = await signedInUser(ctx, { name: 'Bert', email: 'bert@firma.de' });
    const closed = await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie: bert.cookie,
    });
    expect(closed.status).toBe(403);
  });
});

describe('personal Microsoft accounts vouch for no domain', () => {
  /** A Microsoft login, in the personal-accounts tenant unless `tenant` says otherwise. */
  const microsoft = (email: string, tenant = MICROSOFT_CONSUMER_TENANT) =>
    signInWithIdentity(ctx.deps, {
      provider: 'microsoft',
      subject: `${tenant}:${email}`,
      email,
      emailVerified: true,
      name: null,
      inviteToken: null,
    });

  it('sign up and in under SIGNUP=open, but neither find, join nor open the company organisation', async () => {
    ctx = await open();
    const { workspaceId } = await companyOfAnna();
    const signedUp = await microsoft('ex@firma.de');
    if (!signedUp.ok) throw new Error(signedUp.error);
    const ex = signedUp.user;
    expect(await listWorkspaces(ctx.deps, ex.id)).toEqual([
      expect.objectContaining<Partial<Workspace>>({
        name: PERSONAL_WORKSPACE_NAME,
        audiencePending: false,
      }),
    ]);
    expect(await microsoft('ex@firma.de')).toEqual({ ok: true, user: ex });

    const { cookie } = await signedInUser(ctx, { name: ex.name, email: ex.email });
    expect((await me(cookie)).domainWorkspace).toBeNull();
    const joined = await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie,
    });
    expect(joined.status).toBe(403);
    const [own] = await listWorkspaces(ctx.deps, ex.id);
    await ctx.deps.db
      .update(workspaces)
      .set({ joinDomain: null })
      .where(eq(workspaces.id, workspaceId));
    expect((await setDomain(own!.id, cookie, true)).status).toBe(400);
  });

  it('SIGNUP=company: a personal account is no way in, a work account is', async () => {
    ctx = await open();
    await companyOfAnna();
    ctx.deps.config.auth.signup = 'company';
    expect(await microsoft('ex@firma.de')).toEqual({ ok: false, error: 'signup_closed' });
    expect((await microsoft('bert@firma.de', 'firma-tenant')).ok).toBe(true);
  });
});

describe('nameFromDomain', () => {
  it.each([
    ['firma.de', 'Firma'],
    ['mail.firma.de', 'Firma'],
    ['firma.co.uk', 'Firma'],
    ['example.org', 'Example'],
  ])('%s → %s', (domain, name) => expect(nameFromDomain(domain)).toBe(name));
});

describe('SIGNUP=invite: only invitations', () => {
  it('nobody signs up by domain, finds, joins or opens an organisation by domain', async () => {
    ctx = await open();
    const { workspaceId, cookie: annaCookie } = await companyOfAnna();
    ctx.deps.config.auth.signup = 'invite';

    const login = await signInWithIdentity(ctx.deps, {
      provider: 'oidc',
      subject: 'bert',
      email: 'bert@firma.de',
      emailVerified: true,
      name: null,
      inviteToken: null,
    });
    expect(login).toEqual({ ok: false, error: 'signup_closed' });

    const bert = await signedInUser(ctx, { name: 'Bert', email: 'bert@firma.de' });
    const body = await me(bert.cookie);
    expect(body.domainWorkspace).toBeNull();
    expect(body.limits).toMatchObject({ domainJoin: false });
    const join = await ctx.request(`/api/workspaces/${workspaceId}/domain-join`, {
      method: 'POST',
      cookie: bert.cookie,
    });
    expect(join.status).toBe(403);

    await setDomain(workspaceId, annaCookie, false);
    expect((await setDomain(workspaceId, annaCookie, true)).status).toBe(400);
  });

  it('a first account (unclaimed instance) gets no question about the company', async () => {
    ctx = await createTestContext({
      config: { auth: { ...testConfig().auth, signup: 'invite', devLogin: false } },
    });
    cleanup = ctx.cleanup;
    const anna = await signUp('anna@firma.de');
    expect(await listWorkspaces(ctx.deps, anna.id)).toEqual([
      expect.objectContaining({ name: 'Meine Organisation', audiencePending: false }),
    ]);
  });
});
