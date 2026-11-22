import { DECK_TRASH_DAYS, type Deck } from '@slider/shared';
import { pluralize } from '@/lib/format';
import { useDeleteDecks, type BulkResult } from '@/lib/api';
import { ConfirmDialog } from '@/ui';

/** Titles listed in the dialog when several decks are deleted; the rest as "und N weitere". */
const LISTED_TITLES = 5;

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
    linked.some((deck) => deck.source === 'nextcloud') && 'in Nextcloud',
    // Decks once linked from OneDrive, SharePoint or Google Drive read as any other link.
    linked.some((deck) => deck.source !== 'nextcloud') && 'unter dem Link',
  ].filter((place) => place !== false);
  const where = places.join(' bzw. ');
  const kept =
    uploaded > 0
      ? `Bei verknüpften Präsentationen bleibt das Original ${where}.`
      : linked.length === 1
        ? `Das Original ${where} bleibt.`
        : `Die Originale ${where} bleiben.`;
  return { removed, kept };
}

export function DeleteDeckDialog({
  decks,
  filesStay = false,
  forGood = false,
  onClose,
  onDeleted,
}: {
  decks: readonly Deck[];
  /** In the desktop app: a deck is a file on this computer – that file stays (BER-201). */
  filesStay?: boolean;
  /** Out of the trash („Endgültig löschen“); else „Löschen“ puts them into it. */
  forGood?: boolean;
  onClose: () => void;
  onDeleted: (result: BulkResult<unknown>) => void;
}) {
  const remove = useDeleteDecks(forGood);
  const single = decks.length === 1 ? decks[0] : undefined;
  const failed = remove.data?.failed ?? [];
  const copy = fileCopy(decks);

  return (
    <ConfirmDialog
      onClose={onClose}
      title={
        single
          ? `„${single.title}“ ${forGood ? 'endgültig ' : ''}löschen?`
          : `${pluralize(decks.length, 'Präsentation', 'Präsentationen')} ${forGood ? 'endgültig ' : ''}löschen?`
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
          {forGood ? (
            <>
              <span>Wird endgültig gelöscht:</span>
              <ul className="list-disc pl-5">
                <li>Kommentare und Zeichnungen</li>
                <li>Folienbilder</li>
                {copy.removed.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {copy.kept && <span>{copy.kept}</span>}
            </>
          ) : (
            <span>
              {single ? 'Sie liegt' : 'Sie liegen'} noch {DECK_TRASH_DAYS} Tage im Papierkorb und{' '}
              {single ? 'lässt' : 'lassen'} sich so lange wiederherstellen.
            </span>
          )}
          {filesStay && (
            <span>
              {single
                ? 'Die Datei auf diesem Computer bleibt.'
                : 'Dateien auf diesem Computer bleiben.'}
            </span>
          )}
        </div>
      }
      confirmLabel={forGood ? 'Endgültig löschen' : 'Löschen'}
      confirmIcon={forGood ? 'deleteForever' : 'delete'}
      pending={remove.isPending}
      onConfirm={() =>
        remove.mutate(
          decks.map((deck) => deck.id),
          {
            // Nothing went: the dialog stays open with the reason. The caller reports
            // partial failures of several.
            onSuccess: (result) => result.done.length > 0 && onDeleted(result),
          },
        )
      }
      error={failed[0]?.message}
    />
  );
}
