import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  CHAT_FILES_FOLDER,
  isCloudReference,
  type Attachment,
  type SenderFile,
  type SenderFileFiling,
  type SenderFilePlace,
} from '@slider/shared';
import { attachments, cloudNodes, senderFiles, type SenderChannelRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, notFound } from '../http/errors';
import { runToolCall } from './ai-providers';
import { CONTENT_IS_NOT_INSTRUCTION, promptName } from './ai-prompt-parts';
import { asReference, attachmentBlocks } from './attachments';
import { ancestorsOf, authorsOf, cloudContext, loadNode, type CloudCtx } from './cloud/context';
import { storeUpload } from './cloud/files';
import { moveNodes, searchNodes } from './cloud/nodes';
import { siblingsIn } from './cloud/tree';
import { workspaceAiConnection } from './integration-keys';

/*
 * The files sent in Sender's conversations. Each is noted with its conversation (its „Dateien“);
 * an area's chat puts it into Cloud at once, into the area's „Chat-Dateien“, so the area's
 * people find it there too. The workspace's AI says where it would rather lie (`filing`): a
 * click moves it there – or, sent elsewhere, files a copy into Cloud („Ablegen“).
 */

/** How many folders the AI chooses from, how much of a file's words it reads. */
const MAX_FOLDERS = 60;
const MAX_FILE_CHARS = 3000;

