import {
  type Author,
  type Comment,
  type CreateCommentInput,
  type CreateReviewLinkInput,
  type Deck,
  type InviteInfo,
  type JoinInviteInput,
  type MeResponse,
  type ReviewLink,
  type Slide,
  type UpdateCommentInput,
  type UpdateDeckInput,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { confirmComment, pendingReply } from './comment-cache';

/** Central query keys, so invalidation stays consistent across features. */
export const queryKeys = {
  me: ['me'] as const,
  decks: ['decks'] as const,
  deck: (deckId: string) => ['decks', deckId] as const,
  slides: (deckId: string) => ['decks', deckId, 'slides'] as const,
  comments: (deckId: string) => ['decks', deckId, 'comments'] as const,
  reviewLinks: (deckId: string) => ['decks', deckId, 'review-links'] as const,
  invite: (token: string) => ['invites', token] as const,
};

const IMPORT_POLL_MS = 1000;
const isImporting = (deck: Deck | undefined) =>
  deck?.import.status === 'queued' || deck?.import.status === 'running';

// ── Session ─────────────────────────────────────────────────────────────────

export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<MeResponse>('/me'),
    staleTime: Infinity,
  });

// ── Decks ───────────────────────────────────────────────────────────────────

export const useDecks = () =>
  useQuery({
    queryKey: queryKeys.decks,
    queryFn: () => api.get<Deck[]>('/decks'),
    // Keep "Import läuft" cards fresh without a realtime channel (BER-104 comes later).
    refetchInterval: (query) => (query.state.data?.some(isImporting) ? IMPORT_POLL_MS * 2 : false),
  });

/** Polls while the deck is importing so the progress view advances (BER-97). */
export const useDeck = (deckId: string) =>
  useQuery({
    queryKey: queryKeys.deck(deckId),
    queryFn: () => api.get<Deck>(`/decks/${deckId}`),
    refetchInterval: (query) => (isImporting(query.state.data) ? IMPORT_POLL_MS : false),
  });

export function useUpdateDeck(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateDeckInput) => api.patch<Deck>(`/decks/${deckId}`, input),
    onSuccess: (deck) => {
      queryClient.setQueryData(queryKeys.deck(deckId), deck);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks, exact: true });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => api.delete(`/decks/${deckId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
  });
}

export const useImportLink = () =>
  useMutation({ mutationFn: (url: string) => api.post<Deck>('/decks/link', { url }) });

// ── Slides & comments ───────────────────────────────────────────────────────

export const useSlides = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.slides(deckId),
    queryFn: () => api.get<Slide[]>(`/decks/${deckId}/slides`),
    enabled,
  });

export const useComments = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.comments(deckId),
    queryFn: () => api.get<Comment[]>(`/decks/${deckId}/comments`),
    enabled,
    // Light polling until realtime lands (BER-104): other reviewers' comments show up.
    refetchInterval: 15_000,
  });

function useInvalidateDeckFeedback(deckId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.slides(deckId) }),
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
      queryClient.setQueryData<Comment[]>(queryKeys.comments(deckId), (current = []) => [
        ...current,
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
      const previous = queryClient.getQueryData<Comment[]>(key);
      queryClient.setQueryData<Comment[]>(key, (current = []) =>
        current.map((comment) => (comment.id === commentId ? { ...comment, ...input } : comment)),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.comments(deckId), context.previous);
    },
    onSettled: invalidate,
  });
}

export function useDeleteComment(deckId: string) {
  const invalidate = useInvalidateDeckFeedback(deckId);
  return useMutation({
    mutationFn: (commentId: string) => api.delete(`/comments/${commentId}`),
    onSuccess: invalidate,
  });
}

// ── Sharing ─────────────────────────────────────────────────────────────────

export const useReviewLinks = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.reviewLinks(deckId),
    queryFn: () => api.get<ReviewLink[]>(`/decks/${deckId}/review-links`),
    enabled,
  });

export function useCreateReviewLink(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewLinkInput) =>
      api.post<ReviewLink>(`/decks/${deckId}/review-links`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewLinks(deckId) }),
  });
}

export function useRevokeReviewLink(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.delete(`/review-links/${linkId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviewLinks(deckId) }),
  });
}

export const useInvite = (token: string) =>
  useQuery({
    queryKey: queryKeys.invite(token),
    queryFn: () => api.get<InviteInfo>(`/invites/${token}`),
    retry: false,
  });

export function useJoinInvite(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JoinInviteInput) => api.post<MeResponse>(`/invites/${token}/join`, input),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
  });
}

export function useLeaveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/session/leave'),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
