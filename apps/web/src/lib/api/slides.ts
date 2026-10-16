import type { Author, Slide } from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';
import { queryKeys } from './keys';

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