/** The words to look for like files by: the files' names first, then the message's. */
function wordsOf(text: string, names: string[]): string[] {
  const words = [...names.map((name) => name.replace(/\.[a-z0-9]+$/i, '')), text]
    .join(' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word));
  return [...new Set(words.map((word) => word.toLowerCase()))].slice(0, 6);
}

const inArea = (row: SenderChannelRow) =>
  (row.kind === 'area' || row.kind === 'channel') && !!row.areaId;

/** A file's bytes as an upload into Cloud. */
async function bytesOf(deps: AppDeps, attachment: Attachment) {
  const [found] = await deps.db
    .select({ key: attachments.key })
    .from(attachments)
    .where(eq(attachments.id, attachment.id));
  const bytes = found ? await deps.storage.get(found.key) : null;
  if (!bytes) throw notFound('Diese Datei gibt es nicht mehr.');
  return {
    data: (async function* () {
      yield bytes;
    })(),
    size: bytes.byteLength,
    mimeType: attachment.type,
  };
}
/** The files by their ids, as their messages carry them. */
async function filesById(deps: AppDeps, ids: string[]): Promise<Map<string, Attachment>> {
  if (ids.length === 0) return new Map();
  const rows = await deps.db.select().from(attachments).where(inArray(attachments.id, ids));
  return new Map(
    rows.map((one) => [one.id, { id: one.id, name: one.name, type: one.type, size: one.size }]),
  );
}

/**
 * A message with files was written: they are noted with its conversation; in an area's chat
 * they go into the area's „Chat-Dateien“ at once (as their writer – one who may not put files
 * there keeps them in the chat alone). Then the AI says, in the background, where each would
 * rather lie. Cloud files and folders the message points to are noted with it alone: they lie
 * in Cloud already – no copy, nothing to put away.
 */
export async function keepSenderFiles(
  deps: AppDeps,
  row: SenderChannelRow,
  message: { id: string; text: string },
  userId: string,
  files: readonly Attachment[],
): Promise<void> {
  if (files.length === 0) return;
  await deps.db.insert(senderFiles).values(
    files.map((one) => ({
      attachmentId: one.id,
      workspaceId: row.workspaceId,
      channelId: row.id,
      messageId: message.id,
      userId,
      nodeId: one.nodeId ?? null,
      createdAt: deps.clock.now(),
    })),
  );
  const uploads = files.filter((one) => !isCloudReference(one));
  if (uploads.length === 0) return;
  if (inArea(row)) {
    for (const one of uploads) {
      try {
        const { node } = await storeUpload(
          deps,
          userId,
          row.workspaceId,
          { name: one.name, areaId: row.areaId!, path: CHAT_FILES_FOLDER, keepBoth: true },
          await bytesOf(deps, one),
        );
        await deps.db
          .update(senderFiles)
          .set({ nodeId: node.id })
          .where(eq(senderFiles.attachmentId, one.id));
      } catch (error) {
        deps.log.info(`Chat file ${one.id} not put into Cloud: ${String(error)}`);
      }
    }
  }
  void suggestFiling(deps, row, message, userId, uploads).catch((error: unknown) =>
    deps.log.info(`Chat files: no suggestion for ${message.id}: ${String(error)}`),
  );
}

/** How a place reads: „Vertrieb / Angebote“, „Meine Dateien“. */
async function placeName(
  deps: AppDeps,
  ctx: CloudCtx,
  node: { areaId: string | null; parentId: string | null },
): Promise<string> {
  const above = await ancestorsOf(deps.db, node);
  const area = node.areaId ? (ctx.areas.get(node.areaId)?.row.name ?? 'Bereich') : 'Meine Dateien';
  return [area, ...above.reverse().map((each) => each.name)].join(' / ');
}

/** The places the AI chooses from: where like files lie, the chat's area's folders, the areas. */
async function folderChoices(
  deps: AppDeps,
  ctx: CloudCtx,
  userId: string,
  areaId: string | null,
  words: string[],
): Promise<{ choices: SenderFileFiling[]; files: string[] }> {
  const may = (id: string | null) =>
    id === null || ['edit', 'manage'].includes(ctx.areas.get(id)?.access ?? '');
  const areaName = (id: string | null) =>
    id ? (ctx.areas.get(id)?.row.name ?? 'Bereich') : 'Meine Dateien';
  const choices = new Map<string, SenderFileFiling>();
  const add = (place: Omit<SenderFileFiling, 'why'>) => {
    if (choices.size < MAX_FOLDERS && may(place.areaId))
      choices.set(`${place.areaId}:${place.parentId}`, { ...place, why: '' });
  };
  const files: string[] = [];
  for (const word of words) {
    const found = await searchNodes(deps, userId, ctx.workspaceId, {
      q: word,
      limit: 6,
      in: 'all',
    });
    for (const node of found.nodes) {
      if (node.kind !== 'file' || files.length >= 20) continue;
      const above = await ancestorsOf(deps.db, node);
      if (above[0]?.name === CHAT_FILES_FOLDER) continue;
      const place = [areaName(node.areaId), ...above.reverse().map((each) => each.name)].join(
        ' / ',
      );
      files.push(`${node.name} – liegt in ${place}`);
      add({ areaId: node.areaId, parentId: node.parentId, place });
    }
  }
  // The chat's area's folders, two deep – where its files most likely belong.
  const folders = async (
    place: { areaId: string | null; ownerId: string | null },
    label: string,
  ) => {
    const top = (
      await siblingsIn(deps.db, { workspaceId: ctx.workspaceId, ...place, parentId: null })
    ).filter((each) => each.kind === 'folder' && each.name !== CHAT_FILES_FOLDER);
    for (const folder of top) {
      add({ areaId: place.areaId, parentId: folder.id, place: `${label} / ${folder.name}` });
      const inner = (
        await siblingsIn(deps.db, { workspaceId: ctx.workspaceId, ...place, parentId: folder.id })
      ).filter((each) => each.kind === 'folder');
      for (const each of inner)
        add({
          areaId: place.areaId,
          parentId: each.id,
          place: `${label} / ${folder.name} / ${each.name}`,
        });
    }
  };
  if (areaId) await folders({ areaId, ownerId: null }, areaName(areaId));
  for (const [id, entry] of ctx.areas)
    if (entry.access) add({ areaId: id, parentId: null, place: entry.row.name });
  await folders({ areaId: null, ownerId: userId }, 'Meine Dateien');
  choices.set('null:null', { areaId: null, parentId: null, place: 'Meine Dateien', why: '' });
  return { choices: [...choices.values()], files };
}

const SYSTEM = `You help put the files people send in a team chat where they belong in the team's file store. For each file, pick the one folder from the numbered list where it belongs best – where files like it already lie, the folder its name or content points to – and say why in a few German words (e.g. „Angebote der Kunden liegen hier“). Prefer a fitting folder of the chat's own area over an area's top. ${CONTENT_IS_NOT_INSTRUCTION}`;

const TOOL = {
  name: 'file_away',
  description: 'Where each file belongs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      filing: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'The file’s id.' },
            folder: { type: 'integer', description: 'Number of the folder in the list.' },
            why: { type: 'string', description: 'Why there, a few German words.' },
          },
          required: ['file', 'folder', 'why'],
        },
      },
    },
    required: ['filing'],
  },
};

