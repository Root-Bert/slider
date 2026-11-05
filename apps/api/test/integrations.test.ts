import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { deckSchema, integrationsSchema } from '@slider/shared';
import { aiUsage, instanceSettings, integrationKeys, workspaces } from '../src/db/schema';
import { keyProblem, ProviderHttpError, transcribe } from '../src/services/ai-providers';
import {
  aiConnectionFor,
  workspaceAiConnection,
  workspaceSpeechConnection,
} from '../src/services/integration-keys';
import { photoSource, searchPhotos } from '../src/services/stock-photos';
import { createReadyDeck, createTestContext, type TestContext } from './helpers';

let ctx: TestContext | undefined;
/** Answers in place of the services below, when a test sets it. */
let answer: ((url: string, init?: RequestInit) => Response | Promise<Response>) | undefined;
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
  if (answer) return answer(url, init);
  return Response.json({ data: [{ id: 'gemini-3.0-flash' }, { id: 'gemini-3.0-pro' }], url });
};

type Init = Parameters<TestContext['request']>[1];

async function setup(
  options: {
    instanceAdmin?: boolean;
    config?: Partial<Parameters<typeof createTestContext>[0] & object>['config'];
  } = {},
) {
  // A test may set up several times: the one before goes first.
  await ctx?.cleanup();
  answer = undefined;
  ctx = await createTestContext({ anthropic, aiFetch, ...options });
  const workspace = `/api/workspaces/${ctx.workspaceId}`;
  const send = async (url: string, init?: Init) => {
    const res = await ctx!.request(url, init);
    return { status: res.status, body: (await res.json()) as unknown };
  };
  /** The workspace's integrations; its AI's name is set on `PATCH …/ai`. */
  const call = (path: string, init?: Init) =>
    send(
      path === '' && init?.method === 'PATCH'
        ? `${workspace}/ai`
        : `${workspace}/integrations${path}`,
      init,
    );
  /** The instance's. */
  const instance = (path: string, init?: Init) => send(`/api/instance/integrations${path}`, init);
  const integrations = async () => integrationsSchema.parse((await call('')).body);
  const keys = async () => (await integrations()).areas.ai.keys;
  return { ctx, call, instance, integrations, keys };
}

