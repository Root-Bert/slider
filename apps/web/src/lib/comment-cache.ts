import type { Author, Comment, CreateCommentInput } from '@slider/shared';

/* Cache helpers for optimistic comment inserts (used by `useCreateReply`). */

const TEMP_PREFIX = 'temp-';
let tempCounter = 0;

/**
 * Local placeholder id. Not `crypto.randomUUID()`: that only exists in secure contexts, and
 * replies must also work when the app is served over plain http (LAN, staging).
 */
const tempId = () => `${TEMP_PREFIX}${Date.now().toString(36)}-${(tempCounter += 1)}`;

/** Replies shown before the server confirmed them have a temporary id (optimistic insert). */
export const isPendingComment = (comment: Pick<Comment, 'id'>) =>
  comment.id.startsWith(TEMP_PREFIX);

/** Placeholder for a reply that is still on its way to the server. */
export function pendingReply(
  input: CreateCommentInput,
  root: Pick<Comment, 'deckId'>,
  author: Author,
  now = new Date(),
): Comment {
  const createdAt = now.toISOString();
  return {
    id: tempId(),
    deckId: root.deckId,
    slideId: input.slideId,
    parentId: input.parentId ?? null,
    author,
    body: input.body,
    anchor: input.anchor,
    strokes: [],
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    source: 'app',
    createdAt,
    updatedAt: createdAt,
  };
}

/** Swaps the placeholder for the saved comment; appends it if a refetch already dropped it. */
export function confirmComment(
  comments: readonly Comment[],
  tempId: string,
  saved: Comment,
): Comment[] {
  const rest = comments.filter((comment) => comment.id !== saved.id);
  const index = rest.findIndex((comment) => comment.id === tempId);
  if (index === -1) return [...rest, saved];
  return rest.map((comment) => (comment.id === tempId ? saved : comment));
}
