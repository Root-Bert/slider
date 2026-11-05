import Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_AI_NAME,
  INTEGRATION_KINDS,
  isSpeechKind,
  providerAddress,
  type AddIntegrationKeyInput,
  type AiModelList,
  type InheritedIntegration,
  type IntegrationArea,
  type IntegrationKind,
  type IntegrationRule,
  type ModelProvider,
  type Integrations,
  type PhotoProvider,
  type SetInheritedModelInput,
  type UpdateIntegrationKeyInput,
  type UpdateWorkspaceAiInput,
  type Viewer,
} from '@slider/shared';
import { integrationKeys, workspaces, type IntegrationKeyRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, forbidden, isUniqueViolation, notFound } from '../http/errors';
import {
  keyHint,
  keyProblem,
  listImageModels,
  listModels,
  listLiveModels,
  listSpeechModels,
  ProviderHttpError,
  providerName,
  ProviderUnreachable,
  recommendedModel,
  type AiConnection,
  type AiModel,
} from './ai-providers';
import {
  assignedModel,
  inheritedRow,
  type AssignedModel,
  keyRows,
  readPolicy,
  ruleFor,
  savePolicy,
} from './integration-keys';
import { checkPhotoKey } from './stock-photos';
import { requireRole } from './workspaces';

/*
 * The integrations' keys (BER-183): the AI's models, speech to text, photos, pictures generated. The instance admin
 * stores keys for every workspace and sets per kind a rule – for all workspaces, and for single
 * ones apart: whether they may store their own, and whether they take over the instance's key
 * with its model, on a model of their choosing, or not at all. A workspace's admins store theirs
 * where they may. Each key is checked with its service before
 * it is stored; per place and kind one is active. Which key a request runs on: `integration-keys`.
 */

/** A workspace, or the instance (`null`). */
type Place = string | null;

const ADMINS_ONLY = 'Die Integrationen des Workspace verwalten nur Admins.';
const LOCKED = 'Eigene Keys dafür erlaubt der Instanz-Admin in diesem Workspace nicht.';
const NO_PICK = 'Das Modell dafür legt der Instanz-Admin fest.';

const ofPlace = (place: Place) =>
  place ? eq(integrationKeys.workspaceId, place) : isNull(integrationKeys.workspaceId);

/** A workspace's admin – and, to change a kind, one the instance lets the workspace store keys of. */
async function allowed(
  deps: AppDeps,
  viewer: Viewer,
  place: Place,
  kind?: IntegrationKind,
): Promise<void> {
  if (!place) return; // The instance's routes check their admin.
  await requireRole(deps.db, place, viewer.author.id, 'admin', ADMINS_ONLY);
  if (kind && !ruleFor(await readPolicy(deps), kind, place).ownKeys) throw forbidden(LOCKED);
}

/**
 * The models a key may run on – asking also checks the key. Its refusal as a 400 in German,
 * the service out of reach as a 503.
 */
