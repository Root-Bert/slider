import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { Attachment, CloudAgentContext, CloudAgentStep } from '@slider/shared';
import { agentTranscripts } from '../db/schema';
import type { AppDeps } from '../deps';
import { TOOL_CARDS } from './agent-catalog';
import { memoryReads } from './agent-memory';
import { runTurn, type AiConnection } from './ai-providers';

/*
 * An agent's chat as the model last read it (`agent_transcripts`): how full that made its context
 * (the meter on the agent's page), what it did with its tools for each answer – told beside the
 * answer the next time it reads the chat, and shown under it – and, once the chat grows long, the
 * earlier part summed up instead of cut off. The words themselves stay the chat's
 * (`sender_messages`): what was changed or deleted there is changed or gone here too.
 */

/** One thing an agent did with a tool for an answer. */
export interface AgentStep {
  tool: string;
  /** Of its input only ids, names and short values – no content the chat does not show. */
  input: Record<string, string | number | boolean>;
  /** In a line what came of it; `null` for what only read or waited for a card (told there). */
  outcome: string | null;
  failed: boolean;
  /** How the agent's activity named it („Liest eine Datei“); `null`: not shown. */
  label: string | null;
}

/** The earlier part of a long chat, summed up: messages up to `through` (seq), as `hash` read. */
interface Summary {
  text: string;
  through: number;
  hash: string;
}

/** What is kept of a chat beside its words (`agent_transcripts.turns`). */
interface Turns {
  v: 1;
  /** By the answer they were done for (its message id); `pending`: the run at work, or stopped. */
  steps: Record<string, AgentStep[]>;
  summary?: Summary;
}

const PENDING = 'pending';
/** The longest short value of a tool's input kept with its step. */
const MAX_VALUE = 80;
/** The longest outcome line. */
const MAX_OUTCOME = 160;

const emptyTurns = (): Turns => ({ v: 1, steps: {} });

const turnsOf = (value: unknown): Turns =>
  value && typeof value === 'object' && (value as Turns).v === 1 ? (value as Turns) : emptyTurns();

/** What is kept of the chat beside its words. */
export async function loadTurns(deps: AppDeps, chatId: string): Promise<Turns> {
  const [row] = await deps.db
    .select({ turns: agentTranscripts.turns })
    .from(agentTranscripts)
    .where(eq(agentTranscripts.chatId, chatId));
  return turnsOf(row?.turns);
}

async function keepTurns(deps: AppDeps, chatId: string, agentId: string, turns: Turns) {
  await deps.db
    .insert(agentTranscripts)
    .values({ chatId, agentId, turns, updatedAt: deps.clock.now() })
    .onConflictDoUpdate({ target: agentTranscripts.chatId, set: { turns } });
}

/** The short values of a tool's input: ids, names, numbers – long text left out. */
function briefInput(input: unknown): AgentStep['input'] {
  if (!input || typeof input !== 'object') return {};
  const kept: AgentStep['input'] = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'boolean') kept[key] = value;
    else if (typeof value === 'string' && value.length <= MAX_VALUE && !value.includes('\n'))
      kept[key] = value;
    else if (
      Array.isArray(value) &&
      value.length <= 5 &&
      value.every((each) => typeof each === 'string' && each.length <= MAX_VALUE)
    )
      kept[key] = value.join(', ');
  }
  return kept;
}

/** A tool's call as a step: what was asked, and in a line what came of it. */
export function stepOf(
  tool: string,
  input: unknown,
  result: string,
  failed: boolean,
  label: string | null,
  /** It waited for the person's card: what came of it is told with the card. */
  asked: boolean,
): AgentStep {
  const card = TOOL_CARDS[tool];
  // The person's own (mail, services, settings, what they share): told by name only – should the
  // agent be shared one day, others' runs read its chats.
  const own =
    card?.askedOnly === true ||
    card?.app === 'mail' ||
    card?.app === 'connections' ||
    card?.app === 'settings';
  const line = result.trim().split('\n')[0]?.slice(0, MAX_OUTCOME) ?? '';
  const reads = card?.reads === true || (tool === 'memory' && memoryReads(input));
  const quiet = own || (!failed && (reads || asked));
  return { tool, input: own ? {} : briefInput(input), outcome: quiet ? null : line, failed, label };
}

