import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  AiProposal,
  ApplyEditInput,
  ApplyEditResult,
  CreateAiProposalInput,
  DeckEditState,
  DeckLayouts,
  GenerateEditImageInput,
  RevertEditInput,
  SendExportInput,
  SlideLayers,
  StockOrientation,
  StockSearch,
  UpdateAiProposalInput,
  UploadedEditImage,
} from '@slider/shared';
import { useEffect } from 'react';
import { api, apiDownload, isStoredAnswer, unreachableError } from '../api-client';
import { queryKeys } from './keys';
import { invalidateSlideImages } from './revisions';

/*
 * Editing a deck in Slider (BER-180 – BER-183): its elements, operations on them, undo and redo,
 * saving back to the cloud, and the AI's proposals. Every answer is the new edit state; the
 * slides (titles, boxes, pictures) are reloaded alongside.
 */

/**
 * A slide just put in, shown before the server has it (`pending-slides.ts`): its id begins so,
 * and nothing is asked about it until it is the server's.
 */
export const STAND_IN_SLIDE = 'pending:';
export const isStandInSlide = (slideId: string) => slideId.startsWith(STAND_IN_SLIDE);

export const useDeckEdit = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.edit(deckId),
    queryFn: () => api.get<DeckEditState>(`/decks/${deckId}/edit`),
    enabled,
  });

/**
 * The layouts of the deck's own design, for „Folie einfügen“. Asked again each time it opens: a
 * layout taken in from a template changes them – the pictures are kept on the server.
 */
export const useDeckLayouts = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.deckLayouts(deckId),
    queryFn: () => api.get<DeckLayouts>(`/decks/${deckId}/layouts`),
    enabled,
  });

/**
 * Stores an answer's edit state and reloads the slides it changed – also from outside React (the
 * editor's outbox, `features/viewer/editing/edit-outbox.ts`).
 */
export function storeEditAnswer(queryClient: QueryClient, deckId: string, state: DeckEditState) {
  queryClient.setQueryData(queryKeys.edit(deckId), state);
  return invalidateSlideImages(queryClient, deckId);
}

function useEditAnswer(deckId: string) {
  const queryClient = useQueryClient();
  return (state: DeckEditState) => storeEditAnswer(queryClient, deckId, state);
}

/**
 * Sends one edit of the editor's: the new edit state. Not a mutation hook – the editor's outbox
 * sends (`edit-outbox.ts`), also once the editor is gone, and stores the answer itself.
 */
export const postEdit = (deckId: string, input: ApplyEditInput) =>
  api.post<ApplyEditResult>(`/decks/${deckId}/edit/operations`, input);

/** Takes back one own step (undo, or the undo's step: redo) – what others changed stays. */
export function useRevertEdit(deckId: string) {
  const answered = useEditAnswer(deckId);
  return useMutation({
    mutationFn: (input: RevertEditInput) =>
      api.post<ApplyEditResult>(`/decks/${deckId}/edit/revert`, input),
    onSuccess: answered,
  });
}

/** `background`: asked for ahead (the pointer came over it) – drawn after what someone waits for. */
export type BackgroundPriority = 'interactive' | 'background';

/**
 * A slide taken apart for the layers view (`SlideLayers`) at an edit step: drawn by the server on
 * asking – a few seconds the first time; the one before stays while the next is drawn.
 * `background`: a slide beside the one looked at – drawn after what someone waits for.
 */
/** A slide taken apart (`SlideLayers`) at an edit step – for `useSlideLayers` and drawing ahead. */
const pendingLayers = new Map<string, { priority: BackgroundPriority }>();
const layerRequestKey = (deckId: string, slideId: string, seq: number) =>
  JSON.stringify([deckId, slideId, seq]);

export const slideLayersQuery = (
  deckId: string,
  slideId: string,
  seq: number,
  priority: BackgroundPriority = 'interactive',
) => ({
  queryKey: queryKeys.slideLayers(deckId, slideId, seq),
  queryFn: async () => {
    const key = layerRequestKey(deckId, slideId, seq);
    const pending = { priority };
    pendingLayers.set(key, pending);
    try {
      const layers = await api.post<SlideLayers>(
        `/decks/${deckId}/edit/slides/${encodeURIComponent(slideId)}/layers`,
        { priority },
      );
      if (isStoredAnswer(layers) && layers.seq !== seq) throw unreachableError();
      return layers;
    } finally {
      if (pendingLayers.get(key) === pending) pendingLayers.delete(key);
    }
  },
  staleTime: Infinity,
});

