import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, lt, max, or } from 'drizzle-orm';
import { blankOdt, MarkdownDocument, OdtDocument, OdtError } from '@slider/odt';
import {
  cloudAccessAtLeast,
  cloudExtension,
  cloudNameSchema,
  isWriterMarkdown,
  movedAnchor,
  WRITER_EXTENSION,
  WRITER_IMPORTS,
  WRITER_MARKDOWN_MIME,
  WRITER_MIME,
  WRITER_OPENS,
  WRITER_PICTURE_TYPES,
  MAX_WRITER_PICTURE_BYTES,
  writerText,
  type Author,
  type CommentReaction,
  type CommentReactionKind,
  type CloudAccess,
  type CloudNode,
  type CreateWriterCommentInput,
  type CreateWriterDocumentInput,
  type UpdateWriterCommentInput,
  type WriterBlock,
  type WriterComment,
  type WriterContent,
  type WriterDocument,
  type WriterEditInput,
  type WriterEditResult,
  type WriterOpened,
  type WriterPresence,
  type WriterTools,
  type ImageCredit,
  type WriterParagraphBlock,
  type WriterStep,
  type StockOrientation,
  type StockPhoto,
} from '@slider/shared';
import { displayAuthor } from '../authors';
import { advisoryXactLock } from '../db/client';
import {
  cloudNodes,
  cloudVersions,
  documentCommentReactions,
  documentComments,
  documentEdits,
  documents,
  type CloudNodeRow,
  type CloudVersionRow,
  type DocumentCommentRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError, badRequest, fileTooLarge, forbidden, notFound } from '../http/errors';
import { claimAttachments, deleteAttachments } from './attachments';
import type { TextDocumentKind } from '../import/libreoffice';
import { blobKeys } from '../storage/blob-storage';
import { deleteBlobs, storageBlobs } from './blob-deletions';
import { isDeckKey } from './cloud/blobs';
import {
  authorIn,
  authorsOf,
  baseAccess,
  cloudContext,
  listNodes,
  looksOnly,
  loadNode,
  nodeDto,
  reachable,
  recordEvent,
  storeUpload,
  toNodeDtos,
  touchRecent,
  type CloudCtx,
  type CloudDeps,
  type LoadedNode,
} from './cloud';
import { imageMediaType } from './edits/images';
import { generatePicture, withReferences } from './image-generation';
import { takesImageReferences } from './ai-providers';
import { workspaceImageConnection } from './integration-keys';
import { imageSize } from '../import/any-file';
import { assertStorageFor } from './plans';
import {
  findPhoto,
  photoBytes,
  photoSource,
  randomPhotos,
  searchPhotos,
  toStockPhoto,
  trackPhoto,
} from './stock-photos';
import { atLeast } from './workspaces/roles';

/*
 * Writer's documents. A document is a text file (.odt) lying in Cloud: where it lies, who may
 * open it, its versions and its trash are Cloud's (`services/cloud`). Here: reading it as
 * paragraphs, writing steps into it (each a new version of the file – a stretch of typing one
 * version, not one per keystroke), its pictures, and the comments on it.
 */

export type DocumentDeps = CloudDeps & Pick<AppDeps, 'documentOdt'>;

const documentNotFound = () => notFound('Dieses Dokument gibt es nicht (mehr).');
/** The largest text file Writer opens: it is read whole for every step. */
export const MAX_DOCUMENT_FILE_BYTES = 60 * 1024 ** 2;
/** Typing by one person within this long is one version of the file. */
export const DRAFT_WINDOW_MS = 10 * 60_000;
const EDIT_MEMORY_MS = 24 * 60 * 60_000;

// ── Who has it open ─────────────────────────────────────────────────────────

export type DocumentEvent =
  | { type: 'step'; step: WriterStep }
  /** The comments changed, or what the AI does under them: read them again. */
  | { type: 'comments' }
  /** Something on the document's board „Material“ changed (`board-owner.ts`): read it again. */
  | { type: 'board' }
  /** An earlier version was brought back (`restoreVersion`): read the document anew. */
  | { type: 'restored' }
  /** A diagram was saved (`services/diagrams.ts`): joined into what is open, but by who saved it. */
  | { type: 'diagram'; versionId: string; clientId: string }
  /** Where someone's caret stands now (`POST …/presence`); gone with them from `people`. */
  | { type: 'cursor'; author: Author; sel: WriterPresence['sel'] }
  | { type: 'people'; people: Author[] };

interface Listener {
  author: Author;
  send: (event: DocumentEvent) => void;
}

/** The open documents of this server and who listens to each. */
export class DocumentLive {
  private readonly rooms = new Map<string, Set<Listener>>();

  join(documentId: string, author: Author, send: Listener['send']): () => void {
    const listener = { author, send };
    const room = this.rooms.get(documentId) ?? new Set<Listener>();
    this.rooms.set(documentId, room);
    room.add(listener);
    this.people(documentId);
    return () => {
      room.delete(listener);
      if (room.size === 0) this.rooms.delete(documentId);
      else this.people(documentId);
    };
  }