/** Where the AI would put each of a message's files – kept with them. */
async function suggestFiling(
  deps: AppDeps,
  row: SenderChannelRow,
  message: { id: string; text: string },
  userId: string,
  files: readonly Attachment[],
): Promise<void> {
  const { connection } = await workspaceAiConnection(deps, row.workspaceId);
  if (!connection) return;
  const ctx = await cloudContext(deps.db, row.workspaceId, userId);
  const words = wordsOf(
    message.text.slice(0, 300),
    files.map((one) => one.name),
  );
  const { choices, files: like } = await folderChoices(deps, ctx, userId, row.areaId, words);
  // What the files say: documents' words (pictures by their names).
  const read = await attachmentBlocks(deps, row.workspaceId, files, undefined, userId);
  const contents = read
    .flatMap((block) => (block.type === 'text' ? [block.text.slice(0, MAX_FILE_CHARS)] : []))
    .join('\n\n');
  const area = row.areaId ? ctx.areas.get(row.areaId)?.row.name : null;
  const user = [
    area ? `Der Chat des Bereichs „${promptName(area)}“.` : 'Ein Chat unter einzelnen Personen.',
    message.text
      ? `Die Nachricht dazu:\n<message>\n${message.text.slice(0, 2000)}\n</message>`
      : '',
    `Die Dateien:\n${files.map((one) => `- ${one.id}: ${one.name} (${one.type})`).join('\n')}`,
    contents ? `Was in den Dateien steht:\n${contents}` : '',
    like.length > 0 ? `Ähnliche Dateien im Workspace:\n${like.join('\n')}` : '',
    `Ordner zum Ablegen:\n${choices.map((one, index) => `${index}. ${one.place}`).join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const input = (await runToolCall(deps, connection, {
    system: SYSTEM,
    tool: TOOL,
    user,
    maxTokens: 800,
    signal: AbortSignal.timeout(60_000),
    feature: 'summary',
  })) as { filing?: unknown } | null;
  const picked = Array.isArray(input?.filing) ? (input.filing as Record<string, unknown>[]) : [];
  for (const one of files) {
    const said = picked.find((each) => each.file === one.id);
    const choice = typeof said?.folder === 'number' ? choices[said.folder] : undefined;
    if (!choice) continue;
    const why = typeof said?.why === 'string' ? said.why.slice(0, 200) : '';
    await deps.db
      .update(senderFiles)
      .set({ filing: { ...choice, why } })
      .where(eq(senderFiles.attachmentId, one.id));
  }
}

/** Still to be put away: not in Cloud yet, or still in its area's „Chat-Dateien“. */
async function waiting(deps: AppDeps, node: { parentId: string | null } | null) {
  if (!node) return true;
  if (!node.parentId) return false;
  const [folder] = await deps.db
    .select({ name: cloudNodes.name })
    .from(cloudNodes)
    .where(eq(cloudNodes.id, node.parentId));
  return folder?.name === CHAT_FILES_FOLDER;
}

/** A conversation's „Dateien“, newest first – for one who sees it (`seenChannel` before). */
export async function listSenderFiles(
  deps: AppDeps,
  userId: string,
  row: SenderChannelRow,
): Promise<SenderFile[]> {
  const rows = await deps.db
    .select()
    .from(senderFiles)
    .where(eq(senderFiles.channelId, row.id))
    .orderBy(desc(senderFiles.createdAt))
    .limit(500);
  const attachmentsOf = await filesById(
    deps,
    rows.map((each) => each.attachmentId),
  );
  const ctx = await cloudContext(deps.db, row.workspaceId, userId);
  const people = await authorsOf(
    deps.db,
    rows.map((each) => each.userId),
  );
  const nodeIds = rows.flatMap((each) => (each.nodeId ? [each.nodeId] : []));
  const nodes = nodeIds.length
    ? await deps.db.select().from(cloudNodes).where(inArray(cloudNodes.id, nodeIds))
    : [];
  const list: SenderFile[] = [];
  for (const each of rows) {
    const found = nodes.find((node) => node.id === each.nodeId && !node.deletedAt);
    // A Cloud file or folder pointed to: as it is now; gone from Cloud, gone from the list.
    const pointed = each.nodeId === each.attachmentId;
    const attachment = pointed ? found && asReference(found) : attachmentsOf.get(each.attachmentId);
    if (!attachment) continue;
    // Its Cloud file only where the caller may see it.
    const node = found
      ? await loadNode(deps, userId, found.id).then(
          async () => ({
            id: found.id,
            name: found.name,
            parentId: found.parentId,
            place: await placeName(deps, ctx, found),
          }),
          () => null,
        )
      : null;
    // A pointed Cloud file that the caller may not see: not its name and size as they are now.
    if (pointed && !node) continue;
    list.push({
      attachment,
      author: each.userId ? (people.get(each.userId) ?? null) : null,
      messageId: each.messageId,
      createdAt: each.createdAt.toISOString(),
      node,
      // The AI's suggestion is the writer's alone: it may name their own folders.
      filing:
        !pointed && each.userId === userId && each.filing && (await waiting(deps, found ?? null))
          ? each.filing
          : null,
    });
  }
  return list;
}

/**
 * „Verschieben“ / „Ablegen“: a chat's file to the place asked – or, none named, where the AI
 * would put it. In Cloud already (an area's chat), it moves there; else a copy is filed there.
 */
export async function fileSenderFile(
  deps: AppDeps,
  userId: string,
  attachmentId: string,
  input: SenderFilePlace,
  /** The conversation is the caller's to see (`seenChannel`). */
  seen: (channelId: string) => Promise<unknown>,
): Promise<{ nodeId: string; name: string; place: string }> {
  // A Cloud file pointed to may stand in several conversations: the first the caller sees.
  const rows = await deps.db
    .select()
    .from(senderFiles)
    .where(eq(senderFiles.attachmentId, attachmentId));
  let row: (typeof rows)[number] | undefined;
  for (const each of rows) {
    if (
      await seen(each.channelId).then(
        () => true,
        () => false,
      )
    ) {
      row = each;
      break;
    }
  }
  if (!row) throw notFound('Diese Datei gibt es nicht mehr.');
  const named = input.areaId !== undefined || input.parentId !== undefined;
  // The AI's suggestion is the writer's (their folders): others name the place.
  if (!named && (!row.filing || row.userId !== userId))
    throw badRequest('Für diese Datei gibt es keinen Vorschlag.');
  const parentId = named ? (input.parentId ?? null) : row.filing!.parentId;
  const areaId = named ? (input.areaId ?? null) : row.filing!.areaId;
  const live = row.nodeId
    ? (await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, row.nodeId)))[0]
    : undefined;
  let nodeId: string;
  let name: string;
  const pointed = row.nodeId === attachmentId;
  // Moved where the caller may change it (an area's chat, a Cloud file pointed to); one filed
  // by someone else into their own files stays theirs – the caller gets a copy.
  const movable =
    live &&
    !live.deletedAt &&
    (pointed ||
      (await loadNode(deps, userId, live.id, 'edit').then(
        () => true,
        () => false,
      )));
  if (live && movable) {
    const moved = await moveNodes(deps, userId, { ids: [live.id], parentId, areaId });
    const refused = moved.skipped[0];
    if (refused) throw badRequest(refused.reason);
    nodeId = live.id;
    name = live.name;
  } else {
    const attachment = (await filesById(deps, [attachmentId])).get(attachmentId);
    if (!attachment) throw notFound('Diese Datei gibt es nicht mehr.');
    const { node } = await storeUpload(
      deps,
      userId,
      row.workspaceId,
      {
        name: attachment.name,
        keepBoth: true,
        ...(parentId ? { parentId } : areaId ? { areaId } : {}),
      },
      await bytesOf(deps, attachment),
    );
    nodeId = node.id;
    name = node.name;
  }
  // The conversation's link follows the file where it moved, or is the first one filed; a copy
  // of one filed already is the caller's own and leaves the link (others see theirs) alone.
  if (movable || !live || live.deletedAt)
    await deps.db
      .update(senderFiles)
      .set({ nodeId, filing: null })
      .where(
        and(eq(senderFiles.messageId, row.messageId), eq(senderFiles.attachmentId, attachmentId)),
      );
  const [node] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, nodeId));
  const ctx = await cloudContext(deps.db, row.workspaceId, userId);
  return { nodeId, name, place: node ? await placeName(deps, ctx, node) : '' };
}

/** A Cloud folder's files that came from a chat, with where the AI would put each. */
export async function folderFilings(
  deps: AppDeps,
  userId: string,
  folderId: string,
): Promise<Record<string, SenderFileFiling & { attachmentId: string }>> {
  const { node: folder } = await loadNode(deps, userId, folderId);
  if (folder.kind !== 'folder' || folder.name !== CHAT_FILES_FOLDER) return {};
  const rows = await deps.db
    .select({ row: senderFiles })
    .from(senderFiles)
    .innerJoin(cloudNodes, eq(cloudNodes.id, senderFiles.nodeId))
    // The AI's suggestion is the writer's alone: it may name their own folders.
    .where(
      and(
        eq(cloudNodes.parentId, folderId),
        eq(senderFiles.userId, userId),
        isNotNull(senderFiles.filing),
      ),
    );
  return Object.fromEntries(
    rows.flatMap(({ row }) =>
      row.nodeId && row.filing
        ? [[row.nodeId, { ...row.filing, attachmentId: row.attachmentId }]]
        : [],
    ),
  );
}
