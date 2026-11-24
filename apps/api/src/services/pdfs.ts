import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  cloudAccessAtLeast,
  cloudExtension,
  cloudNameSchema,
  MAX_READER_FILE_BYTES,
  MAX_READER_MARKS,
  MAX_READER_SIGNATURES,
  READER_EXTENSION,
  READER_MIME,
  readerFieldMarkId,
  type Author,
  type CloudAccess,
  type CloudNode,
  type CreateReaderCommentInput,
  type CreateReaderSignatureInput,
  type ReaderComment,
  type ReaderEvent,
  type ReaderMark,
  type ReaderMarkBody,
  type ReaderOpened,
  type ReaderPdf,
  type ReaderSignature,
  type UpdateReaderCommentInput,
} from '@slider/shared';
import {
  cloudNodes,
  cloudVersions,
  pdfComments,
  pdfMarks,
  readerSignatures,
  type CloudNodeRow,
  type CloudVersionRow,
  type PdfCommentRow,
  type PdfMarkRow,
} from '../db/schema';
import { ApiError, badRequest, fileTooLarge, forbidden, notFound } from '../http/errors';
import { claimAttachments, deleteAttachments } from './attachments';
import { isDeckKey } from './cloud/blobs';
import {
  authorIn,
  authorsOf,
  baseAccess,
  cloudContext,
  looksOnly,
  listNodes,
  loadNode,
  nodeDto,
  reachable,
  storeUpload,
  toNodeDtos,
  touchRecent,
  type CloudCtx,
  type CloudDeps,
  type LoadedNode,
} from './cloud';
import { bakePdf } from './pdf-bake';
import { atLeast } from './workspaces/roles';

/*
 * Reader's PDFs. A PDF is a file lying in Cloud: where it lies, who may open it, its versions and
 * its trash are Cloud's (`services/cloud`). It is never written while open: what is filled in
 * (`pdf_marks`) and said about it (`pdf_comments`) lies beside it, heard live by whoever has it
 * open, and is baked into a copy for printing and exporting (`pdf-bake.ts`).
 */

export type PdfDeps = CloudDeps;

const pdfNotFound = () => notFound('Dieses PDF gibt es nicht (mehr).');

// ── Who has it open ─────────────────────────────────────────────────────────

interface Listener {
  author: Author;
  send: (event: ReaderEvent) => void;
}

/** The open PDFs of this server and who listens to each. */
export class PdfLive {
  private readonly rooms = new Map<string, Set<Listener>>();

  join(pdfId: string, author: Author, send: Listener['send']): () => void {
    const listener = { author, send };
    const room = this.rooms.get(pdfId) ?? new Set<Listener>();
    this.rooms.set(pdfId, room);
    room.add(listener);
    this.people(pdfId);
    return () => {
      room.delete(listener);
      if (room.size === 0) this.rooms.delete(pdfId);
      else this.people(pdfId);
    };
  }

  publish(pdfId: string, event: ReaderEvent): void {
    for (const listener of this.rooms.get(pdfId) ?? []) {
      try {
        listener.send(event);
      } catch {
        // A stream that is gone leaves by itself.
      }
    }
  }

  private people(pdfId: string): void {
    const seen = new Map<string, Author>();
    for (const listener of this.rooms.get(pdfId) ?? []) {
      seen.set(listener.author.id, listener.author);
    }
    this.publish(pdfId, { type: 'people', people: [...seen.values()] });
  }
}

// ── Reading ─────────────────────────────────────────────────────────────────

const isPdf = (node: Pick<CloudNodeRow, 'kind' | 'extension'>) =>
  node.kind === 'file' && node.extension === READER_EXTENSION;

const titleOf = (name: string) => name.replace(/\.pdf$/i, '');

async function loadPdf(
  deps: PdfDeps,
  userId: string,
  pdfId: string,
  min: CloudAccess = 'view',
): Promise<LoadedNode> {
  const loaded = await loadNode(deps, userId, pdfId, min).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) throw pdfNotFound();
    throw error;
  });
  if (!isPdf(loaded.node)) throw pdfNotFound();
  return loaded;
}

const placeOf = (node: CloudNode): string => {
  const location = node.location;
  if (!location) return '';
  return [location.areaName ?? 'Meine Dateien', ...location.folders.map((folder) => folder.name)]
    .filter(Boolean)
    .join(' / ');
};

