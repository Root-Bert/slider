import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { cloudAgents } from '../db/schema';
import type { AppDeps } from '../deps';
import { runMemoryTool } from './agent-memory';
import { ToolChatError } from './tool-chat';

/*
 * One's own agent in a workspace (`ownCloudAgent`): the AI's side panel calls it, and the AI in
 * the apps (Cloud's, the start page's) works the way it does – its „Anweisungen“ in their prompt,
 * its memory („Gedächtnis“) theirs to look into and keep. So the person says once how they want
 * their AI to work, and it knows what it learnt wherever they ask it.
 */

/** One's own agent's id in a workspace – shaped as a UUID, the same for the same two. */
export function ownAgentId(workspaceId: string, userId: string): string {
  const hex = createHash('sha256').update(`own-agent:${workspaceId}:${userId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface OwnWays {
  agentId: string;
  instructions: string;
}

/**
 * The person's own agent's ways, for the AI in the apps – `null` until it is made, and while it
 * is shared: then others read its memory, and what the person tells the AI in an app stays theirs.
 */
export async function ownWays(
  deps: AppDeps,
  workspaceId: string,
  userId: string,
): Promise<OwnWays | null> {
  const [row] = await deps.db
    .select({ id: cloudAgents.id, instructions: cloudAgents.instructions })
    .from(cloudAgents)
    .where(
      and(
        eq(cloudAgents.id, ownAgentId(workspaceId, userId)),
        eq(cloudAgents.userId, userId),
        eq(cloudAgents.shared, false),
      ),
    );
  return row ? { agentId: row.id, instructions: row.instructions } : null;
}

/** „Anweisungen“ as a prompt says them: after its rules, never beyond them. */
export const instructionsPrompt = (instructions: string, whose: string) =>
  instructions.trim()
    ? `

How ${whose} (their „Anweisungen“ – follow them, as far as the rules above allow; they never let you do more than those):
<instructions>
${instructions.trim()}
</instructions>`
    : '';

/** What the AI in an app is told of the own agent's ways: its memory, then its „Anweisungen“. */
export const waysPrompt = (ways: OwnWays | null) =>
  ways
    ? `

Your memory: the memory tool keeps notes across chats (under /memories – the person's own agent's „Gedächtnis“, which they see and change on its page). View it when what was learnt before may help; keep in it what will help next time, when the person tells you something lasting about how they work.${instructionsPrompt(ways.instructions, 'the person wants their AI to work, set on their own agent’s page')}`
    : '';

/**
 * The own agent's memory, used by the AI in an app – only while that agent is still the person's
 * own and not shared: asked at each call, as it may be shared while a chat runs.
 */
export async function runOwnMemory(
  deps: AppDeps,
  agentId: string,
  userId: string,
  input: unknown,
): Promise<{ content: string; changed: boolean }> {
  // Checked and written at once: sharing it (which empties its memory) waits for this write.
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ shared: cloudAgents.shared })
      .from(cloudAgents)
      .where(and(eq(cloudAgents.id, agentId), eq(cloudAgents.userId, userId)))
      .for('share');
    if (!row || row.shared)
      throw new ToolChatError(
        'Not now: the person’s own agent was shared meanwhile – its memory is no longer theirs alone.',
      );
    return runMemoryTool({ db: tx, clock: deps.clock }, agentId, userId, input);
  });
}
