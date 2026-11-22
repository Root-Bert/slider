import type { CloudTargetInput, Deck, RerenderResult, UpdateDeckInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from '../api-client';
import { queryKeys } from './keys';
import { isGoneError } from './status';

const IMPORT_POLL_MS = 1000;
/** The deck page waits for its import: a short one (uploads open on their previews) shows at once. */
const DECK_IMPORT_POLL_MS = 300;
const IMPORT_STALLED_AFTER_MS = 120_000;
const IMPORT_STALLED_POLL_MS = 3000;
const isImporting = (deck: Deck | undefined) =>
  deck?.import.status === 'queued' || deck?.import.status === 'running';

/** Since when the imports polled for have looked the same. */
export type ImportStall = { state: string; since: number } | null;

/**
 * Poll interval while imports run: `fastMs`, or every 3 s once their state hasn't moved for two
 * minutes (a stuck worker would otherwise be asked every second forever) – a slow step's end is
 * still seen within moments. `state`: the running imports as a
 * string, `null` when none runs (polling stops). Updates `stall` (kept per hook).
 */
export function importPollInterval(
  stall: { current: ImportStall },
  state: string | null,
  fastMs: number,
  now = Date.now(),
): number | false {
  if (state === null) {
    stall.current = null;
    return false;
  }
  if (stall.current?.state !== state) stall.current = { state, since: now };
  return now - stall.current.since > IMPORT_STALLED_AFTER_MS ? IMPORT_STALLED_POLL_MS : fastMs;
}

/** The decks of one workspace (BER-129). */
export function useDecks(workspaceId: string) {
  const stall = useRef<ImportStall>(null);
  return useQuery({
    queryKey: queryKeys.deckList(workspaceId),
    queryFn: () => api.get<Deck[]>(`/decks?workspaceId=${encodeURIComponent(workspaceId)}`),
    // Keep "Import läuft" cards fresh without a realtime channel (BER-104 comes later).
    // A 4xx (access lost) keeps the last list, which would keep polling otherwise.
    refetchInterval: (query) => {
      const importing = isGoneError(query.state.error)
        ? []
        : (query.state.data ?? []).filter(isImporting);
      const state = importing.length
        ? JSON.stringify(importing.map((deck) => [deck.id, deck.import]))
        : null;
      return importPollInterval(stall, state, IMPORT_POLL_MS * 2);
    },
  });
}

/** Polls while the deck is importing so the progress view advances (BER-97). */
export function useDeck(deckId: string) {
  const stall = useRef<ImportStall>(null);
  return useQuery({
    queryKey: queryKeys.deck(deckId),
    queryFn: () => api.get<Deck>(`/decks/${deckId}`),
    // A deleted deck (404) keeps its last "importing" data: stop polling it.
    refetchInterval: (query) => {
      const deck = query.state.data;
      const importing = !isGoneError(query.state.error) && isImporting(deck);
      return importPollInterval(
        stall,
        importing ? JSON.stringify(deck?.import) : null,
        DECK_IMPORT_POLL_MS,
      );
    },
  });
}

type Lists = ReturnType<typeof useQueryClient>;
const TRASH_LISTS = ['decks', 'trash'] as const;

/**
 * The lists show a change at once, before the server answers; what comes back is how to take it
 * back when the server refuses. Every caller reloads the lists afterwards anyway.
 */
async function changeLists(
  queryClient: Lists,
  queryKey: readonly string[],
  change: (decks: Deck[]) => Deck[],
): Promise<() => void> {
  await queryClient.cancelQueries({ queryKey });
  const before = queryClient.getQueriesData<Deck[]>({ queryKey });
  queryClient.setQueriesData<Deck[]>({ queryKey }, (decks) => decks && change(decks));
  return () => before.forEach(([key, decks]) => queryClient.setQueryData(key, decks));
}

/** What a list row shows of an update: the name, and whether it is archived. */
const updated =
  (deckIds: readonly string[], input: UpdateDeckInput) =>
  (decks: Deck[]): Deck[] =>
    decks.map((deck) =>
      deckIds.includes(deck.id)
        ? {
            ...deck,
            ...(input.title !== undefined && { title: input.title }),
            ...(input.archived !== undefined && {
              archivedAt: input.archived ? (deck.archivedAt ?? new Date().toISOString()) : null,
            }),
          }
        : deck,
    );
const without =
  (deckIds: readonly string[]) =>
  (decks: Deck[]): Deck[] =>
    decks.filter((deck) => !deckIds.includes(deck.id));

export function useUpdateDeck(deckId: string, scope?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    ...(scope && { scope: { id: scope } }),
    mutationFn: (input: UpdateDeckInput) => api.patch<Deck>(`/decks/${deckId}`, input),
    onMutate: (input) =>
      input.title === undefined && input.archived === undefined
        ? undefined
        : changeLists(queryClient, queryKeys.deckLists, updated([deckId], input)),
    onError: (_error, _input, undo) => {
      undo?.();
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
    },
    onSuccess: (deck) => {
      // In line with other changes (`scope`): only what this one set, not their state before.
      queryClient.setQueryData<Deck>(queryKeys.deck(deckId), (current) =>
        scope && current ? { ...current, title: deck.title, updatedAt: deck.updatedAt } : deck,
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.deckLists });
    },
  });
}