export const useSlideLayers = (
  deckId: string,
  slideId: string | null,
  seq: number | undefined,
  {
    enabled = true,
    priority = 'interactive',
  }: { enabled?: boolean; priority?: BackgroundPriority } = {},
) => {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...slideLayersQuery(deckId, slideId ?? '', seq ?? 0, priority),
    enabled: enabled && slideId !== null && !isStandInSlide(slideId) && seq !== undefined,
    // Another step of the same slide: its pictures until the new ones come – also those of an
    // earlier step drawn ahead (`useLayersAhead`), so the layers open without waiting.
    placeholderData: (previous, query) =>
      query?.queryKey[2] === slideId
        ? keepPreviousData(previous)
        : queryClient
            .getQueriesData<SlideLayers>({ queryKey: ['slideLayers', deckId, slideId] })
            .reduce<SlideLayers | undefined>(
              (latest, [, data]) => (data && (!latest || data.seq > latest.seq) ? data : latest),
              undefined,
            ),
    // Drawn ahead while many are (503): asked again a little later.
    retry: priority === 'background' ? 3 : 1,
    retryDelay: (attempt) => 1500 * 2 ** attempt,
  });
  useEffect(() => {
    if (
      !enabled ||
      priority !== 'interactive' ||
      slideId === null ||
      seq === undefined ||
      query.fetchStatus !== 'fetching'
    )
      return;
    const pending = pendingLayers.get(layerRequestKey(deckId, slideId, seq));
    if (!pending || pending.priority === 'interactive') return;
    pending.priority = 'interactive';
    // Same render job, promoted by drawOnce on the server. The original query owns the
    // response and the cache; this second request only moves it ahead of speculative work.
    void api
      .post(`/decks/${deckId}/edit/slides/${encodeURIComponent(slideId)}/layers`, {
        priority: 'interactive',
      })
      .catch(() => {});
  }, [deckId, slideId, seq, enabled, priority, query.fetchStatus]);
  return query;
};

/**
 * A slide taken apart for the per-element editor (`SlideCompositor`): live texts left out of the
 * pictures and what the browser draws whole not drawn (`compose`). The one of an earlier step
 * stays while the next is drawn.
 */
export const useComposedLayers = (
  deckId: string,
  slideId: string,
  seq: number | undefined,
  enabled: boolean,
) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.composedLayers(deckId, slideId, seq),
    queryFn: async ({ queryKey }) => {
      const layers = await api.post<SlideLayers>(
        `/decks/${deckId}/edit/slides/${encodeURIComponent(slideId)}/layers`,
        { priority: 'interactive', compose: true },
      );
      // Offline, the slide's pictures as last drawn (kept by the service worker) – of another
      // step maybe: the elements the browser draws come from the model anyway, the others stand
      // as they were drawn. Drawn anew once back online.
      if (isStoredAnswer(layers) && layers.seq !== seq) {
        window.addEventListener('online', () => void queryClient.invalidateQueries({ queryKey }), {
          once: true,
        });
      }
      return layers;
    },
    enabled: enabled && !isStandInSlide(slideId) && seq !== undefined,
    // Another step of the same slide: its pictures until the new ones come.
    placeholderData: (previous, query) =>
      query?.queryKey[2] === slideId ? keepPreviousData(previous) : undefined,
    staleTime: Infinity,
    retry: 1,
  });
};

export function useUploadEditImage(deckId: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post<UploadedEditImage>(`/decks/${deckId}/edit/images`, body);
    },
  });
}

/** A picture generated from a description, cut to the frame's `aspect` – ready for `replaceImage`. */
export function useGenerateEditImage(deckId: string) {
  return useMutation({
    mutationFn: (input: GenerateEditImageInput) =>
      api.post<UploadedEditImage>(`/decks/${deckId}/edit/images/generate`, input),
  });
}

/** The picture of picture element `elementId` cut out of its background – ready for `replaceImage`. */
export function useRemoveBackground(deckId: string) {
  return useMutation({
    mutationFn: (elementId: string) =>
      api.post<UploadedEditImage>(
        `/decks/${deckId}/edit/elements/${encodeURIComponent(elementId)}/remove-background`,
      ),
  });
}

/** Stock photos (Unsplash) for a search; asks once the query has two letters. */
export const useStockSearch = (deckId: string, query: string, orientation?: StockOrientation) =>
  useQuery({
    queryKey: queryKeys.stockSearch(deckId, query.trim().toLowerCase(), orientation ?? ''),
    queryFn: () => {
      const params = new URLSearchParams({ q: query.trim() });
      if (orientation) params.set('orientation', orientation);
      return api.get<StockSearch>(`/decks/${deckId}/stock/photos?${params}`);
    },
    // Empty: photos at random; one letter is no search yet.
    enabled: query.trim().length !== 1,
    staleTime: 10 * 60_000,
  });

/** A stock photo picked for a frame: fetched into the deck, ready for `replaceImage`. */
export function usePickStockPhoto(deckId: string) {
  return useMutation({
    mutationFn: ({ photoId, aspect }: { photoId: string; aspect?: number }) =>
      api.post<UploadedEditImage>(`/decks/${deckId}/stock/photos/${encodeURIComponent(photoId)}`, {
        aspect,
      }),
  });
}

