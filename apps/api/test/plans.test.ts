import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createdWorkspaceInviteSchema,
  workspaceSchema,
  type MeResponse,
  type WorkspaceRole,
} from '@slider/shared';
import type { Config } from '../src/config';
import { decks, workspaceMembers } from '../src/db/schema';
import { RecordingMailer } from '../src/mail/mailer';
import { createReadyDeck, createTestContext, signedInUser, type TestContext } from './helpers';
import { FakeSource, pptxBytes } from './sync-helpers';

/** BER-130: one own organisation per account, free plan with 5 seats and 3 decks. */

let ctx: TestContext;
let source: FakeSource;
const setup = async (config: Partial<Config> = {}) => {
  source = new FakeSource();
  source.resolve.mockImplementation(async () => ({
    ref: 'drives/d1/items/i1',
    fileName: 'Aus OneDrive.pptx',
    sizeBytes: 16,
    changeToken: 'c1',
    bytes: pptxBytes('v1'),
  }));
  ctx = await createTestContext({
    mailer: new RecordingMailer(),
    sources: { onedrive: source },
    config,
  });
};
afterEach(() => ctx.cleanup());

const body = async (res: Response) =>
  (await res.json()) as { error: { code: string; message: string } };

const workspace = async (cookie?: string, id = ctx.workspaceId) =>
  workspaceSchema.parse(await (await ctx.request(`/api/workspaces/${id}`, { cookie })).json());

async function member(name: string, role: WorkspaceRole = 'member') {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}

const invite = (json: { email?: string; role?: string }) =>
  ctx.request(`/api/workspaces/${ctx.workspaceId}/invites`, { method: 'POST', json });

const tokenOf = async (res: Response) => {
  const created = createdWorkspaceInviteSchema.parse(await res.json());
  return { ...created, token: new URL(created.url).pathname.split('/').pop() ?? '' };
};

const upload = (name = 'Neu.pptx', workspaceId = ctx.workspaceId) => {
  const form = new FormData();
  form.append('file', new File([pptxBytes('v1')], name));
  form.append('workspaceId', workspaceId);
  return ctx.request('/api/decks/upload', { method: 'POST', body: form });
};

const importLink = () =>
  ctx.request('/api/decks/link', {
    method: 'POST',
    json: { url: 'https://1drv.ms/p/c/abc123/EXAMPLE', workspaceId: ctx.workspaceId },
  });

const deckCount = async () =>
  (await ctx.deps.db.select().from(decks).where(eq(decks.workspaceId, ctx.workspaceId))).length;

describe('own organisations', () => {
  beforeEach(() => setup());

  it('lets every account found exactly one, and another once it is deleted', async () => {
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    const me = async () =>
      (await (await ctx.request('/api/me', { cookie: anna.cookie })).json()) as MeResponse;
    expect((await me()).limits).toEqual({ canCreateWorkspace: true });
    expect((await me()).workspaces).toEqual([]);

    const found = (name: string) =>
      ctx.request('/api/workspaces', { method: 'POST', json: { name }, cookie: anna.cookie });
    const first = await found('Anna GmbH');
    expect(first.status).toBe(201);
    const { id } = workspaceSchema.parse(await first.json());
    expect((await me()).limits).toEqual({ canCreateWorkspace: false });

    const second = await found('Noch eine');
    expect(second.status).toBe(403);
    expect(await body(second)).toEqual({
      error: { code: 'plan_limit', message: 'Du hast bereits eine eigene Organisation.' },
    });

    // Being invited into other organisations is unlimited.
    const link = await tokenOf(await invite({}));
    expect(
      (await ctx.request(`/api/join/${link.token}`, { method: 'POST', cookie: anna.cookie }))
        .status,
    ).toBe(200);
    expect((await me()).workspaces).toHaveLength(2);

    expect(
      (await ctx.request(`/api/workspaces/${id}`, { method: 'DELETE', cookie: anna.cookie }))
        .status,
    ).toBe(204);
    expect((await me()).limits).toEqual({ canCreateWorkspace: true });
    expect((await found('Neustart')).status).toBe(201);
  });
});

