import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  instanceHistorySchema,
  instanceOverviewSchema,
  instanceTimelineSchema,
  instanceUserListSchema,
  instanceUserSchema,
  instanceWorkspaceListSchema,
  instanceWorkspaceSchema,
  joinPreviewSchema,
  workspaceSchema,
  workspaceUsageDetailsSchema,
  type WorkspaceRole,
} from '@slider/shared';
import {
  sessions,
  userIdentities,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from '../src/db/schema';
import { maySignUp, signInWithIdentity } from '../src/services/accounts';
import { findDomainWorkspace, pendingInvitesFor } from '../src/services/workspaces';
import {
  createReadyDeck,
  createTestContext,
  signedInUser,
  testConfig,
  type TestContext,
} from './helpers';
import { BILLING_TEST_CONFIG, FakeBilling } from './billing-helpers';
import { hashToken, newSecretToken } from '../src/auth/session';

/** The instance admin's dashboard (BER-167): numbers, blocking, plans by hand. */

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext({ instanceAdmin: true });
});
afterEach(() => ctx.cleanup());

async function member(name: string, role: WorkspaceRole = 'member') {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}

const put = (path: string, json: unknown, cookie?: string) =>
  ctx.request(`/api/instance${path}`, { method: 'PUT', json, cookie });