/** Keeps the steps of the run at work as they happen: a restart in between loses none. */
export async function keepPendingSteps(
  deps: AppDeps,
  chatId: string,
  agentId: string,
  steps: AgentStep[],
): Promise<void> {
  const turns = await loadTurns(deps, chatId);
  turns.steps[PENDING] = steps;
  await keepTurns(deps, chatId, agentId, turns);
}

/** The steps of a run that stopped before it answered (the server started anew). */
export const pendingSteps = (turns: Turns): AgentStep[] => turns.steps[PENDING] ?? [];

/**
 * The run's answer is kept: its steps go with it. Those of messages no longer in the chat
 * (deleted, aged out) go.
 */
export async function keepAnswerSteps(
  deps: AppDeps,
  chatId: string,
  agentId: string,
  answerId: string,
  steps: AgentStep[],
  messageIds: ReadonlySet<string>,
): Promise<void> {
  const turns = await loadTurns(deps, chatId);
  const kept: Turns['steps'] = {};
  for (const [id, each] of Object.entries(turns.steps)) if (messageIds.has(id)) kept[id] = each;
  if (steps.length > 0) kept[answerId] = steps;
  await keepTurns(deps, chatId, agentId, { ...turns, steps: kept });
}

/** The steps beside an answer, for the model: what it did, so it goes on from there. */
export function workNote(
  steps: AgentStep[],
  before = 'What you did for this with your tools',
): string {
  const said = steps.map((step) => {
    const input = Object.entries(step.input)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ');
    const outcome = step.outcome ? ` → ${step.failed ? 'refused: ' : ''}${step.outcome}` : '';
    return `${step.tool}(${input})${outcome}`;
  });
  return `[${before}: ${said.join('; ')}]`;
}

/** The steps beside each answer, as the chat shows them. */
export function shownSteps(turns: Turns, messageId: string): CloudAgentStep[] {
  return (turns.steps[messageId] ?? []).flatMap((step) =>
    step.label
      ? [{ label: step.label, app: TOOL_CARDS[step.tool]?.app ?? null, failed: step.failed }]
      : [],
  );
}

/** A turn of the chat as the model reads it; `seq`: its last message's. */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
  seq: number;
  /**
   * What it says, the same whoever's message started the run (`text` names only the others):
   * what tells whether a summary still covers it.
   */
  same?: string;
  /** Its text with the name of each who wrote it – the writer now too: what a summary reads. */
  named?: string;
}

/** Raised when what a summary reads changes: those made before are made once anew. */
const SUMMARY_VERSION = 2;

const hashOf = (entries: HistoryEntry[]) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        SUMMARY_VERSION,
        ...entries.map((each) => [each.role, each.seq, each.same ?? each.text]),
      ]),
    )
    .digest('base64url');

/** Before a summary of a chat read only in part – kept when it is summed up on from there. */
const IN_PART =
  '(This sums up only the later part of it – the earliest messages were too much to read.)\n';

/** What a summary reads at most of the chat (characters) – the latest of it where more. */
const SUMMARY_INPUT = 400_000;

const SUMMARY_PROMPT = `You sum up the earlier part of a chat between people and an AI agent for that agent, which goes on with the chat and reads only your summary of this part. Keep what it needs to go on: what was asked and decided, by whom (keep the names in square brackets), what it made, changed or found – with the ids, names and places it gave – and what is still open. Leave out greetings and repetition. Write in the chat's language, in short paragraphs or points, no more than about 600 words. Answer with the summary alone.`;

/**
 * The chat for the model: as it is while it is short; once longer than `max` turns, its earlier
 * part summed up (kept, and made anew only once enough was said after it) – the latest half of
 * `max` stays word for word. Summing up failed: the latest `max` turns, as before.
 */
