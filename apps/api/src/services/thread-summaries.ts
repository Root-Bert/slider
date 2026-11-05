import { and, asc, eq, inArray, or } from 'drizzle-orm';
import { aiProposals, comments, decks } from '../db/schema';
import type { AppDeps } from '../deps';
import { runToolCall } from './ai-providers';
import { workspaceAiConnection } from './integration-keys';

/** A thread that asked the AI more often than this gets a summary at its top. */
export const SUMMARY_AFTER_REQUESTS = 3;
/** What the summary call reads of the thread at most – its latest part. */
const MAX_THREAD_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 600;

const SYSTEM = [
  'You keep a short summary at the top of a comment thread on a presentation, where people',
  'asked an AI to change the slides many times. Say in 1–3 short sentences what was done in',
  'sum, where it stands now and what is still open (if anything). Write in the language of the',
  'thread, plainly, no preamble, no quotes, no lists, no names of people unless needed.',
].join(' ');

const TOOL = {
  name: 'thread_summary',
  description: 'The summary shown at the top of the thread.',
  input_schema: {
    type: 'object' as const,
    properties: { text: { type: 'string', description: '1–3 short sentences.' } },
    required: ['text'],
  },
};

const PROPOSAL_STATE: Record<string, string> = {
  applied: 'done',
  ready: 'answered without a change',
  failed: 'failed',
  reverted: 'taken back',
  cancelled: 'stopped',
};

/** Summaries at work, by thread: a request settling meanwhile asks for one more after it. */
const working = new Map<string, { again: boolean }>();

/**
 * Writes the summary of a thread anew once one of its requests to the AI settled – in the
 * background, on the workspace's AI key (none: none). Only threads that asked more than
 * {@link SUMMARY_AFTER_REQUESTS} times get one; while another of its requests still runs, that
 * one's end writes it.
 */
export function summarizeThreadLater(deps: AppDeps, commentId: string | null): void {
  if (!commentId) return;
  void (async () => {
    const [row] = await deps.db
      .select({ id: comments.id, parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, commentId));
    if (!row) return;
    const rootId = row.parentId ?? row.id;
    const current = working.get(rootId);
    if (current) {
      current.again = true;
      return;
    }
    const state = { again: true };
    working.set(rootId, state);
    try {
      while (state.again) {
        state.again = false;
        await summarizeThread(deps, rootId);
      }
    } finally {
      working.delete(rootId);
    }
  })().catch((error: unknown) => deps.log.info(`Thread not summarised: ${String(error)}`));
}

async function summarizeThread(deps: AppDeps, rootId: string): Promise<void> {
  const messages = await deps.db
    .select()
    .from(comments)
    .where(or(eq(comments.id, rootId), eq(comments.parentId, rootId)))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  const root = messages.find((message) => message.id === rootId);
  if (!root || root.parentId) return;
  const proposals = await deps.db
    .select({
      status: aiProposals.status,
      summary: aiProposals.summary,
      error: aiProposals.error,
      createdAt: aiProposals.createdAt,
    })
    .from(aiProposals)
    .where(
      inArray(
        aiProposals.commentId,
        messages.map((message) => message.id),
      ),
    )
    .orderBy(asc(aiProposals.createdAt));
  // Still at work: its end writes the summary.
  if (proposals.some((proposal) => proposal.status === 'running')) return;
  // A request stopped to be asked again with an addition is the same request.
  const asked = proposals.filter((proposal) => proposal.status !== 'cancelled');
  if (asked.length <= SUMMARY_AFTER_REQUESTS) return;
  const [deck] = await deps.db
    .select({ workspaceId: decks.workspaceId })
    .from(decks)
    .where(eq(decks.id, root.deckId));
  if (!deck) return;
  const { connection } = await workspaceAiConnection(deps, deck.workspaceId);
  if (!connection) return;

  const lines = [
    ...messages.map((message) => ({
      at: message.createdAt.getTime(),
      text: `${message.author.type === 'ai' ? 'AI' : message.author.name || 'Someone'}: ${message.body.trim() || '(a drawing on the slide)'}`,
    })),
    ...asked.map((proposal) => ({
      at: proposal.createdAt.getTime(),
      text: `[AI request, ${PROPOSAL_STATE[proposal.status] ?? proposal.status}${proposal.summary ? `: ${proposal.summary}` : proposal.error ? `: ${proposal.error}` : ''}]`,
    })),
  ].sort((a, b) => a.at - b.at);
  let thread = lines.map((line) => line.text).join('\n');
  if (thread.length > MAX_THREAD_CHARS) thread = `…${thread.slice(-MAX_THREAD_CHARS)}`;

  const input = await runToolCall(deps, connection, {
    system: SYSTEM,
    tool: TOOL,
    user: `${root.status === 'done' ? 'The thread is resolved.\n' : ''}The thread, oldest first:\n${thread}`,
    maxTokens: 400,
    signal: AbortSignal.timeout(60_000),
    feature: 'summary',
  });
  const text =
    input && typeof input === 'object' && typeof (input as { text?: unknown }).text === 'string'
      ? (input as { text: string }).text.trim().slice(0, MAX_SUMMARY_CHARS)
      : '';
  if (!text) return;
  const updated = await deps.db
    .update(comments)
    .set({ aiSummary: text, aiSummaryAt: deps.clock.now() })
    .where(and(eq(comments.id, rootId), eq(comments.deckId, root.deckId)))
    .returning({ id: comments.id });
  if (updated.length > 0) deps.live?.commentsChanged(root.deckId);
}