  publish(documentId: string, event: DocumentEvent): void {
    for (const listener of this.rooms.get(documentId) ?? []) {
      try {
        listener.send(event);
      } catch {
        // A stream that is gone leaves by itself.
      }
    }
  }

  private people(documentId: string): void {
    const seen = new Map<string, Author>();
    for (const listener of this.rooms.get(documentId) ?? []) {
      seen.set(listener.author.id, listener.author);
    }
    this.publish(documentId, { type: 'people', people: [...seen.values()] });
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

const isDocument = (node: Pick<CloudNodeRow, 'kind' | 'extension'>) =>
  node.kind === 'file' && node.extension !== null && WRITER_OPENS.includes(node.extension);

const titleOf = (name: string) => name.replace(/\.(odt|md|markdown)$/i, '');

/** A text document or a Markdown file, as Writer reads and writes it. */
type TextFile = OdtDocument | MarkdownDocument;

async function loadDocument(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
  min: CloudAccess = 'view',
  options: { deleted?: boolean } = {},
): Promise<LoadedNode> {
  const loaded = await loadNode(deps, userId, documentId, min, options).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) throw documentNotFound();
    throw error;
  });
  if (!isDocument(loaded.node)) throw documentNotFound();
  return loaded;
}

async function currentVersion(deps: DocumentDeps, node: CloudNodeRow): Promise<CloudVersionRow> {
  const [version] = node.currentVersionId
    ? await deps.db.select().from(cloudVersions).where(eq(cloudVersions.id, node.currentVersionId))
    : [];
  if (!version) throw documentNotFound();
  if (isDeckKey(version.storageKey)) throw documentNotFound();
  if (version.sizeBytes > MAX_DOCUMENT_FILE_BYTES) {
    throw badRequest('Dieses Dokument ist zu groß, um es hier zu öffnen.');
  }
  return version;
}

/** Where the ids of a Markdown version's lines lie: beside its bytes, gone with them. */
const lineIdsKey = (version: Pick<CloudVersionRow, 'storageKey'>) =>
  `${version.storageKey}.ids.json`;

async function openFile(
  deps: DocumentDeps,
  node: Pick<CloudNodeRow, 'name'>,
  version: CloudVersionRow,
): Promise<TextFile> {
  const bytes = await deps.storage.get(version.storageKey);
  if (!bytes) throw documentNotFound();
  try {
    if (isWriterMarkdown(node.name)) {
      const ids = await deps.storage.get(lineIdsKey(version)).catch(() => null);
      let known: string[] | null = null;
      try {
        known = ids ? (JSON.parse(new TextDecoder().decode(ids)) as string[]) : null;
      } catch {
        // Unreadable: the lines are counted.
      }
      return MarkdownDocument.open(bytes, Array.isArray(known) ? known : null);
    }
    return await OdtDocument.open(bytes);
  } catch (error) {
    if (error instanceof OdtError) {
      throw badRequest('Dieses Dokument lässt sich nicht lesen. Die Datei ist beschädigt.');
    }
    throw error;
  }
}

const placeOf = (node: CloudNode): string => {
  const location = node.location;
  if (!location) return '';
  return [location.areaName ?? 'Meine Dateien', ...location.folders.map((folder) => folder.name)]
    .filter(Boolean)
    .join(' / ');
};

async function commentCounts(
  deps: DocumentDeps,
  ids: readonly string[],
): Promise<Map<string, { open: number; all: number }>> {
  const counts = new Map<string, { open: number; all: number }>();
  if (ids.length === 0) return counts;
  for (let at = 0; at < ids.length; at += 500) {
    const rows = await deps.db
      .select({
        documentId: documentComments.documentId,
        parentId: documentComments.parentId,
        status: documentComments.status,
      })
      .from(documentComments)
      .where(inArray(documentComments.documentId, ids.slice(at, at + 500)));
    for (const row of rows) {
      const count = counts.get(row.documentId) ?? { open: 0, all: 0 };
      count.all += 1;
      // A thread is open or done; its answers follow it.
      if (!row.parentId && row.status === 'open') count.open += 1;
      counts.set(row.documentId, count);
    }
  }
  return counts;
}

function toDocument(
  ctx: CloudCtx,
  node: CloudNode,
  counts: ReadonlyMap<string, { open: number; all: number }>,
): WriterDocument {
  const count = counts.get(node.id);
  const trashed = node.deleted !== null;
  return {
    id: node.id,
    workspaceId: node.workspaceId,
    title: titleOf(node.name),
    fileName: node.name,
    place: placeOf(node),
    sizeBytes: node.sizeBytes,
    hasThumbnail: node.thumbnail,
    versionId: node.versionId,
    openComments: count?.open ?? 0,
    comments: count?.all ?? 0,
    updatedBy: node.updatedBy,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    deletedAt: node.deleted?.at ?? null,
    permissions: {
      canEdit: !trashed && cloudAccessAtLeast(node.access, 'edit'),
      canComment: !trashed && atLeast(ctx.role, 'reviewer'),
      canManage: cloudAccessAtLeast(node.access, 'manage'),
    },
  };
}

