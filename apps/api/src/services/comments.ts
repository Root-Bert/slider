import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { createCommentInputSchema } from '@slider/shared';
import {
  isDrawing,
  isTextStroke,
  moveDrawing,
  type Anchor,
  type Comment,
  type Point,
  type Rect,
  type UpdateCommentInput,
  type Viewer,
} from '@slider/shared';
import type { z } from 'zod';
import { deckAccess, requireDeckAccess } from '../auth/access';
import { displayAuthor } from '../authors';
import type { Executor } from '../db/client';
import {
  comments,
  deletedPptxComments,
  media as mediaRows,
  type CommentRow,
  type DeckRow,
} from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest, forbidden, notFound } from '../http/errors';
import { pptxTombstone } from '../import/pptx-comments';
import { touchDeck } from './decks';
import { assertWithinLimits } from './plans';
import {
  deleteMediaBlobs,
  mediaByComment,
  mediaKeysOfThread,
  type CommentAttachments,
} from './media';
import { isSlideInCurrentRevision } from './slides';

type CreateCommentData = z.output<typeof createCommentInputSchema>;

export function toCommentDto(
  row: CommentRow,
  { media, image }: CommentAttachments = { media: null, image: null },
): Comment {
  return {
    id: row.id,
    deckId: row.deckId,
    slideId: row.slideId,
    parentId: row.parentId,
    author: displayAuthor(row.author),
    body: row.body,
    anchor: row.anchor,
    strokes: row.strokes,
    media,
    image,
    status: row.status,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    source: row.source,
    sourceStatus: row.removedInSourceAt ? 'removed_in_pptx' : 'present',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Comment lists being loaded, per database and `deck:generation`. */
const loadingComments = new WeakMap<Executor, Map<string, Promise<Comment[]>>>();

/**
 * Roots and replies of a deck, oldest first; the client builds the threads. Every change makes
 * every open viewer refetch the whole list at once (live `comments` event): those requests share
 * one query – the list is the same for everyone who may see the deck. Only requests after the
 * same change share one (`LiveHub.commentsGeneration`), so nobody gets a list from before it.
 */
export async function listComments(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
): Promise<Comment[]> {
  await requireDeckAccess(deps, viewer, deckId, 'view');
  if (!deps.live) return loadComments(deps.db, deckId);
  let loading = loadingComments.get(deps.db);
  if (!loading) {
    loading = new Map();
    loadingComments.set(deps.db, loading);
  }
  const key = `${deckId}:${deps.live.commentsGeneration(deckId)}`;
  const running = loading.get(key);
  if (running) return running;
  const load = loadComments(deps.db, deckId).finally(() => loading.delete(key));
  loading.set(key, load);
  return load;
}

async function loadComments(db: Executor, deckId: string): Promise<Comment[]> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.deckId, deckId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return withMedia(db, rows);
}

/** DTOs with their recordings attached. */
export async function withMedia(db: Executor, rows: readonly CommentRow[]): Promise<Comment[]> {
  const media = await mediaByComment(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toCommentDto(row, media.get(row.id)));
}

export async function createComment(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: CreateCommentData,
): Promise<Comment> {
  const deck = await requireDeckAccess(deps, viewer, deckId, 'comment');
  // No new comments or replies while the organisation is over its plan's limits (BER-155).
  await assertWithinLimits(deps.db, deps.config, deck.workspaceId, deps.clock.now());
  const comment = toCommentDto(await insertComment(deps.db, deps, viewer, deck, input));
  deps.live?.commentsChanged(deck.id);
  return comment;
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
  await requireDeckAccess(deps, viewer, comment.deckId, 'comment');

  if (
    input.body !== undefined ||
    input.textBox !== undefined ||
    input.anchor !== undefined ||
    input.move !== undefined ||
    input.removeMarks !== undefined
  ) {
    if (comment.source === 'pptx')
      throw forbidden('Kommentare aus PowerPoint können nicht bearbeitet werden.');
    if (comment.source === 'gslides')
      throw forbidden('Kommentare aus Google Präsentationen können nicht bearbeitet werden.');
    if (comment.author.id !== viewer.author.id)
      throw forbidden('Nur die Autorin oder der Autor kann den Text ändern.');
  }
  const placement: Partial<Pick<CommentRow, 'strokes' | 'anchor'>> = input.textBox
    ? moveTextBox(comment, input.textBox)
    : input.anchor
      ? moveBox(comment, input.anchor)
      : input.move
        ? moveDrawingOf(comment, input.move)
        : input.removeMarks
          ? await removeMarks(deps.db, comment, input.removeMarks.pin)
          : {};
  // Without text, a drawing, recording or image must remain as the comment's content – as when
  // it was written.
  if (
    input.body === '' &&
    (placement.strokes ?? comment.strokes).length === 0 &&
    !(await hasAttachment(deps.db, comment.id))
  )
    throw badRequest('Ein Kommentar ohne Zeichnung, Aufnahme oder Bild braucht Text.');

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
      ...placement,
      ...statusChange,
      updatedAt: now,
    })
    .where(eq(comments.id, commentId))
    .returning();
  if (!row) throw notFound('Diesen Kommentar gibt es nicht (mehr).');
  await touchDeck(deps.db, comment.deckId, now);
  deps.live?.commentsChanged(comment.deckId);
  const [dto] = await withMedia(deps.db, [row]);
  return dto!;
}