export async function fitHistory(
  deps: AppDeps,
  connection: AiConnection,
  chat: { id: string; agentId: string },
  turns: Turns,
  history: HistoryEntry[],
  max: number,
  signal: AbortSignal,
): Promise<HistoryEntry[]> {
  if (history.length <= max) return history;
  const known = turns.summary;
  const covered = known ? history.filter((each) => each.seq <= known.through) : [];
  const valid = known && covered.length > 0 && hashOf(covered) === known.hash;
  const after = valid ? history.filter((each) => each.seq > known.through) : history;
  const note = (text: string): HistoryEntry => ({
    role: 'user',
    text: `[The earlier part of this chat, summed up:\n${text}]`,
    seq: 0,
  });
  if (valid && after.length <= max) return [note(known.text), ...after];
  const cut = history.length - Math.ceil(max / 2);
  const old = history.slice(0, cut);
  const fresh = valid ? old.filter((each) => each.seq > known.through) : old;
  // A chat too long to read at once: its latest part, the earliest left out.
  const lines = fresh.map(
    (each) => `${each.role === 'user' ? 'USER' : 'AGENT'}: ${each.named ?? each.text}`,
  );
  let room = SUMMARY_INPUT;
  let from = lines.length;
  while (from > 0 && room - lines[from - 1]!.length >= 0) {
    from -= 1;
    room -= lines[from]!.length;
  }
  const read =
    from > 0
      ? ['(Earlier messages left out: too much to read at once.)', ...lines.slice(from)]
      : lines;
  try {
    const said = await runTurn(deps, connection, {
      system: SUMMARY_PROMPT,
      tools: [],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                ...(valid ? [`Summary so far:\n${known.text.replace(IN_PART, '')}`] : []),
                'The chat:',
                ...read,
              ].join('\n\n'),
            },
          ],
        },
      ],
      taskBudgetTokens: 20_000,
      effort: 'low',
      feature: 'office',
      signal,
    });
    const text = said.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (!text) throw new Error('empty summary');
    // Read only in part – now, or the summary it went on from: the agent is told so with it.
    const told = from > 0 || (valid && known.text.startsWith(IN_PART)) ? `${IN_PART}${text}` : text;
    const summary: Summary = { text: told, through: old.at(-1)!.seq, hash: hashOf(old) };
    await keepTurns(deps, chat.id, chat.agentId, { ...turns, summary });
    turns.summary = summary;
    return [note(told), ...history.slice(cut)];
  } catch (error) {
    if (signal.aborted) throw error;
    deps.log.info(`Agent chat not summed up: ${String(error)}`);
    return history.slice(-max);
  }
}

/** What a run measured at its last turn in a chat. */
export interface Measured {
  tokens: number;
  window: number | null;
  model: string;
}

/** Keeps how full the chat's context was at the run's last turn. */
export async function keepContext(
  deps: AppDeps,
  chatId: string,
  agentId: string,
  measured: Measured,
): Promise<void> {
  const values = {
    contextTokens: measured.tokens,
    contextWindow: measured.window,
    model: measured.model,
    updatedAt: deps.clock.now(),
  };
  await deps.db
    .insert(agentTranscripts)
    .values({ chatId, agentId, ...values })
    .onConflictDoUpdate({ target: agentTranscripts.chatId, set: values });
}

/**
 * Of each chat: how full its context was at its last turn (by chat), and what the agent did with
 * its tools for each answer (by message).
 */
export async function transcriptsOf(
  deps: AppDeps,
  chatIds: string[],
): Promise<{
  contexts: Map<string, CloudAgentContext>;
  steps: Map<string, CloudAgentStep[]>;
}> {
  const contexts = new Map<string, CloudAgentContext>();
  const steps = new Map<string, CloudAgentStep[]>();
  if (chatIds.length === 0) return { contexts, steps };
  const rows = await deps.db
    .select({
      chatId: agentTranscripts.chatId,
      tokens: agentTranscripts.contextTokens,
      window: agentTranscripts.contextWindow,
      model: agentTranscripts.model,
      at: agentTranscripts.updatedAt,
      turns: agentTranscripts.turns,
    })
    .from(agentTranscripts)
    .where(inArray(agentTranscripts.chatId, chatIds));
  for (const row of rows) {
    if (row.tokens > 0)
      contexts.set(row.chatId, {
        tokens: row.tokens,
        window: row.window,
        model: row.model,
        at: row.at.toISOString(),
      });
    const turns = turnsOf(row.turns);
    for (const id of Object.keys(turns.steps)) {
      const shown = shownSteps(turns, id);
      if (id !== PENDING && shown.length > 0) steps.set(id, shown);
    }
  }
  return { contexts, steps };
}
