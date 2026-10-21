import type { LegalTexts, UpdateLegalTextsInput } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

const LEGAL_KEY = ['legal'] as const;

/** Privacy policy and imprint of the instance (BER-141); no login needed. */
export const useLegalTexts = () =>
  useQuery({
    queryKey: LEGAL_KEY,
    queryFn: () => api.get<LegalTexts>('/legal'),
    staleTime: Infinity,
    retry: false,
  });

/** Instance admin: saves both texts (`null` or blank removes one). */
export function useSaveLegalTexts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateLegalTextsInput) => api.put<LegalTexts>('/legal', input),
    onSuccess: (texts) => queryClient.setQueryData(LEGAL_KEY, texts),
  });
}