async function checkedModels(
  deps: AppDeps,
  kind: Exclude<IntegrationKind, 'photos'>,
  connection: Omit<AiConnection, 'model'>,
): Promise<AiModel[]> {
  try {
    if (kind === 'ai') return await listModels(deps, connection);
    if (kind === 'live') return await listLiveModels(deps, connection);
    if (isSpeechKind(kind)) return await listSpeechModels(deps, connection);
    return await listImageModels(deps, connection);
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

const connectionOf = (
  row: Pick<IntegrationKeyRow, 'workspaceId' | 'provider' | 'apiKey' | 'baseUrl'>,
) => ({
  provider: row.provider as ModelProvider,
  apiKey: row.apiKey,
  baseUrl: row.baseUrl,
  instance: row.workspaceId === null,
});

/** Checks a key with its service; the model it starts on (empty for photos). */
async function checkKey(
  deps: AppDeps,
  kind: IntegrationKind,
  row: Pick<IntegrationKeyRow, 'workspaceId' | 'provider' | 'apiKey' | 'baseUrl'>,
): Promise<string> {
  if (kind === 'photos') {
    await checkPhotoKey(deps, row.provider as PhotoProvider, row.apiKey);
    return '';
  }
  const connection = connectionOf(row);
  const models = await checkedModels(deps, kind, connection);
  const model = recommendedModel(connection.provider, models, kind);
  if (!model) {
    throw badRequest(
      `Mit diesem Key bietet ${providerName(connection)} keine Modelle${{ ai: '', speech: ' für Sprache zu Text', voice: ' für Sprache zu Text', live: ' für Live-Mitschrift („realtime“)', images: ' zum Erzeugen von Bildern' }[kind]} an.`,
    );
  }
  return model;
}

const keyGone = () => notFound('Diesen API-Key gibt es nicht mehr.');

async function keyRow(deps: AppDeps, place: Place, keyId: string) {
  const [row] = await deps.db
    .select()
    .from(integrationKeys)
    .where(and(ofPlace(place), eq(integrationKeys.id, keyId)));
  if (!row) throw keyGone();
  return row;
}

/** What a workspace (or the instance) sees of its integrations. */
async function toDto(deps: AppDeps, place: Place): Promise<Integrations> {
  const policy = await readPolicy(deps);
  // The instance names the workspaces it treats apart – those still there.
  const apart = place
    ? []
    : [...new Set(Object.values(policy).flatMap((entry) => Object.keys(entry.exceptions)))];
  const [rows, instanceRows, workspace, names] = await Promise.all([
    keyRows(deps, place),
    place ? keyRows(deps, null) : Promise.resolve([]),
    place
      ? deps.db
          .select({ aiName: workspaces.aiName })
          .from(workspaces)
          .where(eq(workspaces.id, place))
          .then(([found]) => found)
      : Promise.resolve(undefined),
    apart.length > 0
      ? deps.db
          .select({ id: workspaces.id, name: workspaces.name })
          .from(workspaces)
          .where(inArray(workspaces.id, apart))
      : Promise.resolve([]),
  ]);
  const nameOf = new Map(names.map((row) => [row.id, row.name]));
  const area = async (kind: IntegrationKind): Promise<IntegrationArea> => {
    const own = rows.filter((row) => row.kind === kind);
    const rule = place ? ruleFor(policy, kind, place) : policy[kind].rule;
    const active = (place ? instanceRows : own).find((row) => row.kind === kind && row.active);
    const instance =
      place && active && rule.inherit !== 'none'
        ? await inheritedRow(deps, policy, place, active)
        : null;
    const inherited: InheritedIntegration | null = instance
      ? {
          provider: instance.provider,
          model: instance.model,
          // What it runs on without a pick of its own: the instance's model for it there.
          defaultModel: assignedModel(policy, kind, place!, active!.id) ?? active!.model,
          createModel: instance.createModel,
          defaultCreateModel:
            assignedModel(policy, kind, place!, active!.id, 'createModel') ?? active!.createModel,
        }
      : null;
    return {
      kind,
      // A workspace that may not store its own: its keys rest, unseen, until it may again.
      keys: !place || rule.ownKeys ? own.map(keyDto) : [],
      rule,
      exceptions: Object.entries(policy[kind].exceptions)
        .flatMap(([workspaceId, apartRule]) => {
          const name = nameOf.get(workspaceId);
          if (name === undefined) return [];
          const model = active ? assignedModel(policy, kind, workspaceId, active.id) : null;
          const createModel = active
            ? assignedModel(policy, kind, workspaceId, active.id, 'createModel')
            : null;
          return [{ workspaceId, name, rule: apartRule, model, createModel }];
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      inherited,
    };
  };
  const [ai, speech, voice, live, photos, images] = await Promise.all(INTEGRATION_KINDS.map(area));
  return {
    areas: {
      ai: ai!,
      speech: speech!,
      voice: voice!,
      live: live!,
      photos: photos!,
      images: images!,
    },
    aiName: place ? (workspace?.aiName ?? DEFAULT_AI_NAME) : null,
  };
}

const keyDto = (row: IntegrationKeyRow) => ({
  id: row.id,
  kind: row.kind,
  provider: row.provider,
  baseUrl: row.baseUrl,
  hint: row.hint,
  model: row.model,
  createModel: row.createModel,
  active: row.active,
  setByName: row.setByName ?? 'Unbekannt',
  setAt: row.setAt.toISOString(),
  error: row.error,
});

export async function getIntegrations(
  deps: AppDeps,
  viewer: Viewer,
  place: Place,
): Promise<Integrations> {
  await allowed(deps, viewer, place);
  return toDto(deps, place);
}

/** Names the workspace's AI; an empty name gives it back its default. */
export async function updateWorkspaceAi(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  input: UpdateWorkspaceAiInput,
): Promise<Integrations> {
  await allowed(deps, viewer, workspaceId);
  const name = input.name.replace(/\s+/g, ' ');
  await deps.db
    .update(workspaces)
    .set({ aiName: name && name !== DEFAULT_AI_NAME ? name : null })
    .where(eq(workspaces.id, workspaceId));
  return toDto(deps, workspaceId);
}

/** Throws unless the key offers `model` – asking its service. */
async function requireOffered(
  deps: AppDeps,
  row: IntegrationKeyRow & { kind: Exclude<IntegrationKind, 'photos'> },
  model: string,
): Promise<void> {
  const models = await checkedModels(deps, row.kind, connectionOf(row));
  if (!models.some((offered) => offered.id === model)) {
    throw badRequest(`Dieses Modell bietet ${providerName(connectionOf(row))} nicht an.`);
  }
}

/** The instance's active key of a kind – one with a model. */
async function activeInstanceKey(deps: AppDeps, kind: IntegrationKind) {
  if (kind === 'photos') throw badRequest('Fotodienste haben kein Modell.');
  const [row] = await keyRows(deps, null, kind).then((rows) => rows.filter((each) => each.active));
  if (!row) throw notFound('Die Instanz hat dafür gerade keinen Key aktiv.');
  return row as IntegrationKeyRow & { kind: Exclude<IntegrationKind, 'photos'> };
}

/** Only the AI creates decks: a model for that only there. */
const CREATE_AI_ONLY = 'Ein Modell zum Erstellen von Präsentationen gibt es nur für die KI.';

/**
 * A model picked anew beside the one it falls back to: left out (`undefined`) as it was, `null`
 * or the fallback itself none of its own – a later change of the fallback applies there too.
 */
const picked = (
  next: string | null | undefined,
  before: string | undefined,
  fallback: string | null,
): string | undefined =>
  next === undefined ? before : next === null || next === fallback ? undefined : next;

/**
 * The rule of a kind for all workspaces (`workspaceId` `null`), or for one apart – `null` gives
 * it back to the rule for all. For one apart, `model` sets the model of the instance's active
 * key there (`null`: the key's own; left out: as it is), `createModel` (AI) the one it creates
 * decks on there, alike. The instance's only.
 */
export async function setIntegrationPolicy(
  deps: AppDeps,
  kind: IntegrationKind,
  workspaceId: string | null,
  rule: IntegrationRule | null,
  model?: string | null,
  createModel?: string | null,
): Promise<Integrations> {
  if (createModel !== undefined && kind !== 'ai') throw badRequest(CREATE_AI_ONLY);
  if (workspaceId) {
    const [found] = await deps.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!found) throw notFound('Diesen Workspace gibt es nicht mehr.');
  }
  // Photos have no model to pick.
  const stored =
    rule && kind === 'photos' && rule.inherit === 'key'
      ? { ...rule, inherit: 'all' as const }
      : rule;
  let assigned: AssignedModel | null | undefined;
  if ((model !== undefined || createModel !== undefined) && workspaceId && stored) {
    const row = await activeInstanceKey(deps, kind);
    const before = (await readPolicy(deps))[kind].models[workspaceId];
    const kept = before?.keyId === row.id ? before : undefined;
    const next = {
      model: picked(model, kept?.model, row.model),
      createModel: picked(createModel, kept?.createModel, row.createModel),
    };
    for (const name of [next.model, next.createModel]) {
      if (name && name !== row.model) await requireOffered(deps, row, name);
    }
    // The key's own model is none set: a later change of it applies there too.
    assigned =
      next.model || next.createModel
        ? {
            keyId: row.id,
            ...(next.model && { model: next.model }),
            ...(next.createModel && { createModel: next.createModel }),
          }
        : null;
  }
  await savePolicy(deps, kind, workspaceId, stored, assigned);
  return toDto(deps, null);
}

/** The instance's active key of a kind, where the rule lets the workspace pick its model. */
async function pickableKey(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  kind: IntegrationKind,
): Promise<IntegrationKeyRow & { kind: Exclude<IntegrationKind, 'photos'> }> {
  await allowed(deps, viewer, workspaceId);
  const rule = ruleFor(await readPolicy(deps), kind, workspaceId);
  if (kind === 'photos' || rule.inherit !== 'key') throw forbidden(NO_PICK);
  return activeInstanceKey(deps, kind);
}

/** The models the instance's key offers – for a workspace that may pick one. */
export async function inheritedModels(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  kind: IntegrationKind,
): Promise<AiModelList> {
  const row = await pickableKey(deps, viewer, workspaceId, kind);
  return { models: await checkedModels(deps, row.kind, connectionOf(row)) };
}

/** The model a workspace runs the instance's key on; `null`: the instance's. */
export async function setInheritedModel(
  deps: AppDeps,
  viewer: Viewer,
  workspaceId: string,
  kind: IntegrationKind,
  input: SetInheritedModelInput,
): Promise<Integrations> {
  const row = await pickableKey(deps, viewer, workspaceId, kind);
  if (input.createModel !== undefined && kind !== 'ai') throw badRequest(CREATE_AI_ONLY);
  const policy = await readPolicy(deps);
  const [found] = await deps.db
    .select({ models: workspaces.integrationModels })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const before = found?.models[kind];
  const kept = before?.keyId === row.id ? before : undefined;
  // Without a pick: the model the instance set for this workspace, else the key's own.
  const next = {
    model: picked(
      input.model,
      kept?.model,
      assignedModel(policy, kind, workspaceId, row.id) ?? row.model,
    ),
    createModel: picked(
      input.createModel,
      kept?.createModel,
      assignedModel(policy, kind, workspaceId, row.id, 'createModel') ?? row.createModel,
    ),
  };
  for (const name of [next.model, next.createModel]) {
    if (name && name !== row.model) await requireOffered(deps, row, name);
  }
  // The instance's model is no pick: a later change of it applies here too.
  const pick =
    next.model || next.createModel
      ? {
          keyId: row.id,
          ...(next.model && { model: next.model }),
          ...(next.createModel && { createModel: next.createModel }),
        }
      : null;
  await deps.db
    .update(workspaces)
    .set({
      integrationModels: pick
        ? sql`${workspaces.integrationModels} || ${JSON.stringify({ [kind]: pick })}::jsonb`
        : sql`${workspaces.integrationModels} - ${kind}`,
    })
    .where(eq(workspaces.id, workspaceId));
  return toDto(deps, workspaceId);
}

/**
 * Stores a key once its service accepted it (AI and speech on the recommended model); the first
 * key of its kind – or one added while none is active, or the active one was refused – becomes
 * the active one.
 */
export async function addIntegrationKey(
  deps: AppDeps,
  viewer: Viewer,
  place: Place,
  input: AddIntegrationKeyInput,
): Promise<Integrations> {
  await allowed(deps, viewer, place, input.kind);
  const address = providerAddress(input.provider);
  const connection = {
    provider: input.provider,
    apiKey: input.apiKey.trim(),
    baseUrl: address === 'none' ? null : input.baseUrl?.trim().replace(/\/+$/, '') || null,
  };
  const model = await checkKey(deps, input.kind, { ...connection, workspaceId: place });
  // The instance may have locked the kind while the service was asked.
  await allowed(deps, viewer, place, input.kind);
  const rows = await keyRows(deps, place, input.kind);
  const key = (active: boolean) => ({
    id: crypto.randomUUID(),
    workspaceId: place,
    kind: input.kind,
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
          .update(integrationKeys)
          .set({ active: false })
          .where(eq(integrationKeys.id, current.id));
        await tx.insert(integrationKeys).values(key(true));
      });
    } catch (error) {
      // Another key took over meanwhile (two added at once): this one waits beside it.
      if (!isUniqueViolation(error)) throw error;
      await deps.db.insert(integrationKeys).values(key(false));
    }
    return toDto(deps, place);
  }
  const active = !current;
  try {
    await deps.db.insert(integrationKeys).values(key(active));
  } catch (error) {
    // Another key became active meanwhile (two added at once): this one waits beside it.
    if (!active || !isUniqueViolation(error)) throw error;
    await deps.db.insert(integrationKeys).values(key(false));
  }
  return toDto(deps, place);
}

/**
 * Makes a key the active one – or none, so the instance's applies –, or picks its model, one its
 * service offers it. A refused key is asked again on the way: it answers, it works again.
 */
export async function updateIntegrationKey(
  deps: AppDeps,
  viewer: Viewer,
  place: Place,
  keyId: string,
  input: UpdateIntegrationKeyInput,
): Promise<Integrations> {
  await allowed(deps, viewer, place);
  const row = await keyRow(deps, place, keyId);
  await allowed(deps, viewer, place, row.kind);
  if (input.model !== undefined && row.kind === 'photos') {
    throw badRequest('Fotodienste haben kein Modell.');
  }
  if (input.createModel !== undefined && row.kind !== 'ai') throw badRequest(CREATE_AI_ONLY);
  const model = input.model !== undefined && input.model !== row.model ? input.model : null;
  // `null` none of its own: decks are created on `model`.
  const createModel =
    input.createModel !== undefined && input.createModel !== row.createModel
      ? input.createModel
      : undefined;
  if (
    model !== null ||
    createModel !== undefined ||
    (row.error && (input.recheck || input.active || input.model !== undefined))
  ) {
    if (row.kind === 'photos') {
      await checkPhotoKey(deps, row.provider as PhotoProvider, row.apiKey);
    } else {
      const models = await checkedModels(deps, row.kind, connectionOf(row));
      for (const name of [model, createModel]) {
        if (name && !models.some((offered) => offered.id === name)) {
          throw badRequest(
            `Dieses Modell bietet ${providerName(connectionOf(row))} mit dem Key nicht an.`,
          );
        }
      }
    }
    // It answered: the key works again – unless it was removed while the service was asked.
    const updated = await deps.db
      .update(integrationKeys)
      .set({
        ...(model !== null ? { model } : {}),
        ...(createModel !== undefined ? { createModel } : {}),
        error: null,
      })
      .where(eq(integrationKeys.id, keyId))
      .returning({ id: integrationKeys.id });
    if (updated.length === 0) throw keyGone();
  }
  const ofKind = and(ofPlace(place), eq(integrationKeys.kind, row.kind));
  if (input.active === true && !row.active) {
    await deps.db.transaction(async (tx) => {
      // Locked first: removed meanwhile, nothing changes – the old key stays the active one.
      const [target] = await tx
        .select({ id: integrationKeys.id })
        .from(integrationKeys)
        .where(and(ofPlace(place), eq(integrationKeys.id, keyId)))
        .for('update');
      if (!target) throw keyGone();
      await tx
        .update(integrationKeys)
        .set({ active: false })
        .where(and(ofKind, eq(integrationKeys.active, true)));
      await tx.update(integrationKeys).set({ active: true }).where(eq(integrationKeys.id, keyId));
    });
  } else if (input.active === false && row.active) {
    await deps.db
      .update(integrationKeys)
      .set({ active: false })
      .where(eq(integrationKeys.id, keyId));
  }
  return toDto(deps, place);
}

/** Removes a key; removing the active one leaves the kind to the instance's, or off. */
export async function removeIntegrationKey(
  deps: AppDeps,
  viewer: Viewer,
  place: Place,
  keyId: string,
): Promise<Integrations> {
  await allowed(deps, viewer, place);
  const row = await keyRow(deps, place, keyId);
  await allowed(deps, viewer, place, row.kind);
  await deps.db.delete(integrationKeys).where(eq(integrationKeys.id, keyId));
  return toDto(deps, place);
}

/** The models a stored key may run on – for picking one. */
export async function integrationKeyModels(
  deps: AppDeps,
  viewer: Viewer,
  place: Place,
  keyId: string,
): Promise<AiModelList> {
  await allowed(deps, viewer, place);
  const row = await keyRow(deps, place, keyId);
  await allowed(deps, viewer, place, row.kind);
  if (row.kind === 'photos') return { models: [] };
  return { models: await checkedModels(deps, row.kind, connectionOf(row)) };
}