async function documentDto(
  deps: DocumentDeps,
  ctx: CloudCtx,
  row: CloudNodeRow,
  access?: CloudAccess,
): Promise<WriterDocument> {
  const [withPlace] = await toNodeDtos(deps, ctx, [row], {
    access: () => access ?? 'view',
    location: true,
    trashed: Boolean(row.deletedAt),
  });
  const node = withPlace ?? (await nodeDto(deps, ctx, row, access));
  return toDocument(ctx, node, await commentCounts(deps, [row.id]));
}

/** The workspace's documents the caller reaches, the last changed first – or those deleted. */
export async function listDocuments(
  deps: DocumentDeps,
  userId: string,
  workspaceId: string,
  scope: 'all' | 'trash',
): Promise<WriterDocument[]> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  let nodes: CloudNode[];
  if (scope === 'trash') {
    const { nodes: trashed } = await listNodes(deps, userId, workspaceId, { scope: 'trash' });
    nodes = trashed.filter(
      (node) => node.kind === 'file' && WRITER_OPENS.includes(cloudExtension(node.name)),
    );
  } else {
    const rows = await deps.db
      .select()
      .from(cloudNodes)
      .where(
        and(
          reachable(ctx),
          eq(cloudNodes.kind, 'file'),
          inArray(cloudNodes.extension, [...WRITER_OPENS]),
        ),
      );
    const own = await toNodeDtos(deps, ctx, rows, {
      access: (row) => baseAccess(ctx, row) ?? 'view',
      location: true,
    });
    const have = new Set(own.map((node) => node.id));
    const { nodes: shared } = await listNodes(deps, userId, workspaceId, { scope: 'shared' });
    nodes = [
      ...own,
      ...shared.filter(
        (node) =>
          node.kind === 'file' &&
          WRITER_OPENS.includes(cloudExtension(node.name)) &&
          !have.has(node.id),
      ),
    ];
  }
  const counts = await commentCounts(
    deps,
    nodes.map((node) => node.id),
  );
  return nodes
    .map((node) => toDocument(ctx, node, counts))
    .sort((a, b) =>
      scope === 'trash'
        ? (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')
        : b.updatedAt.localeCompare(a.updatedAt),
    );
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/**
 * Where a new file goes: a folder or an area's top when made from inside one, else its maker's
 * own files („Meine Dateien“) – there only they see it until they move or share it.
 */
export interface NewFilePlace {
  parentId?: string;
  areaId?: string;
}

async function store(
  deps: DocumentDeps,
  userId: string,
  workspaceId: string,
  name: string,
  bytes: Uint8Array,
  place: NewFilePlace = {},
  mimeType = WRITER_MIME,
): Promise<WriterDocument> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  if (!place.parentId && !place.areaId && looksOnly(ctx.role)) {
    throw forbidden('Neue Dokumente legen Mitglieder und Admins des Workspace an.');
  }
  const result = await storeUpload(
    deps,
    userId,
    workspaceId,
    { name: cloudNameSchema.parse(name), keepBoth: true, ...place },
    { data: once(bytes), size: bytes.byteLength, mimeType },
  );
  const [row] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, result.node.id));
  if (!row) throw documentNotFound();
  return documentDto(deps, ctx, row, result.node.access);
}

export async function createDocument(
  deps: DocumentDeps,
  userId: string,
  input: CreateWriterDocumentInput,
  place: NewFilePlace = {},
): Promise<WriterDocument> {
  const title = input.title ?? 'Neues Dokument';
  const bytes = await blankOdt(deps.clock.now(), { title, template: input.template ?? 'plain' });
  return store(deps, userId, input.workspaceId, `${title}.${WRITER_EXTENSION}`, bytes, place);
}

/** A file brought to Writer: a text document as it is, a Word or text file made into one. */
export async function importDocument(
  deps: DocumentDeps,
  userId: string,
  workspaceId: string,
  fileName: string,
  bytes: Uint8Array,
  place: NewFilePlace = {},
): Promise<WriterDocument> {
  const extension = cloudExtension(fileName);
  if (!(WRITER_IMPORTS as readonly string[]).includes(extension)) {
    throw badRequest('Diese Datei ist kein Textdokument.');
  }
  if (bytes.byteLength > MAX_DOCUMENT_FILE_BYTES) throw fileTooLarge(MAX_DOCUMENT_FILE_BYTES);
  // Markdown stays Markdown: Writer edits the file itself.
  if (isWriterMarkdown(fileName)) {
    try {
      MarkdownDocument.open(bytes);
    } catch {
      throw badRequest('Die Datei lässt sich nicht lesen. Sie ist kein Text in UTF-8.');
    }
    return store(deps, userId, workspaceId, fileName, bytes, place, WRITER_MARKDOWN_MIME);
  }
  let odt: Uint8Array;
  if (extension === 'odt' || extension === 'ott') odt = bytes;
  else {
    if (!deps.documentOdt) {
      throw badRequest('Dieses Format lässt sich auf diesem Server nicht öffnen.');
    }
    try {
      odt = await deps.documentOdt(bytes, extension as TextDocumentKind);
    } catch {
      throw badRequest('Die Datei lässt sich nicht lesen. Sie ist beschädigt oder geschützt.');
    }
  }
  try {
    const document = await OdtDocument.open(odt);
    // A template becomes a document; any file gets its paragraphs named once.
    if (extension !== 'odt') odt = await document.toBytes();
  } catch (error) {
    if (!(error instanceof OdtError)) throw error;
    throw badRequest('Die Datei lässt sich nicht lesen. Sie ist beschädigt oder geschützt.');
  }
  const name = `${fileName.replace(/\.[^.]+$/, '') || 'Dokument'}.${WRITER_EXTENSION}`;
  return store(deps, userId, workspaceId, name, odt, place);
}

