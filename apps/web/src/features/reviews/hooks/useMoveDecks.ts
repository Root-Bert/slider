import { pluralize } from '@/lib/format';
import { useUpdateDecks, type BulkResult } from '@/lib/queries';
import { markDecksVisited } from '../lib/last-visits';

/** Moves decks into a folder (`null` = out of any); one request per deck. */
export function useMoveDecks() {
  const update = useUpdateDecks();
  return {
    ...update,
    mutate: (
      { deckIds, folderId }: { deckIds: readonly string[]; folderId: string | null },
      options?: Parameters<typeof update.mutate>[1],
    ) =>
      update.mutate(
        { deckIds, input: { folderId } },
        {
          ...options,
          onSuccess: (result, ...rest) => {
            // Our own change bumps `updatedAt` – it shouldn't show up as "Neu".
            markDecksVisited(result.done.map((entry) => entry.deckId));
            options?.onSuccess?.(result, ...rest);
          },
        },
      ),
  };
}

/** Toast text after a move: what went where, or what failed. */
export function movedMessage(
  result: BulkResult<unknown>,
  folderName: string | null,
): { text: string; tone?: 'danger' } {
  const failed = result.failed[0];
  if (failed) {
    return {
      text: `${pluralize(result.failed.length, 'Review konnte', 'Reviews konnten')} nicht verschoben werden: ${failed.message}`,
      tone: 'danger',
    };
  }
  const what = pluralize(result.done.length, 'Review', 'Reviews');
  return {
    text: folderName
      ? `${what} nach „${folderName}“ verschoben`
      : `${what} aus dem Ordner genommen`,
  };
}