describe('instance dashboard (BER-167)', () => {
  it('only the instance admin sees or changes anything – nobody else, not even workspace admins', async () => {
    const anna = await member('Anna', 'admin');
    const endpoints: [string, string, unknown?][] = [
      ['GET', '/overview'],
      ['GET', '/timeline?interval=31d'],
      ['GET', '/history'],
      ['GET', '/users'],
      ['GET', '/workspaces'],
      ['PUT', `/users/${ctx.ownerId}/blocked`, { blocked: true }],
      ['PUT', `/users/${anna.user.id}/blocked`, { blocked: true }],
      ['PUT', `/workspaces/${ctx.workspaceId}/blocked`, { blocked: true }],
      ['PUT', `/workspaces/${ctx.workspaceId}/plan`, { plan: 'paid' }],
    ];
    for (const [method, path, json] of endpoints) {
      const response = await ctx.request(`/api/instance${path}`, {
        method,
        json,
        cookie: anna.cookie,
      });
      expect(response.status, `${method} ${path}`).toBe(403);
    }
    // Nothing changed.
    const [org] = await ctx.deps.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId));
    expect(org).toMatchObject({ blockedAt: null, plan: 'free', planGrantedAt: null });
    expect((await ctx.deps.db.select().from(users)).every((user) => user.blockedAt === null)).toBe(
      true,
    );
    // The instance admin's answers are never cached.
    const own = await ctx.request('/api/instance/overview');
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('no-store');
  });

  it('signed out: nothing at all', async () => {
    await ctx.cleanup();
    ctx = await createTestContext({
      instanceAdmin: true,
      config: { auth: { ...testConfig().auth, devLogin: false } },
    });
    for (const path of [
      '/overview',
      '/timeline?interval=1d',
      '/history',
      '/users',
      '/workspaces',
    ]) {
      expect((await ctx.request(`/api/instance${path}`)).status, path).toBe(401);
    }
  });

  it('counts accounts, workspaces, reviews and storage – no names', async () => {
    await member('Anna');
    await createReadyDeck(ctx, { title: 'Q3' });
    const overview = instanceOverviewSchema.parse(
      await (await ctx.request('/api/instance/overview')).json(),
    );
    expect(overview.users).toEqual({
      total: 2,
      active: 2,
      activeWeek: 2,
      activeQuarter: 2,
      blocked: 0,
    });
    expect(overview.workspaces).toEqual({ total: 1, paid: 0, granted: 0, blocked: 0 });
    expect(overview.decks).toBe(1);
    expect(overview.plans).toBe(true);
    expect(JSON.stringify(overview)).not.toContain('Q3');
  });

  it('counts what was created in a window, in the stretches of its interval', async () => {
    const anna = await member('Anna');
    const DAY = 86_400_000;
    await ctx.deps.db
      .update(users)
      .set({ createdAt: new Date(Date.now() - 100 * DAY) })
      .where(eq(users.id, anna.user.id));
    const timeline = async (interval: string, to?: Date) =>
      instanceTimelineSchema.parse(
        await (
          await ctx.request(
            `/api/instance/timeline?interval=${interval}${to ? `&to=${to.toISOString()}` : ''}`,
          )
        ).json(),
      );
    const users_ = (buckets: { users: number }[]) =>
      buckets.reduce((sum, bucket) => sum + bucket.users, 0);
    // Ending a minute ahead, as the browser does (a full hour, midnight).
    const ahead = new Date(Date.now() + 60_000);

    const day = await timeline('1d', ahead);
    expect(day.buckets).toHaveLength(24);
    expect(day.buckets.at(-1)).toMatchObject({ users: 1, workspaces: 1 });
    expect((await timeline('7d')).buckets).toHaveLength(28);
    expect((await timeline('31d')).buckets).toHaveLength(31);
    // A year is 52 whole weeks.
    const year = await timeline('1y', ahead);
    expect(year.buckets).toHaveLength(52);
    expect(Date.parse(year.to) - Date.parse(year.from)).toBe(364 * DAY);
    expect(users_(year.buckets)).toBe(2);

    // A window in the past: only what was created then.
    const then = await timeline('31d', new Date(Date.now() - 80 * DAY));
    expect(users_(then.buckets)).toBe(1);
    expect(then.buckets.every((bucket) => bucket.workspaces === 0)).toBe(true);

    for (const bad of ['', '?interval=2y', '?interval=1d&to=gestern']) {
      expect((await ctx.request(`/api/instance/timeline${bad}`)).status, bad).toBe(400);
    }
  });

  it('gives the whole history for the strip, at least a month back', async () => {
    const anna = await member('Anna');
    await ctx.deps.db
      .update(users)
      .set({ createdAt: new Date(Date.now() - 500 * 86_400_000) })
      .where(eq(users.id, anna.user.id));
    const history = instanceHistorySchema.parse(
      await (await ctx.request('/api/instance/history')).json(),
    );
    expect(history.stretchDays).toBe(3);
    expect(history.buckets.length).toBeLessThanOrEqual(200);
    expect(history.buckets.reduce((sum, bucket) => sum + bucket.users, 0)).toBe(2);
  });

  it('lists accounts newest first and finds them by name or address', async () => {
    await member('Anna');
    const bert = await member('Bert');
    await ctx.deps.db
      .update(users)
      .set({ createdAt: new Date(Date.now() + 60_000) })
      .where(eq(users.id, bert.user.id));
    const list = async (query = '') =>
      instanceUserListSchema.parse(await (await ctx.request(`/api/instance/users${query}`)).json());
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.users.map((user) => user.name)).toEqual(['Bert', 'Anna', 'Robert Hofmann']);
    expect(all.users[0]?.workspaceCount).toBe(1);
    const found = await list('?q=ANNA@');
    expect(found.users.map((user) => user.email)).toEqual(['anna@firma.de']);
    // `%` is a character, not a wildcard.
    expect((await list('?q=%25')).total).toBe(0);
  });

  it('a blocked account signs in nowhere, its sessions end; unblocking lets it in again', async () => {
    const anna = await member('Anna');
    await ctx.deps.db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: anna.user.id,
      tokenHash: hashToken(newSecretToken()),
      createdAt: ctx.clock.now(),
      lastSeenAt: ctx.clock.now(),
      expiresAt: new Date(ctx.clock.now().getTime() + 86_400_000),
    });
    const blocked = instanceUserSchema.parse(
      await (await put(`/users/${anna.user.id}/blocked`, { blocked: true })).json(),
    );
    expect(blocked.blockedAt).not.toBeNull();
    expect(
      await ctx.deps.db.select().from(sessions).where(eq(sessions.userId, anna.user.id)),
    ).toEqual([]);
    // Her cookie no longer signs anyone in (tests fall back to the dev owner without a session).
    const me = await (await ctx.request('/api/me', { cookie: anna.cookie })).json();
    expect(JSON.stringify(me)).not.toContain('anna@firma.de');

    await ctx.deps.db.insert(userIdentities).values({
      provider: 'oidc',
      subject: 'anna',
      userId: anna.user.id,
      email: 'anna@firma.de',
    });
    const login = () =>
      signInWithIdentity(ctx.deps, {
        provider: 'oidc',
        subject: 'anna',
        email: 'anna@firma.de',
        emailVerified: true,
        name: null,
        inviteToken: null,
      });
    expect(await login()).toEqual({ ok: false, error: 'account_blocked' });

    await put(`/users/${anna.user.id}/blocked`, { blocked: false });
    const again = await login();
    expect(again.ok).toBe(true);
    // Blocking is idempotent and leaves the rest of the account alone.
    const [row] = await ctx.deps.db.select().from(users).where(eq(users.id, anna.user.id));
    expect(row?.blockedAt).toBeNull();
  });

  it('never blocks the instance admin', async () => {
    const response = await put(`/users/${ctx.ownerId}/blocked`, { blocked: true });
    expect(response.status).toBe(400);
  });

  it('a blocked workspace opens nowhere, takes nobody in, and its members can leave', async () => {
    const anna = await member('Anna');
    const { deckId } = await createReadyDeck(ctx);
    const invite = newSecretToken();
    await ctx.deps.db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      tokenHash: hashToken(invite),
      role: 'member',
      createdBy: ctx.ownerId,
      createdAt: ctx.clock.now(),
      expiresAt: new Date(ctx.clock.now().getTime() + 86_400_000),
    });

    const response = await put(`/workspaces/${ctx.workspaceId}/blocked`, { blocked: true });
    expect(instanceWorkspaceSchema.parse(await response.json()).blockedAt).not.toBeNull();

    const asAnna = (path: string, init: RequestInit = {}) =>
      ctx.request(path, { ...init, cookie: anna.cookie });
    const opened = await asAnna(`/api/workspaces/${ctx.workspaceId}`);
    expect(opened.status).toBe(403);
    expect(await opened.json()).toMatchObject({ error: { code: 'workspace_blocked' } });
    expect((await asAnna(`/api/decks/${deckId}`)).status).toBe(403);
    expect(await (await asAnna('/api/decks')).json()).toEqual([]);
    const listed = workspaceSchema.array().parse(await (await asAnna('/api/workspaces')).json());
    expect(listed.map((workspace) => workspace.blocked)).toEqual([true]);
    const preview = joinPreviewSchema.parse(
      await (await ctx.request(`/api/join/${invite}`)).json(),
    );
    expect(preview.state).toBe('revoked');

    const left = await asAnna(`/api/workspaces/${ctx.workspaceId}/members/${anna.user.id}`, {
      method: 'DELETE',
    });
    expect(left.status).toBe(204);

    await put(`/workspaces/${ctx.workspaceId}/blocked`, { blocked: false });
    expect((await ctx.request(`/api/decks/${deckId}`)).status).toBe(200);
  });

  it('lists workspaces with sizes only, found by name or domain', async () => {
    await createReadyDeck(ctx, { title: 'Geheim' });
    await ctx.deps.db
      .update(workspaces)
      .set({ joinDomain: 'firma.de' })
      .where(eq(workspaces.id, ctx.workspaceId));
    const list = instanceWorkspaceListSchema.parse(
      await (await ctx.request('/api/instance/workspaces?q=firma')).json(),
    );
    expect(list.total).toBe(1);
    expect(list.workspaces[0]).toMatchObject({ memberCount: 1, deckCount: 1, plan: 'free' });
    expect(JSON.stringify(list)).not.toContain('Geheim');
  });
});

