import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Attachment, MaterialChatAnswerState } from '@slider/shared';
import { isEncrypted, openText } from '../crypto/content-crypto';
import type { Logger } from '../logger';
import { dropAttachmentRows } from '../services/attachments';
import type { Executor } from './client';
import { senderChannels, senderFiles, senderMembers, senderMessages } from './schema';

/*
 * Agent chats moved into Sender (migration 0185): their conversations are there already, their
 * titles and messages still in the old tables, sealed for those columns (`encryptedText` binds
 * `table.column`) – opened here and kept anew, each chat numbered from 1 by itself; how far
 * someone read an agent becomes how far they read each of its chats. Then the old tables go.
 * Once, at the start, before anything reads them; with the tables gone, nothing. A message that
 * no longer opens (sealed with another key) is left out, logged, its files (where its list opens)
 * deleted. The move failing as a whole stops the start, as a migration does: half moved, the
 * chats would take new messages under numbers the old ones need. The files on tag chats'
 * messages (no conversation of their own: what the agent said stands in the tagging one) go
 * with them – not one a conversation's message still shows (passed on uncopied by some builds).
 */

interface OldMessage {
  id: string;
  agent_id: string;
  chat_id: string;
  user_id: string | null;
  owner_id: string;
  call_id: string | null;
  seq: number;
  role: 'user' | 'assistant';
  text: string;
  attachments: unknown;
  state: MaterialChatAnswerState | null;
  error: string | null;
  created_at: Date | string;
}

const rowsOf = <T>(result: unknown): T[] =>
  Array.isArray(result) ? (result as T[]) : (result as { rows: T[] }).rows;

/** Opened, or `null` where it does not open (logged as left out). */
function tryOpen(value: string, context: string): string | null {
  try {
    return openText(value, context);
  } catch {
    return null;
  }
}

function openList(raw: unknown, context: string): Attachment[] {
  // postgres-js hands jsonb over as text, PGlite already parsed.
  const value: unknown = typeof raw === 'string' && !isEncrypted(raw) ? JSON.parse(raw) : raw;
  const list: unknown =
    typeof value === 'string' && isEncrypted(value) ? JSON.parse(openText(value, context)) : value;
  return Array.isArray(list) ? (list as Attachment[]) : [];
}

const CHUNK = 500;

function tryList(raw: unknown, context: string): Attachment[] {
  try {
    return openList(raw, context);
  } catch {
    return [];
  }
}

/** Files no message keeps any more – none a conversation's message still shows. */
async function dropUnshown(tx: Executor, files: Attachment[]) {
  const ids = [...new Set(files.map((one) => one.id))];
  const shown = new Set<string>();
  for (let from = 0; from < ids.length; from += CHUNK)
    for (const row of await tx
      .select({ id: senderFiles.attachmentId })
      .from(senderFiles)
      .innerJoin(senderChannels, eq(senderChannels.id, senderFiles.channelId))
      .where(
        and(
          inArray(senderFiles.attachmentId, ids.slice(from, from + CHUNK)),
          ne(senderChannels.kind, 'agent'),
        ),
      ))
      shown.add(row.id);
  // Their bytes noted: the hourly sweep deletes them (no storage open yet at the start).
  await dropAttachmentRows(
    tx,
    files.filter((one) => !shown.has(one.id)),
  );
}

