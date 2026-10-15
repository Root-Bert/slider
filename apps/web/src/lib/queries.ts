import {
  isTextStroke,
  moveDrawing,
  type Author,
  type Comment,
  type CreatedWorkspaceInvite,
  type CreateCommentInput,
  type Deck,
  type DeckFolder,
  type DeckStatus,
  type DeletedSlide,
  type ImportDriveItemInput,
  type MeResponse,
  type RerenderResult,
  type Revision,
  type RevisionDiff,
  type Slide,
  type SlideVersionView,
  type ShareDeckInput,
  type SyncResult,
  type UpdateCommentInput,
  type UpdateDeckInput,
  type UpdateMeInput,
  type WorkspaceInvite,
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
  /** The folders of one workspace – outside `decks`, so deck invalidation leaves them alone. */
  folders: (workspaceId: string) => ['folders', workspaceId] as const,
  slides: (deckId: string) => ['decks', deckId, 'slides'] as const,
  comments: (deckId: string) => ['decks', deckId, 'comments'] as const,
  shares: (deckId: string) => ['decks', deckId, 'shares'] as const,
  people: (deckId: string) => ['decks', deckId, 'people'] as const,
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
  /** One slide in every revision (Alt/Neu, BER-109) – keyed by the current revision too. */
  slideVersions: (deckId: string, slideId: string, revisionId: string | null) =>
    ['decks', deckId, 'slide-versions', slideId, revisionId] as const,
};

/**
 * Answers with slide image URLs: signed URLs expire after 6 h at the earliest (BER-94), so
 * these are fetched again after an hour instead of being kept forever.
 */
const SIGNED_URL_STALE_MS = 60 * 60_000;

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

// ── Folders ─────────────────────────────────────────────────────────────────

export const useFolders = (workspaceId: string) =>
  useQuery({
    queryKey: queryKeys.folders(workspaceId),
    queryFn: () => api.get<DeckFolder[]>(`/workspaces/${encodeURIComponent(workspaceId)}/folders`),
  });

export function useCreateFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<DeckFolder>(`/workspaces/${encodeURIComponent(workspaceId)}/folders`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.folders(workspaceId) }),
  });
}

export function useRenameFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, name }: { folderId: string; name: string }) =>
      api.patch<DeckFolder>(`/folders/${folderId}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.folders(workspaceId) }),
  });
}

/** Its decks stay, outside any folder – so the deck lists reload too. */
export function useDeleteFolder(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folderId: string) => api.delete(`/folders/${folderId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.folders(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
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

/** A file picked in Microsoft's OneDrive file picker. */
export function useImportDriveItem(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: Omit<ImportDriveItemInput, 'workspaceId'>) =>
      api.post<Deck>('/decks/drive-item', workspaceId ? { ...item, workspaceId } : item),
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

/** Everyone who can open the deck (its workspace's members), for `@` suggestions (BER-105). */
export const useDeckPeople = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.people(deckId),
    queryFn: () => api.get<Author[]>(`/decks/${deckId}/people`),
    enabled,
    staleTime: 5 * 60_000,
  });

/**
 * Comments of a deck. Changes by others arrive live (BER-104, the viewer's live stream refetches);
 * `live` says the stream is up – polling is then only a slow safety net.
 */
export const useComments = (deckId: string, enabled = true, live = false) =>
  useQuery({
    queryKey: queryKeys.comments(deckId),
    queryFn: () => api.get<Comment[]>(`/decks/${deckId}/comments`),
    enabled,
    refetchInterval: live ? 120_000 : 15_000,
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
function withUpdate(
  comment: Comment,
  { textBox, anchor: box, move, ...input }: UpdateCommentInput,
): Comment {
  if (move) return { ...moveDrawing(comment, move.dx, move.dy), ...input };
  const current = comment.anchor;
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
    /** `keepDrawing`: only the comment goes, its drawing / text on the slide stays. */
    mutationFn: ({
      commentId,
      keepDrawing = false,
    }: {
      commentId: string;
      keepDrawing?: boolean;
    }) => api.delete(`/comments/${commentId}${keepDrawing ? '?keep=drawing' : ''}`),
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
    staleTime: SIGNED_URL_STALE_MS,
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
      staleTime: SIGNED_URL_STALE_MS,
    })),
    combine: diffData,
  });

