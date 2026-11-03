import type {
  Author,
  Comment,
  CommentReactionKind,
  CreateCommentInput,
  MeResponse,
  UpdateCommentInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { api } from '../api-client';
import { newCommentId, pendingComment, withQueued, withUpdate } from './comment-cache';
import {
  commentOutbox,
  type CommentAction,
  type CommentOutcome,
  type QueuedMedia,
} from './comment-outbox';
import { queryKeys } from './keys';

/*
 * Every change to comments goes through the comment outbox (`comment-outbox.ts`): shown at once
 * over the server's list, sent in the order made, kept in the browser while the server is out of
 * reach and sent once it is back. The mutations wait for the server's answer while it answers –
 * the AI is asked on the saved comment, a refusal is said where it was made – and go on at once
 * (`{ sent: false }`, the change shown pending) while it does not. `networkMode: 'always'`: the
 * outbox decides what waits for a connection, not TanStack Query (it would hold them unsent).
 */

/**
 * Comments of a deck – with what is queued here laid over them (`withQueued`). Changes by others
 * arrive live (BER-104, the viewer's live stream refetches); `live` says the stream is up –
 * polling is then only a slow safety net.
 */
export function useComments(deckId: string, enabled = true, live = false) {
  const outbox = commentOutbox();
  const queued = useSyncExternalStore(
    outbox.subscribe,
    () => outbox.queued(deckId),
    () => outbox.queued(deckId),
  );
  const select = useCallback((list: Comment[]) => withQueued(list, queued), [queued]);
  return useQuery({
    queryKey: queryKeys.comments(deckId),
    // A stored answer as it is: the query tells it by identity (`isStoredAnswer`) – with
    // comments of its own already, it keeps those rather than take an older list.
    queryFn: () => api.get<Comment[]>(`/decks/${deckId}/comments`),
    select,
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
  return () => invalidateDeckFeedback(queryClient, deckId);
}

const invalidateDeckFeedback = (client: QueryClient, deckId: string) =>
  Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
    client.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true }),
  ]);

/**
 * The server took `action`: its answer goes into the query cache, which the outbox lays what is
 * still queued over. Once nothing of the deck is left to send (`settled`), its comments and the
 * deck are asked for anew – a recording or a delete changes the storage used too.
 */
export function storeCommentAnswer(
  client: QueryClient,
  deckId: string,
  action: CommentAction,
  answer: Comment | null,
  settled = true,
): void {
  client.setQueryData<Comment[]>(queryKeys.comments(deckId), (current) => {
    if (!current) return current;
    if (action.type === 'delete') {
      return current.flatMap((comment) => {
        if (comment.parentId === action.commentId) return [];
        if (comment.id !== action.commentId) return [comment];
        return action.keepDrawing ? [{ ...comment, body: '', media: null, images: [] }] : [];
      });
    }
    if (!answer) return current;
    return current.some((comment) => comment.id === answer.id)
      ? current.map((comment) => (comment.id === answer.id ? answer : comment))
      : [...current, answer];
  });
  if (!settled) return;
  void invalidateDeckFeedback(client, deckId);
  if (action.type === 'delete' || (action.type === 'create' && action.media))
    void client.invalidateQueries({ queryKey: [...queryKeys.deck(deckId), 'media-usage'] });
}

/** The deck's comments as shown: the cache with what is queued laid over it. */
function shownComments(client: QueryClient, deckId: string): Comment[] {
  return withQueued(
    client.getQueryData<Comment[]>(queryKeys.comments(deckId)) ?? [],
    commentOutbox().queued(deckId),
  );
}

/**
 * Queues an action of the signed-in account on the deck's comments; resolves with what became of
 * it: the server's answer (in the cache), or held for later (shown pending meanwhile).
 */
function useSendComment(deckId: string) {
  const queryClient = useQueryClient();
  return async (
    action: CommentAction,
    options?: { shown?: boolean; userId?: string },
  ): Promise<CommentOutcome> => {
    const userId =
      options?.userId ?? queryClient.getQueryData<MeResponse>(queryKeys.me)?.user?.id ?? 'me';
    const outcome = await commentOutbox().enqueue(deckId, userId, action, options).done;
    // Stored by the outbox already (`installEditOutbox`), refetched once the deck has nothing left
    // to send – here again for an outbox without the app's query cache (tests), not refetched.
    if (outcome.sent) storeCommentAnswer(queryClient, deckId, action, outcome.answer, false);
    return outcome;
  };
}

