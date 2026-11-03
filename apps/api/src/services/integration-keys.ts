import { and, desc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  DEFAULT_INTEGRATION_RULE,
  INTEGRATION_INHERITS,
  INTEGRATION_KINDS,
  SERVER_PROVIDER,
  type IntegrationKind,
  type IntegrationRule,
} from '@slider/shared';
import {
  instanceSettings,
  integrationKeys,
  workspaces,
  type IntegrationKeyRow,
} from '../db/schema';
import type { Executor } from '../db/client';
import type { AppDeps } from '../deps';
import { sha256Hex } from '../import/common';
import {
  DEFAULT_ANTHROPIC_MODEL,
  keyHint,
  listLiveModels,
  recommendedModel,
  type AiConnection,
} from './ai-providers';
import { usageMeter } from './ai-usage';

/*
 * Which key an integration runs on. Per kind, the instance and each workspace keep several keys
 * with one active. The instance's rule (the policy) – for all workspaces, or for one apart – says
 * whether a workspace may use keys of its own and what it takes over of the instance's: its own
 * active key comes first, else the instance's, as far as the rule lets it.
 */

/** Where the policy is kept: beside the instance's other settings, read live – no restart. */
const POLICY_KEY = 'INTEGRATION_POLICY';

/** A model the instance runs its key on in one workspace – for that key only. */
export interface AssignedModel {
  keyId: string;
  model: string;
}

/**
 * Per kind, the rule for all workspaces and those for single ones apart – each of those with the
 * model of the instance's key there, where the instance set one.
 */
export type IntegrationPolicy = Record<
  IntegrationKind,
  {
    rule: IntegrationRule;
    exceptions: Record<string, IntegrationRule>;
    models: Record<string, AssignedModel>;
  }
>;

function parseModel(stored: unknown): AssignedModel | null {
  if (!stored || typeof stored !== 'object' || !('model' in stored)) return null;
  const { model } = stored;
  if (!model || typeof model !== 'object') return null;
  const { keyId, model: name } = model as Partial<Record<string, unknown>>;
  return typeof keyId === 'string' && typeof name === 'string' ? { keyId, model: name } : null;
}

/** A stored rule; once only `true`/`false` – whether workspaces may set their own. */
function parseRule(stored: unknown): IntegrationRule | null {
  if (typeof stored === 'boolean') return { ownKeys: stored, inherit: 'all' };
  if (!stored || typeof stored !== 'object') return null;
  const { ownKeys, inherit } = stored as Partial<Record<string, unknown>>;
  if (typeof ownKeys !== 'boolean') return null;
  const known = INTEGRATION_INHERITS.find((value) => value === inherit) ?? 'all';
  // Neither its own nor the instance's would leave it nothing: the instance's, then.
  return { ownKeys, inherit: !ownKeys && known === 'none' ? 'all' : known };
}

export async function readPolicy(deps: { db: Executor }): Promise<IntegrationPolicy> {
  const [row] = await deps.db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, POLICY_KEY));
  let stored: Partial<Record<string, unknown>> = {};
  try {
    stored = row ? (JSON.parse(row.value) as Partial<Record<string, unknown>>) : {};
  } catch {
    // Unreadable: as if nothing was said – workspaces may.
  }
  return Object.fromEntries(
    INTEGRATION_KINDS.map((kind) => {
      const entry = stored[kind];
      const apart =
        entry && typeof entry === 'object' && 'workspaces' in entry ? entry.workspaces : null;
      const entries = Object.entries(apart && typeof apart === 'object' ? apart : {});
      const exceptions = Object.fromEntries(
        entries.flatMap(([id, rule]) => {
          const parsed = parseRule(rule);
          return parsed ? [[id, parsed]] : [];
        }),
      );
      const models = Object.fromEntries(
        entries.flatMap(([id, rule]) => {
          const model = id in exceptions ? parseModel(rule) : null;
          return model ? [[id, model]] : [];
        }),
      );
      return [kind, { rule: parseRule(entry) ?? DEFAULT_INTEGRATION_RULE, exceptions, models }];
    }),
  ) as IntegrationPolicy;
}

