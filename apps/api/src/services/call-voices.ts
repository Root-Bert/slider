import { asc, eq } from 'drizzle-orm';
import type { CallVoices } from '@slider/shared';
import { users, workspaceMembers } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, notFound } from '../http/errors';
import {
  automaticVoice,
  keyProblem,
  ProviderHttpError,
  providerName,
  ProviderUnreachable,
  speechOnce,
  speechVoices,
  type AiConnection,
} from './ai-providers';
import { workspaceLiveConnection } from './integration-keys';

/**
 * The voice agents speak with in calls – each person's own (personal settings): an agent called
 * by someone, or brought into a call by them, speaks in theirs. Mistral's voices only; a preset's
 * slug is the same on every key, so one voice serves in all of a person's workspaces.
 */

/** What a voice reads in the settings, to be heard before it is picked. */
const VOICE_SAMPLE =
  'Hallo, so klinge ich in euren Anrufen. Soll ich die Präsentation für Donnerstag vorbereiten?';
/** Samples made, per key and voice: each costs the workspace a request – asked once. */
const voiceSamples = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
const MAX_VOICE_SAMPLES = 200;
const NO_VOICES = 'Stimmen gibt es mit einem Mistral-Key für Live-Mitschrift.';

/** The person's picked voice; `null` none. */
export async function personsVoice(deps: AppDeps, userId: string): Promise<string | null> {
  const [row] = await deps.db
    .select({ callVoice: users.callVoice })
    .from(users)
    .where(eq(users.id, userId));
  return row?.callVoice ?? null;
}

/** The live key that speaks (Mistral) in the first of the person's workspaces that has one. */
async function speakingConnection(deps: AppDeps, userId: string): Promise<AiConnection | null> {
  const memberships = await deps.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt));
  for (const { workspaceId } of memberships) {
    const live = await workspaceLiveConnection(deps, workspaceId);
    if (live?.connection.provider === 'mistral') return live.connection;
  }
  return null;
}

/** A refusal or silence of the voice service, in words. */
function voiceTrouble(error: unknown, connection: AiConnection): never {
  if (error instanceof ApiError) throw error;
  const name = providerName(connection);
  const problem = keyProblem(error, connection);
  if (problem) throw badRequest(problem);
  if (error instanceof ProviderUnreachable)
    throw new ApiError(
      503,
      'source_unreachable',
      `${name} ist gerade nicht erreichbar. Bitte gleich nochmal versuchen.`,
    );
  if (error instanceof ProviderHttpError)
    throw badRequest(`${name} meldet: ${error.message.slice(0, 200)}`);
  throw error;
}

/** The key that speaks for the person – throws unless it offers `voice`. */
async function offeredVoice(deps: AppDeps, userId: string, voice: string) {
  const connection = await speakingConnection(deps, userId);
  if (!connection) throw badRequest(NO_VOICES);
  const voices = await speechVoices(deps, connection).catch((error: unknown) =>
    voiceTrouble(error, connection),
  );
  if (!voices.some((offered) => offered.id === voice))
    throw notFound('Diese Stimme gibt es nicht mehr.');
  return connection;
}

/** The person's voice and the voices to pick from. */
export async function callVoices(deps: AppDeps, userId: string): Promise<CallVoices> {
  const [picked, connection] = await Promise.all([
    personsVoice(deps, userId),
    speakingConnection(deps, userId),
  ]);
  if (!connection) return { voices: [], automatic: null, picked };
  const voices = await speechVoices(deps, connection).catch((error: unknown) =>
    voiceTrouble(error, connection),
  );
  return { voices, automatic: automaticVoice(voices), picked };
}

/** Picks the person's voice – one offered – or gives back the automatic one (`null`). */
export async function pickCallVoice(
  deps: AppDeps,
  userId: string,
  voice: string | null,
): Promise<CallVoices> {
  if (voice) await offeredVoice(deps, userId, voice);
  await deps.db.update(users).set({ callVoice: voice }).where(eq(users.id, userId));
  return callVoices(deps, userId);
}

/** A voice reading {@link VOICE_SAMPLE}, as WAV – made once per key and voice. */
export async function callVoiceSample(
  deps: AppDeps,
  userId: string,
  voice: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const connection = await offeredVoice(deps, userId, voice);
  const key = `${connection.baseUrl ?? ''}|${connection.apiKey}|${voice}`;
  let made = voiceSamples.get(key);
  if (!made) {
    made = speechOnce(deps, connection, VOICE_SAMPLE, voice);
    made.catch(() => voiceSamples.delete(key));
    voiceSamples.set(key, made);
    for (const old of [...voiceSamples.keys()].slice(0, -MAX_VOICE_SAMPLES))
      voiceSamples.delete(old);
  }
  return made.catch((error: unknown) => voiceTrouble(error, connection));
}
