import { and, eq, inArray } from 'drizzle-orm';
import type { SenderPin, SenderPinKind } from '@slider/shared';
import type { Executor } from '../db/client';
import { senderPins } from '../db/schema';
import type { AppDeps } from '../deps';
import { agentFor } from './cloud-agents';
import { ownThread } from './mail';
import { seenChannel, senderLive } from './sender';

/*
 * „Anpinnen“ / „Lösen“ in Sender: a person keeps chats (a conversation, an agent) and mails at
 * the top of their lists, the latest pinned first – for themselves alone, on every device.
 */

const COLUMN = {
  channel: senderPins.channelId,
  agent: senderPins.agentId,
  mail: senderPins.threadId,
} as const;

/** When the caller pinned these (by id) – only the pinned ones. */
export async function pinnedAtOf(
  db: Executor,
  userId: string,
  kind: SenderPinKind,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (ids.length === 0) return result;
  const column = COLUMN[kind];
  const rows = await db
    .select({ id: column, at: senderPins.pinnedAt })
    .from(senderPins)
    .where(and(eq(senderPins.userId, userId), inArray(column, [...new Set(ids)])));
  for (const row of rows) if (row.id) result.set(row.id, row.at.toISOString());
  return result;
}

/** The workspace of what is pinned – only what the caller sees (anything else: 404). */
async function workspaceOf(deps: AppDeps, userId: string, { kind, id }: SenderPin) {
  if (kind === 'channel') return (await seenChannel(deps, userId, id)).workspaceId;
  if (kind === 'agent') return (await agentFor(deps, userId, id)).workspaceId;
  return (await ownThread(deps, userId, id)).account.workspaceId;
}

/**
 * Pins it for the caller (pinned again, it keeps its place) or lets it go. The caller's other
 * tabs and devices hear of it at once.
 */
export async function pinSender(
  deps: AppDeps,
  userId: string,
  input: SenderPin,
): Promise<{ pinnedAt: string | null }> {
  const workspaceId = await workspaceOf(deps, userId, input);
  const column = COLUMN[input.kind];
  let pinnedAt: string | null = null;
  if (input.pinned) {
    await deps.db
      .insert(senderPins)
      .values({
        id: crypto.randomUUID(),
        userId,
        [input.kind === 'channel' ? 'channelId' : input.kind === 'agent' ? 'agentId' : 'threadId']:
          input.id,
        pinnedAt: deps.clock.now(),
      })
      .onConflictDoNothing();
    pinnedAt = (await pinnedAtOf(deps.db, userId, input.kind, [input.id])).get(input.id) ?? null;
  } else {
    await deps.db
      .delete(senderPins)
      .where(and(eq(senderPins.userId, userId), eq(column, input.id)));
  }
  if (senderLive.open(workspaceId)) {
    senderLive.publish(
      workspaceId,
      new Set([userId]),
      input.kind === 'mail' ? { type: 'mail', threadId: input.id } : { type: 'channels' },
    );
  }
  return { pinnedAt };
}