/** The rule that applies to a workspace – its own apart, else the one for all. */
export const ruleFor = (
  policy: IntegrationPolicy,
  kind: IntegrationKind,
  workspaceId: string,
): IntegrationRule => policy[kind].exceptions[workspaceId] ?? policy[kind].rule;

/**
 * Sets the rule for all workspaces (`workspaceId` `null`), or one's apart – `null` ends it, its
 * model with it. `model`: for one apart, the model of the instance's key there (`null` none);
 * left out, it stays as it is.
 */
export async function savePolicy(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  kind: IntegrationKind,
  workspaceId: string | null,
  rule: IntegrationRule | null,
  model?: AssignedModel | null,
): Promise<void> {
  const policy = await readPolicy(deps);
  const entry = policy[kind];
  if (!workspaceId) entry.rule = rule ?? DEFAULT_INTEGRATION_RULE;
  else if (rule) {
    entry.exceptions[workspaceId] = rule;
    if (model) entry.models[workspaceId] = model;
    else if (model === null) delete entry.models[workspaceId];
  } else {
    delete entry.exceptions[workspaceId];
    delete entry.models[workspaceId];
  }
  const value = JSON.stringify(
    Object.fromEntries(
      INTEGRATION_KINDS.map((each) => [
        each,
        {
          ...policy[each].rule,
          workspaces: Object.fromEntries(
            Object.entries(policy[each].exceptions).map(([id, apart]) => {
              const assigned = policy[each].models[id];
              return [id, assigned ? { ...apart, model: assigned } : apart];
            }),
          ),
        },
      ]),
    ),
  );
  const now = deps.clock.now();
  await deps.db
    .insert(instanceSettings)
    .values({ key: POLICY_KEY, value, updatedAt: now })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: now } });
}

/** The model the instance set for its key `keyId` in a workspace apart – `null`: none. */
export const assignedModel = (
  policy: IntegrationPolicy,
  kind: IntegrationKind,
  workspaceId: string,
  keyId: string,
): string | null => {
  const assigned = policy[kind].models[workspaceId];
  return assigned && assigned.keyId === keyId && workspaceId in policy[kind].exceptions
    ? assigned.model
    : null;
};

/**
 * The instance's key as a workspace runs on it: on the model the instance set for it there, or
 * the key's own – and where the rule lets the workspace pick, on its pick, made for this key.
 */
export async function inheritedRow(
  deps: { db: Executor },
  policy: IntegrationPolicy,
  workspaceId: string,
  instance: IntegrationKeyRow,
): Promise<IntegrationKeyRow> {
  if (instance.kind === 'photos') return instance;
  const assigned = assignedModel(policy, instance.kind, workspaceId, instance.id);
  const base = assigned ? { ...instance, model: assigned } : instance;
  if (ruleFor(policy, instance.kind, workspaceId).inherit !== 'key') return base;
  const [found] = await deps.db
    .select({ models: workspaces.integrationModels })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const pick = found?.models[instance.kind];
  return pick && pick.keyId === instance.id ? { ...instance, model: pick.model } : base;
}

/** The keys of one place – a workspace, or the instance (`null`) – newest first. */
export async function keyRows(
  deps: AppDeps,
  workspaceId: string | null,
  kind?: IntegrationKind,
): Promise<IntegrationKeyRow[]> {
  if (workspaceId) await moveOldKey(deps, workspaceId);
  else await importEnvKeys(deps);
  if (!kind || kind === 'live') await adoptLiveKey(deps, workspaceId);
  return deps.db
    .select()
    .from(integrationKeys)
    .where(
      and(
        workspaceId
          ? eq(integrationKeys.workspaceId, workspaceId)
          : isNull(integrationKeys.workspaceId),
        kind ? eq(integrationKeys.kind, kind) : undefined,
      ),
    )
    .orderBy(desc(integrationKeys.setAt));
}