export async function moveAgentChats(db: Executor, log: Logger): Promise<void> {
  const [left] = rowsOf<{ old: string | null }>(
    await db.execute(sql`select to_regclass('public.cloud_agent_messages')::text as old`),
  );
  if (!left?.old) return;
  let moved = 0;
  let unread = 0;
  await db.transaction(async (tx) => {
    const chats = rowsOf<{ id: string; title: string | null }>(
      await tx.execute(
        sql`select c.id, c.title from cloud_agent_chats c join sender_channels s on s.id = c.id`,
      ),
    );
    for (const chat of chats) {
      const title = chat.title && tryOpen(chat.title, 'cloud_agent_chats.title');
      if (title)
        await tx.update(senderChannels).set({ title }).where(eq(senderChannels.id, chat.id));
    }
    // Tag chats' messages stay behind: their files go now, with the table.
    const gone = rowsOf<{ attachments: unknown }>(
      await tx.execute(
        sql`select attachments from cloud_agent_messages where chat_id like '%:%' and attachments is not null`,
      ),
    ).flatMap((row) => tryList(row.attachments, 'cloud_agent_messages.attachments'));
    // Before chats were shared (0117) a person's message had no `user_id`: the owner's. Later
    // `null` is an account deleted since (`set null`) – nobody's, as in any conversation.
    const [shared] = rowsOf<{ since: Date | string | null }>(
      await tx.execute(
        sql`select min(created_at) as since from cloud_agent_messages where user_id is not null`,
      ),
    );
    const sharedSince = shared?.since ? new Date(shared.since) : null;
    const messages = rowsOf<OldMessage>(
      await tx.execute(sql`
        select m.id, m.agent_id, m.chat_id, m.user_id, a.user_id as owner_id, m.call_id, m.seq,
          m.role, m.text, m.attachments, m.state, m.error, m.created_at
        from cloud_agent_messages m
        join sender_channels s on s.id = m.chat_id
        join cloud_agents a on a.id = m.agent_id
        order by m.chat_id, m.seq`),
    );
    /** By chat: its messages' old numbers (per agent), in order – their new ones are 1, 2, … */
    const numbers = new Map<string, number[]>();
    const kept = messages.flatMap((message) => {
      const text = tryOpen(message.text, 'cloud_agent_messages.text');
      if (text === null) {
        unread += 1;
        gone.push(...tryList(message.attachments, 'cloud_agent_messages.attachments'));
        return [];
      }
      const seen = numbers.get(message.chat_id) ?? [];
      seen.push(message.seq);
      numbers.set(message.chat_id, seen);
      const createdAt = new Date(message.created_at);
      const before = !sharedSince || createdAt < sharedSince;
      const person = message.user_id ?? (before ? message.owner_id : null);
      return {
        id: message.id,
        channelId: message.chat_id,
        seq: seen.length,
        userId: message.role === 'user' ? person : message.user_id,
        agentId: message.role === 'assistant' ? message.agent_id : null,
        text,
        attachments: tryList(message.attachments, 'cloud_agent_messages.attachments'),
        state: message.state,
        error: message.error,
        callId: message.call_id,
        createdAt,
      };
    });
    const moving = new Set(kept.flatMap((one) => one.attachments.map((file) => file.id)));
    await dropUnshown(
      tx,
      gone.filter((one) => !moving.has(one.id)),
    );
    for (let from = 0; from < kept.length; from += CHUNK)
      await tx.insert(senderMessages).values(kept.slice(from, from + CHUNK));
    moved = kept.length;
    const last = new Map<string, Date>();
    for (const message of kept) last.set(message.channelId, message.createdAt);
    for (const [chatId, seqs] of numbers)
      await tx
        .update(senderChannels)
        .set({ lastSeq: seqs.length, updatedAt: last.get(chatId) })
        .where(eq(senderChannels.id, chatId));
    const reads = rowsOf<{ agent_id: string; user_id: string; read_seq: number }>(
      await tx.execute(sql`select agent_id, user_id, read_seq from sender_agent_reads`),
    );
    const chatsOf = new Map<string, string[]>();
    for (const row of rowsOf<{ id: string; agent_id: string }>(
      await tx.execute(sql`select id, agent_id from sender_channels where kind = 'agent'`),
    ))
      chatsOf.set(row.agent_id, [...(chatsOf.get(row.agent_id) ?? []), row.id]);
    const members = reads.flatMap((read) =>
      (chatsOf.get(read.agent_id) ?? []).map((chatId) => ({
        channelId: chatId,
        userId: read.user_id,
        readSeq: (numbers.get(chatId) ?? []).filter((seq) => seq <= read.read_seq).length,
      })),
    );
    for (let from = 0; from < members.length; from += CHUNK)
      await tx
        .insert(senderMembers)
        .values(members.slice(from, from + CHUNK))
        .onConflictDoNothing();
    await tx.execute(sql`drop table sender_agent_reads`);
    await tx.execute(sql`drop table cloud_agent_messages`);
    await tx.execute(sql`drop table cloud_agent_chats`);
  });
  log.info(`Moved ${moved} agent chat messages into Sender.`);
  if (unread > 0) log.warn(`Left out ${unread} agent chat messages that no longer open.`);
}
