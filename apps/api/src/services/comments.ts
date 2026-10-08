import { and, asc, eq } from 'drizzle-orm';
import type { createCommentInputSchema } from '@slider/shared';
import {
  isTextStroke,
  type Comment,
  type CommentMedia,
  type UpdateCommentInput,
  type Viewer,
} from '@slider/shared';
import type { z } from 'zod';
import { deckAccess, requireDeckAccess } from '../auth/access';
import type { Executor } from '../db/client';
import { comments, type CommentRow, type DeckRow } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, forbidden, notFound } from '../http/errors';
import { touchDeck } from './decks';
import { deleteMediaBlobs, mediaByComment, mediaKeysOfThread } from './media';
import { isSlideInCurrentRevision } from './slides';

type CreateCommentData = z.output<typeof createCommentInputSchema>;

export function toCommentDto(row: CommentRow, media: CommentMedia | null = null): Comment {
  return {
    id: row.id,
    deckId: row.deckId,
    slideId: row.slideId,
    parentId: row.parentId,
    author: row.author,
    body: row.body,
    anchor: row.anchor,
    strokes: row.strokes,
    media,
    status: row.status,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    source: row.source,
    sourceStatus: row.removedInSourceAt ? 'removed_in_pptx' : 'present',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Roots and replies of a deck, oldest first; the client builds the threads. */
export async function listComments(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<Comment[]> {
  await requireDeckAccess(deps.db, viewer, deckId, 'view');
  const rows = await deps.db
    .select()
    .from(comments)
    .where(eq(comments.deckId, deckId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return withMedia(deps.db, rows);
}

/** DTOs with their recordings attached. */
export async function withMedia(db: Executor, rows: readonly CommentRow[]): Promise<Comment[]> {
  const media = await mediaByComment(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toCommentDto(row, media.get(row.id) ?? null));
}

export async function createComment(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: CreateCommentData,
): Promise<Comment> {
  const deck = await requireDeckAccess(deps.db, viewer, deckId, 'comment');
  return toCommentDto(await insertComment(deps.db, deps, viewer, deck, input));
}

/**
 * Validates and stores a comment. With `hasMedia` (voice/video comments, BER-116) the body and
 * strokes may both be empty – the recording is the content.
 */
export async function insertComment(
  db: Executor,
  deps: Pick<AppDeps, 'clock'>,
  viewer: Viewer,
  deck: DeckRow,
  input: CreateCommentData,
  { hasMedia = false }: { hasMedia?: boolean } = {},
): Promise<CommentRow> {
  const slideId = input.parentId
    ? await validateReply(db, deck, input)
    : await validateRoot(db, deck, input);
  // "Text auf Folie": the text lives in its stroke; the body is a separate, optional comment.
  validateTextAnnotation(input);
  if (!hasMedia && !input.body && input.strokes.length === 0) {
    throw badRequest('Ein Kommentar braucht Text oder eine Zeichnung.');
  }

  const now = deps.clock.now();
  const [row] = await db
    .insert(comments)
    .values({
      id: crypto.randomUUID(),
      deckId: deck.id,
      slideId,
      parentId: input.parentId,
      author: viewer.author,
      body: input.body,
      anchor: input.anchor,
      strokes: input.strokes,
      status: 'open',
      source: 'app',
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('Comment insert returned no row');
  await touchDeck(db, deck.id, now);
  return row;
}

/**
 * Text on the slide (`tool: 'text'`, shape checked by the schema): one box per comment, only on
 * root comments that sit on a slide.
 */
function validateTextAnnotation(input: CreateCommentData) {
  const texts = input.strokes.filter(isTextStroke);
  if (texts.length === 0) return;
  if (texts.length > 1)
    throw badRequest('Ein Kommentar kann nur ein Textfeld auf der Folie haben.');
  if (input.parentId) throw badRequest('Antworten können keinen Text auf die Folie schreiben.');
  if (input.anchor.type === 'gap')
    throw badRequest('Text auf der Folie braucht eine Folie, keine Lücke.');
}

/** Replies hang off a root comment of the same deck and inherit its slide. Returns the slide id. */
async function validateReply(
  db: Executor,
  deck: DeckRow,
  input: CreateCommentData,
): Promise<string | null> {
  const [parent] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, input.parentId ?? ''), eq(comments.deckId, deck.id)));
  if (!parent) throw badRequest('Der Kommentar, auf den du antwortest, existiert nicht.');
  if (parent.parentId) throw badRequest('Auf eine Antwort kann nicht geantwortet werden.');
  if (input.anchor.type !== 'slide') throw badRequest('Antworten haben keinen eigenen Ankerpunkt.');
  return parent.slideId;
}

/** Root comments sit on a slide of the current revision, or between two slides (gap). */
async function validateRoot(
  db: Executor,
  deck: DeckRow,
  input: CreateCommentData,
): Promise<string | null> {
  const { anchor } = input;
  if (anchor.type === 'gap') {
    if (input.slideId !== null)
      throw badRequest('Lücken-Kommentare gehören zu keiner Folie (slideId: null).');
    const { afterSlideId, beforeSlideId } = anchor;
    if (afterSlideId === null && beforeSlideId === null)
      throw badRequest('Die Lücke braucht eine Nachbarfolie.');
    for (const neighbour of [afterSlideId, beforeSlideId]) {
      if (neighbour && !(await isSlideInCurrentRevision(db, deck, neighbour))) {
        throw badRequest('Die Folie neben der Lücke gehört nicht zu dieser Präsentation.');
      }
    }
    return null;
  }
  if (!input.slideId) throw badRequest('slideId fehlt.');
  if (!(await isSlideInCurrentRevision(db, deck, input.slideId))) {
    throw badRequest('Die Folie gehört nicht zu dieser Präsentation.');
  }
  return input.slideId;
}

async function loadComment(deps: AppDeps, commentId: string): Promise<CommentRow> {
  const [row] = await deps.db.select().from(comments).where(eq(comments.id, commentId));
  if (!row) throw notFound('Diesen Kommentar gibt es nicht (mehr).');
  return row;
}

export async function updateComment(
  deps: AppDeps,
  viewer: Viewer,
  commentId: string,
  input: UpdateCommentInput,
): Promise<Comment> {
  const comment = await loadComment(deps, commentId);
  await requireDeckAccess(deps.db, viewer, comment.deckId, 'comment');

  if (input.body !== undefined) {
    if (comment.source === 'pptx')
      throw forbidden('Kommentare aus PowerPoint können nicht bearbeitet werden.');
    if (comment.author.id !== viewer.author.id)
      throw forbidden('Nur die Autorin oder der Autor kann den Text ändern.');
  }

  const now = deps.clock.now();
  const statusChange =
    input.status === undefined || input.status === comment.status
      ? {}
      : input.status === 'done'
        ? { status: 'done' as const, resolvedBy: viewer.author.id, resolvedAt: now }
        : { status: 'open' as const, resolvedBy: null, resolvedAt: null };

  const [row] = await deps.db
    .update(comments)
    .set({
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...statusChange,
      updatedAt: now,
    })
    .where(eq(comments.id, commentId))
    .returning();
  if (!row) throw notFound('Diesen Kommentar gibt es nicht (mehr).');
  await touchDeck(deps.db, comment.deckId, now);
  const [dto] = await withMedia(deps.db, [row]);
  return dto!;
}

/**
 * Authors delete their own comments; whoever manages the deck may delete any. Replies go with
 * their root.
 */
export async function deleteComment(
  deps: AppDeps,
  viewer: Viewer,
  commentId: string,
): Promise<void> {
  const comment = await loadComment(deps, commentId);
  const { permissions } = await deckAccess(deps.db, viewer, comment.deckId, 'view');
  const own = comment.author.id === viewer.author.id;
  if (!permissions.canManage && !(own && permissions.canComment)) {
    throw forbidden('Nur eigene Kommentare können gelöscht werden.');
  }
  const mediaKeys = await mediaKeysOfThread(deps.db, commentId);
  await deps.db.delete(comments).where(eq(comments.id, commentId));
  await deleteMediaBlobs(deps, mediaKeys);
  await touchDeck(deps.db, comment.deckId, deps.clock.now());
}
