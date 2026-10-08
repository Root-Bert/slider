import {
  isTextStroke,
  type Author,
  type Comment,
  type CreateCommentInput,
  type CreateReviewLinkInput,
  type Deck,
  type DeckStatus,
  type DeletedSlide,
  type InsertSlideInput,
  type InsertSlideResult,
  type InviteInfo,
  type JoinInviteInput,
  type MeResponse,
  type RerenderResult,
  type Revision,
  type RevisionDiff,
  type ReviewLink,
  type Slide,
  type SyncResult,
  type UpdateCommentInput,
  type UpdateDeckInput,
  type UpdateMeInput,
} from '@slider/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { confirmComment, pendingReply } from './comment-cache';

/** Central query keys, so invalidation stays consistent across features. */
export const queryKeys = {
  me: ['me'] as const,
  decks: ['decks'] as const,
  /** Every workspace's deck list – invalidate this after a deck was created or changed. */
  deckLists: ['decks', 'list'] as const,
  deckList: (workspaceId: string) => ['decks', 'list', workspaceId] as const,
  /** The decks of all my workspaces (tab "Geteilt"). */
  allDecks: ['decks', 'list', '*'] as const,
  deck: (deckId: string) => ['decks', deckId] as const,
  slides: (deckId: string) => ['decks', deckId, 'slides'] as const,
  comments: (deckId: string) => ['decks', deckId, 'comments'] as const,
  reviewLinks: (deckId: string) => ['decks', deckId, 'review-links'] as const,
  status: (deckId: string) => ['decks', deckId, 'status'] as const,
  revisions: (deckId: string) => ['decks', deckId, 'revisions'] as const,
  /**
   * One revision's diff – it never changes. Fetched by id (never via `latest`), so an entry can
   * never hold another revision's diff, and outside the `revisions` list key so reloading the
   * list doesn't refetch every diff.
   */
  revisionDiff: (deckId: string, revisionId: string | null) =>
    ['decks', deckId, 'revision-diff', revisionId] as const,
  deletedSlides: (deckId: string, revisionId: string | null) =>
    ['decks', deckId, 'deleted-slides', revisionId] as const,
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

/** Picks the viewer's colour; their comments are recoloured, so everything deck-related reloads. */
export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.patch<MeResponse>('/me', input),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me, me);
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
    },
  });
}

// ── Decks ───────────────────────────────────────────────────────────────────

/** The decks of one workspace (BER-129). */
export const useDecks = (workspaceId: string) =>
  useQuery({
    queryKey: queryKeys.deckList(workspaceId),
    queryFn: () => api.get<Deck[]>(`/decks?workspaceId=${encodeURIComponent(workspaceId)}`),
    // Keep "Import läuft" cards fresh without a realtime channel (BER-104 comes later).
    refetchInterval: (query) => (query.state.data?.some(isImporting) ? IMPORT_POLL_MS * 2 : false),
  });