describe('plans by hand (BER-167)', () => {
  let stripe: FakeBilling;
  beforeEach(async () => {
    await ctx.cleanup();
    stripe = new FakeBilling();
    ctx = await createTestContext({
      instanceAdmin: true,
      config: { billing: BILLING_TEST_CONFIG },
      billing: stripe,
    });
  });

  const plan = (value: string) => put(`/workspaces/${ctx.workspaceId}/plan`, { plan: value });
  const usage = async () =>
    workspaceUsageDetailsSchema.parse(
      await (await ctx.request(`/api/workspaces/${ctx.workspaceId}/usage`)).json(),
    );

  it('grants paid without Stripe, closes checkout meanwhile, and takes it back', async () => {
    const granted = instanceWorkspaceSchema.parse(await (await plan('paid')).json());
    expect(granted).toMatchObject({ plan: 'paid', planGranted: true, subscribed: false });
    const details = await usage();
    expect(details.plan).toBe('paid');
    expect(details.usage.maxDecks).toBeNull();
    expect(details.billing).toMatchObject({ granted: true, trialAvailable: false });
    const checkout = await ctx.request(`/api/workspaces/${ctx.workspaceId}/billing/checkout`, {
      method: 'POST',
    });
    expect(checkout.status).toBe(400);

    const back = instanceWorkspaceSchema.parse(await (await plan('free')).json());
    expect(back).toMatchObject({ plan: 'free', planGranted: false });
    expect((await usage()).billing.granted).toBe(false);
  });

  it('a blocked workspace still lets whoever pays see the usage and stop paying', async () => {
    await ctx.deps.db
      .update(workspaces)
      .set({
        plan: 'paid',
        billingOwnerId: ctx.ownerId,
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        subscriptionStatus: 'active',
        blockedAt: ctx.clock.now(),
      })
      .where(eq(workspaces.id, ctx.workspaceId));
    const billing = (path: string) =>
      ctx.request(`/api/workspaces/${ctx.workspaceId}/billing/${path}`, { method: 'POST' });
    expect((await ctx.request(`/api/workspaces/${ctx.workspaceId}/usage`)).status).toBe(200);
    expect((await billing('portal')).status).toBe(200);
    // Paying anew for a blocked workspace: no.
    expect((await billing('checkout')).status).toBe(403);
  });

  it('leaves a running subscription to Stripe', async () => {
    await ctx.deps.db
      .update(workspaces)
      .set({ plan: 'paid', stripeSubscriptionId: 'sub_1', subscriptionStatus: 'active' })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect((await plan('free')).status).toBe(400);
    expect((await plan('paid')).status).toBe(400);
  });

  it('not where every workspace has the same limits', async () => {
    await ctx.cleanup();
    ctx = await createTestContext({
      instanceAdmin: true,
      config: { limited: false, plans: { free: UNLIMITED, paid: UNLIMITED } },
    });
    expect((await plan('paid')).status).toBe(400);
    const overview = instanceOverviewSchema.parse(
      await (await ctx.request('/api/instance/overview')).json(),
    );
    expect(overview.plans).toBe(false);
  });
});