/** Whether the comment has a recording or a drawn image (both are `media` rows). */
async function hasAttachment(db: Executor, commentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mediaRows.id })
    .from(mediaRows)
    .where(eq(mediaRows.commentId, commentId))
    .limit(1);
  return row !== undefined;
}

const sameRect = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 1e-6 &&
  Math.abs(a.y - b.y) < 1e-6 &&
  Math.abs(a.w - b.w) < 1e-6 &&
  Math.abs(a.h - b.h) < 1e-6;

/**
 * Moves / resizes the comment's text on the slide. A rect anchor that was the text box itself
 * (the usual case) follows it; an anchor of its own stays where it is.
 */
function moveTextBox(comment: CommentRow, box: Rect): Pick<CommentRow, 'strokes' | 'anchor'> {
  const text = comment.strokes.find(isTextStroke);
  if (!text) throw badRequest('Dieser Kommentar hat kein Textfeld auf der Folie.');
  const { anchor } = comment;
  const followsText = anchor.type === 'rect' && sameRect(anchor.rect, text);
  return {
    strokes: comment.strokes.map((stroke) => (stroke === text ? { ...text, ...box } : stroke)),
    anchor: followsText ? { ...anchor, rect: box } : anchor,
  };
}

/**
 * Moves / resizes the comment's own box; a box that is its text on the slide moves with it.
 * Moved without resizing, the drawing in it goes along.
 */
function moveBox(
  comment: CommentRow,
  anchor: Extract<Anchor, { type: 'rect' }>,
): Pick<CommentRow, 'anchor' | 'strokes'> {
  const current = comment.anchor;
  if (current.type !== 'rect') throw badRequest('Dieser Kommentar hat keine Box.');
  const text = comment.strokes.find(isTextStroke);
  if (text && sameRect(current.rect, text))
    throw badRequest('Diese Box ist das Textfeld – verschiebe das Textfeld.');
  const { rect } = anchor;
  const resized =
    Math.abs(rect.w - current.rect.w) > 1e-6 || Math.abs(rect.h - current.rect.h) > 1e-6;
  const strokes = resized
    ? comment.strokes
    : moveDrawing(
        { anchor: current, strokes: comment.strokes },
        rect.x - current.rect.x,
        rect.y - current.rect.y,
      ).strokes;
  return { anchor, strokes };
}

/** Moves a drawing – its strokes and its anchor – as a whole; or a pin to another place. */
function moveDrawingOf(
  comment: CommentRow,
  { dx, dy }: { dx: number; dy: number },
): Pick<CommentRow, 'anchor' | 'strokes'> {
  if (!isDrawing(comment) && comment.anchor.type !== 'point')
    throw badRequest('Dieser Kommentar lässt sich nicht verschieben.');
  const { anchor, strokes } = moveDrawing(comment, dx, dy);
  return { anchor, strokes };
}