const anthropicKey = { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-inst-WxYz12345' };
const geminiKey = { kind: 'ai', provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' };
/** No keys of its own: the instance's, as it is. */
const locked = { ownKeys: false, inherit: 'all' };
const speech = { url: 'http://stt:8000/v1', model: 'whisper-large-v3-turbo' };
const recording = { bytes: new Uint8Array([1, 2, 3]), name: 'aufnahme.webm', type: 'audio/webm' };
const addOpenAi = (call: Awaited<ReturnType<typeof setup>>['call']) =>
  call('/keys', {
    method: 'POST',
    json: { kind: 'ai', provider: 'openai', apiKey: 'sk-proj-good-1234567' },
  });
const connection = { provider: 'gemini' as const, baseUrl: null };

describe('a workspace’s AI keys', () => {
  it('stores several keys, one active, each on a model its provider offers – a refused one asked again', async () => {
    {
      const { ctx: context, call, keys } = await setup();
      expect(await keys()).toEqual([]);

      // The first key is checked, starts on the recommended model and becomes the active one.
      await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
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
        json: { kind: 'ai', provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
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

      // Creating decks: none of its own runs on the one model; one set, saved and used for it
      // only – each request written down as `create`; none it does not offer; `null` back.
      const runsOn = async (purpose: 'review' | 'create') =>
        (await aiConnectionFor(context.deps, context.workspaceId, purpose)).connection;
      expect((await keys())[0]!.createModel).toBeNull();
      expect((await runsOn('create'))?.model).toBe('gemini-3.0-flash');
      await call(`/keys/${gemini.id}`, {
        method: 'PATCH',
        json: { createModel: 'gemini-3.0-pro' },
      });
      expect((await keys())[0]).toMatchObject({
        model: 'gemini-3.0-flash',
        createModel: 'gemini-3.0-pro',
      });
      expect((await runsOn('review'))?.model).toBe('gemini-3.0-flash');
      const creating = await runsOn('create');
      expect(creating?.model).toBe('gemini-3.0-pro');
      creating?.meter?.({ feature: 'edit', model: 'gemini-3.0-pro', inputTokens: 5 });
      await context.deps.background?.idle();
      expect(
        (await context.deps.db.select().from(aiUsage)).map((row) => [row.feature, row.model]),
      ).toEqual([['create', 'gemini-3.0-pro']]);
      expect(
        (await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { createModel: 'gpt-5.5' } }))
          .status,
      ).toBe(400);
      await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { createModel: null } });
      expect((await runsOn('create'))?.model).toBe('gemini-3.0-flash');

      // Removing the active one leaves the AI off until another is set active.
      await call(`/keys/${gemini.id}`, { method: 'DELETE' });
      expect((await keys()).map((key) => [key.provider, key.active])).toEqual([
        ['anthropic', false],
      ]);
    }
    {
      const { ctx: context, call, keys } = await setup();
      await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
      });
      const [first] = await keys();
      const refuse = () =>
        context.deps.db
          .update(integrationKeys)
          .set({ error: 'Das Guthaben ist aufgebraucht.' })
          .where(eq(integrationKeys.id, first!.id));

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
        json: { kind: 'ai', provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
      });
      expect(Object.fromEntries((await keys()).map((key) => [key.provider, key.active]))).toEqual({
        anthropic: false,
        gemini: true,
      });
    }
    {
      const { ctx: context, call, keys } = await setup();
      await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
      });
      await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
      });
      const gemini = (await keys()).find((key) => key.provider === 'gemini')!;
      // Refused before: setting it active asks its service again – and meanwhile it is removed.
      await context.deps.db
        .update(integrationKeys)
        .set({ error: 'Das Guthaben ist aufgebraucht.' })
        .where(eq(integrationKeys.id, gemini.id));
      answer = async () => {
        await context.deps.db.delete(integrationKeys).where(eq(integrationKeys.id, gemini.id));
        return Response.json({ data: [{ id: 'gemini-3.0-pro' }] });
      };
      const res = await call(`/keys/${gemini.id}`, { method: 'PATCH', json: { active: true } });
      expect(res.status).toBe(404);
      expect((await keys()).map((key) => [key.provider, key.active])).toEqual([
        ['anthropic', true],
      ]);
    }
  });

  it('names the AI, and its decks show it among the participants once a key works', async () => {
    {
      const { ctx, call } = await setup();
      const { deckId } = await createReadyDeck(ctx);
      const deckAi = async () =>
        deckSchema.parse(await (await ctx.request(`/api/decks/${deckId}`)).json()).ai;
      expect(await deckAi()).toEqual({ name: 'KI', available: false });
      expect(integrationsSchema.parse((await call('')).body).aiName).toBe('KI');

      await call('', { method: 'PATCH', json: { name: '  Lektor ' } });
      expect(integrationsSchema.parse((await call('')).body).aiName).toBe('Lektor');
      await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKl' },
      });
      expect(await deckAi()).toEqual({ name: 'Lektor', available: true });

      // Too long is refused; empty gives back the default.
      expect((await call('', { method: 'PATCH', json: { name: 'x'.repeat(41) } })).status).toBe(
        400,
      );
      await call('', { method: 'PATCH', json: { name: '' } });
      expect(await deckAi()).toEqual({ name: 'KI', available: true });
    }
  });

  it('refuses a key its provider refuses, an internal or query address, and a service answer too big or of the wrong form', async () => {
    {
      const { call, keys } = await setup();
      const refused = await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'openai', apiKey: 'sk-bad-AbCdEfGhIjKl' },
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('OpenAI hat den API-Key abgelehnt');

      const internal = await call('/keys', {
        method: 'POST',
        json: {
          kind: 'ai',
          provider: 'custom',
          apiKey: 'sk-local-1234567',
          baseUrl: 'http://localhost:11434/v1',
        },
      });
      expect(internal.status).toBe(400);
      expect(JSON.stringify(internal.body)).toContain('AI_ALLOW_INTERNAL_URLS');

      const wrongKind = await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-proj-not-anthropic' },
      });
      expect(wrongKind.status).toBe(400);
      expect(await keys()).toEqual([]);
    }
    {
      const { call, instance } = await setup({
        instanceAdmin: true,
        config: { aiAllowInternalUrls: true },
      });
      const local = {
        kind: 'ai',
        provider: 'custom',
        apiKey: 'sk-local-1234567',
        baseUrl: 'http://localhost:11434/v1',
      };
      const refused = await call('/keys', { method: 'POST', json: local });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('nur der Instanz-Admin');
      expect((await instance('/keys', { method: 'POST', json: local })).status).toBe(200);

      // A `?` would turn the paths appended into a query – to reach any path of the host.
      const query = await call('/keys', {
        method: 'POST',
        json: { ...local, baseUrl: 'https://example.com/admin?' },
      });
      expect(query.status).toBe(400);
      expect(JSON.stringify(query.body)).toContain('ohne „?“');
    }
    {
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
    }
    {
      const { call, keys } = await setup();
      answer = () => Response.json({ data: [{ id: 123 }] });
      const res = await addOpenAi(call);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('nicht die erwartete Form');
      expect(await keys()).toEqual([]);
    }
    {
      const limited = new ProviderHttpError(
        429,
        'You exceeded your current quota, please check your plan and billing details',
        null,
      );
      expect(keyProblem(limited, connection)).toBeNull();
      const empty = new ProviderHttpError(402, 'Payment required: billing', null);
      expect(keyProblem(empty, connection)).toContain('aufgebraucht');
    }
  });

  it('takes over keys stored as they once were – in the workspace, the old rule and the server’s environment', async () => {
    {
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
        .from(integrationKeys)
        .where(eq(integrationKeys.workspaceId, context.workspaceId));
      expect(row!.apiKey).toBe('sk-ant-api03-old-AbCdEfGhWxYz');
      const [workspace] = await context.deps.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, context.workspaceId));
      expect(workspace!.aiApiKey).toBeNull();
    }
    {
      const { ctx: context, instance } = await setup({ instanceAdmin: true });
      await context.deps.db
        .insert(instanceSettings)
        .values({ key: 'INTEGRATION_POLICY', value: '{"ai":false}', updatedAt: new Date() });
      const { areas } = integrationsSchema.parse((await instance('')).body);
      expect(areas.ai.rule).toEqual({ ownKeys: false, inherit: 'all' });
      expect(areas.photos.rule).toEqual({ ownKeys: true, inherit: 'all' });
    }
    {
      await ctx?.cleanup();
      ctx = await createTestContext({
        anthropic,
        aiFetch,
        instanceAdmin: true,
        config: {
          unsplash: { accessKey: 'unsplash-env-12345678' },
          anthropicApiKey: 'sk-ant-api03-env-AbCdWxYz',
        },
      });
      const context = ctx;
      const instance = async (path = '', init?: Init) => {
        const res = await context.request(`/api/instance/integrations${path}`, init);
        return { status: res.status, body: (await res.json()) as unknown };
      };
      const areas = async () => integrationsSchema.parse((await instance()).body).areas;

      const { ai, photos } = await areas();
      expect(ai.keys).toMatchObject([
        {
          provider: 'anthropic',
          hint: 'sk-ant-…WxYz',
          model: 'claude-sonnet-5-5',
          active: true,
          setByName: 'Umgebung des Servers (.env)',
        },
      ]);
      expect(photos.keys).toMatchObject([{ provider: 'unsplash', active: true, model: '' }]);
      // Every workspace without its own runs on it.
      expect(
        (await workspaceAiConnection(context.deps, context.workspaceId)).connection?.apiKey,
      ).toBe('sk-ant-api03-env-AbCdWxYz');

      // Removed, it stays removed – the environment names the same value still.
      await instance(`/keys/${ai.keys[0]!.id}`, { method: 'DELETE' });
      expect((await areas()).ai.keys).toEqual([]);
    }
  });
});

