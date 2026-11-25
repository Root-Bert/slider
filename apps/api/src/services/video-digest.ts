import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { imageSize } from '@slider/odp';
import { isVideoAttachment } from '@slider/shared';
import { attachments } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { isProviderError, transcribe, transcribeTimed, wavSeconds } from './ai-providers';
import { workspaceSpeechConnection } from './integration-keys';
import { requireRole } from './workspaces/roles';

/*
 * A video put on a message, as the AI reads it: the server cannot look into a video (no ffmpeg),
 * so the browser that put it there takes stills from it and its sound (16 kHz WAV) and hands them
 * over once it is up. The stills are kept at once beside the video (`<key>.digest`, JSON); the
 * sound goes to the workspace's speech to text, its words with their times join them – the sound
 * itself is not kept. An agent, Sender's AI or Cloud's AI then read the video as what was said
 * and what was shown when (`videoBlocks`).
 */

/** The digest's key beside its video's: deleted with it (`attachmentBlobKeys`). */
export const VIDEO_DIGEST_SUFFIX = '.digest';

/** At most this many stills of one video go to the model – each costs as a picture does. */
export const MAX_VIDEO_STILLS = 8;
/** A still larger than this is no still (they are small JPEGs, 768 px wide). */
const MAX_STILL_BYTES = 600_000;

interface VideoDigest {
  /** In seconds, as the browser read it. */
  duration: number | null;
  stills: { at: number; data: string }[];
  /** What was said, with its times – `null` while it is being heard or where it could not be. */
  said: { start: number; end: number; text: string }[] | null;
  /** Why there are no words, where there are none (no speech service, none heard). */
  note: string | null;
}

/**
 * Digests whose sound is still being heard, by attachment id: the AI waits for them. Done again
 * meanwhile, the newer one counts – the older neither takes the newer's place here nor, heard
 * later, overwrites its words.
 */
const hearing = new Map<string, { job: Promise<void> }>();

/**
 * The stills and the sound of a video its writer just put up. Only its writer, only a video;
 * done again, the last one counts. The words come after this returns.
 */
export async function digestVideo(
  deps: AppDeps,
  userId: string,
  id: string,
  input: {
    duration: number | null;
    stills: { at: number; bytes: Uint8Array }[];
    speech: { bytes: Uint8Array; name: string; type: string } | null;
  },
): Promise<void> {
  const [row] = await deps.db.select().from(attachments).where(eq(attachments.id, id));
  if (!row || row.userId !== userId) throw notFound('Nicht gefunden.');
  // Still in its workspace (the speech service is the workspace's).
  await requireRole(deps.db, row.workspaceId, userId);
  if (!isVideoAttachment(row.type)) throw badRequest('Das ist kein Video.');
  const stills = input.stills
    .filter(
      (still) =>
        still.bytes.byteLength <= MAX_STILL_BYTES &&
        imageSize(still.bytes)?.mediaType === 'image/jpeg' &&
        Number.isFinite(still.at),
    )
    .slice(0, MAX_VIDEO_STILLS)
    .map((still) => ({
      at: Math.max(0, Math.round(still.at * 10) / 10),
      data: Buffer.from(still.bytes).toString('base64'),
    }));
  const duration =
    input.duration !== null && Number.isFinite(input.duration) && input.duration > 0
      ? Math.round(input.duration * 10) / 10
      : null;
  const digest: VideoDigest = { duration, stills, said: null, note: null };
  const key = row.key + VIDEO_DIGEST_SUFFIX;
  // Each call its own entry: a newer one's digest is the one that stays.
  const entry = { job: Promise.resolve() };
  hearing.set(id, entry);
  const latest = () => hearing.get(id) === entry;
  const keep = async (next: VideoDigest) => {
    if (latest()) await deps.storage.put(key, new TextEncoder().encode(JSON.stringify(next)));
  };
  const done = () => {
    if (latest()) hearing.delete(id);
  };
  if (!input.speech || input.speech.bytes.byteLength === 0) {
    await keep({ ...digest, note: 'Ohne Ton.' }).finally(done);
    return;
  }
  const speech = input.speech;
  await keep(digest);
  entry.job = (async () => {
    const heard = await hear(deps, row.workspaceId, speech).catch((error: unknown) => {
      deps.log.info(`Video digest: speech to text failed – ${String(error)}`);
      return { said: null, note: 'Der Ton ließ sich nicht abhören.' };
    });
    await keep({ ...digest, ...heard });
  })().finally(done);
}

