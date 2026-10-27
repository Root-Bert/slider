import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type {
  AddWorkspaceAiKeyInput,
  AiModelList,
  UpdateWorkspaceAiKeyInput,
  Viewer,
  WorkspaceAi,
} from '@slider/shared';
import { workspaceAiKeys, workspaces, type WorkspaceAiKeyRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, isUniqueViolation, notFound } from '../http/errors';
import {
  DEFAULT_ANTHROPIC_MODEL,
  keyHint,
  keyProblem,
  listModels,
  ProviderHttpError,
  providerName,
  ProviderUnreachable,
  recommendedModel,
  type AiConnection,
  type AiModel,
} from './ai-providers';
import { requireRole } from './workspaces';

/*
 * The workspace's AI (BER-183): its admins store API keys – Anthropic, OpenAI, Google Gemini or a
 * service speaking OpenAI's API – and set one of them active, with a model. Every member's AI
 * requests run on that one, on the server; keys never leave the server.
 */

const ADMINS_ONLY = 'Die KI des Workspace verwalten nur Admins.';

/**
 * The models a key may run on – asking also checks the key. Its refusal as a 400 in German,
 * the service out of reach as a 503.
 */
async function checkedModels(
  deps: AppDeps,
  connection: Omit<AiConnection, 'model'>,
): Promise<AiModel[]> {
  try {
    return await listModels(deps, connection);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const name = providerName(connection);
    const problem = keyProblem(error, connection);
    if (problem) throw badRequest(problem);
    if (error instanceof Anthropic.APIConnectionError || error instanceof ProviderUnreachable) {
      throw new ApiError(
        503,
        'source_unreachable',
        `${name} ist gerade nicht erreichbar. Bitte gleich nochmal versuchen.`,
      );
    }
    if (error instanceof Anthropic.APIError || error instanceof ProviderHttpError) {
      throw badRequest(
        `Der Key ließ sich nicht prüfen – ${name} meldet: ${error.message.slice(0, 200)}`,
      );
    }
    throw error;
  }
}

/**
 * A key stored before workspaces had several (one Anthropic key on the workspace itself) moves
 * over on first use – re-sealed for its new column, so this cannot be done in SQL.
 */
async function moveOldKey(deps: AppDeps, workspaceId: string): Promise<void> {
  // Nothing writes the old column any more: a workspace checked once stays without one.
  if (movedOldKeys.has(workspaceId)) return;
  const [found] = await deps.db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNotNull(workspaces.aiApiKey)));
  if (!found) {
    movedOldKeys.add(workspaceId);
    return;
  }
  await deps.db.transaction(async (tx) => {
    // Locked and read again: two requests at once move it once.
    const [old] = await tx
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNotNull(workspaces.aiApiKey)))
      .for('update');
    if (!old?.aiApiKey) return;
    const [active] = await tx
      .select({ id: workspaceAiKeys.id })
      .from(workspaceAiKeys)
      .where(and(eq(workspaceAiKeys.workspaceId, workspaceId), eq(workspaceAiKeys.active, true)));
    await tx.insert(workspaceAiKeys).values({
      id: crypto.randomUUID(),
      workspaceId,
      provider: 'anthropic',
      baseUrl: null,
      apiKey: old.aiApiKey!,
      hint: keyHint(old.aiApiKey!),
      model: DEFAULT_ANTHROPIC_MODEL,
      active: !active,
      setById: old.aiKeySetById,
      setByName: old.aiKeySetByName,
      setAt: old.aiKeySetAt ?? deps.clock.now(),
      error: old.aiKeyError,
    });
    await tx
      .update(workspaces)
      .set({
        aiApiKey: null,
        aiKeyHint: null,
        aiKeySetById: null,
        aiKeySetByName: null,
        aiKeySetAt: null,
        aiKeyError: null,
      })
      .where(eq(workspaces.id, workspaceId));
  });
  movedOldKeys.add(workspaceId);
}

/** Workspaces whose old key was moved (or that had none), in this process. */
const movedOldKeys = new Set<string>();