interface Counts {
  open: number;
  all: number;
  filled: number;
}

async function countsOf(deps: PdfDeps, ids: readonly string[]): Promise<Map<string, Counts>> {
  const counts = new Map<string, Counts>();
  const of = (id: string) => {
    const count = counts.get(id) ?? { open: 0, all: 0, filled: 0 };
    counts.set(id, count);
    return count;
  };
  for (let at = 0; at < ids.length; at += 500) {
    const part = ids.slice(at, at + 500);
    const rows = await deps.db
      .select({
        pdfId: pdfComments.pdfId,
        parentId: pdfComments.parentId,
        status: pdfComments.status,
      })
      .from(pdfComments)
      .where(inArray(pdfComments.pdfId, part));
    for (const row of rows) {
      const count = of(row.pdfId);
      count.all += 1;
      // A thread is open or done; its answers follow it.
      if (!row.parentId && row.status === 'open') count.open += 1;
    }
    const marks = await deps.db
      .select({ pdfId: pdfMarks.pdfId, count: sql<number>`count(*)::int` })
      .from(pdfMarks)
      .where(inArray(pdfMarks.pdfId, part))
      .groupBy(pdfMarks.pdfId);
    for (const row of marks) of(row.pdfId).filled = Number(row.count);
  }
  return counts;
}