/** The decks of every workspace I belong to – `GET /decks` without `workspaceId`. */
export const useAllDecks = () =>
  useQuery({
    queryKey: queryKeys.allDecks,
    queryFn: () => api.get<Deck[]>('/decks'),
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => api.delete(`/decks/${deckId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      // Frees a slot of the plan's deck limit (`Workspace.usage`, BER-130).
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export function useImportLink(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (url: string) =>
      api.post<Deck>('/decks/link', workspaceId ? { url, workspaceId } : { url }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  });
}

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

export function useInvalidateDeckFeedback(deckId: string) {
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

/** The comment as the server will return it after `input` (mirrors `updateComment`). */
function withUpdate(comment: Comment, { textBox, ...input }: UpdateCommentInput): Comment {
  const next = { ...comment, ...input };
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
      const previous = queryClient.getQueryData<Comment[]>(key);
      queryClient.setQueryData<Comment[]>(key, (current = []) =>
        current.map((comment) => (comment.id === commentId ? withUpdate(comment, input) : comment)),
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

// ── Revisions & automatic updates (BER-107, BER-109) ───────────────────────

/** Status poll every 20 s while the tab is visible; faster while a change is being imported. */
const STATUS_POLL_MS = 20_000;
const STATUS_POLL_PENDING_MS = 5_000;
/** While slide images are re-rendered (BER-94): progress in the ⋯ menu. */
const STATUS_POLL_RENDERING_MS = 1_500;

export const useDeckStatus = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.status(deckId),
    queryFn: () => api.get<DeckStatus>(`/decks/${deckId}/status`),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.rendering
        ? STATUS_POLL_RENDERING_MS
        : query.state.data?.sync.pending
          ? STATUS_POLL_PENDING_MS
          : STATUS_POLL_MS,
    // Hidden tabs don't poll; coming back (focus / visibility) refetches right away.
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

export const useRevisions = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.revisions(deckId),
    queryFn: () => api.get<Revision[]>(`/decks/${deckId}/revisions`),
    enabled,
    staleTime: 60_000,
  });

/**
 * What the current revision changed; only fetched from revision 2 on. Asks for the revision by
 * id rather than `latest`: right after a new revision `latest` already means the new one, and its
 * diff must not land in the cache entry of the revision before it.
 */
export const useLatestDiff = (deckId: string, revisionId: string | null, enabled = true) =>
  useQuery({
    queryKey: queryKeys.revisionDiff(deckId, revisionId),
    queryFn: () => api.get<RevisionDiff>(`/decks/${deckId}/revisions/${revisionId}/diff`),
    enabled: enabled && revisionId !== null,
    staleTime: Infinity,
  });

/** Stable `combine`, so the result only changes when a diff arrives. */
const diffData = (results: { data?: RevisionDiff }[]) => results.map((result) => result.data);

/**
 * Diffs of the given (earlier) revisions – a revision's diff never changes. Same cache entry as
 * {@link useLatestDiff} got for that revision while it was the current one.
 */
export const useRevisionDiffs = (deckId: string, revisionIds: readonly string[]) =>
  useQueries({
    queries: revisionIds.map((revisionId) => ({
      queryKey: queryKeys.revisionDiff(deckId, revisionId),
      queryFn: () => api.get<RevisionDiff>(`/decks/${deckId}/revisions/${revisionId}/diff`),
      staleTime: Infinity,
    })),
    combine: diffData,
  });

export const useDeletedSlides = (deckId: string, revisionId: string | null, enabled = true) =>
  useQuery({
    queryKey: queryKeys.deletedSlides(deckId, revisionId),
    queryFn: () => api.get<DeletedSlide[]>(`/decks/${deckId}/deleted-slides`),
    enabled: enabled && revisionId !== null,
    staleTime: Infinity,
  });

/**
 * Everything that belongs to a revision: reloaded when a new one arrives. Diffs and deleted
 * slides are keyed by revision id – the new deck DTO brings a new id and with it fresh queries,
 * so they're left alone here (invalidating them would only refetch the old revision's entries).
 */
export function useInvalidateRevision(deckId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.slides(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.comments(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.revisions(deckId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.status(deckId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
    ]);
}

/** "Neu laden" for link imports: checks the source now (owner only). */
export function useSyncDeck(deckId: string) {
  const invalidate = useInvalidateRevision(deckId);
  return useMutation({
    mutationFn: () => api.post<SyncResult>(`/decks/${deckId}/sync`),
    onSettled: invalidate,
  });
}

/**
 * ⊕ between slides: an empty slide, written straight into the linked PowerPoint (owner only,
 * BER-128). The new revision is loaded before `mutate`'s own callbacks run.
 */
export function useInsertSlide(deckId: string) {
  const invalidate = useInvalidateRevision(deckId);
  return useMutation({
    mutationFn: (input: InsertSlideInput) =>
      api.post<InsertSlideResult>(`/decks/${deckId}/slides`, input),
    onSettled: invalidate,
  });
}

/** "Neue Version hochladen" for uploaded decks (owner only). */
export function useUploadRevision(deckId: string) {
  const invalidate = useInvalidateRevision(deckId);
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post<SyncResult>(`/decks/${deckId}/revisions`, form);
    },
    onSettled: invalidate,
  });
}

/**
 * "Neu rendern" (BER-94): queues new slide images, Office first, then LibreOffice. Progress and
 * the end show up in the deck status (`rendering`, `renderedAt`). `newVersion`: the linked file
 * had changed and comes in as a new revision instead.
 */
export function useRerenderDeck(deckId: string) {
  const queryClient = useQueryClient();
  const invalidateRevision = useInvalidateRevision(deckId);
  return useMutation({
    mutationFn: () => api.post<RerenderResult>(`/decks/${deckId}/rerender`),
    onSuccess: (result) =>
      result.status === 'newVersion'
        ? invalidateRevision()
        : queryClient.invalidateQueries({ queryKey: queryKeys.status(deckId), exact: true }),
  });
}

/** New slide images arrived: the slide list and thumbnails point at new files. */
export function useInvalidateSlideImages(deckId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.slides(deckId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.deckLists }),
    ]);
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