async function keyRows(deps: AppDeps, workspaceId: string): Promise<WorkspaceAiKeyRow[]> {
  await moveOldKey(deps, workspaceId);
  return deps.db
    .select()
    .from(workspaceAiKeys)
    .where(eq(workspaceAiKeys.workspaceId, workspaceId))
    .orderBy(desc(workspaceAiKeys.setAt));
}

const keyGone = () => notFound('Diesen API-Key gibt es nicht mehr.');

async function keyRow(deps: AppDeps, workspaceId: string, keyId: string) {
  const [row] = await deps.db
    .select()
    .from(workspaceAiKeys)
    .where(and(eq(workspaceAiKeys.workspaceId, workspaceId), eq(workspaceAiKeys.id, keyId)));
  if (!row) throw keyGone();
  return row;
}

async function toDto(deps: AppDeps, workspaceId: string): Promise<WorkspaceAi> {
  return {
    keys: (await keyRows(deps, workspaceId)).map((row) => ({
      id: row.id,
      provider: row.provider,
      baseUrl: row.baseUrl,
      hint: row.hint,
      model: row.model,
      active: row.active,
      setByName: row.setByName ?? 'Unbekannt',
      setAt: row.setAt.toISOString(),
      error: row.error,
    })),
  };
}

export async function getWorkspaceAi(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
): Promise<WorkspaceAi> {
  await requireRole(deps.db, workspaceId, viewer.author.id, 'admin', ADMINS_ONLY);
  return toDto(deps, workspaceId);
}

/**
 * Stores a key once its provider accepted it, on the recommended model; the first key – or one
 * added while none is active, or the active one was refused – becomes the active one.
 */
export async function addWorkspaceAiKey(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  input: AddWorkspaceAiKeyInput,
): Promise<WorkspaceAi> {
  await requireRole(deps.db, workspaceId, viewer.author.id, 'admin', ADMINS_ONLY);
  const connection = {
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    baseUrl:
      input.provider === 'custom' ? (input.baseUrl?.trim().replace(/\/+$/, '') ?? null) : null,
  };
  const models = await checkedModels(deps, connection);
  const model = recommendedModel(connection.provider, models);
  if (!model) {
    throw badRequest(`Mit diesem Key bietet ${providerName(connection)} keine Modelle an.`);
  }
  const rows = await keyRows(deps, workspaceId);
  const key = (active: boolean) => ({
    id: crypto.randomUUID(),
    workspaceId,
    ...connection,
    hint: keyHint(connection.apiKey),
    model,
    active,
    setById: viewer.author.id,
    setByName: viewer.author.name,
    setAt: deps.clock.now(),
    error: null,
  });
  const current = rows.find((row) => row.active);
  if (current?.error) {
    // The active key was refused: the new one takes over.
    try {
      await deps.db.transaction(async (tx) => {
        await tx
          .update(workspaceAiKeys)
          .set({ active: false })
          .where(eq(workspaceAiKeys.id, current.id));
        await tx.insert(workspaceAiKeys).values(key(true));
      });
    } catch (error) {
      // Another key took over meanwhile (two added at once): this one waits beside it.
      if (!isUniqueViolation(error)) throw error;
      await deps.db.insert(workspaceAiKeys).values(key(false));
    }
    return toDto(deps, workspaceId);
  }
  const active = !current;
  try {
    await deps.db.insert(workspaceAiKeys).values(key(active));
  } catch (error) {
    // Another key became active meanwhile (two added at once): this one waits beside it.
    if (!active || !isUniqueViolation(error)) throw error;
    await deps.db.insert(workspaceAiKeys).values(key(false));
  }
  return toDto(deps, workspaceId);
}

/**
 * Makes a key the active one, or picks its model – one its provider offers it. A refused key is
 * asked again on the way: it answers, it works again.
 */