function toPdf(ctx: CloudCtx, node: CloudNode, counts: ReadonlyMap<string, Counts>): ReaderPdf {
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
    filled: count?.filled ?? 0,
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

async function pdfDto(
  deps: PdfDeps,
  ctx: CloudCtx,
  row: CloudNodeRow,
  access?: CloudAccess,
): Promise<ReaderPdf> {
  const [withPlace] = await toNodeDtos(deps, ctx, [row], {
    access: () => access ?? 'view',
    location: true,
    trashed: Boolean(row.deletedAt),
  });
  const node = withPlace ?? (await nodeDto(deps, ctx, row, access));
  return toPdf(ctx, node, await countsOf(deps, [row.id]));
}

/** The workspace's PDFs the caller reaches, the last changed first – or those deleted. */
export async function listPdfs(
  deps: PdfDeps,
  userId: string,
  workspaceId: string,
  scope: 'all' | 'trash',
): Promise<ReaderPdf[]> {
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  let nodes: CloudNode[];
  const pdfFile = (node: CloudNode) =>
    node.kind === 'file' && cloudExtension(node.name) === READER_EXTENSION;
  if (scope === 'trash') {
    const { nodes: trashed } = await listNodes(deps, userId, workspaceId, { scope: 'trash' });
    nodes = trashed.filter(pdfFile);
  } else {
    const rows = await deps.db
      .select()
      .from(cloudNodes)
      .where(
        and(
          reachable(ctx),
          eq(cloudNodes.kind, 'file'),
          eq(cloudNodes.extension, READER_EXTENSION),
        ),
      );
    const own = await toNodeDtos(deps, ctx, rows, {
      access: (row) => baseAccess(ctx, row) ?? 'view',
      location: true,
    });
    const have = new Set(own.map((node) => node.id));
    const { nodes: shared } = await listNodes(deps, userId, workspaceId, { scope: 'shared' });
    nodes = [...own, ...shared.filter((node) => pdfFile(node) && !have.has(node.id))];
  }
  const counts = await countsOf(
    deps,
    nodes.map((node) => node.id),
  );
  return nodes
    .map((node) => toPdf(ctx, node, counts))
    .sort((a, b) =>
      scope === 'trash'
        ? (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')
        : b.updatedAt.localeCompare(a.updatedAt),
    );
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/** A PDF's bytes start with `%PDF-` – within its first KB, as readers allow. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/**
 * A PDF brought to Reader: it lies in its bringer's own files („Meine Dateien“), as new
 * presentations and documents do – or in the folder or area it was brought into.
 */
export async function importPdf(
  deps: PdfDeps,
  userId: string,
  workspaceId: string,
  fileName: string,
  bytes: Uint8Array,
  place: { parentId?: string; areaId?: string } = {},
): Promise<ReaderPdf> {
  if (cloudExtension(fileName) !== READER_EXTENSION || !looksLikePdf(bytes)) {
    throw badRequest('Diese Datei ist kein PDF.');
  }
  if (bytes.byteLength > MAX_READER_FILE_BYTES) throw fileTooLarge(MAX_READER_FILE_BYTES);
  const ctx = await cloudContext(deps.db, workspaceId, userId);
  if (!place.parentId && !place.areaId && looksOnly(ctx.role)) {
    throw forbidden('PDFs legen hier Mitglieder und Admins des Workspace ab.');
  }
  const result = await storeUpload(
    deps,
    userId,
    workspaceId,
    { name: cloudNameSchema.parse(fileName), keepBoth: true, ...place },
    { data: once(bytes), size: bytes.byteLength, mimeType: READER_MIME },
  );
  const [row] = await deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, result.node.id));
  if (!row) throw pdfNotFound();
  return pdfDto(deps, ctx, row, result.node.access);
}

async function marksOf(deps: PdfDeps, pdfId: string): Promise<ReaderMark[]> {
  const rows = await deps.db
    .select()
    .from(pdfMarks)
    .where(eq(pdfMarks.pdfId, pdfId))
    .orderBy(asc(pdfMarks.updatedAt));
  return toMarks(deps, rows);
}

async function toMarks(deps: PdfDeps, rows: readonly PdfMarkRow[]): Promise<ReaderMark[]> {
  const authors = await authorsOf(
    deps.db,
    rows.map((row) => row.authorId),
  );
  return rows.map(
    (row) =>
      ({
        ...row.body,
        id: row.id,
        author: row.authorId ? authorIn(authors, row.authorId) : null,
        updatedAt: row.updatedAt.toISOString(),
      }) as ReaderMark,
  );
}

export async function openPdf(deps: PdfDeps, userId: string, pdfId: string): Promise<ReaderOpened> {
  const { node, ctx, access } = await loadPdf(deps, userId, pdfId);
  await touchRecent(deps.db, userId, node.id, deps.clock.now());
  return { pdf: await pdfDto(deps, ctx, node, access), marks: await marksOf(deps, node.id) };
}

export async function pdfOf(deps: PdfDeps, userId: string, pdfId: string): Promise<ReaderPdf> {
  const { node, ctx, access } = await loadPdf(deps, userId, pdfId);
  return pdfDto(deps, ctx, node, access);
}

async function currentVersion(deps: PdfDeps, node: CloudNodeRow): Promise<CloudVersionRow> {
  const [version] = node.currentVersionId
    ? await deps.db.select().from(cloudVersions).where(eq(cloudVersions.id, node.currentVersionId))
    : [];
  if (!version || isDeckKey(version.storageKey)) throw pdfNotFound();
  if (version.sizeBytes > MAX_READER_FILE_BYTES) {
    throw badRequest('Dieses PDF ist zu groß, um es hier zu öffnen.');
  }
  return version;
}

/** The file as it lies in Cloud, for the browser to draw. */
export async function pdfFile(
  deps: PdfDeps,
  userId: string,
  pdfId: string,
): Promise<{ bytes: Uint8Array; name: string; versionId: string }> {
  const { node } = await loadPdf(deps, userId, pdfId);
  const version = await currentVersion(deps, node);
  const bytes = await deps.storage.get(version.storageKey);
  if (!bytes) throw pdfNotFound();
  return { bytes, name: node.name, versionId: version.id };
}

/** The file with everything filled in baked into it: what is printed and exported. */
export async function exportPdf(
  deps: PdfDeps,
  userId: string,
  pdfId: string,
): Promise<{ bytes: Uint8Array; name: string }> {
  const file = await pdfFile(deps, userId, pdfId);
  const marks = await marksOf(deps, pdfId);
  if (marks.length === 0) return file;
  return { bytes: await bakePdf(file.bytes, marks), name: file.name };
}

// ── Filling in ──────────────────────────────────────────────────────────────

const mayFill = (loaded: LoadedNode) => {
  if (!cloudAccessAtLeast(loaded.access, 'edit') || loaded.node.deletedAt) {
    throw forbidden('Ausfüllen und unterschreiben kann, wer diese Datei ändern darf.');
  }
};

/** Writes one mark as it is now; heard by everyone who has the PDF open. */
export async function setPdfMark(
  deps: PdfDeps,
  live: PdfLive,
  userId: string,
  pdfId: string,
  markId: string,
  body: ReaderMarkBody,
): Promise<ReaderMark> {
  const loaded = await loadPdf(deps, userId, pdfId);
  mayFill(loaded);
  const mark = await writeMark(deps, loaded.node.id, userId, markId, body);
  live.publish(loaded.node.id, { type: 'mark', mark });
  return mark;
}

/** The mark written; for the AI too, which checks rights itself. */
export async function writeMark(
  deps: PdfDeps,
  pdfId: string,
  userId: string | null,
  markId: string,
  body: ReaderMarkBody,
): Promise<ReaderMark> {
  if (
    body.kind === 'field' ? markId !== readerFieldMarkId(body.name) : markId.startsWith('field:')
  ) {
    throw badRequest('Ein Formularfeld trägt seinen Namen, alles andere nicht.');
  }
  const now = deps.clock.now();
  const row = await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: pdfMarks.id })
      .from(pdfMarks)
      .where(and(eq(pdfMarks.pdfId, pdfId), eq(pdfMarks.id, markId)));
    if (!existing) {
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(pdfMarks)
        .where(eq(pdfMarks.pdfId, pdfId));
      if (Number(count) >= MAX_READER_MARKS) {
        throw badRequest('Auf diesem PDF ist kein Platz für mehr.');
      }
    }
    const [written] = await tx
      .insert(pdfMarks)
      .values({ pdfId, id: markId, body, authorId: userId, updatedAt: now })
      .onConflictDoUpdate({
        target: [pdfMarks.pdfId, pdfMarks.id],
        set: { body, authorId: userId, updatedAt: now },
      })
      .returning();
    return written;
  });
  if (!row) throw new Error('Mark upsert returned nothing');
  const [mark] = await toMarks(deps, [row]);
  if (!mark) throw new Error('A mark has no DTO');
  return mark;
}