async function seqOf(deps: DocumentDeps, documentId: string): Promise<number> {
  const [row] = await deps.db.select().from(documents).where(eq(documents.nodeId, documentId));
  return row?.editSeq ?? 0;
}

function contentOf(file: TextFile, seq: number, versionId: string): WriterContent {
  return { seq, versionId, page: file.page(), formats: file.formats(), blocks: file.blocks() };
}

export async function openDocument(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
): Promise<WriterOpened> {
  const { node, ctx, access } = await loadDocument(deps, userId, documentId);
  const version = await currentVersion(deps, node);
  const file = await openFile(deps, node, version);
  await touchRecent(deps.db, userId, node.id, deps.clock.now());
  return {
    document: await documentDto(deps, ctx, node, access),
    content: contentOf(file, await seqOf(deps, node.id), version.id),
  };
}

/** A deleted document's card still needs its name. */
export async function documentOf(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
): Promise<WriterDocument> {
  const { node, ctx, access } = await loadDocument(deps, userId, documentId);
  return documentDto(deps, ctx, node, access);
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** One step at a time per document in this process; the database lock covers other processes. */
const queues = new Map<string, Promise<unknown>>();
function inLine<T>(documentId: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(documentId) ?? Promise.resolve();
  const run = before.then(work, work);
  const tail = run.catch(() => {});
  queues.set(documentId, tail);
  void tail.then(() => {
    if (queues.get(documentId) === tail) queues.delete(documentId);
  });
  return run;
}

const paragraphsOf = (blocks: readonly WriterBlock[]): WriterParagraphBlock[] =>
  blocks.flatMap((block) =>
    block.type === 'paragraph'
      ? [block]
      : block.rows.flatMap((row) => row.flatMap((cell) => cell.blocks)),
  );

class ChangedMeanwhile extends Error {}

export interface EditOptions {
  /** A version of its own (the AI's change): not typed on into, not typing on from. */
  apart?: boolean;
}

/**
 * Writes a step into the document: its operations into the file as it is now, the result as
 * the file's next version. Whoever has it open hears the step (`live`).
 */
export function editDocument(
  deps: DocumentDeps,
  live: DocumentLive,
  userId: string,
  documentId: string,
  input: WriterEditInput,
  options: EditOptions = {},
): Promise<WriterEditResult> {
  return inLine(documentId, async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await editOnce(deps, live, userId, documentId, input, options);
      } catch (error) {
        // A version came in from elsewhere while this one was made: once more, on that one.
        if (!(error instanceof ChangedMeanwhile) || attempt >= 3) throw error;
      }
    }
  });
}

