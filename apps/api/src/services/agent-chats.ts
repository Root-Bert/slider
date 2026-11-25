/**
 * A chat with an agent is a Sender conversation like any other (`sender_channels`, kind `agent`;
 * its messages `sender_messages`) – one model for people and agents. Here: an agent's chats and
 * their messages as the agent's run reads and writes them (`cloud-agents.ts`).
 */
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Attachment, MaterialChatAnswerState } from '@slider/shared';
import type { Executor } from '../db/client';
import { senderChannels, senderMembers, senderMessages, type CloudAgentRow } from '../db/schema';
import { notFound } from '../http/errors';
import { attachmentsOf } from './purge-attachments';

/** A chat with an agent. The first has the agent's id. */
export interface AgentChatRow {
  id: string;
  agentId: string;
  /** Who opened it (gone: `null`). */
  userId: string | null;
  /** What it is about (`name_chat`); `null`: how it began – the first chat: the agent's title. */
  title: string | null;
  createdAt: Date;
}

/** A message in a chat with an agent: a person's (`user`) or the agent's (`assistant`). */
export interface AgentMessageRow {
  id: string;
  agentId: string;
  chatId: string;
  /** Who wrote it – on the agent's call entry, who called. */
  userId: string | null;
  callId: string | null;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  attachments: Attachment[];
  /** How the agent's answer ended. */
  state: MaterialChatAnswerState | null;
  error: string | null;
  /** „Antworten“: the message of the chat it answers. */
  replyTo: string | null;
  deleted: boolean;
  createdAt: Date;
}

const isAgentChat = eq(senderChannels.kind, 'agent');

/** The chats matching `where` (on `sender_channels`), oldest first. */
export async function agentChatsWhere(db: Executor, where?: SQL): Promise<AgentChatRow[]> {
  const rows = await db
    .select({
      id: senderChannels.id,
      agentId: senderChannels.agentId,
      userId: senderChannels.createdBy,
      title: senderChannels.title,
      createdAt: senderChannels.createdAt,
    })
    .from(senderChannels)
    .where(where ? and(isAgentChat, where) : isAgentChat)
    .orderBy(asc(senderChannels.createdAt));
  return rows.flatMap((row) => (row.agentId ? [{ ...row, agentId: row.agentId }] : []));
}

/** An agent's chats, its first first. */
export const agentChatsOf = (db: Executor, agentId: string) =>
  agentChatsWhere(db, eq(senderChannels.agentId, agentId));

/** One chat of the agent (none given: its first). */
export async function agentChat(
  db: Executor,
  agent: Pick<CloudAgentRow, 'id'>,
  chatId?: string,
): Promise<AgentChatRow> {
  const [chat] = await agentChatsWhere(
    db,
    and(eq(senderChannels.agentId, agent.id), eq(senderChannels.id, chatId ?? agent.id)),
  );
  if (!chat) throw notFound('Diesen Chat gibt es nicht.');
  return chat;
}

/** Opens a chat with the agent: the first gets its id. */
export async function openAgentChat(
  db: Executor,
  agent: Pick<CloudAgentRow, 'id' | 'workspaceId'>,
  input: { id?: string; userId: string; at: Date },
): Promise<AgentChatRow> {
  const id = input.id ?? crypto.randomUUID();
  await db.insert(senderChannels).values({
    id,
    workspaceId: agent.workspaceId,
    kind: 'agent',
    agentId: agent.id,
    createdBy: input.userId,
    createdAt: input.at,
    updatedAt: input.at,
  });
  return { id, agentId: agent.id, userId: input.userId, title: null, createdAt: input.at };
}

/** The messages matching `where` (on `sender_messages` / `sender_channels`), in their order. */
export async function agentMessagesWhere(
  db: Executor,
  where: SQL | undefined,
): Promise<AgentMessageRow[]> {
  const rows = await db
    .select({
      id: senderMessages.id,
      agentId: senderChannels.agentId,
      chatId: senderMessages.channelId,
      userId: senderMessages.userId,
      by: senderMessages.agentId,
      callId: senderMessages.callId,
      seq: senderMessages.seq,
      text: senderMessages.text,
      attachments: senderMessages.attachments,
      state: senderMessages.state,
      error: senderMessages.error,
      replyTo: senderMessages.replyTo,
      deletedAt: senderMessages.deletedAt,
      createdAt: senderMessages.createdAt,
    })
    .from(senderMessages)
    .innerJoin(senderChannels, eq(senderChannels.id, senderMessages.channelId))
    .where(and(isAgentChat, where))
    .orderBy(asc(senderMessages.createdAt), asc(senderMessages.seq));
  return rows.flatMap(({ by, deletedAt, agentId, ...row }) =>
    agentId
      ? [{ ...row, agentId, role: by ? 'assistant' : 'user', deleted: !!deletedAt } as const]
      : [],
  );
}

/** Keeps a message in an agent's chat, numbered after its last; what one writes oneself is read. */
export async function keepAgentMessage(
  db: Executor,
  chat: Pick<AgentChatRow, 'id' | 'agentId'>,
  at: Date,
  message: {
    id?: string;
    /** The person who wrote it – on the agent's call entry, who called. */
    userId?: string | null;
    /** The agent's (an answer, a call entry); else the person's. */
    byAgent?: boolean;
    text: string;
    attachments?: Attachment[];
    state?: MaterialChatAnswerState | null;
    error?: string | null;
    callId?: string | null;
    /** „Antworten“: a message of this chat. */
    replyTo?: string | null;
  },
): Promise<string> {
  const id = message.id ?? crypto.randomUUID();
  await db.transaction(async (tx) => {
    const [bumped] = await tx
      .update(senderChannels)
      .set({ lastSeq: sql`${senderChannels.lastSeq} + 1`, updatedAt: at })
      .where(eq(senderChannels.id, chat.id))
      .returning({ seq: senderChannels.lastSeq });
    if (!bumped) throw notFound('Diesen Chat gibt es nicht.');
    await tx.insert(senderMessages).values({
      id,
      channelId: chat.id,
      seq: bumped.seq,
      userId: message.userId ?? null,
      agentId: message.byAgent ? chat.agentId : null,
      text: message.text,
      attachments: message.attachments ?? [],
      state: message.state ?? null,
      error: message.error ?? null,
      callId: message.callId ?? null,
      replyTo: message.replyTo ?? null,
      createdAt: at,
    });
    if (message.userId && !message.byAgent) {
      await tx
        .insert(senderMembers)
        .values({ channelId: chat.id, userId: message.userId, readSeq: bumped.seq, createdAt: at })
        .onConflictDoUpdate({
          target: [senderMembers.channelId, senderMembers.userId],
          set: { readSeq: bumped.seq },
        });
    }
  });
  return id;
}

/**
 * Takes the chats of the agents `of` picks (on `sender_channels.agent_id`) out – before the agents
 * go: their rows only let go of a chat (`set null`). The files on them: the caller's to delete.
 */
export async function dropAgentChats(db: Executor, of: SQL): Promise<Attachment[]> {
  const chats = (
    await db.select({ id: senderChannels.id }).from(senderChannels).where(and(isAgentChat, of))
  ).map((chat) => chat.id);
  if (chats.length === 0) return [];
  const files = await attachmentsOf(db, { channelIds: chats });
  await db.delete(senderChannels).where(inArray(senderChannels.id, chats));
  return files;
}