/**
 * A new comment (root or reply, text or marks): saved when the server answers, the saved one
 * returned. Held for later (no connection), it goes on at once with the comment as it will be –
 * shown pending until it is saved. `shown`: shown at once (a reply), not only once it is held –
 * a new comment's draft shows it until then.
 */
export function useCreateComment(deckId: string, author: Author, { shown = false } = {}) {
  const send = useSendComment(deckId);
  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: CreateCommentInput) => {
      const withId = { ...input, id: input.id ?? newCommentId() };
      const comment = pendingComment(withId, deckId, author);
      const outcome = await send(
        { type: 'create', comment, input: withId },
        { shown, userId: author.id },
      );
      return (outcome.sent ? outcome.answer : null) ?? comment;
    },
  });
}

/**
 * A reply: shown in the thread at once (pending until saved), so the field clears right away. A
 * refusal says why where it was sent.
 */
export function useCreateReply(deckId: string, author: Author) {
  const create = useCreateComment(deckId, author, { shown: true });
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ input }: { input: CreateCommentInput; root: Comment }) =>
      create.mutateAsync(input),
  });
}

/**
 * A media comment written offline (a recording, pictures): kept with its files in the browser and
 * sent once the server can be reached – shown pending at once, playable from what was recorded.
 */
export function useQueueMediaComment(deckId: string, author: Author) {
  const send = useSendComment(deckId);
  return async (input: CreateCommentInput, media: QueuedMedia): Promise<Comment> => {
    const withId = { ...input, id: input.id ?? newCommentId() };
    const comment = pendingComment(withId, deckId, author);
    const { recording } = media;
    const shown: Comment = {
      ...comment,
      media: recording && {
        id: `${withId.id}-recording`,
        kind: recording.kind,
        url: URL.createObjectURL(recording.blob),
        mimeType: recording.mimeType,
        sizeBytes: recording.blob.size,
        durationMs: recording.durationMs,
        peaks: recording.peaks,
        transcript: null,
        transcriptStatus: 'none',
        transcriptSummary: null,
      },
      images: media.images.map((image, index) => ({
        id: `${withId.id}-image-${index}`,
        url: URL.createObjectURL(image),
        mimeType: image.type || 'image/png',
        sizeBytes: image.size,
      })),
    };
    const outcome = await send(
      { type: 'create', comment: shown, input: withId, media },
      { userId: author.id },
    );
    return (outcome.sent ? outcome.answer : null) ?? shown;
  };
}

export function useUpdateComment(deckId: string) {
  const queryClient = useQueryClient();
  const send = useSendComment(deckId);
  return useMutation({
    networkMode: 'always',
    // Shown at once (status toggles must feel instant); a refusal takes it back by itself.
    mutationFn: async ({ commentId, ...input }: UpdateCommentInput & { commentId: string }) => {
      const before = shownComments(queryClient, deckId).find((comment) => comment.id === commentId);
      const outcome = await send({ type: 'update', commentId, input });
      if (outcome.sent && outcome.answer) return outcome.answer;
      // Held for later: the comment as it will be.
      if (!before) throw new Error('Diesen Kommentar gibt es nicht (mehr).');
      return withUpdate(before, input);
    },
  });
}

/**
 * Sets one's own reaction to a comment (👍 / 👎 / egal), `null` takes it back. Shown at once like
 * status toggles; a refusal takes it back.
 */
export function useReactToComment(deckId: string, author: Author) {
  const send = useSendComment(deckId);
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ commentId, kind }: { commentId: string; kind: CommentReactionKind | null }) =>
      send({ type: 'react', commentId, kind, author }, { userId: author.id }),
  });
}

/** Deletes a drawing the eraser touched: it leaves the slide at once, and comes back on errors. */
export function useEraseDrawing(deckId: string) {
  const send = useSendComment(deckId);
  return useMutation({
    networkMode: 'always',
    mutationFn: (commentId: string) => send({ type: 'delete', commentId }),
  });
}

/** Makes a recording's transcript anew (it failed); the result arrives with the live comments. */
export function useRetryTranscript(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mediaId: string) => api.post(`/media/${mediaId}/transcript`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
  });
}

export function useDeleteComment(deckId: string) {
  const send = useSendComment(deckId);
  return useMutation({
    networkMode: 'always',
    /** `keepDrawing`: only the comment goes, its drawing / text on the slide stays. */
    mutationFn: ({
      commentId,
      keepDrawing = false,
    }: {
      commentId: string;
      keepDrawing?: boolean;
    }) => send({ type: 'delete', commentId, keepDrawing }),
  });
}