async function editOnce(
  deps: DocumentDeps,
  live: DocumentLive,
  userId: string,
  documentId: string,
  input: WriterEditInput,
  options: EditOptions,
): Promise<WriterEditResult> {
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  const [sent] = await deps.db
    .select()
    .from(documentEdits)
    .where(
      and(
        eq(documentEdits.documentId, node.id),
        eq(documentEdits.clientEditId, input.clientEditId),
      ),
    );
  if (sent) return { seq: sent.seq, versionId: node.currentVersionId, dropped: sent.dropped };

  const version = await currentVersion(deps, node);
  const file = await openFile(deps, node, version);
  const mimeType = file instanceof MarkdownDocument ? WRITER_MARKDOWN_MIME : WRITER_MIME;
  // Comments stand at stretches of paragraphs: what is typed before one moves it along.
  const touched = new Set(
    input.operations.flatMap((op) => (op.type === 'setParagraph' ? [op.id] : [])),
  );
  const anchored = touched.size
    ? (
        await deps.db
          .select()
          .from(documentComments)
          .where(and(eq(documentComments.documentId, node.id), isNotNull(documentComments.anchor)))
      ).filter(
        (row) =>
          row.anchor &&
          (touched.has(row.anchor.paragraphId) ||
            (row.anchor.to !== undefined && touched.has(row.anchor.to.paragraphId))),
      )
    : [];
  const textBefore = new Map<string, string>();
  if (anchored.length > 0) {
    for (const block of paragraphsOf(file.blocks())) {
      if (touched.has(block.id)) textBefore.set(block.id, writerText(block));
    }
  }

  let dropped: number[];
  try {
    dropped = file.apply(input.operations);
  } catch (error) {
    if (error instanceof OdtError) throw badRequest(error.message);
    throw error;
  }
  const now = deps.clock.now();
  const applied = input.operations.filter((_, index) => !dropped.includes(index));

  if (!file.changed) {
    const seq = await seqOf(deps, node.id);
    return { seq, versionId: version.id, dropped };
  }

  const bytes = await file.toBytes();
  if (bytes.byteLength > MAX_DOCUMENT_FILE_BYTES) throw fileTooLarge(MAX_DOCUMENT_FILE_BYTES);
  const versionId = crypto.randomUUID();
  const key = blobKeys.cloudVersion(node.workspaceId, node.id, versionId);
  await deps.storage.put(key, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // A Markdown file's lines keep their ids beside it: the next step names them so.
  const idsKey = file instanceof MarkdownDocument ? lineIdsKey({ storageKey: key }) : null;
  if (idsKey && file instanceof MarkdownDocument) {
    await deps.storage.put(idsKey, new TextEncoder().encode(JSON.stringify(file.ids())));
  }

  let outcome: { seq: number; replaced: CloudVersionRow | null; row: CloudNodeRow };
  try {
    outcome = await deps.db.transaction(async (tx) => {
      await advisoryXactLock(tx, `document:${node.id}`);
      const [fresh] = await tx.select().from(cloudNodes).where(eq(cloudNodes.id, node.id));
      if (!fresh || fresh.deletedAt) throw documentNotFound();
      if (fresh.currentVersionId !== version.id) throw new ChangedMeanwhile();
      const [state] = await tx.select().from(documents).where(eq(documents.nodeId, node.id));
      // Typing on: the version made a moment ago by the same person is replaced, not kept.
      const typingOn =
        !options.apart &&
        state?.draftVersionId === version.id &&
        state.draftBy === userId &&
        state.draftAt !== null &&
        now.getTime() - state.draftAt.getTime() < DRAFT_WINDOW_MS &&
        version.label === null &&
        version.restoredFrom === null;
      await assertStorageFor(
        tx,
        deps.config,
        node.workspaceId,
        Math.max(0, bytes.byteLength - (typingOn ? version.sizeBytes : 0)),
        now,
      );
      let number = version.number;
      if (typingOn) await tx.delete(cloudVersions).where(eq(cloudVersions.id, version.id));
      else {
        const [last] = await tx
          .select({ number: max(cloudVersions.number) })
          .from(cloudVersions)
          .where(eq(cloudVersions.nodeId, node.id));
        number = (last?.number ?? 0) + 1;
      }
      await tx.insert(cloudVersions).values({
        id: versionId,
        nodeId: node.id,
        workspaceId: node.workspaceId,
        number,
        storageKey: key,
        sizeBytes: bytes.byteLength,
        sha256,
        mimeType,
        createdBy: userId,
        createdAt: now,
      });
      const [row] = await tx
        .update(cloudNodes)
        .set({
          sizeBytes: bytes.byteLength,
          mimeType,
          currentVersionId: versionId,
          versionCount: fresh.versionCount + (typingOn ? 0 : 1),
          thumbnail: 'none',
          updatedAt: now,
          updatedBy: userId,
        })
        .where(eq(cloudNodes.id, node.id))
        .returning();
      if (!row) throw new Error('Document update returned nothing');
      const seq = (state?.editSeq ?? 0) + 1;
      const draft = {
        editSeq: seq,
        draftVersionId: options.apart ? null : versionId,
        draftBy: userId,
        draftAt: typingOn ? state.draftAt : now,
      };
      await tx
        .insert(documents)
        .values({ nodeId: node.id, ...draft })
        .onConflictDoUpdate({ target: documents.nodeId, set: draft });
      await tx.insert(documentEdits).values({
        id: crypto.randomUUID(),
        documentId: node.id,
        clientEditId: input.clientEditId,
        seq,
        dropped,
        createdAt: now,
      });
      if (anchored.length > 0) {
        const textAfter = new Map<string, string>();
        for (const op of applied) {
          if (op.type === 'setParagraph') textAfter.set(op.id, writerText(op.paragraph));
        }
        for (const comment of anchored) {
          const anchor = comment.anchor;
          if (!anchor) continue;
          const moved = movedAnchor(anchor, (paragraphId) => {
            const before = textBefore.get(paragraphId);
            const after = textAfter.get(paragraphId);
            return before === undefined || after === undefined ? undefined : { before, after };
          });
          if (moved === anchor) continue;
          await tx
            .update(documentComments)
            .set({ anchor: moved })
            .where(eq(documentComments.id, comment.id));
        }
      }
      return { seq, replaced: typingOn ? version : null, row };
    });
  } catch (error) {
    await deleteBlobs(deps, storageBlobs(idsKey ? [key, idsKey] : [key]));
    throw error;
  }

  if (outcome.replaced) {
    await deleteBlobs(
      deps,
      storageBlobs([
        outcome.replaced.storageKey,
        ...(idsKey ? [lineIdsKey(outcome.replaced)] : []),
        blobKeys.cloudThumbnail(node.workspaceId, node.id, outcome.replaced.id),
        blobKeys.cloudPreview(node.workspaceId, node.id, outcome.replaced.id),
      ]),
    );
  } else {
    await recordEvent(
      deps.db,
      {
        kind: 'version',
        actorId: userId,
        node: outcome.row,
        workspaceId: node.workspaceId,
        name: outcome.row.name,
        detail: `Fassung ${outcome.row.versionCount}`,
      },
      now,
    );
    // Now and then: what was remembered of steps sent long ago goes.
    await deps.db
      .delete(documentEdits)
      .where(
        and(
          eq(documentEdits.documentId, node.id),
          lt(documentEdits.createdAt, new Date(now.getTime() - EDIT_MEMORY_MS)),
        ),
      );
  }
  live.publish(node.id, {
    type: 'step',
    step: {
      seq: outcome.seq,
      versionId,
      operations: applied,
      clientEditId: input.clientEditId,
      authorId: userId,
    },
  });
  if (anchored.length > 0) live.publish(node.id, { type: 'comments' });
  return { seq: outcome.seq, versionId, dropped };
}

// ── Pictures ────────────────────────────────────────────────────────────────

/** A picture of the document, for the page drawn in the browser. */
export async function documentPicture(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
  path: string,
): Promise<{ bytes: Uint8Array; mimeType: string; versionId: string }> {
  const { node } = await loadDocument(deps, userId, documentId);
  const version = await currentVersion(deps, node);
  const file = await openFile(deps, node, version);
  const picture = file instanceof OdtDocument ? await file.picture(path) : null;
  if (!picture) throw notFound('Dieses Bild gibt es nicht.');
  return { ...picture, versionId: version.id };
}

/**
 * Puts a picture into the file (a new version, nothing shown yet); answers its path for the
 * `insertPicture` step that places it.
 */
export function addDocumentPicture(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ path: string }> {
  if (!(WRITER_PICTURE_TYPES as readonly string[]).includes(mimeType)) {
    throw badRequest('Hier gehen Bilder als PNG, JPEG, GIF oder WebP.');
  }
  if (bytes.byteLength > MAX_WRITER_PICTURE_BYTES) throw fileTooLarge(MAX_WRITER_PICTURE_BYTES);
  return inLine(documentId, async () => {
    const { node } = await loadDocument(deps, userId, documentId, 'edit');
    const version = await currentVersion(deps, node);
    const file = await openFile(deps, node, version);
    if (!(file instanceof OdtDocument)) throw badRequest('In Markdown gehen hier keine Bilder.');
    const path = await file.addPicture(bytes, mimeType);
    const next = await file.toBytes();
    await storeUpload(
      deps,
      userId,
      node.workspaceId,
      { name: node.name, nodeId: node.id, ifVersion: version.id },
      { data: once(next), size: next.byteLength, mimeType: WRITER_MIME },
    );
    return { path };
  });
}

/**
 * `GET /documents/:id/stock/photos` – the workspace's photo service searched (Unsplash, Pexels), as
 * for a slide's picture; without a query, photos at random. For who may edit the document.
 */
export async function searchDocumentPhotos(
  deps: AppDeps,
  userId: string,
  documentId: string,
  query: string,
  orientation: StockOrientation | undefined,
): Promise<StockPhoto[]> {
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  // Nothing typed in a workspace without a photo source: nothing to show, no error.
  if (!query.trim() && !(await photoSource(deps, node.workspaceId))) return [];
  const photos = query.trim()
    ? await searchPhotos(deps, node.workspaceId, query, { orientation })
    : await randomPhotos(deps, node.workspaceId, { orientation });
  return photos.map(toStockPhoto);
}

/**
 * `POST /documents/:id/stock/photos/:photoId`: a photo picked – put into the file as an uploaded
 * picture is ({@link addDocumentPicture}), Unsplash hears; answers its path and size for the
 * `insertPicture` step.
 */
export async function pickDocumentPhoto(
  deps: AppDeps,
  userId: string,
  documentId: string,
  photoId: string,
): Promise<{ path: string; width: number; height: number; credit: ImageCredit }> {
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  const photo = await findPhoto(deps, node.workspaceId, photoId);
  const bytes = await photoBytes(deps, photo, null);
  const type = imageMediaType(bytes);
  const size = imageSize(bytes);
  if (!type || !size) throw badRequest('Das Foto ließ sich nicht lesen.');
  const { path } = await addDocumentPicture(deps, userId, documentId, type, bytes);
  // Unsplash hears meanwhile: the picture never waits for it (a failure costs only the count).
  void trackPhoto(deps, node.workspaceId, photo);
  // Its credit goes into the file with it (`svg:desc`), as on a slide.
  return { path, ...size, credit: photo.credit };
}

/**
 * `GET /documents/:id/tools`: which of the workspace's services the picture panel offers, as a
 * slide's edit state says (`stockPhotos`, `imageGeneration`) – for who may edit.
 */
export async function documentTools(
  deps: AppDeps,
  userId: string,
  documentId: string,
): Promise<WriterTools> {
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  const [photos, images] = await Promise.all([
    photoSource(deps, node.workspaceId),
    workspaceImageConnection(deps, node.workspaceId),
  ]);
  return {
    stockPhotos: photos !== null,
    photoSource: photos?.provider ?? null,
    imageGeneration: images.connection !== null,
    imageReferences: !!images.connection && takesImageReferences(images.connection),
  };
}

/**
 * `POST /documents/:id/pictures/generate`: a picture of `prompt` made with the workspace's key for
 * pictures (Integrationen → Bildgenerierung), as for a slide's picture – put into the file as an
 * uploaded one; its path and size for the `insertPicture` step.
 */
export async function generateDocumentPicture(
  deps: AppDeps,
  userId: string,
  documentId: string,
  prompt: string,
  aspect: number | null,
  /** Pictures up already that it goes after (`withReferences`). */
  references?: readonly string[],
): Promise<{ path: string; width: number; height: number }> {
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  const bytes = await withReferences(deps, userId, node.workspaceId, references, (given) =>
    generatePicture(
      deps,
      { id: node.id, workspaceId: node.workspaceId },
      prompt,
      aspect,
      'image',
      given,
    ),
  );
  const type = imageMediaType(bytes);
  const size = imageSize(bytes);
  if (!type || !size) throw badRequest('Der Dienst hat kein lesbares Bild geschickt.');
  const { path } = await addDocumentPicture(deps, userId, documentId, type, bytes);
  return { path, ...size };
}

// ── Comments ────────────────────────────────────────────────────────────────

async function toComments(
  deps: DocumentDeps,
  rows: readonly DocumentCommentRow[],
): Promise<WriterComment[]> {
  const [authors, reactions] = await Promise.all([
    authorsOf(
      deps.db,
      rows.flatMap((row) => [row.authorId, row.resolvedBy]),
    ),
    reactionsOf(
      deps,
      rows.map((row) => row.id),
    ),
  ]);
  return rows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    parentId: row.parentId,
    author: authorIn(authors, row.authorId),
    body: row.body,
    attachments: row.attachments,
    anchor: row.anchor,
    status: row.status,
    resolvedBy: row.resolvedBy ? authorIn(authors, row.resolvedBy) : null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(reactions.has(row.id) && { reactions: reactions.get(row.id) }),
  }));
}