/**
 * Takes the drawing / text off the slide, the comment stays. A box that was that drawing or text
 * becomes a pin at `pin`. Nothing left (no text, recording, image or reply): delete it instead.
 */
async function removeMarks(
  db: Executor,
  comment: CommentRow,
  pin: Point | null,
): Promise<Pick<CommentRow, 'anchor' | 'strokes'>> {
  if (comment.strokes.length === 0) throw badRequest('Dieser Kommentar hat nichts auf der Folie.');
  const { anchor } = comment;
  if (pin && anchor.type !== 'rect') throw badRequest('Dieser Kommentar hat keine Box.');
  if (comment.body.trim() === '') {
    const media = await hasAttachment(db, comment.id);
    const [reply] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.parentId, comment.id))
      .limit(1);
    if (!media && !reply)
      throw badRequest('Ohne Zeichnung bleibt von diesem Kommentar nichts – lösche ihn ganz.');
  }
  return {
    strokes: [],
    anchor:
      pin && anchor.type === 'rect'
        ? { type: 'point', point: pin, shapeRef: anchor.shapeRef }
        : anchor,
  };
}

/**
 * Authors delete their own comments; whoever manages the deck may delete any. Replies go with
 * their root. `keepDrawing` deletes only the comment of a root with something on the slide: its
 * replies, text, recording and image go, the drawing / text on the slide stays as a bare drawing.
 */
export async function deleteComment(
  deps: AppDeps,
  viewer: Viewer,
  commentId: string,
  { keepDrawing = false }: { keepDrawing?: boolean } = {},
): Promise<void> {
  const comment = await loadComment(deps, commentId);
  const { permissions } = await deckAccess(deps, viewer, comment.deckId, 'view');
  const own = comment.author.id === viewer.author.id;
  if (!permissions.canManage && !(own && permissions.canComment)) {
    throw forbidden('Nur eigene Kommentare können gelöscht werden.');
  }
  if (keepDrawing && (comment.parentId !== null || comment.strokes.length === 0))
    throw badRequest('Dieser Kommentar hat nichts auf der Folie, das stehen bleiben könnte.');
  const now = deps.clock.now();
  const replies = eq(comments.parentId, commentId);
  const deleted = keepDrawing ? replies : or(eq(comments.id, commentId), replies);
  const mediaKeys = await deps.db.transaction(async (tx) => {
    // The thread locked: no reply or recording joins it on the way out, its blobs are all known.
    await tx
      .select({ id: comments.id })
      .from(comments)
      .where(or(eq(comments.id, commentId), replies))
      .for('update');
    const keys = await mediaKeysOfThread(tx, commentId);
    // PowerPoint and Google comments in the thread stay deleted: the next import skips them.
    const fromPptx = await tx
      .select()
      .from(comments)
      .where(
        and(deleted, inArray(comments.source, ['pptx', 'gslides']), isNotNull(comments.externalId)),
      );
    if (fromPptx.length > 0) {
      await tx
        .insert(deletedPptxComments)
        .values(fromPptx.map((row) => pptxTombstone(comment.deckId, row, now)))
        .onConflictDoNothing();
    }
    if (keepDrawing) {
      await tx.delete(comments).where(replies);
      await tx.delete(mediaRows).where(eq(mediaRows.commentId, commentId));
      await tx
        .update(comments)
        .set({ body: '', status: 'open', resolvedBy: null, resolvedAt: null, updatedAt: now })
        .where(eq(comments.id, commentId));
    } else {
      await tx.delete(comments).where(eq(comments.id, commentId));
    }
    return keys;
  });
  await deleteMediaBlobs(deps, mediaKeys);
  await touchDeck(deps.db, comment.deckId, now);
  deps.live?.commentsChanged(comment.deckId);
}
