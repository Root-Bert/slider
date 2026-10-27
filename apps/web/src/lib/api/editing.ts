import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiProposal,
  ApplyEditInput,
  CreateAiProposalInput,
  DeckEditState,
  SlideLayers,
  StockOrientation,
  StockSearch,
  UploadedEditImage,
  WorkspaceAi,
  AddWorkspaceAiKeyInput,
  AiModelList,
  UpdateWorkspaceAiKeyInput,
} from '@slider/shared';
import { api } from '../api-client';
import { queryKeys, workspaceKeys } from './keys';
import { useInvalidateSlideImages } from './revisions';

/*
 * Editing a deck in Slider (BER-180 – BER-183): its elements, operations on them, undo and redo,
 * saving back to the cloud, and the AI's proposals. Every answer is the new edit state; the
 * slides (titles, boxes, pictures) are reloaded alongside.
 */

export const useDeckEdit = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.edit(deckId),
    queryFn: () => api.get<DeckEditState>(`/decks/${deckId}/edit`),
    enabled,
  });

/** Stores an answer's edit state and reloads the slides it changed. */
function useEditAnswer(deckId: string) {
  const queryClient = useQueryClient();
  const reloadSlides = useInvalidateSlideImages(deckId);
  return (state: DeckEditState) => {
    queryClient.setQueryData(queryKeys.edit(deckId), state);
    return reloadSlides();
  };
}

export function useApplyEdit(deckId: string) {
  const answered = useEditAnswer(deckId);
  return useMutation({
    mutationFn: (input: ApplyEditInput) =>
      api.post<DeckEditState>(`/decks/${deckId}/edit/operations`, input),
    onSuccess: answered,
  });
}

export function useMoveEdit(deckId: string) {
  const answered = useEditAnswer(deckId);
  return useMutation({
    mutationFn: (direction: 'undo' | 'redo') =>
      api.post<DeckEditState>(`/decks/${deckId}/edit/${direction}`),
    onSuccess: answered,
  });
}

/** `background`: asked for ahead (the pointer came over it) – drawn after what someone waits for. */
export type BackgroundPriority = 'interactive' | 'background';

/**
 * The picture an element's text is typed over (the live editor): its slide drawn without that
 * text, by the server on asking – a second or two the first time.
 */
export function useTextBackground(deckId: string) {
  return useMutation({
    mutationFn: ({ elementId, priority }: { elementId: string; priority: BackgroundPriority }) =>
      api.post<{ url: string }>(
        `/decks/${deckId}/edit/elements/${encodeURIComponent(elementId)}/background`,
        { priority },
      ),
  });
}

/**
 * What the editor draws an element with while its slide is drawn anew after its look or place
 * changed (`POST …/cutout`): the slide without it, and its area and outline as masks – cut to
 * `box` on the slide – painted in its colours. `plain`: its look is one colour each or none, so
 * the masks painted draw it as LibreOffice does; `strokeWidth`: the outline's width in the mask.
 */
export interface ElementCutout {
  backdrop: string;
  fill: string | null;
  stroke: string | null;
  box: { x: number; y: number; w: number; h: number } | null;
  /** What lies over the element, drawn over it in turn (as it is), at `aboveBox`. */
  above: string | null;
  aboveBox: { x: number; y: number; w: number; h: number } | null;
  strokeWidth: number;
  plain: boolean;
  /** How see-through its area and outline are drawn (0–1). */
  fillOpacity: number;
  strokeOpacity: number;
}

export function useElementCutout(deckId: string) {
  return useMutation({
    mutationFn: ({ elementId, priority }: { elementId: string; priority: BackgroundPriority }) =>
      api.post<ElementCutout>(
        `/decks/${deckId}/edit/elements/${encodeURIComponent(elementId)}/cutout`,
        { priority },
      ),
  });
}

/**
 * A slide taken apart for the layers view (`SlideLayers`) at an edit step: drawn by the server on
 * asking – a few seconds the first time; the one before stays while the next is drawn.
 * `background`: a slide beside the one looked at – drawn after what someone waits for.
 */
export const useSlideLayers = (
  deckId: string,
  slideId: string | null,
  seq: number | undefined,
  {
    enabled = true,
    priority = 'interactive',
  }: { enabled?: boolean; priority?: BackgroundPriority } = {},
) =>
  useQuery({
    queryKey: queryKeys.slideLayers(deckId, slideId, seq),
    queryFn: () =>
      api.post<SlideLayers>(
        `/decks/${deckId}/edit/slides/${encodeURIComponent(slideId ?? '')}/layers`,
        { priority },
      ),
    enabled: enabled && slideId !== null && seq !== undefined,
    placeholderData: (previous, query) =>
      // Another step of the same slide: its pictures until the new ones come.
      query?.queryKey[2] === slideId ? keepPreviousData(previous) : undefined,
    staleTime: Infinity,
    // Drawn ahead while many are (503): asked again a little later.
    retry: priority === 'background' ? 3 : 1,
    retryDelay: (attempt) => 1500 * 2 ** attempt,
  });

export function useUploadEditImage(deckId: string) {
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return api.post<UploadedEditImage>(`/decks/${deckId}/edit/images`, body);
    },
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
    enabled: query.trim().length >= 2,
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

export function useSaveEdit(deckId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { overwrite?: boolean }) =>
      api.post<DeckEditState>(`/decks/${deckId}/edit/save`, input),
    onSuccess: (state) => queryClient.setQueryData(queryKeys.edit(deckId), state),
  });
}

/** Where the edited file downloads from (a plain link: the browser saves it). */
export const editedFileUrl = (deckId: string) => `/api/decks/${deckId}/edit/file`;

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

// ── Workspace AI keys ────────────────────────────────────────────────────

export const useWorkspaceAi = (workspaceId: string, enabled = true) =>
  useQuery({
    queryKey: workspaceKeys.ai(workspaceId),
    queryFn: () => api.get<WorkspaceAi>(`/workspaces/${workspaceId}/ai`),
    enabled,
  });

/** The models a stored key may run on – asked of its provider when the picker opens. */
export const useWorkspaceAiModels = (workspaceId: string, keyId: string, enabled: boolean) =>
  useQuery({
    queryKey: [...workspaceKeys.ai(workspaceId), 'models', keyId],
    queryFn: () => api.get<AiModelList>(`/workspaces/${workspaceId}/ai/keys/${keyId}/models`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

export function useAddWorkspaceAiKey(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddWorkspaceAiKeyInput) =>
      api.post<WorkspaceAi>(`/workspaces/${workspaceId}/ai/keys`, input),
    onSuccess: (ai) => queryClient.setQueryData(workspaceKeys.ai(workspaceId), ai),
  });
}

export function useUpdateWorkspaceAiKey(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ keyId, ...input }: UpdateWorkspaceAiKeyInput & { keyId: string }) =>
      api.patch<WorkspaceAi>(`/workspaces/${workspaceId}/ai/keys/${keyId}`, input),
    onSuccess: (ai) => queryClient.setQueryData(workspaceKeys.ai(workspaceId), ai),
  });
}

export function useRemoveWorkspaceAiKey(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) => api.delete(`/workspaces/${workspaceId}/ai/keys/${keyId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.ai(workspaceId) }),
  });
}