/** The reactions to the given comments, by comment, oldest first – as a slide's. */
async function reactionsOf(
  deps: DocumentDeps,
  commentIds: readonly string[],
): Promise<Map<string, CommentReaction[]>> {
  const byComment = new Map<string, CommentReaction[]>();
  if (commentIds.length === 0) return byComment;
  const rows = await deps.db
    .select()
    .from(documentCommentReactions)
    .where(inArray(documentCommentReactions.commentId, [...commentIds]))
    .orderBy(asc(documentCommentReactions.createdAt), asc(documentCommentReactions.userId));
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push({ kind: row.kind, author: displayAuthor(row.author) });
    byComment.set(row.commentId, list);
  }
  return byComment;
}

/**
 * `PUT /document-comments/:id/reaction`: one's own reaction (👍 / 👎 / egal) or, with `null`, it
 * taken back – for who may comment, as on a slide.
 */
export async function setDocumentCommentReaction(
  deps: DocumentDeps,
  live: DocumentLive,
  author: Author,
  commentId: string,
  kind: CommentReactionKind | null,
): Promise<WriterComment> {
  const { comment, loaded } = await loadComment(deps, author.id, commentId);
  mayComment(loaded);
  const own = and(
    eq(documentCommentReactions.commentId, comment.id),
    eq(documentCommentReactions.userId, author.id),
  );
  if (kind === null) await deps.db.delete(documentCommentReactions).where(own);
  else {
    const now = deps.clock.now();
    await deps.db
      .insert(documentCommentReactions)
      .values({ commentId: comment.id, userId: author.id, author, kind, createdAt: now })
      .onConflictDoUpdate({
        target: [documentCommentReactions.commentId, documentCommentReactions.userId],
        set: { kind, author, createdAt: now },
      });
  }
  live.publish(comment.documentId, { type: 'comments' });
  const [dto] = await toComments(deps, [comment]);
  if (!dto) throw new Error('A comment has no DTO');
  return dto;
}