export const useDeletedSlides = (deckId: string, revisionId: string | null, enabled = true) =>
  useQuery({
    queryKey: queryKeys.deletedSlides(deckId, revisionId),
    queryFn: () => api.get<DeletedSlide[]>(`/decks/${deckId}/deleted-slides`),
    enabled: enabled && revisionId !== null,
    staleTime: SIGNED_URL_STALE_MS,
  });

/** One slide in every revision, newest first: "Alt" on a comment shows the one it was made on. */
export const useSlideVersions = (
  deckId: string,
  slideId: string | null,
  revisionId: string | null,
) =>
  useQuery({
    queryKey: queryKeys.slideVersions(deckId, slideId ?? '', revisionId),
    queryFn: () => api.get<SlideVersionView[]>(`/decks/${deckId}/slides/${slideId}/versions`),
    enabled: slideId !== null,
    staleTime: SIGNED_URL_STALE_MS,
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

// ── Several decks at once (multi-select in "Reviews") ──────────────────────

export interface BulkResult<T> {
  /** Per deck that went through, in the order asked for. */
  done: { deckId: string; result: T }[];
  failed: { deckId: string; message: string }[];
}

/** One request per deck, all at once; a failing deck doesn't stop the others. */
async function eachDeck<T>(
  deckIds: readonly string[],
  run: (deckId: string) => Promise<T>,
): Promise<BulkResult<T>> {
  const settled = await Promise.allSettled(deckIds.map(run));
  const outcome: BulkResult<T> = { done: [], failed: [] };
  settled.forEach((entry, index) => {
    const deckId = deckIds[index]!;
    if (entry.status === 'fulfilled') outcome.done.push({ deckId, result: entry.value });
    else {
      const reason: unknown = entry.reason;
      outcome.failed.push({
        deckId,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });
  return outcome;
}

export function useUpdateDecks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckIds, input }: { deckIds: readonly string[]; input: UpdateDeckInput }) =>
      eachDeck(deckIds, (deckId) => api.patch<Deck>(`/decks/${deckId}`, input)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
  });
}

export function useDeleteDecks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckIds: readonly string[]) =>
      eachDeck(deckIds, (deckId) => api.delete(`/decks/${deckId}`)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      // Frees slots of the plan's deck limit (`Workspace.usage`, BER-130).
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** "Neu rendern" for several decks; follow them with {@link useDeckStatuses}. */
export function useRerenderDecks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckIds: readonly string[]) =>
      eachDeck(deckIds, (deckId) => api.post<RerenderResult>(`/decks/${deckId}/rerender`)),
    // Status, slides and the deck list – a changed linked file comes in as a new revision.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
  });
}

/** New slide images for several decks: everything deck-related is reloaded. */
export function useInvalidateDecks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.decks });
}

/** Status of several decks, polled like {@link useDeckStatus} (fast while rendering). */
export const useDeckStatuses = (deckIds: readonly string[]) =>
  useQueries({
    queries: deckIds.map((deckId) => ({
      queryKey: queryKeys.status(deckId),
      queryFn: () => api.get<DeckStatus>(`/decks/${deckId}/status`),
      refetchInterval: (query: { state: { data?: DeckStatus } }) =>
        query.state.data?.rendering ? STATUS_POLL_RENDERING_MS : STATUS_POLL_MS,
      refetchIntervalInBackground: false,
    })),
  });

// ── Sharing ─────────────────────────────────────────────────────────────────

/** Invitations created by sharing this deck – each invites into the organisation as `viewer`. */
export const useDeckShares = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.shares(deckId),
    queryFn: () => api.get<WorkspaceInvite[]>(`/decks/${deckId}/share`),
    enabled,
  });

/** Sharing a deck = inviting into its organisation as `viewer` (there are no guests). */
export function useShareDeck(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ShareDeckInput) =>
      api.post<CreatedWorkspaceInvite>(`/decks/${deckId}/share`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shares(deckId) }),
  });
}

export function useRevokeDeckShare(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete(`/workspace-invites/${inviteId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.shares(deckId) }),
  });
}