export async function removePdfMark(
  deps: PdfDeps,
  live: PdfLive,
  userId: string,
  pdfId: string,
  markId: string,
): Promise<void> {
  const loaded = await loadPdf(deps, userId, pdfId);
  mayFill(loaded);
  await dropMark(deps, loaded.node.id, markId);
  live.publish(loaded.node.id, { type: 'unmark', id: markId, authorId: userId });
}

export async function dropMark(deps: PdfDeps, pdfId: string, markId: string): Promise<void> {
  await deps.db.delete(pdfMarks).where(and(eq(pdfMarks.pdfId, pdfId), eq(pdfMarks.id, markId)));
}

export async function markBodies(
  deps: PdfDeps,
  pdfId: string,
): Promise<Map<string, ReaderMarkBody>> {
  const rows = await deps.db.select().from(pdfMarks).where(eq(pdfMarks.pdfId, pdfId));
  return new Map(rows.map((row) => [row.id, row.body]));
}

// ── Signatures one keeps ────────────────────────────────────────────────────

const toSignature = (row: typeof readerSignatures.$inferSelect): ReaderSignature => ({
  id: row.id,
  image: row.image,
  width: row.width,
  height: row.height,
  createdAt: row.createdAt.toISOString(),
});

export async function listSignatures(deps: PdfDeps, userId: string): Promise<ReaderSignature[]> {
  const rows = await deps.db
    .select()
    .from(readerSignatures)
    .where(eq(readerSignatures.userId, userId))
    .orderBy(asc(readerSignatures.createdAt));
  return rows.map(toSignature);
}

export async function createSignature(
  deps: PdfDeps,
  userId: string,
  input: CreateReaderSignatureInput,
): Promise<ReaderSignature> {
  const kept = await listSignatures(deps, userId);
  // The oldest goes once there are as many as one keeps.
  const over = kept.slice(0, Math.max(0, kept.length - MAX_READER_SIGNATURES + 1));
  if (over.length > 0) {
    await deps.db.delete(readerSignatures).where(
      inArray(
        readerSignatures.id,
        over.map((each) => each.id),
      ),
    );
  }
  const [row] = await deps.db
    .insert(readerSignatures)
    .values({
      id: crypto.randomUUID(),
      userId,
      image: input.image,
      width: input.width,
      height: input.height,
      createdAt: deps.clock.now(),
    })
    .returning();
  if (!row) throw new Error('Signature insert returned nothing');
  return toSignature(row);
}

export async function deleteSignature(
  deps: PdfDeps,
  userId: string,
  signatureId: string,
): Promise<void> {
  await deps.db
    .delete(readerSignatures)
    .where(and(eq(readerSignatures.id, signatureId), eq(readerSignatures.userId, userId)));
}

// ── Comments ────────────────────────────────────────────────────────────────