describe('the instance’s integrations', () => {
  it('are the instance admin’s only, and give a workspace without a key of its own the instance’s – and only it, when locked', async () => {
    {
      const { instance } = await setup();
      expect((await instance('')).status).toBe(403);
      expect((await instance('/keys', { method: 'POST', json: anthropicKey })).status).toBe(403);
    }
    {
      const {
        ctx: context,
        call,
        instance,
        integrations,
        keys,
      } = await setup({
        instanceAdmin: true,
      });
      const { deckId } = await createReadyDeck(context);
      const deckAi = async () =>
        deckSchema.parse(await (await context.request(`/api/decks/${deckId}`)).json()).ai;
      const runsOn = async () =>
        (await workspaceAiConnection(context.deps, context.workspaceId)).connection?.provider;

      // The instance's key: the workspace runs on it, and sees which it is.
      expect((await instance('/keys', { method: 'POST', json: anthropicKey })).status).toBe(200);
      expect((await integrations()).areas.ai).toMatchObject({
        keys: [],
        rule: { ownKeys: true, inherit: 'all' },
        inherited: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      });
      expect(await deckAi()).toEqual({ name: 'KI', available: true });
      expect(await runsOn()).toBe('anthropic');

      // Its own key comes first; set inactive, the instance's applies again.
      await call('/keys', { method: 'POST', json: geminiKey });
      const [own] = await keys();
      expect(own).toMatchObject({ provider: 'gemini', active: true });
      expect(await runsOn()).toBe('gemini');
      await call(`/keys/${own!.id}`, { method: 'PATCH', json: { active: false } });
      expect(await runsOn()).toBe('anthropic');
      await call(`/keys/${own!.id}`, { method: 'PATCH', json: { active: true } });

      // Locked: the instance's applies, the workspace's keys rest unseen and stay as they are.
      expect((await instance('/ai', { method: 'PATCH', json: { rule: locked } })).status).toBe(200);
      expect((await integrations()).areas.ai).toMatchObject({ keys: [], rule: locked });
      expect(await runsOn()).toBe('anthropic');
      expect((await call('/keys', { method: 'POST', json: geminiKey })).status).toBe(403);
      expect((await call(`/keys/${own!.id}`, { method: 'DELETE' })).status).toBe(403);

      // Without the instance's key, the AI is off – and says who can change that.
      const stored = integrationsSchema.parse((await instance('')).body).areas.ai.keys;
      await instance(`/keys/${stored[0]!.id}`, { method: 'DELETE' });
      expect((await workspaceAiConnection(context.deps, context.workspaceId)).error).toContain(
        'Instanz-Admin',
      );
      expect(await deckAi()).toEqual({ name: 'KI', available: false });

      // Allowed again: its own key is back.
      await instance('/ai', { method: 'PATCH', json: { rule: { ownKeys: true, inherit: 'all' } } });
      expect(await runsOn()).toBe('gemini');
      expect(await deckAi()).toEqual({ name: 'KI', available: true });
    }
    {
      const { call, instance, keys } = await setup({ instanceAdmin: true });
      await call('/keys', {
        method: 'POST',
        json: { kind: 'ai', provider: 'gemini', apiKey: 'AIzaSy-good-key-1234' },
      });
      const [own] = await keys();
      await instance('/ai', { method: 'PATCH', json: { rule: locked } });
      expect((await call(`/keys/${own!.id}/models`)).status).toBe(403);
    }
  });

  it('treat single workspaces apart – the model of the instance’s key picked or fixed, or nothing taken over', async () => {
    {
      const { ctx: context, call, instance, integrations } = await setup({ instanceAdmin: true });
      const runsOn = async () =>
        (await workspaceAiConnection(context.deps, context.workspaceId)).connection;
      await instance('/keys', { method: 'POST', json: anthropicKey });

      // For all: the instance's model – no picking it.
      expect((await call('/instance/ai/models')).status).toBe(403);
      expect(
        (await call('/instance/ai/model', { method: 'PUT', json: { model: 'claude-opus-5-5' } }))
          .status,
      ).toBe(403);

      // Apart: the workspace picks the model of the instance's key; the instance names it.
      const pick = { ownKeys: false, inherit: 'key' };
      expect(
        (
          await instance('/ai', {
            method: 'PATCH',
            json: { workspaceId: context.workspaceId, rule: pick },
          })
        ).status,
      ).toBe(200);
      const exceptions = integrationsSchema.parse((await instance('')).body).areas.ai.exceptions;
      expect(exceptions).toEqual([
        {
          workspaceId: context.workspaceId,
          name: expect.any(String),
          rule: pick,
          model: null,
          createModel: null,
        },
      ]);
      expect((await call('/instance/ai/models')).body).toMatchObject({
        models: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }],
      });
      expect(
        (await call('/instance/ai/model', { method: 'PUT', json: { model: 'gpt-0' } })).status,
      ).toBe(400);
      await call('/instance/ai/model', { method: 'PUT', json: { model: 'claude-opus-5-5' } });
      expect((await integrations()).areas.ai).toMatchObject({
        rule: pick,
        inherited: { model: 'claude-opus-5-5', defaultModel: 'claude-sonnet-5-5' },
      });
      expect(await runsOn()).toMatchObject({ provider: 'anthropic', model: 'claude-opus-5-5' });

      // Its model to create decks on, picked apart: saved with the model, and without it again
      // decks are created on the model it runs on.
      const creates = async () =>
        (await aiConnectionFor(context.deps, context.workspaceId, 'create')).connection?.model;
      expect(await creates()).toBe('claude-opus-5-5');
      await call('/instance/ai/model', {
        method: 'PUT',
        json: { createModel: 'claude-sonnet-5-5' },
      });
      expect((await integrations()).areas.ai.inherited).toMatchObject({
        model: 'claude-opus-5-5',
        createModel: 'claude-sonnet-5-5',
        defaultCreateModel: null,
      });
      expect(await creates()).toBe('claude-sonnet-5-5');
      expect((await runsOn())?.model).toBe('claude-opus-5-5');
      await call('/instance/ai/model', { method: 'PUT', json: { createModel: null } });
      expect(await creates()).toBe('claude-opus-5-5');

      // Another key of the instance: its model applies again.
      await instance('/keys', {
        method: 'POST',
        json: { ...anthropicKey, apiKey: `${anthropicKey.apiKey}2` },
      });
      const [second] = integrationsSchema.parse((await instance('')).body).areas.ai.keys;
      await instance(`/keys/${second!.id}`, { method: 'PATCH', json: { active: true } });
      expect((await runsOn())?.model).toBe('claude-sonnet-5-5');

      // Nothing taken over: only its own key – and neither own nor the instance's is refused.
      expect(
        (
          await instance('/ai', {
            method: 'PATCH',
            json: { workspaceId: context.workspaceId, rule: { ownKeys: false, inherit: 'none' } },
          })
        ).status,
      ).toBe(400);
      await instance('/ai', {
        method: 'PATCH',
        json: { workspaceId: context.workspaceId, rule: { ownKeys: true, inherit: 'none' } },
      });
      expect((await integrations()).areas.ai.inherited).toBeNull();
      expect(await runsOn()).toBeNull();
      await call('/keys', { method: 'POST', json: geminiKey });
      expect((await runsOn())?.provider).toBe('gemini');

      // Given back to the rule for all: the instance's applies once its own is set aside.
      await instance('/ai', {
        method: 'PATCH',
        json: { workspaceId: context.workspaceId, rule: null },
      });
      expect(integrationsSchema.parse((await instance('')).body).areas.ai.exceptions).toEqual([]);
      const [own] = (await integrations()).areas.ai.keys;
      await call(`/keys/${own!.id}`, { method: 'PATCH', json: { active: false } });
      expect((await runsOn())?.provider).toBe('anthropic');
    }
    {
      const { ctx: context, call, instance, integrations } = await setup({ instanceAdmin: true });
      const runsOn = async () =>
        (await workspaceAiConnection(context.deps, context.workspaceId)).connection;
      const apart = (json: Record<string, unknown>) =>
        instance('/ai', { method: 'PATCH', json: { workspaceId: context.workspaceId, ...json } });
      await instance('/keys', { method: 'POST', json: anthropicKey });
      const fixed = { ownKeys: false, inherit: 'all' };

      // Only for a workspace apart, and only a model the key offers.
      expect(
        (
          await instance('/ai', {
            method: 'PATCH',
            json: { rule: fixed, model: 'claude-opus-5-5' },
          })
        ).status,
      ).toBe(400);
      expect((await apart({ rule: fixed, model: 'gpt-0' })).status).toBe(400);

      // Fixed: the workspace runs on it and cannot pick another.
      await apart({ rule: fixed, model: 'claude-opus-5-5' });
      expect(
        integrationsSchema.parse((await instance('')).body).areas.ai.exceptions[0],
      ).toMatchObject({ rule: fixed, model: 'claude-opus-5-5' });
      expect((await integrations()).areas.ai.inherited).toMatchObject({
        model: 'claude-opus-5-5',
        defaultModel: 'claude-opus-5-5',
      });
      expect(await runsOn()).toMatchObject({ model: 'claude-opus-5-5' });
      expect(
        (await call('/instance/ai/model', { method: 'PUT', json: { model: 'claude-sonnet-5-5' } }))
          .status,
      ).toBe(403);

      // The model to create decks on, fixed apart beside it – the other model kept; only for
      // the AI.
      const creates = async () =>
        (await aiConnectionFor(context.deps, context.workspaceId, 'create')).connection?.model;
      await apart({ rule: fixed, createModel: 'claude-sonnet-5-5' });
      expect(
        integrationsSchema.parse((await instance('')).body).areas.ai.exceptions[0],
      ).toMatchObject({ model: 'claude-opus-5-5', createModel: 'claude-sonnet-5-5' });
      expect(await creates()).toBe('claude-sonnet-5-5');
      expect(await runsOn()).toMatchObject({ model: 'claude-opus-5-5' });
      expect(
        (
          await instance('/speech', {
            method: 'PATCH',
            json: { workspaceId: context.workspaceId, rule: fixed, createModel: 'x' },
          })
        ).status,
      ).toBe(400);
      await apart({ rule: fixed, createModel: null });
      expect(await creates()).toBe('claude-opus-5-5');

      // Model free: the instance's is the default – a pick of the workspace goes before it.
      const pick = { ownKeys: false, inherit: 'key' };
      await apart({ rule: pick });
      expect(await runsOn()).toMatchObject({ model: 'claude-opus-5-5' });
      await call('/instance/ai/model', { method: 'PUT', json: { model: 'claude-sonnet-5-5' } });
      expect((await integrations()).areas.ai.inherited).toMatchObject({
        model: 'claude-sonnet-5-5',
        defaultModel: 'claude-opus-5-5',
      });
      expect(await runsOn()).toMatchObject({ model: 'claude-sonnet-5-5' });

      // The key's own model is none set; given back to all, the model goes with it.
      await apart({ rule: fixed, model: 'claude-sonnet-5-5' });
      expect(
        integrationsSchema.parse((await instance('')).body).areas.ai.exceptions[0]?.model,
      ).toBeNull();
      await apart({ rule: fixed, model: 'claude-opus-5-5' });
      await apart({ rule: null });
      await apart({ rule: fixed });
      expect(await runsOn()).toMatchObject({ model: 'claude-sonnet-5-5' });

      // Another key of the instance: its own model again.
      await apart({ rule: fixed, model: 'claude-opus-5-5' });
      await instance('/keys', {
        method: 'POST',
        json: { ...anthropicKey, apiKey: `${anthropicKey.apiKey}2` },
      });
      const [second] = integrationsSchema.parse((await instance('')).body).areas.ai.keys;
      await instance(`/keys/${second!.id}`, { method: 'PATCH', json: { active: true } });
      expect((await runsOn())?.model).toBe('claude-sonnet-5-5');
    }
  });

  it('check speech, picture and photo keys on their services', async () => {
    {
      const { call, integrations } = await setup();
      answer = () =>
        Response.json({
          data: [{ id: 'gpt-5.5' }, { id: 'whisper-1' }, { id: 'gpt-4o-transcribe' }],
        });
      await call('/keys', {
        method: 'POST',
        json: { kind: 'speech', provider: 'openai', apiKey: 'sk-proj-good-1234567' },
      });
      expect((await integrations()).areas.speech.keys).toMatchObject([
        { provider: 'openai', model: 'gpt-4o-transcribe', active: true },
      ]);
      // Anthropic turns no speech into text; Mistral offers none with this key.
      expect(
        (
          await call('/keys', {
            method: 'POST',
            json: { kind: 'speech', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIj' },
          })
        ).status,
      ).toBe(400);
      answer = () => Response.json({ data: [{ id: 'mistral-large-latest' }] });
      const none = await call('/keys', {
        method: 'POST',
        json: { kind: 'speech', provider: 'mistral', apiKey: 'mistral-good-12345678' },
      });
      expect(none.status).toBe(400);
      expect(JSON.stringify(none.body)).toContain('keine Modelle für Sprache zu Text');
    }
    {
      const { call, integrations } = await setup();
      const asked: { url: string; key: string | null }[] = [];
      answer = (url, init) => {
        asked.push({ url, key: new Headers(init?.headers).get('x-key') });
        if (url.endsWith('/credits')) return Response.json({ credits: 12.5 });
        // Its models come from its API description: the picture ones, not video or fine-tunes.
        return Response.json({
          paths: {
            '/v1/flux-2-pro': { post: { summary: 'Generate or edit an image with FLUX.2 [pro]' } },
            '/v1/flux-3-image': { post: { summary: 'Generate an image with FLUX 3.' } },
            '/v1/flux-3-video': { post: { summary: 'Generate a video with FLUX 3.' } },
            '/v1/get_result': { get: { summary: 'Get Result' } },
          },
        });
      };
      await call('/keys', {
        method: 'POST',
        json: { kind: 'images', provider: 'black-forest-labs', apiKey: 'bfl-good-12345678' },
      });
      expect(asked.map((each) => each.url).sort()).toEqual([
        'https://api.eu.bfl.ai/openapi.json',
        'https://api.eu.bfl.ai/v1/credits',
      ]);
      expect(asked[0]?.key).toBe('bfl-good-12345678');
      const [bfl] = (await integrations()).areas.images.keys;
      expect(bfl).toMatchObject({ provider: 'black-forest-labs', model: 'flux-3-image' });
      expect((await call(`/keys/${bfl!.id}/models`)).body).toEqual({
        models: [
          { id: 'flux-3-image', name: 'FLUX 3' },
          { id: 'flux-2-pro', name: 'FLUX.2 [pro]' },
        ],
      });

      // OpenAI-compatible ones: the picture models among those offered.
      answer = () => Response.json({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-image-2.5-flare' }] });
      await call('/keys', {
        method: 'POST',
        json: { kind: 'images', provider: 'openai', apiKey: 'sk-proj-good-1234567' },
      });
      expect((await integrations()).areas.images.keys.map((key) => key.model)).toEqual([
        'gpt-image-2.5-flare',
        'flux-3-image',
      ]);
    }
    {
      const { ctx: context, call, integrations } = await setup();
      const asked: string[] = [];
      answer = (url) => {
        asked.push(url);
        // The key goes in a header: Unsplash here stands for a service that refuses it.
        if (url.startsWith('https://api.unsplash.com/')) return new Response('', { status: 401 });
        return Response.json({
          photos: [
            {
              id: 42,
              width: 4000,
              height: 3000,
              url: 'https://www.pexels.com/photo/leuchtturm-42/',
              photographer: 'Jo',
              photographer_url: 'https://www.pexels.com/@jo',
              avg_color: '#336699',
              alt: 'Ein Leuchtturm',
              src: {
                original: 'https://images.pexels.com/photos/42/pexels-photo-42.jpeg',
                medium: 'https://images.pexels.com/photos/42/pexels-photo-42.jpeg?h=350',
              },
            },
          ],
        });
      };
      // Without a key of its own – and none on the instance: no photos.
      expect(await photoSource(context.deps, context.workspaceId)).toBeNull();

      await call('/keys', {
        method: 'POST',
        json: { kind: 'photos', provider: 'pexels', apiKey: 'pexels-good-12345678' },
      });
      expect((await integrations()).areas.photos.keys).toMatchObject([
        { provider: 'pexels', model: '', active: true },
      ]);
      const photos = await searchPhotos(context.deps, context.workspaceId, 'Leuchtturm');
      expect(photos).toMatchObject([
        { id: '42', description: 'Ein Leuchtturm', credit: { name: 'Jo', source: 'pexels' } },
      ]);
      expect(asked.at(-1)).toContain('https://api.pexels.com/v1/search?query=Leuchtturm');

      const refused = await call('/keys', {
        method: 'POST',
        json: { kind: 'photos', provider: 'unsplash', apiKey: 'unsplash-key-12345678' },
      });
      expect(refused.status).toBe(400);
      expect(JSON.stringify(refused.body)).toContain('Unsplash hat den API-Key abgelehnt');
    }
  });

  it('take SPEECH_URL over as a self-hosted key of the instance, and set one up without a key', async () => {
    {
      const {
        ctx: context,
        call,
        instance,
        integrations,
      } = await setup({
        instanceAdmin: true,
        config: { speech },
      });
      expect((await integrations()).areas.speech.inherited).toEqual({
        provider: 'self-hosted',
        model: 'whisper-large-v3-turbo',
        defaultModel: 'whisper-large-v3-turbo',
        createModel: null,
        defaultCreateModel: null,
      });
      const ofInstance = integrationsSchema.parse((await instance('')).body);
      expect(ofInstance.areas.speech.inherited).toBeNull();
      expect(ofInstance.areas.speech.keys).toMatchObject([
        {
          provider: 'self-hosted',
          baseUrl: 'http://stt:8000/v1',
          hint: '',
          model: 'whisper-large-v3-turbo',
          active: true,
          setByName: 'Umgebung des Servers (.env)',
        },
      ]);
      // Nothing else comes of it.
      expect((await integrations()).areas.ai.inherited).toBeNull();

      const sent: { url: string; init?: RequestInit }[] = [];
      answer = (url, init) => {
        sent.push({ url, init });
        return Response.json({ text: ' Guten Tag. ' });
      };
      const found = await workspaceSpeechConnection(context.deps, context.workspaceId);
      expect(found).toMatchObject({
        keyId: ofInstance.areas.speech.keys[0]!.id,
        connection: { provider: 'self-hosted', baseUrl: 'http://stt:8000/v1' },
      });
      const text = await transcribe(context.deps, found.connection!, recording, { language: 'de' });
      expect(text).toBe('Guten Tag.');
      expect(sent[0]!.url).toBe('http://stt:8000/v1/audio/transcriptions');
      expect(new Headers(sent[0]!.init?.headers).has('authorization')).toBe(false);
      const form = sent[0]!.init?.body as FormData;
      expect(form.get('model')).toBe('whisper-large-v3-turbo');
      expect(form.get('language')).toBe('de');
      expect((form.get('file') as File).name).toBe('aufnahme.webm');

      // A key of the workspace's own goes first.
      answer = () => Response.json({ data: [{ id: 'gpt-transcribe' }] });
      await call('/keys', {
        method: 'POST',
        json: { kind: 'speech', provider: 'openai', apiKey: 'sk-proj-good-1234' },
      });
      const own = await workspaceSpeechConnection(context.deps, context.workspaceId);
      expect(own.connection).toMatchObject({ provider: 'openai', model: 'gpt-transcribe' });

      // Removed, it stays removed – the same SPEECH_URL is not taken over again.
      const keyId = ofInstance.areas.speech.keys[0]!.id;
      expect((await instance(`/keys/${keyId}`, { method: 'DELETE' })).status).toBe(200);
      const after = integrationsSchema.parse((await instance('')).body);
      expect(after.areas.speech.keys).toEqual([]);

      // The instance sets up its own: an internal address, no key; asked for its models.
      answer = (url, init) => {
        sent.push({ url, init });
        return Response.json({ data: [{ id: 'Systran/faster-whisper-large-v3' }] });
      };
      sent.length = 0;
      const added = await instance('/keys', {
        method: 'POST',
        json: { kind: 'speech', provider: 'self-hosted', baseUrl: 'http://10.0.0.5:8000/v1/' },
      });
      expect(added.status).toBe(200);
      expect(sent[0]!.url).toBe('http://10.0.0.5:8000/v1/models');
      expect(new Headers(sent[0]!.init?.headers).has('authorization')).toBe(false);
      expect(integrationsSchema.parse(added.body).areas.speech.keys).toMatchObject([
        {
          provider: 'self-hosted',
          baseUrl: 'http://10.0.0.5:8000/v1',
          hint: '',
          model: 'Systran/faster-whisper-large-v3',
          active: true,
        },
      ]);
    }
    {
      const { ctx: context, call } = await setup({ config: { speech } });
      answer = () => Response.json({ data: [{ id: 'gpt-transcribe' }] });
      await call('/keys', {
        method: 'POST',
        json: { kind: 'speech', provider: 'openai', apiKey: 'sk-proj-good-1234' },
      });
      await context.deps.db
        .update(integrationKeys)
        .set({ error: 'Das Guthaben ist aufgebraucht.' });
      expect(await workspaceSpeechConnection(context.deps, context.workspaceId)).toEqual({
        connection: null,
        error: 'Das Guthaben ist aufgebraucht.',
      });

      // A workspace's own self-hosted service must not reach into the server's network.
      const stored = await call('/keys', {
        method: 'POST',
        json: { kind: 'speech', provider: 'self-hosted', baseUrl: 'http://10.0.0.5:8000/v1' },
      });
      expect(stored.status).toBe(400);
      expect(JSON.stringify(stored.body)).toContain('intern');
    }
    {
      const { ctx: context, integrations } = await setup();
      expect((await integrations()).areas.speech.inherited).toBeNull();
      const found = await workspaceSpeechConnection(context.deps, context.workspaceId);
      expect(found.error).toContain('Sprache zu Text nicht eingerichtet');
    }
  });
});
