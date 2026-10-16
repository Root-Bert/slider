import type { Deck } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { useDeleteDecks, type BulkResult } from '@/lib/api';
import { ConfirmDialog } from '@/ui';

/** Titles listed in the dialog when several decks are deleted; the rest as "und N weitere". */
const LISTED_TITLES = 5;

export function DeleteDeckDialog({
  decks,
  onClose,
  onDeleted,
}: {
  decks: readonly Deck[];
  onClose: () => void;
  onDeleted: (result: BulkResult<unknown>) => void;
}) {
  const remove = useDeleteDecks();
  const single = decks.length === 1 ? decks[0] : undefined;
  const failed = remove.data?.failed ?? [];

  return (
    <ConfirmDialog
      onClose={onClose}
      title={
        single
          ? `„${single.title}“ löschen?`
          : `${pluralize(decks.length, 'Review', 'Reviews')} löschen?`
      }
      description={
        <div className="flex flex-col gap-2">
          {!single && (
            <ul className="flex flex-col gap-0.5 text-fg">
              {decks.slice(0, LISTED_TITLES).map((deck) => (
                <li key={deck.id} className="truncate">
                  „{deck.title}“
                </li>
              ))}
              {decks.length > LISTED_TITLES && (
                <li className="text-fg-subtle">und {decks.length - LISTED_TITLES} weitere</li>
              )}
            </ul>
          )}
          <span>Wird endgültig entfernt:</span>
          <ul className="list-disc pl-5">
            <li>Kommentare und Zeichnungen</li>
            <li>Folienbilder</li>
            <li>Hochgeladene {single ? 'Datei' : 'Dateien'}</li>
          </ul>
          <span>Original in OneDrive/SharePoint bleibt.</span>
        </div>
      }
      confirmLabel="Endgültig löschen"
      confirmIcon="delete"
      pending={remove.isPending}
      onConfirm={() =>
        remove.mutate(
          decks.map((deck) => deck.id),
          {
            // A single deck that couldn't go stays open with the reason; the caller
            // reports partial failures of several.
            onSuccess: (result) => (!single || result.failed.length === 0) && onDeleted(result),
          },
        )
      }
      error={failed[0]?.message}
    />
  );
}