/** Where the edited file downloads from (a plain link: the browser saves it). */
export const editedFileUrl = (deckId: string) => `/api/decks/${deckId}/edit/file`;

/** The edited file as a PDF – LibreOffice draws it, which takes a moment. */
export const useDownloadEditedPdf = (deckId: string) =>
  useMutation({
    mutationFn: (fallbackName: string) => apiDownload(`/decks/${deckId}/edit/pdf`, fallbackName),
  });

/** One slide as a PDF (LibreOffice draws its page anew) or as its picture (PNG). */
export const useDownloadSlide = (deckId: string) =>
  useMutation({
    mutationFn: ({
      slideId,
      format,
      fallbackName,
    }: {
      slideId: string;
      format: 'pdf' | 'png';
      fallbackName: string;
    }) =>
      apiDownload(
        `/decks/${deckId}/edit/slides/${encodeURIComponent(slideId)}/${format}`,
        fallbackName,
      ),
  });

/** An export mailed to someone as an attachment (`mail` in the edit state: the server can). */
export const useSendExport = (deckId: string) =>
  useMutation({
    mutationFn: (input: SendExportInput) => api.post<void>(`/decks/${deckId}/edit/send`, input),
  });

// ── AI proposals ─────────────────────────────────────────────────────────

export const useAiProposals = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.proposals(deckId),
    queryFn: () => api.get<AiProposal[]>(`/decks/${deckId}/ai/proposals`),
    enabled,
    // The live channel says when one finishes; this only covers a dropped connection.
    refetchInterval: (query) =>
      query.state.data?.some((proposal) => proposal.status === 'running') ? 5_000 : false,
  });

export function useCreateProposal(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAiProposalInput) =>
      api.post<AiProposal>(`/decks/${deckId}/ai/proposals`, input),
    onSuccess: (proposal) =>
      queryClient.setQueryData<AiProposal[]>(queryKeys.proposals(deckId), (list) => [
        proposal,
        ...(list ?? []).filter((item) => item.id !== proposal.id),
      ]),
  });
}

/** Stops the AI at work on a comment. */
export function useCancelProposal(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      api.post<void>(`/decks/${deckId}/ai/proposals/${proposalId}/cancel`),
    onSuccess: (_, proposalId) =>
      queryClient.setQueryData<AiProposal[]>(queryKeys.proposals(deckId), (list) =>
        list?.map((item) =>
          item.id === proposalId ? { ...item, status: 'cancelled' as const } : item,
        ),
      ),
  });
}

/**
 * Its card done (✕, „Erledigt“) or open again – for everyone, as a thread is resolved. Optimistic
 * like `useUpdateComment`: shown at once, rolled back alone on an error; the others hear it live.
 */
export function useResolveProposal(deckId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.proposals(deckId);
  return useMutation({
    mutationFn: ({ proposalId, status }: UpdateAiProposalInput & { proposalId: string }) =>
      api.patch<AiProposal>(`/decks/${deckId}/ai/proposals/${proposalId}`, { status }),
    onMutate: async ({ proposalId, status }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient
        .getQueryData<AiProposal[]>(key)
        ?.find((item) => item.id === proposalId);
      const resolvedAt = status === 'done' ? new Date().toISOString() : null;
      queryClient.setQueryData<AiProposal[]>(key, (list) =>
        list?.map((item) => (item.id === proposalId ? { ...item, resolvedAt } : item)),
      );
      return { previous };
    },
    onError: (_error, { proposalId }, context) => {
      const previous = context?.previous;
      if (!previous) return;
      queryClient.setQueryData<AiProposal[]>(key, (list) =>
        list?.map((item) => (item.id === proposalId ? previous : item)),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** Takes an applied proposal back (`revert`) or applies it again (`reapply`). */
export function useMoveProposal(deckId: string) {
  const answered = useEditAnswer(deckId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, action }: { proposalId: string; action: 'revert' | 'reapply' }) =>
      api.post<DeckEditState>(`/decks/${deckId}/ai/proposals/${proposalId}/${action}`),
    onSuccess: async (state) => {
      await answered(state);
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposals(deckId) });
    },
  });
}

/** Puts another of the AI's photos in place of the one on the slide. */
export function useChooseProposalPhoto(deckId: string) {
  const answered = useEditAnswer(deckId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, photoId }: { proposalId: string; photoId: string }) =>
      api.post<DeckEditState>(`/decks/${deckId}/ai/proposals/${proposalId}/photo`, { photoId }),
    onSuccess: async (state) => {
      await answered(state);
      await queryClient.invalidateQueries({ queryKey: queryKeys.proposals(deckId) });
    },
  });
}
