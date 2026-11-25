import type { SuggestedVideoCut } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import {
  failureMessage,
  isProviderError,
  runTurn,
  transcribeTimed,
  wavSeconds,
  type TimedTranscript,
} from './ai-providers';
import { workspaceAiConnection, workspaceSpeechConnection } from './integration-keys';
import { requireRole } from './workspaces/roles';

/*
 * „KI-Schnitt“ (Beta) on a recorded video before it is sent: the browser sends the sound alone
 * (16 kHz WAV), speech to text tells when what was said; the silences between become cuts, and
 * the workspace's AI marks what was said twice or broken off (the last take stays). The browser
 * shows them as cuts one can take back – nothing here is kept.
 */

/** Silence at least this long is a pause worth cutting. */
const PAUSE_S = 1.2;
/** A cut keeps this much of the silence on each side: words do not start or end clipped. */
const PAD_S = 0.3;
/** Silence before the first and after the last word: cut from this long. */
const EDGE_S = 0.6;

const FLUB_SYSTEM = [
  'You help cut a short screen recording before it is sent – someone explaining something.',
  'You get what was said, numbered piece by piece. Name the pieces to cut out: false starts and',
  'sentences broken off and said again (keep the last, complete take), slips of the tongue that',
  'are corrected right after, and pieces that are only filler („äh“, „ähm“, „also“). Never cut',
  'anything that carries content said only once. When unsure, keep it.',
  'Answer with JSON only, no prose: {"cut":[{"id":3,"why":"Versprecher"}]} – `why` one or two',
  'German words („Versprecher“, „Wiederholung“, „Abgebrochen“, „Füllwort“). {"cut":[]} for none.',
].join(' ');

/** Where the recording's silences and slips are, as cuts – sorted, none overlapping. */
export async function suggestVideoCuts(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  audio: { bytes: Uint8Array; name: string; type: string },
): Promise<SuggestedVideoCut[]> {
  await requireRole(deps.db, workspaceId, userId);
  if (audio.bytes.byteLength === 0) throw badRequest('Die Aufnahme hat keinen Ton.');
  const speech = await workspaceSpeechConnection(deps, workspaceId);
  if (!speech.connection) throw badRequest(speech.error);
  let heard: TimedTranscript;
  try {
    heard = await transcribeTimed(deps, speech.connection, audio, {
      durationMs: (wavSeconds(audio.bytes) ?? 0) * 1000 || undefined,
      signal: AbortSignal.timeout(5 * 60_000),
    });
  } catch (error) {
    if (!isProviderError(error)) throw error;
    throw new ApiError(502, 'internal', failureMessage(error, speech.connection));
  }
  if (heard.segments.length === 0 && heard.words.length === 0) {
    if (!heard.text) return [];
    throw badRequest(
      'Dieser Sprachdienst sagt nicht, wann was gesagt wurde – der KI-Schnitt geht damit nicht.',
    );
  }
  const duration = heard.duration ?? wavSeconds(audio.bytes) ?? heard.segments.at(-1)?.end ?? 0;
  const cuts = [...pauses(heard, duration), ...(await slips(deps, workspaceId, heard))];
  return merged(cuts);
}

/** The silences: before the first word, between words (or pieces), after the last. */
export function pauses(
  heard: Pick<TimedTranscript, 'segments' | 'words'>,
  duration: number,
): SuggestedVideoCut[] {
  const spoken = (heard.words.length > 0 ? heard.words : heard.segments)
    .filter((one) => one.end > one.start)
    .sort((a, b) => a.start - b.start);
  const first = spoken[0];
  const last = spoken.at(-1);
  if (!first || !last) return [];
  const cuts: SuggestedVideoCut[] = [];
  if (first.start >= EDGE_S) cuts.push({ start: 0, end: first.start - PAD_S, why: 'Pause' });
  let spokenTo = first.end;
  for (const one of spoken.slice(1)) {
    if (one.start - spokenTo >= PAUSE_S)
      cuts.push({ start: spokenTo + PAD_S, end: one.start - PAD_S, why: 'Pause' });
    spokenTo = Math.max(spokenTo, one.end);
  }
  if (duration - spokenTo >= EDGE_S)
    cuts.push({ start: spokenTo + PAD_S, end: duration, why: 'Pause' });
  return cuts.filter((cut) => cut.end - cut.start > 0.2);
}

/** What the AI would cut of what was said – none without the workspace's AI or when it fails. */
async function slips(
  deps: AppDeps,
  workspaceId: string,
  heard: TimedTranscript,
): Promise<SuggestedVideoCut[]> {
  if (heard.segments.length < 2) return [];
  const ai = await workspaceAiConnection(deps, workspaceId);
  if (!ai.connection) return [];
  const listed = heard.segments
    .map((one, index) => `${index}: ${one.text}`)
    .join('\n')
    .slice(0, 40_000);
  try {
    const turn = await runTurn(deps, ai.connection, {
      system: FLUB_SYSTEM,
      tools: [],
      messages: [{ role: 'user', content: listed }],
      taskBudgetTokens: 20_000,
      effort: 'low',
      signal: AbortSignal.timeout(90_000),
      feature: 'summary',
    });
    const text = turn.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    return slipsFrom(text, heard.segments);
  } catch (error) {
    // The pauses alone still help: a failing AI only leaves its part out.
    deps.log.info(`Video cut: the AI's part failed – ${String(error)}`);
    return [];
  }
}

/** The AI's answer (`{"cut":[{"id","why"}]}`) as cuts over the pieces it names. */
export function slipsFrom(
  answer: string,
  segments: TimedTranscript['segments'],
): SuggestedVideoCut[] {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0];
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const named = (parsed as { cut?: unknown }).cut;
  if (!Array.isArray(named)) return [];
  return named.flatMap((one: unknown) => {
    const { id, why } = (one ?? {}) as { id?: unknown; why?: unknown };
    const segment = typeof id === 'number' ? segments[id] : undefined;
    if (!segment) return [];
    const reason = typeof why === 'string' && why.trim() ? why.trim().slice(0, 40) : 'Versprecher';
    return [{ start: segment.start, end: segment.end, why: reason }];
  });
}

/** Cuts in order, overlapping ones as one (the first one's reason). */
function merged(cuts: SuggestedVideoCut[]): SuggestedVideoCut[] {
  const sorted = cuts.filter((cut) => cut.end > cut.start).sort((a, b) => a.start - b.start);
  const out: SuggestedVideoCut[] = [];
  for (const cut of sorted) {
    const last = out.at(-1);
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else out.push({ ...cut, start: Math.max(0, cut.start) });
  }
  return out.map((cut) => ({
    start: Math.round(cut.start * 100) / 100,
    end: Math.round(cut.end * 100) / 100,
    why: cut.why,
  }));
}