const UNLIMITED = { maxMembers: null, maxDecks: null, maxStorageBytes: null };

describe('nobody joins a blocked workspace (BER-167)', () => {
  const block = () =>
    ctx.deps.db
      .update(workspaces)
      .set({ blockedAt: ctx.clock.now() })
      .where(eq(workspaces.id, ctx.workspaceId));

  it('its invitations count as withdrawn: not offered, no sign-up through them', async () => {
    await ctx.deps.db.insert(workspaceInvites).values({
      id: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
      tokenHash: hashToken(newSecretToken()),
      email: 'neu@firma.de',
      role: 'member',
      createdBy: ctx.ownerId,
      createdAt: ctx.clock.now(),
      expiresAt: new Date(ctx.clock.now().getTime() + 86_400_000),
    });
    const neu = await signedInUser(ctx, { name: 'Neu', email: 'neu@firma.de' });
    expect(await pendingInvitesFor(ctx.deps.db, neu.user, ctx.clock.now())).toHaveLength(1);
    expect((await maySignUp(ctx.deps, 'neu@firma.de', true, null)).allowed).toBe(true);

    await block();
    expect(await pendingInvitesFor(ctx.deps.db, neu.user, ctx.clock.now())).toEqual([]);
    expect((await maySignUp(ctx.deps, 'neu@firma.de', true, null)).allowed).toBe(false);
  });

  it('its company domain finds it no more', async () => {
    await ctx.cleanup();
    ctx = await createTestContext({
      instanceAdmin: true,
      config: { auth: { ...testConfig().auth, signup: 'company' } },
    });
    await ctx.deps.db
      .update(workspaces)
      .set({ joinDomain: 'firma.de' })
      .where(eq(workspaces.id, ctx.workspaceId));
    expect((await findDomainWorkspace(ctx.deps, 'firma.de'))?.id).toBe(ctx.workspaceId);
    await block();
    expect(await findDomainWorkspace(ctx.deps, 'firma.de')).toBeNull();
  });
});