export async function updateWorkspaceAiKey(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  keyId: string,
  input: UpdateWorkspaceAiKeyInput,
): Promise<WorkspaceAi> {
  await requireRole(deps.db, workspaceId, viewer.author.id, 'admin', ADMINS_ONLY);
  const row = await keyRow(deps, workspaceId, keyId);
  if (input.model !== undefined && input.model !== row.model) {
    const models = await checkedModels(deps, row);
    if (!models.some((model) => model.id === input.model)) {
      throw badRequest(`Dieses Modell bietet ${providerName(row)} mit dem Key nicht an.`);
    }
    // It answered: the key works again – unless it was removed while the provider was asked.
    const updated = await deps.db
      .update(workspaceAiKeys)
      .set({ model: input.model, error: null })
      .where(eq(workspaceAiKeys.id, keyId))
      .returning({ id: workspaceAiKeys.id });
    if (updated.length === 0) throw keyGone();
  } else if (row.error && (input.recheck || input.active || input.model !== undefined)) {
    await checkedModels(deps, row);
    const updated = await deps.db
      .update(workspaceAiKeys)
      .set({ error: null })
      .where(eq(workspaceAiKeys.id, keyId))
      .returning({ id: workspaceAiKeys.id });
    if (updated.length === 0) throw keyGone();
  }
  if (input.active && !row.active) {
    await deps.db.transaction(async (tx) => {
      // Locked first: removed meanwhile, nothing changes – the old key stays the active one.
      const [target] = await tx
        .select({ id: workspaceAiKeys.id })
        .from(workspaceAiKeys)
        .where(and(eq(workspaceAiKeys.workspaceId, workspaceId), eq(workspaceAiKeys.id, keyId)))
        .for('update');
      if (!target) throw keyGone();
      await tx
        .update(workspaceAiKeys)
        .set({ active: false })
        .where(and(eq(workspaceAiKeys.workspaceId, workspaceId), eq(workspaceAiKeys.active, true)));
      await tx.update(workspaceAiKeys).set({ active: true }).where(eq(workspaceAiKeys.id, keyId));
    });
  }
  return toDto(deps, workspaceId);
}

/** Removes a key; removing the active one turns the AI off until another is set active. */
export async function removeWorkspaceAiKey(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  keyId: string,
): Promise<WorkspaceAi> {
  await requireRole(deps.db, workspaceId, viewer.author.id, 'admin', ADMINS_ONLY);
  await keyRow(deps, workspaceId, keyId);
  await deps.db.delete(workspaceAiKeys).where(eq(workspaceAiKeys.id, keyId));
  return toDto(deps, workspaceId);
}

/** The models a stored key may run on – for picking one. */
export async function workspaceAiModels(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  keyId: string,
): Promise<AiModelList> {
  await requireRole(deps.db, workspaceId, viewer.author.id, 'admin', ADMINS_ONLY);
  const row = await keyRow(deps, workspaceId, keyId);
  return { models: await checkedModels(deps, row) };
}

/** The workspace's active key for an AI request, with its id – or why there is none (German). */
export async function workspaceAiConnection(
  deps: AppDeps,
  workspaceId: string,
): Promise<
  { connection: AiConnection; keyId: string; error: null } | { connection: null; error: string }
> {
  const rows = await keyRows(deps, workspaceId);
  const active = rows.find((row) => row.active);
  if (!active) {
    return {
      connection: null,
      error:
        rows.length === 0
          ? 'In diesem Workspace ist keine KI eingerichtet – ein Admin hinterlegt dafür in den Einstellungen einen API-Key.'
          : 'In diesem Workspace ist kein API-Key aktiv – ein Admin setzt in den Einstellungen einen aktiv.',
    };
  }
  if (active.error) return { connection: null, error: active.error };
  return {
    connection: {
      provider: active.provider,
      apiKey: active.apiKey,
      baseUrl: active.baseUrl,
      model: active.model,
    },
    keyId: active.id,
    error: null,
  };
}

/** Remembers that the provider refused the key, so the settings show why the AI stopped. */
export async function markKeyRefused(deps: AppDeps, keyId: string, problem: string): Promise<void> {
  await deps.db
    .update(workspaceAiKeys)
    .set({ error: problem })
    .where(eq(workspaceAiKeys.id, keyId));
}