export type EffectiveKey =
  | { row: IntegrationKeyRow; from: 'workspace' | 'instance' }
  | {
      row: null;
      /** `locked`: the workspace may not use its own, and the instance has no key active. */
      why: 'locked' | 'none' | 'inactive';
    };

/** The key a workspace's requests of a kind run on – its own, or the instance's. */
export async function effectiveKey(
  deps: AppDeps,
  workspaceId: string,
  kind: IntegrationKind,
): Promise<EffectiveKey> {
  if (kind === 'ai') await moveOldKey(deps, workspaceId);
  await importEnvKeys(deps, kind);
  if (kind === 'live') {
    await adoptLiveKey(deps, null);
    await adoptLiveKey(deps, workspaceId);
  }
  const [policy, rows] = await Promise.all([
    readPolicy(deps),
    deps.db
      .select()
      .from(integrationKeys)
      .where(
        and(
          eq(integrationKeys.kind, kind),
          or(eq(integrationKeys.workspaceId, workspaceId), isNull(integrationKeys.workspaceId)),
        ),
      ),
  ]);
  const rule = ruleFor(policy, kind, workspaceId);
  const active = rows.find((row) => row.workspaceId === null && row.active);
  const instance =
    active && rule.inherit !== 'none'
      ? await inheritedRow(deps, policy, workspaceId, active)
      : undefined;
  if (!rule.ownKeys)
    return instance ? { row: instance, from: 'instance' } : { row: null, why: 'locked' };
  const own = rows.find((row) => row.workspaceId === workspaceId && row.active);
  if (own) return { row: own, from: 'workspace' };
  if (instance) return { row: instance, from: 'instance' };
  return {
    row: null,
    why: rows.some((row) => row.workspaceId === workspaceId) ? 'inactive' : 'none',
  };
}

/** Why a workspace has nothing of a kind to run on, per kind (German). */
const MISSING = {
  ai: {
    locked:
      'Auf dieser Instanz ist keine KI eingerichtet – der Instanz-Admin hinterlegt dafür unter „Integrationen“ einen API-Key.',
    none: 'In diesem Workspace ist keine KI eingerichtet – ein Admin hinterlegt dafür in den Einstellungen unter „Integrationen“ einen API-Key.',
    inactive:
      'In diesem Workspace ist kein API-Key aktiv – ein Admin setzt in den Einstellungen unter „Integrationen“ einen aktiv.',
  },
  speech: {
    locked:
      'Auf dieser Instanz ist Sprache zu Text nicht eingerichtet – der Instanz-Admin hinterlegt dafür unter „Integrationen“ einen API-Key.',
    none: 'In diesem Workspace ist Sprache zu Text nicht eingerichtet – ein Admin hinterlegt dafür in den Einstellungen unter „Integrationen“ einen API-Key.',
    inactive:
      'In diesem Workspace ist kein Key für Sprache zu Text aktiv – ein Admin setzt in den Einstellungen unter „Integrationen“ einen aktiv.',
  },
  images: {
    locked:
      'Auf dieser Instanz ist keine Bildgenerierung eingerichtet – der Instanz-Admin hinterlegt dafür unter „Integrationen“ einen API-Key.',
    none: 'In diesem Workspace ist keine Bildgenerierung eingerichtet – ein Admin hinterlegt dafür in den Einstellungen unter „Integrationen“ einen API-Key.',
    inactive:
      'In diesem Workspace ist kein Key für Bildgenerierung aktiv – ein Admin setzt in den Einstellungen unter „Integrationen“ einen aktiv.',
  },
} as const;

/** `keyId`: the key it runs on. */
type WorkspaceConnection =
  { connection: AiConnection; keyId: string; error: null } | { connection: null; error: string };

/**
 * The key a workspace's request of a kind runs on, with its id – or why there is none. A key the
 * service refused stays the answer – its error, not quietly another.
 */
