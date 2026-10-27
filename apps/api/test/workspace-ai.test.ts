import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceAiSchema } from '@slider/shared';
import { workspaceAiKeys, workspaces } from '../src/db/schema';
import { keyProblem, ProviderHttpError } from '../src/services/ai-providers';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext | undefined;
/** Answers in place of the services below, when a test sets it. */
let answer: ((url: string) => Response | Promise<Response>) | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
  answer = undefined;
});

/** Anthropic that knows two models for any key. */
const anthropic = () =>
  ({
    models: {
      list: () =>
        (async function* () {
          await Promise.resolve();
          yield { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' };
          yield { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' };
        })(),
    },
  }) as unknown as Anthropic;

/** OpenAI-compatible services: a key `sk-bad…` is refused, others see two models. */
const aiFetch = async (url: string, init?: RequestInit) => {
  if (new Headers(init?.headers).get('authorization')?.startsWith('Bearer sk-bad')) {
    return Response.json({ error: { message: 'Incorrect API key provided' } }, { status: 401 });
  }
  if (answer) return answer(url);
  return Response.json({ data: [{ id: 'gemini-3.0-flash' }, { id: 'gemini-3.0-pro' }], url });
};

async function setup() {
  ctx = await createTestContext({ anthropic, aiFetch });
  const base = `/api/workspaces/${ctx.workspaceId}/ai`;
  const call = async (path: string, init?: Parameters<TestContext['request']>[1]) => {
    const res = await ctx!.request(`${base}${path}`, init);
    return { status: res.status, body: (await res.json()) as unknown };
  };
  const keys = async () => workspaceAiSchema.parse((await call('')).body).keys;
  return { ctx, call, keys };
}

describe('workspace AI keys', () => {
  it('stores several keys, one active, each on a model its provider offers', async () => {
    const { call, keys } = await setup();
    expect(await keys()).toEqual([]);

    // The first key is checked, starts on the recommended model and becomes the active one.
    await call('/keys', {
      method: 'POST',
      json: { provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
    });
    const [anthropicKey] = await keys();
    expect(anthropicKey).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      active: true,
      hint: 'sk-ant-…IjKl',
    });

    // A second one waits, inactive, until it is set active.
    await call('/keys', {
      method: 'POST',
      json: { provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
    });
    const gemini = (await keys()).find((key) => key.provider === 'gemini')!;
    expect(gemini).toMatchObject({ model: 'gemini-3.0-pro', active: false });
    await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { active: true } });
    expect((await keys()).map((key) => [key.provider, key.active])).toEqual([
      ['gemini', true],
      ['anthropic', false],
    ]);

    // Its models; another of them, but none it does not offer.
    expect((await call(`/keys/${gemini.id}/models`)).body).toEqual({
      models: [
        { id: 'gemini-3.0-flash', name: 'gemini-3.0-flash' },
        { id: 'gemini-3.0-pro', name: 'gemini-3.0-pro' },
      ],
    });
    await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { model: 'gemini-3.0-flash' } });
    expect((await keys())[0]!.model).toBe('gemini-3.0-flash');
    expect(
      (await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { model: 'gpt-5.5' } })).status,
    ).toBe(400);

    // Removing the active one leaves the AI off until another is set active.
    await call(`/keys/${gemini.id}`, { method: 'DELETE' });
    expect((await keys()).map((key) => [key.provider, key.active])).toEqual([['anthropic', false]]);
  });

  it('refuses a key its provider refuses, and an internal address for a custom service', async () => {
    const { call, keys } = await setup();
    const refused = await call('/keys', {
      method: 'POST',
      json: { provider: 'openai', apiKey: 'sk-bad-AbCdEfGhIjKl' },
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('OpenAI hat den API-Key abgelehnt');

    const internal = await call('/keys', {
      method: 'POST',
      json: {
        provider: 'custom',
        apiKey: 'sk-local-1234567',
        baseUrl: 'http://localhost:11434/v1',
      },
    });
    expect(internal.status).toBe(400);
    expect(JSON.stringify(internal.body)).toContain('AI_ALLOW_INTERNAL_URLS');

    const wrongKind = await call('/keys', {
      method: 'POST',
      json: { provider: 'anthropic', apiKey: 'sk-proj-not-anthropic' },
    });
    expect(wrongKind.status).toBe(400);
    expect(await keys()).toEqual([]);
  });

  it('moves a key stored before there were several over, as the active Anthropic key', async () => {
    const { ctx: context, keys } = await setup();
    await context.deps.db
      .update(workspaces)
      .set({
        aiApiKey: 'sk-ant-api03-old-AbCdEfGhWxYz',
        aiKeyHint: 'sk-ant-…WxYz',
        aiKeySetByName: 'Alte Admin',
        aiKeySetAt: new Date('2026-10-01T10:00:00Z'),
      })
      .where(eq(workspaces.id, context.workspaceId));

    expect(await keys()).toMatchObject([
      {
        provider: 'anthropic',
        hint: 'sk-ant-…WxYz',
        model: 'claude-sonnet-5-5',
        active: true,
        setByName: 'Alte Admin',
      },
    ]);
    const [row] = await context.deps.db
      .select()
      .from(workspaceAiKeys)
      .where(eq(workspaceAiKeys.workspaceId, context.workspaceId));
    expect(row!.apiKey).toBe('sk-ant-api03-old-AbCdEfGhWxYz');
    const [workspace] = await context.deps.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, context.workspaceId));
    expect(workspace!.aiApiKey).toBeNull();
  });

  it('asks a refused key again, and lets a new key take over from it', async () => {
    const { ctx: context, call, keys } = await setup();
    await call('/keys', {
      method: 'POST',
      json: { provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
    });
    const [first] = await keys();
    const refuse = () =>
      context.deps.db
        .update(workspaceAiKeys)
        .set({ error: 'Das Guthaben ist aufgebraucht.' })
        .where(eq(workspaceAiKeys.id, first!.id));

    // Topped up: asked again, it works again.
    await refuse();
    expect(
      (await call(`/keys/${first!.id}`, { method: 'PATCH', json: { recheck: true } })).status,
    ).toBe(200);
    expect((await keys())[0]).toMatchObject({ active: true, error: null });

    // A new key while the active one is refused becomes the active one.
    await refuse();
    await call('/keys', {
      method: 'POST',
      json: { provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
    });
    expect(Object.fromEntries((await keys()).map((key) => [key.provider, key.active]))).toEqual({
      anthropic: false,
      gemini: true,
    });
  });
});