async function toComments(deps: PdfDeps, rows: readonly PdfCommentRow[]): Promise<ReaderComment[]> {
  const authors = await authorsOf(
    deps.db,
    rows.flatMap((row) => [row.authorId, row.resolvedBy]),
  );
  return rows.map((row) => ({
    id: row.id,
    pdfId: row.pdfId,
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
  }));
}

export async function listPdfComments(
  deps: PdfDeps,
  userId: string,
  pdfId: string,
): Promise<ReaderComment[]> {
  const { node } = await loadPdf(deps, userId, pdfId);
  const rows = await deps.db
    .select()
    .from(pdfComments)
    .where(eq(pdfComments.pdfId, node.id))
    .orderBy(asc(pdfComments.createdAt));
  return toComments(deps, rows);
}

const mayComment = (loaded: LoadedNode) => {
  if (!atLeast(loaded.ctx.role, 'reviewer') || loaded.node.deletedAt) {
    throw forbidden('Kommentieren können hier Prüfende, Mitglieder und Admins.');
  }
};

export async function createPdfComment(
  deps: PdfDeps,
  live: PdfLive,
  userId: string,
  pdfId: string,
  input: CreateReaderCommentInput,
): Promise<ReaderComment> {
  const loaded = await loadPdf(deps, userId, pdfId);
  mayComment(loaded);
  const [existing] = await deps.db.select().from(pdfComments).where(eq(pdfComments.id, input.id));
  if (existing) {
    // Sent twice (its answer was lost): the one that is there.
    if (existing.pdfId !== loaded.node.id || existing.authorId !== userId) {
      throw badRequest('Diesen Kommentar gibt es schon.');
    }
    const [dto] = await toComments(deps, [existing]);
    if (!dto) throw new Error('A comment has no DTO');
    return dto;
  }
  if (input.parentId) {
    const [parent] = await deps.db
      .select()
      .from(pdfComments)
      .where(eq(pdfComments.id, input.parentId));
    if (!parent || parent.pdfId !== loaded.node.id || parent.parentId) {
      throw notFound('Den Kommentar, auf den du antwortest, gibt es nicht mehr.');
    }
  } else if (!input.anchor) {
    throw badRequest('Ein Kommentar steht an einer Stelle des PDFs.');
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
    .insert(pdfComments)
    .values({
      attachments: files,
      id: input.id,
      pdfId: loaded.node.id,
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

export async function updatePdfComment(
  deps: PdfDeps,
  live: PdfLive,
  userId: string,
  commentId: string,
  input: UpdateReaderCommentInput,
): Promise<ReaderComment> {
  const [comment] = await deps.db.select().from(pdfComments).where(eq(pdfComments.id, commentId));
  if (!comment) throw notFound('Diesen Kommentar gibt es nicht (mehr).');
  const loaded = await loadPdf(deps, userId, comment.pdfId);
  mayComment(loaded);
  const now = deps.clock.now();
  const set: Partial<typeof pdfComments.$inferInsert> = { updatedAt: now };
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
    .update(pdfComments)
    .set(set)
    .where(eq(pdfComments.id, comment.id))
    .returning();
  if (!row) throw new Error('Comment update returned nothing');
  live.publish(comment.pdfId, { type: 'comments' });
  const [dto] = await toComments(deps, [row]);
  if (!dto) throw new Error('A comment has no DTO');
  return dto;
}

export async function deletePdfComment(
  deps: PdfDeps,
  live: PdfLive,
  userId: string,
  commentId: string,
): Promise<void> {
  const [comment] = await deps.db.select().from(pdfComments).where(eq(pdfComments.id, commentId));
  // Deleted already (sent twice): done.
  if (!comment) return;
  const loaded = await loadPdf(deps, userId, comment.pdfId);
  if (comment.authorId !== userId && !cloudAccessAtLeast(loaded.access, 'manage')) {
    throw forbidden('Löschen kann einen Kommentar, wer ihn schrieb.');
  }
  // Its files go with it – and its replies' (they go with a thread's first comment).
  const gone = await deps.db
    .delete(pdfComments)
    .where(or(eq(pdfComments.id, comment.id), eq(pdfComments.parentId, comment.id)))
    .returning({ attachments: pdfComments.attachments });
  await deleteAttachments(
    deps,
    gone.flatMap((each) => each.attachments),
  );
  live.publish(comment.pdfId, { type: 'comments' });
}