async function workspaceConnection(
  deps: AppDeps,
  workspaceId: string,
  kind: 'ai' | 'speech' | 'images',
): Promise<WorkspaceConnection> {
  const found = await effectiveKey(deps, workspaceId, kind);
  if (!found.row) return { connection: null, error: MISSING[kind][found.why] };
  return usableConnection(deps, workspaceId, found.row);
}

/** The key as the workspace's connection – or why it may not run: the service refused it. */
function usableConnection(
  deps: AppDeps,
  workspaceId: string,
  row: IntegrationKeyRow,
): WorkspaceConnection {
  if (row.error) return { connection: null, error: row.error };
  return connectionOf(row, { deps, workspaceId });
}

/** The key as a connection – told to write down what each request used, for whom it runs. */
function connectionOf(
  row: IntegrationKeyRow,
  usage?: { deps: AppDeps; workspaceId: string },
): WorkspaceConnection {
  return {
    connection: {
      provider: row.provider as AiConnection['provider'],
      apiKey: row.apiKey,
      baseUrl: row.baseUrl,
      model: row.model,
      instance: row.workspaceId === null,
      ...(usage && {
        meter: usageMeter(usage.deps, {
          workspaceId: usage.workspaceId,
          keyId: row.id,
          instanceKey: row.workspaceId === null,
          provider: row.provider,
        }),
      }),
    },
    keyId: row.id,
    error: null,
  };
}

/** The key for a workspace's AI request, with its id – or why there is none (German). */
export const workspaceAiConnection = (deps: AppDeps, workspaceId: string) =>
  workspaceConnection(deps, workspaceId, 'ai');

/** Where a workspace's recordings become text – or why nowhere (German). */
export const workspaceSpeechConnection = (deps: AppDeps, workspaceId: string) =>
  workspaceConnection(deps, workspaceId, 'speech');

/**
 * Speech to text for speaking to the AI, where every second counts: its own kind (`voice`) –
 * usually a service's key, while recordings stay on a self-hosted Whisper; without one, the key
 * recordings use. A refused `voice` key stays the answer.
 */
export async function workspaceVoiceConnection(
  deps: AppDeps,
  workspaceId: string,
): Promise<WorkspaceConnection> {
  const found = await effectiveKey(deps, workspaceId, 'voice');
  if (!found.row) return workspaceSpeechConnection(deps, workspaceId);
  return usableConnection(deps, workspaceId, found.row);
}

/**
 * Where the words are shown live as they are spoken (`live`) – `null` without a key, with one
 * the service refused: then only what `voice` heard of the pieces is shown.
 */
export async function workspaceLiveConnection(
  deps: AppDeps,
  workspaceId: string,
): Promise<{ connection: AiConnection; keyId: string } | null> {
  const found = await effectiveKey(deps, workspaceId, 'live');
  if (!found.row) return null;
  const usable = usableConnection(deps, workspaceId, found.row);
  return usable.connection ? { connection: usable.connection, keyId: usable.keyId } : null;
}

/** Who generates a workspace's pictures – or why nobody (German). */
export const workspaceImageConnection = (deps: AppDeps, workspaceId: string) =>
  workspaceConnection(deps, workspaceId, 'images');