describe('self-hosted (no limits)', () => {
  beforeEach(() => setup({ limited: false }));

  it('lets an account found as many organisations as it likes', async () => {
    const anna = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    const found = (name: string) =>
      ctx.request('/api/workspaces', { method: 'POST', json: { name }, cookie: anna.cookie });
    expect((await found('Anna GmbH')).status).toBe(201);
    expect((await found('Noch eine')).status).toBe(201);
    const me = (await (await ctx.request('/api/me', { cookie: anna.cookie })).json()) as MeResponse;
    expect(me.limits).toEqual({ canCreateWorkspace: true });
  });
});

describe('seats (members + pending e-mail invites)', () => {
  beforeEach(() => setup());

  it('counts pending e-mail invites and refuses more when full', async () => {
    await member('Ada');
    await member('Ben');
    expect((await workspace()).usage).toEqual({
      members: 3,
      seatsUsed: 3,
      maxMembers: 5,
      decks: 0,
      maxDecks: 3,
    });

    expect((await invite({ email: 'cleo@firma.de' })).status).toBe(201);
    // Inviting the same address again takes no extra seat.
    expect((await invite({ email: 'Cleo@firma.de' })).status).toBe(201);
    expect((await workspace()).usage.seatsUsed).toBe(4);
    expect((await invite({ email: 'dora@firma.de' })).status).toBe(201);
    expect((await workspace()).usage).toMatchObject({ members: 3, seatsUsed: 5 });

    const full = await invite({ email: 'emil@firma.de' });
    expect(full.status).toBe(403);
    expect(await body(full)).toEqual({
      error: {
        code: 'plan_limit',
        message: 'Die Organisation hat bereits 5 von 5 Plätzen belegt.',
      },
    });
    // Links may still be created; joining through them checks.
    expect((await invite({})).status).toBe(201);
  });

  it('lets a reserved seat be taken at the limit, but nobody through a link', async () => {
    await member('Ada');
    await member('Ben');
    await member('Cleo');
    const reserved = await tokenOf(await invite({ email: 'dora@firma.de' }));
    expect((await workspace()).usage).toMatchObject({ members: 4, seatsUsed: 5 });
    const link = await tokenOf(await invite({}));

    // A link joiner would take Dora's reserved seat.
    const emil = await signedInUser(ctx, { name: 'Emil', email: 'emil@firma.de' });
    const refused = await ctx.request(`/api/join/${link.token}`, {
      method: 'POST',
      cookie: emil.cookie,
    });
    expect(refused.status).toBe(403);
    expect(await body(refused)).toMatchObject({
      error: {
        code: 'plan_limit',
        message: expect.stringMatching(/^Diese Organisation ist voll\./),
      },
    });

    const dora = await signedInUser(ctx, { name: 'Dora', email: 'dora@firma.de' });
    const accepted = await ctx.request(`/api/join/${reserved.token}`, {
      method: 'POST',
      cookie: dora.cookie,
    });
    expect(accepted.status).toBe(200);
    expect((await workspace()).usage).toMatchObject({ members: 5, seatsUsed: 5 });

    // Changing roles doesn't touch seats.
    expect(
      (
        await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${dora.user.id}`, {
          method: 'PATCH',
          json: { role: 'admin' },
        })
      ).status,
    ).toBe(200);
    expect((await workspace()).usage.seatsUsed).toBe(5);

    // Removing someone frees a seat for the link.
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/members/${dora.user.id}`, {
      method: 'DELETE',
    });
    expect(
      (await ctx.request(`/api/join/${link.token}`, { method: 'POST', cookie: emil.cookie }))
        .status,
    ).toBe(200);
  });

  it('accepts a pending invite from /me at the limit', async () => {
    await member('Ada');
    await member('Ben');
    await member('Cleo');
    const { invite: pending } = await tokenOf(await invite({ email: 'dora@firma.de' }));
    const dora = await signedInUser(ctx, { name: 'Dora', email: 'dora@firma.de' });
    const res = await ctx.request(`/api/workspace-invites/${pending.id}/accept`, {
      method: 'POST',
      cookie: dora.cookie,
    });
    expect(res.status).toBe(200);
  });

  it('frees the seat of a revoked invite', async () => {
    await member('Ada');
    await member('Ben');
    await member('Cleo');
    const { invite: pending } = await tokenOf(await invite({ email: 'dora@firma.de' }));
    expect((await invite({ email: 'emil@firma.de' })).status).toBe(403);
    await ctx.request(`/api/workspace-invites/${pending.id}`, { method: 'DELETE' });
    expect((await invite({ email: 'emil@firma.de' })).status).toBe(201);
  });
});

describe('decks per organisation', () => {
  beforeEach(() => setup());

  it('stops uploads and link imports at 3 decks; deleting one frees the slot', async () => {
    const archived = await createReadyDeck(ctx, { title: 'Archiviert' });
    await ctx.deps.db
      .update(decks)
      .set({ archivedAt: new Date() })
      .where(eq(decks.id, archived.deckId));
    expect((await upload()).status).toBe(201);
    expect((await importLink()).status).toBe(201);
    expect((await workspace()).usage).toMatchObject({ decks: 3, maxDecks: 3 });

    const full = await upload();
    expect(full.status).toBe(403);
    expect(await body(full)).toEqual({
      error: {
        code: 'plan_limit',
        message:
          'Im Free-Plan sind 3 Präsentationen pro Organisation möglich. Lösche eine, um Platz zu schaffen.',
      },
    });
    const downloads = source.download.mock.calls.length;
    const fullLink = await importLink();
    expect(fullLink.status).toBe(403);
    expect((await body(fullLink)).error.code).toBe('plan_limit');
    // Refused before anything was downloaded.
    expect(source.download.mock.calls.length).toBe(downloads);
    expect(await deckCount()).toBe(3);

    expect((await ctx.request(`/api/decks/${archived.deckId}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect((await upload()).status).toBe(201);
    await ctx.deps.queue.idle();
  });

  it('never exceeds the limit with requests at the same time', async () => {
    await createReadyDeck(ctx);
    const results = await Promise.all([upload('A.pptx'), upload('B.pptx'), upload('C.pptx')]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 201, 403]);
    expect(await deckCount()).toBe(3);
    await ctx.deps.queue.idle();
  });

  it('keeps decks above the limit but allows no new ones', async () => {
    for (let i = 0; i < 4; i++) await createReadyDeck(ctx, { title: `Alt ${i}` });
    expect((await workspace()).usage.decks).toBe(4);
    expect((await upload()).status).toBe(403);
    expect((await ctx.request('/api/decks')).status).toBe(200);
  });
});

describe('limits from the environment (self-hosting)', () => {
  it('0 means unlimited', async () => {
    await setup({ plans: { free: { maxMembers: null, maxDecks: null } } });
    for (let i = 0; i < 4; i++) await createReadyDeck(ctx, { title: `Alt ${i}` });
    expect((await upload()).status).toBe(201);
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect((await invite({ email: `${name}@firma.de` })).status).toBe(201);
    }
    expect((await workspace()).usage).toMatchObject({
      members: 1,
      seatsUsed: 7,
      maxMembers: null,
      decks: 5,
      maxDecks: null,
    });
    await ctx.deps.queue.idle();
  });

  it('takes custom limits', async () => {
    await setup({ plans: { free: { maxMembers: 2, maxDecks: 1 } } });
    expect((await upload()).status).toBe(201);
    const full = await upload();
    expect(full.status).toBe(403);
    expect((await body(full)).error.message).toMatch(/ist eine Präsentation pro/);
    expect((await invite({ email: 'a@firma.de' })).status).toBe(201);
    expect((await invite({ email: 'b@firma.de' })).status).toBe(403);
    await ctx.deps.queue.idle();
  });
});