export async function listDocumentComments(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
): Promise<WriterComment[]> {
  const { node } = await loadDocument(deps, userId, documentId);
  const rows = await deps.db
    .select()
    .from(documentComments)
    .where(eq(documentComments.documentId, node.id))
    .orderBy(asc(documentComments.createdAt));
  return toComments(deps, rows);
}

/**
 * What a person may do on the document's board „Material“ (`board-owner.ts`) – as with its
 * comments: who may open it sees the board, Prüfende and up put things down and ask the AI, who
 * manages the file deletes anyone's. Throws 404 when the document is not theirs to see.
 */
export async function documentBoardRights(
  deps: DocumentDeps,
  userId: string,
  documentId: string,
): Promise<{ workspaceId: string; title: string; canComment: boolean; canManage: boolean }> {
  const loaded = await loadDocument(deps, userId, documentId);
  return {
    workspaceId: loaded.ctx.workspaceId,
    title: titleOf(loaded.node.name),
    canComment: atLeast(loaded.ctx.role, 'reviewer'),
    canManage: loaded.access === 'manage',
  };
}

const mayComment = (loaded: LoadedNode) => {
  if (!atLeast(loaded.ctx.role, 'reviewer')) {
    throw forbidden('Kommentieren können hier Prüfende, Mitglieder und Admins.');
  }
};