/** Remembers that the service refused the key, so the settings show why it stopped. */
export async function markKeyRefused(deps: AppDeps, keyId: string, problem: string): Promise<void> {
  await deps.db
    .update(integrationKeys)
    .set({ error: problem })
    .where(eq(integrationKeys.id, keyId));
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
      .select({ id: integrationKeys.id })
      .from(integrationKeys)
      .where(
        and(
          eq(integrationKeys.workspaceId, workspaceId),
          eq(integrationKeys.kind, 'ai'),
          eq(integrationKeys.active, true),
        ),
      );
    await tx.insert(integrationKeys).values({
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'ai',
      provider: 'anthropic',
      baseUrl: null,
      apiKey: old.aiApiKey,
      hint: keyHint(old.aiApiKey),
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

/** What the environment names of a key: the key, where the service answers, its model. */
interface EnvKey {
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

/**
 * Keys the server's environment names, each taken over as one of the instance's keys. Beside the
 * instance's settings, per variable, the hash of the value taken over last.
 */
const ENV_KEYS: {
  setting: string;
  kind: IntegrationKind;
  provider: IntegrationKeyRow['provider'];
  value: (deps: AppDeps) => EnvKey | null;
}[] = [
  {
    setting: 'INTEGRATION_ENV_UNSPLASH',
    kind: 'photos',
    provider: 'unsplash',
    value: (deps) => {
      const apiKey = deps.config.unsplash?.accessKey;
      return apiKey ? { apiKey, baseUrl: null, model: '' } : null;
    },
  },
  {
    setting: 'INTEGRATION_ENV_ANTHROPIC',
    kind: 'ai',
    provider: 'anthropic',
    value: (deps) => {
      const apiKey = deps.config.anthropicApiKey;
      return apiKey ? { apiKey, baseUrl: null, model: DEFAULT_ANTHROPIC_MODEL } : null;
    },
  },
  // Mistral for the spoken pieces and voice (its live words are adopted from these, `adoptLiveKey`).
  ...(['speech', 'voice'] as const).map((kind) => ({
    setting: `INTEGRATION_ENV_MISTRAL_${kind.toUpperCase()}`,
    kind,
    provider: 'mistral' as const,
    value: (deps: AppDeps) => {
      const apiKey = deps.config.mistralApiKey;
      return apiKey ? { apiKey, baseUrl: null, model: 'voxtral-mini-latest' } : null;
    },
  })),
  {
    setting: 'INTEGRATION_ENV_BFL',
    kind: 'images',
    provider: 'black-forest-labs',
    value: (deps) => {
      const apiKey = deps.config.bflApiKey;
      return apiKey ? { apiKey, baseUrl: null, model: 'flux-2-pro' } : null;
    },
  },
  {
    // Speech to text on the server itself (deploy/stt): no key, its address and model.
    setting: 'INTEGRATION_ENV_SPEECH',
    kind: 'speech',
    provider: SERVER_PROVIDER,
    value: (deps) => {
      const server = deps.config.speech;
      return server
        ? { apiKey: '', baseUrl: server.url.replace(/\/+$/, ''), model: server.model }
        : null;
    },
  },
];

/**
 * The keys of the server's environment (`UNSPLASH_ACCESS_KEY`, `ANTHROPIC_API_KEY`,
 * `MISTRAL_API_KEY`, `BFL_API_KEY`, `SPEECH_URL`) become keys of the instance – active unless another of their kind is – and from
 * then on are keys like any other: shown, replaced, removed. Each value is taken over once: a key
 * removed stays removed until the environment names another.
 */
async function importEnvKeys(deps: AppDeps, kind?: IntegrationKind): Promise<void> {
  for (const env of ENV_KEYS) {
    if (kind && env.kind !== kind) continue;
    const named = env.value(deps);
    if (!named) continue;
    const { apiKey, baseUrl, model } = named;
    // Before the address counted, only the key was hashed: a key keeps its hash.
    const hash = sha256Hex(baseUrl === null ? apiKey : `${apiKey}|${baseUrl}|${model}`);
    if (importedEnvKeys.has(`${env.setting}|${hash}`)) continue;
    await deps.db.transaction(async (tx) => {
      // Claimed first: two requests at once take it over once.
      const claimed = await tx
        .insert(instanceSettings)
        .values({ key: env.setting, value: hash, updatedAt: deps.clock.now() })
        .onConflictDoUpdate({
          target: instanceSettings.key,
          set: { value: hash, updatedAt: deps.clock.now() },
          setWhere: ne(instanceSettings.value, hash),
        })
        .returning({ key: instanceSettings.key });
      if (claimed.length === 0) return;
      const [active] = await tx
        .select({ id: integrationKeys.id })
        .from(integrationKeys)
        .where(
          and(
            isNull(integrationKeys.workspaceId),
            eq(integrationKeys.kind, env.kind),
            eq(integrationKeys.active, true),
          ),
        );
      await tx.insert(integrationKeys).values({
        id: crypto.randomUUID(),
        workspaceId: null,
        kind: env.kind,
        provider: env.provider,
        baseUrl,
        apiKey,
        hint: keyHint(apiKey),
        model,
        active: !active,
        setById: null,
        setByName: 'Umgebung des Servers (.env)',
        setAt: deps.clock.now(),
        error: null,
      });
    });
    importedEnvKeys.add(`${env.setting}|${hash}`);
  }
}

/** Mistral's realtime model – what a key taken over for `live` runs on, unless it offers a newer one. */
export const DEFAULT_LIVE_MODEL = 'voxtral-mini-transcribe-realtime-3';

/** Per database, the places whose `live` key is settled in this process. */
const adoptedLiveKeys = new WeakMap<object, Set<string>>();

/**
 * A place (the instance, a workspace) that speaks to the AI on Mistral already gets that key for
 * the live words too, once: its `voice` key (else `speech`'s), on Mistral's realtime model. From
 * then on it is a key like any other – removed, it stays removed.
 */
async function adoptLiveKey(deps: AppDeps, workspaceId: string | null): Promise<void> {
  const place = workspaceId ?? 'instance';
  const settled = adoptedLiveKeys.get(deps.db) ?? new Set<string>();
  adoptedLiveKeys.set(deps.db, settled);
  if (settled.has(place)) return;
  const ofPlace = workspaceId
    ? eq(integrationKeys.workspaceId, workspaceId)
    : isNull(integrationKeys.workspaceId);
  const rows = await deps.db
    .select()
    .from(integrationKeys)
    .where(
      and(ofPlace, or(eq(integrationKeys.kind, 'live'), eq(integrationKeys.provider, 'mistral'))),
    )
    .orderBy(desc(integrationKeys.setAt));
  if (rows.some((row) => row.kind === 'live')) {
    settled.add(place);
    return;
  }
  const rank = (row: IntegrationKeyRow) => (row.kind === 'voice' ? 0 : 2) + (row.active ? 0 : 1);
  const from = rows
    .filter((row) => (row.kind === 'voice' || row.kind === 'speech') && !row.error)
    .sort((a, b) => rank(a) - rank(b))[0];
  // Nothing to take over yet: asked again next time (a Mistral key may be added meanwhile).
  if (!from) return;
  // The newest realtime model the key may use – Mistral's known one when it cannot be asked.
  let model = DEFAULT_LIVE_MODEL;
  try {
    const connection = { provider: 'mistral' as const, apiKey: from.apiKey, baseUrl: from.baseUrl };
    model = recommendedModel('mistral', await listLiveModels(deps, connection), 'live') ?? model;
  } catch {
    // Out of reach just now: the known one, changeable in the settings.
  }
  await deps.db.transaction(async (tx) => {
    // Claimed first: two requests at once take it over once – and once only, ever.
    const claimed = await tx
      .insert(instanceSettings)
      .values({
        key: `INTEGRATION_LIVE_ADOPTED:${place}`,
        value: from.id,
        updatedAt: deps.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ key: instanceSettings.key });
    if (claimed.length === 0) return;
    await tx.insert(integrationKeys).values({
      id: crypto.randomUUID(),
      workspaceId,
      kind: 'live',
      provider: 'mistral',
      baseUrl: from.baseUrl,
      apiKey: from.apiKey,
      hint: from.hint,
      model,
      active: true,
      setById: from.setById,
      setByName: from.setByName,
      setAt: deps.clock.now(),
      error: null,
    });
  });
  settled.add(place);
}

/** Environment keys taken over (or found taken over) in this process. */
const importedEnvKeys = new Set<string>();
