import type { Deck } from '@slider/shared';
import { DestinationDialog } from '@/features/cloud';
import { pluralize } from '@/lib/format';
import { usePlaceDecks, type BulkResult } from '@/lib/api';

/**
 * „Verschieben …“: where one or several presentations lie – a folder in Cloud, an area, or
 * one's own files. Presentations have no folders of their own; where they lie says who sees
 * them.
 */
export function MoveDecksDialog({
  decks,
  workspaceId,
  onClose,
  onMoved,
}: {
  decks: readonly Deck[];
  workspaceId: string;
  onClose: () => void;
  onMoved: (result: BulkResult<unknown>, placeName: string) => void;
}) {
  const place = usePlaceDecks();
  return (
    <DestinationDialog
      workspaceId={workspaceId}
      nodes={[]}
      heading={
        decks.length === 1
          ? `„${decks[0]!.title}“ verschieben`
          : `${pluralize(decks.length, 'Präsentation', 'Präsentationen')} verschieben`
      }
      verb="verschieben"
      pending={place.isPending}
      error={place.error?.message ?? place.data?.failed[0]?.message}
      onClose={onClose}
      onPick={({ name, ...target }) =>
        place.mutate(
          { deckIds: decks.map((deck) => deck.id), target },
          // Nothing moved: the dialog stays open with the reason.
          { onSuccess: (result) => result.done.length > 0 && onMoved(result, name) },
        )
      }
    />
  );
}
