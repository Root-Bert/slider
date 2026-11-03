import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { TranscriptStatus } from '@slider/shared';
import { decks, media } from '../db/schema';
import type { AppDeps } from '../deps';
import {
  type AiConnection,
  isProviderError,
  refusesKey,
  runTurn,
  transcribe,
} from './ai-providers';
import { markKeyRefused, workspaceSpeechConnection } from './integration-keys';

/** Gives the spelling of the names recordings here use. */
const PROMPT = 'Slider, Folie, Präsentation, Kommentar.';

/** How a new recording starts: `pending` where its workspace can turn speech into text. */
export async function initialTranscriptStatus(
  deps: AppDeps,
  workspaceId: string,
): Promise<TranscriptStatus> {
  const speech = await workspaceSpeechConnection(deps, workspaceId);
  return speech.connection ? 'pending' : 'none';
}

/**
 * One recording after the other: the server's own Whisper takes them in turn anyway, and a
 * service's rate limits are spared.
 */
let queue: Promise<void> = Promise.resolve();

/**
 * Makes the recording's transcript in the background, once it is `pending`. Not the server's
 * tracked background work: one may take half an hour, and a stopping server must not wait for
 * it (PGlite closed cleanly) – the row stays `pending`, `resumeTranscripts` takes it up again.
 */
export function transcribeLater(deps: AppDeps, mediaId: string): void {
  queue = queue
    .then(() => transcribeMedia(deps, mediaId))
    .catch((error: unknown) => deps.log.warn(`Recording ${mediaId} not transcribed`, error));
}

/** Recordings whose transcript a stopped server left undone: made now, in the background. */
export async function resumeTranscripts(deps: AppDeps): Promise<void> {
  const rows = await deps.db
    .select({ id: media.id })
    .from(media)
    .where(eq(media.transcriptStatus, 'pending'))
    .orderBy(media.createdAt);
  if (rows.length > 0) deps.log.info(`Transcribing ${rows.length} recording(s) left undone`);
  for (const row of rows) transcribeLater(deps, row.id);
}

async function transcribeMedia(deps: AppDeps, mediaId: string): Promise<void> {
  const [row] = await deps.db
    .select({
      id: media.id,
      deckId: media.deckId,
      mimeType: media.mimeType,
      durationMs: media.durationMs,
      storageKey: media.storageKey,
      transcriptStatus: media.transcriptStatus,
      workspaceId: decks.workspaceId,
    })
    .from(media)
    .innerJoin(decks, eq(media.deckId, decks.id))
    .where(eq(media.id, mediaId));
  // Replaced, deleted or done meanwhile.
  if (!row || row.transcriptStatus !== 'pending') return;

  const settle = async (values: { transcript?: string; transcriptStatus: TranscriptStatus }) => {
    // Only a recording still waiting: one replaced meanwhile is gone, its row with it.
    const updated = await deps.db
      .update(media)
      .set(values)
      .where(and(eq(media.id, row.id), eq(media.transcriptStatus, 'pending')))
      .returning({ id: media.id });
    if (updated.length > 0) deps.live?.commentsChanged(row.deckId);
  };

  // Looked up inside the `try`: a failing lookup must not leave the row `pending` – a retry
  // refuses a pending recording, so it would stay stuck until the next start.
  let keyId: string | null = null;
  try {
    const speech = await workspaceSpeechConnection(deps, row.workspaceId);
    if (!speech.connection) return await settle({ transcriptStatus: 'none' });
    keyId = speech.keyId;
    const bytes = await deps.media.get(row.storageKey);
    if (!bytes) return await settle({ transcriptStatus: 'failed' });
    const container = row.mimeType.split('/')[1] ?? 'webm';
    const text = await transcribe(
      deps,
      speech.connection,
      { bytes, name: `recording.${container}`, type: row.mimeType },
      { prompt: PROMPT, durationMs: row.durationMs },
    );
    await settle({ transcript: text, transcriptStatus: 'done' });
  } catch (error) {
    if (keyId && refusesKey(error)) {
      await markKeyRefused(deps, keyId, 'Der Dienst hat den Key abgelehnt.');
    } else if (!isProviderError(error)) {
      deps.log.warn(`Recording ${row.id} not transcribed`, error);
    } else {
      deps.log.info(`Recording ${row.id} not transcribed: ${String(error)}`);
    }
    await settle({ transcriptStatus: 'failed' });
  }
}

/** Shorter transcripts are shown whole – a summary would say no less. */
export const SUMMARY_FROM_CHARS = 160;

const SUMMARY_SYSTEM = [
  'You summarise the transcript of a voice memo left as a comment on a presentation slide.',
  'Write two or three short sentences in the language of the transcript, saying what the',
  'speaker wants – the requests and points, no filler, no preamble, no quotes around it.',
].join(' ');

/**
 * The transcripts of the given comments' recordings in short, on the workspace's AI key – when
 * they go to the AI. In the background; a summary that fails leaves the transcript shown whole.
 */
export function summarizeTranscriptsLater(
  deps: AppDeps,
  connection: AiConnection,
  commentIds: readonly string[],
): void {
  if (commentIds.length === 0) return;
  void summarizeTranscripts(deps, connection, commentIds).catch((error: unknown) =>
    deps.log.info(`Transcripts not summarised: ${String(error)}`),
  );
}

async function summarizeTranscripts(
  deps: AppDeps,
  connection: AiConnection,
  commentIds: readonly string[],
): Promise<void> {
  const rows = await deps.db
    .select({ id: media.id, deckId: media.deckId, transcript: media.transcript })
    .from(media)
    .where(
      and(
        inArray(media.commentId, [...commentIds]),
        eq(media.transcriptStatus, 'done'),
        isNull(media.transcriptSummary),
      ),
    );
  for (const row of rows) {
    const transcript = row.transcript?.trim() ?? '';
    if (transcript.length < SUMMARY_FROM_CHARS) continue;
    const turn = await runTurn(deps, connection, {
      system: SUMMARY_SYSTEM,
      tools: [],
      messages: [{ role: 'user', content: transcript }],
      taskBudgetTokens: 20_000,
      signal: AbortSignal.timeout(60_000),
      feature: 'summary',
    });
    const summary = turn.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (turn.stop !== 'end_turn' || !summary) continue;
    const updated = await deps.db
      .update(media)
      .set({ transcriptSummary: summary })
      .where(and(eq(media.id, row.id), isNull(media.transcriptSummary)))
      .returning({ id: media.id });
    if (updated.length > 0) deps.live?.commentsChanged(row.deckId);
  }
}
