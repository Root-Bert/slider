import type { Deck, RerenderResult, UpdateDeckInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from '../api-client';
import { queryKeys } from './keys';
import { isGoneError } from './status';

const IMPORT_POLL_MS = 1000;
const IMPORT_STALLED_AFTER_MS = 120_000;
const IMPORT_STALLED_POLL_MS = 10_000;
const isImporting = (deck: Deck | undefined) =>
  deck?.import.status === 'queued' || deck?.import.status === 'running';

/** Since when the imports polled for have looked the same. */
export type ImportStall = { state: string; since: number } | null;

/**
 * Poll interval while imports run: `fastMs`, or every 10 s once their state hasn't moved for two
 * minutes (a stuck worker would otherwise be asked forever). `state`: the running imports as a
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
        IMPORT_POLL_MS,
      );
    },
  });
}

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
