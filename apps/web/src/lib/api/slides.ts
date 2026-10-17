import type { Author, Slide } from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';
import { SIGNED_URL_STALE_MS } from './revisions';

export const useSlides = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.slides(deckId),
    queryFn: () => api.get<Slide[]>(`/decks/${deckId}/slides`),
    enabled,
    // Its image URLs are signed and expire (see `SIGNED_URL_STALE_MS`): reloaded before they do,
    // also on coming back to the tab – but not on every focus, it holds every slide's shapes.
    // A new revision or re-render reloads it anyway (`useInvalidateRevision`).
    staleTime: SIGNED_URL_STALE_MS,
    refetchInterval: SIGNED_URL_STALE_MS,
  });

/** Everyone who can open the deck (its workspace's members), for `@` suggestions (BER-105). */
export const useDeckPeople = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.people(deckId),
    queryFn: () => api.get<Author[]>(`/decks/${deckId}/people`),
    enabled,
    staleTime: 5 * 60_000,
  });