export async function createDocumentComment(
  deps: DocumentDeps,
  live: DocumentLive,
  userId: string,
  documentId: string,
  input: CreateWriterCommentInput,
): Promise<WriterComment> {
  const loaded = await loadDocument(deps, userId, documentId);
  mayComment(loaded);
  const [existing] = await deps.db
    .select()
    .from(documentComments)
    .where(eq(documentComments.id, input.id));
  if (existing) {
    // Sent twice (its answer was lost): the one that is there.
    if (existing.documentId !== loaded.node.id || existing.authorId !== userId) {
      throw badRequest('Diesen Kommentar gibt es schon.');
    }
    const [dto] = await toComments(deps, [existing]);
    if (!dto) throw new Error('A comment has no DTO');
    return dto;
  }
  if (input.parentId) {
    const [parent] = await deps.db
      .select()
      .from(documentComments)
      .where(eq(documentComments.id, input.parentId));
    if (!parent || parent.documentId !== loaded.node.id || parent.parentId) {
      throw notFound('Den Kommentar, auf den du antwortest, gibt es nicht mehr.');
    }
  } else if (!input.anchor) {
    throw badRequest('Ein Kommentar steht an einer Stelle im Text.');
  }
  if (!input.body && !input.attachments?.length) throw badRequest('Schreib etwas.');
  const now = deps.clock.now();
  const files = await claimAttachments(
    deps.db,
    now,
    userId,
    loaded.node.workspaceId,
    input.attachments ?? [],
  );
  const [row] = await deps.db
    .insert(documentComments)
    .values({
      attachments: files,
      id: input.id,
      documentId: loaded.node.id,
      parentId: input.parentId,
      authorId: userId,
      body: input.body,
      anchor: input.parentId ? null : input.anchor,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Comment insert returned nothing');
  live.publish(loaded.node.id, { type: 'comments' });
  const [dto] = await toComments(deps, [row]);
  if (!dto) throw new Error('A comment has no DTO');
  return dto;
}

async function loadComment(deps: DocumentDeps, userId: string, commentId: string) {
  const [comment] = await deps.db
    .select()
    .from(documentComments)
    .where(eq(documentComments.id, commentId));
  if (!comment) throw notFound('Diesen Kommentar gibt es nicht (mehr).');
  const loaded = await loadDocument(deps, userId, comment.documentId);
  return { comment, loaded };
}

export async function updateDocumentComment(
  deps: DocumentDeps,
  live: DocumentLive,
  userId: string,
  commentId: string,
  input: UpdateWriterCommentInput,
): Promise<WriterComment> {
  const { comment, loaded } = await loadComment(deps, userId, commentId);
  mayComment(loaded);
  const now = deps.clock.now();
  const set: Partial<typeof documentComments.$inferInsert> = { updatedAt: now };
  if (input.body !== undefined && input.body !== comment.body) {
    if (comment.authorId !== userId)
      throw forbidden('Ändern kann einen Kommentar, wer ihn schrieb.');
    set.body = input.body;
  }
  if (input.status !== undefined && input.status !== comment.status) {
    if (comment.parentId) throw badRequest('Erledigt wird der Kommentar, nicht seine Antwort.');
    set.status = input.status;
    set.resolvedBy = input.status === 'done' ? userId : null;
    set.resolvedAt = input.status === 'done' ? now : null;
  }
  const [row] = await deps.db
    .update(documentComments)
    .set(set)
    .where(eq(documentComments.id, comment.id))
    .returning();
  if (!row) throw new Error('Comment update returned nothing');
  live.publish(comment.documentId, { type: 'comments' });
  const [dto] = await toComments(deps, [row]);
  if (!dto) throw new Error('A comment has no DTO');
  return dto;
}

export async function deleteDocumentComment(
  deps: DocumentDeps,
  live: DocumentLive,
  userId: string,
  commentId: string,
): Promise<void> {
  const [comment] = await deps.db
    .select()
    .from(documentComments)
    .where(eq(documentComments.id, commentId));
  // Deleted already (sent twice): done.
  if (!comment) return;
  const loaded = await loadDocument(deps, userId, comment.documentId);
  if (comment.authorId !== userId && !cloudAccessAtLeast(loaded.access, 'manage')) {
    throw forbidden('Löschen kann einen Kommentar, wer ihn schrieb.');
  }
  // Its files go with it – and its replies' (they go with a thread's first comment).
  const gone = await deps.db
    .delete(documentComments)
    .where(or(eq(documentComments.id, comment.id), eq(documentComments.parentId, comment.id)))
    .returning({ attachments: documentComments.attachments });
  await deleteAttachments(
    deps,
    gone.flatMap((each) => each.attachments),
  );
  live.publish(comment.documentId, { type: 'comments' });
}