export function useDeleteDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => api.delete(`/decks/${deckId}`),
    onSuccess: () => {
      // One trash for both apps: its file in Cloud went or came with it.
      void queryClient.invalidateQueries({ queryKey: ['cloud'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      // Frees a slot of the plan's deck limit (`Workspace.usage`, BER-130).
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** The trash: deleted presentations one may bring back („Papierkorb“). */
export function useTrashedDecks(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.deckTrash(workspaceId),
    queryFn: () => api.get<Deck[]>(`/decks/trash?workspaceId=${encodeURIComponent(workspaceId)}`),
  });
}

/** „Wiederherstellen“ out of the trash. */
export function useRestoreDeck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => api.post(`/decks/${deckId}/restore`),
    onMutate: (deckId) => changeLists(queryClient, TRASH_LISTS, without([deckId])),
    onError: (_error, _deckId, undo) => undo?.(),
    onSuccess: () => {
      // One trash for both apps: its file in Cloud went or came with it.
      void queryClient.invalidateQueries({ queryKey: ['cloud'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
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

/** „Verschieben …“: the folder in Cloud the presentations lie in from now on. */
export function usePlaceDecks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckIds, target }: { deckIds: readonly string[]; target: CloudTargetInput }) =>
      eachDeck(deckIds, (deckId) => api.put<Deck>(`/decks/${deckId}/place`, target)),
    onSettled: (_result, _error, { deckIds }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      for (const deckId of deckIds) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.deck(deckId) });
      }
      void queryClient.invalidateQueries({ queryKey: ['cloud'] });
    },
  });
}

export function useUpdateDecks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ deckIds, input }: { deckIds: readonly string[]; input: UpdateDeckInput }) =>
      eachDeck(deckIds, (deckId) => api.patch<Deck>(`/decks/${deckId}`, input)),
    // A deck the server refused shows as before once the lists are reloaded (`onSettled`).
    onMutate: ({ deckIds, input }) => {
      void changeLists(queryClient, queryKeys.deckLists, updated(deckIds, input));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.decks }),
  });
}

/** „Löschen“: into the trash – `forGood`: out of it („Endgültig löschen“). */
export function useDeleteDecks(forGood = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deckIds: readonly string[]) =>
      eachDeck(deckIds, (deckId) => api.delete(`/decks/${deckId}${forGood ? '/trash' : ''}`)),
    onMutate: (deckIds) => {
      void changeLists(queryClient, forGood ? TRASH_LISTS : queryKeys.deckLists, without(deckIds));
    },
    onSettled: () => {
      // One trash for both apps: its file in Cloud went or came with it.
      void queryClient.invalidateQueries({ queryKey: ['cloud'] });
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
