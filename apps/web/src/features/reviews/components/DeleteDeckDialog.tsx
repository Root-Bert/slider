import type { Deck, DeckSource } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { useDeleteDecks, type BulkResult } from '@/lib/api';
import { ConfirmDialog } from '@/ui';

/** Titles listed in the dialog when several decks are deleted; the rest as "und N weitere". */
const LISTED_TITLES = 5;

const MICROSOFT_SOURCES: readonly DeckSource[] = ['onedrive', 'sharepoint'];

/**
 * What happens to the PowerPoint files, by where the decks came from: an upload's file is the
 * only copy here and goes for good; a linked deck's stored copy goes, its original stays.
 */
function fileCopy(decks: readonly Deck[]): { removed: string[]; kept: string | null } {
  const uploaded = decks.filter((deck) => deck.source === 'upload').length;
  const linked = decks.filter((deck) => deck.source !== 'upload');
  const removed: string[] = [];
  if (uploaded > 0) removed.push(uploaded === 1 ? 'Hochgeladene Datei' : 'Hochgeladene Dateien');
  if (linked.length > 0) {
    removed.push(
      linked.length === 1
        ? 'Gespeicherte Kopie der Präsentation'
        : 'Gespeicherte Kopien der Präsentationen',
    );
  }
  if (linked.length === 0) return { removed, kept: null };

  const places = [
    linked.some((deck) => MICROSOFT_SOURCES.includes(deck.source)) && 'in OneDrive/SharePoint',
    linked.some((deck) => deck.source === 'nextcloud') && 'in Nextcloud',
    linked.some((deck) => deck.source === 'google') && 'in Google Drive',
    linked.some((deck) => deck.source === 'url') && 'unter dem Link',
  ].filter((place) => place !== false);
  const where = places.join(' bzw. ');
  const kept =
    uploaded > 0
      ? `Bei verknüpften Reviews bleibt das Original ${where}.`
      : linked.length === 1
        ? `Das Original ${where} bleibt.`
        : `Die Originale ${where} bleiben.`;
  return { removed, kept };
}

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
  const copy = fileCopy(decks);

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
            {copy.removed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {copy.kept && <span>{copy.kept}</span>}
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
