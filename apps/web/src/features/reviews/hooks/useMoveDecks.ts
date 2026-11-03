import { useUpdateDecks } from '@/lib/api';

/** Moves decks into a folder (`null` = out of any); one request per deck. */
export function useMoveDecks() {
  const update = useUpdateDecks();
  return {
    ...update,
    mutate: (
      { deckIds, folderId }: { deckIds: readonly string[]; folderId: string | null },
      options?: Parameters<typeof update.mutate>[1],
    ) => update.mutate({ deckIds, input: { folderId } }, options),
  };
}