describe('answers of a service', () => {
  const addOpenAi = (call: Awaited<ReturnType<typeof setup>>['call']) =>
    call('/keys', { method: 'POST', json: { provider: 'openai', apiKey: 'sk-proj-good-1234567' } });

  it('refuses an answer that is too big, without reading all of it', async () => {
    const { call, keys } = await setup();
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    answer = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            sent += 1;
            if (sent > 64) controller.close();
            else controller.enqueue(chunk);
          },
        }),
      );
    const res = await addOpenAi(call);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('zu groß');
    expect(sent).toBeLessThan(16);
    expect(await keys()).toEqual([]);
  });

  it('refuses an answer of the wrong form as the service’s error', async () => {
    const { call, keys } = await setup();
    answer = () => Response.json({ data: [{ id: 123 }] });
    const res = await addOpenAi(call);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('nicht die erwartete Form');
    expect(await keys()).toEqual([]);
  });

  it('leaves the active key as it is when the key set active is removed meanwhile', async () => {
    const { ctx: context, call, keys } = await setup();
    await call('/keys', {
      method: 'POST',
      json: { provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
    });
    await call('/keys', {
      method: 'POST',
      json: { provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
    });
    const gemini = (await keys()).find((key) => key.provider === 'gemini')!;
    // Refused before: setting it active asks its service again – and meanwhile it is removed.
    await context.deps.db
      .update(workspaceAiKeys)
      .set({ error: 'Das Guthaben ist aufgebraucht.' })
      .where(eq(workspaceAiKeys.id, gemini.id));
    answer = async () => {
      await context.deps.db.delete(workspaceAiKeys).where(eq(workspaceAiKeys.id, gemini.id));
      return Response.json({ data: [{ id: 'gemini-3.0-pro' }] });
    };
    const res = await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { active: true } });
    expect(res.status).toBe(404);
    expect((await keys()).map((key) => [key.provider, key.active])).toEqual([['anthropic', true]]);
  });
});

describe('keyProblem', () => {
  const connection = { provider: 'gemini' as const, baseUrl: null };
  it('takes a rate limit that mentions a quota for a pause, not a refused key', () => {
    const limited = new ProviderHttpError(
      429,
      'You exceeded your current quota, please check your plan and billing details',
      null,
    );
    expect(keyProblem(limited, connection)).toBeNull();
    const empty = new ProviderHttpError(402, 'Payment required: billing', null);
    expect(keyProblem(empty, connection)).toContain('aufgebraucht');
  });
});
