import {
  isTextStroke,
  moveDrawing,
  type Author,
  type Comment,
  type CreateCommentInput,
  type UpdateCommentInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { confirmComment, keepPending, pendingReply } from './comment-cache';
import { queryKeys } from './keys';

/**
 * Comments of a deck. Changes by others arrive live (BER-104, the viewer's live stream refetches);
 * `live` says the stream is up – polling is then only a slow safety net.
 */
export function useComments(deckId: string, enabled = true, live = false) {
  const queryClient = useQueryClient();
  const key = queryKeys.comments(deckId);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const fresh = await api.get<Comment[]>(`/decks/${deckId}/comments`);
      // Replies posted while this was loading: keep their placeholders (`useCreateReply`).
      return keepPending(queryClient.getQueryData<Comment[]>(key), fresh);
    },
    enabled,
    refetchInterval: live ? 120_000 : 15_000,
  });
}

/**
 * After a comment action: the comments and the deck (its count and participants). Not the slide
 * list – every slide's shapes – just for its per-slide open counts: the viewer counts those from
 * the comments (`openCountBySlide`).
 */
export function useInvalidateDeckFeedback(deckId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true }),
    ]);
}

export function useCreateComment(deckId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api.post<Comment>(`/decks/${deckId}/comments`, input),
    onSuccess: (comment) => {
      // The live stream's refetch may have brought it in already.
      queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) => [
        ...current.filter((existing) => existing.id !== comment.id),
        comment,
      ]);
      void invalidate();
    },
  });
}

/**
 * Posts a reply with an optimistic placeholder, so it shows in the thread immediately. Errors
 * remove only the placeholder (polling may have changed the list meanwhile).
 */
export function useCreateReply(deckId: string, author: Author) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  const key = queryKeys.comments(deckId);
  const drop = (id: string) =>
    queryClient.setQueryData<Comment[]>(key, (current = []) =>
      current.filter((comment) => comment.id !== id),
    );
  return useMutation({
    mutationFn: ({ input }: { input: CreateCommentInput; root: Comment }) =>
      api.post<Comment>(`/decks/${deckId}/comments`, input),
    onMutate: async ({ input, root }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const pending = pendingReply(input, root, author);
      queryClient.setQueryData<Comment[]>(key, (current = []) => [...current, pending]);
      return { tempId: pending.id };
    },
    onSuccess: (saved, _variables, context) => {
      queryClient.setQueryData<Comment[]>(key, (current = []) =>
        confirmComment(current, context.tempId, saved),
      );
    },
    onError: (_error, _variables, context) => {
      if (context) drop(context.tempId);
    },
    onSettled: invalidate,
  });
}

/** The comment as the server will return it after `input` (mirrors `updateComment`). */
function withUpdate(
  comment: Comment,
  { textBox, anchor: box, move, removeMarks, ...input }: UpdateCommentInput,
): Comment {
  if (move) return { ...moveDrawing(comment, move.dx, move.dy), ...input };
  const current = comment.anchor;
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

export function useUpdateComment(deckId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  return useMutation({
    mutationFn: ({ commentId, ...input }: UpdateCommentInput & { commentId: string }) =>
      api.patch<Comment>(`/comments/${commentId}`, input),
    // Optimistic: status toggles must feel instant.
    onMutate: async ({ commentId, ...input }) => {
      const key = queryKeys.comments(deckId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient
        .getQueryData<Comment[]>(key)
        ?.find((comment) => comment.id === commentId);
      queryClient.setQueryData<Comment[]>(key, (current = []) =>
        current.map((comment) => (comment.id === commentId ? withUpdate(comment, input) : comment)),
      );
      return { previous };
    },
    // Roll back only this comment: other optimistic updates running meanwhile stay.
    onError: (_error, { commentId }, context) => {
      const previous = context?.previous;
      if (!previous) return;
      queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) =>
        current.map((comment) => (comment.id === commentId ? previous : comment)),
      );
    },
    onSettled: invalidate,
  });
}

/** Deletes a drawing the eraser touched: it leaves the slide at once, and comes back on errors. */
export function useEraseDrawing(deckId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  const key = queryKeys.comments(deckId);
  return useMutation({
    mutationFn: (commentId: string) => api.delete(`/comments/${commentId}`),
    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient
        .getQueryData<Comment[]>(key)
        ?.find((comment) => comment.id === commentId);
      queryClient.setQueryData<Comment[]>(key, (current = []) =>
        current.filter((comment) => comment.id !== commentId),
      );
      return { previous };
    },
    onError: (_error, _commentId, context) => {
      const previous = context?.previous;
      if (previous)
        queryClient.setQueryData<Comment[]>(key, (current = []) => [...current, previous]);
    },
    onSettled: invalidate,
  });
}

export function useDeleteComment(deckId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateDeckFeedback(deckId);
  return useMutation({
    /** `keepDrawing`: only the comment goes, its drawing / text on the slide stays. */
    mutationFn: ({
      commentId,
      keepDrawing = false,
    }: {
      commentId: string;
      keepDrawing?: boolean;
    }) => api.delete(`/comments/${commentId}${keepDrawing ? '?keep=drawing' : ''}`),
    onSuccess: async () => {
      // Deleting a voice or video comment (or a thread with some) frees recording storage.
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.deck(deckId), 'media-usage'] });
      await invalidate();
    },
  });
}
