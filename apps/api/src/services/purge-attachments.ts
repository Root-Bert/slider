import { eq, inArray, or } from 'drizzle-orm';
import { isCloudReference, type Attachment } from '@slider/shared';
import type { Executor } from '../db/client';
import {
  calendarEvents,
  decks,
  documentComments,
  materialChatMessages,
  materialChats,
  pdfComments,
  senderMessages,
  senderScheduled,
  todos,
} from '../db/schema';

/*
 * The files put on what is written about a presentation, a document or a PDF – its comments, its
 * AI chat. Their rows go with it through the database (cascades), the files themselves would
 * stay: nothing points at them any more (the user, 2026-11-23: „so dass solche dateien auch
 * wieder gelöscht werden können per rechtsklick auf die slider, writer, ... datei“). Gathered
 * before the final delete, removed after it (`deleteAttachments`). In the trash they stay, with
 * what they are on.
 */

/** How many ids go into one query. */
const CHUNK = 500;

/**
 * The files on the comments and AI chats of these Cloud files (`nodeIds`: documents, PDFs, the
 * files presentations stand for) and these presentations (`deckIds`: also those without a file)
 * – not the Cloud files and folders they point to.
 */
export async function attachmentsOn(
  db: Executor,
  at: { nodeIds?: readonly string[]; deckIds?: readonly string[] },
): Promise<Attachment[]> {
  const found: Attachment[] = [];
  const nodeIds = [...(at.nodeIds ?? [])];
  const deckIds = [...(at.deckIds ?? [])];
  for (let from = 0; from < nodeIds.length; from += CHUNK) {
    const ids = nodeIds.slice(from, from + CHUNK);
    const [chats, docs, pdfs] = await Promise.all([
      db
        .select({ attachments: materialChatMessages.attachments })
        .from(materialChatMessages)
        .innerJoin(materialChats, eq(materialChats.id, materialChatMessages.chatId))
        .where(
          or(
            inArray(materialChats.documentId, ids),
            inArray(
              materialChats.deckId,
              db.select({ id: decks.id }).from(decks).where(inArray(decks.cloudNodeId, ids)),
            ),
          ),
        ),
      db
        .select({ attachments: documentComments.attachments })
        .from(documentComments)
        .where(inArray(documentComments.documentId, ids)),
      db
        .select({ attachments: pdfComments.attachments })
        .from(pdfComments)
        .where(inArray(pdfComments.pdfId, ids)),
    ]);
    for (const row of [...chats, ...docs, ...pdfs]) found.push(...(row.attachments ?? []));
  }
  for (let from = 0; from < deckIds.length; from += CHUNK) {
    const rows = await db
      .select({ attachments: materialChatMessages.attachments })
      .from(materialChatMessages)
      .innerJoin(materialChats, eq(materialChats.id, materialChatMessages.chatId))
      .where(inArray(materialChats.deckId, deckIds.slice(from, from + CHUNK)));
    for (const row of rows) found.push(...(row.attachments ?? []));
  }
  // Cloud files and folders pointed to are no one's files to remove with it.
  return found.filter((one) => !isCloudReference(one));
}

/**
 * The files of planned messages („Später senden“) being deleted – but not of one posted already
 * (stuck or refused after it went out): the message has them now under the plan's id.
 */
export async function unsentPlanFiles(
  db: Executor,
  planned: readonly { id: string; attachments: Attachment[] | null }[],
): Promise<Attachment[]> {
  const ids = planned.map((row) => row.id);
  const out = new Set<string>();
  for (let from = 0; from < ids.length; from += CHUNK)
    for (const row of await db
      .select({ id: senderMessages.id })
      .from(senderMessages)
      .where(inArray(senderMessages.id, ids.slice(from, from + CHUNK))))
      out.add(row.id);
  return planned.filter((row) => !out.has(row.id)).flatMap((row) => row.attachments ?? []);
}

/**
 * The files on what goes with these through the database – a conversation's messages
 * (`channelIds`, an agent's chats among them), to-dos (`todoIds`), the events of calendars
 * (`calendarIds`) – gathered before the delete, removed after it (`deleteAttachments`). Not the
 * Cloud files and folders they point to.
 */
export async function attachmentsOf(
  db: Executor,
  of: {
    channelIds?: readonly string[];
    todoIds?: readonly string[];
    calendarIds?: readonly string[];
  },
): Promise<Attachment[]> {
  const found: Attachment[] = [];
  const gather = async (
    ids: readonly string[] | undefined,
    read: (chunk: string[]) => Promise<{ attachments: Attachment[] | null }[]>,
  ) => {
    const all = [...(ids ?? [])];
    for (let from = 0; from < all.length; from += CHUNK)
      for (const row of await read(all.slice(from, from + CHUNK)))
        found.push(...(row.attachments ?? []));
  };
  await gather(of.channelIds, (ids) =>
    db
      .select({ attachments: senderMessages.attachments })
      .from(senderMessages)
      .where(inArray(senderMessages.channelId, ids)),
  );
  // What was planned there („Später senden“) and holds its files while it waits.
  await gather(of.channelIds, (ids) =>
    db
      .select({ attachments: senderScheduled.attachments })
      .from(senderScheduled)
      .where(inArray(senderScheduled.channelId, ids)),
  );
  await gather(of.todoIds, (ids) =>
    db.select({ attachments: todos.attachments }).from(todos).where(inArray(todos.id, ids)),
  );
  await gather(of.calendarIds, (ids) =>
    db
      .select({ attachments: calendarEvents.attachments })
      .from(calendarEvents)
      .where(inArray(calendarEvents.calendarId, ids)),
  );
  return found.filter((one) => !isCloudReference(one));
}