/** What was said in the sound, with times where the speech service gives them. */
async function hear(
  deps: AppDeps,
  workspaceId: string,
  audio: { bytes: Uint8Array; name: string; type: string },
): Promise<Pick<VideoDigest, 'said' | 'note'>> {
  const speech = await workspaceSpeechConnection(deps, workspaceId);
  if (!speech.connection) return { said: null, note: 'Kein Sprachdienst – nur die Bilder.' };
  const seconds = wavSeconds(audio.bytes);
  const options = {
    durationMs: seconds ? seconds * 1000 : undefined,
    signal: AbortSignal.timeout(5 * 60_000),
  };
  try {
    const heard = await transcribeTimed(deps, speech.connection, audio, options);
    const said = (heard.segments.length > 0 ? heard.segments : [])
      .filter((one) => one.text.trim())
      .map((one) => ({ start: one.start, end: one.end, text: one.text.trim() }));
    if (said.length > 0) return { said, note: null };
    if (heard.text)
      return { said: [{ start: 0, end: seconds ?? 0, text: heard.text }], note: null };
    return { said: [], note: 'Nichts gesagt.' };
  } catch (error) {
    // A service that gives no times (gpt-4o-transcribe refuses verbose_json): the words alone.
    if (!isProviderError(error)) throw error;
    const text = (await transcribe(deps, speech.connection, audio, options)).trim();
    return text
      ? { said: [{ start: 0, end: seconds ?? 0, text }], note: null }
      : { said: [], note: 'Nichts gesagt.' };
  }
}

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Markers in what was said cannot close the frame around it. */
const framed = (text: string) => text.replace(/<\/?\s*datei\b/gi, '‹');

/**
 * A video as the model reads it: what was said, with times, then its stills, each with its time –
 * framed as every file is (`<datei>`). Waits a while for words still being heard. `null`: no
 * digest (put up before there were any, or from a browser that cannot take stills).
 */
export async function videoBlocks(
  deps: Pick<AppDeps, 'storage'>,
  row: { id: string; key: string },
  name: string,
): Promise<Anthropic.Beta.BetaContentBlockParam[] | null> {
  const waiting = hearing.get(row.id)?.job;
  if (waiting) {
    await Promise.race([waiting, new Promise((done) => setTimeout(done, 120_000))]).catch(
      () => undefined,
    );
  }
  const bytes = await deps.storage.get(row.key + VIDEO_DIGEST_SUFFIX);
  if (!bytes) return null;
  let digest: VideoDigest;
  try {
    digest = JSON.parse(new TextDecoder().decode(bytes)) as VideoDigest;
  } catch {
    return null;
  }
  const length = digest.duration ? ` dauer="${clock(digest.duration)}"` : '';
  const said = digest.said?.length
    ? `Gesprochen:\n${digest.said.map((one) => `[${clock(one.start)}] ${framed(one.text)}`).join('\n')}`
    : (digest.note ?? (digest.said ? 'Nichts gesagt.' : 'Der Ton wird noch abgehört.'));
  const shown = digest.stills.length
    ? `\n${digest.stills.length} Standbilder folgen, je mit ihrer Zeit.`
    : '';
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: 'text',
      text: `<datei name="${name}" art="Video"${length}>\n${said}${shown}\n</datei>`,
    },
  ];
  for (const still of digest.stills) {
    blocks.push({ type: 'text', text: `[Bild bei ${clock(still.at)} aus „${name}“]` });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: still.data },
    });
  }
  return blocks;
}
