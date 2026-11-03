import {
  isTextStroke,
  moveDrawing,
  type Author,
  type Comment,
  type CommentReactionKind,
  type CreateCommentInput,
  type UpdateCommentInput,
} from '@slider/shared';
import type { CommentAction } from './comment-outbox';

/*
 * The comments as shown: the server's list (the query cache) with what was done to them here and
 * is not taken by the server yet (`comment-outbox.ts`) laid over it – a new comment shown pending.
 */

/**
 * A comment's own id, made here (a UUID v4): it is known before the server has the comment, so
 * what is done to it meanwhile names it. Not `crypto.randomUUID()`: that only exists in secure
 * contexts, and comments must also work when the app is served over plain http (LAN, staging).
 */
export function newCommentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A new comment as the server will return it, until it does: shown pending meanwhile. */
export function pendingComment(
  input: CreateCommentInput & { id: string },
  deckId: string,
  author: Author,
  now = new Date(),
): Comment {
  const createdAt = now.toISOString();
  return {
    id: input.id,
    deckId,
    slideId: input.slideId,
    parentId: input.parentId ?? null,
    author,
    body: input.body.trim(),
    anchor: input.anchor,
    strokes: input.strokes ?? [],
    media: null,
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    source: 'app',
    createdAt,
    updatedAt: createdAt,
  };
}

/** The comment as the server will return it after `author` reacted with `kind` (`null`: took it back). */
export function withReaction(
  comment: Comment,
  author: Author,
  kind: CommentReactionKind | null,
): Comment {
  const others = (comment.reactions ?? []).filter((reaction) => reaction.author.id !== author.id);
  return { ...comment, reactions: kind ? [...others, { kind, author }] : others };
}

/** The comment as the server will return it after `input` (mirrors `updateComment`). */
export function withUpdate(
  comment: Comment,
  { textBox, anchor: box, move, removeMarks, addStrokes, ...input }: UpdateCommentInput,
): Comment {
  if (move) return { ...moveDrawing(comment, move.dx, move.dy), ...input };
  const current = comment.anchor;
  if (addStrokes && current.type === 'rect')
    return {
      ...comment,
      ...input,
      strokes: [...comment.strokes, ...addStrokes.strokes],
      anchor: { ...current, rect: addStrokes.rect },
    };
  if (removeMarks) {
    const { pin } = removeMarks;
    const anchor =
      pin && current.type === 'rect'
        ? { type: 'point' as const, point: pin, shapeRef: current.shapeRef }
        : current;
    return { ...comment, ...input, strokes: [], anchor };
  }
  // A box moved without resizing takes its drawing along (like the API).
  if (
    box &&
    current.type === 'rect' &&
    Math.abs(box.rect.w - current.rect.w) < 1e-6 &&
    Math.abs(box.rect.h - current.rect.h) < 1e-6
  ) {
    const { strokes } = moveDrawing(
      comment,
      box.rect.x - current.rect.x,
      box.rect.y - current.rect.y,
    );
    return { ...comment, ...input, anchor: box, strokes };
  }
  const next = { ...comment, ...input, ...(box ? { anchor: box } : {}) };
  const text = textBox && comment.strokes.find(isTextStroke);
  if (!textBox || !text) return next;
  const { anchor } = comment;
  const followsText =
    anchor.type === 'rect' &&
    (['x', 'y', 'w', 'h'] as const).every((key) => Math.abs(anchor.rect[key] - text[key]) < 1e-6);
  return {
    ...next,
    strokes: comment.strokes.map((stroke) => (stroke === text ? { ...text, ...textBox } : stroke)),
    anchor: followsText ? { ...anchor, rect: textBox } : anchor,
  };
}

/** The list after `action`, as the server will have it once it took it. */
export function withAction(comments: readonly Comment[], action: CommentAction): Comment[] {
  switch (action.type) {
    case 'create':
      // Taken already (its answer on the way, or a list fetched since): the server's one stays.
      return comments.some((comment) => comment.id === action.comment.id)
        ? [...comments]
        : [...comments, action.comment];
    case 'update':
      return comments.map((comment) =>
        comment.id === action.commentId ? withUpdate(comment, action.input) : comment,
      );
    case 'react':
      return comments.map((comment) =>
        comment.id === action.commentId
          ? withReaction(comment, action.author, action.kind)
          : comment,
      );
    case 'delete':
      // Replies go with their root; only its comment going, its drawing stays on the slide bare.
      return comments.flatMap((comment) => {
        if (comment.parentId === action.commentId) return [];
        if (comment.id !== action.commentId) return [comment];
        return action.keepDrawing
          ? [{ ...comment, body: '', media: null, images: [], status: 'open' as const }]
          : [];
      });
  }
}

/** The server's list with what is queued laid over it, in the order done (the same list if none). */
export function withQueued(comments: Comment[], actions: readonly CommentAction[]): Comment[] {
  return actions.reduce<Comment[]>((list, action) => withAction(list, action), comments);
}
